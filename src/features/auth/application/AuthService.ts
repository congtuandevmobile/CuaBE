import { AppError } from '../../../shared/errors/AppError.js';
import type { AuthGateway, AuthSession, AuthUser, LoginIdentifier, SignUpInput } from '../domain/AuthGateway.js';
import { normalizeUsername } from '../domain/username.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Auth use cases. Normalizes input once, so every adapter sees the same email, username and name. */
export class AuthService {
  constructor(private readonly auth: AuthGateway) {}

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
    return this.auth.signOut(accessToken);
  }

  currentUser(accessToken: string): Promise<AuthUser> {
    return this.auth.getUser(accessToken);
  }
}
