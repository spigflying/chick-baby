export type RaceMode = 'menu' | 'lobby' | 'race' | 'results';
/** 點分頁（錦標賽／車庫／排行榜）：結果畫面時離開結果回選單，不然 renderPanel 會一直畫結果、分頁像沒反應。 */
export function tabNav(mode: RaceMode, tab: string): { mode: RaceMode; tab: string; clearRace: boolean } {
  return mode === 'results' ? { mode: 'menu', tab, clearRace: true } : { mode, tab, clearRace: false };
}
/** 選單選中的賽道：跟著錦標賽站走（followCup）時換成目前這站；手動選了別條就不動。鎖住的國家不選。 */
export function cupSel(sel: string, followCup: boolean, cupTrackId: string | null, unlocked: number, countryOf: (id: string) => number | null): string {
  if (!followCup || !cupTrackId) return sel;
  const c = countryOf(cupTrackId); return c !== null && c < unlocked ? cupTrackId : sel;
}
/** 正在跑的比賽（重新整理頁面後接回用），存在 sessionStorage；讀寫失敗（私密模式等）就當沒有。 */
export interface SavedRace { id: string; inst: string }
const RACE_KEY = 'chick.race';
export function saveRace(r: SavedRace | null) { try { if (r) sessionStorage.setItem(RACE_KEY, JSON.stringify(r)); else sessionStorage.removeItem(RACE_KEY); } catch { /* ignore */ } }
export function savedRace(): SavedRace | null {
  try { const v = JSON.parse(sessionStorage.getItem(RACE_KEY) ?? 'null'); return v && typeof v.id === 'string' && typeof v.inst === 'string' ? { id: v.id, inst: v.inst } : null; } catch { return null; }
}
