/**
 * v1.7 寶（進化）：孵化後累計 GAME.bao.evolveOpenMs 開放時間（與蛋的計時相同，只算開放時間）進化一次。
 * 主配件取自成長最多的能力類別；第二名 ≥ 80% 第一名時再加一個副配件；照顧得好有獎勵配件。
 * 皇冠、墨鏡不是掉落物，是道具店的「服飾」。
 */
import { createRng, nextFloat, type Rng } from './rng';
import { SPECIES } from './species';
import type { PetState, Counters } from './pet';
import type { Clock } from './hours';

export type StatCat = 'strength' | 'speed' | 'stamina' | 'weight';
export type Slot = 'head' | 'deco' | 'face' | 'back' | 'hand' | 'body' | 'feet';
export interface AccDef { name: string; slot: Slot; /** 0 = 低調，1 = 最誇張（領先越多越容易抽到） */ drama: number }
export const ACCESSORIES = {
  sword: { name: '背劍', slot: 'back', drama: 1 }, hammer: { name: '鐵鎚', slot: 'hand', drama: 0.6 }, unicorn: { name: '獨角', slot: 'head', drama: 0.8 }, horns: { name: '小彎角', slot: 'head', drama: 0.3 },
  wings: { name: '天使翅膀', slot: 'back', drama: 1 }, shoes: { name: '運動鞋', slot: 'feet', drama: 0.1 }, soccer: { name: '足球', slot: 'hand', drama: 0.6 }, basketball: { name: '籃球', slot: 'hand', drama: 0.6 }, curl: { name: '捲毛', slot: 'head', drama: 0.2 },
  ring: { name: '游泳圈', slot: 'body', drama: 0.5 }, pickaxe: { name: '十字鎬', slot: 'hand', drama: 0.6 }, shovel: { name: '鐵鏟', slot: 'hand', drama: 0.4 }, pack: { name: '登山包', slot: 'back', drama: 1 },
  jacket: { name: '外套', slot: 'body', drama: 0.3 }, scarf: { name: '圍巾', slot: 'body', drama: 0.2 }, santa: { name: '聖誕帽', slot: 'head', drama: 1 }, hat: { name: '帽子', slot: 'head', drama: 0.4 },
  bow: { name: '蝴蝶結', slot: 'deco', drama: 0 }, flower: { name: '小花', slot: 'deco', drama: 0 }, leaf: { name: '葉子毛', slot: 'head', drama: 0 }, double: { name: '雙呆毛', slot: 'head', drama: 0 },
  crown: { name: '皇冠', slot: 'head', drama: 1 }, shades: { name: '墨鏡', slot: 'face', drama: 1 },
} satisfies Record<string, AccDef>;
export type AccId = keyof typeof ACCESSORIES;
export const BAO_POOLS: Record<StatCat, AccId[]> = {
  strength: ['sword', 'hammer', 'unicorn', 'horns'],
  speed: ['wings', 'shoes', 'soccer', 'basketball', 'curl'],
  stamina: ['ring', 'pickaxe', 'shovel', 'pack'],
  weight: ['jacket', 'scarf', 'santa', 'hat'],
};
export const CARE_POOL: AccId[] = ['bow', 'flower', 'leaf', 'double'];
/** 服飾（道具店購買、每位使用者擁有、可穿脫）。 */
export const OUTFITS = { shades: { name: '墨鏡', price: 200 }, crown: { name: '皇冠', price: 1000 } } as const;
export type OutfitId = keyof typeof OUTFITS;
export const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[];
export function isOutfitId(x: unknown): x is OutfitId { return typeof x === 'string' && x in OUTFITS; }
export function isAccId(x: unknown): x is AccId { return typeof x === 'string' && x in ACCESSORIES; }
export interface BaoLook { items: AccId[]; cat: StatCat; second: StatCat | null; care: number; n: number }

