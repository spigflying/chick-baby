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
export const SEG_LEN = 20;
export const RACE_SLOTS = 20;
export const NITRO_PER_RACE = 3;
export const QUALIFY_RANK = 10;
export const RACES_PER_COUNTRY = 4;
export const RACE_ENGINE_VERSION = 2;

// ---------------- 零件：引擎、變速箱、乾地胎、雨胎、氮氣、前／側／後裝甲（各 3 級＋出廠） ----------------
export type PartKind = 'engine' | 'gearbox' | 'dry' | 'wet' | 'nitro' | 'armorF' | 'armorS' | 'armorR';
export interface PartTier { name: string; price: number }
export const PARTS: Record<PartKind, { label: string; desc: string; tiers: PartTier[] }> = {
  engine: { label: '引擎', desc: '加速、極速小幅提升，也決定高檔位能不能發揮', tiers: [{ name: '原廠 2.0L', price: 0 }, { name: '強化進氣', price: 30000 }, { name: '雙渦輪', price: 50000 }, { name: '賽道規格 V8', price: 80000 }] },
  gearbox: { label: '變速箱', desc: '多一檔＝極速更高；引擎不夠力時高檔位用不到', tiers: [{ name: '4 速', price: 0 }, { name: '5 速', price: 10000 }, { name: '6 速', price: 30000 }, { name: '7 速序列式', price: 50000 }] },
  dry: { label: '乾地胎', desc: '晴天抓地與過彎', tiers: [{ name: '街胎', price: 0 }, { name: '運動胎', price: 1000 }, { name: '半熱熔', price: 2000 }, { name: '光頭胎', price: 4000 }] },
  wet: { label: '雨胎', desc: '雨天、雪地抓地', tiers: [{ name: '一般胎', price: 0 }, { name: '溝紋胎', price: 1000 }, { name: '深溝胎', price: 2000 }, { name: '全天候胎', price: 3000 }] },
  nitro: { label: '氮氣', desc: '氮氣更猛、噴更久', tiers: [{ name: '小鋼瓶', price: 0 }, { name: '雙鋼瓶', price: 5000 }, { name: '高壓噴射', price: 15000 }, { name: '直噴燃燒', price: 30000 }] },
  armorF: { label: '前裝甲', desc: '追撞前車時少掉完美度', tiers: [{ name: '原廠', price: 0 }, { name: '強化保桿', price: 5000 }, { name: '碳纖維', price: 10000 }, { name: '鋼骨保桿', price: 20000 }] },
  armorS: { label: '側裝甲', desc: '擦撞路邊與側面碰撞少掉完美度', tiers: [{ name: '原廠', price: 0 }, { name: '側邊護條', price: 5000 }, { name: '防滾籠', price: 10000 }, { name: '裝甲側板', price: 20000 }] },
  armorR: { label: '後裝甲', desc: '被後車撞時少掉完美度', tiers: [{ name: '原廠', price: 0 }, { name: '強化後保', price: 5000 }, { name: '碳纖維', price: 10000 }, { name: '鋼骨後保', price: 20000 }] },
};
export const PART_KINDS = Object.keys(PARTS) as PartKind[];
export type Parts = Record<PartKind, number>;
export const STOCK_PARTS: Parts = { engine: 0, gearbox: 0, dry: 0, wet: 0, nitro: 0, armorF: 0, armorS: 0, armorR: 0 };
export const normParts = (p: any): Parts => { const o = { ...STOCK_PARTS }; for (const k of PART_KINDS) o[k] = Math.max(0, Math.min(PARTS[k].tiers.length - 1, Math.floor(Number(p?.[k]) || 0))); if (p?.armor && !p.armorS) o.armorS = Math.min(3, p.armor); return o; };
export function partPrice(kind: PartKind, tier: number) { return PARTS[kind]?.tiers[tier]?.price ?? null; }

