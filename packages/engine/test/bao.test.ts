import { describe, expect, it } from 'vitest';
import { stagesDue, stageAt, evolveProgress, ACCESSORIES, BAO_POOLS, CARE_POOL, GAME, OUTFITS, careScore, evolveAt, growthBy, lookKey, makeClock, newPet, parseOpenHours, resolveLook, rollBao, simulate, createRng, ALWAYS_OPEN, type PetState } from '../src';

function pet(stats: Partial<PetState>, counters: Record<string, number> = {}): PetState {
  const p = newPet('chicken', 0); p.status = 'alive'; p.hatchedAt = 0; Object.assign(p, stats); Object.assign(p.counters, counters); return p;
}
describe('寶 evolution (v1.7)', () => {
  it('evolves after 33 open hours (3 open days of 09:00–20:00), counted like the egg timer', () => {
    expect(GAME.bao.evolveOpenMs).toBe(33 * 3_600_000);
    const c = makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei'));
    const hatched = Date.parse('2026-10-12T01:00:00Z'); // 週一 09:00 台北
    const p = pet({ hatchedAt: hatched });
    expect(evolveAt(p, c, GAME.bao.evolveOpenMs)).toBe(Date.parse('2026-10-14T12:00:00Z')); // 週三 20:00 台北
    expect(evolveAt(p, ALWAYS_OPEN, GAME.bao.evolveOpenMs)).toBe(hatched + 33 * 3_600_000);
  });
  it('main accessory comes from the top stat category (normalized by species growth multiplier)', () => {
    for (const [k, cat] of [['strength', 'strength'], ['speed', 'speed'], ['stamina', 'stamina'], ['weight', 'weight']] as const) {
      const p = pet({ [k]: 60 } as any);
      const r = rollBao('pet-' + k, p);
      expect(r.cat).toBe(cat); expect(BAO_POOLS[cat]).toContain(r.items[0]); expect(r.second).toBeNull();
    }
    const duck = newPet('duck', 0); duck.status = 'alive'; duck.stamina = 14 + 13; duck.strength = 9 + 11; // 體力成長 13/1.3 = 10 < 力量 11
    expect(growthBy(duck).stamina).toBeCloseTo(10); expect(rollBao('d', duck).cat).toBe('strength');
  });
  it('is deterministic per pet id and seed+n gives a different roll', () => {
    const p = pet({ strength: 40 });
    expect(rollBao('abc', p)).toEqual(rollBao('abc', p));
    const looks = new Set(Array.from({ length: 8 }, (_, n) => lookKey(rollBao('abc', p, n).items)));
    expect(looks.size).toBeGreaterThan(1);
  });
  it('second stat ≥ 80% of the top adds a secondary accessory from that category in a different slot', () => {
    const p = pet({ strength: 10 + 20, speed: 10 + 17 });
    for (let i = 0; i < 30; i++) {
      const r = rollBao('s' + i, p);
      expect(r.second).toBe('speed');
      const sec = r.items.find((id) => BAO_POOLS.speed.includes(id));
      expect(sec).toBeDefined(); expect(ACCESSORIES[sec!].slot).not.toBe(ACCESSORIES[r.items[0]].slot);
    }
    expect(rollBao('x', pet({ strength: 30, speed: 25 })).second).toBeNull(); // 15/20 = 75%
  });
  it('care reward: good care gets one of 蝴蝶結/小花/葉子毛/雙呆毛, poor care gets none', () => {
    expect(careScore({})).toBe(100);
    expect(careScore({ sickTimes: 2, hungryMin: 60 })).toBe(40);
    const good = rollBao('g', pet({ strength: 30 }));
    expect(good.items.some((id) => CARE_POOL.includes(id))).toBe(true);
    const poor = rollBao('g', pet({ strength: 30 }, { sickTimes: 3 }));
    expect(poor.items.some((id) => CARE_POOL.includes(id))).toBe(false);
  });
  it('bigger stat leads make dramatic items more likely', () => {
    const count = (p: PetState) => { let n = 0; for (let i = 0; i < 400; i++) if (rollBao('p' + i, p).items[0] === 'sword') n++; return n; };
    const big = count(pet({ strength: 80 })), close = count(pet({ strength: 30, speed: 25 }));
    expect(big).toBeGreaterThan(close * 1.3);
  });
  it('crown/墨鏡 are outfits (not drops) and resolveLook handles slot conflicts', () => {
    expect(OUTFITS.crown.price).toBe(1000); expect(OUTFITS.shades.price).toBe(200);
    for (const pool of [...Object.values(BAO_POOLS), CARE_POOL]) { expect(pool).not.toContain('crown'); expect(pool).not.toContain('shades'); }
    expect(resolveLook(['horns', 'bow'], ['crown'])).toEqual(['crown']); // 皇冠取代頭上的角，並擋掉蝴蝶結
    expect(resolveLook(['sword', 'bow'], ['shades'])).toEqual(['shades', 'sword', 'bow']);
    expect(resolveLook(['hat', 'flower'], [])).toEqual(['hat']);
    expect(resolveLook(['nope' as any], null)).toEqual([]);
  });
  it('simulation counts sickness and hungry/dirty open minutes', () => {
    const p = pet({ hunger: 5, cleanliness: 10 });
    simulate(p, 10 * 60_000, createRng(1), { ...GAME, timeScale: 0 }, ALWAYS_OPEN);
    expect(p.counters.hungryMin).toBeCloseTo(10); expect(p.counters.dirtyMin).toBeCloseTo(10);
  });
  it('re-evolves every 77 open hours after the first 33; catch-up counts stages', () => {
    const p = newPet('chicken', 0); p.status = 'alive'; p.hatchedAt = 0; const H = 3_600_000;
    expect(stagesDue(p, ALWAYS_OPEN, 32 * H, GAME.bao)).toBe(0);
    expect(stagesDue(p, ALWAYS_OPEN, 33 * H, GAME.bao)).toBe(1);
    expect(stagesDue(p, ALWAYS_OPEN, 109 * H, GAME.bao)).toBe(1);
    expect(stagesDue(p, ALWAYS_OPEN, 110 * H, GAME.bao)).toBe(2);
    expect(stagesDue(p, ALWAYS_OPEN, (33 + 77 * 3) * H, GAME.bao)).toBe(4);
    expect(stageAt(p, ALWAYS_OPEN, 2, GAME.bao)).toBe(110 * H);
    const pr = evolveProgress(p, ALWAYS_OPEN, 120 * H, 2, GAME.bao)!;
    expect(pr.need_ms).toBe(77 * H); expect(pr.done_ms).toBe(10 * H); expect(pr.next_at).toBe(187 * H);
  });
  it('later evolutions avoid the previous main/secondary items', () => {
    for (let i = 0; i < 40; i++) {
      const p = newPet('chicken', 0); p.strength = 40; p.speed = 38;
      const a = rollBao('r' + i, p, 0, 1);
      const prev = a.items.filter((x) => !(CARE_POOL as string[]).includes(x));
      const b = rollBao('r' + i, p, 0, 2, prev);
      for (const x of prev) expect(b.items).not.toContain(x);
      expect(b.stage).toBe(2);
    }
  });
});

