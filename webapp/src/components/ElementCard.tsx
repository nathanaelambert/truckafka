import { useState } from 'react';
import { useStore, type SelectedElement } from '../store';
import { ElementHeader, RefHeader } from './ElementHeader';
import { TruckForm, TrailerForm, DriverForm, LoadForm, LocationForm } from './Forms';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value" title={typeof value === 'string' ? value : undefined}>{value}</span>
    </div>
  );
}

function ElementContent({ el }: { el: SelectedElement }) {
  const { trucks, trailers, drivers, loads, locations } = useStore();

  const fmtDate = (s: string) => new Date(s).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  if (el.type === 'truck') {
    const truck = trucks.find((t) => t.id === el.id);
    if (!truck) return <div style={{ color: 'var(--danger)' }}>Truck not found</div>;
    return (
      <>
        <InfoRow label="Safe to Drive" value={(truck.is_safe_to_drive as boolean) ? 'Yes' : 'No'} />
        <InfoRow label="Max Weight" value={`${truck.maxweight_kg} kg`} />
        <InfoRow label="Home Hub" value={truck.location_id ? <RefHeader el={{ type: 'location', id: truck.location_id as string }} /> : 'N/A'} />
        {truck.note ? <InfoRow label="Note" value={truck.note as string} /> : null}
      </>
    );
  }

  if (el.type === 'driver') {
    const driver = drivers.find((d) => d.id === el.id);
    if (!driver) return <div style={{ color: 'var(--danger)' }}>Driver not found</div>;
    return (
      <>
        <InfoRow label="Email" value={driver.email as string || 'N/A'} />
        <InfoRow label="Home Hub" value={driver.home_location_id ? <RefHeader el={{ type: 'location', id: driver.home_location_id as string }} /> : 'N/A'} />
        <InfoRow label="Cycle" value={`Cycle ${driver.cycle_id}`} />
        <InfoRow label="Overtime" value={`${driver.overtime}h`} />
        <InfoRow label="Day Start" value={driver.day_start_hour as string} />
        <InfoRow label="Remaining Drive" value={`${driver.remaining_drive_h}h`} />
        <InfoRow label="Remaining On-Duty" value={`${driver.remaining_on_duty_h}h`} />
        <InfoRow label="Remaining Cycle" value={`${driver.remaining_cycle_h}h`} />
        {driver.next_bed_time ? <InfoRow label="Next Bed Time" value={fmtDate(driver.next_bed_time as string)} /> : null}
      </>
    );
  }

  if (el.type === 'load') {
    const load = loads.find((l) => l.id === el.id);
    if (!load) return <div style={{ color: 'var(--danger)' }}>Load not found</div>;
    return (
      <>
        <InfoRow label="Weight" value={`${load.weight} kg`} />
        <InfoRow label="Commodity" value={load.commodity as string || 'N/A'} />
        <InfoRow label="Pickup" value={<RefHeader el={{ type: 'location', id: load.pickup_location_id as string }} />} />
        <InfoRow label="Dropoff" value={<RefHeader el={{ type: 'location', id: load.dropoff_location_id as string }} />} />
        <InfoRow label="Pickup After" value={fmtDate(load.pickup_after as string)} />
        <InfoRow label="Pickup Before" value={fmtDate(load.pickup_before as string)} />
        <InfoRow label="Dropoff After" value={fmtDate(load.dropoff_after as string)} />
        <InfoRow label="Dropoff Before" value={fmtDate(load.dropoff_before as string)} />
        <InfoRow label="Hazmat" value={(load.is_hazmat as boolean) ? 'Yes' : 'No'} />
        <InfoRow label="Rate/km" value={`$${load.rate_km || 0}`} />
      </>
    );
  }

  if (el.type === 'location') {
    const loc = locations.find((l) => l.id === el.id);
    if (!loc) return <div style={{ color: 'var(--danger)' }}>Location not found</div>;
    const pos = loc.position as { lat: number; lng: number } | null | undefined;
    const hasPosition = pos && typeof pos.lat === 'number' && typeof pos.lng === 'number';
    const hasGeofence = !!(loc.geofence_boundary as unknown[] | undefined)?.length && (loc.geofence_boundary as unknown[]).length >= 3;
    const isValid = hasPosition && hasGeofence;
    return (
      <>
        {!isValid && (
          <div style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
            <p style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 8 }}>⚠ Invalid location — missing position or geofence</p>
          </div>
        )}
        <InfoRow label="Name" value={loc.name as string} />
        <InfoRow label="Is Hub" value={(loc.is_hub as boolean) ? 'Yes' : 'No'} />
        <InfoRow label="Address" value={(loc.address as string) || 'N/A'} />
        <InfoRow label="Geofence" value={hasGeofence ? `${(loc.geofence_boundary as unknown[]).length} vertices` : 'None'} />
      </>
    );
  }

  if (el.type === 'trailer') {
    const trailer = trailers.find((t) => t.id === el.id);
    if (!trailer) return <div style={{ color: 'var(--danger)' }}>Trailer not found</div>;
    return (
      <>
        <InfoRow label="Safe to Drive" value={(trailer.is_safe_to_drive as boolean) ? 'Yes' : 'No'} />
        <InfoRow label="Max Weight" value={`${trailer.maxweight_kg} kg`} />
        <InfoRow label="Home Hub" value={trailer.location_id ? <RefHeader el={{ type: 'location', id: trailer.location_id as string }} /> : 'N/A'} />
        {trailer.note ? <InfoRow label="Note" value={trailer.note as string} /> : null}
      </>
    );
  }

  if (el.type === 'road_segment') {
    return <InfoRow label="Type" value="Road Segment" />;
  }

  return null;
}

function getEditForm(el: SelectedElement, onClose: () => void) {
  const { trucks, trailers, drivers, loads, locations } = useStore.getState();
  const item =
    el.type === 'truck' ? trucks.find((t) => t.id === el.id) :
    el.type === 'trailer' ? trailers.find((t) => t.id === el.id) :
    el.type === 'driver' ? drivers.find((d) => d.id === el.id) :
    el.type === 'load' ? loads.find((l) => l.id === el.id) :
    el.type === 'location' ? locations.find((l) => l.id === el.id) :
    null;
  if (!item) return null;
  if (el.type === 'truck') return <TruckForm truck={item} onClose={onClose} />;
  if (el.type === 'trailer') return <TrailerForm trailer={item} onClose={onClose} />;
  if (el.type === 'driver') return <DriverForm driver={item} onClose={onClose} />;
  if (el.type === 'load') return <LoadForm load={item} onClose={onClose} />;
  if (el.type === 'location') return <LocationForm location={item} onClose={onClose} />;
  return null;
}

export function ElementCard({ el, defaultExpanded, draggable, onDragStart, onDragEnd, showEdit }: {
  el: SelectedElement;
  defaultExpanded?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  showEdit?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const [editing, setEditing] = useState(false);

  if (editing && showEdit) {
    const form = getEditForm(el, () => setEditing(false));
    if (form) return form;
  }

  const cardStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 8,
    border: '1px solid var(--bg-elevated)',
    background: 'var(--bg)',
    cursor: draggable ? 'grab' : 'default',
    position: 'relative',
    overflow: 'hidden',
  };

  return (
    <div
      style={cardStyle}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <ElementHeader
        el={el}
        onEdit={showEdit ? () => setEditing(true) : undefined}
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
      />
      {expanded && (
        <div style={{ marginTop: 8 }}>
          <ElementContent el={el} />
        </div>
      )}
    </div>
  );
}
