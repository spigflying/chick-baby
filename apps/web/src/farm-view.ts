// 小雞農場全頁畫面（蓋在蛋殼頁上，掛法同 fight-view.ts）。只限電腦；規則與數值都在伺服器（@chick/engine farm.ts）。
import { ANIMALS, CRAFT_STATIONS, CROPS, DECOS, FARM, FARM_ITEMS, RECIPES, type AnimalStation, type CraftStation, type CropId, type DecoId, type FarmAction, type FarmItemId, type RecipeId, type VisitCollectAction } from '@chick/engine';
import { act, api, ApiError, errText } from './api';
import { art } from './art';
import type { Live } from './ws';
import { EAST, LAYOUT, SCENE, STORYBOOK_LAYOUT, type Box } from './farm-layout';
import * as realisticArt from './farm-art';
import * as classicArt from './farm-art-classic';
import * as storybookArt from './farm-art-storybook';
import { expandOffer, FARM_ERR, feedChoices, fieldBadge, helpTargets, hudModel, loadErrorAction, panelValid, plantChoices, remainText, stallDefaults, visitHeartAvailable, type FarmPayload } from './farm-model';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ic = (id: string, cls = 'fic') => `<svg class="${cls}" aria-hidden="true"><use href="#fi-${id}"/></svg>`;
/** 小雞的顏色：依農場主人目前寵物的物種。 */
const LOOK: Record<string, { body: string; belly: string }> = {
  chicken: { body: '#ffd84d', belly: '#fff6c4' }, duck: { body: '#fff4d6', belly: '#ffffff' },
  penguin: { body: '#9ad7ff', belly: '#ffffff' }, dino: { body: '#9be37a', belly: '#e9ffd9' },
};
const ANIMAL_ART = {
  hutch: { animal: 'rabbit', feedDir: 'hutch', outDir: 'hutch' },
  coop: { animal: 'hen', feedDir: 'bakery', outDir: 'bakery' },
  beehive: { animal: 'bee', feedDir: 'jamhouse', outDir: 'bakery' },
  cowshed: { animal: 'cow', feedDir: 'bakery', outDir: 'dairy' },
} as const;
const CROP_ART: Record<CropId, string> = {
  wheat: 'bakery/wheat', carrot: 'hutch/carrot', strawberry: 'jamhouse/strawberry', pumpkin: 'crops/pumpkin',
};
type Panel = null | { k: 'plant'; idx: number } | { k: 'animal'; st: AnimalStation } | { k: 'craft'; st: CraftStation } | { k: 'tree' } | { k: 'orders' } | { k: 'store' } | { k: 'shop' } | { k: 'friends'; list?: any[] }
  // 第二階段
  | { k: 'grow'; idx: number } | { k: 'expand'; idx: number } | { k: 'balloon' } | { k: 'stall' } | { k: 'stallNew'; slot: number; item?: FarmItemId } | { k: 'deco'; slot: number } | { k: 'feed' };
/** 主畫面的田是 0–11，東邊新地的田是 12–17。 */
const fieldIdxs = (area: 'main' | 'east') => (area === 'main' ? [...LAYOUT.fields.keys()] : EAST.fields.map((_, i) => FARM.baseFields + i));
type FarmTheme = 'storybook' | 'realistic' | 'classic';
const THEMES: FarmTheme[] = ['storybook', 'realistic', 'classic'];
const THEME_LABEL: Record<FarmTheme, string> = { storybook: '仙境手繪', realistic: '寫實 3D', classic: '原版插畫' };
const themeKey = (userId: string) => `chick-farm-theme-${userId}`;
function savedTheme(userId: string): FarmTheme {
  try { const saved = localStorage.getItem(themeKey(userId)); return THEMES.find((t) => t === saved) ?? 'storybook'; }
  catch { return 'storybook'; }
}

let symbolsInjected = false;

export class FarmView {
  private root: HTMLElement;
  private data: FarmPayload | null = null;
  private ownerId: string | null = null;
  private species: string | null = null;
  /** 打開自己農場時的寵物種類；從別人家按「回家」回自己農場時沿用 */
  private mySpecies: string | null = null;
  /** 自己今天拜訪好友拿友情點數的紀錄（好友清單標「+1♥」用） */
  private myVisit: FarmPayload['state']['visitHearts'] | null = null;
  private loadedAt = 0;
  private timer = 0;
  private panel: Panel = null;
  private selectedCraftRecipe: Record<CraftStation, RecipeId> = { bakery: 'bread', jamhouse: 'jam', dairy: 'cheese' };
  private busy = false;
  /** 背景重讀失敗後暫停（避免每秒一直重試），下一次成功的操作或重新打開時恢復 */
  private paused = false;
  /** 主畫面或東邊新地 */
  private area: 'main' | 'east' = 'main';
  private theme: FarmTheme = 'storybook';
  private get art() { return this.theme === 'classic' ? classicArt : this.theme === 'storybook' ? storybookArt : realisticArt; }
  private get mainLayout() { return this.theme === 'storybook' ? STORYBOOK_LAYOUT : LAYOUT; }

