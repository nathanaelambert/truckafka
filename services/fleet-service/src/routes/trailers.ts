import type { FastifyInstance } from 'fastify';
import { query, queryOne, publishEvent, KafkaTopics } from '@truckmafia/shared';

export async function trailerRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return query(
      `SELECT t.*, l.name AS location_name
       FROM trailer t LEFT JOIN location l ON t.location_id = l.id
       ORDER BY t.number`
    );
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('SELECT * FROM trailer WHERE id = $1', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Trailer not found' });
    return row;
  });

  app.post('/', async (request, reply) => {
    const { number, is_safe_to_drive, maxweight_kg, note, location_id, hub } = request.body as {
      number: string; is_safe_to_drive?: boolean; maxweight_kg?: number; note?: string; location_id?: string; hub?: string;
    };
    if (!number) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'number required' });

    const row = await queryOne<{ id: string }>(
      `INSERT INTO trailer (number, status, is_safe_to_drive, maxweight_kg, note, location_id, hub)
       VALUES ($1, 'empty', $2, $3, $4, $5, $6) RETURNING id`,
      [number, is_safe_to_drive ?? true, maxweight_kg ?? 20000, note ?? null, location_id ?? null, hub ?? 'london']
    );
    await publishEvent(KafkaTopics.FLEET_EVENTS, row!.id, { type: 'trailer_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

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
    const row = await queryOne(`UPDATE trailer SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Trailer not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'trailer_updated', payload: { id } });
    return { id };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM trailer WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Trailer not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'trailer_deleted', payload: { id } });
    return { id };
  });
}
