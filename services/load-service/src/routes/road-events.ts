import type { FastifyInstance } from 'fastify';
import { query, queryOne, publishEvent, KafkaTopics, parseGeoLineString } from '@truckmafia/shared';

export async function roadEventRoutes(app: FastifyInstance) {
  // ── List all road events (with their segments) ─────────────
  app.get('/', async (request) => {
    const { active } = request.query as { active?: string };
    let sql = `SELECT re.id, re.title, re.event_type, re.maxspeed_km, re.maxweight_kg, re.is_usable,
               re.note, re.start_at, re.end_at, re.created_at, re.updated_at,
               ST_AsText(ST_Centroid(ST_Collect(rs.geometry))) AS barycentre
        FROM road_event re
        LEFT JOIN road_event_segment res ON re.id = res.road_event_id
        LEFT JOIN road_segment rs ON res.road_segment_id = rs.id`;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (active === 'true') {
      conditions.push(`re.start_at <= now() AND (re.end_at IS NULL OR re.end_at >= now())`);
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ` GROUP BY re.id ORDER BY re.start_at DESC`;
    const rows = await query(sql, params);

    // Fetch segments for each event
    const result = [];
    for (const r of rows) {
      const segs = await query(
        `SELECT rs.id, rs.name, rs.highway_type, rs.maxspeed_km, rs.length_m,
                ST_AsText(rs.geometry) AS geometry
         FROM road_event_segment res
         JOIN road_segment rs ON res.road_segment_id = rs.id
         WHERE res.road_event_id = $1`, [r.id]
      );
      result.push({
        ...r,
        barycentre: r.barycentre ? parseBarycentre(r.barycentre) : null,
        segments: segs.map(s => ({ ...s, geometry: parseGeoLineString(s.geometry) })),
      });
    }
    return result;
  });

  // ── Create road event ──────────────────────────────────────
  app.post('/', async (request, reply) => {
    const b = request.body as {
      title?: string; event_type?: string; maxspeed_km?: number; maxweight_kg?: number;
      is_usable?: boolean; note?: string; start_at?: string; end_at?: string;
      segment_ids?: string[];
    };

    if (!b.title) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'title required' });
    if (!b.start_at) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'start_at required' });

    const row = await queryOne<{ id: string }>(
      `INSERT INTO road_event (title, event_type, maxspeed_km, maxweight_kg, is_usable, note, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        b.title, b.event_type || 'other',
        b.maxspeed_km ?? null, b.maxweight_kg ?? null,
        b.is_usable ?? true, b.note ?? null,
        b.start_at, b.end_at ?? null,
      ]
    );

    // Link segments
    if (b.segment_ids && b.segment_ids.length > 0) {
      for (const segId of b.segment_ids) {
        await query(
          `INSERT INTO road_event_segment (road_event_id, road_segment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [row!.id, segId]
        );
      }
    }

    await publishEvent(KafkaTopics.ROAD_EVENTS, row!.id, { type: 'road_event_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  // ── Update road event ─────────────────────────────────────
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = ['title', 'event_type', 'maxspeed_km', 'maxweight_kg', 'is_usable', 'note', 'start_at', 'end_at'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key in body) { sets.push(`${key} = $${i++}`); vals.push(body[key]); }
    }

    // Handle segment_ids separately
    const segmentIds = body.segment_ids as string[] | undefined;

    if (sets.length === 0 && !segmentIds) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });
    }

    if (sets.length > 0) {
      vals.push(id);
      const row = await queryOne(`UPDATE road_event SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
      if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Road event not found' });
    }

    // Update segments
    if (segmentIds) {
      await query('DELETE FROM road_event_segment WHERE road_event_id = $1', [id]);
      for (const segId of segmentIds) {
        await query(
          `INSERT INTO road_event_segment (road_event_id, road_segment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, segId]
        );
      }
    }

    await publishEvent(KafkaTopics.ROAD_EVENTS, id, { type: 'road_event_updated', payload: { id } });
    return { id };
  });

  // ── Delete road event ─────────────────────────────────────
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM road_event WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Road event not found' });
    await publishEvent(KafkaTopics.ROAD_EVENTS, id, { type: 'road_event_deleted', payload: { id } });
    return { id };
  });
}

// Parse "POINT(lng lat)" → { lat, lng }
function parseBarycentre(wkt: string): { lat: number; lng: number } | null {
  const m = wkt.match(/POINT\(([^ ]+) ([^)]+)\)/);
  if (!m) return null;
  return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
}
