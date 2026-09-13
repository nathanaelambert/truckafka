import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Modal } from './Modal';

export interface LatLng {
  lat: number;
  lng: number;
}

interface LocationEditorProps {
  initialPosition?: { lat: number; lng: number };
  initialAddress?: string;
  initialGeofence?: LatLng[];
  locationName: string;
  onClose: (result: {
    position: { lat: number; lng: number };
    address: string;
    geofence: LatLng[];
  } | null) => void;
}

// ── Nominatim helpers ──────────────────────────────────────────

interface GeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`);
    const data = await resp.json();
    return data?.display_name || null;
  } catch { return null; }
}

async function searchAddresses(query: string): Promise<GeocodeResult[]> {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`);
    const data = await resp.json();
    if (Array.isArray(data)) {
      return data.map((r: { lat: string; lon: string; display_name: string }) => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        display_name: r.display_name,
      }));
    }
  } catch { /* ignore */ }
  return [];
}

// ── Polygon centroid ───────────────────────────────────────────

function centroid(points: LatLng[]): { lat: number; lng: number } {
  let lat = 0, lng = 0;
  for (const p of points) { lat += p.lat; lng += p.lng; }
  return { lat: lat / points.length, lng: lng / points.length };
}

// ── Vertex icons ───────────────────────────────────────────────

function vertexIcon(isFirst: boolean, canClose: boolean): L.DivIcon {
  const size = isFirst ? 16 : 12;
  const color = isFirst ? '#4ade80' : '#4a9eff';
  const cursor = isFirst && canClose ? 'pointer' : 'grab';
  return L.divIcon({
    className: 'geofence-vertex',
    html: `<div style="width: ${size}px; height: ${size}px; border-radius: 50%; background: ${color}; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.5); cursor: ${cursor};"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const searchPinIcon = L.divIcon({
  className: 'search-pin',
  html: `<svg width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));">
    <path d="M12 2 C8.13 2 5 5.13 5 9 C5 13.5 12 22 12 22 C12 22 19 13.5 19 9 C19 5.13 15.87 2 12 2 Z M12 11.5 A2.5 2.5 0 1 1 12 6.5 A2.5 2.5 0 0 1 12 11.5 Z" fill="#f97316" stroke="#fff" stroke-width="1.5"/>
  </svg>`,
  iconSize: [32, 32],
  iconAnchor: [16, 28],
});

const centroidPinIcon = L.divIcon({
  className: 'centroid-pin',
  html: `<svg width="28" height="28" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));">
    <path d="M12 2 C8.13 2 5 5.13 5 9 C5 13.5 12 22 12 22 C12 22 19 13.5 19 9 C19 5.13 15.87 2 12 2 Z M12 11.5 A2.5 2.5 0 1 1 12 6.5 A2.5 2.5 0 0 1 12 11.5 Z" fill="#fbbf24" stroke="#fff" stroke-width="1.5"/>
  </svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});

// ── Map helpers ────────────────────────────────────────────────

