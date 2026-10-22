import { describe, it, expect } from 'vitest';
import { createRace, stepRace, fillField, lapped, COLLIDE_DX, ROAD_WIDEN, PICKUP_LANES } from '../src/racing';
const duo = () => {
  const s = createRace(2, 'tw1', fillField([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }])); s.countdown = 0;
  const a = s.cars.find((c) => c.id === 'a')!, b = s.cars.find((c) => c.id === 'b')!; s.cars.splice(0, s.cars.length, a, b); return { s, a, b };
};
// 直線上追撞：a 在 b 後面 3 m、同一條線、快很多
const rearEnd = (lapGap: number) => { const { s, a, b } = duo(); const z = 200; b.z = z + lapGap * s.len; b.x = a.x = 0; a.z = z - 3; a.speed = 150; b.speed = 60; stepRace(s); return { s, a, b }; };
describe('v26 lapped cars + wider road', () => {
  it('same-lap rear-end still collides', () => { const { a, b } = rearEnd(0); expect(a.hits + b.hits).toBeGreaterThan(0); });
  it('a car a full lap ahead does not collide (server-authoritative skip)', () => { const { a, b } = rearEnd(1); expect(a.hits).toBe(0); expect(b.hits).toBe(0); expect(a.speed).toBeGreaterThan(100); });
  it('lapped() is symmetric and needs a full lap', () => {
    expect(lapped({ z: 0 }, { z: 1000 }, 1000)).toBe(true); expect(lapped({ z: 1000 }, { z: 0 }, 1000)).toBe(true); expect(lapped({ z: 0 }, { z: 999 }, 1000)).toBe(false);
  });
  it('road is 1.3× wider in car widths; still 3 pickup lanes', () => { expect(COLLIDE_DX).toBeCloseTo(0.38 / ROAD_WIDEN); expect(ROAD_WIDEN).toBeGreaterThanOrEqual(1.3); expect(PICKUP_LANES).toHaveLength(3); });
});
