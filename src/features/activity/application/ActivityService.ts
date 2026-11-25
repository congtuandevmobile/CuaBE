import { AppError } from '../../../shared/errors/AppError.js';
import {
  DUPLICATE_TOLERANCE_MS,
  MAX_IMPORT_ITEMS,
  isSameWorkout,
  type Activity,
  type ActivityRepository,
  type ActivitySource,
  type NewActivity,
} from '../domain/Activity.js';
import { decodeCursor, encodeCursor } from './cursor.js';

export type ActivityInput = Omit<NewActivity, 'source' | 'externalId'>;

/** A phone recording: `clientId` is generated on the device before the first try and reused on every retry. */
export interface PhoneActivityInput extends ActivityInput {
  clientId: string;
}

export interface ImportItemInput extends ActivityInput {
  /** HealthKit workout UUID. Missing only when the platform gave none. */
  externalId?: string | null | undefined;
}

export type SkipReason = 'external_id' | 'time_window' | 'in_batch';

export interface ImportItemResult {
  index: number;
  externalId: string | null;
  status: 'created' | 'skipped';
  /** The stored activity: the new one, or the one this item duplicates. */
  activityId: string;
  reason?: SkipReason;
}

export interface ImportResult {
  created: number;
  skipped: number;
  results: ImportItemResult[];
}

export interface ActivityPage {
  activities: Activity[];
  nextCursor: string | null;
}

/**
 * Activity use cases. Idempotency is decided by the unique (user, source, externalId) index; the time-window rule is
 * the fallback for imported workouts whose UUID is missing or changed.
 */
