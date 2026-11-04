// 小雞農場的原創向量美術（SVG 字串片段）。風格基準：草圖第 3 版——彩色可愛插畫、圓角、腮紅、柔和陰影。
// 每個建築在自己的「標準尺寸」座標裡畫，再依 farm-layout 的 Box 縮放。動畫只用 CSS class（style.css 的 .farm 範圍）。
import type { Crate, CropId, DecoId, FarmItemId, Stage, StallSlot } from '@chick/engine';
import { EAST, LAYOUT, SCENE, type Box } from './farm-layout';

const INK = '#4b3a33';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fit = (b: Box, nw: number, nh: number, inner: string) => `<g transform="translate(${b.x} ${b.y}) scale(${(b.w / nw).toFixed(4)} ${(b.h / nh).toFixed(4)})">${inner}</g>`;
const shadow = (cx: number, cy: number, rx: number, ry: number, o = 0.08) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${o}"/>`;
const sparkle = (x: number, y: number, s: number, d2 = false) => `<path class="tw${d2 ? ' d2' : ''}" d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z" fill="#fff"/>`;
const use = (id: string, x: number, y: number, s: number) => `<use href="#fi-${id}" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
function flower(x: number, y: number, c: string, r = 5) {
  let out = '<g>';
  for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; out += `<circle cx="${(x + Math.cos(t) * r).toFixed(1)}" cy="${(y + Math.sin(t) * r).toFixed(1)}" r="${r * 0.75}" fill="${c}"/>`; }
  return out + `<circle cx="${x}" cy="${y}" r="${r * 0.6}" fill="#ffe066"/></g>`;
}
const bush = (x: number, y: number, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${shadow(0, 14, 34, 8)}<circle cx="-16" cy="2" r="16" fill="#5cc26a"/><circle cx="14" cy="2" r="17" fill="#5cc26a"/><circle cx="0" cy="-8" r="19" fill="#6fd47b"/><circle cx="-6" cy="-14" r="6" fill="#9be8a2"/></g>`;

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
  const W = SCENE.w, H = SCENE.h;
  const cloud = (x: number, y: number, s: number, cls: string) => `<g class="cloud ${cls}"><g transform="translate(${x} ${y}) scale(${s})" fill="#fff"><ellipse cx="0" cy="10" rx="58" ry="16"/><circle cx="-22" cy="0" r="20"/><circle cx="8" cy="-8" r="26"/><circle cx="32" cy="4" r="17"/></g></g>`;
  let o = `<rect width="${W}" height="${H}" fill="url(#fg-sky)"/>`;
  o += `<circle cx="880" cy="60" r="40" fill="#fff1a8" opacity=".6"/><circle cx="880" cy="60" r="27" fill="#ffe27a"/>`;
  o += cloud(150, 52, 0.8, '') + cloud(560, 40, 0.65, 'c2');
  o += `<path d="M0 100 Q120 60 260 90 T520 82 T780 80 T960 88 V170 H0 Z" fill="#b5e7a0"/>`;
  o += `<path d="M0 112 Q180 84 360 106 T700 100 T960 108 V190 H0 Z" fill="#9edc86"/>`;
  o += `<path d="M0 120 Q240 104 480 114 T960 118 V${H} H0 Z" fill="url(#fg-grass)"/>`;
  for (let i = 0; i < 46; i++) { const x = (i * 211) % 940 + 10, y = 140 + (i * 137) % 450; o += `<path d="M${x} ${y} l3 -8 l2 8 l3 -6 l1 6" stroke="#69bf57" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`; }
  for (const p of LAYOUT.path) o += `<rect x="${p.x - 4}" y="${p.y - 4}" width="${p.w + 8}" height="${p.h + 8}" rx="${Math.min(p.w, p.h) / 2 + 4}" fill="#e7c58d"/>`;
  for (const p of LAYOUT.path) o += `<rect x="${p.x + 2}" y="${p.y + 2}" width="${p.w - 4}" height="${p.h - 4}" rx="${Math.min(p.w, p.h) / 2 - 2}" fill="#f8e2b3"/>`;
  [[470, 160], [495, 260], [468, 520], [492, 570], [150, 418], [300, 424], [650, 416], [820, 412]].forEach(([x, y]) => { o += `<ellipse cx="${x}" cy="${y}" rx="6" ry="4" fill="#e3c08a"/>`; });
  const pd = LAYOUT.pond, cx = pd.x + pd.w / 2, cy = pd.y + pd.h / 2;
  o += `<ellipse cx="${cx}" cy="${cy + 4}" rx="${pd.w / 2}" ry="${pd.h / 2}" fill="#5ab4e6"/><ellipse cx="${cx}" cy="${cy}" rx="${pd.w / 2 - 6}" ry="${pd.h / 2 - 4}" fill="url(#fg-pond)"/>`;
  o += `<ellipse cx="${cx - 30}" cy="${cy}" rx="14" ry="6" fill="#6fd47b"/><ellipse cx="${cx + 36}" cy="${cy + 8}" rx="11" ry="5" fill="#5fcf6a"/><path d="M${cx} ${cy - 10} q10 -4 20 0" stroke="#fff" stroke-width="2" fill="none" opacity=".8"/>`;
  o += flower(cx - 30, cy - 4, '#ff9fb8', 3);
  o += bush(18, 462, 0.7) + bush(944, 436, 0.6) + bush(372, 560, 0.55) + bush(718, 590, 0.5);
  [[250, 386], [420, 450], [700, 446], [360, 450], [160, 600], [600, 592], [80, 445], [740, 600]].forEach(([x, y], i) => { o += flower(x, y - 4, ['#ff9fb8', '#fff', '#c38cff', '#ffb38a'][i % 4]); });
  return o;
}

