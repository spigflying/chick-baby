# 小雞寶寶 多人版 — 需求文件 v1

> 版本：v1（2026-10-13，已與 Benson 確認）
> 原則：**先做出能上線的 v1，同時保留擴充性**（對戰、合體、更多物種）。
> 標記：**【預設】** = 尚未定案，v1 先照此實作，之後可在 `game_config` 或後續版本調整（見第 12 節）。
> 現有單人原型（repo 根目錄的 `index.html` / `script.js` / `style.css`，https://spigflying.github.io/chick-baby/）**維持不動**，新版另建於 monorepo 資料夾。

---

## 1. 背景與目標

- 原型：純前端單人電子雞，復古像素風（彩色像素蛋殼 + Game Boy 四色綠螢幕），存檔在 localStorage（`schemaVersion: 3`）。
- v1 目標：**多人版**——每個使用者有自己的家與一隻寵物，可以拜訪別人、用自己的金幣幫別人餵食、和其他人在同一個畫面即時玩「小雞下樓梯」。
- 核心原則：**伺服器權威**。規則、數值、金幣全部由後端決定；網頁只負責顯示與送出操作。
- 每隻寵物、每個重要行為都**永久保存**，為之後的對戰與合體留資料。

## 2. 範圍

| | v1 | 之後 |
|---|---|---|
| 登入 | 任何 Google 帳號 | — |
| 寵物 | 每人一隻存活中的寵物；4 種物種（雞、鴨、企鵝、恐龍）；死亡可重孵；所有歷史寵物永久保存 | 一人多隻、更多物種、合體 |
| 家與拜訪 | 預設所有人可進入；黑名單；僅邀請 / 不開放模式 | 留言、送禮、裝飾 |
| 訪客 | **只能餵食** | 其他互動 |
| 餵食與錢包 | 個人錢包、固定價格、每日次數上限 | 商店擴充 |
| 下樓梯 | 單人模式 + **多人即時同畫面（2–6 人，可互相推擠）** | 排行榜、觀戰、對戰 |
| 管理 | 管理員查看所有使用者與寵物（含死亡紀錄）、復活任何寵物 | 管理後台擴充 |
| 部署 | Cloud Run 單一執行個體 + Cloud SQL | 多執行個體擴展 |

## 3. 角色

| 角色 | 說明 |
|---|---|
| 使用者 | 用 Google 帳號登入；擁有一個家、一隻存活寵物（加上已死亡的歷史寵物）、一個錢包 |
| 屋主 | 家的擁有者；可對自己的寵物做所有動作；設定進入模式、邀請名單、黑名單 |
| 訪客 | 能進入他人家的使用者；**只能餵食**，花自己的金幣 |
| 管理員 | Benson；可查看所有使用者與所有寵物（含死亡紀錄）、復活任何寵物、調整遊戲參數。以部署環境變數 `ADMIN_EMAILS` 指定 |
| 伺服器 | 唯一的規則與數值權威 |

## 4. 功能需求

### 4.1 寵物、物種與成長

- **孵化**：新寵物從蛋開始，**1 分鐘內孵化**（`eggSeconds` 預設 60）。蛋的期間狀態不衰減、不能做任何動作。
- **沒有結局階段**：孵化後不再有「大雞」之類的階段變化，**只會一直透過能力值成長**；唯一的結束方式是照顧不周而死亡。
  - 原型的「玉米、蛋糕要大雞才解鎖」改為：孵化後**所有食物都可以吃**。
  - 孵化後每個物種只有一種外型（含走路 2 幀、睡覺 1 幀）。
