import type { FastifyInstance } from 'fastify';
import { query, queryOne, publishEvent, KafkaTopics } from '@truckmafia/shared';

export async function orderRoutes(app: FastifyInstance) {
  // ── GET /api/orders — list all orders ──────────────────────
  app.get('/', async () => {
    const rows = await query(
      `SELECT o.*, l.number AS load_number,
              l.weight, l.commodity, l.is_hazmat, l.rate_km,
              l.pickup_location_id, l.dropoff_location_id,
              l.pickup_phone, l.dropoff_phone,
              l.pickup_after, l.pickup_before,
              l.dropoff_after, l.dropoff_before
       FROM "order" o
       JOIN load l ON o.load_id = l.id
       ORDER BY o.created_at DESC`
    );
    return rows.map((r) => ({
      ...r,
      events: r.events_data,
      events_data: undefined,
    }));
  });

  // ── GET /api/orders/:id — get one order ────────────────────
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await queryOne(
      `SELECT o.*, l.number AS load_number,
              l.weight, l.commodity, l.is_hazmat, l.rate_km,
              l.pickup_location_id, l.dropoff_location_id,
              l.pickup_phone, l.dropoff_phone,
              l.pickup_after, l.pickup_before,
              l.dropoff_after, l.dropoff_before
       FROM "order" o
       JOIN load l ON o.load_id = l.id
       WHERE o.id = $1`, [id]
    );
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });
    return { ...r, events: r.events_data, events_data: undefined };
  });

  // ── POST /api/orders — create order ────────────────────────
  app.post('/', async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    if (!b.load_id) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'load_id required' });

    const eventsData = b.events_data ?? [];
    const status = b.status ?? 'incoming';
    const haulId = b.haul_id ?? null;

    const row = await queryOne<{ id: string }>(
      `INSERT INTO "order" (load_id, haul_id, status, events_data)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.load_id, haulId, status, JSON.stringify(eventsData)]
    );

    await publishEvent(KafkaTopics.ORDER_EVENTS, row!.id, { type: 'order_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  // ── PUT /api/orders/:id — update order ─────────────────────
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = ['load_id', 'haul_id', 'status', 'events_data'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key in body) {
        if (key === 'events_data') {
          sets.push(`events_data = $${i++}`);
          vals.push(JSON.stringify(body[key]));
        } else {
          sets.push(`${key} = $${i++}`);
          vals.push(body[key]);
        }
      }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });
    vals.push(id);
    const row = await queryOne(`UPDATE "order" SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });

    await publishEvent(KafkaTopics.ORDER_EVENTS, id, { type: 'order_updated', payload: { id } });
    return { id };
  });

  // ── DELETE /api/orders/:id — delete order ──────────────────
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Fetch events_data to get event IDs before deleting the order
    const orderRow = await queryOne<{ events_data: string }>(
      'SELECT events_data FROM "order" WHERE id = $1', [id]
    );
    if (!orderRow) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Order not found' });

    // Delete associated events from the event table
    try {
      const events = typeof orderRow.events_data === 'string' ? JSON.parse(orderRow.events_data) : orderRow.events_data;
      if (Array.isArray(events)) {
        for (const ev of events) {
          if (ev.id) {
            await query('DELETE FROM event WHERE id = $1', [ev.id]).catch(() => {});
          }
        }
      }
    } catch { /* ignore parse errors */ }

    // Delete the order itself (this also cascades to haul if FK is set, but haul_id is SET NULL)
    await queryOne('DELETE FROM "order" WHERE id = $1 RETURNING id', [id]);

    await publishEvent(KafkaTopics.ORDER_EVENTS, id, { type: 'order_deleted', payload: { id } });
    return { id };
  });
}
