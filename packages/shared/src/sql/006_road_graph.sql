-- ═══════════════════════════════════════════════════════════════
-- 006_road_graph.sql — Road graph improvements
-- ═══════════════════════════════════════════════════════════════

-- Add geofence_id to road_node (a node inside a geofence links to it)
ALTER TABLE road_node ADD COLUMN IF NOT EXISTS geofence_id UUID REFERENCES geofence(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_road_node_geofence ON road_node (geofence_id) WHERE geofence_id IS NOT NULL;

-- Add node_id to geofence (every geofence has exactly one node)
ALTER TABLE geofence ADD COLUMN IF NOT EXISTS node_id UUID REFERENCES road_node(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_geofence_node ON geofence (node_id) WHERE node_id IS NOT NULL;

-- Add oneway column to road_segment (for directed graph)
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS oneway BOOLEAN NOT NULL DEFAULT true;

-- Add is_loaded column to track which segments have been fetched from OSM
ALTER TABLE road_segment ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ;
