# 停機紀錄與回復步驟

2026-11-10 服務停止營運。這份文件記錄停機時做了什麼、還留著什麼，以及要讓遊戲回來時怎麼做。
帳號一律用 `spigflying@gmail.com`、專案 `silver-greens`、區域 `asia-east1`（gcloud 預設是公司帳號，指令都要加 `--account`／`--project` 或先切 configuration）。

## 停機時做了什麼

| 項目 | 處理 |
|---|---|
| 網站 chick.thesilvertrees.com | Cloud Run `chick-baby` 改跑 `apps/the-end/`（nginx 靜態頁：黑白像素烤全雞＋THE END，任何路徑都回這頁），commit `c00f1df` |
| Cloud Run 設定 | 清掉 Cloud SQL 連線、所有環境變數、secret；`--cpu-throttling`、max 1、128Mi、無 session affinity |
| `.github/workflows/deploy.yml` | 改成只建置／部署 `apps/the-end`（映像 `chick/the-end`），沒有開放時間限制 |
| Cloud SQL `chick-db` | 停機後匯出到 GCS，再**刪除**（自動備份、PITR 一起消失） |
| Cloud Scheduler | 刪除 `chick-db-start`、`chick-db-stop`、`chick-daily` |
| Secret Manager | 刪除 `chick-database-url`、`chick-admin-emails` |
| Artifact Registry | 刪除 `chick/server` 全部舊遊戲映像 |

## 還留著的東西（回復時可以直接用）

- **資料庫備份**：`gs://silver-greens-chick-archive/chick-db-final-20261110.sql.gz`（450 KB，`chick` 資料庫 27 張表，含 `kysely_migration`；是切成結束頁、不再有寫入之後才匯出的，資料完整）。
- **程式**：遊戲最後一版是 git commit `c608103`（`apps/web`、`apps/server`、根目錄 `Dockerfile` 都還在 main 上，沒刪）。
- 服務帳號：`chick-run`（專案層級 `roles/cloudsql.client`）、`chick-sql-ops`（自訂角色 `chickSqlStartStop`）、`chick-scheduler`、`chick-deployer`（GitHub Actions 用，WIF provider `github/chick-baby`）。
- Cloud Run 網域對應 `chick.thesilvertrees.com` → `chick-baby`，Cloud DNS zone `thesilvertrees-com` 的 CNAME → `ghs.googlehosted.com.`。
- Artifact Registry repo `chick`（映像庫本身還在，只剩 `the-end`）。
- Google OAuth 用戶端（Client ID `704427759894-be4jm8vn1k7udgj60o3q20adu92922a9.apps.googleusercontent.com`），沒動過。

## 救不回來的

- `chick-admin-emails` 的內容（管理員 email 清單）——回復時要重新填。
- 資料庫密碼——回復時重新產生即可，備份檔不含密碼。
- 舊的 Cloud Run revision 沒有映像了，不能直接切回去，一定要從 git 重新建置。

## 回復步驟

```bash
export PROJECT_ID=silver-greens REGION=asia-east1 SERVICE=chick-baby
export RUN_SA=chick-run@$PROJECT_ID.iam.gserviceaccount.com
export OPS_SA=chick-sql-ops@$PROJECT_ID.iam.gserviceaccount.com
export SCHED_SA=chick-scheduler@$PROJECT_ID.iam.gserviceaccount.com
export PUBLIC_URL=https://chick.thesilvertrees.com
gcloud config set account spigflying@gmail.com && gcloud config set project $PROJECT_ID
```

### 1. 重建 Cloud SQL 並匯入備份

Cloud SQL 刪除後，同名 instance 會有一段時間不能重建（官方文件：最長約一週）。`chick-db` 被擋的話就改名（例如 `chick-db2`），後面的連線字串和排程 URI 都要跟著改。

```bash
export SQL_INSTANCE=chick-db DB_NAME=chick DB_USER=chick
gcloud sql instances create $SQL_INSTANCE \
  --database-version=POSTGRES_16 --region=$REGION \
  --edition=ENTERPRISE --tier=db-f1-micro --storage-size=10GB --storage-auto-increase \
  --backup-start-time=04:00 --enable-point-in-time-recovery \
  --retained-backups-count=7 --retained-transaction-log-days=7 \
  --availability-type=zonal --maintenance-window-day=WED --maintenance-window-hour=5
gcloud sql databases create $DB_NAME --instance=$SQL_INSTANCE
export DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
gcloud sql users create $DB_USER --instance=$SQL_INSTANCE --password="$DB_PASS"

# 讓這個 instance 的服務帳號讀得到備份檔，再匯入（以 chick 使用者身分匯入，物件擁有者才會對）
SQL_SA=$(gcloud sql instances describe $SQL_INSTANCE --format='value(serviceAccountEmailAddress)')
gcloud storage buckets add-iam-policy-binding gs://silver-greens-chick-archive \
  --member=serviceAccount:$SQL_SA --role=roles/storage.objectViewer
gcloud sql import sql $SQL_INSTANCE gs://silver-greens-chick-archive/chick-db-final-20261110.sql.gz \
  --database=$DB_NAME --user=$DB_USER --quiet
```

