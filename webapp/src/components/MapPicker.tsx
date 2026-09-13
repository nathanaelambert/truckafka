import { useState, useRef, useEffect, useCallback } from 'react';import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Modal } from './Modal';

interface MapPickerProps {
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
  onClose: (result: { lat: number; lng: number; address?: string } | null) => void;
}

// Custom draggable pin icon
const pinIcon = L.divIcon({
  className: 'map-picker-pin',
  html: `<svg width="32" height="32" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));">
    <path d="M12 2 C8.13 2 5 5.13 5 9 C5 13.5 12 22 12 22 C12 22 19 13.5 19 9 C19 5.13 15.87 2 12 2 Z M12 11.5 A2.5 2.5 0 1 1 12 6.5 A2.5 2.5 0 0 1 12 11.5 Z" fill="#4a9eff" stroke="#fff" stroke-width="1.5"/>
  </svg>`,
  iconSize: [32, 32],
  iconAnchor: [16, 28],
});

// Component that handles map clicks
function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Component to recenter map
function Recenter({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.panTo(center, { animate: true });
  }, [center, map]);
  return null;
}

// Nominatim reverse geocoding
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`);
    const data = await resp.json();
    return data?.display_name || null;
  } catch {
    return null;
  }
}

// Nominatim forward geocoding
async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; display_name: string } | null> {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`);
    const data = await resp.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display_name: data[0].display_name };
    }
  } catch {
    // ignore
  }
  return null;
}

export function MapPicker({ initialLat, initialLng, initialAddress, onClose }: MapPickerProps) {
  const hasInitial = initialLat !== undefined && initialLng !== undefined;
  const center: [number, number] = hasInitial ? [initialLat!, initialLng!] : [43.6532, -79.3832];
  const zoom = hasInitial ? 14 : 8;

  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(hasInitial ? { lat: initialLat!, lng: initialLng! } : null);
  const [address, setAddress] = useState<string | null>(initialAddress || null);
  const [addressInput, setAddressInput] = useState('');
  const [latInput, setLatInput] = useState(hasInitial ? initialLat!.toString() : '');
  const [lngInput, setLngInput] = useState(hasInitial ? initialLng!.toString() : '');
  const [searching, setSearching] = useState(false);
  const [recenterTarget, setRecenterTarget] = useState<[number, number] | null>(null);
  const [satellite, setSatellite] = useState(false);

  // Auto-geocode address on open if we have one but no coordinates
  useEffect(() => {
    if (initialAddress && !hasInitial) {
      (async () => {
        setSearching(true);
        const result = await forwardGeocode(initialAddress);
        setSearching(false);
        if (result) {
          setPicked({ lat: result.lat, lng: result.lng });
          setLatInput(result.lat.toFixed(6));
          setLngInput(result.lng.toFixed(6));
          setAddress(result.display_name);
          setRecenterTarget([result.lat, result.lng]);
        }
      })();
    }
  }, []);

  const pickPoint = useCallback(async (lat: number, lng: number) => {
    setPicked({ lat, lng });
    setLatInput(lat.toFixed(6));
    setLngInput(lng.toFixed(6));
    setRecenterTarget([lat, lng]);
    setAddress(null);
    const result = await reverseGeocode(lat, lng);
    if (result) setAddress(result);
  }, []);

  const handleSearch = async () => {
    if (!addressInput.trim()) return;
    setSearching(true);
    const result = await forwardGeocode(addressInput.trim());
    setSearching(false);
    if (result) {
      setPicked({ lat: result.lat, lng: result.lng });
      setLatInput(result.lat.toFixed(6));
      setLngInput(result.lng.toFixed(6));
      setAddress(result.display_name);
      setRecenterTarget([result.lat, result.lng]);
    } else {
      alert('Address not found');
    }
  };

  const handleManualCoords = () => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (isNaN(lat) || isNaN(lng)) {
      alert('Invalid coordinates');
      return;
    }
    setPicked({ lat, lng });
    setRecenterTarget([lat, lng]);
  };

  const handleConfirm = () => {
    if (!picked) {
      alert('Please place a pin on the map first');
      return;
    }
    onClose({ lat: picked.lat, lng: picked.lng, address: address || undefined });
  };

  return (
    <Modal title="Pick Location on Map" onClose={() => onClose(null)} onSubmit={handleConfirm} submitLabel="Confirm" width={750}>
      {/* Address search bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search address (e.g. 100 Bay St, Toronto, ON)"
          style={{ flex: 1, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, fontSize: 13 }}
        />
        <button className="btn btn-sm btn-primary" onClick={handleSearch} disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Map */}
      <div style={{ height: 400, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} className="leaflet-container">
          <ClickHandler onPick={pickPoint} />
          <Recenter center={recenterTarget} />
          {satellite ? (
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="&copy; Esri" maxZoom={19} />
          ) : (
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" maxZoom={19} />
          )}
          {picked && (
            <Marker
              position={[picked.lat, picked.lng]}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const ll = m.getLatLng();
                  pickPoint(ll.lat, ll.lng);
                },
              }}
            />
          )}
        </MapContainer>
        {/* Satellite toggle */}
        <button
          onClick={() => setSatellite(!satellite)}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 1000, padding: '4px 10px', background: 'rgba(15,17,23,0.9)', border: '1px solid var(--border)', borderRadius: 4, color: satellite ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}
        >
          {satellite ? 'Satellite' : 'Map'}
        </button>
        {/* Instructions */}
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1000, padding: '4px 10px', background: 'rgba(15,17,23,0.85)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 11 }}>
          Click map to place pin · Drag pin to adjust
        </div>
      </div>

      {/* Manual coordinate input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0, flex: 1 }}>
          <label>Latitude</label>
          <input type="number" step="0.000001" value={latInput} onChange={(e) => setLatInput(e.target.value)} placeholder="43.653200" />
        </div>
        <div className="form-group" style={{ margin: 0, flex: 1 }}>
          <label>Longitude</label>
          <input type="number" step="0.000001" value={lngInput} onChange={(e) => setLngInput(e.target.value)} placeholder="-79.383200" />
        </div>
        <button className="btn btn-sm" onClick={handleManualCoords}>Set</button>
      </div>

      {/* Resolved address */}
      {address && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 4, fontSize: 12, color: 'var(--text-dim)' }}>
          📍 {address}
        </div>
      )}
    </Modal>
  );
}
