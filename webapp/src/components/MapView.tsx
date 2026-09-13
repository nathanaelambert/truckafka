import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMap } from 'react-leaflet';
import { createLayerComponent } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useStore, type SelectedElement } from '../store';
import { api } from '../api';
import { StageOverlay, MapClickHandler } from './StageOverlay';
import { RefHeader } from './ElementHeader';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const CENTER: [number, number] = [43.5183, -80.55];
const ZOOM = 8;

function speedColor(maxspeed: number): string {
  if (maxspeed >= 100) return '#4ade80';
  if (maxspeed >= 80) return '#a3e635';
  if (maxspeed >= 60) return '#fbbf24';
  if (maxspeed >= 40) return '#fb923c';
  return '#f87171';
}

function createTruckIcon(heading: number, truckNumber: string): L.DivIcon {
  return L.divIcon({
    className: 'truck-marker',
    html: `<div style="display: flex; flex-direction: column; align-items: center;">
      <svg width="24" height="24" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
        <path d="M2 8h11v8H2z" fill="#4a9eff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>
        <path d="M13 11h4l3 3v2h-7z" fill="#4a9eff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>
        <circle cx="6" cy="18" r="1.8" fill="#1a1d27" stroke="#fff" stroke-width="1"/>
        <circle cx="17" cy="18" r="1.8" fill="#1a1d27" stroke="#fff" stroke-width="1"/>
      </svg>
      <div style="background: rgba(15,17,23,0.85); color: #4a9eff; font-size: 10px; font-weight: 700; padding: 1px 4px; border-radius: 3px; margin-top: 1px; white-space: nowrap;">${truckNumber}</div>
    </div>`,
    iconSize: [24, 34],
    iconAnchor: [12, 14],
  });
}

function createLoadIcon(loadNumber: string): L.DivIcon {
  return L.divIcon({
    className: 'load-marker',
    html: `<div style="display: flex; flex-direction: column; align-items: center;">
      <svg width="22" height="22" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" fill="#a78bfa" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>
      </svg>
      <div style="background: rgba(15,17,23,0.85); color: #a78bfa; font-size: 10px; font-weight: 700; padding: 1px 4px; border-radius: 3px; margin-top: 1px; white-space: nowrap;">${loadNumber}</div>
    </div>`,
    iconSize: [22, 32],
    iconAnchor: [11, 12],
  });
}

const EVENT_COLORS: Record<string, string> = {
  loading: '#4ade80', unloading: '#a3e635', bobtail: '#fb923c', deadmile: '#fbbf24', haul: '#4a9eff', attach: '#a78bfa', detach: '#c084fc', idle: '#6b7280',
};

const EVENT_ICONS: Record<string, string> = {
  loading: '📦', unloading: '📤', bobtail: '🚛', deadmile: '🚚', haul: '🛻', attach: '🔗', detach: '✂️', idle: '⏸',
};

function createEventIcon(type: string, selected: boolean = false): L.DivIcon {
  const color = EVENT_COLORS[type] || '#6b7280';
  const icon = EVENT_ICONS[type] || '•';
  const pinStyle = selected
    ? 'border:3px solid #fff;box-shadow:0 0 0 2px ' + color + ',0 2px 8px rgba(0,0,0,0.5);'
    : 'box-shadow:0 2px 6px rgba(0,0,0,0.4);';
  return L.divIcon({
    className: 'event-marker' + (selected ? ' event-marker-selected' : ''),
    html: `<div style="display:flex;flex-direction:column;align-items:center;position:relative;">
      <div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px;${pinStyle}">${icon}</div>
      <div style="background:rgba(15,17,23,0.85);color:${color};font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;margin-top:1px;white-space:nowrap;">${type}</div>
    </div>`,
    iconSize: selected ? [48, 48] : [28, 38],
    iconAnchor: selected ? [24, 24] : [14, 14],
  });
}

