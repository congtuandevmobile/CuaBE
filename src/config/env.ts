import 'dotenv/config';
import { z } from 'zod';

/** `KEY=` in .env arrives as "": treat it as not set. */
const optionalText = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    /**
     * Which adapter answers the auth port. `memory` keeps users in this process (demo / tests, lost on restart);
     * `supabase` uses Supabase Auth. Default: `supabase` when SUPABASE_URL is set, otherwise `memory`.
     */
    AUTH_DRIVER: z.enum(['memory', 'supabase']).optional(),
    SUPABASE_URL: optionalUrl,
    SUPABASE_ANON_KEY: optionalText,
    SUPABASE_SERVICE_ROLE_KEY: optionalText,
  })
  .transform((raw) => ({ ...raw, AUTH_DRIVER: raw.AUTH_DRIVER ?? (raw.SUPABASE_URL ? 'supabase' : 'memory') }))
  .superRefine((env, ctx) => {
    if (env.AUTH_DRIVER === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: 'custom',
        message: 'AUTH_DRIVER=supabase needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (secret key: username login and confirmed sign-up)',
      });
    }
    if (env.AUTH_DRIVER === 'memory' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', message: 'AUTH_DRIVER=memory is for development only' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;
export const env: Env = EnvSchema.parse(process.env);
