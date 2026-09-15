import pg from 'pg';
import type { RouteProfile } from './types.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://truckmafia:truckmafia_dev@localhost:5432/truckmafia';
const LOAD_SERVICE_URL = process.env.LOAD_SERVICE_URL || 'http://127.0.0.1:4002';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

async function makeRouteRequest(
  startLat: number, startLng: number, endLat: number, endLng: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${LOAD_SERVICE_URL}/api/itineraries/route?startLat=${startLat}&startLng=${startLng}&endLat=${endLat}&endLng=${endLng}&weight=12000&isLoaded=true&profile=true`;
  const resp = await fetch(url);
  const body = await resp.json() as Record<string, unknown>;
  return { status: resp.status, body };
}

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('Instrumentation Tests');
  console.log('══════════════════════════════════════════════════════════════\n');

  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

  // Fetch a valid coordinate pair from the DB
  const { rows } = await pool.query<{ lat: string; lng: string }>(`
    SELECT ST_Y(location::geometry)::text AS lat, ST_X(location::geometry)::text AS lng
    FROM road_node
    WHERE id IN (SELECT from_node FROM road_segment WHERE from_node IS NOT NULL)
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(-79.38, 43.65), 4326)::geography
    LIMIT 2
  `);
  if (rows.length < 2) {
    console.error('Not enough road nodes in DB for testing');
    process.exit(1);
  }
  const sLat = parseFloat(rows[0].lat);
  const sLng = parseFloat(rows[0].lng);
  const eLat = parseFloat(rows[1].lat);
  const eLng = parseFloat(rows[1].lng);

  // ── Test 1: Profile data is returned when ?profile=true ──
  console.log('Test 1: Profile data in response when ?profile=true');
  await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/invalidate`, { method: 'POST' });
  const { body: body1 } = await makeRouteRequest(sLat, sLng, eLat, eLng);
  const profile1 = body1.profile as RouteProfile | undefined;
  assert(body1.is_approximate !== undefined, 'Response has is_approximate field');
  assert(profile1 !== undefined && profile1 !== null, 'Profile is present in response');
  if (profile1) {
    assert(profile1.totalMs > 0, `Profile totalMs > 0 (got ${profile1.totalMs}ms)`);
    assert(profile1.dbQueries > 0, `Profile dbQueries > 0 (got ${profile1.dbQueries})`);
    assert(profile1.graphNodes > 0, `Profile graphNodes > 0 (got ${profile1.graphNodes})`);
    assert(profile1.graphEdges > 0, `Profile graphEdges > 0 (got ${profile1.graphEdges})`);
    assert(profile1.cacheHit === false, 'First request after invalidate is cache miss');
    assert(profile1.nodeExpansions >= 0, 'Profile nodeExpansions >= 0');
    assert(profile1.edgesEvaluated >= 0, 'Profile edgesEvaluated >= 0');
  }

  // ── Test 2: Cache hit on second request ──
  console.log('\nTest 2: Cache hit on second request');
  const { body: body2 } = await makeRouteRequest(sLat, sLng, eLat, eLng);
  const profile2 = body2.profile as RouteProfile | undefined;
  if (profile2) {
    assert(profile2.cacheHit === true, 'Second request is cache hit');
    assert(profile2.buildGraphMs <= 1, `buildGraphMs is ~0 on cache hit (got ${profile2.buildGraphMs}ms)`);
    assert(profile2.dbQueries < profile1!.dbQueries, `Fewer DB queries on cache hit (${profile2.dbQueries} < ${profile1!.dbQueries})`);
  } else {
    assert(false, 'Profile should be present on cache hit');
  }

  // ── Test 3: Cache invalidation endpoint ──
  console.log('\nTest 3: Cache invalidation endpoint');
  const statusBefore = await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/status`).then(r => r.json()) as { valid: boolean };
  assert(statusBefore.valid === true, 'Cache is valid before invalidation');
  await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/invalidate`, { method: 'POST' });
  const statusAfter = await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/status`).then(r => r.json()) as { valid: boolean };
  assert(statusAfter.valid === false, 'Cache is invalid after invalidation');

  // ── Test 4: Concurrent requests get distinct profiles ──
  console.log('\nTest 4: Concurrent requests get distinct profiles');
  await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/invalidate`, { method: 'POST' });
  const concurrentResults = await Promise.all([
    makeRouteRequest(sLat, sLng, eLat, eLng),
    makeRouteRequest(sLat, sLng, eLat, eLng),
    makeRouteRequest(sLat, sLng, eLat, eLng),
    makeRouteRequest(sLat, sLng, eLat, eLng),
    makeRouteRequest(sLat, sLng, eLat, eLng),
  ]);
  const profiles = concurrentResults.map(r => r.body.profile as RouteProfile | undefined).filter((p): p is RouteProfile => p !== undefined);
  assert(profiles.length === 5, `All 5 concurrent requests returned profiles (got ${profiles.length})`);
  if (profiles.length === 5) {
    const totalMs = profiles.map(p => p.totalMs);
    const allSame = totalMs.every(t => t === totalMs[0]);
    assert(!allSame, 'Concurrent profiles have different totalMs values (not all identical)');
    const cacheMissCount = profiles.filter(p => !p.cacheHit).length;
    assert(cacheMissCount >= 1, `At least 1 cache miss among concurrent requests (got ${cacheMissCount})`);
  }

  // ── Test 5: dbQueries field counts correctly ──
  console.log('\nTest 5: dbQueries field counts correctly');
  await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/invalidate`, { method: 'POST' });
  const { body: bodyCold } = await makeRouteRequest(sLat, sLng, eLat, eLng);
  const profileCold = bodyCold.profile as RouteProfile;
  await makeRouteRequest(sLat, sLng, eLat, eLng); // warm cache
  const { body: bodyWarm } = await makeRouteRequest(sLat, sLng, eLat, eLng);
  const profileWarm = bodyWarm.profile as RouteProfile;
  assert(profileCold.dbQueries > profileWarm.dbQueries,
    `Cold cache has more DB queries than warm (${profileCold.dbQueries} > ${profileWarm.dbQueries})`);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════════`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
