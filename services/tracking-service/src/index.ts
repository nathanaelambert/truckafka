import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pool, query, queryOne, pointToWKT, publishEvent, KafkaTopics, parseGeoPoint } from '@truckmafia/shared';
import { updateDriverStatus, getHOS, getAllHOS, tickHOS } from './hos.js';
import { startSimulation, stopSimulation, getActiveSimulations } from './simulate.js';

const PORT = parseInt(process.env.PORT || '4003', 10);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok', service: 'tracking-service' }));

// ═══════════════════════════════════════════════════════════════
// Position endpoints
// ═══════════════════════════════════════════════════════════════

// ── Report position (from driver app or simulator) ─────────────
app.post('/api/positions', async (request, reply) => {
  const { truck_id, driver_id, lat, lng, heading, speed_kmh } = request.body as {
    truck_id: string; driver_id?: string; lat: number; lng: number; heading?: number; speed_kmh?: number;
  };

  if (!truck_id || lat === undefined || lng === undefined) {
    return reply.code(400).send({ error: 'BAD_REQUEST', message: 'truck_id, lat, lng required' });
  }

  await query(
    `INSERT INTO position_log (truck_id, driver_id, position, heading, speed_kmh, measured_at)
     VALUES ($1, $2, $3::geography, $4, $5, now())`,
    [truck_id, driver_id ?? null, pointToWKT(lat, lng), heading ?? 0, speed_kmh ?? 0]
  );

  // Publish to Kafka for WebSocket broadcast
  await publishEvent(KafkaTopics.TRACKING_EVENTS, truck_id, {
    type: 'position_update',
    payload: { truck_id, lat, lng, heading: heading ?? 0, speed_kmh: speed_kmh ?? 0, measured_at: new Date().toISOString() },
  });

  return { status: 'ok' };
});

// ── Get latest position for a truck ────────────────────────────
app.get('/api/positions/:truckId', async (request, reply) => {
  const { truckId } = request.params as { truckId: string };
  const row = await queryOne<{ position: string; heading: number; speed_kmh: number; measured_at: string }>(
    `SELECT position::text, heading, speed_kmh, measured_at FROM v_latest_position WHERE truck_id = $1`,
    [truckId]
  );
  if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No position data' });
  const pos = parseGeoPoint(row.position);
  return { truck_id: truckId, lat: pos?.lat, lng: pos?.lng, heading: row.heading, speed_kmh: row.speed_kmh, measured_at: row.measured_at };
});

// ── Get all latest positions ──────────────────────────────────
app.get('/api/positions', async () => {
  const rows = await query(
    `SELECT v.truck_id, v.position::text, v.heading, v.speed_kmh, v.measured_at,
       t.number AS truck_number
     FROM v_latest_position v
     JOIN truck t ON v.truck_id = t.id`
  );
  return rows.map((r) => ({
    truck_id: r.truck_id,
    truck_number: r.truck_number,
    lat: parseGeoPoint(r.position)?.lat,
    lng: parseGeoPoint(r.position)?.lng,
    heading: r.heading,
    speed_kmh: r.speed_kmh,
    measured_at: r.measured_at,
  }));
});

// ── Get position history for a truck ──────────────────────────
app.get('/api/positions/:truckId/history', async (request) => {
  const { truckId } = request.params as { truckId: string };
  const { hours } = request.query as { hours?: string };
  const hrs = parseInt(hours || '24', 10);

  const rows = await query<{ position: string; heading: number; speed_kmh: number; measured_at: string }>(
    `SELECT position::text, heading, speed_kmh, measured_at
     FROM position_log
     WHERE truck_id = $1 AND measured_at >= now() - ($2 * interval '1 hour')
     ORDER BY measured_at ASC`,
    [truckId, hrs]
  );
  return rows.map((r) => ({
    lat: parseGeoPoint(r.position)?.lat,
    lng: parseGeoPoint(r.position)?.lng,
    heading: r.heading,
    speed_kmh: r.speed_kmh,
    measured_at: r.measured_at,
  }));
});

// ═══════════════════════════════════════════════════════════════
// HOS endpoints
// ═══════════════════════════════════════════════════════════════

app.get('/api/hos', async () => {
  return getAllHOS();
});

app.get('/api/hos/:driverId', async (request, reply) => {
  const { driverId } = request.params as { driverId: string };
  const hos = await getHOS(driverId);
  if (!hos) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Driver not found' });
  return hos;
});