// ---------- 田 ----------
function cropAt(crop: CropId, stage: Stage, cx: number, ry: number): string {
  if (stage === 0) return `<ellipse cx="${cx}" cy="${ry + 3}" rx="4" ry="2.6" fill="#7a4a2c"/>`;
  if (stage === 1) return `<g><path d="M${cx} ${ry + 6} V${ry - 2}" stroke="#4fae55" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="${cx - 5}" cy="${ry - 3}" rx="5.5" ry="3" fill="#73d66e" transform="rotate(-25 ${cx - 5} ${ry - 3})"/><ellipse cx="${cx + 5}" cy="${ry - 3}" rx="5.5" ry="3" fill="#8ee388" transform="rotate(25 ${cx + 5} ${ry - 3})"/></g>`;
  if (stage === 2) return `<g><path d="M${cx} ${ry + 6} V${ry - 10}" stroke="#3f9e4a" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="${cx - 7}" cy="${ry - 4}" rx="8" ry="4" fill="#5fcf6a" transform="rotate(-30 ${cx - 7} ${ry - 4})"/><ellipse cx="${cx + 7}" cy="${ry - 6}" rx="8" ry="4" fill="#77dc7c" transform="rotate(30 ${cx + 7} ${ry - 6})"/><ellipse cx="${cx}" cy="${ry - 13}" rx="4" ry="6" fill="#8ee388"/></g>`;
  if (crop === 'wheat') return use('wheat', cx - 16, ry - 26, 32);
  if (crop === 'carrot') return `<g><path d="M${cx - 7} ${ry + 4} Q${cx} ${ry} ${cx + 7} ${ry + 4} L${cx} ${ry + 10} Z" fill="#ff9a3d"/><ellipse cx="${cx - 4}" cy="${ry - 6}" rx="3" ry="8" fill="#5fcf6a" transform="rotate(-20 ${cx - 4} ${ry - 6})"/><ellipse cx="${cx + 4}" cy="${ry - 6}" rx="3" ry="8" fill="#77dc7c" transform="rotate(20 ${cx + 4} ${ry - 6})"/><ellipse cx="${cx}" cy="${ry - 8}" rx="3" ry="8" fill="#5fcf6a"/></g>`;
  if (crop === 'strawberry') return `<g><ellipse cx="${cx}" cy="${ry - 4}" rx="11" ry="8" fill="#5fcf6a"/>${use('strawberry', cx - 9, ry - 8, 18)}</g>`;
  return `<g><ellipse cx="${cx - 6}" cy="${ry - 6}" rx="8" ry="5" fill="#6fd47b"/>${use('pumpkin', cx - 11, ry - 14, 22)}</g>`;
}
/** 一塊田（標準尺寸 120×80）。locked：草地＋木牌「Lv N 解鎖」（文字由呼叫端用 pill 疊上也可以，這裡只畫木牌）。 */
export function field(b: Box, crop: CropId | null, stage: Stage | null, locked: boolean, unlockLevel = 0): string {
  let o = shadow(60, 92, 62, 9);
  if (locked) {
    o += `<rect x="0" y="0" width="120" height="84" rx="18" fill="#9adf7f" stroke="#86d06c" stroke-width="3" stroke-dasharray="8 6"/>`;
    o += `<rect x="56" y="34" width="8" height="34" rx="3" fill="#b8763f"/><rect x="26" y="16" width="68" height="28" rx="7" fill="#f3c08c" stroke="#d8955a" stroke-width="2"/>`;
    o += `<text x="60" y="36" text-anchor="middle" font-size="15" font-weight="800" fill="#7a4a2c">Lv ${unlockLevel || ''} 解鎖</text>`;
    return fit(b, 120, 84, o);
  }
  o += `<rect x="0" y="10" width="120" height="74" rx="18" fill="#8f5a37"/><rect x="0" y="0" width="120" height="76" rx="18" fill="url(#fg-soil)"/>`;
  for (let r = 0; r < 3; r++) o += `<rect x="10" y="${10 + r * 22}" width="100" height="13" rx="6.5" fill="#a6683f" opacity=".75"/>`;
  if (crop && stage !== null) for (const ry of [14, 36, 58]) for (const cx of [26, 60, 94]) o += cropAt(crop, stage, cx, ry);
  if (stage === 3) o += sparkle(10, -6, 9) + sparkle(112, 8, 7, true) + sparkle(70, -16, 6, true);
  return fit(b, 120, 84, o);
}

// ---------- 上鎖的建築（工地圍籬＋木牌） ----------
function lockedLot(nw: number, nh: number, label: string): string {
  let o = shadow(nw / 2, nh - 4, nw / 2, 10, 0.06);
  o += `<rect x="6" y="${nh * 0.25}" width="${nw - 12}" height="${nh * 0.7}" rx="16" fill="#c9e9b2" stroke="#b5dc99" stroke-width="3" stroke-dasharray="10 7"/>`;
  for (let i = 0; i < 6; i++) { const x = 16 + i * ((nw - 40) / 5); o += `<rect x="${x}" y="${nh * 0.55}" width="8" height="${nh * 0.38}" rx="4" fill="#ffb38a"/>`; }
  o += `<rect x="10" y="${nh * 0.62}" width="${nw - 20}" height="8" rx="4" fill="#fff" opacity=".85"/><rect x="10" y="${nh * 0.62}" width="${nw - 20}" height="8" rx="4" fill="url(#fg-tilesY)" opacity=".7"/>`;
  o += `<rect x="${nw / 2 - 5}" y="${nh * 0.3}" width="10" height="${nh * 0.4}" rx="4" fill="#b8763f"/>`;
  o += `<rect x="${nw / 2 - 74}" y="${nh * 0.18}" width="148" height="36" rx="10" fill="#f3c08c" stroke="#d8955a" stroke-width="2"/>`;
  o += `<text x="${nw / 2}" y="${nh * 0.18 + 24}" text-anchor="middle" font-size="16" font-weight="800" fill="#7a4a2c">${esc(label)}</text>`;
  return o;
}

