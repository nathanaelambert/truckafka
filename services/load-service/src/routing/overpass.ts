import { query, queryOne, lineStringToWKT } from '@truckmafia/shared';

// ═══════════════════════════════════════════════════════════════
// Overpass API integration — smart loading strategy:
// 1. Load ALL road types in small radius around endpoints (local roads)
// 2. Load MAJOR highways in large corridor between endpoints (backbone)
// ═══════════════════════════════════════════════════════════════

interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  nodes?: number[]; // OSM node IDs when using out body;
}

interface OverpassResponse {
  elements: (OverpassWay | { type: 'node'; id: number; lat: number; lon: number })[];
}

const OVERPASS_URLS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const ALL_DRIVABLE = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  'living_street', 'service', 'road',
];

const MAJOR_HIGHWAYS = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
];

function parseMaxspeed(s: string | undefined): number {
  if (!s) return 50;
  const m = s.match(/^(\d+)/);
  if (!m) return 50;
  const v = parseInt(m[1]);
  if (s.includes('mph')) return Math.round(v * 1.609);
  return v;
}

function parseMaxweight(s: string | undefined): number {
  if (!s) return 40000;
  const m = s.match(/^(\d+\.?\d*)/);
  if (!m) return 40000;
  const v = parseFloat(m[1]);
  if (s.includes('t') || s.includes('tonne')) return Math.round(v * 1000);
  return Math.round(v);
}

async function fetchOverpass(queryStr: string): Promise<OverpassResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of OVERPASS_URLS) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(queryStr),
          signal: AbortSignal.timeout(45000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as OverpassResponse;
          return data;
        }
        if (resp.status === 429) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
      } catch { /* try next mirror */ }
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 3000));
  }
  return { elements: [] };
}

// Cache: OSM node ID → our UUID
const osmNodeCache = new Map<number, string>();

async function findOrCreateNodeByOsm(osmNodeId: number | undefined, lat: number, lon: number): Promise<string | null> {
  // If we have OSM node ID, use cache first
  if (osmNodeId) {
    const cached = osmNodeCache.get(osmNodeId);
    if (cached) return cached;
  }

  // Check by OSM node ID in DB
  if (osmNodeId) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM road_node WHERE osm_node_id = $1`, [osmNodeId]
    );
    if (existing) {
      osmNodeCache.set(osmNodeId, existing.id);
      return existing.id;
    }
  }

  // Fallback: check by location within 10m
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM road_node
     WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 10)
     ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     LIMIT 1`,
    [lon, lat]
  );
  if (existing) {
    if (osmNodeId) osmNodeCache.set(osmNodeId, existing.id);
    return existing.id;
  }

  // Create new node
  const row = await queryOne<{ id: string }>(
    `INSERT INTO road_node (location, osm_node_id) VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3) RETURNING id`,
    [lon, lat, osmNodeId ?? null]
  );
  if (row && osmNodeId) osmNodeCache.set(osmNodeId, row.id);
  return row?.id ?? null;
}

