import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from 'kysely';

const migrations: Record<string, Migration> = {
  '0001_init': {
    async up(db: Kysely<unknown>) {
      await sql`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        google_sub text UNIQUE NOT NULL,
        email text,
        display_name text NOT NULL,
        avatar_url text,
        share_code text UNIQUE NOT NULL,
        role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
      );
      CREATE TABLE sessions (
        id_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE wallets (
        user_id uuid PRIMARY KEY REFERENCES users(id),
        balance int NOT NULL CHECK (balance >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE coin_ledger (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        delta int NOT NULL,
        balance_after int NOT NULL,
        reason text NOT NULL CHECK (reason IN ('signup','stairs_solo','stairs_match','feed','admin')),
        ref_type text, ref_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX coin_ledger_user ON coin_ledger(user_id, created_at);
      CREATE TABLE idempotency_keys (
        user_id uuid NOT NULL REFERENCES users(id),
        request_id uuid NOT NULL,
        action text NOT NULL,
        request_hash text NOT NULL,
        response jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, request_id)
      );
      CREATE TABLE homes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid UNIQUE NOT NULL REFERENCES users(id),
        name text NOT NULL,
        access_mode text NOT NULL DEFAULT 'open' CHECK (access_mode IN ('open','invite_only','closed')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE home_invites (home_id uuid NOT NULL REFERENCES homes(id), user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (home_id, user_id));
      CREATE TABLE home_blacklist (home_id uuid NOT NULL REFERENCES homes(id), user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (home_id, user_id));
      CREATE TABLE home_visits (user_id uuid NOT NULL REFERENCES users(id), home_id uuid NOT NULL REFERENCES homes(id), last_visited_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, home_id));
      CREATE TABLE pets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id),
        species_id text NOT NULL,
        name text NOT NULL,
        status text NOT NULL CHECK (status IN ('egg','alive','dead')),
        born_at timestamptz NOT NULL, hatched_at timestamptz, last_simulated_at timestamptz NOT NULL,
        hunger double precision NOT NULL, happiness double precision NOT NULL, energy double precision NOT NULL,
        cleanliness double precision NOT NULL, health double precision NOT NULL,
        poop int NOT NULL DEFAULT 0, last_poop_at timestamptz, dirty_since timestamptz,
        sick boolean NOT NULL DEFAULT false, sleeping boolean NOT NULL DEFAULT false,
        strength double precision NOT NULL, speed double precision NOT NULL, stamina double precision NOT NULL, weight double precision NOT NULL,
        personality text NOT NULL, best_floor int NOT NULL DEFAULT 0, counters jsonb NOT NULL,
        died_at timestamptz, death_cause text, revived_at timestamptz, revived_by uuid REFERENCES users(id),
        version int NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX pets_one_living_per_owner ON pets(owner_id) WHERE status IN ('egg','alive');
      CREATE TABLE pet_events (
        id bigserial PRIMARY KEY,
        pet_id uuid NOT NULL REFERENCES pets(id),
        actor_user_id uuid REFERENCES users(id),
        type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX pet_events_pet ON pet_events(pet_id, created_at);
      CREATE TABLE visitor_feed_counters (
        pet_id uuid NOT NULL REFERENCES pets(id), visitor_user_id uuid NOT NULL REFERENCES users(id), day date NOT NULL, count int NOT NULL DEFAULT 0,
        PRIMARY KEY (pet_id, visitor_user_id, day)
      );
      CREATE TABLE stair_matches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        mode text NOT NULL CHECK (mode IN ('solo','multi')), code text, host_user_id uuid NOT NULL REFERENCES users(id),
        status text NOT NULL CHECK (status IN ('waiting','playing','done','aborted')), instance_id text NOT NULL,
        seed bigint NOT NULL, engine_version text NOT NULL, config jsonb NOT NULL,
        started_at timestamptz, ended_at timestamptz
      );
      CREATE TABLE stair_match_players (
        match_id uuid NOT NULL REFERENCES stair_matches(id), user_id uuid NOT NULL REFERENCES users(id), pet_id uuid NOT NULL REFERENCES pets(id),
        rank int, floors int, eliminated_at_tick int, eliminated_by_pet_id uuid, coins_awarded int,
        PRIMARY KEY (match_id, user_id)
      );
      CREATE TABLE game_config (key text PRIMARY KEY, value jsonb NOT NULL, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE audit_log (
        id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), user_id uuid REFERENCES users(id), action text NOT NULL,
        target_type text, target_id text, result text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', ip inet, user_agent text, request_id uuid
      );
      CREATE INDEX audit_log_at ON audit_log(at);
      -- 稽核紀錄只新增、不修改（除了 30 天後把 IP 清成 NULL）
      CREATE FUNCTION audit_log_guard() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'audit_log is append-only'; END IF;
        IF NEW.ip IS NOT NULL OR (NEW.id, NEW.at, NEW.user_id, NEW.action, NEW.target_type, NEW.target_id, NEW.result, NEW.detail, NEW.user_agent, NEW.request_id)
           IS DISTINCT FROM (OLD.id, OLD.at, OLD.user_id, OLD.action, OLD.target_type, OLD.target_id, OLD.result, OLD.detail, OLD.user_agent, OLD.request_id) THEN
          RAISE EXCEPTION 'audit_log is append-only (only ip may be nulled)';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
      `.execute(db);
    },
    async down(db: Kysely<unknown>) {
      await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db);
    },
  },
  '0002_fights': {
    async up(db: Kysely<unknown>) {
      await sql`
      ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_reason_check;
      ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_reason_check CHECK (reason IN ('signup','stairs_solo','stairs_match','feed','admin','fight'));
      CREATE TABLE fights (
        id uuid PRIMARY KEY, home_id uuid NOT NULL REFERENCES homes(id),
        a_user_id uuid NOT NULL REFERENCES users(id), b_user_id uuid NOT NULL REFERENCES users(id),
        a_pet_id uuid NOT NULL REFERENCES pets(id), b_pet_id uuid NOT NULL REFERENCES pets(id),
        status text NOT NULL CHECK (status IN ('playing','done','aborted')),
        winner_user_id uuid REFERENCES users(id), transfer int NOT NULL DEFAULT 0, a_hp int, b_hp int, reason text,
        instance_id text, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
      );
      CREATE INDEX fights_pair ON fights (LEAST(a_user_id, b_user_id), GREATEST(a_user_id, b_user_id), ended_at);
      `.execute(db);
    },
    async down(db: Kysely<unknown>) {
      await sql`DROP TABLE fights; ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_reason_check;
        ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_reason_check CHECK (reason IN ('signup','stairs_solo','stairs_match','feed','admin'));`.execute(db);
    },
  },
  '0003_fight_v2_items': {
    async up(db: Kysely<unknown>) {
      await sql`
      ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_reason_check;
      ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_reason_check CHECK (reason IN ('signup','stairs_solo','stairs_match','feed','admin','fight','item'));
      -- v1.5 混戰：a/b 保留為前兩位參賽者（相容舊資料），完整名單與每人統計放 participants
      ALTER TABLE fights ADD COLUMN participants jsonb NOT NULL DEFAULT '[]';
      CREATE TABLE user_items (
        user_id uuid NOT NULL REFERENCES users(id), item_id text NOT NULL CHECK (item_id IN ('sword','kame','poop')),
        fights_left int NOT NULL DEFAULT 0 CHECK (fights_left >= 0), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, item_id)
      );
      `.execute(db);
    },
    async down(db: Kysely<unknown>) {
      await sql`DROP TABLE user_items; ALTER TABLE fights DROP COLUMN participants;
        ALTER TABLE coin_ledger DROP CONSTRAINT coin_ledger_reason_check;
        ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_reason_check CHECK (reason IN ('signup','stairs_solo','stairs_match','feed','admin','fight'));`.execute(db);
    },
  },
};

const provider: MigrationProvider = { getMigrations: async () => migrations };
export async function migrateToLatest(db: Kysely<unknown>) {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();
  for (const r of results ?? []) if (r.status === 'Error') console.error('migration failed', r.migrationName);
  if (error) throw error;
  return results ?? [];
}
