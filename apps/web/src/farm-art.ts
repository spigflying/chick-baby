// 農場場景的寫實 3D 素材與 SVG 互動層。物件依 farm-layout 的 Box 放置，狀態標示仍由程式疊加。
import type { Crate, CropId, DecoId, Stage, StallSlot } from '@chick/engine';
import { EAST, LAYOUT, SCENE, type Box } from './farm-layout';

const INK = '#4b3a33';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// 透明底：整個框都點得到（小攤、熱氣球這種中間有空隙的圖也一樣）
const fit = (b: Box, nw: number, nh: number, inner: string) => `<g transform="translate(${b.x} ${b.y}) scale(${(b.w / nw).toFixed(4)} ${(b.h / nh).toFixed(4)})"><rect class="hitbg" width="${nw}" height="${nh}" fill="transparent"/>${inner}</g>`;
const shadow = (cx: number, cy: number, rx: number, ry: number, o = 0.08) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${o}"/>`;
const farmImage = (name: string, x: number, y: number, w: number, h: number, aspect = 'xMidYMax meet') => `<image href="${import.meta.env.BASE_URL}farm/${name}${name.endsWith('.jpg') ? '' : '.png'}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${aspect}"/>`;
const farmProp = (b: Box, name: string, nw: number, nh: number) => fit(b, nw, nh, farmImage(name, 0, 0, nw, nh));
const use = (id: string, x: number, y: number, s: number) => `<use href="#fi-${id}" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
function farmBuilding(b: Box, name: string, nw: number, nh: number, locked: boolean, unlockLevel: number, label: string, overlay = ''): string {
  let o = locked ? `<g opacity=".5">${farmImage(name, 0, 0, nw, nh)}</g>` : farmImage(name, 0, 0, nw, nh);
  if (locked) {
    o += `<rect x="${nw / 2 - 70}" y="${nh / 2 - 13}" width="140" height="30" rx="10" fill="#ead8b7" stroke="#927d62" stroke-width="3"/>`;
    o += `<text x="${nw / 2}" y="${nh / 2 + 8}" text-anchor="middle" font-size="14" font-weight="800" fill="#473b30">Lv ${unlockLevel}：${esc(label)}</text>`;
  } else {
    o += overlay;
    o += `<rect x="${nw / 2 - 46}" y="${nh - 24}" width="92" height="20" rx="8" fill="#ead8b7" stroke="#927d62" stroke-width="2"/>`;
    o += `<text x="${nw / 2}" y="${nh - 9}" text-anchor="middle" font-size="12" font-weight="800" fill="#473b30">${esc(label)}</text>`;
  }
  return fit(b, nw, nh, o);
}

// ---------- 共用定義 ----------
export function sceneDefs(): string {
  return `<defs>
    <linearGradient id="fg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ed9ff"/><stop offset="1" stop-color="#e3f6ff"/></linearGradient>
    <linearGradient id="fg-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8e889"/><stop offset="1" stop-color="#7fcf66"/></linearGradient>
    <linearGradient id="fg-soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c98a5b"/><stop offset="1" stop-color="#b0744a"/></linearGradient>
    <radialGradient id="fg-chick" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#fff3a6"/><stop offset="1" stop-color="#ffcf3a"/></radialGradient>
    <radialGradient id="fg-pond" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#bfeaff"/><stop offset="1" stop-color="#6cc4f2"/></radialGradient>
    <radialGradient id="fg-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#ffb347"/></radialGradient>
    <radialGradient id="fg-egg" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f3dcc0"/></radialGradient>
    <radialGradient id="fg-apple" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a8a"/><stop offset="1" stop-color="#e4404f"/></radialGradient>
    <radialGradient id="fg-coin" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe68a"/><stop offset="1" stop-color="#f4b400"/></radialGradient>
    <radialGradient id="fg-pumpkin" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#ffc27a"/><stop offset="1" stop-color="#ff8a2a"/></radialGradient>
    <linearGradient id="fg-bread" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b76a"/><stop offset="1" stop-color="#d98a3d"/></linearGradient>
    <pattern id="fg-tiles" width="22" height="14" patternUnits="userSpaceOnUse"><rect width="22" height="14" fill="#ff8fab"/><path d="M0 14 Q11 2 22 14" fill="#ff7799"/></pattern>
    <pattern id="fg-tilesB" width="22" height="14" patternUnits="userSpaceOnUse"><rect width="22" height="14" fill="#ff9b85"/><path d="M0 14 Q11 2 22 14" fill="#f5826b"/></pattern>
    <pattern id="fg-tilesY" width="22" height="14" patternUnits="userSpaceOnUse"><rect width="22" height="14" fill="#ffd166"/><path d="M0 14 Q11 2 22 14" fill="#f5bd45"/></pattern>
    <pattern id="fg-tilesP" width="22" height="14" patternUnits="userSpaceOnUse"><rect width="22" height="14" fill="#c38cff"/><path d="M0 14 Q11 2 22 14" fill="#ad6ff5"/></pattern>
  </defs>`;
}

/** 圖示（主畫面與子畫面共用）：<symbol id="fi-…">。 */
export function iconSymbols(): string {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${sceneDefs()}
  <symbol id="fi-wheat" viewBox="0 0 40 40"><path d="M20 38 V12" stroke="#c7922f" stroke-width="2.6" stroke-linecap="round"/>
    <g fill="#ffcf4d" stroke="#e5a72a" stroke-width="1"><ellipse cx="20" cy="7" rx="3.2" ry="5"/><ellipse cx="15" cy="13" rx="3" ry="4.8" transform="rotate(-30 15 13)"/><ellipse cx="25" cy="13" rx="3" ry="4.8" transform="rotate(30 25 13)"/><ellipse cx="15" cy="21" rx="3" ry="4.8" transform="rotate(-30 15 21)"/><ellipse cx="25" cy="21" rx="3" ry="4.8" transform="rotate(30 25 21)"/><ellipse cx="15.5" cy="29" rx="2.8" ry="4.4" transform="rotate(-30 15.5 29)"/><ellipse cx="24.5" cy="29" rx="2.8" ry="4.4" transform="rotate(30 24.5 29)"/></g></symbol>
  <symbol id="fi-carrot" viewBox="0 0 40 40"><g fill="#5fcf6a"><ellipse cx="17" cy="9" rx="3" ry="7" transform="rotate(-25 17 9)"/><ellipse cx="23" cy="9" rx="3" ry="7" transform="rotate(25 23 9)"/><ellipse cx="20" cy="7" rx="3" ry="7"/></g>
    <path d="M12 15 Q20 12 28 15 L21.5 37 Q20 39 18.5 37 Z" fill="#ff9a3d"/><path d="M15 21 h5 M17 27 h4 M18 32 h3" stroke="#e57a1f" stroke-width="1.6" stroke-linecap="round"/></symbol>
  <symbol id="fi-strawberry" viewBox="0 0 40 40"><path d="M7 15 Q20 10 33 15 Q32 30 20 37 Q8 30 7 15 Z" fill="#ff5f6d"/><g fill="#ffe08a"><circle cx="14" cy="19" r="1.2"/><circle cx="20" cy="18" r="1.2"/><circle cx="26" cy="19" r="1.2"/><circle cx="17" cy="25" r="1.2"/><circle cx="23" cy="25" r="1.2"/><circle cx="20" cy="31" r="1.2"/></g><path d="M11 14 Q20 4 29 14 Q20 11 11 14 Z" fill="#5fcf6a"/></symbol>
  <symbol id="fi-pumpkin" viewBox="0 0 40 40"><path d="M20 11 Q21 5 25 4" stroke="#6b8f3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="12" cy="24" rx="8" ry="11" fill="url(#fg-pumpkin)"/><ellipse cx="28" cy="24" rx="8" ry="11" fill="url(#fg-pumpkin)"/><ellipse cx="20" cy="24" rx="9" ry="12" fill="#ffa44a"/>
    <path d="M20 17 q-4 -4 -6 0 q-2 4 6 9 q8 -5 6 -9 q-2 -4 -6 0 Z" fill="#ff6f91"/></symbol>
  <symbol id="fi-egg" viewBox="0 0 40 40"><ellipse cx="20" cy="22" rx="12" ry="15" fill="url(#fg-egg)" stroke="#e5c9a6" stroke-width="1.2"/><ellipse cx="15" cy="15" rx="3" ry="4.5" fill="#fff" opacity=".9"/></symbol>
  <symbol id="fi-wool" viewBox="0 0 40 40"><circle cx="20" cy="21" r="14" fill="#ffb3c7"/><g fill="none" stroke="#ff86a6" stroke-width="2" stroke-linecap="round"><path d="M9 17 Q20 10 31 17"/><path d="M7 24 Q20 15 33 24"/><path d="M10 31 Q20 23 30 30"/></g><path d="M31 30 Q37 35 34 38" stroke="#ff86a6" stroke-width="2" fill="none" stroke-linecap="round"/></symbol>
  <symbol id="fi-bread" viewBox="0 0 40 40"><path d="M5 27 Q4 12 20 11 Q36 12 35 27 Q35 32 30 32 H10 Q5 32 5 27 Z" fill="url(#fg-bread)"/><g stroke="#fff2d6" stroke-width="2.2" stroke-linecap="round"><path d="M13 16 l3 6"/><path d="M19 15 l3 6"/><path d="M25 16 l3 6"/></g></symbol>
  <symbol id="fi-apple" viewBox="0 0 40 40"><path d="M20 11 Q21 5 26 4" stroke="#8a5a32" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="26" cy="8" rx="5" ry="2.6" fill="#5fcf6a" transform="rotate(-20 26 8)"/><circle cx="20" cy="23" r="13" fill="url(#fg-apple)"/><ellipse cx="14.5" cy="18" rx="3" ry="4" fill="#fff" opacity=".7"/></symbol>
  <symbol id="fi-jam" viewBox="0 0 40 40"><rect x="9" y="13" width="22" height="23" rx="6" fill="#ff5f6d"/><rect x="8" y="8" width="24" height="7" rx="3" fill="#fff"/><path d="M8 11 h24" stroke="#ff8fab" stroke-width="2" stroke-dasharray="3 3"/><rect x="13" y="20" width="14" height="10" rx="3" fill="#fff4f6"/><path d="M20 22 q-2 -2 -3 0 q-1 2 3 5 q4 -3 3 -5 q-1 -2 -3 0 Z" fill="#ff5f6d"/><ellipse cx="13" cy="30" rx="1.6" ry="3" fill="#fff" opacity=".5"/></symbol>
  <symbol id="fi-coin" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="url(#fg-coin)" stroke="#e0a000" stroke-width="1.5"/><circle cx="20" cy="20" r="10" fill="none" stroke="#fff4bf" stroke-width="2.4"/><circle cx="20" cy="20" r="4.5" fill="#fff4bf"/></symbol>
  <symbol id="fi-box" viewBox="0 0 40 40"><path d="M6 14 L20 7 L34 14 V30 L20 37 L6 30 Z" fill="#e8a96b"/><path d="M6 14 L20 21 L34 14" fill="none" stroke="#c9844a" stroke-width="2"/><path d="M20 21 V37" stroke="#c9844a" stroke-width="2"/><path d="M13 10.5 L27 17.5" stroke="#fff1d8" stroke-width="3"/></symbol>
  <symbol id="fi-heart" viewBox="0 0 40 40"><path d="M20 35 Q4 24 5 14 Q7 6 14 6 Q18 6 20 11 Q22 6 26 6 Q33 6 35 14 Q36 24 20 35 Z" fill="#ff7fa0"/><ellipse cx="12" cy="13" rx="3" ry="2" fill="#fff" opacity=".7"/></symbol>
  <symbol id="fi-shop" viewBox="0 0 40 40"><rect x="7" y="17" width="26" height="18" rx="3" fill="#fff1dc" stroke="#e0b48a" stroke-width="1.5"/><path d="M5 17 L9 7 H31 L35 17 Z" fill="#ff8fab"/><path d="M9 7 L11 17 M16 7 L16.5 17 M24 7 L23.5 17 M31 7 L29 17" stroke="#fff" stroke-width="2.2"/><rect x="16" y="24" width="8" height="11" rx="2" fill="#7fd6b4"/></symbol>
  <symbol id="fi-board" viewBox="0 0 40 40"><rect x="6" y="6" width="28" height="26" rx="4" fill="#e7a86a"/><rect x="10" y="10" width="9" height="11" rx="1.5" fill="#fff" transform="rotate(-6 14 15)"/><rect x="21" y="11" width="9" height="11" rx="1.5" fill="#fff4f8" transform="rotate(5 25 16)"/><circle cx="14" cy="10" r="1.6" fill="#ff5f7e"/><circle cx="25.5" cy="11" r="1.6" fill="#63b6f2"/><rect x="11" y="32" width="3" height="6" fill="#b8763f"/><rect x="26" y="32" width="3" height="6" fill="#b8763f"/></symbol>
  <symbol id="fi-friend" viewBox="0 0 40 40"><circle cx="14" cy="18" r="9" fill="#ffe066"/><circle cx="27" cy="20" r="9" fill="#ffd0dc"/><circle cx="11.5" cy="17" r="1.3" fill="${INK}"/><circle cx="16.5" cy="17" r="1.3" fill="${INK}"/><circle cx="24.5" cy="19" r="1.3" fill="${INK}"/><circle cx="29.5" cy="19" r="1.3" fill="${INK}"/><path d="M13 21 l1 1.2 1-1.2" fill="#ff9f43"/><path d="M8 34 Q20 26 33 34" stroke="#ff7fa0" stroke-width="3" fill="none" stroke-linecap="round"/></symbol>
  <symbol id="fi-home" viewBox="0 0 40 40"><path d="M5 19 L20 7 L35 19" fill="#ff9b85"/><path d="M5 19 L20 7 L35 19" fill="none" stroke="#ff7a63" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><rect x="9" y="18" width="22" height="17" rx="2" fill="#fff1dc"/><rect x="17" y="24" width="6" height="11" rx="2" fill="#c38cff"/></symbol>
  <symbol id="fi-oven" viewBox="0 0 40 40"><path d="M6 34 V20 Q6 8 20 8 Q34 8 34 20 V34 Z" fill="#ffb59a"/><path d="M12 34 V24 Q12 17 20 17 Q28 17 28 24 V34 Z" fill="#5a3427"/><path d="M14 34 Q16 26 20 30 Q24 25 26 34 Z" fill="#ffb33d"/></symbol>
  <symbol id="fi-water" viewBox="0 0 40 40"><path d="M20 6 Q30 20 30 26 Q30 35 20 35 Q10 35 10 26 Q10 20 20 6 Z" fill="#7fc8ff"/><ellipse cx="16" cy="25" rx="2.5" ry="4" fill="#fff" opacity=".7"/></symbol>
  <symbol id="fi-honey" viewBox="0 0 40 40"><path d="M10 14 Q10 9 15 9 H25 Q30 9 30 14 V30 Q30 36 20 36 Q10 36 10 30 Z" fill="#ffc53d"/><rect x="11" y="5" width="18" height="6" rx="3" fill="#f39c3d"/><path d="M10 17 Q14 22 17 17 Q20 24 23 17 Q26 21 30 17" fill="none" stroke="#fff3c4" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="15" cy="27" rx="2" ry="4" fill="#fff" opacity=".55"/></symbol>
  <symbol id="fi-milk" viewBox="0 0 40 40"><path d="M13 6 H27 V12 L31 18 V34 Q31 37 28 37 H12 Q9 37 9 34 V18 L13 12 Z" fill="#fff" stroke="#bfe3ff" stroke-width="1.6"/><rect x="12" y="4" width="16" height="5" rx="2" fill="#6cc4f2"/><path d="M9 24 Q20 20 31 24 V34 Q31 37 28 37 H12 Q9 37 9 34 Z" fill="#dff1ff"/><circle cx="20" cy="29" r="4" fill="#ff9fb8"/></symbol>
  <symbol id="fi-honeycake" viewBox="0 0 40 40"><path d="M6 22 Q6 16 12 16 H28 Q34 16 34 22 V31 Q34 35 30 35 H10 Q6 35 6 31 Z" fill="#f6c27a"/><path d="M6 22 Q6 16 12 16 H28 Q34 16 34 22 Q30 26 26 22 Q22 27 18 22 Q14 26 10 22 Q8 24 6 22 Z" fill="#ffd34d"/><rect x="6" y="27" width="28" height="3" fill="#fff1d8"/><circle cx="20" cy="12" r="4.5" fill="#ff5f6d"/><path d="M20 8 q2 -4 5 -4" stroke="#5fcf6a" stroke-width="2" fill="none" stroke-linecap="round"/></symbol>
  <symbol id="fi-cheese" viewBox="0 0 40 40"><path d="M5 28 L30 9 Q36 14 35 22 V31 Q35 34 32 34 H8 Q5 34 5 31 Z" fill="#ffd84d"/><path d="M5 28 L30 9 Q36 14 35 22 L5 28 Z" fill="#ffe98a"/><g fill="#f5bd45"><circle cx="14" cy="30" r="2.4"/><circle cx="25" cy="28" r="3"/><circle cx="30" cy="20" r="1.8"/></g></symbol>
  <symbol id="fi-balloon" viewBox="0 0 40 40"><path d="M20 3 Q34 3 34 16 Q34 24 24 29 H16 Q6 24 6 16 Q6 3 20 3 Z" fill="#ff8fab"/><path d="M20 3 Q27 3 27 16 Q27 24 22 29 H18 Q13 24 13 16 Q13 3 20 3 Z" fill="#ffd166"/><path d="M20 3 V29" stroke="#7fd6b4" stroke-width="3"/><rect x="15" y="31" width="10" height="7" rx="2" fill="#c9844a"/><path d="M16 29 L16 31 M24 29 L24 31" stroke="#8a5a32" stroke-width="1.4"/></symbol>
  <symbol id="fi-stall" viewBox="0 0 40 40"><rect x="7" y="18" width="26" height="16" rx="3" fill="#fff1dc" stroke="#e0b48a" stroke-width="1.5"/><path d="M5 18 Q8 9 12 9 H28 Q32 9 35 18 Z" fill="#7fd6b4"/><path d="M5 18 q3.75 4 7.5 0 q3.75 4 7.5 0 q3.75 4 7.5 0 q3.75 4 7.5 0" fill="#fff"/><circle cx="14" cy="26" r="3" fill="#ff5f6d"/><circle cx="22" cy="26" r="3" fill="#ffd34d"/><rect x="8" y="34" width="3" height="4" fill="#b8763f"/><rect x="29" y="34" width="3" height="4" fill="#b8763f"/></symbol>
  </svg>`;
}

