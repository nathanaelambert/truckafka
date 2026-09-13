-- ═══════════════════════════════════════════════════════════════
-- 002_orders.sql — Order table + event status
-- ═══════════════════════════════════════════════════════════════

-- Event status enum
DO $$ BEGIN
  CREATE TYPE event_status AS ENUM ('incoming', 'assigned', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add status column to event table (default 'incoming')
ALTER TABLE event ADD COLUMN IF NOT EXISTS status event_status NOT NULL DEFAULT 'incoming';
CREATE INDEX IF NOT EXISTS idx_event_status ON event (status);

-- ── order ──────────────────────────────────────────────────
-- An order wraps a load + its chained events (loading, haul, idle, unloading)
-- and tracks the dispatch lifecycle independently from the load/haul model.

CREATE TABLE IF NOT EXISTS "order" (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id             UUID NOT NULL REFERENCES load(id) ON DELETE CASCADE,
    haul_id             UUID REFERENCES haul(id) ON DELETE SET NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'incoming',
    events_data         JSONB NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_load ON "order" (load_id);
CREATE INDEX IF NOT EXISTS idx_order_status ON "order" (status);
CREATE INDEX IF NOT EXISTS idx_order_haul ON "order" (haul_id);

CREATE TRIGGER trg_order_updated BEFORE UPDATE ON "order"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
