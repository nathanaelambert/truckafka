import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Modal } from './Modal';

export interface LatLng {
  lat: number;
  lng: number;
}

interface GeofenceEditorProps {
  center: { lat: number; lng: number };
  initialBoundary?: LatLng[];
  onClose: (boundary: LatLng[] | null) => void;
}

// ── Vertex marker icon ──────────────────────────────────────────

function vertexIcon(isFirst: boolean, canClose: boolean, color: string): L.DivIcon {
  const size = isFirst ? 16 : 12;
  const cursor = isFirst && canClose ? 'pointer' : 'grab';
  // First vertex gets a larger invisible hit area when it can close
  const hitSize = (isFirst && canClose) ? 36 : size;
  const hitDiv = (isFirst && canClose)
    ? `<div style="position:relative;width:${hitSize}px;height:${hitSize}px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
         <div style="position:absolute;width:${hitSize}px;height:${hitSize}px;border-radius:50%;background:transparent;border:none;"></div>
         <div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 6px ${color},0 1px 3px rgba(0,0,0,0.5);"></div>
       </div>`
    : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.5);cursor:${cursor};"></div>`;
  return L.divIcon({
    className: 'geofence-vertex',
    html: hitDiv,
    iconSize: [hitSize, hitSize],
    iconAnchor: [hitSize / 2, hitSize / 2],
  });
}

// ── Map click handler with zoom/move reset ──────────────────────

function MapEventHandler({
  onMapClick,
  isDragging,
  onInteractionStart,
}: {
  onMapClick: (lat: number, lng: number) => void;
  isDragging: React.MutableRefObject<boolean>;
  onInteractionStart: () => void;
}) {
  const map = useMapEvents({
    click(e) {
      if (isDragging.current) return;
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    zoomstart() {
      isDragging.current = false;
      onInteractionStart();
    },
    movestart() {
      isDragging.current = false;
    },
  });
  return null;
}

function getCloseThreshold(zoom: number): number {
  return 0.0003 * Math.pow(2, 16 - zoom);
}

function MapRefSetter({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map, onMap]);
  return null;
}

// ── Component to fit bounds when needed ─────────────────────────