- **物種**（開局選擇，之後不能改）：`species` 欄位 + 各物種精靈圖 + 能力傾向；物種定義放在共用設定，**新增物種 = 加一筆定義 + 精靈圖**。

  | 物種 | 傾向 | 初始 力量/速度/體力/體重 | 成長倍率（食物、遊戲、睡覺帶來的能力增加） |
  |---|---|---|---|
  | 雞 | 平均 | 10 / 10 / 10 / 20 | 全部 ×1.0 |
  | 鴨 | 體力高 | 9 / 9 / 14 / 22 | 體力 ×1.3 |
  | 企鵝 | 速度快 | 9 / 14 / 10 / 22 | 速度 ×1.3 |
  | 恐龍 | 力量強 | 14 / 8 / 10 / 26 | 力量 ×1.3 |

  數值為【預設】。下樓梯的碰撞框所有物種一致（公平性）。
- **狀態**（沿用原型）：飽食 / 快樂 / 精力 / 清潔 / 健康，範圍 0–100，初始 80/80/80/100/100。
  - 每分鐘衰減（原型）：飽食 −0.8、快樂 −0.6、精力 −0.5、清潔 −0.4；睡覺時飽食 ×0.5、快樂 ×0.3、精力 +2，精力滿 100 自動醒。
  - 便便：每分鐘 2% 機率 +1（最多 3）；每坨每分鐘清潔再 −0.3。
  - 生病：清潔 < 25 或飽食 < 15 時，每分鐘 5% 機率。
  - 健康：每項 < 20 的狀態每分鐘 −0.6，生病再 −0.8；全部正常且沒生病則 +0.3。
  - **時間倍率 `timeScale`**：上面所有每分鐘速率（含機率）都乘上 `timeScale`。原型的速率大約 2 小時就會餓到底，在「會真的死」的規則下太快；【預設】`timeScale = 1/12`（約 20 小時沒餵飽食才會掉到 20 以下，完全不照顧約 1–2 天會死）。
- **屋主動作**（沿用原型）：餵食、睡覺/起床（體力 +0.5）、清潔（清潔 = 100、便便清空）、看醫生（解除生病、健康 +30、快樂 −10；健康 > 90 且沒生病時不用看）、下樓梯、看狀態。睡覺時只能叫醒。
- **能力值**：力量、速度、體力、體重（1–999）、性格（溫和 / 貪吃 / 活潑 / 懶散 / 勇敢 / 機靈，依行為計數判定，規則沿用原型）。
- **死亡**：健康 0 = **真的死亡**，寫入 `died_at` 與死因。屋主可以**孵一隻新的**（重新選物種、取名）；舊寵物保留為歷史紀錄。
- **永久保存**：每個使用者養過的每一隻寵物都永久保存（不刪除），包含能力值與事件歷史。
- **一人一隻**：v1 每人同時只能有**一隻存活中的寵物**（DB 部分唯一索引保證）；資料模型保留一人多隻的可能。
- **管理員復活**：管理員可以復活任何死亡寵物。【預設】復活後健康 50、飽食/快樂/精力/清潔 50、不生病、便便清空，能力值保留；若該使用者目前已有存活寵物則**拒絕復活**（需先處理，見 Q4）。

### 4.2 家與拜訪權限

- 每個使用者第一次登入時自動建立一個家。
- 進入模式（屋主設定）：

  | 模式 | 誰能進入 |
  |---|---|
  | `open`（**預設**） | 所有登入的使用者，**黑名單上的人除外** |
  | `invite_only` | 只有邀請名單上的人（黑名單仍優先） |
  | `closed` | 只有屋主 |

- 屋主可以管理黑名單與邀請名單（加入/移除）；被加入黑名單或模式變更時，伺服器立即把不符資格的訪客踢出房間。
- 【預設】邀請 = 屋主從使用者列表直接加入邀請名單，撤銷前一直有效；屋主不在線時被邀請的人也能進入；v1 不做「敲門」。
- 首頁顯示可進入的家列表（可搜尋），進入家 = 加入該家的即時房間（WebSocket），看到寵物即時狀態、目前在場的人與其他人的動作（例如「Amy 餵了蟲蟲」）。
- 死亡寵物的家顯示墓碑；訪客不能餵食。

### 4.3 餵食與錢包

