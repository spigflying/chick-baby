/**
 * 賽車模式 v5（機制參考 SNES 時代的偽 3D 錦標賽賽車；畫面、名稱、賽道都是原創）。
 * 純邏輯、決定性：伺服器權威模擬，客戶端內插畫面。
 * 單位：距離 m、速度 m/s、tick = 1/RACE_TICK_RATE 秒；賽道由路段組成，每段 SEG_LEN 公尺。
 * v5 規則（使用者最終決定）：20 台車（空位補電腦）、玩家從最後發車、前 10 名晉級、前 6 名拿獎金與積分、
 * 每國 4 站、每場 3 次氮氣、沒有油量；完美度（condition）每次碰撞都會降低、每降一點極速就少一點；
 * 比賽之間只修好撞壞的部分（完美度回到 100%），其他（獎金、零件、進度）都保留。
 */
import { createRng, nextFloat, type Rng } from './rng';

export const RACE_TICK_RATE = 20;
/** v20：整體速度倍率（極速、加速、煞車、碰撞門檻都乘這個；操控用「速度／(70×SPEED_X)」正規化） */
export const SPEED_X = 4;
/** 每 tick 物理子步數（速度變快後避免碰撞穿過去） */
export const SUBSTEPS = 4;
export const SEG_LEN = 20;
export const RACE_SLOTS = 20;
export const NITRO_PER_RACE = 3;
/** v11：車與車的橫向碰撞寬度（半路寬＝1）。畫面上車寬 ≈ 0.44 半路寬（TG2 比例：車 ≈ 路寬 1/4.5），碰撞取畫面車寬的約 80%（0.38），比較好閃。 */
export const COLLIDE_DX = 0.38;
export const QUALIFY_RANK = 10;
export const RACES_PER_COUNTRY = 4;
export const RACE_ENGINE_VERSION = 2;
/** 每多一個國家電腦車變強多少（原本 0.055） */
export const AI_COUNTRY = 0.03;

// ---------------- 改裝店（TG2）：8 類 × 4 項（原廠標準免費＋升級 1／2／3 階） ----------------
// 價格＝TG2 原價 ÷ PRICE_DIVISOR（v21 起 5，也就是 TG2 原價 ÷5）（保留 TG2 的價格比例），單位＝寵物金幣 ◎（錢從下樓梯來，見 docs/racing.md 經濟）。
// 任何一階都可以直接買；換到別的階（包括降級）舊零件直接丟掉、全額付款、不退錢。原廠標準＝免費。
export type PartKind = 'engine' | 'gearbox' | 'nitro' | 'dry' | 'wet' | 'armorF' | 'armorR' | 'armorS';
export interface PartTier { name: string; price: number; tg2: number }
export const PRICE_DIVISOR = 5; // v21：全部零件價格 ÷10（TG2 原價 ÷5）
export const TIER_NAMES = ['原廠標準', '升級 1 階', '升級 2 階', '升級 3 階'];
/** price 可指定明確售價（覆蓋 TG2 ÷ PRICE_DIVISOR），tg2 欄位仍保留原價 */
const tiers = (tg2: number[], price?: number[]): PartTier[] => [0, ...tg2].map((v, i) => ({ name: TIER_NAMES[i], price: i ? (price?.[i - 1] ?? v / PRICE_DIVISOR) : 0, tg2: v }));
export const PARTS: Record<PartKind, { label: string; desc: string; tiers: PartTier[] }> = {
  engine: { label: '引擎', desc: '加速＋極速（每階 +2.5 加速、+10 km/h）', tiers: tiers([30000, 50000, 80000], [2000, 5000, 7000]) },
  gearbox: { label: '變速箱', desc: '極速（每階 +14 km/h，跟引擎各自相加）', tiers: tiers([10000, 30000, 50000], [2000, 4000, 6000]) },
  nitro: { label: '氮氣', desc: '噴更久：原廠 5 秒，每階 +2 秒（7／9／11 秒）；推力不變，每場一律 3 次', tiers: tiers([5000, 15000, 30000]) },
  dry: { label: '乾地胎', desc: '晴天、夜晚、霧天的抓地與過彎；每階極速 +5 km/h', tiers: tiers([1000, 2000, 4000]) },
  wet: { label: '雨胎', desc: '下雨、下雪時自動換上；每階極速 +5 km/h（雨雪天）', tiers: tiers([1000, 2000, 3000]) },
  armorF: { label: '前裝甲', desc: '追撞前車時少掉完美度', tiers: tiers([5000, 10000, 20000]) },
  armorR: { label: '後裝甲', desc: '被後車撞時少掉完美度', tiers: tiers([5000, 10000, 20000]) },
  armorS: { label: '側裝甲', desc: '擦撞路邊與側面碰撞少掉完美度', tiers: tiers([5000, 10000, 20000]) },
};
export const PART_KINDS = Object.keys(PARTS) as PartKind[];
export type Parts = Record<PartKind, number>;
export const STOCK_PARTS: Parts = { engine: 0, gearbox: 0, dry: 0, wet: 0, nitro: 0, armorF: 0, armorS: 0, armorR: 0 };
export const normParts = (p: any): Parts => { const o = { ...STOCK_PARTS }; for (const k of PART_KINDS) o[k] = Math.max(0, Math.min(PARTS[k].tiers.length - 1, Math.floor(Number(p?.[k]) || 0))); if (p?.armor && !p.armorS) o.armorS = Math.min(3, p.armor); return o; };
export function partPrice(kind: PartKind, tier: number) { return PARTS[kind]?.tiers[tier]?.price ?? null; }
/** 全部升到 3 階要多少 ◎（直接買 3 階，不用一階一階買） */
export const MAX_OUT_COST = (Object.keys(PARTS) as PartKind[]).reduce((n, k) => n + PARTS[k].tiers[3].price, 0);

