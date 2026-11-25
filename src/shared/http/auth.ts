import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError.js';

export function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('Missing Bearer token', 401, 'UNAUTHORIZED');
  }
  return header.slice('Bearer '.length).trim();
}
