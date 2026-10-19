import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("price snapshots retain history, reject stale writers and roll back invalid replacements", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const name of ["202608160001_price_daily.sql", "202610200003_price_versions.sql"])
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
    await db.exec("INSERT INTO price_daily(ticker,date,close) VALUES('TEST','2026-01-01',100)");
    const read = async () => (await db.query("SELECT read_price_snapshot('TEST') AS snapshot")).rows[0].snapshot;
    const publish = (revision, rows) => db.query("SELECT publish_price_snapshot('TEST',$1,$2::jsonb,'resync')", [revision, JSON.stringify(rows)]);
    assert.equal((await read()).revision, 0);
    await publish(0, [{ date: "2026-01-01", close: 50 }]);
    await assert.rejects(publish(0, [{ date: "2026-01-01", close: 200 }]));
    await assert.rejects(publish(1, [{ date: "2026-01-02", close: 0 }]));
    await assert.rejects(publish(1, [{ date: "2026-01-02", close: 20 }, { date: "2026-01-02", close: 25 }]));
    // Force an INSERT failure after the RPC's DELETE to verify transaction rollback.
    await db.exec(`CREATE FUNCTION reject_test_price() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.date='2026-01-03' THEN RAISE EXCEPTION 'injected write failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_test_price BEFORE INSERT ON price_daily FOR EACH ROW EXECUTE FUNCTION reject_test_price();`);
    await assert.rejects(publish(1, [{ date: "2026-01-03", close: 70 }]));
    assert.equal((await read()).rows[0].close, 50);
    assert.equal((await read()).revision, 1);
    const legacy = await db.query("SELECT rows FROM price_snapshot_versions WHERE ticker='TEST' AND revision=0");
    assert.equal(legacy.rows[0].rows[0].close, 100);
    await db.exec("SET ROLE anon");
    await assert.rejects(read());
    await assert.rejects(publish(1, [{ date: "2026-01-01", close: 300 }]));
  } finally { await db.close(); }
});

test("ETF tie ranks match between production and snapshots and ignore input order", async () => {
  const rankers = [];
  for (const name of ["../frontend/lib/server/etf-ranking-service.ts", "./etf_pick_snapshot.mjs"]) {
    const source = await readFile(new URL(name, import.meta.url), "utf8");
    let fn = source.match(/function rankZ\(values[^]*?\n\}/)[0];
    fn = fn.replace("values: number[]", "values").replace("): number[]", ")").replace("new Array<number>(n)", "new Array(n)");
    rankers.push(new Function(`const RANK_Z_DENOM=0.2887; return (${fn});`)());
  }
  for (const rank of rankers) {
    assert.deepEqual(rank([0, 0, 0]), [0, 0, 0]);
    const original = rank([0, 1, 0, 2]);
    const permuted = rank([2, 0, 1, 0]);
    assert.equal(original[0], original[2]);
    assert.deepEqual(permuted, [original[3], original[0], original[1], original[2]]);
  }
  assert.deepEqual(rankers[0]([0, 1, 0, 2]), rankers[1]([0, 1, 0, 2]));
});
