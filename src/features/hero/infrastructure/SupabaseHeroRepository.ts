import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../shared/errors/AppError.js';
import { getSupabaseAdmin } from '../../../platform/supabase/client.js';
import type { Hero, HeroEquipment, HeroGender, HeroInput, HeroRepository } from '../domain/Hero.js';

interface HeroRow {
  user_id: string;
  name: string;
  gender: string;
  skin_tone: number;
  equipment: HeroEquipment;
  updated_at: string;
}

/** `public.heroes`, one row per user. Service-role client: every query is scoped by the verified user id. */
export class SupabaseHeroRepository implements HeroRepository {
  constructor(private readonly db: () => SupabaseClient = getSupabaseAdmin) {}

  async find(userId: string): Promise<Hero | undefined> {
    const { data, error } = await this.db().from('heroes').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw failure(error, 'HERO_READ_FAILED');
    return data ? toHero(data as HeroRow) : undefined;
  }

  async save(userId: string, hero: HeroInput): Promise<Hero> {
    const { data, error } = await this.db()
      .from('heroes')
      .upsert(
        { user_id: userId, name: hero.name, gender: hero.gender, skin_tone: hero.skinTone, equipment: hero.equipment, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error || !data) throw failure(error ?? { message: 'no row' }, 'HERO_SAVE_FAILED');
    return toHero(data as HeroRow);
  }
}

function toHero(row: HeroRow): Hero {
  return {
    name: row.name,
    gender: row.gender as HeroGender,
    skinTone: row.skin_tone,
    equipment: row.equipment,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function failure(error: { message: string }, code: string): AppError {
  const wrapped = new AppError('Hero storage failed', 500, code);
  (wrapped as { cause?: unknown }).cause = error.message;
  return wrapped;
}
