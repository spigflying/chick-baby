# 部署到 Cloud Run（專案 `silver-greens`）

> 2026-10-14 已依本文件部署完成（服務網址 `https://chick-baby-704427759894.asia-east1.run.app`）。採用 [`gcp-plan.md`](gcp-plan.md) 的**方案 A**：Cloud Run + Cloud SQL `db-f1-micro`，都在 `asia-east1`；遊戲只在**平日 09:00–20:00** 開放（[`requirements.md`](requirements.md) §4.7），其他時間 Cloud SQL 由排程停機。

> 2026-10-14 已切換到自訂網域 **`https://chick.thesilvertrees.com`**（見第 7a 步）。`PUBLIC_ORIGIN`、`CRON_OIDC_AUDIENCE` 與 `chick-daily` 的 URI／audience 都已改用此網域；舊的 run.app 網址仍可連線。
> 專案 `silver-greens` 屬於個人帳號 **`spigflying@gmail.com`**；所有指令都在第 0 步建立的 gcloud configuration 下執行，不要用公司帳號。
> 根目錄的靜態原型（GitHub Pages）不受影響；Cloud Run 服務的是 `apps/web` + `apps/server`。

## 部署前要先完成的程式改動（另開 PR）

1. 前端在分頁隱藏或閒置時斷開 WebSocket（`apps/web/src/ws.ts`；要用 `stop()`／暫停旗標，只 `close()` 會被自動重連）。沒做的話只要有人開著分頁，Cloud Run 就 24 小時計費。
2. 連線池 `max: 10` → `8`（`apps/server/src/db.ts`）。f1-micro 只有 25 條連線：2 個執行個體 × 8 + 2 條 LISTEN = 18。
3. 開放時間（requirements §4.7）：時間凍結的模擬、早安、關門流程（19:55 / 20:00）、`GET /api/status`、讀取 `OPEN_HOURS` 環境變數。**資料庫停機時伺服器也要能啟動**：目前啟動時會先跑 migration（`apps/server/src/index.ts:9`），要改成第一次連上資料庫時才執行，否則休息時段有人打開網頁，容器會起不來。

## 0. 帳號與變數

```bash
# 用個人帳號的 configuration，避免用到預設的公司帳號
# 本機已經有 silver-greens configuration（spigflying@gmail.com）就直接切過去：
gcloud config configurations activate silver-greens
# 沒有的話才建立：
#   gcloud config configurations create silver-greens
#   gcloud auth login spigflying@gmail.com
#   gcloud config set account spigflying@gmail.com

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
export OPS_SA=chick-sql-ops@$PROJECT_ID.iam.gserviceaccount.com
export SCHED_SA=chick-scheduler@$PROJECT_ID.iam.gserviceaccount.com
export OPEN_HOURS="mon-fri 09:00-20:00 Asia/Taipei"

gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION
```

## 1. 啟用 API

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com iamcredentials.googleapis.com \
  cloudbilling.googleapis.com billingbudgets.googleapis.com
```

- 帳單相關指令（第 11 步）要加 `--billing-project=$PROJECT_ID`，否則 gcloud 會把配額算在它自己的共用專案上而被拒（2026-10-14 實測：`Cloud Billing API has not been used in project 681255809395`）。

## 2. 服務帳號

```bash
gcloud iam service-accounts create chick-run --display-name="chick-baby Cloud Run"
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUN_SA --role=roles/cloudsql.client
# Secret 存取權在第 4 步逐一授予

# 資料庫開關機用（Cloud Scheduler 以它的 OAuth token 呼叫 SQL Admin API）
gcloud iam service-accounts create chick-sql-ops --display-name="chick-baby Cloud SQL start/stop"
# 最小權限：自訂角色只含開關機（instances.patch 的 activationPolicy）所需權限，不用 roles/cloudsql.editor
gcloud iam roles create chickSqlStartStop --project=$PROJECT_ID \
  --title="chick-baby Cloud SQL start/stop" \
  --permissions=cloudsql.instances.get,cloudsql.instances.update --stage=GA
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$OPS_SA \
  --role=projects/$PROJECT_ID/roles/chickSqlStartStop
