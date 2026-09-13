import { query, type GeoPoint } from '@truckmafia/shared';

// ═══════════════════════════════════════════════════════════════
// Fast heuristic router — instant approximation using:
// 1. Haversine distance × detour factor (1.3 for roads)
// 2. Average speed based on highway types in the area
// 3. Road events check: if any event blocks the corridor, add detour time
// 4. Returns a simplified 2-point geometry (start → end)
// ═══════════════════════════════════════════════════════════════

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Average speed by road type (km/h)
const SPEED_BY_TYPE: Record<string, number> = {
  motorway: 100, trunk: 90, primary: 80, secondary: 70, tertiary: 60,
  unclassified: 50, residential: 40, service: 30, living_street: 25,
  motorway_link: 60, trunk_link: 50, primary_link: 50,
  secondary_link: 40, tertiary_link: 40, road: 50,
};

export interface FastRouteResult {
  geometry: GeoPoint[];
  total_distance_m: number;
  total_time_s: number;
  is_approximate: boolean;
}

// ── Get average speed for a corridor by sampling road segments ──
async function getCorridorSpeed(minLat: number, minLng: number, maxLat: number, maxLng: number): Promise<number> {
  const rows = await query<{ highway_type: string; total_length: string }>(
    `SELECT highway_type, SUM(length_m)::text AS total_length
     FROM road_segment
     WHERE geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     GROUP BY highway_type
     ORDER BY SUM(length_m) DESC
     LIMIT 5`,
    [minLng, minLat, maxLng, maxLat]
  );
  if (rows.length === 0) return 60; // default 60 km/h

  let weightedSpeed = 0;
  let totalLength = 0;
  for (const r of rows) {
    const len = parseInt(r.total_length);
    const speed = SPEED_BY_TYPE[r.highway_type] || 50;
    weightedSpeed += speed * len;
    totalLength += len;
  }
  return totalLength > 0 ? weightedSpeed / totalLength : 60;
}

// ── Check for road events that affect the corridor ──
async function getRoadEventPenalty(
  minLat: number, minLng: number, maxLat: number, maxLng: number,
  atTime: Date
): Promise<{ speedReduction: number; detourFactor: number; blockedCount: number }> {
  const rows = await query<{
    maxspeed_km: number | null; is_usable: boolean; road_segment_id: string | null;
  }>(
    `SELECT re.maxspeed_km, re.is_usable, re.road_segment_id
     FROM road_event re
     WHERE re.start_at <= $1 AND (re.end_at IS NULL OR re.end_at >= $1)
       AND re.road_segment_id IS NOT NULL
       AND re.road_segment_id IN (
         SELECT id FROM road_segment
         WHERE geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
       )
     UNION ALL
     SELECT re.maxspeed_km, re.is_usable, res.road_segment_id
     FROM road_event re
     JOIN road_event_segment res ON re.id = res.road_event_id
     WHERE re.start_at <= $1 AND (re.end_at IS NULL OR re.end_at >= $1)
       AND res.road_segment_id IN (
         SELECT id FROM road_segment
         WHERE geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
       )`,
    [atTime, minLng, minLat, maxLng, maxLat]
  );

  if (rows.length === 0) return { speedReduction: 0, detourFactor: 1, blockedCount: 0 };

  let blocked = 0;
  let speedPenalty = 0;
  for (const r of rows) {
    if (!r.is_usable) blocked++;
    if (r.maxspeed_km != null) speedPenalty += 1; // each speed-restriction event adds a bit of delay
  }

  // If roads are blocked, add a detour factor
  const detourFactor = blocked > 0 ? 1 + (blocked * 0.1) : 1;
  // Speed reduction: each event reduces average speed slightly
  const speedReduction = Math.min(speedPenalty * 0.05, 0.3); // max 30% reduction

  return { speedReduction, detourFactor, blockedCount: blocked };
}

// ── Main fast routing function ──
export async function fastRoute(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
  totalWeightKg: number,
  atTime: Date = new Date(),
  isLoaded: boolean = false
): Promise<FastRouteResult> {
  const straightDist = haversine(startLat, startLng, endLat, endLng);

  // Detour factor: roads are never straight — 1.3x is a good approximation
  const detourFactor = 1.3;
  const distance = straightDist * detourFactor;

  // Get average speed for the corridor
  const minLat = Math.min(startLat, endLat);
  const maxLat = Math.max(startLat, endLat);
  const minLng = Math.min(startLng, endLng);
  const maxLng = Math.max(startLng, endLng);

  let avgSpeed = await getCorridorSpeed(minLat, minLng, maxLat, maxLng);
  if (avgSpeed < 30) avgSpeed = 60; // no road data, use default

  // Apply loaded/empty speed factor
  const speedFactor = isLoaded ? 0.7 : 0.8;
  let effectiveSpeed = avgSpeed * speedFactor;

  // Check road events
  const penalty = await getRoadEventPenalty(minLat, minLng, maxLat, maxLng, atTime);
  effectiveSpeed *= (1 - penalty.speedReduction);

  // Apply detour factor from blocked roads
  const finalDistance = distance * penalty.detourFactor;

  // Time = distance / speed (convert km/h to m/s)
  const time = finalDistance / (effectiveSpeed * 1000 / 3600);

  return {
    geometry: [{ lat: startLat, lng: startLng }, { lat: endLat, lng: endLng }],
    total_distance_m: Math.round(finalDistance),
    total_time_s: Math.round(time),
    is_approximate: true,
  };
}