/** 玩家車款（9 款原創外觀＋小幅特性）。電腦車一律用灰色通用車。 */
export interface CarModel { id: string; name: string; price: number; top: number; accel: number; grip: number; tough: number; desc: string }
export const CARS: CarModel[] = [
  { id: 'falcon', name: '隼 GT', price: 0, top: 1, accel: 1, grip: 1, tough: 1, desc: 'GT3 賽車，均衡入門' },
  { id: 'arrow', name: '箭 RS', price: 25000, top: 1.03, accel: 1.04, grip: 0.98, tough: 0.92, desc: '楔形超跑，起步快' },
  { id: 'muscle', name: '野馬 V8', price: 30000, top: 1.04, accel: 0.98, grip: 0.94, tough: 1.2, desc: '肌肉車，直線猛、彎道笨重' },
  { id: 'rally', name: '鷹 拉力', price: 35000, top: 0.98, accel: 1.05, grip: 1.1, tough: 1.15, desc: '拉力掀背，雨雪最穩' },
  { id: 'rhino', name: '犀 R', price: 40000, top: 1, accel: 1.02, grip: 1.06, tough: 1.25, desc: '四驅性能跑車，耐撞' },
  { id: 'drift', name: '鬼 甩尾', price: 45000, top: 1.02, accel: 1.04, grip: 1.02, tough: 1, desc: '日系寬體，靈活' },
  { id: 'comet', name: '彗星 Z', price: 90000, top: 1.07, accel: 1.05, grip: 1.04, tough: 1, desc: '後置引擎經典跑車' },
  { id: 'lmp', name: '曙 LMP', price: 120000, top: 1.1, accel: 1.07, grip: 1.08, tough: 0.95, desc: '利曼原型車，下壓力大' },
  { id: 'f1', name: '燕 F1', price: 160000, top: 1.13, accel: 1.1, grip: 1.12, tough: 0.8, desc: '開輪方程式，最快也最怕撞' },
];
export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];
export const PAINTS = 6; // 免費塗裝數

