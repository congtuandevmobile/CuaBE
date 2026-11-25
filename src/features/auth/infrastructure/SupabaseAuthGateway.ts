import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthGateway, AuthSession, AuthUser, LoginIdentifier, SignUpInput } from '../domain/AuthGateway.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { env } from '../../../config/env.js';
import { getSupabase } from '../../../platform/supabase/client.js';

let adminClient: SupabaseClient | undefined;

/**
 * Service-role client (secret key, server only). Needed to look a username up (another user's row, which RLS hides
 * from the publishable key) and to create users already confirmed (no mail, whatever "Confirm email" says).
 * env.ts refuses AUTH_DRIVER=supabase without the key, so this never runs unconfigured.
 */
function admin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError('SUPABASE_SERVICE_ROLE_KEY is not configured', 503, 'AUTH_SIGNUP_UNAVAILABLE');
  }
  adminClient ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  return adminClient;
}

type SupabaseUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type ProfileRow = { username: string | null; display_name: string | null; code: string | null };
type SupabaseError = { code?: string | undefined; message: string };

const loginFailed = () => new AppError('Wrong username or password', 401, 'AUTH_LOGIN_FAILED');

export class SupabaseAuthGateway implements AuthGateway {
  async signUp(input: SignUpInput): Promise<AuthSession> {
    if (await this.idForUsername(input.username)) throw new AppError('This username is taken', 409, 'AUTH_USERNAME_TAKEN');
    const { error } = await admin().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { username: input.username, ...(input.name ? { display_name: input.name } : {}) },
    });
    if (error) throw signUpError(error);
    return this.signInWithEmail(input.email, input.password);
  }

  async signIn(identifier: LoginIdentifier, password: string): Promise<AuthSession> {
    const email = identifier.kind === 'email' ? identifier.value : await this.emailForUsername(identifier.value);
    if (!email) throw loginFailed();
    return this.signInWithEmail(email, password);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const { data, error } = await getSupabase().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw new AppError('Invalid refresh token', 401, 'AUTH_REFRESH_FAILED');
    return this.toSession(data.session);
  }

  async signOut(accessToken: string): Promise<void> {
    const { error } = await admin().auth.admin.signOut(accessToken);
    // A token whose user was deleted, or that already expired, is as signed out as it gets: nothing to revoke.
    if (error && !/does not exist|not found|expired|invalid/i.test(error.message)) {
      throw new AppError(error.message, 400, 'AUTH_LOGOUT_FAILED');
    }
  }

  async getUser(accessToken: string): Promise<AuthUser> {
    const { data, error } = await getSupabase().auth.getUser(accessToken);
    if (error || !data.user) throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
    return this.toUser(data.user);
  }

  private async signInWithEmail(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error || !data.session) throw loginFailed();
    return this.toSession(data.session);
  }

  private async idForUsername(username: string): Promise<string | undefined> {
    const { data, error } = await admin().from('profiles').select('id').eq('username', username).maybeSingle<{ id: string }>();
    if (error) throw new AppError(error.message, 500, 'AUTH_LOOKUP_FAILED');
    return data?.id;
  }

  private async emailForUsername(username: string): Promise<string | undefined> {
    const id = await this.idForUsername(username);
    if (!id) return undefined;
    const { data } = await admin().auth.admin.getUserById(id);
    return data.user?.email;
  }

  private async toSession(session: { access_token: string; refresh_token: string; expires_at?: number; user: SupabaseUser }): Promise<AuthSession> {
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      user: await this.toUser(session.user),
    };
  }

  /** Auth user + its profile row (username, display name, public code). */
  private async toUser(user: SupabaseUser): Promise<AuthUser> {
    const { data: profile } = await admin().from('profiles').select('username, display_name, code').eq('id', user.id).maybeSingle<ProfileRow>();
    const meta = user.user_metadata ?? {};
    return {
      id: user.id,
      username: profile?.username ?? (typeof meta.username === 'string' ? meta.username : ''),
      email: user.email,
      name: profile?.display_name ?? (typeof meta.display_name === 'string' ? meta.display_name : undefined),
      code: profile?.code ?? undefined,
    };
  }
}

function signUpError(error: SupabaseError): AppError {
  if (error.code === 'email_exists' || error.code === 'user_already_exists' || /already (been )?registered/i.test(error.message)) {
    return new AppError('This email already has an account', 409, 'AUTH_EMAIL_TAKEN');
  }
  if (error.code === 'email_address_invalid' || /email address .* is invalid/i.test(error.message)) {
    return new AppError('Enter a full email address', 400, 'AUTH_EMAIL_INVALID');
  }
  // The profile insert in the trigger failed: almost always the unique username index (a sign-up race).
  if (/database error saving new user/i.test(error.message)) {
    return new AppError('This username is taken', 409, 'AUTH_USERNAME_TAKEN');
  }
  if (error.code === 'weak_password') return new AppError(error.message, 400, 'AUTH_PASSWORD_TOO_SHORT');
  return new AppError(error.message, 400, 'AUTH_SIGNUP_FAILED');
}
