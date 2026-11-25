import { AppError } from '../../../shared/errors/AppError.js';
import type { ActivityCursor } from '../domain/Activity.js';

/** Opaque to clients: base64url of `startedAt|id`. Clients pass back exactly what `nextCursor` gave them. */
export function encodeCursor(cursor: ActivityCursor): string {
  return Buffer.from(`${cursor.startedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): ActivityCursor {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const bar = text.lastIndexOf('|');
  const startedAt = text.slice(0, bar);
  const id = text.slice(bar + 1);
  if (bar <= 0 || !id || Number.isNaN(Date.parse(startedAt))) {
    throw new AppError('Invalid cursor', 400, 'ACTIVITY_CURSOR_INVALID');
  }
  return { startedAt: new Date(startedAt).toISOString(), id };
}