// ---------- 動物 ----------
function bunny(x: number, y: number, flip: number, d2: boolean) {
  return `<g class="hop${d2 ? ' d2' : ''}"><g transform="translate(${x} ${y}) scale(${flip} 1)">${shadow(0, 26, 22, 5)}
    <ellipse cx="-8" cy="-26" rx="6" ry="16" fill="#fff" transform="rotate(-12 -8 -26)"/><ellipse cx="-8" cy="-26" rx="3" ry="11" fill="#ffc2d1" transform="rotate(-12 -8 -26)"/>
    <ellipse cx="8" cy="-28" rx="6" ry="16" fill="#fff" transform="rotate(10 8 -28)"/><ellipse cx="8" cy="-28" rx="3" ry="11" fill="#ffc2d1" transform="rotate(10 8 -28)"/>
    <ellipse cx="-2" cy="12" rx="22" ry="16" fill="#fff"/><circle cx="-22" cy="14" r="6" fill="#fff"/>
    <circle cx="4" cy="-4" r="17" fill="#fff"/><circle cx="-2" cy="-6" r="2.6" fill="${INK}"/><circle cx="12" cy="-6" r="2.6" fill="${INK}"/><circle cx="-1" cy="-7" r=".9" fill="#fff"/><circle cx="13" cy="-7" r=".9" fill="#fff"/>
    <ellipse cx="-6" cy="2" rx="4" ry="2.6" fill="#ffb3c7"/><ellipse cx="17" cy="2" rx="4" ry="2.6" fill="#ffb3c7"/><path d="M3 0 q2 2 4 0" stroke="#e9668a" stroke-width="1.6" fill="none" stroke-linecap="round"/></g></g>`;
}
function hen(x: number, y: number, flip: number, d2: boolean) {
  return `<g class="hop${d2 ? ' d2' : ''}"><g transform="translate(${x} ${y}) scale(${flip} 1)">${shadow(0, 24, 20, 5)}
    <path d="M-8 22 l-2 6 M4 22 l2 6" stroke="#ff9f43" stroke-width="3" stroke-linecap="round"/>
    <path d="M-24 6 Q-30 -12 -14 -8 Z" fill="#fff"/><ellipse cx="-2" cy="8" rx="22" ry="17" fill="#fff"/><ellipse cx="-6" cy="10" rx="10" ry="8" fill="#f2ece6"/>
    <circle cx="12" cy="-8" r="13" fill="#fff"/><path d="M6 -21 q3 -6 6 0 q3 -6 6 0 q2 4 -2 5 h-8 q-4 -1 -2 -5 Z" fill="#ff5f6d"/>
    <circle cx="14" cy="-9" r="2.4" fill="${INK}"/><circle cx="15" cy="-10" r=".8" fill="#fff"/><path d="M22 -7 l7 2 l-7 3 Z" fill="#ffb33d"/><path d="M20 -2 q2 5 -1 6 q-3 -2 1 -6 Z" fill="#ff5f6d"/>
    <ellipse cx="8" cy="-2" rx="3.5" ry="2.2" fill="#ffb3c7"/></g></g>`;
}
function pen(nw: number, nh: number, floor: string) {
  let o = shadow(nw / 2, nh + 4, nw / 2, 12, 0.07);
  o += `<rect x="4" y="10" width="${nw - 8}" height="${nh - 8}" rx="22" fill="${floor}"/>`;
  for (let i = 0; i < 8; i++) o += `<ellipse cx="${26 + i * 26}" cy="${28 + (i % 3) * 26}" rx="8" ry="3" fill="#000" opacity=".05"/>`;
  return o;
}
function penFence(nw: number, nh: number) {
  let o = '';
  const n = 9; for (let i = 0; i < n; i++) { const x = i * ((nw - 10) / (n - 1)); const edge = i === 0 || i === n - 1; o += `<rect x="${x}" y="${edge ? 2 : nh - 26}" width="10" height="${edge ? nh : 30}" rx="5" fill="#e3a46e"/>`; }
  o += `<rect x="0" y="${nh - 16}" width="${nw}" height="8" rx="4" fill="#d08f5a"/>`;
  return o;
}
/** 兔兔窩（標準尺寸 230×110）。ready[i]：第 i 隻有毛線可以收。 */
export function hutch(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 230, 110, lockedLot(230, 110, `Lv ${unlockLevel}：兔兔窩`));
  let o = pen(230, 110, '#c8f0a8');
  o += `<rect x="150" y="18" width="66" height="54" rx="10" fill="#fff6ea"/><path d="M142 24 Q183 -18 224 24 Z" fill="url(#fg-tilesB)"/><path d="M142 24 Q183 -18 224 24" fill="none" stroke="#f5826b" stroke-width="4" stroke-linecap="round"/><path d="M171 72 V54 Q183 40 195 54 V72 Z" fill="#7a4a2c"/>`;
  o += bunny(52, 70, 1, false) + bunny(112, 78, -1, true);
  ready.forEach((r, i) => { if (r) o += `<g class="bob">${use('wool', i ? 120 : 60, 24, 28)}</g>`; });
  o += penFence(230, 110);
  return fit(b, 230, 110, o);
}
/** 雞舍（標準尺寸 230×110）。 */
export function coop(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 230, 110, lockedLot(230, 110, `Lv ${unlockLevel}：雞舍`));
  let o = pen(230, 110, '#f9e7b0');
  for (let i = 0; i < 10; i++) o += `<path d="M${20 + i * 20} ${60 + (i % 2) * 18} l8 -3" stroke="#e8c46a" stroke-width="2.4" stroke-linecap="round"/>`;
  o += `<rect x="148" y="20" width="70" height="54" rx="10" fill="#fff6ea"/><path d="M140 26 L183 -6 L226 26 Z" fill="url(#fg-tilesY)"/><path d="M140 26 L183 -6 L226 26" fill="none" stroke="#f0b13c" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="183" cy="48" r="11" fill="#7a4a2c"/><rect x="176" y="58" width="14" height="4" rx="2" fill="#d08f5a"/>`;
  o += hen(56, 70, 1, false) + hen(116, 78, -1, true);
  ready.forEach((r, i) => { if (r) o += `<g class="bob">${use('egg', i ? 122 : 62, 26, 24)}</g>`; });
  o += penFence(230, 110);
  return fit(b, 230, 110, o);
}

