// 遊戲圖檔（src/art/**）一律經 Vite 打包：建置後網址帶內容 hash（/assets/barn-3f9a1c.png），
// 伺服器對 /assets/ 給一年 immutable 快取，瀏覽器不用每次回來問。圖一換，hash 跟著變 → 網址變 → 自動抓新圖，
// 不必清任何快取。新增圖片只要放進 src/art/ 對應資料夾，用 art('farm/xxx.png') 取網址即可。
const urls = import.meta.glob<string>('./art/**/*.{png,jpg,webp}', { eager: true, query: '?url', import: 'default' });

const warned = new Set<string>();
/** 依 src/art/ 底下的相對路徑取得圖檔網址；找不到回空字串（畫面缺一張圖，不讓整個畫面壞掉） */
export function art(path: string): string {
  const u = urls[`./art/${path}`];
  if (u === undefined && !warned.has(path)) { warned.add(path); console.warn(`[art] 找不到圖檔：src/art/${path}`); }
  return u ?? '';
}

/** 測試用：所有已打包的圖檔路徑（相對 src/art/） */
export const artPaths = () => Object.keys(urls).map((k) => k.slice('./art/'.length));
