/** PostgreSQL/WASM only: access controls and durable jobs never contact production. */
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const user = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const owner = user(100), otherOwner = user(101);
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

async function bootstrap() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE portfolios(id bigserial PRIMARY KEY, user_id uuid, name text);
    CREATE TABLE positions(id bigserial PRIMARY KEY, portfolio_id bigint, quantity integer);
    CREATE TABLE mock_accounts(id bigserial PRIMARY KEY, user_id uuid UNIQUE, cash numeric DEFAULT 10000000, trading_mode text DEFAULT 'mock');
    CREATE TABLE mock_positions(id bigserial PRIMARY KEY, user_id uuid, ticker text);
    CREATE TABLE mock_trades(id bigserial PRIMARY KEY, user_id uuid, amount numeric);
    CREATE TABLE price_daily(id bigserial PRIMARY KEY, ticker text);
    CREATE TABLE quote_cache(id bigserial PRIMARY KEY, ticker text);
    INSERT INTO portfolios(user_id,name) VALUES ('${user(1)}','private');
    GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC,anon,authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC,anon,authenticated;
    CREATE FUNCTION insert_position_owned(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'unsafe legacy owned rpc'::text $$;
    CREATE FUNCTION update_position_owned(uuid,integer) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'unsafe legacy owned rpc'::text $$;
    CREATE FUNCTION execute_mock_buy(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'unsafe legacy buy'::text $$;
    CREATE FUNCTION execute_mock_buy(uuid,integer) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'unsafe legacy buy overload'::text $$;
    CREATE FUNCTION execute_mock_sell(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'unsafe legacy sell'::text $$;
    CREATE FUNCTION acquire_auto_trade_lease(uuid,uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role,anon,authenticated;
  `);
  await db.exec(await migration("202610200004_access_controls.sql"));
  await db.exec(await migration("202610200005_auto_trade_jobs.sql"));
  return db;
}

async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}

test("operational SQL: RLS, table/sequence restrictions and all legacy RPC overloads", async () => {
  const db = await bootstrap();
  try {
    for (const table of ["portfolios", "positions", "mock_accounts", "mock_positions", "mock_trades", "price_daily", "quote_cache", "auto_trade_jobs"]) {
      assert.equal(await scalar(db, "SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass", [table]), true, table);
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          assert.equal(await scalar(db, "SELECT has_table_privilege($1,$2,$3)", [role, table, privilege]), false, `${role} ${privilege} ${table}`);
        }
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        assert.equal(await scalar(db, "SELECT has_table_privilege('service_role',$1,$2)", [table, privilege]), true, `service_role ${privilege} ${table}`);
      }
    }
    assert.equal(await scalar(db, "SELECT has_sequence_privilege('authenticated','portfolios_id_seq','USAGE')"), false);
    assert.equal(await scalar(db, "SELECT has_sequence_privilege('service_role','portfolios_id_seq','USAGE')"), true);
    const signatures = [
      "insert_position_owned(uuid)", "update_position_owned(uuid,integer)",
      "execute_mock_buy(uuid)", "execute_mock_buy(uuid,integer)", "execute_mock_sell(uuid)",
      "acquire_auto_trade_lease(uuid,uuid)", "enqueue_auto_trade_jobs(date)",
      "claim_auto_trade_job(date,uuid)", "finish_auto_trade_job(date,uuid,uuid,jsonb,boolean)",
    ];
    for (const signature of signatures) {
      for (const role of ["anon", "authenticated"]) {
        assert.equal(await scalar(db, "SELECT has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false, `${role} ${signature}`);
      }
      assert.equal(await scalar(db, "SELECT has_function_privilege('service_role',$1,'EXECUTE')", [signature]), !signature.startsWith("execute_mock_"), `service_role ${signature}`);
    }
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query("SELECT * FROM portfolios"), /permission denied/);
      await assert.rejects(db.query("INSERT INTO portfolios(name) VALUES('intrusion')"), /permission denied/);
      await assert.rejects(db.query("UPDATE portfolios SET name='intrusion'"), /permission denied/);
      await assert.rejects(db.query("DELETE FROM portfolios"), /permission denied/);
      await assert.rejects(db.query("SELECT insert_position_owned($1)", [user(1)]), /permission denied/);
      await assert.rejects(db.query("SELECT enqueue_auto_trade_jobs(current_date)"), /permission denied/);
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    assert.equal(await scalar(db, "SELECT count(*) FROM portfolios"), 1);
    await db.query("INSERT INTO portfolios(user_id,name) VALUES($1,'server write')", [user(2)]);
    await assert.rejects(db.query("SELECT execute_mock_buy($1)", [user(1)]), /permission denied/);
    await assert.rejects(db.query("SELECT execute_mock_sell($1)", [user(1)]), /permission denied/);
    assert.equal(await scalar(db, "SELECT acquire_auto_trade_lease($1,$2)", [user(1), owner]), true);
  } finally {
    await db.close();
  }
});

async function seed(db) {
  for (const [n, role, mode] of [[1,"user","mock"], [2,"admin","mock"], [3,"pending","mock"], [4,"rejected","mock"], [5,"user","live"], [6,null,"mock"]]) {
    await db.query("INSERT INTO auth.users(id,raw_app_meta_data) VALUES($1,$2::jsonb)", [user(n), JSON.stringify(role ? {role} : {})]);
    await db.query("INSERT INTO mock_accounts(user_id,trading_mode) VALUES($1,$2)", [user(n), mode]);
  }
}
const enqueue = db => scalar(db, "SELECT enqueue_auto_trade_jobs((now() AT TIME ZONE 'Asia/Seoul')::date)");
const claim = async (db, claimOwner = owner) => (await db.query("SELECT * FROM claim_auto_trade_job((now() AT TIME ZONE 'Asia/Seoul')::date,$1)", [claimOwner])).rows;
const finish = (db, who, claimOwner, success) => scalar(db, "SELECT finish_auto_trade_job((now() AT TIME ZONE 'Asia/Seoul')::date,$1,$2,$3::jsonb,$4)", [who, claimOwner, JSON.stringify({test:true}), success]);
const makeAvailable = (db, who) => db.query("UPDATE auto_trade_jobs SET available_at=now()-interval '1 second' WHERE user_id=$1", [who]);
const expire = (db, who) => db.query("UPDATE auto_trade_jobs SET lease_until=now()-interval '1 second' WHERE user_id=$1", [who]);
const row = (db, who) => db.query("SELECT * FROM auto_trade_jobs WHERE user_id=$1", [who]).then(result => result.rows[0]);

test("durable job SQL: approval filter, idempotency, leases, retry delay and attempt cap", async () => {
  const db = await bootstrap();
  try {
    await seed(db);
    assert.equal(await enqueue(db), 2);
    assert.equal(await enqueue(db), 0);
    await assert.rejects(db.query("SELECT enqueue_auto_trade_jobs((now() AT TIME ZONE 'Asia/Seoul')::date-1)"), /current session/);
    await assert.rejects(db.query("SELECT * FROM claim_auto_trade_job((now() AT TIME ZONE 'Asia/Seoul')::date,NULL)"), /Invalid job claim/);
    const first = (await claim(db))[0];
    assert.equal(first.user_id, user(1));
    assert.equal(first.attempts, 1);
    const second = (await claim(db, otherOwner))[0];
    assert.equal(second.user_id, user(2));
    assert.deepEqual(await claim(db), []);
    assert.equal(await finish(db, user(1), otherOwner, true), false);
    assert.equal(await finish(db, user(1), owner, false), true);
    assert.equal((await row(db, user(1))).status, "pending");
    assert.deepEqual(await claim(db), [], "retry cannot bypass 30 second delay");
    await makeAvailable(db, user(1));
    assert.equal((await claim(db, otherOwner))[0].attempts, 2);
    assert.equal(await finish(db, user(1), owner, true), false);
    assert.equal(await finish(db, user(1), otherOwner, false), true);
    await makeAvailable(db, user(1));
    assert.equal((await claim(db))[0].attempts, 3);
    assert.equal(await finish(db, user(1), owner, false), true);
    assert.equal((await row(db, user(1))).status, "failed");
    await makeAvailable(db, user(1));
    assert.deepEqual(await claim(db), []);

    await expire(db, user(2));
    assert.equal(await finish(db, user(2), otherOwner, true), false, "expired owner cannot finish");
    assert.equal((await claim(db))[0].attempts, 2, "expired lease can be reclaimed");
    assert.equal(await finish(db, user(2), otherOwner, true), false, "previous owner cannot finish reclaimed work");
    await expire(db, user(2));
    assert.equal((await claim(db, otherOwner))[0].attempts, 3);
    await expire(db, user(2));
    assert.deepEqual(await claim(db), [], "crashed jobs also stop at three attempts");
    assert.equal((await row(db, user(2))).status, "failed");
    assert.equal(await enqueue(db), 0, "enqueue does not resurrect failed jobs");
  } finally {
    await db.close();
  }
});

test("durable job SQL: success, revoked/missing users, switched accounts and stale sessions", async () => {
  const db = await bootstrap();
  try {
    await seed(db);
    await enqueue(db);
    const first = (await claim(db))[0];
    assert.equal(await finish(db, first.user_id, owner, true), true);
    assert.equal((await row(db, first.user_id)).status, "done");
    assert.equal(await finish(db, first.user_id, owner, true), false);
    await db.exec("DELETE FROM auto_trade_jobs");
    await enqueue(db);
    await db.query("UPDATE auth.users SET raw_app_meta_data='{\"role\":\"pending\"}' WHERE id=$1", [user(1)]);
    assert.equal((await claim(db))[0].user_id, user(2));
    assert.equal((await row(db, user(1))).status, "cancelled");
    await db.query("DELETE FROM auth.users WHERE id=$1", [user(2)]);
    assert.deepEqual(await claim(db), []);
    assert.equal((await row(db, user(2))).status, "cancelled");

    await db.exec("DELETE FROM auto_trade_jobs");
    await db.query("UPDATE auth.users SET raw_app_meta_data='{\"role\":\"user\"}' WHERE id=$1", [user(1)]);
    await enqueue(db);
    await db.query("UPDATE mock_accounts SET trading_mode='live' WHERE user_id=$1", [user(1)]);
    assert.deepEqual(await claim(db), [], "account switched out of mock must not execute");
    assert.equal((await row(db, user(1))).status, "cancelled");
    await db.exec("DELETE FROM auto_trade_jobs");
    await db.query("UPDATE mock_accounts SET trading_mode='mock' WHERE user_id=$1", [user(1)]);
    await enqueue(db);
    await db.query("DELETE FROM mock_accounts WHERE user_id=$1", [user(1)]);
    assert.deepEqual(await claim(db), [], "removed account must not execute");
    assert.equal((await row(db, user(1))).status, "cancelled");

    await db.exec("DELETE FROM auto_trade_jobs");
    await db.query("INSERT INTO auto_trade_jobs(run_date,user_id,status) VALUES((now() AT TIME ZONE 'Asia/Seoul')::date-1,$1,'pending'),((now() AT TIME ZONE 'Asia/Seoul')::date-1,$2,'running')", [user(1),user(2)]);
    await enqueue(db);
    assert.equal(await scalar(db, "SELECT count(*) FROM auto_trade_jobs WHERE status='cancelled'"), 2);
    await assert.rejects(db.query("SELECT * FROM claim_auto_trade_job((now() AT TIME ZONE 'Asia/Seoul')::date-1,$1)", [owner]), /Invalid job claim/);
  } finally {
    await db.close();
  }
});

test("complete baseline plus every migration: profile trigger, new service RPCs and legacy revocation coexist", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}', raw_user_meta_data jsonb DEFAULT '{}');
      -- Optional profile schema exists on some deployments, outside baseline schema.sql.
      CREATE TABLE public.user_profiles(id uuid PRIMARY KEY, email text, full_name text, role text);
      CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        INSERT INTO public.user_profiles(id,email,full_name,role)
        VALUES(NEW.id,NEW.email,NEW.raw_user_meta_data->>'full_name','admin');
        RETURN NEW;
      END $$;
      CREATE TRIGGER legacy_new_user AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
      INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('${user(9)}','existing-admin@example.invalid','{"role":"admin"}');
    `);
    await db.exec(await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
    // Model a previously exposed deployment so migrations must actively revoke access.
    await db.exec("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon,authenticated,service_role;");
    const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter(file => file.endsWith(".sql")).sort();
    for (const file of files) {
      try {
        await db.exec(await migration(file));
      } catch (error) {
        throw new Error(`Migration failed against complete baseline: ${file}`, { cause: error });
      }
    }
    for (const suffix of ["0001_api_security", "0002_mock_ledger", "0003_price_versions", "0004_access_controls", "0005_auto_trade_jobs"]) {
      assert.ok(files.includes(`20261020${suffix}.sql`), suffix);
    }
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES($1,'self-claimed-owner@example.invalid',$2::jsonb,$3::jsonb)", [user(1), JSON.stringify({full_name:"Applicant",role:"admin"}), JSON.stringify({role:"user"})]);
    assert.equal(await scalar(db, "SELECT role FROM user_profiles WHERE id=$1", [user(1)]), "pending", "trigger never bootstraps new admins");
    assert.equal(await scalar(db, "SELECT full_name FROM user_profiles WHERE id=$1", [user(1)]), "Applicant");
    assert.equal(await scalar(db, "SELECT role FROM user_profiles WHERE id=$1", [user(9)]), "admin", "existing administrator preserved");
    assert.equal(await scalar(db, "SELECT has_table_privilege('authenticated','user_profiles','SELECT')"), false);
    assert.equal(await scalar(db, "SELECT relrowsecurity FROM pg_class WHERE oid='user_profiles'::regclass"), true);

    const legacyBuy = "execute_mock_buy(uuid,character varying,character varying,integer,double precision,text)";
    const legacySell = "execute_mock_sell(uuid,character varying,character varying,integer,double precision,text)";
    for (const signature of [legacyBuy, legacySell]) {
      assert.equal(await scalar(db, "SELECT has_function_privilege('service_role',$1,'EXECUTE')", [signature]), false, "004 must not regrant legacy bypass");
    }
    await db.exec("SET ROLE service_role");
    assert.equal(await scalar(db, "SELECT acquire_auto_trade_lease($1,$2)", [user(1), owner]), true);
    const order = (side, epoch, key, price) => scalar(db, "SELECT execute_mock_order($1,'005930','verified test',2,$2,$3,$4,$5,$6,100)", [user(1),price,key,side,epoch,owner]);
    assert.equal((await order("BUY",0,"combined-buy",101)).duplicate, false);
    assert.equal((await order("BUY",0,"combined-buy",101)).duplicate, true);
    assert.equal((await order("SELL",0,"combined-sell",110)).realized_pnl, 18);
    let snapshot = await scalar(db, "SELECT mock_account_snapshot($1)", [user(1)]);
    assert.equal(snapshot.cash, 10000018);
    assert.equal(snapshot.realized_pnl, 18);
    await db.query("SELECT update_mock_account($1,$2,0,11000018,true,1000000,true,false)", [user(1),owner]);
    snapshot = await scalar(db, "SELECT mock_account_snapshot($1)", [user(1)]);
    assert.equal(snapshot.net_cash_adjustments, 1000000);
    assert.equal(snapshot.cash, 11000018);
    assert.equal(snapshot.auto_trade_capital, 1000000);
    await db.query("SELECT update_mock_account($1,$2,0,NULL,false,NULL,false,true)", [user(1),owner]);
    snapshot = await scalar(db, "SELECT mock_account_snapshot($1)", [user(1)]);
    assert.equal(snapshot.account_epoch, 1);
    assert.equal(snapshot.cash, 10000000);
    assert.equal(snapshot.positions.length, 0);
    await assert.rejects(order("BUY",0,"stale",100), /stale_account_epoch/);
    assert.equal((await order("BUY",1,"combined-buy",101)).duplicate, false);
    await assert.rejects(db.query("SELECT execute_mock_buy($1,'005930','bypass',1,100,'old')", [user(1)]), /permission denied/);
    await assert.rejects(db.query("SELECT execute_mock_sell($1,'005930','bypass',1,100,'old')", [user(1)]), /permission denied/);

    for (let i=0; i<6; i++) assert.equal(await scalar(db, "SELECT consume_api_quota($1,'analysis',20)", [user(1)]), true);
    assert.equal(await scalar(db, "SELECT consume_api_quota($1,'analysis',1)", [user(1)]), false);
    const prices = JSON.stringify([{date:"2026-10-16",open:100,high:110,low:90,close:105,volume:200}]);
    assert.equal(await scalar(db, "SELECT publish_price_snapshot('005930.KS',0,$1::jsonb,'seed')", [prices]), 1);
    const priceSnapshot = await scalar(db, "SELECT read_price_snapshot('005930.KS')");
    assert.equal(priceSnapshot.revision, 1);
    assert.equal(priceSnapshot.rows[0].close, 105);
    await assert.rejects(db.query("SELECT publish_price_snapshot('005930.KS',0,$1::jsonb,'append')", [prices]), /revision conflict/);
    assert.equal(await enqueue(db), 1);
    assert.equal((await claim(db))[0].user_id, user(1));
    assert.equal(await finish(db,user(1),owner,true), true);
    await db.exec("RESET ROLE; SET ROLE authenticated");
    await assert.rejects(db.query("SELECT mock_account_snapshot($1)", [user(1)]), /permission denied/);
    await assert.rejects(db.query("SELECT consume_api_quota($1,'analysis',1)", [user(1)]), /permission denied/);
    await assert.rejects(db.query("SELECT read_price_snapshot('005930.KS')"), /permission denied/);
  } finally {
    await db.close();
  }
});
