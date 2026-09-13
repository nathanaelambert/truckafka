-- ═══════════════════════════════════════════════════════════════
-- 005_road_events_v2.sql — Multi-segment road events
-- ═══════════════════════════════════════════════════════════════

-- Add new columns to road_event
ALTER TABLE road_event ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE road_event ADD COLUMN IF NOT EXISTS is_usable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE road_event ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Make road_segment_id nullable (events can span multiple segments via junction table)
ALTER TABLE road_event ALTER COLUMN road_segment_id DROP NOT NULL;

-- Add trigger for updated_at
CREATE TRIGGER trg_road_event_updated BEFORE UPDATE ON road_event
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Junction table: road_event ↔ road_segment (many-to-many)
CREATE TABLE IF NOT EXISTS road_event_segment (
    road_event_id   UUID NOT NULL REFERENCES road_event(id) ON DELETE CASCADE,
    road_segment_id UUID NOT NULL REFERENCES road_segment(id) ON DELETE CASCADE,
    PRIMARY KEY (road_event_id, road_segment_id)
);
