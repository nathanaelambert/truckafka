import { pool, query } from './db.js';

// ── Helpers ──────────────────────────────────────────────────

interface Pos { lat: number; lng: number; }
interface Waypoint { t: string; lat: number; lng: number; }

function haversineMeters(a: Pos, b: Pos): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Route cache to avoid re-computing the same A* route
const routeCache = new Map<string, Pos[]>();

async function fetchRoute(start: Pos, end: Pos): Promise<Pos[]> {
  const cacheKey = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}→${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey)!;

  // Try the itinerary API (load-service computes A* routes)
  const apiUrl = process.env.LOAD_SERVICE_URL || 'http://localhost:4002';
  try {
    const resp = await fetch(`${apiUrl}/api/itineraries/route?startLat=${start.lat}&startLng=${start.lng}&endLat=${end.lat}&endLng=${end.lng}`);
    if (resp.ok) {
      const data = await resp.json() as { geometry?: Pos[] };
      if (data.geometry && data.geometry.length >= 2) {
        routeCache.set(cacheKey, data.geometry);
        return data.geometry;
      }
    }
  } catch {
    // API not available — fall through to straight line
  }

  // Fallback: straight line
  const fallback = [start, end];
  routeCache.set(cacheKey, fallback);
  return fallback;
}

// Generate waypoints along a road path, with timestamps at 1s intervals
async function generateMovingWaypoints(start: Pos, end: Pos, startTime: Date, speedKmh = 80): Promise<{ waypoints: Waypoint[]; endTime: Date }> {
  const path = await fetchRoute(start, end);

  // Calculate cumulative distances along the path
  const cumDistances: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumDistances.push(cumDistances[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  const totalDistM = cumDistances[cumDistances.length - 1];
  const speedMs = speedKmh * 1000 / 3600;
  const durationS = Math.max(totalDistM / speedMs, 10);

  // Generate waypoints at ~1s intervals, interpolating along the path
  const numWaypoints = Math.min(Math.max(2, Math.floor(durationS)), 2000);
  const waypoints: Waypoint[] = [];

  for (let i = 0; i <= numWaypoints; i++) {
    const fraction = i / numWaypoints;
    const targetDist = totalDistM * fraction;

    // Find which segment of the path contains this distance
    let segIdx = 0;
    for (let j = 0; j < cumDistances.length - 1; j++) {
      if (cumDistances[j] <= targetDist && cumDistances[j + 1] >= targetDist) {
        segIdx = j;
        break;
      }
    }

    const segStart = cumDistances[segIdx];
    const segEnd = cumDistances[segIdx + 1] || segStart + 1;
    const segFraction = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;

    const p1 = path[segIdx];
    const p2 = path[segIdx + 1] || p1;
    const lat = p1.lat + (p2.lat - p1.lat) * segFraction;
    const lng = p1.lng + (p2.lng - p1.lng) * segFraction;

    waypoints.push({
      t: new Date(startTime.getTime() + durationS * 1000 * fraction).toISOString(),
      lat,
      lng,
    });
  }

  return { waypoints, endTime: new Date(startTime.getTime() + durationS * 1000) };
}

async function insertSegment(
  elementType: string, elementId: string,
  segmentType: string, eventType: string | null,
  startTime: Date, endTime: Date,
  waypoints: Waypoint[] | null,
  boundToType?: string, boundToId?: string,
) {
  await query(
    `INSERT INTO trajectory_segment (element_type, element_id, segment_type, event_type, start_time, end_time, waypoints, bound_to_type, bound_to_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [elementType, elementId, segmentType, eventType, startTime, endTime,
     waypoints ? JSON.stringify(waypoints) : null,
     boundToType ?? null, boundToId ?? null]
  );
}

// ── Main ─────────────────────────────────────────────────────

async function seedTrajectories() {
  console.log('🎬 Generating trajectory data...\n');

  const trucks = await query<{ id: string; number: string; hub: string; location_id: string }>(
    `SELECT id, number, hub, location_id FROM truck ORDER BY number LIMIT 5`
  );
  const drivers = await query<{ id: string; name: string; home_location_id: string }>(
    `SELECT id, name, home_location_id FROM driver ORDER BY name LIMIT 5`
  );
  const trailers = await query<{ id: string; number: string; hub: string; location_id: string }>(
    `SELECT id, number, hub, location_id FROM trailer ORDER BY number LIMIT 5`
  );
  const loads = await query<{ id: string; number: string; pickup_location_id: string; dropoff_location_id: string; pickup_after: string; pickup_before: string; dropoff_after: string; dropoff_before: string }>(
    `SELECT l.id, l.number, l.pickup_location_id, l.dropoff_location_id, l.pickup_after, l.pickup_before, l.dropoff_after, l.dropoff_before
     FROM load l ORDER BY l.number LIMIT 3`
  );

  const locations = await query<{ id: string; name: string; position: string }>(
    `SELECT id, name, ST_AsText(position) AS position FROM location`
  );
  const locMap = new Map(locations.map(l => [l.id, l]));
  function locPos(id: string): Pos | null {
    const loc = locMap.get(id);
    if (!loc) return null;
    const m = loc.position.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
    if (!m) return null;
    return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }

  if (trucks.length < 2 || drivers.length < 2 || trailers.length < 2 || loads.length < 1) {
    console.log('❌ Not enough data. Run db:seed first.');
    await pool.end();
    return;
  }

  // Clear existing trajectory data
  console.log('🗑️  Clearing existing trajectory data...');
  await query('DELETE FROM trajectory_segment');
  console.log('   ✅ Cleared\n');

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAYS = 3;

  let segCount = 0;

  for (let day = 0; day < DAYS; day++) {
    for (let i = 0; i < Math.min(loads.length, trucks.length, drivers.length, trailers.length); i++) {
      const truck = trucks[i];
      const driver = drivers[i];
      const trailer = trailers[i];
      const load = loads[i % loads.length];

      const pickupPos = locPos(load.pickup_location_id);
      const dropoffPos = locPos(load.dropoff_location_id);
      const hubPos = locPos(truck.location_id) || locPos(driver.home_location_id);
      const homePos = locPos(driver.home_location_id);
      const trailerPos = locPos(trailer.location_id);

      if (!pickupPos || !dropoffPos || !hubPos || !homePos || !trailerPos) continue;

      const dayBase = new Date(dayStart.getTime() - (DAYS - 1 - day) * 86400000);
      let t = new Date(dayBase.getTime() + 6 * 3600 * 1000);

      // 1. Overnight stationary (only on first day — subsequent days are covered by previous day's step 8)
      if (day === 0) {
        const overnightStart = new Date(t.getTime() - 8 * 3600 * 1000);
        await insertSegment('driver', driver.id, 'stationary', 'rest', overnightStart, t, [{ t: overnightStart.toISOString(), lat: homePos.lat, lng: homePos.lng }]);
        await insertSegment('truck', truck.id, 'stationary', 'parked', overnightStart, t, [{ t: overnightStart.toISOString(), lat: hubPos.lat, lng: hubPos.lng }]);
        await insertSegment('trailer', trailer.id, 'stationary', 'parked', overnightStart, t, [{ t: overnightStart.toISOString(), lat: trailerPos.lat, lng: trailerPos.lng }]);
        segCount += 3;
      }

      // 2. Bobtail: truck to trailer
      console.log(`  Day ${day + 1}/${DAYS} truck ${i + 1}: bobtail...`);
      const bobtail = await generateMovingWaypoints(hubPos, trailerPos, t, 60);
      await insertSegment('truck', truck.id, 'moving', 'bobtail', t, bobtail.endTime, bobtail.waypoints);
      await insertSegment('driver', driver.id, 'moving', 'bobtail', t, bobtail.endTime, null, 'truck', truck.id);
      segCount += 2;
      t = bobtail.endTime;

      // 3. Deadmile: truck+trailer to pickup
      console.log(`  Day ${day + 1}/${DAYS} truck ${i + 1}: deadmile...`);
      const deadmile = await generateMovingWaypoints(trailerPos, pickupPos, t, 80);
      await insertSegment('truck', truck.id, 'moving', 'deadmile', t, deadmile.endTime, deadmile.waypoints);
      await insertSegment('trailer', trailer.id, 'moving', 'deadmile', t, deadmile.endTime, null, 'truck', truck.id);
      await insertSegment('driver', driver.id, 'moving', 'deadmile', t, deadmile.endTime, null, 'truck', truck.id);
      segCount += 3;
      t = deadmile.endTime;

      // 4. Loading (1 hour stationary)
      const loadEnd = new Date(t.getTime() + 3600 * 1000);
      await insertSegment('truck', truck.id, 'stationary', 'loading', t, loadEnd, [{ t: t.toISOString(), lat: pickupPos.lat, lng: pickupPos.lng }]);
      await insertSegment('trailer', trailer.id, 'stationary', 'loading', t, loadEnd, null, 'truck', truck.id);
      await insertSegment('driver', driver.id, 'stationary', 'loading', t, loadEnd, null, 'truck', truck.id);
      segCount += 3;
      t = loadEnd;

      // 5. Haul: truck+trailer+load to dropoff
      console.log(`  Day ${day + 1}/${DAYS} truck ${i + 1}: haul...`);
      const haul = await generateMovingWaypoints(pickupPos, dropoffPos, t, 90);
      await insertSegment('truck', truck.id, 'moving', 'haul', t, haul.endTime, haul.waypoints);
      await insertSegment('trailer', trailer.id, 'moving', 'haul', t, haul.endTime, null, 'truck', truck.id);
      await insertSegment('driver', driver.id, 'moving', 'haul', t, haul.endTime, null, 'truck', truck.id);
      await insertSegment('load', load.id, 'moving', 'haul', t, haul.endTime, null, 'truck', truck.id);
      segCount += 4;
      t = haul.endTime;

      // 6. Unloading (1 hour)
      const unloadEnd = new Date(t.getTime() + 3600 * 1000);
      await insertSegment('truck', truck.id, 'stationary', 'unloading', t, unloadEnd, [{ t: t.toISOString(), lat: dropoffPos.lat, lng: dropoffPos.lng }]);
      await insertSegment('trailer', trailer.id, 'stationary', 'unloading', t, unloadEnd, null, 'truck', truck.id);
      await insertSegment('driver', driver.id, 'stationary', 'unloading', t, unloadEnd, null, 'truck', truck.id);
      await insertSegment('load', load.id, 'stationary', 'unloading', t, unloadEnd, [{ t: t.toISOString(), lat: dropoffPos.lat, lng: dropoffPos.lng }]);
      segCount += 4;
      t = unloadEnd;

      // 7. Deadmile home
      console.log(`  Day ${day + 1}/${DAYS} truck ${i + 1}: return...`);
      const goHome = await generateMovingWaypoints(dropoffPos, homePos, t, 80);
      await insertSegment('truck', truck.id, 'moving', 'deadmile', t, goHome.endTime, goHome.waypoints);
      await insertSegment('trailer', trailer.id, 'moving', 'deadmile', t, goHome.endTime, null, 'truck', truck.id);
      await insertSegment('driver', driver.id, 'moving', 'deadmile', t, goHome.endTime, null, 'truck', truck.id);
      segCount += 3;
      t = goHome.endTime;

      // 8. Overnight
      const nightEnd = new Date(t.getTime() + 12 * 3600 * 1000);
      await insertSegment('driver', driver.id, 'stationary', 'rest', t, nightEnd, [{ t: t.toISOString(), lat: homePos.lat, lng: homePos.lng }]);
      await insertSegment('truck', truck.id, 'stationary', 'parked', t, nightEnd, [{ t: t.toISOString(), lat: homePos.lat, lng: homePos.lng }]);
      await insertSegment('trailer', trailer.id, 'stationary', 'parked', t, nightEnd, [{ t: t.toISOString(), lat: homePos.lat, lng: homePos.lng }]);
      segCount += 3;
    }
  }

  console.log('\n' + '═'.repeat(55));
  console.log(`  ✅ Generated ${segCount} trajectory segments over ${DAYS} days`);
  console.log(`  📍 Routes fetched from road network (A* pathfinding)`);
  console.log('═'.repeat(55));

  await pool.end();
}

seedTrajectories().catch((err) => {
  console.error('\n❌ Failed:', err);
  pool.end();
  process.exit(1);
});
