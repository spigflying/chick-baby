// 在場名單（v1.3）：每位在場者附帶自己目前的寵物摘要，讓房間內每個人看到同一組寵物。
import type { PublicPet } from './pets';

export type PetSummary = { id: string; name: string; species: string; status: 'egg' | 'alive' | 'dead'; sleeping: boolean; sick: boolean; mood: 'happy' | 'ok' | 'sad' };
export type PresenceUser = { id: string; display_name: string; avatar_url: string | null; pet: PetSummary | null };

export function petSummary(p: PublicPet | null | undefined): PetSummary | null {
  if (!p) return null;
  const mood = p.happiness >= 60 ? 'happy' : p.happiness >= 30 ? 'ok' : 'sad';
  return { id: p.id, name: p.name, species: p.species, status: p.status as PetSummary['status'], sleeping: !!p.sleeping, sick: !!p.sick, mood };
}

/** 依連線鍵（instance:conn）存放；同一使用者多個分頁只算一次，以最新加入的為準，並依加入順序排列。 */
export class PresenceStore {
  private homes = new Map<string, Map<string, PresenceUser>>();
  set(home: string, key: string, user: PresenceUser | null) {
    let m = this.homes.get(home);
    if (!m) this.homes.set(home, (m = new Map()));
    m.delete(key);
    if (user) m.set(key, user); else if (!m.size) this.homes.delete(home);
  }
  users(home: string): PresenceUser[] {
    const out = new Map<string, PresenceUser>();
    for (const u of this.homes.get(home)?.values() ?? []) { out.delete(u.id); out.set(u.id, u); }
    return [...out.values()];
  }
  /** 寵物狀態變了：更新所有家裡帶著這隻寵物的人；回傳受影響的家。 */
  updatePet(petId: string, pet: PetSummary | null): string[] {
    const hit: string[] = [];
    for (const [home, m] of this.homes) {
      let changed = false;
      for (const [k, u] of m) if (u.pet?.id === petId) { m.set(k, { ...u, pet }); changed = true; }
      if (changed) hit.push(home);
    }
    return hit;
  }
  /** 這個家目前有連線的執行個體（排序後）；對戰由最小的那個執行個體負責模擬。 */
  instances(home: string): string[] { return [...new Set([...(this.homes.get(home)?.keys() ?? [])].map((k) => k.slice(0, k.lastIndexOf(':'))))].sort(); }
  homesList() { return [...this.homes.keys()]; }
  hasPet(petId: string) { for (const m of this.homes.values()) for (const u of m.values()) if (u.pet?.id === petId) return true; return false; }
}
