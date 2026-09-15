import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import type { InfraSample } from './types.js';

const execAsync = promisify(exec);
const { Pool } = pg;

export class InfraMonitor {
  private pool: pg.Pool;
  private samples: InfraSample[] = [];
  private timer: NodeJS.Timeout | null = null;
  private loadServiceContainer: string;
  private dbContainer: string;
  private polling = false;

  constructor(databaseUrl: string, loadServiceContainer: string, dbContainer: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 2 });
    this.loadServiceContainer = loadServiceContainer;
    this.dbContainer = dbContainer;
  }

  start(): void {
    this.samples = [];
    this.timer = setInterval(() => this.poll(), 1000);
  }

  stop(): InfraSample[] {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return [...this.samples];
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const timestamp = Date.now();

    let loadServiceCpuPct = 0, loadServiceMemMB = 0;
    let dbCpuPct = 0, dbMemMB = 0;

    try {
      const { stdout } = await execAsync(
        `docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}" ${this.loadServiceContainer} ${this.dbContainer} 2>/dev/null`,
        { timeout: 8000, encoding: 'utf-8' }
      );
      for (const line of stdout.trim().split('\n')) {
        const [name, cpuStr, memStr] = line.split('|');
        if (!name) continue;
        const cpu = parseFloat(cpuStr?.replace('%', '').trim() || '0');
        const memMatch = memStr?.match(/([\d.]+)(MiB|GiB)/);
        let memMB = 0;
        if (memMatch) {
          memMB = memMatch[2] === 'GiB' ? parseFloat(memMatch[1]) * 1024 : parseFloat(memMatch[1]);
        }
        if (name.includes('load-service')) {
          loadServiceCpuPct = cpu;
          loadServiceMemMB = memMB;
        } else if (name.includes('-db-')) {
          dbCpuPct = cpu;
          dbMemMB = memMB;
        }
      }
    } catch {
      // docker stats may fail if containers are not running
    }

    let pgActive = 0, pgTotal = 0, pgLatency = 0;
    try {
      const r1 = await this.pool.query('SELECT count(*) AS c FROM pg_stat_activity WHERE state = $1', ['active']);
      pgActive = parseInt(r1.rows[0]?.c || '0');
    } catch { /* ignore */ }
    try {
      const r2 = await this.pool.query('SELECT count(*) AS c FROM pg_stat_activity');
      pgTotal = parseInt(r2.rows[0]?.c || '0');
    } catch { /* ignore */ }
    try {
      const t0 = Date.now();
      await this.pool.query('SELECT 1');
      pgLatency = Date.now() - t0;
    } catch { /* ignore */ }

    this.samples.push({
      timestamp,
      loadServiceCpuPct,
      loadServiceMemMB,
      dbCpuPct,
      dbMemMB,
      pgActiveConnections: pgActive,
      pgTotalConnections: pgTotal,
      pgQueryLatencyMs: pgLatency,
    });

    this.polling = false;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool.end();
  }
}
