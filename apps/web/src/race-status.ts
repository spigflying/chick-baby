/** 賽車「狀態」分頁：目前極速（大號鍍鉻數字）＋每類零件加了多少性能（含百分比）。資料來自 /race/profile 的 parts／car。 */
import { carStats, PARTS, PART_KINDS, STOCK_PARTS, NITRO_PER_RACE, RACE_TICK_RATE, type PartKind } from '@chick/engine';
import { G, kmhShown } from './race-gfx';
import { bigDigit } from './race-shop';
import { partIcon } from './race-icons';
import { speedCanvas, speedFont } from './speed-font';

export interface Speeds { dry: number; wet: number; nitroDry: number; nitroWet: number }
/** 顯示用 km/h（速度表同一套：真實 ÷3），四捨五入 */
export function topSpeeds(parts: any, car: string): Speeds {
  const s = carStats(parts, car), r = (v: number) => Math.round(kmhShown(v));
  return { dry: r(s.topSpeed + s.tireTopDry), wet: r(s.topSpeed + s.tireTopWet), nitroDry: r((s.topSpeed + s.tireTopDry) * s.nitroBoost), nitroWet: r((s.topSpeed + s.tireTopWet) * s.nitroBoost) };
}
export interface PartRow { kind: PartKind; label: string; level: number; tier: string; effects: string[] }
const pct = (a: number, b: number) => `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%`;
/** 每類零件的效果（跟原廠同一台車比較；原廠那一階也列出基準值） */
export function partRows(partsIn: any, car: string): PartRow[] {
  const s0 = carStats(STOCK_PARTS, car), sec = (t: number) => t / RACE_TICK_RATE;
  return PART_KINDS.map((k) => {
    const lv = Math.max(0, Math.min(3, Number(partsIn?.[k]) || 0)), s = carStats({ ...STOCK_PARTS, [k]: lv }, car), e: string[] = [];
    const ms = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)} m/s（${v >= 0 ? '+' : ''}${Math.round(kmhShown(v))} km/h）`;
    if (k === 'engine') { e.push(`極速 ${ms(s.topSpeed - s0.topSpeed)}＝${pct(s.topSpeed, s0.topSpeed)}`); e.push(`加速 ${pct(s.accel, s0.accel)}`); }
    else if (k === 'gearbox') { e.push(`極速 ${ms(s.topSpeed - s0.topSpeed)}＝${pct(s.topSpeed, s0.topSpeed)}`); if (s.accel > s0.accel) e.push(`加速 ${pct(s.accel, s0.accel)}`); }
    else if (k === 'dry') { e.push(`晴天極速 ${ms(s.tireTopDry)}＝${pct(s0.topSpeed + s.tireTopDry, s0.topSpeed)}`); e.push(`抓地 ${pct(s.grip, s0.grip)}`); }
    else if (k === 'wet') { e.push(`雨雪極速 ${ms(s.tireTopWet)}＝${pct(s0.topSpeed + s.tireTopWet, s0.topSpeed)}`); e.push(`雨天抓地 ${pct(s.wetGrip, s0.wetGrip)}`); }
    else if (k === 'nitro') { e.push(`每次 ${sec(s.nitroTicks)} 秒（原廠 ${sec(s0.nitroTicks)} 秒）×${NITRO_PER_RACE} 次`); e.push(`噴射時極速 +${Math.round((s.nitroBoost - 1) * 100)}%`); }
    else { const z = k === 'armorF' ? 'F' : k === 'armorR' ? 'R' : 'S'; e.push(`${k === 'armorF' ? '追撞前車' : k === 'armorR' ? '被後車撞' : '擦撞／側撞'}損傷 −${Math.round(s.armor[z] * 100)}%`); }
    return { kind: k, label: PARTS[k].label, level: lv, tier: PARTS[k].tiers[lv].name, effects: e };
  });
}
/** 大號鍍鉻數字畫成 canvas（每位數 46px 寬、105px 高；原生解析度，CSS 用 pixelated 放大／縮小） */
export function bigNumber(n: number): HTMLCanvasElement {
  const str = String(Math.max(0, Math.round(n))), cw = 46, c = document.createElement('canvas');
  c.width = str.length * cw + 16; c.height = 106; const x = c.getContext('2d')!;
  for (let i = 0; i < str.length; i++) bigDigit(x, Number(str[i]), 4 + i * cw, 0);
  return c;
}
export function statusHtml(prof: any): string {
  const sp = topSpeeds(prof.parts, prof.car), rows = partRows(prof.parts, prof.car), bought = rows.filter((r) => r.level > 0), stock = rows.filter((r) => r.level === 0);
  const sameW = sp.dry === sp.wet;
  const big = (id: string, cap: string, cls: string) => `<div class="rs-num ${cls}"><span class="rs-cap">${cap}</span><canvas data-big="${id}"></canvas><span class="rs-unit">km/h</span></div>`;
  return `<h3>目前極速</h3><div class="rs-speeds">${big('dry', sameW ? '晴天／雨天' : '晴天', 'main')}${sameW ? '' : big('wet', '雨雪天', 'sub')}${big('nd', sameW ? '開氮氣' : '晴天開氮氣', 'sub')}${sameW ? '' : big('nw', '雨雪開氮氣', 'sub')}</div>
    <h3>已裝零件</h3>${bought.length ? `<ul class="rs-parts">${bought.map((r) => `<li><canvas data-icon="${r.kind}:${r.level}" width="48" height="48"></canvas><div><b>${r.label}</b> <span class="muted">${r.tier}</span><br>${r.effects.join('<br>')}</div></li>`).join('')}</ul>` : '<p class="muted">還沒買零件，全部是原廠。到「車庫」改裝。</p>'}
    ${stock.length ? `<h3>原廠（未改裝） <span class="muted">基準值</span></h3><ul class="rs-parts stock">${stock.map((r) => `<li><canvas data-icon="${r.kind}:0" width="48" height="48"></canvas><div><b>${r.label}</b> <span class="muted">原廠</span><br>${r.effects.filter((t) => !/[+−-]0%|\+0 m\/s|損傷 −0%/.test(t)).join('<br>') || '<span class="muted">沒有加成</span>'}</div></li>`).join('')}</ul>` : ''}`;
}
export function mountStatus(el: HTMLElement, prof: any) {
  const sp = topSpeeds(prof.parts, prof.car), val: Record<string, number> = { dry: sp.dry, wet: sp.wet, nd: sp.nitroDry, nw: sp.nitroWet };
  el.querySelector('.rs-speeds')?.setAttribute('data-sf', speedFont());
  el.querySelectorAll('canvas[data-big]').forEach((c) => { const src = speedCanvas(val[(c as HTMLElement).dataset.big!]), cv = c as HTMLCanvasElement; cv.width = src.width; cv.height = src.height; cv.getContext('2d')!.drawImage(src, 0, 0); });
  el.querySelectorAll('canvas[data-icon]').forEach((c) => { const [k, lv] = (c as HTMLElement).dataset.icon!.split(':'), x = (c as HTMLCanvasElement).getContext('2d')!; x.fillStyle = G[1]; x.fillRect(0, 0, 48, 48); x.drawImage(partIcon(k as PartKind, Number(lv)), 0, 0); });
}