  constructor(private live: Live, private me: { id: string; display_name: string }, private toast: (s: string) => void, private setWallet: (n: number) => void, private wallet: () => number) {
    this.theme = savedTheme(this.me.id);
    if (!symbolsInjected) { document.body.insertAdjacentHTML('beforeend', classicArt.iconSymbols() + storybookArt.bakeryIcons()); symbolsInjected = true; }
    this.root = document.createElement('div'); this.root.className = 'farm'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', '小雞農場');
    document.body.append(this.root);
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey, true);
  }

  async open(ownerId: string, species?: string | null) {
    if (this.live.touch) return this.toast('農場只能用電腦玩');
    if (ownerId === this.me.id && species) this.mySpecies = species;
    this.ownerId = ownerId; this.species = species ?? (ownerId === this.me.id ? this.mySpecies : null); this.panel = null; this.paused = false; this.area = 'main';
    try { await this.load(); } catch (e) { this.ownerId = null; return this.toast(this.err(e)); }
    this.root.hidden = false; requestAnimationFrame(() => this.root.classList.add('on'));
    if (ownerId !== this.me.id) void this.visitHeart(ownerId);
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
    this.data = p; this.loadedAt = Date.now();
    if (p.is_owner) this.myVisit = p.state.visitHearts;
    this.render();
  }
  /** 打開好友農場：每天第一次拜訪這位送友情點數（伺服器判斷；拿過或到上限就安靜略過）。 */
  private async visitHeart(ownerId: string) {
    try {
      const r = await act<{ gained: number; friend_pts: number; today: { used: number; cap: number }; visit_hearts: FarmPayload['state']['visitHearts'] }>('POST', `/farm/${ownerId}/visit`);
      this.myVisit = r.visit_hearts;
      if (r.gained > 0 && this.ownerId === ownerId) this.toast(`來拜訪好友，友情點數 +${r.gained}（今天 ${r.today.used}/${r.today.cap}）`);
    } catch { /* 拿不到愛心不影響拜訪 */ }
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
  private async doVisitCollect(action: VisitCollectAction) {
    if (this.busy || !this.ownerId) return; this.busy = true;
    try {
      const r = await act<{ item: FarmItemId; qty: number; leveled: number[]; balance?: number }>('POST', `/farm/${this.ownerId}/collect`, { action });
      this.toast(`採到 ${FARM_ITEMS[r.item].name} ×${r.qty}，放進你的倉庫了`);
      if (typeof r.balance === 'number') this.setWallet(r.balance);
      for (const lv of r.leveled) this.toast(`升到 Lv ${lv} 了！`);
      this.paused = false; await this.load();
    } catch (e) { this.toast(this.err(e)); } finally { this.busy = false; }
  }
  private showHelpLog() {
    const p = this.data; if (!p?.is_owner || !p.state.helpLog.length) return;
    const log = p.state.helpLog, shown = log.slice(-3);
    for (const h of shown) this.toast(`${h.name} ${h.kind === 'water' ? '幫你澆了水' : h.kind === 'rescue' ? '救了你的果樹' : `採走${h.item ? FARM_ITEMS[h.item].name : '資源'} ×${h.qty}`}`);
    if (log.length > 3) this.toast(`還有 ${log.length - 3} 次農場訪客動作`);
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
  private guide() {
    const p = this.data!, d = p.derived;
    const fields = fieldIdxs(this.area);
    const ready = fields.filter((i) => d.fields[i].stage === 3).length;
    let message = ready ? `${ready} 格田可以收成` : '點田地開始種作物';
    let target = ready ? `field:${fields.find((i) => d.fields[i].stage === 3)}` : '';
    let buttonText = ready ? '收成' : '查看';
    if (p.is_owner && this.area === 'main') {
      const water = fields.find((i) => p.state.fields[i].crop && !p.state.fields[i].chick && d.fields[i].stage !== 3);
      if (water !== undefined && d.chickWater.left > 0) { message = `還能幫田 ${water + 1} 澆水・今日剩 ${d.chickWater.left} 次`; target = `field:${water}`; buttonText = '去澆水'; }
    } else if (p.is_owner && this.area === 'east' && d.balloon.state !== 'locked') {
      const balloon = d.balloon;
      message = balloon.state === 'here' ? `熱氣球貨箱 ${balloon.crates.filter((c) => c.filled).length}/${balloon.crates.length}` : this.remain(balloon.remainMs) ? `熱氣球 ${remainText(this.remain(balloon.remainMs))} 後回來` : '熱氣球即將回來';
      target = 'balloon';
      buttonText = '查看';
    } else if (!p.is_owner && !ready) {
      const help = helpTargets(p).find((h) => h.kind === 'water' && fields.includes(h.idx));
      message = help?.kind === 'water' ? `田 ${help.idx + 1} 需要幫忙澆水` : '看看有沒有成熟資源可以採收';
      target = help?.kind === 'water' ? `field:${help.idx}` : '';
      buttonText = help ? '幫忙澆水' : '查看';
    }
    const look = LOOK[this.species ?? 'chicken'] ?? LOOK.chicken;
    return `<div class="farm-guide"><svg class="farm-guide-pet" viewBox="0 0 100 100" aria-hidden="true">${this.art.chick(50, 50, look)}</svg>
      <div class="farm-guide-copy"><small>${this.area === 'east' ? '東邊新地' : '農場小幫手'}</small><b>${esc(message)}</b></div>
      ${target ? `<button type="button" data-act="guide" data-target="${target}" aria-label="${esc(message)}">${buttonText} ›</button>` : ''}</div>`;
  }
  private render() {
    const p = this.data; if (!p) return;
    this.root.classList.toggle('classic', this.theme === 'classic');
    this.root.classList.toggle('storybook', this.theme === 'storybook');
    this.root.classList.toggle('east-area', this.area === 'east');
    const owner = p.is_owner;
    const hud = hudModel(p, this.wallet());
    this.root.innerHTML = `
      <div class="farm-top"><b class="farm-title">${owner ? '我的農場' : `${esc(p.owner.display_name)} 的農場`}</b><span class="farm-place">${this.area === 'east' ? '東邊新地' : '陽光農場'}</span>
        <div class="farm-hud">
          <div class="fpill"><span class="flv">${hud.level}</span><span class="fxp"><i style="width:${hud.xpPct}%"></i></span><span>Lv${hud.level}</span></div>
          ${owner ? `<div class="fpill">${ic('coin')}${hud.coins.toLocaleString()}</div><div class="fpill" title="倉庫">${ic('box')}${hud.barn}</div><div class="fpill" title="友情點數">${ic('heart')}${hud.friendPts}</div>` : `<div class="fpill visit" title="成熟資源可以採收・成長中的田可澆水・枯樹可救">成熟資源可以採收・成長中的田可澆水・枯樹可救</div>`}
        </div>
        <button type="button" class="farm-theme" data-act="theme" aria-label="切換農場畫風，目前為${THEME_LABEL[this.theme]}">畫風：${THEME_LABEL[this.theme]}</button>
        <button type="button" class="farm-x" data-act="close" aria-label="關閉農場（Esc）">✕</button></div>
      <div class="farm-stage">
        <svg class="scene" viewBox="0 0 ${SCENE.w} ${SCENE.h}" role="img" aria-label="農場畫面">${this.art.sceneDefs()}${this.scene()}<g class="pills">${this.pills()}</g></svg>
        <div class="farm-panel" hidden></div>
      </div>
      <div class="farm-footer">${this.guide()}<div class="farm-tools">${owner ? `
        <button type="button" class="ftool" data-act="shop">${ic('shop', 'fic big')}商店</button>
        <button type="button" class="ftool" data-act="store">${ic('box', 'fic big')}倉庫</button>
        <button type="button" class="ftool" data-act="orders">${ic('board', 'fic big')}訂單${this.deliverable() ? `<span class="fbadge">${this.deliverable()}</span>` : ''}</button>
        <button type="button" class="ftool" data-act="collectAll">${ic('wheat', 'fic big')}全部收成</button>
        <button type="button" class="ftool" data-act="feedPanel">${ic('apple', 'fic big')}餵寵物</button>` : ''}
        <button type="button" class="ftool" data-act="friends">${ic('friend', 'fic big')}好友</button>
        <button type="button" class="ftool" data-act="${owner ? 'close' : 'goHome'}" title="${owner ? '回到小雞畫面' : '回到我的農場'}">${ic('home', 'fic big')}回家</button>
      </div></div>`;
    this.renderPanel();
  }
  private deliverable() { return this.data?.derived.orders.filter((o) => 'order' in o && o.canDeliver).length ?? 0; }
  private scene() {
    const p = this.data!, s = p.state, d = p.derived;
    const hit = (key: string, inner: string, label: string) => `<g class="hit" data-hit="${key}" tabindex="0" role="button" aria-label="${esc(label)}">${inner}</g>`;
    if (this.area === 'east') return this.eastScene(hit);
    const layout = this.mainLayout;
    let o = this.art.background();
    layout.fields.forEach((b, i) => { const f = s.fields[i], fd = d.fields[i]; o += hit(`field:${i}`, this.art.field(b, f.crop, fd.stage, fd.locked, fd.unlockLevel), `田 ${i + 1}`); });
    const an = (st: AnimalStation) => d.animals[st].items.map((x) => x.state === 'ready');
    o += hit('animal:hutch', this.art.hutch(layout.hutch, an('hutch'), d.animals.hutch.locked, ANIMALS.hutch.level), '兔兔窩');
    o += hit('animal:coop', this.art.coop(layout.coop, an('coop'), d.animals.coop.locked, ANIMALS.coop.level), '雞舍');
    o += hit('craft:bakery', this.art.bakery(layout.bakery, d.jobs.bakery.items.length > 0, d.jobs.bakery.locked, CRAFT_STATIONS.bakery.level), '烘焙屋');
    o += hit('craft:jamhouse', this.art.jamhouse(layout.jamhouse, d.jobs.jamhouse.items.length > 0, d.jobs.jamhouse.locked, CRAFT_STATIONS.jamhouse.level), '果醬工坊');
    o += hit('tree', this.art.tree(layout.tree, d.tree.state), '蘋果樹');
    o += hit('board', this.art.board(layout.board, p.is_owner && this.deliverable() > 0), '訂單看板');
    o += hit('barn', this.art.barn(layout.barn), '倉庫');
    o += hit('goEast', this.art.sign(layout.eastSign, d.east.locked ? `Lv${FARM.eastLevel} 開放` : '東邊新地', d.east.locked), '去東邊新地');
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
    return o;
  }
  /** 田、建築上方的標籤（每秒更新）。 */
  private pills() {
    const p = this.data!, d = p.derived; let o = '';
    const helps = new Set(helpTargets(p).map((h) => (h.kind === 'water' ? `w${h.idx}` : 'tree')));
    for (const i of fieldIdxs(this.area)) {
      const b = this.area === 'main' ? this.mainLayout.fields[i] : EAST.fields[i - FARM.baseFields], fd = d.fields[i];
      if (fd.locked) { if (p.is_owner && this.area === 'east' && expandOffer(p, i).kind === 'buy') o += this.art.pill(b.x + b.w / 2, b.y - (this.theme === 'classic' ? 18 : 42), '可以買', 'ready'); continue; }
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
      station(this.mainLayout[st], ready ? `${FARM_ITEMS[ANIMALS[st].out.item].name}好了` : hungry ? '肚子餓了' : grow.length ? remainText(Math.min(...grow)) : null, ready ? 'ready' : 'timer');
    }
    for (const st of ['bakery', 'jamhouse'] as const) {
      const j = d.jobs[st]; if (j.locked || !j.items.length) continue;
      const done = j.items.filter((x) => this.remain(x.remainMs) === 0).length;
      station(this.mainLayout[st], done ? `${done} 個做好了` : remainText(this.remain(j.items[0].remainMs)), done ? 'ready' : 'timer');
    }
    if (helps.has('tree')) station(this.mainLayout.tree, '救樹', 'alert');
    else if (d.tree.state === 'ready') station(this.mainLayout.tree, '可收成', 'ready');
    else if (d.tree.state === 'withered') station(this.mainLayout.tree, '枯掉了', 'timer');
    else station(this.mainLayout.tree, remainText(this.remain(d.tree.remainMs)), 'timer');
    return o;
  }
  private eastPills(station: (b: { x: number; y: number; w: number }, txt: string | null, tone: 'ready' | 'timer' | 'alert') => void): void {
    const p = this.data!, d = p.derived, s = p.state;
    for (const st of ['beehive', 'cowshed'] as const) {
      const a = d.animals[st]; if (a.locked) continue;
      const ready = a.items.filter((x) => x.state === 'ready').length, hungry = a.items.filter((x) => x.state === 'hungry').length;
      const grow = a.items.filter((x) => x.state === 'growing').map((x) => this.remain(x.remainMs));
      station(EAST[st], ready ? `${FARM_ITEMS[ANIMALS[st].out.item].name}好了` : p.is_owner && hungry ? '肚子餓了' : grow.length ? remainText(Math.min(...grow)) : null, ready ? 'ready' : 'timer');
    }
    const j = d.jobs.dairy;
    if (!j.locked && j.items.length) { const done = j.items.filter((x) => this.remain(x.remainMs) === 0).length; station(EAST.dairy, done ? `${done} 個做好了` : remainText(this.remain(j.items[0].remainMs)), done ? 'ready' : 'timer'); }
    if (p.is_owner) {
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
    el.classList.toggle('bakery-panel', pn?.k === 'craft' && this.theme === 'storybook');
    el.classList.toggle('animal-card-panel', pn?.k === 'animal' && pn.st in ANIMAL_ART && this.theme === 'storybook');
    el.classList.toggle('tree-panel', pn?.k === 'tree' && this.theme === 'storybook');
    el.classList.toggle('plant-panel', pn?.k === 'plant' && this.theme === 'storybook');
    if (!pn || !p) { el.hidden = true; el.innerHTML = ''; return; }
    const head = (title: string, icon: string, tone: string) => `<header class="fph ${tone}">${ic(icon, 'fic hic')}<b>${title}</b><button type="button" class="fpx" data-act="panelClose" aria-label="關閉">✕</button></header>`;
    let html = '';
    const s = p.state, d = p.derived;
    if (pn.k === 'animal' && pn.st in ANIMAL_ART && this.theme === 'storybook') {
      const station = pn.st as keyof typeof ANIMAL_ART, def = ANIMALS[station], a = d.animals[station], feed = def.feed[0], have = s.inv[feed.item] ?? 0;
      const assets = ANIMAL_ART[station], animalImage = assets.animal;
      const productName = station === 'coop' ? '雞蛋' : FARM_ITEMS[def.out.item].name;
      const picture = (name: string, cls = 'cp-icon') => {
        const dir = name === animalImage ? station : name === feed.item ? assets.feedDir : assets.outDir;
        return `<img class="${cls}" src="${art(`farm/${dir}/${name}.webp`)}" alt="">`;
      };
      html = `<header class="fph bakery-head">${picture(animalImage, 'fic hic')}<b>${def.name}</b><button type="button" class="fpx" data-act="panelClose" aria-label="關閉">✕</button></header><div class="fpb cp-body" data-live>${a.locked ? `<p class="fnote">Lv ${def.level} 解鎖</p>` : `
        <p class="cp-note">${p.is_owner ? `每隻${def.animal}餵${FARM_ITEMS[feed.item].name} ×${feed.qty}，${def.ms / 60000} 分鐘後產出${productName} ×${def.out.qty}。` : `看看${def.animal}有沒有產出${productName}。`}</p><div class="cp-cards">${a.items.map((x, i) => {
          const ready = x.state === 'ready' || (x.state === 'growing' && this.remain(x.remainMs) === 0);
          return `<section class="cp-card"><div class="cp-animal">${picture(animalImage)}<span><b>${def.animal} ${i + 1}</b><small>${ready ? `${productName}好了` : x.state === 'growing' ? `正在產出${productName}` : '等待餵食'}</small></span></div>
            ${ready ? `<div class="cp-product">${picture(def.out.item)}<span><b>${productName} ×${def.out.qty}</b><small>已完成，可以採收</small></span></div><button type="button" class="fbtn go cp-action" data-act="${p.is_owner ? 'collect' : 'visitAnimal'}" data-i="${i}">收取${productName}</button>`
              : x.state === 'growing' ? `<div class="cp-product growing">${picture(def.out.item)}<span><b>${station === 'coop' ? '產蛋中' : `${productName}產出中`}</b><small>還要 ${remainText(this.remain(x.remainMs))}</small></span></div>`
              : p.is_owner ? `<div class="cp-feed${have < feed.qty ? ' short' : ''}">${picture(feed.item)}<span><b>${FARM_ITEMS[feed.item].name}</b><small>需要 / 現有</small></span><strong>${feed.qty} / ${have}</strong></div><button type="button" class="fbtn go cp-action" data-act="feed" data-i="${i}" ${have < feed.qty ? 'disabled' : ''}>餵食${def.animal}</button>`
                : '<p class="cp-wait">還沒有產物</p>'}</section>`;
        }).join('')}</div>`}</div>`;
    } else if (!p.is_owner && pn.k === 'animal') {
      const def = ANIMALS[pn.st], a = d.animals[pn.st];
      html = head(def.name, def.out.item, 'pink') + `<div class="fpb"><div class="flist">${a.items.map((x, i) => `<div class="frow static">${ic(def.out.item, 'fic mid')}<span class="fname">${def.animal} ${i + 1}<small>${x.state === 'ready' ? `${FARM_ITEMS[def.out.item].name}好了！` : x.state === 'growing' ? `還要 ${remainText(this.remain(x.remainMs))}` : '還沒有產物'}</small></span>${x.state === 'ready' ? `<button type="button" class="fbtn go" data-act="visitAnimal" data-i="${i}">採收</button>` : ''}</div>`).join('')}</div></div>`;
    } else if (!p.is_owner && pn.k === 'craft') {
      const j = d.jobs[pn.st];
      html = head(CRAFT_STATIONS[pn.st].name, 'oven', 'pink') + `<div class="fpb"><p class="fnote">${j.items.length ? j.items.map((x) => `${RECIPES[x.recipe].name}：${this.remain(x.remainMs) ? remainText(this.remain(x.remainMs)) : '做好了'}`).join('、') : '沒有成品'}</p>${j.items.length && this.remain(j.items[0].remainMs) === 0 ? '<button type="button" class="fbtn go wide" data-act="visitJob">收一份成品</button>' : ''}</div>`;
    } else if (pn.k === 'plant') {
      html = head(`種什麼？（田 ${pn.idx + 1}）`, 'wheat', 'mint') + `<div class="fpb"><div class="flist">${plantChoices(p, this.wallet()).map((c) => `
        <button type="button" class="frow" data-act="plant" data-crop="${c.crop}" ${c.enabled ? '' : 'disabled'}>${this.theme === 'storybook' ? `<img class="fic mid" src="${art(`farm/${CROP_ART[c.crop]}.webp`)}" alt="">` : ic(CROPS[c.crop].out.item, 'fic mid')}
          <span class="fname">${esc(c.name)}<small>${remainText(CROPS[c.crop].growMs)}・收 ${CROPS[c.crop].out.qty} 個</small></span>
          <span class="fcost">${c.reason ? esc(c.reason) : esc(c.cost)}</span></button>`).join('')}</div></div>`;
    } else if (pn.k === 'animal') {
      const def = ANIMALS[pn.st], a = d.animals[pn.st];
      html = head(def.name, def.out.item, 'pink') + `<div class="fpb" data-live>${a.locked ? `<p class="fnote">Lv ${def.level} 解鎖</p>` : a.items.map((x, i) => `
        <div class="frow static">${ic(def.out.item, 'fic mid')}<span class="fname">${def.animal} ${i + 1}<small>${x.state === 'hungry' ? `要吃 ${def.feed.map((f) => `${FARM_ITEMS[f.item].name} ×${f.qty}`).join('、')}` : x.state === 'ready' ? `${FARM_ITEMS[def.out.item].name}好了！` : `還要 ${remainText(this.remain(x.remainMs))}`}</small></span>
          ${x.state === 'hungry' ? `<button type="button" class="fbtn go" data-act="feed" data-i="${i}">餵</button>` : x.state === 'ready' ? `<button type="button" class="fbtn go" data-act="collect" data-i="${i}">收</button>` : ''}</div>`).join('')}
        <p class="fnote">你有 ${def.feed.map((f) => `${FARM_ITEMS[f.item].name} ${s.inv[f.item] ?? 0}`).join('、')}</p></div>`;
    } else if (pn.k === 'craft' && this.theme === 'storybook') {
      const station = pn.st, meta = CRAFT_STATIONS[station], j = d.jobs[station], slots = s.queueSlots[station];
      const ids = (Object.keys(RECIPES) as RecipeId[]).filter((id) => RECIPES[id].station === station);
      const selectedId = this.selectedCraftRecipe[station], selected = RECIPES[selectedId], ready = (ms: number) => this.remain(ms) === 0;
      const picture = (item: FarmItemId, cls = 'bk-icon') => `<img class="${cls}" src="${art(`farm/${station}/${item}.webp`)}" alt="">`;
      const hasMaterials = selected.in.every((x) => (s.inv[x.item] ?? 0) >= x.qty);
      const canCraft = s.level >= selected.level && hasMaterials && j.items.length < slots;
      html = `<header class="fph bakery-head">${station === 'bakery' ? ic('ro-oven', 'fic hic') : picture(selected.out.item, 'fic hic')}<b>${meta.name}</b><button type="button" class="fpx" data-act="panelClose" aria-label="關閉">✕</button></header><div class="fpb bk-body" data-live>${j.locked ? `<p class="fnote">Lv ${meta.level} 解鎖</p>` : `
        <div class="bk-layout"><section class="bk-products"><h4>選擇產品</h4>${ids.map((id) => { const r = RECIPES[id], unlocked = s.level >= r.level, enough = r.in.every((x) => (s.inv[x.item] ?? 0) >= x.qty);
          return `<button type="button" class="bk-product${id === selectedId ? ' active' : ''}" data-act="selectCraftRecipe" data-recipe="${id}" aria-pressed="${id === selectedId}">${picture(r.out.item)}<span><b>${r.name}</b><small>${remainText(r.ms)}</small><em class="${unlocked && enough ? 'ok' : 'short'}">${unlocked ? enough ? '材料充足' : '缺少原料' : `Lv ${r.level} 解鎖`}</em></span></button>`; }).join('')}</section>
        <section class="bk-details"><div class="bk-selection">${picture(selected.out.item)}<span><small>目前選擇</small><b>${selected.name}</b><small>生產時間 ${remainText(selected.ms)}</small></span></div><h4>需要的原料 <small>需要 / 現有</small></h4><div class="bk-ingredients">${selected.in.map((x) => `<div class="bk-ingredient${(s.inv[x.item] ?? 0) < x.qty ? ' short' : ''}">${picture(x.item)}<b>${FARM_ITEMS[x.item].name}</b><strong>${x.qty} / ${s.inv[x.item] ?? 0}</strong></div>`).join('')}</div><button type="button" class="fbtn go bk-reserve" data-act="craft" data-recipe="${selectedId}" ${canCraft ? '' : 'disabled'}>＋ 預約生產</button><p class="bk-hint">${s.level < selected.level ? `Lv ${selected.level} 解鎖` : !hasMaterials ? '原料不足，補足後才能預約' : j.items.length >= slots ? '佇列已滿，請先收取完成品' : '預約後扣除材料，依序加入佇列'}</p></section>
        <section class="bk-queue"><h4>生產佇列 <small>${j.items.length} / ${slots} 格</small></h4><div class="bk-slots">${Array.from({ length: FARM.queue.max }, (_, i) => { const it = j.items[i]; if (i >= slots) return '<div class="bk-slot locked">未解鎖</div>'; if (!it) return '<div class="bk-slot empty">＋<small>空位</small></div>'; const item = RECIPES[it.recipe].out.item, done = ready(it.remainMs); return done ? `<button type="button" class="bk-slot done" data-act="collectJob" data-i="${i}" aria-label="收取${FARM_ITEMS[item].name}">${picture(item)}<b>${FARM_ITEMS[item].name}</b><small>完成・點擊收取</small></button>` : `<div class="bk-slot">${picture(item)}<b>${FARM_ITEMS[item].name}</b><small>${remainText(this.remain(it.remainMs))}</small></div>`; }).join('')}</div><button type="button" class="fbtn go bk-collect" data-act="collectJobs" ${j.items.some((x) => ready(x.remainMs)) ? '' : 'disabled'}>全收完成品</button><button type="button" class="fbtn up bk-upgrade" data-act="upgradeQueue" ${slots >= FARM.queue.max ? 'disabled' : ''}>${slots >= FARM.queue.max ? '佇列已滿級' : `加一格 ◎${FARM.queue.costs[slots - FARM.queue.base]}`}</button></section></div>`}</div>`;
    } else if (pn.k === 'craft') {
      const meta = CRAFT_STATIONS[pn.st], j = d.jobs[pn.st];
      const recipes = (Object.keys(RECIPES) as RecipeId[]).filter((r) => RECIPES[r].station === pn.st);
      const slots = s.queueSlots[pn.st];
      const bakery = pn.st === 'bakery' && this.theme === 'storybook';
      const itemIcon = (item: FarmItemId) => ic(bakery ? `ro-${item}` : item, 'fic mid');
      html = (bakery ? `<header class="fph bakery-head">${ic('ro-oven', 'fic hic')}<b>${meta.name}</b><button type="button" class="fpx" data-act="panelClose" aria-label="關閉">✕</button></header>` : head(meta.name, 'oven', 'pink')) + `<div class="fpb" data-live>${j.locked ? `<p class="fnote">Lv ${meta.level} 解鎖</p>` : `
        ${bakery ? '<p class="fnote bakery-note">挑一份食譜，材料齊了就能開始烘焙。</p>' : ''}
        ${recipes.map((r) => { const R = RECIPES[r]; const ok = R.in.every((x) => (s.inv[x.item] ?? 0) >= x.qty);
          return bakery ? `<div class="frecipe bakery-recipe"><strong>${R.name}</strong><div class="bakery-formula">${R.in.map((x) => `<span class="bakery-item" title="${FARM_ITEMS[x.item].name}">${itemIcon(x.item)}<small>×${x.qty}・有${s.inv[x.item] ?? 0}</small></span>`).join('<span class="fplus">＋</span>')}<span class="farrow">➜</span><span class="bakery-item product" title="${FARM_ITEMS[R.out.item].name}">${itemIcon(R.out.item)}<small>${FARM_ITEMS[R.out.item].name}</small></span></div>
            <div class="bakery-recipe-foot"><span>${remainText(R.ms)}</span><button type="button" class="fbtn go" data-act="craft" data-recipe="${r}" ${ok && j.items.length < slots ? '' : 'disabled'}>製作</button></div></div>` : `<div class="frecipe">${R.in.map((x) => `${itemIcon(x.item)}<span class="fx">×${x.qty}<small>(${s.inv[x.item] ?? 0})</small></span>`).join('<span class="fplus">＋</span>')}<span class="farrow">➜</span>${itemIcon(R.out.item)}
            <span class="ftime">${remainText(R.ms)}</span><button type="button" class="fbtn go" data-act="craft" data-recipe="${r}" ${ok && j.items.length < slots ? '' : 'disabled'}>做</button></div>`; }).join('')}
        ${bakery ? '<h4 class="fsub bakery-sub">成品區 <small>點完成品可個別收取</small></h4>' : ''}
        <div class="fqueue${bakery ? ' bakery-queue' : ''}">${Array.from({ length: FARM.queue.max }, (_, i) => { const it = j.items[i];
          if (i >= slots) return `<div class="fslot lockq">＋</div>`;
          if (!it) return '<div class="fslot">空</div>';
          const item = RECIPES[it.recipe].out.item, ready = this.remain(it.remainMs) === 0;
          return ready ? `<button type="button" class="fslot full ready" data-act="collectJob" data-i="${i}" aria-label="收取${FARM_ITEMS[item].name}">${itemIcon(item)}<small>點擊收取</small></button>`
            : `<div class="fslot full">${itemIcon(item)}<small>${remainText(this.remain(it.remainMs))}</small></div>`; }).join('')}</div>
        <div class="fbtns"><button type="button" class="fbtn go" data-act="collectJobs" ${j.items.some((x) => this.remain(x.remainMs) === 0) ? '' : 'disabled'}>${bakery ? '全收' : '收成品'}</button>
          <button type="button" class="fbtn up" data-act="upgradeQueue" ${slots >= FARM.queue.max ? 'disabled' : ''}>${slots >= FARM.queue.max ? '佇列已滿級' : `加一格 ◎${FARM.queue.costs[slots - FARM.queue.base]}`}</button></div>`}</div>`;
    } else if (pn.k === 'tree') {
      if (this.theme === 'storybook') {
        const state = d.tree.state === 'growing' && this.remain(d.tree.remainMs) === 0 ? 'ready' : d.tree.state;
        const fruit = art('farm/tree/apple.webp'), tree = art(`farm/storybook-ro-a/tree-${state}.webp`);
        const canHelp = !p.is_owner && helpTargets(p).some((h) => h.kind === 'rescue');
        html = `<header class="fph tp-head"><img class="fic hic" src="${fruit}" alt=""><b>蘋果樹</b><button type="button" class="fpx" data-act="panelClose" aria-label="關閉">✕</button></header>
          <div class="fpb tp-body" data-live><div class="tp-scene"><img src="${tree}" alt="${state === 'withered' ? '枯萎的蘋果樹' : '蘋果樹'}"></div>
          ${state === 'ready' ? `<div class="tp-fruit"><img src="${fruit}" alt=""><span><b>蘋果 ×${FARM.tree.out.qty}</b><small>已成熟，可以採收</small></span></div><button type="button" class="fbtn go tp-action" data-act="${p.is_owner ? 'harvestTree' : 'visitTree'}">收取蘋果</button>`
            : state === 'growing' ? `<div class="tp-fruit growing"><img src="${fruit}" alt=""><span><b>蘋果生長中</b><small>還要 ${remainText(this.remain(d.tree.remainMs))}</small></span></div>`
              : `<p class="tp-note">果樹太久沒收，已經枯萎。${p.is_owner ? '可以請朋友幫忙，或自己花金幣救樹。' : canHelp ? '你可以幫朋友免費救樹。' : '目前無法幫忙救樹。'}</p>
                ${p.is_owner ? `<button type="button" class="fbtn up tp-action" data-act="rescue">花 ◎${FARM.tree.rescueCoins} 救樹</button>` : canHelp ? '<button type="button" class="fbtn go tp-action" data-act="visitRescue">幫忙救樹</button>' : ''}`}</div>`;
      } else html = head('蘋果樹', 'apple', 'mint') + `<div class="fpb"><p class="fnote">${d.tree.state === 'withered' ? '果樹太久沒收，枯掉了。請朋友來救（免費），或自己花金幣救。' : '果樹好好的。'}</p>
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
          <span class="fname">${esc(f.display_name)} 的農場<small>Lv ${f.level}</small></span>${f.needs_help ? '<span class="fhelp">需要幫忙</span>' : ''}${f.user_id !== this.me.id && visitHeartAvailable(this.myVisit, f.user_id, p.server_time + (Date.now() - this.loadedAt)) ? '<span class="fheart" title="今天第一次來拜訪，友情點數 +1">+1 ♥</span>' : ''}</button>`).join('')}</div>`}
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
      this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
      try { localStorage.setItem(themeKey(this.me.id), this.theme); } catch { /* 私密模式仍可在當次切換 */ }
      this.render();
      return this.root.querySelector<HTMLButtonElement>('.farm-theme')?.focus();
    }
    if (a === 'close') return this.close();
    if (a === 'goHome') { this.close(); return void this.open(this.me.id); }
    if (a === 'guide') return this.onHit(b.dataset.target!);
    if (a === 'panelClose') return this.openPanel(null);
    if (a === 'shop' || a === 'store' || a === 'orders') return this.openPanel({ k: a });
    if (a === 'friends') return this.openPanel({ k: 'friends' });
    if (a === 'visit') { this.close(); return void this.open(b.dataset.user!); }
    if (a === 'visitAnimal' && pn?.k === 'animal') return void this.doVisitCollect({ kind: 'animal', station: pn.st, i: +b.dataset.i! });
    if (a === 'visitTree' && pn?.k === 'tree') return void this.doVisitCollect({ kind: 'tree' });
    if (a === 'visitRescue' && pn?.k === 'tree') return void this.doHelp({ kind: 'rescue' });
    if (a === 'visitJob' && pn?.k === 'craft') return void this.doVisitCollect({ kind: 'job', station: pn.st });
    if (a === 'collectAll') return void this.doAct({ type: 'collectAll' });
    if (a === 'harvestTree' && pn?.k === 'tree') return void this.doAct({ type: 'tree' });
    if (a === 'plant' && pn?.k === 'plant') { const crop = b.dataset.crop as CropId; this.panel = null; return void this.doAct({ type: 'plant', idx: pn.idx, crop }); }
    if (a === 'feed' && pn?.k === 'animal') return void this.doAct({ type: 'feed', station: pn.st, i: +b.dataset.i! });
    if (a === 'collect' && pn?.k === 'animal') return void this.doAct({ type: 'collect', station: pn.st, i: +b.dataset.i! });
    if (a === 'selectCraftRecipe' && pn?.k === 'craft') {
      const recipe = b.dataset.recipe as RecipeId;
      if (RECIPES[recipe]?.station === pn.st) { this.selectedCraftRecipe[pn.st] = recipe; this.renderPanel(); }
      return;
    }
    if (a === 'craft') return void this.doAct({ type: 'craft', recipe: b.dataset.recipe as RecipeId });
    if (a === 'collectJob' && pn?.k === 'craft') return void this.doAct({ type: 'collectJob', station: pn.st, i: +b.dataset.i! });
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
    if (kind === 'tree' && this.theme === 'storybook') return this.openPanel({ k: 'tree' });
    if (!p.is_owner) {
      const helps = helpTargets(p);
      if (kind === 'field') { const idx = +arg; if (d.fields[idx]?.stage === 3) return void this.doVisitCollect({ kind: 'field', idx }); if (helps.some((h) => h.kind === 'water' && h.idx === idx)) return void this.doHelp({ kind: 'water', idx }); return this.toast(d.fields[idx]?.locked ? '這塊田還沒開' : '這塊田還不能採收'); }
      if (kind === 'tree' && d.tree.state === 'ready') return void this.doVisitCollect({ kind: 'tree' });
      if (kind === 'tree' && helps.some((h) => h.kind === 'rescue')) return void this.doHelp({ kind: 'rescue' });
      if (kind === 'animal' && !d.animals[arg as AnimalStation]?.locked) return this.openPanel({ k: 'animal', st: arg as AnimalStation });
      if (kind === 'craft' && !d.jobs[arg as CraftStation]?.locked) return this.openPanel({ k: 'craft', st: arg as CraftStation });
      return this.toast('這裡沒有可採收的資源');
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
