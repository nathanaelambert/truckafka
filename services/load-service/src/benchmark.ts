import { findRoute, getLastRouteProfile, invalidateGraphCache, type RouteProfile } from './routing/astar.js';
import { pool } from '@truckmafia/shared';

// ═══════════════════════════════════════════════════════════════
// A* Router Benchmark
//
// Runs representative routes against the synthetic road graph and
// reports a timing breakdown of DB access vs graph traversal vs
// heuristic computation.
// ═══════════════════════════════════════════════════════════════

const CENTER_LAT = 43.65;
const CENTER_LNG = -79.38;
const SPACING = 0.006;
const HALF = 29.5;

function gridLat(row: number): number { return CENTER_LAT + (row - HALF) * SPACING; }
function gridLng(col: number): number { return CENTER_LNG + (col - HALF) * SPACING; }

interface RouteDef {
  name: string;
  startRow: number; startCol: number;
  endRow: number; endCol: number;
}

const ROUTES: RouteDef[] = [
  { name: 'Short  (~1 km)',  startRow: 30, startCol: 30, endRow: 32, endCol: 32 },
  { name: 'Medium (~18 km)', startRow: 15, startCol: 15, endRow: 45, endCol: 45 },
  { name: 'Long   (~34 km)', startRow: 3,  startCol: 3,  endRow: 57, endCol: 57 },
];

const ITERATIONS = 3;