function FitBounds({ center, boundary }: { center: LatLng; boundary: LatLng[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    if (boundary.length > 0) {
      const bounds = L.latLngBounds(boundary.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView([center.lat, center.lng], 16, { animate: true });
    }
  }, [map, center, boundary]);

  return null;
}

// ── Compute polygon area (m²) via Shoelace ──────────────────────

function polygonArea(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const lat1 = (points[i].lat * Math.PI) / 180;
    const lat2 = (points[j].lat * Math.PI) / 180;
    const dLng = ((points[j].lng - points[i].lng) * Math.PI) / 180;
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = (area * R * R) / 2;
  return Math.abs(area);
}

function formatArea(m2: number): string {
  if (m2 < 10000) return `${m2.toFixed(0)} m²`;
  return `${(m2 / 10000).toFixed(2)} ha`;
}

// ── Main component ──────────────────────────────────────────────

export function GeofenceEditor({ center, initialBoundary, onClose }: GeofenceEditorProps) {
  const [vertices, setVertices] = useState<LatLng[]>(initialBoundary || []);
  const [closed, setClosed] = useState(initialBoundary && initialBoundary.length >= 3 ? true : false);
  const [history, setHistory] = useState<LatLng[][]>([]);
  const [hoverVertex, setHoverVertex] = useState<number | null>(null);
  const [mapCursor, setMapCursor] = useState<string>('crosshair');
  const [forceRender, setForceRender] = useState(0);
  const mapRef = useRef<L.Map | null>(null);

  // Use a ref for dragging state — avoids async state update issues
  // that cause the "stuck after zoom" bug
  const draggingRef = useRef(false);

  const canClose = vertices.length >= 3 && !closed;

  // ── Undo ──────────────────────────────────────────────────────

  const pushHistory = (prev: LatLng[]) => {
    setHistory((h) => [...h, [...prev]]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setVertices(prev);
    setHistory((h) => h.slice(0, -1));
    if (prev.length < 3) setClosed(false);
  };

  // ── Click handler ─────────────────────────────────────────────

  const handleMapClick = (lat: number, lng: number) => {
    if (closed) return;
    if (draggingRef.current) return;

    // Check if clicking near first vertex to close
    if (vertices.length >= 3) {
      const first = vertices[0];
      const dist = Math.sqrt((first.lat - lat) ** 2 + (first.lng - lng) ** 2);
      const zoom = mapRef.current?.getZoom() ?? 16;
      const closeThreshold = getCloseThreshold(zoom);
      if (dist < closeThreshold) {
        pushHistory(vertices);
        setClosed(true);
        return;
      }
    }

    pushHistory(vertices);
    setVertices([...vertices, { lat, lng }]);
  };

  // ── Vertex drag ────────────────────────────────────────────────
  // During drag we only update a preview state (for the polygon visual)
  // but NOT the vertices state — this avoids re-rendering the Marker's
  // position prop, which fights Leaflet's internal drag handler.

  const [dragPreview, setDragPreview] = useState<{ index: number; lat: number; lng: number } | null>(null);

  const handleVertexDragEnd = (index: number, lat: number, lng: number) => {
    pushHistory(vertices);
    setVertices((prev) => {
      const updated = [...prev];
      updated[index] = { lat, lng };
      return updated;
    });
    setDragPreview(null);
    draggingRef.current = false;
    setMapCursor('crosshair');
    setForceRender((n) => n + 1);
  };

  // ── Click on vertex ───────────────────────────────────────────

  const handleVertexClick = (index: number) => {
    if (draggingRef.current) return;

    // Click first vertex to close (when 3+ vertices and open)
    if (index === 0 && vertices.length >= 3 && !closed) {
      pushHistory(vertices);
      setClosed(true);
      return;
    }

    // Click last vertex to remove it (when open)
    if (index === vertices.length - 1 && !closed && vertices.length > 0) {
      pushHistory(vertices);
      setVertices(vertices.slice(0, -1));
    }
  };

  // ── Submit ─────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (vertices.length < 3 || !closed) {
      alert('Polygon must be closed with at least 3 vertices');
      return;
    }
    onClose(vertices);
  };

  const area = closed ? polygonArea(vertices) : 0;

  // Compute display positions — substitute the dragged vertex with live preview
  const displayVertices = dragPreview
    ? vertices.map((v, i) => i === dragPreview.index ? { lat: dragPreview.lat, lng: dragPreview.lng } : v)
    : vertices;
  const vertexPositions = displayVertices.map((v) => [v.lat, v.lng] as [number, number]);

  // Cursor logic for map container
  const containerCursor = closed ? 'default' : mapCursor;

  return (
    <Modal title="Draw Geofence" onClose={() => onClose(null)} onSubmit={handleSubmit} submitLabel="OK" width={800}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={undo} disabled={history.length === 0} style={{ opacity: history.length === 0 ? 0.3 : 1 }}>↩ Undo</button>
        <button className="btn btn-sm btn-danger" onClick={() => { pushHistory(vertices); setVertices([]); setClosed(false); }}>Clear</button>
        <span style={{ flex: 1 }} />
        {closed && <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ Closed</span>}
        {area > 0 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Area: {formatArea(area)}</span>}
      </div>

      <div style={{ height: 450, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={16}
          style={{ height: '100%', width: '100%', cursor: containerCursor }}
          className="leaflet-container geofence-map"
        >
          <MapEventHandler
            onMapClick={handleMapClick}
            isDragging={draggingRef}
            onInteractionStart={() => { draggingRef.current = false; setMapCursor('crosshair'); setForceRender((n) => n + 1); }}
          />
          <MapRefSetter onMap={(m) => { mapRef.current = m; }} />
          <FitBounds center={center} boundary={vertices} />

          {/* Satellite layer */}
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="&copy; Esri" maxZoom={20} />
          {/* Labels overlay on top of satellite */}
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={20} />

          {/* When closed: filled polygon */}
          {closed && vertices.length >= 3 && (
            <Polygon
              positions={vertexPositions}
              pathOptions={{
                color: '#4ade80',
                weight: 2,
                opacity: 0.8,
                fillColor: '#4ade80',
                fillOpacity: 0.15,
              }}
            />
          )}

          {/* When open: polyline (not filled, not auto-closed) */}
          {!closed && vertices.length >= 2 && (
            <Polyline
              positions={vertexPositions}
              pathOptions={{
                color: '#4a9eff',
                weight: 2,
                opacity: 0.8,
                dashArray: '8, 6',
              }}
            />
          )}

          {/* Center marker */}
          <Marker position={[center.lat, center.lng]} icon={L.divIcon({
            className: 'geofence-center',
            html: `<div style="width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          })} />

          {/* Vertex markers */}
          {vertices.map((v, i) => (
            <Marker
              key={`vtx-${i}`}
              position={[v.lat, v.lng]}
              icon={vertexIcon(i === 0, canClose, i === 0 ? '#4ade80' : '#4a9eff')}
              draggable
              eventHandlers={{
                drag: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  setDragPreview({ index: i, lat: ll.lat, lng: ll.lng });
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  handleVertexDragEnd(i, ll.lat, ll.lng);
                },
                dragstart: () => {
                  draggingRef.current = true;
                  setMapCursor('grabbing');
                },
                click: () => handleVertexClick(i),
                mouseover: () => setHoverVertex(i),
                mouseout: () => setHoverVertex(null),
              }}
            />
          ))}
        </MapContainer>

        {/* Instructions */}
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1000, padding: '6px 10px', background: 'rgba(15,17,23,0.9)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11, maxWidth: 380 }}>
          {!closed ? (
            <>
              <strong style={{ color: 'var(--text)' }}>Click to add vertex</strong> · Drag vertex to move · Click last vertex to remove · Click first vertex <span style={{ color: '#4ade80' }}>●</span> to close
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--success)' }}>Polygon closed</strong> · Drag vertices to adjust · Undo to go back
            </>
          )}
        </div>

        {/* Vertex count */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1000, padding: '4px 10px', background: 'rgba(15,17,23,0.9)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11 }}>
          {vertices.length} vertices
        </div>
      </div>

      {/* Hover info for vertex — fixed height to prevent layout shift */}
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
