import { useState } from 'react';
import { useStore, computeEventState, computeOrderStatus } from '../store';
import type { Order, OrderEvent } from '../store';
import { OrderForm, AssignOrderForm } from './OrderForm';
import { Modal } from './Modal';
import { RefHeader } from './ElementHeader';

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const EVENT_COLORS: Record<string, string> = {
  loading: '#4ade80', haul: '#4a9eff', unloading: '#a3e635', idle: '#6b7280',
};

const EVENT_ICONS: Record<string, string> = {
  loading: '📦', haul: '🛻', unloading: '📤', idle: '⏸',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function durationLabel(ev: OrderEvent): string {
  const mins = Math.round((new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime()) / 60000);
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value" style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function OrderEventRow({ ev, state }: { ev: OrderEvent; state: string }) {
  const { setSelectedEventId, selectedEventId, setViewTime } = useStore();
  const color = EVENT_COLORS[ev.type] || '#6b7280';
  const locId = ev.start_location_id;
  const isSel = selectedEventId === ev.id;

  return (
    <div
      onClick={() => {
        const cur = useStore.getState().selectedEventId;
        if (cur === ev.id) { setSelectedEventId(null); }
        else {
          setViewTime(new Date(ev.start_time));
          setSelectedEventId(ev.id);
        }
      }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 6px',
        borderBottom: '1px solid var(--bg-elevated)', cursor: 'pointer',
        background: isSel ? 'var(--bg-elevated)' : 'transparent',
        borderRadius: 4, borderLeft: `3px solid ${color}`,
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{EVENT_ICONS[ev.type] || '•'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>{ev.type}</span>
          <span className={`status-badge ${state}`} style={{ fontSize: 9, padding: '1px 6px' }}>{state}</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>{durationLabel(ev)}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
          {fmtDate(ev.start_time)} – {fmtDate(ev.end_time)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          <RefHeader el={{ type: 'location', id: locId }} />
          {ev.end_location_id !== ev.start_location_id && (
            <> → <RefHeader el={{ type: 'location', id: ev.end_location_id }} /></>
          )}
        </div>
        {ev.distance_m != null && ev.distance_m > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {(ev.distance_m / 1000).toFixed(1)} km · {durationLabel(ev)}
          </div>
        )}
        {ev.type === 'loading' && ev.pickup_after && ev.pickup_before && (
          <div style={{ fontSize: 10, color: 'rgba(100, 200, 100, 0.7)' }}>
            Window: {fmtDate(ev.pickup_after)} – {fmtDate(ev.pickup_before)}
          </div>
        )}
        {ev.type === 'unloading' && ev.dropoff_after && ev.dropoff_before && (
          <div style={{ fontSize: 10, color: 'rgba(200, 100, 100, 0.7)' }}>
            Window: {fmtDate(ev.dropoff_after)} – {fmtDate(ev.dropoff_before)}
          </div>
        )}
        {/* Actor refs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          {ev.truck_id ? <RefHeader el={{ type: 'truck', id: ev.truck_id }} /> : <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>No truck</span>}
          {ev.driver_id ? <RefHeader el={{ type: 'driver', id: ev.driver_id }} /> : <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>No driver</span>}
          {ev.trailer_id ? <RefHeader el={{ type: 'trailer', id: ev.trailer_id }} /> : <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>No trailer</span>}
          {ev.load_id && <RefHeader el={{ type: 'load', id: ev.load_id }} />}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const { isItemHidden, toggleItemVisible, locations, dispatchOrder, splitOrder, linkOrders, orders } = useStore();
  const now = new Date();
  const orderStatus = computeOrderStatus(order, now);
  const hidden = isItemHidden('order', order.id);

  const pickupLoc = locations.find(l => l.id === order.pickup_location_id);
  const dropoffLoc = locations.find(l => l.id === order.dropoff_location_id);
  const hasHaul = !!order.haul_id;

  const cardStyle: React.CSSProperties = {
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--bg-elevated)',
    background: 'var(--bg)',
    marginBottom: 6,
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          onClick={(e) => { e.stopPropagation(); toggleItemVisible('order', order.id); }}
          style={{ cursor: 'pointer', color: hidden ? 'var(--text-dim)' : 'var(--accent)', fontSize: 13, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={`Order for ${order.load_number}`}
        >
          {order.load_number}
        </span>
        {orderStatus === 'incoming' && !hasHaul && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowAssign(true); }}
            style={{ background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 10, padding: '2px 10px', borderRadius: 3, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
          >Assign</button>
        )}
        {orderStatus === 'incoming' && hasHaul && (
          <button
            onClick={(e) => { e.stopPropagation(); dispatchOrder(order.id); }}
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: '#fff', fontSize: 10, padding: '2px 10px', borderRadius: 3, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
          >Dispatch</button>
        )}
        {orderStatus === 'incoming' && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowSplit(true); }}
            style={{ background: 'transparent', border: '1px solid var(--text-dim)', color: 'var(--text-dim)', fontSize: 10, padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
          >Split</button>
        )}
        {orderStatus === 'incoming' && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowLink(true); }}
            style={{ background: 'transparent', border: '1px solid var(--text-dim)', color: 'var(--text-dim)', fontSize: 10, padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
          >Link</button>
        )}
        <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, display: 'inline-flex', flexShrink: 0 }}>
          <ChevronIcon open={expanded} />
        </button>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
        {pickupLoc?.name as string} → {dropoffLoc?.name as string}
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          <InfoRow label="Pickup Loc" value={<RefHeader el={{ type: 'location', id: order.pickup_location_id }} />} />
          <InfoRow label="Dropoff Loc" value={<RefHeader el={{ type: 'location', id: order.dropoff_location_id }} />} />
          <InfoRow label="Weight" value={`${order.weight} kg`} />
          <InfoRow label="Commodity" value={order.commodity || 'N/A'} />
          <InfoRow label="Hazmat" value={order.is_hazmat ? 'Yes' : 'No'} />
          <InfoRow label="Rate/km" value={`$${order.rate_km || 0}`} />

          {/* Windows — from events if available (supports merged orders), else order-level */}
          {order.events.some(e => (e.type === 'loading' && e.pickup_after) || (e.type === 'unloading' && e.dropoff_after))
            ? (() => {
                let pickupN = 0, dropoffN = 0;
                return order.events
                  .filter(e => e.type === 'loading' || e.type === 'unloading')
                  .map((ev) => {
                    if (ev.type === 'loading') { pickupN++; return (
                      <InfoRow key={ev.id} label={`Pickup ${pickupN} Window`} value={`${fmtDate(ev.pickup_after!)} – ${fmtDate(ev.pickup_before!)}`} />
                    ); }
                    else { dropoffN++; return (
                      <InfoRow key={ev.id} label={`Dropoff ${dropoffN} Window`} value={`${fmtDate(ev.dropoff_after!)} – ${fmtDate(ev.dropoff_before!)}`} />
                    ); }
                  });
              })()
            : <>
                <InfoRow label="Pickup Window" value={`${fmtDate(order.pickup_after)} – ${fmtDate(order.pickup_before)}`} />
                <InfoRow label="Dropoff Window" value={`${fmtDate(order.dropoff_after)} – ${fmtDate(order.dropoff_before)}`} />
              </>
          }

          <div style={{ marginTop: 8, marginBottom: 4, fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Associated Events</div>
          {order.events.map(ev => (
            <OrderEventRow key={ev.id} ev={ev} state={computeEventState(ev, hasHaul, now)} />
          ))}
        </div>
      )}

      {showAssign && <AssignOrderForm orderId={order.id} onClose={() => setShowAssign(false)} />}
      {showSplit && <SplitOrderForm orderId={order.id} onClose={() => setShowSplit(false)} />}
      {showLink && <LinkOrderForm order1Id={order.id} onClose={() => setShowLink(false)} />}
    </div>
  );
}

function CollapsibleSection({ title, count, orders, defaultOpen }: { title: string; count: number; orders: Order[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span>{title} ({count})</span>
        <span>{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div className="collapsible-content">
          {orders.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '4px 0' }}>None</div>
          ) : (
            orders.map(o => <OrderCard key={o.id} order={o} />)
          )}
        </div>
      )}
    </div>
  );
}

