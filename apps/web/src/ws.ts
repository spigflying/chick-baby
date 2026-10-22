/** WebSocket：指數退避重連、約 50 分鐘主動重連（不在比賽中）、server.draining 立即重連、時鐘同步。 */
type Handler = (msg: any) => void;
export class Live {
  ws: WebSocket | null = null;
  handlers = new Set<Handler>();
  connectedAt = 0;
  attempt = 0;
  inMatch = false;
  /** v1.6：打架中／邀請中／結算畫面 → 算活躍（不暫停、不主動重連）。 */
  inFight = false;
  /** M2：自己發起或已參加一起下樓梯、等開始中 → 也算活躍。 */
  inLobby = false;
  /** v27 賽車房：目前所在的房間（伺服器最新狀態＋收到的本地時間）；在房裡也算活躍（不暫停、不主動重連） */
  room: any = null;
  /** v27：下樓梯房開始時寵物頁可能還沒掛上，留著最近一次房間比賽的 match.started 讓 Device 補收。 */
  roomMatch: { m: any; at: number } | null = null;
  get busy() { return this.inMatch || this.inFight || this.inLobby || !!this.room; }
  homeId: string | null = null;
  offset = 0; // 伺服器時間 − 本地時間
  rtt = 0;
  private samples: { rtt: number; off: number }[] = [];
  private stopped = false;
  private timer: number | undefined;
  onStatus: (s: 'online' | 'offline' | 'unauthorized' | 'paused' | 'closed', info?: { opens_at: number | null }) => void = () => {};
  private paused = false;
  static PROACTIVE_MS = 50 * 60_000;

  start() {
    this.stopped = false; this.open();
    this.timer = window.setInterval(() => {
      if (this.ws?.readyState === 1 && !this.busy && Date.now() - this.connectedAt > Live.PROACTIVE_MS) this.reconnect('proactive');
      if (this.busy && this.ws?.readyState === 1) this.ping();
    }, 10_000);
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.ws?.close(); }
  get isPaused() { return this.paused; }
  /** 閒置或分頁隱藏：關閉連線且不自動重連，直到 resume()。比賽中不暫停。 */
  pause() {
    if (this.paused || this.stopped || this.busy) return;
    this.paused = true; const w = this.ws; this.ws = null; w?.close(1000, 'idle');
    this.onStatus('paused');
  }
  /** 回到分頁或有操作：重新連線；hello 之後會重新 home.join 同步狀態。 */
  resume() { if (!this.paused || this.stopped) return; this.paused = false; this.open(); }
  on(h: Handler) { this.handlers.add(h); return () => this.handlers.delete(h); }
  send(msg: unknown) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; } return false; }
  serverNow() { return Date.now() + this.offset; }

  joinHome(id: string | null) {
    this.homeId = id;
    if (id) this.send({ type: 'home.join', home_id: id }); else this.send({ type: 'home.leave' });
  }
  reconnect(_why: string) { const w = this.ws; this.ws = null; w?.close(1000, 'reconnect'); this.open(); }

  private open() {
    if (this.stopped || this.paused) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.connectedAt = Date.now(); this.attempt = 0; this.samples = []; };
    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'hello') {
        this.onStatus('online');
        for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 120);
        if (this.homeId) this.send({ type: 'home.join', home_id: this.homeId }); // 重新同步
        if (this.room) this.send({ type: 'room.join', room: this.room.id, inst: this.room.inst }); // v27：斷線 30 秒內回到房間
      } else if (m.type === 'time.pong') this.pong(m);
      else if (m.type === 'room.state') this.room = { ...m.room, at: Date.now() };
      else if (m.type === 'match.started' && String(m.home_id ?? '').startsWith('room:')) this.roomMatch = { m, at: Date.now() };
      else if (m.type === 'room.gone') { if (!this.room || this.room.id === m.room) this.room = null; }
      else if (m.type === 'server.draining') { setTimeout(() => { if (this.ws === ws) this.reconnect('draining'); }, Math.random() * 500); }
      else if (m.type === 'error' && m.code === 'UNAUTHORIZED') { this.stopped = true; this.onStatus('unauthorized'); }
      else if (m.type === 'game.closed' || (m.type === 'error' && m.code === 'GAME_CLOSED')) { this.stopped = true; this.onStatus('closed', { opens_at: m.opens_at ?? null }); } // 休息時段：不自動重連
      for (const h of this.handlers) h(m);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return; // 已被主動取代
      this.ws = null;
      // 4423 = 伺服器關門（休息時段）：就算沒收到 game.closed 也不自動重連
      if (ev?.code === 4423 && !this.stopped) { this.stopped = true; this.onStatus('closed', { opens_at: null }); return; }
      if (this.stopped) return; // 已經是 closed / unauthorized，不要再蓋成 offline
      this.onStatus('offline');
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
