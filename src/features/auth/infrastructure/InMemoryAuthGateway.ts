import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthGateway, AuthSession, AuthUser, LoginIdentifier, SignUpInput } from '../domain/AuthGateway.js';
import { AppError } from '../../../shared/errors/AppError.js';

interface StoredUser extends AuthUser {
  email: string;
  code: string;
  salt: Buffer;
  hash: Buffer;
}

const ACCESS_TTL_S = 15 * 60;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Development/test identity provider: users and tokens live in this process and vanish on restart. Passwords are
 * salted scrypt hashes; tokens are random and opaque. Refusing it in production is env.ts's job.
 */
export class InMemoryAuthGateway implements AuthGateway {
  private readonly users: StoredUser[] = [];
  private readonly access = new Map<string, { userId: string; expiresAt: number }>();
  private readonly refreshTokens = new Map<string, string>();

  constructor(private readonly nowS: () => number = () => Math.floor(Date.now() / 1000)) {}

  async signUp(input: SignUpInput): Promise<AuthSession> {
    if (this.users.some((u) => u.email === input.email)) throw new AppError('This email already has an account', 409, 'AUTH_EMAIL_TAKEN');
    if (this.users.some((u) => u.username === input.username)) throw new AppError('This username is taken', 409, 'AUTH_USERNAME_TAKEN');
    const salt = randomBytes(16);
    const user: StoredUser = {
      id: randomUUID(),
      email: input.email,
      username: input.username,
      name: input.name,
      code: this.newCode(),
      salt,
      hash: scryptSync(input.password, salt, 32),
    };
    this.users.push(user);
    return this.issue(user);
  }

  async signIn(identifier: LoginIdentifier, password: string): Promise<AuthSession> {
    const user = this.users.find((u) => (identifier.kind === 'email' ? u.email : u.username) === identifier.value);
    // Same error for an unknown account and a wrong password: never tell which accounts exist.
    if (!user || !timingSafeEqual(scryptSync(password, user.salt, 32), user.hash)) {
      throw new AppError('Wrong username or password', 401, 'AUTH_LOGIN_FAILED');
    }
    return this.issue(user);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const userId = this.refreshTokens.get(refreshToken);
    const user = userId ? this.byId(userId) : undefined;
    if (!user) throw new AppError('Invalid refresh token', 401, 'AUTH_REFRESH_FAILED');
    this.refreshTokens.delete(refreshToken); // rotation: a refresh token works once
    return this.issue(user);
  }

  async signOut(accessToken: string): Promise<void> {
    const entry = this.access.get(accessToken);
    if (!entry) return;
    this.access.delete(accessToken);
    for (const [token, userId] of this.refreshTokens) if (userId === entry.userId) this.refreshTokens.delete(token);
  }

  async verify(accessToken: string): Promise<string> {
    return (await this.getUser(accessToken)).id;
  }

  async getUser(accessToken: string): Promise<AuthUser> {
    const entry = this.access.get(accessToken);
    const user = entry && entry.expiresAt > this.nowS() ? this.byId(entry.userId) : undefined;
    if (!user) throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
    return publicUser(user);
  }

  private issue(user: StoredUser): AuthSession {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = this.nowS() + ACCESS_TTL_S;
    this.access.set(accessToken, { userId: user.id, expiresAt });
    this.refreshTokens.set(refreshToken, user.id);
    return { accessToken, refreshToken, expiresAt, user: publicUser(user) };
  }

  private byId(id: string): StoredUser | undefined {
    return this.users.find((u) => u.id === id);
  }

  /** Same format as the database: 3 letters (no I/O) + 3 digits, unique. */
  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 3 }, () => LETTERS[randomInt(LETTERS.length)]).join('') + String(randomInt(1000)).padStart(3, '0');
      if (!this.users.some((u) => u.code === code)) return code;
    }
  }
}

function publicUser(user: StoredUser): AuthUser {
  return { id: user.id, username: user.username, email: user.email, name: user.name, code: user.code };
}
