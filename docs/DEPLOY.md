# 部署到 Cloud Run（專案 `silver-greens`）

> 本文件只列步驟，**尚未執行**。採用 [`gcp-plan.md`](gcp-plan.md) 的**方案 A**：Cloud Run + Cloud SQL `db-f1-micro`，都在 `asia-east1`。
> 專案 `silver-greens` 屬於個人帳號 **`spigflying@gmail.com`**；所有指令都在第 0 步建立的 gcloud configuration 下執行，不要用公司帳號。
> 根目錄的靜態原型（GitHub Pages）不受影響；Cloud Run 服務的是 `apps/web` + `apps/server`。

## 部署前要先完成的程式改動（另開 PR）

1. 前端在分頁隱藏或閒置時斷開 WebSocket（`apps/web/src/ws.ts`；要用 `stop()`／暫停旗標，只 `close()` 會被自動重連）。沒做的話只要有人開著分頁，Cloud Run 就 24 小時計費。
2. 連線池 `max: 10` → `8`（`apps/server/src/db.ts`）。f1-micro 只有 25 條連線：2 個執行個體 × 8 + 2 條 LISTEN = 18。

## 0. 帳號與變數

```bash
# 獨立的 gcloud configuration，避免用到預設的公司帳號
gcloud config configurations create chick-baby
gcloud auth login spigflying@gmail.com
gcloud config set account spigflying@gmail.com

export PROJECT_ID=silver-greens
export PROJECT_NUMBER=704427759894
export REGION=asia-east1
export SERVICE=chick-baby
export SQL_INSTANCE=chick-db
export DB_NAME=chick
export DB_USER=chick
export REPO=chick
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/server
export RUN_SA=chick-run@$PROJECT_ID.iam.gserviceaccount.com

gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

## 1. 啟用 API

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com iamcredentials.googleapis.com \
  billingbudgets.googleapis.com
```

## 2. 服務帳號

```bash
gcloud iam service-accounts create chick-run --display-name="chick-baby Cloud Run"
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUN_SA --role=roles/cloudsql.client
# Secret 存取權在第 4 步逐一授予
```

## 3. Cloud SQL（PostgreSQL 16）

```bash
gcloud sql instances create $SQL_INSTANCE \
  --database-version=POSTGRES_16 --region=$REGION \
  --edition=ENTERPRISE --tier=db-f1-micro --storage-size=10GB --storage-auto-increase \
  --backup-start-time=18:00 --enable-point-in-time-recovery \
  --retained-backups-count=7 --retained-transaction-log-days=7 \
  --availability-type=zonal
gcloud sql databases create $DB_NAME --instance=$SQL_INSTANCE
export DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
gcloud sql users create $DB_USER --instance=$SQL_INSTANCE --password="$DB_PASS"
```

- 備份時間 `18:00` UTC = 台北 02:00；自動備份保留 7 份、PITR 7 天，不需要另外的備份 Job。
- `--edition=ENTERPRISE` 不能省：shared-core（`db-f1-micro`）只有 Enterprise 版能用。
- `--availability-type=zonal`：SSD 為 $0.17/GB-月；HA（regional）會讓 instance 與儲存都變兩倍。
- f1-micro 預設 `max_connections = 25`，見上方「部署前要先完成的程式改動」第 2 點。
- 費用追蹤：在 Console 為 `chick-db` 加標籤 `app=chick-baby`（本機 gcloud 578.0.0 的 `sql instances create` 沒有 `--labels`）。
- 連線字串用 Cloud Run 內建的 Cloud SQL Unix socket（`--add-cloudsql-instances`），不必開公開 IP 授權網路：
  `postgres://chick:<DB_PASS>@/chick?host=/cloudsql/silver-greens:asia-east1:chick-db`

## 4. Secret Manager

```bash
printf '%s' "postgres://$DB_USER:$DB_PASS@/$DB_NAME?host=/cloudsql/$PROJECT_ID:$REGION:$SQL_INSTANCE" | \
  gcloud secrets create chick-database-url --data-file=-
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create chick-cron-secret --data-file=-
# 管理員 Email（逗號分隔，可多個）
printf '%s' "你的管理員@gmail.com" | gcloud secrets create chick-admin-emails --data-file=-

for s in chick-database-url chick-cron-secret chick-admin-emails; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor
done
```

## 5. Google OAuth 用戶端（Google 登入）

在 Cloud Console 操作（gcloud 無法建立 OAuth Web client）：

1. **APIs & Services → OAuth consent screen**
   - User type：**External**；App name：小雞寶寶；support email 填你的信箱。
   - Scopes：只加 `openid`、`.../auth/userinfo.email`、`.../auth/userinfo.profile`。
   - 填完後按 **Publish app**（發布到正式版；這三個 scope 不需要 Google 審查）。
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type：**Web application**，名稱 `chick-baby-web`。
   - **Authorized JavaScript origins**：
     - `https://chick-baby-704427759894.asia-east1.run.app`（第 7 步部署後的實際網址，以 `gcloud run services describe` 為準）
     - 有自訂網域再加上自訂網域
     - 本機測試可加 `http://localhost:5173`
   - Redirect URI 不需要（使用 Google Identity Services 的 ID token 流程）。
3. 記下 **Client ID**（`xxxx.apps.googleusercontent.com`），它不是機密，直接當環境變數：

```bash
export GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

## 6. 建置映像（Artifact Registry + Cloud Build）

```bash
gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION
# 在 repo 根目錄執行（使用根目錄的 Dockerfile）
gcloud builds submit --tag $IMAGE:$(git rev-parse --short HEAD) .
export TAG=$(git rev-parse --short HEAD)
```

## 7. 部署 Cloud Run

```bash
export SERVICE_URL=https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app

