import { AppError } from '../../../shared/errors/AppError.js';
import type { AuthGateway, AuthSession, AuthUser, LoginIdentifier, SignUpInput } from '../domain/AuthGateway.js';
import { normalizeUsername } from '../domain/username.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Auth use cases. Normalizes input once, so every adapter sees the same email, username and name. */
/** How long a verified token is trusted without asking the identity provider again (one round trip saved per request). */
const VERIFIED_TTL_MS = 30_000;
const MAX_VERIFIED = 10_000;

export class AuthService {
  /** token -> user id, verified recently. Sign-out in this process evicts at once. */
  private readonly verified = new Map<string, { userId: string; until: number }>();

  constructor(
    private readonly auth: AuthGateway,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /**
   * The user id behind a bearer token, for protected routes. Cached for 30 s: a token revoked by another API instance
   * (or in Supabase directly) is still accepted here for at most that long.
   */
  async userIdFor(accessToken: string): Promise<string> {
    const now = this.nowMs();
    const hit = this.verified.get(accessToken);
    if (hit && hit.until > now) return hit.userId;
    const userId = await this.auth.verify(accessToken);
    if (this.verified.size >= MAX_VERIFIED) this.verified.clear();
    this.verified.set(accessToken, { userId, until: now + VERIFIED_TTL_MS });
    return userId;
  }

  async signUp(input: SignUpInput): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new AppError('Enter a full email address', 400, 'AUTH_EMAIL_INVALID');
    const name = input.name?.trim();
    return this.auth.signUp({ email, username: normalizeUsername(input.username), password: input.password, name: name ? name : undefined });
  }

  /** `identifier` is a username or an email: an `@` decides which. */
  async signIn(identifier: string, password: string): Promise<AuthSession> {
    const value = identifier.trim().toLowerCase();
    const login: LoginIdentifier = value.includes('@') ? { kind: 'email', value } : { kind: 'username', value };
    return this.auth.signIn(login, password);
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return this.auth.refresh(refreshToken);
  }

  signOut(accessToken: string): Promise<void> {
    this.verified.delete(accessToken);
    return this.auth.signOut(accessToken);
  }

  currentUser(accessToken: string): Promise<AuthUser> {
    return this.auth.getUser(accessToken);
  }
}
