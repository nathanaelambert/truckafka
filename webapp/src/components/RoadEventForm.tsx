import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Modal } from './Modal';
import { api } from '../api';
import { useStore } from '../store';

const ROAD_EVENT_COLOR = '#fb923c';

interface RoadSegment {
  id: string;
  geometry: { lat: number; lng: number }[];
  name: string;
  highway_type: string;
  maxspeed_km: number;
  length_m: number;
}

// ── Distance from point to line segment ──────────────────
function distToSegment(pt: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.sqrt((pt.lat - a.lat) ** 2 + (pt.lng - a.lng) ** 2);
  const t = Math.max(0, Math.min(1, ((pt.lng - a.lng) * dx + (pt.lat - a.lat) * dy) / (dx * dx + dy * dy)));
  const projLat = a.lat + t * dy;
  const projLng = a.lng + t * dx;
  return Math.sqrt((pt.lat - projLat) ** 2 + (pt.lng - projLng) ** 2);
}

function distToPolyline(pt: { lat: number; lng: number }, geometry: { lat: number; lng: number }[]): number {
  let minDist = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    const d = distToSegment(pt, geometry[i], geometry[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ── Map handler: loads segments on move, handles clicks ───
function MapHandler({
  onMapClick,
  isDragging,
  onMapMove,
}: {
  onMapClick: (lat: number, lng: number) => void;
  isDragging: React.MutableRefObject<boolean>;
  onMapMove: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMapEvents({
    click(e) {
      if (isDragging.current) { isDragging.current = false; return; }
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    moveend() { onMapMove(map.getBounds()); },
    zoomend() { onMapMove(map.getBounds()); },
  });
  useEffect(() => { onMapMove(map.getBounds()); }, [map]);
  return null;
}

function FitBounds({ center }: { center: [number, number] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    map.setView(center, 14, { animate: true });
  }, [map, center]);
  return null;
}

export function RoadEventForm({ onClose }: { onClose: () => void }) {
  const { refreshRoadEvents } = useStore();
  const [segments, setSegments] = useState<RoadSegment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [center] = useState<[number, number]>([43.5183, -80.55]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    maxspeed_km: '',
    maxweight_kg: '',
    is_usable: true,
    start_at: new Date().toISOString().slice(0, 16),
    end_at: '',
    note: '',
  });
  const draggingRef = useRef(false);
  const segmentsRef = useRef<RoadSegment[]>([]);
  segmentsRef.current = segments;
  const loadedBboxesRef = useRef<Set<string>>(new Set());

  // Fetch + load road segments for a bbox
  const handleMapMove = useCallback(async (bounds: L.LatLngBounds) => {
    const bboxKey = `${bounds.getWest().toFixed(2)},${bounds.getSouth().toFixed(2)},${bounds.getEast().toFixed(2)},${bounds.getNorth().toFixed(2)}`;
    const minLat = bounds.getSouth();
    const minLng = bounds.getWest();
    const maxLat = bounds.getNorth();
    const maxLng = bounds.getEast();

    // First, fetch existing segments from DB
    const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
    try {
      const data = await api.getRoadSegments(bbox) as RoadSegment[];
      setSegments(prev => {
        const existingIds = new Set(prev.map(s => s.id));
        const newSegs = data.filter(s => !existingIds.has(s.id));
        return [...prev, ...newSegs];
      });
    } catch { /* ignore */ }

    // If we got very few segments, try loading from Overpass
    const data = segmentsRef.current;
    const inBbox = data.filter(s => {
      if (!s.geometry || s.geometry.length === 0) return false;
      const mid = s.geometry[Math.floor(s.geometry.length / 2)];
      return mid.lat >= minLat && mid.lat <= maxLat && mid.lng >= minLng && mid.lng <= maxLng;
    });

    if (inBbox.length < 20 && !loadedBboxesRef.current.has(bboxKey)) {
      loadedBboxesRef.current.add(bboxKey);
      setLoading(true);
      try {
        await api.loadRoadSegments(minLat, minLng, maxLat, maxLng);
        // Re-fetch after loading
        const newData = await api.getRoadSegments(bbox) as RoadSegment[];
        setSegments(prev => {
          const existingIds = new Set(prev.map(s => s.id));
          const newSegs = newData.filter(s => !existingIds.has(s.id));
          return [...prev, ...newSegs];
        });
      } catch { /* ignore Overpass errors */ }
      setLoading(false);
    }
  }, []);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    const clickPt = { lat, lng };
    const currentSegs = segmentsRef.current;

    if (currentSegs.length === 0) {
      // Try loading for this area
      const delta = 0.01;
      const bounds = L.latLngBounds([lat - delta, lng - delta], [lat + delta, lng + delta]);
      await handleMapMove(bounds);
    }

    const segs = segmentsRef.current;
    if (segs.length === 0) return;

    // Find closest segment using point-to-line distance
    let closest: RoadSegment | null = null;
    let minDist = Infinity;
    for (const seg of segs) {
      if (!seg.geometry || seg.geometry.length < 2) continue;
      const d = distToPolyline(clickPt, seg.geometry);
      if (d < minDist) { minDist = d; closest = seg; }
    }

    if (closest && minDist < 0.008) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(closest!.id)) next.delete(closest!.id);
        else next.add(closest!.id);
        return next;
      });
    }
  }, [handleMapMove]);

  const submit = async () => {
    if (!form.title) throw new Error('Title is required');
    if (!form.start_at) throw new Error('Start time is required');
    if (form.end_at && new Date(form.end_at) <= new Date(form.start_at)) {
      throw new Error('End time must be after start time');
    }
    if (selectedIds.size === 0) throw new Error('Select at least one road segment');

    await api.createRoadEvent({
      title: form.title,
      maxspeed_km: form.maxspeed_km ? parseInt(form.maxspeed_km) : null,
      maxweight_kg: form.maxweight_kg ? parseInt(form.maxweight_kg) : null,
      is_usable: form.is_usable,
      start_at: new Date(form.start_at).toISOString(),
      end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
      note: form.note || null,
      segment_ids: Array.from(selectedIds),
    });
    await refreshRoadEvents();
    onClose();
  };

  return (
    <Modal title="Create Road Event" onClose={onClose} onSubmit={submit} submitLabel="Create" width={800}>
      <div style={{ height: 400, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 12, position: 'relative' }}>
        <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }}>
          <MapHandler onMapClick={handleMapClick} isDragging={draggingRef} onMapMove={handleMapMove} />
          <FitBounds center={center} />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" maxZoom={19} />

          {/* Render road segments */}
          {segments.map(seg => {
            const isSel = selectedIds.has(seg.id);
            return (
              <Polyline
                key={seg.id}
                positions={seg.geometry.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: isSel ? ROAD_EVENT_COLOR : '#6b7280', weight: isSel ? 5 : 3, opacity: isSel ? 1 : 0.4 }}
              />
            );
          })}
        </MapContainer>

        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1000, padding: '6px 10px', background: 'rgba(15,17,23,0.9)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11 }}>
          <strong style={{ color: 'var(--text)' }}>Click near a road to select</strong> · {selectedIds.size} selected · {segments.length} segments {loading ? '· loading...' : ''}
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Title *</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Highway 401 construction" /></div>
        <div className="form-group"><label>Max Speed (km/h)</label><input type="number" value={form.maxspeed_km} onChange={(e) => setForm({ ...form, maxspeed_km: e.target.value })} placeholder="Override speed limit" /></div>
        <div className="form-group"><label>Max Weight (kg)</label><input type="number" value={form.maxweight_kg} onChange={(e) => setForm({ ...form, maxweight_kg: e.target.value })} placeholder="Weight restriction" /></div>
        <div className="form-group"><label>Is Usable</label>
          <select value={String(form.is_usable)} onChange={(e) => setForm({ ...form, is_usable: e.target.value === 'true' })}>
            <option value="true">Yes</option>
            <option value="false">No (closed)</option>
          </select>
        </div>
        <div className="form-group"><label>Start *</label><input type="datetime-local" lang="en-GB" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} /></div>
        <div className="form-group"><label>End</label><input type="datetime-local" lang="en-GB" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} placeholder="Leave blank for ongoing" /></div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Note</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
      </div>
    </Modal>
  );
}
