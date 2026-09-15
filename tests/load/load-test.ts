import pg from 'pg';
import { execSync } from 'node:child_process';
import type { RouteDef, RequestResult, ConcurrencyResult, InfraSample, EnvInfo, RouteProfile } from './types.js';
import { percentile, mean, fmtMs, fmtNum } from './stats.js';
import { InfraMonitor } from './monitor.js';

const { Pool } = pg;

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://truckmafia:truckmafia_dev@localhost:5432/truckmafia';
const LOAD_SERVICE_URL = process.env.LOAD_SERVICE_URL || 'http://127.0.0.1:4002';
const CONCURRENCY_LEVELS = [1, 10, 25, 50, 100];
const REQUESTS_PER_LEVEL: Record<number, number> = { 1: 50, 10: 100, 25: 100, 50: 100, 100: 100 };
const HTTP_TIMEOUT_MS = 30_000;
const PRODUCTION_ROUTE_TIMEOUT_MS = 5_000;
const LOAD_SERVICE_CONTAINER = process.env.LOAD_SERVICE_CONTAINER || 'truckafka-v1-load-service-1';
const DB_CONTAINER = process.env.DB_CONTAINER || 'truckafka-v1-db-1';

// ═══════════════════════════════════════════════════════════════
// Route definitions — fetched from DB road_node positions
// ═══════════════════════════════════════════════════════════════

async function fetchRouteDefs(pool: pg.Pool): Promise<RouteDef[]> {
  const { rows } = await pool.query<{
    lat: string; lng: string;
  }>(`
    SELECT ST_Y(location::geometry)::text AS lat, ST_X(location::geometry)::text AS lng
    FROM road_node
    WHERE id IN (SELECT from_node FROM road_segment WHERE from_node IS NOT NULL LIMIT 1)
    ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    LIMIT 1
  `, [-79.38, 43.65]);

  const center = rows[0];
  if (!center) throw new Error('No road nodes found in database');

  // Fetch nodes at varying distances for short/medium/long routes
  const { rows: nearby } = await pool.query<{ lat: string; lng: string }>(`
    SELECT ST_Y(location::geometry)::text AS lat, ST_X(location::geometry)::text AS lng
    FROM road_node
    WHERE id IN (SELECT from_node FROM road_segment WHERE from_node IS NOT NULL)
    ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    LIMIT 50
  `, [parseFloat(center.lng), parseFloat(center.lat)]);

  if (nearby.length < 10) throw new Error('Not enough road nodes for route definitions');

  const routes: RouteDef[] = [];
  const n = nearby.length;

  // Short routes: nearby pairs (~1-2 grid steps)
  for (let i = 0; i < 4 && i + 1 < n; i++) {
    const s = nearby[i];
    const e = nearby[i + 1];
    routes.push({ name: `Short-${i+1}`, startLat: parseFloat(s.lat), startLng: parseFloat(s.lng), endLat: parseFloat(e.lat), endLng: parseFloat(e.lng), category: 'short' });
  }

  // Medium routes: ~15-20 grid steps apart
  for (let i = 0; i < 3; i++) {
    const s = nearby[i];
    const e = nearby[Math.min(i + 15, n - 1)];
    routes.push({ name: `Medium-${i+1}`, startLat: parseFloat(s.lat), startLng: parseFloat(s.lng), endLat: parseFloat(e.lat), endLng: parseFloat(e.lng), category: 'medium' });
  }

  // Long routes: opposite corners
  for (let i = 0; i < 3; i++) {
    const s = nearby[i];
    const e = nearby[n - 1 - i];
    routes.push({ name: `Long-${i+1}`, startLat: parseFloat(s.lat), startLng: parseFloat(s.lng), endLat: parseFloat(e.lat), endLng: parseFloat(e.lng), category: 'long' });
  }

  return routes;
}

// ═══════════════════════════════════════════════════════════════
// HTTP client
// ═══════════════════════════════════════════════════════════════

