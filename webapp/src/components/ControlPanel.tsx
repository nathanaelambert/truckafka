import { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { SelectedElement } from '../store';
import { ElementCard } from './ElementCard';
import { RefHeader } from './ElementHeader';
import { LocationForm, TruckForm, TrailerForm, DriverForm, LoadForm } from './Forms';
import { RoadEventForm } from './RoadEventForm';
import { SplitPane } from './SplitPane';
import { api } from '../api';

// ── Edit icon button ───────────────────────────────────────────

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Edit"
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--text-dim)', padding: '2px 4px', fontSize: 13,
        display: 'inline-flex', alignItems: 'center',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </button>
  );
}

// ── Wrapper that shows an edit button next to a title ──────────

function TitledSection({ title, onEdit, children }: { title: React.ReactNode; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ color: 'var(--accent)', margin: 0, flex: 1 }}>{title}</h3>
        {onEdit && <EditButton onClick={onEdit} />}
      </div>
      {children}
    </div>
  );
}

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span>{open ? '▼' : '▶'}</span>
      </div>
      {open && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value, clickable, onClick, clamp }: { label: string; value: React.ReactNode; clickable?: boolean; onClick?: () => void; clamp?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span
        className={`info-value ${clickable ? 'clickable' : ''}`}
        onClick={onClick}
        style={clamp ? {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: '0 0 80%',
          maxWidth: '80%',
          textAlign: 'right',
        } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function LocationEditorLauncher({ loc }: { loc: Record<string, unknown> }) {
  const [showForm, setShowForm] = useState(false);
  if (showForm) {
    return <LocationForm location={loc} onClose={() => setShowForm(false)} />;
  }
  return (
    <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
      ✎ Open Location Editor
    </button>
  );
}

// ── Category Icons ──────────────────────────────────────────

const Icons = {
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
  road: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 19l4-14M21 19l-4-14M12 5v2M12 11v2M12 17v2" />
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


const EVENT_COLORS: Record<string, string> = {
  bobtail: '#fb923c', deadmile: '#fbbf24', haul: '#4a9eff',
  loading: '#4ade80', unloading: '#a3e635', attach: '#a78bfa', detach: '#c084fc', idle: '#6b7280',
};

function SelectedEventPanel() {
  const { selectedEventId, setSelectedEventId, orders, roadEvents } = useStore();
  const [eventData, setEventData] = useState<any>(null);

  useEffect(() => {
    if (!selectedEventId) { setEventData(null); return; }

    // First check order events (in store, may not be in DB)
    for (const order of orders) {
      const ev = order.events.find(e => e.id === selectedEventId);
      if (ev) {
        const pickupLoc = useStore.getState().locations.find(l => l.id === ev.start_location_id);
        const dropoffLoc = useStore.getState().locations.find(l => l.id === ev.end_location_id);
        setEventData({
          id: ev.id, type: ev.type,
          start_time: ev.start_time, end_time: ev.end_time,
          truck_id: ev.truck_id, load_id: ev.load_id, trailer_id: ev.trailer_id, driver_id: ev.driver_id,
          start_location_id: ev.start_location_id, end_location_id: ev.end_location_id,
          start_location_name: pickupLoc?.name || null,
          end_location_name: dropoffLoc?.name || null,
          distance_m: ev.distance_m ?? null,
        });
        return;
      }
    }

    // Check road events (in store)
    const re = roadEvents.find((e: any) => e.id === selectedEventId);
    if (re) {
      setEventData({
        id: re.id, type: 'road_event',
        start_time: re.start_at, end_time: re.end_at || re.start_at,
        truck_id: null, load_id: null, trailer_id: null, driver_id: null,
        start_location_name: re.title, end_location_name: null,
        distance_m: null,
        note: re.note, maxspeed_km: re.maxspeed_km, maxweight_kg: re.maxweight_kg,
      });
      return;
    }

    // Fallback: search DB events
    api.getEvents(new Date(Date.now() - 30 * 86400000).toISOString(), new Date(Date.now() + 30 * 86400000).toISOString())
      .then((data: unknown) => {
        const d = data as { events: any[] };
        setEventData(d.events.find(e => e.id === selectedEventId) || null);
      }).catch(() => setEventData(null));
  }, [selectedEventId, orders, roadEvents]);

  if (!selectedEventId || !eventData) {
    return (
      <div className="control-section" style={{ overflow: 'auto' }}>
        <h3>Selected Event</h3>
        <div style={{ padding: 16, color: 'var(--text-dim)', textAlign: 'center' }}>no event selected</div>
      </div>
    );
  }

  const ev = eventData;
  const color = EVENT_COLORS[ev.type] || '#6b7280';
  const actors: { type: string; id: string }[] = [];
  if (ev.truck_id) actors.push({ type: 'truck', id: ev.truck_id });
  if (ev.trailer_id) actors.push({ type: 'trailer', id: ev.trailer_id });
  if (ev.driver_id) actors.push({ type: 'driver', id: ev.driver_id });
  if (ev.load_id) actors.push({ type: 'load', id: ev.load_id });
  const startTime = new Date(ev.start_time).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const endTime = new Date(ev.end_time).toLocaleString('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false });
  const duration = Math.round((new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime()) / 60000);
  const distanceKm = ev.distance_m ? (ev.distance_m / 1000).toFixed(1) + ' km' : null;

  return (
    <div className="control-section" style={{ overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
        <h3 style={{ margin: 0, flex: 1, color: 'var(--accent)' }}>{ev.type}</h3>
        <button onClick={() => setSelectedEventId(null)} style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--bg-elevated)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div style={{ marginBottom: 8 }}>
        {actors.map(a => (
          <div key={`${a.type}-${a.id}`} style={{ marginBottom: 4 }}>
            <RefHeader el={{ type: a.type as SelectedElement['type'], id: a.id }} />
          </div>
        ))}
      </div>
      {ev.start_location_name && ev.end_location_name && (
        <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>{ev.start_location_name} → {ev.end_location_name}</div>
      )}
      {ev.start_location_name && !ev.end_location_name && (
        <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>{ev.start_location_name}</div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{startTime} – {endTime}</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {duration < 60 ? `${duration} min` : `${Math.floor(duration / 60)}h ${duration % 60}min`}{distanceKm ? ` · ${distanceKm}` : ''}
      </div>
      {ev.maxspeed_km && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Max speed: {ev.maxspeed_km} km/h</div>}
      {ev.maxweight_kg && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Max weight: {ev.maxweight_kg} kg</div>}
      {ev.note && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{ev.note}</div>}
    </div>
  );
}

// ── View Options with per-item tables ───────────────────────────

function ViewSection({
  title,
  icon,
  items,
  type,
  renderName,
  FormComponent,
  forceHub,
}: {
  title: string;
  icon: React.ReactNode;
  items: Record<string, unknown>[];
  type: string;
  renderName: (item: Record<string, unknown>) => string;
  FormComponent?: React.ComponentType<{ onClose: () => void; forceHub?: boolean }>;
  forceHub?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { isItemHidden, setAllVisible } = useStore();

  const visibleCount = items.filter((item) => !isItemHidden(type, item.id as string)).length;
  const hasVisible = visibleCount > 0;
  const ids = items.map((i) => i.id as string);

  if (showForm && FormComponent) {
    return <FormComponent onClose={() => setShowForm(false)} forceHub={forceHub} />;
  }

  return (
    <div style={{ marginBottom: 2 }}>
      <div className="collapsible-header" style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer', color: hasVisible ? 'var(--text)' : 'var(--text-dim)' }} onClick={() => setOpen(!open)}>
          <span style={{ display: 'inline-flex', color: hasVisible ? 'var(--accent)' : 'var(--text-dim)' }}>{icon}</span>
          {title} ({visibleCount}/{items.length})
          {visibleCount < items.length && (
            <button
              onClick={(e) => { e.stopPropagation(); setAllVisible(type, ids, true); }}
              style={{ marginLeft: 6, background: 'transparent', border: '1px solid var(--bg-elevated)', color: 'var(--accent)', fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer' }}
            >show all</button>
          )}
          {hasVisible && (
            <button
              onClick={(e) => { e.stopPropagation(); setAllVisible(type, ids, false); }}
              style={{ background: 'transparent', border: '1px solid var(--bg-elevated)', color: 'var(--text-dim)', fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer' }}
            >hide all</button>
          )}
        </span>
        {FormComponent && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowForm(true); }}
            style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 10, padding: '1px 8px', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}
          >+ New</button>
        )}
        <span style={{ cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setOpen(!open)}>
          {open ? '▼' : '▶'}
        </span>
      </div>
      {open && (
        <div className="collapsible-content">
          {items.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '4px 0' }}>None</div>
          ) : (
            items.map((item) => {
              const id = item.id as string;
              const el = { type: type as SelectedElement['type'], id };
              return (
                <div key={id} style={{ padding: '2px 0' }}>
                  <ElementCard
                    el={el}
                    defaultExpanded={false}
                  />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ViewOptions() {
  const { trucks, trailers, drivers, locations, loads } = useStore();
  const hubs = locations.filter(l => l.is_hub as boolean);
  const regularLocs = locations.filter(l => !l.is_hub as boolean);

  return (
    <div className="control-section" style={{ flex: 1 }}>
      <h3>Actors</h3>

      <ViewSection
        title="Trucks"
        icon={Icons.truck}
        items={trucks}
        type="truck"
        renderName={(t) => `#${t.number as string} (${(t.hub as string) || ''})`}
        FormComponent={TruckForm}
      />

      <ViewSection
        title="Trailers"
        icon={Icons.trailer}
        items={trailers}
        type="trailer"
        renderName={(t) => `#${t.number as string}`}
        FormComponent={TrailerForm}
      />

      <ViewSection
        title="Drivers"
        icon={Icons.driver}
        items={drivers}
        type="driver"
        renderName={(d) => d.name as string}
        FormComponent={DriverForm}
      />

      <ViewSection
        title="Loads"
        icon={Icons.load}
        items={loads}
        type="load"
        renderName={(l) => `${l.number as string} — ${l.pickup_location_name as string} → ${l.dropoff_location_name as string}`}
        FormComponent={LoadForm}
      />

      <h3 style={{ marginTop: 16 }}>Geography</h3>

      <ViewSection
        title="Hubs"
        icon={Icons.location}
        items={hubs}
        type="location"
        renderName={(l) => l.name as string}
        FormComponent={LocationForm}
        forceHub
      />

      <ViewSection
        title="Regular Locations"
        icon={Icons.location}
        items={regularLocs}
        type="location"
        renderName={(l) => l.name as string}
        FormComponent={LocationForm}
      />

      <RoadEventsSection />
    </div>
  );
}

const ROAD_EVENT_COLOR = '#fb923c';

function RoadEventsSection() {
  const { roadEvents, setSelectedEventId, setViewTime, toggleItemVisible, isItemHidden } = useStore();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return <RoadEventForm onClose={() => setShowForm(false)} />;
  }

  const fmtDate = (s: string) => new Date(s).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div style={{ marginBottom: 2 }}>
      <div className="collapsible-header" style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, cursor: 'pointer', color: roadEvents.length > 0 ? 'var(--text)' : 'var(--text-dim)' }} onClick={() => setOpen(!open)}>
          <span style={{ display: 'inline-flex', color: ROAD_EVENT_COLOR }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 19l4-14M21 19l-4-14M12 5v2M12 11v2M12 17v2" /></svg>
          </span>
          Road Events ({roadEvents.length})
        </span>
        <button onClick={(e) => { e.stopPropagation(); setShowForm(true); }} style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 10, padding: '1px 8px', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}>+ New</button>
        <span style={{ cursor: 'pointer', color: 'var(--text-dim)' }} onClick={() => setOpen(!open)}>{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div className="collapsible-content">
          {roadEvents.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '4px 0' }}>None</div>
          ) : (
            roadEvents.map((ev) => {
              const evId = ev.id as string;
              const hidden = isItemHidden('road_event', evId);
              const color = hidden ? 'var(--text-dim)' : ROAD_EVENT_COLOR;
              return (
                <div
                  key={evId}
                  onClick={() => { setSelectedEventId(evId); if (ev.start_at) setViewTime(new Date(ev.start_at as string)); }}
                  style={{ padding: '4px 6px', borderRadius: 4, cursor: 'pointer', borderLeft: `3px solid ${color}`, marginBottom: 4, background: 'var(--bg)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleItemVisible('road_event', evId); }} />
                    <span
                      onClick={(e) => { e.stopPropagation(); toggleItemVisible('road_event', evId); }}
                      style={{ fontSize: 12, fontWeight: 600, color: hidden ? 'var(--text-dim)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, cursor: 'pointer' }}
                    >
                      {ev.title as string}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                    {fmtDate(ev.start_at as string)} – {ev.end_at ? fmtDate(ev.end_at as string) : 'ongoing'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                    {ev.maxspeed_km ? `${ev.maxspeed_km} km/h` : ''} {ev.maxweight_kg ? `· ${ev.maxweight_kg} kg` : ''} {(ev as any).segments?.length ? `· ${(ev as any).segments.length} segments` : ''}
                  </div>
                  {ev.note ? <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.note as string}</div> : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function ControlPanel() {
  return (
    <div className="monitor-control">
      <SplitPane direction="vertical" initialSplit={35} min={80}>
        <SelectedEventPanel />
        <div style={{ overflow: 'auto' }}>
          <ViewOptions />
        </div>
      </SplitPane>
    </div>
  );
}
