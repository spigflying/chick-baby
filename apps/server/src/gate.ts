import type { Db } from './db';
import type { Bus } from './bus';
import { migrateToLatest } from './migrations';

/**
 * 資料庫閘門：第一次需要資料庫時才跑 migration 並開始 LISTEN；失敗就留到下次請求再試。
 * 休息時段 Cloud SQL 停機，伺服器仍要能啟動並提供 /healthz、/api/status、/api/config。
 */
export function createDbGate(db: Db, bus: Bus, migrate: (db: Db) => Promise<unknown> = migrateToLatest) {
  let ready: Promise<void> | null = null;
  return {
    ensure(): Promise<void> {
      ready ??= (async () => { await migrate(db); await bus.start(); })().catch((e) => { ready = null; throw e; });
      return ready;
    },
    /** 關門時呼叫：停止 LISTEN；下次 ensure() 會重新連線。 */
    async release() { ready = null; await bus.stop(); },
  };
}
export type DbGate = ReturnType<typeof createDbGate>;