// ---------- 加工站 ----------
function cottage(roof: string, roofLine: string, label: string, labelColor: string, busy: boolean, door: string) {
  let o = shadow(85, 166, 82, 10);
  o += `<rect x="128" y="10" width="20" height="52" rx="5" fill="#c9a08a"/>`;
  if (busy) o += `<g class="smoke" fill="#fff"><circle cx="138" cy="4" r="10"/><circle cx="138" cy="4" r="10"/><circle cx="138" cy="4" r="10"/></g>`;
  o += `<rect x="12" y="66" width="146" height="98" rx="14" fill="#fff3df"/>`;
  o += `<path d="M0 74 L85 8 L170 74 Z" fill="${roof}"/><path d="M0 74 L85 8 L170 74" fill="none" stroke="${roofLine}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`;
  o += `<circle cx="85" cy="46" r="11" fill="url(#fg-glow)" stroke="#fff" stroke-width="3"/>`;
  for (let i = 0; i < 7; i++) o += `<path d="M${16 + i * 20} 82 h20 v11 q-10 10 -20 0 Z" fill="${i % 2 ? '#fff' : roofLine}"/>`;
  o += `<path d="M68 164 V128 Q85 110 102 128 V164 Z" fill="${door}"/><circle cx="96" cy="144" r="2.4" fill="#ffd166"/>`;
  o += `<rect x="22" y="110" width="34" height="32" rx="8" fill="url(#fg-glow)" stroke="#fff" stroke-width="4"/><path d="M39 110 V142 M22 126 H56" stroke="#fff" stroke-width="3"/>`;
  o += `<rect x="114" y="110" width="34" height="32" rx="8" fill="url(#fg-glow)" stroke="#fff" stroke-width="4"/><path d="M131 110 V142 M114 126 H148" stroke="#fff" stroke-width="3"/>`;
  o += `<rect x="40" y="90" width="90" height="22" rx="11" fill="#fff"/><text x="85" y="106" text-anchor="middle" font-size="13" font-weight="800" fill="${labelColor}">${esc(label)}</text>`;
  return o;
}
/** 烘焙屋（標準尺寸 170×170）。busy：加工中冒煙。 */
export function bakery(b: Box, busy: boolean, locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 170, 170, lockedLot(170, 170, `Lv ${unlockLevel}：烘焙屋`));
  return fit(b, 170, 170, cottage('url(#fg-tiles)', '#e9668a', '烘焙屋', '#e9668a', busy, '#a7653f'));
}
/** 果醬工坊（標準尺寸 170×170）。 */
export function jamhouse(b: Box, busy: boolean, locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 170, 170, lockedLot(170, 170, `Lv ${unlockLevel}：果醬工坊`));
  return fit(b, 170, 170, cottage('url(#fg-tilesP)', '#9a5ce6', '果醬工坊', '#9a5ce6', busy, '#7fbfa8') + use('jam', 136, 132, 28));
}

// ---------- 果樹、看板、倉庫 ----------
/** 蘋果樹（標準尺寸 140×130）。 */
export function tree(b: Box, state: 'growing' | 'ready' | 'withered'): string {
  const dead = state === 'withered', x = 70, y = 82;
  let o = shadow(x, y + 42, 50, 9, 0.09) + `<rect x="${x - 8}" y="${y - 4}" width="16" height="46" rx="7" fill="#a46c40"/>`;
  const c1 = dead ? '#c8b089' : '#58c06a', c2 = dead ? '#d8c39e' : '#6fd47b', c3 = dead ? '#e6d6b6' : '#93e69a';
  o += `<circle cx="${x - 28}" cy="${y - 16}" r="28" fill="${c1}"/><circle cx="${x + 28}" cy="${y - 18}" r="29" fill="${c1}"/><circle cx="${x}" cy="${y - 42}" r="34" fill="${c2}"/><circle cx="${x - 10}" cy="${y - 56}" r="11" fill="${c3}"/>`;
  if (state === 'ready') [[-32, -16], [0, -28], [24, -8], [32, -36], [-14, -48]].forEach(([dx, dy]) => { o += use('apple', x + dx - 12, y + dy - 12, 24); });
  if (state === 'growing') [[-30, -14], [26, -30], [-6, -44]].forEach(([dx, dy]) => { o += `<circle cx="${x + dx}" cy="${y + dy}" r="4" fill="#fff" opacity=".9"/><circle cx="${x + dx}" cy="${y + dy}" r="1.6" fill="#ffb3c7"/>`; });
  if (state === 'ready') o += sparkle(x + 52, y - 60, 8) + sparkle(x - 50, y - 46, 6, true);
  if (dead) o += `<path d="M${x - 32} ${y - 6} q4 8 0 14 M${x + 30} ${y - 4} q-4 8 0 12" stroke="#b89a6c" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return fit(b, 140, 130, o);
}
/** 訂單看板（標準尺寸 110×100）。alert：有訂單可以交。 */
export function board(b: Box, alert: boolean): string {
  let o = shadow(55, 96, 56, 8) + `<rect x="18" y="44" width="12" height="52" rx="5" fill="#b8763f"/><rect x="80" y="44" width="12" height="52" rx="5" fill="#b8763f"/>`;
  o += `<rect x="4" y="8" width="102" height="66" rx="14" fill="#e7a86a"/><rect x="10" y="14" width="90" height="54" rx="10" fill="#f3c08c"/>`;
  o += `<rect x="16" y="20" width="26" height="34" rx="4" fill="#fff" transform="rotate(-6 29 37)"/><rect x="46" y="18" width="24" height="32" rx="4" fill="#fff4f8" transform="rotate(4 58 34)"/><rect x="74" y="22" width="20" height="30" rx="4" fill="#fff" transform="rotate(-3 84 37)"/>`;
  o += use('bread', 18, 27, 22) + use('egg', 48, 24, 20) + use('wool', 75, 29, 18);
  o += `<circle cx="28" cy="21" r="3" fill="#ff5f7e"/><circle cx="58" cy="19" r="3" fill="#63b6f2"/><circle cx="84" cy="23" r="3" fill="#ffd166"/>`;
  if (alert) o += `<g class="alert"><circle cx="98" cy="4" r="16" fill="#ff5f7e" stroke="#fff" stroke-width="3"/><text x="98" y="11" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">!</text></g>`;
  return fit(b, 110, 100, o);
}
/** 倉庫穀倉（標準尺寸 180×140）。 */
export function barn(b: Box): string {
  let o = shadow(90, 140, 92, 10);
  o += `<path d="M10 56 L90 6 L170 56 V136 H10 Z" fill="#8fd8c0"/>`;
  o += `<path d="M0 62 L90 0 L180 62" fill="none" stroke="#ff9b85" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/>`;
  o += `<circle cx="90" cy="44" r="13" fill="#fff6ea" stroke="#5fbf9f" stroke-width="3"/>`;
  o += `<rect x="52" y="76" width="76" height="60" rx="6" fill="#fff6ea"/><rect x="58" y="82" width="64" height="54" rx="4" fill="#ffad99"/><path d="M58 82 L122 136 M122 82 L58 136" stroke="#fff6ea" stroke-width="6"/>`;
  o += `<path d="M20 136 q8 -14 18 0 M144 136 q8 -14 18 0" fill="#ffd166"/>`;
  o += `<rect x="34" y="102" width="20" height="34" rx="3" fill="#7bcbb0"/><rect x="126" y="102" width="20" height="34" rx="3" fill="#7bcbb0"/>`;
  return fit(b, 180, 140, o);
}

