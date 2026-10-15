import { describe, expect, it } from 'vitest';
import { IDLE, shouldPause } from '../src/idle';

describe('shouldPause', () => {
  const base = { hiddenSince: null, lastActivity: 0, inMatch: false };
  it('pauses after the tab is hidden for 2 minutes', () => {
    expect(shouldPause({ ...base, hiddenSince: 0 }, IDLE.hiddenMs - 1)).toBe(false);
    expect(shouldPause({ ...base, hiddenSince: 0 }, IDLE.hiddenMs)).toBe(true);
  });
  it('pauses after 10 minutes without activity even when visible', () => {
    expect(shouldPause(base, IDLE.idleMs - 1)).toBe(false);
    expect(shouldPause(base, IDLE.idleMs)).toBe(true);
  });
  it('never pauses during a match', () => {
    expect(shouldPause({ hiddenSince: 0, lastActivity: 0, inMatch: true }, 10 * IDLE.idleMs)).toBe(false);
  });
});

describe('watchIdle', () => {
  it('listens for activity in the capture phase, so controls that stopPropagation (fight pad, top bar) still count and resume a paused connection', async () => {
    const calls: { type: string; opts: unknown }[] = [];
    const target = () => ({ addEventListener: (type: string, _f: unknown, opts?: unknown) => calls.push({ type, opts }), removeEventListener: () => {} });
    const g = globalThis as any;
    const saved = { window: g.window, document: g.document };
    g.window = { ...target(), setInterval: () => 0, clearInterval: () => {} };
    g.document = { ...target(), hidden: false };
    try {
      const { watchIdle } = await import('../src/idle');
      watchIdle({ isPaused: false, inMatch: false, pause() {}, resume() {} } as any)();
    } finally { g.window = saved.window; g.document = saved.document; }
    const activity = calls.filter((c) => c.type !== 'visibilitychange');
    expect(activity.map((c) => c.type).sort()).toEqual(['keydown', 'pointerdown', 'touchstart']);
    for (const c of activity) expect(c.opts).toMatchObject({ capture: true });
  });
  it('v1.6: an active fight / invite / result screen (live.inFight) counts as active — never paused while idle', async () => {
    let tick: () => void = () => {}; let paused = 0;
    const g = globalThis as any; const saved = { window: g.window, document: g.document };
    const t = { addEventListener() {}, removeEventListener() {} };
    g.window = { ...t, setInterval: (f: () => void) => { tick = f; return 1; }, clearInterval() {} };
    g.document = { ...t, hidden: true };
    const realNow = Date.now;
    try {
      const { watchIdle } = await import('../src/idle');
      const live = { isPaused: false, inMatch: false, inFight: true, pause() { paused++; }, resume() {} } as any;
      const off = watchIdle(live, { hiddenMs: 0, idleMs: 0 });
      Date.now = () => realNow() + 60 * 60_000;
      tick(); expect(paused).toBe(0);
      live.inFight = false; tick(); expect(paused).toBe(1);
      off();
    } finally { Date.now = realNow; g.window = saved.window; g.document = saved.document; }
  });
});
