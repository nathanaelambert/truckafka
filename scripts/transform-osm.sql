-- ═══════════════════════════════════════════════════════════════
-- Transform OSM data (from osm2pgsql) into our road schema
-- Creates road_node and road_segment records from OSM ways
-- ═══════════════════════════════════════════════════════════════

-- Clear existing road data (but keep synthetic data if no OSM import yet)
DELETE FROM road_segment_traversal;
DELETE FROM road_event;
DELETE FROM road_segment WHERE osm_way_id IS NOT NULL;
DELETE FROM road_node WHERE osm_node_id IS NOT NULL;

-- ── Step 1: Create road nodes from OSM way endpoints ─────────
-- osm2pgsql stores ways in planet_osm_line with osm_id
-- We extract the start and end points of each road way

INSERT INTO road_node (location, osm_node_id, osm_version)
SELECT DISTINCT ON (osm_id)
  ST_StartPoint(way)::geography AS location,
  NULL AS osm_node_id,
  NULL AS osm_version
FROM planet_osm_line
WHERE highway IS NOT NULL
  AND osm_id > 0;

-- Also insert end points
INSERT INTO road_node (location, osm_node_id, osm_version)
SELECT DISTINCT ON (osm_id)
  ST_EndPoint(way)::geography AS location,
  NULL,
  NULL
FROM planet_osm_line
WHERE highway IS NOT NULL
  AND osm_id > 0
ON CONFLICT DO NOTHING;

-- ── Step 2: Create road segments from OSM ways ───────────────
-- Parse maxspeed and maxweight from OSM tags

INSERT INTO road_segment (geometry, maxspeed_km, maxweight_kg, length_m, highway_type, from_node, to_node, osm_way_id, name)
SELECT
  way AS geometry,
  COALESCE(
    CASE
      WHEN planet_osm_line.maxspeed ~ '^[0-9]+$' THEN CAST(planet_osm_line.maxspeed AS SMALLINT)
      WHEN planet_osm_line.maxspeed ~ '^[0-9]+ mph$' THEN CAST(SPLIT_PART(planet_osm_line.maxspeed, ' ', 1) AS SMALLINT) * 1.609
      ELSE 50
    END,
    50
  ) AS maxspeed_km,
  COALESCE(
    CASE
      WHEN planet_osm_line.maxweight ~ '^[0-9]+$' THEN CAST(planet_osm_line.maxweight AS INTEGER) * 1000
      WHEN planet_osm_line.maxweight ~ '^[0-9.]+ tonnes?$' THEN CAST(SPLIT_PART(planet_osm_line.maxweight, ' ', 1) AS FLOAT) * 1000
      WHEN planet_osm_line.maxweight ~ '^[0-9.]+ t$' THEN CAST(SPLIT_PART(planet_osm_line.maxweight, ' ', 1) AS FLOAT) * 1000
      ELSE 40000
    END,
    40000
  ) AS maxweight_kg,
  ST_Length(way::geography)::INTEGER AS length_m,
  COALESCE(planet_osm_line.highway, 'residential') AS highway_type,
  fn.id AS from_node,
  tn.id AS to_node,
  planet_osm_line.osm_id AS osm_way_id,
  planet_osm_line.name
FROM planet_osm_line
LEFT JOIN road_node fn ON ST_Equals(fn.location::geometry, ST_StartPoint(planet_osm_line.way))
LEFT JOIN road_node tn ON ST_Equals(tn.location::geometry, ST_EndPoint(planet_osm_line.way))
WHERE planet_osm_line.highway IS NOT NULL
  AND planet_osm_line.osm_id > 0
  AND ST_GeometryType(planet_osm_line.way) = 'ST_LineString';

-- ── Step 3: Merge nearby nodes (simplify graph) ──────────────
-- Create a mapping of nearby nodes to a canonical node
-- This helps with intersection matching for routing

CREATE TEMP TABLE node_merge AS
SELECT
  n1.id AS node_id,
  n1.id AS canonical_id
FROM road_node n1;

-- For nodes within 5 meters of each other, merge to the lower id
UPDATE node_merge nm
SET canonical_id = sub.canonical_id
FROM (
  SELECT
    n1.id AS node_id,
    MIN(n2.id) AS canonical_id
  FROM road_node n1
  JOIN road_node n2 ON
    n1.id > n2.id
    AND ST_DWithin(n1.location, n2.location, 5)
  GROUP BY n1.id
) sub
WHERE nm.node_id = sub.node_id;

-- Update road segments to use canonical node ids
UPDATE road_segment rs
SET from_node = nm.canonical_id
FROM node_merge nm
WHERE rs.from_node = nm.node_id;

UPDATE road_segment rs
SET to_node = nm.canonical_id
FROM node_merge nm
WHERE rs.to_node = nm.node_id;

-- ── Stats ────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM road_node) AS total_nodes,
  (SELECT COUNT(*) FROM road_segment) AS total_segments,
  (SELECT COUNT(*) FROM road_segment WHERE from_node IS NOT NULL AND to_node IS NOT NULL) AS routable_segments;
