import { describe, expect, it } from 'vitest';
import { createRace, fillField, setRaceInput, stepRace, carStats, STOCK_PARTS, TRACKS, raceRanking, RACE_TICK_RATE } from '../src/racing';
describe('AI cars have no nitro (v21)', () => {
  it('AI never fires nitro; field still finishes; sim ranks of a stock / maxed human', () => {
    const rows: string[] = []; let bad = 0;
    for (const parts of [STOCK_PARTS, { engine: 3, gearbox: 3, dry: 3, wet: 3, nitro: 3, armorF: 3, armorS: 3, armorR: 3 }]) for (const t of TRACKS) {
      const s = createRace(11, t.id, fillField([{ id: 'me', name: 'me', car: 'falcon', parts, color: 0 }]));
      while (!s.over) {
        const c = s.cars.find((q) => q.id === 'me')!;
        setRaceInput(s, 'me', { gas: true, left: c.x > 0.2, right: c.x < -0.2, nitro: s.tick % 200 === 50 });
        for (const a of s.cars) if (a.ai) setRaceInput(s, a.id, { gas: true, nitro: true });
        stepRace(s);
        for (const a of s.cars) if (a.ai && (a.nitroT !== 0 || a.nitro !== 3)) bad++;
      }
      expect(s.cars.find((c) => c.id === 'me')!.finishedTick).not.toBeNull();
      const me = s.cars.find((c) => c.id === 'me')!;
      rows.push(`${parts === STOCK_PARTS ? 'stock' : 'max  '} ${t.id} rank ${raceRanking(s).indexOf(me) + 1} time ${((me.finishedTick ?? s.tick) / RACE_TICK_RATE).toFixed(0)}s`);
    }
    expect(bad).toBe(0);
    console.log(rows.join('\n')); void carStats;
  });
});
