# 賽車錦標賽（racing，v5）

偽 3D 賽車，四階綠點陣（240×200 內部解析度、2 倍像素）。玩法依 docs/tg2-mechanics.md 的 TG2 結構重做；美術、車名、賽道名全部原創。

## 規則
- **場上 20 台**：真人玩家（最多 8 人）＋電腦補滿空位。電腦車一律畫成同一款灰色通用車（所有 LOD 相同），真人用 9 款設計車與塗裝。
- **發車**：電腦依實力排（強的在前），真人全部從最後面出發。
- **晉級**：前 10 名晉級下一站；第 11 名以後（或沒跑完），這個國家從第 1 站重來。
- **獎金／積分**：前 6 名，$10,000 / 6,000 / 4,000 / 3,000 / 2,000 / 1,000，積分 10/6/4/3/2/1，各賽道一樣。
- **國家**：台灣、日本、美國、德國，每國 4 站（天氣：晴／雨／夜／雪／霧）。4 站跑完，國家積分第一（同分算玩家）就解鎖下一國。只有「目前錦標賽站」算國家積分，其他賽道可以練習、賺獎金。
- **氮氣**：每場 3 次，沒有燃料。
- **完美度（condition）**：每次碰撞都扣（撞車、撞路邊、撞任何東西），依部位用前／側／後裝甲減免。完美度越低極速越慢（每 1% 約 −0.4%，最低 60%）。HUD 顯示 `COND xx%`。比賽之間只修撞傷，所以每場都從 100% 開始；零件、車款、獎金都保留。
- **電腦駕駛**：走彎內側路線、超慢車、太近時收油跟車、入彎前依安全速度煞車、只在直線用氮氣、被撞後閃避並收油，每位車手實力不同（19 位固定名字）。
- **賽季**：一個日曆月（台北時間）。換月時把上季存進 `race_seasons`，積分／勝場／解鎖／錦標賽進度歸零；獎金、零件、車款保留。排行榜只看本季。
- **換匯**：1 金幣 → $500 賽車獎金；$1,000 → 1 金幣。每個方向每天（台北日）最多 50 枚，走金幣帳本（`race_exchange_in` / `race_exchange_out`）。
- **關門保護**：關門前 8 分鐘不開新比賽（`RACE_CLOSING`）；比賽最長 9 分鐘。
- **私人房間**：`race.create` 拿到 6 碼房號；朋友用 `race.join {code}` 加入；房主 `race.invite {share_code}` 邀請線上朋友（對方收到 `race.invited`）；房主 `race.start` 開賽（或 2 分鐘後自動開）。空位一樣由電腦補。

## 車庫（TG2 結構）
零件分 4 級（含原廠），要一級一級買：引擎、變速箱、乾地胎、雨胎、氮氣、前／側／後裝甲。車款 9 種（隼 GT 免費起步，最貴 F1 $160k），買過的可以隨時換，6 種免費塗裝。起始獎金 $15,000。

## API
- REST：`GET /api/race/profile`、`POST /api/race/buy {kind,tier}|{car,paint?}`、`POST /api/race/exchange {dir:'in'|'out',coins}`、`GET /api/race/leaderboard/:track`。
- WS：`race.join {track}|{code}`、`race.create {track}`、`race.start`、`race.invite {share_code}`、`race.input`、`race.leave`；伺服器送 `race.lobby`、`race.room`、`race.started`、`race.snap`（每 2 tick）、`race.ended`（含 `qualified`、`champion`、`standings`）。
- 伺服器權威模擬（20 Hz），比賽中 `live.inMatch = true`。

## 限制（原型）
- 房間只存在單一 Cloud Run 執行個體的記憶體；邀請只送得到同一個執行個體上的連線。
- 資料表：`race_profiles`、`race_results`、`race_seasons`（migration `0008_racing`，還沒部署）。

## 開發預覽
`apps/web/race-preview.html?v=sheet|grid|pack|fog|nitro|rain|night|page`（`page` 用假的 API／WS 跑真正的頁面）。
