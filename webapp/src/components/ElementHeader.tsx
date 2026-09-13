import { useState, useEffect } from 'react';
import { useStore, type SelectedElement } from '../store';

// ── Actor status helpers ───────────────────────────────────

const MOTION_TYPES = new Set(['bobtail', 'haul', 'deadmile']);

const ACTIVE_VERBS: Record<string, string> = {
  bobtail: 'bobtailing', haul: 'hauling', deadmile: 'deadmiling',
  loading: 'loading', unloading: 'unloading',
  attach: 'attaching', detach: 'detaching',
};

interface StoreData {
  trucks: Record<string, unknown>[];
  trailers: Record<string, unknown>[];
  drivers: Record<string, unknown>[];
  loads: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  viewTime: Date;
}

export interface ActorStatusResult {
  text: string;
  eventId: string | null;
  eventStartTime: string | null;
  isCurrent: boolean;
}

function resolveLocName(locId: string | null, locName: string | null, locations: Record<string, unknown>[]): string {
  if (locName) return locName;
  if (locId) {
    const loc = locations.find(l => l.id === locId);
    if (loc?.name) return loc.name as string;
  }
  return 'unknown';
}

function getEventLocName(ev: any, locations: Record<string, unknown>[]): string {
  const isMotion = MOTION_TYPES.has(ev.type);
  return resolveLocName(
    isMotion ? ev.end_location_id : ev.start_location_id,
    isMotion ? ev.end_location_name : ev.start_location_name,
    locations
  );
}

function homeHubName(actorType: string, actorId: string, storeData: StoreData): string {
  let locId: string | null = null;
  if (actorType === 'truck') {
    const truck = storeData.trucks.find((t: any) => t.id === actorId);
    locId = (truck?.location_id as string) || null;
  } else if (actorType === 'trailer') {
    const trailer = storeData.trailers.find((t: any) => t.id === actorId);
    locId = (trailer?.location_id as string) || null;
  } else if (actorType === 'driver') {
    const driver = storeData.drivers.find((d: any) => d.id === actorId);
    locId = (driver?.home_location_id as string) || null;
  }
  return resolveLocName(locId, null, storeData.locations);
}