- **錢包屬於使用者**（原型的 `coins` 改存在使用者錢包）。新使用者起始 **◎20**。
- **固定價格**，餵自己或別人的寵物一樣價錢。食物表沿用原型（孵化後全部可吃）：

  | 食物 | 價格 | 飽食 | 快樂 | 健康 | 體重 | 力量 | 速度 | 體力 |
  |---|---|---|---|---|---|---|---|---|
  | 米粒 | 免費 | +20 | +2 | +1 | +1 | | | +0.5 |
  | 糖果（點心） | ◎3 | +5 | +20 | −3 | +2 | | +1 | |
  | 蟲蟲 | ◎5 | +20 | +8 | +3 | +1 | +4 | +1 | +1 |
  | 玉米 | ◎10 | +35 | +6 | +4 | +2 | +2 | +3 | +4 |
  | 蛋糕（點心） | ◎15 | +10 | +35 | −5 | +4 | +2 | | +2 |

  其他規則（原型）：飽食 > 95 拒吃；每次餵食清潔 −4；30% 機率便便；寵物睡覺時不能餵。
- **每日上限**（Asia/Taipei 00:00 重置，**免費米粒也算**）：
  - 每隻寵物每天總共最多被餵 **20 次**（屋主 + 所有訪客）。
  - 同一位訪客對同一隻寵物每天最多 **5 次**。【預設】屋主不受 5 次限制，但算在 20 次內。
- **低健康保護**：寵物健康偏低時，**訪客不能餵點心（糖果、蛋糕）**，只能餵正餐。【預設】門檻為健康 < 30；屋主不受限制。
- **處理流程**：前端送 `feed {pet_id, food_id, request_id}` → 伺服器先把寵物狀態結算到現在 → 檢查（權限、存活、睡覺、飽食、上限、低健康保護、餘額）→ **在單一 DB transaction 內**扣幣、更新寵物、更新每日計數、寫 ledger / 事件 / 稽核 → 廣播結果。前端只播放動畫。
- 價格、上限、門檻全部放伺服器 `game_config`。

### 4.4 小雞下樓梯

#### 共通
- 玩法沿用原型：平台有 普通（踩到回 1 HP）/ 尖刺（−4 HP）/ 輸送帶 / 彈簧 / 易碎；頂端尖刺 −4 HP；HP 歸零或掉出畫面底部就出局。
- 能力影響：HP 上限 `10 + min(4, floor((體力−10)/5))`；移動速度 `1.2 + min(0.5, (速度−10)×0.03)`。
- 開始條件：精力 ≥ 15；寵物存活且醒著。
- 結算（沿用原型）：精力 −15、飽食 −8、快樂 +10+min(15, ⌊樓層/2⌋)、速度 +min(2, 0.5+樓層×0.03)（乘以物種倍率）、體重 −1。
- **遊戲引擎**：TypeScript 共用套件 `packages/engine`，伺服器與前端跑同一份程式碼；決定性設計（固定 tick、seeded PRNG，例如 mulberry32；不使用 `Math.random()`、不依賴實際時間）。
- 【預設】**單人模式也由伺服器權威模擬**（等於只有 1 人的房間），和多人用同一條路徑，金幣才可信。

#### 單人模式
- 每下 1 樓 = **◎1**（原型規則）。

#### 多人模式（v1 必做）
- 房間人數 **2–6 人**。開房 → 其他人加入 → 房主開始；開始後不能中途加入。
- **所有人的寵物在同一個畫面**，同一組平台。
- **碰撞與推擠**：寵物之間有碰撞，會互相推擠，可以把別人推下平台、推到尖刺或推出畫面（被推死）。被誰推出局要記錄在事件中（之後對戰可用）。
- **伺服器權威即時模擬**：
  - 伺服器以【預設】**30 tick/秒**模擬（與原型 33ms 一幀一致；可設 20–30），每 2 tick 廣播一次快照（約 15 次/秒）。
  - 前端**只送左右輸入**：`{seq, tick, left, right}`。
  - 前端對**自己的寵物做預測**（用共用引擎先跑），收到伺服器快照後校正；**其他人的寵物用插值**（延後約 100ms 顯示）。
