import pg from 'pg';
import { env } from './env';

/** 跨執行個體廣播：專用長連線 LISTEN（不在連線池內），斷線後以指數退避重連（最長 60 秒）。 */
export class Bus {
  private client: pg.Client | null = null;
  private handlers: ((msg: any) => void)[] = [];
  private stopped = false;
  private restarting = false;
  private attempts = 0;
  constructor(private url = env.databaseUrl) {}
  on(h: (msg: any) => void) { this.handlers.push(h); }
  async start() {
    this.stopped = false;
    if (this.client) return;
    const c = new pg.Client({ connectionString: this.url, connectionTimeoutMillis: 5000 });
    c.on('notification', (n) => { if (n.channel !== 'chick' || !n.payload) return; let m; try { m = JSON.parse(n.payload); } catch { return; } for (const h of this.handlers) h(m); });
    c.on('error', () => this.restart());
    c.on('end', () => this.restart());
    try { await c.connect(); await c.query('LISTEN chick'); }
    catch (e) { c.removeAllListeners(); c.on('error', () => {}); void c.end().catch(() => {}); throw e; }
    this.client = c; this.attempts = 0;
  }
  private restart() {
    if (this.stopped || this.restarting) return; this.restarting = true; this.client = null;
    const delay = Math.min(60_000, 1000 * 2 ** this.attempts++);
    setTimeout(() => { this.restarting = false; if (this.stopped) return; this.start().catch(() => this.restart()); }, delay);
  }
  async publish(msg: unknown) { await this.client?.query('SELECT pg_notify($1, $2)', ['chick', JSON.stringify(msg)]); }
  async stop() { this.stopped = true; const c = this.client; this.client = null; await c?.end().catch(() => {}); }
}
