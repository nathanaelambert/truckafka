import { query, queryOne, parseGeoLineString, parseGeoPoint, type GeoPoint } from '@truckmafia/shared';
import { loadLocalRoads, loadHighwayCorridor } from './overpass.js';

// Fixed empty weights for weight constraint filtering
const TRUCK_EMPTY_WEIGHT_KG = 8000;
const TRAILER_EMPTY_WEIGHT_KG = 4000;

interface GraphEdge {
  toNode: string;
  segmentId: string;
  length_m: number;
  maxspeed_km: number;
  maxweight_kg: number;
  oneway: boolean;
  geometry: GeoPoint[];
}

interface Graph {
  nodes: Map<string, GeoPoint>;
  adjacency: Map<string, GraphEdge[]>;
}

let graphCache: Graph | null = null;
let graphCacheTime = 0;
const GRAPH_CACHE_TTL_MS = 60_000;

// ── Profiling ──────────────────────────────────────────────────

export interface RouteProfile {
  ensureRoadDataMs: number;
  buildGraphMs: number;
  findNearestNodeMs: number;
  loadRoadEventsMs: number;
  bfsConnectivityMs: number;
  astarLoopMs: number;
  reconstructPathMs: number;
  nodeExpansions: number;
  edgeLookups: number;
  edgesEvaluated: number;
  edgesRelaxed: number;
  heuristicCalls: number;
  heuristicMs: number;
  graphNodes: number;
  graphEdges: number;
  cacheHit: boolean;
  dbQueries: number;
  totalMs: number;
}

let lastProfile: RouteProfile | null = null;

export function getLastRouteProfile(): RouteProfile | null {
  return lastProfile;
}

// ── Haversine distance (meters) ──────────────────────────────────

