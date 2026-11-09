import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { ANIMALS, CRAFT_STATIONS, CROPS, DECOS, FARM_ITEMS, type DecoId } from '@chick/engine';
import { EAST, LAYOUT, SCENE, STORYBOOK_LAYOUT, type Box } from '../src/farm-layout';
import { iconSymbols, field, hutch, coop, bakery, jamhouse, tree, board, barn, chick, pill, background, sceneDefs, eastBackground, beehive, cowshed, dairy, balloon, stall, deco, sign } from '../src/farm-art';
import * as storybook from '../src/farm-art-storybook';

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

describe('仙境手繪主畫面', () => {
  it('12 格田與主要建築的點擊框不重疊', () => {
    const boxes = [...STORYBOOK_LAYOUT.fields, STORYBOOK_LAYOUT.hutch, STORYBOOK_LAYOUT.coop, STORYBOOK_LAYOUT.bakery,
      STORYBOOK_LAYOUT.jamhouse, STORYBOOK_LAYOUT.tree, STORYBOOK_LAYOUT.board, STORYBOOK_LAYOUT.barn, STORYBOOK_LAYOUT.eastSign];
    expect(STORYBOOK_LAYOUT.fields).toHaveLength(12);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(SCENE.w); expect(b.y + b.h).toBeLessThanOrEqual(SCENE.h);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${i} × ${j}`).toBe(false);
  });
  it('背景、成熟作物及鎖定狀態使用獨立素材並保留狀態標示', () => {
    const b = STORYBOOK_LAYOUT.fields[0];
    expect(storybook.background()).toContain('storybook-ro-a/background.webp');
    expect(storybook.field(b, 'wheat', 3, false)).toContain('storybook-ro-a/crop-wheat.webp');
    expect(storybook.field(b, 'wheat', 3, false)).not.toContain('field-empty.webp');
    expect(storybook.field(b, null, null, true, 8)).toContain('Lv 8 解鎖');
    expect(storybook.field(b, 'carrot', 1, false)).toContain('field-empty.webp');
    expect(storybook.field(EAST.fields[0], 'carrot', 3, false)).toContain('storybook-ro-a/crop-carrot.webp');
    expect(storybook.hutch(STORYBOOK_LAYOUT.hutch, [true, false], false, 2)).toContain('fi-wool');
    expect(storybook.hutch(STORYBOOK_LAYOUT.hutch, [false, false], true, 2)).toContain('storybook-ro-a/construction.webp');
    expect(storybook.hutch(STORYBOOK_LAYOUT.hutch, [false, false], true, 2)).not.toContain('storybook-ro-a/hutch.webp');
    expect(storybook.bakery(STORYBOOK_LAYOUT.bakery, true, false, 4)).toContain('class="smoke"');
  });
  it('東邊解鎖內容使用同畫風素材且保留動態狀態', () => {
    expect(storybook.eastBackground()).toContain('storybook-ro-a/background-east.webp');
    expect(storybook.beehive(EAST.beehive, [true, false], false, 8)).toContain('storybook-ro-a/beehive.webp');
    expect(storybook.beehive(EAST.beehive, [true, false], false, 8)).toContain('fi-honey');
    expect(storybook.cowshed(EAST.cowshed, [false, true], false, 10)).toContain('storybook-ro-a/cowshed.webp');
    expect(storybook.dairy(EAST.dairy, true, false, 12)).toContain('storybook-ro-a/dairy.webp');
    expect(storybook.balloon(EAST.balloon, { state: 'locked' }, 7)).toContain('storybook-ro-a/construction.webp');
    expect(storybook.balloon(EAST.balloon, { state: 'away', remainMs: 1 }, 7)).toContain('opacity=".28"');
    expect(storybook.balloon(EAST.balloon, { state: 'here', remainMs: 1, crates: [{ item: 'wheat', qty: 3, filled: false }] }, 7)).toContain('fi-wheat');
    expect(storybook.stall(EAST.stall, [{ item: 'jam', qty: 2, price: 50 }, null, null, null], false, 5)).toContain('◎50');
    for (const id of Object.keys(DECOS) as DecoId[]) expect(storybook.deco(EAST.decos[0], id, true)).toContain(`storybook-ro-a/deco-${id}.webp`);
  });
  it('目前可解鎖的作物、建築與裝飾都有對應素材', () => {
    // 新增動物站或加工站時，先補上場景版位與繪圖函式；避免只新增素材卻在升級後消失。
    expect(Object.keys(ANIMALS).sort()).toEqual(['beehive', 'coop', 'cowshed', 'hutch']);
    expect(Object.keys(CRAFT_STATIONS).sort()).toEqual(['bakery', 'dairy', 'jamhouse']);
    const names = ['background', 'background-east', 'field-empty', 'construction', 'tree-growing', 'tree-ready', 'tree-withered',
      'board', 'barn', 'balloon', 'stall', ...Object.keys(CROPS).map((id) => `crop-${id}`),
      ...Object.keys(ANIMALS), ...Object.keys(CRAFT_STATIONS), ...Object.keys(DECOS).map((id) => `deco-${id}`)];
    for (const name of names) expect(existsSync(new URL(`../src/art/farm/storybook-ro-a/${name}.webp`, import.meta.url)), name).toBe(true);
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

describe('EAST layout (phase 2)', () => {
  const things: [string, Box][] = [
    ...EAST.fields.map((b, i) => [`field${12 + i}`, b] as [string, Box]),
    ['beehive', EAST.beehive], ['cowshed', EAST.cowshed], ['dairy', EAST.dairy], ['balloon', EAST.balloon], ['stall', EAST.stall],
    ...EAST.decos.map((b, i) => [`deco${i}`, b] as [string, Box]), ['back', EAST.back],
  ];
  it('has 6 fields and 6 deco slots', () => { expect(EAST.fields).toHaveLength(6); expect(EAST.decos).toHaveLength(6); });
  it('nothing overlaps and everything stays inside the scene below the HUD', () => {
    for (const [n, b] of things) {
      expect(b.x, n).toBeGreaterThanOrEqual(0); expect(b.x + b.w, n).toBeLessThanOrEqual(SCENE.w);
      expect(b.y, n).toBeGreaterThanOrEqual(SCENE.hudH); expect(b.y + b.h, n).toBeLessThanOrEqual(SCENE.h);
    }
    for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) expect(overlap(things[i][1], things[j][1]), `${things[i][0]} × ${things[j][0]}`).toBe(false);
  });
  it('fields and buildings stay off the east path (signs sit on the path ends)', () => {
    for (const [n, b] of things) if (n !== 'back') for (const p of EAST.path) expect(overlap(b, p), `${n} on path`).toBe(false);
  });
  it('the main scene sign to the east does not cover anything', () => {
    const main: Box[] = [...LAYOUT.fields, LAYOUT.hutch, LAYOUT.coop, LAYOUT.bakery, LAYOUT.jamhouse, LAYOUT.tree, LAYOUT.board, LAYOUT.barn];
    for (const b of main) expect(overlap(b, LAYOUT.eastSign)).toBe(false);
    expect(LAYOUT.eastSign.x + LAYOUT.eastSign.w).toBeLessThanOrEqual(SCENE.w);
  });
});

describe('phase 2 art', () => {
  it('icons for the new items and art for every decoration', () => {
    const s = iconSymbols();
    for (const id of ['honey', 'milk', 'honeycake', 'cheese', 'balloon', 'stall']) expect(s).toContain(`id="fi-${id}"`);
    for (const id of Object.keys(DECOS) as DecoId[]) { const d = deco(EAST.decos[0], id, true); expect(d, id).toMatch(/<g/); expect(d).not.toBe(deco(EAST.decos[0], null, true)); }
  });
  it('drawings return SVG and keep away from the Game Boy greens', () => {
    const parts = [eastBackground(), beehive(EAST.beehive, [true, false], false, 8), beehive(EAST.beehive, [false, false], true, 8), cowshed(EAST.cowshed, [false, true], false, 10),
      dairy(EAST.dairy, true, false, 12), dairy(EAST.dairy, false, true, 12), balloon(EAST.balloon, { state: 'locked' }, 7), balloon(EAST.balloon, { state: 'away', remainMs: 1 }, 7),
      balloon(EAST.balloon, { state: 'here', remainMs: 1, crates: [{ item: 'wheat', qty: 3, filled: true, canFill: false }] }, 7),
      stall(EAST.stall, [{ item: 'jam', qty: 2, price: 50 }, null, null, null], false, 5), stall(EAST.stall, [null, null, null, null], true, 5),
      deco(EAST.decos[0], null, true), deco(EAST.decos[0], null, false), sign(EAST.back, '← 回農場', false), sign(LAYOUT.eastSign, '東邊新地', true)];
    for (const p of parts) { expect(p.length).toBeGreaterThan(20); expect(p).toMatch(/</); }
    expect(parts.join('').toLowerCase()).not.toMatch(/#9bbc0f|#8bac0f|#306230|#0f380f/);
    expect(dairy(EAST.dairy, false, false, 12)).toContain('起司小屋');
    expect(balloon(EAST.balloon, { state: 'locked' }, 7)).toContain('Lv 7');
    // 中間有空隙的圖也整個框都點得到
    expect(stall(EAST.stall, [null, null, null, null], false, 5)).toContain('<rect class="hitbg" width="200" height="96" fill="transparent"/>');
  });
});
