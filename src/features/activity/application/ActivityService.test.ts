import { describe, expect, it } from 'vitest';
import { ActivityService, type ImportItemInput } from './ActivityService.js';
import { InMemoryActivityRepository } from '../infrastructure/InMemoryActivityRepository.js';
import type { Activity, ActivityRepository, NewActivity } from '../domain/Activity.js';

const workout = (externalId: string | null, startedAt: string, minutes = 30, activityType = 'running'): ImportItemInput => ({
  externalId,
  activityType,
  startedAt,
  endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
  durationSec: minutes * 60,
  distanceMeters: 5000,
  energyKcal: 300,
  sourceName: 'Apple Watch',
  metadata: {},
});

const phone = (clientId: string) => ({
  clientId,
  activityType: 'running',
  startedAt: '2026-11-20T06:00:00.000Z',
  endedAt: '2026-11-20T06:30:00.000Z',
  durationSec: 1800,
  distanceMeters: 5000,
  energyKcal: null,
  sourceName: null,
  metadata: {},
});

describe('ActivityService — phone recordings', () => {
  it('a retry with the same clientId returns the stored activity instead of a second one', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    const first = await service.createFromPhone('u1', phone('client-0001'));
    const retry = await service.createFromPhone('u1', phone('client-0001'));
    expect(first.created).toBe(true);
    expect(retry).toEqual({ activity: first.activity, created: false });
    expect((await service.list('u1', 20)).activities).toHaveLength(1);
  });

  it('the same clientId of another user is another activity', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    await service.createFromPhone('u1', phone('client-0001'));
    expect((await service.createFromPhone('u2', phone('client-0001'))).created).toBe(true);
  });

  it('a phone recording never hides an Apple Health workout at the same time (dedup is per source)', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    await service.createFromPhone('u1', phone('client-0001'));
    const result = await service.importBatch('u1', 'apple_health', [workout('HK-1', '2026-11-20T06:00:00.000Z')]);
    expect(result.created).toBe(1);
  });
});

describe('ActivityService — Apple Health import', () => {
  it('re-importing everything after a reinstall creates nothing', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    const batch = [workout('HK-1', '2026-11-01T06:00:00Z'), workout('HK-2', '2026-11-02T06:00:00Z'), workout(null, '2026-11-03T06:00:00Z')];
    expect(await service.importBatch('u1', 'apple_health', batch)).toMatchObject({ created: 3, skipped: 0 });

    const again = await service.importBatch('u1', 'apple_health', batch);
    expect(again).toMatchObject({ created: 0, skipped: 3 });
    expect(again.results.map((r) => r.reason)).toEqual(['external_id', 'external_id', 'time_window']);
    expect((await service.list('u1', 50)).activities).toHaveLength(3);
  });

  it('a workout whose UUID changed is matched by type and time within the tolerance', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    const first = await service.importBatch('u1', 'apple_health', [workout('OLD-UUID', '2026-11-01T06:00:00Z')]);
    const shifted = { ...workout('NEW-UUID', '2026-11-01T06:00:30Z'), endedAt: '2026-11-01T06:30:20Z' };
    const result = await service.importBatch('u1', 'apple_health', [shifted]);
    expect(result.results[0]).toMatchObject({ status: 'skipped', reason: 'time_window', activityId: first.results[0]?.activityId });
  });

  it('the time-window rule needs the same type and both ends inside the tolerance', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    await service.importBatch('u1', 'apple_health', [workout('A', '2026-11-01T06:00:00Z')]);
    const result = await service.importBatch('u1', 'apple_health', [
      workout('B', '2026-11-01T06:00:00Z', 30, 'cycling'), // other sport
      workout('C', '2026-11-01T06:02:00Z'), // starts 2 min later
      workout('D', '2026-11-01T06:00:00Z', 45), // ends 15 min later
    ]);
    expect(result).toMatchObject({ created: 3, skipped: 0 });
  });

  it('duplicates inside one batch: the first wins, the others point at it', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    const result = await service.importBatch('u1', 'apple_health', [
      workout('HK-1', '2026-11-01T06:00:00Z'),
      workout('HK-1', '2026-11-01T06:00:00Z'),
      workout('HK-9', '2026-11-01T06:00:10Z'), // same workout written twice to HealthKit under another UUID
    ]);
    expect(result).toMatchObject({ created: 1, skipped: 2 });
    const firstId = result.results[0]?.activityId;
    expect(result.results.slice(1).map((r) => [r.reason, r.activityId])).toEqual([['in_batch', firstId], ['in_batch', firstId]]);
  });

  it('a row stored concurrently (unique index wins the race) is reported as skipped, not as an error', async () => {
    const inner = new InMemoryActivityRepository();
    let raced = false;
    // Another request stores HK-1 between this request's read and its insert.
    const racing: ActivityRepository = {
      findByExternalIds: (...a) => inner.findByExternalIds(...a),
      findStartedBetween: (...a) => inner.findStartedBetween(...a),
      list: (...a) => inner.list(...a),
      findById: (...a) => inner.findById(...a),
      async insertIgnoringDuplicates(userId: string, rows: readonly NewActivity[]): Promise<Activity[]> {
        if (!raced) {
          raced = true;
          await inner.insertIgnoringDuplicates(userId, rows.filter((r) => r.externalId === 'HK-1'));
        }
        return inner.insertIgnoringDuplicates(userId, rows);
      },
    };
    const service = new ActivityService(racing);
    const result = await service.importBatch('u1', 'apple_health', [workout('HK-1', '2026-11-01T06:00:00Z'), workout('HK-2', '2026-11-02T06:00:00Z')]);
    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(result.results[0]).toMatchObject({ status: 'skipped', reason: 'external_id' });
    expect((await service.list('u1', 50)).activities).toHaveLength(2);
  });

  it('two concurrent imports of the same UUID-less workouts store them once', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    const batch = [workout(null, '2026-11-01T06:00:00Z')];
    const [a, b] = await Promise.all([service.importBatch('u1', 'apple_health', batch), service.importBatch('u1', 'apple_health', batch)]);
    expect(a.created + b.created).toBe(1);
  });
});

describe('ActivityService — list', () => {
  it('pages newest first with a cursor and never repeats or skips a row', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    const items = Array.from({ length: 7 }, (_, i) => workout(`HK-${i}`, `2026-11-0${i + 1}T06:00:00Z`));
    // Two workouts at the same instant: the id breaks the tie.
    items.push(workout('HK-same', '2026-11-04T06:00:00Z', 30, 'walking'));
    await service.importBatch('u1', 'apple_health', items);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.list('u1', 3, cursor);
      seen.push(...page.activities.map((a) => a.startedAt));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(8);
    expect([...seen].sort().reverse()).toEqual(seen);
  });

  it('rejects a cursor it did not issue', async () => {
    const service = new ActivityService(new InMemoryActivityRepository());
    await expect(service.list('u1', 3, 'not-a-cursor')).rejects.toMatchObject({ code: 'ACTIVITY_CURSOR_INVALID' });
  });
});
