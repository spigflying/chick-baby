// 路障（race-demo-obstacles → 正式版）：種子決定、留通道、不放彎中、難度越高越多、撞到只減速、AI 會閃
import { describe, it, expect } from 'vitest';
import {
  registerMapFirstTracks, raceObstacles, obstacleSpotOk, obstacleGap, obstaclesPerLap, obstacleHit, obstacleLevel,
  createRace, stepRace, fillField, trackSegs, trackLength, SEG_LEN, DEMO_HITBOX, DEMO_CAR_W, OBST_MAX_CURVE, OBST_MIN_GAP,
  OBSTACLE_SPECS, HIT_OBSTACLE, condition, TRACKS, type RaceState,
} from '../src';

const MF = registerMapFirstTracks();
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

describe('obstacle placement', () => {
  it('same seed → same obstacles; different seeds differ', () => {
    for (const t of MF) {
      expect(raceObstacles(42, t.id)).toEqual(raceObstacles(42, t.id));
      const sigs = new Set(SEEDS.map((s) => JSON.stringify(raceObstacles(s, t.id))));
      expect(sigs.size).toBeGreaterThan(SEEDS.length / 2);
    }
  });
  it('always a passable gap (≥ 2.5 car widths) and inside the road', () => {
    for (const t of [...MF, ...TRACKS]) for (const s of SEEDS.slice(0, 10)) for (const o of raceObstacles(s, t.id)) {
      expect(obstacleGap(o)).toBeGreaterThanOrEqual(2.5 * DEMO_CAR_W);
      expect(Math.abs(o.x) + o.w / 2).toBeLessThanOrEqual(1.0001);
    }
  });
  it('never mid-corner or on corner entry: segment and next 40 m straight; spaced apart', () => {
    for (const t of MF) {
      const segs = trackSegs(t.id), n = segs.length, len = trackLength(segs);
      for (const s of SEEDS) { const obs = raceObstacles(s, t.id);
        for (const o of obs) { expect(obstacleSpotOk(t.id, o.z, len)).toBe(true);
          const i = Math.floor(o.z / SEG_LEN); for (let k = 0; k <= 2; k++) expect(Math.abs(segs[(i + k) % n].curve)).toBeLessThan(OBST_MAX_CURVE); }
        for (let i = 1; i < obs.length; i++) expect(obs[i].z - obs[i - 1].z).toBeGreaterThanOrEqual(OBST_MIN_GAP);
      }
    }
  });
  it('count scales with track difficulty', () => {
    const lv = MF.map((t) => obstacleLevel(t.id)), cnt = MF.map((t) => obstaclesPerLap(t.id));
    expect(lv).toEqual([0, 0.5, 1]);
    expect(cnt[0]).toBeLessThan(cnt[1]); expect(cnt[1]).toBeLessThan(cnt[2]);
    for (const t of MF) for (const s of SEEDS.slice(0, 10)) expect(raceObstacles(s, t.id).length).toBe(obstaclesPerLap(t.id));
  });
  it('production races: every track gets seeded obstacles, identical for any entrant list (server, clients, resume)', () => {
    for (const t of TRACKS) {
      const a = createRace(4242, t.id, fillField([{ id: 'me', name: 'me' }]));
      const b = createRace(4242, t.id, fillField([{ id: 'x', name: 'x' }, { id: 'y', name: 'y' }, { id: 'z', name: 'z' }]), 1, 2);
      expect(a.obstacles!.length).toBeGreaterThanOrEqual(2); expect(a.obstacles!.length).toBeLessThanOrEqual(obstaclesPerLap(t.id));
      expect(b.obstacles).toEqual(a.obstacles); expect(raceObstacles(4242, t.id)).toEqual(a.obstacles);
      expect(JSON.parse(JSON.stringify(a.obstacles))).toEqual(a.obstacles); // 走 JSON（跨實例 relay）不變
      for (const o of a.obstacles!) { expect(obstacleSpotOk(t.id, o.z, a.len)).toBe(true); expect(obstacleGap(o)).toBeGreaterThan(0.5); }
    }
  });
  it('production (no hitbox): every human gets the server-side slowdown, no damage', () => {
    const s = createRace(9, TRACKS[0].id, fillField([{ id: 'p1', name: 'p1' }, { id: 'p2', name: 'p2' }]));
    s.countdown = 0; s.pickups = []; const o = { id: 0, kind: 'tyres' as const, z: 400, ...OBSTACLE_SPECS.tyres, x: 0 }; s.obstacles = [o];
    const hs = s.cars.filter((c) => !c.ai); for (const c of s.cars) if (c.ai) { c.z = -900; c.finishedTick = 0; }
    hs.forEach((c, i) => { c.z = 390 - i * 40; c.x = 0; c.speed = 100; });
    const v0: number[] = []; for (let i = 0; i < 200 && hs.some((c) => !c.obN); i++) { hs.forEach((c, j) => { if (!c.obN) { v0[j] = c.speed; c.x = 0; } }); stepRace(s); }
    for (const c of hs) { expect(c.obN).toBe(1); expect(c.damage).toBe(0); expect(c.hit).toBe(0); expect(c.speed).toBeLessThan(v0[hs.indexOf(c)] * 0.6); expect(c.evK).toBe(HIT_OBSTACLE); }
  });
});

