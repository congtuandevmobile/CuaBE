import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';

let client: SupabaseClient | undefined;
let adminClient: SupabaseClient | undefined;

/** Created on first use, so the API also boots without Supabase (AUTH_DRIVER=memory). */
export function getSupabase(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new AppError('Supabase is not configured on this server', 503, 'SUPABASE_NOT_CONFIGURED');
  }
  client ??= createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

/**
 * Service-role client (secret key, server only): bypasses RLS. Only for repositories that scope EVERY query by the
 * user id the API verified from the bearer token.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError('Supabase is not configured on this server', 503, 'SUPABASE_NOT_CONFIGURED');
  }
  adminClient ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}
