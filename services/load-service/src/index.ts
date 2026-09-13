import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pool } from '@truckmafia/shared';
import { loadRoutes } from './routes/loads.js';
import { haulRoutes } from './routes/hauls.js';
import { orderRoutes } from './routes/orders.js';
import { roadSegmentRoutes } from './routes/road-segments.js';
import { roadEventRoutes } from './routes/road-events.js';
import { itineraryRoutes } from './routes/itineraries.js';
import { subscribe, KafkaTopics } from '@truckmafia/shared';

const PORT = parseInt(process.env.PORT || '4002', 10);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok', service: 'load-service' }));

await app.register(loadRoutes, { prefix: '/api/loads' });
await app.register(haulRoutes, { prefix: '/api/hauls' });
await app.register(orderRoutes, { prefix: '/api/orders' });
await app.register(roadSegmentRoutes, { prefix: '/api/road-segments' });
await app.register(roadEventRoutes, { prefix: '/api/road-events' });
await app.register(itineraryRoutes, { prefix: '/api/itineraries' });

// Subscribe to fleet events to invalidate route graph when road events change
subscribe(KafkaTopics.ROAD_EVENTS, 'load-service', async () => {
  // Road events changed; graph cache will naturally expire
}).catch((err) => app.log.warn('Kafka subscribe failed:', err.message));

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down...`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`📦 Load service running on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
