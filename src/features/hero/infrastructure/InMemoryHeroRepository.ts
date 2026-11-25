import type { Hero, HeroInput, HeroRepository } from '../domain/Hero.js';

/** Development/test store (AUTH_DRIVER=memory). */
export class InMemoryHeroRepository implements HeroRepository {
  private readonly heroes = new Map<string, Hero>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async find(userId: string): Promise<Hero | undefined> {
    return this.heroes.get(userId);
  }

  async save(userId: string, hero: HeroInput): Promise<Hero> {
    const saved: Hero = { ...hero, equipment: { ...hero.equipment }, updatedAt: this.now().toISOString() };
    this.heroes.set(userId, saved);
    return saved;
  }
}
