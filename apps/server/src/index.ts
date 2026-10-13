import { createDb } from './db';
import { migrateToLatest } from './migrations';
import { buildApp } from './app';
import { Bus } from './bus';
import { env } from './env';
import { abortAll, startStairsLoop } from './stairs';

const { db } = createDb();
if (process.env.MIGRATE_ON_START !== '0') await migrateToLatest(db);
const bus = new Bus(); await bus.start();
const { app, hub } = await buildApp(db, bus);
const loop = startStairsLoop(db);
await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`instance ${env.instanceId} ready (dev_login=${env.devLogin})`);

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return; shuttingDown = true;
  app.log.info(`${sig}: draining`);
  clearInterval(loop);
  await abortAll(db);
  hub.drain();
  await app.close().catch(() => {});
  await bus.stop(); await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
