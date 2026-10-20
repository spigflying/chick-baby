import { describe, expect, it } from 'vitest';
import { S, ANCHOR, speciesSprite, frontSprite } from '../src/sprites';
import { POSE_ART } from '../src/pose-art';
describe("Benson's cape / wings are drawn per species and pose", () => {
  for (const sp of ['chicken', 'duck', 'penguin', 'dino']) for (const id of ['cape', 'wings']) {
    it(`${sp} + ${id}`, () => {
      for (const [k, pose] of [[1, 'side'], ['w', 'walk1'], [2, 'walk2'], ['s', 'sleep']] as const) {
        const art = POSE_ART[sp][pose][id]; const n = speciesSprite(`${sp}|${id}`, k), a = ANCHOR[n];
        for (const [x, y, c] of [...art.back, ...art.front].slice(0, 20)) {
          const covered = art.front.some(([fx, fy]) => fx === x && fy === y) || S[`${sp}_${k}`][y]?.[x] === undefined || S[`${sp}_${k}`][y][x] === '.';
          if (covered) expect(S[n][y + a.oy][x + a.ox], `${pose} ${x},${y}`).toBe(String(c));
        }
      }
      expect(frontSprite(`${sp}|${id}`)).not.toBe(frontSprite(sp));
    });
  }
});
