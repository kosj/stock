/** Offline policy, stream bounds, concurrency and real PostgreSQL quota tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { createRequire } from "node:module";
import * as policy from "../frontend/lib/server/api-security-policy.ts";
import { isApprovedRole, apiAccessPolicy, parseTicker, parseTickerBatch, readBoundedJson, boundedSettled } from "../frontend/lib/server/api-security-policy.ts";

const responseStub = { json: (body, init) => Response.json(body, init), next: () => ({ status: 200, cookies: { set() {} } }), redirect: url => Response.redirect(url) };
async function loadHandler(path, modules, env = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", "process", compiled)(name => {
    if (name === "next/server") return { NextResponse: responseStub };
    if (modules[name]) return modules[name];
    if (name.startsWith("node:")) return createRequire(import.meta.url)(name);
    throw new Error(`unexpected dependency ${name}`);
  }, exports, { env });
  return exports;
}

test("actual route guard denies unauthenticated, pending/rejected and user-metadata elevation", async () => {
  for (const [user, status] of [[null, 401], [{ id: "u", app_metadata: { role: "pending" } }, 403],
    [{ id: "u", app_metadata: { role: "rejected" } }, 403], [{ id: "u", user_metadata: { role: "admin" } }, 403],
    [{ id: "u", app_metadata: { role: "user" } }, 200], [{ id: "u", app_metadata: { role: "admin" } }, 200]]) {
    const handler = await loadHandler("frontend/lib/server/require-user.ts", {
      "./api-security-policy": policy,
      "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    });
    const result = await handler.requireUser();
    assert.equal(result.ok ? 200 : result.response.status, status);
    const admin = await handler.requireAdmin();
    assert.equal(admin.ok, user?.app_metadata?.role === "admin");
  }
});

test("actual middleware protects API boundary, fails closed and preserves public/cron paths", async () => {
  const request = pathname => ({ nextUrl: { pathname }, url: `https://offline.invalid${pathname}`, cookies: { getAll: () => [], set() {} } });
  for (const [role, expected] of [[undefined, 401], ["pending", 403], ["rejected", 403], ["unknown", 403], ["user", 200], ["admin", 200]]) {
    const handler = await loadHandler("frontend/middleware.ts", {
      "./lib/server/api-security-policy": policy,
      "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: role ? { app_metadata: { role } } : null } }) } }) },
    }, { NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy" });
    assert.equal((await handler.middleware(request("/api/portfolio"))).status, expected);
    assert.equal((await handler.middleware(request("/api/admin/users"))).status, role === "admin" ? 200 : role ? 403 : 401);
  }
  const noConfig = await loadHandler("frontend/middleware.ts", { "./lib/server/api-security-policy": policy, "@supabase/ssr": {} });
  assert.equal((await noConfig.middleware(request("/api/portfolio"))).status, 503);
  for (const path of ["/api/auth/signup", "/api/health", "/api/cron/auto-trade"]) assert.equal((await noConfig.middleware(request(path))).status, 200);
});

test("signup cannot bootstrap admin from a supplied email or role", async () => {
  let created;
  const handler = await loadHandler("frontend/app/api/auth/signup/route.ts", {
    "@/lib/server/api-security-policy": policy,
    "@/lib/supabase/server": { createSupabaseAdminClient: () => ({
      rpc: async () => ({ data: true, error: null }),
      auth: { admin: { createUser: async input => { created = input; return { data: { user: { id: "new" } } }; } } },
      from: () => ({ upsert: async () => ({ error: null }) }),
    }) },
  }, { SUPABASE_SERVICE_ROLE_KEY: "offline-dummy" });
  const response = await handler.POST(new Request("https://offline.invalid", { method: "POST", body: JSON.stringify({ email: "godkosj@gmail.com", password: "valid-password", role: "admin" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(created.app_metadata, { role: "pending" });
});

test("signup is throttled before any account is created and fails closed without the limiter", async () => {
  for (const [quota, expected] of [[{ data: false, error: null }, 429], [{ data: null, error: { message: "missing function" } }, 503], [{ data: true, error: null }, 200]]) {
    let created = 0, client;
    const handler = await loadHandler("frontend/app/api/auth/signup/route.ts", {
      "@/lib/server/api-security-policy": policy,
      "@/lib/supabase/server": { createSupabaseAdminClient: () => ({
        rpc: async (name, args) => { assert.equal(name, "consume_signup_quota"); client = args.p_client; return quota; },
        auth: { admin: { createUser: async () => { created++; return { data: { user: { id: "new" } } }; } } },
        from: () => ({ upsert: async () => ({ error: null }) }),
      }) },
    }, { SUPABASE_SERVICE_ROLE_KEY: "offline-dummy" });
    const response = await handler.POST(new Request("https://offline.invalid", { method: "POST", headers: { "x-real-ip": "203.0.113.7" },
      body: JSON.stringify({ email: "applicant@example.invalid", password: "valid-password" }) }));
    assert.equal(response.status, expected);
    assert.equal(created, expected === 200 ? 1 : 0, "no account before the quota allows it");
    assert.match(client, /^[0-9a-f]{64}$/, "only a keyed hash of the client address is sent");
    assert.ok(!client.includes("203.0.113.7"));
  }
});

test("cross-site state changes are rejected while same-origin, read-only and cron requests pass", async () => {
  const h = values => new Headers(values);
  assert.equal(policy.isForeignMutation("POST", h({ origin: "https://evil.example" }), "app.example"), true);
  assert.equal(policy.isForeignMutation("POST", h({ origin: "null" }), "app.example"), true);
  assert.equal(policy.isForeignMutation("DELETE", h({ "sec-fetch-site": "same-site" }), "app.example"), true);
  assert.equal(policy.isForeignMutation("POST", h({ "sec-fetch-site": "cross-site", origin: "https://app.example" }), "app.example"), true);
  assert.equal(policy.isForeignMutation("POST", h({ origin: "https://app.example", "sec-fetch-site": "same-origin" }), "app.example"), false);
  assert.equal(policy.isForeignMutation("GET", h({ origin: "https://evil.example" }), "app.example"), false);
  assert.equal(policy.isForeignMutation("POST", h({}), "app.example"), false, "server-to-server calls carry no browser cookies");

  const handler = await loadHandler("frontend/middleware.ts", {
    "./lib/server/api-security-policy": policy,
    "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { app_metadata: { role: "admin" } } } }) } }) },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy" });
  const req = (pathname, method, headers) => ({ method, headers: new Headers({ host: "app.example", ...headers }), nextUrl: { pathname, host: "app.example" },
    url: `https://app.example${pathname}`, cookies: { getAll: () => [], set() {} } });
  for (const path of ["/api/mock/account/reset", "/api/admin/users/x/approve", "/api/auth/signup"]) {
    assert.equal((await handler.middleware(req(path, "POST", { origin: "https://evil.example" }))).status, 403, path);
  }
  assert.equal((await handler.middleware(req("/api/mock/account/reset", "POST", { origin: "https://app.example" }))).status, 200);
  assert.equal((await handler.middleware(req("/api/cron/auto-trade", "POST", { origin: "https://evil.example" }))).status, 200, "cron uses its own bearer secret");
});

test("cron secret check fails closed and rejects wrong or missing bearer tokens", async () => {
  const load = env => loadHandler("frontend/lib/server/cron-auth.ts", {}, env);
  const call = async (env, authorization) => (await load(env)).cronAuthFailure(new Request("https://offline.invalid", { headers: authorization ? { authorization } : {} }));
  assert.equal((await call({}, "Bearer anything")).status, 500);
  assert.equal((await call({ CRON_SECRET: "s3cret" }, undefined)).status, 401);
  assert.equal((await call({ CRON_SECRET: "s3cret" }, "Bearer s3cre")).status, 401);
  assert.equal((await call({ CRON_SECRET: "s3cret" }, "Bearer s3cret")), null);
});

test("admin user actions cannot target the actor, other admins or malformed ids", async () => {
  const actor = "00000000-0000-4000-8000-000000000001";
  const roles = { "00000000-0000-4000-8000-000000000002": "admin", "00000000-0000-4000-8000-000000000003": "pending" };
  const { managedTargetFailure } = await loadHandler("frontend/lib/server/admin-target.ts", { "@/lib/supabase/server": {} });
  const admin = { auth: { admin: { getUserById: async id => roles[id] ? { data: { user: { id, app_metadata: { role: roles[id] } } }, error: null } : { data: { user: null }, error: { message: "not found" } } } } };
  assert.equal((await managedTargetFailure(admin, actor, "../../etc")).status, 400);
  assert.equal((await managedTargetFailure(admin, actor, actor)).status, 400);
  assert.equal((await managedTargetFailure(admin, actor, "00000000-0000-4000-8000-000000000002")).status, 409);
  assert.equal((await managedTargetFailure(admin, actor, "00000000-0000-4000-8000-000000000009")).status, 404);
  assert.equal(await managedTargetFailure(admin, actor, "00000000-0000-4000-8000-000000000003"), null);
});

test("actual analysis request validates before quota and fails closed on quota failure", async () => {
  let calls = 0, quotaResult = { data: true, error: null };
  const handler = await loadHandler("frontend/lib/server/analysis-request.ts", {
    "./api-security-policy": policy,
    "./require-user": { requireApprovedUser: async () => ({ ok: true, userId: "u", role: "user" }) },
    "@/lib/supabase/server": { createSupabaseAdminClient: () => ({ rpc: async () => { calls++; return quotaResult; } }) },
  });
  const req = body => new Request("https://offline.invalid", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await handler.analysisBatchRequest(req({ tickers: [null] }))).response.status, 400);
  assert.equal(calls, 0);
  assert.equal((await handler.analysisBatchRequest(req({ tickers: ["AAPL"] }))).ok, true);
  quotaResult = { data: false, error: null };
  const denied = await handler.analysisBatchRequest(req({ tickers: ["AAPL"] }));
  assert.equal(denied.response.status, 429);
  assert.equal(denied.response.headers.get("Retry-After"), "60");
  quotaResult = { data: null, error: { message: "migration missing" } };
  assert.equal((await handler.analysisBatchRequest(req({ tickers: ["AAPL"] }))).response.status, 503);
});

test("only explicit server-assigned approved roles authorize application access", () => {
  for (const role of [null, undefined, "pending", "rejected", "ADMIN", "", {}, 1]) assert.equal(isApprovedRole(role), false);
  assert.equal(isApprovedRole("user"), true);
  assert.equal(isApprovedRole("admin"), true);
  for (const path of ["/api/mock/account", "/api/portfolio", "/api/analysis/tft", "/api/settings/broker", "/api/auth/anything"]) assert.equal(apiAccessPolicy(path), "approved");
  assert.equal(apiAccessPolicy("/api/admin/users"), "admin");
  for (const path of ["/api/auth/signup", "/api/auth/logout", "/api/auth/heartbeat", "/api/health", "/api/cron/auto-trade"]) assert.equal(apiAccessPolicy(path), "public");
});

test("ticker and batch validation rejects hostile shapes before fan-out", () => {
  for (const value of [null, 123, {}, "", "../../etc", "A&key=secret", "A/B", "a".repeat(17), "005930?x"]) assert.throws(() => parseTicker(value));
  for (const ticker of ["005930", "005930.KS", "AAPL", "BRK-B", "^KS11", "USD/KRW", "EUR/USD", "USD/JPY", "USD/CNY", "S&P500"]) assert.equal(parseTicker(ticker.toLowerCase()), ticker);
  assert.deepEqual(parseTickerBatch({ tickers: [" aapl ", "AAPL", "005930"] }).tickers, ["AAPL", "005930"]);
  for (const body of [null, [], {}, { tickers: [] }, { tickers: Array(21).fill("AAPL") }, { tickers: [null] }, { tickers: ["AAPL"], basket: "true" }]) assert.throws(() => parseTickerBatch(body));
  assert.throws(() => parseTickerBatch({ tickers: Array(11).fill("AAPL") }, 10));
});

test("body byte limit includes chunked requests and malformed JSON", async () => {
  const req = body => new Request("https://offline.invalid", { method: "POST", body });
  assert.deepEqual(await readBoundedJson(req('{"tickers":["AAPL"]}')), { tickers: ["AAPL"] });
  await assert.rejects(readBoundedJson(req("invalid")), /invalid JSON/);
  await assert.rejects(readBoundedJson(req("한".repeat(3000))), e => e.status === 413);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5000)); controller.enqueue(new Uint8Array(5000)); controller.close(); } });
  await assert.rejects(readBoundedJson(new Request("https://offline.invalid", { method: "POST", body, duplex: "half" })), e => e.status === 413);
});

test("bounded fan-out preserves rejection and order with at most three active tasks", async () => {
  let active = 0, peak = 0;
  const values = await boundedSettled(Array.from({ length: 20 }, (_, i) => i), async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (value === 5) throw new Error("provider failure");
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.equal(values[5].status, "rejected");
  assert.deepEqual(values[19], { status: "fulfilled", value: 38 });
});

test("durable quota is atomic, user-isolated, resets and denies browser DB roles", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);");
    const user = "00000000-0000-0000-0000-000000000001", other = "00000000-0000-0000-0000-000000000002";
    await db.query("INSERT INTO auth.users VALUES ($1),($2)", [user, other]);
    const migration = await readFile(new URL("../supabase/migrations/202610200001_api_security.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration); // repeatable apply
    const consume = (id = user, cost = 20) => db.query("SELECT public.consume_api_quota($1,'analysis',$2) AS ok", [id, cost]).then(r => r.rows[0].ok);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => consume()));
    assert.equal(outcomes.filter(Boolean).length, 6);
    assert.equal(await consume(other), true);
    assert.equal((await db.query("SELECT used FROM api_request_quotas WHERE user_id=$1", [user])).rows[0].used, 120);
    await db.query("UPDATE api_request_quotas SET window_started_at=now()-interval '61 seconds' WHERE user_id=$1", [user]);
    assert.equal(await consume(), true);
    for (const cost of [0, -1, 21, null]) await assert.rejects(consume(user, cost));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(consume(), /permission denied/);
      await assert.rejects(db.query("SELECT * FROM api_request_quotas"), /permission denied/);
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    assert.equal(await consume(other, 1), true);
  } finally { await db.close(); }
});

test("forward migration replaces optional legacy signup trigger without changing existing roles", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
      CREATE TABLE public.user_profiles(id uuid PRIMARY KEY, email text, full_name text, role text);
      CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO public.user_profiles VALUES(NEW.id, NEW.email, '', 'admin'); RETURN NEW; END $$;
      CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
      INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001','existing@example.com','{}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/202610200001_api_security.sql", import.meta.url), "utf8"));
    await db.exec("INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000002','godkosj@gmail.com','{}');");
    const rows = (await db.query("SELECT role FROM user_profiles ORDER BY id")).rows;
    assert.deepEqual(rows.map(r => r.role), ["admin", "pending"]);
  } finally { await db.close(); }
});
