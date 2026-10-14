import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { FastifyRequest } from 'fastify';
import { env } from './env';
import { fail } from './errors';

/** 驗證 Google ID token 的簽章、iss、exp 與 audience；回傳 payload。測試時注入假的。 */
export type IdTokenVerifier = (idToken: string, audience: string) => Promise<TokenPayload | undefined>;

const client = new OAuth2Client();
export const googleIdTokenVerifier: IdTokenVerifier = async (idToken, audience) =>
  (await client.verifyIdToken({ idToken, audience })).getPayload();

/** 本機開發／測試用的免驗證 token：只有 NODE_ENV=test 或 DEV_LOGIN 開啟（正式環境一律關閉）時接受。 */
export const DEV_CRON_TOKEN = 'dev-cron';
const devBypass = () => process.env.NODE_ENV === 'test' || env.devLogin;

/**
 * Cloud Scheduler 以 OIDC 呼叫內部端點：Authorization: Bearer <Google ID token>。
 * 缺少／格式錯誤／簽章無效 → 401；token 有效但 aud、email 不符或 email 未驗證 → 403。
 */
export async function requireCronOidc(req: FastifyRequest, verify: IdTokenVerifier = googleIdTokenVerifier) {
  const m = /^Bearer ([^\s]+)$/.exec(String(req.headers.authorization ?? ''));
  if (!m) fail('UNAUTHORIZED', 'missing bearer token');
  const token = m![1];
  if (token === DEV_CRON_TOKEN && devBypass()) return;
  const audience = env.cronOidcAudience, email = env.cronOidcSaEmail;
  if (!audience || !email) fail('FORBIDDEN', 'cron OIDC not configured');
  const p = await verify(token, audience).catch(() => undefined);
  if (!p) fail('UNAUTHORIZED', 'invalid token');
  const aud = Array.isArray(p!.aud) ? p!.aud : [p!.aud];
  if (!aud.includes(audience)) fail('FORBIDDEN', 'wrong audience');
  if ((p!.email ?? '').toLowerCase() !== email) fail('FORBIDDEN', 'wrong service account');
  if (p!.email_verified !== true) fail('FORBIDDEN', 'email not verified');
}
