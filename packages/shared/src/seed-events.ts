import { pool, query } from './db.js';

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

const routeCache = new Map<string, Pos[]>();

async function fetchRoute(start: Pos, end: Pos): Promise<Pos[]> {
  const cacheKey = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}→${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey)!;
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
  } catch { /* fallback to straight line */ }
  const fallback = [start, end];
  routeCache.set(cacheKey, fallback);
  return fallback;
}

async function createMotion(start: Pos, end: Pos, startTime: Date, speedKmh: number): Promise<{ motionId: string; endTime: Date }> {
  const path = await fetchRoute(start, end);
  const cumDist: number[] = [0];
  for (let i = 1; i < path.length; i++) cumDist.push(cumDist[i - 1] + haversineMeters(path[i - 1], path[i]));
  const totalDistM = cumDist[cumDist.length - 1];
  const speedMs = speedKmh * 1000 / 3600;
  const durationS = Math.max(totalDistM / speedMs, 10);
  const endTime = new Date(startTime.getTime() + durationS * 1000);

  const numWp = Math.min(Math.max(2, Math.floor(durationS)), 2000);
  const waypoints: Waypoint[] = [];
  for (let i = 0; i <= numWp; i++) {
    const fraction = i / numWp;
    const targetDist = totalDistM * fraction;
    let segIdx = 0;
    for (let j = 0; j < cumDist.length - 1; j++) { if (cumDist[j] <= targetDist && cumDist[j + 1] >= targetDist) { segIdx = j; break; } }
    const segFrac = cumDist[segIdx + 1] > cumDist[segIdx] ? (targetDist - cumDist[segIdx]) / (cumDist[segIdx + 1] - cumDist[segIdx]) : 0;
    const p1 = path[segIdx], p2 = path[segIdx + 1] || p1;
    waypoints.push({ t: new Date(startTime.getTime() + durationS * 1000 * fraction).toISOString(), lat: p1.lat + (p2.lat - p1.lat) * segFrac, lng: p1.lng + (p2.lng - p1.lng) * segFrac });
  }

  const wkt = `SRID=4326;LINESTRING(${path.map(p => `${p.lng} ${p.lat}`).join(', ')})`;
  const row = await query<{ id: string }>(
    `INSERT INTO motion (path, distance_m, duration_s, waypoints) VALUES (ST_GeomFromText($1, 4326), $2, $3, $4) RETURNING id`,
    [wkt, Math.round(totalDistM), Math.round(durationS), JSON.stringify(waypoints)]
  );
  return { motionId: row[0].id, endTime };
}

