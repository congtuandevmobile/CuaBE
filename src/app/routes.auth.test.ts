import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  // env.ts reads process.env when first imported: pick the in-memory driver before loading the server.
  process.env.AUTH_DRIVER = 'memory';
  process.env.NODE_ENV = 'test';
  const { buildServer } = await import('./server.js');
  app = await buildServer();
});

describe('auth routes (in-memory driver)', () => {
  it('signup → me → refresh → logout', async () => {
    const signup = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { name: 'Minh', email: 'minh@x.vn', username: 'minh', password: 'longenough', guestId: 'guest-1' } });
    expect(signup.statusCode).toBe(201);
    const { session } = signup.json();
    expect(session.user).toMatchObject({ username: 'minh', email: 'minh@x.vn', name: 'Minh' });
    expect(session.user.code).toMatch(/^[A-Z]{3}\d{3}$/);

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${session.accessToken}` } });
    expect(me.json().user.id).toBe(session.user.id);

    const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: session.refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json().session;

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${next.accessToken}` } });
    expect(logout.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${next.accessToken}` } });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  });

  it('answers errors as { error: { code, message } }', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'a@x.vn', username: 'minh2', password: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const invalid = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'b@x.vn', username: 'has space', password: 'longenough' } });
    expect(invalid.json().error.code).toBe('AUTH_USERNAME_INVALID');

    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'dup@x.vn', username: 'dup', password: 'longenough' } });
    const dup = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'dup2@x.vn', username: 'dup', password: 'longenough' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('AUTH_USERNAME_TAKEN');

    const emptyJson = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { 'content-type': 'application/json', authorization: 'Bearer x' } });
    expect(emptyJson.statusCode).toBe(400);
    expect(emptyJson.json().error.code).toBe('BAD_REQUEST');

    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'DUP@X.VN', password: 'longenough' } });
    expect(login.json().session.accessToken).toEqual(expect.any(String));
  });
});
