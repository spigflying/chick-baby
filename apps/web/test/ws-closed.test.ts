import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Live } from '../src/ws';

/** 假的 WebSocket：記錄建立了幾條連線，讓測試觸發 message / close。 */
class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0; onopen: any; onmessage: any; onclose: any;
  constructor(public url: string) { FakeWS.all.push(this); }
  send() {}
  close() { this.readyState = 3; }
  serverOpen() { this.readyState = 1; this.onopen?.({}); }
  serverMsg(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

beforeEach(() => {
  FakeWS.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('window', { setInterval, clearInterval });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Live after 20:00', () => {
  it('does not reconnect after a 4423 close even if game.closed never arrived', () => {
    const live = new Live(); const st: string[] = [];
    live.onStatus = (s) => st.push(s);
    live.start(); FakeWS.all[0].serverOpen();
    FakeWS.all[0].serverClose(4423);
    vi.advanceTimersByTime(120_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(st).toContain('closed');
    live.stop();
  });
  it('does not reconnect after game.closed + 4423, and status stays "closed"', () => {
    const live = new Live(); const st: string[] = [];
    live.onStatus = (s) => st.push(s);
    live.start(); FakeWS.all[0].serverOpen();
    FakeWS.all[0].serverMsg({ type: 'game.closed', opens_at: 1 });
    FakeWS.all[0].serverClose(4423);
    vi.advanceTimersByTime(120_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(st.at(-1)).toBe('closed');
    live.stop();
  });
  it('still reconnects after an ordinary disconnect', () => {
    const live = new Live();
    live.start(); FakeWS.all[0].serverOpen();
    FakeWS.all[0].serverClose(1006);
    vi.advanceTimersByTime(20_000);
    expect(FakeWS.all.length).toBeGreaterThan(1);
    live.stop();
  });
});
