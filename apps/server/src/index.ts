import { abortRaces, startRaceLoop } from './racing';
import { createDb } from './db';
import { buildApp } from './app';
import { Bus } from './bus';
import { env } from './env';
import { clock } from './hours';
import { handleClosed, startClosingLoop } from './closing';
import { abortAll, startStairsLoop } from './stairs';
import { abortArenas, startArenaLoop } from './arena';
import { abortMStairs, startMStairsLoop } from './mstairs';
import { abortFights, startFightLoop } from './fight1v1';

const { db } = createDb();
const bus = new Bus();
// 不在啟動時連資料庫：休息時段 Cloud SQL 停機，伺服器仍要能啟動（requirements §4.7）
const { app, hub, gate } = await buildApp(db, bus);
const loop = startStairsLoop(db);
const arenaLoop = startArenaLoop();
const fightLoop = startFightLoop();
const mstairsLoop = startMStairsLoop();
const raceLoop = startRaceLoop();
const closing = startClosingLoop({
  onClosing: (closes_at) => hub.broadcast({ type: 'game.closing', closes_at }),
  onClosed: (opens_at) => handleClosed({ db, hub, gate }, opens_at),
});
await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`instance ${env.instanceId} ready (dev_login=${env.devLogin}, open_hours=${env.openHours || 'always'})`);
// 開放時間內先暖機（migration + LISTEN）；失敗不影響啟動，第一個請求會再試
if (process.env.MIGRATE_ON_START !== '0' && clock().isOpen(Date.now())) gate.ensure().catch((e) => app.log.warn({ err: e }, 'database not ready at boot'));

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return; shuttingDown = true;
  app.log.info(`${sig}: draining`);
  clearInterval(loop); clearInterval(arenaLoop); clearInterval(fightLoop); clearInterval(mstairsLoop); clearInterval(raceLoop); abortRaces(); clearInterval(closing.timer);
  await abortAll(db);
  await abortMStairs();
  await abortArenas();
  await abortFights('SIGTERM');
  hub.drain();
  await app.close().catch(() => {});
  await bus.stop(); await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
