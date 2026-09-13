import { query, queryOne, pointToWKT, publishEvent, KafkaTopics, parseGeoLineString, type GeoPoint } from '@truckmafia/shared';
import { tickHOS } from './hos.js';

interface Simulation {
  haulId: string;
  truckId: string;
  driverId: string;
  positions: GeoPoint[];
  currentIndex: number;
  speedKmh: number;
  intervalId: NodeJS.Timeout;
  startTime: Date;
}

const activeSimulations = new Map<string, Simulation>();

// ── Start simulating a truck driving along its itinerary ────────

export async function startSimulation(haulId: string, speedKmh: number = 80): Promise<void> {
  // Stop existing simulation for this haul
  stopSimulation(haulId);

  // Get haul info + itinerary
  const haul = await queryOne<{ truck_id: string; driver_id: string }>(
    'SELECT truck_id, driver_id FROM haul WHERE id = $1',
    [haulId]
  );
  if (!haul) throw new Error('Haul not found');

  const itinerary = await queryOne<{ geometry: string }>(
    `SELECT ST_AsText(ST_MakeLine(
       (SELECT ST_MakeLine(array_agg(pt)) FROM (
         SELECT ST_PointN(rs.geometry, g.n) AS pt
         FROM road_segment_traversal rst
         JOIN road_segment rs ON rst.road_segment_id = rs.id
         CROSS JOIN generate_series(1, ST_NPoints(rs.geometry)) AS g(n)
         WHERE rst.haul_id = $1
         ORDER BY rst.sequence, g.n
       ) sub
     )) AS geometry`,
    [haulId]
  );

  // Fallback: get geometry from individual segments
  let positions: GeoPoint[] = [];
  if (itinerary?.geometry) {
    positions = parseGeoLineString(itinerary.geometry);
  }
  if (positions.length === 0) {
    const segs = await query<{ geometry: string }>(
      `SELECT ST_AsText(rs.geometry) AS geometry
       FROM road_segment_traversal rst
       JOIN road_segment rs ON rst.road_segment_id = rs.id
       WHERE rst.haul_id = $1
       ORDER BY rst.sequence`,
      [haulId]
    );
    for (const s of segs) {
      positions = [...positions, ...parseGeoLineString(s.geometry)];
    }
  }

  if (positions.length < 2) throw new Error('No route geometry available for simulation');

  // Update haul and truck status
  await query(`UPDATE haul SET status = 'in_progress' WHERE id = $1`, [haulId]);
  await query(`UPDATE truck SET status = 'on_move' WHERE id = $1`, [haul.truck_id]);

  const sim: Simulation = {
    haulId,
    truckId: haul.truck_id,
    driverId: haul.driver_id,
    positions,
    currentIndex: 0,
    speedKmh,
    intervalId: null as never,
    startTime: new Date(),
  };

  // Tick every 2 seconds (per README: publish current location update every 2s)
  sim.intervalId = setInterval(async () => {
    await tickSimulation(sim);
  }, 2000);

  activeSimulations.set(haulId, sim);
}

// ── Single simulation tick ───────────────────────────────────────

async function tickSimulation(sim: Simulation): Promise<void> {
  // Move along positions based on speed
  // 2s interval, speed in km/h -> distance per tick = speed * 1000 / 3600 * 2 meters
  const metersPerTick = (sim.speedKmh * 1000) / 3600 * 2;
  let remainingDistance = metersPerTick;

  while (remainingDistance > 0 && sim.currentIndex < sim.positions.length - 1) {
    const from = sim.positions[sim.currentIndex];
    const to = sim.positions[sim.currentIndex + 1];
    const segDistance = haversine(from, to);

    if (segDistance <= remainingDistance) {
      remainingDistance -= segDistance;
      sim.currentIndex++;
    } else {
      // Interpolate
      const ratio = remainingDistance / segDistance;
      const lat = from.lat + (to.lat - from.lat) * ratio;
      const lng = from.lng + (to.lng - from.lng) * ratio;

      // Publish position update
      await publishPosition(sim, lat, lng);
      sim.currentIndex++;
      remainingDistance = 0;
    }
  }

  // If we reached the end
  if (sim.currentIndex >= sim.positions.length - 1) {
    const finalPos = sim.positions[sim.positions.length - 1];
    await publishPosition(sim, finalPos.lat, finalPos.lng);
    stopSimulation(sim.haulId);
    await query(`UPDATE haul SET status = 'completed' WHERE id = $1`, [sim.haulId]);
    await query(`UPDATE truck SET status = 'at_hub' WHERE id = $1`, [sim.truckId]);
    return;
  }
}

async function publishPosition(sim: Simulation, lat: number, lng: number): Promise<void> {
  // Calculate heading
  const nextIdx = Math.min(sim.currentIndex + 1, sim.positions.length - 1);
  const heading = calculateBearing(lat, lng, sim.positions[nextIdx].lat, sim.positions[nextIdx].lng);

  // Store in DB
  await query(
    `INSERT INTO position_log (truck_id, driver_id, position, heading, speed_kmh, measured_at)
     VALUES ($1, $2, $3::geography, $4, $5, now())`,
    [sim.truckId, sim.driverId, pointToWKT(lat, lng), heading, sim.speedKmh]
  );

  // Publish to Kafka
  await publishEvent(KafkaTopics.TRACKING_EVENTS, sim.truckId, {
    type: 'position_update',
    payload: {
      truck_id: sim.truckId,
      lat,
      lng,
      heading,
      speed_kmh: sim.speedKmh,
      measured_at: new Date().toISOString(),
    },
  });

  // Tick HOS
  await tickHOS(sim.driverId, 2);
}

export function stopSimulation(haulId: string): void {
  const sim = activeSimulations.get(haulId);
  if (sim) {
    clearInterval(sim.intervalId);
    activeSimulations.delete(haulId);
  }
}

export function getActiveSimulations(): string[] {
  return Array.from(activeSimulations.keys());
}

// ── Helpers ─────────────────────────────────────────────────────

function haversine(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180);
  const x = Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