// ---------- 背景 ----------
export function background(): string {
  let o = farmImage('background-main-v2.jpg', 0, 0, SCENE.w, SCENE.h, 'none');
  o += farmImage('pond', LAYOUT.pond.x, LAYOUT.pond.y - 18, LAYOUT.pond.w, LAYOUT.pond.h + 36, 'none');
  return o;
}
// ---------- 田 ----------
/** 一塊田（標準尺寸 120×84）。圖片包含超出田格上緣的作物，解鎖文字由程式疊在空白石牌上。 */
export function field(b: Box, crop: CropId | null, stage: Stage | null, locked: boolean, unlockLevel = 0): string {
  const name = locked ? 'locked' : !crop || stage === null ? 'empty'
    : stage === 0 ? 'seed' : stage === 1 ? 'sprout' : stage === 2 ? 'grow' : `${crop}-ready`;
  // 圖片含上方作物與下方土層；固定同一畫布，切換生長階段時位置不跳動。
  let o = `<image href="${import.meta.env.BASE_URL}farm/field-${name}.png" x="0" y="-37.5" width="120" height="120"/>`;
  if (locked) o += `<text x="60" y="0" text-anchor="middle" font-size="14" font-weight="800" fill="#554338">Lv ${unlockLevel || ''} 解鎖</text>`;
  return fit(b, 120, 84, o);
}