export function getActorStatus(
  actorType: string,
  actorId: string,
  actorEvents: Record<string, any[]>,
  storeData: StoreData
): ActorStatusResult | null {
  const key = `${actorType}-${actorId}`;
  const evs = actorEvents[key] || [];
  const now = storeData.viewTime.getTime();
  const sorted = [...evs].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const current = sorted.find(e => new Date(e.start_time).getTime() <= now && new Date(e.end_time).getTime() >= now);

  // Active current event (not idle)
  if (current && current.type !== 'idle') {
    const isMotion = MOTION_TYPES.has(current.type);
    const locName = getEventLocName(current, storeData.locations);
    const verb = ACTIVE_VERBS[current.type] || current.type;
    const prep = isMotion ? 'to' : 'in';
    return { text: `is ${verb} ${prep} ${locName}`, eventId: current.id, eventStartTime: current.start_time, isCurrent: true };
  }

  // Idle/past: determine location from current idle event or last past event
  const past = sorted.filter(e => new Date(e.end_time).getTime() < now);
  const lastEvent = past.length > 0 ? past[past.length - 1] : null;
  const locName = current
    ? getEventLocName(current, storeData.locations)
    : (lastEvent ? getEventLocName(lastEvent, storeData.locations) : homeHubName(actorType, actorId, storeData));

  // Truck: attached/detached based on last attach/detach event
  if (actorType === 'truck') {
    const attachEvents = sorted.filter(e => e.type === 'attach' || e.type === 'detach');
    const lastAttach = attachEvents.length > 0 ? attachEvents[attachEvents.length - 1] : null;
    const attached = lastAttach?.type === 'attach';
    return { text: `is ${attached ? 'attached' : 'detached'} in ${locName}`, eventId: lastEvent?.id || null, eventStartTime: lastEvent?.start_time || null, isCurrent: false };
  }

  // Driver: on-duty/off-duty based on day_start_hour + 15h
  if (actorType === 'driver') {
    const driver = storeData.drivers.find((d: any) => d.id === actorId);
    const dayStart = (driver?.day_start_hour as string) || '06:00';
    const [h, m] = dayStart.split(':').map(Number);
    const startMinutes = h * 60 + m;
    // Use playback time instead of real time
    const viewDate = new Date(now);
    const nowMinutes = viewDate.getHours() * 60 + viewDate.getMinutes();
    const onDutyMinutes = 15 * 60;
    let isOnDuty = false;
    if (nowMinutes >= startMinutes) {
      isOnDuty = (nowMinutes - startMinutes) < onDutyMinutes;
    } else {
      isOnDuty = (nowMinutes + 24 * 60 - startMinutes) < onDutyMinutes;
    }
    return { text: `is ${isOnDuty ? 'on-duty' : 'off-duty'} in ${locName}`, eventId: lastEvent?.id || null, eventStartTime: lastEvent?.start_time || null, isCurrent: false };
  }

  // Trailer: full/empty based on last loading/unloading event
  if (actorType === 'trailer') {
    const loadUnloadEvents = sorted.filter(e => e.type === 'loading' || e.type === 'unloading');
    const lastLoadUnload = loadUnloadEvents.length > 0 ? loadUnloadEvents[loadUnloadEvents.length - 1] : null;
    const full = lastLoadUnload?.type === 'loading';
    return { text: `is ${full ? 'full' : 'empty'} in ${locName}`, eventId: lastEvent?.id || null, eventStartTime: lastEvent?.start_time || null, isCurrent: false };
  }

  // Load: dropped / ready / not ready / idle
  if (actorType === 'load') {
    const load = storeData.loads.find((l: any) => l.id === actorId);
    if (!load) return null;

    const pickupLocId = load.pickup_location_id as string;
    const dropoffLocId = load.dropoff_location_id as string;
    const pickupLocName = resolveLocName(pickupLocId, null, storeData.locations);
    const dropoffLocName = resolveLocName(dropoffLocId, null, storeData.locations);

    // Dropped: unloading at dropoff completed
    const dropEvents = sorted.filter(e =>
      e.type === 'unloading' && e.end_location_id === dropoffLocId && new Date(e.end_time).getTime() < now
    );
    if (dropEvents.length > 0) {
      const dropEv = dropEvents[dropEvents.length - 1];
      return { text: `is dropped in ${dropoffLocName}`, eventId: dropEv.id, eventStartTime: dropEv.start_time, isCurrent: false };
    }

    // Current idle
    if (current && current.type === 'idle') {
      return { text: `is idle in ${locName}`, eventId: current.id, eventStartTime: current.start_time, isCurrent: false };
    }

    // Not picked up yet → ready / not ready based on pickup window
    const hasBeenPickedUp = sorted.some(e =>
      e.type === 'loading' && new Date(e.end_time).getTime() < now
    );

    if (!hasBeenPickedUp) {
      const viewMs = storeData.viewTime.getTime();
      const pickupAfter = new Date(load.pickup_after as string).getTime();
      const pickupBefore = new Date(load.pickup_before as string).getTime();
      if (viewMs >= pickupAfter && viewMs <= pickupBefore) {
        return { text: `is ready in ${pickupLocName}`, eventId: null, eventStartTime: null, isCurrent: false };
      } else {
        return { text: `is not ready in ${pickupLocName}`, eventId: null, eventStartTime: null, isCurrent: false };
      }
    }

    // Picked up but not dropped → idle
    return { text: `is idle in ${locName}`, eventId: lastEvent?.id || null, eventStartTime: lastEvent?.start_time || null, isCurrent: false };
  }

  return null;
}

// ── SVG Icons ──────────────────────────────────────────────

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const CategoryIcons: Record<string, React.ReactNode> = {
  truck: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" />
      <circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  location: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  haul: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10l4-4h6l4 4M3 10v8h18v-8M3 10h18" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
    </svg>
  ),
  trailer: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="16" height="10" rx="1" /><circle cx="6" cy="19" r="2" /><circle cx="14" cy="19" r="2" /><path d="M18 10h4v7h-4" />
    </svg>
  ),
  driver: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  load: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  ),
};

export function elementLabel(el: SelectedElement): string {
  const { trucks, trailers, drivers, loads, locations } = useStore.getState();
  const data: Record<string, Record<string, unknown>[]> = { truck: trucks, trailer: trailers, driver: drivers, load: loads, location: locations };
  const list = data[el.type] || [];
  const item = list.find((d) => d.id === el.id);
  if (!item) return el.type;
  switch (el.type) {
    case 'truck': return `#${item.number}`;
    case 'trailer': return `#${item.number}`;
    case 'driver': return item.name as string;
    case 'load': return item.number as string;
    case 'haul': return `${item.pickup_name}→${item.dropoff_name}`;
    case 'location': return item.name as string;
    default: return el.type;
  }
}

const btnStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--bg-elevated)',
  background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0,
};


