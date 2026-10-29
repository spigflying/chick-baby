// @ts-nocheck
import { SFV } from '@chick/engine';
import { NetClient, SpectatorClient } from './sfv-net';
import { drawFight } from './sfv-draw';
import type { Live } from './ws';

const KEY_BITS = { KeyW: SFV.UP, KeyS: SFV.DOWN, KeyA: SFV.LEFT, KeyD: SFV.RIGHT, KeyU: SFV.LP, KeyI: SFV.HP, KeyJ: SFV.LK, KeyK: SFV.HK, KeyH: SFV.LP | SFV.LK, KeyL: SFV.HP | SFV.HK };
const EASY_BITS = { KeyO: SFV.EASY_HADO, KeyP: SFV.EASY_DP, KeyN: SFV.EASY_TATSU, KeyM: SFV.EASY_CA };
const MODE_NAME = { classic: '經典模式', beginner: '初心模式' };
const NOTICE: Record<string, string> = {
  TOUCH_DEVICE: '手機只能觀戰，請用電腦挑戰', NO_OPPONENT: '目前沒有可以挑戰的對手', NOT_ELIGIBLE: '寵物必須活著、醒著且沒有生病',
  FIGHT_BUSY: '這個家已經有格鬥邀請或比賽', RACE_BUSY: '有人正在賽車', STAIRS_BUSY: '有人正在下樓梯', HOME_COOLDOWN: '剛打完，請等 30 秒',
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
  private current: any = null;
  private raf = 0;
  private closeTimer = 0;
  private visual: any = null;
  private lastDrawAt = 0;

  constructor(private live: Live, private me: { id: string; display_name: string }, private toast: (s: string) => void) {
    this.root = document.createElement('div'); this.root.className = 'sfv-live'; this.root.hidden = true;
    this.root.innerHTML = `<div class="sfv-top"><b class="sfv-title">1v1 格鬥</b><button class="sfv-close" aria-label="關閉">✕</button></div>
      <canvas width="960" height="540"></canvas><div class="sfv-help"></div><div class="sfv-result" hidden></div><div class="sfv-debug" hidden></div>`;
    document.body.append(this.root);
    this.canvas = this.root.querySelector('canvas')!; this.ctx = this.canvas.getContext('2d')!; this.ctx.imageSmoothingEnabled = false;
    this.banner = document.createElement('div'); this.banner.className = 'sfv-banner'; this.banner.hidden = true; document.body.append(this.banner);
    this.dialog = document.createElement('div'); this.dialog.className = 'sfv-dialog'; this.dialog.hidden = true; document.body.append(this.dialog);
    this.root.querySelector('.sfv-close')!.addEventListener('click', () => this.closeView());
    this.banner.addEventListener('click', () => this.openView());
    this.dialog.addEventListener('click', (e) => this.dialogClick(e));
    addEventListener('keydown', this.keyDown); addEventListener('keyup', this.keyUp); addEventListener('blur', this.blur);
    this.off = live.on((m) => this.onLive(m));
    this.raf = requestAnimationFrame(this.draw);
  }
  destroy() {
    this.off(); cancelAnimationFrame(this.raf); clearTimeout(this.closeTimer);
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
    this.dialog.innerHTML = `<div class="sfv-card"><h3>選擇戰鬥模式</h3><button data-mode="classic">經典模式・搓招出必殺</button><button data-mode="beginner">初心模式・一鍵出必殺</button><button data-cancel class="alt">取消</button></div>`;
  }
  private dialogClick(e: Event) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
    if (b.dataset.mode && !b.dataset.accept) {
      this.pendingMode = b.dataset.mode;
      const candidates = fightCandidates(this.presence, this.me.id);
      this.dialog.innerHTML = `<div class="sfv-card"><h3>${MODE_NAME[this.pendingMode]}：挑戰誰？</h3>${candidates.map((u) => `<button data-to="${u.id}">${esc(u.display_name)}・${esc(u.pet.name)}</button>`).join('')}<button data-cancel class="alt">取消</button></div>`;
      return;
    }
    if (b.dataset.to) { if (!this.live.send({ type: 'fight.invite', to: b.dataset.to, mode: this.pendingMode })) this.toast('連線中斷，稍後再試'); }
    else if (b.dataset.accept) this.live.send({ type: 'fight.reply', invite: b.dataset.invite, accept: b.dataset.accept === '1', mode: b.dataset.mode ?? 'classic' });
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
        this.dialog.innerHTML = `<div class="sfv-card"><h3>${esc(m.from_name)} 向你挑戰！</h3><p>對方選了${MODE_NAME[m.from_mode] ?? '經典模式'}。你要用哪種模式？</p><button data-accept="1" data-mode="classic" data-invite="${m.invite}">經典模式接受</button><button data-accept="1" data-mode="beginner" data-invite="${m.invite}">初心模式接受</button><button data-accept="0" data-invite="${m.invite}" class="alt">拒絕</button><p>10 秒後自動拒絕</p></div>`;
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
    this.live.send({ type: 'arena.join' }); this.showResult(title, detail);
  }
  private aborted(reason: string) { if (!this.current) return; this.current.aborted = reason; this.feed({ type: 'sfv.ended', aborted: true }); this.openView(); this.live.inFight = false; this.live.send({ type: 'arena.join' }); this.showResult('比賽中止', '不轉帳、不發獎池'); }
  private showResult(title: string, detail: string) {
    const el = this.root.querySelector('.sfv-result') as HTMLElement; el.hidden = false; el.innerHTML = `<b>${esc(title)}</b><span>${esc(detail)}</span><small>按 Enter 關閉，或 6 秒後自動返回</small>`;
    clearTimeout(this.closeTimer); this.closeTimer = window.setTimeout(() => this.finishView(), 6000);
  }
  private finishView() { clearTimeout(this.closeTimer); this.closeView(); this.banner.hidden = true; this.current = null; this.visual = null; this.held.clear(); }
  private openView() { if (!this.current) return; if (this.root.hidden) { this.visual = null; this.lastDrawAt = 0; } this.root.hidden = false; }
  private closeView() { if (!this.current || (!this.current.result && !this.current.aborted && this.current.pid)) return; this.root.hidden = true; }
  private updateHelp() {
    const help = this.root.querySelector('.sfv-help') as HTMLElement;
    if (!this.current?.pid) { help.textContent = '觀戰中・按 Esc 返回家裡'; return; }
    const mode = this.current.players[this.current.pid - 1].mode;
    help.innerHTML = mode === 'beginner'
      ? '<b>初心模式出招表</b>　WASD 移動／後退防禦　U/I 拳　J/K 腳<br>O 蛋波　P 衝天啄（昇龍）　N 旋風翅　M 火雞連環踢（3 格 EX）　H 摔　L 炸毛'
      : '<b>經典模式出招表</b>　WASD 移動／後退防禦　U/I 拳　J/K 腳（面向左時左右相反）<br>↓↘→＋拳 蛋波　→↓↘＋拳 衝天啄（昇龍）　↓↙←＋腳 旋風翅　↓↘→↓↘→＋腳 大招（3 格 EX）　H 摔　L 炸毛';
  }
  private mask() { let m = 0; for (const code of this.held) m |= KEY_BITS[code] ?? (this.current?.players[this.current.pid - 1]?.mode === 'beginner' ? EASY_BITS[code] : 0) ?? 0; return m; }
  private keyDown = (e: KeyboardEvent) => {
    if (this.root.hidden) return;
    if (this.current?.result || this.current?.aborted) { if (e.code === 'Enter') { e.preventDefault(); this.finishView(); } return; }
    if (!this.current?.pid) { if (e.code === 'Escape') { e.preventDefault(); this.closeView(); } return; }
    if (KEY_BITS[e.code] !== undefined || (this.current.players[this.current.pid - 1]?.mode === 'beginner' && EASY_BITS[e.code] !== undefined)) { e.preventDefault(); this.held.add(e.code); }
  };
  private keyUp = (e: KeyboardEvent) => { if (KEY_BITS[e.code] !== undefined || EASY_BITS[e.code] !== undefined) this.held.delete(e.code); };
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
      drawFight(this.ctx, shown, { showBoxes: false, me: this.current.pid ? this.current.pid - 1 : -1, names: this.current.players.map((p: any) => p.name), ended });
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
const coin = (n: number) => `${n >= 0 ? '+' : '−'}◎${Math.abs(n ?? 0)}`;