```

- `cloudsql.instances.update` 是 SQL Admin API `instances.patch`（改 `activationPolicy`）需要的權限；`cloudsql.instances.get` 讓排查時可讀狀態。
- **建立第 8 步 Cloud Scheduler job 的人**，需要對 `chick-sql-ops` 有 `roles/iam.serviceAccountUser`（才能把 job 設成以它的身分取得 OAuth token）。專案 Owner 已內含；否則先授予：
  `gcloud iam service-accounts add-iam-policy-binding $OPS_SA --member=user:<你的帳號> --role=roles/iam.serviceAccountUser`

```bash
# 每日排程用（Cloud Scheduler 以它的 OIDC ID token 呼叫 /api/internal/daily）
# 不需要任何專案層級角色：伺服器只檢查 token 的 email 是否等於 CRON_OIDC_SA_EMAIL
gcloud iam service-accounts create chick-scheduler --display-name="chick-baby Scheduler (OIDC caller)"
```

- 建立 `chick-daily` job 的人同樣需要對 `chick-scheduler` 有 `roles/iam.serviceAccountUser`（Owner 已內含）：
  `gcloud iam service-accounts add-iam-policy-binding $SCHED_SA --member=user:<你的帳號> --role=roles/iam.serviceAccountUser`
- Cloud Scheduler 的 service agent（`service-$PROJECT_NUMBER@gcp-sa-cloudscheduler.iam.gserviceaccount.com`）要有 `roles/cloudscheduler.serviceAgent` 才能替 SA 簽 token；啟用 API 時會自動授予，通常不用處理。

## 3. Cloud SQL（PostgreSQL 16）

```bash
gcloud sql instances create $SQL_INSTANCE \
  --database-version=POSTGRES_16 --region=$REGION \
  --edition=ENTERPRISE --tier=db-f1-micro --storage-size=10GB --storage-auto-increase \
  --backup-start-time=04:00 --enable-point-in-time-recovery \
  --retained-backups-count=7 --retained-transaction-log-days=7 \
  --availability-type=zonal \
  --maintenance-window-day=WED --maintenance-window-hour=5
gcloud sql databases create $DB_NAME --instance=$SQL_INSTANCE
export DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
gcloud sql users create $DB_USER --instance=$SQL_INSTANCE --password="$DB_PASS"
```

- 備份時間 `04:00` UTC = 台北 12:00，**一定要在開機期間**（平日 08:45–20:15）；自動備份保留 7 份、PITR 7 天，不需要另外的備份 Job。
- 建立後 instance 會一直開著，直到第 8 步的 `chick-db-stop` 第一次執行。
- 維護時段 `WED 05:00` UTC = 台北週三 13:00，放在開機期間、避開 04:00 UTC 備份。官方說明：instance 在排定維護時若是關機狀態，該次維護會略過，**下次啟動時會自動套用最新維護版本**——所以每天 08:45 開機偶爾會比較久，這也是開機排在 09:00 前 15 分鐘的原因之一。<https://cloud.google.com/sql/docs/postgres/maintenance>
- **關機不是零成本**：官方文件寫明「Stopping an instance suspends instance charges… charges for storage and IP addresses continue to apply」，價格頁列「IPv4 addresses while idle：$0.01/小時」。Cloud SQL 預設會配公開 IPv4，關機約 ~480 小時/月 ≈ **US$4.8/月**（未含在 gcp-plan 的估算內）。若不需要公開 IP，可建立時加 `--no-assign-ip` 改用 Private IP（需 VPC/Private Service Access 設定），由 Benson 決定。<https://cloud.google.com/sql/docs/postgres/start-stop-restart-instance>、<https://cloud.google.com/sql/pricing>
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
# 管理員 Email（逗號分隔，可多個）
printf '%s' "你的管理員@gmail.com" | gcloud secrets create chick-admin-emails --data-file=-

for s in chick-database-url chick-admin-emails; do
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
  --set-env-vars="NODE_ENV=production,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,PUBLIC_ORIGIN=$SERVICE_URL,OPEN_HOURS=$OPEN_HOURS,CRON_OIDC_AUDIENCE=$SERVICE_URL,CRON_OIDC_SA_EMAIL=$SCHED_SA" \
  --set-secrets=DATABASE_URL=chick-database-url:latest,ADMIN_EMAILS=chick-admin-emails:latest
```

