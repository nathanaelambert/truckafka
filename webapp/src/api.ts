const API_URL = (import.meta as unknown as { env: { VITE_API_URL: string } }).env?.VITE_API_URL || 'http://localhost:4000';
const WS_URL = (import.meta as unknown as { env: { VITE_WS_URL: string } }).env?.VITE_WS_URL || 'ws://localhost:4000/ws';

// ═══════════════════════════════════════════════════════════════
// API client
// ═══════════════════════════════════════════════════════════════

function getToken(): string | null {
  return localStorage.getItem('tm_token');
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = getToken();
  const resp = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (resp.status === 401) {
    localStorage.removeItem('tm_token');
    localStorage.removeItem('tm_user');
    window.location.reload();
    throw new Error('Unauthorized');
  }

  const text = await resp.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!resp.ok) {
    throw new Error((data as { message?: string })?.message || `HTTP ${resp.status}`);
  }

  return data;
}

export const api = {
  // Auth
  login: (user_name: string, password: string) =>
    apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ user_name, password }) }) as Promise<{ token: string; user: { id: string; user_name: string; name: string; role: string; driver_id?: string } }>,

  // Trucks
  getTrucks: () => apiFetch('/api/trucks'),
  createTruck: (data: Record<string, unknown>) => apiFetch('/api/trucks', { method: 'POST', body: JSON.stringify(data) }),
  updateTruck: (id: string, data: Record<string, unknown>) => apiFetch(`/api/trucks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTruck: (id: string) => apiFetch(`/api/trucks/${id}`, { method: 'DELETE' }),

  // Trailers
  getTrailers: () => apiFetch('/api/trailers'),
  createTrailer: (data: Record<string, unknown>) => apiFetch('/api/trailers', { method: 'POST', body: JSON.stringify(data) }),
  updateTrailer: (id: string, data: Record<string, unknown>) => apiFetch(`/api/trailers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTrailer: (id: string) => apiFetch(`/api/trailers/${id}`, { method: 'DELETE' }),

  // Drivers
  getDrivers: () => apiFetch('/api/drivers'),
  createDriver: (data: Record<string, unknown>) => apiFetch('/api/drivers', { method: 'POST', body: JSON.stringify(data) }),
  updateDriver: (id: string, data: Record<string, unknown>) => apiFetch(`/api/drivers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDriver: (id: string) => apiFetch(`/api/drivers/${id}`, { method: 'DELETE' }),

  // Locations
  getLocations: () => apiFetch('/api/locations'),
  createLocation: (data: Record<string, unknown>) => apiFetch('/api/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: Record<string, unknown>) => apiFetch(`/api/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id: string) => apiFetch(`/api/locations/${id}`, { method: 'DELETE' }),

  // Loads
  getLoads: () => apiFetch('/api/loads'),
  getLoad: (id: string) => apiFetch(`/api/loads/${id}`),
  createLoad: (data: Record<string, unknown>) => apiFetch('/api/loads', { method: 'POST', body: JSON.stringify(data) }),
  updateLoad: (id: string, data: Record<string, unknown>) => apiFetch(`/api/loads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLoad: (id: string) => apiFetch(`/api/loads/${id}`, { method: 'DELETE' }),

  // Hauls
  getHauls: (params?: { status?: string; driver_id?: string }) =>
    apiFetch(`/api/hauls${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`),
  getHaul: (id: string) => apiFetch(`/api/hauls/${id}`),
  createHaul: (data: Record<string, unknown>) => apiFetch('/api/hauls', { method: 'POST', body: JSON.stringify(data) }),
  updateHaul: (id: string, data: Record<string, unknown>) => apiFetch(`/api/hauls/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  submitHaul: (id: string) => apiFetch(`/api/hauls/${id}/submit`, { method: 'POST' }),
  startHaul: (id: string) => apiFetch(`/api/hauls/${id}/start`, { method: 'POST' }),
  completeHaul: (id: string) => apiFetch(`/api/hauls/${id}/complete`, { method: 'POST' }),
  deleteHaul: (id: string) => apiFetch(`/api/hauls/${id}`, { method: 'DELETE' }),

  // Orders
  getOrders: () => apiFetch('/api/orders'),
  getOrder: (id: string) => apiFetch(`/api/orders/${id}`),
  createOrder: (data: Record<string, unknown>) => apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(data) }),
  updateOrder: (id: string, data: Record<string, unknown>) => apiFetch(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrder: (id: string) => apiFetch(`/api/orders/${id}`, { method: 'DELETE' }),

  // Itineraries
  getItinerary: (haulId: string) => apiFetch(`/api/itineraries/${haulId}`),
  getLoadItinerary: (loadId: string) => apiFetch(`/api/itineraries/load/${loadId}`),
  recomputeItinerary: (haulId: string) => apiFetch(`/api/itineraries/${haulId}/recompute`, { method: 'POST' }),
  getRoute: (startLat: number, startLng: number, endLat: number, endLng: number, weight?: number, startAt?: string, isLoaded?: boolean) => {
    const params = new URLSearchParams();
    params.set('startLat', String(startLat));
    params.set('startLng', String(startLng));
    params.set('endLat', String(endLat));
    params.set('endLng', String(endLng));
    if (weight) params.set('weight', String(weight));
    if (startAt) params.set('startAt', startAt);
    if (isLoaded) params.set('isLoaded', 'true');
    return apiFetch(`/api/itineraries/route?${params.toString()}`) as Promise<{ geometry: { lat: number; lng: number }[]; total_distance_m: number; total_time_s: number }>;
  },

  // Road segments & events
  getRoadSegments: (bbox?: string) => apiFetch(`/api/road-segments${bbox ? '?bbox=' + bbox : ''}`),
  loadRoadSegments: (minLat: number, minLng: number, maxLat: number, maxLng: number) =>
    apiFetch('/api/road-segments/load', { method: 'POST', body: JSON.stringify({ minLat, minLng, maxLat, maxLng }) }),
  getRoadEvents: (active?: boolean) => apiFetch(`/api/road-events${active ? '?active=true' : ''}`),
  createRoadEvent: (data: Record<string, unknown>) => apiFetch('/api/road-events', { method: 'POST', body: JSON.stringify(data) }),
  updateRoadEvent: (id: string, data: Record<string, unknown>) => apiFetch(`/api/road-events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoadEvent: (id: string) => apiFetch(`/api/road-events/${id}`, { method: 'DELETE' }),

  // Positions & HOS
  getPositions: () => apiFetch('/api/positions'),
  getPositionHistory: (truckId: string, hours = 24) => apiFetch(`/api/positions/${truckId}/history?hours=${hours}`),
  getAllHOS: () => apiFetch('/api/hos'),
  getHOS: (driverId: string) => apiFetch(`/api/hos/${driverId}`),
  updateDriverStatus: (driverId: string, status: string) => apiFetch(`/api/hos/${driverId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  // Events
  getEvents: (from: string, to: string) => apiFetch(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  getEventSnapshot: (time: string) => apiFetch(`/api/events/snapshot?time=${encodeURIComponent(time)}`),
  createEvent: (data: Record<string, unknown>) => apiFetch('/api/events', { method: 'POST', body: JSON.stringify(data) }),
  updateEvent: (id: string, data: Record<string, unknown>) => apiFetch(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEvent: (id: string) => apiFetch(`/api/events/${id}`, { method: 'DELETE' }),

  // Detention
  recordDetention: (data: Record<string, unknown>) => apiFetch('/api/detention', { method: 'POST', body: JSON.stringify(data) }),
  getDetention: (params?: { order_id?: string; load_id?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return apiFetch(`/api/detention${qs}`);
  },

  // Trajectories (legacy)
  getTrajectorySnapshot: (time: string) => apiFetch(`/api/trajectories/snapshot?time=${encodeURIComponent(time)}`),
  getTrajectory: (elementType: string, elementId: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return apiFetch(`/api/trajectories/${elementType}/${elementId}${qs ? '?' + qs : ''}`);
  },
  getAllTrajectories: (from: string, to: string) => apiFetch(`/api/trajectories?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  // Fleet summary
  getFleetSummary: () => apiFetch('/api/fleet/summary'),

  // Users
  getUsers: () => apiFetch('/api/users'),
  createUser: (data: Record<string, unknown>) => apiFetch('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  deleteUser: (id: string) => apiFetch(`/api/users/${id}`, { method: 'DELETE' }),

  // Simulation
  startSimulation: (haulId: string, speedKmh?: number) => apiFetch(`/api/simulate/${haulId}/start`, { method: 'POST', body: JSON.stringify({ speed_kmh: speedKmh }) }),
  stopSimulation: (haulId: string) => apiFetch(`/api/simulate/${haulId}/stop`, { method: 'POST' }),
  getActiveSimulations: () => apiFetch('/api/simulate'),

  // Admin
  nukeAll: () => apiFetch('/api/admin/nuke?confirm=YES_DELETE_EVERYTHING', { method: 'DELETE' }),
};

// ═══════════════════════════════════════════════════════════════
// WebSocket client
// ═══════════════════════════════════════════════════════════════

export function connectWebSocket(onMessage: (data: unknown) => void): WebSocket {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => console.log('[WS] Connected');
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 3s...');
    setTimeout(() => connectWebSocket(onMessage), 3000);
  };
  ws.onerror = () => ws.close();
  return ws;
}
