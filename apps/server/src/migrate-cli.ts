import { createDb } from './db';
import { migrateToLatest } from './migrations';
const { db } = createDb();
const res = await migrateToLatest(db);
console.log(res.map((r) => `${r.migrationName}: ${r.status}`).join('\n') || 'up to date');
await db.destroy();
