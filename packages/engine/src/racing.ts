/**
 * 賽車模式（靈感來自 16 位元時代的偽 3D 賽車；畫面、名稱、賽道都是原創）。
 * 純邏輯、決定性：伺服器權威模擬，客戶端用同一份程式畫面內插。
 * 單位：距離 m、速度 m/s、tick = 1/RACE_TICK_RATE 秒。賽道由「路段」組成，每段 SEG_LEN 公尺。
 */
import { createRng, nextFloat, type Rng } from './rng';

export const RACE_TICK_RATE = 20;
export const SEG_LEN = 20;
export const RACE_SLOTS = 6;
export const NITRO_PER_RACE = 3;
export const RACE_ENGINE_VERSION = 1;

// ---------------- 零件（升級結構：引擎、變速箱、乾地胎、雨胎、氮氣、車身裝甲、修理） ----------------
export type PartKind = 'engine' | 'gearbox' | 'dry' | 'wet' | 'nitro' | 'armor';
export interface PartTier { name: string; price: number }
/** 每種零件的等級；第 0 級是出廠配備（免費）。價格用賽車獎金（$）。 */
export const PARTS: Record<PartKind, { label: string; tiers: PartTier[] }> = {
  engine: { label: '引擎', tiers: [{ name: '原廠 1.6L', price: 0 }, { name: '強化進氣', price: 6000 }, { name: '雙凸輪 2.0L', price: 15000 }, { name: '渦輪增壓', price: 32000 }, { name: '賽道規格 V6', price: 60000 }] },
  gearbox: { label: '變速箱', tiers: [{ name: '4 速手排', price: 0 }, { name: '5 速手排', price: 5000 }, { name: '6 速近齒比', price: 14000 }, { name: '7 速序列式', price: 30000 }] },
  dry: { label: '乾地胎', tiers: [{ name: '街胎', price: 0 }, { name: '運動胎', price: 4000 }, { name: '半熱熔胎', price: 11000 }, { name: '光頭胎', price: 24000 }] },
  wet: { label: '雨胎', tiers: [{ name: '（沒有）', price: 0 }, { name: '溝紋雨胎', price: 5000 }, { name: '深溝雨胎', price: 13000 }, { name: '全天候賽胎', price: 26000 }] },
  nitro: { label: '氮氣', tiers: [{ name: '小鋼瓶', price: 0 }, { name: '雙鋼瓶', price: 7000 }, { name: '高壓噴射', price: 18000 }, { name: '直噴燃燒室', price: 36000 }] },
  armor: { label: '車身裝甲', tiers: [{ name: '原廠鈑金', price: 0 }, { name: '防滾籠', price: 6000 }, { name: '碳纖維外殼', price: 16000 }, { name: '裝甲護板', price: 34000 }] },
};
export const PART_KINDS = Object.keys(PARTS) as PartKind[];
export type Parts = Record<PartKind, number>;
export const STOCK_PARTS: Parts = { engine: 0, gearbox: 0, dry: 0, wet: 0, nitro: 0, armor: 0 };

