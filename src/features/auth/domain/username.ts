import { AppError } from '../../../shared/errors/AppError.js';

/** 3–30 characters: lowercase letters, digits, `_` and `.`. */
export const USERNAME = /^[a-z0-9_.]{3,30}$/;

/** Usernames are case-insensitive: `Minh` and `minh` are one account. */
export function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME.test(username)) {
    throw new AppError('Use 3–30 letters, digits, "_" or "."', 400, 'AUTH_USERNAME_INVALID');
  }
  return username;
}
