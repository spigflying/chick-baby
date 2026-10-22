export type RaceMode = 'menu' | 'lobby' | 'race' | 'results';
/** 點分頁（錦標賽／車庫／排行榜）：結果畫面時離開結果回選單，不然 renderPanel 會一直畫結果、分頁像沒反應。 */
export function tabNav(mode: RaceMode, tab: string): { mode: RaceMode; tab: string; clearRace: boolean } {
  return mode === 'results' ? { mode: 'menu', tab, clearRace: true } : { mode, tab, clearRace: false };
}
