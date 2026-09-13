import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://localhost:4000';

export async function getToken(): Promise<string | null> {
  return await AsyncStorage.getItem('tm_token');
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem('tm_token', token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem('tm_token');
}

export async function setUserData(data: {
  id: string; user_name: string; name: string; role: string; driver_id?: string;
}): Promise<void> {
  await AsyncStorage.setItem('tm_user', JSON.stringify(data));
}

export async function getUserData(): Promise<{
  id: string; user_name: string; name: string; role: string; driver_id?: string;
} | null> {
  const data = await AsyncStorage.getItem('tm_user');
  return data ? JSON.parse(data) : null;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = await getToken();
  const resp = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (resp.status === 401) {
    await clearToken();
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

export interface Haul {
  id: string; load_id: string; driver_id: string; truck_id: string; trailer_id: string;
  started_at: string; ended_at: string; status: string;
  load_number: string; load_weight: number; commodity: string;
  driver_name: string; truck_number: string; trailer_number: string;
  pickup_name: string; dropoff_name: string;
  pickup_phone: string; dropoff_phone: string;
  pickup_after: string; pickup_before: string;
  dropoff_after: string; dropoff_before: string;
  is_hazmat: boolean; rate_km: number; load_note: string;
}

export interface Itinerary {
  haul_id: string;
  geometry: { lat: number; lng: number }[];
  total_distance_m: number;
  segments: { road_segment_id: string; geometry: { lat: number; lng: number }[]; maxspeed_km: number }[];
}

export const api = {
  login: (user_name: string, password: string) =>
    apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ user_name, password }) }) as Promise<{
      token: string; user: { id: string; user_name: string; name: string; role: string; driver_id?: string };
    }>,

  getHauls: (driverId: string) =>
    apiFetch(`/api/hauls?driver_id=${driverId}`) as Promise<Haul[]>,

  getItinerary: (haulId: string) =>
    apiFetch(`/api/itineraries/${haulId}`) as Promise<Itinerary>,

  getHOS: (driverId: string) =>
    apiFetch(`/api/hos/${driverId}`) as Promise<Record<string, unknown>>,

  updateStatus: (driverId: string, status: string) =>
    apiFetch(`/api/hos/${driverId}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  reportPosition: (truckId: string, lat: number, lng: number, heading: number, speed: number) =>
    apiFetch('/api/positions', { method: 'POST', body: JSON.stringify({
      truck_id: truckId, lat, lng, heading, speed_kmh: speed,
    }) }),
};
