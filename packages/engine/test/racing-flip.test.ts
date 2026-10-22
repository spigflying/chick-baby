import { describe, it, expect } from 'vitest';
import { createRace, stepRace, fillField, roadside, snapCar, FLIP_TICKS, HIT_OBJECT, HIT_WALL, SPEED_X } from '../src/racing';
const solo = () => { const s = createRace(2, 'tw1', fillField([{ id: 'me', name: 'me' }])); s.countdown = 0; const me = s.cars.find((c) => c.id === 'me')!; s.cars.splice(0, s.cars.length, me); return { s, me }; };
describe('racing v16 roadside objects + flip', () => {
  it('roadside objects are deterministic and off-track (1.2–1.5 half-road)', () => {
    const a = roadside('tw1'), b = roadside('tw1'); expect(a).toEqual(b); expect(a.length).toBeGreaterThan(10);
    for (const o of a) { expect(Math.abs(o.x)).toBeGreaterThanOrEqual(1.2); expect(Math.abs(o.x)).toBeLessThanOrEqual(1.5); }
  });
  it('hitting a solid object flips the car, then it resets on the road edge at low speed', () => {
    const { s, me } = solo(); const o = roadside('tw1').find((o) => o.solid && o.z > 400)!;
    me.z = o.z - 10; me.x = o.x; me.speed = 50; const d0 = me.damage;
    for (let i = 0; i < 6 && !me.flip; i++) stepRace(s);
    expect(me.flip).toBeGreaterThan(0); expect(me.evK).toBe(HIT_OBJECT); expect(me.damage - d0).toBeGreaterThan(4); expect(snapCar(me)[13]).toBe(me.flip);
    for (let i = 0; i < FLIP_TICKS; i++) stepRace(s);
    expect(me.flip).toBe(0); expect(Math.abs(me.x)).toBeLessThan(1); expect(me.speed).toBeLessThan(12.5 * SPEED_X);
  });
  it('road-edge wall hit does not flip', () => { const { s, me } = solo(); me.z = 3; me.x = 1.6; me.speed = 50; stepRace(s); expect(me.evK).toBe(HIT_WALL); expect(me.flip ?? 0).toBe(0); });
});
