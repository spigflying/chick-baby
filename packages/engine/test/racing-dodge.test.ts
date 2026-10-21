import { describe, it, expect } from 'vitest';
import { createRace, stepRace, setRaceInput, fillField, COLLIDE_DX, RACE_SLOTS, raceRanking } from '../src/racing';

/** v11：照 TG2 比例調寬路面後，一個簡單的閃車機器人要能一路超車、很少撞到。 */
describe('racing v11 proportions: a steering bot can pass cars', () => {
  it('solo = player + 19 AI; dodging bot overtakes most of the field with few car hits', () => {
    const s = createRace(11, 'tw1', fillField([{ id: 'me', name: 'bot', car: 'falcon', color: 0, parts: { engine: 3, gearbox: 3, dry: 3, wet: 3, nitro: 3, armorF: 0, armorR: 0, armorS: 0 } as any }]));
    expect(s.cars.length).toBe(RACE_SLOTS); expect(RACE_SLOTS).toBe(20); expect(s.cars.filter((c) => c.ai).length).toBe(19);
    const me = s.cars.find((c) => c.id === 'me')!;
    let target = 0;
    for (let t = 0; t < 20 * 90 && !s.over; t++) {
      // 前方 30m 內同一條線上有車 → 選最空的一條線（-0.6 / 0 / 0.6）
      const ahead = s.cars.filter((o) => o !== me && o.z > me.z && o.z - me.z < 30);
      const lanes = [-0.6, 0, 0.6]; const cost = (l: number) => ahead.filter((o) => Math.abs(o.x - l) < COLLIDE_DX + 0.1).reduce((a, o) => a + 1 / (o.z - me.z + 1), 0) + Math.abs(l - me.x) * 0.01;
      if (ahead.some((o) => Math.abs(o.x - me.x) < COLLIDE_DX + 0.1)) target = lanes.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      setRaceInput(s, 'me', { gas: true, left: me.x > target + 0.05, right: me.x < target - 0.05, nitro: t % 400 === 100 });
      stepRace(s);
    }
    const pos = raceRanking(s).findIndex((c) => c.id === 'me') + 1;
    expect(pos).toBeLessThanOrEqual(5);   // 從最後一名起跑，90 秒內超到前 5
    console.log('dodge bot', { pos, hits: me.hits, damage: Math.round(me.damage) });
    expect(me.hits).toBeLessThanOrEqual(15);
  });
});
