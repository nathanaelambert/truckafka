import type { FastifyInstance } from 'fastify';
import { query, queryOne, parseGeoLineString, publishEvent, KafkaTopics } from '@truckmafia/shared';
import { fetchAndStoreRoadData } from '../routing/overpass.js';

export async function roadSegmentRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { bbox } = request.query as { bbox?: string };
    let sql = `SELECT id, ST_AsText(geometry) AS geometry, maxspeed_km, maxweight_kg, length_m, highway_type, from_node, to_node, name, oneway FROM road_segment`;
    const params: unknown[] = [];
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(parseFloat);
      sql += ` WHERE geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;
      params.push(minLng, minLat, maxLng, maxLat);
    }
    sql += ' LIMIT 5000';
    const rows = await query(sql, params);
    return rows.map((r) => ({ ...r, geometry: parseGeoLineString(r.geometry) }));
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `SELECT id, ST_AsText(geometry) AS geometry, maxspeed_km, maxweight_kg, length_m, highway_type, from_node, to_node, name
       FROM road_segment WHERE id = $1`,
      [id]
    );
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Road segment not found' });
    return { ...row, geometry: parseGeoLineString(row.geometry) };
  });

  // ── Load road data from Overpass API for a bbox ────────────
  app.post('/load', async (request, reply) => {
    const { minLat, minLng, maxLat, maxLng } = request.body as {
      minLat: number; minLng: number; maxLat: number; maxLng: number;
    };
    if ([minLat, minLng, maxLat, maxLng].some(v => isNaN(v))) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Invalid bbox' });
    }
    try {
      const result = await fetchAndStoreRoadData(minLat, minLng, maxLat, maxLng);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'OVERPASS_ERROR', message: msg });
    }
  });
}