/** 車款（外觀＋小幅特性），用獎金購買。 */
export interface CarModel { id: string; name: string; price: number; top: number; accel: number; grip: number; tough: number; desc: string }
export const CARS: CarModel[] = [
  { id: 'falcon', name: '隼 GT', price: 0, top: 1, accel: 1, grip: 1, tough: 1, desc: '均衡的入門跑車' },
  { id: 'arrow', name: '箭 RS', price: 25000, top: 1.05, accel: 1.06, grip: 0.97, tough: 0.9, desc: '輕量楔形，起步快' },
  { id: 'rhino', name: '犀 R', price: 40000, top: 0.98, accel: 1.02, grip: 1.08, tough: 1.35, desc: '四驅高車身，雨雪穩、耐撞' },
  { id: 'muscle', name: '野馬 V8', price: 30000, top: 1.06, accel: 0.98, grip: 0.92, tough: 1.2, desc: '美式肌肉車，直線猛、彎道笨重' },
  { id: 'rally', name: '鷹 拉力', price: 35000, top: 0.97, accel: 1.08, grip: 1.12, tough: 1.15, desc: '拉力掀背，雨雪路面最穩' },
  { id: 'drift', name: '鬼 甩尾', price: 45000, top: 1.03, accel: 1.05, grip: 1.0, tough: 1.0, desc: '日系寬體，操控靈活' },
  { id: 'comet', name: '彗星 Z', price: 90000, top: 1.12, accel: 1.08, grip: 1.04, tough: 1, desc: '後置引擎經典跑車，平衡快速' },
  { id: 'lmp', name: '曙 LMP', price: 120000, top: 1.15, accel: 1.1, grip: 1.1, tough: 0.95, desc: '利曼原型車，高速下壓力大' },
  { id: 'f1', name: '燕 F1', price: 160000, top: 1.18, accel: 1.15, grip: 1.15, tough: 0.8, desc: '開輪方程式，最快但最怕碰撞' },
];
export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];

export interface CarStats { topSpeed: number; accel: number; grip: number; wetGrip: number; nitroBoost: number; armor: number; shift: number }
export function carStats(parts: Parts, carId = 'falcon'): CarStats {
  const c = carById(carId);
  return {
    topSpeed: (62 + parts.engine * 7) * c.top, // 約 223 → 349 km/h
    accel: (14 + parts.gearbox * 3 + parts.engine * 1.5) * c.accel,
    grip: (1 + parts.dry * 0.16) * c.grip,
    wetGrip: (0.62 + parts.wet * 0.15) * c.grip,
    nitroBoost: 1.22 + parts.nitro * 0.08,
    armor: Math.min(0.75, (parts.armor * 0.17 + (c.tough - 1) * 0.5)),
    shift: parts.gearbox,
  };
}
/** 修理費：每 1% 損傷的價錢，車越好越貴。 */
export function repairCost(damage: number, parts: Parts) {
  const lvl = PART_KINDS.reduce((s, k) => s + parts[k], 0);
  return Math.ceil(Math.max(0, Math.min(100, damage)) * (60 + lvl * 8));
}
export function partPrice(kind: PartKind, tier: number) { return PARTS[kind].tiers[tier]?.price ?? null; }

