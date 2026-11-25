import { env } from './config/env.js';
import { buildServer } from './app/server.js';

const app = await buildServer();
app.log.info({ authDriver: env.AUTH_DRIVER }, 'auth driver');
await app.listen({ host: '0.0.0.0', port: env.PORT });
