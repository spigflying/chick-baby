// 仙境手繪主畫面：背景只含環境，可互動物件與田地狀態由獨立素材疊加。
import type { Crate, CropId, DecoId, Stage, StallSlot } from '@chick/engine';
import { SCENE, type Box } from './farm-layout';
import { art } from './art';
import * as classicArt from './farm-art-classic';

export * from './farm-art';
export const chick = classicArt.chick;

/** 烘焙屋道具沿用場景的暖色細線；只在仙境手繪面板使用。 */
export function bakeryIcons(): string {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="ro-gold" x2=".8" y2="1"><stop stop-color="#fff0aa"/><stop offset=".55" stop-color="#e5b85d"/><stop offset="1" stop-color="#bb7838"/></linearGradient>
    <linearGradient id="ro-cream" x2=".8" y2="1"><stop stop-color="#fffdf0"/><stop offset="1" stop-color="#e7ceb0"/></linearGradient>
    <linearGradient id="ro-bread" x2=".8" y2="1"><stop stop-color="#fbe3a5"/><stop offset=".55" stop-color="#d69552"/><stop offset="1" stop-color="#a96739"/></linearGradient>
    <linearGradient id="ro-honey" x2=".8" y2="1"><stop stop-color="#ffe394"/><stop offset="1" stop-color="#c97628"/></linearGradient>
  </defs>
  <symbol id="fi-ro-wheat" viewBox="0 0 48 48"><g stroke="#745333" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 43 Q17 29 17 7 M24 44 Q24 26 25 4 M35 43 Q31 27 33 9" fill="none" stroke-width="2"/>
    <g fill="url(#ro-gold)" stroke-width="1.2"><ellipse cx="17" cy="8" rx="3" ry="5"/><ellipse cx="12" cy="15" rx="3" ry="5" transform="rotate(-32 12 15)"/><ellipse cx="21" cy="17" rx="3" ry="5" transform="rotate(32 21 17)"/><ellipse cx="25" cy="5" rx="3" ry="5"/><ellipse cx="20" cy="13" rx="3" ry="5" transform="rotate(-32 20 13)"/><ellipse cx="29" cy="15" rx="3" ry="5" transform="rotate(32 29 15)"/><ellipse cx="33" cy="10" rx="3" ry="5"/><ellipse cx="29" cy="20" rx="3" ry="5" transform="rotate(-32 29 20)"/><ellipse cx="37" cy="20" rx="3" ry="5" transform="rotate(32 37 20)"/></g>
    <path d="M8 42 Q24 38 40 42" fill="none" stroke="#a37b4b" stroke-width="2"/></g></symbol>
  <symbol id="fi-ro-egg" viewBox="0 0 48 48"><g stroke="#78543a" stroke-linejoin="round">
    <ellipse cx="17" cy="24" rx="8" ry="13" fill="url(#ro-cream)" stroke-width="1.6" transform="rotate(-13 17 24)"/><ellipse cx="30" cy="24" rx="8" ry="13" fill="url(#ro-cream)" stroke-width="1.6" transform="rotate(13 30 24)"/>
    <path d="M7 31 Q24 40 41 31 L37 40 Q24 46 11 40 Z" fill="#ba874e" stroke-width="1.5"/><path d="M8 35 Q23 43 40 35 M11 39 Q24 44 37 39" fill="none" stroke="#f0cf89" stroke-width="2"/><path d="M13 19 Q15 15 17 15 M27 18 Q29 15 31 16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g></symbol>
  <symbol id="fi-ro-honey" viewBox="0 0 48 48"><g stroke="#765038" stroke-linejoin="round">
    <rect x="11" y="13" width="26" height="30" rx="6" fill="url(#ro-honey)" stroke-width="1.8"/><path d="M13 22 Q24 26 35 22 V32 Q24 36 13 32 Z" fill="#f6c367" opacity=".75"/><rect x="9" y="9" width="30" height="8" rx="3" fill="#d7a86a" stroke-width="1.6"/><path d="M12 9 Q24 4 36 9" fill="#fff0cf" stroke-width="1.5"/><path d="M19 28 Q24 24 29 28 Q27 34 24 36 Q21 34 19 28" fill="#fff4cf" stroke-width="1"/><path d="M16 18 Q18 16 20 17" fill="none" stroke="#fff1b7" stroke-width="2" stroke-linecap="round"/></g></symbol>
  <symbol id="fi-ro-bread" viewBox="0 0 48 48"><g stroke="#785031" stroke-linejoin="round">
    <path d="M6 30 Q6 13 24 12 Q42 13 42 30 V37 Q40 42 34 42 H14 Q8 42 6 37 Z" fill="url(#ro-bread)" stroke-width="1.9"/><path d="M10 30 Q12 18 24 17 Q36 18 38 30" fill="none" stroke="#fff0bc" stroke-width="2"/><path d="M17 19 l3 8 M24 17 l3 9 M31 20 l3 8" fill="none" stroke="#fff3cc" stroke-width="2.5" stroke-linecap="round"/><path d="M9 36 Q24 39 39 36" fill="none" stroke="#a76939" stroke-width="1.5"/></g></symbol>
  <symbol id="fi-ro-honeycake" viewBox="0 0 48 48"><g stroke="#775034" stroke-linejoin="round">
    <path d="M8 20 H40 V39 Q24 45 8 39 Z" fill="#d99b5c" stroke-width="1.8"/><path d="M8 29 Q24 34 40 29 V33 Q24 38 8 33 Z" fill="#fff0c6" stroke-width="1.1"/><path d="M8 20 Q10 14 24 14 Q38 14 40 20 Q39 27 34 23 Q30 29 25 23 Q20 29 15 23 Q10 27 8 20 Z" fill="url(#ro-honey)" stroke-width="1.6"/><ellipse cx="24" cy="12" rx="5" ry="4" fill="#c96459" stroke-width="1.2"/><path d="M24 9 Q27 5 31 7" fill="none" stroke="#6d8a4d" stroke-width="2" stroke-linecap="round"/></g></symbol>
  <symbol id="fi-ro-oven" viewBox="0 0 48 48"><g stroke="#765035" stroke-linejoin="round">
    <path d="M5 17 L24 5 L43 17 Z" fill="#bc7650" stroke-width="1.8"/><path d="M9 17 H39 V43 H9 Z" fill="#e7cda9" stroke-width="1.8"/><path d="M14 41 V28 Q14 19 24 19 Q34 19 34 28 V41 Z" fill="#795035" stroke-width="1.6"/><path d="M19 38 Q14 31 23 26 Q22 31 27 31 Q33 34 28 38 Z" fill="#e99a4b" stroke-width="1"/><path d="M22 37 Q21 33 25 31 Q29 34 26 37 Z" fill="#ffe3a3" stroke="none"/><path d="M12 17 H36 M11 42 H37" fill="none" stroke="#fff0c7" stroke-width="1.5"/></g></symbol>
  </svg>`;
}

const image = (name: string, x: number, y: number, w: number, h: number) => `<image href="${art(`farm/storybook-ro-a/${name}.webp`)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
const hitBox = (b: Box, inner: string) => `<g transform="translate(${b.x} ${b.y})"><rect class="hitbg" width="${b.w}" height="${b.h}" fill="transparent"/>${inner}</g>`;

export function background(): string { return image('background', 0, 0, SCENE.w, SCENE.h); }
export function eastBackground(): string { return image('background-east', 0, 0, SCENE.w, SCENE.h); }

/** 各生長期的作物與土壤同一張圖，所有田格共用尺寸避免切換時跳動。 */
export function field(b: Box, crop: CropId | null, stage: Stage | null, locked: boolean, unlockLevel = 0): string {
  const phase = stage === 0 ? 'seed' : stage === 1 ? 'sprout' : 'growing';
  const tile = crop && stage !== null && !locked ? `crop-${crop}${stage === 3 ? '' : `-${phase}`}` : 'field-empty';
  // 田土與作物共用素材，才能讓不同階段在同一田格位置對齊。
  let o = image(tile, -5, -8, b.w + 10, b.h + 16);
  if (locked) {
    o += `<rect x="3" y="8" width="${b.w - 6}" height="${b.h - 16}" rx="12" fill="#282018" opacity=".42"/><text x="${b.w / 2}" y="${b.h / 2 + 4}" text-anchor="middle" font-size="12" font-weight="900" fill="#fff0c9" stroke="#49351e" stroke-width="2" paint-order="stroke">Lv ${unlockLevel} 解鎖</text>`;
  }
  return hitBox(b, o);
}

function building(b: Box, name: string, label: string, locked: boolean, level: number, overlay = ''): string {
  let o = image(locked ? 'construction' : name, 0, 0, b.w, b.h);
  if (!locked) o += overlay;
  const caption = locked ? `Lv ${level}：${label}` : label;
  const w = locked ? 102 : 82;
  o += `<rect x="${(b.w - w) / 2}" y="${b.h - 22}" width="${w}" height="19" rx="8" fill="#f6e5b9" stroke="#75502c" stroke-width="2"/><text x="${b.w / 2}" y="${b.h - 8}" text-anchor="middle" font-size="12" font-weight="900" fill="#4a321d">${caption}</text>`;
  return hitBox(b, o);
}
const ready = (items: boolean[], icon: string, w: number) => items.map((on, i) => on ? `<g class="bob"><use href="#fi-${icon}" x="${w / 2 - 36 + i * 36}" y="1" width="26" height="26"/></g>` : '').join('');
const smoke = (busy: boolean, w: number) => busy ? `<g class="smoke" fill="#fff7db" opacity=".85"><circle cx="${w - 41}" cy="20" r="7"/><circle cx="${w - 35}" cy="11" r="5"/></g>` : '';

export function hutch(b: Box, items: boolean[], locked: boolean, level: number): string { return building(b, 'hutch', '兔兔窩', locked, level, ready(items, 'wool', b.w)); }
export function coop(b: Box, items: boolean[], locked: boolean, level: number): string { return building(b, 'coop', '雞舍', locked, level, ready(items, 'egg', b.w)); }
export function bakery(b: Box, busy: boolean, locked: boolean, level: number): string { return building(b, 'bakery', '烘焙屋', locked, level, smoke(busy, b.w)); }
export function jamhouse(b: Box, busy: boolean, locked: boolean, level: number): string { return building(b, 'jamhouse', '果醬工坊', locked, level, smoke(busy, b.w)); }
export function tree(b: Box, state: 'growing' | 'ready' | 'withered'): string { return hitBox(b, image(`tree-${state}`, 0, 0, b.w, b.h)); }
export function board(b: Box, alert: boolean): string {
  const badge = alert ? `<g class="alert"><circle cx="${b.w - 13}" cy="18" r="13" fill="#bd4d31" stroke="#fff2ce" stroke-width="3"/><text x="${b.w - 13}" y="25" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">!</text></g>` : '';
  return hitBox(b, image('board', 0, 0, b.w, b.h) + badge);
}
export function barn(b: Box): string { return hitBox(b, image('barn', 0, 0, b.w, b.h)); }

// 東邊新地沿用同一套田與建築狀態，素材不再退回舊畫風。
export function beehive(b: Box, items: boolean[], locked: boolean, level: number): string { return building(b, 'beehive', '蜂箱', locked, level, ready(items, 'honey', b.w)); }
export function cowshed(b: Box, items: boolean[], locked: boolean, level: number): string { return building(b, 'cowshed', '牛棚', locked, level, ready(items, 'milk', b.w)); }
export function dairy(b: Box, busy: boolean, locked: boolean, level: number): string { return building(b, 'dairy', '起司小屋', locked, level, smoke(busy, b.w)); }

export function balloon(b: Box, st: { state: 'locked' } | { state: 'away'; remainMs: number } | { state: 'here'; remainMs: number; crates: (Crate & { canFill?: boolean })[] }, level: number): string {
  if (st.state === 'locked') return building(b, 'balloon', '熱氣球', true, level);
  let o = `<g${st.state === 'away' ? ' opacity=".28"' : ''}>${image('balloon', 0, 0, b.w, b.h)}</g>`;
  if (st.state === 'here') st.crates.slice(0, 4).forEach((c, i) => {
    const x = 17 + i * 49, y = b.h - 30;
    o += `<rect x="${x}" y="${y}" width="29" height="23" rx="5" fill="${c.filled ? '#f8df9b' : '#c89e79'}" stroke="#6d4229" stroke-width="2"/><use href="#fi-${c.item}" x="${x + 3}" y="${y - 15}" width="22" height="22"/>${c.filled ? `<path d="M${x + 19} ${y + 13} l4 4 l6 -8" stroke="#4d9b61" stroke-width="2.5" fill="none"/>` : ''}`;
  });
  return hitBox(b, o);
}

export function stall(b: Box, slots: (StallSlot | null)[], locked: boolean, level: number): string {
  if (locked) return building(b, 'stall', '小攤', true, level);
  let o = image('stall', 0, 0, b.w, b.h);
  slots.slice(0, 4).forEach((item, i) => {
    if (!item) return;
    const x = 18 + i * 37;
    o += `<use href="#fi-${item.item}" x="${x}" y="44" width="26" height="26"/><rect x="${x - 2}" y="73" width="31" height="14" rx="6" fill="#fff1cf" stroke="#8c6344" stroke-width="1"/><text x="${x + 13}" y="84" text-anchor="middle" font-size="10" font-weight="800" fill="#4a321d">◎${item.price}</text>`;
  });
  return hitBox(b, o);
}

export function deco(b: Box, id: DecoId | null, owner: boolean): string {
  if (id) return hitBox(b, image(`deco-${id}`, 0, 0, b.w, b.h));
  const marker = owner ? `<circle cx="${b.w / 2}" cy="${b.h / 2}" r="18" fill="#fff3d8" stroke="#8c6344" stroke-width="3"/><text x="${b.w / 2}" y="${b.h / 2 + 9}" text-anchor="middle" font-size="28" font-weight="800" fill="#6d4229">＋</text>` : '';
  return hitBox(b, marker);
}
