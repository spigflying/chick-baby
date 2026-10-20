import { describe, expect, it } from 'vitest';
import { ACCESSORIES } from '@chick/engine';
import { S, ANCHOR, speciesSprite, frontSprite } from '../src/sprites';
import { BENSON } from '../src/species-sprites';
import { SPECIES_FRONT, HAIR_ROWS } from '../src/species-acc';
const SP = ['chicken', 'duck', 'penguin', 'dino'];
describe('Benson sprites', () => {
  it('every species uses his side / walk1 / walk2 / sleep / front frames', () => {
    for (const sp of SP) {
      const b = BENSON[sp];
      expect(S[`${sp}_1`]).toEqual(b.side); expect(S[`${sp}_w`]).toEqual(b.walk1); expect(S[`${sp}_2`]).toEqual(b.walk2); expect(S[`${sp}_s`]).toEqual(b.sleep);
      expect(SPECIES_FRONT[sp]).toEqual(b.front); expect(S[frontSprite(sp)]).toEqual(b.front);
    }
  });
  it('only the 4 palette shades, fits 20×21 (scaled to the original size), stores the left / right / back views, and side / walk / sleep share one size so they stand on the same ground line', () => {
    for (const sp of SP) {
      const b = BENSON[sp], frames = [b.side, b.walk1, b.walk2, b.sleep];
      for (const f of [...frames, b.front, b.left, b.right, b.back]) { expect(f.length).toBeLessThanOrEqual(21); expect(f[0].length).toBeLessThanOrEqual(20); for (const r of f) expect(r).toMatch(/^[.0123]+$/); }
      for (const f of frames) { expect(f.length).toBe(b.side.length); expect(f[0].length).toBe(b.side[0].length); }
      expect(b.side[b.side.length - 1]).not.toMatch(/^\.+$/); // 裁掉了底下的透明列：腳踩在地上
    }
  });
  it('side views face left (the chick and duck beak is on the left)', () => {
    for (const sp of ['chicken', 'duck']) { const r = BENSON[sp].side; const lx = Math.min(...r.map((row) => row.search(/[^.]/)).filter((x) => x >= 0)); const beak = r.findIndex((row) => row.search(/[^.]/) === lx); expect(lx, sp).toBe(0); expect(beak, sp).toBeGreaterThan(2); expect(beak, sp).toBeLessThan(r.length * 0.6); }
  });
  it('the sleep frames have no baked-in Z (the game draws its own)', () => {
    for (const sp of SP) { const s = BENSON[sp].sleep; const w = s[0].length; for (let y = 0; y < 3; y++) { expect(s[y].slice(0, 5), sp).toMatch(/^\.+$/); expect(s[y].slice(w - 5), sp).toMatch(/^\.+$/); } }
  });
  it('a hair-hiding hat removes the chick tuft', () => {
    const n = speciesSprite('chicken|crown', 1), plain = S.chicken_1, oy = ANCHOR[n].oy, ox = ANCHOR[n].ox;
    expect(HAIR_ROWS.chicken.side).toBeGreaterThanOrEqual(0);
    const tuft = [...plain[0]].map((c, x) => (c !== '.' ? x : -1)).filter((x) => x >= 0);
    expect(tuft.length).toBeGreaterThan(0);
    // 頭毛那幾格現在是皇冠或透明，不是原本的呆毛色塊組合
    expect(tuft.map((x) => S[n][oy][x + ox]).join('')).not.toBe(tuft.map((x) => plain[0][x]).join(''));
  });
  it('every accessory changes every species in every pose', () => {
    for (const sp of SP) for (const id of Object.keys(ACCESSORIES)) {
      for (const k of [1, 'w', 2, 's'] as const) expect(S[speciesSprite(`${sp}|${id}`, k)], `${sp} ${k} ${id}`).not.toEqual(S[`${sp}_${k}`]);
      expect(S[frontSprite(`${sp}|${id}`)], `${sp} front ${id}`).not.toEqual(SPECIES_FRONT[sp]);
    }
  });
});
