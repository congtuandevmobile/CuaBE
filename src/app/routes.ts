import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { container } from './composition/container.js';
import { bearerToken } from '../shared/http/auth.js';
import { AppError } from '../shared/errors/AppError.js';
import { ACTIVITY_SOURCES, MAX_IMPORT_ITEMS } from '../features/activity/domain/Activity.js';
import { HERO_GENDERS, HERO_SLOTS, SKIN_TONE_COUNT } from '../features/hero/domain/Hero.js';

/** `username` accepts a username or an email. */
const credentials = z.object({ username: z.string().trim().min(1).max(254), password: z.string().min(1).max(72) });
const signUpSchema = z.object({
  email: z.string().trim().max(254),
  username: z.string().trim().min(1).max(30),
  password: z.string().min(8).max(72),
  name: z.string().trim().min(1).max(80).optional(),
  /** Local guest id of the device, so its activities can be migrated to the new account later. */
  guestId: z.string().min(1).max(120).optional(),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const profileSchema = z.object({
  username: z.string().min(2).max(40).nullable().optional(),
  displayName: z.string().min(1).max(80).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
});
const profileReplaceSchema = z.object({
  username: z.string().min(2).max(40).nullable(),
  displayName: z.string().min(1).max(80).nullable(),
  avatarUrl: z.string().url().nullable(),
  bio: z.string().max(280).nullable(),
});
/** ISO 8601 with a zone (`Z` or `+07:00`): a time without a zone would be ambiguous. */
const isoDate = z.string().datetime({ offset: true });
const activityFields = {
  activityType: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, 'activityType must be a lower camel case sport code'),
  startedAt: isoDate,
  endedAt: isoDate,
  durationSec: z.number().min(0).max(7 * 24 * 3600),
  distanceMeters: z.number().min(0).max(1_000_000).nullable().default(null),
  energyKcal: z.number().min(0).max(100_000).nullable().default(null),
  sourceName: z.string().trim().max(120).nullable().default(null),
  /** Flat and small on purpose: no route, coordinates or samples can travel in it. */
  metadata: z
    .record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .refine((m) => Object.keys(m).length <= 20, 'metadata has at most 20 keys')
    .default({}),
};
const endNotBeforeStart = (a: { startedAt: string; endedAt: string }) => Date.parse(a.endedAt) >= Date.parse(a.startedAt);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, 'clientId must be 8-128 characters of A-Z a-z 0-9 . _ : -');
const phoneActivitySchema = z.object({ ...activityFields, clientId: idempotencyKey }).refine(endNotBeforeStart, 'endedAt must not be before startedAt');
const importSchema = z.object({
  source: z.enum(['apple_health']),
  items: z
    .array(z.object({ ...activityFields, externalId: z.string().trim().min(1).max(128).nullable().default(null) }).refine(endNotBeforeStart, 'endedAt must not be before startedAt'))
    .max(MAX_IMPORT_ITEMS, `At most ${MAX_IMPORT_ITEMS} items per import`),
});
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).optional(),
  source: z.enum(ACTIVITY_SOURCES).optional(),
});

const accessoryId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, 'accessory ids are lowercase a-z 0-9 _ -');
const heroSchema = z.object({
  name: z.string().trim().min(1).max(40),
  gender: z.enum(HERO_GENDERS),
  skinTone: z.number().int().min(0).max(SKIN_TONE_COUNT - 1),
  equipment: z.object(Object.fromEntries(HERO_SLOTS.map((slot) => [slot, accessoryId])) as Record<(typeof HERO_SLOTS)[number], typeof accessoryId>).strict(),
});

async function userId(request: FastifyRequest): Promise<string> {
  return (await container.authService.currentUser(bearerToken(request))).id;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/v1/auth/signup', async (request, reply) => {
    const input = signUpSchema.parse(request.body);
    const session = await container.authService.signUp({ email: input.email, username: input.username, password: input.password, name: input.name });
    return reply.status(201).send({ session });
  });

  app.post('/v1/auth/login', async (request) => {
    const input = credentials.parse(request.body);
    return { session: await container.authService.signIn(input.username, input.password) };
  });

  app.post('/v1/auth/refresh', async (request) => {
    const input = refreshSchema.parse(request.body);
    return { session: await container.authService.refresh(input.refreshToken) };
  });

  app.get('/v1/auth/me', async (request) => ({ user: await container.authService.currentUser(bearerToken(request)) }));

  app.post('/v1/auth/logout', async (request, reply) => {
    await container.authService.signOut(bearerToken(request));
    return reply.status(204).send();
  });

  app.get('/v1/profile', async (request) => ({ profile: await container.profileService.get(await userId(request)) }));
  app.put('/v1/profile', async (request) => ({ profile: await container.profileService.replace(await userId(request), profileReplaceSchema.parse(request.body)) }));
  app.patch('/v1/profile', async (request) => ({ profile: await container.profileService.patch(await userId(request), profileSchema.parse(request.body)) }));

  /** A phone recording. Idempotent on `clientId`: 201 when stored now, 200 with the stored activity on a retry. */
  app.post('/v1/activities', async (request, reply) => {
    const input = phoneActivitySchema.parse(request.body);
    const { activity, created } = await container.activityService.createFromPhone(await userId(request), input);
    return reply.status(created ? 201 : 200).send({ activity, created });
  });

  /** A batch of imported workouts (Apple Health). Re-sending the same workouts creates nothing. */
  app.post('/v1/activities/import', async (request) => {
    const input = importSchema.parse(request.body);
    return container.activityService.importBatch(await userId(request), input.source, input.items);
  });

  app.get('/v1/activities', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return container.activityService.list(await userId(request), query.limit, query.cursor, query.source);
  });

  app.get<{ Params: { id: string } }>('/v1/activities/:id', async (request) => ({
    activity: await container.activityService.get(await userId(request), request.params.id),
  }));

  /** The signed-in user's hero. 404 HERO_NOT_FOUND until one is saved. */
  app.get('/v1/hero', async (request) => ({ hero: await container.heroService.get(await userId(request)) }));
  /** Creates or replaces the whole hero (body, skin tone, equipment). */
  app.put('/v1/hero', async (request) => ({ hero: await container.heroService.save(await userId(request), heroSchema.parse(request.body)) }));

  app.setNotFoundHandler(() => {
    throw new AppError('Route not found', 404, 'NOT_FOUND');
  });
}