app.post('/api/hos/:driverId/status', async (request, reply) => {
  const { driverId } = request.params as { driverId: string };
  const { status } = request.body as { status: 'off_duty' | 'on_duty_not_driving' | 'driving' };

  const validStatuses = ['off_duty', 'on_duty_not_driving', 'driving'];
  if (!validStatuses.includes(status)) {
    return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Invalid status' });
  }

  // Validate transition: cannot go from off_duty to driving directly
  const driver = await queryOne<{ status: string }>('SELECT status::text FROM driver WHERE id = $1', [driverId]);
  if (!driver) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Driver not found' });

  if (driver.status === 'off_duty' && status === 'driving') {
    return reply.code(400).send({ error: 'INVALID_TRANSITION', message: 'Cannot go from off_duty to driving directly' });
  }

  await updateDriverStatus(driverId, status);
  await publishEvent(KafkaTopics.TRACKING_EVENTS, driverId, {
    type: 'driver_status_change',
    payload: { driver_id: driverId, status, recorded_at: new Date().toISOString() },
  });

  return { driver_id: driverId, status };
});

// ═══════════════════════════════════════════════════════════════
// Simulation endpoints (admin test/debug)
// ═══════════════════════════════════════════════════════════════

app.post('/api/simulate/:haulId/start', async (request, reply) => {
  const { haulId } = request.params as { haulId: string };
  const { speed_kmh } = request.body as { speed_kmh?: number };
  try {
    await startSimulation(haulId, speed_kmh ?? 80);
    return { haul_id: haulId, status: 'simulating', speed_kmh: speed_kmh ?? 80 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return reply.code(400).send({ error: 'SIMULATION_FAILED', message: msg });
  }
});

app.post('/api/simulate/:haulId/stop', async (request) => {
  const { haulId } = request.params as { haulId: string };
  stopSimulation(haulId);
  return { haul_id: haulId, status: 'stopped' };
});

app.get('/api/simulate', async () => {
  return { active: getActiveSimulations() };
});

// ═══════════════════════════════════════════════════════════════
// Map matching (simplified)
// ═══════════════════════════════════════════════════════════════

app.post('/api/mapmatch', async (request, reply) => {
  const { lat, lng } = request.body as { lat: number; lng: number };
  const row = await queryOne<{ id: string; name: string; maxspeed_km: number; highway_type: string; dist: string }>(
    `SELECT id, name, maxspeed_km, highway_type,
       ST_Distance(geometry, ST_MakePoint($1, $2)::geography)::text AS dist
     FROM road_segment
     ORDER BY geometry <-> ST_MakePoint($1, $2)::geography
     LIMIT 1`,
    [lng, lat]
  );
  if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No road segment found' });
  return {
    road_segment_id: row.id,
    name: row.name,
    maxspeed_km: row.maxspeed_km,
    highway_type: row.highway_type,
    distance_m: parseFloat(row.dist),
  };
});

// ═══════════════════════════════════════════════════════════════
// Trajectory endpoints
// ═══════════════════════════════════════════════════════════════

// ── Get all element positions at a given time (for map playback) ──
app.get('/api/trajectories/snapshot', async (request, reply) => {
  const { time } = request.query as { time?: string };
  const t = time ? new Date(time) : new Date();
  if (isNaN(t.getTime())) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Invalid time' });

  const rows = await query<{
    element_type: string; element_id: string; segment_type: string; event_type: string | null;
    waypoints: string; bound_to_type: string | null; bound_to_id: string | null;
  }>(
    `SELECT element_type, element_id, segment_type, event_type, waypoints::text, bound_to_type, bound_to_id
     FROM trajectory_segment
     WHERE start_time <= $1 AND end_time >= $1`,
    [t]
  );

  const results: Record<string, { type: string; id: string; lat: number; lng: number; event: string | null; segment: string }[]> = {};

  for (const row of rows) {
    // If bound, skip — we'll resolve from source
    if (row.bound_to_type && row.bound_to_id) continue;

    const wps = row.waypoints ? JSON.parse(row.waypoints) : [];
    let lat = 0, lng = 0;

    if (row.segment_type === 'stationary' && wps.length > 0) {
      lat = wps[0].lat; lng = wps[0].lng;
    } else if (row.segment_type === 'moving' && wps.length > 0) {
      // Interpolate position at time t
      const tMs = t.getTime();
      if (tMs <= new Date(wps[0].t).getTime()) {
        lat = wps[0].lat; lng = wps[0].lng;
      } else if (tMs >= new Date(wps[wps.length - 1].t).getTime()) {
        lat = wps[wps.length - 1].lat; lng = wps[wps.length - 1].lng;
      } else {
        for (let i = 0; i < wps.length - 1; i++) {
          const t0 = new Date(wps[i].t).getTime();
          const t1 = new Date(wps[i + 1].t).getTime();
          if (tMs >= t0 && tMs <= t1) {
            const f = (tMs - t0) / (t1 - t0);
            lat = wps[i].lat + (wps[i + 1].lat - wps[i].lat) * f;
            lng = wps[i].lng + (wps[i + 1].lng - wps[i].lng) * f;
            break;
          }
        }
      }
    }

    const key = row.element_type;
    if (!results[key]) results[key] = [];
    results[key].push({ type: row.element_type, id: row.element_id, lat, lng, event: row.event_type, segment: row.segment_type });
  }

  // Resolve bound elements
  const boundRows = rows.filter(r => r.bound_to_type && r.bound_to_id);
  for (const row of boundRows) {
    const source = results[row.bound_to_type!]?.find(e => e.id === row.bound_to_id);
    if (source) {
      const key = row.element_type;
      if (!results[key]) results[key] = [];
      results[key].push({ type: row.element_type, id: row.element_id, lat: source.lat, lng: source.lng, event: row.event_type, segment: row.segment_type });
    }
  }

  return { time: t.toISOString(), positions: results };
});

// ── Get trajectory segments for an element ──
app.get('/api/trajectories/:elementType/:elementId', async (request, reply) => {
  const { elementType, elementId } = request.params as { elementType: string; elementId: string };
  const { from, to } = request.query as { from?: string; to?: string };

  const fromTime = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
  const toTime = to ? new Date(to) : new Date();

  const rows = await query<{
    id: string; segment_type: string; event_type: string | null;
    start_time: string; end_time: string; waypoints: string;
    bound_to_type: string | null; bound_to_id: string | null;
  }>(
    `SELECT id, segment_type, event_type, start_time, end_time, waypoints::text, bound_to_type, bound_to_id
     FROM trajectory_segment
     WHERE element_type = $1 AND element_id = $2
       AND start_time <= $3 AND end_time >= $4
     ORDER BY start_time`,
    [elementType, elementId, toTime, fromTime]
  );

  return {
    element_type: elementType,
    element_id: elementId,
    segments: rows.map(r => ({
      id: r.id,
      segment_type: r.segment_type,
      event_type: r.event_type,
      start_time: r.start_time,
      end_time: r.end_time,
      waypoints: r.waypoints ? JSON.parse(r.waypoints) : null,
      bound_to_type: r.bound_to_type,
      bound_to_id: r.bound_to_id,
    })),
  };
});

// ── Get all trajectory events in a time range (for timeline) ──
app.get('/api/trajectories', async (request, reply) => {
  const { from, to } = request.query as { from?: string; to?: string };

  const fromTime = from ? new Date(from) : new Date(Date.now() - 3 * 86400000);
  const toTime = to ? new Date(to) : new Date();

  const rows = await query<{
    element_type: string; element_id: string; segment_type: string; event_type: string | null;
    start_time: string; end_time: string; bound_to_type: string | null; bound_to_id: string | null;
  }>(
    `SELECT element_type, element_id, segment_type, event_type, start_time, end_time, bound_to_type, bound_to_id
     FROM trajectory_segment
     WHERE start_time <= $1 AND end_time >= $2
       AND (bound_to_type IS NULL) -- only primary segments
     ORDER BY start_time`,
    [toTime, fromTime]
  );

  return {
    from: fromTime.toISOString(),
    to: toTime.toISOString(),
    events: rows.map(r => ({
      element_type: r.element_type,
      element_id: r.element_id,
      segment_type: r.segment_type,
      event_type: r.event_type,
      start_time: r.start_time,
      end_time: r.end_time,
    })),
  };
});

// ═══════════════════════════════════════════════════════════════
// Event endpoints
// ═══════════════════════════════════════════════════════════════

// ── Get events in a time range (for timeline) ──
app.get('/api/events', async (request, reply) => {
  const { from, to } = request.query as { from?: string; to?: string };
  const fromTime = from ? new Date(from) : new Date(Date.now() - 3 * 86400000);
  const toTime = to ? new Date(to) : new Date(Date.now() + 86400000);

  const rows = await query<{
    id: string; type: string; start_time: string; end_time: string;
    truck_id: string | null; load_id: string | null; trailer_id: string | null; driver_id: string | null;
    start_location_id: string; end_location_id: string;
    start_loc_name: string | null; end_loc_name: string | null;
    motion_id: string | null; distance_m: number | null; status: string;
  }>(
    `SELECT e.id, e.type, e.start_time, e.end_time,
            e.truck_id, e.load_id, e.trailer_id, e.driver_id,
            e.start_location_id, e.end_location_id, e.motion_id,
            sl.name AS start_loc_name, el.name AS end_loc_name,
            m.distance_m, e.status
     FROM event e
     JOIN location sl ON e.start_location_id = sl.id
     JOIN location el ON e.end_location_id = el.id
     LEFT JOIN motion m ON e.motion_id = m.id
     WHERE e.start_time <= $1 AND e.end_time >= $2
     ORDER BY e.start_time`,
    [toTime, fromTime]
  );

  return {
    from: fromTime.toISOString(),
    to: toTime.toISOString(),
    events: rows.map(r => ({
      id: r.id, type: r.type,
      start_time: r.start_time, end_time: r.end_time,
      truck_id: r.truck_id, load_id: r.load_id, trailer_id: r.trailer_id, driver_id: r.driver_id,
      start_location_id: r.start_location_id, end_location_id: r.end_location_id,
      start_location_name: r.start_loc_name, end_location_name: r.end_loc_name,
      motion_id: r.motion_id, distance_m: r.distance_m, status: r.status,
    })),
  };
});

// ── Get event positions at a given time (for map playback) ──
app.get('/api/events/snapshot', async (request, reply) => {
  const { time } = request.query as { time?: string };
  const t = time ? new Date(time) : new Date();
  if (isNaN(t.getTime())) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Invalid time' });

  const rows = await query<{
    id: string; type: string; start_time: string; end_time: string;
    truck_id: string | null; load_id: string | null; trailer_id: string | null; driver_id: string | null;
    start_location_id: string; end_location_id: string;
    motion_id: string | null; waypoints: string | null; status: string;
  }>(
    `SELECT e.id, e.type, e.start_time, e.end_time,
            e.truck_id, e.load_id, e.trailer_id, e.driver_id,
            e.start_location_id, e.end_location_id, e.motion_id,
            m.waypoints::text AS waypoints, e.status
     FROM event e
     LEFT JOIN motion m ON e.motion_id = m.id
     WHERE e.start_time <= $1 AND e.end_time >= $1`,
    [t]
  );

  const events = rows.map(r => {
    let lat = 0, lng = 0;
    const tMs = t.getTime();
    const startMs = new Date(r.start_time).getTime();
    const endMs = new Date(r.end_time).getTime();

    if (r.waypoints) {
      const wps = JSON.parse(r.waypoints) as { t: string; lat: number; lng: number }[];
      if (wps.length > 0) {
        if (tMs <= new Date(wps[0].t).getTime()) { lat = wps[0].lat; lng = wps[0].lng; }
        else if (tMs >= new Date(wps[wps.length - 1].t).getTime()) { lat = wps[wps.length - 1].lat; lng = wps[wps.length - 1].lng; }
        else {
          for (let i = 0; i < wps.length - 1; i++) {
            const t0 = new Date(wps[i].t).getTime(), t1 = new Date(wps[i + 1].t).getTime();
            if (tMs >= t0 && tMs <= t1) {
              const f = (tMs - t0) / (t1 - t0);
              lat = wps[i].lat + (wps[i + 1].lat - wps[i].lat) * f;
              lng = wps[i].lng + (wps[i + 1].lng - wps[i].lng) * f;
              break;
            }
          }
        }
      }
    }

    // If no motion, position is at start_location (same as end for stationary events)
    if (lat === 0 && lng === 0 && !r.motion_id) {
      // Will be resolved by the caller using location_id
    }

    return {
      id: r.id, type: r.type,
      start_time: r.start_time, end_time: r.end_time,
      truck_id: r.truck_id, load_id: r.load_id, trailer_id: r.trailer_id, driver_id: r.driver_id,
      start_location_id: r.start_location_id, end_location_id: r.end_location_id,
      lat, lng, has_motion: !!r.motion_id, status: r.status,
    };
  });

  return { time: t.toISOString(), events };
});

// ── Create an event ──────────────────────────────────────────
app.post('/api/events', async (request, reply) => {
  const b = request.body as Record<string, unknown>;
  if (!b.type || !b.start_time || !b.end_time || !b.start_location_id || !b.end_location_id) {
    return reply.code(400).send({ error: 'BAD_REQUEST', message: 'type, start_time, end_time, start_location_id, end_location_id required' });
  }
  const status = (b.status as string) || 'incoming';
  const row = await queryOne<{ id: string }>(
    `INSERT INTO event (type, start_time, end_time, truck_id, load_id, trailer_id, driver_id,
        start_location_id, end_location_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [b.type, b.start_time, b.end_time, b.truck_id ?? null, b.load_id ?? null,
     b.trailer_id ?? null, b.driver_id ?? null, b.start_location_id, b.end_location_id, status]
  );
  return reply.code(201).send({ id: row!.id });
});

// ── Update an event (status, times, actors) ──────────────────
app.put('/api/events/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as Record<string, unknown>;
  const allowed = ['type', 'start_time', 'end_time', 'truck_id', 'load_id', 'trailer_id', 'driver_id', 'start_location_id', 'end_location_id', 'status'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const key of allowed) {
    if (key in body) { sets.push(`${key} = $${i++}`); vals.push(body[key]); }
  }
  if (sets.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });
  vals.push(id);
  const row = await queryOne(`UPDATE event SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
  if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Event not found' });
  return { id };
});

// ── Delete an event (and its motion if orphaned) ──────────────
app.delete('/api/events/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const row = await queryOne<{ motion_id: string | null }>(
    'DELETE FROM event WHERE id = $1 RETURNING motion_id', [id]
  );
  if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Event not found' });
  if (row.motion_id) {
    await query('DELETE FROM motion WHERE id = $1', [row.motion_id]).catch(() => {});
  }
  return { id };
});

