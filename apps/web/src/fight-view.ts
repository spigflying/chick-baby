// @ts-nocheck
import { SFV, FIGHT_FACES, fightFace } from '@chick/engine';
import { NetClient, SpectatorClient } from './sfv-net';
import { drawFight } from './sfv-draw';
import { preloadFightArt } from './sfv-art';
import type { Live } from './ws';
import { api } from './api';
import { art } from './art';

const KEY_BITS = { KeyW: SFV.UP, KeyS: SFV.DOWN, KeyA: SFV.LEFT, KeyD: SFV.RIGHT, KeyU: SFV.LP, KeyI: SFV.HP, KeyJ: SFV.LK, KeyK: SFV.HK, KeyH: SFV.LP | SFV.LK, KeyL: SFV.HP | SFV.HK };
// 初心 3x3：RTY / FGH / VBN（H＝EX 旋風翅，不再當摔；摔改 V）。經典模式仍用 KEY_BITS（H＝摔）。
const BEGINNER_BITS = {
  KeyR: SFV.EASY_HADO, KeyT: SFV.EASY_DP, KeyY: SFV.EASY_TATSU,
  KeyF: SFV.EASY_HADO_EX, KeyG: SFV.EASY_DP_EX, KeyH: SFV.EASY_TATSU_EX,
  KeyV: SFV.LP | SFV.LK, KeyB: SFV.EASY_CA, KeyN: SFV.EASY_SHINKU,
};
const MODE_NAME = { classic: '經典模式', beginner: '初心模式' };
const FACE_NAME: Record<string, string> = { chick: '雞臉', a: '臉 A', b: '臉 B', c: '臉 C' };
const FACE_KEY = 'sfv-face';
const loadFace = () => { try { return fightFace(localStorage.getItem(FACE_KEY)); } catch { return 'chick'; } };
const NOTICE: Record<string, string> = {
  TOUCH_DEVICE: '手機只能觀戰，請用電腦挑戰', NO_OPPONENT: '目前沒有可以挑戰的對手', NOT_ELIGIBLE: '寵物必須活著、醒著且沒有生病',
  FIGHT_BUSY: '這個家已經有格鬥邀請或比賽', RACE_BUSY: '有人正在賽車', STAIRS_BUSY: '有人正在下樓梯', 
  OWNER_OFFLINE: '主人不在家', OWNER_AWAY: '主人外出了', OWNER_SLEEPING: '主人的寵物在睡覺', OWNER_SICK: '主人的寵物生病了',
  GAME_CLOSING: '快關門了，時間不夠打一場', DECLINED: '對方拒絕了挑戰', TIMEOUT: '對方沒有回覆', INVITE_GONE: '這個邀請已經失效', BAD_MODE: '請重新選擇戰鬥模式', INTERNAL: '格鬥開場失敗，請稍後再試',
};

export function fightCandidates(users: any[], me: string) {
  return users.filter((u) => u.id !== me && !u.touch && u.pet?.status === 'alive' && !u.pet.sleeping && !u.pet.sick);
}

export class FightView {
  private off: () => void;
  private home: string | null = null;
  private presence: any[] = [];
  private root: HTMLElement;
  private banner: HTMLElement;
  private dialog: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private held = new Set<string>();
  private pendingMode: 'classic' | 'beginner' = 'classic';
  private face: string = loadFace(); // 格鬥時用哪張臉；記在這台電腦（綁定照片臉的帳號固定用自己的）
  private current: any = null;
  private raf = 0;
  private closeTimer = 0;
  private visual: any = null;
  private lastDrawAt = 0;
  private three: any = undefined; // undefined = 還沒建；null = 不支援 WebGL，用 2D
  private load3d: Promise<any> | null = null;