export interface CarStats { topSpeed: number; accel: number; grip: number; wetGrip: number; nitroBoost: number; nitroTicks: number; armor: { F: number; S: number; R: number } }
export function carStats(partsIn: Partial<Parts>, carId = 'falcon'): CarStats {
  const p = normParts(partsIn), c = carById(carId);
  const gear = Math.min(p.gearbox, p.engine + 1); // 引擎不夠力，高檔位發揮不出來
  const tough = (c.tough - 1) * 0.4;
  const arm = (lv: number) => Math.max(0, Math.min(0.75, lv * 0.2 + tough));
  return {
    topSpeed: (64 + gear * 3.5 + p.engine * 1.5) * c.top,   // 平衡：升級幫助有限，約 230 → 285 km/h（再乘車款）
    accel: (13 + p.engine * 2.5 + (p.gearbox >= 2 ? 1 : 0)) * c.accel,
    grip: (1 + p.dry * 0.18) * c.grip,
    wetGrip: (0.62 + p.wet * 0.17) * c.grip,
    nitroBoost: 1.22 + p.nitro * 0.09,
    nitroTicks: RACE_TICK_RATE * (3 + p.nitro * 0.4),
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
  ['tw', '台灣', [['tw1', '河濱大道', 'city', 'clear', 4, 11], ['tw2', '陽明山霧道', 'forest', 'fog', 3, 12], ['tw3', '港都夜景', 'city', 'night', 4, 13], ['tw4', '東海岸雨線', 'coast', 'rain', 3, 14]]],
  ['jp', '日本', [['jp1', '箱根山道', 'forest', 'clear', 3, 21], ['jp2', '首都高夜行', 'city', 'night', 4, 22], ['jp3', '雨中賽道', 'farm', 'rain', 3, 23], ['jp4', '北國雪原', 'snow', 'snow', 3, 24]]],
  ['us', '美國', [['us1', '沙漠直線', 'desert', 'clear', 4, 31], ['us2', '紅岩峽谷', 'desert', 'clear', 3, 32], ['us3', '霓虹賭城', 'city', 'night', 4, 33], ['us4', '一號公路霧', 'coast', 'fog', 3, 34]]],
  ['de', '德國', [['de1', '黑森林', 'forest', 'rain', 3, 41], ['de2', '北環霧中', 'forest', 'fog', 3, 42], ['de3', '阿爾卑斯雪', 'snow', 'snow', 3, 43], ['de4', '無限速公路', 'farm', 'clear', 5, 44]]],
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
  id, name, country: cname, countryId: cid, countryIdx: ci, raceIdx: ri, scenery, weather, laps, ai: 0.78 + ci * 0.055 + ri * 0.012, pieces: makePieces(seed, ci),
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
export const trackLength = (segs: Segment[]) => segs.length * SEG_LEN;

// ---------------- 獎金、積分、晉級（同一張表，每條賽道一樣） ----------------
export const PRIZES = [10000, 6000, 4000, 3000, 2000, 1000];
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

// ---------------- 換匯（賽車獎金 ↔ 寵物金幣） ----------------
export const EXCHANGE = { coinToCash: 500, cashPerCoin: 1000, dailyCapCoins: 50 };

// ---------------- 模擬 ----------------
export interface RaceInput { gas: boolean; brake: boolean; left: boolean; right: boolean; nitro: boolean }
export interface RaceCar {
  id: string; name: string; ai: boolean; car: string; color: number;
  z: number; x: number; speed: number; damage: number; nitro: number; nitroT: number; lap: number;
  finishedTick: number | null; stats: CarStats; input: RaceInput; prevNitro: boolean; nitroQ: boolean;
  aiLane: number; aiNitroAt: number[]; aiSkill: number; aiRecover: number; hit: number; hits: number;
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
    if (e.ai) { st.topSpeed = 78 * skill; st.accel = 17 * skill; st.grip = 1.15 + 0.1 * form; st.wetGrip = 1.0 + 0.1 * form; st.nitroBoost = 1.3; st.armor = { F: 0.3, S: 0.3, R: 0.3 }; }
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
  const near = segAt(s, c.z + 40), far = segAt(s, c.z + 90);
  const curve = Math.abs(near.curve) > Math.abs(far.curve) ? near.curve : far.curve;
  let target = c.aiLane * 0.5 + Math.max(-0.6, Math.min(0.6, curve * 0.15)); // 走彎內側
  let blocked = false, follow = false;
  for (const o of s.cars) {
    if (o === c || o.finishedTick !== null) continue;
    const dz = o.z - c.z;
    if (dz > 0 && dz < 28 && Math.abs(o.x - c.x) < 0.4 && o.speed < c.speed + 2) { // 前面有慢車：往空的那邊超
      blocked = true; const left = o.x - 0.65, right = o.x + 0.65;
      target = Math.abs(left) < Math.abs(right) ? (left > -0.95 ? left : right) : (right < 0.95 ? right : left);
      if (dz < 9 && c.speed > o.speed - 1) follow = true; // 太近：先收油跟車，別追撞
    }
  }
  if (c.aiRecover > 0) { c.aiRecover--; target = c.aiLane * -0.6; }
  const dx = target - c.x;
  const safe = c.stats.topSpeed * Math.min(1, 1.05 - Math.max(0, Math.abs(curve) - 2) * 0.09 / grip);
  const tooFast = c.speed > safe;
  const straight = Math.abs(near.curve) < 1.2 && Math.abs(far.curve) < 1.8;
  const nitro = c.nitro > 0 && c.nitroT === 0 && straight && c.z >= c.aiNitroAt[NITRO_PER_RACE - c.nitro] && !blocked;
  return { gas: !tooFast && !follow && c.aiRecover < 14, brake: tooFast && c.speed > safe + 4, left: dx < -0.06, right: dx > 0.06, nitro };
}
export function gripOf(c: RaceCar, w: Weather) { return w === 'rain' ? c.stats.wetGrip : w === 'snow' ? c.stats.wetGrip * 0.85 : w === 'fog' ? c.stats.grip * 0.95 : c.stats.grip; }
/** 碰撞：依部位扣完美度（裝甲減免）。每次撞擊都算。 */
function hurt(c: RaceCar, amount: number, zone: 'F' | 'S' | 'R') {
  c.damage = Math.min(100, c.damage + amount * (1 - c.stats.armor[zone])); c.hits++;
  if (c.ai) c.aiRecover = amount > 2 ? 20 : 8;
}
export function stepRace(s: RaceState) {
  if (s.over) return;
  s.tick++;
  if (s.countdown > 0) { s.countdown--; return; }
  const t = trackById(s.track)!, dt = 1 / RACE_TICK_RATE, total = s.len * s.laps;
  for (const c of s.cars) {
    if (c.finishedTick !== null) { c.speed = Math.max(0, c.speed - 20 * dt); c.z += c.speed * dt; continue; }
    const seg = segAt(s, c.z), grip = gripOf(c, t.weather);
    const inp = c.ai ? aiInput(s, c, grip) : c.input;
    if (c.ai && inp.nitro) c.nitroQ = true;
    if (c.nitroQ) { if (c.nitro > 0 && c.nitroT === 0) { c.nitro--; c.nitroT = Math.round(c.stats.nitroTicks); } c.nitroQ = false; }
    const off = Math.abs(c.x) > 1;
    let vmax = c.stats.topSpeed * condFactor(c.damage) * (off ? 0.45 : 1);
    let acc = c.stats.accel;
    if (c.nitroT > 0) { c.nitroT--; vmax *= c.stats.nitroBoost; acc *= 2; }
    if (inp.gas) c.speed += acc * Math.max(0.1, 1 - c.speed / vmax) * dt * (c.speed > vmax ? -2 : 1);
    else c.speed -= 6 * dt;
    if (inp.brake) c.speed -= 45 * dt;
    if (c.speed > vmax) c.speed -= (c.speed - vmax) * 2 * dt;
    c.speed = Math.max(0, c.speed);
    const sp = c.speed / 70;
    const steer = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    c.x += steer * 1.6 * Math.min(1, sp + 0.15) * dt;
    c.x -= seg.curve * sp * sp * 0.55 * dt / grip;
    if (Math.abs(c.x) > 1.55) { // 撞上路邊物
      if (c.hit <= 0) { hurt(c, 6 * (0.3 + sp), 'S'); c.speed *= 0.35; c.hit = 16; }
      c.x = Math.sign(c.x) * 1.15;
    }
    if (c.hit > 0) c.hit--;
    c.z += c.speed * dt;
    c.lap = Math.max(0, Math.floor(c.z / s.len));
    if (c.z >= total) c.finishedTick = s.tick;
  }
  // 車與車：追撞（前／後裝甲）與並排擦撞（側裝甲）
  const live = s.cars.filter((c) => c.finishedTick === null).sort((a, b) => a.z - b.z);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j], dz = b.z - a.z; if (dz > 5) break;
    const dx = Math.abs(a.x - b.x); if (dx >= 0.32) continue;
    if (dz > 1.5 && a.speed > b.speed) { // a 從後面撞上 b
      const rel = (a.speed - b.speed) / 30;
      if (a.speed - b.speed < 1.5) { a.speed = b.speed; continue; } // 輕輕貼上：不算撞
      a.speed = b.speed * 0.85; b.speed += 2;
      hurt(a, 3 * (0.3 + rel), 'F'); hurt(b, 2 * (0.3 + rel), 'R');
      a.hit = Math.max(a.hit, 8); b.hit = Math.max(b.hit, 6);
      const push = a.x < b.x ? -0.12 : 0.12; a.x += push; b.x -= push;
    } else if (dz <= 1.5 && a.hit <= 0 && b.hit <= 0) { // 並排擦撞
      hurt(a, 2.5, 'S'); hurt(b, 2.5, 'S'); a.hit = b.hit = 8; a.speed *= 0.92; b.speed *= 0.92;
      const push = a.x < b.x ? -0.2 : 0.2; a.x += push; b.x -= push;
    }
  }
  const humans = s.cars.filter((c) => !c.ai);
  if (s.tick >= s.maxTicks || (humans.length > 0 && humans.every((c) => c.finishedTick !== null)) || s.cars.every((c) => c.finishedTick !== null)) s.over = true;
}
export function raceRanking(s: RaceState): RaceCar[] {
  return [...s.cars].sort((a, b) => (a.finishedTick ?? Infinity) - (b.finishedTick ?? Infinity) || b.z - a.z);
}
export const raceTimeMs = (s: RaceState, c: RaceCar) => c.finishedTick === null ? null : Math.round(((c.finishedTick - RACE_TICK_RATE * 3) * 1000) / RACE_TICK_RATE);
export const kmh = (v: number) => Math.round(v * 3.6);
/** 賽季：一個日曆月（台北時間），例如 '2026-10'。 */
export function seasonOf(ms: number) { const d = new Date(ms + 8 * 3600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
