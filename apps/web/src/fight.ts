// v1.4 打架模式（前端）：輸入模式、按鍵對應、快照插值與畫面工具。模擬在伺服器。
export type ControlMode = 'menu' | 'pet' | 'nav';
/**
 * 輸入模式：
 * - 拜訪別人家：預設 'pet'（方向鍵／空白鍵控制自己的寵物）；按 Enter 開啟動作列 → 'nav'；選完或 Esc 回到 'pet'。
 * - 自己家：維持 'menu'（方向鍵選動作）；只有正在對戰時才是 'pet'。
 * - 子選單開著（餵食等）一律 'menu'；自己的寵物不能打（沒寵物／睡覺／生病）也是 'menu'。
 */
export function controlMode(o: { isOwner: boolean; submenuOpen: boolean; navOpen: boolean; inArena: boolean; inFight: boolean }): ControlMode {
  if (o.submenuOpen) return 'menu';
  if (!o.inArena) return 'menu';
  if (o.isOwner && !o.inFight) return 'menu';
  return o.navOpen ? 'nav' : 'pet';
}
export type Pad = { left: boolean; right: boolean; jump: boolean; attack: boolean };
const KEYMAP: Record<string, keyof Pad> = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'jump', w: 'jump', ' ': 'attack', Spacebar: 'attack' };
/** 'pet' 模式的按鍵：回傳要改的按鈕；Enter = 開啟動作列。 */
export function petKey(key: string): keyof Pad | 'nav' | null { if (key === 'Enter') return 'nav'; return KEYMAP[key] ?? null; }
export class PadState {
  pad: Pad = { left: false, right: false, jump: false, attack: false };
  /** 回傳 true = 有變化（要送給伺服器） */
  set(b: keyof Pad, v: boolean) { if (this.pad[b] === v) return false; this.pad[b] = v; return true; }
  clear() { const ch = Object.values(this.pad).some(Boolean); this.pad = { left: false, right: false, jump: false, attack: false }; return ch; }
}

export interface FSnap { u: string; pet: string; sp: string; name: string; x: number; y: number; dir: 1 | -1; atk: number; inv: number; hp: number; fight: string | null }
export interface ArenaMsg { tick: number; server_time: number; fighters: FSnap[]; fights: { id: string; a: string; b: string; left_ms: number }[]; hp_max: number }
/** 兩個快照之間線性插值（新加入的直接用最新位置）。 */
export function lerpFighters(prev: ArenaMsg | null, cur: ArenaMsg, t: number): FSnap[] {
  const k = Math.max(0, Math.min(1, t));
  const old = new Map((prev?.fighters ?? []).map((f) => [f.u, f]));
  return cur.fighters.map((f) => { const o = old.get(f.u); return o ? { ...f, x: o.x + (f.x - o.x) * k, y: o.y + (f.y - o.y) * k } : f; });
}
export const NOTICE_TEXT: Record<string, string> = {
  PAIR_COOLDOWN: '剛打完，同一對要休息 1 分鐘才能再打',
  GAME_CLOSING: '快關門了，現在不能開打',
  GAME_CLOSED: '休息時間，不能打架',
  NOT_ELIGIBLE: '寵物要醒著、沒生病才能打架',
  ARENA_FULL: '場上太擠了',
};
export function resultText(r: { winner: string | null; amount: number; reason: string }, name: (id: string) => string) {
  if (r.reason === 'cancel') return '對戰取消（不轉帳）';
  if (!r.winner) return '平手！不轉帳';
  return `${name(r.winner)} 贏了！拿走 ◎${r.amount}${r.reason === 'forfeit' ? '（對手離開）' : ''}`;
}
export const HINT: Record<ControlMode, string> = {
  pet: '←→ 移動　↑ 跳　空白 啄　Enter 選單',
  nav: '←→ 選擇　Enter 確定　Esc 返回',
  menu: '',
};
