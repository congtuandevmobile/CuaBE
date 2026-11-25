import { env } from '../../config/env.js';
import { ActivityService } from '../../features/activity/application/ActivityService.js';
import { InMemoryActivityRepository } from '../../features/activity/infrastructure/InMemoryActivityRepository.js';
import { SupabaseActivityRepository } from '../../features/activity/infrastructure/SupabaseActivityRepository.js';
import { AuthService } from '../../features/auth/application/AuthService.js';
import type { AuthGateway } from '../../features/auth/domain/AuthGateway.js';
import { InMemoryAuthGateway } from '../../features/auth/infrastructure/InMemoryAuthGateway.js';
import { SupabaseAuthGateway } from '../../features/auth/infrastructure/SupabaseAuthGateway.js';
import { HeroService } from '../../features/hero/application/HeroService.js';
import { InMemoryHeroRepository } from '../../features/hero/infrastructure/InMemoryHeroRepository.js';
import { SupabaseHeroRepository } from '../../features/hero/infrastructure/SupabaseHeroRepository.js';
import { ProfileService } from '../../features/profile/application/ProfileService.js';
import { SupabaseProfileRepository } from '../../features/profile/infrastructure/SupabaseProfileRepository.js';

/** The one place that picks adapters: services only know their ports. */
const authGateway: AuthGateway = env.AUTH_DRIVER === 'memory' ? new InMemoryAuthGateway() : new SupabaseAuthGateway();

const authService = new AuthService(authGateway);
const profileService = new ProfileService(new SupabaseProfileRepository());
// Memory users do not exist in Supabase, so their activities cannot live there either: one driver for both.
const activityService = new ActivityService(env.AUTH_DRIVER === 'memory' ? new InMemoryActivityRepository() : new SupabaseActivityRepository());

const heroService = new HeroService(env.AUTH_DRIVER === 'memory' ? new InMemoryHeroRepository() : new SupabaseHeroRepository());

export const container = { authService, profileService, activityService, heroService };