export class ActivityService {
  /** Imports of the same user run one after another in this process, so the time-window check cannot race itself. */
  private readonly userLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly activities: ActivityRepository,
    private readonly toleranceMs = DUPLICATE_TOLERANCE_MS,
  ) {}

  /** Saves a phone recording once. A retry with the same `clientId` returns the stored activity with `created: false`. */
  async createFromPhone(userId: string, input: PhoneActivityInput): Promise<{ activity: Activity; created: boolean }> {
    const { clientId, ...fields } = input;
    const row: NewActivity = { ...normalize(fields), source: 'phone', externalId: clientId };
    const [inserted] = await this.activities.insertIgnoringDuplicates(userId, [row]);
    if (inserted) return { activity: inserted, created: true };
    const [existing] = await this.activities.findByExternalIds(userId, 'phone', [clientId]);
    if (!existing) throw new AppError('Activity could not be saved', 500, 'ACTIVITY_CREATE_FAILED');
    return { activity: existing, created: false };
  }

  importBatch(userId: string, source: ActivitySource, items: readonly ImportItemInput[]): Promise<ImportResult> {
    if (items.length > MAX_IMPORT_ITEMS) {
      throw new AppError(`At most ${MAX_IMPORT_ITEMS} items per import`, 400, 'ACTIVITY_IMPORT_TOO_LARGE');
    }
    return this.withUserLock(userId, () => this.importUnlocked(userId, source, items));
  }

  async list(userId: string, limit: number, cursor?: string, source?: ActivitySource): Promise<ActivityPage> {
    // One extra row tells whether another page exists without a count query.
    const rows = await this.activities.list(userId, { limit: limit + 1, cursor: cursor ? decodeCursor(cursor) : undefined, source });
    const activities = rows.slice(0, limit);
    const last = activities[activities.length - 1];
    return { activities, nextCursor: rows.length > limit && last ? encodeCursor({ startedAt: last.startedAt, id: last.id }) : null };
  }

  async get(userId: string, id: string): Promise<Activity> {
    const activity = await this.activities.findById(userId, id);
    if (!activity) throw new AppError('Activity not found', 404, 'ACTIVITY_NOT_FOUND');
    return activity;
  }

  private async importUnlocked(userId: string, source: ActivitySource, items: readonly ImportItemInput[]): Promise<ImportResult> {
    const rows: NewActivity[] = items.map((item) => ({ ...normalize(item), source, externalId: item.externalId ?? null }));
    const results: (ImportItemResult | undefined)[] = new Array(rows.length);
    if (rows.length === 0) return { created: 0, skipped: 0, results: [] };

    // 1. Same UUID already stored: the primary rule.
    const ids = [...new Set(rows.flatMap((r) => (r.externalId ? [r.externalId] : [])))];
    const byId = new Map((await this.activities.findByExternalIds(userId, source, ids)).map((a) => [a.externalId, a]));
    rows.forEach((row, index) => {
      const hit = row.externalId ? byId.get(row.externalId) : undefined;
      if (hit) results[index] = skipped(index, row, hit.id, 'external_id');
    });

    // 2. Same workout stored under another (or no) UUID: same type, start and end within the tolerance.
    const open = rows.map((row, index) => ({ row, index })).filter(({ index }) => !results[index]);
    if (open.length > 0) {
      const starts = open.map(({ row }) => Date.parse(row.startedAt));
      const from = new Date(Math.min(...starts) - this.toleranceMs).toISOString();
      const to = new Date(Math.max(...starts) + this.toleranceMs).toISOString();
      const nearby = await this.activities.findStartedBetween(userId, source, from, to);
      for (const { row, index } of open) {
        const hit = nearby.find((a) => isSameWorkout(row, a, this.toleranceMs));
        if (hit) results[index] = skipped(index, row, hit.id, 'time_window');
      }
    }

    // 3. Duplicates inside this batch: the first occurrence wins.
    const accepted: { row: NewActivity; index: number }[] = [];
    const sameAs = new Map<number, number>();
    for (const { row, index } of open) {
      if (results[index]) continue;
      const first = accepted.find((a) => (row.externalId !== null && a.row.externalId === row.externalId) || isSameWorkout(row, a.row, this.toleranceMs));
      if (first) sameAs.set(index, first.index);
      else accepted.push({ row, index });
    }

    // 4. Insert; the unique index drops whatever a concurrent request stored in the meantime.
    const inserted = await this.activities.insertIgnoringDuplicates(userId, accepted.map((a) => a.row));
    const insertedByKey = new Map(inserted.map((a) => [a.externalId ?? `@${a.startedAt}|${a.activityType}`, a]));
    const lost = accepted.filter(({ row }) => !insertedByKey.has(row.externalId ?? `@${row.startedAt}|${row.activityType}`));
    const raced = lost.length
      ? new Map((await this.activities.findByExternalIds(userId, source, lost.flatMap(({ row }) => (row.externalId ? [row.externalId] : [])))).map((a) => [a.externalId, a]))
      : new Map<string | null, Activity>();
    for (const { row, index } of accepted) {
      const created = insertedByKey.get(row.externalId ?? `@${row.startedAt}|${row.activityType}`);
      if (created) {
        results[index] = { index, externalId: row.externalId, status: 'created', activityId: created.id };
        continue;
      }
      const existing = row.externalId ? raced.get(row.externalId) : undefined;
      if (!existing) throw new AppError('Activity import failed', 500, 'ACTIVITY_IMPORT_FAILED');
      results[index] = skipped(index, row, existing.id, 'external_id');
    }
    for (const [index, firstIndex] of sameAs) {
      const first = results[firstIndex];
      const row = rows[index];
      if (first && row) results[index] = skipped(index, row, first.activityId, 'in_batch');
    }

    const done = results.filter((r): r is ImportItemResult => r !== undefined);
    const created = done.filter((r) => r.status === 'created').length;
    return { created, skipped: done.length - created, results: done };
  }

  private async withUserLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.userLocks.get(userId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    this.userLocks.set(userId, run);
    try {
      return await run;
    } finally {
      if (this.userLocks.get(userId) === run) this.userLocks.delete(userId);
    }
  }
}

function skipped(index: number, row: NewActivity, activityId: string, reason: SkipReason): ImportItemResult {
  return { index, externalId: row.externalId, status: 'skipped', activityId, reason };
}

/** Timestamps are stored as UTC ISO strings, so equality and ordering never depend on the client's offset. */
function normalize(input: ActivityInput): ActivityInput {
  const startedAt = new Date(input.startedAt).toISOString();
  const endedAt = new Date(input.endedAt).toISOString();
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new AppError('endedAt must not be before startedAt', 400, 'VALIDATION_ERROR');
  }
  return { ...input, startedAt, endedAt };
}
