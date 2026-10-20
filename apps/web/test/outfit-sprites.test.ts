import { ACCESSORIES } from '@chick/engine';
import { describe, expect, it } from 'vitest';
import { ANCHOR, S, speciesSprite, frontSprite, petSpriteKey } from '../src/sprites';
const diff = (a: string, b: string) => S[a].join('\n') !== S[b].join('\n');
describe('purchased outfits are drawn on every species and view', () => {
  for (const sp of ['chicken', 'duck', 'penguin', 'dino']) {
    for (const o of ['shades', 'crown']) {
      it(`${sp} + ${o}: side frames, sleeping and front view differ from the plain sprite`, () => {
        const key = petSpriteKey({ species: sp, look: o });
        for (const k of [1, 2, 's'] as const) { const n = speciesSprite(key, k); expect(n).toContain('|'); expect(diff(n, `${sp}_${k}`)).toBe(true); }
        expect(frontSprite(key)).not.toBe(frontSprite(sp));
      });
    }
    it(`${sp}: shades cover the eye pixel`, () => {
      const eye: Record<string, [number, number]> = { chicken: [7, 9], duck: [9, 8], penguin: [9, 7], dino: [10, 7] };
      const plain = S[`${sp}_1`], n = speciesSprite(`${sp}|shades`, 1), out = S[n];
      const [x, y] = eye[sp]; expect(plain[y][x]).not.toBe('.');
      const a = ANCHOR[n]; let changed = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((out[y + dy + a.oy]?.[x + dx + a.ox] ?? '.') !== (plain[y + dy]?.[x + dx] ?? '.')) changed++;
      expect(changed).toBeGreaterThanOrEqual(2); // 眼睛周圍 3×3 有被墨鏡蓋到
    });
  }
  it('every species × every accessory (evolution + outfits) differs from the plain sprite in walk, sleep and front views', () => {
    for (const sp of ['chicken', 'duck', 'penguin', 'dino']) for (const id of Object.keys(ACCESSORIES)) {
      const key = `${sp}|${id}`;
      for (const k of [1, 2, 's'] as const) { const n = speciesSprite(key, k); expect(n, `${key} ${k}`).toContain('|'); expect(diff(n, `${sp}_${k}`), `${key} ${k}`).toBe(true); }
      expect(frontSprite(key), key).not.toBe(frontSprite(sp));
    }
  });
});
