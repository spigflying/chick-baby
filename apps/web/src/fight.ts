// v1.4 打架模式（前端）：輸入模式、按鍵對應、快照插值與畫面工具。模擬在伺服器。
export type ControlMode = 'menu' | 'pet' | 'nav';
/**
 * 輸入模式：
 * - 拜訪別人家：預設 'pet'（方向鍵／空白鍵控制自己的寵物）；按 Enter 開啟動作列 → 'nav'；選完或 Esc 回到 'pet'。
 * - 自己家：維持 'menu'（方向鍵選動作）；只有正在對戰時才是 'pet'。
 * - 子選單開著（餵食等）一律 'menu'；自己的寵物不能打（沒寵物／睡覺／生病）也是 'menu'。
 */
/** v1.5：自己家有訪客在場時，主人也控制寵物（Enter 開動作列，和訪客一樣）。 */
export function controlMode(o: { isOwner: boolean; submenuOpen: boolean; navOpen: boolean; inArena: boolean; inFight: boolean; visitors?: boolean }): ControlMode {
  if (o.submenuOpen) return 'menu';
  if (!o.inArena) return 'menu';
  if (o.isOwner && !o.inFight && !o.visitors) return 'menu';
  return o.navOpen ? 'nav' : 'pet';
}
/** 控制面板顯示條件：寵物控制或動作列模式（主人在有訪客時也會看到）。 */
export const showFightbar = (m: string) => m === 'pet' || m === 'nav';
export type Pad = { left: boolean; right: boolean; jump: boolean };
const EMPTY: Pad = { left: false, right: false, jump: false };
const KEYMAP: Record<string, keyof Pad> = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'jump', w: 'jump' };
/** 家中漫遊只保留移動、跳躍；Enter 開啟動作列。 */
export function petKey(key: string): keyof Pad | 'nav' | null { if (key === 'Enter') return 'nav'; return KEYMAP[key] ?? null; }
export class PadState {
  pad: Pad = { ...EMPTY };
  /** 回傳 true = 有變化（要送給伺服器） */
  set(b: keyof Pad, v: boolean) { if (this.pad[b] === v) return false; this.pad[b] = v; return true; }
  clear() { const ch = Object.values(this.pad).some(Boolean); this.pad = { ...EMPTY }; return ch; }
}
export interface FSnap { u: string; pet: string; sp: string; name: string; x: number; y: number; dir: 1 | -1; atk: number; inv: number; hp: number; fight: string | null;
  out?: boolean; sw?: string | null; sn?: number; hn?: number; hd?: number; chg?: number; eq?: string | null; items?: Record<string, number>; slip?: boolean }
