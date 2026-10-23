# 離線單人賽車試玩（race-demo）

給 Benson：最小成本、不影響架構、不資料庫、不存檔的 solo try-play。

## 怎麼開

本地 Vite（不必開 server / Cloud SQL）：

```bash
cd apps/web && pnpm dev
# 瀏覽器開 http://localhost:5173/race-demo.html
```

也可：`http://localhost:5173/race-demo.html?t=tw1`（換賽道 id）。

正式環境：`https://chick.thesilvertrees.com/race-demo`（或 `/race-demo.html`）。靜態檔，關門／DB 停機也能開。

獨立 HTML 入口，**不經過** `main.ts` 的開放時段／睡覺畫面，關門時也能開。

## 有什麼

- 瀏覽器內跑 `@chick/engine` 的 `createRace`／`stepRace`（與正式邏輯同一套）
- 本地 AI 補滿 20 台、原廠零件隼 GT
- 鍵盤／觸控同正式頁（←→ 轉向、↑/Z 油門、↓/X 煞車、空白鍵 氮氣）
- 重用 `race-gfx` 畫面與 pad 樣式
- 狀態全在記憶體；**重新整理＝沒了**

## 沒有什麼

- 無登入、無 Cloud SQL、無 race profile API
- 無錦標賽進度、金幣、排行榜、房間
- 無存檔／斷線重連
- **不改**正式 `/race` 路徑與 production 架構
- 已掛正式 `/race-demo`（純靜態）

## 預覽圖

見 workspace 根目錄 `race-demo-preview-*.png`（本機截圖）。
