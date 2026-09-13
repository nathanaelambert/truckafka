-- ═══════════════════════════════════════════════════════════════
-- Truckmafia — Core Schema
-- PostGIS extension + all domain tables per README data model
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'dispatcher', 'driver');
CREATE TYPE truck_status AS ENUM ('at_hub', 'on_move', 'maintenance');
CREATE TYPE trailer_status AS ENUM ('at_hub', 'loaded', 'empty', 'maintenance');
CREATE TYPE haul_status AS ENUM ('draft', 'assigned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE driver_status AS ENUM ('off_duty', 'on_duty_not_driving', 'driving');
CREATE TYPE road_event_type AS ENUM ('traffic_jam', 'construction', 'accident', 'weather', 'other');

-- ── geofence ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS geofence (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    boundary    geography(Polygon, 4326) NOT NULL,
    name        VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── location ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS location (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(255) NOT NULL,
    position     geography(Point, 4326) NOT NULL,
    geofence_id  UUID REFERENCES geofence(id) ON DELETE SET NULL,
    address      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_position ON location USING GIST (position);

-- ── road_node ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS road_node (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location      geography(Point, 4326) NOT NULL,
    osm_node_id   BIGINT,
    osm_version   INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_road_node_location ON road_node USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_road_node_osm ON road_node (osm_node_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_road_node_osm_unique ON road_node (osm_node_id) WHERE osm_node_id IS NOT NULL;

-- ── road_segment ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS road_segment (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    geometry      geometry(LineString, 4326) NOT NULL,
    maxspeed_km   SMALLINT NOT NULL DEFAULT 50,
    maxweight_kg  INTEGER NOT NULL DEFAULT 40000,
    length_m      INTEGER NOT NULL DEFAULT 0,
    highway_type  VARCHAR(50) NOT NULL DEFAULT 'residential',
    from_node     UUID REFERENCES road_node(id) ON DELETE SET NULL,
    to_node       UUID REFERENCES road_node(id) ON DELETE SET NULL,
    osm_way_id    BIGINT,
    name          VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_road_segment_geom ON road_segment USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_road_segment_from ON road_segment (from_node);
CREATE INDEX IF NOT EXISTS idx_road_segment_to ON road_segment (to_node);

-- ── road_segment_traversal (haul itinerary) — created after haul below ──

-- ── road_event ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS road_event (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    road_segment_id  UUID NOT NULL REFERENCES road_segment(id) ON DELETE CASCADE,
    event_type       road_event_type NOT NULL DEFAULT 'other',
    maxspeed_km      SMALLINT,
    maxweight_kg     INTEGER,
    note             TEXT,
    start_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_at           TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_road_event_segment ON road_event (road_segment_id);
CREATE INDEX IF NOT EXISTS idx_road_event_time ON road_event (start_at, end_at);

-- ── truck ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS truck (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number          VARCHAR(4) NOT NULL UNIQUE,
    status          truck_status NOT NULL DEFAULT 'at_hub',
    is_safe_to_drive BOOLEAN NOT NULL DEFAULT true,
    maxweight_kg    INTEGER NOT NULL DEFAULT 40000,
    note            TEXT,
    location_id     UUID REFERENCES location(id) ON DELETE SET NULL,
    hub             VARCHAR(50) DEFAULT 'london',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── trailer ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trailer (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number          VARCHAR(6) NOT NULL UNIQUE,
    status          trailer_status NOT NULL DEFAULT 'empty',
    is_safe_to_drive BOOLEAN NOT NULL DEFAULT true,
    maxweight_kg    INTEGER NOT NULL DEFAULT 20000,
    note            TEXT,
    location_id     UUID REFERENCES location(id) ON DELETE SET NULL,
    hub             VARCHAR(50) DEFAULT 'london',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── driver ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS driver (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              VARCHAR(255) NOT NULL,
    email             VARCHAR(255),
    status            driver_status NOT NULL DEFAULT 'off_duty',
    home_location_id  UUID REFERENCES location(id) ON DELETE SET NULL,
    cycle_id          SMALLINT NOT NULL DEFAULT 1,
    overtime          SMALLINT NOT NULL DEFAULT 10,
    day_start_hour    TIME NOT NULL DEFAULT '00:00',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── hours_of_service ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hours_of_service (
    driver_id          UUID PRIMARY KEY REFERENCES driver(id) ON DELETE CASCADE,
    cycle_start        TIMESTAMPTZ,
    shift_start        TIMESTAMPTZ,
    next_bed_time      TIMESTAMPTZ,
    remaining_cycle_h  INTEGER NOT NULL DEFAULT 70,
    remaining_on_duty_h INTEGER NOT NULL DEFAULT 14,
    remaining_drive_h  INTEGER NOT NULL DEFAULT 13,
    until_break_h      NUMERIC(5,2) NOT NULL DEFAULT 8,
    breaks_remaining   INTEGER NOT NULL DEFAULT 4,
    break_started      TIMESTAMPTZ,
    slept_today        BOOLEAN NOT NULL DEFAULT false,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── app_user (README: user) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_user (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_name     VARCHAR(255) NOT NULL UNIQUE,
    name          VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role          user_role NOT NULL DEFAULT 'dispatcher',
    driver_id     UUID REFERENCES driver(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── load ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS load (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number             VARCHAR(255) NOT NULL,
    weight             INTEGER DEFAULT 0,
    commodity          VARCHAR(255),
    pickup_location_id UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    pickup_phone       VARCHAR(50) NOT NULL,
    pickup_after       TIMESTAMPTZ NOT NULL,
    pickup_before      TIMESTAMPTZ NOT NULL,
    dropoff_location_id UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    dropoff_phone      VARCHAR(50) NOT NULL,
    dropoff_after      TIMESTAMPTZ NOT NULL,
    dropoff_before     TIMESTAMPTZ NOT NULL,
    multi_stop_id      UUID REFERENCES load(id) ON DELETE SET NULL,
    is_hazmat          BOOLEAN NOT NULL DEFAULT false,
    detention_rate     INTEGER DEFAULT 0,
    rate_km            FLOAT,
    note               TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── haul ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS haul (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id     UUID NOT NULL REFERENCES load(id) ON DELETE CASCADE,
    driver_id   UUID NOT NULL REFERENCES driver(id) ON DELETE RESTRICT,
    truck_id    UUID NOT NULL REFERENCES truck(id) ON DELETE RESTRICT,
    trailer_id  UUID NOT NULL REFERENCES trailer(id) ON DELETE RESTRICT,
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ NOT NULL,
    status      haul_status NOT NULL DEFAULT 'draft',
    is_draft    BOOLEAN NOT NULL DEFAULT false,
    is_active   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_haul_driver ON haul (driver_id);
CREATE INDEX IF NOT EXISTS idx_haul_status ON haul (status);

-- ── road_segment_traversal (haul itinerary) ──────────────────────

CREATE TABLE IF NOT EXISTS road_segment_traversal (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    haul_id          UUID NOT NULL REFERENCES haul(id) ON DELETE CASCADE,
    road_segment_id  UUID NOT NULL REFERENCES road_segment(id) ON DELETE CASCADE,
    sequence         INTEGER NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (haul_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_traversal_haul ON road_segment_traversal (haul_id);

-- ── itinerary (computed route for a load) ──────────────────────

CREATE TABLE IF NOT EXISTS itinerary (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id           UUID NOT NULL REFERENCES load(id) ON DELETE CASCADE,
    path              geometry(LineString, 4326) NOT NULL,
    total_distance_m  INTEGER NOT NULL DEFAULT 0,
    total_time_s      INTEGER NOT NULL DEFAULT 0,
    progress_lat      DOUBLE PRECISION,
    progress_lng      DOUBLE PRECISION,
    progress_time_s   INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (load_id)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_load ON itinerary (load_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_path ON itinerary USING GIST (path);

-- ── position_log (tracking) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS position_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    truck_id    UUID NOT NULL REFERENCES truck(id) ON DELETE CASCADE,
    driver_id   UUID REFERENCES driver(id) ON DELETE SET NULL,
    position    geography(Point, 4326) NOT NULL,
    heading     FLOAT,
    speed_kmh   FLOAT,
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_position_truck ON position_log (truck_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_position_geom ON position_log USING GIST (position);

-- ── driver_status_log (HOS events) ────────────────────────────

CREATE TABLE IF NOT EXISTS driver_status_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id   UUID NOT NULL REFERENCES driver(id) ON DELETE CASCADE,
    status      driver_status NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_status_log_driver ON driver_status_log (driver_id, recorded_at DESC);

-- ── updated_at trigger ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_truck_updated   BEFORE UPDATE ON truck   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_trailer_updated BEFORE UPDATE ON trailer FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_driver_updated  BEFORE UPDATE ON driver  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_load_updated    BEFORE UPDATE ON load    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_haul_updated    BEFORE UPDATE ON haul    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_hos_updated     BEFORE UPDATE ON hours_of_service FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_itinerary_updated BEFORE UPDATE ON itinerary FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- Convenience views
-- ═══════════════════════════════════════════════════════════════

-- Latest position per truck
CREATE OR REPLACE VIEW v_latest_position AS
SELECT DISTINCT ON (truck_id)
    truck_id,
    position,
    heading,
    speed_kmh,
    measured_at
FROM position_log
ORDER BY truck_id, measured_at DESC;

-- Fleet summary
CREATE OR REPLACE VIEW v_fleet_summary AS
SELECT
    (SELECT COUNT(*) FROM truck)   AS total_trucks,
    (SELECT COUNT(*) FROM trailer) AS total_trailers,
    (SELECT COUNT(*) FROM driver)  AS total_drivers,
    (SELECT COUNT(*) FROM driver WHERE status = 'on_duty_not_driving' OR status = 'driving') AS drivers_in_service,
    (SELECT COUNT(*) FROM driver WHERE status = 'off_duty') AS drivers_off_duty,
    (SELECT COUNT(*) FROM truck WHERE status = 'on_move') AS trucks_on_move,
    (SELECT COUNT(*) FROM truck WHERE hub = 'london' AND status = 'at_hub') AS trucks_london,
    (SELECT COUNT(*) FROM truck WHERE hub = 'milton' AND status = 'at_hub') AS trucks_milton,
    (SELECT COUNT(*) FROM trailer WHERE hub = 'london') AS trailers_london,
    (SELECT COUNT(*) FROM trailer WHERE hub = 'milton') AS trailers_milton;

-- ── trajectory_segment (compressed space-time data) ───────────
-- Stationary: waypoints = [{t, lat, lng}] (single point, start_time..end_time)
-- Moving: waypoints = [{t, lat, lng}, ...] (interpolated path)
-- Bound: bound_to_type/bound_to_id reference the source element's trajectory

CREATE TABLE IF NOT EXISTS trajectory_segment (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    element_type    VARCHAR(50) NOT NULL,
    element_id      UUID NOT NULL,
    segment_type    VARCHAR(50) NOT NULL DEFAULT 'stationary',
    event_type      VARCHAR(50),
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    waypoints       JSONB,
    bound_to_type   VARCHAR(50),
    bound_to_id     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traj_element ON trajectory_segment (element_type, element_id);
CREATE INDEX IF NOT EXISTS idx_traj_time ON trajectory_segment (start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_traj_bound ON trajectory_segment (bound_to_type, bound_to_id);

-- ── motion (timed path through space) ───────────────────────

CREATE TABLE IF NOT EXISTS motion (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    path            geometry(LineString, 4326) NOT NULL,
    distance_m      INTEGER NOT NULL DEFAULT 0,
    duration_s      INTEGER NOT NULL DEFAULT 0,
    waypoints       JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_motion_path ON motion USING GIST (path);

-- ── event ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    truck_id            UUID REFERENCES truck(id) ON DELETE SET NULL,
    load_id             UUID REFERENCES load(id) ON DELETE SET NULL,
    trailer_id          UUID REFERENCES trailer(id) ON DELETE SET NULL,
    driver_id           UUID REFERENCES driver(id) ON DELETE SET NULL,
    start_location_id   UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    end_location_id     UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    type                VARCHAR(50) NOT NULL,
    motion_id           UUID REFERENCES motion(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_truck ON event (truck_id);
CREATE INDEX IF NOT EXISTS idx_event_load ON event (load_id);
CREATE INDEX IF NOT EXISTS idx_event_trailer ON event (trailer_id);
CREATE INDEX IF NOT EXISTS idx_event_driver ON event (driver_id);
CREATE INDEX IF NOT EXISTS idx_event_time ON event (start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_event_type ON event (type);
