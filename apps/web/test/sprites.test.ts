import { describe, expect, it } from 'vitest';
import { S, speciesSprite } from '../src/sprites';

describe('sprites', () => {
  it('every species has walk ×2 + sleep frames with uniform width', () => {
    for (const sp of ['chicken', 'duck', 'penguin', 'dino']) {
      for (const k of [1, 2, 's'] as const) {
        const rows = S[speciesSprite(sp, k)];
        expect(rows, `${sp}_${k}`).toBeTruthy();
        const w = rows[0].length;
        expect(rows.every((r) => r.length === w), `${sp}_${k} width`).toBe(true);
        expect(rows.join('')).toMatch(/^[.0-3]+$/);
      }
      expect(S[speciesSprite(sp, 's')].join()).not.toBe(S[speciesSprite(sp, 2)].join()); // 閉眼
    }
  });
  it('unknown species falls back to chicken', () => { expect(speciesSprite('zzz', 1)).toBe('chicken_1'); });
});
