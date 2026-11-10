import { describe, expect, it } from 'vitest';
import { SFV, SFV_FIT } from '@chick/engine';

const { DOWN, RIGHT, LP, HP, LK, HK, M } = SFV;
function fight(x1 = 450, x2 = 500) { const s = SFV.createState(); s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2; return s; }
function run(s: any, p1: number[], p2: number[] = []) { const n = Math.max(p1.length, p2.length); for (let k = 0; k < n; k++) SFV.simulateSFVTick(s, p1[k] ?? 0, p2[k] ?? 0); return s; }
const hold = (m: number, n: number) => new Array(n).fill(m);
const started = (s: any) => SFV.MOVE_LIST[s.p[0].mv]?.id;
const QCF2 = [DOWN, DOWN | RIGHT, RIGHT, DOWN, DOWN | RIGHT];

describe('真空蛋波 SHINKU (236236+P)', () => {
  it('needs 3 bars, freezes the screen, spends 300', () => {
    expect(started(run(fight(300, 600), [...QCF2, RIGHT | LP]))).not.toBe('SHINKU');
    const s = fight(300, 600); s.p[0].ex = 300;
    run(s, [...QCF2, RIGHT | LP]);
    expect(started(s)).toBe('SHINKU'); expect(s.frz).toBe(30); expect(s.p[0].ex).toBe(0);
  });
  it('236236+K is still CA', () => {
    const s = fight(300, 600); s.p[0].ex = 300;
    expect(started(run(s, [...QCF2, RIGHT | HK]))).toBe('CA');
  });
  it('lands all 5 hits for 350 total in range', () => {
    const s = fight(450, 520); s.p[0].ex = 300;
    run(s, [...QCF2, RIGHT | HP, ...hold(0, 160)]);
    expect(1000 - s.p[1].hp).toBe(350);
  });
  it('per-hit hit-stop 8 on every hit', () => {
    expect(SFV.MOVE_LIST[M.SHINKU].hs).toEqual([8, 8, 8, 8, 8]);
  });
});

describe('SF6 hit-stop values', () => {
  const hs = (id: string) => SFV.MOVE_LIST[M[id]].hs;
  it('lights 9, DP 15/20, CA last hit 13', () => {
    expect(hs('5LP')).toBe(9); expect(hs('2LK')).toBe(9);
    expect(hs('DP_L')).toBe(15); expect(hs('DP_H')).toBe(20); expect(hs('DP_EX')).toEqual([20, 13]);
    expect(hs('CA')).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 13]);
  });
  it('block hit-stop equals hit hit-stop', () => {
    const s = run(fight(), [LP, LP, LP, LP], hold(RIGHT, 4));
    expect(s.p[1].st).toBe(SFV.ST.BLOCK);
    expect(s.p[1].hs).toBe(9); expect(s.p[0].hs).toBe(9);
  });
});

describe('fitted boxes', () => {
  it('idle hurtboxes come from the fitted pose set', () => {
    const s = fight();
    const p = s.p[0];
    expect(SFV_FIT.pose(p, s).img).toBe('body_1');
    expect(SFV.hurtboxes(p).length).toBeGreaterThanOrEqual(3);
  });
  it('startup front edge stays at the old standing 22', () => {
    const s = fight(400, 700); run(s, [HP, 0, 0]);
    const front = Math.max(...SFV.hurtboxes(s.p[0]).map((r: number[]) => r[0] + r[2])) - s.p[0].x;
    expect(front).toBeLessThanOrEqual(22.01);
  });
  it('is deterministic: same inputs → identical boxes', () => {
    const a = run(fight(), [...hold(RIGHT, 7), HK, ...hold(0, 12)]);
    const b = run(fight(), [...hold(RIGHT, 7), HK, ...hold(0, 12)]);
    expect(JSON.stringify(SFV.hurtboxes(a.p[0]))).toBe(JSON.stringify(SFV.hurtboxes(b.p[0])));
  });
});
