import { describe, it, expect } from 'vitest';
import { TRACKS, createRace, stepRace, setRaceInput, fillField, DEMO_HITBOX, SPEED_X, type RaceState, type RaceCar } from '../src';

const W = DEMO_HITBOX.dx, D = DEMO_HITBOX.dz, X = SPEED_X;
/** 玩家 + 一台電腦車，給定 dx（b−a 橫向）、dz（b 在 a 前方的公尺）、兩車速度；跑 n tick，回報每 tick 是否重疊、是否有事件 */
export function pair(o: { dx: number; dz: number; va: number; vb: number; aMe?: boolean; hitA?: number; hitB?: number; n?: number; demo?: boolean }) {
  const s: RaceState = createRace(1, TRACKS[0].id, fillField([{ id: 'me', name: 'me' }]));
  if (o.demo !== false) s.hitbox = DEMO_HITBOX;
  s.countdown = 0; s.pickups = [];
  const me = s.cars.find((c) => c.id === 'me')!, ai = s.cars.find((c) => c.ai)!;
  for (const c of s.cars) if (c !== me && c !== ai) { c.z = -500; c.finishedTick = 0; }
  const [a, b] = o.aMe === false ? [ai, me] : [me, ai];
  a.z = 200; b.z = 200 + o.dz; a.x = 0; b.x = o.dx; a.hit = o.hitA ?? 0; b.hit = o.hitB ?? 0;
  ai.ai = false; // 固定輸入（不讓 AI 自己閃開），電腦車／玩家路徑相同
  const log: { ov: boolean; ev: boolean; touch: boolean }[] = [];
  const ov = () => Math.abs(a.x - b.x) < W && Math.abs(a.z - b.z) < D;
  for (let k = 0; k < (o.n ?? 10); k++) {
    a.speed = Math.max(a.speed, 0); if (k === 0) { a.speed = o.va; b.speed = o.vb; }
    for (const c of [a, b]) setRaceInput(s, c.id, { gas: false, brake: false, left: false, right: false, nitro: false });
    const h0 = a.hits + b.hits, before = ov(); stepRace(s);
    log.push({ ov: before, ev: a.hits + b.hits > h0, touch: (a.touchT ?? -1) === s.tick || (b.touchT ?? -1) === s.tick });
  }
  return { log, a, b, overlapNoReaction: log.filter((l) => l.ov && !l.ev && !l.touch).length, endOverlap: ov() };
}
const cases = {
  sideBySide: { dx: W * 0.7, dz: 0.3, va: 20 * X, vb: 20 * X },
  sideBySideCooldown: { dx: W * 0.7, dz: 0.3, va: 20 * X, vb: 20 * X, hitA: 10 },
  slowCloseBehind: { dx: 0.05, dz: 1.2, va: 20.5 * X, vb: 20 * X },
  sameSpeedBehind: { dx: 0.05, dz: 1.2, va: 20 * X, vb: 20 * X },
  frontFasterOverlap: { dx: 0.05, dz: 1.2, va: 20 * X, vb: 20.6 * X },
  fastRearEnd: { dx: 0.05, dz: 1.2, va: 30 * X, vb: 20 * X },
  aiBehindPlayer: { dx: 0.05, dz: 1.2, va: 20.5 * X, vb: 20 * X, aMe: false },
};
describe('race-demo-hitfix: overlapping boxes always react', () => {
  for (const [name, c] of Object.entries(cases)) it(name, () => {
    const r = pair(c);
    if (process.env.HIT_DUMP) console.log(name, JSON.stringify({ noReact: r.overlapNoReaction, end: r.endOverlap, ev: r.log.filter((l) => l.ev).length, touch: r.log.filter((l) => l.touch).length }));
    expect(r.overlapNoReaction).toBe(0); expect(r.endOverlap).toBe(false);
  });
  it('fast rear-end still damages; gentle touch only marks contact (yellow) without damage', () => {
    expect(pair(cases.fastRearEnd).log[0].ev).toBe(true);
    const g = pair({ ...cases.slowCloseBehind, n: 1 }); expect(g.log[0].ev).toBe(false); expect(g.log[0].touch).toBe(true);
  });
  it('side swipe sets cooldown and slows both (demo)', () => { const r = pair({ ...cases.sideBySide, n: 1 }); expect(r.a.hit).toBeGreaterThan(0); expect(r.a.hits).toBe(1); });
  it('production /race (no hitbox) keeps the old rule', () => { const r = pair({ ...cases.sameSpeedBehind, dz: 2, demo: false }); expect(r.a.hits + r.b.hits).toBe(0); expect(r.b.z - r.a.z).toBeCloseTo(2, 3); expect(r.a.touchT).toBeUndefined(); /* 舊盒 dz≤5 內同速＝不處理（正式版不動） */ });
});
