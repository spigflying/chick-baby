export class AppError extends Error {
  constructor(public code: string, public status = 400, message?: string) { super(message ?? code); }
}
const STATUS: Record<string, number> = { FORBIDDEN: 403, UNAUTHORIZED: 401, NOT_FOUND: 404, RATE_LIMITED: 429, IDEMPOTENCY_CONFLICT: 409, INSUFFICIENT_COINS: 402 };
export const fail = (code: string, message?: string): never => { throw new AppError(code, STATUS[code] ?? 400, message); };
