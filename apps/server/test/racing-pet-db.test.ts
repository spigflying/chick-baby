import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { racePets } from '../src/racing';
import { randomUUID } from 'node:crypto';

const { db } = createDb();
beforeAll(async () => { await migrateToLatest(db as any); });
afterAll(async () => { await db.destroy(); });
async function user() {
  const id = randomUUID();
  await sql`INSERT INTO users (id, google_sub, display_name, share_code) VALUES (${id}, ${'t-' + id}, 'racer', ${id.slice(0, 12)})`.execute(db);
  return id;
}
async function pet(owner: string, species: string, status: string, born: string) {
  await sql`INSERT INTO pets (owner_id, species_id, name, status, born_at, last_simulated_at, hunger, happiness, energy, cleanliness, health, strength, speed, stamina, weight, personality, counters)
    VALUES (${owner}, ${species}, 'p', ${status}, ${born}, now(), 1,1,1,1,1,1,1,1,1, 'calm', '{}'::jsonb)`.execute(db);
}
describe('racePets against the migrated schema', () => {
  it('reads species_id and picks living pet, else ghost, else null', async () => {
    const a = await user(), b = await user(), c = await user();
    await pet(a, 'penguin', 'dead', '2026-01-01T00:00:00Z');
    await pet(a, 'duck', 'alive', '2026-02-01T00:00:00Z');
    await pet(b, 'duck', 'dead', '2026-01-01T00:00:00Z');
    const m = await racePets(db as any, [a, b, c]);
    expect(m.get(a)).toBe('duck');
    expect(m.get(b)).toBe('ghost');
    expect(m.get(c)).toBeNull();
  });
});