// ---------------- 賽道（錦標賽：不同國家、景色、天氣） ----------------
export type Scenery = 'city' | 'coast' | 'desert' | 'forest' | 'snow' | 'farm';
export type Weather = 'clear' | 'rain' | 'night' | 'snow';
/** 路段：[段數, 彎度（正＝右彎）, 坡度（正＝上坡）] */
export type Piece = [number, number, number];
export interface Track { id: string; name: string; country: string; scenery: Scenery; weather: Weather; laps: number; prize: number; pieces: Piece[]; ai: number }
export const TRACKS: Track[] = [
  { id: 'tpe', name: '河濱大道', country: '台灣', scenery: 'city', weather: 'clear', laps: 2, prize: 4000, ai: 0.76,
    pieces: [[25, 0, 0], [15, 2, 0], [20, 0, 1], [15, -2, -1], [30, 0, 0], [20, -3, 0], [10, 0, 2], [20, 0, -2], [15, 3, 0], [20, 0, 0]] },
  { id: 'jpn', name: '山道夜行', country: '日本', scenery: 'forest', weather: 'night', laps: 2, prize: 6000, ai: 0.86,
    pieces: [[20, 0, 0], [12, 4, 2], [12, -4, 2], [20, 0, -1], [10, 5, 0], [10, -5, 0], [25, 0, -2], [15, 3, 1], [20, 0, 0], [15, -2, 0]] },
  { id: 'usa', name: '沙漠直線', country: '美國', scenery: 'desert', weather: 'clear', laps: 2, prize: 8000, ai: 0.9,
    pieces: [[40, 0, 0], [20, 1, 1], [30, 0, -1], [15, -3, 0], [40, 0, 2], [20, 0, -2], [15, 2, 0], [30, 0, 0]] },
  { id: 'gbr', name: '雨中莊園', country: '英國', scenery: 'farm', weather: 'rain', laps: 2, prize: 10000, ai: 0.92,
    pieces: [[20, 0, 0], [15, 3, 0], [15, 0, 1], [10, -4, 0], [20, 0, -1], [15, 2, 1], [15, -2, -1], [25, 0, 0], [10, 4, 0], [15, 0, 0]] },
  { id: 'bra', name: '海岸線', country: '巴西', scenery: 'coast', weather: 'clear', laps: 3, prize: 13000, ai: 0.95,
    pieces: [[25, 0, 0], [20, -2, 1], [15, 2, -1], [20, 0, 0], [12, -4, 0], [25, 0, 2], [15, 0, -2], [15, 3, 0]] },
  { id: 'deu', name: '黑森林', country: '德國', scenery: 'forest', weather: 'rain', laps: 3, prize: 16000, ai: 0.98,
    pieces: [[20, 0, 0], [10, 4, 1], [10, -3, 1], [20, 0, 0], [12, 5, -2], [20, 0, 0], [10, -5, 0], [20, 0, 1], [15, 2, -1]] },
  { id: 'isl', name: '冰原公路', country: '冰島', scenery: 'snow', weather: 'snow', laps: 3, prize: 20000, ai: 1.0,
    pieces: [[30, 0, 0], [15, 3, 1], [20, 0, -1], [15, -3, 0], [25, 0, 2], [20, 2, -2], [20, 0, 0], [15, -2, 0]] },
  { id: 'hkg', name: '霓虹港灣', country: '香港', scenery: 'city', weather: 'night', laps: 3, prize: 26000, ai: 1.03,
    pieces: [[20, 0, 0], [10, -5, 0], [10, 5, 1], [25, 0, -1], [10, 4, 0], [15, 0, 2], [10, -4, -2], [20, 0, 0], [15, 3, 0]] },
];
export const trackById = (id: string) => TRACKS.find((t) => t.id === id) ?? null;
export interface Segment { curve: number; y: number }
/** 展開成路段陣列：彎度平滑進出、坡度累積成高度。 */
export function buildTrack(t: Track): Segment[] {
  const segs: Segment[] = []; let y = 0;
  for (const [n, curve, hill] of t.pieces) {
    for (let i = 0; i < n; i++) {
      const e = Math.min(1, i / 5, (n - 1 - i) / 5 + 0.2); // 進彎／出彎緩和
      y += hill * 0.9 * Math.sin((i / n) * Math.PI);
      segs.push({ curve: curve * e, y });
    }
  }
  // 讓終點高度回到起點（環狀）
  const dy = segs[segs.length - 1].y; segs.forEach((s, i) => { s.y -= (dy * (i + 1)) / segs.length; });
  return segs;
}
export const trackLength = (segs: Segment[]) => segs.length * SEG_LEN;
/** 獎金：名次倍率 × 賽道基本獎金。錦標賽積分。 */
export const PRIZE_SHARE = [1, 0.6, 0.4, 0.25, 0.15, 0.1];
export const POINTS = [10, 6, 4, 3, 2, 1];
export const prizeFor = (t: Track, rank: number) => Math.round(t.prize * (PRIZE_SHARE[rank - 1] ?? 0));
/** 解鎖：前 3 名完成上一條賽道才能跑下一條。 */
export const unlockAfter = (rank: number) => rank <= 3;

