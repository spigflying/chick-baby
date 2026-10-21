import { describe, expect, it } from 'vitest';
import { createRace, stepRace, raceRanking, setRaceInput, carStats, repairCost, STOCK_PARTS, PARTS, PART_KINDS, TRACKS, buildTrack, prizeFor, NITRO_PER_RACE, RACE_TICK_RATE, unlockAfter, type Parts } from '../src/racing';

const run = (s: ReturnType<typeof createRace>, f?: (s: any) => void) => { while (!s.over) { f?.(s); stepRace(s); } return s; };
const field = (n = 5) => Array.from({ length: n }, (_, i) => ({ id: `ai${i}`, name: `AI${i}`, ai: true }));
describe('racing engine', () => {
  it('all tracks build, loop back to start height and AI-only races finish', () => {
    for (const t of TRACKS) {
      const segs = buildTrack(t); expect(segs.length).toBeGreaterThan(100); expect(Math.abs(segs[segs.length - 1].y)).toBeLessThan(1e-6);
      const s = run(createRace(7, t.id, field(6)));
      expect(s.cars.every((c) => c.finishedTick !== null), t.id).toBe(true);
    }
  });
  it('is deterministic for the same seed and inputs', () => {
    const go = () => run(createRace(42, 'jpn', [{ id: 'me', name: 'me' }, ...field()]), (s) => setRaceInput(s, 'me', { gas: true, right: s.tick % 40 < 10, nitro: s.tick % 300 === 0 }));
    expect(JSON.stringify(go().cars)).toBe(JSON.stringify(go().cars));
  });
  it('exactly 3 nitro per race; nitro makes the car faster', () => {
    const s = createRace(1, 'usa', [{ id: 'me', name: 'me' }]);
    let presses = 0;
    run(s, (st) => { const tap = st.tick % 100 === 50; if (tap) presses++; setRaceInput(st, 'me', { gas: true, nitro: tap }); });
    expect(presses).toBeGreaterThan(NITRO_PER_RACE); expect(s.cars[0].nitro).toBe(0);
    const a = createRace(1, 'usa', [{ id: 'me', name: 'me' }]), b = createRace(1, 'usa', [{ id: 'me', name: 'me' }]);
    for (let i = 0; i < 200; i++) { setRaceInput(a, 'me', { gas: true }); setRaceInput(b, 'me', { gas: true, nitro: i === 150 }); stepRace(a); stepRace(b); }
    expect(b.cars[0].z).toBeGreaterThan(a.cars[0].z);
  });
  it('hitting the roadside damages the car, damage lowers speed, armor reduces damage', () => {
    const crash = (parts: Parts) => { const s = createRace(3, 'tpe', [{ id: 'me', name: 'me', parts }]); for (let i = 0; i < 400; i++) { setRaceInput(s, 'me', { gas: true, right: true }); stepRace(s); } return s.cars[0].damage; };
    const d0 = crash(STOCK_PARTS), d3 = crash({ ...STOCK_PARTS, armor: 3 });
    expect(d0).toBeGreaterThan(0); expect(d3).toBeLessThan(d0);
    const speed = (damage: number) => { const s = createRace(3, 'usa', [{ id: 'me', name: 'me', damage }]); for (let i = 0; i < 300; i++) { setRaceInput(s, "me", { gas: true }); stepRace(s); } return s.cars[0].speed; };
    expect(speed(80)).toBeLessThan(speed(0) * 0.8);
  });
  it('rear-ending another car damages both', () => {
    const s = createRace(5, 'usa', [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    s.cars[0].x = 0; s.cars[1].x = 0; s.cars[0].z = 0; s.cars[1].z = 3; s.cars[0].speed = 60; s.cars[1].speed = 20; s.countdown = 0;
    stepRace(s); expect(s.cars[0].damage).toBeGreaterThan(0); expect(s.cars[1].damage).toBeGreaterThan(0); expect(s.cars[0].speed).toBeLessThan(60);
  });
  it('upgrades improve stats; rain needs wet tyres; prices rise per tier; repair costs money', () => {
    const base = carStats(STOCK_PARTS), up = carStats({ engine: 4, gearbox: 3, dry: 3, wet: 3, nitro: 3, armor: 3 });
    expect(up.topSpeed).toBeGreaterThan(base.topSpeed); expect(up.accel).toBeGreaterThan(base.accel); expect(up.wetGrip).toBeGreaterThan(base.wetGrip);
    expect(base.wetGrip).toBeLessThan(base.grip);
    for (const k of PART_KINDS) PARTS[k].tiers.forEach((t, i) => { if (i) expect(t.price).toBeGreaterThan(PARTS[k].tiers[i - 1].price); });
    expect(repairCost(50, STOCK_PARTS)).toBeGreaterThan(0); expect(repairCost(0, STOCK_PARTS)).toBe(0);
    expect(prizeFor(TRACKS[0], 1)).toBeGreaterThan(prizeFor(TRACKS[0], 2)); expect(unlockAfter(3)).toBe(true); expect(unlockAfter(4)).toBe(false);
  });
  it('a human holding gas on stock car can finish the first track in reasonable time and ranking is sane', () => {
    const s = run(createRace(9, 'tpe', [{ id: 'me', name: 'me' }, ...field()]), (st) => {
      const me = st.cars[0]; const seg = (st as any); void seg; setRaceInput(st, 'me', { gas: true, left: me.x > 0.3, right: me.x < -0.3 });
    });
    const r = raceRanking(s); expect(r.length).toBe(6); expect(s.cars[0].finishedTick! / RACE_TICK_RATE).toBeLessThan(180);
  });
});
