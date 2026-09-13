import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore, type SelectedElement } from '../store';
import { elementHeaderHTML, wireTooltipActions, elementLabel } from './ElementHeader';

interface TooltipMarker {
  lat: number;
  lng: number;
}

export function MapTooltip({ el, markerPos }: { el: SelectedElement; markerPos: TooltipMarker }) {
  const map = useMap();
  const { activeTooltip, setActiveTooltip } = useStore();
  const [screenPos, setScreenPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);

  const { isItemHidden } = useStore();
  const hidden = isItemHidden(el.type, el.id);

  useEffect(() => {
    const update = () => {
      const point = map.latLngToContainerPoint([markerPos.lat, markerPos.lng] as L.LatLngExpression);
      setScreenPos({ x: point.x, y: point.y });
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
    };
  }, [map, markerPos.lat, markerPos.lng]);

  if (!activeTooltip || activeTooltip.type !== el.type || activeTooltip.id !== el.id) return null;

  const label = elementLabel(el);
  const headerHTML = elementHeaderHTML(el);

  return (
    <div
      key={tick}
      ref={(r) => {
        if (r) {
          wireTooltipActions(r, el, () => setTick(t => t + 1));
        }
      }}
      style={{
        position: 'absolute',
        left: screenPos.x,
        top: screenPos.y - 12,
        transform: 'translate(-50%, -100%)',
        zIndex: 1200,
        background: '#fff',
        border: '1px solid #fff',
        borderRadius: 3,
        padding: '6px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: headerHTML }} />
      <div
        style={{
          position: 'absolute',
          bottom: -6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid #fff',
        }}
      />
    </div>
  );
}

export function MapClickHandler() {
  const map = useMap();
  const { setActiveTooltip } = useStore();

  useEffect(() => {
    const handler = () => {
      setActiveTooltip(null);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, setActiveTooltip]);

  return null;
}