- 【預設】排名與結束：依出局順序排名（越晚出局越前面）；剩 1 人存活時比賽結束，該人第 1 名；比賽最長 5 分鐘，時間到時依樓層排名。
- 斷線：比賽期間斷線時角色留在場上（視為沒有按鍵），在比賽結束前重連可以繼續操作。
- **出局只影響該局**：多人賽的死亡**不會**扣寵物健康。
- **獎勵**：所有人都有保底獎勵（就算一開始就出局），名次越前越多。【預設】`◎5 + (人數 − 名次) × 3`（例如 6 人局：第 1 名 ◎20 … 第 6 名 ◎5）；多人模式不另外按樓層給幣。目的是鼓勵大家賺幣去拜訪、餵別人的寵物。
- 【預設】多人模式的場地寬度比單人寬（單人邏輯寬 96px，多人 144px），避免 6 隻寵物太擠。

### 4.5 金幣經濟

- 來源：起始 ◎20、單人下樓梯（1 樓 = ◎1）、多人下樓梯（保底 + 名次）。
- 消耗：食物（◎3–15）；之後可能新增對戰、合體等用途。
- 金幣**只能由伺服器在 DB transaction 中變動**，每筆變動都寫 `coin_ledger`（原因與關聯事件）；餘額可以由 ledger 加總對帳。
- v1 不能轉帳。【預設】v1 不設每日賺幣上限，用 ledger 觀察；`game_config` 預留 `dailyEarnCap`。

### 4.6 管理員功能

- 查看所有使用者、錢包、每個使用者的**所有寵物**（含死亡紀錄、能力值、事件歷史）。
- 復活任何死亡寵物（見 4.1）。
- 每個管理動作都寫入稽核紀錄。
- 【預設】v1 只做上面的查看與復活頁面；參數調整直接改 `game_config`，補幣/扣幣用管理指令且一定寫 ledger。

## 5. 伺服器權威與防作弊

- 前端**只送操作意圖**（`feed`、`clean`、`sleep`、`doctor`、下樓梯左右輸入），不送任何數值結果。
- 狀態衰減與隨機事件（便便、生病）由伺服器計算，亂數在伺服器端產生。
- 下樓梯完全在伺服器模擬；客戶端預測只用來讓畫面順暢，最後結果以伺服器為準。輸入要驗證格式與頻率（每 tick 最多一筆，序號遞增）。
- 金幣與寵物更新：同一 transaction 內 `SELECT … FOR UPDATE` 鎖住錢包與寵物 → 檢查 → 更新 → 寫 ledger / 事件 / 稽核；用 `request_id` 讓重送的請求不會重複執行。
- 每個動作都在伺服器重新檢查權限（進入模式、黑名單、邀請、存活、上限），不信任前端狀態。
- 【預設】離線衰減用**存取時結算**：每次讀取或寫入寵物時，依 `last_simulated_at` 補算到現在（以分鐘為單位迴圈，與原型 `simulate()` 相同），結果寫回 DB。

## 6. 非功能需求

| 類別 | 需求 |
|---|---|
| 安全 | 開放任何 Google 帳號，所以視為公開網路服務：後端驗證 Google ID token（`aud`、`iss`、`exp`、`email_verified`）；session 用 HttpOnly + Secure + SameSite cookie；WebSocket 連線時驗證 session 與 `Origin`；名字長度/字元驗證、輸出跳脫；DB 密碼放 Secret Manager |
| 稽核 | `audit_log` 記錄誰、何時、做什麼、對象、結果、變化內容、IP/UA；只新增、不修改。【預設】永久保存；屋主可以看到自己寵物被誰餵過 |
| 頻率限制 | 每使用者每類動作（例：餵食每分鐘 ≤ 10 次）、每條 WS 連線每秒訊息數（下樓梯輸入 ≤ 每秒 35 筆）、登入與 API 全域限制；超過回 `RATE_LIMITED` 並記錄。v1 單一執行個體，計數可放在記憶體，每日上限放 DB |
| 效能 | 【預設】規模 ≤ 200 使用者、同時在線 ≤ 50、同時進行中的下樓梯房間 ≤ 10；動作回應 p95 < 300ms；房間廣播 < 1 秒；下樓梯快照 15 次/秒，每局頻寬 < 50 KB/s |
| 可用性 | 內部工具等級，可以接受短暫中斷；部署或執行個體重啟時進行中的比賽會中斷（不發獎勵、不扣精力）；WS 斷線自動重連並重新同步 |
| 相容性 | 桌機與手機瀏覽器（鍵盤、觸控按鈕、滑鼠左右鍵，沿用原型操作） |
| 擴充性 | 物種、食物、參數用資料定義；引擎用共用套件；資料模型保留一人多隻與多執行個體擴展的空間 |

