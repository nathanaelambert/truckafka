import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '@truckmafia/shared';

export async function fleetSummaryRoute(app: FastifyInstance) {
  app.get('/summary', async () => {
    const rows = await query('SELECT * FROM v_fleet_summary');
    return rows[0] ?? {};
  });
}

export async function nukeRoute(app: FastifyInstance) {
  // DELETE /api/admin/nuke?confirm=YES_DELETE_EVERYTHING
  app.delete('/nuke', async (request, reply) => {
    const { confirm } = request.query as { confirm?: string };
    if (confirm !== 'YES_DELETE_EVERYTHING') {
      return reply.code(400).send({
        error: 'CONFIRMATION_REQUIRED',
        message: 'Pass ?confirm=YES_DELETE_EVERYTHING to delete everything',
      });
    }

    const tables = [
      'road_segment_traversal', 'road_event_segment', 'road_event', 'haul', 'load',
      'position_log', 'driver_status_log', 'hours_of_service', 'detention_log',
      'driver', 'trailer', 'truck', 'app_user',
      'road_segment', 'road_node', 'location', 'geofence',
      'event', 'motion', '"order"',
    ];
    for (const t of tables) {
      await query(`DELETE FROM ${t}`);
    }
    // Reset sequences
    await query(`SELECT setval(pg_get_serial_sequence('geofence', 'id'), 1, false)`).catch(() => {});

    return { status: 'everything deleted' };
  });
}
