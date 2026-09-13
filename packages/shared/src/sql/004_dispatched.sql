-- ═══════════════════════════════════════════════════════════════
-- 004_dispatched.sql — Rename 'assigned' to 'dispatched'
-- ═══════════════════════════════════════════════════════════════

-- Add 'dispatched' to event_status enum
ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'dispatched';

-- Migrate existing data
UPDATE event SET status = 'dispatched' WHERE status = 'assigned';
UPDATE "order" SET status = 'dispatched' WHERE status = 'assigned';
