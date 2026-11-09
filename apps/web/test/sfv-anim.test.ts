import { describe, expect, it } from 'vitest';
import { SFV } from '@chick/engine';
import { P, mix, keyed, overshoot, blendTicks, FighterAnim, interpPose, Spring, solveLeg, footOf, easeOut } from '../src/sfv-anim';
import { __test } from '../src/sfv-3d';

describe('格鬥動畫工具', () => {
  it('keyed：剛好在關鍵格時等於那格姿勢，轉折格不會衝過頭', () => {
    const a = P({ aF: 0 }), b = P({ aF: -1 }), c = P({ aF: 2 });
    const keys: any = [[0, a], [3, b], [4, c], [10, a]];
    expect(keyed(keys, 3).aF).toBeCloseTo(-1);
    expect(keyed(keys, 4).aF).toBeCloseTo(2);
    for (let t = 0; t <= 3; t += 0.25) expect(keyed(keys, t).aF).toBeGreaterThanOrEqual(-1 - 1e-9); // 預備動作最低點就是 -1
    for (let t = 4; t <= 10; t += 0.25) expect(keyed(keys, t).aF).toBeLessThanOrEqual(2 + 1e-9);
  });
  it('mix：spin 走最短角度；overshoot 往反方向多走一點', () => {
    expect(mix(P({ spin: 6.2 }), P({ spin: 0 }), 0.5).spin).toBeCloseTo(6.2 + (2 * Math.PI - 6.2) / 2);
    expect(overshoot(P({ aF: 0 }), P({ aF: -1 }), 0.1).aF).toBeCloseTo(-1.1);
  });
  it('blendTicks：出招／被打第一幀／防禦不淡入，站蹲走停會淡入', () => {
    expect(blendTicks('idle', 'move:5LP')).toBe(0);
    expect(blendTicks('idle', 'hit')).toBe(0);
    expect(blendTicks('walk', 'block')).toBe(0);
    expect(blendTicks('idle', 'crouch')).toBeGreaterThanOrEqual(3);
    expect(blendTicks('walk', 'idle')).toBeGreaterThanOrEqual(3);
    expect(blendTicks('hit', 'idle')).toBeGreaterThanOrEqual(3);
    expect(easeOut(0)).toBe(0); expect(easeOut(1)).toBeCloseTo(1);
  });
  it('FighterAnim：組別切換時淡入、同一 tick 重算（回滾）結果一樣、出招那幀標 snap', () => {
    const pose = (p: any) => (p.st === 1 ? { ...P({ aF: 1 }), g: 'b' } : { ...P({ aF: 0 }), g: 'a' });
    const an = new FighterAnim(pose, (p) => p.mt === 4);
    const s = (tick: number, st: number, mt = 0) => ({ tick, rnd: 1, p: [{ st, f: 1, mt }] });
    an.at(s(1, 0), 0); an.at(s(2, 0), 0);
    const x3 = an.at(s(3, 1), 0).aF;
    expect(x3).toBeGreaterThan(0); expect(x3).toBeLessThan(1);
    const x4 = an.at(s(4, 1), 0).aF;
    expect(an.at(s(3, 1), 0).aF).toBeCloseTo(x3); // 倒回去重算
    expect(an.at(s(4, 1), 0).aF).toBeCloseTo(x4);
    for (let t = 5; t < 12; t++) an.at(s(t, 1), 0);
    expect(an.at(s(12, 1), 0).aF).toBeCloseTo(1);
    expect(an.at(s(13, 1, 4), 0).snap).toBe(true);
  });
  it('FighterAnim：換面向時 turn 從 0 走到 1', () => {
    const an = new FighterAnim(() => ({ ...P(), g: 'a' }));
    const s = (tick: number, f: number) => ({ tick, rnd: 1, p: [{ st: 0, f }] });
    an.at(s(1, 1), 0);
    const t = [2, 3, 4, 5, 6, 7].map((k) => an.at(s(k, -1), 0).turn);
    expect(t[0]).toBeGreaterThan(0); expect(t[0]).toBeLessThan(0.5);
    for (let k = 1; k < t.length; k++) expect(t[k]).toBeGreaterThanOrEqual(t[k - 1]);
    expect(t[t.length - 1]).toBe(1);
  });
  it('interpPose：snap 的 tick 直接顯示，其他在兩 tick 之間內插', () => {
    const a = P({ aF: 0 }), b = P({ aF: 1 });
    expect(interpPose(a, b, 0.25).aF).toBeCloseTo(0.25);
    expect(interpPose(a, { ...b, snap: true }, 0.25).aF).toBe(1);
    expect(interpPose(null, b, 0.25).aF).toBe(1);
  });
  it('Spring：大衝量也不會爆、會回到 0', () => {
    const sp = new Spring(300, 12, 0.4);
    sp.step(1e6, 1 / 60); expect(Math.abs(sp.x)).toBeLessThanOrEqual(0.4);
    for (let i = 0; i < 240; i++) sp.step(0, 1 / 60);
    expect(Math.abs(sp.x)).toBeLessThan(1e-3);
  });
  it('solveLeg：腳底剛好到目標、膝蓋彎的方向不變', () => {
    for (const [a, e] of [[-1.12, -0.7], [-2.02, 0.5], [-0.35, -1.9]]) {
      const [fx, fy] = footOf(13, 12, a, e);
      const [A, E] = solveLeg(13, 12, fx, fy + 2, e);
      const [gx, gy] = footOf(13, 12, A, E);
      expect(gx).toBeCloseTo(fx, 4); expect(gy).toBeCloseTo(fy + 2, 4); expect(Math.sign(E)).toBe(Math.sign(e));
    }
  });
  it('真實引擎：走停、蹲站、受擊回復都沒有一幀跳超過 0.5 rad', () => {
    const s = SFV.createState([0, 0]);
    while (s.rs !== SFV.RS.FIGHT) SFV.simulateSFVTick(s, 0, 0);
    const an = __test.makeAnim(); let prev: any = null, worst = 0;
    const plan: [number, number][] = [[0, 10], [SFV.RIGHT, 30], [0, 15], [SFV.DOWN, 15], [0, 15], [SFV.LEFT, 20], [0, 15]];
    for (const [m, n] of plan) for (let k = 0; k < n; k++) {
      SFV.simulateSFVTick(s, m, 0);
      const pose = an.at(s, 0);
      if (prev) for (const key of ['lean', 'head', 'aF', 'eF', 'aB', 'eB', 'hF', 'kF', 'hB', 'kB']) worst = Math.max(worst, Math.abs(pose[key] - prev[key]));
      prev = pose;
    }
    expect(worst).toBeLessThan(0.5);
  });
});
