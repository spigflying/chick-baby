/** 草稿 v2（未接到 racing.ts）：由 racing-prod-layouts2.templates.ts 經 scripts/prod-layouts2.ts 補角＋調直線長度後的結果。 */
import type { LayoutPiece } from './racing-mapfirst';
const S = (s: number | 'auto', hill?: number): LayoutPiece => (hill ? { s, hill } : { s });
const A = (a: number, r: number, hill?: number): LayoutPiece => (hill ? { a, r, hill } : { a, r });
export const PROD_LAYOUTS2_DRAFT: Record<string, LayoutPiece[]> = {
  // Fuji Speedway（長直線＋T1 減速彎）
  tw1: [S('auto'), A(120, 250), S(40), A(-30, 450), A(30, 450), S(40), A(60, 450), S(60), A(90, 330), S('auto'), A(-25, 300), A(25, 300), S(100), A(90, 400), S(100)],
  // 陽明山 仰德大道／陽金公路（S 彎接單一髮夾）
  tw2: [S(100), A(90, 270), S(40), A(-40, 270), A(40, 270), S(40, 1.5), A(90, 360), S('auto'), A(180, 250), S(40, -1.5), A(-90, 270), S('auto'), A(90, 270), S(100)],
  // Macau Guia（港邊直線→Lisboa 急右→街道直角）
  tw3: [S('auto'), A(90, 330), S('auto'), A(100, 160), A(-10, 250), S(40), A(90, 240), S(40), A(-90, 240), S(50), A(90, 240), S(40), A(90, 250), S(100)],
  // Isle of Man TT（海岸高速彎＋Ramsey 髮夾）
  tw4: [S('auto'), A(30, 450), S(460), A(-30, 450), A(90, 399), S('auto'), A(90, 310), S(40), A(-35, 250), A(35, 250), S(40), A(90, 350), S(160), A(-90, 290), S(40), A(180, 180), S(100)],
  // 箱根 Turnpike ＋ いろは坂 連續髮夾
  jp1: [S('auto', 2), A(90, 320), S('auto'), A(180, 200), S(40, -2), A(-180, 200), S(300, 2), A(180, 200), S(40, -2), A(-30, 300), A(30, 300), S(160), A(90, 300), S(100)],
  // 首都高 C1（窄 chicane＋箱崎 JCT 減半徑迴圈）
  jp2: [S(300), A(90, 410), S(40), A(-35, 120), A(35, 120), S(40), A(90, 410), S('auto'), A(45, 230), A(45, 190), A(45, 150), A(45, 120), S(40), A(-90, 240), S('auto'), A(90, 260), S(100)],
  // Suzuka（S 字、Degner 雙彎、髮夾、Spoon 雙頂點、130R、Casio chicane；8 字跨橋略過）
  jp3: [S('auto'), A(60, 400), A(30, 240), S(40), A(-35, 200), A(35, 200), S(40), A(45, 250), S(40), A(45, 200), S(60), A(-180, 200), S(40), A(90, 220), S(40), A(90, 220), S(160), A(90, 400), S('auto'), A(-30, 170), A(30, 170), S(100), A(90, 300), S(100)],
  // Autopolis／雪地大彎（減半徑彎、長 180° 掃彎）
  jp4: [S('auto'), A(30, 450), A(30, 240), A(30, 150), S('auto'), A(180, 170), S(40), A(-90, 200), S(150), A(-30, 150), A(30, 150), S(150), A(90, 230), S(300), A(30, 400), A(30, 210), A(30, 130), S(100)],
  // 舊 Hockenheim（森林長直線＋chicane＋Spitzkehre 髮夾）
  us1: [S(300), A(90, 400), S(140), A(-25, 150), A(25, 150), S(160), A(30, 350), A(30, 270), A(30, 180), S(300), A(-25, 150), A(25, 150), S('auto'), A(180, 150), S(50), A(-90, 250), S('auto'), A(25, 150), A(-25, 150), S(200), A(90, 250), S(100)],
  // Laguna Seca（Andretti 髮夾、Corkscrew 左右、Rainey）＋峽谷雙頂點
  us2: [S('auto'), A(150, 120), S(40), A(-60, 200), S('auto'), A(90, 200), S(300), A(-60, 120), A(80, 120), S(860), A(45, 140), S(40), A(45, 140), S(200), A(70, 160), S(100)],
  // Monaco（Ste Dévote、Casino、Mirabeau、Grand Hotel R140 髮夾、隧道、Nouvelle chicane、泳池）
  us3: [S('auto'), A(90, 170), S(40), A(-40, 210), A(50, 210), S(40), A(90, 190), S(40), A(-180, 130), S(40), A(90, 190), S(40), A(90, 210), S('auto'), A(-35, 130), A(35, 130), S(200), A(60, 240), A(-40, 190), A(40, 190), S(740), A(110, 210), S(100)],
  // Bathurst Mount Panorama（Mountain 直線、The Cutting、Skyline→Esses→Dipper、Conrod、Chase）
  us4: [S('auto'), A(90, 200), S(40), A(60, 200), S(40), A(-120, 120), S(40), A(60, 210), A(-30, 400), S(40), A(80, 160), A(55, 130), A(-55, 130), A(55, 130), A(-50, 120), S(50), A(90, 200), S('auto'), A(30, 140), A(-30, 140), S(200), A(125, 200), S(100)],
  // Spa（Eau Rouge/Raidillon、Kemmel、Les Combes、La Source 型 R140 髮夾、Pouhon 雙頂點、Blanchimont、Bus Stop）
  de1: [S('auto'), A(90, 180), S(200), A(-25, 180), A(40, 180), A(-15, 180), S('auto'), A(-40, 120), A(60, 120), S(350), A(160, 120), S(140), A(-45, 140), S(240), A(-45, 140), S(300), A(50, 500), S(200), A(-45, 120), A(60, 120), S(100), A(115, 150), S(100)],
  // Nürburgring Nordschleife（Hatzenbach、Schwedenkreuz→Aremberg、Fuchsröhre、Adenauer Forst、Karussell、Brünnchen、Pflanzgarten）
  de2: [S('auto'), A(-35, 150), A(35, 150), A(-35, 150), A(35, 150), S(200), A(30, 400), A(-20, 410), A(110, 130), S(50), A(-25, 240), A(30, 240), A(-25, 240), S(40), A(-50, 120), A(60, 120), S(40), A(90, 170), S('auto'), A(-60, 190), A(-60, 150), A(-60, 120), S(50), A(90, 150), S(40), A(90, 140), S(460), A(40, 150), A(-40, 150), S(200), A(90, 190), S(700), A(70, 260), S(100)],
  // Pikes Peak／Stelvio 雪地髮夾群
  de3: [S('auto', 2), A(90, 280), S('auto'), A(180, 150), S(40, -2), A(-180, 140), S(40, 2), A(180, 140), S(40, -2), A(-180, 130), S(50), A(30, 290), A(30, 250), A(30, 210), S(40), A(90, 240), S(240), A(90, 320), S(100)],
  // Monza／Autobahn（Rettifilo R120 chicane、Curva Grande、Lesmo、Ascari）＋高速公路出口髮夾
  de4: [S('auto'), A(-30, 120), A(40, 120), S(100), A(80, 660), S('auto'), A(-40, 120), A(40, 120), S(200), A(90, 120), S(760), A(60, 120), S(210), A(-30, 120), A(30, 120), S(230), A(-20, 600), A(-35, 120), A(45, 120), S(150), A(30, 120), A(-30, 120), S(150), A(130, 120), S(100)],
};