// ---------------- 模擬 ----------------
export interface RaceInput { gas: boolean; brake: boolean; left: boolean; right: boolean; nitro: boolean }
export interface RaceCar {
  id: string; name: string; ai: boolean; car: string; color: number;
  z: number; x: number; speed: number; damage: number; nitro: number; nitroT: number; lap: number;
  finishedTick: number | null; stats: CarStats; input: RaceInput; prevNitro: boolean; nitroQ: boolean; aiLane: number; aiNitroAt: number[]; hit: number;
}
export interface RaceState { seed: number; track: string; tick: number; laps: number; len: number; cars: RaceCar[]; rng: Rng; over: boolean; maxTicks: number; countdown: number }
export interface Entrant { id: string; name: string; ai?: boolean; car?: string; parts?: Parts; damage?: number }
const NO_INPUT: RaceInput = { gas: false, brake: false, left: false, right: false, nitro: false };

export function createRace(seed: number, trackId: string, entrants: Entrant[]): RaceState {
  const t = trackById(trackId); if (!t) throw new Error('bad track');
  const segs = buildTrack(t), len = trackLength(segs), rng = createRng(seed);
  const cars: RaceCar[] = entrants.slice(0, RACE_SLOTS).map((e, i) => {
    const aiSkill = t.ai * (0.92 + nextFloat(rng) * 0.1);
    const parts = e.parts ?? STOCK_PARTS;
    const st = carStats(parts, e.car);
    if (e.ai) { st.topSpeed = (62 + 14) * aiSkill; st.accel = 17 * aiSkill; st.grip = 1.2; st.wetGrip = 1.0; }
    // 發車格：兩列，後面的先排
    return { id: e.id, name: e.name, ai: !!e.ai, car: e.car ?? CARS[i % CARS.length].id, color: i,
      z: -(Math.floor(i / 2) * 12) - 6, x: i % 2 ? 0.45 : -0.45, speed: 0, damage: Math.max(0, Math.min(100, e.damage ?? 0)), nitro: NITRO_PER_RACE, nitroT: 0, lap: 0,
      finishedTick: null, stats: st, input: { ...NO_INPUT }, prevNitro: false, nitroQ: false, aiLane: -0.6 + nextFloat(rng) * 1.2,
      aiNitroAt: [0.3 + nextFloat(rng) * 0.2, 0.6 + nextFloat(rng) * 0.2, 0.85 + nextFloat(rng) * 0.1].map((f) => f * len * t.laps), hit: 0 };
  });
  return { seed, track: trackId, tick: 0, laps: t.laps, len, cars, rng, over: false, maxTicks: RACE_TICK_RATE * 60 * 6, countdown: RACE_TICK_RATE * 3 };
}
const segCache = new Map<string, Segment[]>();
export function trackSegs(id: string) { let s = segCache.get(id); if (!s) { s = buildTrack(trackById(id)!); segCache.set(id, s); } return s; }
export function segAt(state: RaceState, z: number) { const segs = trackSegs(state.track); const n = segs.length; return segs[((Math.floor(z / SEG_LEN) % n) + n) % n]; }

export function setRaceInput(s: RaceState, id: string, inp: Partial<RaceInput>) {
  const c = s.cars.find((c) => c.id === id); if (!c || c.ai) return;
  c.input = { gas: !!inp.gas, brake: !!inp.brake, left: !!inp.left, right: !!inp.right, nitro: !!inp.nitro };
  // 按下氮氣的瞬間先記住（按鍵可能在兩個 tick 之間就放開）
  if (inp.nitro && !c.prevNitro) c.nitroQ = true;
  c.prevNitro = !!inp.nitro;
}
function aiInput(s: RaceState, c: RaceCar): RaceInput {
  const ahead = segAt(s, c.z + 60);
  let target = c.aiLane - ahead.curve * 0.12;
  // 前方有車就換線
  for (const o of s.cars) if (o !== c && o.z > c.z && o.z - c.z < 30 && Math.abs(o.x - c.x) < 0.35) target = o.x > 0 ? o.x - 0.6 : o.x + 0.6;
  const dx = target - c.x;
  const sharp = Math.abs(ahead.curve) > 3.5 && c.speed > c.stats.topSpeed * 0.82;
  const nitro = c.nitro > 0 && c.nitroT === 0 && c.z >= c.aiNitroAt[NITRO_PER_RACE - c.nitro];
  return { gas: !sharp, brake: sharp && c.speed > c.stats.topSpeed * 0.9, left: dx < -0.08, right: dx > 0.08, nitro };
}
/** 天氣對抓地力的影響：雨天用雨胎（沒有雨胎就很滑），雪地更滑，夜晚不影響抓地。 */
export function gripOf(c: RaceCar, w: Weather) { return w === 'rain' ? c.stats.wetGrip : w === 'snow' ? c.stats.wetGrip * 0.85 : c.stats.grip; }

