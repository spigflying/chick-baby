// 在場名單（v1.3）：每位在場者附帶自己目前的寵物摘要，讓房間內每個人看到同一組寵物。
import type { PublicPet } from './pets';

export type PetSummary = { id: string; name: string; species: string; status: 'egg' | 'alive' | 'dead'; sleeping: boolean; sick: boolean; mood: 'happy' | 'ok' | 'sad'; look?: string };
export type PresenceUser = { id: string; display_name: string; avatar_url: string | null; pet: PetSummary | null; touch?: boolean };

export function petSummary(p: PublicPet | null | undefined): PetSummary | null {
  if (!p) return null;
  const mood = p.happiness >= 60 ? 'happy' : p.happiness >= 30 ? 'ok' : 'sad';
  return { id: p.id, name: p.name, species: p.species, status: p.status as PetSummary['status'], sleeping: !!p.sleeping, sick: !!p.sick, mood, look: p.look ?? '' };
}

/** 依連線鍵（instance:conn）存放；同一使用者多個分頁只算一次，以最新加入的為準，並依加入順序排列。 */
export const PRESENCE_TTL_MS = 75_000;
export const PRESENCE_REFRESH_MS = 30_000;
type Entry = { user: PresenceUser; at: number };
export class PresenceStore {
  private homes = new Map<string, Map<string, Entry>>();
  private owners = new Map<string, string>(); // home → owner user id（不會變）
  private online = new Map<string, { userId: string; at: number }>();
  setOnline(key: string, userId: string | null, now = Date.now()) {
    if (userId) this.online.set(key, { userId, at: now }); else this.online.delete(key);
  }
  onlineUserIds(now = Date.now()) {
    const ids = new Set<string>();
    for (const [key, entry] of this.online) {
      if (now - entry.at > PRESENCE_TTL_MS) this.online.delete(key);
      else ids.add(entry.userId);
    }
    // 部署切換期間，舊版連線仍會送家中在場心跳；一併計入在線名單。
    for (const home of this.homes.values()) for (const entry of home.values()) if (now - entry.at <= PRESENCE_TTL_MS) ids.add(entry.user.id);
    return ids;
  }
  setOwner(home: string, owner: string) { this.owners.set(home, owner); }
  ownerOf(home: string) { return this.owners.get(home) ?? null; }
  set(home: string, key: string, user: PresenceUser | null, now = Date.now()) {
    let m = this.homes.get(home);
    if (!m) this.homes.set(home, (m = new Map()));
    const had = m.get(key);
    m.delete(key);
    // 心跳刷新同一條連線時保留原本的加入順序
    if (user) m.set(key, { user, at: now }); else if (!m.size) this.homes.delete(home);
    void had;
  }
  /** 心跳：只更新時間（加入順序不變）；不存在就新增。 */
  touch(home: string, key: string, user: PresenceUser, now = Date.now()) {
    const m = this.homes.get(home); const e = m?.get(key);
    if (e) { e.at = now; e.user = { ...user, pet: e.user.pet ?? user.pet }; return false; }
    this.set(home, key, user, now); return true;
  }
  /** 清掉太久沒刷新的連線（執行個體當掉、SIGTERM 沒送出離開等）；回傳受影響的家。 */
  sweep(now = Date.now(), ttl = PRESENCE_TTL_MS): string[] {
    const hit: string[] = [];
    for (const [home, m] of this.homes) {
      let ch = false;
      for (const [k, e] of m) if (now - e.at > ttl) { m.delete(k); ch = true; }
      if (!m.size) this.homes.delete(home);
      if (ch) hit.push(home);
    }
    return hit;
  }
  users(home: string): PresenceUser[] {
    const out = new Map<string, PresenceUser>();
    for (const { user: u } of this.homes.get(home)?.values() ?? []) {
      const old = out.get(u.id);
      out.delete(u.id);
      // 同一人同時開手機與電腦時，只要還有一條電腦連線就能被挑戰。
      out.set(u.id, old ? { ...u, touch: !!old.touch && !!u.touch } : u);
    }
    return [...out.values()];
  }
  /** 產品上的「可操作格鬥」資格以連線為準，不能被同一人的手機分頁覆蓋。 */
  hasDesktop(home: string, userId: string): boolean {
    for (const e of this.homes.get(home)?.values() ?? []) if (e.user.id === userId && !e.user.touch) return true;
    return false;
  }
  desktopKey(home: string, userId: string): string | null {
    return [...(this.homes.get(home)?.entries() ?? [])].filter(([, e]) => e.user.id === userId && !e.user.touch).map(([k]) => k).sort()[0] ?? null;
  }
  hasKey(home: string, key: string): boolean { return this.homes.get(home)?.has(key) ?? false; }
  /** 使用者目前在哪些家（多個分頁可能在不同家）。 */
  whereIs(userId: string): string[] {
    const out: string[] = [];
    for (const [home, m] of this.homes) for (const e of m.values()) if (e.user.id === userId) { out.push(home); break; }
    return out;
  }
  /**
   * 主人外出中：主人正在別人家、而且沒有任何分頁在自己家。
   * 主人在自己家或離線 → 寵物在家（照常顯示）。
   */
  ownerAway(home: string): boolean {
    const owner = this.ownerOf(home); if (!owner) return false;
    const at = this.whereIs(owner);
    return at.length > 0 && !at.includes(home);
  }
  /** 這個使用者自己的家（如果這個執行個體知道）。 */
  homeOf(userId: string): string | null { for (const [h, o] of this.owners) if (o === userId) return h; return null; }
  /** 寵物狀態變了：更新所有家裡帶著這隻寵物的人；回傳受影響的家。 */
  updatePet(petId: string, pet: PetSummary | null): string[] {
    const hit: string[] = [];
    for (const [home, m] of this.homes) {
      let changed = false;
      for (const e of m.values()) if (e.user.pet?.id === petId) { e.user = { ...e.user, pet }; changed = true; }
      if (changed) hit.push(home);
    }
    return hit;
  }
  /** 這個家目前有連線的執行個體（排序後）；對戰由最小的那個執行個體負責模擬。 */
  instances(home: string): string[] { return [...new Set([...(this.homes.get(home)?.keys() ?? [])].map((k) => k.slice(0, k.lastIndexOf(':'))))].sort(); }
  homesList() { return [...this.homes.keys()]; }
  hasPet(petId: string) { for (const m of this.homes.values()) for (const e of m.values()) if (e.user.pet?.id === petId) return true; return false; }
}
