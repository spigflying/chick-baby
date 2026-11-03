import { describe, expect, it } from 'vitest';
import { FARM_ITEMS } from '@chick/engine';
import { LAYOUT, SCENE, type Box } from '../src/farm-layout';
import { iconSymbols, field, hutch, coop, bakery, jamhouse, tree, board, barn, chick, pill, background, sceneDefs } from '../src/farm-art';

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('LAYOUT', () => {
  const things: [string, Box][] = [
    ...LAYOUT.fields.map((b, i) => [`field${i}`, b] as [string, Box]),
    ['hutch', LAYOUT.hutch], ['coop', LAYOUT.coop], ['bakery', LAYOUT.bakery], ['jamhouse', LAYOUT.jamhouse],
    ['tree', LAYOUT.tree], ['board', LAYOUT.board], ['barn', LAYOUT.barn],
  ];
  it('has exactly 12 fields', () => { expect(LAYOUT.fields).toHaveLength(12); });
  it('nothing overlaps and everything stays inside the scene below the HUD', () => {
    for (const [n, b] of things) {
      expect(b.x, n).toBeGreaterThanOrEqual(0); expect(b.x + b.w, n).toBeLessThanOrEqual(SCENE.w);
      expect(b.y, n).toBeGreaterThanOrEqual(SCENE.hudH); expect(b.y + b.h, n).toBeLessThanOrEqual(SCENE.h);
    }
    for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) expect(overlap(things[i][1], things[j][1]), `${things[i][0]} × ${things[j][0]}`).toBe(false);
  });
  it('fields and buildings stay off the path', () => {
    for (const [n, b] of things) for (const p of LAYOUT.path) expect(overlap(b, p), `${n} on path`).toBe(false);
  });
});

describe('farm art', () => {
  it('has an icon symbol for every farm item', () => {
    const s = iconSymbols();
    for (const id of Object.keys(FARM_ITEMS)) expect(s).toContain(`id="fi-${id}"`);
    for (const id of ['coin', 'box', 'heart', 'shop', 'board', 'friend', 'home', 'oven']) expect(s).toContain(`id="fi-${id}"`);
  });
  it('every drawing returns SVG markup and never uses the Game Boy greens', () => {
    const b = LAYOUT.fields[0];
    const parts = [sceneDefs(), background(), field(b, 'wheat', 3, false), field(b, null, null, true), field(b, 'carrot', 1, false),
      hutch(LAYOUT.hutch, [true, false], false, 2), hutch(LAYOUT.hutch, [false, false], true, 2), coop(LAYOUT.coop, [false, true], false, 4),
      bakery(LAYOUT.bakery, true, false, 4), jamhouse(LAYOUT.jamhouse, false, true, 6), tree(LAYOUT.tree, 'ready'), tree(LAYOUT.tree, 'withered'),
      board(LAYOUT.board, true), barn(LAYOUT.barn), chick(480, 360, { body: '#ffe066', belly: '#fff6c4' }), pill(100, 100, '可收成', 'ready')];
    for (const p of parts) { expect(p.length).toBeGreaterThan(20); expect(p).toMatch(/</); }
    expect(parts.join('').toLowerCase()).not.toMatch(/#9bbc0f|#8bac0f|#306230|#0f380f/);
    expect(field(b, null, null, true)).toContain('Lv');
    expect(jamhouse(LAYOUT.jamhouse, false, true, 6)).toContain('果醬工坊');
  });
});
