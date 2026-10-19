/** Isolated PostgreSQL/WASM integration tests; never connects to production. */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("SQL migrations: leases, atomic publication, guarded/idempotent fills and privileges", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
    for (const table of ["mock_accounts", "mock_positions", "mock_trades", "prophet_recommendations"]) {
      const statement = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
      assert.ok(statement, table); await db.exec(statement[0]);
    }
    await db.exec("ALTER TABLE mock_trades ADD COLUMN realized_pnl NUMERIC; CREATE UNIQUE INDEX ON mock_trades(user_id, client_order_id) WHERE client_order_id IS NOT NULL;");
    for (const file of ["202610190002_trading_safety.sql", "202610190001_mock_order_guards.sql"])
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const user = "00000000-0000-0000-0000-000000000001";
    const owner = "00000000-0000-0000-0000-000000000002";
    const other = "00000000-0000-0000-0000-000000000003";
    const acquire = async o => (await db.query("SELECT acquire_auto_trade_lease($1,$2) AS ok", [user, o])).rows[0].ok;
    assert.equal(await acquire(owner), true); assert.equal(await acquire(other), false);
    await db.query("SELECT release_auto_trade_lease($1,$2)", [user, other]);
    assert.equal(await acquire(other), false);
    await db.query("SELECT release_auto_trade_lease($1,$2)", [user, owner]);
    assert.equal(await acquire(other), true);

    const buy = (quantity, price, id) => db.query("SELECT execute_mock_buy($1,'1','test',$2,$3,$4) AS fill", [user, quantity, price, id]);
    for (const [qty, price] of [[-1,100],[0,100],[1,-1],[1,Infinity],[1,NaN]]) await assert.rejects(buy(qty, price, "invalid"));
    assert.equal((await buy(10, 100, "order-1")).rows[0].fill.duplicate, false);
    assert.equal((await buy(10, 100, "order-1")).rows[0].fill.duplicate, true);
    assert.equal((await db.query("SELECT quantity FROM mock_positions")).rows[0].quantity, 10);
    assert.equal((await db.query("SELECT cash FROM mock_accounts")).rows[0].cash, 9999000);
    const sell = () => db.query("SELECT execute_mock_sell($1,'1','test',10,110,'sell-1') AS fill", [user]);
    await sell(); assert.equal((await sell()).rows[0].fill.duplicate, true);
    assert.equal((await db.query("SELECT cash FROM mock_accounts")).rows[0].cash, 10000100);

    const rows = Array.from({ length: 20 }, (_, i) => ({ run_date: "2026-10-16", rank: i + 1, ticker: String(i), current_price: 100 }));
    const publish = data => db.query("SELECT publish_recommendations('2026-10-16','2026-10-16','test',$1::jsonb)", [JSON.stringify(data)]);
    await publish(rows);
    assert.equal((await db.query("SELECT count(*) AS n FROM recommendation_batches")).rows[0].n, 1);
    await assert.rejects(publish(rows.slice(0, 19)));
    await assert.rejects(publish(rows.map(r => ({ ...r, ticker: "duplicate" }))));
    assert.equal((await db.query("SELECT count(*) AS n FROM prophet_recommendations")).rows[0].n, 20);
    assert.equal((await db.query("SELECT ticker FROM prophet_recommendations WHERE rank=1")).rows[0].ticker, "0");
    await db.exec("SET ROLE anon");
    await assert.rejects(acquire(owner), /permission denied/);
    await assert.rejects(buy(1,100,"anon"), /permission denied/);
    await db.exec("RESET ROLE");
  } finally { await db.close(); }
});
