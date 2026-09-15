import { pool, query } from './db.js';
import { randomUUID } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════
// Synthetic road graph seeder — generates a realistic road network
// for A* router benchmarking.
//
// Creates a city grid (local roads) + highway corridors, centered
// on Toronto.  ~3,600 nodes, ~7,200 segments.
// ═══════════════════════════════════════════════════════════════

const GRID_SIZE = 60;
const CENTER_LAT = 43.65;
const CENTER_LNG = -79.38;
const SPACING = 0.006; // ~600 m between adjacent nodes

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function gridLat(row: number): number {
  return CENTER_LAT + (row - (GRID_SIZE - 1) / 2) * SPACING;
}
function gridLng(col: number): number {
  return CENTER_LNG + (col - (GRID_SIZE - 1) / 2) * SPACING;
}

interface NodeDef {
  id: string;
  row: number;
  col: number;
  lat: number;
  lng: number;
  osmId: number;
}

interface SegDef {
  fromId: string;
  toId: string;
  lat1: number; lng1: number;
  lat2: number; lng2: number;
  length: number;
  maxspeed: number;
  highwayType: string;
  name: string;
  osmWayId: number;
}

async function seedRoadGraph() {
  console.log('Seeding synthetic road graph...\n');

  // ── Clear existing road data ────────────────────────────────
  await query('DELETE FROM road_segment_traversal');
  await query('DELETE FROM road_event_segment');
  await query('DELETE FROM road_event');
  await query('DELETE FROM road_segment');
  await query('DELETE FROM road_node');
  console.log('  Cleared existing road data');

  // ── Generate nodes ──────────────────────────────────────────
  const nodes: NodeDef[] = [];
  let osmCounter = 1_000_000;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      nodes.push({
        id: randomUUID(),
        row,
        col,
        lat: gridLat(row),
        lng: gridLng(col),
        osmId: osmCounter++,
      });
    }
  }

  const nodeMap = new Map<string, NodeDef>();
  for (const n of nodes) {
    nodeMap.set(`${n.row},${n.col}`, n);
  }

  // ── Batch-insert nodes (200 per batch) ─────────────────────
  const BATCH = 200;
  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);
    const values = batch.map((_, j) =>
      `($${j * 4 + 1}::uuid, ST_SetSRID(ST_MakePoint($${j * 4 + 2}, $${j * 4 + 3}), 4326)::geography, $${j * 4 + 4}, now())`
    ).join(', ');
    const params: unknown[] = [];
    for (const n of batch) {
      params.push(n.id, n.lng, n.lat, n.osmId);
    }
    await query(
      `INSERT INTO road_node (id, location, osm_node_id, created_at) VALUES ${values}`,
      params
    );
  }
  console.log(`  Inserted ${nodes.length} road nodes`);

  // ── Generate segments ─────────────────────────────────────
  const segments: SegDef[] = [];
  let wayCounter = 500_000;

  const isHighwayRow = (row: number) => row === Math.floor(GRID_SIZE / 2);
  const isHighwayCol = (col: number) => col === Math.floor(GRID_SIZE / 2);

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const from = nodeMap.get(`${row},${col}`)!;

      // Horizontal neighbor
      if (col < GRID_SIZE - 1) {
        const to = nodeMap.get(`${row},${col + 1}`)!;
        const isHwy = isHighwayRow(row);
        segments.push({
          fromId: from.id, toId: to.id,
          lat1: from.lat, lng1: from.lng, lat2: to.lat, lng2: to.lng,
          length: Math.round(haversine(from.lat, from.lng, to.lat, to.lng)),
          maxspeed: isHwy ? 100 : 50,
          highwayType: isHwy ? 'motorway' : 'residential',
          name: isHwy ? 'Highway 401' : 'Local Road',
          osmWayId: wayCounter++,
        });
      }

      // Vertical neighbor
      if (row < GRID_SIZE - 1) {
        const to = nodeMap.get(`${row + 1},${col}`)!;
        const isHwy = isHighwayCol(col);
        segments.push({
          fromId: from.id, toId: to.id,
          lat1: from.lat, lng1: from.lng, lat2: to.lat, lng2: to.lng,
          length: Math.round(haversine(from.lat, from.lng, to.lat, to.lng)),
          maxspeed: isHwy ? 100 : 50,
          highwayType: isHwy ? 'motorway' : 'residential',
          name: isHwy ? 'Highway 400' : 'Local Road',
          osmWayId: wayCounter++,
        });
      }
    }
  }

  // ── Batch-insert segments ──────────────────────────────────
  for (let i = 0; i < segments.length; i += BATCH) {
    const batch = segments.slice(i, i + BATCH);
    const values = batch.map((_, j) => {
      const b = j * 12;
      return `(ST_SetSRID(ST_MakeLine(ST_MakePoint($${b + 1}, $${b + 2}), ST_MakePoint($${b + 3}, $${b + 4})), 4326),
               $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::uuid, $${b + 10}::uuid, $${b + 11}, $${b + 12}, false, now())`;
    }).join(', ');
    const params: unknown[] = [];
    for (const s of batch) {
      params.push(s.lng1, s.lat1, s.lng2, s.lat2,
        s.maxspeed, 40000, s.length, s.highwayType,
        s.fromId, s.toId, s.osmWayId, s.name);
    }
    await query(
      `INSERT INTO road_segment (geometry, maxspeed_km, maxweight_kg, length_m, highway_type,
         from_node, to_node, osm_way_id, name, oneway, loaded_at)
       VALUES ${values}`,
      params
    );
  }
  console.log(`  Inserted ${segments.length} road segments`);

  // ── Add a few road events for realism ──────────────────────
  const eventSegs = segments.filter(s => s.highwayType === 'motorway').slice(0, 5);
  for (let i = 0; i < eventSegs.length; i++) {
    const seg = eventSegs[i];
    const segRow = await query<{ id: string }>(
      `SELECT id FROM road_segment WHERE from_node = $1 AND to_node = $2 LIMIT 1`,
      [seg.fromId, seg.toId]
    );
    if (segRow.length > 0) {
      await query(
        `INSERT INTO road_event (road_segment_id, event_type, maxspeed_km, is_usable, start_at, end_at)
         VALUES ($1, $2, $3, $4, now(), now() + interval '6 hours')`,
        [segRow[0].id, i < 2 ? 'construction' : 'traffic_jam', 40, true]
      );
    }
  }
  console.log(`  Inserted ${eventSegs.length} road events`);

  // ── Summary ────────────────────────────────────────────────
  const nodeCount = await query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM road_node');
  const segCount = await query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM road_segment');
  console.log(`\n  Graph: ${nodeCount[0].cnt} nodes, ${segCount[0].cnt} segments`);
  console.log('\nSeed complete!');

  await pool.end();
}

seedRoadGraph().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
