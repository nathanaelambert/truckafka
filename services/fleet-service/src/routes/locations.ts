import type { FastifyInstance } from 'fastify';
import { query, queryOne, pointToWKT, polygonToWKT, parseGeoPoint, parseGeoPolygon, parseGeoLineString, publishEvent, KafkaTopics } from '@truckmafia/shared';

// ── Link a geofence to a road node ─────────────────────────
// 1. If a road node exists inside the geofence, link it
// 2. If not, find a road segment intersecting the geofence,
//    create a node at the intersection point, split the segment
async function linkGeofenceToNode(geofenceId: string, geofenceWkt: string): Promise<void> {
  // Check if any existing node is inside the geofence
  const existingNode = await queryOne<{ id: string }>(
    `SELECT id FROM road_node
     WHERE ST_Contains($1::geometry, location::geometry)
     AND geofence_id IS NULL
     ORDER BY random()
     LIMIT 1`,
    [geofenceWkt]
  );

  if (existingNode) {
    // Link the node to the geofence
    await query('UPDATE road_node SET geofence_id = $1 WHERE id = $2', [geofenceId, existingNode.id]);
    await query('UPDATE geofence SET node_id = $1 WHERE id = $2', [existingNode.id, geofenceId]);
    return;
  }

  // No node inside — find a road segment intersecting the geofence
  const intersectingSeg = await queryOne<{ id: string; geometry: string }>(
    `SELECT id, ST_AsText(geometry) AS geometry FROM road_segment
     WHERE ST_Intersects(geometry, $1::geometry)
     LIMIT 1`,
    [geofenceWkt]
  );

  if (!intersectingSeg) {
    // No road segment intersects — the geofence has no node
    // User will need to redraw near a road
    return;
  }

  // Find the intersection point (closest point on the segment to the geofence centroid)
  const centroid = await queryOne<{ pt: string }>(
    `SELECT ST_AsText(ST_Centroid($1::geometry)) AS pt`,
    [geofenceWkt]
  );
  if (!centroid) return;

  const centroidPt = parseGeoPoint(centroid.pt);
  if (!centroidPt) return;

  // Find the closest point on the segment geometry to the centroid
  const segGeometry = parseGeoLineString(intersectingSeg.geometry);
  if (segGeometry.length < 2) return;

  let bestPt = segGeometry[0];
  let bestDist = Infinity;
  for (let i = 0; i < segGeometry.length - 1; i++) {
    const a = segGeometry[i];
    const b = segGeometry[i + 1];
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const len = dx * dx + dy * dy;
    let t = 0;
    if (len > 0) {
      t = Math.max(0, Math.min(1, ((centroidPt.lng - a.lng) * dx + (centroidPt.lat - a.lat) * dy) / len));
    }
    const projLat = a.lat + t * dy;
    const projLng = a.lng + t * dx;
    const d = Math.sqrt((centroidPt.lat - projLat) ** 2 + (centroidPt.lng - projLng) ** 2);
    if (d < bestDist) {
      bestDist = d;
      bestPt = { lat: projLat, lng: projLng };
    }
  }

  // Create the new node at the projection point
  const newNode = await queryOne<{ id: string }>(
    `INSERT INTO road_node (location, geofence_id) VALUES ($1::geography, $2) RETURNING id`,
    [pointToWKT(bestPt.lat, bestPt.lng), geofenceId]
  );
  if (!newNode) return;

  await query('UPDATE geofence SET node_id = $1 WHERE id = $2', [newNode.id, geofenceId]);

  // Split the road segment into two at the new node
  const segId = intersectingSeg.id;
  const segGeo = parseGeoLineString(intersectingSeg.geometry);

  // Find the split index (which segment of the polyline the new node falls on)
  let splitIdx = 0;
  let minD = Infinity;
  for (let i = 0; i < segGeo.length - 1; i++) {
    const a = segGeo[i];
    const b = segGeo[i + 1];
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const len = dx * dx + dy * dy;
    let t = 0;
    if (len > 0) {
      t = Math.max(0, Math.min(1, ((bestPt.lng - a.lng) * dx + (bestPt.lat - a.lat) * dy) / len));
    }
    const projLat = a.lat + t * dy;
    const projLng = a.lng + t * dx;
    const d = Math.sqrt((bestPt.lat - projLat) ** 2 + (bestPt.lng - projLng) ** 2);
    if (d < minD) { minD = d; splitIdx = i; }
  }

  // Build two sub-geometries
  const part1 = [...segGeo.slice(0, splitIdx + 1), bestPt];
  const part2 = [bestPt, ...segGeo.slice(splitIdx + 1)];

  // Get the original segment's properties
  const origSeg = await queryOne<{ from_node: string; to_node: string; maxspeed_km: number; maxweight_kg: number; highway_type: string; osm_way_id: string | null; name: string | null; oneway: boolean }>(
    'SELECT from_node, to_node, maxspeed_km, maxweight_kg, highway_type, osm_way_id::text, name, oneway FROM road_segment WHERE id = $1',
    [segId]
  );
  if (!origSeg) return;

  // Create two new segments
  const geo1Wkt = `SRID=4326;LINESTRING(${part1.map(p => `${p.lng} ${p.lat}`).join(', ')})`;
  const geo2Wkt = `SRID=4326;LINESTRING(${part2.map(p => `${p.lng} ${p.lat}`).join(', ')})`;

  await queryOne(
    `INSERT INTO road_segment (geometry, maxspeed_km, maxweight_kg, length_m, highway_type, from_node, to_node, osm_way_id, name, oneway)
     VALUES ($1::geometry, $2, $3, ST_Length($1::geography)::integer, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [geo1Wkt, origSeg.maxspeed_km, origSeg.maxweight_kg, origSeg.highway_type, origSeg.from_node, newNode.id, origSeg.osm_way_id, origSeg.name, origSeg.oneway]
  );

  await queryOne(
    `INSERT INTO road_segment (geometry, maxspeed_km, maxweight_kg, length_m, highway_type, from_node, to_node, osm_way_id, name, oneway)
     VALUES ($1::geometry, $2, $3, ST_Length($1::geography)::integer, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [geo2Wkt, origSeg.maxspeed_km, origSeg.maxweight_kg, origSeg.highway_type, newNode.id, origSeg.to_node, origSeg.osm_way_id, origSeg.name, origSeg.oneway]
  );

  // Delete the original segment
  await query('DELETE FROM road_segment WHERE id = $1', [segId]);
}

export async function locationRoutes(app: FastifyInstance) {
  // ── List all locations ──────────────────────────────────────
  app.get('/', async (request) => {
    const { hub } = request.query as { hub?: string };
    let sql = `SELECT l.id, l.name, l.address, l.is_hub, l.geofence_id, l.created_at,
          ST_AsText(l.position) AS position,
          g.name AS geofence_name, ST_AsText(g.boundary) AS geofence_boundary
       FROM location l LEFT JOIN geofence g ON l.geofence_id = g.id`;
    const params: unknown[] = [];
    if (hub === 'true') {
      sql += ' WHERE l.is_hub = true';
    }
    sql += ' ORDER BY l.name';
    const rows = await query(sql, params);
    return rows.map((l) => ({
      ...l,
      position: parseGeoPoint(l.position),
      geofence_boundary: l.geofence_boundary ? parseGeoPolygon(l.geofence_boundary) : null,
    }));
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const l = await queryOne(
      `SELECT l.id, l.name, l.address, l.is_hub, l.geofence_id, l.created_at,
         ST_AsText(l.position) AS position,
         g.name AS geofence_name, ST_AsText(g.boundary) AS geofence_boundary
       FROM location l LEFT JOIN geofence g ON l.geofence_id = g.id WHERE l.id = $1`,
      [id]
    );
    if (!l) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Location not found' });
    return { ...l, position: parseGeoPoint(l.position), geofence_boundary: l.geofence_boundary ? parseGeoPolygon(l.geofence_boundary) : null };
  });

  // ── Create location (optionally with geofence) ──────────────
  app.post('/', async (request, reply) => {
    const { name, position, address, geofence, is_hub } = request.body as {
      name: string;
      position: { lat: number; lng: number };
      address?: string;
      geofence?: { name?: string; boundary: { lat: number; lng: number }[] };
      is_hub?: boolean;
    };

    if (!name || !position) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'name and position required' });

    let geofenceId: string | null = null;
    if (geofence && geofence.boundary.length >= 3) {
      const gfWkt = polygonToWKT(geofence.boundary);
      const gf = await queryOne<{ id: string }>(
        `INSERT INTO geofence (name, boundary) VALUES ($1, $2::geography) RETURNING id`,
        [geofence.name || `${name} geofence`, gfWkt]
      );
      geofenceId = gf?.id ?? null;

      // Link geofence to a road node
      if (geofenceId) {
        await linkGeofenceToNode(geofenceId, gfWkt);
      }
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO location (name, position, geofence_id, address, is_hub)
       VALUES ($1, $2::geography, $3, $4, $5) RETURNING id`,
      [name, pointToWKT(position.lat, position.lng), geofenceId, address ?? null, is_hub ?? false]
    );
    await publishEvent(KafkaTopics.FLEET_EVENTS, row!.id, { type: 'location_created', payload: { id: row!.id } });
    return reply.code(201).send({ id: row!.id });
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, position, address, geofence, is_hub } = request.body as {
      name?: string;
      position?: { lat: number; lng: number };
      address?: string;
      geofence?: { name?: string; boundary: { lat: number; lng: number }[] };
      is_hub?: boolean;
    };

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (name) { sets.push(`name = $${i++}`); vals.push(name); }
    if (position) { sets.push(`position = $${i++}::geography`); vals.push(pointToWKT(position.lat, position.lng)); }
    if (address !== undefined) { sets.push(`address = $${i++}`); vals.push(address); }
    if (is_hub !== undefined) { sets.push(`is_hub = $${i++}`); vals.push(is_hub); }

    // Handle geofence update/create
    if (geofence && geofence.boundary.length >= 3) {
      // Check if location already has a geofence
      const existing = await queryOne<{ geofence_id: string | null }>(
        'SELECT geofence_id FROM location WHERE id = $1', [id]
      );
      if (existing?.geofence_id) {
        // Update existing geofence
        const gfWkt = polygonToWKT(geofence.boundary);
        await query(
          'UPDATE geofence SET boundary = $1::geography, name = $2 WHERE id = $3',
          [gfWkt, geofence.name || 'geofence', existing.geofence_id]
        );
        // Re-link node
        await linkGeofenceToNode(existing.geofence_id, gfWkt);
      } else {
        // Create new geofence and link it
        const gfWkt = polygonToWKT(geofence.boundary);
        const gf = await queryOne<{ id: string }>(
          `INSERT INTO geofence (name, boundary) VALUES ($1, $2::geography) RETURNING id`,
          [geofence.name || 'geofence', gfWkt]
        );
        if (gf) {
          sets.push(`geofence_id = $${i++}`);
          vals.push(gf.id);
          await linkGeofenceToNode(gf.id, gfWkt);
        }
      }
    }

    if (sets.length === 0) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'No fields to update' });
    vals.push(id);
    const row = await queryOne(`UPDATE location SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Location not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'location_updated', payload: { id } });
    return { id };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await queryOne('DELETE FROM location WHERE id = $1 RETURNING id', [id]);
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Location not found' });
    await publishEvent(KafkaTopics.FLEET_EVENTS, id, { type: 'location_deleted', payload: { id } });
    return { id };
  });

  // ── Geofence endpoints ──────────────────────────────────────
  app.post('/:id/geofence', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, boundary } = request.body as { name?: string; boundary: { lat: number; lng: number }[] };
    if (!boundary || boundary.length < 3) return reply.code(400).send({ error: 'BAD_REQUEST', message: 'boundary with 3+ points required' });

    const gf = await queryOne<{ id: string }>(
      `INSERT INTO geofence (name, boundary) VALUES ($1, $2::geography) RETURNING id`,
      [name || 'geofence', polygonToWKT(boundary)]
    );
    await query('UPDATE location SET geofence_id = $1 WHERE id = $2', [gf!.id, id]);
    return reply.code(201).send({ geofence_id: gf!.id });
  });
}