## 7. 技術架構

```
瀏覽器（apps/web：TypeScript，像素 UI，Canvas）
   │ HTTPS (REST)          │ WSS (家的房間、下樓梯比賽)
   ▼                       ▼
Cloud Run（apps/server：Node.js + TypeScript，REST + WebSocket + 遊戲迴圈，同時提供靜態前端）
   │ Cloud SQL Node.js Connector / Unix socket
   ▼
Cloud SQL for PostgreSQL
```

- **Repo**：沿用 `spigflying/chick-baby`，monorepo：
  - `apps/web`：新版前端
  - `apps/server`：API + WebSocket + 遊戲迴圈
  - `packages/engine`：共用遊戲邏輯（寵物模擬、下樓梯、物種與食物定義）
  - 根目錄原型（`index.html` / `script.js` / `style.css`）與 GitHub Pages 維持不動。
- 【預設】技術選型：Node.js 22 LTS、pnpm workspaces、Vite（前端）、Fastify + `ws`（後端）、Kysely 或 Drizzle + SQL migration、Vitest。引擎要寫決定性測試（同 seed、同輸入 → 同結果）。
- **GCP**：專案 `silver-greens`（專案編號 704427759894）。【預設】區域 `asia-east1`（台灣），Cloud Run 與 Cloud SQL 放同一區。
- **Cloud Run 設定**：
  - **`max-instances=1`**：v1 所有房間都在同一個執行個體上，不需要跨執行個體廣播或 session affinity。
  - `min-instances=1` 並使用 instance-based billing（CPU 一直配置），讓遊戲迴圈不被節流，也避免冷啟動。
  - request timeout 設 **3600 秒**（WebSocket 連線上限）；前端**必須自動重連**（指數退避）並重新取得狀態；比賽中重連可以回到原本的比賽。
  - concurrency 調高（例如 1000），讓所有 WebSocket 能連到同一個執行個體。
  - 之後若要多執行個體：改用 Postgres `LISTEN/NOTIFY` 或 Memorystore Redis 做廣播，比賽房間依房間 ID 指定到特定執行個體。
- **Cloud SQL**：PostgreSQL 16；使用連線池；開啟每日自動備份與時間點復原（寵物要永久保存）。
- **登入**：Google Identity Services，前端取得 ID token → `POST /auth/google` → 後端驗證後建立 session。不限網域；OAuth 同意畫面為 External，只用 `openid email profile`，並發布到正式版（避免測試模式的 100 人限制）。
- **秘密資訊**：OAuth client ID、DB 密碼、session secret 放 Secret Manager；`ADMIN_EMAILS` 用環境變數。

## 8. 資料模型（PostgreSQL）

