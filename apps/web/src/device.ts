import { PAL, S, spr, sw, sh, num, speciesSprite, spriteCanvas, SPECIES_LABEL, FOOD_SPRITE, CUP_LIQUID } from './sprites';
import { GuestWalkers, guestsOf, guestSprite, lanes, spriteH, spriteW, type PresenceUser } from './visitors';
import { drawShell, SHELL_COLORS } from './shell';
import { act, errText } from './api';
import type { Live } from './ws';
import { StairsClient } from './stairs';

const W = 120, H = 100, GROUND = 86, HUD = 14;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface Ctx {
  me: { id: string; display_name: string };
  cfg: any; live: Live;
  wallet: () => number; setWallet: (n: number) => void;
  toast: (t: string) => void;
  goHome: () => void;
}
/** 便便位置：從右往左排在地上，一排 16 個，超過就往上疊（玫瑰茶最多 23 個）。 */
export function poopXY(i: number) { const row = Math.floor(i / 16), col = i % 16; return { x: W - 9 - col * 7, y: GROUND - 5 - (col % 2) * 3 - row * 7 }; }
type Cell = { act: string; icon: string; label: string };

export class Device {
  el: HTMLElement;
  cv!: HTMLCanvasElement; g!: CanvasRenderingContext2D;
  home: any = null; pet: any = null; visitor: any = null;
  isOwner = false;
  cells: Cell[] = []; sel = 0;
  menu: null | 'feed' | 'status' | 'hatch' | 'result' = null; menuSel = 0; menuHtml = '';
  frame = 0; petX = 42; petDir = 1; anim: any = null; fxT = 0; fxKind: string | null = null;
  busy = false;
  stairs: StairsClient | null = null;
  private timer = 0; private off: (() => void)[] = [];
  private hatchPick = 'chicken';
  guests: PresenceUser[] = []; guestExtra = 0; private walkers = new GuestWalkers();

  /** v1.3：在場者的寵物同框。 */
  setPresence(users: PresenceUser[]) {
    if (!this.home) return;
    const g = guestsOf(users, this.home.owner.id);
    this.guests = g.shown; this.guestExtra = g.extra;
    const tags = this.$('.tags');
    tags.innerHTML = `<span class="tag own" data-g="owner">${esc(this.home.owner.display_name)}</span>`
      + this.guests.map((u, i) => `<span class="tag" data-g="${i}" title="${esc(u.pet ? u.pet.name : '沒有寵物')}">${esc(u.display_name)}${u.pet ? (u.pet.status === 'dead' ? '†' : '') : '·沒寵物'}</span>`).join('')
      + (this.guestExtra ? `<span class="tag more">+${this.guestExtra}</span>` : '');
  }
  private lanes() { return lanes(W, this.guests.length); }
  /** 主人寵物的活動範圍：有訪客時只用第 0 條跑道。 */
  private ownerRange(pw: number) { if (!this.guests.length) return { min: 8, max: W - pw - 22 }; const l = this.lanes()[0]; return { min: l.x0, max: Math.max(l.x0, l.x1 - pw) }; }
  private ownerCx() { if (!this.guests.length) return W / 2; const l = this.lanes()[0]; return (l.x0 + l.x1) / 2; }
  private tag(sel: string, cx: number, top: number) {
    const el = this.el.querySelector(`.tags [data-g="${sel}"]`) as HTMLElement | null; if (!el) return;
    el.style.left = `${(cx / W) * 100}%`; el.style.top = `${(Math.max(HUD + 1, top - 7) / H) * 100}%`;
  }
  drawGuests() {
    const g = this.g, f = Math.floor(this.frame / 4) % 2, L = this.lanes();
    const names = this.guests.map((u) => guestSprite(u.pet, f));
    const xs = this.walkers.step(this.guests.map((u) => u.id), (i) => L[i + 1], (i) => spriteW(names[i]),
      (i) => this.frame % 3 === 0 && !!this.guests[i].pet && this.guests[i].pet!.status === 'alive' && !this.guests[i].pet!.sleeping);
    this.guests.forEach((u, i) => {
      const n = names[i], w = spriteW(n), h = spriteH(n), x = xs[i];
      const y = n === 'ghost' ? GROUND - h - 4 + (f ? 0 : 2) : GROUND - h;
      if (n) spr(g, n, x, y, this.walkers.dir(u.id) > 0 && n !== 'ghost' && n !== 'egg' && !u.pet!.sleeping);
      if (u.pet?.sleeping) spr(g, 'z', x + w + 1, y - 5 - f * 2);
      if (u.pet?.sick && u.pet.status === 'alive') spr(g, 'skull', x - 6, y - 6 + f);
      this.tag(String(i), x + w / 2, n ? y : GROUND - 4);
    });
  }
  private drawOwnerTag(cx: number, top: number) { this.tag('owner', cx, top); }

