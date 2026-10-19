import { describe, expect, it } from 'vitest';
import { GAME } from '@chick/engine';
import { STAT_KEYS, statAt, statHelp, hudTarget, EVO_HELP, EVO_LINE_Y, EVO_LINE_TRACK } from '../src/statHelp';
import { PAL } from '../src/sprites';
import { evoEta } from '../src/topTip';
describe('top stat help popover', () => {
  it('hit-tests the 5 HUD cells drawn at x = 1 + i*24 (23 wide), y < 13', () => {
    STAT_KEYS.forEach((_, i) => { expect(statAt(1 + i * 24 + 2, 5)).toBe(i); expect(statAt(1 + i * 24 + 22, 10)).toBe(i); });
    expect(statAt(1 + 23, 5)).toBe(-1); // 兩格之間的空隙
    expect(statAt(50, 13)).toBe(-1); expect(statAt(0, 5)).toBe(-1); expect(statAt(119, 5)).toBe(4); // 最後一格的條畫到 x=119
  });
  it('every stat has a name and 3 lines: what lowers it, what raises it, what happens when low', () => {
    for (const k of STAT_KEYS) { const h = statHelp(k); expect(h.name).toBeTruthy(); expect(h.lines).toHaveLength(3); expect(h.lines[0]).toMatch(/^↓/); expect(h.lines[1]).toMatch(/^↑/); }
  });
  it('numbers come from the engine config (per open hour = per-minute × timeScale × 60)', () => {
    const ph = (v: number) => String(Math.round(v * GAME.timeScale * 60 * 10) / 10);
    expect(statHelp('hunger').lines[0]).toContain(`−${ph(GAME.decay.hunger)}`);
    expect(statHelp('hunger').lines[2]).toContain(`低於 ${GAME.sick.hungryBelow} 可能生病`);
    expect(statHelp('energy').lines[2]).toContain(`低於 ${GAME.stairsMinEnergy} 不能下樓梯`);
    expect(statHelp('cleanliness').lines[2]).toContain(`低於 ${GAME.sick.dirtyBelow} 超過 30 分鐘`);
    expect(statHelp('health').lines[1]).toContain(`+${GAME.doctor.healthGain}`);
    const c = { ...GAME, decay: { ...GAME.decay, hunger: 1.2 } };
    expect(statHelp('hunger', c).lines[0]).toContain('−6');
  });
});
describe('status panel next evolution', () => {
  it('shows open hours left and an approximate Taipei date/time', () => {
    const at = Date.UTC(2026, 9, 21, 7, 30); // 台北 10/21（三）15:30
    expect(evoEta({ status: 'alive', evolve_at: at, evolve_done_ms: 20 * 3_600_000, evolve_need_ms: 33 * 3_600_000 })).toBe('還有 13 小時（營業時間）・約 10/21（三）15:30');
    expect(evoEta({ status: 'egg', evolve_at: at, evolve_done_ms: 0, evolve_need_ms: 1 })).toBeNull();
  });
});
import { evoHelp } from '../src/statHelp';
describe('evolution bar help', () => {
  it('explains the rules from the engine config, plus stage and next time', () => {
    const at = Date.UTC(2026, 9, 21, 7, 30);
    const h = evoHelp({ status: 'alive', bao_stage: 1, evolve_at: at, evolve_done_ms: 10 * 3_600_000, evolve_need_ms: 77 * 3_600_000 });
    expect(h.name).toBe('進化（第 1 階）');
    expect(h.lines[0]).toBe('下次：還有 67 小時（營業時間）・約 10/21（三）15:30');
    const all = h.lines.join('\n');
    expect(all).toContain(`${GAME.bao.evolveOpenMs / 3_600_000} 小時第一次進化`); expect(all).toContain(`每 ${GAME.bao.reevolveOpenMs / 3_600_000} 小時`);
    expect(all).toContain('晚上和週末不算'); expect(all).toContain('80%'); expect(all).toContain('50 分以上');
    expect(evoHelp({ status: 'alive', bao_stage: 0 }).name).toBe('進化（還沒進化）');
  });
});

describe('divider line under the HUD doubles as the evolution progress (easter egg)', () => {
  it('the line (y=13) and a few px above/below open the evolution help; icons above it still open their own help', () => {
    for (const y of [11, 12, EVO_LINE_Y, 14, 16]) expect(hudTarget(60, y)).toBe(EVO_HELP);
    expect(hudTarget(60, 17)).toBe(-1); expect(hudTarget(5, 5)).toBe(0); expect(hudTarget(1 + 4 * 24 + 5, 10)).toBe(4);
  });
  it('remainder colour is a close dark shade: darker than PAL[2], distinct from PAL[3]', () => {
    const lum = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    expect(EVO_LINE_TRACK).not.toBe(PAL[3]);
    expect(lum(EVO_LINE_TRACK) - lum(PAL[3])).toBeGreaterThan(8);
    expect(lum(EVO_LINE_TRACK)).toBeLessThan(lum(PAL[2]) - 10);
  });
});
