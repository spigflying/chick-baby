import { describe, expect, it } from 'vitest';
import { ACCESSORIES } from '@chick/engine';
import { S, ANCHOR, sw, sh, speciesSprite, frontSprite, petSpriteKey, COIN9 } from '../src/sprites';
import { ACC_SPRITES } from '../src/bao-sprites';

describe('寶 sprites (v1.7)', () => {
  it('every engine accessory has side and front pixel data', () => {
    for (const id of Object.keys(ACCESSORIES)) { expect(ACC_SPRITES[id], id).toBeDefined(); const a = ACC_SPRITES[id]; expect(a.side.back.length + a.side.front.length + a.side.fx.length, id).toBeGreaterThan(0); }
  });
  it('composite keeps the body size for layout and anchors the extra canvas', () => {
    const n = speciesSprite(petSpriteKey({ species: 'chicken', look: 'crown,sword' }), 1);
    expect(n).toBe('chicken_1|crown,sword');
    expect(sw(n)).toBe(sw('chicken_1')); expect(sh(n)).toBe(sh('chicken_1'));
    expect(S[n].length).toBeGreaterThan(S.chicken_1.length); expect(ANCHOR[n].oy).toBeGreaterThan(0); // 皇冠在頭上
    expect(S[n].join('')).not.toBe(S.chicken_1.join(''));
  });
  it('crown hides the hair; walk frame 2 moves body accessories with the bob', () => {
    const n1 = speciesSprite('chicken|crown', 1), n2 = speciesSprite('chicken|crown', 2);
    expect(ANCHOR[n2].oy).toBe(ANCHOR[n1].oy - 1);
  });
  it('other species keep their own sprite (accessories are drawn for the chicken only)', () => {
    expect(speciesSprite('duck|sword', 1)).toBe('duck_1'); expect(speciesSprite('chicken', 's')).toBe('chicken_s');
  });
  it('front view for the status panel', () => {
    const n = frontSprite('chicken|shades'); expect(S[n]).toBeDefined(); expect(ANCHOR[n].bw).toBe(16);
  });
  it('9×9 top-bar coin', () => { expect(COIN9).toHaveLength(9); for (const r of COIN9) expect(r).toHaveLength(9); });
});