/** 照顧品質 0–100：生病次數、飢餓與骯髒的開放分鐘數扣分。 */
export function careScore(c: Partial<Counters>): number {
  const s = 100 - (c.sickTimes ?? 0) * 25 - (c.hungryMin ?? 0) / 6 - (c.dirtyMin ?? 0) / 6;
  return Math.max(0, Math.min(100, Math.round(s)));
}
/** 各類別的「成長量」：（目前 − 物種初始）÷ 物種成長倍率，讓不同物種公平比較；體重不乘倍率。 */
export function growthBy(p: PetState): Record<StatCat, number> {
  const sp = SPECIES[p.speciesId] ?? SPECIES.chicken;
  return {
    strength: (p.strength - sp.base.strength) / sp.mult.strength, speed: (p.speed - sp.base.speed) / sp.mult.speed,
    stamina: (p.stamina - sp.base.stamina) / sp.mult.stamina, weight: p.weight - sp.base.weight,
  };
}
export function evolveAt(p: PetState, clock: Clock, evolveOpenMs: number): number | null {
  return p.hatchedAt === null ? null : clock.addOpen(p.hatchedAt, evolveOpenMs);
}
export function hashSeed(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function pickWeighted(rng: Rng, ids: AccId[], w: (id: AccId) => number): AccId | null {
  if (!ids.length) return null;
  const ws = ids.map(w), tot = ws.reduce((a, b) => a + b, 0); let r = nextFloat(rng) * tot;
  for (let i = 0; i < ids.length; i++) { r -= ws[i]; if (r < 0) return ids[i]; }
  return ids[ids.length - 1];
}
const CAT_ORDER: StatCat[] = ['strength', 'speed', 'stamina', 'weight'];
/** 決定外觀：以寵物 id（＋重抽次數 n）為種子，完全決定性。 */
export function rollBao(petId: string, p: PetState, n = 0): BaoLook {
  const rng = createRng(hashSeed(`${petId}#${n}`));
  const g = growthBy(p);
  const cats = [...CAT_ORDER].sort((a, b) => g[b] - g[a] || CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b));
  const top = cats[0], g0 = Math.max(0, g[top]), g1 = Math.max(0, g[cats[1]]);
  const lead = g0 > 0 ? (g0 - g1) / g0 : 0; // 0–1：第一名領先越多，越誇張的配件權重越高
  const items: AccId[] = [];
  const main = pickWeighted(rng, BAO_POOLS[top], (id) => Math.exp(3 * lead * (ACCESSORIES[id].drama - 0.5)))!;
  items.push(main);
  let second: StatCat | null = null;
  if (g0 > 0 && g1 >= 0.8 * g0) {
    second = cats[1];
    const s = pickWeighted(rng, BAO_POOLS[second].filter((id) => ACCESSORIES[id].slot !== ACCESSORIES[main].slot), () => 1);
    if (s) items.push(s);
  }
  const care = careScore(p.counters);
  if (care >= 50) {
    const used = new Set(items.map((i) => ACCESSORIES[i].slot));
    const pool = (care >= 80 ? CARE_POOL : ['bow', 'flower'] as AccId[]).filter((id) => !used.has(ACCESSORIES[id].slot));
    const c = pickWeighted(rng, pool, () => 1); if (c) items.push(c);
  }
  return { items, cat: top, second, care, n };
}
/** 比對用的鍵（排序後）。 */
export const lookKey = (items: readonly string[]) => [...items].sort().join(',');
/**
 * 實際要畫的配件（含服飾）與畫的順序。衝突規則：服飾優先；同一個欄位（slot）只留一個；
 * 帽子類（皇冠、帽子、聖誕帽）會擋掉頭上的 deco（蝴蝶結、小花）。
 */
export function resolveLook(items: readonly string[] | null | undefined, outfits: readonly string[] | null | undefined): AccId[] {
  const out: AccId[] = []; const slots = new Set<Slot>();
  for (const id of [...(outfits ?? []), ...(items ?? [])]) {
    if (!isAccId(id)) continue; const s = ACCESSORIES[id].slot;
    if (slots.has(s)) continue; slots.add(s); out.push(id);
  }
  const hatty = out.some((id) => id === 'crown' || id === 'hat' || id === 'santa');
  return out.filter((id) => !(hatty && ACCESSORIES[id].slot === 'deco'));
}
