import { describe, expect, it } from 'vitest';
import { createRace, fillField, stepRace, setRaceInput, racePickups, pickupSpotOk, trackSegs, TRACKS, PICKUP_TICKS, PICKUP_START_GAP, PICKUP_MAX_CURVE, SEG_LEN, carStats, STOCK_PARTS, snapCar, snapPickups, pickupShare, rankOf, type RaceState } from '../src/racing';

const field = (n = 2) => fillField(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'p' + i, parts: STOCK_PARTS })));
/** 把車放在道具前一點、對準車道，跑到通過 */
function driveOver(s: RaceState, ids: string[], pid = 0) {
  const p = s.pickups[pid]; p.q = 0; s.countdown = 0; // 取用機制測試：門檻 0＝任何名次都吃得到（名次規則另測）
  for (const c of s.cars) { if (ids.includes(c.id)) { c.z = p.z - 0.5; c.x = p.x; c.speed = 60; } else c.z = p.z - 2000; }
  for (const id of ids) setRaceInput(s, id, { gas: true });
  stepRace(s);
}
describe('nitro pickups', () => {
  it('spawn rules: up to 4 per lap, lanes, no curves / start area, deterministic from seed', () => {
    for (const t of TRACKS) for (const seed of [1, 7, 99, 12345]) {
      const ps = racePickups(seed, t.id, t.laps), len = trackSegs(t.id).length * SEG_LEN, segs = trackSegs(t.id);
      expect(ps).toEqual(racePickups(seed, t.id, t.laps));
      for (let lap = 0; lap < t.laps; lap++) { const n = ps.filter((p) => p.lap === lap).length; expect(n).toBeLessThanOrEqual(4); }
      expect(ps.length).toBeGreaterThanOrEqual(t.laps); // 每圈至少 1 個（目前所有賽道都找得到直線）
      for (const p of ps) {
        const zl = p.z - p.lap * len; expect(zl).toBeGreaterThanOrEqual(PICKUP_START_GAP); expect(zl).toBeLessThanOrEqual(len - PICKUP_START_GAP);
        expect([-0.6, 0, 0.6]).toContain(p.x); expect(pickupSpotOk(t.id, zl, len)).toBe(true);
        const i = Math.floor(zl / SEG_LEN); for (let k = -4; k <= 4; k++) expect(Math.abs(segs[(i + k + segs.length) % segs.length].curve)).toBeLessThan(PICKUP_MAX_CURVE);
        expect(p.taken).toBeNull(); expect(p.q).toBeGreaterThanOrEqual(0); expect(p.q).toBeLessThan(1);
      }
    }
    // createRace 用同一份（伺服器產生，所有人一樣）
    const s = createRace(42, 'tw1', field()); expect(s.pickups).toEqual(racePickups(42, 'tw1', s.laps));
  });
  it('driving over gives a fixed 5 s nitro at own strength without using stock nitros; gone for everyone', () => {
    const s = createRace(3, 'tw1', field()); driveOver(s, ['p0']);
    const c = s.cars.find((c) => c.id === 'p0')!;
    expect(c.nitro).toBe(3); expect(c.nitroT).toBe(PICKUP_TICKS);
    expect(s.pickups[0].taken).toBe(s.tick); expect(snapPickups(s)).toEqual([0]); expect(snapCar(c)[17]).toBe(s.tick);
    // 第二台之後經過：已經沒了
    const o = s.cars.find((c) => c.id === 'p1')!; o.z = s.pickups[0].z - 3; o.x = s.pickups[0].x; o.speed = 60; setRaceInput(s, 'p1', { gas: true }); stepRace(s);
    expect(o.nitroT).toBe(0); expect(o.pkN ?? 0).toBe(0);
  });
  it('same-tick touch: every player gets it', () => {
    const s = createRace(3, 'tw1', field(3)); driveOver(s, ['p0', 'p1', 'p2']);
    for (const id of ['p0', 'p1', 'p2']) { const c = s.cars.find((c) => c.id === id)!; expect(c.pkN).toBe(1); expect(c.nitroT).toBeGreaterThan(0); }
  });
  it('AI can never take one (passes through, pickup stays)', () => {
    const s = createRace(3, 'tw1', field(1)); const ai = s.cars.find((c) => c.ai)!; const p = s.pickups[0]; s.countdown = 0;
    for (const c of s.cars) c.z = p.z - 2000; ai.z = p.z - 3; ai.x = p.x; ai.speed = 60;
    for (let i = 0; i < 3; i++) { stepRace(s); ai.x = p.x; }
    expect(ai.z).toBeGreaterThan(p.z); expect(p.taken).toBeNull(); expect(ai.nitroT).toBe(0);
  });
  it('active nitro: adds 5 s capped at one full nitro, strength unchanged', () => {
    for (const nitro of [0, 3]) {
      const s = createRace(3, 'tw1', fillField([{ id: 'p0', name: 'p0', parts: { ...STOCK_PARTS, nitro } }])); const c = s.cars.find((c) => c.id === 'p0')!;
      const full = carStats({ ...STOCK_PARTS, nitro }).nitroTicks, boost = c.stats.nitroBoost;
      c.nitroT = 40; driveOver(s, ['p0']);
      expect(c.nitroT).toBeLessThanOrEqual(full); expect(c.nitroT).toBe(Math.min(39 + PICKUP_TICKS, full)); // 這 tick 先扣 1 再吃到
      expect(c.stats.nitroBoost).toBe(boost); expect(c.nitro).toBe(3);
    }
  });
  it('v26 catch-up: share grows with rank; leader nearly never eligible, last sees all', () => {
    expect(pickupShare(1, 20)).toBeCloseTo(0.05); expect(pickupShare(20, 20)).toBe(1); expect(pickupShare(10, 20)).toBeGreaterThan(pickupShare(5, 20));
    let lead = 0, last = 0, n = 0; for (const t of TRACKS) for (const p of racePickups(5, t.id, t.laps)) { n++; if (p.q < pickupShare(1, 20)) lead++; if (p.q < pickupShare(20, 20)) last++; }
    expect(last).toBe(n); expect(lead / n).toBeLessThan(0.12);
  });
  it('v26 catch-up: same pickup is taken by a trailing player but skipped by the leader (server-side)', () => {
    const mk = (behind: boolean) => { const s = createRace(3, 'tw1', field(2)); const p = s.pickups[0]; p.q = 0.5; s.countdown = 0;
      const me = s.cars.find((c) => c.id === 'p0')!; for (const c of s.cars) c.z = p.z + (behind ? 500 : -2000);
      me.z = p.z - 0.5; me.x = p.x; me.speed = 60; setRaceInput(s, 'p0', { gas: true }); stepRace(s); return me.pkN ?? 0; };
    expect(mk(true)).toBe(1); expect(mk(false)).toBe(0);
    expect(rankOf([{ z: 5, finishedTick: null }, { z: 9, finishedTick: null }], { z: 5, finishedTick: null })).toBe(2);
  });
});
