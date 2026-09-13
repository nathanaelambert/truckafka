import type { FastifyInstance } from 'fastify';
import { query, queryOne, publishEvent, KafkaTopics, parseGeoPoint } from '@truckmafia/shared';

const ROUTING_FIELDS = new Set(['pickup_location_id', 'dropoff_location_id', 'weight']);

export async function loadRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const rows = await query(
      `SELECT l.*,
         lp.name AS pickup_location_name, lp.position::text AS pickup_pos,
         ld.name AS dropoff_location_name, ld.position::text AS dropoff_pos
       FROM load l
       JOIN location lp ON l.pickup_location_id = lp.id
       JOIN location ld ON l.dropoff_location_id = ld.id
       ORDER BY l.created_at DESC`
    );
    return rows.map((l) => ({
      ...l,
      pickup_position: parseGeoPoint(l.pickup_pos),
      dropoff_position: parseGeoPoint(l.dropoff_pos),
      pickup_pos: undefined,
      dropoff_pos: undefined,
    }));
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const l = await queryOne(
      `SELECT l.*,
         lp.name AS pickup_location_name, lp.position::text AS pickup_pos,
         ld.name AS dropoff_location_name, ld.position::text AS dropoff_pos
       FROM load l
       JOIN location lp ON l.pickup_location_id = lp.id
       JOIN location ld ON l.dropoff_location_id = ld.id
       WHERE l.id = $1`,
      [id]
    );
    if (!l) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Load not found' });
    return {
      ...l,
      pickup_position: parseGeoPoint(l.pickup_pos),
      dropoff_position: parseGeoPoint(l.dropoff_pos),
      pickup_pos: undefined,
      dropoff_pos: undefined,
    };
  });

  app.post('/', async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    const required = ['number', 'pickup_location_id', 'pickup_phone', 'pickup_after', 'pickup_before', 'dropoff_location_id', 'dropoff_phone', 'dropoff_after', 'dropoff_before'];
    for (const f of required) {
      if (b[f] === undefined) return reply.code(400).send({ error: 'BAD_REQUEST', message: `${f} required` });
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO load (number, weight, commodity, pickup_location_id, pickup_phone, pickup_after, pickup_before,
          dropoff_location_id, dropoff_phone, dropoff_after, dropoff_before, multi_stop_id, is_hazmat, detention_rate, rate_km, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [
        b.number, b.weight ?? 0, b.commodity ?? null,
        b.pickup_location_id, b.pickup_phone, b.pickup_after, b.pickup_before,
        b.dropoff_location_id, b.dropoff_phone, b.dropoff_after, b.dropoff_before,
        b.multi_stop_id ?? null, b.is_hazmat ?? false,
        b.detention_rate ?? 0, b.rate_km ?? null, b.note ?? null,
      ]
    );
    await publishEvent(KafkaTopics.LOAD_EVENTS, row!.id, { type: 'load_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = ['number', 'weight', 'commodity', 'pickup_location_id', 'pickup_phone', 'pickup_after', 'pickup_before',
      'dropoff_location_id', 'dropoff_phone', 'dropoff_after', 'dropoff_before', 'multi_stop_id', 'is_hazmat', 'detention_rate', 'rate_km', 'note'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key in body) { sets.push(`${key} = $${i++}`); vals.push(body[key]); }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });
    vals.push(id);
    const row = await queryOne(`UPDATE load SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Load not found' });

    // Invalidate stored itinerary if routing-relevant fields changed
    const changedRoutingFields = Object.keys(body).filter((k) => ROUTING_FIELDS.has(k));
    if (changedRoutingFields.length > 0) {
      await query('DELETE FROM itinerary WHERE load_id = $1', [id]);
    }

    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'load_updated', payload: { id } });
    return { id };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM load WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Load not found' });

    // Delete all events associated with this load
    await query('DELETE FROM event WHERE load_id = $1', [id]);

    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'load_deleted', payload: { id } });
    return { id };
  });
}
