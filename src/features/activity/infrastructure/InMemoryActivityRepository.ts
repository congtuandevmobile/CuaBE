import { randomUUID } from 'node:crypto';
import {
  compareNewestFirst,
  isAfterCursor,
  type Activity,
  type ActivityRepository,
  type ActivitySource,
  type ListActivitiesQuery,
  type NewActivity,
} from '../domain/Activity.js';

/**
 * Development/test store (AUTH_DRIVER=memory): rows live in this process. It enforces the same unique
 * (user, source, externalId) rule as the database index, so services behave the same on both.
 */
export class InMemoryActivityRepository implements ActivityRepository {
  private readonly rows: Activity[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async insertIgnoringDuplicates(userId: string, rows: readonly NewActivity[]): Promise<Activity[]> {
    const inserted: Activity[] = [];
    for (const row of rows) {
      if (row.externalId !== null && this.rows.some((a) => a.userId === userId && a.source === row.source && a.externalId === row.externalId)) continue;
      const activity: Activity = { ...row, id: randomUUID(), userId, createdAt: this.now().toISOString() };
      this.rows.push(activity);
      inserted.push(activity);
    }
    return inserted;
  }

  async findByExternalIds(userId: string, source: ActivitySource, externalIds: readonly string[]): Promise<Activity[]> {
    const wanted = new Set(externalIds);
    return this.rows.filter((a) => a.userId === userId && a.source === source && a.externalId !== null && wanted.has(a.externalId));
  }

  async findStartedBetween(userId: string, source: ActivitySource, fromIso: string, toIso: string): Promise<Activity[]> {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return this.rows.filter((a) => a.userId === userId && a.source === source && Date.parse(a.startedAt) >= from && Date.parse(a.startedAt) <= to);
  }

  async list(userId: string, query: ListActivitiesQuery): Promise<Activity[]> {
    return this.rows
      .filter((a) => a.userId === userId && (!query.source || a.source === query.source) && (!query.cursor || isAfterCursor(a, query.cursor)))
      .sort(compareNewestFirst)
      .slice(0, query.limit);
  }

  async findById(userId: string, id: string): Promise<Activity | undefined> {
    return this.rows.find((a) => a.userId === userId && a.id === id);
  }
}
