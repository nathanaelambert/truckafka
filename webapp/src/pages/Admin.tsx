import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { TruckForm, TrailerForm, DriverForm, LoadForm, LocationForm, HaulForm, UserForm } from '../components/Forms';
import { RoadEventForm } from '../components/RoadEventForm';

type AnyRecord = Record<string, unknown>;

function fmtDate(dt: string | undefined): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ═══════════════════════════════════════════════════════════════
// Fleet Summary
// ═══════════════════════════════════════════════════════════════

function FleetSummary() {
  const { fleetSummary } = useStore();
  if (!fleetSummary) return null;

  const cards = [
    { label: 'Total Trucks', value: fleetSummary.total_trucks },
    { label: 'Total Trailers', value: fleetSummary.total_trailers },
    { label: 'Total Drivers', value: fleetSummary.total_drivers },
    { label: 'Drivers In Service', value: fleetSummary.drivers_in_service },
    { label: 'Drivers Off Duty', value: fleetSummary.drivers_off_duty },
    { label: 'Trucks On Move', value: fleetSummary.trucks_on_move },
    { label: 'Trucks @ London', value: fleetSummary.trucks_london },
    { label: 'Trucks @ Milton', value: fleetSummary.trucks_milton },
    { label: 'Trailers @ London', value: fleetSummary.trailers_london },
    { label: 'Trailers @ Milton', value: fleetSummary.trailers_milton },
  ];

  return (
    <div className="admin-section">
      <h2>Fleet Summary</h2>
      <div className="summary-grid">
        {cards.map((c) => (
          <div key={c.label} className="summary-card">
            <div className="value">{c.value}</div>
            <div className="label">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Fleet Control — Trucks, Trailers, Drivers
// ═══════════════════════════════════════════════════════════════

function FleetControl() {
  const { trucks, trailers, drivers, refreshTrucks, refreshTrailers, refreshDrivers, refreshFleetSummary, refreshAll } = useStore();
  const [modal, setModal] = useState<null | { type: 'truck' | 'trailer' | 'driver'; data?: AnyRecord }>(null);

  return (
    <div className="admin-section">
      <h2>Fleet Control</h2>

      {/* Trucks */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-dim)' }}>Trucks ({trucks.length})</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setModal({ type: 'truck' })}>+ Add Truck</button>
      </div>
      <table>
        <thead><tr><th>#</th><th>Hub</th><th>Max Wt</th><th>Safe</th><th>Actions</th></tr></thead>
        <tbody>
          {trucks.map((t) => (
            <tr key={t.id as string}>
              <td>{t.number as string}</td>
              <td>{t.hub as string}</td>
              <td>{(t.maxweight_kg as number).toLocaleString()} kg</td>
              <td>{(t.is_safe_to_drive as boolean) ? '✓' : '✗'}</td>
              <td>
                <div className="table-actions">
                  <button className="btn btn-sm" onClick={() => setModal({ type: 'truck', data: t })}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete truck ${t.number}?`)) { await api.deleteTruck(t.id as string); await refreshTrucks(); await refreshFleetSummary(); await refreshAll(); } }}>Del</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Trailers */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-dim)' }}>Trailers ({trailers.length})</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setModal({ type: 'trailer' })}>+ Add Trailer</button>
      </div>
      <table>
        <thead><tr><th>#</th><th>Hub</th><th>Max Wt</th><th>Safe</th><th>Actions</th></tr></thead>
        <tbody>
          {trailers.map((t) => (
            <tr key={t.id as string}>
              <td>{t.number as string}</td>
              <td>{t.hub as string}</td>
              <td>{(t.maxweight_kg as number).toLocaleString()} kg</td>
              <td>{(t.is_safe_to_drive as boolean) ? '✓' : '✗'}</td>
              <td>
                <div className="table-actions">
                  <button className="btn btn-sm" onClick={() => setModal({ type: 'trailer', data: t })}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete trailer ${t.number}?`)) { await api.deleteTrailer(t.id as string); await refreshTrailers(); await refreshFleetSummary(); await refreshAll(); } }}>Del</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Drivers */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-dim)' }}>Drivers ({drivers.length})</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setModal({ type: 'driver' })}>+ Add Driver</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Cycle</th><th>Drive Hrs</th><th>Overtime</th><th>Actions</th></tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id as string}>
              <td>{d.name as string}</td>
              <td>C{d.cycle_id as number}</td>
              <td>{d.remaining_drive_h as number}h</td>
              <td>{d.overtime as number}h</td>
              <td>
                <div className="table-actions">
                  <button className="btn btn-sm" onClick={() => setModal({ type: 'driver', data: d })}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete driver ${d.name}?`)) { await api.deleteDriver(d.id as string); await refreshDrivers(); await refreshFleetSummary(); await refreshAll(); } }}>Del</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal?.type === 'truck' && <TruckForm truck={modal.data} onClose={() => setModal(null)} />}
      {modal?.type === 'trailer' && <TrailerForm trailer={modal.data} onClose={() => setModal(null)} />}
      {modal?.type === 'driver' && <DriverForm driver={modal.data} onClose={() => setModal(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Locations
// ═══════════════════════════════════════════════════════════════

function LocationsSection() {
  const { locations, refreshLocations, refreshAll } = useStore();
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Locations ({locations.length})</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>+ Add Location</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Position</th><th>Address</th><th>Geofence</th><th>Actions</th></tr></thead>
        <tbody>
          {locations.map((l) => {
            const pos = l.position as { lat: number; lng: number } | undefined;
            return (
              <tr key={l.id as string}>
                <td>{l.name as string}</td>
                <td>{pos ? `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` : '—'}</td>
                <td>{(l.address as string) || '—'}</td>
                <td>{(l.geofence_name as string) ? '✓' : '—'}</td>
                <td>
                  <div className="table-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(l)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete location ${l.name}?`)) { await api.deleteLocation(l.id as string); await refreshLocations(); await refreshAll(); } }}>Del</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {creating && <LocationForm onClose={() => setCreating(false)} />}
      {editing && <LocationForm location={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Loads
// ═══════════════════════════════════════════════════════════════

function LoadsSection() {
  const { loads, refreshLoads, refreshAll } = useStore();
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Loads ({loads.length})</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>+ Create Load</button>
      </div>
      <table>
        <thead><tr><th>Number</th><th>Pickup</th><th>Dropoff</th><th>Weight</th><th>Hazmat</th><th>Actions</th></tr></thead>
        <tbody>
          {loads.map((l) => (
            <tr key={l.id as string}>
              <td>{l.number as string}</td>
              <td>{l.pickup_location_name as string}</td>
              <td>{l.dropoff_location_name as string}</td>
              <td>{(l.weight as number).toLocaleString()} kg</td>
              <td>{(l.is_hazmat as boolean) ? '⚠️' : '—'}</td>
              <td>
                <div className="table-actions">
                  <button className="btn btn-sm" onClick={() => setEditing(l)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete load ${l.number}?`)) { await api.deleteLoad(l.id as string); await refreshLoads(); await refreshAll(); } }}>Del</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {creating && <LoadForm onClose={() => setCreating(false)} />}
      {editing && <LoadForm load={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Hauls
// ═══════════════════════════════════════════════════════════════

function HaulsSection() {
  const { hauls, refreshHauls, refreshAll } = useStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AnyRecord | null>(null);

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Hauls ({hauls.length})</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>+ Create Haul</button>
      </div>
      <table>
        <thead><tr><th>Load</th><th>Driver</th><th>Route</th><th>Start</th><th>End</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {hauls.map((h) => (
            <tr key={h.id as string}>
              <td>{h.load_number as string}</td>
              <td>{h.driver_name as string}</td>
              <td style={{ fontSize: 12 }}>{h.pickup_name as string} → {h.dropoff_name as string}</td>
              <td style={{ fontSize: 12 }}>{fmtDate(h.started_at as string)}</td>
              <td style={{ fontSize: 12 }}>{fmtDate(h.ended_at as string)}</td>
              <td><span className={`status-badge ${h.status}`}>{(h.status as string).replace(/_/g, ' ')}</span></td>
              <td>
                <div className="table-actions">
                  {h.status === 'draft' && <button className="btn btn-sm btn-primary" onClick={async () => { await api.submitHaul(h.id as string); await refreshHauls(); }}>Submit</button>}
                  {h.status === 'assigned' && <button className="btn btn-sm btn-primary" onClick={async () => { await api.startHaul(h.id as string); await refreshHauls(); }}>Start</button>}
                  {h.status === 'in_progress' && <button className="btn btn-sm" onClick={async () => { await api.completeHaul(h.id as string); await refreshHauls(); }}>Complete</button>}
                  <button className="btn btn-sm" onClick={() => setEditing(h)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm('Delete haul?')) { await api.deleteHaul(h.id as string); await refreshHauls(); await refreshAll(); } }}>Del</button>
                </div>
              </td>
            </tr>
          ))}
          {hauls.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No hauls yet</td></tr>}
        </tbody>
      </table>
      {creating && <HaulForm onClose={() => setCreating(false)} />}
      {editing && <HaulForm haul={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Orders
// ═══════════════════════════════════════════════════════════════

function OrdersSection() {
  const { orders, refreshOrders, refreshAll } = useStore();

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Orders ({orders.length})</h2>
      </div>
      <table>
        <thead><tr><th>Load #</th><th>Status</th><th>Events</th><th>Haul</th><th>Actions</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.load_number}</td>
              <td><span className={`status-badge ${o.status}`}>{o.status}</span></td>
              <td style={{ fontSize: 12 }}>{o.events.length} events ({o.events.filter(e => e.status === 'incoming').length} incoming, {o.events.filter(e => e.status === 'dispatched').length} dispatched, {o.events.filter(e => e.status === 'completed').length} completed)</td>
              <td style={{ fontSize: 12 }}>{o.haul_id ? o.haul_id.slice(0, 8) : '—'}</td>
              <td><button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete order for ${o.load_number}?`)) { await api.deleteOrder(o.id); await refreshOrders(); await refreshAll(); } }}>Del</button></td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No orders</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Road Events
// ═══════════════════════════════════════════════════════════════

function RoadEventsSection() {
  const { refreshHauls, refreshAll } = useStore();
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    setEvents(await api.getRoadEvents() as AnyRecord[]);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Road Events ({events.length})</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>+ Create Event</button>
      </div>
      <table>
        <thead><tr><th>Title</th><th>Max Speed</th><th>Max Weight</th><th>Usable</th><th>Start</th><th>End</th><th>Segments</th><th>Actions</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id as string}>
              <td>{e.title as string || '—'}</td>
              <td>{e.maxspeed_km ? `${e.maxspeed_km} km/h` : '—'}</td>
              <td>{e.maxweight_kg ? `${e.maxweight_kg} kg` : '—'}</td>
              <td>{(e.is_usable as boolean) ? '✓' : '✗'}</td>
              <td style={{ fontSize: 12 }}>{fmtDate(e.start_at as string)}</td>
              <td style={{ fontSize: 12 }}>{e.end_at ? fmtDate(e.end_at as string) : 'ongoing'}</td>
              <td>{(e as any).segments?.length || 0}</td>
              <td><button className="btn btn-sm btn-danger" onClick={async () => { await api.deleteRoadEvent(e.id as string); await refresh(); await refreshAll(); }}>Del</button></td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No road events</td></tr>}
        </tbody>
      </table>
      {creating && <RoadEventForm onClose={async () => { setCreating(false); await refresh(); await refreshAll(); }} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Timeline Events
// ═══════════════════════════════════════════════════════════════

function EventsSection() {
  const { refreshAll } = useStore();
  const [events, setEvents] = useState<AnyRecord[]>([]);

  const refresh = async () => {
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const to = new Date(Date.now() + 30 * 86400000).toISOString();
    const data = await api.getEvents(from, to) as { events: AnyRecord[] };
    setEvents(data.events || []);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Events ({events.length})</h2>
        <button className="btn btn-sm" onClick={refresh}>Refresh</button>
      </div>
      <table>
        <thead><tr><th>Type</th><th>Status</th><th>Start</th><th>End</th><th>Truck</th><th>Load</th><th>Locations</th><th>Actions</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id as string}>
              <td><span className={`status-badge ${e.type === 'haul' ? 'assigned' : e.type === 'loading' ? 'completed' : e.type === 'unloading' ? 'on_duty_not_driving' : 'off_duty'}`}>{e.type as string}</span></td>
              <td><span className={`status-badge ${(e.status as string) || 'incoming'}`}>{(e.status as string) || 'incoming'}</span></td>
              <td style={{ fontSize: 12 }}>{fmtDate(e.start_time as string)}</td>
              <td style={{ fontSize: 12 }}>{fmtDate(e.end_time as string)}</td>
              <td style={{ fontSize: 12 }}>{(e.truck_id as string)?.slice(0, 8) || '—'}</td>
              <td style={{ fontSize: 12 }}>{(e.load_id as string)?.slice(0, 8) || '—'}</td>
              <td style={{ fontSize: 12 }}>{e.start_location_name as string || '—'} → {e.end_location_name as string || '—'}</td>
              <td><button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Delete event ${e.type}?`)) { await api.deleteEvent(e.id as string); await refresh(); await refreshAll(); } }}>Del</button></td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No events</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Simulate Driver
// ═══════════════════════════════════════════════════════════════

function SimulateDriver() {
  const { hauls, refreshHauls } = useStore();
  const [activeSims, setActiveSims] = useState<string[]>([]);
  const [speed, setSpeed] = useState(80);

  const refreshSims = async () => {
    try {
      const data = await api.getActiveSimulations() as { active: string[] };
      setActiveSims(data.active);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    refreshSims();
    const interval = setInterval(refreshSims, 3000);
    return () => clearInterval(interval);
  }, []);

  const assignedHauls = hauls.filter((h) => ['assigned', 'in_progress'].includes(h.status as string));

  return (
    <div className="admin-section">
      <h2>Simulate Driver (Test & Debug)</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>
        Simulate a truck driving along its assigned haul itinerary. Position updates are published every 2s.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Speed:</label>
        <input type="number" value={speed} onChange={(e) => setSpeed(parseInt(e.target.value) || 80)} style={{ width: 80, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4 }} />
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>km/h</span>
      </div>
      {activeSims.length > 0 && (
        <div style={{ marginBottom: 12, padding: 8, background: 'var(--bg-elevated)', borderRadius: 4 }}>
          <strong style={{ color: 'var(--success)' }}>● {activeSims.length} simulation(s) running</strong>
        </div>
      )}
      <table>
        <thead><tr><th>Load</th><th>Driver</th><th>Route</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {assignedHauls.map((h) => {
            const isSimulating = activeSims.includes(h.id as string);
            return (
              <tr key={h.id as string}>
                <td>{h.load_number as string}</td>
                <td>{h.driver_name as string}</td>
                <td style={{ fontSize: 12 }}>{h.pickup_name as string} → {h.dropoff_name as string}</td>
                <td><span className={`status-badge ${h.status}`}>{h.status as string}</span></td>
                <td>
                  {isSimulating ? (
                    <button className="btn btn-sm btn-danger" onClick={async () => { await api.stopSimulation(h.id as string); await refreshSims(); await refreshHauls(); }}>Stop</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={async () => { await api.startSimulation(h.id as string, speed); await refreshSims(); }}>Start Sim</button>
                  )}
                </td>
              </tr>
            );
          })}
          {assignedHauls.length === 0 && (
            <tr><td colSpan={5} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No assigned/in-progress hauls. Create and submit a haul first.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Danger Zone
// ═══════════════════════════════════════════════════════════════

function DangerZone() {
  const { refreshAll } = useStore();
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="admin-section" style={{ borderColor: 'var(--danger)' }}>
      <h2 style={{ color: 'var(--danger)' }}>Danger Zone</h2>
      {!confirm ? (
        <button className="btn btn-danger" onClick={() => setConfirm(true)}>Delete Everything</button>
      ) : (
        <div>
          <p style={{ color: 'var(--danger)', marginBottom: 8 }}>⚠️ This will delete ALL data (trucks, trailers, drivers, loads, hauls, users). This cannot be undone.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-danger" onClick={async () => { await api.nukeAll(); await refreshAll(); setConfirm(false); }}>Yes, Delete Everything</button>
            <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Admin Page
// ═══════════════════════════════════════════════════════════════

export function Admin() {
  const [showUsers, setShowUsers] = useState(false);
  return (
    <div className="admin-page">
      <FleetSummary />
      <FleetControl />
      <LocationsSection />
      <LoadsSection />
      <HaulsSection />
      <OrdersSection />
      <RoadEventsSection />
      <EventsSection />
      <SimulateDriver />
      <div className="admin-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Users</h2>
          <button className="btn btn-sm" onClick={() => setShowUsers(true)}>Manage Users</button>
        </div>
      </div>
      <DangerZone />
      {showUsers && <UserForm onClose={() => setShowUsers(false)} />}
    </div>
  );
}