// ---------- 動物 ----------
/** 可收取物仍由程式疊在動物圈上。 */
export function hutch(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  const items = ready.map((r, i) => r ? `<g class="bob">${use('wool', i ? 132 : 62, 8, 28)}</g>` : '').join('');
  return farmBuilding(b, 'hutch', 230, 110, locked, unlockLevel, '兔兔窩', items);
}
export function coop(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  const items = ready.map((r, i) => r ? `<g class="bob">${use('egg', i ? 132 : 62, 8, 28)}</g>` : '').join('');
  return farmBuilding(b, 'coop', 230, 110, locked, unlockLevel, '雞舍', items);
}
// ---------- 加工站 ----------
const smoke = (busy: boolean) => busy ? `<g class="smoke" fill="#fff" opacity=".8"><circle cx="138" cy="18" r="9"/><circle cx="138" cy="18" r="9"/><circle cx="138" cy="18" r="9"/></g>` : '';
export function bakery(b: Box, busy: boolean, locked: boolean, unlockLevel: number): string {
  return farmBuilding(b, 'bakery', 170, 170, locked, unlockLevel, '烘焙屋', smoke(busy));
}
export function jamhouse(b: Box, busy: boolean, locked: boolean, unlockLevel: number): string {
  return farmBuilding(b, 'jamhouse', 170, 170, locked, unlockLevel, '果醬工坊', smoke(busy));
}
// ---------- 果樹、看板、倉庫 ----------
export function tree(b: Box, state: 'growing' | 'ready' | 'withered'): string {
  return farmProp(b, `tree-${state}`, 140, 130);
}
export function board(b: Box, alert: boolean): string {
  let o = farmImage('board', 0, 0, 110, 100);
  if (alert) o += `<g class="alert"><circle cx="98" cy="12" r="15" fill="#b84838" stroke="#fff" stroke-width="3"/><text x="98" y="19" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">!</text></g>`;
  return fit(b, 110, 100, o);
}
export function barn(b: Box): string { return farmProp(b, 'barn', 180, 140); }
// ---------- 小雞與標籤 ----------
/** 戴草帽的小雞（腳底在 y+40）。look：身體顏色（用目前寵物的物種色）。 */
export function chick(x: number, y: number, look: { body: string; belly: string }): string {
  const species = look.body === '#fff4d6' ? 'duck' : look.body === '#9ad7ff' ? 'penguin' : look.body === '#9be37a' ? 'dino' : 'chick';
  return `<g class="bob">${farmImage(species, x - 43, y - 50, 86, 96)}</g>`;
}
const PILL: Record<'ready' | 'timer' | 'lock' | 'alert', [string, string]> = { ready: ['#7fd6b4', '#1f4d3d'], timer: ['#ffffff', INK], lock: ['#f3c08c', '#7a4a2c'], alert: ['#ff5f7e', '#ffffff'] };
/** 標籤泡泡（中心 cx，底部尖角在 y+22）。 */
export function pill(cx: number, y: number, text: string, tone: 'ready' | 'timer' | 'lock' | 'alert'): string {
  const [bg, fg] = PILL[tone];
  const clockIcon = tone === 'timer';
  const w = Math.max(44, [...text].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 15 : 8.5), 0) + (clockIcon ? 34 : 22));
  const tx = clockIcon ? 9 : 0;
  return `<g transform="translate(${cx} ${y})" pointer-events="none"><path d="M-8 14 L0 22 L8 14" fill="${bg}"/><rect x="${-w / 2}" y="-14" width="${w}" height="29" rx="14.5" fill="${bg}"/>${clockIcon ? `<g transform="translate(${-w / 2 + 16} 1)"><circle r="8" fill="#ffd166"/><path d="M0 -4 V0 H3.5" stroke="#5a4310" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>` : ''}<text x="${tx}" y="6" text-anchor="middle" font-size="15" font-weight="800" fill="${fg}">${esc(text)}</text></g>`;
}

