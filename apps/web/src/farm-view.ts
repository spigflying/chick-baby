// 小雞農場全頁畫面（蓋在蛋殼頁上，掛法同 fight-view.ts）。只限電腦；規則與數值都在伺服器（@chick/engine farm.ts）。
import { ANIMALS, CRAFT_STATIONS, CROPS, FARM, FARM_ITEMS, RECIPES, type AnimalStation, type CraftStation, type CropId, type FarmAction, type FarmItemId, type RecipeId } from '@chick/engine';
import { act, api, ApiError, errText } from './api';
import type { Live } from './ws';
import { LAYOUT, SCENE } from './farm-layout';
import { background, barn, bakery, board, chick, coop, field, hutch, iconSymbols, jamhouse, pill, sceneDefs, tree } from './farm-art';
import { FARM_ERR, fieldBadge, helpTargets, hudModel, loadErrorAction, plantChoices, remainText, type FarmPayload } from './farm-model';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ic = (id: string, cls = 'fic') => `<svg class="${cls}" aria-hidden="true"><use href="#fi-${id}"/></svg>`;
/** 小雞的顏色：依農場主人目前寵物的物種。 */
const LOOK: Record<string, { body: string; belly: string }> = {
  chicken: { body: '#ffd84d', belly: '#fff6c4' }, duck: { body: '#fff4d6', belly: '#ffffff' },
  penguin: { body: '#9ad7ff', belly: '#ffffff' }, dino: { body: '#9be37a', belly: '#e9ffd9' },
};
type Panel = null | { k: 'plant'; idx: number } | { k: 'animal'; st: AnimalStation } | { k: 'craft'; st: CraftStation } | { k: 'tree' } | { k: 'orders' } | { k: 'store' } | { k: 'shop' } | { k: 'friends'; list?: any[] };

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

  constructor(private live: Live, private me: { id: string; display_name: string }, private toast: (s: string) => void, private setWallet: (n: number) => void, private wallet: () => number) {
    if (!symbolsInjected) { document.body.insertAdjacentHTML('beforeend', iconSymbols()); symbolsInjected = true; }
    this.root = document.createElement('div'); this.root.className = 'farm'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', '小雞農場');
    document.body.append(this.root);
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey, true);
  }

  async open(ownerId: string, species?: string | null) {
    if (this.live.touch) return this.toast('農場只能用電腦玩');
    this.ownerId = ownerId; this.species = species ?? null; this.panel = null; this.paused = false;
    try { await this.load(); } catch (e) { this.ownerId = null; return this.toast(this.err(e)); }
    this.root.hidden = false; requestAnimationFrame(() => this.root.classList.add('on'));
    clearInterval(this.timer); this.timer = window.setInterval(() => this.tickTimers(), 1000);
    this.showHelpLog();
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
  /** 倒數：伺服器給的是開放時間的剩餘毫秒，這裡用經過的牆鐘時間近似；有東西剛好熟了就重讀一次。 */
  private remain(ms: number) { return Math.max(0, ms - (Date.now() - this.loadedAt)); }
  private tickTimers() {
    const d = this.data?.derived; if (!d || this.busy || this.paused) return;
    const all = [...d.fields.filter((f) => f.stage !== null && f.stage < 3).map((f) => f.remainMs),
      ...Object.values(d.animals).flatMap((a) => a.items.filter((x) => x.state === 'growing').map((x) => x.remainMs)),
      ...Object.values(d.jobs).flatMap((j) => j.items.map((x) => x.remainMs)), ...(d.tree.state === 'growing' ? [d.tree.remainMs] : []),
      ...d.orders.flatMap((o) => ('waitMs' in o && o.waitMs > 0 ? [o.waitMs] : []))];
    if (all.some((ms) => ms > 0 && this.remain(ms) === 0)) { void this.bgLoad(); return; }
    const g = this.root.querySelector('.scene .pills'); if (g) g.innerHTML = this.pills();
    const pn = this.root.querySelector('.farm-panel [data-live]'); if (pn) this.renderPanel();
  }

  // ---------- 畫面 ----------
  private render() {
    const p = this.data; if (!p) return;
    const owner = p.is_owner;
    const hud = hudModel(p, this.wallet());
    this.root.innerHTML = `
      <div class="farm-top"><b class="farm-title">${owner ? '我的農場' : `${esc(p.owner.display_name)} 的農場`}</b>
        <button type="button" class="farm-x" data-act="close" aria-label="關閉農場（Esc）">✕</button></div>
      <div class="farm-stage">
        <svg class="scene" viewBox="0 0 ${SCENE.w} ${SCENE.h}" role="img" aria-label="農場畫面">${sceneDefs()}${this.scene()}<g class="pills">${this.pills()}</g></svg>
        <div class="farm-hud">
          <div class="fpill"><span class="flv">${hud.level}</span><span class="fxp"><i style="width:${hud.xpPct}%"></i></span><span>Lv${hud.level}</span></div>
          ${owner ? `<div class="fpill">${ic('coin')}${hud.coins.toLocaleString()}</div>` : ''}
          <span class="fgrow"></span>
          ${owner ? `<div class="fpill" title="倉庫">${ic('box')}${hud.barn}</div><div class="fpill" title="友情點數">${ic('heart')}${hud.friendPts}</div>` : `<div class="fpill visit">來幫忙：點「澆水」「救樹」</div>`}
        </div>
        <div class="farm-panel" hidden></div>
      </div>
      <div class="farm-tools">${owner ? `
        <button type="button" class="ftool" data-act="shop">${ic('shop', 'fic big')}商店</button>
        <button type="button" class="ftool" data-act="store">${ic('box', 'fic big')}倉庫</button>
        <button type="button" class="ftool" data-act="orders">${ic('board', 'fic big')}訂單${this.deliverable() ? `<span class="fbadge">${this.deliverable()}</span>` : ''}</button>
        <button type="button" class="ftool" data-act="collectAll">${ic('wheat', 'fic big')}全部收成</button>` : ''}
        <button type="button" class="ftool" data-act="friends">${ic('friend', 'fic big')}好友</button>
        <button type="button" class="ftool" data-act="close">${ic('home', 'fic big')}回家</button>
      </div>`;
    this.renderPanel();
  }
  private deliverable() { return this.data?.derived.orders.filter((o) => 'order' in o && o.canDeliver).length ?? 0; }
  private scene() {
    const p = this.data!, s = p.state, d = p.derived;
    const hit = (key: string, inner: string, label: string) => `<g class="hit" data-hit="${key}" tabindex="0" role="button" aria-label="${esc(label)}">${inner}</g>`;
    let o = background();
    LAYOUT.fields.forEach((b, i) => { const f = s.fields[i], fd = d.fields[i]; o += hit(`field:${i}`, field(b, f.crop, fd.stage, fd.locked, fd.unlockLevel), `田 ${i + 1}`); });
    const an = (st: AnimalStation) => d.animals[st].items.map((x) => x.state === 'ready');
    o += hit('animal:hutch', hutch(LAYOUT.hutch, an('hutch'), d.animals.hutch.locked, ANIMALS.hutch.level), '兔兔窩');
    o += hit('animal:coop', coop(LAYOUT.coop, an('coop'), d.animals.coop.locked, ANIMALS.coop.level), '雞舍');
    o += hit('craft:bakery', bakery(LAYOUT.bakery, d.jobs.bakery.items.length > 0, d.jobs.bakery.locked, CRAFT_STATIONS.bakery.level), '烘焙屋');
    o += hit('craft:jamhouse', jamhouse(LAYOUT.jamhouse, d.jobs.jamhouse.items.length > 0, d.jobs.jamhouse.locked, CRAFT_STATIONS.jamhouse.level), '果醬工坊');
    o += hit('tree', tree(LAYOUT.tree, d.tree.state), '蘋果樹');
    o += hit('board', board(LAYOUT.board, p.is_owner && this.deliverable() > 0), '訂單看板');
    o += hit('barn', barn(LAYOUT.barn), '倉庫');
    o += chick(LAYOUT.chick.x, LAYOUT.chick.y, LOOK[this.species ?? 'chicken'] ?? LOOK.chicken);
    return o;
  }
  /** 田、建築上方的標籤（每秒更新）。 */
  private pills() {
    const p = this.data!, d = p.derived; let o = '';
    const helps = new Set(helpTargets(p).map((h) => (h.kind === 'water' ? `w${h.idx}` : 'tree')));
    LAYOUT.fields.forEach((b, i) => {
      const fd = d.fields[i]; if (fd.locked) return;
      const cx = b.x + b.w / 2, y = b.y - 18;
      if (helps.has(`w${i}`)) { o += pill(cx, y, '澆水', 'alert'); return; }
      const badge = fieldBadge({ ...fd, remainMs: this.remain(fd.remainMs) }, p.is_owner);
      if (badge.tone === 'ready') o += pill(cx, y, '可收成', 'ready');
      else if (badge.tone === 'timer') o += pill(cx, y, remainText(this.remain(fd.remainMs)), 'timer');
    });
    const station = (b: { x: number; y: number; w: number }, txt: string | null, tone: 'ready' | 'timer' | 'alert') => { if (txt) o += pill(b.x + b.w / 2, b.y - 14, txt, tone); };
    for (const st of ['hutch', 'coop'] as AnimalStation[]) {
      const a = d.animals[st]; if (a.locked) continue;
      const ready = a.items.filter((x) => x.state === 'ready').length, hungry = a.items.filter((x) => x.state === 'hungry').length;
      const grow = a.items.filter((x) => x.state === 'growing').map((x) => this.remain(x.remainMs));
      station(LAYOUT[st], ready ? `${FARM_ITEMS[ANIMALS[st].out.item].name}好了` : hungry ? '肚子餓了' : grow.length ? remainText(Math.min(...grow)) : null, ready ? 'ready' : 'timer');
    }
    for (const st of ['bakery', 'jamhouse'] as CraftStation[]) {
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

  // ---------- 子畫面 ----------
  private renderPanel() {
    const el = this.root.querySelector('.farm-panel') as HTMLElement | null; if (!el) return;
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
        <div class="frowtext"><span>容量</span><span>${d.barn.used} / ${d.barn.cap}</span></div><div class="fbar"><i style="width:${Math.min(100, Math.round((d.barn.used / d.barn.cap) * 100))}%"></i></div>
        <button type="button" class="fbtn up wide" data-act="upgradeBarn" ${maxed ? 'disabled' : ''}>${maxed ? '倉庫已滿級' : `升級倉庫 +${FARM.barn.step} 格　◎${FARM.barn.costBase * 2 ** lvl}`}</button></div>`;
    } else if (pn.k === 'shop') {
      const cost = FARM.barn.bonusCostStep * (s.barnBonusBought + 1);
      html = head('商店・友情', 'heart', 'pink') + `<div class="fpb"><p class="fnote">去朋友的農場幫忙澆水、救樹就能拿友情點數（現在 ${s.friendPts} 點）。</p>
        <div class="frow static">${ic('pumpkin', 'fic mid')}<span class="fname">愛心南瓜種子<small>Lv ${CROPS.pumpkin.level}・種田時選「愛心南瓜」，每次用 ${CROPS.pumpkin.seedFriendPts} 點</small></span></div>
        <div class="frow static">${ic('box', 'fic mid')}<span class="fname">倉庫 +${FARM.barn.bonusSlots} 格<small>友情 ${cost} 點</small></span>
          <button type="button" class="fbtn up" data-act="barnBonus" ${s.friendPts >= cost ? '' : 'disabled'}>換</button></div></div>`;
    } else if (pn.k === 'friends') {
      const list = pn.list;
      html = head('好友農場', 'friend', 'purple') + `<div class="fpb">${!list ? '<p class="fnote">讀取中…</p>' : !list.length ? '<p class="fnote">還沒有朋友的農場。先用分享碼去朋友家拜訪，之後就會出現在這裡。</p>'
        : `<div class="flist">${list.map((f) => `<button type="button" class="frow" data-act="visit" data-user="${esc(f.user_id)}"><span class="fav">${esc(String(f.display_name).slice(0, 1))}</span>
          <span class="fname">${esc(f.display_name)} 的農場<small>Lv ${f.level}</small></span>${f.needs_help ? '<span class="fhelp">需要幫忙</span>' : ''}</button>`).join('')}</div>`}
        ${p.is_owner ? '' : `<button type="button" class="fbtn wide" data-act="visit" data-user="${esc(this.me.id)}">回我的農場</button>`}</div>`;
    }
    el.innerHTML = html; el.hidden = false;
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
  }
  private onHit(key: string) {
    const p = this.data; if (!p) return;
    const [kind, arg] = key.split(':');
    const d = p.derived;
    if (!p.is_owner) {
      const helps = helpTargets(p);
      if (kind === 'field') { const idx = +arg; if (helps.some((h) => h.kind === 'water' && h.idx === idx)) return void this.doHelp({ kind: 'water', idx }); return this.toast(d.fields[idx]?.locked ? '這塊田還沒開' : '這塊田不用幫忙'); }
      if (kind === 'tree' && helps.some((h) => h.kind === 'rescue')) return void this.doHelp({ kind: 'rescue' });
      return this.toast('這裡不用幫忙，找「澆水」「救樹」的標籤');
    }
    if (kind === 'field') {
      const idx = +arg, f = d.fields[idx];
      if (f.locked) return this.toast(`這塊田 Lv ${f.unlockLevel} 解鎖`);
      if (f.stage === null) return this.openPanel({ k: 'plant', idx });
      if (this.remain(f.remainMs) === 0) return void this.doAct({ type: 'harvest', idx });
      return this.toast(`還要 ${remainText(this.remain(f.remainMs))}`);
    }
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