function ClickHandler({ onPick, disabled }: { onPick: (lat: number, lng: number) => void; disabled: boolean }) {
  useMapEvents({
    click(e) { if (!disabled) onPick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

function PanTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.panTo(target, { animate: true }); }, [target, map]);
  return null;
}

function FitBounds({ boundary }: { boundary: LatLng[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    if (boundary.length > 0) {
      const bounds = L.latLngBounds(boundary.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, boundary]);
  return null;
}

// ── Main component ─────────────────────────────────────────────

export function LocationEditor({ initialPosition, initialAddress, initialGeofence, locationName, onClose }: LocationEditorProps) {
  const hasInitialPos = initialPosition !== undefined;
  const mapCenter: [number, number] = hasInitialPos ? [initialPosition!.lat, initialPosition!.lng] : [43.6532, -79.3832];

  const [vertices, setVertices] = useState<LatLng[]>(initialGeofence || []);
  const [closed, setClosed] = useState(initialGeofence && initialGeofence.length >= 3 ? true : false);
  const [address, setAddress] = useState<string>(initialAddress || '');

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchPin, setSearchPin] = useState<{ lat: number; lng: number } | null>(null);

  const [panTarget, setPanTarget] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState<LatLng[][]>([]);
  const [hoverVertex, setHoverVertex] = useState<number | null>(null);
  const [satellite, setSatellite] = useState(true);
  const [dragPreview, setDragPreview] = useState<{ index: number; lat: number; lng: number } | null>(null);
  const draggingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLDivElement | null>(null);

  const canClose = vertices.length >= 3 && !closed;

  // Auto-geocode address on open if we have address but no position
  useEffect(() => {
    if (initialAddress && !hasInitialPos) {
      (async () => {
        setSearching(true);
        const results = await searchAddresses(initialAddress);
        setSearching(false);
        if (results.length > 0) {
          setAddress(results[0].display_name);
          setSearchPin({ lat: results[0].lat, lng: results[0].lng });
          setPanTarget([results[0].lat, results[0].lng]);
        }
      })();
    }
  }, []);

  // ── Debounced live suggestions ──────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchInput.trim() || searchInput.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const results = await searchAddresses(searchInput.trim());
      setSearching(false);
      setSuggestions(results);
      setShowSuggestions(true);
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Select a suggestion ─────────────────────────────────────

  const selectSuggestion = (result: GeocodeResult) => {
    setAddress(result.display_name);
    setSearchPin({ lat: result.lat, lng: result.lng });
    setPanTarget([result.lat, result.lng]);
    setShowSuggestions(false);
    setSearchInput(result.display_name);
  };

  // ── Map click: add vertex or close polygon ──────────────────

  const handleMapClick = (lat: number, lng: number) => {
    if (closed || draggingRef.current) return;

    if (vertices.length >= 3) {
      const first = vertices[0];
      const dist = Math.sqrt((first.lat - lat) ** 2 + (first.lng - lng) ** 2);
      if (dist < 0.0003) {
        pushHistory();
        setClosed(true);
        return;
      }
    }

    pushHistory();
    setVertices([...vertices, { lat, lng }]);
  };

  // ── Undo / Clear ────────────────────────────────────────────

  const pushHistory = () => setHistory((h) => [...h, [...vertices]]);
  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setVertices(prev);
    setHistory((h) => h.slice(0, -1));
    if (prev.length < 3) setClosed(false);
  };

  // ── Vertex drag ─────────────────────────────────────────────

  const handleDragEnd = (index: number, lat: number, lng: number) => {
    pushHistory();
    setVertices((prev) => {
      const updated = [...prev];
      updated[index] = { lat, lng };
      return updated;
    });
    setDragPreview(null);
    draggingRef.current = false;
  };

  // ── Vertex click: close or remove ───────────────────────────

  const handleVertexClick = (index: number) => {
    if (draggingRef.current) return;
    if (index === 0 && vertices.length >= 3 && !closed) {
      pushHistory();
      setClosed(true);
      return;
    }
    if (index === vertices.length - 1 && !closed && vertices.length > 0) {
      pushHistory();
      setVertices(vertices.slice(0, -1));
    }
  };

  // ── Compute final values ────────────────────────────────────

  const displayVertices = dragPreview
    ? vertices.map((v, i) => i === dragPreview.index ? { lat: dragPreview.lat, lng: dragPreview.lng } : v)
    : vertices;

  const isValid = closed && vertices.length >= 3;
  const finalPosition = isValid ? centroid(vertices) : (initialPosition || null);

  const handleSubmit = async () => {
    if (!isValid || !finalPosition) {
      alert('Please draw and close a geofence polygon with at least 3 vertices');
      return;
    }

    let finalAddress = address;
    if (!finalAddress) {
      const geocoded = await reverseGeocode(finalPosition.lat, finalPosition.lng);
      if (geocoded) finalAddress = geocoded;
    }

    onClose({
      position: finalPosition,
      address: finalAddress || '',
      geofence: vertices,
    });
  };

  const vertexPositions = displayVertices.map((v) => [v.lat, v.lng] as [number, number]);

  return (
    <Modal title={`Edit Location — ${locationName}`} onClose={() => onClose(null)} onSubmit={handleSubmit} submitLabel="Save Location" width={800}>
      {/* Search bar with live suggestions */}
      <div ref={searchInputRef} style={{ position: 'relative', marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Type an address to search and zoom (e.g. 100 Bay St, Toronto, ON)"
            style={{ flex: 1, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, fontSize: 13 }}
          />
          {searching && <span style={{ fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center' }}>...</span>}
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10001,
            background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '0 0 4px 4px',
            maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}>
            {!searching && suggestions.length === 0 && searchInput.trim().length >= 3 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-dim)' }}>No address found</div>
            )}
            {suggestions.map((s, i) => (
              <div
                key={i}
                onClick={() => selectSuggestion(s)}
                style={{
                  padding: '8px 12px', fontSize: 12, color: 'var(--text)', cursor: 'pointer',
                  borderBottom: i < suggestions.length - 1 ? '1px solid var(--bg-elevated)' : 'none',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
              >
                📍 {s.display_name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button className="btn btn-sm" onClick={undo} disabled={history.length === 0} style={{ opacity: history.length === 0 ? 0.3 : 1 }}>↩ Undo</button>
        <button className="btn btn-sm btn-danger" onClick={() => { pushHistory(); setVertices([]); setClosed(false); }}>Clear</button>
        {searchPin && !isValid && (
          <button className="btn btn-sm" onClick={() => { setPanTarget([searchPin.lat, searchPin.lng]); }}>Recenter on search</button>
        )}
        <span style={{ flex: 1 }} />
        {isValid && <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ Valid</span>}
        {!isValid && <span style={{ fontSize: 12, color: 'var(--warning)' }}>Draw a closed polygon</span>}
      </div>

      {/* Map */}
      <div style={{ height: 500, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
        <MapContainer center={mapCenter} zoom={16} style={{ height: '100%', width: '100%', cursor: 'crosshair' }} className="leaflet-container geofence-map">
          <ClickHandler onPick={handleMapClick} disabled={closed} />
          <PanTo target={panTarget} />
          <FitBounds boundary={vertices} />

          {satellite ? (
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="&copy; Esri" maxZoom={20} />
          ) : (
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" maxZoom={20} />
          )}
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={20} />

          {/* Closed polygon */}
          {closed && vertices.length >= 3 && (
            <Polygon positions={vertexPositions} pathOptions={{ color: '#4ade80', weight: 2, opacity: 0.8, fillColor: '#4ade80', fillOpacity: 0.15 }} />
          )}

          {/* Open polyline */}
          {!closed && vertices.length >= 2 && (
            <Polyline positions={vertexPositions} pathOptions={{ color: '#4a9eff', weight: 2, opacity: 0.8, dashArray: '8, 6' }} />
          )}

          {/* Search result pin (temporary, to help draw) */}
          {searchPin && !isValid && (
            <Marker position={[searchPin.lat, searchPin.lng]} icon={searchPinIcon} />
          )}

          {/* Centroid pin (shows final position once valid) */}
          {finalPosition && isValid && (
            <Marker position={[finalPosition.lat, finalPosition.lng]} icon={centroidPinIcon} />
          )}

          {/* Vertex markers */}
          {vertices.map((v, i) => (
            <Marker
              key={`vtx-${i}`}
              position={[v.lat, v.lng]}
              icon={vertexIcon(i === 0, canClose)}
              draggable
              eventHandlers={{
                drag: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  setDragPreview({ index: i, lat: ll.lat, lng: ll.lng });
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  handleDragEnd(i, ll.lat, ll.lng);
                },
                dragstart: () => { draggingRef.current = true; },
                click: () => handleVertexClick(i),
                mouseover: () => setHoverVertex(i),
                mouseout: () => setHoverVertex(null),
              }}
            />
          ))}
        </MapContainer>

        {/* Layer toggle */}
        <button
          onClick={() => setSatellite(!satellite)}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 1000, padding: '4px 10px', background: 'rgba(15,17,23,0.9)', border: '1px solid var(--border)', borderRadius: 4, color: satellite ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}
        >
          {satellite ? 'Satellite' : 'Map'}
        </button>

        {/* Instructions */}
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1000, padding: '6px 10px', background: 'rgba(15,17,23,0.9)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11, maxWidth: 400 }}>
          {!closed ? (
            <><strong style={{ color: 'var(--text)' }}>Click to add vertices</strong> · Search to zoom · Drag to adjust · Click first vertex <span style={{ color: '#4ade80' }}>●</span> to close · Click last vertex to remove</>
          ) : (
            <><strong style={{ color: 'var(--success)' }}>Polygon closed</strong> · Drag vertices to adjust · Undo to go back</>
          )}
        </div>

        {/* Vertex count */}
        <div style={{ position: 'absolute', top: 8, right: 60, zIndex: 1000, padding: '4px 10px', background: 'rgba(15,17,23,0.9)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11 }}>
          {vertices.length} vertices
        </div>
      </div>

      {/* Status + address preview */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        {isValid ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ Location valid</span>
            {finalPosition && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Center: {finalPosition.lat.toFixed(5)}, {finalPosition.lng.toFixed(5)}</span>}
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--warning)' }}>⚠ Draw a closed polygon to set the location</span>
        )}
      </div>
      {address && (
        <div style={{ marginTop: 4, padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 4, fontSize: 12, color: 'var(--text-dim)' }}>
          📍 {address}
        </div>
      )}

      {/* Hover info — fixed height to prevent layout shift */}
      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)', height: '1.4em', lineHeight: '1.4em', overflow: 'hidden' }}>
        {hoverVertex !== null ? (
          <>
            Vertex {hoverVertex + 1}: {vertices[hoverVertex]?.lat.toFixed(5)}, {vertices[hoverVertex]?.lng.toFixed(5)}
            {hoverVertex === vertices.length - 1 && !closed && ' — click to remove'}
            {hoverVertex === 0 && vertices.length >= 3 && !closed && ' — click to close polygon'}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
