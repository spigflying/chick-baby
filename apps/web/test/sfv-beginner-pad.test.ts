import { describe, expect, it } from 'vitest';
import { SFV } from '@chick/engine';

const {
  EASY_HADO, EASY_DP, EASY_TATSU, EASY_CA,
  EASY_HADO_EX, EASY_DP_EX, EASY_TATSU_EX, EASY_SHINKU,
  LP, LK, INPUT_MASK, EX_BAR, EX_MAX, M, ST,
} = SFV;

function fight(modes: number[] = [1, 0]) {
  const s = SFV.createState(modes);
  s.rs = SFV.RS.FIGHT; s.p[0].x = 400; s.p[1].x = 560;
  return s;
}
function run(s: any, p1: number[], p2: number[] = []) {
  const n = Math.max(p1.length, p2.length);
  for (let k = 0; k < n; k++) SFV.simulateSFVTick(s, p1[k] ?? 0, p2[k] ?? 0);
  return s;
}
const id = (s: any) => SFV.MOVE_LIST[s.p[0].mv]?.id;

describe('beginner 3x3 easy bits', () => {
  it('exports new bits inside 16-bit INPUT_MASK and BUTTONS range', () => {
    expect(INPUT_MASK).toBe(65535);
    for (const b of [EASY_HADO_EX, EASY_DP_EX, EASY_TATSU_EX, EASY_SHINKU]) {
      expect(b).toBeGreaterThan(2048);
      expect(b & INPUT_MASK).toBe(b);
      expect(b & ~INPUT_MASK).toBe(0);
    }
    // 新 bit 互不重疊
    const all = EASY_HADO | EASY_DP | EASY_TATSU | EASY_CA | EASY_HADO_EX | EASY_DP_EX | EASY_TATSU_EX | EASY_SHINKU;
    expect(all).toBe(EASY_HADO + EASY_DP + EASY_TATSU + EASY_CA + EASY_HADO_EX + EASY_DP_EX + EASY_TATSU_EX + EASY_SHINKU);
  });

  it('RTY 一鍵通常必殺', () => {
    expect(id(run(fight(), [EASY_HADO]))).toBe('HADO_L');
    expect(id(run(fight(), [EASY_DP]))).toBe('DP_H');
    expect(id(run(fight(), [EASY_TATSU]))).toBe('TATSU_L');
  });

  it('FGH：有 1 格 EX 出 EX 版，不足則退回通常版', () => {
    const ok = fight(); ok.p[0].ex = EX_BAR;
    expect(id(run(ok, [EASY_HADO_EX]))).toBe('HADO_EX');
    const ok2 = fight(); ok2.p[0].ex = EX_BAR;
    expect(id(run(ok2, [EASY_DP_EX]))).toBe('DP_EX');
    const ok3 = fight(); ok3.p[0].ex = EX_BAR;
    expect(id(run(ok3, [EASY_TATSU_EX]))).toBe('TATSU_EX');

    expect(id(run(fight(), [EASY_HADO_EX]))).toBe('HADO_L');
    expect(id(run(fight(), [EASY_DP_EX]))).toBe('DP_H');
    expect(id(run(fight(), [EASY_TATSU_EX]))).toBe('TATSU_L');
  });

  it('B＝CA、N＝SHINKU 需滿 3 格；不足則不出', () => {
    const ca = fight(); ca.p[0].ex = EX_MAX;
    expect(id(run(ca, [EASY_CA]))).toBe('CA');
    const sh = fight(); sh.p[0].ex = EX_MAX;
    expect(id(run(sh, [EASY_SHINKU]))).toBe('SHINKU');

    expect(id(run(fight(), [EASY_CA]))).not.toBe('CA');
    expect(id(run(fight(), [EASY_SHINKU]))).not.toBe('SHINKU');
    const low = fight(); low.p[0].ex = EX_BAR * 2;
    expect(id(run(low, [EASY_SHINKU]))).not.toBe('SHINKU');
  });

  it('V＝摔（LP+LK）；經典模式忽略 easy EX／SHINKU bits', () => {
    const s = fight();
    run(s, [LP | LK]);
    expect(id(s)).toBe('THROW');

    const classic = fight([0, 0]); classic.p[0].ex = EX_MAX;
    run(classic, [EASY_SHINKU]);
    expect(id(classic)).not.toBe('SHINKU');
    run(fight([0, 0]), [EASY_HADO_EX]);
    // classic with only easy bit and no motion → idle
  });

  it('hist 與 INPUT_MASK 保留高位 bit（net／rollback）', () => {
    const s = fight();
    s.p[0].ex = EX_MAX;
    run(s, [EASY_SHINKU | EASY_HADO_EX]);
    const stored = s.p[0].hist[s.tick % SFV.HIST];
    expect(stored & EASY_SHINKU).toBe(EASY_SHINKU);
    expect(stored & INPUT_MASK).toBe(stored);
    const packed = SFV.packState(s);
    const u = SFV.unpackState(packed);
    expect(u.p[0].hist[u.tick % SFV.HIST] & EASY_SHINKU).toBe(EASY_SHINKU);
  });
});
