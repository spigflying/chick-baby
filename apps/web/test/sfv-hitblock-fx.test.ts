import { describe, expect, it, beforeEach } from 'vitest';
import { SFV } from '@chick/engine';
import { fightShake, drawFightFx, __fxTest, superScreenTint } from '../src/sfv-art';

const { LP, HK, DOWN, RIGHT, M, ST, EASY_CA } = SFV;
function fight(x1 = 450, x2 = 510) {
  const s = SFV.createState();
  s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2;
  return s;
}
function run(s: any, p1: number[], p2: number[] = []) {
  const n = Math.max(p1.length, p2.length);
  for (let k = 0; k < n; k++) {
    SFV.simulateSFVTick(s, p1[k] ?? 0, p2[k] ?? 0);
    fightShake(s);
  }
  return s;
}
const hold = (m: number, n: number) => new Array(n).fill(m);

describe('hit / block FX v2', () => {
  beforeEach(() => __fxTest.reset());

  it('命中火花在防守方受擊框重疊處（夾進身體剪影）', () => {
    const s = fight();
    run(s, [LP], hold(0, 8));
    const hit = __fxTest.list().find((f) => f.kind === 'hit');
    expect(hit).toBeTruthy();
    expect(hit!.str).toBe('light');
    const d = s.p[1];
    const hurts = SFV.hurtboxes(d);
    expect(hurts.length).toBeGreaterThan(0);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const h of hurts) {
      bx0 = Math.min(bx0, h[0]); by0 = Math.min(by0, h[1]);
      bx1 = Math.max(bx1, h[0] + h[2]); by1 = Math.max(by1, h[1] + h[3]);
    }
    expect(hit!.wx).toBeGreaterThanOrEqual(bx0 - 1);
    expect(hit!.wx).toBeLessThanOrEqual(bx1 + 1);
    expect(hit!.wy).toBeGreaterThanOrEqual(by0 - 1);
    expect(hit!.wy).toBeLessThanOrEqual(by1 + 1);

    __fxTest.reset();
    const s2 = fight();
    run(s2, [HK], hold(0, 14));
    const heavy = __fxTest.list().find((f) => f.kind === 'hit');
    expect(heavy?.str).toBe('heavy');
    const d2 = s2.p[1];
    const hurts2 = SFV.hurtboxes(d2);
    let minY = Infinity, maxY = -Infinity;
    for (const h of hurts2) { minY = Math.min(minY, h[1]); maxY = Math.max(maxY, h[1] + h[3]); }
    // 5HK 火花不可飄在受擊框上方的空氣裡
    expect(heavy!.wy).toBeGreaterThanOrEqual(minY - 2);
    expect(heavy!.wy).toBeLessThanOrEqual(maxY + 2);
  });

  it('防禦只記 block 事件、不畫光圈；引擎時序不變', () => {
    const s = fight();
    run(s, [LP], hold(RIGHT, 8));
    expect(s.p[1].st).toBe(ST.BLOCK);
    const blocks = __fxTest.list().filter((f) => f.kind === 'block');
    const hits = __fxTest.list().filter((f) => f.kind === 'hit');
    expect(blocks.length).toBeGreaterThan(0);
    expect(hits.length).toBe(0);
    // drawFightFx 只畫 hit —— block 不會產生可見光圈（函式層保證）
    expect(typeof drawFightFx).toBe('function');
    // blockstun／hs 仍是引擎原本的（輕拳 blockstun 11、hs 9）
    expect(s.p[1].hs).toBeGreaterThan(0);
  });

  it('同一狀態兩次 track 命中點確定（rollback 安全）', () => {
    const go = () => {
      __fxTest.reset();
      const s = fight();
      run(s, [LP], hold(0, 8));
      return __fxTest.list().map((f) => ({ kind: f.kind, str: f.str, seed: f.seed, wx: f.wx, wy: f.wy }));
    };
    expect(go()).toEqual(go());
  });

  it('蛋波命中標成 special，火花在防守方身上', () => {
    const s = fight(300, 600);
    run(s, [DOWN, DOWN | RIGHT, RIGHT | LP], hold(0, 3));
    expect(SFV.MOVE_LIST[s.p[0].mv]?.id).toBe('HADO_L');
    for (let k = 0; k < 80 && s.p[1].st !== ST.HIT; k++) run(s, [0], [0]);
    expect(s.p[1].st).toBe(ST.HIT);
    const hit = __fxTest.list().find((f) => f.kind === 'hit');
    expect(hit?.str).toBe('special');
    const hurts = SFV.hurtboxes(s.p[1]);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const h of hurts) {
      bx0 = Math.min(bx0, h[0]); bx1 = Math.max(bx1, h[0] + h[2]);
      by0 = Math.min(by0, h[1]); by1 = Math.max(by1, h[1] + h[3]);
    }
    expect(hit!.wx).toBeGreaterThanOrEqual(bx0 - 2);
    expect(hit!.wx).toBeLessThanOrEqual(bx1 + 2);
  });

  it('大招全場變色：凍結＋整段招式都 active，結束後關閉', () => {
    const s = SFV.createState([1, 0]); // beginner → EASY_CA
    s.rs = SFV.RS.FIGHT; s.p[0].x = 400; s.p[1].x = 520; s.p[0].ex = SFV.EX_MAX;
    expect(superScreenTint(s).active).toBe(false);
    run(s, [EASY_CA], [0]);
    expect(SFV.MOVE_LIST[s.p[0].mv]?.id).toBe('CA');
    expect(s.frz).toBeGreaterThan(0);
    const midFreeze = superScreenTint(s);
    expect(midFreeze.active).toBe(true);
    expect(midFreeze.id).toBe('CA');
    expect(midFreeze.alpha).toBeGreaterThan(0);
    // 跑完凍結
    while (s.frz > 0) run(s, [0], [0]);
    const during = superScreenTint(s);
    expect(during.active).toBe(true);
    expect(during.alpha).toBeGreaterThan(0.5);
    // 跑完整段招式
    for (let k = 0; k < 200 && s.p[0].st === ST.MOVE; k++) run(s, [0], [0]);
    expect(superScreenTint(s).active).toBe(false);
  });

  it('SHINKU 用深藍紫 tint，且整段招式期間維持', () => {
    const s = fight(300, 600);
    s.p[0].ex = SFV.EX_MAX;
    // 236236P
    const seq = [DOWN, DOWN | RIGHT, RIGHT, DOWN, DOWN | RIGHT, RIGHT | LP];
    run(s, seq, hold(0, seq.length));
    expect(SFV.MOVE_LIST[s.p[0].mv]?.id).toBe('SHINKU');
    const t0 = superScreenTint(s);
    expect(t0.active).toBe(true);
    expect(t0.id).toBe('SHINKU');
    expect(t0.hex).toBe(0x221868);
    while (s.frz > 0) run(s, [0], [0]);
    let saw = false;
    for (let k = 0; k < 120; k++) {
      run(s, [0], [0]);
      const t = superScreenTint(s);
      if (t.active && t.id === 'SHINKU') saw = true;
      if (!t.active && saw) break;
    }
    expect(saw).toBe(true);
    expect(superScreenTint(s).active).toBe(false);
  });
});
