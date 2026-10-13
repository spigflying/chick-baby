/** WebSocket：指數退避重連、約 50 分鐘主動重連（不在比賽中）、server.draining 立即重連、時鐘同步。 */
type Handler = (msg: any) => void;
export class Live {
  ws: WebSocket | null = null;
  handlers = new Set<Handler>();
  connectedAt = 0;
  attempt = 0;
  inMatch = false;
  homeId: string | null = null;
  offset = 0; // 伺服器時間 − 本地時間
  rtt = 0;
  private samples: { rtt: number; off: number }[] = [];
  private stopped = false;
  private timer: number | undefined;
  onStatus: (s: 'online' | 'offline' | 'unauthorized') => void = () => {};
  static PROACTIVE_MS = 50 * 60_000;

  start() {
    this.stopped = false; this.open();
    this.timer = window.setInterval(() => {
      if (this.ws?.readyState === 1 && !this.inMatch && Date.now() - this.connectedAt > Live.PROACTIVE_MS) this.reconnect('proactive');
      if (this.inMatch && this.ws?.readyState === 1) this.ping();
    }, 10_000);
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.ws?.close(); }
  on(h: Handler) { this.handlers.add(h); return () => this.handlers.delete(h); }
  send(msg: unknown) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; } return false; }
  serverNow() { return Date.now() + this.offset; }

  joinHome(id: string | null) {
    this.homeId = id;
    if (id) this.send({ type: 'home.join', home_id: id }); else this.send({ type: 'home.leave' });
  }
  reconnect(_why: string) { const w = this.ws; this.ws = null; w?.close(1000, 'reconnect'); this.open(); }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.connectedAt = Date.now(); this.attempt = 0; this.samples = []; };
    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'hello') {
        this.onStatus('online');
        for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 120);
        if (this.homeId) this.send({ type: 'home.join', home_id: this.homeId }); // 重新同步
      } else if (m.type === 'time.pong') this.pong(m);
      else if (m.type === 'server.draining') { setTimeout(() => { if (this.ws === ws) this.reconnect('draining'); }, Math.random() * 500); }
      else if (m.type === 'error' && m.code === 'UNAUTHORIZED') { this.stopped = true; this.onStatus('unauthorized'); }
      for (const h of this.handlers) h(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // 已被主動取代
      this.ws = null; this.onStatus('offline');
      if (this.stopped) return;
      const delay = Math.min(15_000, 500 * 2 ** this.attempt++) * (0.7 + Math.random() * 0.6);
      setTimeout(() => this.open(), delay);
    };
  }
  ping() { this.send({ type: 'time.ping', t0: Date.now() }); }
  private pong(m: any) {
    const now = Date.now(), rtt = now - m.t0, off = m.server_time + rtt / 2 - now;
    this.samples.push({ rtt, off }); if (this.samples.length > 10) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3).map((s) => s.off).sort((a, b) => a - b);
    const target = best[Math.floor(best.length / 2)];
    // 比賽中平滑調整，不跳變
    this.offset = this.inMatch && this.samples.length > 5 ? this.offset + Math.max(-5, Math.min(5, target - this.offset)) : target;
    this.rtt = rtt;
  }
}
