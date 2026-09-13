import { pool, query, queryOne } from './db.js';

// ═══════════════════════════════════════════════════════════════
// OSM Road Import via Overpass API
// Downloads major roads and highways for the Southern Ontario corridor
// and inserts them as road_node + road_segment records.
// ═══════════════════════════════════════════════════════════════

const BBOX = { south: 42.8, west: -81.5, north: 45.0, east: -78.2 };

const HIGHWAY_TYPES = [
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
  'tertiary', 'tertiary_link',
].join('|');

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

interface OsmNode { lat: number; lon: number; }
interface OsmWay {
  type: string; id: number; nodes: number[];
  geometry: OsmNode[]; tags: Record<string, string>;
}
interface OverpassResponse { elements: OsmWay[]; }

function parseMaxspeed(tags: Record<string, string>): number {
  const ms = tags.maxspeed || tags['maxspeed:forward'] || tags['maxspeed:backward'];
  if (!ms) return 50;
  const num = parseInt(ms);
  if (!isNaN(num)) return ms.includes('mph') ? Math.round(num * 1.609) : num;
  return 50;
}

function parseMaxweight(tags: Record<string, string>): number {
  const mw = tags.maxweight || tags['maxweight:forward'] || tags['maxweight:backward'];
  if (!mw) return 40000;
  const num = parseFloat(mw);
  if (!isNaN(num)) {
    if (mw.includes('t') || mw.includes('tonne')) return Math.round(num * 1000);
    if (mw.includes('lb') || mw.includes('lbs')) return Math.round(num * 0.453592);
    return Math.round(num);
  }
  return 40000;
}

async function fetchOverpass(): Promise<OsmWay[]> {
  const q = `[out:json][timeout:300];
(
  way["highway"~"^(${HIGHWAY_TYPES})$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out geom;`;

  for (const url of OVERPASS_URLS) {
    console.log(`\u{1F4E1}  Querying Overpass API: ${url}`);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!resp.ok) {
        console.log(`  \u26A0\uFE0F  HTTP ${resp.status}, trying next endpoint...`);
        continue;
      }
      const data = (await resp.json()) as OverpassResponse;
      console.log(`  \u2705 Received ${data.elements.length} ways`);
      return data.elements;
    } catch (err) {
      console.log(`  \u26A0\uFE0F  ${err instanceof Error ? err.message : 'Failed'}, trying next endpoint...`);
    }
  }
  throw new Error('All Overpass API endpoints failed');
}

