import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, setInput, leaveStairs, stairsRanking, multiStairsCoins, STAIRS_PARAMS as P } from '../src';

const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const stats = (n: number) => ids.slice(0, n).map((petId) => ({ petId, speed: 15, stamina: 15 }));
describe('multi-player stairs (M2, requirements §4.4 / §5.1: no contact between pets)', () => {
  it('everyone starts on the same point of the normal start platform (same as solo)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createStairs(seed, stats(6)), solo = createStairs(seed, stats(1));
      const start = s.plats.find((pl) => pl.id === s.players[0].on)!;
      expect(start.type).toBe('normal'); expect(s.plats).toEqual(solo.plats);
      expect(s.players.every((p) => p.on === start.id && p.x === solo.players[0].x && p.y === solo.players[0].y)).toBe(true);
      expect(s.players[0].x).toBe(start.x + P.platW / 2 - P.boxW / 2);
    }
  });
  it('pets never touch: with the same inputs they stay stacked on the same spot the whole run', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createStairs(seed, stats(4));
      while (!s.over && s.tick < 3000) {
        const t = s.tick;
        for (const p of s.players) setInput(s, p.petId, t % 50 < 20, t % 50 > 30);
        stepStairs(s);
        const [a, ...rest] = s.players;
        for (const b of rest) expect([b.x, b.y, b.hp, b.floor, b.alive]).toEqual([a.x, a.y, a.hp, a.floor, a.alive]);
      }
    }
  });
  it('walking into / through another pet does not move it', () => {
    const s = createStairs(1, stats(2));
    const [a, b] = s.players; b.x = a.x + 4;
    for (let i = 0; i < 6; i++) { const bx = b.x; setInput(s, 'p1', false, true); stepStairs(s); expect(b.x).toBe(bx); }
    expect(a.x).toBeGreaterThan(b.x); // 直接穿過去
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
    s.plats = [{ id: 999, x: 0, y: 60, type: 'spiky', dir: 1, brk: -1 }];
    const [a, b] = s.players; a.x = 4; b.x = 6;
    for (const p of s.players) { p.on = null; p.y = 60 - P.boxH - 1; p.vy = 1; }
    const ha = a.hp, hb = b.hp;
    stepStairs(s); for (let i = 0; i < 40; i++) stepStairs(s);
    expect(a.hp).toBe(ha - P.spikeDamage); expect(b.hp).toBe(hb - P.spikeDamage);
  });
  it('the match ends when one pet is left (multi), but a solo run goes on', () => {
    const s = createStairs(1, stats(3));
    expect(leaveStairs(s, 'p2')).toBe(true); expect(s.over).toBe(false);
    const p2 = s.players[1]; expect(p2.cause).toBe('left'); expect(p2.diedAtTick).toBe(s.tick);
    expect(leaveStairs(s, 'p2')).toBe(false);
    stepStairs(s); expect(s.over).toBe(false);
    leaveStairs(s, 'p3'); expect(s.over).toBe(true);
    const solo = createStairs(1, stats(1)); stepStairs(solo); expect(solo.over).toBe(false);
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