  constructor(private ctx: Ctx) {
    this.el = document.createElement('div');
    this.el.className = 'device';
    this.el.innerHTML = `<canvas class="shell"></canvas><div class="inner"><div class="brand">CHICK♥BABY</div><div class="lcd">
      <div class="lcd-top"><span data-k="name">—</span><span data-k="stage">—</span><span data-k="coins">◎0</span><span data-k="age">—</span></div>
      <div class="scr"><canvas class="screen" width="${W}" height="${H}"></canvas><div class="tags"></div><div class="menu" hidden></div></div>
      <div class="labels"></div>
      <div class="gamebar" hidden><button data-dir="left">◀</button><button class="quit">離開</button><button data-dir="right">▶</button></div>
      <p class="msg">…</p></div></div>`;
    this.cv = this.el.querySelector('canvas.screen')!; this.g = this.cv.getContext('2d')!;
    this.bind();
    this.timer = window.setInterval(() => this.loop(), 33);
    this.off.push(ctx.live.on((m) => this.onLive(m)));
  }
  destroy() { clearInterval(this.timer); this.off.forEach((f) => f()); this.stairs?.leave(); document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKeyUp); }
  $(s: string) { return this.el.querySelector(s) as HTMLElement; }
  say(t: string) { this.$('.msg').textContent = t; }

  setHome(view: { home: any; pet: any; visitor: any }) {
    const first = !this.home || this.home.id !== view.home.id;
    this.home = view.home; this.isOwner = !!view.home.is_owner; this.visitor = view.visitor;
    this.setPet(view.pet);
    const sc = SHELL_COLORS[this.pet?.species ?? 'chicken'];
    drawShell(this.$('canvas.shell') as HTMLCanvasElement, sc.palette, sc.rim);
    this.$('.brand').textContent = this.isOwner ? 'CHICK♥BABY' : `${view.home.owner.display_name} 的家`;
    if (first) this.say(this.isOwner ? (this.pet ? `歡迎回家！` : '還沒有寵物，點「孵蛋」選一隻吧！') : `來 ${view.home.owner.display_name} 家玩～`);
  }
  setPet(p: any) {
    const prevSpecies = this.pet?.species;
    this.pet = p;
    if (p && prevSpecies && prevSpecies !== p.species) { const sc = SHELL_COLORS[p.species]; drawShell(this.$('canvas.shell') as HTMLCanvasElement, sc.palette, sc.rim); }
    this.buildCells(); this.renderTop(); if (this.menu === 'status') this.renderMenu();
  }

  // ---------- 圖示列 ----------
  buildCells() {
    const p = this.pet, alive = p && p.status === 'alive';
    let cells: Cell[];
    if (this.isOwner) {
      if (!p || p.status === 'dead') cells = [{ act: 'hatch', icon: 'egg', label: '孵蛋' }, { act: 'status', icon: 'i_stat', label: '狀態' }];
      else if (p.status === 'egg') cells = [{ act: 'status', icon: 'i_stat', label: '狀態' }];
      else cells = [
        { act: 'feed', icon: 'i_feed', label: '餵食' }, { act: 'play', icon: 'i_play', label: '樓梯' },
        p.sleeping ? { act: 'wake', icon: 'i_wake', label: '起床' } : { act: 'sleep', icon: 'i_sleep', label: '睡覺' },
        { act: 'clean', icon: 'i_wash', label: '清潔' }, { act: 'doctor', icon: 'i_doc', label: '醫生' }, { act: 'status', icon: 'i_stat', label: '狀態' }];
    } else if (!p || p.status !== 'alive') cells = [{ act: 'status', icon: 'i_stat', label: '狀態' }, { act: 'home', icon: 'i_home', label: '回家' }];
    else cells = [{ act: 'feed', icon: 'i_feed', label: '餵食' }, { act: 'status', icon: 'i_stat', label: '狀態' }, { act: 'home', icon: 'i_home', label: '回家' }];
    const key = cells.map((c) => c.act).join(',');
    const box = this.$('.labels');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    this.cells = cells; this.sel = Math.min(this.sel, cells.length - 1);
    box.style.gridTemplateColumns = `repeat(${Math.max(cells.length, 3)},1fr)`;
    box.innerHTML = '';
    cells.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'cell'; b.dataset.i = String(i); b.dataset.act = c.act;
      b.append(document.createElement('canvas')); const s = document.createElement('span'); s.textContent = c.label; b.append(s);
      box.append(b);
    });
    this.drawCells(true);
    void alive;
  }
  drawCells(force = false) {
    const box = this.$('.labels');
    [...box.children].forEach((b, i) => {
      const on = i === this.sel;
      if (!force && b.classList.contains('on') === on) return;
      b.classList.toggle('on', on);
      const old = b.querySelector('canvas')!; const c = spriteCanvas(this.cells[i].icon, 1, on);
      const pad = document.createElement('canvas'); pad.width = 13; pad.height = 11;
      pad.getContext('2d')!.drawImage(c, Math.floor((13 - c.width) / 2), Math.floor((11 - c.height) / 2));
      old.replaceWith(pad);
    });
  }
  renderTop() {
    const p = this.pet, t = (k: string, v: string) => { this.$(`[data-k="${k}"]`).textContent = v; };
    t('name', p ? p.name : this.isOwner ? '空巢' : '沒有寵物');
    t('stage', !p ? '—' : p.status === 'dead' ? '天堂' : p.status === 'egg' ? '蛋' : SPECIES_LABEL[p.species]);
    t('coins', '◎' + this.ctx.wallet());
    if (p) {
      const a = Math.max(0, Math.floor((Date.now() - (p.hatched_at ?? p.born_at)) / 60000));
      t('age', p.status === 'egg' ? `${Math.max(0, Math.ceil((p.hatch_at - this.ctx.live.serverNow()) / 1000))}秒` : a < 60 ? a + '分' : a < 1440 ? Math.floor(a / 60) + '時' : Math.floor(a / 1440) + '天');
    } else t('age', '—');
  }

  // ---------- 輸入 ----------
  private onKey = (e: KeyboardEvent) => {
    if (!this.el.isConnected || (document.getElementById('dlg') as HTMLDialogElement).open) return;
    if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
    const k = e.key;
    if (this.stairs) { if (this.stairs.key(k, true)) e.preventDefault(); return; }
    if (this.menu) {
      if (k === 'Escape' || k === 'Backspace') this.closeMenu();
      else if (this.menu === 'feed' && (k === 'ArrowUp' || k === 'ArrowDown')) { const n = this.ctx.cfg.foods.length; this.menuSel = (this.menuSel + (k === 'ArrowUp' ? n - 1 : 1)) % n; this.renderMenu(); }
      else if (k === 'Enter' || k === ' ') { if (this.menu === 'feed') this.chooseFood(this.ctx.cfg.foods[this.menuSel]); else this.closeMenu(); }
      else return;
    } else if (k === 'ArrowLeft') { this.sel = (this.sel + this.cells.length - 1) % this.cells.length; this.drawCells(); }
    else if (k === 'ArrowRight') { this.sel = (this.sel + 1) % this.cells.length; this.drawCells(); }
    else if (k === 'Enter' || k === ' ') this.activate(this.sel);
    else return;
    e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => { if (this.stairs) this.stairs.key(e.key, false); };
  bind() {
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('keyup', this.onKeyUp);
    this.$('.labels').addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest('.cell') as HTMLElement | null; if (!c) return;
      const i = +c.dataset.i!;
      if (this.menu && this.menu !== 'result') { const was = this.menu; this.closeMenu(); if (this.cells[i].act === was) { this.sel = i; this.drawCells(); return; } }
      this.activate(i);
    });
    this.$('.menu').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (this.menu === 'feed') { const it = t.closest('.mi') as HTMLElement | null; if (!it) return; const i = +it.dataset.i!; if (i < 0) return this.closeMenu(); this.menuSel = i; return this.chooseFood(this.ctx.cfg.foods[i]); }
      if (this.menu === 'hatch') {
        const sp = t.closest('.sp') as HTMLElement | null; if (sp) { this.hatchPick = sp.dataset.s!; this.renderMenu(); return; }
        if (t.closest('[data-go]')) return void this.hatch();
        if (t.closest('.back')) this.closeMenu();
        return;
      }
      if (this.menu === 'result') { this.endStairsView(); return; }
      this.closeMenu();
    });
    this.cv.addEventListener('click', () => { if (!this.stairs && this.menu) this.closeMenu(); });
    this.el.querySelectorAll<HTMLElement>('.gamebar [data-dir]').forEach((b) => {
      const d = b.dataset.dir as 'left' | 'right';
      const set = (v: boolean) => (e: Event) => { e.preventDefault(); this.stairs?.setDir(d, v); };
      b.addEventListener('pointerdown', set(true)); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, set(false)));
    });
    this.$('.gamebar .quit').addEventListener('click', () => this.stairs?.quit());
    const scr = this.$('.scr');
    scr.addEventListener('pointerdown', (e) => { if (!this.stairs || e.pointerType !== 'mouse') return; if (e.button === 0) this.stairs.setDir('left', true); else if (e.button === 2) this.stairs.setDir('right', true); });
    window.addEventListener('pointerup', (e) => { if (!this.stairs || e.pointerType !== 'mouse') return; if (e.button === 0) this.stairs.setDir('left', false); else if (e.button === 2) this.stairs.setDir('right', false); });
    scr.addEventListener('contextmenu', (e) => { if (this.stairs) e.preventDefault(); });
  }

  activate(i: number) {
    if (this.stairs) return;
    this.sel = i; this.drawCells();
    const a = this.cells[i]?.act; const p = this.pet;
    if (a === 'status') return this.openMenu('status');
    if (a === 'home') return this.ctx.goHome();
    if (a === 'hatch') return this.openMenu('hatch');
    if (!p) return;
    if (p.status === 'egg') return this.say('蛋蛋還在孵化中…');
    if (p.status === 'dead') return this.say(`${p.name} 去當小天使了…`);
    if (this.anim) return this.say(this.anim.type === 'clean' ? '正在洗澎澎，等一下～' : '正在吃東西，等一下～');
    if (a === 'feed') { if (p.sleeping) return this.say('噓…牠在睡覺，先叫醒牠吧。'); return this.openMenu('feed'); }
    if (a === 'play') return this.startStairs();
    void this.ownerAction(a);
  }
  async ownerAction(a: string) {
    if (this.busy) return; this.busy = true;
    const before = this.pet;
    try {
      const r = await act('POST', `/pets/${this.pet.id}/actions`, { action: a });
      if (a === 'clean') { this.startClean(before.poop); this.pendingPet = r.pet; this.say('龍捲風來打掃囉！'); }
      else {
        this.setPet(r.pet);
        if (a === 'doctor') { this.fx('syringe'); this.say('打針好痛…但病好了！'); }
        else this.say(a === 'sleep' ? '晚安～' : '早安！');
      }
    } catch (e) { this.say(errText(e)); }
    finally { this.busy = false; }
  }
  pendingPet: any = null;
  fx(k: string) { this.fxKind = k; this.fxT = 6; }

  // ---------- 選單 ----------
  openMenu(m: 'feed' | 'status' | 'hatch') { this.menu = m; this.menuSel = m === 'feed' ? (this.isOwner ? 0 : 1) : 0; this.renderMenu(); }
  closeMenu() { this.menu = null; this.renderMenu(); }
  renderMenu() {
    const el = this.$('.menu');
    if (!this.menu) { el.hidden = true; return; }
    el.hidden = false;
    const p = this.pet, coins = this.ctx.wallet(), cfg = this.ctx.cfg;
    if (this.menu === 'feed') {
      const v = this.visitor, f = cfg.game.feed;
      el.innerHTML = `<div class="mt">— 餵食 —  ◎${coins}</div>` + cfg.foods.map((fd: any, i: number) => {
        const blocked = (!this.isOwner && (!fd.visitorAllowed || fd.price === 0)) || fd.price > coins;
        return `<div class="mi${i === this.menuSel ? ' on' : ''}${blocked ? ' off' : ''}" data-i="${i}"><span>${i === this.menuSel ? '▶' : '　'}${esc(fd.name)}${fd.drink ? '<small>飲料</small>' : fd.snack ? '<small>點心</small>' : ''}</span><em>${fd.price ? '◎' + fd.price : '免費'}</em></div>`;
      }).join('') +
        (this.isOwner ? '' : `<div class="note">今天你餵了 ${v?.today_mine ?? 0}/${f.visitorDailyPerVisitorPerPet}・全部訪客 ${v?.today_pet_total ?? 0}/${f.visitorDailyPerPet}</div>`) +
        '<div class="mi back" data-i="-1">✕ 關閉</div>';
    } else if (this.menu === 'status') {
      if (!p) { el.innerHTML = '<div class="mt">— 狀態 —</div><p>還沒有寵物。</p><div class="mi back">✕ 關閉</div>'; return; }
      const row = (k: string, v: unknown) => `<div><b>${k}</b><span>${v}</span></div>`;
      const born = new Date(p.born_at);
      el.innerHTML = '<div class="mt">— 狀態 —</div><div class="grid">' + row('名字', esc(p.name)) + row('種類', SPECIES_LABEL[p.species]) + row('性格', p.personality) +
        row('力量', p.strength) + row('速度', p.speed) + row('體力', p.stamina) + row('體重', p.weight + 'g') + row('最深', p.best_floor + '樓') +
        row('飽足', Math.round(p.hunger)) + row('心情', Math.round(p.happiness)) + row('精力', Math.round(p.energy)) + row('清潔', Math.round(p.cleanliness)) + row('健康', Math.round(p.health)) + row('便便', p.poop) + '</div>' +
        `<div class="wide"><b>出生</b><span>${born.getMonth() + 1}/${born.getDate()} ${String(born.getHours()).padStart(2, '0')}:${String(born.getMinutes()).padStart(2, '0')}</span></div>` +
        (p.status === 'dead' ? `<div class="wide"><b>死因</b><span>${({ starvation: '餓壞了', illness: '生病', neglect: '沒人照顧' } as any)[p.death_cause] ?? p.death_cause}</span></div>` : '') +
        (this.isOwner ? `<div class="wide"><b>金幣</b><span>◎${coins}</span></div>` : '') + '<div class="mi back">✕ 關閉</div>';
    } else if (this.menu === 'hatch') {
      el.innerHTML = '<div class="mt">— 選一顆蛋 —</div><div class="species">' + cfg.species.map((s: any) =>
        `<div class="sp${s.id === this.hatchPick ? ' on' : ''}" data-s="${s.id}"><span class="pic"></span><span>${SPECIES_LABEL[s.id]}</span></div>`).join('') +
        '</div><div class="mi" data-go style="justify-content:center">▶ 孵這顆！</div><div class="mi back">✕ 取消</div>';
      el.querySelectorAll<HTMLElement>('.sp').forEach((d) => d.querySelector('.pic')!.append(spriteCanvas(speciesSprite(d.dataset.s!, 1), 1, d.dataset.s === this.hatchPick)));
    }
  }
  async hatch() {
    const dlg = document.getElementById('dlg') as HTMLDialogElement, form = document.getElementById('dlgForm') as HTMLFormElement;
    form.innerHTML = `<p>幫你的${SPECIES_LABEL[this.hatchPick]}寶寶取個名字吧！</p><input name="n" maxlength="12" placeholder="例如：小黃" required><button value="ok">開始孵蛋</button> <button value="cancel" formnovalidate class="alt">取消</button>`;
    dlg.showModal();
    const name = await new Promise<string | null>((res) => { dlg.onclose = () => res(dlg.returnValue === 'ok' ? (form.elements.namedItem('n') as HTMLInputElement).value.trim() : null); });
    if (!name) return;
    try {
      const r = await act('POST', '/pets', { species: this.hatchPick, name });
      this.closeMenu(); this.setPet(r.pet); this.petX = 42;
      const sc = SHELL_COLORS[r.pet.species]; drawShell(this.$('canvas.shell') as HTMLCanvasElement, sc.palette, sc.rim);
      this.say(`${r.pet.name} 的蛋來了！一分鐘內就會孵化～`);
    } catch (e) { this.say(errText(e)); }
  }
  async chooseFood(f: any) {
    if (this.busy || !this.pet) return;
    this.busy = true;
    try {
      const r = await act('POST', `/pets/${this.pet.id}/actions`, { action: 'feed', food_id: f.id });
      this.ctx.setWallet(r.balance); if (r.visitor) this.visitor = r.visitor;
      this.closeMenu(); this.startEat(f.id); this.pendingPet = r.pet;
      this.say(`${f.name} 掉下來了！`);
    } catch (e) { this.say(errText(e)); if (this.menu === 'feed') this.renderMenu(); }
    finally { this.busy = false; }
  }

  // ---------- 即時事件 ----------
  onLive(m: any) {
    if (m.type === 'pet.updated' && this.home && m.home_id === this.home.id) {
      const ev = m.event;
      const mine = ev?.actor?.id === this.ctx.me.id;
      if (this.anim || this.stairs) { this.pendingPet = m.pet; }
      else if (ev?.type === 'feed' && !mine) { this.startEat(ev.food); this.pendingPet = m.pet; this.say(`${ev.actor.display_name} 餵了 ${this.ctx.cfg.foods.find((f: any) => f.id === ev.food)?.name ?? ev.food}！`); }
      else if (!mine || !this.anim) this.setPet(m.pet);
    } else if (m.type === 'wallet.updated') { this.ctx.setWallet(m.balance); this.renderTop(); }
    else if (this.stairs) this.stairs.onLive(m);
    else if (m.type === 'match.started') this.beginStairs(m);
    else if (m.type === 'error' && m.for === 'match.create') this.say(errText({ message: (({ TOO_TIRED: '太累了，想睡覺…', PET_SLEEPING: '噓…牠在睡覺', ALREADY_IN_MATCH: '已經在遊戲中' }) as any)[m.code] ?? m.code }));
  }

  // ---------- 下樓梯 ----------
  startStairs() {
    if (!this.ctx.live.send({ type: 'match.create', request_id: crypto.randomUUID() })) return this.say('連線中斷，稍後再試');
    this.say('準備下樓梯…');
  }
  beginStairs(m: any) {
    this.closeMenu();
    const lab = this.$('.labels'), bar = this.$('.gamebar');
    const h0 = this.cv.offsetHeight + lab.offsetHeight;
    lab.hidden = true; bar.hidden = false; this.el.classList.add('playing');
    const P = m.params;
    const hh = Math.min(h0 - bar.offsetHeight + 22, Math.round(this.cv.offsetWidth * P.height / P.width));
    this.cv.width = P.width; this.cv.height = P.height; this.cv.style.height = hh + 'px'; this.cv.style.width = Math.round(hh * P.width / P.height) + 'px';
    this.stairs = new StairsClient(this.ctx.live, m, this.pet?.species ?? 'chicken', {
      ended: (r) => {
        if (r.balance != null) this.ctx.setWallet(r.balance);
        if (r.pet) this.pendingPet = r.pet;
        this.menu = 'result';
        const el = this.$('.menu'); el.hidden = false;
        el.innerHTML = r.aborted ? `<div class="mt">— 遊戲中止 —</div><p>伺服器維護中，這場不計分。</p><div class="mi back on">✕ 離開</div>`
          : `<div class="mt">— 遊戲結束 —</div><div class="wide"><b>下了</b><span>${r.floors} 樓</span></div><div class="wide"><b>獲得</b><span>◎${r.coins}</span></div><div class="wide"><b>目前</b><span>◎${this.ctx.wallet()}</span></div><div class="mi back on">✕ 離開</div>`;
        this.say(r.aborted ? '遊戲中止' : `下了 ${r.floors} 樓，賺到 ◎${r.coins}！`);
      },
    });
    this.say('←→ 移動，往下跳！小心尖刺～');
  }
  endStairsView() {
    this.stairs?.leave(); this.stairs = null; this.menu = null; this.$('.menu').hidden = true;
    this.cv.width = W; this.cv.height = H; this.cv.style.width = this.cv.style.height = '';
    this.$('.labels').hidden = false; this.$('.gamebar').hidden = true; this.el.classList.remove('playing');
    if (this.pendingPet) { this.setPet(this.pendingPet); this.pendingPet = null; }
  }

  // ---------- 動畫 ----------
  startEat(foodId: string) {
    const sprite = FOOD_SPRITE[foodId] ?? 'food';
    this.anim = { type: 'eat', sprite, drink: !!this.ctx.cfg.foods.find((f: any) => f.id === foodId)?.drink, level: CUP_LIQUID.rows.length, phase: 'drop', fx: Math.max(14, Math.min(W - 18, this.petX + (this.petX > 48 ? -20 : 24))), fy: -8, t: 0, bite: 0 };
  }
  startClean(poop: number) {
    this.anim = { type: 'clean', phase: 'tornado', t: 0, tx: -16, items: Array.from({ length: poop }, (_, i) => ({ ...poopXY(i), lifted: false, ang: i * 2 })) };
  }
  private finishAnim(msg?: string) { this.anim = null; if (this.pendingPet) { this.setPet(this.pendingPet); this.pendingPet = null; } if (msg) this.say(msg); }

  loop() {
    if (this.stairs) { this.stairs.tick(); this.stairs.draw(this.g); return; }
    if (++this.sub % 3 === 0) this.draw();
    if (this.sub % 30 === 0) { this.renderTop(); if (this.pet?.status === 'egg' && this.ctx.live.serverNow() > this.pet.hatch_at + 300 && this.home) this.ctx.live.joinHome(this.home.id); }
  }
  private sub = 0;

  bar(x: number, y: number, icon: string, v: number) {
    const g = this.g, iw = sw(icon), ih = sh(icon), n = 9, f = Math.round(n * v / 100);
    spr(g, icon, x + Math.floor((11 - iw) / 2), y + Math.floor((11 - ih) / 2));
    g.fillStyle = PAL[3]; g.fillRect(x + 12, y + 3, n + 2, 6);
    g.fillStyle = PAL[0]; g.fillRect(x + 13, y + 4, n, 4);
    g.fillStyle = PAL[2]; g.fillRect(x + 13, y + 4, f, 4);
  }
  draw() {
    this.drawMain();
    this.drawGuests();
    const more = this.el.querySelector('.tags .more') as HTMLElement | null;
    if (more) { more.style.right = '1%'; more.style.top = `${((HUD + 1) / H) * 100}%`; }
  }
  drawMain() {
    const g = this.g, p = this.pet; this.frame++;
    const cx = this.ownerCx();
    const f = Math.floor(this.frame / 4) % 2;
    g.fillStyle = p?.sleeping ? PAL[2] : PAL[0]; g.fillRect(0, 0, W, H);
    if (p && p.status === 'alive') (['i_hunger', 'i_happy', 'i_energy', 'i_clean', 'i_health'] as const).forEach((ic, i) => this.bar(1 + i * 24, 1, ic, p[['hunger', 'happiness', 'energy', 'cleanliness', 'health'][i]]));
    g.fillStyle = PAL[3]; g.fillRect(0, HUD - 1, W, 1);
    g.fillStyle = PAL[1]; g.fillRect(0, GROUND, W, 1);
    for (let i = 0; i < W; i += 6) g.fillRect(i, GROUND + 2 + ((i / 6) % 2), 2, 1);
    if (!p) { spr(g, 'egg', cx - 6, GROUND - 12); g.fillStyle = PAL[0]; g.fillRect(cx - 3, GROUND - 9, 6, 5); spr(g, 'z', cx + 8, GROUND - 22 - f * 2); this.drawOwnerTag(cx, GROUND - 12); return; }
    if (p.status === 'dead') { spr(g, 'ghost', cx - 5, HUD + 22 + (f ? 0 : 2)); spr(g, 'tomb', cx - 4, GROUND - 8); this.drawOwnerTag(cx, HUD + 22); return; }
    if (p.status === 'egg') {
      const left = p.hatch_at - this.ctx.live.serverNow(), shake = left < 15000 ? (f ? 1 : -1) : (this.frame % 16 < 2 ? 1 : 0);
      spr(g, f && left < 15000 ? 'egg2' : 'egg', cx - 6 + shake, GROUND - 12);
      if (left > 0) num(g, Math.ceil(left / 1000), cx - 4, HUD + 10);
      this.drawOwnerTag(cx, GROUND - 12);
      return;
    }
    const name1 = speciesSprite(p.species, 1), pw = sw(name1), ph = sh(name1), baseY = GROUND - ph;
    let alt = f, py = baseY, flip = this.petDir > 0;
    const a = this.anim;
    if (a && a.type === 'eat') {
      a.t++;
      if (a.phase === 'drop') { a.fy += 1 + a.t * 0.15; const land = GROUND - sh(a.sprite); if (a.fy >= land) { a.fy = land; a.phase = 'walk'; a.t = 0; } }
      else if (a.phase === 'walk') {
        if (a.target === undefined) {
          const fw = sw(a.sprite), L = a.fx - pw + 2, R = a.fx + fw - 2;
          let left = this.petX + pw / 2 <= a.fx + fw / 2;
          if (left && L < 0) left = false; if (!left && R > W - pw) left = true;
          a.target = left ? L : R; a.faceRight = left;
        }
        if (Math.abs(this.petX - a.target) <= 1) { this.petX = a.target; a.phase = 'peck'; a.t = 0; this.petDir = a.faceRight ? 1 : -1; }
        else { this.petDir = a.target > this.petX ? 1 : -1; this.petX += this.petDir; }
        flip = this.petDir > 0; alt = Math.floor(a.t / 2) % 2;
      } else if (a.phase === 'peck' && a.drink) {
        // 飲料：小口小口慢慢喝，杯子裡的茶一格一格變少（約 5 秒）
        flip = a.faceRight; this.petDir = flip ? 1 : -1;
        const sip = Math.floor(a.t / 4) % 4 === 0; py = baseY + (sip ? 1 : 0); alt = 0;
        a.level = Math.max(0, CUP_LIQUID.rows.length - Math.floor(a.t / 12));
        if (a.level === 0 && a.t % 12 === 11) { a.phase = 'hearts'; a.t = 0; if (this.pendingPet) { this.setPet(this.pendingPet); this.pendingPet = null; } this.say('喝光光～咦，肚子怪怪的…'); }
      } else if (a.phase === 'peck') {
        flip = a.faceRight; this.petDir = flip ? 1 : -1;
        const cyc = Math.floor(a.t / 3) % 2; py = baseY + (cyc ? 2 : 0); alt = cyc;
        if (a.t % 6 === 5) a.bite++;
        if (a.bite >= 4) { a.phase = 'hearts'; a.t = 0; if (this.pendingPet) { this.setPet(this.pendingPet); this.pendingPet = null; } this.say('好吃！吃光光～'); }
      } else if (a.phase === 'hearts' && a.t > 24) this.finishAnim();
      if (this.anim && a.drink && a.phase !== 'hearts') this.drawCup(a);
      else if (this.anim && a.phase !== 'hearts') spr(g, a.sprite, a.fx, a.fy, false, Math.ceil(sw(a.sprite) * a.bite / 4));
      if (this.anim && a.phase === 'hearts') for (let k = 0; k < 3; k++) { const hy = GROUND - ph - 4 - a.t * 0.8 - k * 6; if (hy > HUD + 1) spr(g, 'heart', this.petX + pw / 2 - 2 + (k - 1) * 6 + (Math.floor((a.t + k * 3) / 4) % 2), hy); }
    } else if (a && a.type === 'clean') {
      a.t++;
      if (a.phase === 'tornado') { a.tx += 5; if (Math.abs(a.tx + 7 - (this.petX + pw / 2)) < 14) this.petX += a.t % 2 ? 1 : -1;
        for (const it of a.items) if (!it.lifted && a.tx + 12 >= it.x) it.lifted = true;
        if (a.tx > W + 4) { a.phase = 'soap'; a.t = 0; this.say('泡泡水沖過來～'); } }
      else if (a.phase === 'soap') { if (a.t > 11) { a.phase = 'rinse'; a.t = 0; this.say('清水沖乾淨！'); } }
      else if (a.phase === 'rinse') { if (a.t > 11) { a.phase = 'shake'; a.t = 0; } }
      else if (a.phase === 'shake') { this.petX += a.t % 2 ? 2 : -2; flip = a.t % 4 < 2; if (a.t > 8) this.finishAnim('洗香香，好舒服～'); }
    } else if (!p.sleeping && !this.menu) {
      const rg = this.ownerRange(pw);
      if (this.frame % 3 === 0) { this.petX += this.petDir; if (this.petX < rg.min || this.petX > rg.max || Math.random() < 0.02) this.petDir *= -1; }
      this.petX = Math.max(rg.min, Math.min(rg.max, this.petX));
    }
    spr(g, p.sleeping ? speciesSprite(p.species, 's') : speciesSprite(p.species, alt ? 2 : 1), this.petX, py, flip && !p.sleeping);
    if (p.sleeping) { spr(g, 'z', this.petX + pw + 2, baseY - 6 - f * 3); spr(g, 'z', this.petX + pw + 8, baseY - 14 - f * 3); }
    if (p.sick) spr(g, 'skull', this.petX - 7, baseY - 6 + f);
    this.drawOwnerTag(this.petX + pw / 2, py);
    if (!(this.anim && this.anim.type === 'clean')) for (let i = 0; i < p.poop; i++) { const q = poopXY(i); spr(g, 'poop', q.x, q.y); }
    if (this.anim && this.anim.type === 'clean') this.drawClean(this.anim, pw, ph, baseY);
    if (this.fxT > 0 && this.fxKind) { spr(g, this.fxKind, this.petX + pw / 2 - 3, baseY - 8 - (6 - this.fxT) * 2); if (this.frame % 3 === 0) this.fxT--; }
  }
  /** 杯子：先畫整杯，再把喝掉的茶水列塗回背景色；喝光後不再冒煙。 */
  drawCup(a: any) {
    const g = this.g;
    spr(g, a.sprite, a.fx, a.fy);
    const drained = CUP_LIQUID.rows.length - a.level;
    g.fillStyle = this.pet?.sleeping ? PAL[2] : PAL[0];
    for (let k = 0; k < drained; k++) g.fillRect(Math.round(a.fx + CUP_LIQUID.x0), Math.round(a.fy + CUP_LIQUID.rows[k]), CUP_LIQUID.x1 - CUP_LIQUID.x0 + 1, 1);
    if (a.level === 0) g.fillRect(Math.round(a.fx), Math.round(a.fy), 6, 2);
  }
  drawTornado(tx: number, top: number, bot: number) {
    const g = this.g, hgt = bot - top;
    for (let j = 0; j < hgt; j++) {
      const w = Math.max(2, Math.round(16 - j * 14 / hgt)), cx = tx + 8 + Math.round(Math.sin(j / 4 + this.frame * 0.9) * 2);
      for (let i = 0; i < w; i++) { const k = (i + j + this.frame) % 4; if (k === 3) continue; g.fillStyle = k === 0 ? PAL[3] : PAL[2]; g.fillRect(cx - (w >> 1) + i, top + j, 1, 1); }
    }
  }
  drawClean(a: any, pw: number, ph: number, baseY: number) {
    const g = this.g, frame = this.frame, petX = this.petX;
    if (a.phase === 'tornado') {
      for (const it of a.items) if (!it.lifted) spr(g, 'poop', it.x, it.y);
      this.drawTornado(a.tx, HUD + 2, GROUND);
      for (const it of a.items) if (it.lifted) { it.ang += 0.7; const px = a.tx + 5 + Math.cos(it.ang) * 15, py = HUD + 4 + Math.sin(it.ang) * 5; g.fillStyle = PAL[0]; g.fillRect(px - 1, py - 1, 9, 7); spr(g, 'poop', px, py); }
      return;
    }
    const front = a.phase === 'soap' || a.phase === 'rinse' ? -10 + a.t * 12 : W + 20;
    const bubbles = [[1, 3], [pw - 4, 2], [2, ph - 6], [pw - 5, ph - 7], [pw / 2 - 2, -2], [pw / 2, ph / 2 - 2]];
    if (a.phase === 'soap') {
      for (let x = 0; x < Math.min(W, front); x++) {
        const crest = GROUND - 2 - (x > front - 6 ? front - x : 0) + Math.round(Math.sin((x + frame * 3) / 3));
        g.fillStyle = PAL[1]; g.fillRect(x, crest, 1, H - crest);
        if ((x + frame) % 7 === 0) spr(g, 'bubble', x - 1, crest - 3 - ((x * 3 + frame) % 5));
      }
      if (front > petX + pw / 2) bubbles.forEach(([bx, by], i) => { if ((frame + i) % 6 !== 0) spr(g, 'bubble', petX + bx, baseY + by); else { g.fillStyle = PAL[2]; g.fillRect(petX + bx + 1, baseY + by + 1, 2, 2); } });
    } else if (a.phase === 'rinse') {
      for (let x = 0; x < Math.min(W, front); x++) {
        const crest = GROUND - 7 + Math.round(Math.sin((x + frame * 4) / 2.5));
        g.fillStyle = (x + frame) % 3 ? PAL[2] : PAL[1]; g.fillRect(x, crest, 1, 1);
        g.fillStyle = PAL[1]; for (let y = crest + 2; y < H; y += 2) if ((x + y + frame) % 4 === 0) g.fillRect(x, y, 1, 1);
      }
      if (front <= petX + pw / 2) bubbles.forEach(([bx, by]) => spr(g, 'bubble', petX + bx, baseY + by));
      else bubbles.slice(0, Math.max(0, 6 - Math.floor((front - petX) / 6))).forEach(([bx, by]) => spr(g, 'bubble', petX + bx, baseY + by - 3));
    } else if (a.phase === 'shake') {
      for (let k = 0; k < 4; k++) { const d = (a.t + k * 2) % 6; g.fillStyle = PAL[2]; g.fillRect(petX + (k % 2 ? pw + d : -d - 1), baseY + 3 + k * 3, 1, 1); }
      spr(g, 'sparkle', petX + pw - 1, baseY - 6 + (a.t % 2)); if (a.t > 3) spr(g, 'sparkle', petX - 5, baseY - 2);
    }
  }
}
void S;
