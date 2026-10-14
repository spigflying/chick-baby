import { describe, expect, it } from 'vitest';
import { GuestWalkers, guestsOf, guestSprite, lanes, presenceDiff, MAX_GUESTS } from '../src/visitors';
import { S, FOOD_SPRITE, CUP_LIQUID } from '../src/sprites';

const pet = (o: any = {}) => ({ id: 'p', name: 'n', species: 'duck', status: 'alive', sleeping: false, sick: false, mood: 'ok', ...o });
const u = (id: string, p: any = pet({ id: 'p' + id })) => ({ id, display_name: 'U' + id, avatar_url: null, pet: p });

describe('visitors on the egg screen', () => {
  it('excludes the owner, dedupes, orders by id so everyone sees the same set, caps with +k', () => {
    const users = [u('f'), u('owner'), u('b'), u('e'), u('a'), u('d'), u('c'), u('b')];
    const g = guestsOf(users, 'owner');
    expect(g.shown.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(g.shown).toHaveLength(MAX_GUESTS);
    expect(g.extra).toBe(2);
    expect(guestsOf([...users].reverse(), 'owner')).toEqual(g); // 順序與到達順序無關
  });
  it('join/leave diff ignores me and the first snapshot', () => {
    expect(presenceDiff(null, [u('a')], 'me')).toEqual({ joined: [], left: [] });
    expect(presenceDiff([u('me'), u('a')], [u('me'), u('b')], 'me')).toEqual({ joined: ['Ub'], left: ['Ua'] });
  });
  it('picks sprites for alive / sleeping / egg / dead / no pet', () => {
    expect(guestSprite(pet(), 0)).toBe('duck_1');
    expect(guestSprite(pet(), 1)).toBe('duck_2');
    expect(guestSprite(pet({ sleeping: true }), 0)).toBe('duck_s');
    expect(guestSprite(pet({ status: 'egg' }), 0)).toBe('egg');
    expect(guestSprite(pet({ status: 'dead' }), 0)).toBe('ghost');
    expect(guestSprite(null, 0)).toBeNull();
  });
  it('lanes never overlap and walkers stay inside their lane', () => {
    const L = lanes(120, 4);
    for (let i = 1; i < L.length; i++) expect(L[i].x0).toBeGreaterThanOrEqual(L[i - 1].x1);
    const w = new GuestWalkers(); const ids = ['a', 'b', 'c', 'd'];
    for (let t = 0; t < 500; t++) {
      const xs = w.step(ids, (i) => L[i + 1], () => 14, () => true);
      xs.forEach((x, i) => { expect(x).toBeGreaterThanOrEqual(L[i + 1].x0); expect(x + 14).toBeLessThanOrEqual(Math.max(L[i + 1].x1, L[i + 1].x0 + 14)); });
    }
  });
  it('rose tea cup sprite has the liquid rows the drain animation erases', () => {
    const rows = S[FOOD_SPRITE.rosetea];
    for (const r of CUP_LIQUID.rows) expect(rows[r].slice(CUP_LIQUID.x0, CUP_LIQUID.x1 + 1)).toBe('2222');
  });
});

describe('poop layout handles rose tea (23 max)', () => {
  it('all 23 poops are on-screen and distinct', async () => {
    const { poopXY } = await import('../src/device');
    const ps = Array.from({ length: 23 }, (_, i) => poopXY(i));
    for (const p of ps) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + 7).toBeLessThanOrEqual(120); expect(p.y).toBeGreaterThan(14); }
    expect(new Set(ps.map((p) => `${p.x},${p.y}`)).size).toBe(23);
  });
});
