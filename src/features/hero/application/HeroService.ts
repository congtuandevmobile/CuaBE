import { AppError } from '../../../shared/errors/AppError.js';
import { heroRuleViolation, type Hero, type HeroInput, type HeroRepository } from '../domain/Hero.js';

export class HeroService {
  constructor(private readonly heroes: HeroRepository) {}

  async get(userId: string): Promise<Hero> {
    const hero = await this.heroes.find(userId);
    if (!hero) throw new AppError('This account has no hero yet', 404, 'HERO_NOT_FOUND');
    return hero;
  }

  /** Last write wins: the app sends the whole hero after every change. */
  save(userId: string, input: HeroInput): Promise<Hero> {
    const violation = heroRuleViolation(input);
    if (violation) throw new AppError(violation, 400, 'HERO_INVALID');
    return this.heroes.save(userId, { ...input, name: input.name.trim() });
  }
}
