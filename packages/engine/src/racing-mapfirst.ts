/**
 * race-demo-mapfirst：「先畫地圖、再推導路段」的試玩賽道。
 * 賽道 = 封閉 2D 佈局（直線＋圓弧，弧有明確轉角與半徑）。路段每段 SEG_LEN 公尺，
 * 每段航向變化（弧度）＝佈局在那 20m 的實際轉角 → segment.curve = 轉角 / SEG_TURN_K。
 * 之後小地圖（trackPathXY）、路面彎曲（segCurvature）、外甩（mapFirstPullRate）全部只讀這個 curve，沒有別的比例。
 * 只有試玩頁會 registerTrack()；正式 /race 不用。
 */
import { SEG_LEN, SEG_TURN_K, registerTrack, type Segment, type Track, type Scenery, type Weather } from './racing';

/** s：直線長度（公尺，'auto' 由閉合求解）；a：轉角（度，正＝右轉）＋ r：半徑（公尺）；hill：此段起伏幅度 */
export type LayoutPiece = { s: number | 'auto'; hill?: number } | { a: number; r: number; hill?: number };
export interface MapLayout { id: string; name: string; scenery: Scenery; weather: Weather; laps: number; pieces: LayoutPiece[] }

/** 一片圓弧切成 n 段（每段 20m）：n = round(|a|·r / SEG_LEN)，每段轉 a/n。 */
export const arcSegs = (aDeg: number, r: number) => Math.max(2, Math.round(Math.abs(aDeg * Math.PI / 180) * r / SEG_LEN));

export interface MapFirstTrack {
  track: Track; segs: Segment[];
  /** 每段的航向轉角（弧度）＝ segs[i].curve × SEG_TURN_K */
  turns: number[];
  /** 每片佈局在 segs 裡的起始段與段數 */
  pieceStart: number[]; pieceSegs: number[];
  closeGapM: number; autoLens: number[];
}

/**
 * 佈局 → 路段。兩段 'auto' 直線的長度由閉合條件（終點回到起點）解出。
 * 每段轉角取「半段相位」：弧的第一段轉 a/2n、中間 a/n、弧後下一段再轉 a/2n（總和 a）。
 * 這樣「先轉再走 20m」的積分（trackPathXY／路面 lh）走出來的折線＝真圓弧的弦多邊形，與設計圖一致。
 */
export function buildMapFirst(L: MapLayout, idx = 0): MapFirstTrack {
  const autos = L.pieces.map((p, i) => ('s' in p && p.s === 'auto' ? i : -1)).filter((i) => i >= 0);
  if ('a' in L.pieces[0] || 'a' in L.pieces[L.pieces.length - 1]) throw new Error(`${L.id}: must start and end on a straight`);
  if (autos.length !== 2) throw new Error(`${L.id}: need exactly 2 auto straights`);
  // 真幾何位移（弦多邊形）：auto 長度 0 時的終點＋兩條 auto 直線方向
  let th = 0, ex = 0, ey = 0; const dirs: number[] = [];
  for (const [i, p] of L.pieces.entries()) {
    if ('a' in p) { const n = arcSegs(p.a, p.r), d = p.a * Math.PI / 180 / n;
      for (let k = 0; k < n; k++) { ex += Math.sin(th + (k + 0.5) * d) * SEG_LEN; ey -= Math.cos(th + (k + 0.5) * d) * SEG_LEN; }
      th += n * d; }
    else if (p.s === 'auto') dirs.push(th);
    else { const n = Math.round(p.s / SEG_LEN); ex += Math.sin(th) * SEG_LEN * n; ey -= Math.cos(th) * SEG_LEN * n; }
  }
  if (Math.abs(th - 2 * Math.PI) > 1e-9) throw new Error(`${L.id}: total turn ${(th * 180 / Math.PI).toFixed(2)}° ≠ 360°`);
  // 解 l1·(sin d1, −cos d1) + l2·(sin d2, −cos d2) = −end
  const [a1, b1, a2, b2] = [Math.sin(dirs[0]), -Math.cos(dirs[0]), Math.sin(dirs[1]), -Math.cos(dirs[1])];
  const det = a1 * b2 - a2 * b1; if (Math.abs(det) < 1e-6) throw new Error(`${L.id}: auto straights parallel`);
  const l1 = (-ex * b2 + ey * a2) / det, l2 = (-a1 * ey + b1 * ex) / det;
  if (l1 < 0 || l2 < 0) throw new Error(`${L.id}: closure needs negative straight (${l1.toFixed(0)}, ${l2.toFixed(0)})`);
  // 段數取整：4 種 floor/ceil 組合挑閉合誤差最小的
  const gap = (q1: number, q2: number) => Math.hypot(ex + q1 * a1 + q2 * a2, ey + q1 * b1 + q2 * b2);
  const opts = [Math.floor, Math.ceil].flatMap((f) => [Math.floor, Math.ceil].map((g) => [f(l1 / SEG_LEN) * SEG_LEN, g(l2 / SEG_LEN) * SEG_LEN]));
  const autoLens = opts.reduce((b, o) => (gap(o[0], o[1]) < gap(b[0], b[1]) ? o : b));
  // 每片段數與「均勻」轉角，再做半段相位平移（循環，總和不變）
  const pieceSegs: number[] = [], pieceStart: number[] = [], uni: number[] = [];
  L.pieces.forEach((p, i) => {
    pieceStart.push(uni.length);
    const n = 'a' in p ? arcSegs(p.a, p.r) : Math.round((p.s === 'auto' ? autoLens[autos.indexOf(i)] : p.s) / SEG_LEN);
    pieceSegs.push(n);
    for (let k = 0; k < n; k++) uni.push('a' in p ? p.a * Math.PI / 180 / n : 0);
  });
  const N = uni.length, turns = uni.map((t, i) => (t + uni[(i - 1 + N) % N]) / 2);
  let fx = 0, fy = 0, h = 0; for (const t of turns) { h += t; fx += Math.sin(h) * SEG_LEN; fy -= Math.cos(h) * SEG_LEN; }
  // 起伏：每片可給 hill，正弦形，最後線性閉合（和 buildTrack 一樣只動 y）
  const segs: Segment[] = []; let y = 0;
  L.pieces.forEach((p, pi) => { const hh = p.hill ?? 0, n = pieceSegs[pi];
    for (let i = 0; i < n; i++) { y += hh * 0.9 * Math.sin((i / n) * Math.PI); segs.push({ curve: turns[segs.length] / SEG_TURN_K, y }); } });
  const dy = segs[segs.length - 1].y; segs.forEach((s, i) => { s.y -= (dy * (i + 1)) / segs.length; });
  const track: Track = {
    id: L.id, name: L.name, country: '試玩', countryId: 'demo', countryIdx: 0, raceIdx: idx,
    scenery: L.scenery, weather: L.weather, laps: L.laps, ai: 0.8, pieces: [], mapFirst: true,
  };
  return { track, segs, turns, pieceStart, pieceSegs, closeGapM: Math.hypot(fx, fy), autoLens };
}

