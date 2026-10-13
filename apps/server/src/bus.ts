import pg from 'pg';
import { env } from './env';

/** 跨執行個體廣播：專用長連線 LISTEN（不在連線池內），斷線自動重連。 */
export class Bus {
  private client: pg.Client | null = null;
  private handlers: ((msg: any) => void)[] = [];
  private stopped = false;
  constructor(private url = env.databaseUrl) {}
  on(h: (msg: any) => void) { this.handlers.push(h); }
  async start() {
    if (this.stopped) return;
    const c = new pg.Client({ connectionString: this.url });
    c.on('notification', (n) => { if (n.channel !== 'chick' || !n.payload) return; let m; try { m = JSON.parse(n.payload); } catch { return; } for (const h of this.handlers) h(m); });
    c.on('error', () => this.restart());
    c.on('end', () => this.restart());
    await c.connect(); await c.query('LISTEN chick'); this.client = c;
  }
  private restarting = false;
  private restart() {
    if (this.stopped || this.restarting) return; this.restarting = true; this.client = null;
    setTimeout(() => { this.restarting = false; this.start().catch(() => this.restart()); }, 1000);
  }
  async publish(msg: unknown) { await this.client?.query('SELECT pg_notify($1, $2)', ['chick', JSON.stringify(msg)]); }
  async stop() { this.stopped = true; await this.client?.end().catch(() => {}); }
}
