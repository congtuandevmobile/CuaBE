import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.js';
import { registerErrorHandling } from '../shared/http/errors.js';

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  registerErrorHandling(app);
  await registerRoutes(app);
  return app;
}
