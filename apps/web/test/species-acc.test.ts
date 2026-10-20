import { describe, expect, it } from 'vitest';
import { ACCESSORIES } from '@chick/engine';
import { ANCHOR, S, speciesSprite, frontSprite } from '../src/sprites';
import { SPECIES_FRONT } from '../src/species-acc';
const px = (n: string, x: number, y: number) => S[n][y + ANCHOR[n].oy]?.[x + ANCHOR[n].ox] ?? '.';
describe('non-chicken accessory polish', () => {
  it('duck/penguin/dino have real front sprites (not the side view) and every accessory changes the front view', () => {
    for (const sp of ['duck', 'penguin', 'dino']) {
      expect(frontSprite(sp)).toBe(`${sp}_front|`);
      expect(S[frontSprite(sp)].join('\n')).toBe(SPECIES_FRONT[sp].join('\n'));
      for (const id of Object.keys(ACCESSORIES)) expect(S[frontSprite(`${sp}|${id}`)].join('\n'), `${sp} ${id}`).not.toBe(S[frontSprite(sp)].join('\n'));
    }
  });
  it('coat on duck/penguin/dino is a solid shape with an opening line and buttons (not stripes)', () => {
    for (const sp of ['chicken', 'duck', 'penguin', 'dino']) for (const n of [speciesSprite(`${sp}|jacket`, 1), frontSprite(`${sp}|jacket`)]) {
      const plain = n.startsWith(`${sp}_front`) ? SPECIES_FRONT[sp] : S[`${sp}_1`];
      let changed = 0; plain.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.' && px(n, x, y) !== c) changed++; }));
      expect(changed, n).toBeGreaterThan(20);
    }
  });
});
