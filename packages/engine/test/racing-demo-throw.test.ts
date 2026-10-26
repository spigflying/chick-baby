import { describe, it, expect } from 'vitest';
import { registerMapFirstTracks, trackSegs, createRace, stepRace, setRaceInput, SEG_LEN, RACE_TICK_RATE, MAPFIRST_NOSTEER_MUL, MAPFIRST_COUNTER_MUL, MAPFIRST_NOSTEER_PUSH, TRACKS, segCurvature } from '../src/index';

registerMapFirstTracks();
type Inp = 'against' | 'none' | 'with';
/** 第一個 |curve| 符合條件的弧，從弧起點 +1 段開始 */
function arcStart(id: string, pick: (c: number) => boolean) { const segs = trackSegs(id); const i = segs.findIndex((s) => s.curve !== 0 && pick(Math.abs(s.curve))); return { z: (i + 1) * SEG_LEN, dir: Math.sign(segCurvature(segs[i].curve)) }; }
/** 固定速度、固定輸入，回傳 1 秒後往彎外的橫移（半路寬單位）與離開路面的 tick 數 */
export function throwRun(id: string, pick: (c: number) => boolean, inp: Inp, speed = 150, gas = true) {
  const s = createRace(1, id, [{ id: 'me', name: 'me' }]); s.countdown = 0; s.pickups = [];
  const me = s.cars.find((c) => c.id === 'me')!; for (const c of s.cars) if (c !== me) { c.z = -5000; c.finishedTick = 0; }
  const { z, dir } = arcStart(id, pick); me.z = z; me.x = 0;
  // pull>0（dir>0）把車往 −x 甩；往彎內打 = 與 dir 同號
  const st = inp === 'none' ? 0 : inp === 'with' ? dir : -dir;
  let offTick: number | null = null, out1s = 0;
  for (let k = 1; k <= 3 * RACE_TICK_RATE; k++) {
    me.speed = speed; setRaceInput(s, 'me', { gas, brake: false, left: st < 0, right: st > 0, nitro: false }); stepRace(s);
    if (offTick === null && Math.abs(me.x) > 1) offTick = k;
    if (k === RACE_TICK_RATE) out1s = -dir * me.x;
  }
  return { out1s, offTick };
}
const NINETY = (c: number) => c > 0 && c <= 7, HAIRPIN = (c: number) => c > 7;

describe('race-demo-throw: outward drift against > none > with (map-first only)', () => {
  it('constants', () => { expect(MAPFIRST_NOSTEER_MUL).toBeGreaterThanOrEqual(1.3); expect(MAPFIRST_NOSTEER_MUL).toBeLessThanOrEqual(1.5); expect(MAPFIRST_NOSTEER_PUSH).toBe(2); expect(MAPFIRST_COUNTER_MUL).toBeGreaterThan(MAPFIRST_NOSTEER_PUSH); });
  for (const [name, id, pick] of [['90° (mf2)', 'mf2', NINETY], ['hairpin (mf1)', 'mf1', HAIRPIN]] as const) {
    it(`${name}: ordering at the same speed`, () => {
      const a = throwRun(id, pick, 'against'), n = throwRun(id, pick, 'none'), w = throwRun(id, pick, 'with');
      if (process.env.THROW_DUMP) console.log(name, JSON.stringify({ a, n, w }));
      expect(a.out1s).toBeGreaterThan(n.out1s); expect(n.out1s).toBeGreaterThan(w.out1s); expect(n.out1s).toBeGreaterThan(0);
      expect(a.offTick ?? 1e9).toBeLessThan(n.offTick ?? 1e9);
      // Benson 目標（20 tick/s）：90° 不打 ≤1.5s、反打 ≤1s；髮夾 不打 ≤0.9s、反打 ≈0.6s
      const [nMax, aMax] = id === 'mf2' ? [30, 20] : [18, 13];
      expect(n.offTick ?? 1e9).toBeLessThanOrEqual(nMax); expect(a.offTick ?? 1e9).toBeLessThanOrEqual(aMax);
      expect(w.offTick).toBeNull();
    });
  }
  it('production tracks are map-first too (throw is global, race-prod-port)', () => { expect(TRACKS.every((t) => t.mapFirst)).toBe(true); });
});