function solo(kind: 'boxes' | 'cones', x: number, ai = false) {
  const t = MF[0], s: RaceState = createRace(7, t.id, fillField([{ id: 'me', name: 'me' }]));
  s.hitbox = DEMO_HITBOX; s.countdown = 0; s.pickups = [];
  const me = s.cars.find((c) => c.id === 'me')!;
  for (const c of s.cars) if (c !== me) { c.z = -5000; c.finishedTick = 0; }
  const sp = OBSTACLE_SPECS[kind], z = raceObstacles(7, t.id)[0].z;
  s.obstacles = [{ id: 0, kind, z, x: kind === 'cones' ? 1 - sp.w / 2 : 0, w: sp.w, dz: sp.dz, slow: sp.slow }];
  me.ai = ai; me.z = z - (ai ? 400 : 5); me.x = x; me.speed = 90; me.aiLane = x / 0.8; me.aiT = x;
  return { s, me };
}
describe('obstacle collision', () => {
  it('hitting slows the car, no damage, once per obstacle (cooldown)', () => {
    const { s, me } = solo('boxes', 0); const cond0 = condition(me), dmg0 = me.damage;
    let before = 0; for (let i = 0; i < 6; i++) { before = me.speed; stepRace(s); if (me.obN) break; }
    expect(me.obN).toBe(1);
    expect(me.speed).toBeLessThan(before * 0.7);
    expect(me.damage).toBe(dmg0); expect(condition(me)).toBe(cond0); expect(me.hit).toBe(0);
    for (let i = 0; i < 20; i++) stepRace(s);
    expect(me.obN).toBe(1);
  });
  it('hitbox matches drawn width: just outside the edge = no hit', () => {
    const o = { id: 0, kind: 'boxes' as const, z: 500, x: 0, w: 0.34, dz: 1.2, slow: 0.5 };
    const edge = (DEMO_CAR_W + o.w) / 2;
    expect(obstacleHit(o, edge - 0.01, 495, 505, 3000)).toBe(true);
    expect(obstacleHit(o, edge + 0.01, 495, 505, 3000)).toBe(false);
    expect(obstacleHit(o, 0, 3495, 3505, 3000)).toBe(true); // 第二圈同位置
  });
  it('passing through the gap of a cone row is free', () => {
    const { s, me } = solo('cones', -0.6); for (let i = 0; i < 10; i++) stepRace(s);
    expect(me.obN ?? 0).toBe(0);
  });
  it('AI changes lane to avoid an obstacle in its lane', () => {
    for (const k of ['boxes', 'cones'] as const) {
      const x0 = k === 'cones' ? 0.6 : 0; const { s, me } = solo(k, x0, true);
      for (let i = 0; i < 200 && me.z < s.obstacles![0].z + 10; i++) stepRace(s);
      expect(me.z).toBeGreaterThan(s.obstacles![0].z);
      expect(me.obN ?? 0).toBe(0);
    }
  });
});
