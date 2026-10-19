import { describe, expect, it } from 'vitest';
import { ACCESSORIES, BAO_POOLS, CARE_POOL, CARE_POOL_MID, OUTFITS, OUTFIT_IDS, HATS, newPet, resolveLook, rollBao, wearOutfitList, type AccId } from '../src';

const NEW: Record<string, string[]> = {
  strength: ['pan', 'dumbbell', 'gloves', 'mace', 'shield', 'armband'],
  speed: ['skateboard', 'skates', 'boltband', 'goggles', 'copter', 'cape'],
  stamina: ['propcap', 'monitor', 'hardhat', 'flashlight', 'bottle', 'snorkel'],
  weight: ['tie', 'chef', 'donut', 'bib', 'nightcap', 'beanie'],
};
const CARE_NEW = ['heartclip', 'cherry', 'dandelion', 'star', 'rainbow'];
const SHOP_NEW = ['wizard', 'eyepatch', 'headphones', 'monocle', 'paperbag', 'eggshell'];

describe('v2.0 35 件新配件', () => {
  it('每個能力類別的進化池都多了 6 件，舊的還在', () => {
    for (const [cat, ids] of Object.entries(NEW)) {
      for (const id of ids) expect(BAO_POOLS[cat as keyof typeof BAO_POOLS]).toContain(id);
      expect(BAO_POOLS[cat as keyof typeof BAO_POOLS].length).toBeGreaterThanOrEqual(10);
    }
    expect(BAO_POOLS.strength.slice(0, 4)).toEqual(['sword', 'hammer', 'unicorn', 'horns']);
    // 一件配件只屬於一個池
    const all = Object.values(BAO_POOLS).flat(); expect(new Set(all).size).toBe(all.length);
  });
  it('照顧獎勵：5 件新的都在 ≥80 池；50–79 池只有少數幾件（含 2 件新的）', () => {
    for (const id of CARE_NEW) expect(CARE_POOL).toContain(id);
    expect(CARE_POOL_MID).toEqual(['bow', 'flower', 'heartclip', 'star']);
    for (const id of CARE_POOL_MID) expect(CARE_POOL).toContain(id);
  });
  it('服飾：6 款新的進商店，價格介於墨鏡與皇冠之間；不在掉落池裡', () => {
    for (const id of SHOP_NEW) { expect(OUTFIT_IDS).toContain(id); const p = (OUTFITS as any)[id].price; expect(p).toBeGreaterThanOrEqual(150); expect(p).toBeLessThanOrEqual(600); }
    expect(OUTFITS.shades.price).toBe(200); expect(OUTFITS.crown.price).toBe(1000);
    const drops = [...Object.values(BAO_POOLS).flat(), ...CARE_POOL] as string[];
    for (const id of OUTFIT_IDS) expect(drops).not.toContain(id);
  });
  it('都有中文名稱與部位；領帶、圍兜在脖子', () => {
    for (const id of [...Object.values(NEW).flat(), ...CARE_NEW, ...SHOP_NEW]) { const a = (ACCESSORIES as any)[id]; expect(a?.name).toMatch(/[\u4e00-\u9fff]/); expect(a.slot).toBeTruthy(); }
    expect(ACCESSORIES.tie.slot).toBe('neck'); expect(ACCESSORIES.bib.slot).toBe('neck');
  });
  it('同部位只穿一件服飾（頭、臉各一）', () => {
    expect(wearOutfitList(['crown'], 'wizard', true)).toEqual(['wizard']);
    expect(wearOutfitList(['crown', 'shades'], 'monocle', true)).toEqual(['crown', 'monocle']);
    expect(wearOutfitList(['wizard', 'eyepatch'], 'wizard', false)).toEqual(['eyepatch']);
    expect(wearOutfitList(['headphones'], 'eyepatch', true)).toEqual(['headphones', 'eyepatch']);
  });
  it('紙袋／蛋殼會擋掉臉上的配件；新帽子擋掉頭頂裝飾', () => {
    expect(resolveLook(['sword', 'bow'], ['paperbag', 'shades'])).toEqual(['paperbag', 'sword']);
    expect(resolveLook(['goggles', 'star'], ['eggshell'])).toEqual(['eggshell']);
    expect(resolveLook(['chef', 'heartclip'], [])).toEqual(['chef']);
    expect(HATS.has('crown') && HATS.has('wizard')).toBe(true);
  });
  it('rollBao 會抽到新配件（很多隻寵物裡每件新掉落物至少出現一次），戴帽子時不配頭頂裝飾', () => {
    const seen = new Set<string>();
    for (const cat of ['strength', 'speed', 'stamina', 'weight'] as const) {
      for (let i = 0; i < 400; i++) {
        const p = newPet('chicken', 0); (p as any)[cat] += 50; p.counters = { sickTimes: 0, hungryMin: 0, dirtyMin: 0 } as any;
        const look = rollBao(`pet-${cat}-${i}`, p);
        look.items.forEach((x) => seen.add(x));
        if (look.items.some((x) => HATS.has(x))) expect(look.items.some((x) => ACCESSORIES[x as AccId].slot === 'deco')).toBe(false);
      }
    }
    for (const id of [...Object.values(NEW).flat(), ...CARE_NEW]) expect(seen.has(id), id).toBe(true);
    for (const id of SHOP_NEW) expect(seen.has(id)).toBe(false);
  });
});
