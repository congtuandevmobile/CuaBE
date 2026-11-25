import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let auth: { authorization: string };
let other: { authorization: string };

async function signUp(username: string): Promise<{ authorization: string }> {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: `${username}@x.vn`, username, password: 'longenough' } });
  return { authorization: `Bearer ${res.json().session.accessToken}` };
}

const hero = {
  name: 'Cua',
  gender: 'male',
  skinTone: 1,
  equipment: { top: 'm-top-1', bottom: 'm-bottom-1', shoes: 'm-shoes-1', sandals: 'none', watch: 'none', hat: 'none', hair: 'm-hair-1' },
};

beforeAll(async () => {
  process.env.AUTH_DRIVER = 'memory';
  process.env.NODE_ENV = 'test';
  const { buildServer } = await import('./server.js');
  app = await buildServer();
  auth = await signUp('herouser');
  other = await signUp('otheruser');
});

describe('hero routes (in-memory driver)', () => {
  it('404 until saved, then PUT replaces and GET returns it (per user)', async () => {
    const none = await app.inject({ method: 'GET', url: '/v1/hero', headers: auth });
    expect(none.statusCode).toBe(404);
    expect(none.json().error.code).toBe('HERO_NOT_FOUND');

    const put = await app.inject({ method: 'PUT', url: '/v1/hero', headers: auth, payload: hero });
    expect(put.statusCode).toBe(200);
    expect(put.json().hero).toMatchObject(hero);

    const changed = { ...hero, gender: 'female', equipment: { ...hero.equipment, shoes: 'none', sandals: 'f-sandals-2', watch: 'garmin' } };
    await app.inject({ method: 'PUT', url: '/v1/hero', headers: auth, payload: changed });
    const got = await app.inject({ method: 'GET', url: '/v1/hero', headers: auth });
    expect(got.json().hero).toMatchObject(changed);
    expect(got.json().hero.updatedAt).toEqual(expect.any(String));

    expect((await app.inject({ method: 'GET', url: '/v1/hero', headers: other })).statusCode).toBe(404);
  });

  it('needs a token and validates the hero', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/hero' })).statusCode).toBe(401);
    const bad = [
      { ...hero, gender: 'other' },
      { ...hero, skinTone: 6 },
      { ...hero, name: '  ' },
      { ...hero, equipment: { ...hero.equipment, cape: 'x' } },
      { ...hero, equipment: { ...hero.equipment, hat: undefined } },
    ];
    for (const payload of bad) {
      const res = await app.inject({ method: 'PUT', url: '/v1/hero', headers: auth, payload });
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    const rules = [
      { ...hero, equipment: { ...hero.equipment, top: 'none' } },
      { ...hero, equipment: { ...hero.equipment, sandals: 'm-sandals-1' } },
    ];
    for (const payload of rules) {
      const res = await app.inject({ method: 'PUT', url: '/v1/hero', headers: auth, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('HERO_INVALID');
    }
  });
});
