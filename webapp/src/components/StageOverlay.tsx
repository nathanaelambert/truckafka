import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore, type SelectedElement } from '../store';
import { ElementCard } from './ElementCard';

function getElementPosition(el: SelectedElement): { lat: number; lng: number } | null {
  const { trucks, trailers, drivers, loads, locations, positions } = useStore.getState();

  if (el.type === 'location') {
    const loc = locations.find((l) => l.id === el.id);
    const p = loc?.position as { lat: number; lng: number } | null | undefined;
    if (p && typeof p.lat === 'number') return p;
  } else if (el.type === 'truck') {
    const livePos = positions.get(el.id);
    if (livePos) return { lat: livePos.lat, lng: livePos.lng };
    const truck = trucks.find((t) => t.id === el.id);
    if (truck?.location_id) {
      const loc = locations.find((l) => l.id === truck.location_id);
      const p = loc?.position as { lat: number; lng: number } | null | undefined;
      if (p && typeof p.lat === 'number') return p;
    }
  } else if (el.type === 'driver') {
    const driver = drivers.find((d) => d.id === el.id);
    if (driver?.home_location_id) {
      const loc = locations.find((l) => l.id === driver.home_location_id);
      const p = loc?.position as { lat: number; lng: number } | null | undefined;
      if (p && typeof p.lat === 'number') return { lat: p.lat + 0.002, lng: p.lng + 0.002 };
    }
  } else if (el.type === 'trailer') {
    const trailer = trailers.find((t) => t.id === el.id);
    if (trailer?.location_id) {
      const loc = locations.find((l) => l.id === trailer.location_id);
      const p = loc?.position as { lat: number; lng: number } | null | undefined;
      if (p && typeof p.lat === 'number') return { lat: p.lat - 0.002, lng: p.lng + 0.002 };
    }
  } else if (el.type === 'load') {
    const load = loads.find((l) => l.id === el.id);
    if (load?.pickup_location_id) {
      const loc = locations.find((l) => l.id === load.pickup_location_id);
      const p = loc?.position as { lat: number; lng: number } | null | undefined;
      if (p && typeof p.lat === 'number') return p;
    }
  }
  return null;
}

function StageCardOverlay({ el }: { el: SelectedElement }) {
  const map = useMap();
  const pos = getElementPosition(el);
  const [screenPos, setScreenPos] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const { setDragItem } = useStore();

  useEffect(() => {
    if (!pos) return;
    const update = () => {
      const bounds = map.getBounds();
      const latLng = L.latLng(pos.lat, pos.lng);
      if (!bounds.contains(latLng)) {
        setVisible(false);
        return;
      }
      setVisible(true);
      const point = map.latLngToContainerPoint(latLng);
      setScreenPos({ x: point.x, y: point.y });
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
    };
  }, [map, pos?.lat, pos?.lng]);

  if (!pos || !visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: screenPos.x,
        top: screenPos.y,
        transform: 'translate(-50%, -110%)',
        zIndex: 1000,
        maxWidth: 250,
        pointerEvents: 'auto',
      }}
    >
      <ElementCard
        el={el}
        defaultExpanded={true}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/json', JSON.stringify(el));
          e.dataTransfer.effectAllowed = 'move';
          setDragItem(el);
        }}
        onDragEnd={() => setDragItem(null)}
      />
    </div>
  );
}

export function StageOverlay() {
  const { stagedItems } = useStore();
  return (
    <>
      {stagedItems.map((el) => (
        <StageCardOverlay key={`${el.type}-${el.id}`} el={el} />
      ))}
    </>
  );
}

export function MapClickHandler() {
  const map = useMap();

  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent.target as HTMLElement;
      // Don't handle if clicking inside an event tooltip
      if (target?.closest('[data-event-tooltip]')) return;
      // Don't handle if clicking on a marker (event pins, location markers)
      if (target?.closest('.leaflet-marker-icon')) return;
      
      const state = useStore.getState();
      // Clear selected event if clicking empty map
      if (state.selectedEventId) {
        state.setSelectedEventId(null);
        return;
      }
      if (state.activeTooltip) {
        state.toggleStaging(state.activeTooltip);
      }
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map]);

  return null;
}
