import { describe, it, expect } from 'vitest';
import { createRace, stepRace, setRaceInput, fillField, slideFactor, carStats } from '../src/racing';

const drive = (track: string, parts: any) => {
  const s = createRace(3, track, fillField([{ id: 'me', name: 'me', parts }]));
  s.pickups = []; // 只量輪胎抓地：不吃路上氮氣道具
  s.cars.splice(0, s.cars.length, ...s.cars.filter((c) => c.id === 'me'));
  const me = s.cars[0]; let off = 0, n = 0;
  for (let t = 0; t < 20 * 120 && !s.over; t++) { setRaceInput(s, 'me', { gas: true, left: me.x > 0.05, right: me.x < -0.05 }); stepRace(s); if (s.countdown > 0) continue; n++; if (Math.abs(me.x) > 1) off++; }
  return off / n;
};
describe('racing v12: tire grip is clearly felt in corners', () => {
  it('centrifugal slide scales ~grip^-2.5: stock dry slides ~2.9x more than Lv3', () => {
    const f0 = slideFactor(carStats({ dry: 0 }).grip), f3 = slideFactor(carStats({ dry: 3 }).grip);
    expect(f0 / f3).toBeGreaterThan(2.5);
    expect(3 * f0).toBeGreaterThan(1.6);   // 彎度 3、252 km/h：原廠胎滑出比方向盤修正（1.6/秒）還快
    expect(3 * f3).toBeLessThan(1.2);      // 3 階胎守得住
  });
  it('flat-out driver: stock tires run wide off the road, Lv3 holds the line (dry and wet)', () => {
    const base = { engine: 3, gearbox: 3, armorF: 0, armorR: 0, armorS: 0, nitro: 0 };
    // v13 curves：外甩減半後，原廠胎只在急彎賽道偶爾衝出，3 階胎完全守住
    expect(drive('de2', { ...base, dry: 0 })).toBeGreaterThan(0.01); expect(drive('de2', { ...base, dry: 0 })).toBeLessThan(0.08); expect(drive('de2', { ...base, dry: 3 })).toBe(0);
    expect(drive('jp3', { ...base, wet: 0 })).toBeGreaterThan(0.03); expect(drive('jp3', { ...base, wet: 0 })).toBeLessThan(0.16); expect(drive('jp3', { ...base, wet: 3 })).toBeLessThan(0.02);
    expect(drive('tw4', { ...base, wet: 0 })).toBeLessThan(0.06);
  });
  it('AI is affected too but stays fair: all 19 AI finish a rain race and rarely leave the road', () => {
    const s = createRace(4, 'tw4', fillField([])); let off = 0, n = 0;
    for (let t = 0; t < 20 * 900 && !s.over; t++) { stepRace(s); if (s.countdown > 0) continue; for (const c of s.cars) { if (c.finishedTick !== null) continue; n++; if (Math.abs(c.x) > 1) off++; } }
    expect(s.cars.every((c) => c.finishedTick !== null)).toBe(true);
    console.log('AI rain off-road share', (off / n * 100).toFixed(2) + '%');
    expect(off / n).toBeLessThan(0.05);
  });
});
