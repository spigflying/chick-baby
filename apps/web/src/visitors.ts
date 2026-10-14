// 拜訪同框（v1.3）：在場者的寵物畫在主人寵物旁邊；房間內每個人用同一份 home.presence 算出同一組寵物。
import { S, speciesSprite, sw, sh } from './sprites';

export type PetSummary = { id: string; name: string; species: string; status: 'egg' | 'alive' | 'dead'; sleeping: boolean; sick: boolean; mood: 'happy' | 'ok' | 'sad' };
export type PresenceUser = { id: string; display_name: string; avatar_url: string | null; pet: PetSummary | null };
export const MAX_GUESTS = 4;

/** 主人以外的在場者（主人的寵物住在這裡，不論主人在不在線上都由 home.state 畫出）。依 id 排序，所有人看到的順序一致。 */
export function guestsOf(users: PresenceUser[], ownerId: string) {
  const list = [...new Map(users.filter((u) => u.id !== ownerId).map((u) => [u.id, u])).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { shown: list.slice(0, MAX_GUESTS), extra: Math.max(0, list.length - MAX_GUESTS) };
}

/** 加入／離開提示（不含自己）。prev = null 代表剛進家，不提示。 */
export function presenceDiff(prev: PresenceUser[] | null, next: PresenceUser[], meId: string) {
  if (!prev) return { joined: [] as string[], left: [] as string[] };
  const a = new Map(prev.map((u) => [u.id, u])), b = new Map(next.map((u) => [u.id, u]));
  return {
    joined: [...b.values()].filter((u) => !a.has(u.id) && u.id !== meId).map((u) => u.display_name),
    left: [...a.values()].filter((u) => !b.has(u.id) && u.id !== meId).map((u) => u.display_name),
  };
}

export function guestSprite(p: PetSummary | null, alt: number): string | null {
  if (!p) return null;
  if (p.status === 'dead') return 'ghost';
  if (p.status === 'egg') return 'egg';
  return speciesSprite(p.species, p.sleeping ? 's' : alt ? 2 : 1);
}
export function spriteW(name: string | null) { return name && S[name] ? sw(name) : 10; }
export function spriteH(name: string | null) { return name && S[name] ? sh(name) : 6; }

/** 把畫面切成 1 + n 條互不重疊的跑道：0 給主人寵物，其餘依序給訪客。 */
export function lanes(width: number, n: number, margin = 4) {
  const L = (width - margin * 2) / (n + 1);
  return Array.from({ length: n + 1 }, (_, i) => ({ x0: Math.round(margin + i * L), x1: Math.round(margin + (i + 1) * L) }));
}

/** 訪客寵物的位置：每隻只在自己的跑道內慢慢走，保證不重疊。 */
export class GuestWalkers {
  private pos = new Map<string, { x: number; dir: number }>();
  step(ids: string[], laneOf: (i: number) => { x0: number; x1: number }, widthOf: (i: number) => number, moving: (i: number) => boolean, rnd = Math.random) {
    const out: number[] = [];
    ids.forEach((id, i) => {
      const { x0, x1 } = laneOf(i), w = widthOf(i), max = Math.max(x0, x1 - w);
      let s = this.pos.get(id);
      if (!s) s = { x: Math.round((x0 + max) / 2), dir: rnd() < 0.5 ? -1 : 1 };
      if (moving(i)) { s.x += s.dir; if (s.x <= x0 || s.x >= max || rnd() < 0.02) s.dir *= -1; }
      s.x = Math.max(x0, Math.min(max, s.x));
      this.pos.set(id, s); out.push(s.x);
    });
    for (const k of [...this.pos.keys()]) if (!ids.includes(k)) this.pos.delete(k);
    return out;
  }
  dir(id: string) { return this.pos.get(id)?.dir ?? 1; }
}

let ac: AudioContext | null = null;
/** 像素風提示音（方波兩音）。瀏覽器沒有互動前可能被擋，失敗就安靜略過。 */
export function blip(up: boolean) {
  try {
    ac = ac ?? new AudioContext();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(up ? 660 : 520, t); o.frequency.setValueAtTime(up ? 990 : 390, t + 0.08);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.2);
  } catch { /* ignore */ }
}
