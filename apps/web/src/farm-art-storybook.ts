// 仙境手繪主畫面：背景只含環境，可互動物件與田地狀態由獨立素材疊加。
import type { Crate, CropId, DecoId, Stage, StallSlot } from '@chick/engine';
import { SCENE, type Box } from './farm-layout';
import * as classicArt from './farm-art-classic';

export * from './farm-art';
export const chick = classicArt.chick;

const base = `${import.meta.env.BASE_URL}farm/storybook-ro-a/`;
const image = (name: string, x: number, y: number, w: number, h: number) => `<image href="${base}${name}.webp" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
const hitBox = (b: Box, inner: string) => `<g transform="translate(${b.x} ${b.y})"><rect class="hitbg" width="${b.w}" height="${b.h}" fill="transparent"/>${inner}</g>`;

export function background(): string { return image('background', 0, 0, SCENE.w, SCENE.h); }
export function eastBackground(): string { return image('background-east', 0, 0, SCENE.w, SCENE.h); }

/** 成熟作物與土壤同一張圖，土壟才會遮住根部；所有田格共用尺寸避免切換時跳動。 */
export function field(b: Box, crop: CropId | null, stage: Stage | null, locked: boolean, unlockLevel = 0): string {
  // 新素材的透明邊較少；田土限制在田格內，放大的作物才不會蓋住隔壁田。
  let o = image(crop && stage === 3 && !locked ? `crop-${crop}` : 'field-empty', -5, -8, b.w + 10, b.h + 16);
  if (locked) {
    o += `<rect x="3" y="8" width="${b.w - 6}" height="${b.h - 16}" rx="12" fill="#282018" opacity=".42"/><text x="${b.w / 2}" y="${b.h / 2 + 4}" text-anchor="middle" font-size="12" font-weight="900" fill="#fff0c9" stroke="#49351e" stroke-width="2" paint-order="stroke">Lv ${unlockLevel} 解鎖</text>`;
  } else if (crop && stage !== null && stage !== 3) {
    // 初期作物用少量芽葉，成熟時才展示作物種類，讓狀態在小尺寸下仍清楚。
    o += [21, 48, 75].map((x) => stage === 0
      ? `<ellipse cx="${x}" cy="35" rx="4" ry="2.5" fill="#e9c88b" stroke="#704321" stroke-width="1.5"/>`
      : `<path d="M${x} 43 v-${stage === 1 ? 12 : 23}" stroke="#3b6728" stroke-width="3" stroke-linecap="round"/><path d="M${x} ${stage === 1 ? 34 : 27} q-12 -11 -12 1 q8 6 12 -1 q12 -11 12 1 q-8 6 -12 -1" fill="${stage === 1 ? '#78b844' : '#5fa139'}" stroke="#3b6728" stroke-width="1.4"/>`).join('');
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
