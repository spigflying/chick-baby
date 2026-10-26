import { describe, it, expect } from 'vitest';
import { createRace, stepRace, setRaceInput, fillField, STEER_RATE, TRACKS } from '../src/racing';
describe('racing v14 steering', () => {
  it('constant-rate steering is gentle: a 1-tick tap moves < 0.05 half-road', () => {
    expect(STEER_RATE).toBeLessThan(0.9);
    const s = createRace(1, 'tw1', fillField([{ id: 'me', name: 'me' }])); s.cars.splice(0, s.cars.length, ...s.cars.filter((c) => c.id === 'me'));
    const me = s.cars[0]; for (let i = 0; i < 160; i++) { setRaceInput(s, 'me', { gas: true }); stepRace(s); }
    const x0 = me.x; setRaceInput(s, 'me', { gas: true, right: true }); stepRace(s); setRaceInput(s, 'me', { gas: true }); 
    expect(Math.abs(me.x - x0)).toBeLessThan(0.05); expect(me.x - x0).toBeGreaterThan(0.01); // race-feel-pc：加油時 STEER_AUTH_GAS=0.75，單 tick 位移略降
  });
  it('AI holds a steady line at 4x speed (v22): < 0.3 lateral direction reversals (>0.015) per car-second on every track', () => {
    for (const tr of TRACKS) {
    const s = createRace(4, tr.id, fillField([])); let n = 0, flips = 0; const st = new Map<string, { ext: number; dir: number }>();
    for (let t = 0; t < 20 * 300 && !s.over; t++) { stepRace(s); if (s.countdown > 0) continue; for (const c of s.cars) { if (c.finishedTick !== null) continue; n++;
      const m = st.get(c.id) ?? { ext: c.x, dir: 0 }; if ((m.dir > 0 && c.x > m.ext) || (m.dir < 0 && c.x < m.ext)) m.ext = c.x;
      if (Math.abs(c.x - m.ext) > 0.015) { const d = Math.sign(c.x - m.ext); if (m.dir && d !== m.dir) flips++; m.dir = d; m.ext = c.x; } st.set(c.id, m); } }
    expect(flips / n * 20, tr.id).toBeLessThan(0.36); // race-prod-port：v2 佈局彎多，jp4 ≈0.33
    }
  });
});