/** 玩家車款：9 款原創外觀，免費隨意換、性能完全一樣（TG2 的改裝店只賣零件和塗裝；性能全部來自零件）。電腦車一律用灰色通用車。 */
export interface CarModel { id: string; name: string; price: number; top: number; accel: number; grip: number; tough: number; desc: string }
const car = (id: string, name: string, desc: string): CarModel => ({ id, name, price: 0, top: 1, accel: 1, grip: 1, tough: 1, desc });
export const CARS: CarModel[] = [
  car('falcon', '隼 GT', 'GT3 賽車'), car('arrow', '箭 RS', '楔形超跑'), car('muscle', '野馬 V8', '肌肉車'),
  car('rally', '鷹 拉力', '拉力掀背'), car('rhino', '犀 R', '四驅性能跑車'), car('drift', '鬼 甩尾', '日系寬體'),
  car('comet', '彗星 Z', '後置引擎經典跑車'), car('lmp', '曙 LMP', '利曼原型車'), car('f1', '燕 F1', '開輪方程式'),
];
export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];
/** 8 種免費塗裝（TG2）。四階綠畫面裡用「深淺搭配＋花紋」區分，見 web race-cars.ts LIVERIES。 */
export const PAINT_NAMES = ['紅', '灰', '綠', '淺藍', '深藍', '黃', '黑', '紫'];
export const PAINTS = PAINT_NAMES.length;

/** 雨胎各階抓地（v12b 調整：原廠胎約 12% 時間被甩出路面、1 階約 9%、3 階約 2%；都不碰 slideFactor 上限 1.4） */
export const WET_GRIP = [0.845, 0.925, 1.03, 1.14];
export interface CarStats { topSpeed: number; /** v21：輪胎加極速（m/s，乾地胎／雨胎各自，依天氣用哪一組） */ tireTopDry: number; tireTopWet: number; accel: number; grip: number; wetGrip: number; nitroBoost: number; nitroTicks: number; armor: { F: number; S: number; R: number } }
/** v21：輪胎每階極速 +1（原廠 64 的約 1.5%；變速箱 +3、引擎 +2） */
export const TIRE_TOP = 1;
export function carStats(partsIn: Partial<Parts>, carId = 'falcon'): CarStats {
  const p = normParts(partsIn), c = carById(carId);
  const tough = (c.tough - 1) * 0.4;
  const arm = (lv: number) => Math.max(0, Math.min(0.75, lv * 0.2 + tough));
  return {
    topSpeed: (64 + p.engine * 2 + p.gearbox * 3) * c.top * SPEED_X,   // 引擎、變速箱各自加極速、直接相加（不互相卡）；全滿 79 m/s ≈ 284 km/h
    tireTopDry: p.dry * TIRE_TOP * c.top * SPEED_X, tireTopWet: p.wet * TIRE_TOP * c.top * SPEED_X,
    accel: (13 + p.engine * 2.5 + (p.gearbox >= 2 ? 1 : 0)) * c.accel * SPEED_X,
    grip: (1 + p.dry * 0.18) * c.grip,
    wetGrip: WET_GRIP[Math.max(0, Math.min(3, p.wet | 0))] * c.grip,
    nitroBoost: 1.22 + p.nitro * 0.09,
    nitroTicks: RACE_TICK_RATE * (5 + p.nitro * 2), // v18：氮氣持續 5／7／9／11 秒
    armor: { F: arm(p.armorF), S: arm(p.armorS), R: arm(p.armorR) },
  };
}

