import { describe, expect, it } from 'vitest';
import { ACCESSORIES } from '@chick/engine';
import { ANCHOR, S, speciesSprite, frontSprite } from '../src/sprites';
import { SPECIES_FRONT } from '../src/species-acc';
const px = (n: string, x: number, y: number) => S[n][y + ANCHOR[n].oy]?.[x + ANCHOR[n].ox] ?? '.';
const count = (n: string, c: string) => S[n].join('').split(c).length - 1;
describe('non-chicken accessory polish', () => {
  it('duck/penguin/dino have real front sprites (not the side view) and every accessory changes the front view', () => {
    for (const sp of ['duck', 'penguin', 'dino']) {
      expect(frontSprite(sp)).toBe(`${sp}_front|`);
      expect(S[frontSprite(sp)].join('\n')).toBe(SPECIES_FRONT[sp].join('\n'));
      for (const id of Object.keys(ACCESSORIES)) expect(S[frontSprite(`${sp}|${id}`)].join('\n'), `${sp} ${id}`).not.toBe(S[frontSprite(sp)].join('\n'));
    }
  });
  it('front sprites have the eyes where the chicken front has them (x=5, x=10) so face items line up', () => {
    const eyeRow: Record<string, number> = { duck: 3, penguin: 3, dino: 4 };
    for (const sp of ['duck', 'penguin', 'dino']) { const r = SPECIES_FRONT[sp][eyeRow[sp]]; expect(r[5]).not.toBe(r[4]); expect(r[10]).not.toBe(r[9]); }
  });
  it('duck hats are small: the eye stays visible (side) and the hat is narrower than the chicken one', () => {
    for (const id of ['hat', 'santa']) {
      const n = speciesSprite(`duck|${id}`, 1); expect(px(n, 6, 2), id).toBe(S.duck_1[2][6]);
      const ink = (k: string) => S[k].join('').replace(/\./g, '').length;
      expect(ink(n) - ink('duck_1'), id).toBeLessThan(ink(speciesSprite(`chicken|${id}`, 1)) - ink('chicken_1'));
    }
  });
  it('dino crown is scaled down (not top-heavy) and dino hats sit over the head', () => {
    const d = speciesSprite('dino|crown', 1), c = speciesSprite('chicken|crown', 1);
    expect(ANCHOR[d].oy).toBeLessThan(ANCHOR[c].oy);
    for (const id of ['hat', 'santa']) { const n = speciesSprite(`dino|${id}`, 1); expect(px(n, 2, 3), id).toBe(S.dino_1[3][2]); expect(ANCHOR[n].bw).toBe(19); expect(S[n][0].length).toBeLessThanOrEqual(20); }
  });
  it('coat on duck/penguin/dino is a solid shape with an opening line and buttons (not stripes)', () => {
    for (const sp of ['duck', 'penguin', 'dino']) for (const n of [speciesSprite(`${sp}|jacket`, 1), frontSprite(`${sp}|jacket`)]) {
      const plain = n.startsWith(`${sp}_front`) ? SPECIES_FRONT[sp] : S[`${sp}_1`];
      let changed = 0; plain.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.' && px(n, x, y) !== c) changed++; }));
      expect(changed, n).toBeGreaterThan(20);
    }
  });
  it('penguin shades get a light rim so they show on the dark head', () => {
    for (const n of [speciesSprite('penguin|shades', 1), frontSprite('penguin|shades')]) expect(count(n, '1')).toBeGreaterThan(count(n.startsWith('penguin_front') ? 'penguin_front|' : 'penguin_1', '1'));
  });
});