export function stepRace(s: RaceState) {
  if (s.over) return;
  s.tick++;
  if (s.countdown > 0) { s.countdown--; return; }
  const t = trackById(s.track)!, dt = 1 / RACE_TICK_RATE, total = s.len * s.laps;
  for (const c of s.cars) {
    if (c.finishedTick !== null) { c.speed = Math.max(0, c.speed - 20 * dt); c.z += c.speed * dt; continue; }
    const inp = c.ai ? aiInput(s, c) : c.input;
    const seg = segAt(s, c.z), grip = gripOf(c, t.weather);
    if (c.ai && inp.nitro) c.nitroQ = true;
    if (c.nitroQ) { if (c.nitro > 0 && c.nitroT === 0) { c.nitro--; c.nitroT = RACE_TICK_RATE * 3; } c.nitroQ = false; }
    const dmgF = 1 - 0.4 * (c.damage / 100); // 損傷越多越慢
    const off = Math.abs(c.x) > 1;
    let vmax = c.stats.topSpeed * dmgF * (off ? 0.45 : 1);
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
    c.x -= seg.curve * sp * sp * 0.55 * dt / grip; // 離心力：抓地力越好越不會被甩出去
    if (Math.abs(c.x) > 1.55) { // 撞上路邊物
      if (c.hit <= 0) { c.damage = Math.min(100, c.damage + 7 * (0.3 + sp) * (1 - c.stats.armor)); c.speed *= 0.35; c.hit = 16; }
      c.x = Math.sign(c.x) * 1.15; // 彈回路肩
    }
    if (c.hit > 0) c.hit--;
    c.z += c.speed * dt;
    c.lap = Math.max(0, Math.floor(c.z / s.len));
    if (c.z >= total) c.finishedTick = s.tick;
  }
  // 車與車碰撞
  for (const a of s.cars) for (const b of s.cars) {
    if (a === b || a.finishedTick !== null || b.finishedTick !== null) continue;
    const dz = b.z - a.z;
    if (dz > 0 && dz < 5 && Math.abs(a.x - b.x) < 0.32 && a.speed > b.speed) { // a 從後面撞上 b
      const rel = (a.speed - b.speed) / 30;
      a.speed = b.speed * 0.85; b.speed += 2;
      a.damage = Math.min(100, a.damage + 5 * (0.4 + rel) * (1 - a.stats.armor));
      b.damage = Math.min(100, b.damage + 3 * (0.4 + rel) * (1 - b.stats.armor));
      const push = a.x < b.x ? -0.12 : 0.12; a.x += push; b.x -= push;
    }
  }
  const humans = s.cars.filter((c) => !c.ai);
  if (s.tick >= s.maxTicks || (humans.length > 0 && humans.every((c) => c.finishedTick !== null)) || s.cars.every((c) => c.finishedTick !== null)) s.over = true;
}
/** 名次：先完賽的在前（依完賽 tick），沒完賽的依距離。 */
export function raceRanking(s: RaceState): RaceCar[] {
  return [...s.cars].sort((a, b) => (a.finishedTick ?? Infinity) - (b.finishedTick ?? Infinity) || b.z - a.z);
}
export const raceTimeMs = (s: RaceState, c: RaceCar) => c.finishedTick === null ? null : Math.round(((c.finishedTick - RACE_TICK_RATE * 3) * 1000) / RACE_TICK_RATE);
export const kmh = (v: number) => Math.round(v * 3.6);
