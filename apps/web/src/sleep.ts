/** 倒數文字：`2 天 03:04:05` 或 `03:04:05`；負數視為 0。 */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const hms = [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
  return d ? `${d} 天 ${hms}` : hms;
}
/** 開門時間（瀏覽器時區；台灣使用者即台北時間）：`星期一 09:00`。 */
export function formatOpensAt(t: number): string {
  const d = new Date(t);
  return `星期${'日一二三四五六'[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- 休息時段的蛋殼畫面（v1.5）：資料庫晚上停機，用 localStorage 裡上次看到的寵物 ----------
export const PET_CACHE_KEY = 'chick.lastPet';
export interface PetCache { species: string; status: 'egg' | 'alive' | 'dead'; name: string }
type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** 線上時記住自己的寵物（種類、階段、名字）；沒有寵物就清掉。 */
export function savePetCache(store: Store, pet: any) {
  try { store.setItem(PET_CACHE_KEY, pet ? JSON.stringify({ species: pet.species, status: pet.status, name: pet.name }) : ''); } catch { /* 隱私模式 */ }
}
export function loadPetCache(store: Store): PetCache | null {
  try { const v = JSON.parse(store.getItem(PET_CACHE_KEY) || 'null'); return v && typeof v.species === 'string' && typeof v.status === 'string' ? { species: v.species, status: v.status, name: String(v.name ?? '') } : null; } catch { return null; }
}
/** 要畫哪個精靈：蛋 → 'egg'；活著 → 該物種的睡覺圖；沒快取（或已死亡）→ 一般的睡覺小雞。 */
export function sleepSprite(c: PetCache | null): { sprite: string; egg: boolean; name: string } {
  if (c?.status === 'egg') return { sprite: 'egg', egg: true, name: c.name };
  if (c?.status === 'alive') return { sprite: `${['chicken', 'duck', 'penguin', 'dino'].includes(c.species) ? c.species : 'chicken'}_s`, egg: false, name: c.name };
  return { sprite: 'chicken_s', egg: false, name: '' };
}
/** 「休息中・09:00 開門」（開門時間用瀏覽器時區，台灣即台北時間）。 */
export function closedLine(opensAt: number | null): string {
  if (!opensAt) return '休息中';
  const d = new Date(opensAt);
  return `休息中・${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 開門`;
}
