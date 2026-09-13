import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, 'sql');

async function migrate() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    console.log('⚠️  Dropping all tables...');
    const tables = [
      'road_segment_traversal', 'road_event', 'haul', 'load',
      'app_user', 'hours_of_service', 'driver', 'trailer', 'truck',
      'road_segment', 'road_node', 'location', 'geofence',
      'position_log', 'driver_status_log',
    ];
    for (const t of tables) {
      await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    await pool.query('DROP TYPE IF EXISTS user_role CASCADE');
    await pool.query('DROP TYPE IF EXISTS truck_status CASCADE');
    await pool.query('DROP TYPE IF EXISTS trailer_status CASCADE');
    await pool.query('DROP TYPE IF EXISTS haul_status CASCADE');
    await pool.query('DROP TYPE IF EXISTS driver_status CASCADE');
    await pool.query('DROP TYPE IF EXISTS road_event_type CASCADE');
    await pool.query('DROP FUNCTION IF EXISTS update_updated_at() CASCADE');
    console.log('✅ Dropped all tables');
  }

  const files = readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`📄 Running ${file}...`);
    const sql = readFileSync(join(SQL_DIR, file), 'utf-8');
    await pool.query(sql);
    console.log(`  ✅ ${file} done`);
  }

  console.log('\n✅ Migration complete!');
  await pool.end();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