// ---------------- 錦標賽：國家 × 4 站 ----------------
export type Scenery = 'city' | 'coast' | 'desert' | 'forest' | 'snow' | 'farm';
export type Weather = 'clear' | 'rain' | 'night' | 'snow' | 'fog';
/** 路段：[段數, 彎度（正＝右彎）, 坡度（正＝上坡）] */
export type Piece = [number, number, number];
export interface Track { id: string; name: string; country: string; countryId: string; countryIdx: number; raceIdx: number; scenery: Scenery; weather: Weather; laps: number; ai: number; pieces: Piece[] }
export interface Country { id: string; name: string; tracks: string[] }
type TrackDef = [string, string, Scenery, Weather, number, number]; // id 名稱 景色 天氣 圈數 路線種子
const COUNTRY_DEFS: [string, string, TrackDef[]][] = [
  ['tw', '台灣', [['tw1', '河濱大道', 'city', 'clear', 3, 11], ['tw2', '陽明山霧道', 'forest', 'fog', 3, 12], ['tw3', '港都夜景', 'city', 'night', 3, 13], ['tw4', '東海岸雨線', 'coast', 'rain', 3, 14]]],
  ['jp', '日本', [['jp1', '箱根山道', 'forest', 'clear', 3, 21], ['jp2', '首都高夜行', 'city', 'night', 3, 22], ['jp3', '雨中賽道', 'farm', 'rain', 3, 23], ['jp4', '北國雪原', 'snow', 'snow', 3, 24]]],
  ['us', '美國', [['us1', '沙漠直線', 'desert', 'clear', 3, 31], ['us2', '紅岩峽谷', 'desert', 'clear', 3, 32], ['us3', '霓虹賭城', 'city', 'night', 3, 33], ['us4', '一號公路霧', 'coast', 'fog', 3, 34]]],
  ['de', '德國', [['de1', '黑森林', 'forest', 'rain', 3, 41], ['de2', '北環霧中', 'forest', 'fog', 3, 42], ['de3', '阿爾卑斯雪', 'snow', 'snow', 3, 43], ['de4', '無限速公路', 'farm', 'clear', 3, 44]]],
];
/** 用種子產生路線：直線、左右彎、坡；越後面的國家彎越急。 */
function makePieces(seed: number, hard: number): Piece[] {
  const r = createRng(seed); const out: Piece[] = [[18, 0, 0]];
  let total = 18;
  while (total < 150 + hard * 15) {
    const kind = nextFloat(r);
    const n = 8 + Math.floor(nextFloat(r) * 18);
    const curve = kind < 0.35 ? 0 : (nextFloat(r) < 0.5 ? -1 : 1) * Math.round((1 + nextFloat(r) * (2.5 + hard)) * 10) / 10;
    const hill = nextFloat(r) < 0.45 ? Math.round((nextFloat(r) * 4 - 2) * 10) / 10 : 0;
    out.push([n, curve, hill]); total += n;
  }
  out.push([14, 0, 0]);
  return out;
}
export const COUNTRIES: Country[] = COUNTRY_DEFS.map(([id, name, ts]) => ({ id, name, tracks: ts.map((t) => t[0]) }));
export const TRACKS: Track[] = COUNTRY_DEFS.flatMap(([cid, cname, ts], ci) => ts.map(([id, name, scenery, weather, laps, seed], ri) => ({
  id, name, country: cname, countryId: cid, countryIdx: ci, raceIdx: ri, scenery, weather, laps, ai: 0.78 + ci * AI_COUNTRY + ri * 0.01, pieces: makePieces(seed, ci),
})));
export const trackById = (id: string) => TRACKS.find((t) => t.id === id) ?? null;
export interface Segment { curve: number; y: number }
export function buildTrack(t: Track): Segment[] {
  const segs: Segment[] = []; let y = 0;
  for (const [n, curve, hill] of t.pieces) for (let i = 0; i < n; i++) {
    const e = Math.min(1, i / 5, (n - 1 - i) / 5 + 0.2);
    y += hill * 0.9 * Math.sin((i / n) * Math.PI);
    segs.push({ curve: curve * e, y });
  }
  const dy = segs[segs.length - 1].y; segs.forEach((s, i) => { s.y -= (dy * (i + 1)) / segs.length; });
  return segs;
}
// ---------------- v16 路邊物（樹、輪胎堆、招牌…）：位置固定（由賽道決定），伺服器與畫面共用 ----------------
export const SCENE_PROPS: Record<Scenery, string[]> = { city: ['tyres', 'bush', 'pine', 'bush'], forest: ['pine', 'pine', 'rock', 'bush', 'tyres'], desert: ['cactus', 'rock', 'sign', 'tyres'], farm: ['fence', 'hay', 'pine', 'bush', 'tyres'], coast: ['palm', 'palm', 'sign', 'tyres', 'bush'], snow: ['snowpine', 'rock', 'snowpine', 'tyres'] };
/** 撞到會翻車的硬物（矮樹叢不算） */
export const SOLID_PROPS = new Set(['pine', 'snowpine', 'cactus', 'palm', 'tyres', 'sign', 'rock', 'fence', 'hay', 'lamp', 'tower']);
export const propHash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return x / 4294967296; };
export interface Roadside { seg: number; z: number; side: number; x: number; name: string; solid: boolean }
const sideCache = new Map<string, Roadside[]>();
/** 每 4 段一組、左右各一個（約 1/4 空著）；x（半路寬）在 1.2–1.5 之間，在路邊護欄（1.55）以內，衝出路面就可能撞上。 */
export function roadside(trackId: string): Roadside[] {
  let r = sideCache.get(trackId); if (r) return r; r = [];
  const t = trackById(trackId)!, n = trackSegs(trackId).length, names = SCENE_PROPS[t.scenery];
  for (let seg = 0; seg < n; seg += 4) for (const side of [-1, 1]) {
    const h = propHash(seg * 2 + (side > 0 ? 1 : 0)); if (h < 0.25) continue;
    const name = names[Math.floor(h * 97) % names.length];
    r.push({ seg, z: seg * SEG_LEN, side, x: side * (1.2 + (h - 0.25) / 0.75 * 0.3), name, solid: SOLID_PROPS.has(name) });
  }
  sideCache.set(trackId, r); return r;
}
export const FLIP_TICKS = 26; // 翻車約 1.3 秒
export const PROP_HIT_DX = 0.2;
export const trackLength = (segs: Segment[]) => segs.length * SEG_LEN;