export function OrdersPanel() {
  const { orders } = useStore();
  const [showForm, setShowForm] = useState(false);

  const now = new Date();
  const incoming = orders.filter(o => computeOrderStatus(o, now) === 'incoming');
  const dispatched = orders.filter(o => computeOrderStatus(o, now) === 'dispatched');
  const completed = orders.filter(o => computeOrderStatus(o, now) === 'completed');

  return (
    <div className="monitor-control" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, flex: 1 }}>Orders</h3>
        <button
          onClick={() => setShowForm(true)}
          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >new +</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 12px' }}>
        <CollapsibleSection title="Incoming" count={incoming.length} orders={incoming} defaultOpen />
        <CollapsibleSection title="Dispatched" count={dispatched.length} orders={dispatched} />
        <CollapsibleSection title="Completed" count={completed.length} orders={completed} />
      </div>
      {showForm && <OrderForm onClose={() => setShowForm(false)} />}
    </div>
  );
}

// ── Split Order popup ───────────────────────────────────────

function SplitOrderForm({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { locations, splitOrder } = useStore();
  const hubs = locations.filter(l => l.is_hub as boolean);
  const [hubId, setHubId] = useState('');

  const submit = async () => {
    if (!hubId) throw new Error('Please select a hub');
    await splitOrder(orderId, hubId);
    onClose();
  };

  return (
    <Modal title="Split Order at Hub" onClose={onClose} onSubmit={submit} submitLabel="Split" width={500}>
      <div className="form-group" style={{ gridColumn: '1 / 3' }}>
        <label>Select Hub *</label>
        <select value={hubId} onChange={(e) => setHubId(e.target.value)}>
          <option value="">Select a hub...</option>
          {hubs.map((l) => <option key={l.id as string} value={l.id as string}>{l.name as string}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
        This will create two orders: one from the original pickup to the hub, and one from the hub to the original dropoff.
        The original order will be deleted.
      </div>
    </Modal>
  );
}

// ── Link Order popup ────────────────────────────────────────

function LinkOrderForm({ order1Id, onClose }: { order1Id: string; onClose: () => void }) {
  const { orders, drivers, linkOrders } = useStore();
  const [order2Id, setOrder2Id] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const order1 = orders.find(o => o.id === order1Id);
  const driverId = order1?.events.find(e => e.driver_id)?.driver_id;
  const driver = drivers.find(d => d.id === driverId);
  const dayStart = (driver?.day_start_hour as string) || '06:00';

  const candidates = orders.filter(o => o.id !== order1Id && computeOrderStatus(o, new Date()) === 'incoming');

  const submit = async () => {
    if (!order2Id) throw new Error('Please select an order to link');
    setError(null);
    setWarning(null);

    if (driver && order1) {
      const order2 = orders.find(o => o.id === order2Id);
      if (order2) {
        const allEnds = [...order1.events, ...(order2.events || [])].map(e => new Date(e.end_time).getTime());
        const lastEnd = Math.max(...allEnds);
        const [h, m] = dayStart.split(':').map(Number);
        const shiftStart = new Date(lastEnd);
        shiftStart.setHours(h, m, 0, 0);
        if (lastEnd > shiftStart.getTime() + 15 * 3600 * 1000) {
          setWarning(`Warning: Driver's shift will extend beyond 14 hours (day starts at ${dayStart})`);
          return;
        }
      }
    }

    try {
      await linkOrders(order1Id, order2Id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal title="Link Orders" onClose={onClose} onSubmit={submit} submitLabel="Link" width={500}>
      {error && (
        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#3a2a2a', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', fontSize: 12 }}>
          {error}
        </div>
      )}
      {warning && (
        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#4a3a2a', border: '1px solid var(--warning)', borderRadius: 4, color: 'var(--warning)', fontSize: 12 }}>
          {warning}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={async () => { setWarning(null); try { await linkOrders(order1Id, order2Id); onClose(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>Link anyway</button>
          </div>
        </div>
      )}
      <div className="form-group" style={{ gridColumn: '1 / 3' }}>
        <label>Select Order to Link *</label>
        <select value={order2Id} onChange={(e) => { setOrder2Id(e.target.value); setError(null); setWarning(null); }}>
          <option value="">Select an order...</option>
          {candidates.map((o) => <option key={o.id} value={o.id}>{o.load_number}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
        Links two orders into one multi-stop order (pickup1 → dropoff1 → deadmile → pickup2 → dropoff2).
        A deadmile is computed between the two. If there is not enough time for the deadmile, linking will fail.
      </div>
      {driver && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Driver: {driver.name as string} (day starts at {dayStart}, 14h shift limit)
        </div>
      )}
    </Modal>
  );
}