export interface ArenaMsg { tick: number; server_time: number; fighters: FSnap[]; fights: { id: string; parts: string[]; left_ms: number }[]; hp_max: number; frozen?: boolean; cooldown_ms?: number; invite?: { id: string; from: string; to: string[]; left_ms: number } | null; proj?: { x: number; y: number }[] }
/** 兩個快照之間線性插值（新加入的直接用最新位置）。 */
export function lerpFighters(prev: ArenaMsg | null, cur: ArenaMsg, t: number): FSnap[] {
  const k = Math.max(0, Math.min(1, t));
  const old = new Map((prev?.fighters ?? []).map((f) => [f.u, f]));
  return cur.fighters.map((f) => { const o = old.get(f.u); return o ? { ...f, x: o.x + (f.x - o.x) * k, y: o.y + (f.y - o.y) * k } : f; });
}
export const NOTICE_TEXT: Record<string, string> = {
  PAIR_COOLDOWN: '剛打完，休息一下再打',
  HOME_COOLDOWN: '剛打完，休息 30 秒才能再打',
  GAME_CLOSING: '快關門了，現在不能開打',
  GAME_CLOSED: '休息時間，不能打架',
  NOT_ELIGIBLE: '寵物要醒著、沒生病才能打架',
  ARENA_FULL: '場上太擠了',
  FIGHT_BUSY: '已經有人發起或正在打架',
  RACE_BUSY: '有人在賽車，等比賽結束再打架',
  NO_OPPONENT: '場上沒有可以一起打的寵物',
  NOT_ENOUGH: '參戰的不到 2 隻，取消',
  OWNER_OFFLINE: '主人離線，不能打架',
  OWNER_AWAY: '主人外出中，不能打架',
  OWNER_SLEEPING: '主人的寵物在睡覺，不能打架',
  OWNER_SICK: '主人的寵物生病了，不能打架',
};
// ---------- v1.6 能不能打 ----------
export type PetLite = { status: string; sleeping: boolean; sick: boolean } | null | undefined;
/** 單隻寵物的資格：null = 可以打，否則是原因。 */
export function petBlock(p: PetLite, who: '你' | '主人' = '你'): string | null {
  const s = who === '你' ? '你的寵物' : '主人的寵物';
  if (!p) return who === '你' ? '你還沒有寵物' : '主人沒有寵物';
  if (p.status === 'egg') return `${s}還是蛋`;
  if (p.status === 'dead') return `${s}已經死了`;
  if (p.sleeping) return `${s}在睡覺，不能打架`;
  if (p.sick) return `${s}生病了，不能打架`;
  return null;
}
/** 發起戰鬥的阻擋原因（依序：主人外出／離線／睡覺／生病 → 自己寵物 → 冷卻 → 對手）。null = 可以發起。 */
export function fightBlocker(o: { isOwner: boolean; ownerPresent: boolean; ownerAway: boolean; ownerPet: PetLite; myPet: PetLite; cooldownMs: number; opponents: number; busy?: boolean }): string | null {
  if (!o.isOwner) {
    if (o.ownerAway) return NOTICE_TEXT.OWNER_AWAY;
    if (!o.ownerPresent) return NOTICE_TEXT.OWNER_OFFLINE;
    const ob = petBlock(o.ownerPet, '主人');
    if (ob) return o.ownerPet?.sleeping ? NOTICE_TEXT.OWNER_SLEEPING : o.ownerPet?.sick ? NOTICE_TEXT.OWNER_SICK : ob;
  }
  const mb = petBlock(o.myPet); if (mb) return mb;
  if (o.busy) return NOTICE_TEXT.FIGHT_BUSY;
  if (o.cooldownMs > 0) return `剛打完，還要休息 ${Math.ceil(o.cooldownMs / 1000)} 秒`;
  if (o.opponents < 1) return NOTICE_TEXT.NO_OPPONENT;
  return null;
}
export const INVITE_MS = 10_000;
export const inviteSecs = (leftMs: number) => Math.max(0, Math.ceil(leftMs / 1000));
export function resultText(r: { winner: string | null; amount: number; reason: string }, name: (id: string) => string) {
  if (r.reason === 'cancel') return '對戰取消（不轉帳）';
  if (!r.winner) return '平手！不轉帳';
  return `${name(r.winner)} 贏了！拿走 ◎${r.amount}${r.reason === 'forfeit' ? '（對手離開）' : ''}`;
}
/** 手機（觸控）的提示：沒有鍵盤，用螢幕按鈕。 */
export const TOUCH_HINT = '按住 ◀ ▶ 移動・▲ 跳・發起戰鬥・選單 開動作列';
export const hintFor = (m: ControlMode, touch: boolean) => (m === 'pet' && touch ? TOUCH_HINT : m === 'nav' && touch ? '點下方圖示選動作・再按「選單」或任一控制鈕返回' : HINT[m]);
/** 控制鈕按下：動作列（nav）開著時直接回到寵物控制，不要吞掉這一下（手機沒有 Esc）。 */
export function padPress(mode: string, down: boolean): { exitNav: boolean; apply: boolean } {
  if (!down) return { exitNav: false, apply: true };
  if (mode === 'nav') return { exitNav: true, apply: true };
  return { exitNav: false, apply: mode === 'pet' };
}
export const HINT: Record<ControlMode, string> = {
  pet: '←→ 移動　↑ 跳　F 發起戰鬥　Enter 選單',
  nav: '←→ 選擇　Enter 確定　Esc 返回',
  menu: '',
};

