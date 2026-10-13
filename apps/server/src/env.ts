export const env = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://chick:chick@localhost:5432/chick',
  devLogin: process.env.DEV_LOGIN === '1',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  publicOrigins: (process.env.PUBLIC_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  cronSecret: process.env.CRON_SECRET ?? '',
  secureCookies: process.env.NODE_ENV === 'production',
  webDist: process.env.WEB_DIST ?? '',
  instanceId: process.env.K_REVISION ? `${process.env.K_REVISION}-${Math.random().toString(36).slice(2, 8)}` : `local-${process.pid}`,
};
