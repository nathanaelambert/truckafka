import type { FastifyInstance } from 'fastify';
import { query, queryOne, publishEvent, KafkaTopics } from '@truckmafia/shared';

export async function driverRoutes(app: FastifyInstance) {
  // ── List all drivers (with HOS) ──────────────────────────────
  app.get('/', async () => {
    return query(
      `SELECT d.*,
         hos.remaining_cycle_h, hos.remaining_on_duty_h, hos.remaining_drive_h,
         hos.next_bed_time, hos.breaks_remaining, hos.slept_today,
         l.name AS home_location_name
       FROM driver d
       LEFT JOIN hours_of_service hos ON hos.driver_id = d.id
       LEFT JOIN location l ON d.home_location_id = l.id
       ORDER BY d.name`
    );
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `SELECT d.*, hos.remaining_cycle_h, hos.remaining_on_duty_h, hos.remaining_drive_h,
         hos.next_bed_time, hos.breaks_remaining, hos.slept_today
       FROM driver d
       LEFT JOIN hours_of_service hos ON hos.driver_id = d.id
       WHERE d.id = $1`,
      [id]
    );
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Driver not found' });
    return row;
  });

  app.post('/', async (request, reply) => {
    const { name, email, home_location_id, cycle_id, overtime, day_start_hour } = request.body as {
      name: string; email?: string; home_location_id?: string; cycle_id?: number; overtime?: number; day_start_hour?: string;
    };
    if (!name) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'name required' });

    const row = await queryOne<{ id: string }>(
      `INSERT INTO driver (name, email, status, home_location_id, cycle_id, overtime, day_start_hour)
       VALUES ($1, $2, 'off_duty', $3, $4, $5, $6) RETURNING id`,
      [name, email ?? null, home_location_id ?? null, cycle_id ?? 1, overtime ?? 10, day_start_hour ?? '06:00']
    );
    // Initialize HOS record
    await query(
      `INSERT INTO hours_of_service (driver_id, remaining_cycle_h, remaining_on_duty_h, remaining_drive_h, breaks_remaining, slept_today)
       VALUES ($1, 70, 14, 13, 4, false)`,
      [row!.id]
    );
    await publishEvent(KafkaTopics.FLEET_EVENTS, row!.id, { type: 'driver_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = ['name', 'email', 'status', 'home_location_id', 'cycle_id', 'overtime', 'day_start_hour'];
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
    const row = await queryOne(`UPDATE driver SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Driver not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'driver_updated', payload: { id } });
    return { id };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM driver WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Driver not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'driver_deleted', payload: { id } });
    return { id };
  });
}