function haversine(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Estimated traversal time (seconds) ───────────────────────────
// loaded: 0.7 * maxspeed, empty: 0.8 * maxspeed

export function estimatedTime(length_m: number, maxspeed_km: number, isLoaded: boolean): number {
  if (maxspeed_km <= 0) return Infinity;
  const factor = isLoaded ? 0.7 : 0.8;
  return (length_m * 3.6) / (factor * maxspeed_km);
}

// ── Build graph from road_segments ───────────────────────────────

async function buildGraph(): Promise<Graph> {
  const now = Date.now();
  if (graphCache && now - graphCacheTime < GRAPH_CACHE_TTL_MS) {
    return graphCache;
  }

  const segments = await query<{
    id: string; from_node: string; to_node: string;
    geometry: string; maxspeed_km: number; maxweight_kg: number; length_m: number; oneway: boolean;
  }>(
    `SELECT id, from_node, to_node, ST_AsText(geometry) AS geometry,
            maxspeed_km, maxweight_kg, length_m, oneway
     FROM road_segment
     WHERE from_node IS NOT NULL AND to_node IS NOT NULL`
  );

  const nodes = await query<{ id: string; location: string }>(
    `SELECT id, ST_AsText(location) AS location FROM road_node`
  );

  const graph: Graph = {
    nodes: new Map(),
    adjacency: new Map(),
  };

  for (const n of nodes) {
    const pt = parseGeoPoint(n.location);
    if (pt) graph.nodes.set(n.id, pt);
  }

  for (const seg of segments) {
    const fromPos = graph.nodes.get(seg.from_node);
    const toPos = graph.nodes.get(seg.to_node);
    if (!fromPos || !toPos) continue;

    const geometry = parseGeoLineString(seg.geometry);

    const edge: GraphEdge = {
      toNode: seg.to_node,
      segmentId: seg.id,
      length_m: seg.length_m,
      maxspeed_km: seg.maxspeed_km,
      maxweight_kg: seg.maxweight_kg,
      oneway: seg.oneway,
      geometry,
    };

    if (!graph.adjacency.has(seg.from_node)) {
      graph.adjacency.set(seg.from_node, []);
    }
    graph.adjacency.get(seg.from_node)!.push(edge);

    // Add reverse edge only if road is not oneway
    if (!seg.oneway) {
      const reverseEdge: GraphEdge = {
        ...edge,
        toNode: seg.from_node,
        geometry: [...geometry].reverse(),
      };
      if (!graph.adjacency.has(seg.to_node)) {
        graph.adjacency.set(seg.to_node, []);
      }
      graph.adjacency.get(seg.to_node)!.push(reverseEdge);
    }
  }

  graphCache = graph;
  graphCacheTime = now;
  return graph;
}

// ── Ensure local road data exists near a point ──────────────────

async function ensureRoadDataNear(lat: number, lng: number): Promise<void> {
  // Check if any road node exists within ~500m
  const nearest = await queryOne<{ dist: string }>(
    `SELECT (location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::text AS dist
     FROM road_node ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography LIMIT 1`,
    [lng, lat]
  );
  // If no node or nearest is > 500m away, load local roads
  if (!nearest || parseFloat(nearest.dist) > 500) {
    try {
      console.log(`[A*] Loading local roads near ${lat},${lng} (nearest: ${nearest?.dist || 'none'})`);
      let loaded = await loadLocalRoads(lat, lng);
      // If first attempt loaded nothing, try with bigger radius
      if (loaded === 0) {
        console.log(`[A*] Retrying with bigger radius for ${lat},${lng}`);
        loaded = await loadLocalRoads(lat, lng, 0.025);
      }
      if (loaded > 0) invalidateGraphCache();
    } catch (e) {
      console.error('[A*] Failed to load local roads:', e instanceof Error ? e.message : String(e));
    }
  }
}

// ── Find nearest road node to a position ─────────────────────────

async function findNearestNode(lat: number, lng: number): Promise<string | null> {
  // Find nearest node that is a from_node in at least one segment (has outgoing edges)
  const row = await queryOne<{ id: string }>(
    `SELECT n.id FROM road_node n
     WHERE n.id IN (SELECT from_node FROM road_segment WHERE from_node IS NOT NULL)
        OR n.id IN (SELECT to_node FROM road_segment WHERE to_node IS NOT NULL AND oneway = false)
     ORDER BY n.location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     LIMIT 1`,
    [lng, lat]
  );
  return row?.id ?? null;
}

// ── Get active road events for segments at a given time ─────────

interface RoadEventInfo {
  maxspeed_km: number | null;
  maxweight_kg: number | null;
  is_usable: boolean;
}

// Preload all road events into a map by segment ID (active at given time)
async function loadAllRoadEvents(atTime: Date): Promise<Map<string, RoadEventInfo>> {
  const rows = await query<{
    road_segment_id: string; maxspeed_km: number | null; maxweight_kg: number | null; is_usable: boolean;
  }>(
    `SELECT seg_id, MIN(maxspeed_km) AS maxspeed_km, MIN(maxweight_kg) AS maxweight_kg, BOOL_AND(is_usable) AS is_usable FROM (
       SELECT road_segment_id AS seg_id, maxspeed_km, maxweight_kg, is_usable FROM road_event
       WHERE start_at <= $1 AND (end_at IS NULL OR end_at >= $1) AND road_segment_id IS NOT NULL
       UNION ALL
       SELECT res.road_segment_id AS seg_id, re.maxspeed_km, re.maxweight_kg, re.is_usable
       FROM road_event re
       JOIN road_event_segment res ON re.id = res.road_event_id
       WHERE re.start_at <= $1 AND (re.end_at IS NULL OR re.end_at >= $1)
     ) combined
     GROUP BY seg_id`,
    [atTime]
  );
  const map = new Map<string, RoadEventInfo>();
  for (const r of rows) {
    map.set(r.road_segment_id, {
      maxspeed_km: r.maxspeed_km,
      maxweight_kg: r.maxweight_kg,
      is_usable: r.is_usable,
    });
  }
  return map;
}

// ── A* pathfinding ───────────────────────────────────────────────

export interface RouteResult {
  segmentIds: string[];
  geometry: GeoPoint[];
  totalDistance_m: number;
  totalTime_s: number;
  segments: { segmentId: string; geometry: GeoPoint[]; length_m: number; maxspeed_km: number; estimated_time_s: number }[];
}

export async function findRoute(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
  totalWeightKg: number,
  atTime: Date = new Date(),
  isLoaded: boolean = false,
  onProfile?: (p: RouteProfile) => void
): Promise<RouteResult | null> {
  const tStart = Date.now();
  const p: RouteProfile = {
    ensureRoadDataMs: 0, buildGraphMs: 0, findNearestNodeMs: 0, loadRoadEventsMs: 0,
    bfsConnectivityMs: 0, astarLoopMs: 0, reconstructPathMs: 0,
    nodeExpansions: 0, edgeLookups: 0, edgesEvaluated: 0, edgesRelaxed: 0,
    heuristicCalls: 0, heuristicMs: 0,
    graphNodes: 0, graphEdges: 0, cacheHit: false, dbQueries: 0, totalMs: 0,
  };

  const done = (): RouteProfile => {
    p.totalMs = Date.now() - tStart;
    lastProfile = p;
    onProfile?.(p);
    return p;
  };

  // Smart loading strategy:
  // 1. Load ALL road types in small radius around start and end (local roads connect to highways)
  // 2. Load MAJOR highways in the corridor between them (backbone, fewer Overpass calls)
  // Cache is only invalidated when new road data is actually loaded from Overpass.
  // When the cache is valid, skip road-data loading entirely — the graph is current.
  const cacheValid = graphCache !== null && (Date.now() - graphCacheTime < GRAPH_CACHE_TTL_MS);
  let t0 = Date.now();
  if (!cacheValid) {
    p.dbQueries += 1;
    await ensureRoadDataNear(startLat, startLng);
    p.dbQueries += 1;
    await ensureRoadDataNear(endLat, endLng);
    p.dbQueries += 1;
    const corridorLoaded = await loadHighwayCorridor(startLat, startLng, endLat, endLng);
    if (corridorLoaded > 0) invalidateGraphCache();
  }
  p.ensureRoadDataMs = Date.now() - t0;

  t0 = Date.now();
  if (!cacheValid) p.dbQueries += 2;
  const graph = await buildGraph();
  p.buildGraphMs = Date.now() - t0;
  p.cacheHit = cacheValid;
  p.graphNodes = graph.nodes.size;
  p.graphEdges = graph.adjacency.size;
  console.log(`[A*] Graph: ${graph.nodes.size} nodes, ${graph.adjacency.size} adjacency entries`);

  t0 = Date.now();
  p.dbQueries += 1;
  const startNode = await findNearestNode(startLat, startLng);
  p.dbQueries += 1;
  const endNode = await findNearestNode(endLat, endLng);
  p.findNearestNodeMs = Date.now() - t0;
  console.log(`[A*] startNode: ${startNode}, endNode: ${endNode}`);

  if (!startNode || !endNode) { done(); return null; }
  if (startNode === endNode) {
    done();
    return { segmentIds: [], geometry: [], totalDistance_m: 0, totalTime_s: 0, segments: [] };
  }

  const endPos = graph.nodes.get(endNode);
  const startPos = graph.nodes.get(startNode);
  console.log(`[A*] startPos in graph: ${!!startPos}, endPos in graph: ${!!endPos}`);
  if (!startPos || !endPos) { done(); return null; }

  // A* with time-advancing: gScore is accumulated time (seconds) from start
  // We also track the arrival time at each node to check road events per-edge
  // Preload all road events at the start time (approximation: we use start time for all edges)
  t0 = Date.now();
  p.dbQueries += 1;
  const roadEventsMap = await loadAllRoadEvents(atTime);
  p.loadRoadEventsMs = Date.now() - t0;
  console.log(`[A*] Road events: ${roadEventsMap.size} segments with events`);

  // Quick BFS connectivity check before running expensive A*
  t0 = Date.now();
  const reachable = new Set<string>([startNode]);
  const queue = [startNode];
  while (queue.length > 0 && reachable.size < graph.nodes.size) {
    const node = queue.shift()!;
    const neighbors = graph.adjacency.get(node) ?? [];
    for (const edge of neighbors) {
      if (!reachable.has(edge.toNode)) {
        reachable.add(edge.toNode);
        queue.push(edge.toNode);
        if (edge.toNode === endNode) break;
      }
    }
    if (reachable.has(endNode)) break;
  }
  p.bfsConnectivityMs = Date.now() - t0;
  if (!reachable.has(endNode)) {
    console.log(`[A*] End node not reachable from start (reachable: ${reachable.size}/${graph.nodes.size})`);
    done();
    return null;
  }
  console.log(`[A*] End node is reachable (reachable set: ${reachable.size})`);

  const openSet = new Set<string>([startNode]);
  const cameFrom = new Map<string, { node: string; edge: GraphEdge; edgeTime: number }>();
  const gScore = new Map<string, number>(); // accumulated time in seconds
  const arrivalTime = new Map<string, number>(); // arrival time at node (ms since epoch)
  const fScore = new Map<string, number>();

  gScore.set(startNode, 0);
  arrivalTime.set(startNode, atTime.getTime());
  fScore.set(startNode, haversine(startPos, endPos) / 30);

  t0 = Date.now();
  let result: RouteResult | null = null;

  while (openSet.size > 0) {
    let current: string | null = null;
    let lowestF = Infinity;
    for (const node of openSet) {
      const f = fScore.get(node) ?? Infinity;
      if (f < lowestF) { lowestF = f; current = node; }
    }
    if (!current) break;

    p.nodeExpansions++;

    if (current === endNode) {
      p.astarLoopMs = Date.now() - t0;
      t0 = Date.now();
      result = reconstructPath(cameFrom, current, startNode, graph, totalWeightKg, isLoaded, atTime);
      p.reconstructPathMs = Date.now() - t0;
      break;
    }

    openSet.delete(current);
    p.edgeLookups++;
    const neighbors = graph.adjacency.get(current) ?? [];
    const currentArrival = arrivalTime.get(current) ?? atTime.getTime();

    for (const edge of neighbors) {
      p.edgesEvaluated++;

      // Check road events from preloaded map
      const eventInfo = roadEventsMap.get(edge.segmentId) ?? null;

      // Compute effective maxspeed: min of segment default and road event override
      let effectiveSpeed = edge.maxspeed_km;
      if (eventInfo?.maxspeed_km != null) {
        effectiveSpeed = Math.min(effectiveSpeed, eventInfo.maxspeed_km);
      }

      // Compute effective maxweight: min of segment default and road event override
      let effectiveMaxWeight = edge.maxweight_kg;
      if (eventInfo?.maxweight_kg != null) {
        effectiveMaxWeight = Math.min(effectiveMaxWeight, eventInfo.maxweight_kg);
      }

      // Weight constraint: segment must support total weight
      if (effectiveMaxWeight > 0 && effectiveMaxWeight < totalWeightKg) continue;

      // Usability check: if road event says not usable, skip
      if (eventInfo && !eventInfo.is_usable) continue;

      const edgeTime = estimatedTime(edge.length_m, effectiveSpeed, isLoaded);
      const tentativeG = (gScore.get(current) ?? Infinity) + edgeTime;

      const neighborG = gScore.get(edge.toNode) ?? Infinity;
      if (tentativeG < neighborG) {
        p.edgesRelaxed++;
        cameFrom.set(edge.toNode, { node: current, edge, edgeTime });
        gScore.set(edge.toNode, tentativeG);
        arrivalTime.set(edge.toNode, currentArrival + edgeTime * 1000);

        const neighborPos = graph.nodes.get(edge.toNode);
        const hT0 = Date.now();
        const heuristic = neighborPos ? haversine(neighborPos, endPos) / 30 : 0;
        p.heuristicMs += Date.now() - hT0;
        p.heuristicCalls++;
        fScore.set(edge.toNode, tentativeG + heuristic);
        openSet.add(edge.toNode);
      }
    }
  }

  if (!result) {
    p.astarLoopMs = Date.now() - t0;
  }

  done();
  return result;
}

function reconstructPath(
  cameFrom: Map<string, { node: string; edge: GraphEdge; edgeTime: number }>,
  current: string,
  startNode: string,
  _graph: Graph,
  _totalWeightKg: number,
  _isLoaded: boolean,
  _atTime: Date
): RouteResult {
  const segments: RouteResult['segments'] = [];
  const segmentIds: string[] = [];
  let geometry: GeoPoint[] = [];

  let node = current;
  while (cameFrom.has(node)) {
    const step = cameFrom.get(node)!;

    segments.unshift({
      segmentId: step.edge.segmentId,
      geometry: step.edge.geometry,
      length_m: step.edge.length_m,
      maxspeed_km: step.edge.maxspeed_km,
      estimated_time_s: step.edgeTime,
    });
    segmentIds.unshift(step.edge.segmentId);
    geometry = [...step.edge.geometry, ...geometry];
    node = step.node;
  }

  const totalDistance_m = segments.reduce((sum, s) => sum + s.length_m, 0);
  const totalTime_s = segments.reduce((sum, s) => sum + s.estimated_time_s, 0);

  const deduped: GeoPoint[] = [];
  for (const pt of geometry) {
    if (deduped.length === 0 ||
        deduped[deduped.length - 1].lat !== pt.lat ||
        deduped[deduped.length - 1].lng !== pt.lng) {
      deduped.push(pt);
    }
  }

  return { segmentIds, geometry: deduped, totalDistance_m, totalTime_s, segments };
}

// ── Compute and store itinerary for a haul ───────────────────────

export async function computeItinerary(haulId: string): Promise<RouteResult | null> {
  const haul = await queryOne<{
    load_id: string; truck_id: string; trailer_id: string; started_at: string;
    pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number;
    load_weight: number;
  }>(
    `SELECT h.load_id, h.truck_id, h.trailer_id, h.started_at,
            ST_Y(lp.position::geometry) AS pickup_lat, ST_X(lp.position::geometry) AS pickup_lng,
            ST_Y(ld.position::geometry) AS dropoff_lat, ST_X(ld.position::geometry) AS dropoff_lng,
            l.weight AS load_weight
     FROM haul h
     JOIN load l ON h.load_id = l.id
     JOIN location lp ON l.pickup_location_id = lp.id
     JOIN location ld ON l.dropoff_location_id = ld.id
     WHERE h.id = $1`,
    [haulId]
  );

  if (!haul) return null;

  const totalWeight = haul.load_weight + TRUCK_EMPTY_WEIGHT_KG + TRAILER_EMPTY_WEIGHT_KG;
  const atTime = new Date(haul.started_at);

  const route = await findRoute(
    haul.pickup_lat, haul.pickup_lng,
    haul.dropoff_lat, haul.dropoff_lng,
    totalWeight,
    atTime,
    true // loaded
  );

  if (!route) return null;

  await query('DELETE FROM road_segment_traversal WHERE haul_id = $1', [haulId]);

  if (route.segmentIds.length > 0) {
    const values = route.segmentIds
      .map((segId, i) => `($1, $${i + 2}, $${i + route.segmentIds.length + 2})`)
      .join(', ');
    const params = [haulId, ...route.segmentIds, ...route.segmentIds.map((_, i) => i + 1)];
    await query(
      `INSERT INTO road_segment_traversal (haul_id, road_segment_id, sequence) VALUES ${values}`,
      params
    );
  }

  return route;
}

export function invalidateGraphCache(): void {
  graphCache = null;
}

export function getCacheStatus(): { valid: boolean; ageMs: number; ttlMs: number; nodes: number; edges: number } {
  const now = Date.now();
  const valid = graphCache !== null && (now - graphCacheTime < GRAPH_CACHE_TTL_MS);
  return {
    valid,
    ageMs: graphCache ? now - graphCacheTime : 0,
    ttlMs: GRAPH_CACHE_TTL_MS,
    nodes: graphCache?.nodes.size ?? 0,
    edges: graphCache?.adjacency.size ?? 0,
  };
}
