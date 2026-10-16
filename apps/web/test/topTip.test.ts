import { describe, expect, it } from 'vitest';
import { TopTip, tipText, TIP_HIDE_MS, TOP_TIP_LABEL } from '../src/topTip';

function fakeTimers() {
  let now = 0, id = 0; const q = new Map<number, { at: number; f: () => void }>();
  return {
    set: (f: () => void, ms: number) => { q.set(++id, { at: now + ms, f }); return id; },
    clear: (i: number) => { q.delete(i); },
    advance(ms: number) { now += ms; for (const [i, t] of [...q]) if (t.at <= now) { q.delete(i); t.f(); } },
    size: () => q.size,
  };
}

describe('tipText', () => {
  it('shows Chinese stat name and value', () => {
    expect(tipText('coins', '◎72')).toBe('金幣 72');
    expect(tipText('name', '小黃')).toBe('名字 小黃');
    expect(tipText('stage', '雞')).toBe('階段 雞');
    expect(tipText('age', '5分')).toBe('年齡 5分');
    expect(tipText('age', '30秒', true)).toBe('孵化倒數 30秒');
    expect(tipText('age', '—')).toBe('年齡');
  });
  it('has a label for every top-row item', () => {
    expect(Object.keys(TOP_TIP_LABEL).sort()).toEqual(['age', 'coins', 'evo', 'name', 'stage']);
  });
});

describe('TopTip', () => {
  it('hover shows, leave hides', () => {
    const tm = fakeTimers(); const seen: any[] = []; const t = new TopTip((k) => seen.push(k), tm);
    t.hover('coins'); expect(t.shown).toBe('coins');
    tm.advance(5000); expect(t.shown).toBe('coins'); // hover 不自動隱藏
    t.leave('coins'); expect(t.shown).toBe(null); expect(seen).toEqual(['coins', null]);
  });
  it('tap toggles and auto-hides after ~2s', () => {
    const tm = fakeTimers(); const t = new TopTip(() => {}, tm);
    t.tap('age'); expect(t.shown).toBe('age');
    t.tap('age'); expect(t.shown).toBe(null);
    t.tap('age'); tm.advance(TIP_HIDE_MS - 1); expect(t.shown).toBe('age');
    tm.advance(1); expect(t.shown).toBe(null); expect(tm.size()).toBe(0);
  });
  it('tapping another item switches and restarts the timer', () => {
    const tm = fakeTimers(); const t = new TopTip(() => {}, tm);
    t.tap('name'); tm.advance(1500); t.tap('coins'); tm.advance(1500); expect(t.shown).toBe('coins');
    tm.advance(500); expect(t.shown).toBe(null);
  });
  it('tapping elsewhere hides', () => {
    const tm = fakeTimers(); const t = new TopTip(() => {}, tm);
    t.tap('stage'); t.outside(); expect(t.shown).toBe(null); expect(tm.size()).toBe(0);
  });
});

import { evoProgress } from '../src/topTip';
describe('evoProgress (v1.7 寶 bar)', () => {
  const H = 3_600_000;
  it('hidden for eggs, dead or missing data', () => {
    expect(evoProgress(null)).toBeNull();
    expect(evoProgress({ status: 'egg', evolve_done_ms: 1, evolve_need_ms: 2 })).toBeNull();
    expect(evoProgress({ status: 'dead', evolve_done_ms: 1, evolve_need_ms: 2 })).toBeNull();
  });
  it('fraction + open-hours tooltip', () => {
    const e = evoProgress({ status: 'alive', evolve_done_ms: 10.5 * H, evolve_need_ms: 33 * H })!;
    expect(e.frac).toBeCloseTo(10.5 / 33); expect(e.text).toBe('下次進化：還有 23 小時');
    expect(evoProgress({ status: 'alive', evolve_done_ms: 33 * H, evolve_need_ms: 33 * H })!.text).toBe('下次進化：快了！');
    expect(tipText('evo', '下次進化：還有 5 小時')).toBe('下次進化：還有 5 小時');
  });
});
