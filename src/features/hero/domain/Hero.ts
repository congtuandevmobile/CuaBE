/**
 * The user's hero (the 3D character): body, skin tone and what it wears. One per user. The accessory catalog and its
 * unlock rules live in the app; the server checks the shape and the rules that do not depend on the catalog.
 */
export const HERO_GENDERS = ['male', 'female'] as const;
export type HeroGender = (typeof HERO_GENDERS)[number];

export const HERO_SLOTS = ['top', 'bottom', 'shoes', 'sandals', 'watch', 'hat', 'hair'] as const;
export type HeroSlot = (typeof HERO_SLOTS)[number];

/** Slots that can never be empty. */
export const REQUIRED_HERO_SLOTS: readonly HeroSlot[] = ['top', 'bottom'];
export const NO_ACCESSORY = 'none';
export const SKIN_TONE_COUNT = 6;

export type HeroEquipment = Record<HeroSlot, string>;

export interface HeroInput {
  name: string;
  gender: HeroGender;
  skinTone: number;
  equipment: HeroEquipment;
}

export interface Hero extends HeroInput {
  updatedAt: string;
}

export interface HeroRepository {
  find(userId: string): Promise<Hero | undefined>;
  /** Creates or replaces the user's hero (one row per user). */
  save(userId: string, hero: HeroInput): Promise<Hero>;
}

/** The rules that hold whatever the catalog: required slots are worn, shoes and sandals are never worn together. */
export function heroRuleViolation(hero: HeroInput): string | undefined {
  const empty = REQUIRED_HERO_SLOTS.find((slot) => hero.equipment[slot] === NO_ACCESSORY);
  if (empty) return `${empty} cannot be empty`;
  if (hero.equipment.shoes !== NO_ACCESSORY && hero.equipment.sandals !== NO_ACCESSORY) {
    return 'shoes and sandals cannot be worn together';
  }
  return undefined;
}