說明：
- `--no-cpu-throttling` = instance-based billing，下樓梯遊戲迴圈不會被節流。WebSocket 開著時執行個體本來就一直計費，instance-based 單價比 request-based 低。
- `--cpu=1` 已是下限：低於 1 vCPU 必須用 request-based 計費且 concurrency=1，WebSocket 服務不適用。
- `--min-instances=0`：沒人連線時最多 15 分鐘就縮到 0、停止計費；代價是第一個人進來要等約 1–2 秒冷啟動。設 `min=1` 會 24 小時計費，每月約多 US$40，不建議。
- `--max-instances=2`：受 Cloud SQL 25 條連線限制。要調高就同時調低連線池。
- `--timeout=3600` 讓 WebSocket 最長 60 分鐘；客戶端約 50 分鐘會在非比賽中主動重連。
- `--session-affinity` 讓重連盡量回到同一個執行個體；正確性不依賴它（跨執行個體用 Postgres `LISTEN/NOTIFY`）。
- 伺服器第一次連上資料庫時自動執行 migration（Kysely，`kysely_migration_lock` 防止多個執行個體同時跑）；休息時段資料庫是關的，部署後的 migration 會延到下次開門才跑。
- `NODE_ENV=production` 時開發用登入（`DEV_LOGIN`）一律關閉，Cookie 加上 `Secure`。
- 部署後確認網址：`gcloud run services describe $SERVICE --format='value(status.url)'`。若和 `$SERVICE_URL` 不同，更新 `PUBLIC_ORIGIN`、`CRON_OIDC_AUDIENCE`（`gcloud run services update $SERVICE --update-env-vars=PUBLIC_ORIGIN=...,CRON_OIDC_AUDIENCE=...`）、OAuth 的 JavaScript origin，以及第 8 步 `chick-daily` 的 `--oidc-token-audience`。三者必須是同一個字串（不含結尾 `/`）。
- `CRON_OIDC_AUDIENCE`／`CRON_OIDC_SA_EMAIL` 不是機密，用一般環境變數即可。沒設定時 `/api/internal/daily` 一律回 403。

## 7a. 自訂網域 chick.thesilvertrees.com（2026-10-14 已完成）

和 `vote.thesilvertrees.com`（服務 `vote-lab`）相同做法：Cloud Run 網域對應（asia-east1 支援），不用負載平衡器。`thesilvertrees.com` 已在 spigflying@gmail.com 驗證，DNS 在本專案的 Cloud DNS zone `thesilvertrees-com`。

```bash
gcloud beta run domain-mappings create --service=$SERVICE --domain=chick.thesilvertrees.com --region=$REGION
gcloud dns record-sets create chick.thesilvertrees.com. --zone=thesilvertrees-com \
  --type=CNAME --ttl=300 --rrdatas=ghs.googlehosted.com.
# 等待憑證（約 20 分鐘）：Ready / CertificateProvisioned = True
gcloud beta run domain-mappings describe --domain=chick.thesilvertrees.com --region=$REGION

export PUBLIC_URL=https://chick.thesilvertrees.com
gcloud run services update $SERVICE --region=$REGION \
  --update-env-vars=PUBLIC_ORIGIN=$PUBLIC_URL,CRON_OIDC_AUDIENCE=$PUBLIC_URL
gcloud scheduler jobs update http chick-daily --location=$REGION \
  --uri=$PUBLIC_URL/api/internal/daily \
  --oidc-service-account-email=$SCHED_SA --oidc-token-audience=$PUBLIC_URL
```