// ---------------- 獎金、積分、晉級（同一張表，每條賽道一樣） ----------------
/** 獎金（◎ 寵物金幣）：保留 TG2 10:6:4:3:2:1 比例，但壓低到「每分鐘賺得比下樓梯少」，錢主要還是從下樓梯來。 */
export const PRIZES = [60, 36, 24, 18, 12, 6];
export const POINTS = [10, 6, 4, 3, 2, 1];
export const prizeFor = (rank: number) => PRIZES[rank - 1] ?? 0;
export const pointsFor = (rank: number) => POINTS[rank - 1] ?? 0;
/** 19 位電腦車手（名字固定，讓同一國 4 站的積分榜能累積）。skill 是基礎實力。 */
export const AI_DRIVERS: { name: string; skill: number }[] = [
  '阿飛', '雷霆', '閃電', '老鷹', '疾風', '白鯨', '火狐', '黑豹', '銀狼', '小黃', '山貓', '海燕', '鐵牛', '飛魚', '青龍', '赤兔', '夜梟', '流星', '野狼',
].map((name, i) => ({ name, skill: 1.06 - i * 0.012 }));

/** 錦標賽進度（存在玩家檔案裡）。points 以車手名稱為鍵，自己用 ME。 */
export interface Cup { country: number; race: number; points: Record<string, number> }
export const ME = '__me';
export const newCup = (country = 0): Cup => ({ country, race: 0, points: {} });
export const cupTrack = (cup: Cup) => TRACKS.find((t) => t.countryIdx === cup.country && t.raceIdx === cup.race) ?? null;
export interface CupResult { cup: Cup; counted: boolean; qualified: boolean; countryDone: boolean; champion: boolean; unlocked: number; standings: [string, number][] }
/**
 * 一場比賽結束後更新錦標賽：只有跑的是「目前這站」才算。名次 > 10 沒晉級＝這個國家重來；
 * 4 站跑完：國家積分第一名（同分算玩家贏）就解鎖下一個國家，否則重跑這個國家。
 */
export function settleCup(cupIn: Cup, unlocked: number, trackId: string, ranking: { key: string; rank: number }[]): CupResult {
  const cup: Cup = { country: cupIn.country, race: cupIn.race, points: { ...cupIn.points } };
  const t = trackById(trackId), cur = cupTrack(cup);
  const standings = () => Object.entries(cup.points).sort((a, b) => b[1] - a[1] || (a[0] === ME ? -1 : b[0] === ME ? 1 : 0));
  const mine = ranking.find((r) => r.key === ME);
  if (!t || !cur || t.id !== cur.id || !mine) return { cup, counted: false, qualified: !!mine && mine.rank <= QUALIFY_RANK, countryDone: false, champion: false, unlocked, standings: standings() };
  if (mine.rank > QUALIFY_RANK) { const st = standings(); return { cup: newCup(cup.country), counted: true, qualified: false, countryDone: false, champion: false, unlocked, standings: st }; }
  for (const r of ranking) { const p = pointsFor(r.rank); if (p) cup.points[r.key] = (cup.points[r.key] ?? 0) + p; }
  cup.race++;
  const st = standings();
  if (cup.race < RACES_PER_COUNTRY) return { cup, counted: true, qualified: true, countryDone: false, champion: false, unlocked, standings: st };
  const champion = st.length > 0 && st[0][0] === ME;
  const next = champion ? Math.min(COUNTRIES.length - 1, cup.country + 1) : cup.country;
  const unl = champion ? Math.max(unlocked, Math.min(COUNTRIES.length, cup.country + 2)) : unlocked;
  return { cup: newCup(champion && cup.country + 1 < COUNTRIES.length ? next : cup.country), counted: true, qualified: true, countryDone: true, champion, unlocked: unl, standings: st };
}