/** 三條試玩賽道（起點朝北、順時針；總轉角自然 = 360°）。'auto' 直線由閉合解出。 */
export const MAPFIRST_LAYOUTS: MapLayout[] = [
  { id: 'mf1', name: '方城環道', scenery: 'city', weather: 'clear', laps: 2, pieces: [
    { s: 200 },                    // 起跑直線（北）
    { a: 90, r: 450 },             // T1 右 90°（向東）
    { s: 600, hill: 1.5 },
    { a: -45, r: 380 }, { a: 45, r: 380 }, // S 彎
    { s: 200 },
    { a: 90, r: 450 },             // T2 右 90°（向南）
    { s: 'auto' },                 // 南向長直線
    { a: 180, r: 180 },            // 髮夾 180°（向北）
    { s: 200 },
    { a: -90, r: 420 },            // 左 90°（向西）
    { s: 'auto', hill: -1.5 },
    { a: 90, r: 450 },             // 右 90°（回北）
    { s: 100 },                    // 終點直線
  ] },
  { id: 'mf2', name: '海岸彎道', scenery: 'coast', weather: 'clear', laps: 2, pieces: [
    { s: 'auto' },                 // 起跑直線（北）
    { a: 60, r: 700 },             // 快速右彎
    { s: 500 },
    { a: 30, r: 500 },             // （向東）
    { s: 600, hill: 1 },
    { a: 90, r: 450 },             // 右 90°（向南）
    { s: 300 },
    { a: -50, r: 350 }, { a: 50, r: 350 }, // S 彎
    { s: 400 },
    { a: 90, r: 430 },             // 右 90°（向西）
    { s: 'auto', hill: -1 },
    { a: 90, r: 500 },             // 右 90°（回北）
    { s: 100 },                    // 終點直線
  ] },
  { id: 'mf3', name: '山路髮夾', scenery: 'forest', weather: 'clear', laps: 2, pieces: [
    { s: 'auto', hill: 2 },
    { a: 90, r: 450 },             // 右 90°（向東）
    { s: 'auto' },
    { a: 180, r: 180 },            // 髮夾 1（右，向西）
    { s: 450, hill: -2 },
    { a: -180, r: 190 },           // 髮夾 2（左，向東）
    { s: 350 },
    { a: 90, r: 450 },             // 右 90°（向南）
    { s: 600 },
    { a: 90, r: 450 },             // 右 90°（向西）
    { s: 300 },
    { a: 90, r: 480 },             // 右 90°（回北）
    { s: 100 },                    // 終點直線
  ] },
];

let built: MapFirstTrack[] | null = null;
export function mapFirstTracks(): MapFirstTrack[] { return (built ??= MAPFIRST_LAYOUTS.map((l, i) => buildMapFirst(l, i))); }
/** 試玩頁呼叫：把三條地圖先賽道註冊進引擎（trackById／trackSegs 看得到）。 */
export function registerMapFirstTracks(): Track[] { return mapFirstTracks().map((m) => { registerTrack(m.track, m.segs); return m.track; }); }