// ---------- 小雞與標籤 ----------
/** 戴草帽的小雞（腳底在 y+40）。look：身體顏色（用目前寵物的物種色）。 */
export function chick(x: number, y: number, look: { body: string; belly: string }): string {
  return `<g transform="translate(${x} ${y})">${shadow(0, 40, 30, 7, 0.12)}<g class="bob">
    <path d="M-12 30 l-3 10 M-12 30 l3 10 M10 30 l-3 10 M10 30 l3 10" stroke="#ff9f43" stroke-width="3.2" stroke-linecap="round"/>
    <ellipse cx="0" cy="6" rx="34" ry="30" fill="${look.body}"/>
    <ellipse cx="2" cy="16" rx="20" ry="14" fill="${look.belly}" opacity=".85"/>
    <ellipse class="wing" cx="-30" cy="8" rx="11" ry="15" fill="${look.body}" stroke="#000" stroke-opacity=".06" transform="rotate(20 -30 8)"/>
    <ellipse cx="30" cy="8" rx="9" ry="13" fill="${look.body}" stroke="#000" stroke-opacity=".06" transform="rotate(-20 30 8)"/>
    <circle cx="-11" cy="-2" r="4.2" fill="${INK}"/><circle cx="13" cy="-2" r="4.2" fill="${INK}"/><circle cx="-10" cy="-3.5" r="1.5" fill="#fff"/><circle cx="14" cy="-3.5" r="1.5" fill="#fff"/>
    <ellipse cx="-20" cy="8" rx="6" ry="4" fill="#ffa6bd"/><ellipse cx="22" cy="8" rx="6" ry="4" fill="#ffa6bd"/>
    <path d="M-4 4 L1 10 L6 4 Z" fill="#ff9f43"/>
    <ellipse cx="0" cy="-22" rx="40" ry="9" fill="#f5cf85"/><path d="M-22 -22 Q-22 -46 0 -46 Q22 -46 22 -22 Z" fill="#f9dc9b"/><path d="M-22 -26 Q0 -20 22 -26 L22 -22 Q0 -16 -22 -22 Z" fill="#ff8fab"/>
    <path d="M-30 -22 q30 6 60 0" stroke="#e8b864" stroke-width="2" fill="none"/></g></g>`;
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
  const W = SCENE.w, H = SCENE.h;
  let o = `<rect width="${W}" height="${H}" fill="url(#fg-sky)"/>`;
  o += `<g class="cloud c2"><g transform="translate(300 54) scale(.7)" fill="#fff"><ellipse cx="0" cy="10" rx="58" ry="16"/><circle cx="-22" cy="0" r="20"/><circle cx="8" cy="-8" r="26"/><circle cx="32" cy="4" r="17"/></g></g>`;
  o += `<g class="cloud"><g transform="translate(760 44) scale(.55)" fill="#fff"><ellipse cx="0" cy="10" rx="58" ry="16"/><circle cx="-22" cy="0" r="20"/><circle cx="8" cy="-8" r="26"/><circle cx="32" cy="4" r="17"/></g></g>`;
  o += `<path d="M0 96 Q160 70 320 92 T640 86 T960 92 V170 H0 Z" fill="#c4ecaa"/>`;
  // 遠方的風車小屋（裝飾）
  o += `<g transform="translate(120 66)"><rect x="-8" y="0" width="16" height="30" rx="3" fill="#fff6ea"/><path d="M-11 2 L0 -8 L11 2 Z" fill="#c38cff"/><g class="spin"><path d="M0 -2 l-3 -20 h6 Z M0 -2 l20 -3 v6 Z M0 -2 l3 20 h-6 Z M0 -2 l-20 3 v-6 Z" fill="#fff"/></g><circle cy="-2" r="2.4" fill="#ff8fab"/></g>`;
  o += `<path d="M0 108 Q200 86 420 104 T960 104 V190 H0 Z" fill="#a9e28e"/>`;
  o += `<path d="M0 118 Q240 100 480 112 T960 116 V${H} H0 Z" fill="url(#fg-grass)"/>`;
  for (let i = 0; i < 40; i++) { const x = (i * 197) % 940 + 10, y = 140 + (i * 151) % 450; o += `<path d="M${x} ${y} l3 -8 l2 8 l3 -6 l1 6" stroke="#69bf57" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`; }
  for (const p of EAST.path) o += `<rect x="${p.x - 4}" y="${p.y - 4}" width="${p.w + 8}" height="${p.h + 8}" rx="${Math.min(p.w, p.h) / 2 + 4}" fill="#e7c58d"/>`;
  for (const p of EAST.path) o += `<rect x="${p.x + 2}" y="${p.y + 2}" width="${p.w - 4}" height="${p.h - 4}" rx="${Math.min(p.w, p.h) / 2 - 2}" fill="#f8e2b3"/>`;
  [[480, 150], [504, 250], [140, 420], [330, 424], [640, 418], [830, 414]].forEach(([x, y]) => { o += `<ellipse cx="${x}" cy="${y}" rx="6" ry="4" fill="#e3c08a"/>`; });
  o += bush(24, 300, 0.6) + bush(950, 456, 0.55) + bush(470, 592, 0.5);
  [[60, 250], [100, 300], [470, 460], [930, 590], [20, 592], [610, 452]].forEach(([x, y], i) => { o += flower(x, y, ['#ff9fb8', '#fff', '#c38cff', '#ffb38a'][i % 4]); });
  return o;
}

