import type { FastifyInstance } from 'fastify';
import { query, queryOne, hashPassword } from '@truckmafia/shared';

export async function userRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return query(
      `SELECT id, user_name, name, role::text, driver_id, created_at FROM app_user ORDER BY user_name`
    );
  });

  app.post('/', async (request, reply) => {
    const { user_name, name, password, role, driver_id } = request.body as {
      user_name: string; name: string; password: string; role: string; driver_id?: string;
    };
    if (!user_name || !password) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'user_name and password required' });

    const existing = await query('SELECT id FROM app_user WHERE user_name = $1', [user_name]);
    if (existing.length > 0) return reply.code(409).send({ error: 'CONFLICT', message: 'Username exists' });

    const row = await queryOne<{ id: string }>(
      `INSERT INTO app_user (user_name, name, password_hash, role, driver_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user_name, name || user_name, hashPassword(password), role || 'dispatcher', driver_id || null]
    );
    return reply.code(201).send({ id: row!.id, user_name, name, role: role || 'dispatcher' });
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM app_user WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found' });
    return { id };
  });
}
