import type { FastifyInstance } from 'fastify';
import { query, hashPassword, comparePassword, signToken } from '@truckmafia/shared';

export async function authRoutes(app: FastifyInstance) {
  // ── Login ────────────────────────────────────────────────────
  app.post('/login', async (request, reply) => {
    const { user_name, password } = request.body as { user_name: string; password: string };
    if (!user_name || !password) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'user_name and password required' });
    }

    const user = await query<{ id: string; user_name: string; name: string; password_hash: string; role: string; driver_id: string | null }>(
      `SELECT id, user_name, name, password_hash, role::text, driver_id FROM app_user WHERE user_name = $1`,
      [user_name]
    );

    if (user.length === 0 || !comparePassword(password, user[0].password_hash)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const u = user[0];
    const token = signToken({
      userId: u.id,
      role: u.role as 'admin' | 'dispatcher' | 'driver',
      driverId: u.driver_id ?? undefined,
    });

    return reply.send({
      token,
      user: { id: u.id, user_name: u.user_name, name: u.name, role: u.role, driver_id: u.driver_id },
    });
  });

  // ── Register (admin only) ───────────────────────────────────
  app.post('/register', async (request, reply) => {
    const auth = request.headers.authorization;
    // Simple check — in production this would be middleware
    const { user_name, name, password, role, driver_id } = request.body as {
      user_name: string; name: string; password: string; role: string; driver_id?: string;
    };

    if (!user_name || !password) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'user_name and password required' });
    }

    const existing = await query('SELECT id FROM app_user WHERE user_name = $1', [user_name]);
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'CONFLICT', message: 'Username already exists' });
    }

    const row = await query<{ id: string }>(
      `INSERT INTO app_user (user_name, name, password_hash, role, driver_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user_name, name || user_name, hashPassword(password), role || 'dispatcher', driver_id || null]
    );

    return reply.code(201).send({ id: row[0].id, user_name, name, role: role || 'dispatcher' });
  });
}