| 表 | 主要欄位 | 說明 |
|---|---|---|
| `users` | id, google_sub (unique), email, display_name, avatar_url, role (`user`/`admin`), created_at, last_login_at | |
| `wallets` | user_id (PK), balance (int, ≥ 0), updated_at | 餘額，可由 ledger 對帳 |
| `coin_ledger` | id, user_id, delta, balance_after, reason (`signup`/`stairs_solo`/`stairs_match`/`feed`/`admin`), ref_type, ref_id, request_id (unique), created_at | 只新增 |
| `homes` | id, owner_id (unique), name, access_mode (`open`/`invite_only`/`closed`，預設 `open`), created_at | |
| `home_invites` | home_id, user_id, created_at | 邀請名單 |
| `home_blacklist` | home_id, user_id, created_at | 黑名單 |
| `species` | id (`chicken`/`duck`/`penguin`/`dino`), name, base_traits (jsonb), growth_multipliers (jsonb), enabled | 也可以放在 engine 裡的程式定義，DB 只存 id |
| `pets` | id (UUID), owner_id, species_id, name, status (`egg`/`alive`/`dead`), born_at, hatched_at, last_simulated_at, hunger, happiness, energy, cleanliness, health, poop, sick, sleeping, strength, speed, stamina, weight, personality, best_floor, counters (jsonb), died_at, death_cause, revived_at, revived_by, version | 部分唯一索引：每個 owner 只能有一筆 `status IN ('egg','alive')`；永不刪除 |
| `pet_events` | id, pet_id, actor_user_id, type (`hatch`/`feed`/`clean`/`sleep`/`wake`/`doctor`/`poop`/`sick`/`death`/`revive`/`stairs_solo`/`stairs_match`), payload (jsonb：食物、數值變化、樓層、名次、被誰推出局), created_at | 永久保存 |
| `feed_counters` | pet_id, actor_user_id, day (date, Asia/Taipei), count | PK (pet_id, actor_user_id, day)；每隻每日總數用 SUM 計算 |
| `stair_matches` | id, mode (`solo`/`multi`), host_user_id, status (`waiting`/`playing`/`done`/`aborted`), seed, engine_version, started_at, ended_at | |
| `stair_match_players` | match_id, user_id, pet_id, rank, floors, eliminated_at_tick, eliminated_by_pet_id, coins_awarded | |
| `game_config` | key, value (jsonb), updated_by, updated_at | 價格、上限、timeScale、門檻、獎勵公式參數 |
| `audit_log` | id, at, user_id, action, target_type, target_id, result, detail (jsonb), ip, user_agent, request_id | 只新增 |

## 9. API 與事件

**REST（HTTPS，JSON）**

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/auth/google` | 送 ID token，換 session（第一次登入：建立使用者、錢包 ◎20、家） |
| POST | `/auth/logout` | |
| GET | `/me` | 自己的資料、錢包、家、目前寵物 |
| GET | `/config` | 物種、食物、價格、上限（顯示用） |
| GET | `/homes?q=` | 可以進入的家列表 |
| GET | `/homes/:id` | 家與寵物狀態（先結算到現在） |
| PATCH | `/homes/:id` | 修改進入模式（屋主） |
| PUT/DELETE | `/homes/:id/invites/:userId` | 邀請名單 |
| PUT/DELETE | `/homes/:id/blacklist/:userId` | 黑名單 |
| POST | `/pets` | 孵蛋 `{species, name}`（沒有存活寵物時才可以） |
| GET | `/pets/:id/events` | 寵物歷史（屋主、管理員） |
| GET | `/users/:id/pets` | 某使用者的所有寵物（本人、管理員） |
| GET | `/admin/users` | 管理員：所有使用者 |
| POST | `/admin/pets/:id/revive` | 管理員：復活 |

**WebSocket**（`wss://…/ws`，連線時驗證 session；每則訊息 `{type, ...}`）

