import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { api } from '../api';
import { useStore } from '../store';
import { LocationEditor, type LatLng } from './LocationEditor';

type AnyRecord = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════
// Hub Picker (selects only is_hub locations, can create new hub)
// ═══════════════════════════════════════════════════════════════

const NEW_HUB_VALUE = '__new__';

function HubPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { locations, refreshLocations } = useStore();
  const [showHubForm, setShowHubForm] = useState(false);
  const hubs = locations.filter(l => l.is_hub as boolean);

  const handleSelect = (val: string) => {
    if (val === NEW_HUB_VALUE) {
      setShowHubForm(true);
    } else {
      onChange(val);
    }
  };

  return (
    <>
      <select value={value} onChange={(e) => handleSelect(e.target.value)}>
        <option value="">Select...</option>
        {hubs.map((l) => <option key={l.id as string} value={l.id as string}>{l.name as string}</option>)}
        <option value={NEW_HUB_VALUE}>+ Create new hub...</option>
      </select>
      {showHubForm && (
        <LocationForm forceHub onClose={async () => {
          setShowHubForm(false);
          await refreshLocations();
          const latest = useStore.getState().locations;
          const newHubs = latest.filter(l => l.is_hub as boolean);
          if (newHubs.length > 0) {
            const newest = newHubs[newHubs.length - 1];
            onChange(newest.id as string);
          }
        }} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Truck Form
// ═══════════════════════════════════════════════════════════════

export function TruckForm({ truck, onClose }: { truck?: AnyRecord; onClose: () => void }) {
  const { refreshTrucks, refreshFleetSummary } = useStore();
  const [form, setForm] = useState({
    number: (truck?.number as string) || '',
    is_safe_to_drive: truck ? (truck.is_safe_to_drive as boolean) : true,
    maxweight_kg: truck ? (truck.maxweight_kg as number) : 40000,
    note: (truck?.note as string) || '',
    location_id: (truck?.location_id as string) || '',
  });

  const submit = async () => {
    if (!form.number) { alert('Number is required'); return; }
    const data: Record<string, unknown> = {
      number: form.number,
      is_safe_to_drive: form.is_safe_to_drive,
      maxweight_kg: form.maxweight_kg,
      note: form.note,
      location_id: form.location_id || null,
      hub: form.location_id || 'london',
    };
    if (truck) {
      await api.updateTruck(truck.id as string, data);
    } else {
      await api.createTruck(data);
    }
    await refreshTrucks();
    await refreshFleetSummary();
    onClose();
  };

  return (
    <Modal title={truck ? `Edit Truck #${truck.number}` : 'Add Truck'} onClose={onClose} onSubmit={submit} submitLabel={truck ? 'Update' : 'Create'}>
      <div className="form-grid">
        <div className="form-group"><label>Number *</label><input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="e.g. 0021" maxLength={4} /></div>
        <div className="form-group"><label>Max Weight (kg)</label><input type="number" value={form.maxweight_kg} onChange={(e) => setForm({ ...form, maxweight_kg: parseInt(e.target.value) || 40000 })} /></div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Home Hub</label>
          <HubPicker value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
        </div>
        <div className="form-group"><label>Safe to Drive</label>
          <select value={String(form.is_safe_to_drive)} onChange={(e) => setForm({ ...form, is_safe_to_drive: e.target.value === 'true' })}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Note</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// Trailer Form
// ═══════════════════════════════════════════════════════════════

export function TrailerForm({ trailer, onClose }: { trailer?: AnyRecord; onClose: () => void }) {
  const { refreshTrailers, refreshFleetSummary } = useStore();
  const [form, setForm] = useState({
    number: (trailer?.number as string) || '',
    is_safe_to_drive: trailer ? (trailer.is_safe_to_drive as boolean) : true,
    maxweight_kg: trailer ? (trailer.maxweight_kg as number) : 20000,
    note: (trailer?.note as string) || '',
    location_id: (trailer?.location_id as string) || '',
  });

  const submit = async () => {
    if (!form.number) { alert('Number is required'); return; }
    const data: Record<string, unknown> = {
      number: form.number,
      is_safe_to_drive: form.is_safe_to_drive,
      maxweight_kg: form.maxweight_kg,
      note: form.note,
      location_id: form.location_id || null,
      hub: form.location_id || 'london',
    };
    if (trailer) {
      await api.updateTrailer(trailer.id as string, data);
    } else {
      await api.createTrailer(data);
    }
    await refreshTrailers();
    await refreshFleetSummary();
    onClose();
  };

  return (
    <Modal title={trailer ? `Edit Trailer #${trailer.number}` : 'Add Trailer'} onClose={onClose} onSubmit={submit} submitLabel={trailer ? 'Update' : 'Create'}>
      <div className="form-grid">
        <div className="form-group"><label>Number *</label><input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="e.g. 000031" maxLength={6} /></div>
        <div className="form-group"><label>Max Weight (kg)</label><input type="number" value={form.maxweight_kg} onChange={(e) => setForm({ ...form, maxweight_kg: parseInt(e.target.value) || 20000 })} /></div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Home Hub</label>
          <HubPicker value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
        </div>
        <div className="form-group"><label>Safe to Drive</label>
          <select value={String(form.is_safe_to_drive)} onChange={(e) => setForm({ ...form, is_safe_to_drive: e.target.value === 'true' })}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Note</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// Driver Form
// ═══════════════════════════════════════════════════════════════

export function DriverForm({ driver, onClose }: { driver?: AnyRecord; onClose: () => void }) {
  const { refreshDrivers, refreshFleetSummary } = useStore();
  const [form, setForm] = useState({
    name: (driver?.name as string) || '',
    email: (driver?.email as string) || '',
    cycle_id: driver ? (driver.cycle_id as number) : 1,
    overtime: driver ? (driver.overtime as number) : 10,
    day_start_hour: (driver?.day_start_hour as string) || '06:00',
    home_location_id: (driver?.home_location_id as string) || '',
  });

  const submit = async () => {
    if (!form.name) { alert('Name is required'); return; }
    const data: Record<string, unknown> = { ...form };
    if (!data.home_location_id) delete data.home_location_id;
    if (driver) {
      await api.updateDriver(driver.id as string, data);
    } else {
      await api.createDriver(data);
    }
    await refreshDrivers();
    await refreshFleetSummary();
    onClose();
  };

  return (
    <Modal title={driver ? `Edit ${driver.name}` : 'Add Driver'} onClose={onClose} onSubmit={submit} submitLabel={driver ? 'Update' : 'Create'}>
      <div className="form-grid">
        <div className="form-group"><label>Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="form-group"><label>Cycle</label>
          <select value={form.cycle_id} onChange={(e) => setForm({ ...form, cycle_id: parseInt(e.target.value) })}>
            <option value={1}>Cycle 1 (70h / 7 days)</option>
            <option value={2}>Cycle 2 (120h / 14 days)</option>
          </select>
        </div>
        <div className="form-group"><label>Overtime (hours)</label><input type="number" value={form.overtime} onChange={(e) => setForm({ ...form, overtime: parseInt(e.target.value) || 10 })} /></div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Home Hub</label>
          <HubPicker value={form.home_location_id} onChange={(id) => setForm({ ...form, home_location_id: id })} />
        </div>
        <div className="form-group"><label>Day Start Hour</label><input type="time" value={form.day_start_hour} onChange={(e) => setForm({ ...form, day_start_hour: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// Location Form
// ═══════════════════════════════════════════════════════════════

export function LocationForm({ location, onClose, forceHub }: { location?: AnyRecord; onClose: () => void; forceHub?: boolean }) {
  const { refreshLocations } = useStore();
  const [name, setName] = useState((location?.name as string) || '');
  const [isHub, setIsHub] = useState(forceHub || (location?.is_hub as boolean) || false);
  const [showEditor, setShowEditor] = useState(false);

  // Stored location data from the editor
  const [locData, setLocData] = useState<{
    position: { lat: number; lng: number };
    address: string;
    geofence: LatLng[];
  } | null>(
    location?.position && (location?.geofence_boundary as LatLng[] | undefined) && (location!.geofence_boundary as LatLng[]).length >= 3
      ? {
          position: location!.position as { lat: number; lng: number },
          address: (location!.address as string) || '',
          geofence: location!.geofence_boundary as LatLng[],
        }
      : null
  );

  const isValid = !!locData && locData.geofence.length >= 3;

  const submit = async () => {
    if (!name) { alert('Name is required'); return; }
    if (!locData || !isValid) { alert('Please set the location using "Update Location"'); return; }

    const data: Record<string, unknown> = {
      name,
      position: locData.position,
      address: locData.address || undefined,
      is_hub: isHub,
      geofence: {
        name: `${name} geofence`,
        boundary: locData.geofence,
      },
    };

    if (location) {
      await api.updateLocation(location.id as string, data);
    } else {
      await api.createLocation(data);
    }
    await refreshLocations();
    onClose();
  };

  return (
    <>
      <Modal title={location ? `Edit ${location.name || 'Location'}` : 'Add Location'} onClose={onClose} onSubmit={submit} submitLabel={location ? 'Update' : 'Create'} width={600}>
        <div className="form-grid">
          <div className="form-group">
            <label>Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Toronto Distribution Centre" />
          </div>
          <div className="form-group">
            <label>Is Hub</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
              <input type="checkbox" checked={isHub} disabled={forceHub} onChange={(e) => setIsHub(e.target.checked)} style={{ width: 'auto', accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{forceHub ? 'Hub (locked)' : isHub ? 'Hub location' : 'Regular location'}</span>
            </div>
          </div>

          {/* Location status */}
          <div className="form-group" style={{ gridColumn: '1 / 3' }}>
            <label>Location & Geofence</label>
            <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
              {isValid ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>✓ Valid location</span>
                    <button className="btn btn-sm" type="button" onClick={() => setShowEditor(true)}>Update Location</button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    <div>📍 {locData!.address || 'No address'}</div>
                    <div>🎯 {locData!.position.lat.toFixed(5)}, {locData!.position.lng.toFixed(5)}</div>
                    <div>⬡ {locData!.geofence.length} vertices</div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 8 }}>⚠ Location not set</p>
                  <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>
                    Set the location by drawing a geofence on the map. The centroid becomes the position, and the address is auto-resolved from OSM.
                  </p>
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowEditor(true)}>📍 Update Location</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {showEditor && (
        <LocationEditor
          locationName={name || 'New Location'}
          initialPosition={locData?.position}
          initialAddress={locData?.address}
          initialGeofence={locData?.geofence}
          onClose={(result) => {
            setShowEditor(false);
            if (result) {
              setLocData(result);
            }
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Load Form
// ═══════════════════════════════════════════════════════════════

function toLocalInput(dt: string | undefined): string {
  if (!dt) return '';
  const d = new Date(dt);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function LoadForm({ load, onClose }: { load?: AnyRecord; onClose: () => void }) {
  const { locations, refreshLoads } = useStore();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const [form, setForm] = useState({
    number: (load?.number as string) || '',
    weight: load ? (load.weight as number) : 20000,
    commodity: (load?.commodity as string) || '',
    pickup_location_id: (load?.pickup_location_id as string) || '',
    dropoff_location_id: (load?.dropoff_location_id as string) || '',
    pickup_phone: (load?.pickup_phone as string) || '',
    dropoff_phone: (load?.dropoff_phone as string) || '',
    pickup_after: load ? toLocalInput(load.pickup_after as string) : `${defaultDate}T08:00`,
    pickup_before: load ? toLocalInput(load.pickup_before as string) : `${defaultDate}T12:00`,
    dropoff_after: load ? toLocalInput(load.dropoff_after as string) : `${defaultDate}T14:00`,
    dropoff_before: load ? toLocalInput(load.dropoff_before as string) : `${defaultDate}T18:00`,
    is_hazmat: load ? (load.is_hazmat as boolean) : false,
    detention_rate: load ? (load.detention_rate as number) : 50,
    rate_km: load ? (load.rate_km as number) : 2.5,
    note: (load?.note as string) || '',
  });

  const submit = async () => {
    const required = ['number', 'pickup_location_id', 'pickup_phone', 'pickup_after', 'pickup_before', 'dropoff_location_id', 'dropoff_phone', 'dropoff_after', 'dropoff_before'];
    for (const f of required) {
      if (!(form as Record<string, unknown>)[f]) { alert(`${f.replace(/_/g, ' ')} is required`); return; }
    }

    if (new Date(form.pickup_after) >= new Date(form.pickup_before)) {
      alert('Pickup After must be before Pickup Before'); return;
    }
    if (new Date(form.dropoff_after) >= new Date(form.dropoff_before)) {
      alert('Dropoff After must be before Dropoff Before'); return;
    }
    if (new Date(form.pickup_before) > new Date(form.dropoff_after)) {
      alert('Pickup must be completed before Dropoff can begin'); return;
    }

    const data: Record<string, unknown> = {
      ...form,
      pickup_after: new Date(form.pickup_after).toISOString(),
      pickup_before: new Date(form.pickup_before).toISOString(),
      dropoff_after: new Date(form.dropoff_after).toISOString(),
      dropoff_before: new Date(form.dropoff_before).toISOString(),
    };

    if (load) {
      await api.updateLoad(load.id as string, data);
    } else {
      await api.createLoad(data);
    }
    await refreshLoads();
    onClose();
  };

  return (
    <Modal title={load ? `Edit Load #${load.number}` : 'Create Load'} onClose={onClose} onSubmit={submit} submitLabel={load ? 'Update' : 'Create'} width={700}>
      <div className="form-grid">
        <div className="form-group"><label>Number *</label><input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="LD-001" /></div>
        <div className="form-group"><label>Weight (kg)</label><input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: parseInt(e.target.value) || 0 })} /></div>
        <div className="form-group"><label>Commodity</label><input value={form.commodity} onChange={(e) => setForm({ ...form, commodity: e.target.value })} /></div>
        <div className="form-group"><label>Rate per km ($)</label><input type="number" step="0.01" value={form.rate_km} onChange={(e) => setForm({ ...form, rate_km: parseFloat(e.target.value) || 0 })} /></div>
        <div className="form-group"><label>Detention Rate ($/h)</label><input type="number" value={form.detention_rate} onChange={(e) => setForm({ ...form, detention_rate: parseInt(e.target.value) || 0 })} /></div>
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
          <select value={form.pickup_location_id} onChange={(e) => setForm({ ...form, pickup_location_id: e.target.value })}>
            <option value="">Select...</option>
            {locations.map((l) => <option key={l.id as string} value={l.id as string}>{l.name as string}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Pickup Phone *</label><input value={form.pickup_phone} onChange={(e) => setForm({ ...form, pickup_phone: e.target.value })} placeholder="416-555-0100" /></div>
        <div className="form-group"><label>Pickup After *</label><input type="datetime-local" value={form.pickup_after} onChange={(e) => setForm({ ...form, pickup_after: e.target.value })} /></div>
        <div className="form-group"><label>Pickup Before *</label><input type="datetime-local" value={form.pickup_before} min={form.pickup_after} onChange={(e) => setForm({ ...form, pickup_before: e.target.value })} /></div>
      </div>

      <h3 style={{ fontSize: 13, color: 'var(--text-dim)', margin: '16px 0 8px' }}>Dropoff</h3>
      <div className="form-grid">
        <div className="form-group"><label>Dropoff Location *</label>
          <select value={form.dropoff_location_id} onChange={(e) => setForm({ ...form, dropoff_location_id: e.target.value })}>
            <option value="">Select...</option>
            {locations.map((l) => <option key={l.id as string} value={l.id as string}>{l.name as string}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Dropoff Phone *</label><input value={form.dropoff_phone} onChange={(e) => setForm({ ...form, dropoff_phone: e.target.value })} placeholder="519-555-0100" /></div>
        <div className="form-group"><label>Dropoff After *</label><input type="datetime-local" value={form.dropoff_after} min={form.pickup_before} onChange={(e) => setForm({ ...form, dropoff_after: e.target.value })} /></div>
        <div className="form-group"><label>Dropoff Before *</label><input type="datetime-local" value={form.dropoff_before} min={form.dropoff_after} onChange={(e) => setForm({ ...form, dropoff_before: e.target.value })} /></div>
      </div>

      <div className="form-group" style={{ marginTop: 12 }}><label>Note</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// Haul Form
// ═══════════════════════════════════════════════════════════════

export function HaulForm({ haul, onClose, isDraft = false }: { haul?: AnyRecord; onClose: () => void; isDraft?: boolean }) {
  const { loads, trucks, trailers, drivers, refreshHauls } = useStore();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const [form, setForm] = useState({
    load_id: (haul?.load_id as string) || '',
    driver_id: (haul?.driver_id as string) || '',
    truck_id: (haul?.truck_id as string) || '',
    trailer_id: (haul?.trailer_id as string) || '',
    started_at: haul ? toLocalInput(haul.started_at as string) : `${defaultDate}T08:00`,
    ended_at: haul ? toLocalInput(haul.ended_at as string) : `${defaultDate}T18:00`,
    is_draft: haul ? (haul.is_draft as boolean) : isDraft,
    is_active: haul ? (haul.is_active as boolean) : false,
  });

  const submit = async () => {
    const required = ['load_id', 'driver_id', 'truck_id', 'trailer_id', 'started_at', 'ended_at'];
    for (const f of required) {
      if (!(form as Record<string, unknown>)[f]) { alert(`${f.replace(/_/g, ' ')} is required`); return; }
    }

    const data: Record<string, unknown> = {
      ...form,
      started_at: new Date(form.started_at).toISOString(),
      ended_at: new Date(form.ended_at).toISOString(),
    };

    if (haul) {
      await api.updateHaul(haul.id as string, data);
    } else {
      await api.createHaul(data);
    }
    await refreshHauls();
    onClose();
  };

  return (
    <Modal title={haul ? 'Edit Haul' : isDraft ? 'Create Draft Haul' : 'Create Haul'} onClose={onClose} onSubmit={submit} submitLabel={haul ? 'Update' : 'Create'} width={600}>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Load *</label>
          <select value={form.load_id} onChange={(e) => setForm({ ...form, load_id: e.target.value })}>
            <option value="">Select a load...</option>
            {loads.map((l) => <option key={l.id as string} value={l.id as string}>{l.number as string} — {l.pickup_location_name as string} → {l.dropoff_location_name as string}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Driver *</label>
          <select value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
            <option value="">Select a driver...</option>
            {drivers.map((d) => <option key={d.id as string} value={d.id as string}>{d.name as string}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Truck *</label>
          <select value={form.truck_id} onChange={(e) => setForm({ ...form, truck_id: e.target.value })}>
            <option value="">Select a truck...</option>
            {trucks.map((t) => <option key={t.id as string} value={t.id as string}>#{t.number as string} ({t.hub as string})</option>)}
          </select>
        </div>
        <div className="form-group"><label>Trailer *</label>
          <select value={form.trailer_id} onChange={(e) => setForm({ ...form, trailer_id: e.target.value })}>
            <option value="">Select a trailer...</option>
            {trailers.map((t) => <option key={t.id as string} value={t.id as string}>#{t.number as string}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Start Time *</label><input type="datetime-local" value={form.started_at} onChange={(e) => setForm({ ...form, started_at: e.target.value })} /></div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>End Time *</label><input type="datetime-local" value={form.ended_at} onChange={(e) => setForm({ ...form, ended_at: e.target.value })} /></div>
        {isDraft && (
          <div className="form-group" style={{ gridColumn: '1 / 3' }}>
            <label>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} style={{ width: 'auto', marginRight: 6 }} />
              Active draft (include in monitor & itinerary calculations)
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// Road Event Form
// ═══════════════════════════════════════════════════════════════

export function RoadEventForm({ onClose }: { onClose: () => void }) {
  const { refreshHauls } = useStore();
  const [roadSegments, setRoadSegments] = useState<AnyRecord[]>([]);
  const [form, setForm] = useState({
    road_segment_id: '',
    event_type: 'traffic_jam',
    maxspeed_km: '',
    maxweight_kg: '',
    note: '',
    start_at: new Date().toISOString().slice(0, 16),
    end_at: '',
  });

  useEffect(() => {
    api.getRoadSegments('-81.5,42.8,-78.2,45.0').then((data) => setRoadSegments(data as AnyRecord[])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.road_segment_id) { alert('Road segment is required'); return; }
    const data: Record<string, unknown> = {
      road_segment_id: form.road_segment_id,
      event_type: form.event_type,
      note: form.note || undefined,
      start_at: new Date(form.start_at).toISOString(),
      end_at: form.end_at ? new Date(form.end_at).toISOString() : undefined,
    };
    if (form.maxspeed_km) data.maxspeed_km = parseInt(form.maxspeed_km);
    if (form.maxweight_kg) data.maxweight_kg = parseInt(form.maxweight_kg);

    await api.createRoadEvent(data);
    await refreshHauls();
    onClose();
  };

  return (
    <Modal title="Create Road Event" onClose={onClose} onSubmit={submit} submitLabel="Create" width={600}>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Road Segment *</label>
          <select value={form.road_segment_id} onChange={(e) => setForm({ ...form, road_segment_id: e.target.value })}>
            <option value="">Select a road segment...</option>
            {roadSegments.slice(0, 200).map((s) => <option key={s.id as string} value={s.id as string}>{(s.name as string) || 'Unnamed'} ({(s.highway_type as string) || 'road'}, {s.length_m as number}m, {s.maxspeed_km as number}km/h)</option>)}
          </select>
        </div>
        <div className="form-group"><label>Event Type</label>
          <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
            <option value="traffic_jam">Traffic Jam</option>
            <option value="construction">Construction</option>
            <option value="accident">Accident</option>
            <option value="weather">Weather</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group"><label>Speed Limit Override (km/h)</label><input type="number" value={form.maxspeed_km} onChange={(e) => setForm({ ...form, maxspeed_km: e.target.value })} placeholder="Leave blank for no change" /></div>
        <div className="form-group"><label>Weight Limit Override (kg)</label><input type="number" value={form.maxweight_kg} onChange={(e) => setForm({ ...form, maxweight_kg: e.target.value })} placeholder="Leave blank for no change" /></div>
        <div className="form-group"><label>Start *</label><input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} /></div>
        <div className="form-group"><label>End</label><input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} placeholder="Leave blank for ongoing" /></div>
        <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Note</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════
// User Form
// ═══════════════════════════════════════════════════════════════

export function UserForm({ onClose }: { onClose: () => void }) {
  const { drivers, refreshTrucks } = useStore();
  const [users, setUsers] = useState<AnyRecord[]>([]);
  const [form, setForm] = useState({ user_name: '', name: '', password: '', role: 'dispatcher', driver_id: '' });

  const refreshUsers = async () => setUsers(await api.getUsers() as AnyRecord[]);

  useEffect(() => {
    refreshUsers();
  }, []);

  const submit = async () => {
    if (!form.user_name || !form.password) { alert('Username and password required'); return; }
    const data: Record<string, unknown> = { ...form };
    if (!data.driver_id) delete data.driver_id;
    await api.createUser(data);
    setForm({ user_name: '', name: '', password: '', role: 'dispatcher', driver_id: '' });
    await refreshUsers();
  };

  return (
    <Modal title="Manage Users" onClose={onClose} width={700}>
      <div className="form-grid">
        <div className="form-group"><label>Username *</label><input value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} /></div>
        <div className="form-group"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="form-group"><label>Password *</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div className="form-group"><label>Role</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="admin">Admin</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="driver">Driver</option>
          </select>
        </div>
        {form.role === 'driver' && (
          <div className="form-group" style={{ gridColumn: '1 / 3' }}><label>Link to Driver</label>
            <select value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
              <option value="">Select driver...</option>
              {drivers.map((d) => <option key={d.id as string} value={d.id as string}>{d.name as string}</option>)}
            </select>
          </div>
        )}
        <div style={{ gridColumn: '1 / 3' }}><button className="btn btn-primary" onClick={submit}>Create User</button></div>
      </div>

      <table style={{ marginTop: 16 }}>
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id as string}>
              <td>{u.user_name as string}</td>
              <td>{u.name as string}</td>
              <td>{u.role as string}</td>
              <td><button className="btn btn-sm btn-danger" onClick={async () => { await api.deleteUser(u.id as string); await refreshUsers(); }}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
