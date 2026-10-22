import { describe, it, expect } from 'vitest';
import { topSpeeds, partRows } from '../src/race-status';
describe('race status page data', () => {
  it('stock and partly-upgraded top speeds (shown km/h)', () => {
    expect(topSpeeds({}, 'falcon')).toEqual({ dry: 230, wet: 230, nitroDry: 281, nitroWet: 281 });
    const s = topSpeeds({ engine: 1, dry: 2 }, 'falcon'); expect(s.dry).toBe(245); expect(s.wet).toBe(238);
  });
  it('per-part effects with percentages', () => {
    const r = Object.fromEntries(partRows({ engine: 1, gearbox: 3, nitro: 2, armorF: 2, wet: 3 }, 'falcon').map((x) => [x.kind, x]));
    expect(r.engine.effects[0]).toContain('+6 m/s'); expect(r.engine.effects[0]).toContain('+3%');
    expect(r.gearbox.effects[0]).toContain('+27 m/s'); expect(r.gearbox.effects[0]).toContain('+14%');
    expect(r.nitro.effects[0]).toContain('9 秒'); expect(r.nitro.effects[1]).toContain('+40%');
    expect(r.armorF.effects[0]).toContain('−40%');
    expect(r.wet.effects[1]).toContain('+35%');
    expect(r.dry.level).toBe(0);
  });
});