| 方向 | 事件 | 內容 |
|---|---|---|
| C→S | `home.join` / `home.leave` | home_id |
| C→S | `pet.action` | `{pet_id, action: feed/clean/sleep/doctor, food_id?, request_id}`（訪客只能 `feed`） |
| S→C | `home.presence` | 目前在場的人 |
| S→C | `pet.updated` | 最新狀態 + 觸發者 + 動作（前端播動畫） |
| S→C | `wallet.updated` | 新餘額 |
| S→C | `home.kicked` | 被移出（黑名單、模式變更） |
| C→S | `match.create` / `match.join` / `match.leave` / `match.start` | mode, match_id |
| S→C | `match.lobby` | 房內玩家、房主 |
| S→C | `match.started` | seed, engine_version, start_tick, 玩家與初始位置 |
| C→S | `match.input` | `{seq, tick, left, right}` |
| S→C | `match.snapshot` | tick、每位玩家位置/速度/HP/樓層、平台狀態、最後處理的 input seq（給預測校正用） |
| S→C | `match.eliminated` | pet_id, tick, 原因（尖刺/掉落/被推）, 推的人 |
| S→C | `match.ended` | 名次、樓層、獎勵、寵物變化 |
| S→C | `error` | code：`FORBIDDEN`、`RATE_LIMITED`、`INSUFFICIENT_COINS`、`DAILY_CAP`、`LOW_HEALTH_SNACK`、`PET_DEAD`、`PET_SLEEPING`、`TOO_FULL`… |

## 10. 從原型搬過來的重點

- 原型 `simulate()`、食物、性格、下樓梯邏輯搬到 `packages/engine`，改成 TypeScript、決定性（seeded PRNG + 固定 tick），並加上 `timeScale`、物種倍率與多人碰撞。
- `coins` 改存到使用者錢包；成長階段改為「蛋 → 孵化後一直成長」，取消食物的階段解鎖。
- 像素圖：沿用原型的調色盤與精靈格式；新增鴨、企鵝、恐龍的精靈圖。
- 【預設】原型 localStorage 存檔**不匯入**。

## 11. 視覺

- 維持復古像素風：彩色像素蛋殼外殼 + Game Boy 四色綠螢幕（`#9bbc0f` `#8bac0f` `#306230` `#0f380f`）。
- 【預設】寵物、家、下樓梯畫面在蛋殼螢幕內；家列表、登入、管理頁等大廳介面放在蛋殼外，使用同一套四色綠像素風格。

## 12. 待確認問題（v1 先照【預設】實作）

1. **時間倍率**：【預設】`timeScale = 1/12`（完全不照顧約 1–2 天會死）。要更慢嗎？下班或週末要不要暫停衰減？
2. **低健康保護門檻**：【預設】健康 < 30 時訪客不能餵糖果、蛋糕；屋主不受限制。
3. **屋主自己餵食**：【預設】算在每隻每日 20 次內，但不受「同一人 5 次」限制。
4. **管理員復活規則**：【預設】健康與其他狀態回到 50、能力值保留；使用者已有存活寵物時拒絕復活。要改成兩隻並存，或讓管理員選擇封存目前那隻嗎？
5. **物種數值**：【預設】見 4.1 表格（鴨體力、企鵝速度、恐龍力量 ×1.3）。
6. **多人獎勵公式**：【預設】`◎5 + (人數 − 名次) × 3`，不另外按樓層給幣；多人模式也消耗 15 精力並套用成長結算。
7. **多人結束條件**：【預設】剩 1 人時結束，最長 5 分鐘；時間到時依樓層排名。
8. **多人場地寬度**：【預設】邏輯寬 144px（單人 96px）。
9. **單人下樓梯**：【預設】也由伺服器權威模擬（1 人房間）。
10. **離線衰減**：【預設】讀寫寵物時結算；不做定時排程與死亡通知。
11. **邀請機制**：【預設】屋主直接把人加入邀請名單，撤銷前一直有效；不做敲門。
12. **每日賺幣上限**：【預設】v1 不設上限，用 ledger 觀察。
13. **稽核與可見度**：【預設】稽核永久保存；屋主可以看到自己寵物被誰餵過。
14. **規模**：【預設】≤ 200 使用者、同時在線 ≤ 50、同時進行的比賽 ≤ 10。
15. **技術選型細節**：【預設】Node 22、pnpm、Vite、Fastify + ws、Kysely/Drizzle、Vitest；區域 asia-east1。
16. **封鎖濫用者**：開放任何 Google 帳號後，要不要有全站停權？【預設】v1 只做各家黑名單，管理員必要時直接改 DB。
17. **舊存檔**：【預設】原型 localStorage 存檔不匯入。
