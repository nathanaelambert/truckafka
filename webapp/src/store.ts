import { create } from 'zustand';
import { api, connectWebSocket } from './api';

export type Page = 'monitor' | 'admin';

interface User {
  id: string;
  user_name: string;
  name: string;
  role: string;
  driver_id?: string;
}

export interface PositionUpdate {
  truck_id: string;
  truck_number?: string;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
  measured_at: string;
}

interface ViewOptions {
  satelliteLayer: boolean;
}

// Per-item visibility: a Set of hidden IDs per type
type HiddenItems = Record<string, Set<string>>;

export interface SelectedElement {
  type: 'truck' | 'trailer' | 'driver' | 'load' | 'haul' | 'location' | 'road_segment' | 'order' | 'road_event';
  id: string;
}

// ── Order types ────────────────────────────────────────────

export type OrderEventType = 'loading' | 'haul' | 'unloading' | 'attach' | 'detach' | 'deadmile' | 'bobtail';
export type EventState = 'incoming' | 'dispatched' | 'completed';
export type OrderStatus = 'incoming' | 'dispatched' | 'completed';

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  start_time: string; // ISO
  end_time: string;   // ISO
  start_location_id: string;
  end_location_id: string;
  truck_id: string | null;
  driver_id: string | null;
  trailer_id: string | null;
  load_id: string;
  status: EventState;
  path?: { lat: number; lng: number }[];
  distance_m?: number;
  duration_s?: number;
}

export interface Order {
  id: string;
  load_id: string;
  load_number: string;
  haul_id?: string;
  status: OrderStatus;
  pickup_location_id: string;
  dropoff_location_id: string;
  pickup_after: string;
  pickup_before: string;
  dropoff_after: string;
  dropoff_before: string;
  weight: number;
  commodity: string;
  is_hazmat: boolean;
  rate_km: number;
  events: OrderEvent[];
}

export interface OrderFormData {
  number: string;
  pickup_location_id: string;
  dropoff_location_id: string;
  pickup_phone: string;
  dropoff_phone: string;
  pickup_after: Date;
  pickup_before: Date;
  dropoff_after: Date;
  dropoff_before: Date;
  weight: number;
  commodity: string;
  is_hazmat: boolean;
  rate_km: number;
}

const HOUR_MS = 3600 * 1000;

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function computeEventState(ev: OrderEvent, hasHaul: boolean, now: Date): EventState {
  if (ev.status) return ev.status;
  if (new Date(ev.end_time).getTime() < now.getTime()) return 'completed';
  if (hasHaul && ev.truck_id && ev.driver_id && ev.trailer_id) return 'dispatched';
  return 'incoming';
}

export function computeOrderStatus(order: Order, now: Date): OrderStatus {
  if (order.status) return order.status;
  const states = order.events.map(ev => computeEventState(ev, !!order.haul_id, now));
  if (states.length > 0 && states.every(s => s === 'completed')) return 'completed';
  if (order.haul_id) return 'dispatched';
  return 'incoming';
}