/** 木頭路牌（標準尺寸 78×46，箭頭朝左或右）。locked：寫「Lv N 開放」。 */
export function sign(b: Box, text: string, locked: boolean, left = false): string {
  const arrow = left ? 'M4 18 L18 4 H74 V32 H18 Z' : 'M74 18 L60 4 H4 V32 H60 Z';
  let o = shadow(39, 44, 22, 4) + `<rect x="35" y="24" width="8" height="22" rx="3" fill="#b8763f"/>`;
  o += `<path d="${arrow}" transform="translate(0 2)" fill="#d8955a"/><path d="${arrow}" fill="${locked ? '#e8d6c0' : '#f3c08c'}" stroke="#d8955a" stroke-width="2" stroke-linejoin="round"/>`;
  o += `<text x="${left ? 44 : 34}" y="23" text-anchor="middle" font-size="12" font-weight="800" fill="${locked ? '#9a8470' : '#7a4a2c'}">${esc(text)}</text>`;
  return fit(b, 78, 46, o);
}

function bee(x: number, y: number, d2: boolean) {
  return `<g class="hop${d2 ? ' d2' : ''}"><g transform="translate(${x} ${y})"><ellipse cx="-4" cy="-8" rx="5" ry="7" fill="#fff" opacity=".85" transform="rotate(-25 -4 -8)"/><ellipse cx="4" cy="-8" rx="5" ry="7" fill="#fff" opacity=".85" transform="rotate(25 4 -8)"/>
    <ellipse cx="0" cy="0" rx="10" ry="8" fill="#ffd34d"/><path d="M-3 -7.5 V7.5 M3 -7 V7" stroke="${INK}" stroke-width="2.6"/><circle cx="7" cy="-2" r="1.4" fill="${INK}"/><ellipse cx="6" cy="2" rx="2" ry="1.3" fill="#ffb3c7"/></g></g>`;
}
function hive(x: number, y: number) {
  let o = shadow(x, y + 46, 30, 6);
  o += `<rect x="${x - 10}" y="${y + 30}" width="20" height="16" rx="3" fill="#b8763f"/>`;
  o += `<rect x="${x - 30}" y="${y - 6}" width="60" height="38" rx="12" fill="#ffc53d"/><rect x="${x - 34}" y="${y - 30}" width="68" height="28" rx="12" fill="#ffd34d"/>`;
  o += `<path d="M${x - 30} ${y + 6} H${x + 30} M${x - 34} ${y - 16} H${x + 34}" stroke="#f5a623" stroke-width="3" opacity=".6"/>`;
  o += `<path d="M${x - 38} ${y - 30} Q${x} ${y - 52} ${x + 38} ${y - 30} Z" fill="url(#fg-tilesP)"/><circle cx="${x}" cy="${y + 18}" r="6" fill="#7a4a2c"/>`;
  return o;
}
/** 蜂箱（標準尺寸 150×120）。ready[i]：第 i 箱有蜂蜜。 */
export function beehive(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 150, 120, lockedLot(150, 120, `Lv ${unlockLevel}：蜂箱`));
  let o = `<rect x="4" y="30" width="142" height="86" rx="20" fill="#d8f3c0"/>`;
  for (let i = 0; i < 6; i++) o += flower(14 + i * 24, 108 - (i % 2) * 8, ['#ff9fb8', '#fff', '#c38cff'][i % 3], 4);
  o += hive(42, 62) + hive(110, 64);
  o += bee(76, 30, false) + bee(20, 40, true) + bee(132, 36, true);
  ready.forEach((r, i) => { if (r) o += `<g class="bob">${use('honey', i ? 96 : 28, 4, 26)}</g>`; });
  return fit(b, 150, 120, o);
}
function cow(x: number, y: number, flip: number, d2: boolean) {
  return `<g class="hop${d2 ? ' d2' : ''}"><g transform="translate(${x} ${y}) scale(${flip} 1)">${shadow(0, 26, 26, 5)}
    <path d="M-16 18 v10 M-4 20 v8 M8 20 v8 M18 18 v10" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M-16 26 v2 M-4 26 v2 M8 26 v2 M18 26 v2" stroke="#c9a08a" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="0" cy="8" rx="28" ry="17" fill="#fff"/><ellipse cx="-10" cy="4" rx="8" ry="6" fill="#c9a08a"/><ellipse cx="10" cy="14" rx="6" ry="4.5" fill="#c9a08a"/>
    <path d="M-27 4 q-8 4 -6 12" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="24" cy="-6" r="13" fill="#fff"/><ellipse cx="30" cy="0" rx="9" ry="7" fill="#ffc2d1"/><circle cx="27" cy="0" r="1.3" fill="#e9668a"/><circle cx="33" cy="0" r="1.3" fill="#e9668a"/>
    <circle cx="20" cy="-10" r="2.4" fill="${INK}"/><circle cx="21" cy="-11" r=".8" fill="#fff"/><ellipse cx="12" cy="-16" rx="5" ry="2.6" fill="#fff" transform="rotate(-25 12 -16)"/><path d="M18 -18 q-2 -6 2 -8 M28 -18 q2 -6 -2 -8" stroke="#f3c08c" stroke-width="3" fill="none" stroke-linecap="round"/></g></g>`;
}
/** 牛棚（標準尺寸 230×110）。 */
export function cowshed(b: Box, ready: boolean[], locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 230, 110, lockedLot(230, 110, `Lv ${unlockLevel}：牛棚`));
  let o = pen(230, 110, '#c8f0a8');
  o += `<rect x="150" y="18" width="68" height="54" rx="10" fill="#fff6ea"/><path d="M142 24 Q184 -14 226 24 Z" fill="#8fd8c0"/><path d="M142 24 Q184 -14 226 24" fill="none" stroke="#5fbf9f" stroke-width="4" stroke-linecap="round"/><rect x="170" y="44" width="28" height="28" rx="4" fill="#ffad99"/><path d="M170 44 L198 72 M198 44 L170 72" stroke="#fff6ea" stroke-width="3"/>`;
  o += cow(50, 66, 1, false) + cow(116, 74, -1, true);
  ready.forEach((r, i) => { if (r) o += `<g class="bob">${use('milk', i ? 122 : 56, 18, 26)}</g>`; });
  o += penFence(230, 110);
  return fit(b, 230, 110, o);
}
/** 起司小屋（標準尺寸 170×170）。 */
export function dairy(b: Box, busy: boolean, locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 170, 170, lockedLot(170, 170, `Lv ${unlockLevel}：起司小屋`));
  return fit(b, 170, 170, cottage('url(#fg-tilesY)', '#f0a630', '起司小屋', '#d88a10', busy, '#8fbfe6') + use('cheese', 134, 132, 28));
}

