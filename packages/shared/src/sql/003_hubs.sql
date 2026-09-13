-- ═══════════════════════════════════════════════════════════════
-- 003_hubs.sql — Hub flag on locations
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE location ADD COLUMN IF NOT EXISTS is_hub BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_location_is_hub ON location (is_hub) WHERE is_hub = true;