function sortEventsByTime(events: OrderEvent[]): OrderEvent[] {
  return [...events].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

interface AppState {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  login: (user_name: string, password: string) => Promise<void>;
  logout: () => void;

  // Navigation
  page: Page;
  setPage: (page: Page) => void;

  // Selected element
  selected: SelectedElement | null;
  selectElement: (el: SelectedElement | null) => void;

  // Element placement: staging
  moveToStaging: (el: SelectedElement) => void;

  // View options
  viewOptions: ViewOptions;
  toggleViewOption: (key: keyof ViewOptions) => void;
  hiddenItems: HiddenItems;
  toggleItemVisible: (type: string, id: string) => void;
  setAllVisible: (type: string, ids: string[], visible: boolean) => void;
  isItemHidden: (type: string, id: string) => boolean;

  // Staging area
  stagedItems: SelectedElement[];
  reorderStaging: (from: number, to: number) => void;

  // Drag overlay
  dragItem: SelectedElement | null;
  dragOverStaging: boolean;
  setDragItem: (el: SelectedElement | null) => void;
  setDragOverStaging: (v: boolean) => void;

  // Active map tooltip (which element's tooltip is open on the map)
  activeTooltip: SelectedElement | null;
  setActiveTooltip: (el: SelectedElement | null) => void;
  // Toggle staging for an element (used by map marker clicks)
  toggleStaging: (el: SelectedElement) => void;

  // Selected event (synced between timeline and map)
  selectedEventId: string | null;
  setSelectedEventId: (id: string | null) => void;

  // Cached actor events (for showing current/last activity in actor headers)
  actorEvents: Record<string, { id: string; type: string; start_time: string; end_time: string; start_location_id: string; end_location_id: string; start_location_name: string | null; end_location_name: string | null; truck_id: string | null; driver_id: string | null; trailer_id: string | null; load_id: string | null }[]>;
  refreshActorEvents: () => Promise<void>;

  // View time
  viewTime: Date;
  isLiveTime: boolean;
  setViewTime: (time: Date) => void;
  setLiveTime: () => void;

  // Real-time positions
  positions: Map<string, PositionUpdate>;
  updatePosition: (pos: PositionUpdate) => void;

  // Data
  trucks: Record<string, unknown>[];
  trailers: Record<string, unknown>[];
  drivers: Record<string, unknown>[];
  loads: Record<string, unknown>[];
  hauls: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  fleetSummary: Record<string, number> | null;
  refreshTrucks: () => Promise<void>;
  refreshTrailers: () => Promise<void>;
  refreshDrivers: () => Promise<void>;
  refreshLoads: () => Promise<void>;
  refreshHauls: () => Promise<void>;
  refreshLocations: () => Promise<void>;
  refreshFleetSummary: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // WebSocket
  wsConnected: boolean;
  initWebSocket: () => void;

  // Road events
  roadEvents: Record<string, unknown>[];
  refreshRoadEvents: () => Promise<void>;

  // Orders
  orders: Order[];
  refreshOrders: () => Promise<void>;
  createOrder: (data: OrderFormData) => Promise<void>;
  assignOrder: (orderId: string, truckId: string, driverId: string, trailerId: string) => Promise<void>;
  dispatchOrder: (orderId: string) => Promise<void>;
  splitOrder: (orderId: string, hubLocationId: string) => Promise<void>;
  linkOrders: (order1Id: string, order2Id: string) => Promise<void>;
  moveOrderEvent: (orderId: string, eventId: string, newStartMs: number) => void;
  recomputeEventDuration: (orderId: string, eventId: string) => Promise<void>;
  getOrderEventState: (orderId: string, eventId: string) => EventState;
  getOrderStatus: (orderId: string) => OrderStatus;

  // Linked orders: map of orderId → array of linked order IDs
  linkedOrders: Record<string, string[]>;

  // Timeline visible range (shared with MapView)
  timelineRange: { start: Date; end: Date };
  setTimelineRange: (start: Date, end: Date) => void;

  // Detention alerts
  detentionAlerts: { eventId: string; orderId: string; loadNumber: string; eventType: string; phone: string; locationName: string; time: Date }[];
  checkDetention: () => void;
  dismissDetentionAlert: (index: number) => void;
}


export const useStore = create<AppState>((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────
  user: JSON.parse(localStorage.getItem('tm_user') || 'null'),
  isAuthenticated: !!localStorage.getItem('tm_token'),

  login: async (user_name, password) => {
    const result = await api.login(user_name, password);
    localStorage.setItem('tm_token', result.token);
    localStorage.setItem('tm_user', JSON.stringify(result.user));
    set({ user: result.user, isAuthenticated: true });
    get().initWebSocket();
    await get().refreshAll();
  },

  logout: () => {
    localStorage.removeItem('tm_token');
    localStorage.removeItem('tm_user');
    set({ user: null, isAuthenticated: false });
    window.location.reload();
  },

  // ── Navigation ────────────────────────────────────────────
  page: 'monitor',
  setPage: (page) => set({ page }),

  // ── Selected element ──────────────────────────────────────
  selected: null,

  selectElement: (el) => {
    set({ selected: el });
  },

  moveToStaging: (el) => {
    const state = get();
    const stagedItems = state.stagedItems.some((s) => s.type === el.type && s.id === el.id)
      ? state.stagedItems
      : [...state.stagedItems, el];
    set({ stagedItems, dragItem: null });
  },

  // ── View options ──────────────────────────────────────────
  viewOptions: {
    satelliteLayer: false,
  },
  toggleViewOption: (key) => {
    set((state) => ({
      viewOptions: { ...state.viewOptions, [key]: !state.viewOptions[key] },
    }));
  },
  hiddenItems: {},
  toggleItemVisible: (type, id) => {
    set((state) => {
      const hidden = { ...state.hiddenItems };
      if (!hidden[type]) hidden[type] = new Set();
      const set = new Set(hidden[type]);
      const willHide = !set.has(id);
      if (willHide) set.add(id);
      else set.delete(id);
      hidden[type] = set;

      // Coupled loads/hauls
      if (type === 'load') {
        const linkedHauls = state.hauls.filter((h) => h.load_id === id).map((h) => h.id as string);
        if (!hidden['haul']) hidden['haul'] = new Set();
        const haulSet = new Set(hidden['haul']);
        for (const hid of linkedHauls) { if (willHide) haulSet.add(hid); else haulSet.delete(hid); }
        hidden['haul'] = haulSet;
      } else if (type === 'haul') {
        const haul = state.hauls.find((h) => h.id === id);
        if (haul?.load_id) {
          if (!hidden['load']) hidden['load'] = new Set();
          const loadSet = new Set(hidden['load']);
          if (willHide) loadSet.add(haul.load_id as string);
          else loadSet.delete(haul.load_id as string);
          hidden['load'] = loadSet;
        }
      }

      return { hiddenItems: hidden };
    });
  },
  setAllVisible: (type, ids, visible) => {
    set((state) => {
      const hidden = { ...state.hiddenItems };
      if (visible) {
        const existing = new Set(hidden[type] ?? []);
        for (const id of ids) existing.delete(id);
        hidden[type] = existing;
      } else {
        hidden[type] = new Set(ids);
      }

      // Coupled loads/hauls
      if (type === 'load') {
        const linkedHaulIds = state.hauls
          .filter((h) => ids.includes(h.load_id as string))
          .map((h) => h.id as string);
        if (!hidden['haul']) hidden['haul'] = new Set();
        const haulSet = new Set(hidden['haul']);
        for (const hid of linkedHaulIds) { if (visible) haulSet.delete(hid); else haulSet.add(hid); }
        hidden['haul'] = haulSet;
      } else if (type === 'haul') {
        const loadIds = state.hauls
          .filter((h) => ids.includes(h.id as string) && h.load_id)
          .map((h) => h.load_id as string);
        const uniqueLoadIds = [...new Set(loadIds)];
        if (!hidden['load']) hidden['load'] = new Set();
        const loadSet = new Set(hidden['load']);
        for (const lid of uniqueLoadIds) { if (visible) loadSet.delete(lid); else loadSet.add(lid); }
        hidden['load'] = loadSet;
      }

      return { hiddenItems: hidden };
    });
  },
  isItemHidden: (type, id) => {
    return get().hiddenItems[type]?.has(id) ?? false;
  },

  // ── Staging area ──────────────────────────────────────────
  stagedItems: [],
  reorderStaging: (from, to) => {
    set((state) => {
      const items = [...state.stagedItems];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { stagedItems: items };
    });
  },

  // ── Drag overlay ──────────────────────────────────────────
  dragItem: null,
  dragOverStaging: false,
  setDragItem: (el) => set({ dragItem: el }),
  setDragOverStaging: (v) => set({ dragOverStaging: v }),

  // ── Active map tooltip ───────────────────────────────────
  activeTooltip: null,
  setActiveTooltip: (el) => set({ activeTooltip: el }),
  toggleStaging: (el) => {
    const state = get();
    const isInStaging = state.stagedItems.some((s) => s.type === el.type && s.id === el.id);
    if (isInStaging) {
      const stagedItems = state.stagedItems.filter((s) => !(s.type === el.type && s.id === el.id));
      set({ stagedItems, activeTooltip: null });
    } else {
      get().moveToStaging(el);
      set({ activeTooltip: el });
    }
  },

  // ── Selected event (synced between timeline and map) ──
  selectedEventId: null,
  setSelectedEventId: (id) => set({ selectedEventId: id }),

  // ── Cached actor events ────────────────────────────────────
  actorEvents: {},
  refreshActorEvents: async () => {
    try {
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date(Date.now() + 7 * 86400000).toISOString();
      const data = await api.getEvents(from, to) as { events: any[] };
      const byActor: Record<string, any[]> = {};
      for (const ev of data.events || []) {
        for (const key of ['truck_id', 'driver_id', 'trailer_id', 'load_id'] as const) {
          const actorId = ev[key];
          if (actorId) {
            const actorKey = `${key.replace('_id', '')}-${actorId}`;
            if (!byActor[actorKey]) byActor[actorKey] = [];
            byActor[actorKey].push(ev);
          }
        }
      }
      set({ actorEvents: byActor });
    } catch { /* ignore */ }
  },

  // ── View time ─────────────────────────────────────────────
  viewTime: new Date(),
  isLiveTime: true,
  setViewTime: (time) => set({ viewTime: time, isLiveTime: false }),
  setLiveTime: () => set({ viewTime: new Date(), isLiveTime: true }),

  // ── Real-time positions ───────────────────────────────────
  positions: new Map(),
  updatePosition: (pos) => {
    const positions = new Map(get().positions);
    positions.set(pos.truck_id, pos);
    set({ positions });
  },

  // ── Data ──────────────────────────────────────────────────
  trucks: [],
  trailers: [],
  drivers: [],
  loads: [],
  hauls: [],
  locations: [],
  fleetSummary: null,

  refreshTrucks: async () => {
    const trucks = await api.getTrucks() as Record<string, unknown>[];
    const hidden = { ...useStore.getState().hiddenItems };
    if (!hidden['truck']) hidden['truck'] = new Set();
    const truckSet = new Set(hidden['truck']);
    for (const t of trucks) { const id = t.id as string; if (!truckSet.has(id) && !useStore.getState().stagedItems.some(s => s.type === 'truck' && s.id === id)) truckSet.add(id); }
    set({ trucks, hiddenItems: { ...hidden, truck: truckSet } });
  },
  refreshTrailers: async () => {
    const trailers = await api.getTrailers() as Record<string, unknown>[];
    const hidden = { ...useStore.getState().hiddenItems };
    if (!hidden['trailer']) hidden['trailer'] = new Set();
    const trailerSet = new Set(hidden['trailer']);
    for (const t of trailers) { const id = t.id as string; if (!trailerSet.has(id) && !useStore.getState().stagedItems.some(s => s.type === 'trailer' && s.id === id)) trailerSet.add(id); }
    set({ trailers, hiddenItems: { ...hidden, trailer: trailerSet } });
  },
  refreshDrivers: async () => {
    const drivers = await api.getDrivers() as Record<string, unknown>[];
    const hidden = { ...useStore.getState().hiddenItems };
    if (!hidden['driver']) hidden['driver'] = new Set();
    const driverSet = new Set(hidden['driver']);
    for (const d of drivers) { const id = d.id as string; if (!driverSet.has(id) && !useStore.getState().stagedItems.some(s => s.type === 'driver' && s.id === id)) driverSet.add(id); }
    set({ drivers, hiddenItems: { ...hidden, driver: driverSet } });
  },
  refreshLoads: async () => {
    const loads = await api.getLoads() as Record<string, unknown>[];
    const hidden = { ...useStore.getState().hiddenItems };
    if (!hidden['load']) hidden['load'] = new Set();
    const loadSet = new Set(hidden['load']);
    for (const l of loads) { const id = l.id as string; if (!loadSet.has(id) && !useStore.getState().stagedItems.some(s => s.type === 'load' && s.id === id)) loadSet.add(id); }
    set({ loads, hiddenItems: { ...hidden, load: loadSet } });
  },
  refreshHauls: async () => {
    const hauls = await api.getHauls() as Record<string, unknown>[];
    const hidden = { ...useStore.getState().hiddenItems };
    if (!hidden['haul']) hidden['haul'] = new Set();
    const haulSet = new Set(hidden['haul']);
    for (const h of hauls) { const id = h.id as string; if (!haulSet.has(id) && !useStore.getState().stagedItems.some(s => s.type === 'haul' && s.id === id)) haulSet.add(id); }
    set({ hauls, hiddenItems: { ...hidden, haul: haulSet } });
  },
  refreshLocations: async () => {
    const locations = await api.getLocations() as Record<string, unknown>[];
    const hidden = { ...useStore.getState().hiddenItems };
    if (!hidden['location']) hidden['location'] = new Set();
    const locSet = new Set(hidden['location']);
    for (const l of locations) { const id = l.id as string; if (!locSet.has(id) && !useStore.getState().stagedItems.some(s => s.type === 'location' && s.id === id)) locSet.add(id); }
    set({ locations, hiddenItems: { ...hidden, location: locSet } });
  },
  refreshFleetSummary: async () => set({ fleetSummary: await api.getFleetSummary() as Record<string, number> }),

  refreshAll: async () => {
    await Promise.all([
      get().refreshTrucks(),
      get().refreshTrailers(),
      get().refreshDrivers(),
      get().refreshLoads(),
      get().refreshHauls(),
      get().refreshLocations(),
      get().refreshFleetSummary(),
      get().refreshOrders(),
      get().refreshActorEvents(),
      get().refreshRoadEvents(),
    ]);
  },

  // ── WebSocket ─────────────────────────────────────────────
  wsConnected: false,
  initWebSocket: () => {
    connectWebSocket((data) => {
      const event = data as { value?: { type?: string; payload?: unknown } };
      const evt = event?.value;
      if (!evt) return;

      if (evt.type === 'position_update') {
        get().updatePosition(evt.payload as PositionUpdate);
      }
      if (evt.type === 'truck_created' || evt.type === 'truck_updated' || evt.type === 'truck_deleted') {
        get().refreshTrucks();
      }
      if (evt.type === 'haul_created' || evt.type === 'haul_updated' || evt.type === 'haul_submitted') {
        get().refreshHauls();
        get().refreshActorEvents();
      }
      if (evt.type === 'load_created' || evt.type === 'load_updated') {
        get().refreshLoads();
      }
      if (evt.type === 'location_created' || evt.type === 'location_updated' || evt.type === 'location_deleted') {
        get().refreshLocations();
      }
      if (evt.type === 'trailer_created' || evt.type === 'trailer_updated' || evt.type === 'trailer_deleted') {
        get().refreshTrailers();
      }
      if (evt.type === 'driver_created' || evt.type === 'driver_updated' || evt.type === 'driver_deleted' || evt.type === 'driver_status_change') {
        get().refreshDrivers();
      }
      if (evt.type === 'order_created' || evt.type === 'order_updated' || evt.type === 'order_deleted') {
        get().refreshOrders();
        get().refreshActorEvents();
      }
      if (evt.type === 'road_event_created' || evt.type === 'road_event_updated' || evt.type === 'road_event_deleted') {
        get().refreshRoadEvents();
      }
    });
    set({ wsConnected: true });
  },

  // ── Road events ───────────────────────────────────────────
  roadEvents: [],
  refreshRoadEvents: async () => {
    try {
      const data = await api.getRoadEvents() as Record<string, unknown>[];
      set({ roadEvents: data });
    } catch { /* ignore */ }
  },

  // ── Orders ───────────────────────────────────────────────
  orders: [],

  refreshOrders: async () => {
    try {
      const data = await api.getOrders() as any[];
      const orderList: Order[] = data.map((r: any) => {
        const events: OrderEvent[] = (r.events || []).map((e: any) => ({
          ...e,
          status: (e.status as EventState) || 'incoming',
        }));
        return {
          id: r.id,
          load_id: r.load_id,
          load_number: r.load_number,
          haul_id: r.haul_id,
          status: (r.status as OrderStatus) || 'incoming',
          pickup_location_id: r.pickup_location_id || '',
          dropoff_location_id: r.dropoff_location_id || '',
          pickup_after: r.pickup_after || '',
          pickup_before: r.pickup_before || '',
          dropoff_after: r.dropoff_after || '',
          dropoff_before: r.dropoff_before || '',
          weight: r.weight || 0,
          commodity: r.commodity || '',
          is_hazmat: r.is_hazmat || false,
          rate_km: r.rate_km || 0,
          events,
        };
      });
      set({ orders: orderList });
    } catch { /* ignore */ }
  },

  createOrder: async (data) => {
    const { locations } = get();
    const pickupLoc = locations.find(l => l.id === data.pickup_location_id);
    const dropoffLoc = locations.find(l => l.id === data.dropoff_location_id);
    const pickupPos = pickupLoc?.position as { lat: number; lng: number } | undefined;
    const dropoffPos = dropoffLoc?.position as { lat: number; lng: number } | undefined;
    if (!pickupPos || !dropoffPos) {
      throw new Error('Pickup or dropoff location has no position');
    }

    // 1. Create the load via API
    const loadResult = await api.createLoad({
      number: data.number,
      weight: data.weight,
      commodity: data.commodity || null,
      pickup_location_id: data.pickup_location_id,
      pickup_phone: data.pickup_phone,
      pickup_after: data.pickup_after.toISOString(),
      pickup_before: data.pickup_before.toISOString(),
      dropoff_location_id: data.dropoff_location_id,
      dropoff_phone: data.dropoff_phone,
      dropoff_after: data.dropoff_after.toISOString(),
      dropoff_before: data.dropoff_before.toISOString(),
      is_hazmat: data.is_hazmat,
      rate_km: data.rate_km,
    }) as { id: string };
    const loadId = loadResult.id;

    // 2. Compute route via A* (haul is loaded, starts after loading)
    const TRUCK_EMPTY = 8000;
    const TRAILER_EMPTY = 4000;
    const haulWeight = data.weight + TRUCK_EMPTY + TRAILER_EMPTY;
    const haulStartTime = data.pickup_after.getTime() + 90 * 60 * 1000; // after 1h30 loading
    let routeDurationMs = 2 * HOUR_MS;
    let routePath: { lat: number; lng: number }[] | undefined;
    let routeDistanceM = 0;
    try {
      console.log('[createOrder] Computing route from', pickupPos, 'to', dropoffPos, 'weight', haulWeight);
      const route = await api.getRoute(
        pickupPos.lat, pickupPos.lng, dropoffPos.lat, dropoffPos.lng,
        haulWeight, new Date(haulStartTime).toISOString(), true
      );
      console.log('[createOrder] Route result:', route.total_distance_m, 'm,', route.total_time_s, 's,', route.geometry?.length, 'points');
      routeDurationMs = Math.max(route.total_time_s * 1000, 15 * 60 * 1000);
      routePath = route.geometry;
      routeDistanceM = route.total_distance_m;
    } catch (e) {
      console.error('[createOrder] Route computation failed:', e instanceof Error ? e.message : String(e));
      // Use fast heuristic as fallback
      const straightDist = Math.sqrt(
        (pickupPos.lat - dropoffPos.lat) ** 2 + (pickupPos.lng - dropoffPos.lng) ** 2
      );
      routeDistanceM = Math.round(straightDist * 111000 * 1.3); // 1 degree ≈ 111km, 1.3 detour
      routeDurationMs = Math.max(routeDistanceM / (60 * 1000 / 3600), 15 * 60 * 1000); // 60km/h avg
    }

    // 3. Compute event times
    const LOADING_DUR = 90 * 60 * 1000; // 1h30
    const UNLOADING_DUR = 90 * 60 * 1000; // 1h30
    const pickupAfterMs = data.pickup_after.getTime();
    const dropoffAfterMs = data.dropoff_after.getTime();
    const loadingStart = pickupAfterMs;
    const loadingEnd = loadingStart + LOADING_DUR;
    const haulStart = loadingEnd;
    const haulEnd = haulStart + routeDurationMs;
    const unloadStart = dropoffAfterMs;
    const unloadEnd = unloadStart + UNLOADING_DUR;

    const noActors = { truck_id: null as string | null, driver_id: null as string | null, trailer_id: null as string | null };
    const incomingStatus = { status: 'incoming' as EventState };

    // 4. Build events (loading, haul, unloading)
    const events: OrderEvent[] = [
      {
        id: uid(), type: 'loading', load_id: loadId, ...incomingStatus,
        start_time: new Date(loadingStart).toISOString(),
        end_time: new Date(loadingEnd).toISOString(),
        start_location_id: data.pickup_location_id, end_location_id: data.pickup_location_id,
        ...noActors,
      },
      {
        id: uid(), type: 'haul', load_id: loadId, ...incomingStatus,
        start_time: new Date(haulStart).toISOString(),
        end_time: new Date(haulEnd).toISOString(),
        start_location_id: data.pickup_location_id, end_location_id: data.dropoff_location_id,
        path: routePath, distance_m: routeDistanceM, duration_s: routeDurationMs / 1000,
        ...noActors,
      },
      {
        id: uid(), type: 'unloading', load_id: loadId, ...incomingStatus,
        start_time: new Date(unloadStart).toISOString(),
        end_time: new Date(unloadEnd).toISOString(),
        start_location_id: data.dropoff_location_id, end_location_id: data.dropoff_location_id,
        ...noActors,
      },
    ];

    // 5. Create events in DB
    for (const ev of events) {
      try {
        const created = await api.createEvent({
          type: ev.type,
          start_time: ev.start_time,
          end_time: ev.end_time,
          load_id: ev.load_id,
          truck_id: ev.truck_id,
          driver_id: ev.driver_id,
          trailer_id: ev.trailer_id,
          start_location_id: ev.start_location_id,
          end_location_id: ev.end_location_id,
          status: ev.status,
        }) as { id: string };
        ev.id = created.id;
      } catch { /* ignore individual event creation errors */ }
    }

    // 6. Create the order in DB
    const orderResult = await api.createOrder({
      load_id: loadId,
      status: 'incoming',
      events_data: events,
    }) as { id: string };

    // 7. Add to local state
    const order: Order = {
      id: orderResult.id,
      load_id: loadId,
      load_number: data.number,
      status: 'incoming',
      pickup_location_id: data.pickup_location_id,
      dropoff_location_id: data.dropoff_location_id,
      pickup_after: data.pickup_after.toISOString(),
      pickup_before: data.pickup_before.toISOString(),
      dropoff_after: data.dropoff_after.toISOString(),
      dropoff_before: data.dropoff_before.toISOString(),
      weight: data.weight,
      commodity: data.commodity,
      is_hazmat: data.is_hazmat,
      rate_km: data.rate_km,
      events,
    };

    set(state => ({ orders: [...state.orders, order] }));
    await get().refreshLoads();
  },

  assignOrder: async (orderId, truckId, driverId, trailerId) => {
    const { orders, locations, trucks, trailers, drivers } = get();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const loading = order.events.find(e => e.type === 'loading');
    const haul = order.events.find(e => e.type === 'haul');
    const unloading = order.events.find(e => e.type === 'unloading');
    if (!loading || !haul || !unloading) return;

    // Resolve locations
    const truck = trucks.find(t => t.id === truckId);
    const trailer = trailers.find(t => t.id === trailerId);
    const driver = drivers.find(d => d.id === driverId);
    const homeLocId = (truck?.location_id as string) || (trailer?.location_id as string) || (driver?.home_location_id as string) || '';
    const pickupLocId = order.pickup_location_id;
    const dropoffLocId = order.dropoff_location_id;
    const loadId = order.load_id;

    const actors = { truck_id: truckId, driver_id: driverId, trailer_id: trailerId };
    const incomingStatus = { status: 'incoming' as EventState };

    // Compute route from home hub to pickup (empty truck, not loaded)
    const TRUCK_EMPTY_W = 8000;
    const TRAILER_EMPTY_W = 4000;
    const emptyWeight = TRUCK_EMPTY_W + TRAILER_EMPTY_W;
    let deadmileDurationMs = 30 * 60 * 1000;
    let deadmilePath: { lat: number; lng: number }[] | undefined;
    let deadmileDistanceM = 0;
    const homeLoc = locations.find(l => l.id === homeLocId);
    const pickupLoc = locations.find(l => l.id === pickupLocId);
    const homePos = homeLoc?.position as { lat: number; lng: number } | undefined;
    const pickupPos = pickupLoc?.position as { lat: number; lng: number } | undefined;
    const loadingStartMs = new Date(loading.start_time).getTime();
    // deadmile to pickup starts before loading; we estimate start time for routing
    const deadmileToStartTime = loadingStartMs - 60 * 60 * 1000; // rough estimate
    if (homePos && pickupPos) {
      try {
        const route = await api.getRoute(
          homePos.lat, homePos.lng, pickupPos.lat, pickupPos.lng,
          emptyWeight, new Date(deadmileToStartTime).toISOString(), false
        );
        deadmileDurationMs = Math.max(route.total_time_s * 1000, 10 * 60 * 1000);
        deadmilePath = route.geometry;
        deadmileDistanceM = route.total_distance_m;
      } catch {
        // Fast fallback
        const d = Math.sqrt((homePos.lat - pickupPos.lat) ** 2 + (homePos.lng - pickupPos.lng) ** 2);
        deadmileDistanceM = Math.round(d * 111000 * 1.3);
        deadmileDurationMs = Math.max(deadmileDistanceM / (60 * 1000 / 3600), 10 * 60 * 1000);
      }
    }

    // Compute route from dropoff back to home hub (empty truck after unloading)
    let returnDurationMs = 30 * 60 * 1000;
    let returnPath: { lat: number; lng: number }[] | undefined;
    let returnDistanceM = 0;
    const dropoffLoc = locations.find(l => l.id === dropoffLocId);
    const dropoffPos = dropoffLoc?.position as { lat: number; lng: number } | undefined;
    const unloadingEndMs = new Date(unloading.end_time).getTime();
    const returnStartTime = unloadingEndMs + 15 * 60 * 1000;
    if (dropoffPos && homePos) {
      try {
        const route = await api.getRoute(
          dropoffPos.lat, dropoffPos.lng, homePos.lat, homePos.lng,
          emptyWeight, new Date(returnStartTime).toISOString(), false
        );
        returnDurationMs = Math.max(route.total_time_s * 1000, 10 * 60 * 1000);
        returnPath = route.geometry;
        returnDistanceM = route.total_distance_m;
      } catch {
        const d = Math.sqrt((dropoffPos.lat - homePos.lat) ** 2 + (dropoffPos.lng - homePos.lng) ** 2);
        returnDistanceM = Math.round(d * 111000 * 1.3);
        returnDurationMs = Math.max(returnDistanceM / (60 * 1000 / 3600), 10 * 60 * 1000);
      }
    }

    const ATTACH_DUR = 30 * 60 * 1000; // 30min
    const DETACH_DUR = 30 * 60 * 1000;

    const loadingStart = new Date(loading.start_time).getTime();
    const unloadingEnd = new Date(unloading.end_time).getTime();

    // attach at home hub, deadmile starts immediately after attach
    const deadmileToStart = loadingStart - deadmileDurationMs;
    const attachStart = deadmileToStart - ATTACH_DUR;
    const attachEnd = attachStart + ATTACH_DUR;

    // deadmile home → pickup (ends exactly when loading starts)
    const deadmileToStart_t = attachEnd;
    const deadmileToEnd = loadingStart;

    // deadmile dropoff → home (starts immediately when unloading ends)
    const deadmileBackStart = unloadingEnd;
    const deadmileBackEnd = deadmileBackStart + returnDurationMs;

    // detach at home hub
    const detachStart = deadmileBackEnd;
    const detachEnd = detachStart + DETACH_DUR;

    // Create a haul via API
    const haulResult = await api.createHaul({
      load_id: loadId,
      driver_id: driverId,
      truck_id: truckId,
      trailer_id: trailerId,
      started_at: loading.start_time,
      ended_at: unloading.end_time,
      is_draft: false,
      is_active: true,
    }) as { id: string };

    // Build the new event chain
    const newEvents: OrderEvent[] = [
      { id: uid(), type: 'loading', load_id: loadId, ...actors, ...incomingStatus,
        start_time: loading.start_time, end_time: loading.end_time,
        start_location_id: pickupLocId, end_location_id: pickupLocId },
      { id: uid(), type: 'haul', load_id: loadId, ...actors, ...incomingStatus,
        start_time: haul.start_time, end_time: haul.end_time,
        start_location_id: pickupLocId, end_location_id: dropoffLocId,
        path: haul.path, distance_m: haul.distance_m, duration_s: haul.duration_s },
      { id: uid(), type: 'unloading', load_id: loadId, ...actors, ...incomingStatus,
        start_time: unloading.start_time, end_time: unloading.end_time,
        start_location_id: dropoffLocId, end_location_id: dropoffLocId },
    ];

    // Add attach + deadmile to pickup (before loading)
    const preEvents: OrderEvent[] = [
      { id: uid(), type: 'attach', load_id: loadId, ...actors, ...incomingStatus,
        start_time: new Date(attachStart).toISOString(), end_time: new Date(attachEnd).toISOString(),
        start_location_id: homeLocId, end_location_id: homeLocId },
      { id: uid(), type: 'deadmile', load_id: loadId, ...actors, ...incomingStatus,
        start_time: new Date(deadmileToStart_t).toISOString(), end_time: new Date(deadmileToEnd).toISOString(),
        start_location_id: homeLocId, end_location_id: pickupLocId,
        path: deadmilePath, distance_m: deadmileDistanceM, duration_s: deadmileDurationMs / 1000 },
    ];

    // Add deadmile back + detach (after unloading)
    const postEvents: OrderEvent[] = [
      { id: uid(), type: 'deadmile', load_id: loadId, ...actors, ...incomingStatus,
        start_time: new Date(deadmileBackStart).toISOString(), end_time: new Date(deadmileBackEnd).toISOString(),
        start_location_id: dropoffLocId, end_location_id: homeLocId,
        path: returnPath, distance_m: returnDistanceM, duration_s: returnDurationMs / 1000 },
      { id: uid(), type: 'detach', load_id: loadId, ...actors, ...incomingStatus,
        start_time: new Date(detachStart).toISOString(), end_time: new Date(detachEnd).toISOString(),
        start_location_id: homeLocId, end_location_id: homeLocId },
    ];

    const allEvents = [...preEvents, ...newEvents, ...postEvents];

    // Create events in DB
    for (const ev of allEvents) {
      try {
        const created = await api.createEvent({
          type: ev.type,
          start_time: ev.start_time,
          end_time: ev.end_time,
          load_id: ev.load_id,
          truck_id: ev.truck_id,
          driver_id: ev.driver_id,
          trailer_id: ev.trailer_id,
          start_location_id: ev.start_location_id,
          end_location_id: ev.end_location_id,
          status: ev.status,
        }) as { id: string };
        ev.id = created.id;
      } catch { /* ignore */ }
    }

    // Update order in DB
    try {
      await api.updateOrder(orderId, {
        haul_id: haulResult.id,
        status: 'incoming',
        events_data: allEvents,
      });
    } catch { /* ignore */ }

    set(state => ({
      orders: state.orders.map(o =>
        o.id === orderId ? { ...o, haul_id: haulResult.id, status: 'incoming' as OrderStatus, events: allEvents } : o
      ),
    }));
    await get().refreshHauls();
    await get().refreshActorEvents();
  },

  dispatchOrder: async (orderId) => {
    const { orders } = get();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const updatedEvents = order.events.map(ev => ({
      ...ev,
      status: 'dispatched' as EventState,
    }));

    // Update events in DB
    for (const ev of updatedEvents) {
      try {
        await api.updateEvent(ev.id, { status: 'dispatched' });
      } catch { /* ignore */ }
    }

    // Update order in DB
    try {
      await api.updateOrder(orderId, {
        status: 'dispatched',
        events_data: updatedEvents,
      });
    } catch { /* ignore */ }

    set(state => ({
      orders: state.orders.map(o =>
        o.id === orderId ? { ...o, status: 'dispatched' as OrderStatus, events: updatedEvents } : o
      ),
    }));
    await get().refreshActorEvents();
  },

  splitOrder: async (orderId, hubLocationId) => {
    const { orders, locations } = get();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const hubLoc = locations.find(l => l.id === hubLocationId);
    const hubPos = hubLoc?.position as { lat: number; lng: number } | undefined;
    if (!hubPos) { throw new Error('Hub location has no position'); }

    const pickupLoc = locations.find(l => l.id === order.pickup_location_id);
    const dropoffLoc = locations.find(l => l.id === order.dropoff_location_id);
    const pickupPos = pickupLoc?.position as { lat: number; lng: number } | undefined;
    const dropoffPos = dropoffLoc?.position as { lat: number; lng: number } | undefined;
    if (!pickupPos || !dropoffPos) { throw new Error('Pickup or dropoff location has no position'); }

    // Compute route pickup → hub
    let haul1DurationMs = 2 * HOUR_MS;
    let haul1Path: { lat: number; lng: number }[] | undefined;
    let haul1DistanceM = 0;
    try {
      const route = await api.getRoute(pickupPos.lat, pickupPos.lng, hubPos.lat, hubPos.lng, order.weight + 12000, order.pickup_after, true);
      haul1DurationMs = Math.max(route.total_time_s * 1000, 15 * 60 * 1000);
      haul1Path = route.geometry;
      haul1DistanceM = route.total_distance_m;
    } catch { /* fallback */ }

    // Compute route hub → dropoff
    let haul2DurationMs = 2 * HOUR_MS;
    let haul2Path: { lat: number; lng: number }[] | undefined;
    let haul2DistanceM = 0;
    try {
      const route = await api.getRoute(hubPos.lat, hubPos.lng, dropoffPos.lat, dropoffPos.lng, order.weight + 12000, new Date().toISOString(), true);
      haul2DurationMs = Math.max(route.total_time_s * 1000, 15 * 60 * 1000);
      haul2Path = route.geometry;
      haul2DistanceM = route.total_distance_m;
    } catch { /* fallback */ }

    const noActors = { truck_id: null as string | null, driver_id: null as string | null, trailer_id: null as string | null };
    const incomingStatus = { status: 'incoming' as EventState };

    // Order 1: original pickup → hub (no dropoff window constraint)
    const loading1End = new Date(order.pickup_after).getTime() + 90 * 60 * 1000;
    const haul1Start = loading1End;
    const haul1End = haul1Start + haul1DurationMs;
    const unload1Start = haul1End;
    const unload1End = unload1Start + 90 * 60 * 1000;

    const order1Events: OrderEvent[] = [
      { id: uid(), type: 'loading', load_id: order.load_id, ...incomingStatus, ...noActors,
        start_time: order.pickup_after, end_time: new Date(loading1End).toISOString(),
        start_location_id: order.pickup_location_id, end_location_id: order.pickup_location_id },
      { id: uid(), type: 'haul', load_id: order.load_id, ...incomingStatus, ...noActors,
        start_time: new Date(haul1Start).toISOString(), end_time: new Date(haul1End).toISOString(),
        start_location_id: order.pickup_location_id, end_location_id: hubLocationId,
        path: haul1Path, distance_m: haul1DistanceM, duration_s: haul1DurationMs / 1000 },
      { id: uid(), type: 'unloading', load_id: order.load_id, ...incomingStatus, ...noActors,
        start_time: new Date(unload1Start).toISOString(), end_time: new Date(unload1End).toISOString(),
        start_location_id: hubLocationId, end_location_id: hubLocationId },
    ];

    // Order 2: hub → original dropoff (flexible pickup, original dropoff window)
    const load2Start = Math.max(unload1End, new Date(order.dropoff_after).getTime() - haul2DurationMs - 90 * 60 * 1000);
    const load2End = load2Start + 90 * 60 * 1000;
    const haul2Start = load2End;
    const haul2End = haul2Start + haul2DurationMs;
    const unload2Start = Math.max(haul2End, new Date(order.dropoff_after).getTime());
    const unload2End = unload2Start + 90 * 60 * 1000;

    const order2Events: OrderEvent[] = [
      { id: uid(), type: 'loading', load_id: order.load_id, ...incomingStatus, ...noActors,
        start_time: new Date(load2Start).toISOString(), end_time: new Date(load2End).toISOString(),
        start_location_id: hubLocationId, end_location_id: hubLocationId },
      { id: uid(), type: 'haul', load_id: order.load_id, ...incomingStatus, ...noActors,
        start_time: new Date(haul2Start).toISOString(), end_time: new Date(haul2End).toISOString(),
        start_location_id: hubLocationId, end_location_id: order.dropoff_location_id,
        path: haul2Path, distance_m: haul2DistanceM, duration_s: haul2DurationMs / 1000 },
      { id: uid(), type: 'unloading', load_id: order.load_id, ...incomingStatus, ...noActors,
        start_time: new Date(unload2Start).toISOString(), end_time: new Date(unload2End).toISOString(),
        start_location_id: order.dropoff_location_id, end_location_id: order.dropoff_location_id },
    ];

    // Create loads for the two new orders
    const load1Result = await api.createLoad({
      number: `${order.load_number}-A`,
      weight: order.weight, commodity: order.commodity || null,
      pickup_location_id: order.pickup_location_id, pickup_phone: '000-000-0000',
      pickup_after: order.pickup_after, pickup_before: order.pickup_before,
      dropoff_location_id: hubLocationId, dropoff_phone: '000-000-0000',
      dropoff_after: new Date(unload1Start).toISOString(), dropoff_before: new Date(unload1End + 24 * HOUR_MS).toISOString(),
      is_hazmat: order.is_hazmat, rate_km: order.rate_km,
    }) as { id: string };

    const load2Result = await api.createLoad({
      number: `${order.load_number}-B`,
      weight: order.weight, commodity: order.commodity || null,
      pickup_location_id: hubLocationId, pickup_phone: '000-000-0000',
      pickup_after: new Date(load2Start).toISOString(), pickup_before: new Date(load2End + 24 * HOUR_MS).toISOString(),
      dropoff_location_id: order.dropoff_location_id, dropoff_phone: '000-000-0000',
      dropoff_after: order.dropoff_after, dropoff_before: order.dropoff_before,
      is_hazmat: order.is_hazmat, rate_km: order.rate_km,
    }) as { id: string };

    // Update event load_ids
    for (const ev of order1Events) ev.load_id = load1Result.id;
    for (const ev of order2Events) ev.load_id = load2Result.id;

    // Create events in DB
    for (const ev of [...order1Events, ...order2Events]) {
      try {
        const created = await api.createEvent({
          type: ev.type, start_time: ev.start_time, end_time: ev.end_time,
          load_id: ev.load_id, truck_id: ev.truck_id, driver_id: ev.driver_id, trailer_id: ev.trailer_id,
          start_location_id: ev.start_location_id, end_location_id: ev.end_location_id, status: ev.status,
        }) as { id: string };
        ev.id = created.id;
      } catch { /* ignore */ }
    }

    // Create two new orders in DB
    const order1Result = await api.createOrder({ load_id: load1Result.id, status: 'incoming', events_data: order1Events }) as { id: string };
    const order2Result = await api.createOrder({ load_id: load2Result.id, status: 'incoming', events_data: order2Events }) as { id: string };

    // Delete original order and its events
    try { await api.deleteOrder(orderId); } catch { /* ignore */ }

    // Add new orders to state
    const order1: Order = {
      id: order1Result.id, load_id: load1Result.id, load_number: `${order.load_number}-A`,
      status: 'incoming', pickup_location_id: order.pickup_location_id, dropoff_location_id: hubLocationId,
      pickup_after: order.pickup_after, pickup_before: order.pickup_before,
      dropoff_after: new Date(unload1Start).toISOString(), dropoff_before: new Date(unload1End + 24 * HOUR_MS).toISOString(),
      weight: order.weight, commodity: order.commodity, is_hazmat: order.is_hazmat, rate_km: order.rate_km,
      events: order1Events,
    };
    const order2: Order = {
      id: order2Result.id, load_id: load2Result.id, load_number: `${order.load_number}-B`,
      status: 'incoming', pickup_location_id: hubLocationId, dropoff_location_id: order.dropoff_location_id,
      pickup_after: new Date(load2Start).toISOString(), pickup_before: new Date(load2End + 24 * HOUR_MS).toISOString(),
      dropoff_after: order.dropoff_after, dropoff_before: order.dropoff_before,
      weight: order.weight, commodity: order.commodity, is_hazmat: order.is_hazmat, rate_km: order.rate_km,
      events: order2Events,
    };

    set(state => ({
      orders: [...state.orders.filter(o => o.id !== orderId), order1, order2],
    }));
    await get().refreshLoads();
    await get().refreshActorEvents();
  },

  linkOrders: async (order1Id, order2Id) => {
    const { orders, locations } = get();
    const order1 = orders.find(o => o.id === order1Id);
    const order2 = orders.find(o => o.id === order2Id);
    if (!order1 || !order2) return;
    if (!order1.haul_id || !order1.events.some(e => e.truck_id)) {
      throw new Error('First order must be assigned before linking');
    }

    // Get actors from order 1
    const truckId = order1.events.find(e => e.truck_id)?.truck_id!;
    const driverId = order1.events.find(e => e.driver_id)?.driver_id!;
    const trailerId = order1.events.find(e => e.trailer_id)?.trailer_id!;

    // Find the unloading end of order 1
    const unload1 = order1.events.find(e => e.type === 'unloading');
    if (!unload1) throw new Error('Order 1 has no unloading event');
    const unload1End = new Date(unload1.end_time).getTime();

    // Find order 2's pickup location
    const pickup2Loc = locations.find(l => l.id === order2.pickup_location_id);
    const dropoff2Loc = locations.find(l => l.id === order2.dropoff_location_id);
    const unload1Loc = locations.find(l => l.id === unload1.end_location_id);
    const pickup2Pos = pickup2Loc?.position as { lat: number; lng: number } | undefined;
    const unload1Pos = unload1Loc?.position as { lat: number; lng: number } | undefined;

    // Compute deadmile from order 1 dropoff → order 2 pickup
    let deadmileDurationMs = 30 * 60 * 1000;
    let deadmilePath: { lat: number; lng: number }[] | undefined;
    let deadmileDistanceM = 0;
    if (unload1Pos && pickup2Pos) {
      try {
        const route = await api.getRoute(unload1Pos.lat, unload1Pos.lng, pickup2Pos.lat, pickup2Pos.lng, 12000, new Date(unload1End + 15 * 60 * 1000).toISOString(), false);
        deadmileDurationMs = Math.max(route.total_time_s * 1000, 10 * 60 * 1000);
        deadmilePath = route.geometry;
        deadmileDistanceM = route.total_distance_m;
      } catch { /* fallback */ }
    }

    // Shift order 2 events to start after order 1 unloading + deadmile
    const deadmileStart = unload1End + 15 * 60 * 1000;
    const deadmileEnd = deadmileStart + deadmileDurationMs;

    // Get order 2's loading event to compute the shift
    const load2 = order2.events.find(e => e.type === 'loading');
    if (!load2) throw new Error('Order 2 has no loading event');
    const load2Start = new Date(load2.start_time).getTime();
    const newLoad2Start = Math.max(deadmileEnd, load2Start);
    const shiftMs = newLoad2Start - load2Start;

    // Shift all order 2 events
    const updatedOrder2Events = order2.events.map(ev => {
      const newStart = new Date(ev.start_time).getTime() + shiftMs;
      const newEnd = new Date(ev.end_time).getTime() + shiftMs;
      return {
        ...ev,
        start_time: new Date(newStart).toISOString(),
        end_time: new Date(newEnd).toISOString(),
        truck_id: truckId, driver_id: driverId, trailer_id: trailerId,
      };
    });

    // Add deadmile event between order 1 and order 2
    const deadmileEvent: OrderEvent = {
      id: uid(), type: 'deadmile', load_id: order2.load_id,
      truck_id: truckId, driver_id: driverId, trailer_id: trailerId,
      status: 'incoming' as EventState,
      start_time: new Date(deadmileStart).toISOString(),
      end_time: new Date(deadmileEnd).toISOString(),
      start_location_id: unload1.end_location_id,
      end_location_id: order2.pickup_location_id,
      path: deadmilePath, distance_m: deadmileDistanceM, duration_s: deadmileDurationMs / 1000,
    };

    // Update order 2: add deadmile + shifted events with actors
    const allOrder2Events = [deadmileEvent, ...updatedOrder2Events];

    // Also update order 1's post-events (deadmile back to hub, detach) to move after order 2
    const detach1 = order1.events.find(e => e.type === 'detach');
    const deadmileBack1 = order1.events.filter(e => e.type === 'deadmile' && e.start_location_id === order1.dropoff_location_id);

    // Find end of order 2
    const unload2 = updatedOrder2Events.find(e => e.type === 'unloading');
    const order2End = unload2 ? new Date(unload2.end_time).getTime() : deadmileEnd;

    // Find home hub from truck
    const truck = get().trucks.find(t => t.id === truckId);
    const homeLocId = (truck?.location_id as string) || '';

    // Compute deadmile back from order 2 dropoff → home hub
    let backDurationMs = 30 * 60 * 1000;
    let backPath: { lat: number; lng: number }[] | undefined;
    let backDistanceM = 0;
    const dropoff2Pos = dropoff2Loc?.position as { lat: number; lng: number } | undefined;
    const homeLoc = locations.find(l => l.id === homeLocId);
    const homePos = homeLoc?.position as { lat: number; lng: number } | undefined;
    if (dropoff2Pos && homePos) {
      try {
        const route = await api.getRoute(dropoff2Pos.lat, dropoff2Pos.lng, homePos.lat, homePos.lng, 12000, new Date(order2End + 15 * 60 * 1000).toISOString(), false);
        backDurationMs = Math.max(route.total_time_s * 1000, 10 * 60 * 1000);
        backPath = route.geometry;
        backDistanceM = route.total_distance_m;
      } catch { /* fallback */ }
    }

    const backStart = order2End + 15 * 60 * 1000;
    const backEnd = backStart + backDurationMs;
    const detachStart = backEnd;
    const detachEnd = detachStart + 10 * 60 * 1000;

    // Remove old deadmile-back and detach from order 1, add new ones after order 2
    const updatedOrder1Events = order1.events.filter(e =>
      !(e.type === 'deadmile' && e.start_location_id === order1.dropoff_location_id) &&
      e.type !== 'detach'
    );

    const newPostEvents: OrderEvent[] = [
      { id: uid(), type: 'deadmile', load_id: order2.load_id,
        truck_id: truckId, driver_id: driverId, trailer_id: trailerId,
        status: 'incoming' as EventState,
        start_time: new Date(backStart).toISOString(), end_time: new Date(backEnd).toISOString(),
        start_location_id: order2.dropoff_location_id, end_location_id: homeLocId,
        path: backPath, distance_m: backDistanceM, duration_s: backDurationMs / 1000 },
      { id: uid(), type: 'detach', load_id: order2.load_id,
        truck_id: truckId, driver_id: driverId, trailer_id: trailerId,
        status: 'incoming' as EventState,
        start_time: new Date(detachStart).toISOString(), end_time: new Date(detachEnd).toISOString(),
        start_location_id: homeLocId, end_location_id: homeLocId },
    ];

    // Create new events in DB
    for (const ev of [...allOrder2Events, ...newPostEvents]) {
      try {
        const created = await api.createEvent({
          type: ev.type, start_time: ev.start_time, end_time: ev.end_time,
          load_id: ev.load_id, truck_id: ev.truck_id, driver_id: ev.driver_id, trailer_id: ev.trailer_id,
          start_location_id: ev.start_location_id, end_location_id: ev.end_location_id, status: ev.status,
        }) as { id: string };
        ev.id = created.id;
      } catch { /* ignore */ }
    }

    // Delete old deadmile-back and detach events from order 1
    for (const ev of order1.events) {
      if ((ev.type === 'deadmile' && ev.start_location_id === order1.dropoff_location_id) || ev.type === 'detach') {
        try { await api.deleteEvent(ev.id); } catch { /* ignore */ }
      }
    }

    // Update order 1: remove old post-events, add new post-events after order 2
    const finalOrder1Events = [...updatedOrder1Events, ...newPostEvents];

    // Update order 2: add deadmile + shifted events with actors
    // Also create haul for order 2 if not already assigned
    try {
      await api.createHaul({
        load_id: order2.load_id, driver_id: driverId, truck_id: truckId, trailer_id: trailerId,
        started_at: updatedOrder2Events.find(e => e.type === 'loading')?.start_time || new Date().toISOString(),
        ended_at: updatedOrder2Events.find(e => e.type === 'unloading')?.end_time || new Date().toISOString(),
        is_draft: false, is_active: true,
      });
    } catch { /* ignore */ }

    // Update orders in DB
    try {
      await api.updateOrder(order1Id, { events_data: finalOrder1Events });
      await api.updateOrder(order2Id, { haul_id: 'linked', status: 'incoming', events_data: allOrder2Events });
    } catch { /* ignore */ }

    // Update state
    set(state => ({
      orders: state.orders.map(o => {
        if (o.id === order1Id) return { ...o, events: finalOrder1Events };
        if (o.id === order2Id) return { ...o, haul_id: 'linked', events: allOrder2Events, status: 'incoming' as OrderStatus };
        return o;
      }),
      linkedOrders: {
        ...state.linkedOrders,
        [order1Id]: [...(state.linkedOrders[order1Id] || []), order2Id],
      },
    }));
    await get().refreshHauls();
    await get().refreshActorEvents();
  },

  moveOrderEvent: (orderId, eventId, newStartMs) => {
    let updatedEvents: OrderEvent[] | null = null;
    set(state => ({
      orders: state.orders.map(order => {
        if (order.id !== orderId) return order;

        const sorted = sortEventsByTime(order.events);
        const targetIdx = sorted.findIndex(e => e.id === eventId);
        if (targetIdx === -1) return order;
        const targetEv = sorted[targetIdx];

        const pickupAfterMs = new Date(order.pickup_after).getTime();
        const pickupBeforeMs = new Date(order.pickup_before).getTime();
        const dropoffAfterMs = new Date(order.dropoff_after).getTime();
        const dropoffBeforeMs = new Date(order.dropoff_before).getTime();

        const dur = new Date(targetEv.end_time).getTime() - new Date(targetEv.start_time).getTime();

        // Neighbor constraints: can't overlap prev or next event
        const prevEnd = targetIdx > 0 ? new Date(sorted[targetIdx - 1].end_time).getTime() : -Infinity;
        const nextStart = targetIdx < sorted.length - 1 ? new Date(sorted[targetIdx + 1].start_time).getTime() : Infinity;

        let newStart = Math.max(prevEnd, Math.min(nextStart - dur, newStartMs));

        // Window constraints for loading and unloading
        if (targetEv.type === 'loading') {
          newStart = Math.max(pickupAfterMs, Math.min(pickupBeforeMs - dur, newStart));
        } else if (targetEv.type === 'unloading') {
          newStart = Math.max(dropoffAfterMs, Math.min(dropoffBeforeMs - dur, newStart));
        }

        const newEnd = newStart + dur;
        const updated = { ...targetEv, start_time: new Date(newStart).toISOString(), end_time: new Date(newEnd).toISOString() };

        const result = sorted.map(e => e.id === eventId ? updated : e);
        updatedEvents = result;
        return { ...order, events: result };
      }),
    }));

    if (updatedEvents) {
      const evs: OrderEvent[] = updatedEvents;
      api.updateOrder(orderId, { events_data: evs }).catch(() => {});
      for (const ev of evs) {
        api.updateEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time }).catch(() => {});
      }
    }
  },

  recomputeEventDuration: async (orderId, eventId) => {
    const { orders, locations } = get();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const targetEv = order.events.find(e => e.id === eventId);
    if (!targetEv) return;
    if (targetEv.type !== 'haul' && targetEv.type !== 'deadmile') return;

    // Resolve start/end locations
    const startLoc = locations.find(l => l.id === targetEv.start_location_id);
    const endLoc = locations.find(l => l.id === targetEv.end_location_id);
    const startPos = startLoc?.position as { lat: number; lng: number } | undefined;
    const endPos = endLoc?.position as { lat: number; lng: number } | undefined;
    if (!startPos || !endPos) return;

    const isLoaded = targetEv.type === 'haul';
    const TRUCK_EMPTY = 8000;
    const TRAILER_EMPTY = 4000;
    const weight = isLoaded
      ? order.weight + TRUCK_EMPTY + TRAILER_EMPTY
      : TRUCK_EMPTY + TRAILER_EMPTY;
    const startTime = targetEv.start_time;

    try {
      const route = await api.getRoute(startPos.lat, startPos.lng, endPos.lat, endPos.lng, weight, startTime, isLoaded);
      const newDurationMs = Math.max(route.total_time_s * 1000, 10 * 60 * 1000);
      const startMs = new Date(targetEv.start_time).getTime();
      const newEnd = startMs + newDurationMs;

      set(state => ({
        orders: state.orders.map(o => {
          if (o.id !== orderId) return o;
          const updatedEvents = o.events.map(ev => {
            if (ev.id !== eventId) return ev;
            return {
              ...ev,
              end_time: new Date(newEnd).toISOString(),
              path: route.geometry,
              distance_m: route.total_distance_m,
              duration_s: route.total_time_s,
            };
          });
          // Persist
          api.updateOrder(orderId, { events_data: updatedEvents }).catch(() => {});
          api.updateEvent(eventId, { end_time: new Date(newEnd).toISOString() }).catch(() => {});
          return { ...o, events: updatedEvents };
        }),
      }));
    } catch { /* keep existing duration */ }
  },

  getOrderEventState: (orderId, eventId) => {
    const order = get().orders.find(o => o.id === orderId);
    if (!order) return 'incoming';
    const ev = order.events.find(e => e.id === eventId);
    if (!ev) return 'incoming';
    return computeEventState(ev, !!order.haul_id, new Date());
  },

  getOrderStatus: (orderId) => {
    const order = get().orders.find(o => o.id === orderId);
    if (!order) return 'incoming';
    return computeOrderStatus(order, new Date());
  },

  // ── Timeline visible range ────────────────────────────────
  timelineRange: { start: new Date(Date.now() - 2 * 24 * 3600 * 1000), end: new Date(Date.now() + 2 * 24 * 3600 * 1000) },
  setTimelineRange: (start, end) => set({ timelineRange: { start, end } }),

  // ── Linked orders ────────────────────────────────────────
  linkedOrders: {},

  // ── Detention alerts ──────────────────────────────────────
  detentionAlerts: [],

  checkDetention: () => {
    const { orders, loads, locations, viewTime, detentionAlerts } = get();
    const viewMs = viewTime.getTime();
    // Use event ID as the dedup key — one alert per event, ever
    const existingEventIds = new Set(detentionAlerts.map(a => a.eventId));

    for (const order of orders) {
      if (order.status !== 'dispatched') continue; // only dispatched orders trigger detention
      for (const ev of order.events) {
        if (ev.type !== 'loading' && ev.type !== 'unloading') continue;
        const evStart = new Date(ev.start_time).getTime();
        const evEnd = new Date(ev.end_time).getTime();
        // Event must be active at viewTime
        if (viewMs < evStart || viewMs > evEnd) continue;
        // Must have a truck assigned
        if (!ev.truck_id) continue;

        // Dedup by event ID
        if (existingEventIds.has(ev.id)) continue;

        // Resolve phone and location name
        const load = loads.find(l => l.id === ev.load_id);
        if (!load) continue;
        const phone = ev.type === 'loading' ? load.pickup_phone as string : load.dropoff_phone as string;
        const locId = ev.type === 'loading' ? order.pickup_location_id : order.dropoff_location_id;
        const loc = locations.find(l => l.id === locId);
        const locName = loc?.name as string || 'unknown';

        // Record in DB
        api.recordDetention({
          order_id: order.id,
          load_id: ev.load_id,
          event_id: ev.id,
          event_type: ev.type,
          phone,
          location_id: locId,
          truck_id: ev.truck_id,
          driver_id: ev.driver_id,
          trailer_id: ev.trailer_id,
          detention_time: ev.start_time,
        }).catch(() => {});

        // Add alert
        set(state => ({
          detentionAlerts: [...state.detentionAlerts, {
            eventId: ev.id,
            orderId: order.id,
            loadNumber: order.load_number,
            eventType: ev.type,
            phone,
            locationName: locName,
            time: new Date(ev.start_time),
          }],
        }));
        // Mark as notified so we don't re-check on next frame
        existingEventIds.add(ev.id);
        break; // one alert per check cycle
      }
    }
  },

  dismissDetentionAlert: (index) => {
    set(state => ({
      detentionAlerts: state.detentionAlerts.filter((_, i) => i !== index),
    }));
  },
}));
