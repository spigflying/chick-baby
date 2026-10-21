import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, setInput, leaveStairs, stairsRanking, multiStairsCoins, pushFor, massFor, cloneStairs, STAIRS_PARAMS as P, type StairsState } from '../src';

const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const stats = (n: number) => ids.slice(0, n).map((petId) => ({ petId, speed: 15, stamina: 15, strength: 10, weight: 20 }));
/** 只留一個很寬的平台（不會再長新平台到這麼上面）方便測推擠。 */
function flat(s: StairsState, y = 60) {
  s.plats = [{ id: 999, x: 0, y, type: 'normal', dir: 1, brk: -1, w: P.width }];
  for (const p of s.players) { p.on = 999; p.y = y - P.boxH; p.vy = 0; p.passed = [999]; }
}

describe('multi-player stairs (M2, requirements §4.4 / §5.1)', () => {
  it('starts on one full-width platform, spread out, nobody overlapping', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createStairs(seed, stats(6));
      const start = s.plats.find((pl) => pl.id === s.players[0].on)!;
      expect(start.x).toBe(0); expect(start.w).toBe(P.width); expect(start.type).toBe('normal');
      const xs = s.players.map((p) => p.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(P.boxW);
      expect(xs[0]).toBeGreaterThanOrEqual(0); expect(xs[xs.length - 1]).toBeLessThanOrEqual(P.width - P.boxW);
      expect(s.players.every((p) => p.on === start.id)).toBe(true);
    }
  });
  it('deterministic: same seed + same inputs → same result (including pushes and kill credit)', () => {
    const run = () => {
      const s = createStairs(42, stats(4));
      while (!s.over && s.tick < 4000) {
        s.players.forEach((p, i) => setInput(s, p.petId, (s.tick + i * 13) % 50 < 20, (s.tick + i * 7) % 50 > 30));
        stepStairs(s);
      }
      return JSON.stringify(s);
    };
    const a = run();
    expect(run()).toBe(a);
    expect(a).toContain('"lastPushBy":"p');
  });
  it('the mover shoves an idle pet (pvx, credit) and is pushed back less', () => {
    const s = createStairs(1, stats(2)); flat(s);
    const [a, b] = s.players; a.x = 30; b.x = 41; // 重疊 1px
    setInput(s, 'p1', false, true);
    stepStairs(s);
    expect(b.x - 41).toBeGreaterThan(30 + a.speed - a.x); // b 被推開的比 a 退的多
    expect(b.pvx).toBeGreaterThan(0); expect(b.lastPushBy).toBe('p1'); expect(b.lastPushTick).toBe(s.tick);
    expect(a.pvx).toBe(0); expect(a.lastPushBy).toBeNull();
    expect(b.x - a.x).toBeGreaterThanOrEqual(P.boxW - 1e-9); // 分開了
  });
  it('equal pets pushing each other cancel out: both stay apart, neither gets pvx toward the other side', () => {
    const s = createStairs(1, stats(2)); flat(s);
    const [a, b] = s.players; a.x = 36; b.x = 48;
    for (let i = 0; i < 30; i++) { setInput(s, 'p1', false, true); setInput(s, 'p2', true, false); stepStairs(s); }
    expect(Math.abs((a.x + b.x) / 2 - 42)).toBeLessThan(0.5); // 中點不動
    expect(b.x - a.x).toBeGreaterThanOrEqual(P.boxW - 1e-9);
  });
  it('a heavier pet is pushed less; a stronger pet pushes more', () => {
    const shove = (strength: number, weight: number) => {
      const s = createStairs(1, [{ petId: 'p1', speed: 15, stamina: 15, strength, weight: 20 }, { petId: 'p2', speed: 15, stamina: 15, strength: 10, weight }]);
      flat(s); const [a, b] = s.players; a.x = 30; b.x = 41;
      for (let i = 0; i < 10; i++) { setInput(s, 'p1', false, true); stepStairs(s); }
      return b.x;
    };
    expect(shove(10, 50)).toBeLessThan(shove(10, 20));
    expect(shove(40, 20)).toBeGreaterThan(shove(10, 20));
    expect(pushFor(10)).toBe(1); expect(massFor(20)).toBe(1);
    expect(pushFor(1000)).toBe(1.6); expect(massFor(-100)).toBe(0.8);
  });
  it('pvx is capped and decays, so a shove carries a pet off the platform edge even after contact ends', () => {
    const s = createStairs(1, stats(2));
    s.plats = [{ id: 999, x: 20, y: 60, type: 'normal', dir: 1, brk: -1 }];
    for (const p of s.players) { p.on = 999; p.y = 46; p.passed = [999]; }
    const [a, b] = s.players; a.x = 20; b.x = 31; // b 站在平台右半邊
    let n = 0;
    while (b.on !== null && n++ < 30) { setInput(s, 'p1', false, true); stepStairs(s); expect(Math.abs(b.pvx)).toBeLessThanOrEqual(P.pushMax); }
    setInput(s, 'p1', false, false);
    expect(b.on).toBeNull(); expect(n).toBeLessThan(15); // 被撞下平台
    expect(a.on).toBe(999); // 推人的還站著
    const v = b.pvx; stepStairs(s); expect(Math.abs(b.pvx)).toBeLessThan(Math.abs(v));
  });
  it('kill credit: last pusher within 60 ticks before falling out; older pushes and self-falls do not count', () => {
    const s = createStairs(1, stats(3)); flat(s);
    const [, b, c] = s.players; b.x = 10; c.x = 70;
    b.lastPushBy = 'p1'; b.lastPushTick = s.tick - 30; b.y = P.height + 1; b.on = null;
    c.lastPushBy = 'p1'; c.lastPushTick = s.tick - 200; c.y = P.height + 1; c.on = null;
    stepStairs(s);
    expect(b.alive).toBe(false); expect(b.cause).toBe('fell'); expect(b.killedBy).toBe('p1');
    expect(c.alive).toBe(false); expect(c.killedBy).toBeNull();
  });
  it('each pet counts its own floors (a platform passed by one pet still counts for the next)', () => {
    const s = createStairs(3, stats(2));
    const plat = { id: 500, x: 0, y: 40, type: 'normal' as const, dir: 1 as const, brk: -1 };
    s.plats.push(plat);
    const [a, b] = s.players;
    stepStairs(s);
    expect(a.passed).toContain(500); expect(b.passed).toContain(500);
    expect(a.floor).toBe(b.floor); expect(a.floor).toBeGreaterThan(0);
  });
  it('a spiky platform hurts every pet that lands on it once', () => {
    const s = createStairs(1, stats(2));
    s.plats = [{ id: 999, x: 0, y: 60, type: 'spiky', dir: 1, brk: -1, w: P.width }];
    const [a, b] = s.players; a.x = 10; b.x = 60;
    for (const p of s.players) { p.on = null; p.y = 60 - P.boxH - 1; p.vy = 1; }
    const ha = a.hp, hb = b.hp;
    stepStairs(s); for (let i = 0; i < 40; i++) stepStairs(s);
    expect(a.hp).toBe(ha - P.spikeDamage); expect(b.hp).toBe(hb - P.spikeDamage);
  });
  it('the match ends when one pet is left (multi), but a solo run goes on', () => {
    const s = createStairs(1, stats(3)); flat(s);
    expect(leaveStairs(s, 'p2')).toBe(true); expect(s.over).toBe(false);
    const p2 = s.players[1]; expect(p2.cause).toBe('left'); expect(p2.killedBy).toBeNull(); expect(p2.diedAtTick).toBe(s.tick);
    expect(leaveStairs(s, 'p2')).toBe(false);
    stepStairs(s); expect(s.over).toBe(false);
    leaveStairs(s, 'p3'); expect(s.over).toBe(true);
    const solo = createStairs(1, stats(1)); stepStairs(solo); expect(solo.over).toBe(false);
  });
  it('collide: false (client prediction) ignores other pets', () => {
    const s = createStairs(1, stats(2)); flat(s);
    const [a, b] = s.players; a.x = 30; b.x = 41;
    const c = cloneStairs(s);
    setInput(c, 'p1', false, true); stepStairs(c, { collide: false });
    expect(c.players[1].x).toBe(41); expect(c.players[1].pvx).toBe(0);
  });
  it('ranking: survivors first by floor, then later elimination, then floor; ties share a rank', () => {
    const s = createStairs(1, stats(5));
    const set = (i: number, alive: boolean, died: number | null, floor: number) => Object.assign(s.players[i], { alive, diedAtTick: died, floor });
    set(0, false, 100, 9); set(1, false, 300, 2); set(2, false, 300, 2); set(3, false, 300, 5); set(4, true, null, 1);
    const r = Object.fromEntries(stairsRanking(s).map((x) => [x.petId, x.rank]));
    expect(r).toEqual({ p5: 1, p4: 2, p2: 3, p3: 3, p1: 5 });
    set(4, true, null, 7); set(3, true, null, 7);
    expect(stairsRanking(s).slice(0, 2).map((x) => x.rank)).toEqual([1, 1]);
  });
  it('rewards: ◎5 + (players − rank) × 3', () => {
    expect([1, 2, 3, 4, 5, 6].map((r) => multiStairsCoins(6, r))).toEqual([20, 17, 14, 11, 8, 5]);
    expect([multiStairsCoins(2, 1), multiStairsCoins(2, 2)]).toEqual([8, 5]);
  });
  it('a 6-pet snapshot stays well under the pg_notify 8000-byte limit', () => {
    const s = createStairs(9, stats(6)); let max = 0;
    while (!s.over && s.tick < 3000) {
      s.players.forEach((p, i) => setInput(s, p.petId, (s.tick + i * 40) % 160 < 60, (s.tick + i * 40) % 160 > 100));
      stepStairs(s);
      max = Math.max(max, JSON.stringify({ t: 'stairs.snap', home: '00000000-0000-4000-8000-000000000000', match_id: '00000000-0000-4000-8000-000000000001', tick: s.tick, state: s, seqs: Object.fromEntries(ids.map((id) => [id, 99999])), late: Object.fromEntries(ids.map((id) => [id, 999])) }).length);
    }
    expect(max).toBeLessThan(6000);
  });
});