/** 熱氣球停機坪（標準尺寸 190×154）。here：氣球停著、貨箱放在旁邊（裝好的有勾）。 */
export function balloon(b: Box, st: { state: 'locked' } | { state: 'away'; remainMs: number } | { state: 'here'; remainMs: number; crates: (Crate & { canFill?: boolean })[] }, unlockLevel: number): string {
  if (st.state === 'locked') return fit(b, 190, 154, lockedLot(190, 154, `Lv ${unlockLevel}：熱氣球`));
  let o = shadow(95, 150, 90, 8);
  o += `<ellipse cx="95" cy="134" rx="88" ry="18" fill="#e9d2b0"/><ellipse cx="95" cy="130" rx="80" ry="14" fill="#f8e2b3"/><path d="M40 130 h110" stroke="#ff8fab" stroke-width="3" stroke-dasharray="10 8"/>`;
  if (st.state === 'away') {
    o += `<g opacity=".5"><path d="M95 30 Q130 30 130 62 Q130 82 106 96 H84 Q60 82 60 62 Q60 30 95 30 Z" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="7 6"/></g>`;
    o += `<g class="cloud"><g transform="translate(150 26) scale(.5)">${use('balloon', -16, -16, 32)}</g></g>`;
    return fit(b, 190, 154, o);
  }
  o += `<g class="bob"><path d="M78 96 L84 110 M112 96 L106 110" stroke="#8a5a32" stroke-width="2"/>`;
  o += `<path d="M95 6 Q140 6 140 48 Q140 74 110 96 H80 Q50 74 50 48 Q50 6 95 6 Z" fill="#ff8fab"/>`;
  o += `<path d="M95 6 Q118 6 118 48 Q118 74 102 96 H88 Q72 74 72 48 Q72 6 95 6 Z" fill="#ffd166"/><path d="M95 6 Q102 6 102 48 Q102 74 97 96 H93 Q88 74 88 48 Q88 6 95 6 Z" fill="#7fd6b4"/>`;
  o += `<ellipse cx="72" cy="30" rx="6" ry="12" fill="#fff" opacity=".45"/><rect x="80" y="108" width="30" height="20" rx="5" fill="#c9844a"/><path d="M80 114 h30" stroke="#e8a96b" stroke-width="3"/></g>`;
  st.crates.slice(0, 4).forEach((c, i) => {
    const x = [8, 36, 134, 162][i], y = 112;
    o += `<g><rect x="${x - 2}" y="${y}" width="26" height="22" rx="4" fill="${c.filled ? '#ffd166' : '#e8a96b'}" stroke="#c9844a" stroke-width="1.5"/>${use(c.item, x + 2, y - 16, 18)}${c.filled ? `<circle cx="${x + 20}" cy="${y + 2}" r="6" fill="#7fd6b4" stroke="#fff" stroke-width="1.5"/><path d="M${x + 17} ${y + 2} l2 2 l4 -4" stroke="#fff" stroke-width="1.8" fill="none"/>` : ''}</g>`;
  });
  return fit(b, 190, 154, o);
}

/** 小攤（標準尺寸 200×96）。slots：上架中的東西。 */
export function stall(b: Box, slots: (StallSlot | null)[], locked: boolean, unlockLevel: number): string {
  if (locked) return fit(b, 200, 96, lockedLot(200, 96, `Lv ${unlockLevel}：小攤`));
  let o = shadow(100, 94, 96, 6);
  o += `<rect x="18" y="20" width="8" height="60" rx="3" fill="#b8763f"/><rect x="174" y="20" width="8" height="60" rx="3" fill="#b8763f"/>`;
  o += `<rect x="10" y="54" width="180" height="34" rx="8" fill="#fff1dc" stroke="#e0b48a" stroke-width="2"/><rect x="10" y="80" width="180" height="8" rx="4" fill="#e7a86a"/>`;
  o += `<path d="M4 26 Q14 2 30 2 H170 Q186 2 196 26 Z" fill="#ff8fab"/>`;
  for (let i = 0; i < 8; i++) o += `<path d="M${4 + i * 24} 26 q12 12 24 0" fill="${i % 2 ? '#ff8fab' : '#fff'}"/>`;
  o += `<rect x="64" y="-8" width="72" height="20" rx="10" fill="#fff"/><text x="100" y="7" text-anchor="middle" font-size="12" font-weight="800" fill="#e9668a">小攤</text>`;
  slots.slice(0, 4).forEach((l, i) => {
    const x = 28 + i * 38;
    o += l ? `<g>${use(l.item, x, 46, 28)}<rect x="${x - 2}" y="74" width="32" height="12" rx="6" fill="#ffd166"/><text x="${x + 14}" y="84" text-anchor="middle" font-size="9" font-weight="800" fill="#7a4a2c">◎${l.price}</text></g>`
      : `<rect x="${x + 4}" y="58" width="20" height="16" rx="4" fill="#f3e3cc"/>`;
  });
  return fit(b, 200, 96, o);
}