async function importOsm() {
  console.log('\u2550'.repeat(55));
  console.log('  Truckmafia \u2014 OSM Road Import (Overpass API)');
  console.log('\u2550'.repeat(55));
  console.log(`  BBox: ${BBOX.south},${BBOX.west} \u2192 ${BBOX.north},${BBOX.east}`);
  console.log(`  Road types: ${HIGHWAY_TYPES}`);
  console.log('');

  // ── Clear existing road data ─────────────────────────────────
  console.log('\u{1F5D1}\uFE0F  Clearing existing road data...');
  await query('DELETE FROM road_segment_traversal');
  await query('DELETE FROM road_event');
  await query('DELETE FROM road_segment');
  await query('DELETE FROM road_node');
  console.log('  \u2705 Cleared');

  // ── Fetch from Overpass ──────────────────────────────────────
  const ways = await fetchOverpass();
  if (ways.length === 0) {
    console.log('\u274C No ways returned from Overpass');
    await pool.end();
    return;
  }

  // ── Collect all unique nodes ─────────────────────────────────
  console.log('\n\u{1F4CD} Collecting unique nodes...');
  const nodeMap = new Map<number, { lat: number; lon: number }>();

  for (const way of ways) {
    for (let i = 0; i < way.nodes.length; i++) {
      const osmId = way.nodes[i];
      const geom = way.geometry[i];
      if (osmId && geom && !nodeMap.has(osmId)) {
        nodeMap.set(osmId, { lat: geom.lat, lon: geom.lon });
      }
    }
  }
  console.log(`  \u2705 ${nodeMap.size} unique nodes`);

  // ── Batch insert nodes using parameterized VALUES ───────────
  console.log('\n\u{1F4DD} Inserting road nodes...');
  const nodeIdMap = new Map<number, string>();
  const allNodeEntries = [...nodeMap.entries()];
  const NODE_BATCH = 2000; // keep param count under 65535 (2000*3=6000)

  for (let i = 0; i < allNodeEntries.length; i += NODE_BATCH) {
    const batch = allNodeEntries.slice(i, i + NODE_BATCH);
    const placeholders = batch.map((_, idx) =>
      `($${idx * 3 + 1}::bigint, ST_SetSRID(ST_MakePoint($${idx * 3 + 2}, $${idx * 3 + 3}), 4326)::geography)`
    ).join(', ');
    const params = batch.flatMap(([, pos]) => [0, pos.lon, pos.lat]); // placeholder 0, will set osm_id separately

    // Actually we need osm_id too — rebuild with proper values
    const values: unknown[] = [];
    const phs: string[] = [];
    batch.forEach(([osmId, pos], idx) => {
      const base = idx * 3;
      phs.push(`($${base + 1}::bigint, ST_SetSRID(ST_MakePoint($${base + 2}::double precision, $${base + 3}::double precision), 4326)::geography)`);
      values.push(osmId, pos.lon, pos.lat);
    });

    const sql = `INSERT INTO road_node (osm_node_id, location) VALUES ${phs.join(', ')}
                 ON CONFLICT (osm_node_id) WHERE osm_node_id IS NOT NULL
                 DO UPDATE SET osm_node_id = EXCLUDED.osm_node_id
                 RETURNING osm_node_id, id`;
    const rows = await query<{ osm_node_id: string | number; id: string }>(sql, values);
    for (const r of rows) nodeIdMap.set(Number(r.osm_node_id), r.id);
    process.stdout.write(`\r  ${Math.min(i + NODE_BATCH, allNodeEntries.length)}/${allNodeEntries.length} nodes processed`);
  }

  // Fetch any nodes that were already present
  const missing = [...nodeMap.keys()].filter((id) => !nodeIdMap.has(id));
  if (missing.length > 0) {
    console.log(`\n  \u{1F4CE} Fetching ${missing.length} existing node IDs...`);
    for (let i = 0; i < missing.length; i += 1000) {
      const batch = missing.slice(i, i + 1000);
      const rows = await query<{ osm_node_id: string | number; id: string }>(
        'SELECT osm_node_id, id FROM road_node WHERE osm_node_id = ANY($1::bigint[])',
        [batch]
      );
      for (const r of rows) nodeIdMap.set(Number(r.osm_node_id), r.id);
    }
  }
  console.log(`\r  \u2705 ${nodeIdMap.size} nodes ready                    `);

  // ── Insert road segments ────────────────────────────────────
  console.log('\n\u{1F6E3}\uFE0F  Inserting road segments...');
  let segCount = 0;
  let wayProcessed = 0;

  interface SegRow {
    wkt: string; maxspeed: number; maxweight: number;
    hwType: string; fromId: string; toId: string; osmWayId: number; name: string | null;
  }
  let segBatch: SegRow[] = [];
  const SEG_BATCH = 500; // 8 params each = 4000 max

  async function flushSegments() {
    if (segBatch.length === 0) return;
    const phs: string[] = [];
    const values: unknown[] = [];
    segBatch.forEach((s, idx) => {
      const b = idx * 8;
      phs.push(`($${b + 1}, $${b + 2}::int, $${b + 3}::int, $${b + 4}, $${b + 5}::uuid, $${b + 6}::uuid, $${b + 7}::bigint, $${b + 8})`);
      values.push(s.wkt, s.maxspeed, s.maxweight, s.hwType, s.fromId, s.toId, s.osmWayId, s.name);
    });
    const sql = `INSERT INTO road_segment (geometry, maxspeed_km, maxweight_kg, length_m, highway_type, from_node, to_node, osm_way_id, name)
                 SELECT ST_GeomFromText(v.geom, 4326), v.ms, v.mw,
                        ST_Length(ST_GeomFromText(v.geom, 4326)::geography)::int,
                        v.ht, v.fn, v.tn, v.ow, v.nm
                 FROM (VALUES ${phs.join(', ')}) AS v(geom, ms, mw, ht, fn, tn, ow, nm)`;
    await query(sql, values);
    segCount += segBatch.length;
    segBatch = [];
  }

  for (const way of ways) {
    const hwType = way.tags.highway || 'residential';
    const maxspeed = parseMaxspeed(way.tags);
    const maxweight = parseMaxweight(way.tags);
    const name = way.tags.name || way.tags.ref || null;
    const osmWayId = way.id;

    for (let i = 0; i < way.nodes.length - 1; i++) {
      const fromId = nodeIdMap.get(way.nodes[i]);
      const toId = nodeIdMap.get(way.nodes[i + 1]);
      const fromGeom = way.geometry[i];
      const toGeom = way.geometry[i + 1];
      if (!fromId || !toId || !fromGeom || !toGeom) continue;

      const wkt = `SRID=4326;LINESTRING(${fromGeom.lon} ${fromGeom.lat}, ${toGeom.lon} ${toGeom.lat})`;
      segBatch.push({ wkt, maxspeed, maxweight, hwType, fromId, toId, osmWayId, name });

      if (segBatch.length >= SEG_BATCH) {
        await flushSegments();
      }
    }

    wayProcessed++;
    if (wayProcessed % 2000 === 0) {
      process.stdout.write(`\r  ${wayProcessed}/${ways.length} ways processed, ${segCount} segments`);
    }
  }
  await flushSegments();

  console.log(`\r  \u2705 ${segCount} road segments from ${ways.length} ways           `);

  // ── Stats ────────────────────────────────────────────────────
  const stats = await queryOne<{ nodes: string; segments: string; routable: string }>(
    `SELECT
      (SELECT COUNT(*) FROM road_node)::text AS nodes,
      (SELECT COUNT(*) FROM road_segment)::text AS segments,
      (SELECT COUNT(*) FROM road_segment WHERE from_node IS NOT NULL AND to_node IS NOT NULL)::text AS routable`
  );

  console.log('\n' + '\u2550'.repeat(55));
  console.log('  \u2705 OSM Import Complete!');
  console.log('\u2550'.repeat(55));
  console.log(`  Nodes:     ${stats?.nodes}`);
  console.log(`  Segments:  ${stats?.segments}`);
  console.log(`  Routable:  ${stats?.routable}`);
  console.log('');

  await pool.end();
}

importOsm().catch((err) => {
  console.error('\n\u274C Import failed:', err);
  pool.end();
  process.exit(1);
});