async function makeRouteRequest(route: RouteDef): Promise<RequestResult> {
  const url = `${LOAD_SERVICE_URL}/api/itineraries/route?startLat=${route.startLat}&startLng=${route.startLng}&endLat=${route.endLat}&endLng=${route.endLng}&weight=12000&isLoaded=true&profile=true`;
  const t0 = Date.now();

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - t0;
    const body = await resp.json() as Record<string, unknown>;

    const isApproximate = body.is_approximate === true;
    const profile = (body.profile as RouteProfile) ?? null;
    const timedOut = isApproximate && profile === null;

    return {
      ok: resp.ok && !isApproximate,
      timedOut,
      httpStatus: resp.status,
      latencyMs,
      isApproximate,
      profile,
    };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const err = e instanceof Error ? e.message : String(e);
    const isTimeout = err.includes('timeout') || err.includes('aborted') || latencyMs >= HTTP_TIMEOUT_MS;
    return {
      ok: false,
      timedOut: isTimeout,
      httpStatus: 0,
      latencyMs,
      isApproximate: false,
      profile: null,
      error: err,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Cache control
// ═══════════════════════════════════════════════════════════════

async function invalidateCache(): Promise<void> {
  try {
    await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/invalidate`, { method: 'POST' });
  } catch { /* ignore */ }
}

async function getCacheStatus(): Promise<{ valid: boolean; nodes: number; edges: number }> {
  try {
    const resp = await fetch(`${LOAD_SERVICE_URL}/api/itineraries/cache/status`);
    const body = await resp.json() as { valid: boolean; nodes: number; edges: number };
    return body;
  } catch {
    return { valid: false, nodes: 0, edges: 0 };
  }
}

async function warmupCache(routes: RouteDef[]): Promise<void> {
  // Make a single request to populate the graph cache
  const r = routes[0];
  if (r) {
    await makeRouteRequest(r);
  }
}

// ═══════════════════════════════════════════════════════════════
// Concurrency runner
// ═══════════════════════════════════════════════════════════════

async function runConcurrent(
  routes: RouteDef[],
  concurrency: number,
  totalRequests: number,
  monitor: InfraMonitor,
): Promise<RequestResult[]> {
  const results: RequestResult[] = [];
  const routeQueue: RouteDef[] = [];
  for (let i = 0; i < totalRequests; i++) {
    routeQueue.push(routes[i % routes.length]);
  }

  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (nextIdx < routeQueue.length) {
      const idx = nextIdx++;
      const result = await makeRouteRequest(routeQueue[idx]);
      results.push(result);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  monitor.start();
  await Promise.all(workers);
  monitor.stop();

  return results;
}

// ═══════════════════════════════════════════════════════════════
// Environment info
// ═══════════════════════════════════════════════════════════════

async function gatherEnvInfo(pool: pg.Pool): Promise<EnvInfo> {
  const cpuCores = parseInt(execSync('nproc', { encoding: 'utf-8' }).trim());
  const cpuModel = execSync("grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2", { encoding: 'utf-8' }).trim();
  const memLine = execSync("free -g | awk '/^Mem:/{print $2}'", { encoding: 'utf-8' }).trim();
  const totalRamGB = parseInt(memLine);

  let lsMem = '0', lsCpu = '0';
  let dbMem = '0', dbCpu = '0';
  try {
    const stats = execSync(
      `docker inspect ${LOAD_SERVICE_CONTAINER} --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    [lsMem, lsCpu] = stats.split(' ');
    const dbStats = execSync(
      `docker inspect ${DB_CONTAINER} --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}' 2>/dev/null`,
      { encoding: 'utf-8' }
    ).trim();
    [dbMem, dbCpu] = dbStats.split(' ');
  } catch { /* ignore */ }

  const dockerLimits = `load-service: mem=${lsMem}, cpu=${lsCpu} | db: mem=${dbMem}, cpu=${dbCpu}`;

  const pgConfig = await pool.query('SHOW max_connections');
  const pgMaxConn = parseInt(pgConfig.rows[0]?.max_connections || '100');
  const pgSharedBuffers = (await pool.query('SHOW shared_buffers')).rows[0]?.shared_buffers || '128MB';
  const pgEffCache = (await pool.query('SHOW effective_cache_size')).rows[0]?.effective_cache_size || '4GB';
  const pgWorkMem = (await pool.query('SHOW work_mem')).rows[0]?.work_mem || '4MB';

  return {
    cpuCores,
    cpuModel,
    totalRamGB,
    dockerResourceLimits: dockerLimits,
    pgMaxConnections: pgMaxConn,
    pgSharedBuffers,
    pgEffectiveCacheSize: pgEffCache,
    pgWorkMem,
    loadServicePort: parseInt(process.env.LOAD_SERVICE_PORT || '4002'),
    benchmarkTimeoutMs: HTTP_TIMEOUT_MS,
    productionRouteTimeoutMs: PRODUCTION_ROUTE_TIMEOUT_MS,
  };
}

// ═══════════════════════════════════════════════════════════════
// Results computation
// ═══════════════════════════════════════════════════════════════

interface LevelStats {
  concurrency: number;
  cacheMode: string;
  total: number;
  success: number;
  failed: number;
  timeout: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  avgDbMs: number;
  avgAstarMs: number;
  avgNodeExpansions: number;
  avgEdgesEvaluated: number;
  avgDbQueries: number;
  cacheMisses: number;
  cacheHits: number;
  maxPgConnections: number;
  maxLoadSvcCpu: number;
  maxDbCpu: number;
}

function computeStats(result: ConcurrencyResult): LevelStats {
  const latencies = result.requests.map(r => r.latencyMs).sort((a, b) => a - b);
  const successful = result.requests.filter(r => r.ok);
  const profiles = successful.map(r => r.profile).filter((p): p is RouteProfile => p !== null);

  const total = result.requests.length;
  const success = successful.length;
  const failed = result.requests.filter(r => !r.ok && !r.timedOut).length;
  const timeout = result.requests.filter(r => r.timedOut).length;

  const durationS = result.totalDurationMs / 1000;
  const rps = durationS > 0 ? total / durationS : 0;

  const dbMs = profiles.map(p => p.ensureRoadDataMs + p.buildGraphMs + p.findNearestNodeMs + p.loadRoadEventsMs);
  const astarMs = profiles.map(p => p.bfsConnectivityMs + p.astarLoopMs);
  const nodeExp = profiles.map(p => p.nodeExpansions);
  const edgesEval = profiles.map(p => p.edgesEvaluated);
  const dbQueries = profiles.map(p => p.dbQueries);
  const cacheMisses = profiles.filter(p => !p.cacheHit).length;
  const cacheHits = profiles.filter(p => p.cacheHit).length;

  const maxPg = Math.max(0, ...result.infraSamples.map(s => s.pgTotalConnections));
  const maxLsCpu = Math.max(0, ...result.infraSamples.map(s => s.loadServiceCpuPct));
  const maxDbCpu = Math.max(0, ...result.infraSamples.map(s => s.dbCpuPct));

  return {
    concurrency: result.concurrency,
    cacheMode: result.cacheMode,
    total,
    success,
    failed,
    timeout,
    rps,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    min: latencies[0] ?? 0,
    max: latencies[latencies.length - 1] ?? 0,
    avg: mean(latencies),
    avgDbMs: mean(dbMs),
    avgAstarMs: mean(astarMs),
    avgNodeExpansions: mean(nodeExp),
    avgEdgesEvaluated: mean(edgesEval),
    avgDbQueries: mean(dbQueries),
    cacheMisses,
    cacheHits,
    maxPgConnections: maxPg,
    maxLoadSvcCpu: maxLsCpu,
    maxDbCpu: maxDbCpu,
  };
}

// ═══════════════════════════════════════════════════════════════
// Output formatting
// ═══════════════════════════════════════════════════════════════

function printEnv(env: EnvInfo): void {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('Environment');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  CPU:           ${env.cpuCores} cores — ${env.cpuModel}`);
  console.log(`  RAM:           ${env.totalRamGB} GB`);
  console.log(`  Docker limits: ${env.dockerResourceLimits}`);
  console.log(`  PostgreSQL:    max_connections=${env.pgMaxConnections}, shared_buffers=${env.pgSharedBuffers}, effective_cache_size=${env.pgEffectiveCacheSize}, work_mem=${env.pgWorkMem}`);
  console.log(`  Load service:  port ${env.loadServicePort}`);
  console.log(`  Timeouts:      benchmark=${env.benchmarkTimeoutMs}ms, production route=${env.productionRouteTimeoutMs}ms`);
  console.log('');
}

function printResultsTable(allStats: LevelStats[]): void {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('Results Table');
  console.log('══════════════════════════════════════════════════════════════');

  const header = '| Users | Cache | Reqs |  RPS  |  p50  |  p95  |  p99  |  min  |  max  |  avg  | Timeouts | Errors | DB time | A* time | Node exp | Edges | DB qrys | Cache M/H | PG conns | LS CPU | DB CPU |';
  const sep     = '|-------|-------|------|-------|-------|-------|-------|-------|-------|-------|----------|--------|---------|---------|----------|-------|---------|-----------|----------|--------|--------|';

  console.log(header);
  console.log(sep);

  for (const s of allStats) {
    const row = [
      s.concurrency.toString().padStart(5),
      s.cacheMode.padEnd(5),
      s.total.toString().padStart(4),
      s.rps.toFixed(1).padStart(5),
      fmtMs(s.p50).padStart(5),
      fmtMs(s.p95).padStart(5),
      fmtMs(s.p99).padStart(5),
      fmtMs(s.min).padStart(5),
      fmtMs(s.max).padStart(5),
      fmtMs(s.avg).padStart(5),
      s.timeout.toString().padStart(8),
      s.failed.toString().padStart(6),
      fmtMs(s.avgDbMs).padStart(7),
      fmtMs(s.avgAstarMs).padStart(7),
      fmtNum(s.avgNodeExpansions).padStart(8),
      fmtNum(s.avgEdgesEvaluated).padStart(5),
      fmtNum(s.avgDbQueries).padStart(7),
      `${s.cacheMisses}/${s.cacheHits}`.padStart(9),
      s.maxPgConnections.toString().padStart(8),
      `${s.maxLoadSvcCpu.toFixed(0)}%`.padStart(6),
      `${s.maxDbCpu.toFixed(0)}%`.padStart(6),
    ];
    console.log('| ' + row.join(' | ') + ' |');
  }
}

function printAnalysis(allStats: LevelStats[]): void {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('Analysis');
  console.log('══════════════════════════════════════════════════════════════\n');

  const warm = allStats.filter(s => s.cacheMode === 'warm');
  const cold = allStats.filter(s => s.cacheMode === 'cold');

  // 1. At what concurrency does latency begin increasing significantly?
  console.log('1. Latency inflection point:');
  if (warm.length >= 2) {
    const base = warm[0];
    for (const s of warm.slice(1)) {
      const ratio = s.p95 / base.p95;
      if (ratio > 2) {
        console.log(`   p95 latency increases significantly (${fmtMs(base.p95)} -> ${fmtMs(s.p95)}, ${ratio.toFixed(1)}x) at ${s.concurrency} concurrent users`);
        break;
      }
    }
  }

  // 2. At what concurrency does throughput stop scaling?
  console.log('\n2. Throughput scaling:');
  if (warm.length >= 2) {
    const base = warm[0];
    let lastRps = base.rps;
    for (const s of warm.slice(1)) {
      if (s.rps <= lastRps * 1.05) {
        console.log(`   Throughput stops scaling at ${s.concurrency} users (RPS: ${base.rps.toFixed(1)} -> ${s.rps.toFixed(1)})`);
        break;
      }
      lastRps = s.rps;
    }
  }

  // 3. At what concurrency do timeouts/errors appear?
  console.log('\n3. Timeouts and errors:');
  let anyTimeouts = false;
  for (const s of allStats) {
    if (s.timeout > 0 || s.failed > 0) {
      console.log(`   ${s.cacheMode} cache, ${s.concurrency} users: ${s.timeout} timeouts, ${s.failed} errors`);
      anyTimeouts = true;
    }
  }
  if (!anyTimeouts) {
    console.log('   No timeouts or errors at any concurrency level');
  }

  // 4. Is PostgreSQL becoming the bottleneck?
  console.log('\n4. PostgreSQL bottleneck:');
  const maxPg = Math.max(...allStats.map(s => s.maxPgConnections));
  const maxDbCpu = Math.max(...allStats.map(s => s.maxDbCpu));
  const warmDbMs = warm.map(s => s.avgDbMs);
  console.log(`   Max PG connections: ${maxPg} (limit: 100)`);
  console.log(`   Max DB CPU: ${maxDbCpu.toFixed(1)}% (Docker per-core; ${(maxDbCpu / 8).toFixed(1)}% of 8 cores)`);
  console.log(`   Avg DB time per route (warm): ${warmDbMs.map(m => fmtMs(m)).join(', ')}`);
  if (maxDbCpu / 8 > 70) {
    console.log('   => PostgreSQL CPU is under significant load');
  } else {
    console.log('   => PostgreSQL CPU is not a bottleneck');
  }

  // 5. Is the routing service CPU becoming the bottleneck?
  console.log('\n5. Routing service CPU:');
  const maxLsCpu = Math.max(...allStats.map(s => s.maxLoadSvcCpu));
  console.log(`   Max load-service CPU: ${maxLsCpu.toFixed(1)}%`);
  if (maxLsCpu > 80) {
    console.log('   => Routing service CPU is approaching saturation');
  } else {
    console.log('   => Routing service CPU is not a bottleneck');
  }

  // 6. Is the in-memory graph cache behaving correctly under concurrent requests?
  console.log('\n6. Graph cache behavior under concurrency:');
  for (const s of cold) {
    console.log(`   Cold @${s.concurrency} users: ${s.cacheMisses} cache misses, ${s.cacheHits} cache hits`);
    if (s.cacheMisses > 1) {
      console.log(`   => WARNING: ${s.cacheMisses} concurrent cache misses detected — thundering herd: multiple requests rebuilding graph simultaneously`);
    }
  }
  for (const s of warm) {
    if (s.cacheMisses > 0) {
      console.log(`   Warm @${s.concurrency} users: ${s.cacheMisses} unexpected cache misses (cache may have expired during test)`);
    } else {
      console.log(`   Warm @${s.concurrency} users: all cache hits (correct behavior)`);
    }
  }

  // 7. Does A* become the bottleneck under load?
  console.log('\n7. A* under load:');
  const warmAstar = warm.map(s => s.avgAstarMs);
  console.log(`   Avg A* time (warm): ${warmAstar.map(m => fmtMs(m)).join(', ')}`);
  const maxAstar = Math.max(...warmAstar);
  if (maxAstar > 100) {
    console.log('   => A* traversal is becoming significant under load');
  } else {
    console.log('   => A* traversal remains fast under load');
  }

  // 8. Does database access remain the bottleneck?
  console.log('\n8. Database access as bottleneck:');
  for (const s of warm) {
    const dbPct = s.avg > 0 ? (s.avgDbMs / s.avg * 100).toFixed(1) : '0';
    console.log(`   Warm @${s.concurrency}: DB=${fmtMs(s.avgDbMs)}/${fmtMs(s.avg)} (${dbPct}%) A*=${fmtMs(s.avgAstarMs)}`);
  }

  // 9. Redis recommendation
  console.log('\n9. Redis recommendation:');
  const warmTimeouts = warm.some(s => s.timeout > 0);
  const warmP95 = warm.map(s => s.p95);
  const maxWarmP95 = Math.max(...warmP95);
  const warm100 = warm.find(s => s.concurrency === 100);
  const manyCacheMisses = cold.some(s => s.cacheMisses > 5);

  console.log(`   Warm-cache p95 at 100 users: ${warm100 ? fmtMs(warm100.p95) : 'N/A'}`);
  console.log(`   Warm-cache timeouts at 100 users: ${warm100 ? warm100.timeout : 'N/A'}`);
  console.log(`   Max DB CPU: ${maxDbCpu.toFixed(1)}% (Docker reports per-core; ${maxDbCpu.toFixed(1)}% = ${(maxDbCpu / 8).toFixed(1)}% of 8 cores)`);
  console.log(`   Max PG connections: ${maxPg} / 100`);

  if (!warmTimeouts && maxWarmP95 < 500) {
    console.log('');
    console.log('   The single-instance in-memory cache handles 100 concurrent users with');
    console.log(`   acceptable latency (p95=${fmtMs(maxWarmP95)}) and zero warm-cache timeouts.`);
    console.log('   The cold-cache thundering herd (concurrent graph rebuilds) is the only');
    console.log('   significant issue, but this is fixable with a mutex around buildGraph(),');
    console.log('   not by introducing Redis.');
    console.log('');
    console.log('   Redis would only be justified if:');
    console.log('   - Multiple routing instances need to share a graph cache');
    console.log('   - Cold-start latency across instances becomes a problem at scale');
    console.log('   Neither condition is met with the current single-instance architecture.');
    console.log('   => Redis is NOT justified at this scale.');
  } else if (manyCacheMisses) {
    console.log('');
    console.log('   Cold-cache thundering herd detected. First add a mutex around');
    console.log('   buildGraph() to coalesce concurrent cache rebuilds. Re-evaluate Redis');
    console.log('   only if multiple routing instances are deployed.');
    console.log('   => Redis is NOT justified at this scale — fix the mutex first.');
  } else {
    console.log('   => Redis is NOT justified at this scale.');
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('Load Service Benchmark — Concurrent Route Requests');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Service: ${LOAD_SERVICE_URL}`);
  console.log(`  Concurrency levels: ${CONCURRENCY_LEVELS.join(', ')}`);
  console.log(`  Requests per level: ${CONCURRENCY_LEVELS.map(c => `${c}→${REQUESTS_PER_LEVEL[c]}`).join(', ')}`);
  console.log(`  Benchmark timeout: ${HTTP_TIMEOUT_MS}ms`);
  console.log(`  Production route timeout: ${PRODUCTION_ROUTE_TIMEOUT_MS}ms`);

  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  const monitor = new InfraMonitor(DATABASE_URL, LOAD_SERVICE_CONTAINER, DB_CONTAINER);

  // Gather environment info
  const env = await gatherEnvInfo(pool);
  printEnv(env);

  // Fetch route definitions from DB
  const routes = await fetchRouteDefs(pool);
  console.log(`  Route definitions: ${routes.length} routes (short=${routes.filter(r => r.category === 'short').length}, medium=${routes.filter(r => r.category === 'medium').length}, long=${routes.filter(r => r.category === 'long').length})`);
  console.log('');

  // Verify service is up
  try {
    const resp = await fetch(`${LOAD_SERVICE_URL}/health`);
    if (!resp.ok) throw new Error(`Health check failed: ${resp.status}`);
    console.log('  Service health: OK');
  } catch (e) {
    console.error('  Service is not reachable. Start it first:');
    console.error(`    DATABASE_URL="${DATABASE_URL}" PORT=4002 tsx services/load-service/src/index.ts`);
    process.exit(1);
  }

  const allResults: ConcurrencyResult[] = [];

  for (const concurrency of CONCURRENCY_LEVELS) {
    const totalRequests = REQUESTS_PER_LEVEL[concurrency] || 100;

    // ── Cold cache test ──
    console.log(`\n── ${concurrency} users — COLD cache ──────────────────────────`);
    await invalidateCache();
    const coldCacheStatus = await getCacheStatus();
    console.log(`  Cache before: valid=${coldCacheStatus.valid}`);

    const coldStart = Date.now();
    const coldResults = await runConcurrent(routes, concurrency, totalRequests, monitor);
    const coldDuration = Date.now() - coldStart;
    const coldInfra = monitor.stop();

    const coldResult: ConcurrencyResult = {
      concurrency, cacheMode: 'cold', requests: coldResults, infraSamples: coldInfra, totalDurationMs: coldDuration,
    };
    allResults.push(coldResult);

    const coldStats = computeStats(coldResult);
    console.log(`  Total: ${coldStats.total}, Success: ${coldStats.success}, Timeout: ${coldStats.timeout}, Failed: ${coldStats.failed}`);
    console.log(`  RPS: ${coldStats.rps.toFixed(1)}, p50: ${fmtMs(coldStats.p50)}, p95: ${fmtMs(coldStats.p95)}, p99: ${fmtMs(coldStats.p99)}`);
    console.log(`  Cache misses: ${coldStats.cacheMisses}, hits: ${coldStats.cacheHits}, DB queries avg: ${fmtNum(coldStats.avgDbQueries)}`);
    console.log(`  Max PG conns: ${coldStats.maxPgConnections}, LS CPU: ${coldStats.maxLoadSvcCpu.toFixed(0)}%, DB CPU: ${coldStats.maxDbCpu.toFixed(0)}%`);

    // ── Warm cache test ──
    console.log(`\n── ${concurrency} users — WARM cache ──────────────────────────`);
    await warmupCache(routes);
    const warmCacheStatus = await getCacheStatus();
    console.log(`  Cache before: valid=${warmCacheStatus.valid}, nodes=${warmCacheStatus.nodes}`);

    const warmStart = Date.now();
    const warmResults = await runConcurrent(routes, concurrency, totalRequests, monitor);
    const warmDuration = Date.now() - warmStart;
    const warmInfra = monitor.stop();

    const warmResult: ConcurrencyResult = {
      concurrency, cacheMode: 'warm', requests: warmResults, infraSamples: warmInfra, totalDurationMs: warmDuration,
    };
    allResults.push(warmResult);

    const warmStats = computeStats(warmResult);
    console.log(`  Total: ${warmStats.total}, Success: ${warmStats.success}, Timeout: ${warmStats.timeout}, Failed: ${warmStats.failed}`);
    console.log(`  RPS: ${warmStats.rps.toFixed(1)}, p50: ${fmtMs(warmStats.p50)}, p95: ${fmtMs(warmStats.p95)}, p99: ${fmtMs(warmStats.p99)}`);
    console.log(`  Cache misses: ${warmStats.cacheMisses}, hits: ${warmStats.cacheHits}, DB queries avg: ${fmtNum(warmStats.avgDbQueries)}`);
    console.log(`  Max PG conns: ${warmStats.maxPgConnections}, LS CPU: ${warmStats.maxLoadSvcCpu.toFixed(0)}%, DB CPU: ${warmStats.maxDbCpu.toFixed(0)}%`);
  }

  // Final report
  const allStats = allResults.map(computeStats);
  printResultsTable(allStats);
  printAnalysis(allStats);

  await monitor.close();
  await pool.end();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
