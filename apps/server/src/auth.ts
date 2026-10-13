import { OAuth2Client } from 'google-auth-library';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { env } from './env';
import { AppError, fail } from './errors';
import { newToken, sha256 } from './util';

const SESSION_DAYS = 30;
export const COOKIE = 'chick_sid';
const google = new OAuth2Client();

/** 驗證 Google ID token：aud、iss、exp（由函式庫檢查）以及 email_verified。 */
export async function verifyGoogle(idToken: string) {
  if (!env.googleClientId) fail('GOOGLE_NOT_CONFIGURED');
  const ticket = await google.verifyIdToken({ idToken, audience: env.googleClientId }).catch(() => fail('UNAUTHORIZED', 'invalid token'));
  const p = ticket.getPayload();
  if (!p || !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) || !p.sub) fail('UNAUTHORIZED');
  if (!p!.email_verified) fail('UNAUTHORIZED', 'email not verified');
  return { sub: `google:${p!.sub}`, email: p!.email ?? null, name: p!.name ?? p!.given_name ?? '玩家', avatar: p!.picture ?? null };
}

export async function createSession(db: Db, userId: string, reply: FastifyReply) {
  const token = newToken();
  await db.insertInto('sessions').values({ id_hash: sha256(token), user_id: userId, expires_at: new Date(Date.now() + SESSION_DAYS * 864e5) }).execute();
  reply.setCookie(COOKIE, token, { httpOnly: true, secure: env.secureCookies, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}
export async function sessionUser(db: Db, token: string | undefined) {
  if (!token) return null;
  const r = await db.selectFrom('sessions as s').innerJoin('users as u', 'u.id', 's.user_id').select(['u.id', 'u.role', 'u.display_name', 'u.avatar_url'])
    .where('s.id_hash', '=', sha256(token)).where('s.expires_at', '>', new Date()).executeTakeFirst();
  return r ?? null;
}
export async function destroySession(db: Db, token: string | undefined) { if (token) await db.deleteFrom('sessions').where('id_hash', '=', sha256(token)).execute(); }

declare module 'fastify' { interface FastifyRequest { user?: { id: string; role: string; display_name: string; avatar_url: string | null } } }
export function authHook(db: Db) {
  return async (req: FastifyRequest) => {
    const u = await sessionUser(db, req.cookies[COOKIE]);
    if (!u) throw new AppError('UNAUTHORIZED', 401);
    req.user = u;
  };
}
export const requireAdmin = async (req: FastifyRequest) => { if (req.user?.role !== 'admin') throw new AppError('FORBIDDEN', 403); };
