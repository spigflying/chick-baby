import { createDb } from './db';
import { buildApp } from './app';
import { Bus } from './bus';
import { env } from './env';
import { clock } from './hours';
import { startClosingLoop } from './closing';
import { abortAll, startStairsLoop } from './stairs';

const { db } = createDb();
const bus = new Bus();
// 不在啟動時連資料庫：休息時段 Cloud SQL 停機，伺服器仍要能啟動（requirements §4.7）
const { app, hub, gate } = await buildApp(db, bus);
const loop = startStairsLoop(db);
const closing = startClosingLoop({
  onClosing: (closes_at) => hub.broadcast({ type: 'game.closing', closes_at }),
  onClosed: async (opens_at) => { await abortAll(db); hub.closeAll({ type: 'game.closed', opens_at }, 4423); await gate.release(); },
});
await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`instance ${env.instanceId} ready (dev_login=${env.devLogin}, open_hours=${env.openHours || 'always'})`);
// 開放時間內先暖機（migration + LISTEN）；失敗不影響啟動，第一個請求會再試
if (process.env.MIGRATE_ON_START !== '0' && clock().isOpen(Date.now())) gate.ensure().catch((e) => app.log.warn({ err: e }, 'database not ready at boot'));

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return; shuttingDown = true;
  app.log.info(`${sig}: draining`);
  clearInterval(loop); clearInterval(closing.timer);
  await abortAll(db);
  hub.drain();
  await app.close().catch(() => {});
  await bus.stop(); await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
