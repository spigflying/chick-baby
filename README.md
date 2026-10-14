# 🐣 小雞寶寶 chick-baby

一款用純 HTML / CSS / JavaScript 製作的網頁版電子雞（Tamagotchi），不需要任何建置步驟，手機也能玩！

線上遊玩：https://spigflying.github.io/chick-baby/


## 多人版（M1，開發中）

規格：[`docs/requirements.md`](docs/requirements.md) v1.2（平日 09:00–20:00 開放，其他時間「夜間睡覺」、時間凍結）。根目錄的 `index.html / script.js / style.css` 是單機原型（GitHub Pages），多人版放在 pnpm monorepo：

| 路徑 | 內容 |
|---|---|
| `packages/engine` | 共用遊戲邏輯（寵物模擬 timeScale、食物、物種、下樓梯引擎 + seeded RNG），前後端共用 |
| `apps/server` | Node 22 + TypeScript、Fastify + ws、Kysely migration、Postgres `LISTEN/NOTIFY` |
| `apps/web` | Vite + TypeScript，彩色像素蛋殼 + Game Boy 四綠螢幕（移植原型精靈與動畫） |

### 本機執行

```bash
docker compose up -d            # Postgres 16（chick / chick；同時建立 chick_test）
cp apps/server/.env.example apps/server/.env   # DEV_LOGIN=1 開啟免 Google 的開發登入
pnpm install
pnpm dev                        # server :8080 + web :5173（Vite 代理 /api、/ws）
```

打開 http://localhost:5173 ，用「開發用登入」輸入任意名字（`dev-admin` 為管理員）。
本機預設永遠開放；在 `apps/server/.env` 設 `OPEN_HOURS=mon-fri 09:00-20:00 Asia/Taipei` 可以試開放時間與睡覺畫面。
要測 Google 登入：在 `.env` 填 `GOOGLE_CLIENT_ID`，並把 `http://localhost:5173` 加到 OAuth 用戶端的 JavaScript origins。

```bash
pnpm test        # engine + server（需要 Postgres 的 chick_test）+ web
pnpm typecheck
pnpm build       # web/dist + server/dist
docker build -t chick-baby .   # Cloud Run 單一容器
```

部署步驟：[`docs/DEPLOY.md`](docs/DEPLOY.md)。

## 特色
- 復古像素風：彩色像素蛋殼外殼，加上 Game Boy 四色綠螢幕，所有操作都在螢幕內完成
- 五項狀態：飽食度、快樂度、精力、清潔度、健康，會隨真實時間下降
- 成長階段：蛋（0–2 分鐘）→ 小雞（2–60 分鐘）→ 大雞（60 分鐘以上）
- 可以幫寵物取名字
- 照顧不好會生病 🤒、會便便 💩，健康歸零就會死掉，可以重新開始
- 進度自動存在瀏覽器 localStorage，關掉網頁後再打開，會計算離線期間的狀態變化

## 怎麼玩
1. 打開網頁，輸入名字開始孵蛋
2. 點螢幕下方的像素圖示（或用鍵盤 ←→ 選擇、Enter 確定、Esc 返回）：
   - 🍗 **餵食**：開啟食物選單。米粒免費，其他食物要花金幣（◎）購買，蛋糕等食物在長大後才會解鎖
     | 食物 | 價格 | 解鎖 | 飽食 | 快樂 | 健康 | 體重 | 力量 | 速度 | 體力 |
     |---|---|---|---|---|---|---|---|---|---|
     | 米粒 | 免費 | 小雞 | +20 | +2 | +1 | +1 | | | +0.5 |
     | 糖果（點心） | ◎3 | 小雞 | +5 | +20 | -3 | +2 | | +1 | |
     | 蟲蟲 | ◎5 | 小雞 | +20 | +8 | +3 | +1 | +4 | +1 | +1 |
     | 玉米 | ◎10 | 大雞 | +35 | +6 | +4 | +2 | +2 | +3 | +4 |
     | 蛋糕（點心） | ◎15 | 大雞 | +10 | +35 | -5 | +4 | +2 | | +2 |
   - 🪜 **樓梯**：小遊戲「小雞下樓梯」。用 ←→ 鍵、畫面下方的 ◀ ▶ 按鈕，或按住滑鼠左鍵／右鍵來移動，一直往下跳
     - 平台種類：普通（踩上去回 1 HP）、尖刺（-4 HP）、輸送帶、彈簧、易碎
     - 頂端尖刺會扣 HP；HP 歸零或掉出畫面底部就結束
     - 每下 1 樓得 ◎1 金幣；每玩一次消耗精力，增加快樂度和速度
     - 速度越高移動越快，體力越高 HP 越多；按 Esc 或「離開」可結束遊戲
   - 🌙 **睡覺**：恢復精力、體力提升；再按一次叫醒
   - 💧 **清潔**：清掉便便
   - ✚ **看醫生**：治療生病
   - 📊 **狀態**：查看力量、速度、體力、體重、性格、出生時間與 ID
3. 數值太低會讓健康下降，健康歸零寵物就會死掉，點畫面就能重新開始

## 資料格式
存檔放在 localStorage（`chickBabyState`），格式為 `schemaVersion: 3` 的單一 JSON 物件，包含 `id`、`birthTime` 和 `traits`（力量、速度、體力、體重、性格）、`coins`（金幣）、`bestFloor`（最深樓層）。這份 JSON 之後可以直接寫進 Firestore 文件；舊版存檔會自動轉換成新格式。

## 本機執行
直接用瀏覽器開啟 `index.html` 即可。
