import type { FastifyInstance } from 'fastify';
import { query, queryOne, pointToWKT, parseGeoPoint, publishEvent, KafkaTopics } from '@truckmafia/shared';

export async function truckRoutes(app: FastifyInstance) {
  // ── List all trucks ──────────────────────────────────────────
  app.get('/', async () => {
    const rows = await query(
      `SELECT t.*,
         l.name AS location_name,
         l.position::text AS location_pos
       FROM truck t
       LEFT JOIN location l ON t.location_id = l.id
       ORDER BY t.number`
    );
    return rows.map((t) => ({
      ...t,
      position: t.location_pos ? parseGeoPoint(t.location_pos) : null,
      location_pos: undefined,
    }));
  });

  // ── Get one truck ───────────────────────────────────────────
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const t = await queryOne(
      `SELECT t.*, l.name AS location_name, l.position::text AS location_pos
       FROM truck t LEFT JOIN location l ON t.location_id = l.id WHERE t.id = $1`,
      [id]
    );
    if (!t) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Truck not found' });
    return { ...t, position: parseGeoPoint(t.location_pos) };
  });

  // ── Create truck ────────────────────────────────────────────
  app.post('/', async (request, reply) => {
    const { number, is_safe_to_drive, maxweight_kg, note, location_id, hub } = request.body as {
      number: string; is_safe_to_drive?: boolean; maxweight_kg?: number; note?: string; location_id?: string; hub?: string;
    };
    if (!number) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'number required' });

    const row = await queryOne<{ id: string }>(
      `INSERT INTO truck (number, status, is_safe_to_drive, maxweight_kg, note, location_id, hub)
       VALUES ($1, 'at_hub', $2, $3, $4, $5, $6) RETURNING id`,
      [number, is_safe_to_drive ?? true, maxweight_kg ?? 40000, note ?? null, location_id ?? null, hub ?? 'london']
    );
    await publishEvent(KafkaTopics.FLEET_EVENTS, row!.id, { type: 'truck_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  // ── Update truck ─────────────────────────────────────────────
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = ['number', 'status', 'is_safe_to_drive', 'maxweight_kg', 'note', 'location_id', 'hub'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key in body) {
        sets.push(`${key} = $${i++}`);
        vals.push(body[key]);
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });

    vals.push(id);
    const row = await queryOne<{ id: string }>(
      `UPDATE truck SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`,
      vals
    );
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Truck not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'truck_updated', payload: { id } });
    return { id };
  });

  // ── Delete truck ────────────────────────────────────────────
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM truck WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Truck not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'truck_deleted', payload: { id } });
    return { id };
  });
}
