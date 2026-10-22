export class AppError extends Error {
  constructor(public code: string, public status = 400, message?: string) { super(message ?? code); }
}
const STATUS: Record<string, number> = { FORBIDDEN: 403, UNAUTHORIZED: 401, NOT_FOUND: 404, RATE_LIMITED: 429, IDEMPOTENCY_CONFLICT: 409, INSUFFICIENT_COINS: 402, GAME_CLOSED: 423, GAME_CLOSING: 423, DB_UNAVAILABLE: 503, RACE_CLOSING: 423 };
export const fail = (code: string, message?: string): never => { throw new AppError(code, STATUS[code] ?? 400, message); };
