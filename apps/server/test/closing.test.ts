import { afterEach, describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, makeClock, parseOpenHours } from '@chick/engine';
import { setClock } from '../src/hours';
import { startClosingLoop } from '../src/closing';

const tpe = (s: string) => Date.parse(`${s}+08:00`);
afterEach(() => setClock(ALWAYS_OPEN));

describe('closing loop', () => {
  it('fires onClosing once at 19:55 and onClosed once at 20:00', async () => {
    setClock(makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei')));
    let t = tpe('2026-10-12T19:54:00');
    const calls: string[] = [];
    const loop = startClosingLoop({ onClosing: (c) => { calls.push(`closing ${c}`); }, onClosed: (o) => { calls.push(`closed ${o}`); } }, () => t, 3_600_000);
    clearInterval(loop.timer);
    await loop.tick();
    t = tpe('2026-10-12T19:55:00'); await loop.tick(); await loop.tick();
    t = tpe('2026-10-12T20:00:00'); await loop.tick(); await loop.tick();
    expect(calls).toEqual([`closing ${tpe('2026-10-12T20:00:00')}`, `closed ${tpe('2026-10-13T09:00:00')}`]);
  });
  it('never fires when always open', async () => {
    const calls: string[] = [];
    const loop = startClosingLoop({ onClosing: () => { calls.push('closing'); }, onClosed: () => { calls.push('closed'); } }, () => 0, 3_600_000);
    clearInterval(loop.timer);
    await loop.tick();
    expect(calls).toEqual([]);
  });
});