// ======================================================================
// 第二階段：東邊新地
// ======================================================================
/** 東邊新地的背景：草坡、小路、花叢、遠方山丘上的風車。 */
export function eastBackground(): string {
  return farmImage('background-east-v2.jpg', 0, 0, SCENE.w, SCENE.h, 'none');
}
export function sign(b: Box, text: string, locked: boolean, left = false): string {
  const arrow = left ? 'M4 18 L18 4 H74 V32 H18 Z' : 'M74 18 L60 4 H4 V32 H60 Z';
  let o = shadow(39, 44, 22, 4) + `<rect x="35" y="24" width="8" height="22" rx="3" fill="#b8763f"/>`;
  o += `<path d="${arrow}" transform="translate(0 2)" fill="#d8955a"/><path d="${arrow}" fill="${locked ? '#e8d6c0' : '#f3c08c'}" stroke="#d8955a" stroke-width="2" stroke-linejoin="round"/>`;
  o += `<text x="${left ? 44 : 34}" y="23" text-anchor="middle" font-size="12" font-weight="800" fill="${locked ? '#9a8470' : '#7a4a2c'}">${esc(text)}</text>`;
  return fit(b, 78, 46, o);
}

export function beehive(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  const items = ready.map((r, i) => r ? `<g class="bob">${use('honey', i ? 92 : 30, 4, 26)}</g>` : '').join('');
  return farmBuilding(b, 'beehive', 150, 120, locked, unlockLevel, '蜂箱', items);
}
export function cowshed(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  const items = ready.map((r, i) => r ? `<g class="bob">${use('milk', i ? 132 : 62, 8, 28)}</g>` : '').join('');
  return farmBuilding(b, 'cowshed', 230, 110, locked, unlockLevel, '牛棚', items);
}
export function dairy(b: Box, busy: boolean, locked: boolean, unlockLevel: number): string {
  return farmBuilding(b, 'dairy', 170, 170, locked, unlockLevel, '起司小屋', smoke(busy));
}
export function balloon(b: Box, st: { state: 'locked' } | { state: 'away'; remainMs: number } | { state: 'here'; remainMs: number; crates: (Crate & { canFill?: boolean })[] }, unlockLevel: number): string {
  if (st.state === 'locked') return farmBuilding(b, 'balloon', 190, 154, true, unlockLevel, '熱氣球');
  let o = st.state === 'away' ? `<g opacity=".28">${farmImage('balloon', 0, 0, 190, 154)}</g>` : farmImage('balloon', 0, 0, 190, 154);
  if (st.state === 'here') st.crates.slice(0, 4).forEach((c, i) => {
    const x = [12, 40, 132, 160][i], y = 116;
    o += `<g><rect x="${x - 2}" y="${y}" width="25" height="21" rx="3" fill="${c.filled ? '#e6c77a' : '#ae8562'}" stroke="#755a47" stroke-width="2"/>${use(c.item, x + 1, y - 15, 18)}${c.filled ? `<circle cx="${x + 21}" cy="${y + 2}" r="6" fill="#6b9760"/><path d="M${x + 18} ${y + 2} l2 2 l4 -4" stroke="#fff" stroke-width="2" fill="none"/>` : ''}</g>`;
  });
  return fit(b, 190, 154, o);
}
export function stall(b: Box, slots: (StallSlot | null)[], locked: boolean, unlockLevel: number): string {
  if (locked) return farmBuilding(b, 'stall', 200, 96, true, unlockLevel, '小攤');
  let o = farmImage('stall', 0, 0, 200, 96);
  slots.slice(0, 4).forEach((item, i) => {
    if (!item) return;
    const x = 28 + i * 38;
    o += `${use(item.item, x, 43, 27)}<rect x="${x - 2}" y="73" width="32" height="13" rx="5" fill="#ead8b7"/><text x="${x + 14}" y="83" text-anchor="middle" font-size="10" font-weight="800" fill="#473b30">◎${item.price}</text>`;
  });
  return fit(b, 200, 96, o);
}

/** 裝飾格（標準尺寸 120×110）。id null：空格（主人看得到虛線＋「＋」，訪客只看到草地）。 */
export function deco(b: Box, id: DecoId | null, owner: boolean): string {
  if (id) return farmProp(b, `deco-${id}`, 120, 110);
  const o = owner ? `<circle cx="60" cy="48" r="17" fill="#f7efd8" stroke="#a38253" stroke-width="3"/><text x="60" y="57" text-anchor="middle" font-size="27" font-weight="800" fill="#6a583d">＋</text>` : '';
  return fit(b, 120, 110, o);
}
