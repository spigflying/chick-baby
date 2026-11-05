import { fightFace } from '@chick/engine';

/** FIGHT_FACE_USERS=<user id>:<臉>,…：這些帳號格鬥時固定用自己的照片臉（不放 repo，repo 是公開的） */
export function parseFaceUsers(v: string | undefined) {
  const m = new Map<string, string>();
  for (const part of (v ?? '').split(',')) { const [id, face] = part.split(':').map((s) => s?.trim()); if (id && face && fightFace(face) === face && face !== 'chick') m.set(id, face); }
  return m;
}

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
  /** 小雞農場開關：FARM_ENABLED=1 才有農場 API 與前端入口（農場在 farm 分支開發，跟格鬥分開上線） */
  farmEnabled: process.env.FARM_ENABLED === '1',
  fightFaceUsers: parseFaceUsers(process.env.FIGHT_FACE_USERS),
  instanceId: process.env.K_REVISION ? `${process.env.K_REVISION}-${Math.random().toString(36).slice(2, 8)}` : `local-${process.pid}`,
};
