import type { FastifyInstance } from 'fastify';
import { query, queryOne, parseGeoLineString, parseGeoPoint } from '@truckmafia/shared';
import { computeItinerary, findRoute, estimatedTime, invalidateGraphCache, getCacheStatus, type RouteProfile } from '../routing/astar.js';
import { fastRoute } from '../routing/fast-route.js';
import type { GeoPoint } from '@truckmafia/shared';

const DEFAULT_TOTAL_WEIGHT_KG = 12000; // truck empty (8000) + trailer empty (4000)

function lineStringWKT(points: GeoPoint[]): string {
  const coords = points.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `SRID=4326;LINESTRING(${coords})`;
}

export async function itineraryRoutes(app: FastifyInstance) {
  // ── Get itinerary for a haul ────────────────────────────────
  app.get('/:haulId', async (request, reply) => {
    const { haulId } = request.params as { haulId: string };

    const rows = await query<{
      sequence: number; road_segment_id: string;
      geometry: string; length_m: number; maxspeed_km: number; highway_type: string; name: string;
    }>(
      `SELECT rst.sequence, rst.road_segment_id,
              ST_AsText(rs.geometry) AS geometry, rs.length_m, rs.maxspeed_km, rs.highway_type, rs.name
       FROM road_segment_traversal rst
       JOIN road_segment rs ON rst.road_segment_id = rs.id
       WHERE rst.haul_id = $1
       ORDER BY rst.sequence`,
      [haulId]
    );

    if (rows.length === 0) {
      const route = await computeItinerary(haulId).catch(() => null);
      if (!route || route.segments.length === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'No itinerary found for haul' });
      }
      return {
        haul_id: haulId,
        segments: route.segments.map((s, i) => ({
          road_segment_id: s.segmentId,
          sequence: i + 1,
          geometry: s.geometry,
          length_m: s.length_m,
          maxspeed_km: s.maxspeed_km,
          estimated_time_s: s.estimated_time_s,
        })),
        total_distance_m: route.totalDistance_m,
        total_time_s: route.totalTime_s,
        geometry: route.geometry,
      };
    }

    const segments = rows.map((r) => {
      const estimated_time_s = estimatedTime(r.length_m, r.maxspeed_km);
      return {
        road_segment_id: r.road_segment_id,
        sequence: r.sequence,
        geometry: parseGeoLineString(r.geometry),
        length_m: r.length_m,
        maxspeed_km: r.maxspeed_km,
        estimated_time_s,
        highway_type: r.highway_type,
        name: r.name,
      };
    });

    const totalDistance_m = segments.reduce((sum, s) => sum + s.length_m, 0);
    const totalTime_s = segments.reduce((sum, s) => sum + s.estimated_time_s, 0);
    const geometry = segments.flatMap((s) => s.geometry);
    const deduped = geometry.filter((pt, i) =>
      i === 0 || geometry[i - 1].lat !== pt.lat || geometry[i - 1].lng !== pt.lng
    );

    return {
      haul_id: haulId,
      segments,
      total_distance_m: totalDistance_m,
      total_time_s: totalTime_s,
      geometry: deduped,
    };
  });

  // ── Recompute itinerary ─────────────────────────────────────
  app.post('/:haulId/recompute', async (request, reply) => {
    const { haulId } = request.params as { haulId: string };
    const route = await computeItinerary(haulId).catch(() => null);
    if (!route) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Could not compute itinerary' });
    return { haul_id: haulId, segment_count: route.segments.length, total_distance_m: route.totalDistance_m, total_time_s: route.totalTime_s };
  });

  // ── Get or compute itinerary for a load (stored in itinerary table) ──
  app.get('/load/:loadId', async (request, reply) => {
    const { loadId } = request.params as { loadId: string };

    // Try fetching stored itinerary first
    const stored = await queryOne<{
      path: string; total_distance_m: number; total_time_s: number;
      progress_lat: number | null; progress_lng: number | null; progress_time_s: number;
    }>(
      `SELECT ST_AsText(path) AS path, total_distance_m, total_time_s,
              progress_lat, progress_lng, progress_time_s
       FROM itinerary WHERE load_id = $1`,
      [loadId]
    );

    if (stored) {
      const geometry = parseGeoLineString(stored.path);
      if (geometry.length >= 2) {
        const progress = stored.progress_lat != null && stored.progress_lng != null
          ? { lat: stored.progress_lat, lng: stored.progress_lng }
          : null;
        return {
          load_id: loadId,
          geometry,
          total_distance_m: stored.total_distance_m,
          total_time_s: stored.total_time_s,
          progress,
          progress_time_s: stored.progress_time_s,
        };
      }
    }

    // Compute and store
    const load = await queryOne<{
      pickup_lat: number; pickup_lng: number;
      dropoff_lat: number; dropoff_lng: number; weight: number;
    }>(
      `SELECT
              ST_Y(lp.position::geometry) AS pickup_lat, ST_X(lp.position::geometry) AS pickup_lng,
              ST_Y(ld.position::geometry) AS dropoff_lat, ST_X(ld.position::geometry) AS dropoff_lng,
              l.weight
       FROM load l
       JOIN location lp ON l.pickup_location_id = lp.id
       JOIN location ld ON l.dropoff_location_id = ld.id
       WHERE l.id = $1`,
      [loadId]
    );

    if (!load) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Load not found' });

    const totalWeight = (load.weight || 0) + DEFAULT_TOTAL_WEIGHT_KG;
    const route = await findRoute(
      load.pickup_lat, load.pickup_lng,
      load.dropoff_lat, load.dropoff_lng,
      totalWeight,
      new Date()
    ).catch(() => null);

    if (!route || route.geometry.length < 2) {
      return reply.code(404).send({ error: 'NO_ROUTE', message: 'Could not compute a route for this load' });
    }

    // Store in itinerary table
    const wkt = lineStringWKT(route.geometry);
    await query(
      `INSERT INTO itinerary (load_id, path, total_distance_m, total_time_s, progress_time_s)
       VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, 0)
       ON CONFLICT (load_id) DO UPDATE SET
         path = EXCLUDED.path,
         total_distance_m = EXCLUDED.total_distance_m,
         total_time_s = EXCLUDED.total_time_s,
         updated_at = now()`,
      [loadId, wkt, Math.round(route.totalDistance_m), Math.round(route.totalTime_s)]
    );

    return {
      load_id: loadId,
      geometry: route.geometry,
      total_distance_m: route.totalDistance_m,
      total_time_s: route.totalTime_s,
      progress: null,
      progress_time_s: 0,
    };
  });

  // ── Update itinerary progress ──────────────────────────────
  app.put('/load/:loadId/progress', async (request, reply) => {
    const { loadId } = request.params as { loadId: string };
    const { lat, lng, progress_time_s } = request.body as { lat: number; lng: number; progress_time_s: number };

    await query(
      `UPDATE itinerary SET progress_lat = $2, progress_lng = $3, progress_time_s = $4
       WHERE load_id = $1`,
      [loadId, lat, lng, progress_time_s]
    );

    return { load_id: loadId, ok: true };
  });

  // ── Compute a route between two coordinates (for trajectory generation) ──
  app.get('/route', async (request, reply) => {
    const { startLat, startLng, endLat, endLng, weight, startAt, isLoaded, profile: profileFlag } = request.query as {
      startLat: string; startLng: string; endLat: string; endLng: string;
      weight?: string; startAt?: string; isLoaded?: string; profile?: string;
    };

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    if (isNaN(sLat) || isNaN(sLng) || isNaN(eLat) || isNaN(eLng)) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Invalid coordinates' });
    }

    const totalWeight = weight ? parseFloat(weight) : 12000;
    const atTime = startAt ? new Date(startAt) : new Date();
    const loaded = isLoaded === 'true';
    const wantProfile = profileFlag === 'true';

    // 1. Instant: compute fast heuristic route
    const fast = await fastRoute(sLat, sLng, eLat, eLng, totalWeight, atTime, loaded);

    // 2. Try full A* with a short 5s timeout — if it succeeds, use the real path
    let routeProfile: RouteProfile | null = null;
    const route = await Promise.race([
      findRoute(sLat, sLng, eLat, eLng, totalWeight, atTime, loaded, wantProfile ? (p) => { routeProfile = p; } : undefined).catch(() => null),
      new Promise<null>(r => setTimeout(() => r(null), 5000)),
    ]);

    if (route && route.geometry.length >= 2) {
      const response: Record<string, unknown> = {
        geometry: route.geometry,
        total_distance_m: route.totalDistance_m,
        total_time_s: route.totalTime_s,
        is_approximate: false,
      };
      if (wantProfile && routeProfile) {
        response.profile = routeProfile;
      }
      return response;
    }

    // 3. Fall back to fast heuristic result
    const response: Record<string, unknown> = {
      geometry: fast.geometry,
      total_distance_m: fast.total_distance_m,
      total_time_s: fast.total_time_s,
      is_approximate: true,
    };
    if (wantProfile) {
      response.profile = routeProfile;
    }
    return response;
  });

  // ── Cache management (for benchmarking) ──────────────────────
  app.post('/cache/invalidate', async () => {
    invalidateGraphCache();
    return { ok: true, ...getCacheStatus() };
  });

  app.get('/cache/status', async () => {
    return getCacheStatus();
  });
}
