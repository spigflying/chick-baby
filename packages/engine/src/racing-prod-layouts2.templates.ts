/**
 * 草稿 v2（race-prod-layouts-draft）：16 條正式賽道「地圖先」佈局，每條取材自真實賽道／山路。
 * 只用現有語言（直線 s、圓弧 a/r），新的彎型用下面的 helper 展開成多片圓弧 → buildMapFirst 不用改。
 * fin(r)：在終點直線前補一個彎，讓總轉角＝360°。
 * 不支援立體交叉（鈴鹿 8 字跨橋）：引擎只有一條路面、小地圖／碰撞都假設不自交，所以略過。
 */
import type { LayoutPiece } from './racing-mapfirst';
export type TPiece = LayoutPiece | { fin: number };
export const S = (s: number | 'auto', hill?: number): LayoutPiece => (hill ? { s, hill } : { s });
export const A = (a: number, r: number, hill?: number): LayoutPiece => (hill ? { a, r, hill } : { a, r });
/** 減半徑彎（越轉越緊）：總角 a 分 n 片，半徑 r0 → r1 */
export const DR = (a: number, r0: number, r1: number, n = 3): LayoutPiece[] => Array.from({ length: n }, (_, i) => A(a / n, Math.round(r0 + (r1 - r0) * i / (n - 1))));
/** 雙頂點：兩個半彎中間一小段直線 */
export const DA = (a: number, r: number, gap = 60): LayoutPiece[] => [A(a / 2, r), S(gap), A(a / 2, r)];
/** 減速彎（chicane）：快速 -/+（dir=1 先右） */
export const CH = (a: number, r: number, dir = -1, out = a): LayoutPiece[] => [A(dir * a, r), A(-dir * out, r)];
/** 連續 S（esses）：n 片交替 */
export const ES = (n: number, a: number, r: number, dir = 1): LayoutPiece[] => Array.from({ length: n }, (_, i) => A((i % 2 ? -dir : dir) * a, r));
/** 270° 鑰匙孔（balloon）：先反向 45°，再轉 270°，再反向 45° → 淨 180°，不自交 */
export const KH = (r: number, rt = 250): LayoutPiece[] => [A(-45, rt), A(270, r), A(-45, rt)];
export const fin = (r: number) => ({ fin: r });
export const HP = 180;
export interface Tpl { insp: string; note: string; pieces: TPiece[] }
export const TEMPLATES: Record<string, Tpl> = {
  // ===== 台灣：入門 → 中等 =====
  tw1: { insp: 'Fuji Speedway（長直線＋T1 減速彎）', note: '公平的入門：一個 120° 煞車彎、其餘大彎', pieces: [S('auto'), A(120, 260), S(200), A(-30, 450), A(30, 450), S(200), A(60, 450), S(400), A(90, 350), S('auto'), A(-25, 320), A(25, 320), S(100), fin(400), S(100)] },
  tw2: { insp: '陽明山 仰德大道／陽金公路（S 彎接單一髮夾）', note: '霧中 S 彎＋一個下坡髮夾，入門第二關', pieces: [S(100), A(90, 260), S(40), A(-40, 200), A(40, 200), S(40, 1.5), A(90, 280), S('auto'), A(180, 200), S(40, -1.5), A(-90, 260), S('auto'), fin(260), S(100)] },
  tw3: { insp: 'Macau Guia（港邊直線→Lisboa 急右→街道直角）', note: '長直線尾端 100° 急彎＋街區直角', pieces: [S('auto'), A(90, 350), S('auto'), A(100, 170), A(-10, 300), S(300), A(90, 250), S(200), A(-90, 250), S(150), A(90, 250), S(300), fin(300), S(100)] },
  tw4: { insp: 'Isle of Man TT（海岸高速彎＋Ramsey 髮夾）', note: '高速掃彎→海岸 S 彎→R160 髮夾', pieces: [S('auto'), A(30, 450), S(100), A(-30, 450), A(90, 350), S('auto'), A(90, 300), S(200), ...CH(35, 250), S(200), A(90, 300), S(300), A(-90, 250), S(100), A(180, 160), S(100)] },
  // ===== 日本 =====
  jp1: { insp: '箱根 Turnpike ＋ いろは坂 連續髮夾', note: '3 個 R240 髮夾連發', pieces: [S('auto', 2), A(90, 320), S('auto'), A(180, 200), S(40, -2), A(-180, 200), S(300, 2), A(180, 200), S(80, -2), ...CH(30, 300), S(200), fin(300), S(100)] },
  jp2: { insp: '首都高 C1（窄 chicane＋箱崎 JCT 減半徑迴圈）', note: '高速直線接 R150 chicane、180° 迴圈越轉越緊到 R150', pieces: [S(300), A(90, 450), S(500), ...CH(35, 150), S(300), A(90, 450), S('auto'), ...DR(180, 300, 150, 4), S(200), A(-90, 350), S('auto'), fin(350), S(100)] },
  jp3: { insp: 'Suzuka（S 字、Degner 雙彎、髮夾、Spoon 雙頂點、130R、Casio chicane；8 字跨橋略過）', note: 'Esses 節奏、Degner 第二彎更緊', pieces: [S('auto'), A(60, 400), A(30, 260), S(100), ...ES(2, 35, 200, -1), S(200), A(45, 250), S(60), A(45, 200), S(300), A(-180, 200), S(200), ...DA(180, 220, 60), S(100), A(90, 400), S('auto'), ...CH(30, 170), S(100), fin(300), S(100)] },
  jp4: { insp: 'Autopolis／雪地大彎（減半徑彎、長 180° 掃彎）', note: '雪地上越轉越緊：減半徑 90° ×2＋長 180° 髮夾＋雪地 chicane', pieces: [S('auto'), ...DR(90, 450, 200), S('auto'), A(180, 220), S(200), A(-90, 260), S(150), ...CH(30, 200), S(150), A(90, 300), S(300), ...DR(90, 400, 170), S(100)] },
  // ===== 美國 =====
  us1: { insp: '舊 Hockenheim（森林長直線＋chicane＋Spitzkehre 髮夾）', note: '3 個 R150 chicane＋最高速直接進 R150 Spitzkehre', pieces: [S(300), A(90, 400), S(800), ...CH(25, 150), S(500), ...DR(90, 350, 180), S(300), ...CH(25, 150), S('auto'), A(180, 150), S(150), A(-90, 250), S('auto'), ...CH(25, 150, 1), S(200), fin(250), S(100)] },
  us2: { insp: 'Laguna Seca（Andretti 髮夾、Corkscrew 左右、Rainey）＋峽谷雙頂點', note: '盲彎 Corkscrew R150 左右連續', pieces: [S('auto'), A(150, 170), S(200), A(-60, 300), S('auto'), A(90, 300), S(300), A(-60, 150), A(80, 160), S(200), ...DA(90, 220, 80), S(200), fin(250), S(100)] },
  us3: { insp: 'Monaco（Ste Dévote、Casino、Mirabeau、Grand Hotel R140 髮夾、隧道、Nouvelle chicane、泳池）', note: 'R140 髮夾（全場最慢）＋隧道出口窄 chicane', pieces: [S('auto'), A(90, 180), S(300), A(-40, 220), A(50, 220), S(100), A(90, 200), S(80), A(-180, 140), S(80), A(90, 200), S(100), A(90, 220), S('auto'), ...CH(35, 140), S(200), A(60, 250), ...CH(40, 200), S(100), fin(220), S(100)] },
  us4: { insp: 'Bathurst Mount Panorama（Mountain 直線、The Cutting、Skyline→Esses→Dipper、Conrod、Chase）', note: '山頂 Esses 連續＋Conrod 後的 Chase', pieces: [S('auto'), A(90, 250), S(300), A(60, 250), S(100), A(-120, 150), S(100), A(60, 260), A(-30, 400), S(100), A(80, 200), ...ES(3, 55, 160), A(-50, 140), S(150), A(90, 250), S('auto'), ...CH(30, 180, 1), S(200), fin(250), S(100)] },
  // ===== 德國：最難 =====
  de1: { insp: 'Spa（Eau Rouge/Raidillon、Kemmel、Les Combes、La Source 型 R140 髮夾、Pouhon 雙頂點、Blanchimont、Bus Stop）', note: '高速 Blanchimont 直接進 R130 Bus Stop', pieces: [S('auto'), A(90, 300), S(200), A(-25, 300), A(40, 300), A(-15, 300), S('auto'), ...CH(40, 160, -1, 60), S(150), A(160, 140), S(200), ...DA(-90, 240, 80), S(300), A(50, 500), S(200), ...CH(45, 130, -1, 60), S(100), fin(250), S(100)] },
  de2: { insp: 'Nürburgring Nordschleife（Hatzenbach、Schwedenkreuz→Aremberg、Fuchsröhre、Adenauer Forst、Karussell、Brünnchen、Pflanzgarten）', note: '最殘酷：快彎後接髮夾、Karussell 減半徑到 R130', pieces: [S('auto'), ...ES(4, 35, 180, -1), S(200), A(30, 400), A(-20, 450), A(110, 150), S(150), A(-25, 300), A(30, 300), A(-25, 300), S(200), ...CH(50, 140, -1, 60), S(300), A(90, 200), S('auto'), ...DR(-180, 220, 130), S(150), A(90, 180), S(200), A(90, 170), S(100), ...ES(2, 40, 180), S(200), A(90, 220), S(200), fin(300), S(100)] },
  de3: { insp: 'Pikes Peak／Stelvio 雪地髮夾群', note: '4 個 R120–140 髮夾、髮夾間只有短直線', pieces: [S('auto', 2), A(90, 300), S('auto'), A(180, 140), S(140, -2), A(-180, 130), S(140, 2), A(180, 130), S(140, -2), A(-180, 120), S(150), ...DR(90, 350, 200), S(300), A(90, 250), S(300), fin(300), S(100)] },
  de4: { insp: 'Monza／Autobahn（Rettifilo R120 chicane、Curva Grande、Lesmo、Ascari）＋高速公路出口髮夾', note: '最高速直線直接進 R120 chicane ×5，最後交流道出口髮夾', pieces: [S('auto'), ...CH(30, 120, -1, 40), S(200), A(80, 700), S('auto'), ...CH(40, 120), S(200), A(90, 180), S(100), A(60, 180), S(250), ...CH(30, 120), S(250), A(-20, 600), ...CH(35, 120, -1, 45), S(150), ...CH(30, 120, 1), S(150), A(130, 150), S(100)] },
};
/** fin 補角後的平面佈局 */
export function resolve(t: Tpl): LayoutPiece[] {
  const sum = t.pieces.reduce((s, p) => s + ('a' in p ? p.a : 0), 0);
  return t.pieces.map((p) => ('fin' in p ? A(360 - sum, p.fin) : p)) as LayoutPiece[];
}
