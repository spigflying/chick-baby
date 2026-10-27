import { describe, expect, it } from 'vitest';
import { createRace, stepRace, setRaceInput, carRaceStats, raceTimeMs, hudKmh, RACE_TICK_RATE } from '../src/racing';
describe('race result stats', () => {
  it('collects obstacle hits, pickups, avg and top speed (HUD km/h) for every car', () => {
    const s = createRace(42, 'tw1', [{ id: 'u1', name: '很長很長很長的名字（阿明）', car: 'starter' } as any], 1, 1);
    while (!s.over) { setRaceInput(s, 'u1', { gas: true }); stepRace(s); }
    for (const c of s.cars) {
      const st = carRaceStats(s, c);
      expect(st.top).toBe(hudKmh(c.vTop ?? 0)); expect(st.top).toBeGreaterThan(0);
      expect(st.avg).toBeGreaterThan(0); expect(st.avg).toBeLessThanOrEqual(st.top);
      expect(st.ob).toBe(c.obN ?? 0); expect(st.pk).toBe(c.pkN ?? 0);
      if (c.finishedTick !== null) { const t = raceTimeMs(s, c)! / 1000; expect(st.avg).toBe(hudKmh((s.len * s.laps) / t)); }
    }
  });
  it('before the start everything is zero', () => {
    const s = createRace(1, 'tw1', [{ id: 'u1', name: 'a', car: 'starter' } as any], 1, 1); stepRace(s);
    expect(carRaceStats(s, s.cars[0])).toEqual({ ob: 0, pk: 0, avg: 0, top: 0 }); expect(RACE_TICK_RATE).toBeGreaterThan(0);
  });
});