- `--oidc-token-audience` 必須和 `--oidc-service-account-email` 一起指定。
- Google OAuth 用戶端的 JavaScript origin 需另外加上 `https://chick.thesilvertrees.com`（第 5 步）。

## 8. 排程（Cloud Scheduler，3 個 job，在每個帳單帳戶 3 個免費 job 以內）

| Job | 時間（Asia/Taipei） | 做什麼 |
|---|---|---|
| `chick-db-start` | 平日 08:45 | `chick-db` 開機（`activationPolicy: ALWAYS`），留 15 分鐘給開機 |
| `chick-daily` | 平日 20:05 | 關門後、關機前：清除 30 天前稽核紀錄的 IP、7 天前的冪等紀錄與過期 session |
| `chick-db-stop` | 平日 20:15 | `chick-db` 停機（`activationPolicy: NEVER`），只剩儲存費 |

```bash
gcloud scheduler jobs create http chick-daily \
  --location=$REGION \
  --schedule="5 20 * * 1-5" --time-zone="Asia/Taipei" \
  --uri="$SERVICE_URL/api/internal/daily" --http-method=POST \
  --oidc-service-account-email=$SCHED_SA \
  --oidc-token-audience="$SERVICE_URL"
```

- `chick-daily` 以 `chick-scheduler` 的 **OIDC ID token**（`Authorization: Bearer …`）呼叫；job 設定裡不再存任何密碼。伺服器用 `google-auth-library` 驗證簽章與 `aud == CRON_OIDC_AUDIENCE`，並要求 `email == CRON_OIDC_SA_EMAIL`、`email_verified == true`；缺 token／token 無效回 401，audience 或 SA 不符回 403。
- Cloud Run 服務維持 `--allow-unauthenticated`（網站本來就要公開），由程式檢查 token 即可。想多一層防護也可以加 `gcloud run services add-iam-policy-binding $SERVICE --member=serviceAccount:$SCHED_SA --role=roles/run.invoker`，但服務公開時這不會擋住其他人，只有改成不公開時才有意義（不建議：玩家要能連）。
- 手動觸發測試：`gcloud scheduler jobs run chick-daily --location=$REGION`，然後看 `gcloud scheduler jobs describe chick-daily --location=$REGION --format='value(lastAttemptTime,status)'`。
- 開關機 job（下面）是另一回事：它們呼叫的是 Google 的 SQL Admin API，所以用 **OAuth access token**（`oauthToken`，SA 為 `chick-sql-ops`），不是 OIDC；兩種 SA 分開，`chick-scheduler` 沒有任何 Cloud SQL 權限。

開關機要用 `PATCH` 呼叫 SQL Admin API。本機 gcloud 578.0.0 的 `scheduler jobs create http` 只接受 delete/get/head/post/put，所以直接呼叫 Cloud Scheduler REST API 建立（REST 的 `httpMethod` 支援 `PATCH`）：

```bash
make_db_job() {  # $1=job 名稱  $2=cron  $3=ALWAYS|NEVER
  local body=$(printf '{"settings":{"activationPolicy":"%s"}}' "$3" | base64 | tr -d '\n')
  curl -sS -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "x-goog-user-project: $PROJECT_ID" -H "Content-Type: application/json" \
    "https://cloudscheduler.googleapis.com/v1/projects/$PROJECT_ID/locations/$REGION/jobs" \
    -d @- <<EOF
{
  "name": "projects/$PROJECT_ID/locations/$REGION/jobs/$1",
  "schedule": "$2",
  "timeZone": "Asia/Taipei",
  "retryConfig": {"retryCount": 3, "minBackoffDuration": "30s"},
  "httpTarget": {
    "uri": "https://sqladmin.googleapis.com/v1/projects/$PROJECT_ID/instances/$SQL_INSTANCE",
    "httpMethod": "PATCH",
    "headers": {"Content-Type": "application/json"},
    "body": "$body",
    "oauthToken": {"serviceAccountEmail": "$OPS_SA", "scope": "https://www.googleapis.com/auth/cloud-platform"}
  }
}
EOF
}
make_db_job chick-db-start "45 8 * * 1-5" ALWAYS
make_db_job chick-db-stop  "15 20 * * 1-5" NEVER
gcloud scheduler jobs list --location=$REGION
```

