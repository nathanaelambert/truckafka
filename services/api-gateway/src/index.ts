import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { KafkaTopics, subscribe } from '@truckmafia/shared';

const PORT = parseInt(process.env.PORT || '4000', 10);

const FLEET_URL = process.env.FLEET_SERVICE_URL || 'http://localhost:4001';
const LOAD_URL = process.env.LOAD_SERVICE_URL || 'http://localhost:4002';
const TRACKING_URL = process.env.TRACKING_SERVICE_URL || 'http://localhost:4003';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

// ═══════════════════════════════════════════════════════════════
// REST Proxy — routes requests to the appropriate microservice
// ═══════════════════════════════════════════════════════════════

const ROUTE_MAP: { prefix: string; target: string }[] = [
  // Fleet service
  { prefix: '/api/trucks', target: FLEET_URL },
  { prefix: '/api/trailers', target: FLEET_URL },
  { prefix: '/api/drivers', target: FLEET_URL },
  { prefix: '/api/locations', target: FLEET_URL },
  { prefix: '/api/users', target: FLEET_URL },
  { prefix: '/api/fleet', target: FLEET_URL },
  { prefix: '/api/admin', target: FLEET_URL },
  { prefix: '/api/login', target: FLEET_URL },
  { prefix: '/api/register', target: FLEET_URL },
  // Load service
  { prefix: '/api/loads', target: LOAD_URL },
  { prefix: '/api/hauls', target: LOAD_URL },
  { prefix: '/api/orders', target: LOAD_URL },
  { prefix: '/api/road-segments', target: LOAD_URL },
  { prefix: '/api/road-events', target: LOAD_URL },
  { prefix: '/api/itineraries', target: LOAD_URL },
  // Tracking service
  { prefix: '/api/positions', target: TRACKING_URL },
  { prefix: '/api/hos', target: TRACKING_URL },
  { prefix: '/api/simulate', target: TRACKING_URL },
  { prefix: '/api/mapmatch', target: TRACKING_URL },
  { prefix: '/api/trajectories', target: TRACKING_URL },
  { prefix: '/api/events', target: TRACKING_URL },
  { prefix: '/api/detention', target: TRACKING_URL },
];

async function proxyRequest(
  method: string,
  url: string,
  target: string,
  body: unknown,
  headers: Record<string, string | undefined>
): Promise<{ status: number; data: unknown }> {
  const targetUrl = `${target}${url}`;
  const fetchOpts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers.authorization ? { Authorization: headers.authorization } : {}),
    },
  };
  if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
    fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const resp = await fetch(targetUrl, fetchOpts);
  const text = await resp.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { status: resp.status, data };
}

// Register proxy routes for each prefix
for (const route of ROUTE_MAP) {
  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: `${route.prefix}/*`,
    handler: async (request, reply) => {
      try {
        const result = await proxyRequest(
          request.method,
          request.url,
          route.target,
          request.body,
          request.headers as Record<string, string | undefined>
        );
        return reply.code(result.status).send(result.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Proxy error';
        app.log.error(`Proxy error: ${msg}`);
        return reply.code(502).send({ error: 'BAD_GATEWAY', message: msg });
      }
    },
  });

  // Also handle exact prefix (no trailing path)
  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: route.prefix,
    handler: async (request, reply) => {
      try {
        const result = await proxyRequest(
          request.method,
          request.url,
          route.target,
          request.body,
          request.headers as Record<string, string | undefined>
        );
        return reply.code(result.status).send(result.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Proxy error';
        return reply.code(502).send({ error: 'BAD_GATEWAY', message: msg });
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// WebSocket Hub — subscribes to Kafka and broadcasts to clients
// ═══════════════════════════════════════════════════════════════

interface WSClient {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  topics?: string[];
}

const wsClients = new Set<WSClient>();

app.get('/ws', { websocket: true }, (socket, _req) => {
  const ws = socket as unknown as WSClient;
  wsClients.add(ws);
  app.log.info(`WebSocket client connected (${wsClients.size} total)`);

  socket.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      // Client can subscribe to specific topics
      if (msg.type === 'subscribe' && msg.topics) {
        (ws as unknown as { topics: string[] }).topics = msg.topics;
      }
    } catch {
      // ignore
    }
  });

  socket.on('close', () => {
    wsClients.delete(ws);
    app.log.info(`WebSocket client disconnected (${wsClients.size} total)`);
  });

  socket.send(JSON.stringify({ type: 'connected', message: 'Connected to Truckmafia WebSocket hub' }));
});

function broadcast(message: unknown, topic?: string): void {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  for (const ws of wsClients) {
    if (ws.readyState !== 1) continue; // OPEN
    // Check if client is filtering by topic
    const clientTopics = (ws as unknown as { topics?: string[] }).topics;
    if (topic && clientTopics && clientTopics.length > 0 && !clientTopics.includes(topic)) continue;
    ws.send(data);
  }
}

// Subscribe to all Kafka topics and broadcast to WebSocket clients
async function startKafkaConsumers(): Promise<void> {
  const topics = [
    KafkaTopics.FLEET_EVENTS,
    KafkaTopics.LOAD_EVENTS,
    KafkaTopics.TRACKING_EVENTS,
    KafkaTopics.HOS_EVENTS,
    KafkaTopics.ROAD_EVENTS,
    KafkaTopics.ORDER_EVENTS,
  ];

  for (const topic of topics) {
    try {
      await subscribe(topic, `gateway-${topic}`, async (payload) => {
        const value = payload.message.value?.toString();
        if (value) {
          try {
            const event = JSON.parse(value);
            broadcast(event, topic);
          } catch {
            // ignore parse errors
          }
        }
      });
      app.log.info(`Subscribed to Kafka topic: ${topic}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.warn(`Failed to subscribe to ${topic}: ${msg}`);
    }
  }
}

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'api-gateway' }));

// ═══════════════════════════════════════════════════════════════

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down...`);
  for (const ws of wsClients) {
    ws.close();
  }
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`🌐 API Gateway running on :${PORT}`);
    startKafkaConsumers().catch((err) => app.log.warn('Kafka consumers failed to start:', err.message));
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
