import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { env } from './env';

// timestamptz → Date（預設），bigint → number
pg.types.setTypeParser(20, (v) => Number(v));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = any;
export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export function createDb(url = env.databaseUrl) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { db: new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }), pool };
}
export { sql };
