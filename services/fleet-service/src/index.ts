import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pool } from '@truckmafia/shared';
import { authRoutes } from './routes/auth.js';
import { truckRoutes } from './routes/trucks.js';
import { trailerRoutes } from './routes/trailers.js';
import { driverRoutes } from './routes/drivers.js';
import { locationRoutes } from './routes/locations.js';
import { userRoutes } from './routes/users.js';
import { fleetSummaryRoute, nukeRoute } from './routes/admin.js';

const PORT = parseInt(process.env.PORT || '4001', 10);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'fleet-service' }));

// Routes
await app.register(authRoutes, { prefix: '/api' });
await app.register(truckRoutes, { prefix: '/api/trucks' });
await app.register(trailerRoutes, { prefix: '/api/trailers' });
await app.register(driverRoutes, { prefix: '/api/drivers' });
await app.register(locationRoutes, { prefix: '/api/locations' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(fleetSummaryRoute, { prefix: '/api/fleet' });
await app.register(nukeRoute, { prefix: '/api/admin' });

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down...`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`🚛 Fleet service running on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
