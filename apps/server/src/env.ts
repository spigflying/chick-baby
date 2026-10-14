export const env = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://chick:chick@localhost:5432/chick',
  devLogin: process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production', // 正式環境一律關閉
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  publicOrigins: (process.env.PUBLIC_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  // Cloud Scheduler OIDC：audience = 服務網址；SA = 排程專用服務帳號
  cronOidcAudience: (process.env.CRON_OIDC_AUDIENCE ?? '').trim(),
  cronOidcSaEmail: (process.env.CRON_OIDC_SA_EMAIL ?? '').trim().toLowerCase(),
  openHours: process.env.OPEN_HOURS ?? '', // 例：mon-fri 09:00-20:00 Asia/Taipei；空 = 永遠開放
  secureCookies: process.env.NODE_ENV === 'production',
  webDist: process.env.WEB_DIST ?? '',
  instanceId: process.env.K_REVISION ? `${process.env.K_REVISION}-${Math.random().toString(36).slice(2, 8)}` : `local-${process.pid}`,
};