export function ElementHeader({ el, onEdit, expanded, onToggleExpand, draggable, onDragStart, onDragEnd }: {
  el: SelectedElement;
  onEdit?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const { toggleItemVisible, isItemHidden, actorEvents, setSelectedEventId, setViewTime, viewTime } = useStore();
  const hidden = isItemHidden(el.type, el.id);
  const titleColor = hidden ? 'var(--text-dim)' : 'var(--accent)';
  const icon = CategoryIcons[el.type];
  const label = elementLabel(el);

  const isActor = el.type === 'truck' || el.type === 'trailer' || el.type === 'driver' || el.type === 'load';
  const statusInfo = isActor ? getActorStatus(el.type, el.id, actorEvents, { ...useStore.getState(), viewTime }) : null;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0 }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {onEdit && (
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} style={btnStyle} title="Edit">
          <EditIcon />
        </button>
      )}
      <span
        onClick={(e) => { e.stopPropagation(); toggleItemVisible(el.type, el.id); }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer', color: titleColor, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={label}
      >
        {icon && <span style={{ display: 'inline-flex', color: titleColor, flexShrink: 0 }}>{icon}</span>}
        {label}
      </span>
      {statusInfo && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (statusInfo.eventId) {
              setSelectedEventId(statusInfo.eventId);
              if (statusInfo.eventStartTime) setViewTime(new Date(statusInfo.eventStartTime));
            }
          }}
          style={{
            fontSize: 10, color: statusInfo.isCurrent ? 'var(--warning)' : 'var(--text-dim)',
            cursor: 'pointer', fontStyle: 'italic', flexShrink: 0,
            textDecoration: 'underline', textDecorationStyle: 'dotted',
          }}
          title={statusInfo.isCurrent ? 'Currently active (click to select event)' : 'Last known status (click to select event)'}
        >
          {statusInfo.text}
        </span>
      )}
      {onToggleExpand && (
        <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} style={{ ...btnStyle, border: 'none' }} title={expanded ? 'Collapse' : 'Expand'}>
          <ChevronIcon open={!!expanded} />
        </button>
      )}
    </div>
  );
}

// ── HTML version for leaflet tooltips ──

export function elementHeaderHTML(el: SelectedElement): string {
  const { isItemHidden } = useStore.getState();
  const hidden = isItemHidden(el.type, el.id);
  const titleColor = hidden ? '#9ca3af' : '#2563eb';
  const label = elementLabel(el);

  return `<div style="display:flex;align-items:center;gap:4px;padding:2px">
    <div style="flex:1;font-size:11px;color:${titleColor};font-weight:700;cursor:pointer" data-action="toggle">${label}</div>
  </div>`;
}

export function wireTooltipActions(tooltipEl: HTMLElement, el: SelectedElement, onAction?: () => void) {
  const { toggleItemVisible, setActiveTooltip } = useStore.getState();
  tooltipEl.onclick = (e) => {
    const target = e.target as HTMLElement;
    const actionEl = target.closest('[data-action]') as HTMLElement | null;
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');
    e.stopPropagation();
    if (action === 'toggle') toggleItemVisible(el.type, el.id);
    if (action !== 'toggle' && onAction) onAction();
    if (action !== 'toggle') setActiveTooltip(null);
  };
}

// ── Compact inline RefHeader ──

export function RefHeader({ el }: { el: SelectedElement }) {
  const { isItemHidden, toggleItemVisible, actorEvents, setSelectedEventId, setViewTime, viewTime } = useStore();
  const hidden = isItemHidden(el.type, el.id);
  const color = hidden ? 'var(--text-dim)' : 'var(--accent)';
  const icon = CategoryIcons[el.type];
  const label = elementLabel(el);

  const isActor = el.type === 'truck' || el.type === 'trailer' || el.type === 'driver' || el.type === 'load';
  const statusInfo = isActor ? getActorStatus(el.type, el.id, actorEvents, { ...useStore.getState(), viewTime }) : null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, overflow: 'hidden', minWidth: 0, maxWidth: '100%' }}>
      {icon && <span style={{ display: 'inline-flex', color, flexShrink: 0 }}>{icon}</span>}
      <span
        onClick={(e) => { e.stopPropagation(); toggleItemVisible(el.type, el.id); }}
        style={{ cursor: 'pointer', color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={label}
      >
        {label}
      </span>
      {statusInfo && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (statusInfo.eventId) {
              setSelectedEventId(statusInfo.eventId);
              if (statusInfo.eventStartTime) setViewTime(new Date(statusInfo.eventStartTime));
            }
          }}
          style={{
            fontSize: 9, color: statusInfo.isCurrent ? 'var(--warning)' : 'var(--text-dim)',
            cursor: 'pointer', fontStyle: 'italic',
          }}
        >
          {statusInfo.text}
        </span>
      )}
    </span>
  );
}
