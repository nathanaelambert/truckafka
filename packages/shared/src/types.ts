// ═══════════════════════════════════════════════════════════════
// Shared domain types — used across all microservices
// ═══════════════════════════════════════════════════════════════

export type UserRole = 'admin' | 'dispatcher' | 'driver';
export type TruckStatus = 'at_hub' | 'on_move' | 'maintenance';
export type TrailerStatus = 'at_hub' | 'loaded' | 'empty' | 'maintenance';
export type HaulStatus = 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type DriverStatus = 'off_duty' | 'on_duty_not_driving' | 'driving';
export type RoadEventType = 'traffic_jam' | 'construction' | 'accident' | 'weather' | 'other';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Geofence {
  id: string;
  name?: string;
  boundary: GeoPoint[];
}

export interface Location {
  id: string;
  name: string;
  position: GeoPoint;
  geofence_id?: string;
  address?: string;
}

export interface Truck {
  id: string;
  number: string;
  status: TruckStatus;
  is_safe_to_drive: boolean;
  maxweight_kg: number;
  note?: string;
  location_id?: string;
  hub: string;
}

export interface Trailer {
  id: string;
  number: string;
  status: TrailerStatus;
  is_safe_to_drive: boolean;
  maxweight_kg: number;
  note?: string;
  location_id?: string;
  hub: string;
}

export interface Driver {
  id: string;
  name: string;
  email?: string;
  status: DriverStatus;
  home_location_id?: string;
  cycle_id: number;
  overtime: number;
  day_start_hour: string;
}

export interface HoursOfService {
  driver_id: string;
  cycle_start?: string;
  shift_start?: string;
  next_bed_time?: string;
  remaining_cycle_h: number;
  remaining_on_duty_h: number;
  remaining_drive_h: number;
  until_break_h: number;
  breaks_remaining: number;
  break_started?: string;
  slept_today: boolean;
}

export interface Load {
  id: string;
  number: string;
  weight: number;
  commodity?: string;
  pickup_location_id: string;
  pickup_phone: string;
  pickup_after: string;
  pickup_before: string;
  dropoff_location_id: string;
  dropoff_phone: string;
  dropoff_after: string;
  dropoff_before: string;
  multi_stop_id?: string;
  is_hazmat: boolean;
  detention_rate: number;
  rate_km?: number;
  note?: string;
}

export interface Haul {
  id: string;
  load_id: string;
  driver_id: string;
  truck_id: string;
  trailer_id: string;
  started_at: string;
  ended_at: string;
  status: HaulStatus;
  is_draft: boolean;
  is_active: boolean;
}

export interface RoadSegment {
  id: string;
  geometry: GeoPoint[];
  maxspeed_km: number;
  maxweight_kg: number;
  length_m: number;
  highway_type: string;
  from_node?: string;
  to_node?: string;
  name?: string;
}

export interface RoadEvent {
  id: string;
  road_segment_id: string;
  event_type: RoadEventType;
  maxspeed_km?: number;
  maxweight_kg?: number;
  note?: string;
  start_at: string;
  end_at?: string;
}

export interface User {
  id: string;
  user_name: string;
  name?: string;
  role: UserRole;
  driver_id?: string;
}

export interface AuthToken {
  userId: string;
  role: UserRole;
  driverId?: string;
}

// ── Kafka Event Topics ─────────────────────────────────────────

export const KafkaTopics = {
  FLEET_EVENTS: 'fleet.events',
  LOAD_EVENTS: 'load.events',
  TRACKING_EVENTS: 'tracking.events',
  HOS_EVENTS: 'hos.events',
  DRIVER_EVENTS: 'driver.events',
  ROAD_EVENTS: 'road.events',
  ORDER_EVENTS: 'order.events',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

export interface KafkaEvent<T = unknown> {
  topic: string;
  key: string;
  value: T;
  timestamp: string;
}

export type FleetEvent =
  | { type: 'truck_created' | 'truck_updated' | 'truck_deleted'; payload: { id: string } }
  | { type: 'trailer_created' | 'trailer_updated' | 'trailer_deleted'; payload: { id: string } }
  | { type: 'driver_created' | 'driver_updated' | 'driver_deleted'; payload: { id: string } }
  | { type: 'location_created' | 'location_updated' | 'location_deleted'; payload: { id: string } };

export type LoadEvent =
  | { type: 'load_created' | 'load_updated' | 'load_deleted'; payload: { id: string } }
  | { type: 'haul_created' | 'haul_updated' | 'haul_deleted' | 'haul_submitted'; payload: { id: string } };

export type TrackingEvent =
  | { type: 'position_update'; payload: { truck_id: string; lat: number; lng: number; heading: number; speed_kmh: number; measured_at: string } }
  | { type: 'driver_status_change'; payload: { driver_id: string; status: DriverStatus; recorded_at: string } };

export type HOSEvent =
  | { type: 'hos_updated'; payload: { driver_id: string } }
  | { type: 'hos_violation'; payload: { driver_id: string; message: string } }
  | { type: 'hos_overtime'; payload: { driver_id: string; message: string } };

// ── API Response wrappers ───────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface PositionUpdate {
  truck_id: string;
  driver_id?: string;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
  measured_at: string;
}

export interface ItinerarySegment {
  road_segment_id: string;
  sequence: number;
  geometry: GeoPoint[];
  length_m: number;
  maxspeed_km: number;
  estimated_time_s: number;
}

export interface Itinerary {
  haul_id: string;
  segments: ItinerarySegment[];
  total_distance_m: number;
  total_time_s: number;
  geometry: GeoPoint[];
}

export interface FleetSummary {
  total_trucks: number;
  total_trailers: number;
  total_drivers: number;
  drivers_in_service: number;
  drivers_off_duty: number;
  trucks_on_move: number;
  trucks_london: number;
  trucks_milton: number;
  trailers_london: number;
  trailers_milton: number;
}
