import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let auth: { authorization: string };
let other: { authorization: string };

async function signUp(username: string): Promise<{ authorization: string }> {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: `${username}@x.vn`, username, password: 'longenough' } });
  return { authorization: `Bearer ${res.json().session.accessToken}` };
}

const recording = {
  clientId: 'act-7f3c9a10',
  activityType: 'running',
  startedAt: '2026-11-20T06:00:00+07:00',
  endedAt: '2026-11-20T06:35:00+07:00',
  durationSec: 1980,
  distanceMeters: 5230.5,
};

const hk = (externalId: string | null, startedAt: string) => ({
  externalId,
  activityType: 'cycling',
  startedAt,
  endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
  durationSec: 3600,
  distanceMeters: 20000,
  energyKcal: 500,
  sourceName: 'Apple Watch',
});

beforeAll(async () => {
  process.env.AUTH_DRIVER = 'memory';
  process.env.NODE_ENV = 'test';
  const { buildServer } = await import('./server.js');
  app = await buildServer();
  auth = await signUp('runner');
  other = await signUp('someone');
});

describe('activity routes (in-memory driver)', () => {
  it('needs a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/activities' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('POST is idempotent on clientId: 201, then 200 with the same activity', async () => {
    const first = await app.inject({ method: 'POST', url: '/v1/activities', headers: auth, payload: recording });
    expect(first.statusCode).toBe(201);
    expect(first.json().activity).toMatchObject({ source: 'phone', externalId: 'act-7f3c9a10', startedAt: '2026-11-19T23:00:00.000Z', distanceMeters: 5230.5, energyKcal: null });

    const retry = await app.inject({ method: 'POST', url: '/v1/activities', headers: auth, payload: recording });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ activity: first.json().activity, created: false });

    const byId = await app.inject({ method: 'GET', url: `/v1/activities/${first.json().activity.id}`, headers: auth });
    expect(byId.json().activity.id).toBe(first.json().activity.id);
    const foreign = await app.inject({ method: 'GET', url: `/v1/activities/${first.json().activity.id}`, headers: other });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('ACTIVITY_NOT_FOUND');
  });

  it('validates the body', async () => {
    const cases = [
      { ...recording, clientId: 'short' },
      { ...recording, endedAt: '2026-11-20T05:00:00+07:00' },
      { ...recording, startedAt: '2026-11-20 06:00' },
      { ...recording, metadata: { route: [[10.7, 106.6]] } },
      { ...recording, activityType: 'run ning' },
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/v1/activities', headers: auth, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('import: a full re-sync after reinstall reports everything as skipped', async () => {
    const items = [hk('HK-A', '2026-11-10T00:00:00Z'), hk('HK-B', '2026-11-11T00:00:00Z'), hk(null, '2026-11-12T00:00:00Z')];
    const first = await app.inject({ method: 'POST', url: '/v1/activities/import', headers: auth, payload: { source: 'apple_health', items } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: 3, skipped: 0 });

    const again = await app.inject({ method: 'POST', url: '/v1/activities/import', headers: auth, payload: { source: 'apple_health', items } });
    expect(again.json()).toMatchObject({ created: 0, skipped: 3 });
    expect(again.json().results.map((r: { activityId: string }) => r.activityId)).toEqual(first.json().results.map((r: { activityId: string }) => r.activityId));
  });

  it('import refuses an unknown source and more than 200 items', async () => {
    const phoneSource = await app.inject({ method: 'POST', url: '/v1/activities/import', headers: auth, payload: { source: 'phone', items: [] } });
    expect(phoneSource.statusCode).toBe(400);
    const items = Array.from({ length: 201 }, (_, i) => hk(`X-${i}`, new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString()));
    const tooMany = await app.inject({ method: 'POST', url: '/v1/activities/import', headers: auth, payload: { source: 'apple_health', items } });
    expect(tooMany.statusCode).toBe(400);
  });

  it('GET pages newest first, filters by source and keeps users apart', async () => {
    const page1 = await app.inject({ method: 'GET', url: '/v1/activities?limit=2', headers: auth });
    const body1 = page1.json();
    expect(body1.activities.map((a: { startedAt: string }) => a.startedAt)).toEqual(['2026-11-19T23:00:00.000Z', '2026-11-12T00:00:00.000Z']);
    expect(body1.nextCursor).toEqual(expect.any(String));

    const page2 = await app.inject({ method: 'GET', url: `/v1/activities?limit=2&cursor=${body1.nextCursor}`, headers: auth });
    expect(page2.json().activities.map((a: { externalId: string }) => a.externalId)).toEqual(['HK-B', 'HK-A']);
    expect(page2.json().nextCursor).toBeNull();

    const health = await app.inject({ method: 'GET', url: '/v1/activities?source=apple_health', headers: auth });
    expect(health.json().activities).toHaveLength(3);
    const theirs = await app.inject({ method: 'GET', url: '/v1/activities', headers: other });
    expect(theirs.json()).toEqual({ activities: [], nextCursor: null });

    const bad = await app.inject({ method: 'GET', url: '/v1/activities?cursor=garbage', headers: auth });
    expect(bad.json().error.code).toBe('ACTIVITY_CURSOR_INVALID');
  });
});
