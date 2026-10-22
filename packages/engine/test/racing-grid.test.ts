import { describe, it, expect } from 'vitest';
import { createRace, fillField } from '../src/racing';
const humans = Array.from({ length: 6 }, (_, i) => ({ id: 'h' + i, name: 'h' + i }));
const order = (seed: number) => { const s = createRace(seed, 'tw1', fillField(humans)); return s.cars; };
describe('v26 grid: humans shuffled by seed, behind all AI', () => {
  it('deterministic per seed, varies across seeds, AI always in front', () => {
    const ids = (seed: number) => order(seed).filter((c) => !c.ai).map((c) => c.id).join();
    expect(ids(1)).toBe(ids(1));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(ids)).size).toBeGreaterThan(1);
    for (const seed of [1, 2, 3]) { const cs = order(seed), lastAi = cs.map((c) => c.ai).lastIndexOf(true), firstHum = cs.findIndex((c) => !c.ai);
      expect(firstHum).toBeGreaterThan(lastAi); expect(Math.max(...cs.filter((c) => !c.ai).map((c) => c.z))).toBeLessThan(Math.min(...cs.filter((c) => c.ai).map((c) => c.z))); }
  });
});
