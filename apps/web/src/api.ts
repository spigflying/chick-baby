export class ApiError extends Error { constructor(public code: string, public status: number, msg?: string) { super(msg ?? code); } }

export const rid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? 'INTERNAL', res.status, json.message);
  return json as T;
}
/** 需要冪等的寫入：自動帶 request_id；網路錯誤時用同一個 id 重試一次。 */
export async function act<T = any>(method: string, url: string, body: Record<string, unknown> = {}): Promise<T> {
  const b = { ...body, request_id: rid() };
  try { return await api<T>(method, url, b); }
  catch (e) { if (e instanceof ApiError) throw e; return api<T>(method, url, b); }
}

export const ERR: Record<string, string> = {
  TOO_FULL: '吃不下了啦～', SNACK_ONLY: '快飽了，只吃得下點心', VISITOR_FREE_FOOD: '訪客不能餵免費的米粒喔', LOW_HEALTH_SNACK: '牠身體不好，訪客不能餵點心',
  DAILY_CAP: '今天餵太多次了（每天上限）', INSUFFICIENT_COINS: '金幣不夠！去玩下樓梯賺金幣吧', PET_SLEEPING: '噓…牠在睡覺', NOT_SLEEPING: '牠醒著呀',
  ALREADY_SLEEPING: '已經在睡了', PET_DEAD: '牠已經去當小天使了…', PET_EGG: '蛋蛋還在孵化中…', NOT_NEEDED: '很健康，不用看醫生喔！', TOO_TIRED: '太累了，想睡覺…',
  FORBIDDEN: '沒有權限（可能被拒絕進入）', NOT_FOUND: '找不到', RATE_LIMITED: '太快了，休息一下', ALREADY_HAS_PET: '已經有寵物了', ALREADY_IN_MATCH: '已經在遊戲中',
  UNAUTHORIZED: '請先登入', BAD_REQUEST: '輸入有誤', IDEMPOTENCY_CONFLICT: '重複的請求', INTERNAL: '伺服器出錯了', NO_PET: '還沒有寵物',
  OWNER_HAS_LIVING_PET: '主人已經有活著的寵物', NOT_DEAD: '牠還活著',
};
export const errText = (e: unknown) => e instanceof ApiError ? (ERR[e.code] ?? e.message ?? e.code) : String((e as any)?.message ?? e);
