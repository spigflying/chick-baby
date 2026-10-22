import { TopTip, tipText, evoProgress, evoEta, type TopKey } from './topTip';
import { STAT_KEYS, hudTarget, statHelp, evoHelp, EVO_HELP, EVO_LINE_TRACK, EVO_LINE_TRACK_SLEEP } from './statHelp';
import { ANCHOR, PAL, S, spr, sw, sh, num, speciesSprite, spriteCanvas, SPECIES_LABEL, FOOD_SPRITE, CUP_LIQUID, petSpriteKey, frontSprite, coinHtml } from './sprites';
import { ACCESSORIES, OUTFITS, OUTFIT_IDS, isAccId } from '@chick/engine';
import { GuestWalkers, guestsOf, guestSprite, lanes, spriteH, spriteW, type PresenceUser } from './visitors';
import { drawShell, SHELL_COLORS, eggE, EGG_SAFE_E } from './shell';
import { fitWidth, FIT_KEEP_EGG } from './eggfit';
import { accessoryLine } from './accLine';
import { act, api, errText } from './api';
import { savePetCache } from './sleep';
import type { Live } from './ws';
import { StairsClient } from './stairs';
import { boardHtml, stairsResultHtml, type Board } from './board';
import { inviteHtml, inviterHtml, multiResultHtml, raceNotice, rankText, stairsNotice, type StairsInvite } from './mstairs';
import { trackById } from '@chick/engine';
import { fightBlocker, inviteSecs, resultInput, lockSecs, coinStr, hintFor, padPress, controlMode, petKey, PadState, lerpFighters, NOTICE_TEXT, resultText, HINT, showFightbar, nextEquip, itemHud, resultView, diffFx, RESULT_AUTO_MS, ITEM_INFO, ITEM_ORDER, type ArenaMsg, type FSnap, type Pad, type ResultMsg } from './fight';