/** 裝飾格（標準尺寸 120×110）。id null：空格（主人看得到虛線＋「＋」，訪客只看到草地）。 */
export function deco(b: Box, id: DecoId | null, owner: boolean): string {
  let o = '';
  if (!id) {
    if (owner) o += `<rect x="10" y="20" width="100" height="80" rx="22" fill="#fff" opacity=".25" stroke="#fff" stroke-width="3" stroke-dasharray="9 7"/><text x="60" y="70" text-anchor="middle" font-size="30" font-weight="800" fill="#fff" opacity=".9">＋</text>`;
    return `<g>${fit(b, 120, 110, o)}</g>`;
  }
  o += shadow(60, 100, 44, 7);
  const D: Record<DecoId, string> = {
    flowerbed: `<ellipse cx="60" cy="86" rx="50" ry="16" fill="#a6683f"/><ellipse cx="60" cy="82" rx="46" ry="13" fill="#c98a5b"/>${[[24, 72, '#ff9fb8'], [44, 64, '#fff'], [62, 70, '#c38cff'], [80, 62, '#ffb38a'], [96, 72, '#ff9fb8'], [52, 80, '#ffd166'], [74, 80, '#fff']].map(([x, y, c]) => `<path d="M${x} ${+y + 12} V${+y + 2}" stroke="#4fae55" stroke-width="2.4"/>${flower(+x, +y, String(c), 6)}`).join('')}`,
    scarecrow: `<rect x="56" y="30" width="8" height="70" rx="3" fill="#b8763f"/><rect x="24" y="48" width="72" height="7" rx="3" fill="#b8763f"/><path d="M40 50 H80 L74 86 H46 Z" fill="#7fc8ff"/><rect x="56" y="58" width="8" height="10" rx="2" fill="#ffd166"/><circle cx="60" cy="32" r="16" fill="#f9dc9b"/><circle cx="54" cy="31" r="2.4" fill="${INK}"/><circle cx="66" cy="31" r="2.4" fill="${INK}"/><path d="M54 38 q6 4 12 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="18" rx="28" ry="6" fill="#f5cf85"/><path d="M46 18 Q46 2 60 2 Q74 2 74 18 Z" fill="#ff8fab"/>`,
    bench: `<rect x="14" y="44" width="92" height="12" rx="6" fill="#e3a46e"/><rect x="14" y="60" width="92" height="12" rx="6" fill="#d08f5a"/><rect x="10" y="74" width="100" height="12" rx="6" fill="#e3a46e"/><rect x="20" y="84" width="8" height="18" rx="3" fill="#b8763f"/><rect x="92" y="84" width="8" height="18" rx="3" fill="#b8763f"/>${use('heart', 52, 26, 16)}`,
    mushroom: `<rect x="50" y="56" width="20" height="40" rx="9" fill="#fff6ea"/><path d="M18 62 Q18 22 60 22 Q102 22 102 62 Z" fill="#ff5f6d"/><circle cx="40" cy="44" r="7" fill="#fff"/><circle cx="70" cy="36" r="6" fill="#fff"/><circle cx="86" cy="52" r="5" fill="#fff"/><circle cx="60" cy="74" r="8" fill="url(#fg-glow)" class="tw"/>`,
    fountain: `<ellipse cx="60" cy="88" rx="52" ry="14" fill="#c9d6e3"/><ellipse cx="60" cy="84" rx="46" ry="11" fill="url(#fg-pond)"/><rect x="52" y="44" width="16" height="40" rx="5" fill="#dfe8f1"/><ellipse cx="60" cy="46" rx="24" ry="7" fill="#dfe8f1"/><ellipse cx="60" cy="44" rx="20" ry="5" fill="url(#fg-pond)"/><g class="bob"><path d="M60 40 Q52 18 60 10 Q68 18 60 40" fill="#bfeaff"/><circle cx="46" cy="28" r="3" fill="#bfeaff"/><circle cx="74" cy="26" r="3" fill="#bfeaff"/></g>`,
    arch: `${['#ff5f6d', '#ffb33d', '#ffd84d', '#7fd6b4', '#7fc8ff', '#c38cff'].map((c, i) => `<path d="M${14 + i * 6} 100 V60 Q${14 + i * 6} ${16 + i * 6} 60 ${16 + i * 6} Q${106 - i * 6} ${16 + i * 6} ${106 - i * 6} 60 V100" fill="none" stroke="${c}" stroke-width="6"/>`).join('')}<ellipse cx="22" cy="100" rx="14" ry="6" fill="#fff"/><ellipse cx="98" cy="100" rx="14" ry="6" fill="#fff"/>`,
    heartballoon: `<path d="M60 96 Q52 80 60 62" stroke="#c9844a" stroke-width="2" fill="none"/><g class="bob">${use('heart', 30, 8, 60)}<ellipse cx="46" cy="26" rx="6" ry="4" fill="#fff" opacity=".6"/></g><rect x="50" y="90" width="20" height="10" rx="4" fill="#e3a46e"/>`,
    statue: `<rect x="30" y="80" width="60" height="20" rx="5" fill="#dfe8f1"/><rect x="36" y="74" width="48" height="10" rx="4" fill="#c9d6e3"/><ellipse cx="60" cy="54" rx="26" ry="22" fill="#ffe98a"/><circle cx="52" cy="50" r="2.6" fill="${INK}"/><circle cx="68" cy="50" r="2.6" fill="${INK}"/><path d="M57 56 L60 60 L63 56 Z" fill="#ff9f43"/><ellipse cx="46" cy="58" rx="4" ry="2.6" fill="#ffa6bd"/><ellipse cx="74" cy="58" rx="4" ry="2.6" fill="#ffa6bd"/><path d="M48 34 q12 -14 24 0" fill="#ffd34d"/>${sparkle(92, 30, 7)}`,
  };
  return `<g>${fit(b, 120, 110, o + D[id])}</g>`;
}