// ---------------- 模擬 ----------------
export interface RaceInput { gas: boolean; brake: boolean; left: boolean; right: boolean; nitro: boolean; /** 只有 AI 用：-1…1 的類比轉向 */ steer?: number }
export interface RaceCar {
  id: string; name: string; ai: boolean; car: string; color: number;
  z: number; x: number; speed: number; damage: number; nitro: number; nitroT: number; lap: number;
  finishedTick: number | null; stats: CarStats; input: RaceInput; prevNitro: boolean; nitroQ: boolean;
  aiLane: number; aiT?: number;
  /** v15 碰撞事件（給畫面特效）：evT＝最後一次被撞的 tick、evK＝種類 1 撞路邊 2 追撞前車 3 被追撞 4 側擦、evS＝力道（扣裝甲前的傷害）、evSide＝-1 左 / 0 前後 / 1 右 */
  evT?: number; evK?: number; evS?: number; evSide?: number;
  /** v16 翻車剩餘 tick（0＝沒在翻） */
  flip?: number; aiNitroAt: number[]; aiSkill: number; aiRecover: number; /** v23：前／側／後 分區損傷 0–100（HUD 用） */ zd?: number[]; /** v22：讓車：-1 靠左／1 靠右，剩幾 tick（決定後維持，不來回換） */ aiYield?: number; aiYieldT?: number; hit: number; hits: number;
}
/** 完美度（%）＝ 100 − damage */
export const condition = (c: { damage: number }) => Math.max(0, Math.round(100 - c.damage));
/** 完美度對極速的影響：每少 1% 就少 0.4% 極速（最低 60%） */
export const condFactor = (damage: number) => Math.max(0.6, 1 - 0.004 * damage);
export interface RaceState { seed: number; track: string; tick: number; laps: number; len: number; cars: RaceCar[]; rng: Rng; over: boolean; maxTicks: number; countdown: number; difficulty: number }
export interface Entrant { id: string; name: string; ai?: boolean; car?: string; parts?: Partial<Parts>; color?: number; skill?: number }
const NO_INPUT: RaceInput = { gas: false, brake: false, left: false, right: false, nitro: false };

/** 補滿電腦車：用固定的 19 位車手（依實力），回傳完整 20 人出賽名單（電腦在前、玩家在後）。 */
export function fillField(humans: Entrant[], slots = RACE_SLOTS): Entrant[] {
  const ai = AI_DRIVERS.slice(0, Math.max(0, slots - humans.length)).map((d, i) => ({ id: `ai${i}`, name: d.name, ai: true, car: 'ai', skill: d.skill }));
  return [...ai, ...humans].slice(0, slots);
}
/** v19：電腦車是「要超的車流」：極速／加速調低（原本 78／17），原廠車開得好在簡單賽道能贏、難的能進前 3；全滿車輾壓。 */
export const AI_TOP = 50, AI_ACCEL = 13; // v22：電腦車再弱（62→50）：模擬中原廠車約 3/4 場前 3、全滿全勝
export function createRace(seed: number, trackId: string, entrants: Entrant[], difficulty = 1): RaceState {
  const t = trackById(trackId); if (!t) throw new Error('bad track');
  const segs = buildTrack(t), len = trackLength(segs), rng = createRng(seed);
  // 發車：電腦依實力排（最強在最前），玩家全部在最後（TG2 規則）
  const ai = entrants.filter((e) => e.ai).map((e) => ({ e, form: (e.skill ?? 1) * (0.94 + nextFloat(rng) * 0.12) })).sort((a, b) => b.form - a.form);
  const hum = entrants.filter((e) => !e.ai);
  const order = [...ai.map((a) => ({ e: a.e, form: a.form })), ...hum.map((e) => ({ e, form: 1 }))].slice(0, RACE_SLOTS);
  const cars: RaceCar[] = order.map(({ e, form }, i) => {
    const st = carStats(e.parts ?? STOCK_PARTS, e.ai ? 'falcon' : e.car);
    const skill = t.ai * difficulty * form;
    if (e.ai) { st.topSpeed = AI_TOP * SPEED_X * skill; st.accel = AI_ACCEL * SPEED_X * skill; st.grip = 1.15 + 0.1 * form; st.wetGrip = 1.0 + 0.1 * form; st.nitroBoost = 1.3; st.tireTopDry = 0; st.tireTopWet = 0; st.armor = { F: 0.3, S: 0.3, R: 0.3 }; }
    return { id: e.id, name: e.name, ai: !!e.ai, car: e.ai ? 'ai' : (e.car ?? 'falcon'), color: e.color ?? i % PAINTS,
      z: -(Math.floor(i / 2) * 10) - 6, x: i % 2 ? 0.45 : -0.45, speed: 0, damage: 0, nitro: NITRO_PER_RACE, nitroT: 0, lap: 0,
      finishedTick: null, stats: st, input: { ...NO_INPUT }, prevNitro: false, nitroQ: false,
      aiLane: -0.55 + nextFloat(rng) * 1.1, aiSkill: form, aiRecover: 0,
      aiNitroAt: [0.08 + nextFloat(rng) * 0.2, 0.45 + nextFloat(rng) * 0.2, 0.8 + nextFloat(rng) * 0.12].map((f) => f * len * t.laps), hit: 0, hits: 0 };
  });
  return { seed, track: trackId, tick: 0, laps: t.laps, len, cars, rng, over: false, maxTicks: RACE_TICK_RATE * 60 * 9, countdown: RACE_TICK_RATE * 3, difficulty };
}
export function trackSegs(id: string) { let s = segCache.get(id); if (!s) { s = buildTrack(trackById(id)!); segCache.set(id, s); } return s; }
const segCache = new Map<string, Segment[]>();
export function segAt(state: { track: string }, z: number) { const segs = trackSegs(state.track); const n = segs.length; return segs[((Math.floor(z / SEG_LEN) % n) + n) % n]; }

