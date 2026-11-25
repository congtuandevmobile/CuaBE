import { describe, expect, it } from 'vitest';
import { AuthService } from '../application/AuthService.js';
import { InMemoryAuthGateway } from './InMemoryAuthGateway.js';

function setup() {
  let now = 1_000;
  const service = new AuthService(new InMemoryAuthGateway(() => now));
  return { service, advance: (s: number) => { now += s; } };
}

const minh = { email: ' Minh@X.vn ', username: ' Minh.Run ', password: 'longenough', name: ' Minh ' };

describe('InMemoryAuthGateway through AuthService', () => {
  it('signs up with normalized email + username, a public code, and a token that identifies the user', async () => {
    const { service } = setup();
    const session = await service.signUp(minh);
    expect(session.user).toMatchObject({ email: 'minh@x.vn', username: 'minh.run', name: 'Minh' });
    expect(session.user.code).toMatch(/^[A-HJ-NP-Z]{3}\d{3}$/);
    expect(await service.currentUser(session.accessToken)).toEqual(session.user);
  });

  it('refuses a taken email or a taken username (case-insensitive)', async () => {
    const { service } = setup();
    await service.signUp(minh);
    await expect(service.signUp({ ...minh, username: 'other' })).rejects.toMatchObject({ statusCode: 409, code: 'AUTH_EMAIL_TAKEN' });
    await expect(service.signUp({ ...minh, email: 'other@x.vn', username: 'MINH.RUN' })).rejects.toMatchObject({ statusCode: 409, code: 'AUTH_USERNAME_TAKEN' });
  });

  it('rejects a malformed email or username before the provider is called', async () => {
    const { service } = setup();
    await expect(service.signUp({ ...minh, email: 'nope' })).rejects.toMatchObject({ statusCode: 400, code: 'AUTH_EMAIL_INVALID' });
    await expect(service.signUp({ ...minh, username: 'a b' })).rejects.toMatchObject({ statusCode: 400, code: 'AUTH_USERNAME_INVALID' });
  });

  it('signs in with the username or the email; one error for any wrong pair', async () => {
    const { service } = setup();
    await service.signUp(minh);
    expect((await service.signIn(' MINH.run ', 'longenough')).user.username).toBe('minh.run');
    expect((await service.signIn('minh@X.VN', 'longenough')).user.username).toBe('minh.run');
    await expect(service.signIn('minh.run', 'wrongpass')).rejects.toMatchObject({ code: 'AUTH_LOGIN_FAILED' });
    await expect(service.signIn('nobody', 'wrongpass')).rejects.toMatchObject({ code: 'AUTH_LOGIN_FAILED' });
  });

  it('expires access tokens and rotates refresh tokens', async () => {
    const { service, advance } = setup();
    const first = await service.signUp(minh);
    advance(15 * 60 + 1);
    await expect(service.currentUser(first.accessToken)).rejects.toMatchObject({ statusCode: 401 });
    const renewed = await service.refresh(first.refreshToken);
    expect((await service.currentUser(renewed.accessToken)).id).toBe(first.user.id);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'AUTH_REFRESH_FAILED' });
  });

  it('sign-out revokes the access token and the refresh tokens', async () => {
    const { service } = setup();
    const s = await service.signUp(minh);
    await service.signOut(s.accessToken);
    await expect(service.currentUser(s.accessToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.refresh(s.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('AuthService.userIdFor', () => {
  it('asks the gateway once per token for 30 s, and forgets a signed-out token at once', async () => {
    let now = 0;
    const gateway = new InMemoryAuthGateway();
    let calls = 0;
    const verify = gateway.verify.bind(gateway);
    gateway.verify = async (t: string) => {
      calls += 1;
      return verify(t);
    };
    const service = new AuthService(gateway, () => now);
    const session = await service.signUp({ email: 'c@x.vn', username: 'cache', password: 'longenough' });
    expect(await service.userIdFor(session.accessToken)).toBe(session.user.id);
    expect(await service.userIdFor(session.accessToken)).toBe(session.user.id);
    expect(calls).toBe(1);
    now += 31_000;
    await service.userIdFor(session.accessToken);
    expect(calls).toBe(2);
    await service.signOut(session.accessToken);
    await expect(service.userIdFor(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
