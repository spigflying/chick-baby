import { describe, expect, it } from 'vitest';
import { resultsListHtml, fitName, statsLine } from '../src/race-results';
import { readFileSync } from 'node:fs';
const LONG = '超級無敵長長長長長長長長長長的寵物名字（超級無敵長的玩家名字）';
describe('results screen', () => {
  it('full long name on its own line, time + stats on the next line', () => {
    const h = resultsListHtml([{ id: 'u', name: LONG, rank: 1, time_ms: 83456, ob: 2, pk: 1, avg: 61, top: 98 }, { id: 'ai', name: 'AI', ai: true, rank: 2, time_ms: null }], 'u');
    expect(h).toContain(`<div class="rr-name"><b>1.</b> ${LONG}`); expect(h).toMatch(/rr-name[^]*<\/div><div class="rr-line"><span class="rr-time">1'23"45<\/span>/);
    expect(h).toContain('撞路障 2・吃加速 1・平均 61 km/h・最高 98 km/h'); expect(h).toContain('未完賽');
  });
  it('stats line empty when the server sent no stats (old server)', () => expect(statsLine({ id: 'x', name: 'x', rank: 1, time_ms: 1 })).toBe(''));
  it('canvas: name clipped with … so it never reaches the time column', () => {
    const m = (s: string) => [...s].length * 12;
    const n = fitName(m, LONG, 120); expect(m(n)).toBeLessThanOrEqual(120); expect(n.endsWith('…')).toBe(true);
    expect(fitName(m, '短名', 120)).toBe('短名');
  });
  it('css: results rows wrap names (no single-line flex that overlaps time)', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/ol\.results2 li\{display:block/); expect(css).toMatch(/rr-name\{overflow-wrap:anywhere/);
  });
});