// ---------- v1.5 結算畫面 ----------
export interface ResultPart { u: string; name: string; dmg: number; hits: number; taken: number; hp: number; out: boolean; forfeit: boolean; delta: number; transfer?: number; pool?: number }
export interface ResultMsg { fight: string; winner: string | null; winner_name: string | null; losers: string[]; draw: boolean; amount: number; reason: string; parts: ResultPart[]; pool?: number }
export interface ResultView { banner: string; winner: string | null; role: 'winner' | 'loser' | 'draw' | 'spectator'; coin: string | null; lostLine: string | null; stats: [string, string][]; rows: RankRow[]; net: string | null }
export const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '±0');
/** 每個人看到的結算畫面：彩帶橫幅（贏家寵物名（暱稱））＋自己的金幣變化；輸家多一行「你輸了」與數據；觀眾只看橫幅。 */
export interface RankRow { rank: number; u: string; name: string; score: number; pool: number; transfer: number; me: boolean }
/** v1.6 排名：依攻擊分數（總傷害）由高到低；同分同名次。 */
export function ranking(r: ResultMsg, me: string): RankRow[] {
  const rows = [...r.parts].sort((a, b) => b.dmg - a.dmg || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((p, i) => { if (i === 0 || p.dmg !== rows[i - 1].dmg) rank = i + 1; return { rank, u: p.u, name: p.name, score: p.dmg, pool: p.pool ?? 0, transfer: p.transfer ?? p.delta, me: p.u === me }; });
}
export const coinStr = (n: number) => `◎${sign(n)}`;
/** 結算畫面輸入：前 3 秒忽略點擊與按鍵（顯示倒數），之後點／按鍵關閉，約 8 秒自動關。 */
export const RESULT_LOCK_MS = 3000;
export function resultInput(elapsedMs: number): 'locked' | 'dismiss' { return elapsedMs < RESULT_LOCK_MS ? 'locked' : 'dismiss'; }
export const lockSecs = (elapsedMs: number) => Math.max(0, Math.ceil((RESULT_LOCK_MS - elapsedMs) / 1000));
export function resultView(r: ResultMsg, me: string): ResultView | null {
  if (r.reason === 'cancel') return null;
  const mine = r.parts.find((p) => p.u === me);
  const banner = r.winner ? `🏆 ${r.winner_name ?? '?'} 贏了！` : '平手！';
  const role: ResultView['role'] = !mine ? 'spectator' : r.draw || !r.winner ? 'draw' : r.winner === me ? 'winner' : 'loser';
  const coin = mine ? `◎${sign(mine.delta)}` : null;
  const stats: [string, string][] = role === 'loser' && mine ? [
    ['造成傷害', String(mine.dmg)], ['命中次數', String(mine.hits)], ['被打次數', String(mine.taken)], ['剩餘 HP', String(mine.hp)],
  ] : [];
  return { banner, winner: r.winner_name, role, coin, lostLine: role === 'loser' ? '你輸了' : null, stats, rows: ranking(r, me), net: mine ? `你的變化 ${coin}` : null };
}
export const RESULT_AUTO_MS = 8000;
/** 快照之間的特效偵測：揮擊次數（sn）變了 → 畫弧線；被打次數（hn）變了 → 白閃＋飄字＋震動。 */
export function diffFx(prev: FSnap[] | undefined, cur: FSnap[]) {
  const old = new Map((prev ?? []).map((f) => [f.u, f]));
  const swings: { u: string; kind: string }[] = [], hits: { u: string; dmg: number }[] = [];
  for (const f of cur) {
    const o = old.get(f.u); if (!o) continue;
    if ((f.sn ?? 0) > (o.sn ?? 0) && f.sw) swings.push({ u: f.u, kind: f.sw });
    if ((f.hn ?? 0) > (o.hn ?? 0)) hits.push({ u: f.u, dmg: f.hd ?? 0 });
  }
  return { swings, hits };
}
