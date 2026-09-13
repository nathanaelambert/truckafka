-- ═══════════════════════════════════════════════════════════════
-- 007_detention.sql — Detention log
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS detention_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        UUID NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
    load_id         UUID NOT NULL REFERENCES load(id) ON DELETE CASCADE,
    event_id        UUID,
    event_type      VARCHAR(50) NOT NULL,
    phone           VARCHAR(50) NOT NULL,
    location_id     UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    truck_id        UUID,
    driver_id       UUID,
    trailer_id      UUID,
    detention_time  TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_detention_order ON detention_log (order_id);
CREATE INDEX IF NOT EXISTS idx_detention_load ON detention_log (load_id);
CREATE INDEX IF NOT EXISTS idx_detention_time ON detention_log (detention_time);
