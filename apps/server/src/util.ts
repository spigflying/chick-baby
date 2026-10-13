import { createHash, randomBytes, randomInt } from 'node:crypto';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newShareCode(): string { let s = ''; for (let i = 0; i < 8; i++) s += CROCKFORD[randomInt(32)]; return s; }
export function normalizeShareCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(c) ? c : null;
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const randomSeed = () => randomInt(0, 2 ** 31);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);
/** 穩定 JSON（key 排序）供冪等雜湊 */
export function stableHash(v: unknown): string {
  const norm = (x: unknown): unknown => Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])])) : x;
  return sha256(JSON.stringify(norm(v)));
}
export const publicUser = (u: any): { id: string; display_name: string; avatar_url: string | null } => ({ id: u.id, display_name: u.display_name, avatar_url: u.avatar_url ?? null });
