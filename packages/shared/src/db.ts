import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://truckmafia:truckmafia_dev@localhost:5432/truckmafia',
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// ── Geometry helpers ────────────────────────────────────────────

export function pointToWKT(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

export function polygonToWKT(points: { lat: number; lng: number }[]): string {
  if (points.length < 3) throw new Error('Polygon needs at least 3 points');
  const closed = [...points, points[0]];
  const coords = closed.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `SRID=4326;POLYGON((${coords}))`;
}

export function lineStringToWKT(points: [number, number][]): string {
  if (points.length < 2) throw new Error('LineString needs at least 2 points');
  const coords = points.map(([lat, lng]) => `${lng} ${lat}`).join(', ');
  return `SRID=4326;LINESTRING(${coords})`;
}

export function parseGeoPoint(geo: string | null): { lat: number; lng: number } | null {
  if (!geo) return null;
  const match = geo.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  if (!match) return null;
  return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
}

export function parseGeoLineString(geo: string | null): { lat: number; lng: number }[] {
  if (!geo) return [];
  const match = geo.match(/LINESTRING\((.+)\)/);
  if (!match) return [];
  return match[1].split(',').map((coord) => {
    const [lng, lat] = coord.trim().split(' ').map(parseFloat);
    return { lng, lat };
  });
}

export function parseGeoPolygon(geo: string | null): { lat: number; lng: number }[] {
  if (!geo) return [];
  const match = geo.match(/POLYGON\(\((.+?)\)\)/);
  if (!match) return [];
  return match[1].split(',').slice(0, -1).map((coord) => {
    const [lng, lat] = coord.trim().split(' ').map(parseFloat);
    return { lng, lat };
  });
}

// ── Transaction helper ──────────────────────────────────────────

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { pool as db };
