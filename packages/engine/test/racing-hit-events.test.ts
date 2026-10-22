import { describe, it, expect } from 'vitest';
import { createRace, stepRace, fillField, snapCar, HIT_WALL, HIT_SWIPE, HIT_REAR_END, HIT_REARED } from '../src/racing';
const setup = () => { const s = createRace(2, 'tw1', fillField([{ id: 'me', name: 'me' }])); s.countdown = 0; const me = s.cars.find((c) => c.id === 'me')!; const a = s.cars.find((c) => c.ai)!; s.cars.splice(0, s.cars.length, me, a); me.z = a.z = 500; me.speed = a.speed = 50; me.x = -0.8; a.x = 0.8; return { s, me, a }; };
describe('racing v15 hit events in snapshots', () => {
  it('wall hit → kind/strength/side, carried in snapCar', () => { const { s, me } = setup(); me.x = 1.6; stepRace(s);
    expect(me.evK).toBe(HIT_WALL); expect(me.evSide).toBe(1); expect(me.evS).toBeGreaterThan(2); const row = snapCar(me); expect(row[9]).toBe(s.tick); expect(row[10]).toBe(HIT_WALL); });
  it('side swipe hits both with opposite sides', () => { const { s, me, a } = setup(); me.x = 0; a.x = 0.2; a.z = me.z + 0.3; stepRace(s);
    expect(me.evK).toBe(HIT_SWIPE); expect(a.evK).toBe(HIT_SWIPE); expect(me.evSide).toBe(-a.evSide!); });
  it('rear-end: attacker front, victim rear', () => { const { s, me, a } = setup(); me.x = a.x = 0; a.z = me.z + 3; a.speed = 30; stepRace(s);
    expect(me.evK).toBe(HIT_REAR_END); expect(a.evK).toBe(HIT_REARED); });
});
import { describe as d23, it as i23, expect as e23 } from 'vitest';
import { createRace as cr23, fillField as ff23, stepRace as sr23, snapCar as sc23, condition as cond23 } from '../src/racing';
d23('v23 HUD zones', () => {
  i23('zone damage is tracked and synced in snapCar[14..16]; condition = round(100 - damage)', () => {
    const s = cr23(1, 'tw1', ff23([{ id: 'me', name: 'me' }])); const me = s.cars.find((c) => c.id === 'me')!;
    while (s.countdown > 0) sr23(s);
    me.x = 1.6; me.speed = 100; sr23(s);
    const sn = sc23(me); e23(sn[15]).toBeGreaterThan(0); e23(sn[14]).toBe(0); e23(cond23(me)).toBe(Math.round(100 - me.damage));
  });
});
