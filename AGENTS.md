# AGENTS.md — chick-baby

給 Codex 等 AI 工具看的專案規則。回覆使用者一律用**繁體中文**。

## 分工：Codex commit，Claude Code push 與部署

這個 repo 由兩個工具一起開發，流程固定如下：

1. **Codex**：改完、測試過，就在本機 `git commit`（直接 commit 在 `main`，不開分支、不開 PR）。
2. **不要 `git push`**。Codex 的執行環境連不到 GitHub（查不到 `github.com` 的 DNS），也讀不到 macOS 鑰匙圈裡的 token。push 失敗**不代表使用者的憑證失效**，不要叫使用者重新登入 GitHub。
3. **不要部署**（不要跑 `gcloud builds submit`、`gcloud run deploy`）。部署由 GitHub Actions 負責，push 由 Claude Code 負責。
4. commit 完回報 commit hash 和內容摘要即可，使用者會請 Claude Code 推上去。

### 為什麼一定要 commit，不能只 `git add`

- 暫存區是兩個工具共用的，只 `git add` 會跟另一邊的改動混在一起。
- 只有推上 GitHub 的 commit 才會上線；沒 commit 的改動不會被部署，也不會被推上去。

### commit 規則

- 作者一律是 `spigflying`（repo 的 local git config 已經設好，不要改 `user.name`／`user.email`）。commit 前可用 `git var GIT_AUTHOR_IDENT` 確認。
- message 用英文，格式 `<範圍>: <做了什麼>`，例如 `farm: illustrate chicken coop production panel`、`web: ...`、`server: ...`、`ci: ...`。
- 只 commit 自己這次改的檔案。不要用 `git add -A` / `git add .`，repo 裡有使用者還沒要進版控的檔案（`design/`、`apps/web/demo/` 下的部分檔案、`apps/web/public/farm/storybook*/` 等）。
- 開工前先 `git status` 看一下：如果有不是你改的、尚未 commit 的檔案，不要動它、不要一起 commit。

## commit 前要做的事

1. **跑測試**（本機沒有全域 pnpm，用 npx）：
   ```bash
   cd apps/web && npx vitest run && npx tsc -p .
   cd packages/engine && npx vitest run && npx tsc -p . --noEmit   # 有改引擎才需要
   cd apps/server && npx tsc -p . --noEmit && npx vitest run test/boot.test.ts test/closing.test.ts test/presence.test.ts test/http-hardening.test.ts   # 有改伺服器才需要
   ```
   GitHub Actions 部署前也會跑同一組測試，沒過就不會上線。
2. **玩家看得到的改變要更新 `apps/server/release-notes.json`**：3～5 行、每行一句中文（< 60 字），不要寫版本號（測試會檢查）。部署後玩家會看到「有新版本」和這些說明。上一次部署後的新改動，直接改寫或加在 `notes` 裡。

## 圖片：放 `apps/web/src/art/`，用 `art()` 取網址

- 遊戲圖檔放在 `apps/web/src/art/farm/...`、`apps/web/src/art/fight/...`，**不要放 `apps/web/public/`**。
- 程式裡用 `art('farm/coop/hen.webp')`（`apps/web/src/art.ts`）取網址。建置後網址會帶內容 hash、瀏覽器快取一年；換圖時 hash 跟著變，不用清快取。
- 不要寫死 `/farm/xxx.png`、`/fight/...` 或用 `import.meta.env.BASE_URL` 組圖片路徑，`test/art.test.ts` 會擋。
- `.dockerignore` 排除了 `*.png`，只放行 `apps/web/src/art/**/*.png`。PNG 放在別的地方，部署時會缺圖。

## 部署怎麼運作（知道就好，不用操作）

`.github/workflows/deploy.yml`，詳見 `docs/DEPLOY.md` §10：

| 觸發 | 時間（台北） | 結果 |
|---|---|---|
| push main | 平日 09:00–20:00（開放時間） | 只建置＋測試，不部署（換版會中止進行中的對戰／下樓梯） |
| push main | 其他時間 | 建置＋測試＋部署 |
| 手動執行 workflow | 任何時間 | 一定部署 |

- 只改 `*.md`、`docs/`、`design/` 不會觸發。
- 建置用的是 GitHub 上那個 commit 的內容，本機工作目錄裡的東西不會被帶上線。

## 其他

- GCP 專案 `silver-greens` 用個人帳號 `spigflying@gmail.com`，不要用 gcloud 預設的公司帳號。
- 會花錢的 GCP 操作（BigQuery 查詢、AI 推論、建立／放大資源等）預估超過 US$1 要先問使用者。