async function storeWays(ways: OverpassWay[]): Promise<number> {
  let segCount = 0;
  for (const el of ways) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    const highway = tags.highway;
    if (!highway) continue;

    const maxspeed = parseMaxspeed(tags.maxspeed);
    const maxweight = parseMaxweight(tags.maxweight);
    const oneway = tags.oneway === 'yes' || tags.oneway === 'true' || tags.oneway === '1'
      || (highway === 'motorway' && tags.oneway !== 'no' && tags.oneway !== 'false')
      || (highway === 'motorway_link' && tags.oneway !== 'no' && tags.oneway !== 'false');
    const name = tags.name || null;

    // Create a node at EVERY geometry point — this ensures intersections are shared
    // when two ways pass through the same coordinate
    const nodeIds: string[] = [];
    for (const pt of el.geometry) {
      const node = await findOrCreateNodeByOsm(undefined, pt.lat, pt.lon);
      if (node) nodeIds.push(node);
    }

    if (nodeIds.length < 2) continue;

    // Create sub-segments between consecutive nodes
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const fromNode = nodeIds[i];
      const toNode = nodeIds[i + 1];
      if (fromNode === toNode) continue;

      const a = el.geometry[i];
      const b = el.geometry[i + 1];
      const lengthM = haversine(a.lat, a.lon, b.lat, b.lon);

      const subCoords: [number, number][] = [[a.lat, a.lon], [b.lat, b.lon]];
      const geometryWKT = lineStringToWKT(subCoords);

      // Skip if already exists
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM road_segment WHERE osm_way_id = $1 AND from_node = $2 AND to_node = $3`,
        [el.id, fromNode, toNode]
      );
      if (existing) continue;

      try {
        await queryOne(
          `INSERT INTO road_segment (geometry, maxspeed_km, maxweight_kg, length_m, highway_type,
             from_node, to_node, osm_way_id, name, oneway, loaded_at)
           VALUES (ST_GeomFromEWKT($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) RETURNING id`,
          [geometryWKT, maxspeed, maxweight, Math.round(lengthM), highway, fromNode, toNode, el.id, name, oneway]
        );
        segCount++;
      } catch { /* skip on error */ }
    }
  }
  return segCount;
}

// ── Load local roads (all types) in small radius around a point ──
export async function loadLocalRoads(lat: number, lng: number, radiusDeg = 0.012): Promise<number> {
  const minLat = lat - radiusDeg, maxLat = lat + radiusDeg;
  const minLng = lng - radiusDeg, maxLng = lng + radiusDeg;

  // Check if already loaded
  const existing = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM road_segment
     WHERE geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326) AND loaded_at IS NOT NULL`,
    [minLng, minLat, maxLng, maxLat]
  );
  if (existing && parseInt(existing.cnt) > 5) return 0;

  console.log(`[Overpass] Loading local roads near ${lat},${lng}`);
  const query_str = `[out:json][timeout:60];
    way["highway"~"^(${ALL_DRIVABLE.join('|')})$"](${minLat},${minLng},${maxLat},${maxLng});
    out body geom;`;
  const data = await fetchOverpass(query_str);
  const ways = data.elements.filter(e => e.type === 'way') as OverpassWay[];
  const count = await storeWays(ways);
  console.log(`[Overpass] Local: ${ways.length} ways → ${count} new segments`);
  return count;
}

// ── Load major highways in a large corridor between two points ──
export async function loadHighwayCorridor(
  startLat: number, startLng: number,
  endLat: number, endLng: number
): Promise<number> {
  // Expand bbox by 15% to catch nearby highways
  const minLat = Math.min(startLat, endLat) - 0.05;
  const maxLat = Math.max(startLat, endLat) + 0.05;
  const minLng = Math.min(startLng, endLng) - 0.05;
  const maxLng = Math.max(startLng, endLng) + 0.05;

  // Only load if no major highways exist in this corridor
  const existing = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM road_segment
     WHERE geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)
     AND loaded_at IS NOT NULL
     AND highway_type IN ('motorway','trunk','primary','secondary','tertiary',
       'motorway_link','trunk_link','primary_link','secondary_link','tertiary_link')
     LIMIT 1`,
    [minLng, minLat, maxLng, maxLat]
  );
  if (existing && parseInt(existing.cnt) > 5) return 0;

  console.log(`[Overpass] Loading highway corridor (${minLat},${minLng}) to (${maxLat},${maxLng})`);
  const query_str = `[out:json][timeout:60];
    way["highway"~"^(${MAJOR_HIGHWAYS.join('|')})$"](${minLat},${minLng},${maxLat},${maxLng});
    out body geom;`;
  const data = await fetchOverpass(query_str);
  const ways = data.elements.filter(e => e.type === 'way') as OverpassWay[];
  const count = await storeWays(ways);
  console.log(`[Overpass] Highway corridor: ${ways.length} ways → ${count} new segments`);
  return count;
}

// ── Legacy API: fetch all road data for a bbox ──
export async function fetchAndStoreRoadData(
  minLat: number, minLng: number, maxLat: number, maxLng: number
): Promise<{ nodes: number; segments: number }> {
  const query_str = `[out:json][timeout:60];
    way["highway"~"^(${ALL_DRIVABLE.join('|')})$"](${minLat},${minLng},${maxLat},${maxLng});
    out body geom;`;
  const data = await fetchOverpass(query_str);
  const ways = data.elements.filter(e => e.type === 'way') as OverpassWay[];
  const segCount = await storeWays(ways);
  return { nodes: 0, segments: segCount };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