export function setRaceInput(s: RaceState, id: string, inp: Partial<RaceInput>) {
  const c = s.cars.find((c) => c.id === id); if (!c || c.ai) return;
  c.input = { gas: !!inp.gas, brake: !!inp.brake, left: !!inp.left, right: !!inp.right, nitro: !!inp.nitro };
  if (inp.nitro && !c.prevNitro) c.nitroQ = true; // 按下的瞬間先記住（可能在兩個 tick 之間就放開）
  c.prevNitro = !!inp.nitro;
}
/** 電腦駕駛：走線（彎內側）、超車、入彎前煞車、直線用氮氣、被撞後收油閃避。 */
function aiInput(s: RaceState, c: RaceCar, grip: number): RaceInput {
  const X = SPEED_X, near = segAt(s, c.z + 40 * X), far = segAt(s, c.z + 90 * X);
  const curve = Math.abs(near.curve) > Math.abs(far.curve) ? near.curve : far.curve;
  // v22：AI 當「車流」——固定走自己的車道，不切彎內側、不換線超車（以前每 tick 依前車換目標，4 倍速下偵測距離變長 → 一直左右切）
  let target = c.aiLane * 0.8, blocked = false, follow = false;
  let ahead: RaceCar | null = null;
  for (const o of s.cars) {
    if (o === c || o.finishedTick !== null) continue;
    const dz = o.z - c.z;
    if (dz > 0 && dz < 12 * X && Math.abs(o.x - c.x) < COLLIDE_DX + 0.08 && (!ahead || dz < ahead.z - c.z)) ahead = o;
  }
  if (ahead) { blocked = true; if (c.speed > ahead.speed - X) follow = true; } // 前面同車道有車：收油跟車，不切出去
  // 讓車：後面有明顯更快的車在同一條線上逼近 → 選一邊（離對方遠的那邊）靠過去，至少維持 3 秒，不來回換
  if (!c.aiYieldT) for (const o of s.cars) { if (o === c || o.finishedTick !== null) continue; const dz = c.z - o.z;
    if (dz > 0 && dz < 30 * X && o.speed > c.speed + 3 * X && Math.abs(o.x - c.x) < COLLIDE_DX + 0.15) { c.aiYield = o.x > c.x ? -1 : 1; if (Math.abs(c.x + c.aiYield * 0.55) > 0.9) c.aiYield = -c.aiYield; c.aiYieldT = 60; break; } }
  if (c.aiYieldT) { c.aiYieldT--; target = Math.max(-0.85, Math.min(0.85, c.aiLane * 0.8 + (c.aiYield ?? 0) * 0.55)); }
  if (c.aiRecover > 0) { c.aiRecover--; target = c.aiLane * -0.6; }
  // v14：目標線平滑（換線、彎道切線慢慢移過去，不會一下左一下右）
  c.aiT = (c.aiT ?? c.x) + (target - (c.aiT ?? c.x)) * 0.08;
  const dx = c.aiT - c.x;
  // 安全彎速：讓離心滑出量不超過方向盤修正能力的 75%（抓地差的 AI 也得在彎前收油，公平）
  const slideSafe = Math.abs(curve) < 0.3 ? Infinity : 70 * X * Math.sqrt(STEER_RATE * 0.75 / (Math.abs(curve) * slideFactor(grip) * CORNER_PULL));
  const safe = Math.min(slideSafe, c.stats.topSpeed * Math.min(1, 1.05 - Math.max(0, Math.abs(curve) - 2) * 0.09 / grip));
  const tooFast = c.speed > safe;
  const straight = Math.abs(near.curve) < 1.2 && Math.abs(far.curve) < 1.8;
  const nitro = false; // v21：電腦車不能用氮氣
  // v14：AI 用比例式方向盤（偏多少轉多少，最大仍是 STEER_RATE），不再「全左／全右」來回修 → 不會左右抖
  const steerAmt = Math.max(-1, Math.min(1, dx / 0.18));
  return { gas: !tooFast && !follow && c.aiRecover < 14, brake: tooFast && c.speed > safe + 4 * X, left: steerAmt < 0, right: steerAmt > 0, nitro, steer: steerAmt };
}
/**
 * 過彎離心力（v12）：每秒往彎外滑 = 彎度 × (速度/70)² × slideFactor(抓地)。
 * slideFactor 隨抓地力 2.5 次方下降：原廠胎在快彎明顯被甩出去，3 階胎幾乎貼著線走（雨天用雨胎抓地）。
 */