gcloud run deploy $SERVICE \
  --image=$IMAGE:$TAG \
  --service-account=$RUN_SA \
  --add-cloudsql-instances=$PROJECT_ID:$REGION:$SQL_INSTANCE \
  --allow-unauthenticated \
  --port=8080 \
  --min-instances=0 --max-instances=2 \
  --no-cpu-throttling \
  --concurrency=1000 \
  --timeout=3600 \
  --session-affinity \
  --cpu=1 --memory=512Mi \
  --labels=app=chick-baby \
  --set-env-vars=NODE_ENV=production,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,PUBLIC_ORIGIN=$SERVICE_URL \
  --set-secrets=DATABASE_URL=chick-database-url:latest,CRON_SECRET=chick-cron-secret:latest,ADMIN_EMAILS=chick-admin-emails:latest
```

說明：
- `--no-cpu-throttling` = instance-based billing，下樓梯遊戲迴圈不會被節流。WebSocket 開著時執行個體本來就一直計費，instance-based 單價比 request-based 低。
- `--cpu=1` 已是下限：低於 1 vCPU 必須用 request-based 計費且 concurrency=1，WebSocket 服務不適用。
- `--min-instances=0`：沒人連線時最多 15 分鐘就縮到 0、停止計費；代價是第一個人進來要等約 1–2 秒冷啟動。設 `min=1` 每月約多 US$40–50，不建議。
- `--max-instances=2`：受 Cloud SQL 25 條連線限制。要調高就同時調低連線池。
- `--timeout=3600` 讓 WebSocket 最長 60 分鐘；客戶端約 50 分鐘會在非比賽中主動重連。
- `--session-affinity` 讓重連盡量回到同一個執行個體；正確性不依賴它（跨執行個體用 Postgres `LISTEN/NOTIFY`）。
- 伺服器啟動時會自動執行 migration（Kysely，`kysely_migration_lock` 防止多個執行個體同時跑）。
- `NODE_ENV=production` 時開發用登入（`DEV_LOGIN`）一律關閉，Cookie 加上 `Secure`。
- 部署後確認網址：`gcloud run services describe $SERVICE --format='value(status.url)'`。若和 `$SERVICE_URL` 不同，更新 `PUBLIC_ORIGIN`（`gcloud run services update $SERVICE --update-env-vars=PUBLIC_ORIGIN=...`）與 OAuth 的 JavaScript origin。

## 8. 每日排程（Cloud Scheduler）

清除 30 天前稽核紀錄的 IP、7 天前的冪等紀錄與過期 session：

```bash
gcloud scheduler jobs create http chick-daily \
  --location=$REGION \
  --schedule="10 0 * * *" --time-zone="Asia/Taipei" \
  --uri="$SERVICE_URL/api/internal/daily" --http-method=POST \
  --headers="x-cron-secret=$(gcloud secrets versions access latest --secret=chick-cron-secret)"
```

## 9. 驗證

```bash
curl -s $SERVICE_URL/healthz
curl -s $SERVICE_URL/api/config | head -c 300
```

瀏覽器打開 `$SERVICE_URL`，用 Google 帳號登入；用 `ADMIN_EMAILS` 裡的帳號登入後，頂部會出現「管理」。

## 10. 更新版本

```bash
export TAG=$(git rev-parse --short HEAD)
gcloud builds submit --tag $IMAGE:$TAG .
gcloud run deploy $SERVICE --image=$IMAGE:$TAG
```

Cloud Run 換版時會送 SIGTERM：伺服器廣播 `server.draining`、把進行中的下樓梯標記為 `aborted`（不發獎勵、不扣精力），然後關閉連線；客戶端自動重連到新版本。

## 11. 預算提醒（不要設 Cloud Run spend cap）

```bash
export BILLING_ACCOUNT=$(gcloud billing projects describe $PROJECT_ID --format='value(billingAccountName)' | sed 's#billingAccounts/##')
# 金額不帶幣別 = 用帳單帳戶的幣別；帳單是 TWD 就填 1300，是 USD 就填 40
gcloud billing budgets create --billing-account=$BILLING_ACCOUNT \
  --display-name=chick-baby-monthly --budget-amount=40 \
  --filter-projects=projects/$PROJECT_ID \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

- 預算只會寄信提醒，不會停服務。Cloud Run spend cap 會暫停**整個專案**的 Cloud Run（包含 `silver-greens`、`vote-lab`），所以不設。
- 範圍是整個 `silver-greens` 專案，會包含既有服務的花費；要只看本服務，就在 Billing Reports 用標籤 `app=chick-baby` 篩選。

## 需要使用者提供 / 決定的事項

| 項目 | 說明 |
|---|---|
| OAuth Client ID | 第 5 步在 Console 建立後提供 |
| 管理員 Email | 寫入 `chick-admin-emails` secret |
| 帳單 | `silver-greens` 需要已連結帳單帳戶。預估每月約 NT$500（上班時段才有人玩）～NT$820；有人 24 小時開著分頁會到約 NT$1,760。已扣 Cloud Run instance-based 免費額度（2026-10-14 確認未被其他服務使用）；明細見 `gcp-plan.md` §0、§3 |
| 自訂網域（選用） | `gcloud beta run domain-mappings create --service=$SERVICE --domain=...`，並加到 OAuth origins 與 `PUBLIC_ORIGIN` |
