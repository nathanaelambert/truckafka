import { pool, query, queryOne, pointToWKT, polygonToWKT } from './db.js';
import { hashPassword } from './jwt.js';

// ── Southern Ontario key locations ──────────────────────────────
const LONDON_HUB = { lat: 42.9836, lng: -81.2497 };
const MILTON_HUB = { lat: 43.5183, lng: -79.8807 };
const TORONTO = { lat: 43.6532, lng: -79.3832 };
const BARRIE = { lat: 44.3892, lng: -79.6903 };
const PETERBOROUGH = { lat: 44.3001, lng: -78.3162 };
const NIAGARA_FALLS = { lat: 43.0896, lng: -79.0849 };
const PICKERING = { lat: 43.8553, lng: -79.1321 };

function geofenceAround(center: { lat: number; lng: number }, radiusDeg = 0.01): { lat: number; lng: number }[] {
  const r = radiusDeg;
  return [
    { lat: center.lat - r, lng: center.lng - r },
    { lat: center.lat - r, lng: center.lng + r },
    { lat: center.lat + r, lng: center.lng + r },
    { lat: center.lat + r, lng: center.lng - r },
    { lat: center.lat - r, lng: center.lng - r },
  ];
}

async function seed() {
  console.log('🌱 Seeding database...\n');

  // ── Terminal hub geofences ──────────────────────────────────
  const londonGeofence = await queryOne<{ id: string }>(
    `INSERT INTO geofence (name, boundary) VALUES ($1, $2::geography) RETURNING id`,
    ['London Hub Geofence', polygonToWKT(geofenceAround(LONDON_HUB))]
  );
  const miltonGeofence = await queryOne<{ id: string }>(
    `INSERT INTO geofence (name, boundary) VALUES ($1, $2::geography) RETURNING id`,
    ['Milton Hub Geofence', polygonToWKT(geofenceAround(MILTON_HUB))]
  );

  // ── Locations ───────────────────────────────────────────────
  const locations = [
    { name: 'London Terminal Hub', pos: LONDON_HUB, gf: londonGeofence?.id, address: '100 Exterminator Way, London, ON' },
    { name: 'Milton Terminal Hub', pos: MILTON_HUB, gf: miltonGeofence?.id, address: '200 Steeles Ave, Milton, ON' },
    { name: 'Toronto Distribution Centre', pos: TORONTO, address: '500 Bay St, Toronto, ON' },
    { name: 'Barrie Warehouse', pos: BARRIE, address: '50 Maple Ave, Barrie, ON' },
    { name: 'Peterborough Depot', pos: PETERBOROUGH, address: '300 George St, Peterborough, ON' },
    { name: 'Niagara Falls Logistics', pos: NIAGARA_FALLS, address: '6700 Stanley Ave, Niagara Falls, ON' },
    { name: 'Pickering Distribution', pos: PICKERING, address: '1345 Kingston Rd, Pickering, ON' },
  ];

  const locationIds: Record<string, string> = {};
  for (const loc of locations) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO location (name, position, geofence_id, address)
       VALUES ($1, $2::geography, $3, $4) RETURNING id`,
      [loc.name, pointToWKT(loc.pos.lat, loc.pos.lng), loc.gf ?? null, loc.address]
    );
    if (row) locationIds[loc.name] = row.id;
  }
  console.log(`  ✅ ${Object.keys(locationIds).length} locations`);

  // ── Trucks (fleet of 100, seeding 20 for MVP) ────────────────
  const truckIds: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const hub = i % 2 === 0 ? 'london' : 'milton';
    const locId = hub === 'london' ? locationIds['London Terminal Hub'] : locationIds['Milton Terminal Hub'];
    const row = await queryOne<{ id: string }>(
      `INSERT INTO truck (number, status, is_safe_to_drive, maxweight_kg, location_id, hub)
       VALUES ($1, $2, true, 40000, $3, $4) RETURNING id`,
      [String(i).padStart(4, '0'), 'at_hub', locId, hub]
    );
    if (row) truckIds.push(row.id);
  }
  console.log(`  ✅ ${truckIds.length} trucks`);

  // ── Trailers (300 fleet, seeding 30 for MVP) ─────────────────
  const trailerIds: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const hub = i % 2 === 0 ? 'london' : 'milton';
    const locId = hub === 'london' ? locationIds['London Terminal Hub'] : locationIds['Milton Terminal Hub'];
    const row = await queryOne<{ id: string }>(
      `INSERT INTO trailer (number, status, is_safe_to_drive, maxweight_kg, location_id, hub)
       VALUES ($1, $2, true, 20000, $3, $4) RETURNING id`,
      [String(i).padStart(6, '0'), 'empty', locId, hub]
    );
    if (row) trailerIds.push(row.id);
  }
  console.log(`  ✅ ${trailerIds.length} trailers`);

  // ── Drivers ─────────────────────────────────────────────────
  const driverNames = [
    'James Wilson', 'Sarah Chen', 'Mike Thompson', 'Emily Davis', 'David Kim',
    'Lisa Anderson', 'Robert Brown', 'Jennifer Taylor', 'Chris Martin', 'Amanda Lee',
  ];

  const driverIds: string[] = [];
  for (let i = 0; i < driverNames.length; i++) {
    const hub = i % 2 === 0 ? 'london' : 'milton';
    const homeLocId = hub === 'london' ? locationIds['London Terminal Hub'] : locationIds['Milton Terminal Hub'];
    const row = await queryOne<{ id: string }>(
      `INSERT INTO driver (name, email, status, home_location_id, cycle_id, overtime, day_start_hour)
       VALUES ($1, $2, 'off_duty', $3, 1, 10, '06:00') RETURNING id`,
      [driverNames[i], driverNames[i].toLowerCase().replace(' ', '.') + '@roadstar.ca', homeLocId]
    );
    if (row) {
      driverIds.push(row.id);
      await query(
        `INSERT INTO hours_of_service (driver_id, remaining_cycle_h, remaining_on_duty_h, remaining_drive_h, breaks_remaining, slept_today)
         VALUES ($1, 70, 14, 13, 4, false)`,
        [row.id]
      );
    }
  }
  console.log(`  ✅ ${driverIds.length} drivers`);

  // ── Users ───────────────────────────────────────────────────
  await query(
    `INSERT INTO app_user (user_name, name, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    ['admin', 'System Administrator', hashPassword('admin123')]
  );
  await query(
    `INSERT INTO app_user (user_name, name, password_hash, role)
     VALUES ($1, $2, $3, 'dispatcher')`,
    ['dispatcher', 'Main Dispatcher', hashPassword('dispatch123')]
  );

  // Driver users linked to drivers
  for (let i = 0; i < driverIds.length; i++) {
    await query(
      `INSERT INTO app_user (user_name, name, password_hash, role, driver_id)
       VALUES ($1, $2, $3, 'driver', $4)`,
      [`driver${i + 1}`, driverNames[i], hashPassword('driver123'), driverIds[i]]
    );
  }
  console.log(`  ✅ ${driverIds.length + 2} users (admin, dispatcher, drivers)`);

  // ── Sample loads ────────────────────────────────────────────
  const loadDefs = [
    {
      number: 'LD-001', weight: 25000, commodity: 'Electronics',
      pickup: 'Toronto Distribution Centre', dropoff: 'London Terminal Hub',
      pickup_after: 'tomorrow 08:00', pickup_before: 'tomorrow 12:00',
      dropoff_after: 'tomorrow 14:00', dropoff_before: 'tomorrow 18:00',
    },
    {
      number: 'LD-002', weight: 18000, commodity: 'Furniture',
      pickup: 'Milton Terminal Hub', dropoff: 'Barrie Warehouse',
      pickup_after: 'tomorrow 06:00', pickup_before: 'tomorrow 10:00',
      dropoff_after: 'tomorrow 12:00', dropoff_before: 'tomorrow 16:00',
    },
  ];

  for (const ld of loadDefs) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    await query(
      `INSERT INTO load (number, weight, commodity, pickup_location_id, pickup_phone, pickup_after, pickup_before,
         dropoff_location_id, dropoff_phone, dropoff_after, dropoff_before, detention_rate, rate_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 50, 2.50)`,
      [
        ld.number, ld.weight, ld.commodity,
        locationIds[ld.pickup], '416-555-0100',
        `${dateStr} 08:00:00-04`, `${dateStr} 12:00:00-04`,
        locationIds[ld.dropoff], '519-555-0100',
        `${dateStr} 14:00:00-04`, `${dateStr} 18:00:00-04`,
      ]
    );
  }
  console.log(`  ✅ ${loadDefs.length} sample loads`);

  console.log('\n✅ Seed complete!');
  console.log('\n📋 Login credentials:');
  console.log('   Admin:      admin / admin123');
  console.log('   Dispatcher: dispatcher / dispatch123');
  console.log('   Driver:     driver1 / driver123');
  console.log('\n🛣️  To import real road data, run: pnpm osm:import');

  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
