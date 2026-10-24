import { describe, it, expect } from 'vitest';
import { carPixels, CAR_MODELS } from '../src/race-cars';
import { sameWidthDraw, groundHalfW, CAM_H_EXACT } from '../src/race-gfx';
import { DEMO_HITBOX, DEMO_CAR_W, fillField } from '@chick/engine';

const opW = (model: string) => (lod: number) => { let l = 1e9, r = -1; carPixels(model, 0, lod, {}).forEach((row) => row.forEach((v, i) => { if (v !== null) { l = Math.min(l, i); r = Math.max(r, i); } })); return r - l + 1; };
const drawnW = (model: string, target: number) => { const d = sameWidthDraw(opW(model), target); return opW(model)(d.lod) * d.scale; };

describe('race-demo: one car width', () => {
  it('player (falcon) and AI sprites are drawn at the same on-screen width at every distance', () => {
    const gw = groundHalfW(CAM_H_EXACT);
    for (const lat of [gw, gw * 0.6, gw * 0.3, gw * 0.12, gw * 0.05]) {
      const target = DEMO_CAR_W * lat;
      expect(drawnW('falcon', target)).toBeCloseTo(target, 6);
      expect(drawnW('ai', target)).toBeCloseTo(target, 6);
    }
  });
  it('the old way differed (player 52px canvas vs AI 48px LOD, different body widths)', () => {
    expect(opW('falcon')(-1)).not.toBe(opW('ai')(0));
  });
  it('one hitbox whose width equals the drawn car width', () => {
    expect(DEMO_HITBOX.dx).toBe(DEMO_CAR_W);
  });
  it('the demo field has only two models: the player car and the single AI model', () => {
    const models = new Set(['falcon', ...fillField([{ id: 'me', name: 'me', car: 'falcon' } as any]).filter((e) => e.ai).map((e) => e.car)]);
    expect([...models].sort()).toEqual(['ai', 'falcon']);
    expect(CAR_MODELS).not.toContain('ai');
  });
});
