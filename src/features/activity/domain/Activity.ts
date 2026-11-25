/**
 * Where an activity came from. `phone`: recorded by the Cua app itself. `apple_health`: a workout imported from
 * HealthKit. A source is the namespace of `externalId`.
 */
export const ACTIVITY_SOURCES = ['phone', 'apple_health'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/** Two Apple Health workouts of the same type whose start AND end are this close are the same workout. */
export const DUPLICATE_TOLERANCE_MS = 60_000;

/** At most this many items in one import call. */
export const MAX_IMPORT_ITEMS = 200;

export type ActivityMetadata = Record<string, string | number | boolean | null>;

export interface Activity {
  id: string;
  userId: string;
  source: ActivitySource;
  /**
   * The idempotency key inside its source: the client-generated id for `phone`, the HealthKit workout UUID for
   * `apple_health`. Unique per (user, source). Null only for an imported workout that has no UUID.
   */
  externalId: string | null;
  /** Lower camel case HealthKit name (`running`, `cycling`, `traditionalStrengthTraining`...). */
  activityType: string;
  startedAt: string;
  endedAt: string;
  /** Moving time, pauses excluded. */
  durationSec: number;
  distanceMeters: number | null;
  energyKcal: number | null;
  /** Device or app that recorded it (e.g. "Apple Watch"). Never a location. */
  sourceName: string | null;
  /** Small flat key/value extras. Never a route, a coordinate or a heart-rate series. */
  metadata: ActivityMetadata;
  createdAt: string;
}

export interface NewActivity {
  source: ActivitySource;
  externalId: string | null;
  activityType: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  distanceMeters: number | null;
  energyKcal: number | null;
  sourceName: string | null;
  metadata: ActivityMetadata;
}

/** Position in the newest-first list: started_at desc, then id desc (ties broken by id). */
export interface ActivityCursor {
  startedAt: string;
  id: string;
}

export interface ListActivitiesQuery {
  limit: number;
  cursor?: ActivityCursor | undefined;
  source?: ActivitySource | undefined;
}

export interface ActivityRepository {
  /**
   * Inserts the rows whose (user, source, externalId) does not exist yet and returns only those. A row that already
   * exists (or arrives concurrently) is silently left out: the unique index decides, never a prior read.
   */
  insertIgnoringDuplicates(userId: string, rows: readonly NewActivity[]): Promise<Activity[]>;
  findByExternalIds(userId: string, source: ActivitySource, externalIds: readonly string[]): Promise<Activity[]>;
  /** Activities of one source whose start lies in [fromIso, toIso]. */
  findStartedBetween(userId: string, source: ActivitySource, fromIso: string, toIso: string): Promise<Activity[]>;
  list(userId: string, query: ListActivitiesQuery): Promise<Activity[]>;
  findById(userId: string, id: string): Promise<Activity | undefined>;
}

/** The fallback rule for an imported workout whose UUID is missing or changed. */
export function isSameWorkout(
  a: Pick<NewActivity, 'activityType' | 'startedAt' | 'endedAt'>,
  b: Pick<NewActivity, 'activityType' | 'startedAt' | 'endedAt'>,
  toleranceMs = DUPLICATE_TOLERANCE_MS,
): boolean {
  return (
    a.activityType === b.activityType &&
    Math.abs(Date.parse(a.startedAt) - Date.parse(b.startedAt)) <= toleranceMs &&
    Math.abs(Date.parse(a.endedAt) - Date.parse(b.endedAt)) <= toleranceMs
  );
}

/** Newest first: started_at desc, id desc. One rule shared by every repository. */
export function compareNewestFirst(a: Pick<Activity, 'startedAt' | 'id'>, b: Pick<Activity, 'startedAt' | 'id'>): number {
  const byStart = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (byStart !== 0) return byStart;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** True when `a` comes strictly after the cursor position in the newest-first order. */
export function isAfterCursor(a: Pick<Activity, 'startedAt' | 'id'>, cursor: ActivityCursor): boolean {
  return compareNewestFirst(cursor, a) < 0;
}
