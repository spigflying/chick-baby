// 小雞農場全頁畫面（蓋在蛋殼頁上，掛法同 fight-view.ts）。只限電腦；規則與數值都在伺服器（@chick/engine farm.ts）。
import { ANIMALS, CRAFT_STATIONS, CROPS, DECOS, FARM, FARM_ITEMS, RECIPES, type AnimalStation, type CraftStation, type CropId, type DecoId, type FarmAction, type FarmItemId, type RecipeId } from '@chick/engine';
import { act, api, ApiError, errText } from './api';
import type { Live } from './ws';
import { EAST, LAYOUT, SCENE, type Box } from './farm-layout';
import * as realisticArt from './farm-art';
import * as classicArt from './farm-art-classic';
import { expandOffer, FARM_ERR, feedChoices, fieldBadge, helpTargets, hudModel, loadErrorAction, panelValid, plantChoices, remainText, stallDefaults, type FarmPayload } from './farm-model';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ic = (id: string, cls = 'fic') => `<svg class="${cls}" aria-hidden="true"><use href="#fi-${id}"/></svg>`;
/** 小雞的顏色：依農場主人目前寵物的物種。 */
const LOOK: Record<string, { body: string; belly: string }> = {
  chicken: { body: '#ffd84d', belly: '#fff6c4' }, duck: { body: '#fff4d6', belly: '#ffffff' },
  penguin: { body: '#9ad7ff', belly: '#ffffff' }, dino: { body: '#9be37a', belly: '#e9ffd9' },
};
type Panel = null | { k: 'plant'; idx: number } | { k: 'animal'; st: AnimalStation } | { k: 'craft'; st: CraftStation } | { k: 'tree' } | { k: 'orders' } | { k: 'store' } | { k: 'shop' } | { k: 'friends'; list?: any[] }
  // 第二階段
  | { k: 'grow'; idx: number } | { k: 'expand'; idx: number } | { k: 'balloon' } | { k: 'stall' } | { k: 'stallNew'; slot: number; item?: FarmItemId } | { k: 'deco'; slot: number } | { k: 'feed' };
/** 主畫面的田是 0–11，東邊新地的田是 12–17。 */
const fieldBox = (area: 'main' | 'east', i: number): Box | undefined => (area === 'main' ? LAYOUT.fields[i] : EAST.fields[i - FARM.baseFields]);
const fieldIdxs = (area: 'main' | 'east') => (area === 'main' ? [...LAYOUT.fields.keys()] : EAST.fields.map((_, i) => FARM.baseFields + i));
type FarmTheme = 'realistic' | 'classic';
const themeKey = (userId: string) => `chick-farm-theme-${userId}`;
function savedTheme(userId: string): FarmTheme {
  try { return localStorage.getItem(themeKey(userId)) === 'classic' ? 'classic' : 'realistic'; }
  catch { return 'realistic'; }
}

let symbolsInjected = false;

export class FarmView {
  private root: HTMLElement;
  private data: FarmPayload | null = null;
  private ownerId: string | null = null;
  private species: string | null = null;
  private loadedAt = 0;
  private timer = 0;
  private panel: Panel = null;
  private busy = false;
  /** 背景重讀失敗後暫停（避免每秒一直重試），下一次成功的操作或重新打開時恢復 */
  private paused = false;
  /** 主畫面或東邊新地 */
  private area: 'main' | 'east' = 'main';
  private theme: FarmTheme = 'realistic';
  private get art() { return this.theme === 'classic' ? classicArt : realisticArt; }

