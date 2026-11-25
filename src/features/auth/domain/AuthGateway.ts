export interface AuthUser {
  id: string;
  username: string;
  email?: string | undefined;
  name?: string | undefined;
  /** Public short code shown to people (e.g. ABC314). The UUID `id` stays internal. */
  code?: string | undefined;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds when `accessToken` stops being accepted. */
  expiresAt?: number | undefined;
  user: AuthUser;
}

export interface SignUpInput {
  /** All normalized by AuthService: lowercase email and username. */
  email: string;
  username: string;
  password: string;
  name?: string | undefined;
}

/** How someone signs in: their username or their email (both case-insensitive). */
export type LoginIdentifier = { kind: 'username'; value: string } | { kind: 'email'; value: string };

/** The identity provider. Implemented by Supabase Auth in production and by an in-memory store for demos/tests. */
export interface AuthGateway {
  /** Creates the account and signs it in. AUTH_EMAIL_TAKEN / AUTH_USERNAME_TAKEN when either already exists. */
  signUp(input: SignUpInput): Promise<AuthSession>;
  signIn(identifier: LoginIdentifier, password: string): Promise<AuthSession>;
  /** Exchanges a refresh token for a new session (the old refresh token stops working). */
  refresh(refreshToken: string): Promise<AuthSession>;
  signOut(accessToken: string): Promise<void>;
  getUser(accessToken: string): Promise<AuthUser>;
  /** Only checks the token and answers the user id: what every protected route needs (no profile lookup). */
  verify(accessToken: string): Promise<string>;
}