- 匯入要在空的資料庫上做。備份內含 `kysely_migration`，伺服器開機不會重跑舊的 migration。
- 細節（為什麼這些參數、關機也要付 IP 費用等）見 `docs/DEPLOY.md` §3。

### 2. 重建 secret

```bash
printf '%s' "postgres://$DB_USER:$DB_PASS@/$DB_NAME?host=/cloudsql/$PROJECT_ID:$REGION:$SQL_INSTANCE" | \
  gcloud secrets create chick-database-url --data-file=-
printf '%s' "<管理員 email，逗號分隔>" | gcloud secrets create chick-admin-emails --data-file=-   # 原內容已遺失，要重新問使用者
for s in chick-database-url chick-admin-emails; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor
done
```

### 3. 先把 Cloud Run 設定改回遊戲用的（這時還跑著結束頁）

**順序很重要**：workflow 部署時只換映像、沿用服務設定。如果先換成遊戲映像，沒有 `DATABASE_URL` 的伺服器起不來、部署會失敗。所以先在結束頁上把設定補齊（nginx 不看這些設定，結束頁照常顯示），再換映像。

以下數值抄自停機前最後一個遊戲 revision `chick-baby-00108-6bm`：

```bash
gcloud run services update $SERVICE --region=$REGION \
  --add-cloudsql-instances=$PROJECT_ID:$REGION:$SQL_INSTANCE \
  --no-cpu-throttling --cpu-boost --session-affinity \
  --min-instances=0 --max-instances=2 --cpu=1 --memory=512Mi \
  --concurrency=1000 --timeout=3600 \
  --set-env-vars="^@^NODE_ENV=production@GOOGLE_CLIENT_ID=704427759894-be4jm8vn1k7udgj60o3q20adu92922a9.apps.googleusercontent.com@PUBLIC_ORIGIN=$PUBLIC_URL@OPEN_HOURS=mon-fri 09:00-20:00 Asia/Taipei@CRON_OIDC_AUDIENCE=$PUBLIC_URL@CRON_OIDC_SA_EMAIL=$SCHED_SA@FARM_ENABLED=1@FIGHT_FACE_USERS=bd8c793b-fc8a-4b47-a008-7b9618c38458:b,51ed08ea-75a1-450c-ad3f-a58b70e8f7cf:c,0f59fcc0-c508-4dc4-859e-4ea31f4cbda1:a" \
  --set-secrets=DATABASE_URL=chick-database-url:latest,ADMIN_EMAILS=chick-admin-emails:latest
```

（`^@^` 是把分隔符號換成 `@`，因為 `FIGHT_FACE_USERS` 的值本身有逗號。）

### 4. 把 workflow 改回遊戲版，推上去部署

```bash
git checkout c608103 -- .github/workflows/deploy.yml   # 停機前的版本：建置根目錄 Dockerfile（含測試）、開放時間不自動部署
# 同時拿掉 AGENTS.md 開頭的停機說明；apps/the-end 可以留著
git commit -m "ci: restore the game deploy workflow" && git push   # push 用 spigflying 帳號，見記憶 github-push-account
GH_TOKEN=$(gh auth token --user spigflying) gh workflow run deploy.yml -R spigflying/chick-baby --ref main   # 開放時間要手動觸發才會部署
```

workflow 會建置映像 `chick/server`、部署，並打 `https://chick.thesilvertrees.com/api/status` 驗證。

### 5. 重建排程（3 個 job）

照 `docs/DEPLOY.md` §8 建：`chick-daily`（平日 20:05，`--uri=$PUBLIC_URL/api/internal/daily`、`--oidc-service-account-email=$SCHED_SA`、`--oidc-token-audience=$PUBLIC_URL`），以及用 `make_db_job` 建的 `chick-db-start`（平日 08:45 ALWAYS）和 `chick-db-stop`（平日 20:15 NEVER）。instance 改名的話，`make_db_job` 裡的 `$SQL_INSTANCE` 要用新名字。

### 6. 驗證

```bash
curl -s $PUBLIC_URL/api/status
gcloud run services describe $SERVICE --region=$REGION --format='value(spec.template.spec.containers[0].image)'
gcloud scheduler jobs list --location=$REGION
```

瀏覽器開 `$PUBLIC_URL`，用 Google 登入，確認舊帳號的錢包、農場資料都在；用管理員帳號登入要看得到「管理」。

## 費用提醒

回復後會恢復原本的成本：Cloud SQL（開機時段計費，關機也要付儲存和 IP 費）、Cloud Run 有人連線時以實例計費。GCP 會花錢的操作，預估超過 US$1 要先跟使用者確認。