  constructor(private live: Live, private me: { id: string; display_name: string }, private toast: (s: string) => void, private setWallet: (n: number) => void, private wallet: () => number) {
    this.theme = savedTheme(this.me.id);
    if (!symbolsInjected) { document.body.insertAdjacentHTML('beforeend', classicArt.iconSymbols()); symbolsInjected = true; }
    this.root = document.createElement('div'); this.root.className = 'farm'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', '小雞農場');
    document.body.append(this.root);
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey, true);
  }

  async open(ownerId: string, species?: string | null) {
    if (this.live.touch) return this.toast('農場只能用電腦玩');
    this.ownerId = ownerId; this.species = species ?? null; this.panel = null; this.paused = false; this.area = 'main';
    try { await this.load(); } catch (e) { this.ownerId = null; return this.toast(this.err(e)); }
    this.root.hidden = false; requestAnimationFrame(() => this.root.classList.add('on'));
    clearInterval(this.timer); this.timer = window.setInterval(() => this.tickTimers(), 1000);
    this.showHelpLog(); this.showSaleLog();
  }
  close() {
    this.root.classList.remove('on'); this.root.hidden = true; this.ownerId = null; this.data = null; this.panel = null;
    clearInterval(this.timer);
  }
  onUpdated(userId: string) { if (this.ownerId === userId && !this.busy) void this.bgLoad(); }
  destroy() { this.close(); this.root.remove(); document.removeEventListener('keydown', this.onKey, true); }

  // ---------- 資料 ----------
  private async load() {
    const p = await api<FarmPayload>('GET', `/farm/${this.ownerId}`);
    this.data = p; this.loadedAt = Date.now(); this.render();
  }
  /** 背景重讀（推播、倒數歸零）：失敗時不重試轟炸伺服器。 */
  private async bgLoad() {
    if (this.paused) return;
    try { await this.load(); }
    catch (e) {
      if (loadErrorAction(e instanceof ApiError ? e.code : 'network') === 'close') { if (this.ownerId) { this.toast(this.err(e)); this.close(); } }
      else this.paused = true;
    }
  }
  private err(e: unknown) { return e instanceof ApiError ? (FARM_ERR[e.code] ?? errText(e)) : errText(e); }
  private async doAct(action: FarmAction, okMsg?: string) {
    if (this.busy) return; this.busy = true;
    try {
      const r = await act<FarmPayload>('POST', '/farm/act', { action });
      this.data = r; this.loadedAt = Date.now(); this.paused = false;
      if (typeof r.balance === 'number') this.setWallet(r.balance);
      for (const lv of r.leveled ?? []) this.toast(`升到 Lv ${lv} 了！`);
      if (okMsg) this.toast(okMsg);
      this.render();
    } catch (e) { this.toast(this.err(e)); } finally { this.busy = false; }
  }
  private async doHelp(body: { kind: 'water'; idx: number } | { kind: 'rescue' }) {
    if (this.busy || !this.ownerId) return; this.busy = true;
    try {
      const r = await act<any>('POST', `/farm/${this.ownerId}/help`, body);
      this.toast(body.kind === 'water' ? `幫忙澆水了！友情點數 ${r.friend_pts}` : `果樹救回來了！友情點數 ${r.friend_pts}`);
      await this.load();
    } catch (e) { this.toast(this.err(e)); } finally { this.busy = false; }
  }
  private showHelpLog() {
    const p = this.data; if (!p?.is_owner || !p.state.helpLog.length) return;
    const log = p.state.helpLog, shown = log.slice(-3);
    for (const h of shown) this.toast(`${h.name} ${h.kind === 'water' ? '幫你澆了水' : '救了你的果樹'}`);
    if (log.length > 3) this.toast(`還有 ${log.length - 3} 次好友幫忙`);
    void act('POST', '/farm/act', { action: { type: 'ackHelp' } }).catch(() => {});
  }
  private showSaleLog() {
    const p = this.data; if (!p?.is_owner || !p.state.saleLog?.length) return;
    const log = p.state.saleLog;
    for (const x of log.slice(-3)) this.toast(`${x.name} 買了你的 ${FARM_ITEMS[x.item].name} ×${x.qty}（◎${x.price}）`);
    if (log.length > 3) this.toast(`小攤還賣出 ${log.length - 3} 筆`);
    void act('POST', '/farm/act', { action: { type: 'ackSales' } }).catch(() => {});
  }
  private async doBuy(slot: number) {
    if (this.busy || !this.ownerId) return; this.busy = true;
    try {
      const r = await act<any>('POST', `/farm/${this.ownerId}/buy`, { slot });
      this.setWallet(r.balance); this.toast(`買到 ${FARM_ITEMS[r.item as FarmItemId].name} ×${r.qty}（◎${r.price}），放進你的倉庫了`);
      await this.load();
    } catch (e) { this.toast(this.err(e)); } finally { this.busy = false; }
  }
  private async doFeedPet(item: FarmItemId) {
    if (this.busy) return; this.busy = true;
    try {
      await act<any>('POST', '/farm/feed-pet', { item });
      this.toast(`寵物吃了${FARM_ITEMS[item].name}！`);
      await this.load();
    } catch (e) { this.toast(this.err(e)); } finally { this.busy = false; }
  }
  /** 倒數：伺服器給的是開放時間的剩餘毫秒，這裡用經過的牆鐘時間近似；有東西剛好熟了就重讀一次。 */
  private remain(ms: number) { return Math.max(0, ms - (Date.now() - this.loadedAt)); }
  private tickTimers() {
    const d = this.data?.derived; if (!d || this.busy || this.paused) return;
    const all = [...d.fields.filter((f) => f.stage !== null && f.stage < 3).map((f) => f.remainMs),
      ...Object.values(d.animals).flatMap((a) => a.items.filter((x) => x.state === 'growing').map((x) => x.remainMs)),
      ...Object.values(d.jobs).flatMap((j) => j.items.map((x) => x.remainMs)), ...(d.tree.state === 'growing' ? [d.tree.remainMs] : []),
      ...d.orders.flatMap((o) => ('waitMs' in o && o.waitMs > 0 ? [o.waitMs] : [])), ...('remainMs' in d.balloon ? [d.balloon.remainMs] : [])];
    if (all.some((ms) => ms > 0 && this.remain(ms) === 0)) { void this.bgLoad(); return; }
    const g = this.root.querySelector('.scene .pills'); if (g) g.innerHTML = this.pills();
    const pn = this.root.querySelector('.farm-panel [data-live]'); if (pn) this.renderPanel();
  }

  // ---------- 畫面 ----------
  private render() {
    const p = this.data; if (!p) return;
    this.root.classList.toggle('classic', this.theme === 'classic');
    const owner = p.is_owner;
    const hud = hudModel(p, this.wallet());
    this.root.innerHTML = `
      <div class="farm-top"><b class="farm-title">${owner ? '我的農場' : `${esc(p.owner.display_name)} 的農場`}</b>
        <button type="button" class="farm-theme" data-act="theme" aria-label="切換農場畫風，目前為${this.theme === 'realistic' ? '寫實 3D' : '原版插畫'}">畫風：${this.theme === 'realistic' ? '寫實 3D' : '原版插畫'}</button>
        <button type="button" class="farm-x" data-act="close" aria-label="關閉農場（Esc）">✕</button></div>
      <div class="farm-stage">
        <svg class="scene" viewBox="0 0 ${SCENE.w} ${SCENE.h}" role="img" aria-label="農場畫面">${this.art.sceneDefs()}${this.scene()}<g class="pills">${this.pills()}</g></svg>
        <div class="farm-hud">
          <div class="fpill"><span class="flv">${hud.level}</span><span class="fxp"><i style="width:${hud.xpPct}%"></i></span><span>Lv${hud.level}</span></div>
          ${owner ? `<div class="fpill">${ic('coin')}${hud.coins.toLocaleString()}</div>` : ''}
          <span class="fgrow"></span>
          ${owner ? `<div class="fpill" title="倉庫">${ic('box')}${hud.barn}</div><div class="fpill" title="友情點數">${ic('heart')}${hud.friendPts}</div>` : `<div class="fpill visit">來幫忙：點「澆水」「救樹」・東邊新地有小攤</div>`}
        </div>
        <div class="farm-panel" hidden></div>
      </div>
      <div class="farm-tools">${owner ? `
        <button type="button" class="ftool" data-act="shop">${ic('shop', 'fic big')}商店</button>
        <button type="button" class="ftool" data-act="store">${ic('box', 'fic big')}倉庫</button>
        <button type="button" class="ftool" data-act="orders">${ic('board', 'fic big')}訂單${this.deliverable() ? `<span class="fbadge">${this.deliverable()}</span>` : ''}</button>
        <button type="button" class="ftool" data-act="collectAll">${ic('wheat', 'fic big')}全部收成</button>
        <button type="button" class="ftool" data-act="feedPanel">${ic('apple', 'fic big')}餵寵物</button>` : ''}
        <button type="button" class="ftool" data-act="friends">${ic('friend', 'fic big')}好友</button>
        <button type="button" class="ftool" data-act="close">${ic('home', 'fic big')}回家</button>
      </div>`;
    this.renderPanel();
  }
  private deliverable() { return this.data?.derived.orders.filter((o) => 'order' in o && o.canDeliver).length ?? 0; }
  private scene() {
    const p = this.data!, s = p.state, d = p.derived;
    const hit = (key: string, inner: string, label: string) => `<g class="hit" data-hit="${key}" tabindex="0" role="button" aria-label="${esc(label)}">${inner}</g>`;
    if (this.area === 'east') return this.eastScene(hit);
    let o = this.art.background();
    LAYOUT.fields.forEach((b, i) => { const f = s.fields[i], fd = d.fields[i]; o += hit(`field:${i}`, this.art.field(b, f.crop, fd.stage, fd.locked, fd.unlockLevel), `田 ${i + 1}`); });
    const an = (st: AnimalStation) => d.animals[st].items.map((x) => x.state === 'ready');
    o += hit('animal:hutch', this.art.hutch(LAYOUT.hutch, an('hutch'), d.animals.hutch.locked, ANIMALS.hutch.level), '兔兔窩');
    o += hit('animal:coop', this.art.coop(LAYOUT.coop, an('coop'), d.animals.coop.locked, ANIMALS.coop.level), '雞舍');
    o += hit('craft:bakery', this.art.bakery(LAYOUT.bakery, d.jobs.bakery.items.length > 0, d.jobs.bakery.locked, CRAFT_STATIONS.bakery.level), '烘焙屋');
    o += hit('craft:jamhouse', this.art.jamhouse(LAYOUT.jamhouse, d.jobs.jamhouse.items.length > 0, d.jobs.jamhouse.locked, CRAFT_STATIONS.jamhouse.level), '果醬工坊');
    o += hit('tree', this.art.tree(LAYOUT.tree, d.tree.state), '蘋果樹');
    o += hit('board', this.art.board(LAYOUT.board, p.is_owner && this.deliverable() > 0), '訂單看板');
    o += hit('barn', this.art.barn(LAYOUT.barn), '倉庫');
    o += hit('goEast', this.art.sign(LAYOUT.eastSign, d.east.locked ? `Lv${FARM.eastLevel} 開放` : '東邊新地', d.east.locked), '去東邊新地');
    o += this.art.chick(LAYOUT.chick.x, LAYOUT.chick.y, LOOK[this.species ?? 'chicken'] ?? LOOK.chicken);
    return o;
  }
  private eastScene(hit: (key: string, inner: string, label: string) => string) {
    const p = this.data!, s = p.state, d = p.derived;
    let o = this.art.eastBackground();
    EAST.fields.forEach((b, k) => { const i = FARM.baseFields + k, f = s.fields[i], fd = d.fields[i]; o += hit(`field:${i}`, this.art.field(b, f.crop, fd.stage, fd.locked, fd.unlockLevel), `田 ${i + 1}`); });
    const an = (st: AnimalStation) => d.animals[st].items.map((x) => x.state === 'ready');
    o += hit('animal:beehive', this.art.beehive(EAST.beehive, an('beehive'), d.animals.beehive.locked, ANIMALS.beehive.level), '蜂箱');
    o += hit('animal:cowshed', this.art.cowshed(EAST.cowshed, an('cowshed'), d.animals.cowshed.locked, ANIMALS.cowshed.level), '牛棚');
    o += hit('craft:dairy', this.art.dairy(EAST.dairy, d.jobs.dairy.items.length > 0, d.jobs.dairy.locked, CRAFT_STATIONS.dairy.level), '起司小屋');
    o += hit('balloon', this.art.balloon(EAST.balloon, d.balloon, FARM.balloon.level), '熱氣球');
    o += hit('stall', this.art.stall(EAST.stall, s.stall, s.level < FARM.stall.level, FARM.stall.level), '小攤');
    EAST.decos.forEach((b, i) => { o += p.is_owner ? hit(`deco:${i}`, this.art.deco(b, s.decos[i], true), `裝飾格 ${i + 1}`) : this.art.deco(b, s.decos[i], false); });
    o += hit('goMain', this.art.sign(EAST.back, '回農場', false, true), '回主農場');
    o += this.art.chick(EAST.chick.x, EAST.chick.y, LOOK[this.species ?? 'chicken'] ?? LOOK.chicken);
    return o;
  }
  /** 田、建築上方的標籤（每秒更新）。 */
  private pills() {
    const p = this.data!, d = p.derived; let o = '';
    const helps = new Set(helpTargets(p).map((h) => (h.kind === 'water' ? `w${h.idx}` : 'tree')));
    for (const i of fieldIdxs(this.area)) {
      const b = fieldBox(this.area, i)!, fd = d.fields[i];
      if (fd.locked) { if (p.is_owner && this.area === 'east' && expandOffer(p, i).kind === 'buy') o += this.art.pill(b.x + b.w / 2, b.y - (this.theme === 'realistic' ? 42 : 18), '可以買', 'ready'); continue; }
      const cx = b.x + b.w / 2, y = b.y - 18;
      if (helps.has(`w${i}`)) { o += this.art.pill(cx, y, '澆水', 'alert'); continue; }
      const badge = fieldBadge({ ...fd, remainMs: this.remain(fd.remainMs) }, p.is_owner);
      if (badge.tone === 'ready') o += this.art.pill(cx, y, '可收成', 'ready');
      else if (badge.tone === 'timer') o += this.art.pill(cx, y, remainText(this.remain(fd.remainMs)), 'timer');
    }
    const station = (b: { x: number; y: number; w: number }, txt: string | null, tone: 'ready' | 'timer' | 'alert') => { if (txt) o += this.art.pill(b.x + b.w / 2, b.y - 14, txt, tone); };
    if (this.area === 'east') { this.eastPills(station); return o; }
    for (const st of ['hutch', 'coop'] as const) {
      const a = d.animals[st]; if (a.locked) continue;
      const ready = a.items.filter((x) => x.state === 'ready').length, hungry = a.items.filter((x) => x.state === 'hungry').length;
      const grow = a.items.filter((x) => x.state === 'growing').map((x) => this.remain(x.remainMs));
      station(LAYOUT[st], ready ? `${FARM_ITEMS[ANIMALS[st].out.item].name}好了` : hungry ? '肚子餓了' : grow.length ? remainText(Math.min(...grow)) : null, ready ? 'ready' : 'timer');
    }
    for (const st of ['bakery', 'jamhouse'] as const) {
      const j = d.jobs[st]; if (j.locked || !j.items.length) continue;
      const done = j.items.filter((x) => this.remain(x.remainMs) === 0).length;
      station(LAYOUT[st], done ? `${done} 個做好了` : remainText(this.remain(j.items[0].remainMs)), done ? 'ready' : 'timer');
    }
    if (helps.has('tree')) station(LAYOUT.tree, '救樹', 'alert');
    else if (d.tree.state === 'ready') station(LAYOUT.tree, '可收成', 'ready');
    else if (d.tree.state === 'withered') station(LAYOUT.tree, '枯掉了', 'timer');
    else station(LAYOUT.tree, remainText(this.remain(d.tree.remainMs)), 'timer');
    return o;
  }
  private eastPills(station: (b: { x: number; y: number; w: number }, txt: string | null, tone: 'ready' | 'timer' | 'alert') => void): void {
    const p = this.data!, d = p.derived, s = p.state;
    if (p.is_owner) {
      for (const st of ['beehive', 'cowshed'] as const) {
        const a = d.animals[st]; if (a.locked) continue;
        const ready = a.items.filter((x) => x.state === 'ready').length, hungry = a.items.filter((x) => x.state === 'hungry').length;
        const grow = a.items.filter((x) => x.state === 'growing').map((x) => this.remain(x.remainMs));
        station(EAST[st], ready ? `${FARM_ITEMS[ANIMALS[st].out.item].name}好了` : hungry ? '肚子餓了' : grow.length ? remainText(Math.min(...grow)) : null, ready ? 'ready' : 'timer');
      }
      const j = d.jobs.dairy;
      if (!j.locked && j.items.length) { const done = j.items.filter((x) => this.remain(x.remainMs) === 0).length; station(EAST.dairy, done ? `${done} 個做好了` : remainText(this.remain(j.items[0].remainMs)), done ? 'ready' : 'timer'); }
      const bl = d.balloon;
      if (bl.state === 'here') { const n = bl.crates.filter((c) => c.filled).length; station(EAST.balloon, n === bl.crates.length ? '可以出發' : `貨箱 ${n}/${bl.crates.length}・${remainText(this.remain(bl.remainMs))}`, n === bl.crates.length || bl.crates.some((c) => c.canFill) ? 'ready' : 'timer'); }
      else if (bl.state === 'away') station(EAST.balloon, `${remainText(this.remain(bl.remainMs))}後回來`, 'timer');
    } else if (s.stall.some(Boolean)) station(EAST.stall, '買東西', 'alert');
  }

  // ---------- 子畫面 ----------
  private renderPanel() {
    const el = this.root.querySelector('.farm-panel') as HTMLElement | null; if (!el) return;
    if (this.panel && this.data && !panelValid(this.panel, this.data)) this.panel = null;
    const pn = this.panel, p = this.data;
    if (!pn || !p) { el.hidden = true; el.innerHTML = ''; return; }
    const head = (title: string, icon: string, tone: string) => `<header class="fph ${tone}">${ic(icon, 'fic hic')}<b>${title}</b><button type="button" class="fpx" data-act="panelClose" aria-label="關閉">✕</button></header>`;
    let html = '';
    const s = p.state, d = p.derived;
    if (pn.k === 'plant') {
      html = head(`種什麼？（田 ${pn.idx + 1}）`, 'wheat', 'mint') + `<div class="fpb"><div class="flist">${plantChoices(p, this.wallet()).map((c) => `
        <button type="button" class="frow" data-act="plant" data-crop="${c.crop}" ${c.enabled ? '' : 'disabled'}>${ic(CROPS[c.crop].out.item, 'fic mid')}
          <span class="fname">${esc(c.name)}<small>${remainText(CROPS[c.crop].growMs)}・收 ${CROPS[c.crop].out.qty} 個</small></span>
          <span class="fcost">${c.reason ? esc(c.reason) : esc(c.cost)}</span></button>`).join('')}</div></div>`;
    } else if (pn.k === 'animal') {
      const def = ANIMALS[pn.st], a = d.animals[pn.st];
      html = head(def.name, def.out.item, 'pink') + `<div class="fpb" data-live>${a.locked ? `<p class="fnote">Lv ${def.level} 解鎖</p>` : a.items.map((x, i) => `
        <div class="frow static">${ic(def.out.item, 'fic mid')}<span class="fname">${def.animal} ${i + 1}<small>${x.state === 'hungry' ? `要吃 ${def.feed.map((f) => `${FARM_ITEMS[f.item].name} ×${f.qty}`).join('、')}` : x.state === 'ready' ? `${FARM_ITEMS[def.out.item].name}好了！` : `還要 ${remainText(this.remain(x.remainMs))}`}</small></span>
          ${x.state === 'hungry' ? `<button type="button" class="fbtn go" data-act="feed" data-i="${i}">餵</button>` : x.state === 'ready' ? `<button type="button" class="fbtn go" data-act="collect" data-i="${i}">收</button>` : ''}</div>`).join('')}
        <p class="fnote">你有 ${def.feed.map((f) => `${FARM_ITEMS[f.item].name} ${s.inv[f.item] ?? 0}`).join('、')}</p></div>`;
    } else if (pn.k === 'craft') {
      const meta = CRAFT_STATIONS[pn.st], j = d.jobs[pn.st];
      const recipes = (Object.keys(RECIPES) as RecipeId[]).filter((r) => RECIPES[r].station === pn.st);
      const slots = s.queueSlots[pn.st];
      html = head(meta.name, 'oven', 'pink') + `<div class="fpb" data-live>${j.locked ? `<p class="fnote">Lv ${meta.level} 解鎖</p>` : `
        ${recipes.map((r) => { const R = RECIPES[r]; const ok = R.in.every((x) => (s.inv[x.item] ?? 0) >= x.qty);
          return `<div class="frecipe">${R.in.map((x) => `${ic(x.item, 'fic mid')}<span class="fx">×${x.qty}<small>(${s.inv[x.item] ?? 0})</small></span>`).join('<span class="fplus">＋</span>')}<span class="farrow">➜</span>${ic(R.out.item, 'fic mid')}
          <span class="ftime">${remainText(R.ms)}</span><button type="button" class="fbtn go" data-act="craft" data-recipe="${r}" ${ok && j.items.length < slots ? '' : 'disabled'}>做</button></div>`; }).join('')}
        <div class="fqueue">${Array.from({ length: FARM.queue.max }, (_, i) => { const it = j.items[i];
          if (i >= slots) return `<div class="fslot lockq">＋</div>`;
          return it ? `<div class="fslot full">${ic(RECIPES[it.recipe].out.item, 'fic mid')}<small>${this.remain(it.remainMs) ? remainText(this.remain(it.remainMs)) : '好了'}</small></div>` : '<div class="fslot">空</div>'; }).join('')}</div>
        <div class="fbtns"><button type="button" class="fbtn go" data-act="collectJobs" ${j.items.some((x) => this.remain(x.remainMs) === 0) ? '' : 'disabled'}>收成品</button>
          <button type="button" class="fbtn up" data-act="upgradeQueue" ${slots >= FARM.queue.max ? 'disabled' : ''}>${slots >= FARM.queue.max ? '佇列已滿級' : `加一格 ◎${FARM.queue.costs[slots - FARM.queue.base]}`}</button></div>`}</div>`;
    } else if (pn.k === 'tree') {
      html = head('蘋果樹', 'apple', 'mint') + `<div class="fpb"><p class="fnote">${d.tree.state === 'withered' ? '果樹太久沒收，枯掉了。請朋友來救（免費），或自己花金幣救。' : '果樹好好的。'}</p>
        ${d.tree.state === 'withered' ? `<button type="button" class="fbtn up wide" data-act="rescue">花 ◎${FARM.tree.rescueCoins} 自己救</button>` : ''}</div>`;
    } else if (pn.k === 'orders') {
      html = head('訂單看板', 'board', 'orange') + `<div class="fpb" data-live><div class="forders">${d.orders.map((o, i) => 'order' in o ? `
        <div class="forder ${o.canDeliver ? 'ok' : ''}">${o.order.items.map((it) => `<span class="fneed">${ic(it.item, 'fic mid')}<b>${s.inv[it.item] ?? 0}/${it.qty}</b></span>`).join('')}
          <span class="freward">◎ ${o.order.coins}<small>+${o.order.xp} 經驗</small></span>
          <span class="fbtns"><button type="button" class="fbtn go" data-act="deliver" data-slot="${i}" ${o.canDeliver ? '' : 'disabled'}>交貨</button><button type="button" class="fbtn no" data-act="discard" data-slot="${i}">丟掉</button></span></div>`
        : `<div class="forder wait"><span>${this.remain(o.waitMs) ? `${remainText(this.remain(o.waitMs))}後有新訂單` : '新訂單來了'}</span></div>`).join('')}</div></div>`;
    } else if (pn.k === 'store') {
      const items = (Object.keys(FARM_ITEMS) as FarmItemId[]);
      const lvl = s.barnLevel, maxed = lvl >= FARM.barn.maxLevel;
      html = head('倉庫', 'box', 'blue') + `<div class="fpb"><div class="fgrid">${items.map((it) => { const n = s.inv[it] ?? 0; return `
        <div class="ftile ${n ? '' : 'zero'}">${ic(it, 'fic mid')}<b>${n}</b><small>${esc(FARM_ITEMS[it].name)} ◎${FARM_ITEMS[it].sell}</small>
          <span class="fsell"><button type="button" class="fbtn tiny" data-act="sell" data-item="${it}" data-qty="1" ${n ? '' : 'disabled'}>賣 1</button><button type="button" class="fbtn tiny" data-act="sell" data-item="${it}" data-qty="${n}" ${n > 1 ? '' : 'disabled'}>全賣</button></span></div>`; }).join('')}</div>
        <p class="fnote">能吃的東西可以按下面的「餵寵物」給自己的寵物吃（不花金幣）。</p>
        <div class="frowtext"><span>容量</span><span>${d.barn.used} / ${d.barn.cap}</span></div><div class="fbar"><i style="width:${Math.min(100, Math.round((d.barn.used / d.barn.cap) * 100))}%"></i></div>
        <button type="button" class="fbtn up wide" data-act="upgradeBarn" ${maxed ? 'disabled' : ''}>${maxed ? '倉庫已滿級' : `升級倉庫 +${FARM.barn.step} 格　◎${FARM.barn.costBase * 2 ** lvl}`}</button></div>`;
    } else if (pn.k === 'shop') {
      const cost = FARM.barn.bonusCostStep * (s.barnBonusBought + 1);
      html = head('商店・友情', 'heart', 'pink') + `<div class="fpb"><p class="fnote">去朋友的農場幫忙澆水、救樹就能拿友情點數（現在 ${s.friendPts} 點）。</p>
        <div class="frow static">${ic('pumpkin', 'fic mid')}<span class="fname">愛心南瓜種子<small>Lv ${CROPS.pumpkin.level}・種田時選「愛心南瓜」，每次用 ${CROPS.pumpkin.seedFriendPts} 點</small></span></div>
        <div class="frow static">${ic('box', 'fic mid')}<span class="fname">倉庫 +${FARM.barn.bonusSlots} 格<small>友情 ${cost} 點</small></span>
          <button type="button" class="fbtn up" data-act="barnBonus" ${s.friendPts >= cost ? '' : 'disabled'}>換</button></div>
        <h4 class="fsub">裝飾（擺在東邊新地）${s.decoBag.length ? `<small>收納裡有 ${s.decoBag.length} 個</small>` : ''}</h4>
        ${s.level < FARM.eastLevel ? `<p class="fnote">Lv ${FARM.eastLevel} 開放東邊新地後就能買裝飾。</p>` : `<div class="fdecos">${(Object.keys(DECOS) as DecoId[]).map((id) => { const D = DECOS[id], ok = D.coins ? this.wallet() >= D.coins : s.friendPts >= D.friendPts;
          return `<div class="fdeco"><svg viewBox="0 0 120 110" class="fdeco-art">${this.art.deco({ x: 0, y: 0, w: 120, h: 110 }, id, true)}</svg><small>${esc(D.name)}</small>
            <button type="button" class="fbtn tiny up" data-act="buyDeco" data-deco="${id}" ${ok ? '' : 'disabled'}>${D.coins ? `◎${D.coins}` : `友情 ${D.friendPts}`}</button></div>`; }).join('')}</div>`}</div>`;
    } else if (pn.k === 'friends') {
      const list = pn.list;
      html = head('好友農場', 'friend', 'purple') + `<div class="fpb">${!list ? '<p class="fnote">讀取中…</p>' : !list.length ? '<p class="fnote">還沒有朋友的農場。先用分享碼去朋友家拜訪，之後就會出現在這裡。</p>'
        : `<div class="flist">${list.map((f) => `<button type="button" class="frow" data-act="visit" data-user="${esc(f.user_id)}"><span class="fav">${esc(String(f.display_name).slice(0, 1))}</span>
          <span class="fname">${esc(f.display_name)} 的農場<small>Lv ${f.level}</small></span>${f.needs_help ? '<span class="fhelp">需要幫忙</span>' : ''}</button>`).join('')}</div>`}
        ${p.is_owner ? '' : `<button type="button" class="fbtn wide" data-act="visit" data-user="${esc(this.me.id)}">回我的農場</button>`}</div>`;
    }
    else html = this.phase2Panel(pn, head);
    el.innerHTML = html; el.hidden = false;
  }
  private phase2Panel(pn: NonNullable<Panel>, head: (title: string, icon: string, tone: string) => string): string {
    const p = this.data!, s = p.state, d = p.derived;
    if (pn.k === 'grow') {
      const f = d.fields[pn.idx], crop = s.fields[pn.idx].crop!, cw = d.chickWater;
      const can = cw.left > 0 && !s.fields[pn.idx].chick;
      return head(`${CROPS[crop].name}（田 ${pn.idx + 1}）`, CROPS[crop].out.item, 'mint') + `<div class="fpb" data-live><p class="fnote">還要 ${remainText(this.remain(f.remainMs))}${s.fields[pn.idx].wateredBy ? '・好友澆過水' : ''}${s.fields[pn.idx].chick ? '・小雞澆過水' : ''}</p>
        ${cw.limit ? `<button type="button" class="fbtn go wide" data-act="chickWater" ${can ? '' : 'disabled'}>${ic('water', 'fic')} 小雞澆水（今天還能 ${cw.left}/${cw.limit} 次）</button>
          <p class="fnote">剩下時間少 20%。寵物體力 30、60 以上每天各多 1 次。</p>` : '<p class="fnote">有一隻活著的寵物，牠就會來農場幫你澆水。</p>'}</div>`;
    }
    if (pn.k === 'expand') {
      const o = expandOffer(p, pn.idx);
      return head('買一塊新田', 'wheat', 'orange') + `<div class="fpb">${o.kind === 'buy' ? `<p class="fnote">東邊新地的田要一格一格買，買了就跟其他田一樣種。</p>
        <button type="button" class="fbtn up wide" data-act="expand" ${this.wallet() >= o.cost ? '' : 'disabled'}>花 ◎${o.cost} 買下這塊田</button>` : `<p class="fnote">${o.kind === 'later' ? esc(o.text) : '這塊田已經是你的了'}</p>`}</div>`;
    }
    if (pn.k === 'balloon') {
      const bl = d.balloon;
      if (bl.state !== 'here') return head('熱氣球貨運', 'balloon', 'blue') + `<div class="fpb" data-live><p class="fnote">${bl.state === 'away' ? `熱氣球去送貨了，${remainText(this.remain(bl.remainMs))}後回來。` : `Lv ${FARM.balloon.level} 開放`}</p></div>`;
      const all = bl.crates.every((c) => c.filled);
      return head('熱氣球貨運', 'balloon', 'blue') + `<div class="fpb" data-live><p class="fnote">還會停 ${remainText(this.remain(bl.remainMs))}。每裝好一箱馬上拿錢；4 箱全裝好按「出發」再多 ◎${FARM.balloon.bonusCoins}＋${FARM.balloon.bonusXp} 經驗。</p>
        <div class="forders">${bl.crates.map((c, i) => `<div class="forder ${c.filled ? 'ok' : ''}"><span class="fneed">${ic(c.item, 'fic mid')}<b>${c.filled ? '裝好了' : `${s.inv[c.item] ?? 0}/${c.qty}`}</b></span>
          <span class="freward">◎ ${Math.round(FARM_ITEMS[c.item].sell * c.qty * FARM.balloon.coinMult)}<small>+${FARM_ITEMS[c.item].xp * c.qty} 經驗</small></span>
          <span class="fbtns"><button type="button" class="fbtn go" data-act="fillCrate" data-i="${i}" ${c.canFill ? '' : 'disabled'}>${c.filled ? '✓' : '裝箱'}</button></span></div>`).join('')}</div>
        <button type="button" class="fbtn up wide" data-act="sendBalloon" ${all ? '' : 'disabled'}>出發！</button></div>`;
    }
    if (pn.k === 'stall') {
      if (!p.is_owner) return head(`${esc(p.owner.display_name)} 的小攤`, 'stall', 'pink') + `<div class="fpb">${s.stall.some(Boolean) ? `<div class="flist">${s.stall.map((l, i) => l ? `
        <div class="frow static">${ic(l.item, 'fic mid')}<span class="fname">${esc(FARM_ITEMS[l.item].name)} ×${l.qty}<small>系統收購價 ◎${FARM_ITEMS[l.item].sell * l.qty}</small></span>
          <button type="button" class="fbtn go" data-act="buy" data-slot="${i}" ${this.wallet() >= l.price ? '' : 'disabled'}>◎${l.price} 買</button></div>` : '').join('')}</div>
        <p class="fnote">金幣直接給主人，東西放進你的倉庫。每天最多買 ${FARM.stall.buysPerDay} 次。</p>` : '<p class="fnote">小攤現在沒有東西。</p>'}</div>`;
      return head('我的小攤', 'stall', 'pink') + `<div class="fpb"><div class="flist">${s.stall.map((l, i) => l ? `
        <div class="frow static">${ic(l.item, 'fic mid')}<span class="fname">${esc(FARM_ITEMS[l.item].name)} ×${l.qty}<small>賣 ◎${l.price}</small></span>
          <button type="button" class="fbtn no" data-act="stallCancel" data-slot="${i}">下架</button></div>`
        : `<button type="button" class="frow" data-act="stallNew" data-slot="${i}"><span class="fav">＋</span><span class="fname">空格<small>點這裡從倉庫拿東西上架</small></span></button>`).join('')}</div>
        <p class="fnote">朋友來拜訪時可以買，金幣直接進你的錢包。價格可以訂在系統收購價的 1–3 倍。</p></div>`;
    }
    if (pn.k === 'stallNew') {
      const items = (Object.keys(FARM_ITEMS) as FarmItemId[]).filter((i) => (s.inv[i] ?? 0) > 0);
      if (!pn.item) return head('上架什麼？', 'stall', 'pink') + `<div class="fpb">${items.length ? `<div class="fgrid">${items.map((it) => `
        <button type="button" class="ftile" data-act="stallPick" data-item="${it}">${ic(it, 'fic mid')}<b>${s.inv[it]}</b><small>${esc(FARM_ITEMS[it].name)}</small></button>`).join('')}</div>` : '<p class="fnote">倉庫是空的。</p>'}</div>`;
      const df = stallDefaults(pn.item, s.inv[pn.item] ?? 0);
      return head(`上架 ${esc(FARM_ITEMS[pn.item].name)}`, pn.item, 'pink') + `<div class="fpb"><div class="fform">
        <label>數量 <input class="finput" type="number" data-f="qty" min="1" max="${df.maxQty}" value="1"></label>
        <label>每個 ◎ <input class="finput" type="number" data-f="unit" min="${df.unitMin}" max="${df.unitMax}" value="${df.unit}"></label>
        <p class="fnote">系統收購價每個 ◎${FARM_ITEMS[pn.item].sell}，每個可以訂 ◎${df.unitMin}–${df.unitMax}；總價＝每個 × 數量。</p></div>
        <button type="button" class="fbtn go wide" data-act="stallList">上架</button></div>`;
    }
    if (pn.k === 'deco') {
      const cur = s.decos[pn.slot], bag = [...new Set(s.decoBag)];
      return head(`裝飾格 ${pn.slot + 1}`, 'heart', 'purple') + `<div class="fpb">${cur ? `<div class="frow static"><span class="fname">${esc(DECOS[cur].name)}<small>擺在這裡</small></span><button type="button" class="fbtn no" data-act="storeDeco">收起來</button></div>` : ''}
        ${bag.length ? `<h4 class="fsub">從收納拿出來擺${cur ? '（換掉現在的）' : ''}</h4><div class="fdecos">${bag.map((id) => `<button type="button" class="fdeco" data-act="placeDeco" data-deco="${id}"><svg viewBox="0 0 120 110" class="fdeco-art">${this.art.deco({ x: 0, y: 0, w: 120, h: 110 }, id, true)}</svg><small>${esc(DECOS[id].name)}</small></button>`).join('')}</div>`
          : `<p class="fnote">收納是空的，到「商店」買裝飾。</p>`}</div>`;
    }
    if (pn.k === 'feed') {
      const list = feedChoices(p);
      return head('餵寵物', 'apple', 'orange') + `<div class="fpb">${list.length ? `<div class="flist">${list.map((c) => `
        <button type="button" class="frow" data-act="feedPet" data-item="${c.item}">${ic(c.item, 'fic mid')}<span class="fname">${esc(c.name)}${c.snack ? '（點心）' : ''}<small>倉庫有 ${c.n} 個</small></span><span class="fcost">餵</span></button>`).join('')}</div>`
        : '<p class="fnote">倉庫裡沒有能吃的東西（小麥、蛋、毛線球不能吃）。</p>'}
        <p class="fnote">給自己目前的寵物吃，不花金幣；睡覺、吃太飽的時候不能餵。</p></div>`;
    }
    return '';
  }
  private openPanel(pn: Panel) {
    this.panel = pn; this.renderPanel();
    if (pn?.k === 'friends' && !pn.list) void api<any>('GET', '/farm/friends').then((r) => { if (this.panel?.k === 'friends') { this.panel = { k: 'friends', list: r.farms }; this.renderPanel(); } }).catch((e) => this.toast(this.err(e)));
  }

  // ---------- 操作 ----------
  private onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const b = t.closest('[data-act]') as HTMLElement | null;
    if (b) { if ((b as HTMLButtonElement).disabled) return; return void this.onAct(b); }
    const h = t.closest('[data-hit]') as HTMLElement | null;
    if (h) this.onHit(h.dataset.hit!);
  };
  private onAct(b: HTMLElement) {
    const a = b.dataset.act!, pn = this.panel;
    if (a === 'theme') {
      this.theme = this.theme === 'realistic' ? 'classic' : 'realistic';
      try { localStorage.setItem(themeKey(this.me.id), this.theme); } catch { /* 私密模式仍可在當次切換 */ }
      this.render();
      return this.root.querySelector<HTMLButtonElement>('.farm-theme')?.focus();
    }
    if (a === 'close') return this.close();
    if (a === 'panelClose') return this.openPanel(null);
    if (a === 'shop' || a === 'store' || a === 'orders') return this.openPanel({ k: a });
    if (a === 'friends') return this.openPanel({ k: 'friends' });
    if (a === 'visit') { this.close(); return void this.open(b.dataset.user!); }
    if (a === 'collectAll') return void this.doAct({ type: 'collectAll' });
    if (a === 'plant' && pn?.k === 'plant') { const crop = b.dataset.crop as CropId; this.panel = null; return void this.doAct({ type: 'plant', idx: pn.idx, crop }); }
    if (a === 'feed' && pn?.k === 'animal') return void this.doAct({ type: 'feed', station: pn.st, i: +b.dataset.i! });
    if (a === 'collect' && pn?.k === 'animal') return void this.doAct({ type: 'collect', station: pn.st, i: +b.dataset.i! });
    if (a === 'craft') return void this.doAct({ type: 'craft', recipe: b.dataset.recipe as RecipeId });
    if (a === 'collectJobs' && pn?.k === 'craft') return void this.doAct({ type: 'collectJobs', station: pn.st });
    if (a === 'upgradeQueue' && pn?.k === 'craft') return void this.doAct({ type: 'upgradeQueue', station: pn.st }, '加工佇列多一格了');
    if (a === 'rescue') { this.panel = null; return void this.doAct({ type: 'rescue' }, '果樹救回來了！'); }
    if (a === 'deliver') return void this.doAct({ type: 'deliver', slot: +b.dataset.slot! }, '交貨完成！');
    if (a === 'discard') return void this.doAct({ type: 'discard', slot: +b.dataset.slot! });
    if (a === 'sell') return void this.doAct({ type: 'sell', item: b.dataset.item as FarmItemId, qty: +b.dataset.qty! });
    if (a === 'upgradeBarn') return void this.doAct({ type: 'upgradeBarn' }, '倉庫變大了！');
    if (a === 'barnBonus') return void this.doAct({ type: 'barnBonus' }, `倉庫 +${FARM.barn.bonusSlots} 格`);
    // 第二階段
    if (a === 'feedPanel') return this.openPanel({ k: 'feed' });
    if (a === 'feedPet') return void this.doFeedPet(b.dataset.item as FarmItemId);
    if (a === 'chickWater' && pn?.k === 'grow') return void this.doAct({ type: 'chickWater', idx: pn.idx }, '小雞幫忙澆水了！');
    if (a === 'expand' && pn?.k === 'expand') { this.panel = null; return void this.doAct({ type: 'expand' }, '買到一塊新田了！'); }
    if (a === 'fillCrate') return void this.doAct({ type: 'fillCrate', i: +b.dataset.i! });
    if (a === 'sendBalloon') { this.panel = null; return void this.doAct({ type: 'sendBalloon' }, '熱氣球出發了！'); }
    if (a === 'buy') return void this.doBuy(+b.dataset.slot!);
    if (a === 'stallCancel') return void this.doAct({ type: 'stallCancel', slot: +b.dataset.slot! }, '下架了，東西放回倉庫');
    if (a === 'stallNew') return this.openPanel({ k: 'stallNew', slot: +b.dataset.slot! });
    if (a === 'stallPick' && pn?.k === 'stallNew') return this.openPanel({ ...pn, item: b.dataset.item as FarmItemId });
    if (a === 'stallList' && pn?.k === 'stallNew' && pn.item) {
      const v = (f: string) => Math.floor(Number((this.root.querySelector(`.farm-panel [data-f="${f}"]`) as HTMLInputElement | null)?.value));
      const slot = pn.slot, item = pn.item, qty = v('qty'), unit = v('unit');
      const d = stallDefaults(item, this.data?.state.inv[item] ?? 0);
      if (!(qty >= 1 && qty <= d.maxQty)) return this.toast(`數量要在 1–${d.maxQty} 之間`);
      if (!(unit >= d.unitMin && unit <= d.unitMax)) return this.toast(`每個價格要在 ◎${d.unitMin}–${d.unitMax} 之間`);
      this.panel = { k: 'stall' };
      return void this.doAct({ type: 'stallList', slot, item, qty, price: unit * qty }, '上架了！');
    }
    if (a === 'buyDeco') return void this.doAct({ type: 'buyDeco', deco: b.dataset.deco as DecoId }, `買了${DECOS[b.dataset.deco as DecoId].name}，到東邊新地點空的裝飾格擺上去`);
    if (a === 'placeDeco' && pn?.k === 'deco') { this.panel = null; return void this.doAct({ type: 'placeDeco', deco: b.dataset.deco as DecoId, slot: pn.slot }); }
    if (a === 'storeDeco' && pn?.k === 'deco') { this.panel = null; return void this.doAct({ type: 'storeDeco', slot: pn.slot }); }
  }
  private onHit(key: string) {
    const p = this.data; if (!p) return;
    const [kind, arg] = key.split(':');
    const d = p.derived;
    if (kind === 'goEast') { if (d.east.locked) return this.toast(`Lv ${FARM.eastLevel} 開放東邊新地`); this.area = 'east'; this.panel = null; return this.render(); }
    if (kind === 'goMain') { this.area = 'main'; this.panel = null; return this.render(); }
    if (kind === 'stall') { if (p.state.level < FARM.stall.level) return this.toast(`Lv ${FARM.stall.level} 開放小攤`); return this.openPanel({ k: 'stall' }); }
    if (!p.is_owner) {
      const helps = helpTargets(p);
      if (kind === 'field') { const idx = +arg; if (helps.some((h) => h.kind === 'water' && h.idx === idx)) return void this.doHelp({ kind: 'water', idx }); return this.toast(d.fields[idx]?.locked ? '這塊田還沒開' : '這塊田不用幫忙'); }
      if (kind === 'tree' && helps.some((h) => h.kind === 'rescue')) return void this.doHelp({ kind: 'rescue' });
      return this.toast('這裡不用幫忙，找「澆水」「救樹」的標籤');
    }
    if (kind === 'field') {
      const idx = +arg, f = d.fields[idx];
      if (f.locked) return idx >= FARM.baseFields ? this.openPanel({ k: 'expand', idx }) : this.toast(`這塊田 Lv ${f.unlockLevel} 解鎖`);
      if (f.stage === null) return this.openPanel({ k: 'plant', idx });
      if (this.remain(f.remainMs) === 0) return void this.doAct({ type: 'harvest', idx });
      return this.openPanel({ k: 'grow', idx });
    }
    if (kind === 'balloon') return this.openPanel({ k: 'balloon' });
    if (kind === 'deco') return this.openPanel({ k: 'deco', slot: +arg });
    if (kind === 'animal') { const st = arg as AnimalStation; if (d.animals[st].locked) return this.toast(`Lv ${ANIMALS[st].level} 解鎖${ANIMALS[st].name}`); return this.openPanel({ k: 'animal', st }); }
    if (kind === 'craft') { const st = arg as CraftStation; if (d.jobs[st].locked) return this.toast(`Lv ${CRAFT_STATIONS[st].level} 解鎖${CRAFT_STATIONS[st].name}`); return this.openPanel({ k: 'craft', st }); }
    if (kind === 'tree') {
      if (d.tree.state === 'ready') return void this.doAct({ type: 'tree' });
      if (d.tree.state === 'withered') return this.openPanel({ k: 'tree' });
      return this.toast(`蘋果還要 ${remainText(this.remain(d.tree.remainMs))}`);
    }
    if (kind === 'board') return this.openPanel({ k: 'orders' });
    if (kind === 'barn') return this.openPanel({ k: 'store' });
  }
  private onKey = (e: KeyboardEvent) => {
    if (this.root.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); if (this.panel) this.openPanel(null); else this.close(); }
    else if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement)?.closest?.('.farm [data-hit]')) { e.preventDefault(); this.onHit(((e.target as HTMLElement).closest('[data-hit]') as HTMLElement).dataset.hit!); }
    else if (!(e.target as HTMLElement)?.closest?.('.farm')) { /* 焦點不在農場：吃掉按鍵，避免蛋殼頁跟著動 */ }
    else return;
    e.stopImmediatePropagation();
  };
}