/** v13（curves）：過彎外甩整體減半（所有胎、乾濕地一律 ×0.5，相對差異不變）。 */
/** v14（steer）：固定速率轉向（每秒最多橫移幾個半路寬），從 1.6 降到 0.75：點一下只動一點、按住穩定平移。AI 也用同一個值。 */
export const STEER_RATE = 0.75;
/** 外甩跟著轉向一起縮放（v13 的 0.5 × 0.75/1.6），過彎守線難度與 v13 相同，只是整體橫向動作變慢。 */
export const CORNER_PULL = 0.5 * STEER_RATE / 1.6 * 1.4; // v21：速度 ×4（相對 v19），彎道時間再減半，外甩 ×1.4 讓原廠胎仍偶爾衝出、3 階胎守住
export const slideFactor = (grip: number) => Math.min(1.4, 0.35 * Math.pow(1.4 / Math.max(0.3, grip), 2.5));
export function gripOf(c: RaceCar, w: Weather) { return w === 'rain' ? c.stats.wetGrip : w === 'snow' ? c.stats.wetGrip * 0.85 : w === 'fog' ? c.stats.grip * 0.95 : c.stats.grip; }
/** 碰撞：依部位扣完美度（裝甲減免）。每次撞擊都算。 */
export const HIT_WALL = 1, HIT_REAR_END = 2, HIT_REARED = 3, HIT_SWIPE = 4, HIT_OBJECT = 5;
function hurt(c: RaceCar, amount: number, zone: 'F' | 'S' | 'R', tick = 0, kind = 0, side = 0) {
  if (kind) { c.evT = tick; c.evK = kind; c.evS = +amount.toFixed(2); c.evSide = side; }
  const add = Math.min(100 - c.damage, amount * (1 - c.stats.armor[zone]));
  c.damage += add; c.hits++;
  const zd = (c.zd ??= [0, 0, 0]); const zi = zone === 'F' ? 0 : zone === 'S' ? 1 : 2; zd[zi] = Math.min(100, zd[zi] + add * 3); // v23：HUD 分區損傷（各區 0–100，只畫圖用）
  if (c.ai) c.aiRecover = amount > 2 ? 20 : 8;
}
export function stepRace(s: RaceState) {
  if (s.over) return;
  s.tick++;
  if (s.countdown > 0) { s.countdown--; return; }
  // v20：速度 ×2，每個 tick 拆成 SUBSTEPS 次物理（碰撞不會穿過去）；計時器（nitroT／hit／flip）每 tick 只減一次
  const inputs = new Map<RaceCar, RaceInput>();
  for (let sub = 0; sub < SUBSTEPS; sub++) physics(s, sub, inputs);
  const humans = s.cars.filter((c) => !c.ai);
  if (s.tick >= s.maxTicks || (humans.length > 0 && humans.every((c) => c.finishedTick !== null)) || s.cars.every((c) => c.finishedTick !== null)) s.over = true;
}
function physics(s: RaceState, sub: number, inputs: Map<RaceCar, RaceInput>) {
  const t = trackById(s.track)!, dt = 1 / RACE_TICK_RATE / SUBSTEPS, total = s.len * s.laps, first = sub === 0, X = SPEED_X;
  for (const c of s.cars) {
    if (c.finishedTick !== null) { c.speed = Math.max(0, c.speed - 20 * X * dt); c.z += c.speed * dt; continue; }
    if (c.flip) { // 翻車中：不能操作，快速減速；翻完放回路邊、低速
      if (first) c.flip--; c.speed = Math.max(0, c.speed - 60 * X * dt); c.z += c.speed * dt;
      if (c.flip === 0) { c.x = Math.sign(c.x || 1) * 0.85; c.speed = 10 * X; c.hit = 10; }
      c.lap = Math.max(0, Math.floor(c.z / s.len)); continue;
    }
    const seg = segAt(s, c.z), grip = gripOf(c, t.weather);
    let inp = inputs.get(c); if (!inp) { inp = c.ai ? aiInput(s, c, grip) : c.input; inputs.set(c, inp); }
    if (first) {
      if (c.ai) c.nitroQ = false; // v21：電腦車不能用氮氣（就算輸入也不理）
      if (c.nitroQ) { if (c.nitro > 0 && c.nitroT === 0) { c.nitro--; c.nitroT = Math.round(c.stats.nitroTicks); } c.nitroQ = false; }
    }
    const off = Math.abs(c.x) > 1;
    let vmax = (c.stats.topSpeed + ((t.weather === 'rain' || t.weather === 'snow') ? c.stats.tireTopWet : c.stats.tireTopDry)) * condFactor(c.damage) * (off ? 0.45 : 1);
    let acc = c.stats.accel;
    if (c.nitroT > 0) { if (first) c.nitroT--; vmax *= c.stats.nitroBoost; acc *= 2; }
    if (inp.gas) c.speed += acc * Math.max(0.1, 1 - c.speed / vmax) * dt * (c.speed > vmax ? -2 : 1);
    else c.speed -= 6 * X * dt;
    if (inp.brake) c.speed -= 45 * X * dt;
    if (c.speed > vmax) c.speed -= (c.speed - vmax) * 2 * dt;
    c.speed = Math.max(0, c.speed);
    const sp = c.speed / (70 * X);
    const pull = seg.curve * sp * sp * slideFactor(grip) * CORNER_PULL, auth = STEER_RATE * Math.min(1, sp + 0.15);
    // v22：AI 在每個子步依目前路段先抵銷離心外甩（前饋），比例方向盤只修小偏差 → 過彎穩定、不左右擺（總轉向仍限 ±1）
    const steer = c.ai && inp.steer !== undefined ? Math.max(-1, Math.min(1, inp.steer + pull / auth)) : (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    c.x += steer * auth * dt;
    c.x -= pull * dt;
    if (Math.abs(c.x) > 1.55) { // 撞上路邊護欄
      if (c.hit <= 0) { hurt(c, 6 * (0.3 + sp), 'S', s.tick, HIT_WALL, Math.sign(c.x)); c.speed *= 0.35; c.hit = 16; }
      c.x = Math.sign(c.x) * 1.15;
    }
    if (first && c.hit > 0) c.hit--;
    const z0 = c.z;
    c.z += c.speed * dt;
    if (Math.abs(c.x) > 1.05 && c.speed > 8 * X) { // v16：衝出路面撞到路邊硬物 → 翻車
      const L = s.len, a = ((z0 % L) + L) % L, b = a + (c.z - z0);
      for (const o of roadside(s.track)) {
        if (!o.solid || Math.abs(c.x - o.x) > PROP_HIT_DX) continue;
        if (!((o.z > a && o.z <= b) || (o.z + L > a && o.z + L <= b))) continue;
        hurt(c, 10 * (0.4 + sp), 'F', s.tick, HIT_OBJECT, Math.sign(c.x));
        c.flip = FLIP_TICKS; c.nitroT = 0; break;
      }
    }
    c.lap = Math.max(0, Math.floor(c.z / s.len));
    if (c.z >= total && c.finishedTick === null) c.finishedTick = s.tick;
  }
  // 車與車：追撞（前／後裝甲）與並排擦撞（側裝甲）
  const live = s.cars.filter((c) => c.finishedTick === null && !c.flip).sort((a, b) => a.z - b.z);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j], dz = b.z - a.z; if (dz > 5) break;
    const dx = Math.abs(a.x - b.x); if (dx >= COLLIDE_DX) continue;
    if (dz > 1.5 && a.speed > b.speed) { // a 從後面撞上 b
      const rel = (a.speed - b.speed) / (30 * X);
      if (a.speed - b.speed < 1.5 * X) { a.speed = b.speed; continue; } // 輕輕貼上：不算撞
      a.speed = b.speed * 0.85; b.speed += 2 * X;
      hurt(a, 3 * (0.3 + rel), 'F', s.tick, HIT_REAR_END, 0); hurt(b, 2 * (0.3 + rel), 'R', s.tick, HIT_REARED, 0);
      a.hit = Math.max(a.hit, 8); b.hit = Math.max(b.hit, 6);
      const push = a.x < b.x ? -0.12 : 0.12; a.x += push; b.x -= push;
    } else if (dz <= 1.5 && a.hit <= 0 && b.hit <= 0) { // 並排擦撞
      hurt(a, 1, 'S', s.tick, HIT_SWIPE, a.x < b.x ? 1 : -1); hurt(b, 1, 'S', s.tick, HIT_SWIPE, a.x < b.x ? -1 : 1); // v23：輕擦 ≈ −1% a.hit = b.hit = 8; a.speed *= 0.92; b.speed *= 0.92;
      const push = a.x < b.x ? -0.2 : 0.2; a.x += push; b.x -= push;
    }
  }
}
export function raceRanking(s: RaceState): RaceCar[] {
  return [...s.cars].sort((a, b) => (a.finishedTick ?? Infinity) - (b.finishedTick ?? Infinity) || b.z - a.z);
}
export const raceTimeMs = (s: RaceState, c: RaceCar) => c.finishedTick === null ? null : Math.round(((c.finishedTick - RACE_TICK_RATE * 3) * 1000) / RACE_TICK_RATE);
/** 快照每台車的陣列（伺服器／預覽共用）：[id, z, x, speed, damage, nitro, nitroT, finishedTick, hit, evT, evK, evS, evSide, flip] */
export const snapCar = (c: RaceCar) => [c.id, +c.z.toFixed(2), +c.x.toFixed(3), +c.speed.toFixed(2), +c.damage.toFixed(1), c.nitro, c.nitroT, c.finishedTick, c.hit, c.evT ?? 0, c.evK ?? 0, c.evS ?? 0, c.evSide ?? 0, c.flip ?? 0, Math.round(c.zd?.[0] ?? 0), Math.round(c.zd?.[1] ?? 0), Math.round(c.zd?.[2] ?? 0)];
export const kmh = (v: number) => Math.round(v * 3.6);
/** 賽季：一個日曆月（台北時間），例如 '2026-10'。 */
export function seasonOf(ms: number) { const d = new Date(ms + 8 * 3600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
