import type { FastifyInstance } from 'fastify';
import { query, queryOne, publishEvent, KafkaTopics } from '@truckmafia/shared';
import { computeItinerary } from '../routing/astar.js';

export async function haulRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { status, driver_id } = request.query as { status?: string; driver_id?: string };
    let sql = `SELECT h.*,
        l.number AS load_number, l.weight AS load_weight, l.commodity,
        l.pickup_location_id, l.dropoff_location_id,
        d.name AS driver_name, t.number AS truck_number, tr.number AS trailer_number,
        lp.name AS pickup_name, ld.name AS dropoff_name
      FROM haul h
      JOIN load l ON h.load_id = l.id
      JOIN driver d ON h.driver_id = d.id
      JOIN truck t ON h.truck_id = t.id
      JOIN trailer tr ON h.trailer_id = tr.id
      JOIN location lp ON l.pickup_location_id = lp.id
      JOIN location ld ON l.dropoff_location_id = ld.id`;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) { params.push(status); conditions.push(`h.status = $${params.length}`); }
    if (driver_id) { params.push(driver_id); conditions.push(`h.driver_id = $${params.length}`); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY h.started_at DESC';

    return query(sql, params);
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `SELECT h.*,
        l.number AS load_number, l.weight AS load_weight, l.commodity,
        l.pickup_phone, l.dropoff_phone, l.pickup_after, l.pickup_before,
        l.dropoff_after, l.dropoff_before, l.is_hazmat, l.rate_km, l.note AS load_note,
        l.pickup_location_id, l.dropoff_location_id,
        d.name AS driver_name, d.status AS driver_status,
        t.number AS truck_number, tr.number AS trailer_number,
        lp.name AS pickup_name, ld.name AS dropoff_name
      FROM haul h
      JOIN load l ON h.load_id = l.id
      JOIN driver d ON h.driver_id = d.id
      JOIN truck t ON h.truck_id = t.id
      JOIN trailer tr ON h.trailer_id = tr.id
      JOIN location lp ON l.pickup_location_id = lp.id
      JOIN location ld ON l.dropoff_location_id = ld.id
      WHERE h.id = $1`,
      [id]
    );
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Haul not found' });
    return row;
  });

  app.post('/', async (request, reply) => {
    const { load_id, driver_id, truck_id, trailer_id, started_at, ended_at, is_draft, is_active } = request.body as {
      load_id: string; driver_id: string; truck_id: string; trailer_id: string;
      started_at: string; ended_at: string; is_draft?: boolean; is_active?: boolean;
    };

    const required = { load_id, driver_id, truck_id, trailer_id, started_at, ended_at };
    for (const [k, v] of Object.entries(required)) {
      if (!v) return reply.code(400).send({ error: 'BAD_REQUEST', message: `${k} required` });
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO haul (load_id, driver_id, truck_id, trailer_id, started_at, ended_at, status, is_draft, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8) RETURNING id`,
      [load_id, driver_id, truck_id, trailer_id, started_at, ended_at, is_draft ?? false, is_active ?? false]
    );

    // Compute itinerary
    await computeItinerary(row!.id).catch((err) => app.log.warn('Itinerary computation failed:', err.message));

    await publishEvent(KafkaTopics.LOAD_EVENTS, row!.id, { type: 'haul_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = ['load_id', 'driver_id', 'truck_id', 'trailer_id', 'started_at', 'ended_at', 'status', 'is_draft', 'is_active'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    let needsReroute = false;
    for (const key of allowed) {
      if (key in body) {
        sets.push(`${key} = $${i++}`);
        vals.push(body[key]);
        if (['load_id', 'truck_id', 'trailer_id'].includes(key)) needsReroute = true;
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });
    vals.push(id);
    const row = await queryOne(`UPDATE haul SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Haul not found' });

    if (needsReroute) {
      await computeItinerary(id).catch((err) => app.log.warn('Re-route failed:', err.message));
    }

    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'haul_updated', payload: { id } });
    return { id };
  });

  // ── Submit haul (change from draft to assigned) ──────────────
  app.post('/:id/submit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne<{ id: string }>(
      `UPDATE haul SET status = 'assigned', is_draft = false, is_active = true WHERE id = $1 AND status = 'draft' RETURNING id`,
      [id]
    );
    if (!row) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Haul not found or not in draft status' });

    // Mark truck as on_move
    await query(
      `UPDATE truck SET status = 'on_move' WHERE id = (SELECT truck_id FROM haul WHERE id = $1)`,
      [id]
    );

    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'haul_submitted', payload: { id } });
    return { id, status: 'assigned' };
  });

  // ── Start haul (change to in_progress) ───────────────────────
  app.post('/:id/start', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne<{ id: string }>(
      `UPDATE haul SET status = 'in_progress' WHERE id = $1 AND status = 'assigned' RETURNING id`,
      [id]
    );
    if (!row) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Haul not found or not assigned' });
    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'haul_updated', payload: { id } });
    return { id, status: 'in_progress' };
  });

  // ── Complete haul ────────────────────────────────────────────
  app.post('/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne<{ id: string }>(
      `UPDATE haul SET status = 'completed', ended_at = now() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Haul not found' });

    // Mark truck back to at_hub
    await query(
      `UPDATE truck SET status = 'at_hub' WHERE id = (SELECT truck_id FROM haul WHERE id = $1)`,
      [id]
    );

    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'haul_updated', payload: { id } });
    return { id, status: 'completed' };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM haul WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Haul not found' });
    await publishEvent(KafkaTopics.LOAD_EVENTS, id, { type: 'haul_deleted', payload: { id } });
    return { id };
  });
}