- 手動測試停機→開機時，等停機操作完成（`state=STOPPED`）再觸發 `chick-db-start`，否則第一次會回 409（`invalidState`，重試會成功）。2026-10-14 實測：開機後到應用程式能連上約 13 分鐘（期間 state 顯示 `MAINTENANCE`，即停機期間略過的維護在開機時套用），這段時間 `/api/internal/daily` 會回 500。自訂角色 `cloudsql.instances.get` + `cloudsql.instances.update` 已足夠，不需追加權限。
- 開機失敗會讓 09:00 無法開門（已設重試 3 次）。手動開機：`gcloud sql instances patch $SQL_INSTANCE --activation-policy=ALWAYS`。
- 改開放時間時，`OPEN_HOURS` 和這 3 個 job 的時間要一起改。

## 9. 驗證

```bash
# 注意：Cloud Run 保留以 z 結尾的路徑（/healthz 等），外部呼叫會被 Google 前端回 404，不會到程式；
# /healthz 只能給容器內部探針用。外部驗證請用 /api/status。
curl -s $SERVICE_URL/api/status
curl -s $SERVICE_URL/api/config | head -c 300
```

瀏覽器打開 `$SERVICE_URL`，用 Google 帳號登入；用 `ADMIN_EMAILS` 裡的帳號登入後，頂部會出現「管理」。

第一個平日晚上與隔天早上確認開關機：

```bash
# 20:15 後應為 NEVER / STOPPED；隔天 08:45 後應為 ALWAYS / RUNNABLE
gcloud sql instances describe $SQL_INSTANCE --format='value(settings.activationPolicy,state)'
gcloud scheduler jobs describe chick-db-stop --location=$REGION --format='value(lastAttemptTime,status)'
```

休息時段打開網頁應顯示「小雞睡覺中」，不會出現錯誤頁。

## 10. 更新版本

```bash
export TAG=$(git rev-parse --short HEAD)
gcloud builds submit --tag $IMAGE:$TAG .
gcloud run deploy $SERVICE --image=$IMAGE:$TAG
```

Cloud Run 換版時會送 SIGTERM：伺服器廣播 `server.draining`、把進行中的下樓梯標記為 `aborted`（不發獎勵、不扣精力），然後關閉連線；客戶端自動重連到新版本。

## 11. 預算提醒（不要設 Cloud Run spend cap）

```bash
export BILLING_ACCOUNT=$(gcloud billing projects describe $PROJECT_ID --billing-project=$PROJECT_ID --format='value(billingAccountName)' | sed 's#billingAccounts/##')
# 金額不帶幣別 = 用帳單帳戶的幣別；帳單是 TWD 就填 650，是 USD 就填 20（最壞情境 NT$519 + 緩衝）
gcloud billing budgets create --billing-project=$PROJECT_ID --billing-account=$BILLING_ACCOUNT \
  --display-name=chick-baby-monthly --budget-amount=20 \
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
| 帳單 | `silver-greens` 需要已連結帳單帳戶。平日 09:00–20:00 開放、DB 夜間與週末停機：預估每月約 **NT$334**（一般）～NT$519（開放時間內一直有人開著分頁）。已扣 Cloud Run instance-based 免費額度（2026-10-14 確認未被其他服務使用）；明細見 `gcp-plan.md` §0、§3.2 |
| 自訂網域（選用） | `gcloud beta run domain-mappings create --service=$SERVICE --domain=...`，並加到 OAuth origins 與 `PUBLIC_ORIGIN` |
