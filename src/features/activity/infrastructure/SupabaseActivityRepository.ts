import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../shared/errors/AppError.js';
import { getSupabaseAdmin } from '../../../platform/supabase/client.js';
import type {
  Activity,
  ActivityMetadata,
  ActivityRepository,
  ActivitySource,
  ListActivitiesQuery,
  NewActivity,
} from '../domain/Activity.js';

const TABLE = 'activities';
/** Keeps `in (...)` filters well under URL length limits. */
const IN_CHUNK = 100;

interface ActivityRow {
  id: string;
  user_id: string;
  source: string;
  external_id: string | null;
  type: string;
  started_at: string;
  ended_at: string;
  duration_sec: number | string;
  distance_m: number | string | null;
  energy_kcal: number | string | null;
  source_name: string | null;
  payload: ActivityMetadata | null;
  created_at: string;
}

/**
 * Activities in Postgres (Supabase). Uses the service-role client because the API, not RLS, enforces ownership:
 * every query filters by the verified user id. Duplicates are dropped by the unique index
 * `activities_user_source_external_key` through `insert ... on conflict do nothing`.
 */
export class SupabaseActivityRepository implements ActivityRepository {
  constructor(private readonly db: () => SupabaseClient = getSupabaseAdmin) {}

  async insertIgnoringDuplicates(userId: string, rows: readonly NewActivity[]): Promise<Activity[]> {
    if (rows.length === 0) return [];
    const { data, error } = await this.db()
      .from(TABLE)
      .upsert(rows.map((row) => toRow(userId, row)), { onConflict: 'user_id,source,external_id', ignoreDuplicates: true })
      .select('*');
    if (error) throw failure(error, 'ACTIVITY_CREATE_FAILED');
    return (data ?? []).map((row) => toActivity(row as ActivityRow));
  }

  async findByExternalIds(userId: string, source: ActivitySource, externalIds: readonly string[]): Promise<Activity[]> {
    const found: Activity[] = [];
    for (let i = 0; i < externalIds.length; i += IN_CHUNK) {
      const { data, error } = await this.db()
        .from(TABLE)
        .select('*')
        .eq('user_id', userId)
        .eq('source', source)
        .in('external_id', externalIds.slice(i, i + IN_CHUNK));
      if (error) throw failure(error, 'ACTIVITY_LIST_FAILED');
      found.push(...(data ?? []).map((row) => toActivity(row as ActivityRow)));
    }
    return found;
  }

  async findStartedBetween(userId: string, source: ActivitySource, fromIso: string, toIso: string): Promise<Activity[]> {
    const { data, error } = await this.db()
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq('source', source)
      .gte('started_at', fromIso)
      .lte('started_at', toIso);
    if (error) throw failure(error, 'ACTIVITY_LIST_FAILED');
    return (data ?? []).map((row) => toActivity(row as ActivityRow));
  }

  async list(userId: string, query: ListActivitiesQuery): Promise<Activity[]> {
    let request = this.db()
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(query.limit);
    if (query.source) request = request.eq('source', query.source);
    if (query.cursor) {
      // Keyset pagination: strictly after (started_at, id) in descending order. Values come from a decoded cursor
      // (an ISO date and a UUID-shaped id), quoted for PostgREST's logic-tree syntax.
      const at = `"${query.cursor.startedAt}"`;
      const id = `"${query.cursor.id.replace(/"/g, '')}"`;
      request = request.or(`started_at.lt.${at},and(started_at.eq.${at},id.lt.${id})`);
    }
    const { data, error } = await request;
    if (error) throw failure(error, 'ACTIVITY_LIST_FAILED');
    return (data ?? []).map((row) => toActivity(row as ActivityRow));
  }

  async findById(userId: string, id: string): Promise<Activity | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined; // not a UUID: Postgres would answer 22P02, the API says 404
    const { data, error } = await this.db().from(TABLE).select('*').eq('user_id', userId).eq('id', id).maybeSingle();
    if (error) throw failure(error, 'ACTIVITY_LIST_FAILED');
    return data ? toActivity(data as ActivityRow) : undefined;
  }
}

function toRow(userId: string, row: NewActivity) {
  return {
    user_id: userId,
    source: row.source,
    external_id: row.externalId,
    type: row.activityType,
    started_at: row.startedAt,
    ended_at: row.endedAt,
    duration_sec: row.durationSec,
    distance_m: row.distanceMeters,
    energy_kcal: row.energyKcal,
    source_name: row.sourceName,
    payload: row.metadata,
  };
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** Timestamps come back as `+00:00` strings: normalize to the API's ISO form so comparisons and cursors are stable. */
function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source as ActivitySource,
    externalId: row.external_id,
    activityType: row.type,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: new Date(row.ended_at).toISOString(),
    durationSec: Number(row.duration_sec),
    distanceMeters: num(row.distance_m),
    energyKcal: num(row.energy_kcal),
    sourceName: row.source_name,
    metadata: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Database messages stay in the server log (the error handler logs them); clients get a stable code. */
function failure(error: { message: string }, code: string): AppError {
  const wrapped = new AppError('Activity storage failed', 500, code);
  (wrapped as { cause?: unknown }).cause = error.message;
  return wrapped;
}
