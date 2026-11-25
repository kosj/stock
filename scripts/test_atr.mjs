/**
 * ATR 단일 구현(lib/server/atr.ts) 회귀 테스트.
 *
 * 2026-11-25 VolatilityCalculator(position-manager-service)와 prophet-forecast 가 각자
 * 들고 있던 TR 계산·클램프 상수를 lib/server/atr.ts 로 모았다. 손절선·진입 레벨·예측
 * 시나리오 폭이 모두 이 값에 의존하므로 리팩터 전후 결과가 비트 단위로 같아야 한다.
 *
 * 아래 referenceAtr 은 리팩터 전 VolatilityCalculator 의 계산을 그대로 옮긴 기준
 * 구현이다. 리팩터 당시 실제 옛 원본과 2만 건 퍼징 대조(Object.is)로 불일치 0건을
 * 확인했고, 합산 순서만 뒤집어도 2천여 건이 달라지는 것을 변이 검사로 확인했다 —
 * 부동소수점 결합 순서까지 보존해야 같은 값이 된다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load(path, modules = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    if (modules[name]) return modules[name];
    throw new Error(`unexpected dependency ${name}`);
  }, exports);
  return exports;
}

const atr = await load("frontend/lib/server/atr.ts");
const { VolatilityCalculator } = await load("frontend/lib/server/position-manager-service.ts", { "./atr": atr });

/** 리팩터 전 VolatilityCalculator 의 ATR 계산 (기준 구현, 값을 바꾸지 말 것) */
function referenceAtr(candles, currentPrice) {
  if (candles.length < 2 || currentPrice <= 0) return { atr: currentPrice * (0.5 / 100), atrPct: 0.5 };
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const window = Math.min(14, trueRanges.length);
  const recentTR = trueRanges.slice(-window);
  const atrValue = recentTR.reduce((sum, v) => sum + v, 0) / recentTR.length;
  const rawAtrPct = currentPrice > 0 ? (atrValue / currentPrice) * 100 : 0.5;
  return { atr: atrValue, atrPct: Math.min(12.0, Math.max(0.5, rawAtrPct)) };
}

function series(rnd, len, scale, vol) {
  let px = scale;
  const out = [];
  for (let i = 0; i < len; i++) {
    const open = px * (1 + (rnd() - 0.5) * vol * 2);
    const high = open * (1 + rnd() * vol), low = open * (1 - rnd() * vol);
    const close = low + (high - low) * rnd();
    out.push({ date: `d${i}`, open, high, low, close, volume: 1 });
    px = close;
  }
  return out;
}

test("상수: 기존 두 구현이 쓰던 값 그대로 (14일 / 0.5% / 12%)", () => {
  assert.equal(atr.ATR_PERIOD, 14);
  assert.equal(atr.ATR_PCT_FLOOR, 0.5);
  assert.equal(atr.ATR_PCT_CEIL, 12.0);
});

test("TR 은 갭을 반영한다 — 문서화된 예시(전일 10,000 / 고 10,800 / 저 10,200 → 800)", () => {
  const c = [{ high: 10050, low: 9950, close: 10000 }, { high: 10800, low: 10200, close: 10500 }];
  assert.equal(atr.averageTrueRange(c), 800);
});

test("캔들 2개 미만이면 ATR 을 만들 수 없다(null) — 폴백은 호출부가 정한다", () => {
  assert.equal(atr.averageTrueRange([]), null);
  assert.equal(atr.averageTrueRange([{ high: 1, low: 1, close: 1 }]), null);
  // VolatilityCalculator 의 폴백은 0.5%(손절용)
  assert.equal(VolatilityCalculator.compute([], 1000).atrPct, 0.5);
});

test("클램프: 0.5% 미만은 0.5%, 12% 초과는 12%", () => {
  assert.equal(atr.clampAtrPct(0.01), 0.5);
  assert.equal(atr.clampAtrPct(3.3), 3.3);
  assert.equal(atr.clampAtrPct(40), 12);
});

test("high/low 결측은 종가로 대신한다 (예전 VolatilityCalculator 는 NaN 손절선이 됐다)", () => {
  const c = [{ close: 100 }, { high: null, low: undefined, close: 103 }];
  assert.equal(atr.averageTrueRange(c), 3);
  assert.ok(Number.isFinite(VolatilityCalculator.compute(c, 103).atrPct));
});

test("리팩터 전후 비트 단위 동일 — VolatilityCalculator atr·atrPct·config 5천 건 퍼징", () => {
  let seed = 20261125;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let trial = 0; trial < 5000; trial++) {
    const len = Math.floor(rnd() * 42);
    const scale = [0.01, 1, 100, 70000, 1.5e6][Math.floor(rnd() * 5)];
    const vol = [0.0001, 0.005, 0.03, 0.2, 0.6][Math.floor(rnd() * 5)];
    const c = series(rnd, len, scale, vol);
    const last = c.at(-1)?.close ?? scale;
    const price = [last, last * (1 + (rnd() - 0.5) * 0.1), 0, -5, scale][Math.floor(rnd() * 5)];

    const ref = referenceAtr(c, price);
    const got = VolatilityCalculator.compute(c, price);
    const label = `trial=${trial} len=${len} price=${price}`;
    assert.ok(Object.is(got.atr, ref.atr), `atr ${label}`);
    assert.ok(Object.is(got.atrPct, ref.atrPct), `atrPct ${label}`);
    // config 는 _buildConfig(atrPct, atr, price) 결과 — 입력이 같으면 손절선도 같다
    assert.deepEqual(got.config, VolatilityCalculator._buildConfig(ref.atrPct, ref.atr, price), `config ${label}`);
  }
});