async function insertEvent(params: {
  truckId?: string; loadId?: string; trailerId?: string; driverId?: string;
  startLocationId: string; endLocationId: string;
  startTime: Date; endTime: Date; type: string; motionId?: string;
}): Promise<string> {
  const row = await query<{ id: string }>(
    `INSERT INTO event (truck_id, load_id, trailer_id, driver_id, start_location_id, end_location_id, start_time, end_time, type, motion_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [params.truckId ?? null, params.loadId ?? null, params.trailerId ?? null, params.driverId ?? null,
     params.startLocationId, params.endLocationId, params.startTime, params.endTime, params.type, params.motionId ?? null]
  );
  return row[0].id;
}

async function seedEvents() {
  console.log('🎬 Generating event data...\n');

  const trucks = await query<{ id: string; number: string; hub: string; location_id: string }>(
    `SELECT id, number, hub, location_id FROM truck ORDER BY number LIMIT 5`);
  const drivers = await query<{ id: string; name: string; home_location_id: string }>(
    `SELECT id, name, home_location_id FROM driver ORDER BY name LIMIT 5`);
  const trailers = await query<{ id: string; number: string; hub: string; location_id: string }>(
    `SELECT id, number, hub, location_id FROM trailer ORDER BY number LIMIT 5`);
  const loads = await query<{ id: string; number: string; pickup_location_id: string; dropoff_location_id: string }>(
    `SELECT id, number, pickup_location_id, dropoff_location_id FROM load ORDER BY number LIMIT 3`);

  const locations = await query<{ id: string; name: string; position: string }>(
    `SELECT id, name, ST_AsText(position) AS position FROM location`);
  const locMap = new Map(locations.map(l => [l.id, l]));
  function locPos(id: string): Pos | null {
    const loc = locMap.get(id); if (!loc) return null;
    const m = loc.position.match(/POINT\(([-\d.]+) ([-\d.]+)\)/); if (!m) return null;
    return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }

  if (trucks.length < 2 || drivers.length < 2 || trailers.length < 2 || loads.length < 1) {
    console.log('❌ Not enough data. Run db:seed first.'); await pool.end(); return;
  }

  console.log('🗑️  Clearing existing events and motion...');
  await query('DELETE FROM event');
  await query('DELETE FROM motion');
  console.log('   ✅ Cleared\n');

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAYS = 3;
  let eventCount = 0;

  for (let day = 0; day < DAYS; day++) {
    for (let i = 0; i < Math.min(loads.length, trucks.length, drivers.length, trailers.length); i++) {
      const truck = trucks[i], driver = drivers[i], trailer = trailers[i], load = loads[i % loads.length];
      const pickupPos = locPos(load.pickup_location_id), dropoffPos = locPos(load.dropoff_location_id);
      const hubPos = locPos(truck.location_id) || locPos(driver.home_location_id);
      const homePos = locPos(driver.home_location_id), trailerPos = locPos(trailer.location_id);
      if (!pickupPos || !dropoffPos || !hubPos || !homePos || !trailerPos) continue;

      const dayBase = new Date(dayStart.getTime() - (DAYS - 1 - day) * 86400000);
      let t = new Date(dayBase.getTime() + 6 * 3600 * 1000);
      const truckLocId = truck.location_id!, homeLocId = driver.home_location_id!, trailerLocId = trailer.location_id!;

      // 1. Bobtail: truck+driver hub→trailer
      console.log(`  Day ${day+1}/${DAYS} truck ${i+1}: bobtail...`);
      const bt = await createMotion(hubPos, trailerPos, t, 60);
      await insertEvent({ truckId: truck.id, driverId: driver.id, startLocationId: truckLocId, endLocationId: trailerLocId, startTime: t, endTime: bt.endTime, type: 'bobtail', motionId: bt.motionId });
      eventCount++; t = bt.endTime;

      // 2. Attach: truck+trailer at trailer location (15min)
      const attachEnd = new Date(t.getTime() + 15 * 60000);
      await insertEvent({ truckId: truck.id, trailerId: trailer.id, driverId: driver.id, startLocationId: trailerLocId, endLocationId: trailerLocId, startTime: t, endTime: attachEnd, type: 'attach' });
      eventCount++; t = attachEnd;

      // 3. Dead mile: truck+trailer+driver trailer→pickup
      console.log(`  Day ${day+1}/${DAYS} truck ${i+1}: deadmile...`);
      const dm = await createMotion(trailerPos, pickupPos, t, 80);
      await insertEvent({ truckId: truck.id, trailerId: trailer.id, driverId: driver.id, startLocationId: trailerLocId, endLocationId: load.pickup_location_id, startTime: t, endTime: dm.endTime, type: 'deadmile', motionId: dm.motionId });
      eventCount++; t = dm.endTime;

      // 4. Loading: trailer+load at pickup (1hr)
      const loadEnd = new Date(t.getTime() + 3600 * 1000);
      await insertEvent({ truckId: truck.id, trailerId: trailer.id, driverId: driver.id, loadId: load.id, startLocationId: load.pickup_location_id, endLocationId: load.pickup_location_id, startTime: t, endTime: loadEnd, type: 'loading' });
      eventCount++; t = loadEnd;

      // 5. Haul: truck+trailer+driver+load pickup→dropoff
      console.log(`  Day ${day+1}/${DAYS} truck ${i+1}: haul...`);
      const haul = await createMotion(pickupPos, dropoffPos, t, 90);
      await insertEvent({ truckId: truck.id, trailerId: trailer.id, driverId: driver.id, loadId: load.id, startLocationId: load.pickup_location_id, endLocationId: load.dropoff_location_id, startTime: t, endTime: haul.endTime, type: 'haul', motionId: haul.motionId });
      eventCount++; t = haul.endTime;

      // 6. Unloading: trailer+load at dropoff (1hr)
      const unloadEnd = new Date(t.getTime() + 3600 * 1000);
      await insertEvent({ truckId: truck.id, trailerId: trailer.id, driverId: driver.id, loadId: load.id, startLocationId: load.dropoff_location_id, endLocationId: load.dropoff_location_id, startTime: t, endTime: unloadEnd, type: 'unloading' });
      eventCount++; t = unloadEnd;

      // 7. Dead mile: truck+trailer+driver dropoff→home
      console.log(`  Day ${day+1}/${DAYS} truck ${i+1}: return...`);
      const ret = await createMotion(dropoffPos, homePos, t, 80);
      await insertEvent({ truckId: truck.id, trailerId: trailer.id, driverId: driver.id, startLocationId: load.dropoff_location_id, endLocationId: homeLocId, startTime: t, endTime: ret.endTime, type: 'deadmile', motionId: ret.motionId });
      eventCount++; t = ret.endTime;
    }
  }

  console.log('\n' + '═'.repeat(55));
  console.log(`  ✅ Generated ${eventCount} events over ${DAYS} days`);
  console.log('═'.repeat(55));
  await pool.end();
}

seedEvents().catch((err) => { console.error('\n❌ Failed:', err); pool.end(); process.exit(1); });
