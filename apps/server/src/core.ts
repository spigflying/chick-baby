import { sql, type Db, type Tx } from './db';
import { AppError, fail } from './errors';
import { isUuid, stableHash } from './util';
import { clock } from './hours';

export interface ReqCtx { userId: string; ip?: string | null; ua?: string | null }
export type Notice = { t: 'pet'; home: string; pet: string; ev?: unknown } | { t: 'wallet'; user: string } | { t: 'access'; home: string };

export async function notify(tx: Tx | Db, n: Notice | Record<string, unknown>) {
  // NOTIFY 在 transaction 內呼叫時會在 commit 後才送出（跨執行個體廣播）
  await sql`SELECT pg_notify('chick', ${JSON.stringify(n)})`.execute(tx);
}

export async function audit(db: Tx | Db, ctx: Partial<ReqCtx>, action: string, result: string, opts: { targetType?: string; targetId?: string; detail?: unknown; requestId?: string | null } = {}) {
  await db.insertInto('audit_log').values({
    user_id: ctx.userId ?? null, action, result, target_type: opts.targetType ?? null, target_id: opts.targetId ?? null,
    detail: JSON.stringify(opts.detail ?? {}), ip: ctx.ip ?? null, user_agent: ctx.ua?.slice(0, 300) ?? null,
    request_id: opts.requestId && isUuid(opts.requestId) ? opts.requestId : null,
  }).execute();
}

/**
 * 冪等 + 稽核的動作包裝：單一 transaction 內先寫入 idempotency_keys（主鍵 user_id+request_id），
 * 重複請求 → 相同內容回傳上次結果、不同內容 409。失敗時整個 transaction 回滾，並另外寫一筆失敗稽核。
 */
export async function runAction<T>(db: Db, ctx: ReqCtx, action: string, requestId: unknown, body: unknown, fn: (tx: Tx) => Promise<T>, target?: { type: string; id: string }): Promise<T> {
  if (!isUuid(requestId)) fail('BAD_REQUEST', 'request_id (UUID) required');
  const hash = stableHash({ action, body });
  try {
    return await db.transaction().execute(async (tx) => {
      // 1) 先查已存的結果：重送已完成的請求一律回放（即使已經關門），不再寫稽核
      const replay = async () => {
        const prev = await tx.selectFrom('idempotency_keys').select(['request_hash', 'response']).where('user_id', '=', ctx.userId).where('request_id', '=', requestId as string).executeTakeFirst();
        if (!prev) return null;
        if (prev.request_hash !== hash) fail('IDEMPOTENCY_CONFLICT');
        return { ...(prev.response as object), replayed: true } as T;
      };
      const stored = await replay();
      if (stored) return stored;
      // 2) 關門判斷放在寫入的 transaction 內（requirements §4.7：20:00:00 之後的寫入一律拒絕）
      if (!clock().isOpen(Date.now())) fail('GAME_CLOSED');
      const ins = await tx.insertInto('idempotency_keys').values({ user_id: ctx.userId, request_id: requestId, action, request_hash: hash })
        .onConflict((oc) => oc.doNothing()).returning('request_id').executeTakeFirst();
      if (!ins) { return (await replay()) as T; } // 併發的同一個請求剛寫入
      const result = await fn(tx);
      await tx.updateTable('idempotency_keys').set({ response: JSON.stringify(result) }).where('user_id', '=', ctx.userId).where('request_id', '=', requestId as string).execute();
      await audit(tx, ctx, action, 'ok', { targetType: target?.type, targetId: target?.id, detail: body, requestId: requestId as string });
      return result;
    });
  } catch (e) {
    const code = e instanceof AppError ? e.code : 'INTERNAL';
    await audit(db, ctx, action, `error:${code}`, { targetType: target?.type, targetId: target?.id, detail: body, requestId: requestId as string }).catch(() => {});
    throw e;
  }
}

/** 依固定順序鎖錢包（先錢包、再寵物；同類依 id 排序）。 */
export async function lockWallets(tx: Tx, userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  return sql<{ user_id: string; balance: number }>`SELECT user_id, balance FROM wallets WHERE user_id = ANY(${ids}::uuid[]) ORDER BY user_id FOR UPDATE`.execute(tx).then((r) => r.rows);
}
export async function changeBalance(tx: Tx, userId: string, delta: number, reason: string, ref?: { type: string; id: string }) {
  const r = await tx.updateTable('wallets').set((eb: any) => ({ balance: eb('balance', '+', delta), updated_at: new Date() }))
    .where('user_id', '=', userId).returning('balance').executeTakeFirstOrThrow();
  if (r.balance < 0) fail('INSUFFICIENT_COINS');
  await tx.insertInto('coin_ledger').values({ user_id: userId, delta, balance_after: r.balance, reason, ref_type: ref?.type ?? null, ref_id: ref?.id ?? null }).execute();
  await notify(tx, { t: 'wallet', user: userId });
  return r.balance as number;
}

/** 簡易記憶體頻率限制（近似防護，不影響正確性）。 */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now(); const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 120_000)) buckets.delete(k); }, 60_000).unref();
