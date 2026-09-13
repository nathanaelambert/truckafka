import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { LocationForm } from './Forms';
import { ElementHeader } from './ElementHeader';
import { useStore, type OrderFormData } from '../store';

function toLocalInput(dt: string | undefined): string {
  if (!dt) return '';
  const d = new Date(dt);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

const NEW_LOCATION_VALUE = '__new__';

function LocationPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { locations, refreshLocations } = useStore();
  const [showLocForm, setShowLocForm] = useState(false);

  const handleSelect = (val: string) => {
    if (val === NEW_LOCATION_VALUE) {
      setShowLocForm(true);
    } else {
      onChange(val);
    }
  };

  return (
    <>
      <select value={value} onChange={(e) => handleSelect(e.target.value)}>
        <option value="">Select...</option>
        {locations.map((l) => <option key={l.id as string} value={l.id as string}>{l.name as string}</option>)}
        <option value={NEW_LOCATION_VALUE}>+ Create new location...</option>
      </select>
      {showLocForm && (
        <LocationForm onClose={async () => {
          setShowLocForm(false);
          await refreshLocations();
          const latest = useStore.getState().locations;
          if (latest.length > 0) {
            const newest = latest[latest.length - 1];
            onChange(newest.id as string);
          }
        }} />
      )}
    </>
  );
}