function createLocationIcon(name: string): L.DivIcon {
  const shortName = name.length > 20 ? name.slice(0, 18) + '…' : name;
  return L.divIcon({
    className: 'location-marker',
    html: `<div style="display: flex; flex-direction: column; align-items: center;">
      <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#fbbf24" stroke="#fff" stroke-width="2"/></svg>
      <div style="background: rgba(15,17,23,0.85); color: #fbbf24; font-size: 10px; font-weight: 600; padding: 1px 4px; border-radius: 3px; margin-top: 1px; white-space: nowrap;">${shortName}</div>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 10],
  });
}

function createDriverIcon(name: string): L.DivIcon {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return L.divIcon({
    className: 'driver-marker',
    html: `<div style="display: flex; flex-direction: column; align-items: center;">
      <div style="width: 24px; height: 24px; border-radius: 50%; background: #10b981; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #000; box-shadow: 0 1px 3px rgba(0,0,0,0.5);">${initials}</div>
      <div style="background: rgba(15,17,23,0.85); color: #10b981; font-size: 9px; font-weight: 600; padding: 1px 4px; border-radius: 3px; margin-top: 1px; white-space: nowrap;">${name}</div>
    </div>`,
    iconSize: [24, 34],
    iconAnchor: [12, 12],
  });
}

function createTrailerIcon(number: string): L.DivIcon {
  return L.divIcon({
    className: 'trailer-marker',
    html: `<div style="display: flex; flex-direction: column; align-items: center;">
      <svg width="22" height="22" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="10" rx="1" fill="#a78bfa" stroke="#fff" stroke-width="2"/><circle cx="8" cy="18" r="2" fill="#a78bfa" stroke="#fff" stroke-width="1"/><circle cx="16" cy="18" r="2" fill="#a78bfa" stroke="#fff" stroke-width="1"/></svg>
      <div style="background: rgba(15,17,23,0.85); color: #a78bfa; font-size: 10px; font-weight: 600; padding: 1px 4px; border-radius: 3px; margin-top: 1px; white-space: nowrap;">#${number}</div>
    </div>`,
    iconSize: [22, 30],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ positions }: { positions: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (positions && positions.length > 1) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true });
    }
  }, [positions, map]);
  return null;
}

const _MarkerClusterGroup = createLayerComponent<L.MarkerClusterGroup, L.MarkerClusterGroupOptions>(
  function createClusterGroup(options, ctx) {
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      ...options,
    });
    return { instance: cluster, context: { ...ctx, layerContainer: cluster } };
  }
);
const MarkerClusterGroup = _MarkerClusterGroup as unknown as React.ComponentType<{ children?: React.ReactNode }>;

function MaybeCluster({ children }: { children: React.ReactNode }) {
  return <MarkerClusterGroup>{children}</MarkerClusterGroup>;
}

// ── Selected element handler: centers map, opens popup, brings to front ──

function SelectedElementHandler({ markerRefs }: { markerRefs: React.MutableRefObject<Map<string, L.Marker>> }) {
  const map = useMap();
  const { selected, locations, trucks, trailers, drivers, positions, loads } = useStore();
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevKeyRef.current) {
      const prevMarker = markerRefs.current.get(prevKeyRef.current);
      if (prevMarker) prevMarker.setZIndexOffset(0);
      prevKeyRef.current = null;
    }

    if (!selected) return;

    let pos: { lat: number; lng: number } | null = null;
    let key = '';

    if (selected.type === 'location') {
      const loc = locations.find((l) => l.id === selected.id);
      const p = loc?.position as { lat: number; lng: number } | null | undefined;
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
        pos = p;
        key = `location-${selected.id}`;
      }
    } else if (selected.type === 'truck') {
      const truckPos = positions.get(selected.id);
      if (truckPos) {
        pos = { lat: truckPos.lat, lng: truckPos.lng };
        key = `truck-${selected.id}`;
      } else {
        // Fall back to truck's location_id
        const truck = trucks.find((t) => t.id === selected.id);
        if (truck?.location_id) {
          const loc = locations.find((l) => l.id === truck.location_id);
          const p = loc?.position as { lat: number; lng: number } | null | undefined;
          if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
            pos = p;
            key = `location-${loc!.id}`;
          }
        }
      }
    } else if (selected.type === 'driver') {
      const driver = drivers.find((d) => d.id === selected.id);
      if (driver?.home_location_id) {
        const loc = locations.find((l) => l.id === driver.home_location_id);
        const p = loc?.position as { lat: number; lng: number } | null | undefined;
        if (p && typeof p.lat === 'number') {
          pos = { lat: p.lat + 0.002, lng: p.lng + 0.002 };
          key = `driver-${selected.id}`;
        }
      }
    } else if (selected.type === 'trailer') {
      const trailer = trailers.find((t) => t.id === selected.id);
      if (trailer?.location_id) {
        const loc = locations.find((l) => l.id === trailer.location_id);
        const p = loc?.position as { lat: number; lng: number } | null | undefined;
        if (p && typeof p.lat === 'number') {
          pos = { lat: p.lat - 0.002, lng: p.lng + 0.002 };
          key = `trailer-${selected.id}`;
        }
      }
    } else if (selected.type === 'load') {
      const load = loads.find((l) => l.id === selected.id);
      if (load?.pickup_location_id) {
        const loc = locations.find((l) => l.id === load.pickup_location_id);
        const p = loc?.position as { lat: number; lng: number } | null | undefined;
        if (p && typeof p.lat === 'number') {
          pos = p;
        }
      }
    }

    if (pos) {
      map.panTo([pos.lat, pos.lng], { animate: true });

      if (key) {
        const marker = markerRefs.current.get(key);
        if (marker) {
          marker.setZIndexOffset(1000);
          marker.openPopup();
          prevKeyRef.current = key;
        }
      }
    }
  }, [selected, locations, positions, drivers, trailers, loads, trucks, map, markerRefs]);

  return null;
}

function EventMarkersLayer({ selectedEventId }: { selectedEventId: string | null }) {
  const map = useMap();
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const { locations } = useStore();
  const orders = useStore(state => state.orders);
  const viewTime = useStore(state => state.viewTime);
  const hiddenItems = useStore(state => state.hiddenItems);

  const isHidden = (type: string, id: string) => hiddenItems[type]?.has(id) ?? false;

  // Build the events list directly from store state
  const events = (() => {
    const orderEventIds = new Set<string>();
    for (const order of orders) {
      if (isHidden('order', order.id)) continue;
      for (const ev of order.events) orderEventIds.add(ev.id);
    }

    const viewMs = viewTime.getTime();

    return orders.flatMap(order => {
      if (isHidden('order', order.id)) return [];
      return order.events
        .filter(ev => {
          const s = new Date(ev.start_time).getTime();
          const e = new Date(ev.end_time).getTime();
          return s <= viewMs && e >= viewMs;
        })
        // Note: we don't filter by actor visibility here — order visibility is the source of truth
        .map(ev => {
          const isMotion = ev.type === 'haul' || ev.type === 'deadmile' || ev.type === 'bobtail';
          let lat = 0, lng = 0;

          if (isMotion && ev.path && ev.path.length >= 2) {
            const sMs = new Date(ev.start_time).getTime();
            const eMs = new Date(ev.end_time).getTime();
            const progress = eMs > sMs ? Math.max(0, Math.min(1, (viewMs - sMs) / (eMs - sMs))) : 0;
            const cumDist: number[] = [0];
            let totalDist = 0;
            for (let i = 1; i < ev.path.length; i++) {
              const dx = ev.path[i].lng - ev.path[i - 1].lng;
              const dy = ev.path[i].lat - ev.path[i - 1].lat;
              totalDist += Math.sqrt(dx * dx + dy * dy);
              cumDist.push(totalDist);
            }
            const targetDist = progress * totalDist;
            let segIdx = 0;
            for (let i = 0; i < cumDist.length - 1; i++) {
              if (targetDist >= cumDist[i] && targetDist <= cumDist[i + 1]) { segIdx = i; break; }
            }
            if (totalDist > 0 && segIdx < ev.path.length - 1) {
              const segLen = cumDist[segIdx + 1] - cumDist[segIdx];
              const segProgress = segLen > 0 ? (targetDist - cumDist[segIdx]) / segLen : 0;
              lat = ev.path[segIdx].lat + (ev.path[segIdx + 1].lat - ev.path[segIdx].lat) * segProgress;
              lng = ev.path[segIdx].lng + (ev.path[segIdx + 1].lng - ev.path[segIdx].lng) * segProgress;
            } else {
              lat = ev.path[ev.path.length - 1].lat;
              lng = ev.path[ev.path.length - 1].lng;
            }
          } else {
            const loc = locations.find(l => l.id === ev.start_location_id);
            const p = loc?.position as { lat: number; lng: number } | undefined;
            lat = p?.lat || 0;
            lng = p?.lng || 0;
          }

          return {
            id: ev.id, type: ev.type, lat, lng,
            has_motion: isMotion,
            start_location_id: ev.start_location_id,
            truck_id: ev.truck_id, load_id: ev.load_id,
            trailer_id: ev.trailer_id, driver_id: ev.driver_id,
          };
        });
    }).filter(ev => ev.lat !== 0 || ev.lng !== 0);
  })();

  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Update icon highlight when selection changes
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const ev = eventsRef.current.find(e => e.id === id);
      if (!ev) continue;
      const isSel = selectedEventId === id;
      marker.setIcon(createEventIcon(ev.type, isSel));
      if (isSel) marker.setZIndexOffset(1000);
      else marker.setZIndexOffset(0);
    }
  }, [selectedEventId]);

  // Re-render markers whenever orders, viewTime, hiddenItems, or locations change
  useEffect(() => {
    const currentIds = new Set(events.map(e => e.id));
    const existingMarkers = markersRef.current;

    // Remove markers that are no longer present
    for (const [id, marker] of existingMarkers) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        existingMarkers.delete(id);
      }
    }

    // Add or update markers
    let selLat = 0, selLng = 0;
    for (const ev of events) {
      let lat = ev.lat, lng = ev.lng;
      if (!ev.has_motion || (lat === 0 && lng === 0)) {
        const loc = locations.find(l => l.id === ev.start_location_id);
        const p = loc?.position as { lat: number; lng: number } | null | undefined;
        if (p && typeof p.lat === 'number') { lat = p.lat; lng = p.lng; }
      }

      if (lat === 0 && lng === 0) continue;

      if (selectedEventId === ev.id) { selLat = lat; selLng = lng; }

      const isSel = selectedEventId === ev.id;
      const existing = existingMarkers.get(ev.id);
      if (existing) {
        existing.setLatLng([lat, lng]);
        existing.setIcon(createEventIcon(ev.type, isSel));
        if (isSel) existing.setZIndexOffset(1000);
        else existing.setZIndexOffset(0);
      } else {
        const marker = L.marker([lat, lng], { icon: createEventIcon(ev.type, isSel) });
        if (isSel) marker.setZIndexOffset(1000);
        marker.on('click', () => {
          const cur = useStore.getState().selectedEventId;
          useStore.getState().setSelectedEventId(cur === ev.id ? null : ev.id);
        });
        marker.addTo(map);
        existingMarkers.set(ev.id, marker);
      }
    }
  }, [orders, viewTime, hiddenItems, locations, selectedEventId, map]); // depend on raw store values

  return null;
}

// Always-on marker for the selected event — shows even in live mode or when
// the event isn't in the current snapshot
function SelectedEventMarkerLayer() {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const { selectedEventId, locations, orders, viewTime } = useStore();
  const [eventData, setEventData] = useState<{ id: string; type: string; start_location_id: string; has_motion: boolean; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!selectedEventId) { setEventData(null); return; }

    // Check if this is a road event — road events have their own markers, skip SelectedEventMarkerLayer
    const isRoadEvent = useStore.getState().roadEvents.some((re: any) => re.id === selectedEventId);
    if (isRoadEvent) { setEventData(null); return; }

    // First check order events (in store)
    for (const order of orders) {
      const ev = order.events.find(e => e.id === selectedEventId);
      if (ev) {
        const isMotion = ev.type === 'haul' || ev.type === 'deadmile' || ev.type === 'bobtail';
        let lat = 0, lng = 0;

        if (isMotion && ev.path && ev.path.length >= 2) {
          // Interpolate along path
          const sMs = new Date(ev.start_time).getTime();
          const eMs = new Date(ev.end_time).getTime();
          const progress = eMs > sMs ? Math.max(0, Math.min(1, (viewTime.getTime() - sMs) / (eMs - sMs))) : 0;
          const cumDist: number[] = [0];
          let totalDist = 0;
          for (let i = 1; i < ev.path.length; i++) {
            const dx = ev.path[i].lng - ev.path[i - 1].lng;
            const dy = ev.path[i].lat - ev.path[i - 1].lat;
            totalDist += Math.sqrt(dx * dx + dy * dy);
            cumDist.push(totalDist);
          }
          const targetDist = progress * totalDist;
          let segIdx = 0;
          for (let i = 0; i < cumDist.length - 1; i++) {
            if (targetDist >= cumDist[i] && targetDist <= cumDist[i + 1]) { segIdx = i; break; }
          }
          if (totalDist > 0 && segIdx < ev.path.length - 1) {
            const segLen = cumDist[segIdx + 1] - cumDist[segIdx];
            const segProgress = segLen > 0 ? (targetDist - cumDist[segIdx]) / segLen : 0;
            lat = ev.path[segIdx].lat + (ev.path[segIdx + 1].lat - ev.path[segIdx].lat) * segProgress;
            lng = ev.path[segIdx].lng + (ev.path[segIdx + 1].lng - ev.path[segIdx].lng) * segProgress;
          } else {
            lat = ev.path[ev.path.length - 1].lat;
            lng = ev.path[ev.path.length - 1].lng;
          }
        } else {
          const loc = locations.find(l => l.id === ev.start_location_id);
          const p = loc?.position as { lat: number; lng: number } | undefined;
          lat = p?.lat || 0; lng = p?.lng || 0;
        }

        setEventData({ id: ev.id, type: ev.type, start_location_id: ev.start_location_id, has_motion: isMotion, lat, lng });
        return;
      }
    }

    // Check road events — handled by the permanent road event markers, skip here to avoid duplicate pins
    // (road events have their own orange markers that handle selection state)

    // Fallback: DB events
    api.getEvents(new Date(Date.now() - 30 * 86400000).toISOString(), new Date(Date.now() + 30 * 86400000).toISOString())
      .then((data: unknown) => {
        const d = data as { events: any[] };
        const ev = d.events.find(e => e.id === selectedEventId);
        if (!ev) { setEventData(null); return; }
        setEventData({
          id: ev.id,
          type: ev.type,
          start_location_id: ev.start_location_id,
          has_motion: !!ev.motion_id,
          lat: 0,
          lng: 0,
        });
      }).catch(() => setEventData(null));
  }, [selectedEventId, orders, locations, viewTime]);

  useEffect(() => {
    if (!eventData) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      return;
    }

    let lat = eventData.lat, lng = eventData.lng;

    // If no position from event data, try resolving from location
    if (lat === 0 && lng === 0) {
      const loc = locations.find(l => l.id === eventData.start_location_id);
      const p = loc?.position as { lat: number; lng: number } | null | undefined;
      if (p && typeof p.lat === 'number') { lat = p.lat; lng = p.lng; }
    }

    if (lat === 0 && lng === 0) return;

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      markerRef.current.setIcon(createEventIcon(eventData.type, true));
      markerRef.current.setZIndexOffset(2000);
    } else {
      const marker = L.marker([lat, lng], { icon: createEventIcon(eventData.type, true), zIndexOffset: 2000 });
      marker.on('click', () => {
        useStore.getState().setSelectedEventId(null);
      });
      marker.addTo(map);
      markerRef.current = marker;
    }
    // Don't pan — let the user control the map. The EventMarkersLayer already shows the event.

    return () => {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    };
  }, [eventData, locations, map]);

  return null;
}

export function MapView() {
  const { viewOptions, positions, trucks, trailers, drivers, locations, loads, selected, hiddenItems, toggleStaging, setDragItem, moveToStaging, isLiveTime, viewTime, selectedEventId, setSelectedEventId } = useStore();
  const roadEvents = useStore(state => state.roadEvents);
  const [positionHistory, setPositionHistory] = useState<{ lat: number; lng: number }[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const loadingCount = useRef(0);
  const [loadingDots, setLoadingDots] = useState('   ');
  const [dragOverMap, setDragOverMap] = useState(false);

  const startLoading = () => {
    loadingCount.current++;
    if (loadingCount.current === 1) setMapLoading(true);
  };
  const stopLoading = () => {
    loadingCount.current = Math.max(0, loadingCount.current - 1);
    if (loadingCount.current === 0) setMapLoading(false);
  };

  // Marker refs for programmatic popup/z-index control
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  const isHidden = (type: string, id: string) => hiddenItems[type]?.has(id) ?? false;

  // Register a marker ref
  const registerMarker = (key: string) => (marker: L.Marker | null) => {
    if (marker) {
      markerRefs.current.set(key, marker);
    } else {
      markerRefs.current.delete(key);
    }
  };
  useEffect(() => {
    if (selected?.type === 'truck') {
      startLoading();
      api.getPositionHistory(selected.id, 6).then((data) => {
        setPositionHistory(data as { lat: number; lng: number }[]);
      }).catch(() => setPositionHistory([])).finally(stopLoading);
    } else {
      setPositionHistory([]);
    }
  }, [selected, positions]);

  useEffect(() => {
    if (!mapLoading) return;
    const frames = ['   ', '.  ', '.. ', '...', ' ..', '  .'];
    let i = 0;
    const timer = setInterval(() => {
      setLoadingDots(frames[i % frames.length]);
      i++;
    }, 300);
    return () => clearInterval(timer);
  }, [mapLoading]);

  return (
    <div
      className="monitor-map"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/json')) {
          e.preventDefault();
          setDragOverMap(true);
        }
      }}
      onDragLeave={() => setDragOverMap(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOverMap(false);
        const raw = e.dataTransfer.getData('application/json');
        if (raw) {
          try {
            const el = JSON.parse(raw) as SelectedElement;
            moveToStaging(el);
          } catch { /* ignore */ }
        }
        setDragItem(null);
      }}
    >
      <MapContainer center={CENTER} zoom={ZOOM} className="leaflet-container" style={{ height: '100%', width: '100%', filter: mapLoading ? 'saturate(0.3)' : 'none', transition: 'filter 0.2s' }}>
        <SelectedElementHandler markerRefs={markerRefs} />
        <MapClickHandler />

        {viewOptions.satelliteLayer ? (
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="&copy; Esri" maxZoom={19} />
        ) : (
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" maxZoom={19} />
        )}

        {/* Locations */}
        <MaybeCluster>
        {locations.map((loc) => {
          if (isHidden('location', loc.id as string)) return null;
          const pos = loc.position as { lat: number; lng: number } | null | undefined;
          if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return null;
          const key = `location-${loc.id as string}`;
          return (
            <Marker
              key={key}
              ref={registerMarker(key)}
              position={[pos.lat, pos.lng]}
              icon={createLocationIcon(loc.name as string)}
              eventHandlers={{ click: () => {
                toggleStaging({ type: 'location', id: loc.id as string });
              }}}
            />
          );
        })}
        </MaybeCluster>

        {/* Geofences */}
        {locations.map((loc) => {
          if (isHidden('location', loc.id as string)) return null;
          const gf = loc.geofence_boundary as { lat: number; lng: number }[] | undefined;
          if (!gf || gf.length < 3) return null;
          return (
            <Polygon
              key={`gf-${loc.id as string}`}
              positions={gf.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: '#fbbf24', weight: 1, opacity: 0.5, fillOpacity: 0.1 }}
            />
          );
        })}

        {/* Event markers — reads directly from store, shows order events active at playhead */}
        <EventMarkersLayer selectedEventId={selectedEventId} />

        {/* Road event pins — only show when active at playhead time */}
        {roadEvents.map((re) => {
          const reId = re.id as string;
          if (isHidden('road_event', reId)) return null;
          // Only show if active at current playback time
          const startMs = new Date(re.start_at as string).getTime();
          const endMs = re.end_at ? new Date(re.end_at as string).getTime() : startMs + 365 * 24 * 3600 * 1000;
          const viewMs = viewTime.getTime();
          if (startMs > viewMs || endMs < viewMs) return null;

          const bary = re.barycentre as { lat: number; lng: number } | null;
          if (!bary) return null;
          const isSel = selectedEventId === reId;
          const title = (re.title as string) || 'Road Event';
          return (
            <Marker
              key={`road-event-${reId}`}
              position={[bary.lat, bary.lng]}
              icon={L.divIcon({
                className: 'road-event-marker',
                html: `<div style="display:flex;flex-direction:column;align-items:center;">
                  <div style="width:24px;height:24px;border-radius:50%;background:#fb923c;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;${isSel ? 'box-shadow:0 0 0 2px #fb923c,0 2px 6px rgba(0,0,0,0.5);' : 'box-shadow:0 1px 3px rgba(0,0,0,0.5);'}">⚠</div>
                  <div style="background:rgba(15,17,23,0.85);color:#fb923c;font-size:9px;font-weight:600;padding:1px 4px;border-radius:3px;margin-top:1px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${title}</div>
                </div>`,
                iconSize: [24, 34], iconAnchor: [12, 12],
              })}
              eventHandlers={{ click: (e: any) => {
                const cur = useStore.getState().selectedEventId;
                useStore.getState().setSelectedEventId(cur === reId ? null : reId);
                if (cur !== reId) {
                  const map = e?.target?._map;
                  if (map) map.panTo([bary.lat, bary.lng], { animate: true });
                }
              }}}
            />
          );
        })}
      </MapContainer>

      {mapLoading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 1200, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'rgba(15,17,23,0.9)', color: 'var(--accent)',
            padding: '10px 24px', borderRadius: 8,
            fontSize: 14, fontWeight: 600, fontFamily: 'monospace',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            whiteSpace: 'pre',
          }}>
            updating map{loadingDots}
          </div>
        </div>
      )}

      {/* Layer switch button — thumbnail of the inactive layer */}
      <div
        onClick={() => useStore.getState().toggleViewOption('satelliteLayer')}
        title="Switch layer"
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 1000,
          width: 64, height: 64, borderRadius: 10,
          overflow: 'hidden', cursor: 'pointer',
          border: '2px solid rgba(255,255,255,0.7)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        {/* Thumbnail — shows the layer you'll switch TO (cached tile near University of Waterloo, ON) */}
        <img
          src={viewOptions.satelliteLayer ? '/tiles/map.png' : '/tiles/satellite.jpg'}
          alt={viewOptions.satelliteLayer ? 'Map layer' : 'Satellite layer'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {/* Hover overlay */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0)', transition: 'background 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'transparent', fontSize: 10, fontWeight: 700, textAlign: 'center',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(0,0,0,0.5)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(0,0,0,0)';
          e.currentTarget.style.color = 'transparent';
        }}
        >
          Switch<br />layer
        </div>
      </div>
    </div>
  );
}
