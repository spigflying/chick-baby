import { describe, it, expect } from 'vitest';
import {
  createRace, stepRace, setRaceInput, fillField, trackSegs, SEG_LEN,
  STEER_RATE, CORNER_PULL, STEER_AUTH_GAS, STEER_AUTH_COAST, STEER_AUTH_NITRO,
  PULL_SP_HI, PULL_HI_MUL, SPEED_X,
} from '../src/racing';

describe('race-feel-pc: coast steer + stronger curve pull', () => {
  it('documents STEER_AUTH and CORNER_PULL targets', () => {
    expect(STEER_RATE).toBeCloseTo(0.75 * SPEED_X / 4, 6);
    // before: CORNER_PULL ≈ 0.246 (*1.4); after ≈ 0.290 (*1.65)
    expect(CORNER_PULL).toBeGreaterThan(0.27);
    expect(CORNER_PULL).toBeLessThan(0.32);
    expect(STEER_AUTH_GAS).toBeLessThan(1);
    expect(STEER_AUTH_NITRO).toBeLessThan(STEER_AUTH_GAS);
    expect(STEER_AUTH_COAST).toBeGreaterThan(1);
    expect(PULL_SP_HI).toBeGreaterThan(0.5);
    expect(PULL_HI_MUL).toBeGreaterThan(1);
  });

  it('coasting steers farther laterally than holding gas (same steer input)', () => {
    const run = (gas: boolean) => {
      const s = createRace(1, 'tw1', fillField([{ id: 'me', name: 'me', parts: { dry: 3, engine: 2, gearbox: 2 } }]));
      s.cars.splice(0, s.cars.length, ...s.cars.filter((c) => c.id === 'me'));
      const me = s.cars[0];
      // get onto a flat-ish stretch at race-ish speed
      for (let i = 0; i < 200; i++) { setRaceInput(s, 'me', { gas: true }); stepRace(s); }
      // find a near-straight segment ahead and park there
      const segs = trackSegs('tw1');
      let z = me.z;
      for (let k = 0; k < 80; k++) {
        const i = Math.floor((((z % (segs.length * SEG_LEN)) + segs.length * SEG_LEN) % (segs.length * SEG_LEN)) / SEG_LEN);
        if (Math.abs(segs[i].curve) < 0.2) break;
        z += SEG_LEN;
      }
      me.z = z; me.x = 0; me.speed = 55 * SPEED_X; me.nitroT = 0;
      const x0 = me.x;
      for (let i = 0; i < 8; i++) {
        setRaceInput(s, 'me', { gas, right: true, brake: false, left: false, nitro: false });
        stepRace(s);
      }
      return me.x - x0;
    };
    const dxGas = run(true), dxCoast = run(false);
    expect(dxCoast).toBeGreaterThan(dxGas * 1.15);
    expect(dxGas).toBeGreaterThan(0);
  });
});
