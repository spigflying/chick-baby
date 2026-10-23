import { describe, it, expect } from 'vitest';
import {
  createRace, stepRace, setRaceInput, fillField, trackSegs, SEG_LEN, SPEED_X,
  CORNER_PULL, HAIRPIN_CURVE, HAIRPIN_PULL_EXTRA, hairpinPullMul,
  STEER_AUTH_GAS, STEER_AUTH_COAST, STEER_AUTH_NITRO,
} from '../src/racing';

describe('race-hairpin-pull: curve-magnitude extra outward pull', () => {
  it('documents hairpin thresholds without globally cranking CORNER_PULL', () => {
    expect(CORNER_PULL).toBeGreaterThan(0.27);
    expect(CORNER_PULL).toBeLessThan(0.32); // still ~0.290 (*1.65); hairpins use hairpinPullMul
    expect(HAIRPIN_CURVE).toBe(2.0);
    expect(HAIRPIN_PULL_EXTRA).toBeGreaterThan(0.4);
    expect(hairpinPullMul(0)).toBe(1);
    expect(hairpinPullMul(HAIRPIN_CURVE)).toBe(1);
    expect(hairpinPullMul(HAIRPIN_CURVE + 1)).toBeCloseTo(1 + HAIRPIN_PULL_EXTRA, 6);
    expect(hairpinPullMul(4)).toBeGreaterThan(hairpinPullMul(2.5));
    expect(STEER_AUTH_GAS).toBe(0.75);
    expect(STEER_AUTH_COAST).toBe(1.2);
    expect(STEER_AUTH_NITRO).toBe(0.68);
  });

  it('holding gas: hairpin segment drifts farther outward than a mild ~90° segment', () => {
    const drift = (targetAbsCurve: number, tol: number) => {
      const s = createRace(1, 'de2', fillField([{ id: 'me', name: 'me', parts: { dry: 2, engine: 2, gearbox: 2 } }]));
      s.cars.splice(0, s.cars.length, ...s.cars.filter((c) => c.id === 'me'));
      const me = s.cars[0];
      for (let i = 0; i < 120; i++) { setRaceInput(s, 'me', { gas: true }); stepRace(s); }
      const segs = trackSegs('de2');
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const d = Math.abs(Math.abs(segs[i].curve) - targetAbsCurve);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      expect(bestD).toBeLessThan(tol);
      const seg = segs[bestI];
      // park mid-segment; face the outward direction by starting at center
      me.z = bestI * SEG_LEN + SEG_LEN * 0.4;
      me.x = 0;
      me.speed = 58 * SPEED_X;
      me.nitroT = 0;
      const sign = Math.sign(seg.curve) || 1; // pull subtracts curve*… so x moves opposite to curve
      const x0 = me.x;
      for (let i = 0; i < 6; i++) {
        // counter-steer into the turn (same side as curve) while holding gas — still lose to hairpin pull
        setRaceInput(s, 'me', {
          gas: true,
          left: seg.curve > 0,
          right: seg.curve < 0,
          brake: false,
          nitro: false,
        });
        stepRace(s);
      }
      // outward displacement: pull moves x opposite to curve sign
      return (x0 - me.x) * sign;
    };
    const mild = drift(1.2, 0.6);
    const hair = drift(4.6, 0.6);
    expect(mild).toBeGreaterThan(0);
    expect(hair).toBeGreaterThan(mild * 1.35);
  });
});