function fmt(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${ms.toFixed(1)}ms`;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '  0%';
  return `${(part / whole * 100).toFixed(1).padStart(4)}%`;
}

function printProfile(routeName: string, iter: number, p: RouteProfile) {
  const dbMs = p.ensureRoadDataMs + p.buildGraphMs + p.findNearestNodeMs + p.loadRoadEventsMs;
  const traversalMs = p.bfsConnectivityMs + p.astarLoopMs;
  const heuristicMs = p.heuristicMs;

  console.log(`\n  ┌─ ${routeName} [iter ${iter}] ${p.cacheHit ? '(cache HIT)' : '(cache MISS)'}`);
  console.log(`  │ Total: ${fmt(p.totalMs)}  |  DB: ${fmt(dbMs)}  |  Traversal: ${fmt(traversalMs)}  |  Heuristic: ${fmt(heuristicMs)}`);
  console.log(`  │`);
  console.log(`  │ DB Access Breakdown:`);
  console.log(`  │   ensureRoadData:  ${fmt(p.ensureRoadDataMs).padStart(10)}  (${pct(p.ensureRoadDataMs, p.totalMs)} of total)`);
  console.log(`  │   buildGraph:      ${fmt(p.buildGraphMs).padStart(10)}  (${pct(p.buildGraphMs, p.totalMs)} of total)`);
  console.log(`  │   findNearestNode: ${fmt(p.findNearestNodeMs).padStart(10)}  (${pct(p.findNearestNodeMs, p.totalMs)} of total)`);
  console.log(`  │   loadRoadEvents:  ${fmt(p.loadRoadEventsMs).padStart(10)}  (${pct(p.loadRoadEventsMs, p.totalMs)} of total)`);
  console.log(`  │   ─────────────────────────────`);
  console.log(`  │   DB subtotal:     ${fmt(dbMs).padStart(10)}  (${pct(dbMs, p.totalMs)} of total)`);
  console.log(`  │`);
  console.log(`  │ Graph Traversal Breakdown:`);
  console.log(`  │   BFS connectivity: ${fmt(p.bfsConnectivityMs).padStart(9)}  (${pct(p.bfsConnectivityMs, p.totalMs)} of total)`);
  console.log(`  │   A* loop:          ${fmt(p.astarLoopMs).padStart(9)}  (${pct(p.astarLoopMs, p.totalMs)} of total)`);
  console.log(`  │   reconstructPath:  ${fmt(p.reconstructPathMs).padStart(9)}  (${pct(p.reconstructPathMs, p.totalMs)} of total)`);
  console.log(`  │   ─────────────────────────────`);
  console.log(`  │   Traversal subtotal: ${fmt(traversalMs).padStart(7)}  (${pct(traversalMs, p.totalMs)} of total)`);
  console.log(`  │`);
  console.log(`  │ Heuristic: ${fmt(heuristicMs)}  (${pct(heuristicMs, p.totalMs)} of total, ${p.heuristicCalls} calls)`);
  console.log(`  │`);
  console.log(`  │ A* Metrics:`);
  console.log(`  │   Node expansions: ${p.nodeExpansions}`);
  console.log(`  │   Edge lookups:    ${p.edgeLookups}`);
  console.log(`  │   Edges evaluated: ${p.edgesEvaluated}`);
  console.log(`  │   Edges relaxed:   ${p.edgesRelaxed}`);
  console.log(`  │   Graph: ${p.graphNodes} nodes, ${p.graphEdges} adjacency entries`);
  console.log(`  └─`);
}

function printSummary(routes: { name: string; profiles: RouteProfile[] }[]) {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('SUMMARY: Cold (cache miss) vs Warm (cache hit) Comparison');
  console.log('══════════════════════════════════════════════════════════════\n');

  const dbOf = (p: RouteProfile) => p.ensureRoadDataMs + p.buildGraphMs + p.findNearestNodeMs + p.loadRoadEventsMs;
  const travOf = (p: RouteProfile) => p.bfsConnectivityMs + p.astarLoopMs;

  for (const { name, profiles } of routes) {
    const cold = profiles.filter(p => !p.cacheHit);
    const warm = profiles.filter(p => p.cacheHit);
    const avg = (arr: RouteProfile[], fn: (p: RouteProfile) => number) =>
      arr.length > 0 ? arr.reduce((s, p) => s + fn(p), 0) / arr.length : 0;

    const coldTotal = avg(cold, p => p.totalMs);
    const warmTotal = avg(warm, p => p.totalMs);
    const speedup = warmTotal > 0 ? coldTotal / warmTotal : 0;

    console.log(`  ${name}`);
    console.log(`    COLD (cache miss, ${cold.length} run${cold.length !== 1 ? 's' : ''}):`);
    console.log(`      Total:       ${fmt(coldTotal).padStart(10)}`);
    console.log(`      DB access:   ${fmt(avg(cold, dbOf)).padStart(10)}  ${pct(avg(cold, dbOf), coldTotal)}`);
    console.log(`      buildGraph:  ${fmt(avg(cold, p => p.buildGraphMs)).padStart(10)}`);
    console.log(`      Traversal:   ${fmt(avg(cold, travOf)).padStart(10)}  ${pct(avg(cold, travOf), coldTotal)}`);
    console.log(`    WARM (cache hit, ${warm.length} run${warm.length !== 1 ? 's' : ''}):`);
    console.log(`      Total:       ${fmt(warmTotal).padStart(10)}`);
    console.log(`      DB access:   ${fmt(avg(warm, dbOf)).padStart(10)}  ${pct(avg(warm, dbOf), warmTotal)}`);
    console.log(`      buildGraph:  ${fmt(avg(warm, p => p.buildGraphMs)).padStart(10)}`);
    console.log(`      Traversal:   ${fmt(avg(warm, travOf)).padStart(10)}  ${pct(avg(warm, travOf), warmTotal)}`);
    console.log(`    Speedup: ${speedup.toFixed(1)}x`);
    console.log(`    Node expansions: ${avg(profiles, p => p.nodeExpansions).toFixed(0)}`);
    console.log(`    Edges evaluated: ${avg(profiles, p => p.edgesEvaluated).toFixed(0)}`);
    console.log('');
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('A* Router Benchmark — Bottleneck Profiling');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`\nRoutes: ${ROUTES.length} | Iterations per route: ${ITERATIONS}\n`);

  const allResults: { name: string; profiles: RouteProfile[] }[] = [];

  for (const route of ROUTES) {
    const startLat = gridLat(route.startRow);
    const startLng = gridLng(route.startCol);
    const endLat = gridLat(route.endRow);
    const endLng = gridLng(route.endCol);

    console.log(`\n── ${route.name} ──────────────────────────────────────────`);
    console.log(`  Start: (${startLat.toFixed(4)}, ${startLng.toFixed(4)})`);
    console.log(`  End:   (${endLat.toFixed(4)}, ${endLng.toFixed(4)})`);

    const profiles: RouteProfile[] = [];

    for (let i = 1; i <= ITERATIONS; i++) {
      if (i === 1) invalidateGraphCache();
      const result = await findRoute(startLat, startLng, endLat, endLng, 12000, new Date(), true);
      const p = getLastRouteProfile();
      if (p) {
        profiles.push(p);
        printProfile(route.name, i, p);
      }
    }

    allResults.push({ name: route.name, profiles });
  }

  printSummary(allResults);
  await pool.end();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