  constructor(private live: Live, private me: { id: string; display_name: string; fight_face?: string | null }, private toast: (s: string) => void) {
    if (me.fight_face) this.face = fightFace(me.fight_face);
    preloadFightArt(); // 水墨圖約 0.7 MB，進家裡就先載，開打時已就緒
    // 3D（three.js 約 140 KB gzip）背景載入，不擋主畫面；載不到就用 2D
    this.load3d = import('./sfv-3d').then((m) => m.createFight3D, () => null);
    this.root = document.createElement('div'); this.root.className = 'sfv-live'; this.root.hidden = true;
    this.root.innerHTML = `<div class="sfv-top"><b class="sfv-title">1v1 格鬥</b><button class="sfv-close" aria-label="關閉">✕</button></div>
      <div class="sfv-stage"><canvas class="sfv-3d" width="960" height="540"></canvas><canvas class="sfv-2d" width="960" height="540"></canvas></div><div class="sfv-help"></div><div class="sfv-result" hidden></div><div class="sfv-debug" hidden></div>`;
    document.body.append(this.root);
    this.canvas = this.root.querySelector('canvas.sfv-2d')!; this.ctx = this.canvas.getContext('2d')!; this.ctx.imageSmoothingEnabled = false;
    this.banner = document.createElement('div'); this.banner.className = 'sfv-banner'; this.banner.hidden = true; document.body.append(this.banner);
    this.dialog = document.createElement('div'); this.dialog.className = 'sfv-dialog'; this.dialog.hidden = true; document.body.append(this.dialog);
    this.root.querySelector('.sfv-close')!.addEventListener('click', () => this.closeView());
    this.banner.addEventListener('click', () => this.openView());
    this.dialog.addEventListener('click', (e) => this.dialogClick(e));
    this.root.querySelector('.sfv-result')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      if (b.dataset.rematch) this.rematch(); else this.finishView();
    });
    addEventListener('keydown', this.keyDown); addEventListener('keyup', this.keyUp); addEventListener('blur', this.blur);
    this.off = live.on((m) => this.onLive(m));
    this.raf = requestAnimationFrame(this.draw);
  }
  destroy() {
    this.off(); cancelAnimationFrame(this.raf); clearTimeout(this.closeTimer); this.three?.dispose();
    removeEventListener('keydown', this.keyDown); removeEventListener('keyup', this.keyUp); removeEventListener('blur', this.blur);
    this.root.remove(); this.banner.remove(); this.dialog.remove();
  }
  setHome(home: string | null) {
    this.home = home; if (!home) this.presence = [];
    if (!home && this.current && !this.current.pid) this.finishView();
  }
  setPresence(users: any[]) { this.presence = users; }

  chooseOpponent() {
    if (this.live.touch) return this.toast(NOTICE.TOUCH_DEVICE);
    const candidates = fightCandidates(this.presence, this.me.id);
    if (!candidates.length) return this.toast(NOTICE.NO_OPPONENT);
    this.dialog.hidden = false;
    this.dialog.innerHTML = `<div class="sfv-card"><h3>選擇戰鬥模式</h3>${this.facePicker()}<button data-mode="classic">經典模式・搓招出必殺</button><button data-mode="beginner">初心模式・一鍵出必殺</button><button data-cancel class="alt">取消</button></div>`;
  }
  /** 選臉：雞臉或照片臉；點了只換選擇，不關對話框 */
  private facePicker() {
    if (this.me.fight_face) return ''; // 有自己的臉：跳過選臉
    return `<div class="sfv-faces"><span>用哪張臉打？</span>${FIGHT_FACES.map((id) => `<button data-face="${id}" class="${id === this.face ? 'on' : ''}">${id === 'chick' ? '<i>🐔</i>' : `<img src="${art(`fight/face_${id}.webp`)}" alt="">`}<small>${FACE_NAME[id] ?? id}</small></button>`).join('')}</div>`;
  }
  private dialogClick(e: Event) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
    if (b.dataset.face) {
      this.face = fightFace(b.dataset.face); try { localStorage.setItem(FACE_KEY, this.face); } catch {}
      this.dialog.querySelectorAll('[data-face]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.face === this.face));
      return;
    }
    if (b.dataset.mode && !b.dataset.accept) {
      this.pendingMode = b.dataset.mode;
      const candidates = fightCandidates(this.presence, this.me.id);
      this.dialog.innerHTML = `<div class="sfv-card"><h3>${MODE_NAME[this.pendingMode]}：挑戰誰？</h3><p class="sfv-rec" data-rec-total></p>${candidates.map((u) => `<button data-to="${u.id}">${esc(u.display_name)}・${esc(u.pet.name)}<small class="sfv-rec" data-rec="${u.id}"></small></button>`).join('')}<button data-cancel class="alt">取消</button></div>`;
      void this.fillPickerRecords(candidates.map((u) => u.id));
      return;
    }
    if (b.dataset.to) { if (!this.live.send({ type: 'fight.invite', to: b.dataset.to, mode: this.pendingMode, face: this.face })) this.toast('連線中斷，稍後再試'); }
    else if (b.dataset.accept) this.live.send({ type: 'fight.reply', invite: b.dataset.invite, accept: b.dataset.accept === '1', mode: b.dataset.mode ?? 'classic', face: this.face });
    this.dialog.hidden = true;
  }
  private onLive(m: any) {
    if (m.home_id && this.home && m.home_id !== this.home && m.fight_id !== this.current?.id) return;
    if (m.type === 'time.pong' && this.current?.player)
      this.current.player.onMessage({ type: 'pong', c: m.t0, tick: m.fight_tick ?? this.current.spectator.tick }, Date.now());
    if (m.type === 'fight.notice') return this.toast(NOTICE[m.code] ?? m.code);
    if (m.type === 'fight.event') return this.onEvent(m);
    if (!this.current || m.fight_id !== this.current.id) return;
    if (m.type === 'fight.ticks') this.feed({ type: 'sfv.ticks', from: m.from, m: m.m, ack: m.ack });
    else if (m.type === 'fight.snap') this.feed({ type: 'sfv.snap', tick: m.tick, s: m.s, h: m.h, ack: m.ack, late: m.late });
    else if (m.type === 'fight.result') this.result(m);
  }
  private onEvent(m: any) {
    if (m.kind === 'invite') {
      if (m.from === this.me.id) { this.live.inFight = true; return this.toast('挑戰已送出，等待對方回覆…'); }
      if (m.to === this.me.id && !this.live.touch) {
        this.live.inFight = true;
        this.dialog.hidden = false;
        this.dialog.innerHTML = `<div class="sfv-card"><h3>${esc(m.from_name)} 向你挑戰！</h3><p>對方選了${MODE_NAME[m.from_mode] ?? '經典模式'}。你要用哪種模式？</p>${this.facePicker()}<button data-accept="1" data-mode="classic" data-invite="${m.invite}">經典模式接受</button><button data-accept="1" data-mode="beginner" data-invite="${m.invite}">初心模式接受</button><button data-accept="0" data-invite="${m.invite}" class="alt">拒絕</button><p>10 秒後自動拒絕</p></div>`;
      }
      return;
    }
    if (m.kind === 'invite_cancel') {
      this.dialog.hidden = true;
      if (m.from === this.me.id || m.to === this.me.id) { this.live.inFight = false; this.toast(NOTICE[m.code] ?? '挑戰取消'); }
      return;
    }
    if (m.kind === 'start' || m.kind === 'sync') {
      const pid = Number(m.you_pid) || 0;
      if (this.current?.id === m.fight_id) {
        this.current.players = m.players;
        if (pid && (!this.current.player || this.current.pid !== pid)) this.becomePlayer(pid);
        else if (!pid && this.current.pid) { this.current.player = null; this.current.pid = 0; this.live.inFight = false; }
        this.updateHelp();
        return;
      }
      // 上場的結果面板與自動關閉計時器不能帶進新場次。
      clearTimeout(this.closeTimer);
      (this.root.querySelector('.sfv-result') as HTMLElement).hidden = true;
      this.visual = null;
      this.lastDrawAt = 0;
      const modes = m.players.map((p: any) => p.mode === 'beginner' ? 1 : 0);
      this.current = { id: m.fight_id, players: m.players, pid, spectator: new SpectatorClient(modes), player: null, result: null, aborted: null };
      if (pid) this.becomePlayer(pid);
      const names = m.players.map((p: any) => p.name);
      this.banner.hidden = false; this.banner.innerHTML = `<b>${esc(names[0])} vs ${esc(names[1])}</b><span>${pid ? '你正在對戰' : '點這裡觀戰'}</span>`;
      if (pid) this.openView();
      this.updateHelp();
      this.live.inFight = !!pid; this.dialog.hidden = true;
      return;
    }
    if (m.kind === 'control' && this.current?.id === m.fight_id && m.user === this.me.id) {
      if (m.you_pid) this.becomePlayer(m.you_pid); else { this.current.player = null; this.current.pid = 0; this.live.inFight = false; }
      this.updateHelp();
      return;
    }
    if (m.kind === 'ended' && this.current?.id === m.fight_id) this.aborted(m.reason);
  }
  private becomePlayer(pid: number) {
    this.current.pid = pid;
    this.current.player = new NetClient({ pid, modes: this.current.players.map((p: any) => p.mode === 'beginner' ? 1 : 0), sample: () => this.mask(), send: (msg: any) => {
      if (msg.type === 'sfv.input') this.live.send({ type: 'fight.input', fight_id: this.current.id, seq: msg.seq, inputs: msg.inputs });
      else if (msg.type === 'ping') this.live.send({ type: 'time.ping', t0: msg.c });
    } });
    this.openView(); this.live.inFight = true;
  }
  private feed(msg: any) {
    const now = Date.now(); this.current.spectator.onMessage(msg);
    this.current.player?.onMessage(msg, now);
  }
  private result(m: any) {
    this.current.result = m; this.feed({ type: 'sfv.ended', aborted: false }); this.openView(); this.live.inFight = false;
    const mine = m.parts.find((p: any) => p.user_id === this.me.id);
    const winner = m.players?.find((p: any) => p.user_id === m.winner)?.name ?? this.current.players.find((p: any) => p.user_id === m.winner)?.name;
    const title = m.draw ? '平手' : m.winner === this.me.id ? '你贏了！' : mine ? '你輸了' : `${winner} 獲勝`;
    const detail = mine ? `轉帳 ${coin(mine.transfer)}　獎池 +◎${mine.pool}　合計 ${coin(mine.delta)}` : '比賽結束';
    this.live.send({ type: 'arena.join' }); this.showResult(title, detail, !!mine);
    if (mine) void this.fillResultRecord(m.fight_id);
  }
  /** 選對手清單：自己的總戰績＋跟每個候選人的對戰紀錄（拿不到就不顯示）。 */
  private async fillPickerRecords(ids: string[]) {
    try {
      const r = await api('GET', `/fights/record?vs=${ids.slice(0, 20).join(',')}`);
      const total = this.dialog.querySelector('[data-rec-total]'); if (total) total.textContent = `你的戰績 ${tally(r.total)}`;
      for (const id of ids) { const el = this.dialog.querySelector(`[data-rec="${id}"]`); if (el && r.vs[id]) el.textContent = `對戰 ${tally(r.vs[id])}`; }
    } catch { /* 戰績只是參考，失敗就不顯示 */ }
  }
  /** 結果畫面：結算已寫進資料庫，這時查到的戰績已含這一場。 */
  private async fillResultRecord(fightId: string) {
    const c = this.current; const opp = c?.players.find((p: any) => p.user_id !== this.me.id); if (!opp) return;
    try {
      const r = await api('GET', `/fights/record?vs=${opp.user_id}`);
      if (this.current?.id !== fightId || !this.current.result) return;
      const el = this.root.querySelector('.sfv-result') as HTMLElement;
      const line = document.createElement('em'); line.className = 'sfv-rec';
      line.textContent = `你的戰績 ${tally(r.total)}　對 ${opp.name} ${tally(r.vs[opp.user_id])}`;
      el.querySelector('.sfv-again')?.before(line);
    } catch { /* 戰績只是參考，失敗就不顯示 */ }
  }
  private aborted(reason: string) { if (!this.current) return; this.current.aborted = reason; this.feed({ type: 'sfv.ended', aborted: true }); this.openView(); this.live.inFight = false; this.live.send({ type: 'arena.join' }); this.showResult('比賽中止', '不轉帳、不發獎池', !!this.current.pid); }
  /** 對戰雙方：結果畫面可以直接「再打一場」（同模式再邀請對手），不自動關閉；觀眾照舊 6 秒後返回。 */
  private showResult(title: string, detail: string, player = false) {
    const el = this.root.querySelector('.sfv-result') as HTMLElement; el.hidden = false;
    clearTimeout(this.closeTimer);
    if (player) {
      el.innerHTML = `<b>${esc(title)}</b><span>${esc(detail)}</span><div class="sfv-again"><button data-rematch="1">再打一場（Enter）</button><button class="alt">離開（Esc）</button></div>`;
      return;
    }
    el.innerHTML = `<b>${esc(title)}</b><span>${esc(detail)}</span><small>按 Enter 關閉，或 6 秒後自動返回</small>`;
    this.closeTimer = setTimeout(() => this.finishView(), 6000) as any;
  }
  /** 用上一場自己的模式再邀請同一個對手；對方照一般邀請流程選模式接受。 */
  rematch() {
    const c = this.current; if (!c?.pid) return;
    const opp = c.players.find((p: any) => p.pid !== c.pid);
    if (!opp) return;
    this.pendingMode = c.players[c.pid - 1]?.mode ?? 'classic';
    if (!this.live.send({ type: 'fight.invite', to: opp.user_id, mode: this.pendingMode, face: this.face })) this.toast('連線中斷，稍後再試');
  }
  private finishView() { clearTimeout(this.closeTimer); this.closeView(); this.banner.hidden = true; this.current = null; this.visual = null; this.held.clear(); }
  private openView() { if (!this.current) return; if (this.root.hidden) { this.visual = null; this.lastDrawAt = 0; } this.root.hidden = false; }
  private closeView() { if (!this.current || (!this.current.result && !this.current.aborted && this.current.pid)) return; this.root.hidden = true; }
  private updateHelp() {
    const help = this.root.querySelector('.sfv-help') as HTMLElement;
    if (!this.current?.pid) { help.textContent = '觀戰中・按 Esc 返回家裡'; return; }
    const mode = this.current.players[this.current.pid - 1].mode;
    help.innerHTML = mode === 'beginner'
      ? '<b>初心模式出招表</b>　WASD 移動／後退防禦　U/I 拳　J/K 腳　L 炸毛<br>'
        + '一鍵必殺（3×3）：<br>'
        + 'R 蛋波　T 衝天啄　Y 旋風翅<br>'
        + 'F EX蛋波　G EX衝天啄　H EX旋風翅（各需 1 格 EX，不足則出通常版）<br>'
        + 'V 摔　B 火雞連環踢　N 真空蛋波（B／N 需 3 格 EX）'
      : '<b>經典模式出招表</b>　WASD 移動／後退防禦　U/I 拳　J/K 腳（面向左時左右相反）<br>↓↘→＋拳 蛋波　→↓↘＋拳 衝天啄（昇龍）　↓↙←＋腳 旋風翅　↓↘→↓↘→＋腳 火雞連環踢／＋拳 真空蛋波（3 格 EX）　H 摔　L 炸毛';
  }
  private mask() {
    const beginner = this.current?.players[this.current.pid - 1]?.mode === 'beginner';
    let m = 0;
    for (const code of this.held) {
      if (beginner) {
        // KeyH 在初心只走 BEGINNER_BITS（EX 旋風翅），不要套到經典的摔
        if (BEGINNER_BITS[code] !== undefined) m |= BEGINNER_BITS[code];
        else if (code !== 'KeyH' && KEY_BITS[code] !== undefined) m |= KEY_BITS[code];
      } else if (KEY_BITS[code] !== undefined) m |= KEY_BITS[code];
    }
    return m;
  }
  private keyDown = (e: KeyboardEvent) => {
    if (this.root.hidden) return;
    if (this.current?.result || this.current?.aborted) {
      if (!this.dialog.hidden) return; // 對方的再戰邀請視窗開著時，交給視窗按鈕
      if (e.code === 'Enter') { e.preventDefault(); if (this.current.pid) this.rematch(); else this.finishView(); }
      else if (e.code === 'Escape') { e.preventDefault(); this.finishView(); }
      return;
    }
    if (!this.current?.pid) { if (e.code === 'Escape') { e.preventDefault(); this.closeView(); } return; }
    const beginner = this.current.players[this.current.pid - 1]?.mode === 'beginner';
    const known = beginner
      ? (BEGINNER_BITS[e.code] !== undefined || (e.code !== 'KeyH' && KEY_BITS[e.code] !== undefined))
      : KEY_BITS[e.code] !== undefined;
    if (known) { e.preventDefault(); this.held.add(e.code); }
  };
  private keyUp = (e: KeyboardEvent) => {
    if (KEY_BITS[e.code] !== undefined || BEGINNER_BITS[e.code] !== undefined) this.held.delete(e.code);
  };
  private blur = () => this.held.clear();
  private draw = () => {
    if (!this.root.hidden && this.current) {
      const now = Date.now(); this.current.player?.frame(now);
      const state = this.current.player?.predicted ?? this.current.spectator.state;
      const elapsed = this.lastDrawAt ? Math.min(50, now - this.lastDrawAt) : 0;
      this.lastDrawAt = now;
      const shown = smoothFightState(state, this.visual, elapsed, this.current.pid);
      this.visual = shown;
      const ended = this.current.aborted ? { aborted: true } : this.current.result ? { aborted: false, win: this.current.result.winner ? this.current.players.findIndex((p: any) => p.user_id === this.current.result.winner) : 2 } : null;
      if (this.three === undefined && this.load3d) { // 第一次打開格鬥畫面才建 WebGL；模組還沒到先畫 2D，失敗就藏起 3D 畫布
        const cv3 = this.root.querySelector('canvas.sfv-3d') as HTMLCanvasElement, loading = this.load3d; this.load3d = null;
        cv3.hidden = true;
        loading.then((create) => { this.three = create ? create(cv3) : null; cv3.hidden = !this.three; });
      }
      drawFight(this.ctx, shown, { three: this.three || null, faces: this.current.players.map((p: any) => p.face ?? 'chick'), showBoxes: false, me: this.current.pid ? this.current.pid - 1 : -1, names: this.current.players.map((p: any) => p.name), ended });
      const debug = this.root.querySelector('.sfv-debug') as HTMLElement;
      debug.hidden = new URLSearchParams(location.search).get('debug') !== '1';
      if (!debug.hidden) debug.textContent = this.current.player ? `確認 ${this.current.player.C}・預測 ${this.current.player.L}・rollback ${this.current.player.stats.rollbacks}` : `觀戰確認 ${this.current.spectator.tick}`;
    }
    this.raf = requestAnimationFrame(this.draw);
  };
}

// 只平滑畫出來的位置；碰撞、輸入與回滾仍使用未修改的權威／預測狀態。
export function smoothFightState(state: any, previous: any, elapsed: number, pid: number) {
  if (!previous || state.rnd !== previous.rnd) return { ...state, p: state.p.map((fighter: any) => ({ ...fighter })) };
  const p = state.p.map((fighter: any, i: number) => {
    const before = previous.p[i];
    if (Math.abs(fighter.x - before.x) > 100 || Math.abs(fighter.y - before.y) > 100) return { ...fighter };
    const ms = i === pid - 1 ? 18 : 40;
    const blend = 1 - Math.exp(-Math.max(0, elapsed) / ms);
    return { ...fighter, x: before.x + (fighter.x - before.x) * blend, y: fighter.y === 0 ? 0 : before.y + (fighter.y - before.y) * blend };
  });
  return { ...state, p };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const tally = (t: { win: number; loss: number; draw: number }) => `${t.win} 勝 ${t.loss} 敗${t.draw ? ` ${t.draw} 平` : ''}`;
const coin = (n: number) => `${n >= 0 ? '+' : '−'}◎${Math.abs(n ?? 0)}`;