// ═══════════════════════════════════════════════════════════════
// Detention endpoints
// ═══════════════════════════════════════════════════════════════

// ── Record a detention event (loading/unloading reached) ──────
app.post('/api/detention', async (request, reply) => {
  const { order_id, load_id, event_id, event_type, phone, location_id, truck_id, driver_id, trailer_id, detention_time } = request.body as {
    order_id: string; load_id: string; event_id?: string; event_type: string;
    phone: string; location_id: string; truck_id?: string; driver_id?: string; trailer_id?: string;
    detention_time: string;
  };

  if (!order_id || !load_id || !event_type || !phone || !location_id || !detention_time) {
    return reply.code(400).send({ error: 'BAD_REQUEST', message: 'order_id, load_id, event_type, phone, location_id, detention_time required' });
  }

  // Check if already logged for this event (avoid duplicates)
  if (event_id) {
    const existing = await queryOne('SELECT id FROM detention_log WHERE event_id = $1', [event_id]);
    if (existing) return { id: existing.id, duplicate: true };
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO detention_log (order_id, load_id, event_id, event_type, phone, location_id, truck_id, driver_id, trailer_id, detention_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [order_id, load_id, event_id ?? null, event_type, phone, location_id,
     truck_id ?? null, driver_id ?? null, trailer_id ?? null, detention_time]
  );

  await publishEvent(KafkaTopics.TRACKING_EVENTS, row!.id, { type: 'detention_logged', payload: { id: row!.id, event_type, phone, load_id } });

  return reply.code(201).send({ id: row!.id });
});

// ── List detention logs ──────────────────────────────────────
app.get('/api/detention', async (request) => {
  const { order_id, load_id } = request.query as { order_id?: string; load_id?: string };
  let sql = `SELECT d.*, l.number AS load_number FROM detention_log d JOIN load l ON d.load_id = l.id`;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (order_id) { params.push(order_id); conditions.push(`d.order_id = $${params.length}`); }
  if (load_id) { params.push(load_id); conditions.push(`d.load_id = $${params.length}`); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY d.detention_time DESC LIMIT 100';
  return query(sql, params);
});

// ═══════════════════════════════════════════════════════════════

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down...`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`📍 Tracking service running on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