export function OrderForm({ onClose }: { onClose: () => void }) {
  const { createOrder } = useStore();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const [form, setForm] = useState({
    number: '',
    pickup_location_id: '',
    dropoff_location_id: '',
    pickup_phone: '',
    dropoff_phone: '',
    pickup_after: `${defaultDate}T08:00`,
    pickup_before: `${defaultDate}T12:00`,
    dropoff_after: `${defaultDate}T14:00`,
    dropoff_before: `${defaultDate}T18:00`,
    weight: 20000,
    commodity: '',
    is_hazmat: false,
    rate_km: 2.5,
  });

  const submit = async () => {
    const required: (keyof typeof form)[] = ['number', 'pickup_location_id', 'pickup_phone', 'pickup_after', 'pickup_before', 'dropoff_location_id', 'dropoff_phone', 'dropoff_after', 'dropoff_before'];
    for (const f of required) {
      if (!form[f]) { throw new Error(`${f.replace(/_/g, ' ')} is required`); }
    }
    if (new Date(form.pickup_after) >= new Date(form.pickup_before)) { throw new Error('Pickup After must be before Pickup Before'); }
    if (new Date(form.dropoff_after) >= new Date(form.dropoff_before)) { throw new Error('Dropoff After must be before Dropoff Before'); }
    if (new Date(form.pickup_after) >= new Date(form.dropoff_before)) { throw new Error('Pickup must start before Dropoff ends'); }

    const data: OrderFormData = {
      number: form.number,
      pickup_location_id: form.pickup_location_id,
      dropoff_location_id: form.dropoff_location_id,
      pickup_phone: form.pickup_phone,
      dropoff_phone: form.dropoff_phone,
      pickup_after: new Date(form.pickup_after),
      pickup_before: new Date(form.pickup_before),
      dropoff_after: new Date(form.dropoff_after),
      dropoff_before: new Date(form.dropoff_before),
      weight: form.weight,
      commodity: form.commodity,
      is_hazmat: form.is_hazmat,
      rate_km: form.rate_km,
    };

    await createOrder(data);
    onClose();
  };

  return (
    <Modal title="Create Order" onClose={onClose} onSubmit={submit} submitLabel="Create" width={700}>
      <div className="form-grid">
        <div className="form-group"><label>Load Number *</label><input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="LD-001" /></div>
        <div className="form-group"><label>Weight (kg)</label><input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: parseInt(e.target.value) || 0 })} /></div>
        <div className="form-group"><label>Commodity</label><input value={form.commodity} onChange={(e) => setForm({ ...form, commodity: e.target.value })} /></div>
        <div className="form-group"><label>Rate per km ($)</label><input type="number" step="0.01" value={form.rate_km} onChange={(e) => setForm({ ...form, rate_km: parseFloat(e.target.value) || 0 })} /></div>
        <div className="form-group"><label>Hazmat</label>
          <select value={String(form.is_hazmat)} onChange={(e) => setForm({ ...form, is_hazmat: e.target.value === 'true' })}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>
      </div>

      <h3 style={{ fontSize: 13, color: 'var(--text-dim)', margin: '16px 0 8px' }}>Pickup</h3>
      <div className="form-grid">
        <div className="form-group"><label>Pickup Location *</label>
          <LocationPicker value={form.pickup_location_id} onChange={(id) => setForm({ ...form, pickup_location_id: id })} />
        </div>
        <div className="form-group"><label>Pickup Phone *</label><input value={form.pickup_phone} onChange={(e) => setForm({ ...form, pickup_phone: e.target.value })} placeholder="416-555-0100" /></div>
        <div className="form-group"><label>Pickup After *</label><input type="datetime-local" lang="en-GB" value={form.pickup_after} onChange={(e) => setForm({ ...form, pickup_after: e.target.value })} /></div>
        <div className="form-group"><label>Pickup Before *</label><input type="datetime-local" lang="en-GB" value={form.pickup_before} min={form.pickup_after} onChange={(e) => setForm({ ...form, pickup_before: e.target.value })} /></div>
      </div>

      <h3 style={{ fontSize: 13, color: 'var(--text-dim)', margin: '16px 0 8px' }}>Dropoff</h3>
      <div className="form-grid">
        <div className="form-group"><label>Dropoff Location *</label>
          <LocationPicker value={form.dropoff_location_id} onChange={(id) => setForm({ ...form, dropoff_location_id: id })} />
        </div>
        <div className="form-group"><label>Dropoff Phone *</label><input value={form.dropoff_phone} onChange={(e) => setForm({ ...form, dropoff_phone: e.target.value })} placeholder="519-555-0100" /></div>
        <div className="form-group"><label>Dropoff After *</label><input type="datetime-local" lang="en-GB" value={form.dropoff_after} onChange={(e) => setForm({ ...form, dropoff_after: e.target.value })} /></div>
        <div className="form-group"><label>Dropoff Before *</label><input type="datetime-local" lang="en-GB" value={form.dropoff_before} min={form.dropoff_after} onChange={(e) => setForm({ ...form, dropoff_before: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

// ── Dispatch modal ─────────────────────────────────────────

function ActorRadioRow({ el, selected, onSelect }: { el: { type: 'truck' | 'trailer' | 'driver'; id: string }; selected: boolean; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
        background: selected ? 'var(--bg-elevated)' : 'transparent',
        borderRadius: 4, cursor: 'pointer', borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
      }}
    >
      <input type="radio" checked={selected} onChange={onSelect} style={{ width: 'auto', accentColor: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <ElementHeader el={el} />
      </div>
    </div>
  );
}

export function AssignOrderForm({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { trucks, trailers, drivers, orders, assignOrder, setViewTime, locations } = useStore();
  const [truckId, setTruckId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [trailerId, setTrailerId] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  const order = orders.find(o => o.id === orderId);

  // Shift playhead 30min before loading event
  useEffect(() => {
    if (!order) return;
    const loading = order.events.find(e => e.type === 'loading');
    if (loading) {
      const t = new Date(new Date(loading.start_time).getTime() - 30 * 60 * 1000);
      setViewTime(t);
    }
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select: when driver is selected, find a detached truck and empty trailer at the driver's hub
  useEffect(() => {
    if (!driverId) return;
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;
    const hubLocId = driver.home_location_id as string;
    if (!hubLocId) { setWarning('Driver has no home hub'); return; }

    const { actorEvents } = useStore.getState();

    // Check if a truck is detached: find its last attach/detach event
    const isTruckDetached = (truckId: string): boolean => {
      const evs = actorEvents[`truck-${truckId}`];
      if (!evs || evs.length === 0) return true; // no events = never attached = detached
      const attachEvs = evs.filter(e => e.type === 'attach' || e.type === 'detach')
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
      if (attachEvs.length === 0) return true; // no attach/detach events = detached
      return attachEvs[0].type === 'detach';
    };

    // Find empty trailer at same hub
    if (!trailerId) {
      const emptyTrailer = trailers.find(t =>
        t.location_id === hubLocId
      );
      if (emptyTrailer) {
        setTrailerId(emptyTrailer.id as string);
      } else {
        setWarning(`No available trailer found at driver's hub`);
      }
    }

    // Find detached truck at same hub
    if (!truckId) {
      // Prefer detached trucks at the same hub
      const detachedTrucks = trucks.filter(t =>
        t.location_id === hubLocId && isTruckDetached(t.id as string)
      );
      if (detachedTrucks.length > 0) {
        setTruckId(detachedTrucks[0].id as string);
      } else {
        // Fallback: any truck at the hub
        const anyTruck = trucks.find(t => t.location_id === hubLocId);
        if (anyTruck) {
          setTruckId(anyTruck.id as string);
          setWarning(`No detached truck found at hub — selected an attached truck`);
        } else {
          setWarning(`No available truck found at driver's hub`);
        }
      }
    }
  }, [driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!truckId || !driverId || !trailerId) { throw new Error('Please select truck, driver, and trailer'); }
    await assignOrder(orderId, truckId, driverId, trailerId);
    onClose();
  };

  return (
    <Modal title="Assign Order" onClose={onClose} onSubmit={submit} submitLabel="Assign" width={700}>
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {warning && (
          <div style={{ marginBottom: 8, padding: '8px 12px', background: '#4a3a2a', border: '1px solid var(--warning)', borderRadius: 4, color: 'var(--warning)', fontSize: 12 }}>
            {warning}
          </div>
        )}

        <h3 style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0 4px' }}>Select Driver</h3>
        {drivers.map(d => (
          <ActorRadioRow key={d.id as string} el={{ type: 'driver', id: d.id as string }} selected={driverId === d.id} onSelect={() => { setDriverId(d.id as string); setWarning(null); }} />
        ))}

        <h3 style={{ fontSize: 13, color: 'var(--text-dim)', margin: '12px 0 4px' }}>Select Truck</h3>
        {trucks.map(t => (
          <ActorRadioRow key={t.id as string} el={{ type: 'truck', id: t.id as string }} selected={truckId === t.id} onSelect={() => setTruckId(t.id as string)} />
        ))}

        <h3 style={{ fontSize: 13, color: 'var(--text-dim)', margin: '12px 0 4px' }}>Select Trailer</h3>
        {trailers.map(t => (
          <ActorRadioRow key={t.id as string} el={{ type: 'trailer', id: t.id as string }} selected={trailerId === t.id} onSelect={() => setTrailerId(t.id as string)} />
        ))}
      </div>
    </Modal>
  );
}