const W = 120, H = 100, GROUND = 86, HUD = 14;
const MARK = '#ee4266'; // 自己的標記：和綠色螢幕對比
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
  menu: null | 'feed' | 'status' | 'hatch' | 'result' | 'shop' | 'board' = null; menuSel = 0; menuHtml = '';
  frame = 0; petX = 42; petDir = 1; anim: any = null; fxT = 0; fxKind: string | null = null;
  busy = false;
  stairs: StairsClient | null = null;
  private timer = 0; private off: (() => void)[] = [];
  private hatchPick = 'chicken';
  guests: PresenceUser[] = []; guestExtra = 0; private walkers = new GuestWalkers();
  // ---------- v1.4 打架模式 ----------
  arena: { prev: ArenaMsg | null; cur: ArenaMsg; at: number } | null = null;
  navOpen = false; private padState = new PadState(); private lastJoin = 0; private myPresence: PresenceUser | null = null;
  // v1.5：決勝瞬間凍結、結算畫面、打擊特效、道具
  frozen = false; private frozenAt = 0; result: ResultMsg | null = null; private resultTimer = 0; private resultAt = 0; private lockTimer = 0;
  invite: { id: string; from: string; from_name: string; to: string[]; until: number; answered: boolean } | null = null; private inviteTimer = 0;
  // M2 一起下樓梯：邀請（自己被邀請、或自己發起／已參加時保持連線）
  sinvite: StairsInvite | null = null; private sinviteTimer = 0;
  equip: string | null = null; myItems: Record<string, number> = {};
  private fxSwings: { u: string; kind: string; t: number }[] = []; private fxHits: { u: string; dmg: number; t: number }[] = [];
  private arenaFighters(): FSnap[] {
    const a = this.arena; if (!a || (Date.now() - a.at > 3500 && !this.frozen)) return [];
    if (this.frozen) return a.cur.fighters;
    return lerpFighters(a.prev, a.cur, (Date.now() - a.at) / 100);
  }
  private meFighter() { return this.arena?.cur.fighters.find((f) => f.u === this.ctx.me.id) ?? null; }
  mode() {
    const me = this.meFighter();
    return this.stairs ? 'stairs' : controlMode({ isOwner: this.isOwner, submenuOpen: !!this.menu, navOpen: this.navOpen, inArena: !!me, inFight: !!me?.fight, visitors: this.guests.length > 0 });
  }
  private sendPad() { this.ctx.live.send({ type: 'arena.input', ...this.padState.pad, equip: this.equip }); }
  cycleEquip() { const n = nextEquip(this.myItems, this.equip); if (n && n !== this.equip) { this.equip = n; this.sendPad(); this.updateControls(); } }
  private setPad(b: keyof Pad, v: boolean) { if (this.padState.set(b, v)) this.sendPad(); }
  /** 進家後：自己的寵物能打（活著、醒著、沒生病）就加入場地；斷線重連或負責的執行個體換人時自動重新加入。 */
  private ensureJoined() {
    if (this.stairs) return; // 下樓梯中暫時退出打架場地，比完再回來
    const p = this.myPresence?.pet;
    const ok = !!p && p.status === 'alive' && !p.sleeping && !p.sick;
    if (!ok || this.meFighter() || Date.now() - this.lastJoin < 3000) return;
    this.lastJoin = Date.now(); this.ctx.live.send({ type: 'arena.join' });
  }
  private updateControls() {
    const m = this.mode();
    const pet = m === 'pet' || m === 'nav';
    (this.$('.fightbar') as HTMLElement).hidden = !showFightbar(m);
    const hud = this.$('.itemhud'); const ht = pet ? itemHud(this.equip, this.myItems) : '';
    hud.hidden = !ht; if (hud.textContent !== ht) hud.textContent = ht;
    const h = this.$('.hint'); const txt = m === 'stairs' ? '' : hintFor(m as 'pet', matchMedia('(pointer:coarse)').matches) ?? '';
    h.hidden = !txt; if (h.textContent !== txt) h.textContent = txt;
    this.$('.navbtn').classList.toggle('on', this.navOpen);
    this.updateFightStat();
    if (m !== 'pet' && this.padState.clear()) this.sendPad();
  }
  /** v1.6：可不可以打（別人家顯示主人狀態與原因），並把「打架中」告訴閒置偵測。 */
  blocker(): string | null {
    const cur = this.arena?.cur, ownerId = this.home?.owner.id;
    const ownerP = this.isOwner ? null : (this.presenceAll.find((u) => u.id === ownerId) ?? null);
    return fightBlocker({ isOwner: this.isOwner, ownerPresent: !!ownerP, ownerAway: this.ownerAway, ownerPet: ownerP?.pet ?? this.pet,
      myPet: this.myPresence?.pet ?? null, cooldownMs: Math.max(0, (cur?.cooldown_ms ?? 0) - (Date.now() - (this.arena?.at ?? 0))),
      opponents: (cur?.fighters ?? []).filter((f) => f.u !== this.ctx.me.id).length, busy: !!cur?.fights.length || !!cur?.invite || !!this.invite });
  }
  private updateFightStat() {
    const el = this.$('.fightstat'), btn = this.$('.fightgo') as HTMLElement;
    const show = !this.stairs && this.home && (!this.isOwner || this.guests.length > 0);
    const cur = this.arena?.cur, me = this.meFighter();
    let txt = '';
    if (show) {
      if (this.result) txt = '結算中…';
      else if (me?.fight) txt = '對戰中！';
      else if (this.invite && this.invite.from === this.ctx.me.id) txt = `已發起戰鬥，等待回覆… ${inviteSecs(this.invite.until - Date.now())} 秒`;
      else if (cur?.fights.length) txt = '觀戰中（別人在打架）';
      else txt = this.blocker() ?? `可以發起戰鬥${matchMedia('(pointer:coarse)').matches ? '' : '（F）'}`;
    }
    el.hidden = !txt; if (el.textContent !== txt) el.textContent = txt;
    btn.classList.toggle('off', !!this.blocker() || !!me?.fight);
    this.ctx.live.inFight = !!me?.fight || !!this.invite || !!this.result;
  }
  /** F／「發起戰鬥」：先在前端說明不能打的原因，伺服器仍會再檢查。 */
  startInvite() {
    const why = this.blocker(); if (why) return this.say(why);
    if (!this.ctx.live.send({ type: 'arena.invite' })) this.say('連線中斷，稍後再試');
  }
  private showInvite() {
    const el = this.$('.invite'), v = this.invite;
    if (!v || v.answered || !v.to.includes(this.ctx.me.id)) { el.hidden = true; clearInterval(this.inviteTimer); return; }
    el.hidden = false;
    el.innerHTML = `<div class="it">${esc(v.from_name)} 發起戰鬥！</div><div class="ib"><button data-acc="1">參戰</button><button data-acc="0">觀戰</button></div><div class="ic">${inviteSecs(v.until - Date.now())} 秒後自動觀戰</div>`;
    clearInterval(this.inviteTimer);
    this.inviteTimer = window.setInterval(() => { const c = el.querySelector('.ic'); if (!this.invite) return this.showInvite(); if (c) c.textContent = `${inviteSecs(this.invite.until - Date.now())} 秒後自動觀戰`; this.updateFightStat(); if (Date.now() > this.invite.until) this.answerInvite(false, true); }, 250);
  }
  answerInvite(accept: boolean, silent = false) {
    const v = this.invite; if (!v || v.answered) return;
    v.answered = true;
    if (!silent) this.ctx.live.send({ type: 'arena.reply', invite: v.id, accept });
    this.say(accept ? '參戰！等其他人回覆…' : '觀戰中');
    this.showInvite(); this.updateFightStat();
  }
  onArena(m: any) {
    if (m.type === 'arena.state') {
      if (this.frozen && !m.frozen && Date.now() - this.frozenAt < 8000) return; // 結算畫面關掉前保持凍結
      const prev = this.arena?.cur ?? null; const wasFight = !!this.meFighter()?.fight;
      const fx = diffFx(prev?.fighters, m.fighters), now = Date.now();
      for (const x of fx.swings) this.fxSwings.push({ ...x, t: now });
      for (const x of fx.hits) this.fxHits.push({ ...x, t: now });
      if (fx.hits.length) this.shake();
      this.arena = { prev: m.frozen ? m : prev, cur: m, at: now };
      const me = m.fighters.find((f: FSnap) => f.u === this.ctx.me.id);
      if (me) { this.myItems = me.items ?? {}; if (!this.equip || !(this.myItems[this.equip] > 0)) this.equip = me.eq ?? nextEquip(this.myItems, null); }
      if (m.frozen && !this.frozen) { this.frozen = true; this.frozenAt = now; this.draw(true); }
      const nowFight = !!this.meFighter()?.fight;
      if (nowFight && !wasFight && this.isOwner) this.say('有人來挑戰！方向鍵移動、空白鍵啄');
      this.updateControls();
    } else if (m.type === 'arena.event' && m.kind === 'invite') {
      this.invite = { id: m.invite, from: m.from, from_name: m.from_name ?? '?', to: m.to ?? [], until: Date.now() + (m.left_ms ?? 10_000), answered: false };
      if (m.from === this.ctx.me.id) this.say('已發起戰鬥！等大家回覆（10 秒）');
      this.showInvite(); this.updateFightStat();
    } else if (m.type === 'arena.event' && m.kind === 'invite_cancel') {
      if (this.invite?.id === m.invite) { this.invite = null; this.showInvite(); }
      if (m.from === this.ctx.me.id || this.arena?.cur.fighters.some((f) => f.u === this.ctx.me.id)) this.ctx.toast(NOTICE_TEXT[m.code] ?? '戰鬥取消');
      this.updateFightStat();
    } else if (m.type === 'arena.event' && m.kind === 'start') { this.invite = null; this.showInvite(); this.ctx.toast(`${(m.names ?? [m.a, m.b]).join(' vs ')} 混戰開打！`); }
    else if (m.type === 'arena.event' && m.kind === 'ko') { if (m.user === this.ctx.me.id) this.say('被打倒了…觀戰中'); }
    else if (m.type === 'arena.result') {
      const nm = (id: string) => (this.arena?.cur.fighters.find((f) => f.u === id)?.name) ?? (id === this.home?.owner.id ? this.home.owner.display_name : this.guests.find((g) => g.id === id)?.display_name ?? '?');
      this.ctx.toast(resultText(m, nm));
      this.showResult(m);
    } else if (m.type === 'arena.notice') {
      const t = NOTICE_TEXT[m.code] ?? m.code;
      if (Date.now() - this.noticeAt > 2500) { this.noticeAt = Date.now(); this.say(t); }
    }
  }
  private noticeAt = 0;
  private shake() { const c = this.cv; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  /** 結算畫面：彩帶橫幅＋自己的金幣變化；輸家另外顯示「你輸了」與數據。點一下／按鍵／6 秒後關閉。 */
  showResult(r: ResultMsg) {
    const v = resultView(r, this.ctx.me.id);
    if (!v) { this.unfreeze(); return; }
    this.result = r;
    if (!this.frozen) { this.frozen = true; this.frozenAt = Date.now(); }
    const el = this.$('.fightres');
    el.className = `fightres ${v.role}`; el.hidden = false;
    el.innerHTML = `<canvas class="confetti" width="120" height="100"></canvas><div class="ribbon"><span>${esc(v.banner)}</span></div>`
      + (v.coin ? `<div class="coin">${esc(v.coin)}</div>` : '')
      + (v.lostLine ? `<div class="lost">${esc(v.lostLine)}</div>` : '')
      + (v.stats.length ? `<div class="stats">${v.stats.map(([k, x]) => `<div><b>${esc(k)}</b><span>${esc(x)}</span></div>`).join('')}</div>` : '')
      + (v.rows.length ? `<table class="rank"><tr><th>#</th><th>名字</th><th>分數</th><th>獎池</th><th>轉帳</th></tr>${v.rows.map((x) => `<tr class="${x.me ? 'me' : ''}"><td>${x.rank}</td><td>${esc(x.name)}</td><td>${x.score}</td><td>+${x.pool}</td><td>${x.transfer ? coinStr(x.transfer) : '—'}</td></tr>`).join('')}</table>` : '')
      + (v.net ? `<div class="net">${esc(v.net)}</div>` : '')
      + `<div class="tap">${lockSecs(0)} 秒後可關閉</div>`;
    this.resultAt = Date.now();
    clearInterval(this.lockTimer);
    this.lockTimer = window.setInterval(() => { const t = el.querySelector('.tap'); const e = Date.now() - this.resultAt; if (t) t.textContent = resultInput(e) === 'locked' ? `${lockSecs(e)} 秒後可關閉` : '點一下或按任意鍵繼續'; if (resultInput(e) !== 'locked') clearInterval(this.lockTimer); }, 200);
    this.confettiT = 0; this.drawConfetti();
    clearTimeout(this.resultTimer); this.resultTimer = window.setTimeout(() => this.dismissResult(), RESULT_AUTO_MS);
    if (r.parts.some((p) => p.u === this.ctx.me.id)) void this.refreshItems();
  }
  private confettiT = 0;
  private drawConfetti() {
    const c = this.el.querySelector('.fightres canvas.confetti') as HTMLCanvasElement | null; if (!c || !this.result) return;
    const g = c.getContext('2d')!; g.clearRect(0, 0, 120, 100);
    const cols = ['#ffffff', '#ffd23f', '#ee4266', '#3bceac', PAL[3]];
    for (let i = 0; i < 40; i++) { const x = (i * 37 + Math.sin(i + this.confettiT / 6) * 6) % 120, y = ((i * 23) % 100 + this.confettiT * (0.6 + (i % 5) * 0.2)) % 100; g.fillStyle = cols[i % cols.length]; g.fillRect(Math.round(x), Math.round(y), i % 3 ? 2 : 1, i % 2 ? 2 : 1); }
    this.confettiT++;
  }
  /** 使用者點／按鍵：前 3 秒忽略。 */
  tryDismissResult() { if (this.result && resultInput(Date.now() - this.resultAt) === 'dismiss') this.dismissResult(); }
  dismissResult() {
    if (!this.result) return;
    clearTimeout(this.resultTimer); clearInterval(this.lockTimer); this.result = null; this.$('.fightres').hidden = true; this.unfreeze(); this.updateFightStat();
  }
  private unfreeze() { this.frozen = false; }
  async refreshItems() { try { const r = await api('GET', '/items'); this.myItems = r.items ?? {}; if (this.equip && !(this.myItems[this.equip] > 0)) this.equip = nextEquip(this.myItems, null); this.updateControls(); if (this.menu === 'shop') this.renderMenu(); } catch { /* 下次 */ } }
  leaveArena() { if (this.meFighter()) this.ctx.live.send({ type: 'arena.leave' }); this.arena = null; }
  /** 畫場上的寵物（打架模式中的寵物改由伺服器快照決定位置）。 */
  drawArena(fs: FSnap[]) {
    const g = this.g, f = Math.floor(this.frame / 4) % 2, hpMax = this.arena?.cur.hp_max ?? 100;
    const now = Date.now();
    this.fxSwings = this.fxSwings.filter((s) => now - s.t < (s.kind === 'beam' ? 300 : 150));
    this.fxHits = this.fxHits.filter((s) => now - s.t < 700);
    for (const x of fs) {
      const flash = this.fxHits.some((h) => h.u === x.u && now - h.t < 120);
      if (x.inv > 0 && !flash && this.frame % 2 && !this.frozen) continue; // 無敵中閃爍
      const n = speciesSprite(x.sp, this.arena && !x.out ? (f ? 2 : 'w') : 1), w = sw(n), h = sh(n);
      const px = Math.max(0, Math.min(W - w, x.x + 6 - w / 2)) + (x.atk > 0 && x.sw !== 'beam' ? x.dir * 2 : 0), py = x.y + 12 - h; // 精靈置中在 12px 判定框上（判定框不變），靠牆時不超出畫面
      const spectator = !!this.arena?.cur.fights.length && !x.fight;
      if (x.out) g.globalAlpha = 0.35; else if (spectator) g.globalAlpha = 0.4;
      if (x.u === this.ctx.me.id) this.outline(n, px, py, x.dir > 0);
      if ((x.chg ?? 0) > 0) { g.fillStyle = this.frame % 2 ? '#ffffff' : '#ffd23f'; const r = 2 + Math.floor((x.chg ?? 0) / 8); g.fillRect(Math.round(px) - r, Math.round(py) - r, w + r * 2, h + r * 2); }
      spr(g, n, px, py, x.dir > 0);
      if (flash) this.whiteOut(n, px, py, x.dir > 0);
      g.globalAlpha = 1;
      for (const s of this.fxSwings) if (s.u === x.u) this.drawSwing(s.kind, x, now - s.t);
      if (x.fight) { g.fillStyle = PAL[3]; g.fillRect(Math.round(x.x), Math.round(py) - 4, 12, 3); g.fillStyle = PAL[1]; g.fillRect(Math.round(x.x) + 1, Math.round(py) - 3, Math.round(10 * x.hp / hpMax), 1); }
      const tagKey = x.u === this.home?.owner.id ? 'owner' : String(this.guests.findIndex((u) => u.id === x.u));
      if (tagKey !== '-1') this.tag(tagKey, px + w / 2, py - (x.fight ? 4 : 0));
      if (x.u === this.ctx.me.id) { // 自己：上下浮動的 ▼（對比色）
        const by = Math.round(py) - (x.fight ? 18 : 14) - (Math.floor(this.frame / 3) % 2 ? 1 : 0), cx = Math.round(px + w / 2);
        g.fillStyle = PAL[3]; for (let i = 0; i < 5; i++) g.fillRect(cx - 4 + i, by - 1 + i, 9 - i * 2, 1); // 淺色描邊
        g.fillStyle = MARK; for (let i = 0; i < 4; i++) g.fillRect(cx - 3 + i, by + i, 7 - i * 2, 1);
      }
    }
    for (const p of this.arena?.cur.proj ?? []) spr(g, 'poop', Math.round(p.x) - 3, Math.round(p.y) - 2);
    for (const hh of this.fxHits) { const x = fs.find((q) => q.u === hh.u); if (!x) continue; const k = (now - hh.t) / 700; this.drawDmg(hh.dmg, x.x + 1, x.y - 16 - k * 10); }
    const fights = this.arena?.cur.fights ?? [];
    if (fights.length) {
      const left = Math.max(0, fights[0].left_ms - (Date.now() - (this.arena?.at ?? 0)));
      g.fillStyle = PAL[0]; g.fillRect(W / 2 - 9, HUD + 1, 18, 7);
      num(g, Math.ceil(left / 1000), W / 2 - 7, HUD + 2);
    }
  }
  /** 自己的寵物外框（對比色）。 */
  private outline(n: string, x: number, y: number, flip: boolean) {
    const t = document.createElement('canvas'); t.width = sw(n); t.height = sh(n);
    const tg = t.getContext('2d')!; spr(tg, n, 0, 0, flip); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = MARK; tg.fillRect(0, 0, t.width, t.height);
    // 只留外框：四個方向位移的剪影，再挖掉原本的剪影
    const o = document.createElement('canvas'); o.width = t.width + 2; o.height = t.height + 2;
    const og = o.getContext('2d')!;
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) og.drawImage(t, dx, dy);
    og.globalCompositeOperation = 'destination-out'; og.drawImage(t, 1, 1);
    const a = this.g.globalAlpha; this.g.globalAlpha = 1;
    this.g.drawImage(o, Math.round(x) - 1, Math.round(y) - 1);
    this.g.globalAlpha = a;
  }
  /** 被打中：整隻變白。 */
  private whiteOut(n: string, x: number, y: number, flip: boolean) {
    const t = document.createElement('canvas'); t.width = sw(n); t.height = sh(n);
    const tg = t.getContext('2d')!; spr(tg, n, 0, 0, flip); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#ffffff'; tg.fillRect(0, 0, t.width, t.height);
    this.g.drawImage(t, Math.round(x), Math.round(y));
  }
  /** 揮擊視覺：啄＝白色弧線（範圍 14px）、上啄＝頭頂弧線、長劍＝大弧線（42px）、龜派氣功＝橫越場地的光束。 */
  private drawSwing(kind: string, x: FSnap, ms: number) {
    const g = this.g, cx = x.x + 6, cy = x.y + 6, d = x.dir;
    const arc = (r: number, a0: number, a1: number, col: string, th = 1) => {
      g.fillStyle = col;
      for (let a = a0; a <= a1; a += 0.08) for (let k = 0; k < th; k++) g.fillRect(Math.round(cx + Math.cos(a) * (r - k) * d), Math.round(cy + Math.sin(a) * (r - k)), 1, 1);
    };
    if (kind === 'peck') { const r = 8 + 12 * Math.min(1, ms / 50); arc(r + 1, -1.0, 1.0, PAL[3], 1); arc(r, -1.0, 1.0, '#ffffff', 2); }
    else if (kind === 'up') { g.fillStyle = '#ffffff'; for (let i = -6; i <= 6; i++) g.fillRect(Math.round(cx + i), Math.round(x.y - 2 - Math.sqrt(36 - i * i) * 0.8), 1, 2); }
    else if (kind === 'sword') { arc(42, -1.0, 0.7, PAL[3], 1); arc(40, -1.0, 0.7, '#ffffff', 2); }
    else if (kind === 'beam') { const x0 = d > 0 ? cx + 6 : 0, x1 = d > 0 ? W : cx - 6; g.fillStyle = PAL[3]; g.fillRect(Math.round(x0), Math.round(cy - 4), Math.round(x1 - x0), 8); g.fillStyle = '#ffffff'; g.fillRect(Math.round(x0), Math.round(cy - 2), Math.round(x1 - x0), 4); }
  }
  private drawDmg(n: number, x: number, y: number) {
    const g = this.g; g.fillStyle = '#ffffff'; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 4 + String(n).length * 4 + 1, 7);
    g.fillStyle = PAL[3]; g.fillRect(Math.round(x), Math.round(y) + 2, 2, 1); num(g, n, Math.round(x) + 3, Math.round(y));
  }

  /** v1.3：在場者的寵物同框。 */
  ownerAway = false; presenceAll: PresenceUser[] = [];
  setPresence(users: PresenceUser[], ownerAway = false) {
    if (!this.home) return;
    this.presenceAll = users;
    // v1.4：主人在別人家 → 寵物跟著出門；自己家只顯示「主人外出中」（自己看自己家不會發生）
    this.ownerAway = ownerAway && !this.isOwner;
    const g = guestsOf(users, this.home.owner.id);
    this.guests = g.shown; this.guestExtra = g.extra;
    this.myPresence = users.find((u) => u.id === this.ctx.me.id) ?? null;
    this.ensureJoined();
    const tags = this.$('.tags');
    // 名牌：寵物用主人取的寵物名；滑過顯示主人的暱稱（使用者自訂的 display_name，不是 Google 名稱）
    tags.innerHTML = `<span class="tag own" data-g="owner" title="${esc(this.home.owner.display_name)}">${this.ownerAway ? '主人外出中' : esc(this.pet?.name ?? this.home.owner.display_name)}</span>`
      + this.guests.map((u, i) => `<span class="tag" data-g="${i}" title="${esc(u.display_name)}">${u.pet ? esc(u.pet.name) + (u.pet.status === 'dead' ? '†' : '') : esc(u.display_name) + '·沒寵物'}</span>`).join('')
      + (this.guestExtra ? `<span class="tag more">+${this.guestExtra}</span>` : '');
  }
  private lanes() { return lanes(W, this.guests.length); }
  /** 主人寵物的活動範圍：有訪客時只用第 0 條跑道。 */
  private ownerRange(pw: number) { if (!this.guests.length) return { min: 8, max: W - pw - 22 }; const l = this.lanes()[0]; return { min: l.x0, max: Math.max(l.x0, l.x1 - pw) }; }
  private ownerCx() { if (!this.guests.length) return W / 2; const l = this.lanes()[0]; return (l.x0 + l.x1) / 2; }
  private tag(sel: string, cx: number, top: number) {
    const el = this.el.querySelector(`.tags [data-g="${sel}"]`) as HTMLElement | null; if (!el) return;
    el.style.left = `${(Math.max(14, Math.min(W - 14, cx)) / W) * 100}%`; el.style.top = `${(Math.max(HUD + 1, top - 7) / H) * 100}%`;
  }
  private inArena = new Set<string>();
  drawGuests() {
    const g = this.g, f = Math.floor(this.frame / 4) % 2, L = this.lanes();
    const names = this.guests.map((u) => guestSprite(u.pet, f));
    const xs = this.walkers.step(this.guests.map((u) => u.id), (i) => L[i + 1], (i) => spriteW(names[i]),
      (i) => this.frame % 3 === 0 && !!this.guests[i].pet && this.guests[i].pet!.status === 'alive' && !this.guests[i].pet!.sleeping);
    this.guests.forEach((u, i) => {
      if (this.inArena.has(u.id)) return;
      const n = names[i], w = spriteW(n), h = spriteH(n), x = xs[i];
      const y = n === 'ghost' ? GROUND - h - 4 + (f ? 0 : 2) : GROUND - h;
      if (n) spr(g, n, x, y, this.walkers.dir(u.id) > 0 && n !== 'ghost' && n !== 'egg' && !u.pet!.sleeping);
      if (u.pet?.sleeping) spr(g, 'z', x + w + 1, y - 5 - f * 2);
      if (u.pet?.sick && u.pet.status === 'alive') spr(g, 'skull', x - 6, y - 6 + f);
      this.tag(String(i), x + w / 2, n ? y - (ANCHOR[n]?.oy ?? 0) : GROUND - 4);
    });
  }
  private drawOwnerTag(cx: number, top: number) { this.tag('owner', cx, top); }

  constructor(private ctx: Ctx) {
    this.el = document.createElement('div');
    this.el.className = 'device';
    this.el.innerHTML = `<canvas class="shell"></canvas><div class="inner"><div class="brand">CHICK♥BABY</div><div class="lcd">
      <div class="lcd-top"><span data-k="name">—</span><span data-k="stage">—</span><span data-k="coins">${coinHtml(0)}</span><span data-k="age">—</span></div><div class="toptip" role="tooltip" hidden></div>
      <div class="scr"><canvas class="screen" width="${W}" height="${H}"></canvas><div class="tags"></div><div class="stathelp" role="tooltip" hidden></div><div class="itemhud" hidden></div><div class="menu" hidden></div><div class="fightres" hidden></div><div class="invite" hidden></div><div class="invite sinv" hidden></div></div>
      <p class="fightstat" hidden></p>
      <div class="labels"></div>
      <div class="fightbar" hidden><button data-pad="left" aria-label="左">◀</button><button data-pad="jump" aria-label="跳">▲</button><button data-pad="attack">啄</button><button data-pad="upAtk">上啄</button><button data-pad="item">道具</button><button data-pad="right" aria-label="右">▶</button><button class="navbtn">選單</button><button class="fightgo">發起戰鬥</button></div>
      <p class="hint" hidden></p>
      <div class="gamebar" hidden><button data-dir="left">◀</button><button class="quit">離開</button><button data-dir="right">▶</button></div>
      <p class="msg">…</p></div></div>`;
    this.cv = this.el.querySelector('canvas.screen')!; this.g = this.cv.getContext('2d')!;
    this.bind(); this.bindTopTip(); this.bindFit();
    this.timer = window.setInterval(() => this.loop(), 33);
    this.off.push(ctx.live.on((m) => this.onLive(m)));
  }
  /** 讓蛋殼永遠包住畫面：依內容實際高度，二分搜尋畫面寬度（佔蛋寬的比例），直到四個角都在彩色邊以內。 */
  private fitRaf = 0; private fitLcdH = -1;
  private bindFit() {
    const go = () => { cancelAnimationFrame(this.fitRaf); this.fitRaf = requestAnimationFrame(() => this.fitEgg()); };
    // 只看 .lcd 高度變化（顯示／隱藏按鈕列）；fitEgg 自己造成的變化（記在 fitLcdH）不再觸發，避免來回震盪
    const ro = new ResizeObserver(() => { if (this.$('.lcd').offsetHeight !== this.fitLcdH) go(); });
    ro.observe(this.$('.lcd')); window.addEventListener('resize', go);
    this.off.push(() => { ro.disconnect(); window.removeEventListener('resize', go); });
  }
  private shellSc: { palette: string[]; rim: string } | null = null;
  paintShell(sc: { palette: string[]; rim: string }) { this.shellSc = sc; drawShell(this.$('canvas.shell') as HTMLCanvasElement, sc.palette, sc.rim); }
  /**
   * 讓蛋殼永遠包住畫面，蛋的比例固定 40:56（不拉長）。依序嘗試：
   * 原本大小：畫面寬度在蛋寬 55–56% 之間微調 → 精簡模式 1（戰鬥按鈕 2 列、按鈕高 36px）→ 精簡模式 2（字再小一點）
   * → 畫面縮窄到蛋寬的 FIT_KEEP_EGG；都放不下才把整顆蛋等比例放大（最多到視窗寬 96%，頁面可捲動）。
   * v1.8：先試精簡模式再放大——進別人家（多了戰鬥按鈕列）時蛋不會整個變大。
   */
  fitEgg() {
    const dev = this.el;
    dev.style.width = ''; dev.classList.remove('fit1', 'fit2');
    const base = dev.getBoundingClientRect().width; if (!base) return;
    const maxW = Math.max(base, Math.min(document.documentElement.clientWidth * 0.96, 900));
    const done = () => { this.fitLcdH = this.$('.lcd').offsetHeight; };
    const level = (n: number) => { dev.classList.toggle('fit1', n >= 1); dev.classList.toggle('fit2', n >= 2); };
    for (const n of [0, 1, 2]) { level(n); if (this.fitInner(0.55)) return done(); }
    if (this.fitInner(FIT_KEEP_EGG)) return done(); // 蛋維持原本大小，畫面窄一點
    for (let w = base * 1.08; ; w = Math.min(maxW, w * 1.08)) {
      dev.style.width = `${Math.round(w)}px`;
      if (this.fitInner(0.55)) return done();
      if (w >= maxW) break;
    }
    dev.style.width = `${Math.round(maxW)}px`; this.fitInner(0.3); done(); // 最後手段：畫面再窄一點
  }
  private fitInner(min: number): boolean {
    const inner = this.$('.inner'), dev = this.el;
    const D = dev.getBoundingClientRect(); if (!D.width) return true;
    const fits = (w: number) => {
      inner.style.left = inner.style.right = `${((1 - w) / 2) * 100}%`;
      // 垂直置中在蛋最寬的地方（0.54），但不高過原本的 26.5%
      inner.style.top = `${Math.max(26.5, 54 - (inner.offsetHeight / D.height) * 50)}%`;
      for (const el of [this.$('.brand'), this.$('.lcd')]) {
        const r = el.getBoundingClientRect(), pad = el.classList.contains('lcd') ? 8 : 0; // .lcd 的外框陰影 4+4px
        for (const [x, y] of [[r.left - pad, r.top - pad], [r.right + pad, r.top - pad], [r.left - pad, r.bottom + pad], [r.right + pad, r.bottom + pad]])
          if (eggE((x - D.left) / D.width, (y - D.top) / D.height) > EGG_SAFE_E) return false;
      }
      return true;
    };
    return fits(fitWidth(fits, undefined, min));
  }
  destroy() { this.leaveArena(); clearInterval(this.timer); this.off.forEach((f) => f()); this.stairs?.leave(); document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKeyUp); }
  $(s: string) { return this.el.querySelector(s) as HTMLElement; }
  say(t: string) { this.$('.msg').textContent = t; }

  setHome(view: { home: any; pet: any; visitor: any }) {
    const first = !this.home || this.home.id !== view.home.id;
    this.home = view.home; this.isOwner = !!view.home.is_owner; this.visitor = view.visitor;
    this.setPet(view.pet);
    const sc = SHELL_COLORS[this.pet?.species ?? 'chicken'];
    this.paintShell(sc);
    this.$('.brand').textContent = this.isOwner ? 'CHICK♥BABY' : `${view.home.owner.display_name} 的家`;
    if (first) this.say(this.isOwner ? (this.pet ? `歡迎回家！` : '還沒有寵物，點「孵蛋」選一隻吧！') : `來 ${view.home.owner.display_name} 家玩～`);
  }
  setPet(p: any) {
    const prevSpecies = this.pet?.species;
    if (p?.bao && p.status === 'alive') this.celebrateEvolve(p);
    this.pet = p;
    if (this.isOwner) savePetCache(localStorage, p); // 休息時段的畫面用
    if (p && prevSpecies && prevSpecies !== p.species) { const sc = SHELL_COLORS[p.species]; this.paintShell(sc); }
    this.buildCells(); this.renderTop(); if (this.menu === 'status') this.renderMenu();
    const ot = this.el.querySelector('.tags [data-g="owner"]'); if (ot && this.home) ot.textContent = this.ownerAway ? '主人外出中' : this.pet?.name ?? this.home.owner.display_name;
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
        { act: 'clean', icon: 'i_wash', label: '清潔' }, { act: 'doctor', icon: 'i_doc', label: '醫生' }, { act: 'shop', icon: 'i_shop', label: '道具' }, { act: 'status', icon: 'i_stat', label: '狀態' }];
    } else if (!p || p.status !== 'alive') cells = [{ act: 'status', icon: 'i_stat', label: '狀態' }, { act: 'play', icon: 'i_play', label: '樓梯' }, { act: 'home', icon: 'i_home', label: '回家' }];
    else cells = [{ act: 'feed', icon: 'i_feed', label: '餵食' }, { act: 'play', icon: 'i_play', label: '樓梯' }, { act: 'shop', icon: 'i_shop', label: '道具' }, { act: 'status', icon: 'i_stat', label: '狀態' }, { act: 'home', icon: 'i_home', label: '回家' }];
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
  // ---------- 上方狀態圖示的說明（canvas HUD 列，點一下開／點別處關）----------
  private statShown = -1; private statClosedByDown = -1;
  /** 點到 HUD 第幾個狀態（0–4）、HUD 下方那條線（EVO_HELP，進化進度），或 -1；只有一般畫面（非下樓梯）、活著的寵物才有 HUD。 */
  hudStat(e: { clientX: number; clientY: number }) {
    if (this.stairs || this.pet?.status !== 'alive') return -1;
    const r = this.cv.getBoundingClientRect(); if (!r.width) return -1;
    const t = hudTarget((e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height);
    return t === EVO_HELP && !evoProgress(this.pet) ? -1 : t;
  }
  private onStatDocDown = (e: PointerEvent) => {
    this.statClosedByDown = -1;
    if (this.statShown < 0) return;
    // 點同一個圖示／同一條線，或點在說明框上 → 只關掉（說明框消失後 click 會落到 canvas，不要又打開）
    const onSame = (e.target === this.cv && this.hudStat(e) === this.statShown) || !!(e.target as HTMLElement)?.closest?.('.stathelp');
    this.statClosedByDown = onSame ? this.statShown : -1; // 點同一個圖示 → 這次按下關掉，接著的 click 不要再打開
    this.hideStatHelp();
  };
  hideStatHelp() { this.statShown = -1; const el = this.el.querySelector<HTMLElement>('.stathelp'); if (el) el.hidden = true; }
  toggleStatHelp(i: number) {
    if (this.statClosedByDown === i) { this.statClosedByDown = -1; return; }
    this.statClosedByDown = -1;
    const h = i === EVO_HELP ? evoHelp(this.pet) : statHelp(STAT_KEYS[i]), el = this.$('.stathelp');
    el.innerHTML = `<b>${esc(h.name)}</b>` + h.lines.map((l) => `<p>${esc(l)}</p>`).join('');
    el.hidden = false; this.statShown = i;
    // 對齊到圖示下方，不超出螢幕
    const scr = this.$('.scr').getBoundingClientRect(), x = i === EVO_HELP ? scr.width / 2 : ((1 + i * 24 + 6) / W) * scr.width;
    el.style.top = `${(17 / H) * scr.height}px`; // 在進化線的點擊範圍下面，不擋住線
    el.style.left = `${Math.max(0, Math.min(scr.width - el.offsetWidth, x - el.offsetWidth / 2))}px`;
  }
  private topTip = new TopTip(() => this.showTopTip());
  private onDocDown = (e: PointerEvent) => { if (!(e.target as HTMLElement)?.closest?.('.lcd [data-k]')) this.topTip.outside(); };
  private bindTopTip() {
    this.el.querySelectorAll<HTMLElement>('.lcd-top [data-k]').forEach((s) => {
      const k = s.dataset.k as TopKey;
      s.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.topTip.hover(k); });
      s.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.topTip.leave(k); });
      s.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      s.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (this.topTip.shown === k && matchMedia('(hover:hover)').matches) return; this.topTip.tap(k); });
    });
    document.addEventListener('pointerdown', this.onDocDown);
    this.off.push(() => { document.removeEventListener('pointerdown', this.onDocDown); this.topTip.outside(); });
  }
  private showTopTip() {
    const tip = this.$('.toptip'), k = this.topTip.shown;
    if (!k) { tip.hidden = true; return; }
    const s = this.$(`.lcd [data-k="${k}"]`);
    tip.textContent = tipText(k, k === 'evo' ? evoProgress(this.pet)?.text ?? '' : s.textContent ?? '', this.pet?.status === 'egg');
    tip.hidden = false;
    const lcd = this.$('.lcd').getBoundingClientRect(), r = s.getBoundingClientRect();
    tip.style.top = `${r.bottom - lcd.top + 4}px`;
    const left = Math.min(Math.max(0, r.left - lcd.left + r.width / 2 - tip.offsetWidth / 2), lcd.width - tip.offsetWidth);
    tip.style.left = `${Math.max(0, left)}px`;
  }
  renderTop() {
    const p = this.pet, t = (k: string, v: string) => { this.$(`[data-k="${k}"]`).textContent = v; };
    t('name', p ? p.name : this.isOwner ? '空巢' : '沒有寵物');
    t('stage', !p ? '—' : p.status === 'dead' ? '天堂' : p.status === 'egg' ? '蛋' : SPECIES_LABEL[p.species]);
    this.$('[data-k="coins"]').innerHTML = coinHtml(this.ctx.wallet());
    if (p) {
      const a = Math.max(0, Math.floor((Date.now() - (p.hatched_at ?? p.born_at)) / 60000));
      t('age', p.status === 'egg' ? `${Math.max(0, Math.ceil((p.hatch_at - this.ctx.live.serverNow()) / 1000))}秒` : a < 60 ? a + '分' : a < 1440 ? Math.floor(a / 60) + '時' : Math.floor(a / 1440) + '天');
    } else t('age', '—');
    // 進化說明框：下樓梯中、或沒有進度（蛋／死亡）時關掉
    if (this.statShown === EVO_HELP && (this.stairs || !evoProgress(p))) this.hideStatHelp();
    if (this.topTip.shown) this.showTopTip();
  }

  // ---------- 輸入 ----------
  private onKey = (e: KeyboardEvent) => {
    if (!this.el.isConnected || (document.getElementById('dlg') as HTMLDialogElement).open) return;
    if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
    const k = e.key;
    if (this.stairs) {
      if (k === 'Escape' && this.stairsOut()) { e.preventDefault(); this.endStairsView(); return; } // 多人：出局後可以先離開，結果用 toast
      if (this.stairs.key(k, true)) e.preventDefault(); return;
    }
    if (this.sinvite && !this.sinvite.answered && this.sinvite.to.includes(this.ctx.me.id) && !this.$('.sinv').hidden) {
      if (k === 'Enter' || k === 'y' || k === 'Y' || k === '1') { e.preventDefault(); this.answerSInvite(true); return; }
      if (k === 'Escape' || k === 'n' || k === 'N' || k === '2') { e.preventDefault(); this.answerSInvite(false); return; }
    }
    if (this.result) { e.preventDefault(); if (!e.repeat) this.tryDismissResult(); return; }
    if (this.invite && !this.invite.answered && this.invite.to.includes(this.ctx.me.id) && !this.$('.invite').hidden) {
      if (k === 'Enter' || k === 'y' || k === 'Y' || k === '1') { e.preventDefault(); this.answerInvite(true); return; }
      if (k === 'Escape' || k === 'n' || k === 'N' || k === '2') { e.preventDefault(); this.answerInvite(false); return; }
    }
    if ((k === 'f' || k === 'F') && !e.repeat && !this.menu && (!this.isOwner || this.guests.length > 0)) { e.preventDefault(); this.startInvite(); return; }
    const mode = this.mode();
    if (mode === 'pet') {
      const b = petKey(k); if (!b) return;
      e.preventDefault(); if (e.repeat) return;
      if (b === 'nav') { this.navOpen = true; this.updateControls(); return; }
      if (b === 'cycle') { this.cycleEquip(); return; }
      this.setPad(b, true); return;
    }
    if (mode === 'nav' && k === 'Escape') { this.navOpen = false; this.updateControls(); e.preventDefault(); return; }
    if (this.menu) {
      if (k === 'Escape' || k === 'Backspace') this.closeMenu();
      else if ((this.menu === 'feed' || this.menu === 'shop') && (k === 'ArrowUp' || k === 'ArrowDown')) { const n = this.menu === 'feed' ? this.ctx.cfg.foods.length : ITEM_ORDER.length + OUTFIT_IDS.length; this.menuSel = (this.menuSel + (k === 'ArrowUp' ? n - 1 : 1)) % n; this.renderMenu(); }
      else if (this.menu === 'board' && (k === 'Enter' || k === ' ')) { this.closeMenu(); if (this.isOwner) this.startStairs(); else this.startMulti(); }
      else if (k === 'Enter' || k === ' ') { if (this.menu === 'feed') this.chooseFood(this.ctx.cfg.foods[this.menuSel]); else if (this.menu === 'shop') void this.shopPick(this.menuSel); else this.closeMenu(); }
      else return;
    } else if (k === 'ArrowLeft') { this.sel = (this.sel + this.cells.length - 1) % this.cells.length; this.drawCells(); }
    else if (k === 'ArrowRight') { this.sel = (this.sel + 1) % this.cells.length; this.drawCells(); }
    else if (k === 'Enter' || k === ' ') this.activate(this.sel);
    else return;
    e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (this.stairs) return void this.stairs.key(e.key, false);
    const b = petKey(e.key); if (b && b !== 'nav' && b !== 'cycle') this.setPad(b, false);
  };
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
      if (this.menu === 'board') { if (t.closest('[data-go]')) { this.closeMenu(); this.startStairs(); } else if (t.closest('[data-multi]')) { this.closeMenu(); this.startMulti(); } else if (t.closest('[data-race]')) { this.closeMenu(); this.startRace(); } else if (t.closest('.back')) this.closeMenu(); return; }
      if (this.menu === 'shop') { const it = t.closest('.mi') as HTMLElement | null; if (!it) return; const i = +it.dataset.i!; if (i < 0) return this.closeMenu(); this.menuSel = i; return void this.shopPick(i); }
      this.closeMenu();
    });
    this.cv.addEventListener('click', (e) => { const i = this.hudStat(e); if (i >= 0 && !this.menu) return void this.toggleStatHelp(i); if (!this.stairs && this.menu) this.closeMenu(); });
    document.addEventListener('pointerdown', this.onStatDocDown); // 不 stopPropagation（idle.ts 看 window pointerdown）
    this.off.push(() => document.removeEventListener('pointerdown', this.onStatDocDown));
    this.$('.fightres').addEventListener('click', () => this.tryDismissResult());
    this.$('.invite').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-acc]') as HTMLElement | null; if (b) this.answerInvite(b.dataset.acc === '1'); });
    this.$('.sinv').addEventListener('click', (e) => {
      const t = e.target as HTMLElement, b = t.closest('[data-sacc]') as HTMLElement | null; if (b) return this.answerSInvite(b.dataset.sacc === '1');
      if (t.closest('[data-scancel]')) this.cancelSInvite();
    });
    // fightbar 的 touchstart 有 preventDefault（擋長按選字），手機不會產生 click → 用 pointerup
    this.$('.fightgo').addEventListener('pointerup', (e) => { if (e.button > 0) return; this.startInvite(); });
    this.el.querySelectorAll<HTMLElement>('.gamebar [data-dir]').forEach((b) => {
      const d = b.dataset.dir as 'left' | 'right';
      const set = (v: boolean) => (e: Event) => { e.preventDefault(); this.stairs?.setDir(d, v); };
      b.addEventListener('pointerdown', set(true)); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, set(false)));
    });
    this.$('.gamebar .quit').addEventListener('click', () => { if (this.stairsOut()) this.endStairsView(); else this.stairs?.quit(); });
    this.el.querySelectorAll<HTMLElement>('.fightbar [data-pad]').forEach((b) => {
      const d = b.dataset.pad as keyof Pad;
      // 手機：按住移動要靠 pointer capture（手指稍微滑出按鈕也不會放開）；touchstart preventDefault（非 passive）
      // 擋掉 iOS 長按選字／放大鏡／callout（那會觸發 pointercancel，寵物就停住）與雙擊縮放
      const down = (e: PointerEvent) => {
        e.preventDefault(); // 不要 stopPropagation：閒置偵測要看到這一下
        try { b.setPointerCapture(e.pointerId); } catch { /* 舊瀏覽器 */ }
        const r = padPress(this.mode(), true);
        if (r.exitNav) { this.navOpen = false; this.updateControls(); }
        if (r.apply) this.setPad(d, true);
        b.classList.add('down');
      };
      const up = (e: Event) => { e.preventDefault(); this.setPad(d, false); b.classList.remove('down'); };
      b.addEventListener('pointerdown', down);
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, up));
      b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    this.$('.fightbar').addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.$('.navbtn').addEventListener('click', () => { this.navOpen = !this.navOpen; this.updateControls(); });
    this.$('.navbtn').addEventListener('touchend', (e) => { e.preventDefault(); this.navOpen = !this.navOpen; this.updateControls(); }, { passive: false });
    // 滑鼠：和下樓梯一樣，左鍵按住往左、右鍵按住往右
    this.cv.addEventListener('pointerdown', (e) => { if (this.mode() !== 'pet' || e.pointerType !== 'mouse' || this.hudStat(e) >= 0) return; if (e.button === 0) this.setPad('left', true); else if (e.button === 2) this.setPad('right', true); });
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') return; this.setPad('left', false); this.setPad('right', false); });
    this.cv.addEventListener('contextmenu', (e) => { if (this.mode() === 'pet') e.preventDefault(); });
    const scr = this.$('.scr');
    scr.addEventListener('pointerdown', (e) => { if (!this.stairs || e.pointerType !== 'mouse') return; if (e.button === 0) this.stairs.setDir('left', true); else if (e.button === 2) this.stairs.setDir('right', true); });
    window.addEventListener('pointerup', (e) => { if (!this.stairs || e.pointerType !== 'mouse') return; if (e.button === 0) this.stairs.setDir('left', false); else if (e.button === 2) this.stairs.setDir('right', false); });
    scr.addEventListener('contextmenu', (e) => { if (this.stairs) e.preventDefault(); });
  }

  activate(i: number) {
    if (this.stairs) return;
    if (this.navOpen) { this.navOpen = false; setTimeout(() => this.updateControls()); }
    this.sel = i; this.drawCells();
    const a = this.cells[i]?.act; const p = this.pet;
    if (a === 'status') return this.openMenu('status');
    if (a === 'shop') { if (this.meFighter()?.fight) return this.say('對戰中不能買道具'); this.openMenu('shop'); void this.refreshItems(); void this.refreshOutfits(); return; }
    if (a === 'home') return this.ctx.goHome();
    if (a === 'hatch') return this.openMenu('hatch');
    if (a === 'play' && !this.isOwner) return this.openBoard(); // 訪客：只能一起下樓梯（用自己的寵物）
    if (!p) return;
    if (p.status === 'egg') return this.say('蛋蛋還在孵化中…');
    if (p.status === 'dead') return this.say(`${p.name} 去當小天使了…`);
    if (this.anim) return this.say(this.anim.type === 'clean' ? '正在洗澎澎，等一下～' : '正在吃東西，等一下～');
    if (a === 'feed' && this.ownerAway) return this.say('主人帶寵物出門了，等牠回來再餵吧');
    if (a === 'feed') { if (p.sleeping) return this.say('噓…牠在睡覺，先叫醒牠吧。'); return this.openMenu('feed'); }
    if (a === 'play') return this.openBoard();
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
    } catch (e) {
      this.say(errText(e));
      // 畫面上的狀態可能過期（例如睡飽自動起床）：重新抓一次寵物
      try { const me = await api('GET', '/me'); if (me?.pet && me.pet.id === this.pet?.id) this.setPet(me.pet); } catch { /* 忽略 */ }
    }
    finally { this.busy = false; }
  }
  pendingPet: any = null;
  fx(k: string) { this.fxKind = k; this.fxT = 6; }
  /** v1.7 寶：進化瞬間的閃光（約 3 秒）＋訊息；每隻寵物只演一次（localStorage）。 */
  evoT = 0;
  celebrateEvolve(p: any) {
    const st = p.bao_stage ?? 1, key = st > 1 ? `bao-seen:${p.id}:${st}` : `bao-seen:${p.id}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* 無痕模式 */ }
    this.evoT = 36; setTimeout(() => this.say(st > 1 ? `${p.name}又進化了！（第 ${st} 次）` : `${p.name}進化成寶了！`), 0); // 晚一點說，避免被「歡迎回家」蓋掉
  }
  private drawEvolve(pw: number, ph: number, baseY: number) {
    const g = this.g, t = 36 - this.evoT;
    if (this.evoT > 24 && t % 2 === 0) { g.fillStyle = PAL[0]; g.globalAlpha = 0.6; g.fillRect(this.petX - 3, baseY - 3, pw + 6, ph + 3); g.globalAlpha = 1; }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + t * 0.25, r = 6 + (t % 12);
      spr(g, 'sparkle', Math.round(this.petX + pw / 2 - 2 + Math.cos(a) * (pw / 2 + r)), Math.round(baseY + ph / 2 - 2 + Math.sin(a) * (ph / 2 + r / 2)));
    }
    if (this.frame % 2 === 0) this.evoT--;
  }

  // ---------- 選單 ----------
  openMenu(m: 'feed' | 'status' | 'hatch' | 'shop') { this.hideStatHelp(); this.menu = m; this.menuSel = m === 'feed' ? (this.isOwner ? 0 : 1) : 0; this.renderMenu(); }
  closeMenu() { this.menu = null; this.navOpen = false; this.renderMenu(); this.updateControls(); }
  renderMenu() {
    const el = this.$('.menu');
    if (!this.menu) { el.hidden = true; return; }
    el.hidden = false;
    const p = this.pet, coins = this.ctx.wallet(), cfg = this.ctx.cfg;
    if (this.menu === 'board') { el.innerHTML = boardHtml(this.board, this.boardErr, { solo: this.isOwner, multi: this.othersHere() > 0, race: true }); return; }
    if (this.menu === 'feed') {
      const v = this.visitor, f = cfg.game.feed;
      el.innerHTML = `<div class="mt">— 餵食 —  ${coinHtml(coins)}</div>` + cfg.foods.map((fd: any, i: number) => {
        const blocked = (!this.isOwner && (!fd.visitorAllowed || fd.price === 0)) || fd.price > coins;
        return `<div class="mi${i === this.menuSel ? ' on' : ''}${blocked ? ' off' : ''}" data-i="${i}"><span>${i === this.menuSel ? '▶' : '　'}${esc(fd.name)}${fd.drink ? '<small>飲料</small>' : fd.snack ? '<small>點心</small>' : ''}</span><em>${fd.price ? coinHtml(fd.price) : '免費'}</em></div>`;
      }).join('') +
        (this.isOwner ? '' : `<div class="note">今天你餵了 ${v?.today_mine ?? 0}/${f.visitorDailyPerVisitorPerPet}・全部訪客 ${v?.today_pet_total ?? 0}/${f.visitorDailyPerPet}</div>`) +
        '<div class="mi back" data-i="-1">✕ 關閉</div>';
    } else if (this.menu === 'shop') {
      el.innerHTML = `<div class="mt">— 道具店 —  ${coinHtml(coins)}</div>` + ITEM_ORDER.map((id, i) => {
        const it = ITEM_INFO[id], own = this.myItems[id] ?? 0;
        return `<div class="mi${i === this.menuSel ? ' on' : ''}${it.price > coins ? ' off' : ''}" data-i="${i}"><span>${i === this.menuSel ? '▶' : '　'}${esc(it.name)}<small>${it.fights}場</small>${own ? `<small>有${own}場</small>` : ''}</span><em>${coinHtml(it.price)}</em></div>`;
      }).join('') + '<div class="mt">— 服飾 —</div>' + OUTFIT_IDS.map((id, j) => {
        const i = ITEM_ORDER.length + j, o = OUTFITS[id], own = this.myOutfits.includes(id), on = (this.pet?.outfits ?? []).includes(id);
        return `<div class="mi${i === this.menuSel ? ' on' : ''}${!own && o.price > coins ? ' off' : ''}" data-i="${i}"><span>${i === this.menuSel ? '▶' : '　'}${esc(o.name)}${own ? `<small>${on ? '穿著' : '已擁有'}</small>` : ''}</span><em>${own ? (on ? '脫下' : '穿上') : coinHtml(o.price)}</em></div>`;
      }).join('') + `<div class="note">${esc(this.menuSel < ITEM_ORDER.length ? (ITEM_INFO[ITEM_ORDER[this.menuSel]]?.desc ?? '') + '・Z 使用、X 切換' : '服飾買一次永久擁有，可隨時穿脫；頭上、臉上各穿一件')}</div><div class="mi back" data-i="-1">✕ 關閉</div>`;
    } else if (this.menu === 'status') {
      if (!p) { el.innerHTML = '<div class="mt">— 狀態 —</div><p>還沒有寵物。</p><div class="mi back">✕ 關閉</div>'; return; }
      const row = (k: string, v: unknown) => `<div><b>${k}</b><span>${v}</span></div>`;
      const born = new Date(p.born_at);
      el.innerHTML = '<div class="mt">— 狀態 —</div><div class="front"></div><div class="wide acc"><b>配件</b><span>' + esc(accessoryLine(p)) + '</span></div>' + (evoEta(p) ? '<div class="wide acc"><b>下次進化</b><span>' + esc(evoEta(p)!) + '</span></div>' : '') + '<div class="grid">' + row('名字', esc(p.name)) + row('種類', SPECIES_LABEL[p.species]) + row('性格', p.personality) +
        row('力量', p.strength) + row('速度', p.speed) + row('體力', p.stamina) + row('體重', p.weight + 'g') + row('最深', p.best_floor + '樓') +
        row('飽足', Math.round(p.hunger)) + row('心情', Math.round(p.happiness)) + row('精力', Math.round(p.energy)) + row('清潔', Math.round(p.cleanliness)) + row('健康', Math.round(p.health)) + row('便便', p.poop) + '</div>' +
        `<div class="wide"><b>出生</b><span>${born.getMonth() + 1}/${born.getDate()} ${String(born.getHours()).padStart(2, '0')}:${String(born.getMinutes()).padStart(2, '0')}</span></div>` +
        (p.status === 'dead' ? `<div class="wide"><b>死因</b><span>${({ starvation: '餓壞了', illness: '生病', neglect: '沒人照顧' } as any)[p.death_cause] ?? p.death_cause}</span></div>` : '') +
        (this.isOwner ? `<div class="wide"><b>金幣</b><span>${coinHtml(coins)}</span></div>` : '') + '<div class="mi back">✕ 關閉</div>';
      if (p.status === 'alive') { const c = spriteCanvas(frontSprite(petSpriteKey(p)), 2); c.className = 'frontpic'; el.querySelector('.front')!.append(c); }
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
      const sc = SHELL_COLORS[r.pet.species]; this.paintShell(sc);
      this.say(`${r.pet.name} 的蛋來了！一分鐘內就會孵化～`);
    } catch (e) { this.say(errText(e)); }
  }
  myOutfits: string[] = [];
  async refreshOutfits() { try { const r = await api('GET', '/outfits'); this.myOutfits = r.owned ?? []; if (this.menu === 'shop') this.renderMenu(); } catch { /* 下次 */ } }
  shopPick(i: number) { return i < ITEM_ORDER.length ? this.buyItem(ITEM_ORDER[i]) : this.outfitPick(OUTFIT_IDS[i - ITEM_ORDER.length]); }
  async outfitPick(id: string) {
    if (this.busy || !id) return; this.busy = true;
    const name = (OUTFITS as any)[id].name;
    try {
      if (!this.myOutfits.includes(id)) {
        const r = await act('POST', '/outfits/buy', { outfit_id: id });
        this.ctx.setWallet(r.balance); this.myOutfits = r.owned; if (r.pet) this.setPet(r.pet); this.say(`買了${name}！`);
      } else {
        const on = !(this.pet?.outfits ?? []).includes(id);
        const r = await act('POST', '/outfits/wear', { outfit_id: id, on }); this.setPet(r.pet); this.say(on ? `穿上${name}` : `脫下${name}`);
      }
      this.renderMenu(); this.renderTop();
    } catch (e) { this.say(errText(e)); }
    finally { this.busy = false; }
  }
  async buyItem(id: string) {
    if (this.busy) return; this.busy = true;
    try {
      const r = await act('POST', '/items/buy', { item_id: id });
      this.ctx.setWallet(r.balance); this.myItems = r.items ?? this.myItems; if (!this.equip) this.equip = id;
      this.renderMenu(); this.renderTop(); this.say(`買了 ${ITEM_INFO[id].name}！可用 ${r.fights_left} 場`);
    } catch (e) { this.say(errText(e)); }
    finally { this.busy = false; }
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
    if (typeof m.type === 'string' && m.type.startsWith('arena.')) { if (this.home && m.home_id === this.home.id) this.onArena(m); return; }
    if (m.type === 'pet.updated' && this.home && m.home_id === this.home.id) {
      const ev = m.event;
      const mine = ev?.actor?.id === this.ctx.me.id;
      if (this.anim || this.stairs) { this.pendingPet = m.pet; }
      else if (ev?.type === 'feed' && !mine) { this.startEat(ev.food); this.pendingPet = m.pet; this.say(`${ev.actor.display_name} 餵了 ${this.ctx.cfg.foods.find((f: any) => f.id === ev.food)?.name ?? ev.food}！`); }
      else if (!mine || !this.anim) this.setPet(m.pet);
    } else if (m.type === 'wallet.updated') { this.ctx.setWallet(m.balance); this.renderTop(); }
    else if (m.type === 'stairs.event' || m.type === 'stairs.notice' || m.type === 'race.event' || m.type === 'race.notice') { if (this.home && m.home_id === this.home.id) this.onStairsEvent(m); }
    else if (m.type === 'error' && typeof m.for === 'string' && m.for.startsWith('stairs.')) this.say(stairsNotice(m.code));
    else if (m.type === 'error' && typeof m.for === 'string' && m.for.startsWith('race.')) this.say(raceNotice(m.code));
    else if (this.stairs) this.stairs.onLive(m);
    else if (m.type === 'match.started') this.beginStairs(m);
    else if (m.type === 'match.ended' && m.mode === 'multi' && m.me) { if (m.balance != null) this.ctx.setWallet(m.balance); this.ctx.toast(`一起下樓梯：${rankText(m.me.rank)}、${m.me.floor} 樓、◎${m.me.coins}`); }
    else if (m.type === 'error' && m.for === 'match.create') this.say(errText({ message: (({ TOO_TIRED: '太累了，想睡覺…', PET_SLEEPING: '噓…牠在睡覺', ALREADY_IN_MATCH: '已經在遊戲中' }) as any)[m.code] ?? m.code }));
  }

  // ---------- 下樓梯 ----------
  board: Board | null = null; boardErr = false;
  /** v1.6：進下樓梯先看排行榜，按「開始」才開局。 */
  openBoard() {
    this.board = null; this.boardErr = false; this.menu = 'board'; this.renderMenu();
    api('GET', '/leaderboard/stairs').then((b) => { this.board = b; }).catch(() => { this.boardErr = true; }).finally(() => { if (this.menu === 'board') this.renderMenu(); });
  }
  startStairs() {
    if (!this.ctx.live.send({ type: 'match.create', request_id: crypto.randomUUID() })) return this.say('連線中斷，稍後再試');
    this.say('準備下樓梯…');
  }
  // ---------- M2 一起下樓梯（以家為單位） ----------
  /** 這個家裡除了自己以外的在場人數。 */
  othersHere() { return this.presenceAll.filter((u) => u.id !== this.ctx.me.id).length; }
  /** 多人局裡自己已經出局（還在看別人玩）。 */
  stairsOut() { const st = this.stairs; return !!st && st.multi && !st.ended && !st.state.players[st.me]?.alive; }
  startMulti() {
    const p = this.myPresence?.pet;
    if (!p) return this.say('沒有寵物不能下樓梯');
    if (p.status !== 'alive') return this.say(stairsNotice(p.status === 'egg' ? 'PET_EGG' : 'PET_DEAD'));
    if (p.sleeping) return this.say(stairsNotice('PET_SLEEPING'));
    if (!this.othersHere()) return this.say(stairsNotice('NO_OPPONENT'));
    if (!this.ctx.live.send({ type: 'stairs.invite' })) return this.say('連線中斷，稍後再試');
  }
  /** 一起賽車：流程同一起下樓梯（家裡的人收到邀請 → 參加／不要）；家裡只有自己就直接單人跑（電腦補滿 20 台）。 */
  startRace() {
    if (!this.ctx.live.send({ type: 'race.invite' })) return this.say('連線中斷，稍後再試');
    this.say(this.othersHere() ? '邀請大家一起賽車…' : '準備賽車…');
  }
  private setLobby(on: boolean) { this.ctx.live.inLobby = on; }
  private onStairsEvent(m: any) {
    const me = this.ctx.me.id, race = m.type.startsWith('race.'), notice = race ? raceNotice : stairsNotice;
    if (m.type === 'stairs.notice' || m.type === 'race.notice') { this.say(notice(m.code)); return; }
    if (m.kind === 'invite') {
      this.sinvite = { id: m.invite, from: m.from, from_name: m.from_name ?? '?', to: m.to ?? [], until: Date.now() + (m.left_ms ?? 15_000), answered: false, count: 1, game: race ? 'race' : 'stairs', track_name: race ? trackById(m.track)?.name : undefined };
      if (m.from === me) { this.say(`已邀請大家一起${race ? '賽車' : '下樓梯'}！等回覆（${Math.round((m.left_ms ?? 15_000) / 1000)} 秒）`); this.setLobby(true); }
      this.showSInvite();
    } else if (m.kind === 'reply') {
      const v = this.sinvite; if (!v || v.id !== m.invite) return;
      v.count = m.count ?? v.count;
      if (v.from === me) { this.say(race ? `${v.count} 人要一起賽車…` : `${v.count} 隻要一起下樓梯…`); this.showSInvite(); }
    } else if (m.kind === 'invite_cancel') {
      const v = this.sinvite, same = !!v && v.id === m.invite, mine = m.from === me || (same && this.ctx.live.inLobby); // 發起人或已參加的人才提示
      if (same) { this.sinvite = null; this.showSInvite(); }
      if (mine) { this.ctx.toast(notice(m.code)); this.setLobby(false); }
    } else if (m.kind === 'start') {
      if (this.sinvite?.id === m.invite) { this.sinvite = null; this.showSInvite(); }
      this.setLobby(false);
      if (!(m.users ?? []).includes(me)) this.ctx.toast(`${(m.names ?? []).join('、')} 一起${race ? '賽車' : '下樓梯'}中！`);
    }
  }
  private showSInvite() {
    const el = this.$('.sinv'), v = this.sinvite;
    clearInterval(this.sinviteTimer);
    if (v && v.from === this.ctx.me.id && !this.stairs) { // 發起人：等回覆，可以取消
      el.hidden = false; el.innerHTML = inviterHtml(v, Date.now());
      this.sinviteTimer = window.setInterval(() => { const c = el.querySelector('.ic'), w = this.sinvite; if (!w) return this.showSInvite(); if (c) c.textContent = `${Math.max(0, Math.ceil((w.until - Date.now()) / 1000))} 秒後截止回覆`; }, 250);
      return;
    }
    if (!v || v.answered || !v.to.includes(this.ctx.me.id) || this.stairs) { el.hidden = true; return; }
    el.hidden = false; el.innerHTML = inviteHtml(v, Date.now());
    this.sinviteTimer = window.setInterval(() => {
      const c = el.querySelector('.ic'), w = this.sinvite; if (!w) return this.showSInvite();
      if (c) c.textContent = `${Math.max(0, Math.ceil((w.until - Date.now()) / 1000))} 秒後自動不參加`;
      if (Date.now() > w.until) this.answerSInvite(false, true);
    }, 250);
  }
  /** 發起人取消邀請（伺服器回 invite_cancel 才把框收起來） */
  cancelSInvite() {
    const v = this.sinvite; if (!v || v.from !== this.ctx.me.id) return;
    if (!this.ctx.live.send({ type: v.game === 'race' ? 'race.cancel' : 'stairs.cancel', invite: v.id })) this.say('連線中斷，稍後再試');
  }
  answerSInvite(accept: boolean, silent = false) {
    const v = this.sinvite; if (!v || v.answered) return;
    v.answered = true;
    if (!silent) this.ctx.live.send({ type: v.game === 'race' ? 'race.reply' : 'stairs.reply', invite: v.id, accept });
    if (accept) { this.say('參加！等其他人回覆…'); this.setLobby(true); } else if (!silent) this.say('這次不參加');
    this.showSInvite();
  }
  beginStairs(m: any) {
    this.closeMenu();
    const lab = this.$('.labels'), bar = this.$('.gamebar');
    const h0 = this.cv.offsetHeight + lab.offsetHeight;
    lab.hidden = true; bar.hidden = false; this.el.classList.add('playing');
    const P = m.params;
    const hh = Math.min(h0 - bar.offsetHeight + 22, Math.round(this.cv.offsetWidth * P.height / P.width));
    // 寬度用 min(100%, …)：進下樓梯後按鈕列變了、蛋會重新量一次大小（fitEgg），畫面變窄時畫布不能超出液晶框
    this.cv.width = P.width; this.cv.height = P.height; this.cv.style.height = 'auto'; this.cv.style.width = `min(100%, ${Math.round(hh * P.width / P.height)}px)`;
    const multi = m.mode === 'multi';
    this.sinvite = null; this.showSInvite(); this.setLobby(false);
    const mine = multi ? m.players.find((p: any) => p.user_id === this.ctx.me.id) : null;
    this.stairs = new StairsClient(this.ctx.live, m, mine?.sp ?? petSpriteKey(this.pet), {
      ended: (r) => {
        if (r.balance != null) this.ctx.setWallet(r.balance);
        if (r.pet) this.pendingPet = r.pet;
        this.menu = 'result';
        const el = this.$('.menu'); el.hidden = false;
        if (multi) {
          el.innerHTML = multiResultHtml(r);
          this.say(r.aborted || r.error || !r.me ? '遊戲中止' : `${r.time_up ? '時間到！' : ''}${rankText(r.me.rank)}！下了 ${r.me.floor} 樓，賺到 ◎${r.me.coins}！`);
          return;
        }
        el.innerHTML = stairsResultHtml(r, this.ctx.wallet());
        this.say(r.aborted ? '遊戲中止' : `${r.time_up ? (r.closing ? '快關門了，時間到！' : '時間到！') : ''}下了 ${r.floors} 樓，賺到 ◎${r.coins}！`);
      },
      status: (t) => this.say(t),
    }, this.ctx.me.id);
    this.say(multi ? `${m.players.length} 隻一起下樓梯！←→ 移動，撐到最後～` : '←→ 移動，往下跳！小心尖刺～');
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
  draw(force = false) {
    if (this.frozen && !force) { if (this.result) this.drawConfetti(); if (Date.now() - this.frozenAt > 8000 && !this.result) this.unfreeze(); return; } // 決勝瞬間：暫停畫面
    const fs = this.arenaFighters(); this.inArena = new Set(fs.map((x) => x.u));
    // 只有自己一隻在場上時不接管主人寵物（讓一般動畫照常）；有兩隻以上才由伺服器位置接管
    if (this.inArena.size < 2) this.inArena = new Set();
    this.drawMain();
    this.drawGuests();
    if (this.inArena.size) this.drawArena(fs.filter((x) => this.inArena.has(x.u)));
    if (this.sub % 15 === 0) { this.ensureJoined(); this.updateControls(); }
    const more = this.el.querySelector('.tags .more') as HTMLElement | null;
    if (more) { more.style.right = '1%'; more.style.top = `${((HUD + 1) / H) * 100}%`; }
  }
  drawMain() {
    const g = this.g, p = this.pet; this.frame++;
    const cx = this.ownerCx();
    const f = Math.floor(this.frame / 4) % 2;
    g.fillStyle = p?.sleeping ? PAL[2] : PAL[0]; g.fillRect(0, 0, W, H);
    if (p && p.status === 'alive') (['i_hunger', 'i_happy', 'i_energy', 'i_clean', 'i_health'] as const).forEach((ic, i) => this.bar(1 + i * 24, 1, ic, p[['hunger', 'happiness', 'energy', 'cleanliness', 'health'][i]]));
    // HUD 下方的分隔線＝進化進度（彩蛋）：已完成的部分用原本的深色，剩下的用很接近的深色，仔細看才看得出來
    g.fillStyle = PAL[3]; g.fillRect(0, HUD - 1, W, 1);
    const evo = p && p.status === 'alive' ? evoProgress(p) : null;
    if (evo) { const done = Math.round(W * evo.frac); g.fillStyle = p.sleeping ? EVO_LINE_TRACK_SLEEP : EVO_LINE_TRACK; g.fillRect(done, HUD - 1, W - done, 1); }
    g.fillStyle = PAL[1]; g.fillRect(0, GROUND, W, 1);
    for (let i = 0; i < W; i += 6) g.fillRect(i, GROUND + 2 + ((i / 6) % 2), 2, 1);
    if (this.ownerAway && p && p.status !== 'dead') {
      if (this.anim) this.finishAnim();
      for (let i = 0; i < p.poop; i++) { const q = poopXY(i); spr(g, 'poop', q.x, q.y); }
      this.drawOwnerTag(cx, GROUND - 6);
      return;
    }
    if (!p) { spr(g, 'egg', cx - 6, GROUND - 12); g.fillStyle = PAL[0]; g.fillRect(cx - 3, GROUND - 9, 6, 5); spr(g, 'z', cx + 8, GROUND - 22 - f * 2); this.drawOwnerTag(cx, GROUND - 12); return; }
    if (p.status === 'dead') { spr(g, 'ghost', cx - 5, HUD + 22 + (f ? 0 : 2)); spr(g, 'tomb', cx - 4, GROUND - 8); this.drawOwnerTag(cx, HUD + 22); return; }
    if (p.status === 'egg') {
      const left = p.hatch_at - this.ctx.live.serverNow(), shake = left < 15000 ? (f ? 1 : -1) : (this.frame % 16 < 2 ? 1 : 0);
      spr(g, f && left < 15000 ? 'egg2' : 'egg', cx - 6 + shake, GROUND - 12);
      if (left > 0) num(g, Math.ceil(left / 1000), cx - 4, HUD + 10);
      this.drawOwnerTag(cx, GROUND - 12);
      return;
    }
    const pk = petSpriteKey(p), name1 = speciesSprite(pk, 1), pw = sw(name1), ph = sh(name1), baseY = GROUND - ph;
    if (this.inArena.has(this.home?.owner.id)) {
      // 打架中由場地快照畫主人寵物；進行中的餵食／清潔動畫直接收尾
      if (this.anim) this.finishAnim();
      if (p.poop) for (let i = 0; i < p.poop; i++) { const q = poopXY(i); spr(g, 'poop', q.x, q.y); }
      return;
    }
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
    spr(g, p.sleeping ? speciesSprite(pk, 's') : speciesSprite(pk, alt ? 2 : 'w'), this.petX, py, flip && !p.sleeping);
    if (this.evoT > 0) this.drawEvolve(pw, ph, baseY);
    if (p.sleeping) { spr(g, 'z', this.petX + pw + 2, baseY - 6 - f * 3); spr(g, 'z', this.petX + pw + 8, baseY - 14 - f * 3); }
    if (p.sick) spr(g, 'skull', this.petX - 7, baseY - 6 + f);
    this.drawOwnerTag(this.petX + pw / 2, py - (ANCHOR[speciesSprite(pk, 1)]?.oy ?? 0)); // 名牌放在配件（皇冠等）上面
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
