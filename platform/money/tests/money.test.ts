import assert from "node:assert/strict";
import test from "node:test";
import { Decimal as OracleDecimal } from "decimal.js";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import {
  Decimal,
  MAX_PRECISION,
  MAX_SCALE,
  Money,
  ROUNDING_MODES,
  allocate,
  daysBetween,
  prorateActualDays,
  sumMoney,
  type RoundingMode,
} from "../src/index.ts";

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;
const d = (text: string) => Decimal.parse(text);

// ---------------------------------------------------------------------------------------------
// Golden cases (SPIKE-02; pricing spec sections 13 and 23). Expected values are hand-computed.
// ---------------------------------------------------------------------------------------------

test("SPIKE-02 parsing is strict and formatting is canonical at the value's scale", () => {
  for (const [input, output] of [["0", "0"], ["1.50", "1.50"], ["-0.125", "-0.125"], ["-0.00", "0.00"], ["12345678901234567890.123456789012345678", "12345678901234567890.123456789012345678"]]) {
    assert.equal(d(input!).toString(), output);
  }
  for (const bad of ["", " 1", "1 ", "+1", "01", "1.", ".5", "1e3", "1,000", "NaN", "Infinity", "0x10", "--1", "١"]) {
    assert.throws(() => d(bad), code("invalid_decimal"), JSON.stringify(bad));
  }
  assert.throws(() => Decimal.parse(1.5 as unknown as string), code("invalid_decimal"), "a JavaScript number is never accepted");
  assert.throws(() => d(`0.${"1".repeat(MAX_SCALE + 1)}`), code("invalid_decimal"), "more than 18 fraction digits");
  assert.throws(() => d("9".repeat(MAX_PRECISION + 1)), code("invalid_decimal"), "more than 38 digits");
  assert.equal(d(`0.${"0".repeat(17)}1`).toString(), "0.000000000000000001");
  assert.equal(JSON.stringify({ rate: d("0.0725") }), '{"rate":"0.0725"}', "decimals serialize as strings");
  assert.throws(() => +d("1.5"), TypeError, "implicit number conversion is refused");
});

test("SPIKE-02 addition, subtraction and comparison are exact", () => {
  assert.equal(d("0.1").add(d("0.2")).toString(), "0.3", "the classic float failure is exact here");
  assert.equal(d("1.005").subtract(d("0.005")).toString(), "1.000");
  assert.equal(d("-5.25").add(d("5.25")).toString(), "0.00");
  assert.equal(d("1.5").compare(d("1.50")), 0);
  assert.equal(d("1.5").equals(d("1.500")), true);
  assert.equal(d("-0.01").compare(d("0")), -1);
  assert.throws(() => d("9".repeat(38)).add(d("1")), code("calculation_rejected"), "overflow rejects");
});

test("SPIKE-02 rounding modes, including ties and negatives", () => {
  const cases: readonly [string, number, RoundingMode, string][] = [
    ["2.5", 0, "HALF_UP", "3"], ["-2.5", 0, "HALF_UP", "-3"], ["2.4", 0, "HALF_UP", "2"],
    ["2.5", 0, "HALF_EVEN", "2"], ["3.5", 0, "HALF_EVEN", "4"], ["-2.5", 0, "HALF_EVEN", "-2"], ["2.51", 0, "HALF_EVEN", "3"],
    ["2.9", 0, "DOWN", "2"], ["-2.9", 0, "DOWN", "-2"],
    ["2.1", 0, "UP", "3"], ["-2.1", 0, "UP", "-3"], ["2.0", 0, "UP", "2"],
    ["1.2345", 3, "HALF_UP", "1.235"], ["1.2344", 3, "HALF_UP", "1.234"], ["0.005", 2, "HALF_UP", "0.01"], ["-0.004", 2, "HALF_UP", "0.00"],
    ["1.5", 3, "HALF_UP", "1.500"],
  ];
  for (const [input, scale, mode, expected] of cases) assert.equal(d(input).round(scale, mode).toString(), expected, `${input} ${mode} @${scale}`);
  assert.throws(() => d("1.25").rescale(1), code("calculation_rejected"), "rescale never rounds");
  assert.equal(d("1.20").rescale(1).toString(), "1.2");
});

test("SPIKE-02 multiplication and division state their scale and never coerce", () => {
  assert.equal(d("19.99").multiply(d("3")).toString(), "59.97");
  assert.equal(d("0.000000001").multiply(d("0.000000001")).toString(), "0.000000000000000001");
  assert.throws(() => d("0.0000000001").multiply(d("0.000000001")), code("calculation_rejected"), "exact scale 19 needs explicit rounding");
  assert.equal(d("0.123456789012345678").multiply(d("1234.567890123"), { scale: 18, mode: "HALF_UP" }).toString(), "152.415787532331972688");
  assert.equal(d("10").divide(d("3"), { scale: 2, mode: "HALF_UP" }).toString(), "3.33");
  assert.equal(d("2").divide(d("3"), { scale: 2, mode: "HALF_UP" }).toString(), "0.67");
  assert.equal(d("-2").divide(d("3"), { scale: 2, mode: "DOWN" }).toString(), "-0.66");
  assert.equal(d("1").divide(d("8"), { scale: 2, mode: "HALF_EVEN" }).toString(), "0.12");
  assert.equal(d("1").divide(d("0.001"), { scale: 0, mode: "HALF_UP" }).toString(), "1000");
  assert.throws(() => d("1").divide(d("0.00"), { scale: 2, mode: "HALF_UP" }), code("calculation_rejected"), "division by zero rejects");
  assert.throws(() => d("1").round(19, "HALF_UP"), code("calculation_rejected"));
  assert.throws(() => d("1").round(2, "BANKERS" as RoundingMode), code("calculation_rejected"));
  assert.throws(() => Decimal.fromInteger(1.5), code("calculation_rejected"));
  assert.equal(Decimal.fromInteger(31).toString(), "31");
});

test("SPIKE-02 money is held at the currency minor unit: USD/INR 2, JPY 0, KWD 3", () => {
  assert.equal(Money.of("12.5", "USD").toString(), "12.50 USD");
  assert.equal(Money.of("1000", "JPY").toString(), "1000 JPY");
  assert.equal(Money.of("1.25", "KWD").toString(), "1.250 KWD");
  assert.equal(Money.of("99.99", "INR").minorUnits, 9999n);
  assert.throws(() => Money.of("12.345", "USD"), code("invalid_decimal"), "never rounds silently");
  assert.throws(() => Money.of("1000.5", "JPY"), code("invalid_decimal"));
  assert.throws(() => Money.of("1", "XYZ"), code("unsupported_currency"));
  assert.equal(Money.fromDecimal(d("1234.5"), "JPY").toString(), "1235 JPY");
  assert.equal(Money.fromDecimal(d("1.2345"), "KWD").toString(), "1.235 KWD");
  assert.equal(Money.fromDecimal(d("-10.005"), "USD").toString(), "-10.01 USD");
  assert.equal(Money.of("19.99", "USD").multiply(d("0.0725")).toString(), "1.45 USD", "1.449275 rounds once");
  assert.equal(Money.of("100", "JPY").multiply(d("0.075")).toString(), "8 JPY", "7.5 HALF_UP");
  assert.throws(() => Money.of("1", "USD").add(Money.of("1", "EUR")), code("currency_mismatch"));
  assert.equal(sumMoney([Money.of("0.10", "USD"), Money.of("0.20", "USD")], "USD").toString(), "0.30 USD");
  assert.equal(sumMoney([], "JPY").toString(), "0 JPY");
  assert.deepEqual(JSON.parse(JSON.stringify(Money.of("5", "USD"))), { amount: "5.00", currency: "USD" });
  assert.equal(Money.of("1", "USD").equals(Money.of("1", "EUR")), false);
});

test("SPIKE-02 / D6 ACTUAL_DAYS proration across 28/29/30/31-day months rounds once", () => {
  const monthly = Money.of("100.00", "USD");
  const cases: readonly [string, string, string, string][] = [
    ["2026-01-01", "2026-02-01", "2026-01-17", "48.39"], // 15 of 31 days = 48.387...
    ["2026-02-01", "2026-03-01", "2026-02-16", "46.43"], // 13 of 28 days = 46.428...
    ["2028-02-01", "2028-03-01", "2028-02-16", "48.28"], // 14 of 29 days = 48.275...
    ["2026-04-01", "2026-05-01", "2026-04-16", "50.00"], // 15 of 30 days
  ];
  for (const [start, end, changedOn, expected] of cases) {
    const remaining = prorateActualDays(monthly, { start: changedOn, end }, { start, end });
    assert.equal(remaining.amount.toString(), expected, `${changedOn} in [${start}, ${end})`);
  }
  assert.equal(prorateActualDays(monthly, { start: "2026-01-01", end: "2026-02-01" }, { start: "2026-01-01", end: "2026-02-01" }).amount.toString(), "100.00");
  assert.equal(prorateActualDays(Money.of("1000", "JPY"), { start: "2026-01-01", end: "2026-01-11" }, { start: "2026-01-01", end: "2026-02-01" }).toString(), "323 JPY");
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2, "leap day counted");
  assert.throws(() => daysBetween("2026-02-30", "2026-03-01"), code("invalid_timestamp"));
  assert.throws(() => daysBetween("2026-03-01", "2026-02-01"), code("calculation_rejected"));
  assert.throws(() => prorateActualDays(monthly, { start: "2025-12-31", end: "2026-01-10" }, { start: "2026-01-01", end: "2026-02-01" }), code("calculation_rejected"));
});

test("SPIKE-02 largest-remainder allocation sums exactly with a stable tie-break", () => {
  const equal = (keys: string[]) => keys.map((key) => ({ key, weight: d("1") }));
  const view = (parts: readonly { key: string; amount: Money }[]) => parts.map((part) => `${part.key}=${part.amount.amount}`);
  assert.deepEqual(view(allocate(Money.of("100.00", "USD"), equal(["a", "b", "c"]))), ["a=33.34", "b=33.33", "c=33.33"]);
  assert.deepEqual(view(allocate(Money.of("100.00", "USD"), equal(["c", "b", "a"]))), ["c=33.33", "b=33.33", "a=33.34"], "input order does not change who gets the unit");
  assert.deepEqual(view(allocate(Money.of("100", "JPY"), equal(["x", "y", "z"]))), ["x=34", "y=33", "z=33"]);
  assert.deepEqual(view(allocate(Money.of("-100.00", "USD"), equal(["a", "b", "c"]))), ["a=-33.34", "b=-33.33", "c=-33.33"], "negatives mirror positives");
  assert.deepEqual(
    view(allocate(Money.of("10.000", "KWD"), [{ key: "a", weight: d("0.5") }, { key: "b", weight: d("0.25") }, { key: "c", weight: d("0") }, { key: "d", weight: d("0.25") }])),
    ["a=5.000", "b=2.500", "c=0.000", "d=2.500"],
  );
  assert.deepEqual(view(allocate(Money.of("0.05", "USD"), [{ key: "big", weight: d("2") }, { key: "small", weight: d("1") }])), ["big=0.03", "small=0.02"]);
  assert.throws(() => allocate(Money.of("1", "USD"), []), code("calculation_rejected"));
  assert.throws(() => allocate(Money.of("1", "USD"), equal(["a", "a"])), code("calculation_rejected"));
  assert.throws(() => allocate(Money.of("1", "USD"), [{ key: "a", weight: d("-1") }]), code("calculation_rejected"));
  assert.throws(() => allocate(Money.of("1", "USD"), [{ key: "a", weight: d("0") }]), code("calculation_rejected"));
});

// ---------------------------------------------------------------------------------------------
// Property tests against an independent oracle (decision D5: decimal.js is a dev-only oracle).
// ---------------------------------------------------------------------------------------------

const Oracle = OracleDecimal.clone({ precision: 200, rounding: OracleDecimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
const ORACLE_MODE: Record<RoundingMode, OracleDecimal.Rounding> = {
  HALF_UP: OracleDecimal.ROUND_HALF_UP,
  HALF_EVEN: OracleDecimal.ROUND_HALF_EVEN,
  DOWN: OracleDecimal.ROUND_DOWN,
  UP: OracleDecimal.ROUND_UP,
};

/** Deterministic PRNG (mulberry32) so any failure is reproducible from the printed seed. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max); // money-lint: allow test PRNG index, not an amount
  const decimal = (maxDigits: number, maxScale: number, allowZero = true): string => {
    const digits = 1 + int(maxDigits);
    const scale = Math.min(int(maxScale + 1), digits);
    let body = Array.from({ length: digits }, () => String(int(10))).join("").replace(/^0+(?=[0-9])/, "");
    if (!allowZero && /^0*$/.test(body)) body = "1";
    const padded = body.padStart(scale + 1, "0");
    const text = scale === 0 ? padded : `${padded.slice(0, padded.length - scale)}.${padded.slice(padded.length - scale)}`;
    return int(3) === 0 && !/^[0.]*$/.test(text) ? `-${text}` : text;
  };
  return { int, decimal, pick: <T>(values: readonly T[]) => values[int(values.length)]! };
}

const normalizeZero = (text: string) => (/^-[0.]*$/.test(text) ? text.slice(1) : text);
const RUNS = 3000;

test("SPIKE-02 property: add, subtract and compare agree with the oracle", () => {
  const seed = 20260924;
  const rng = random(seed);
  for (let run = 0; run < RUNS; run += 1) {
    const [a, b] = [rng.decimal(19, 18), rng.decimal(19, 18)];
    const scale = Math.max(d(a).scale, d(b).scale);
    assert.equal(d(a).add(d(b)).toString(), normalizeZero(new Oracle(a).plus(b).toFixed(scale)), `seed ${seed} run ${run}: ${a} + ${b}`);
    assert.equal(d(a).subtract(d(b)).toString(), normalizeZero(new Oracle(a).minus(b).toFixed(scale)), `seed ${seed} run ${run}: ${a} - ${b}`);
    assert.equal(d(a).compare(d(b)), new Oracle(a).comparedTo(b), `seed ${seed} run ${run}: compare ${a} ${b}`);
  }
});

test("SPIKE-02 property: multiply, divide and round agree with the oracle in every rounding mode", () => {
  const seed = 5020926;
  const rng = random(seed);
  for (let run = 0; run < RUNS; run += 1) {
    const mode = rng.pick(ROUNDING_MODES);
    const scale = rng.int(MAX_SCALE + 1);
    const [a, b] = [rng.decimal(18, 18), rng.decimal(18, 18, false)];
    const context = `seed ${seed} run ${run}: ${a}, ${b}, ${mode} @${scale}`;
    const fits = (text: string) => text.replace(/[-.]/g, "").replace(/^0+/, "").length <= MAX_PRECISION;
    const product = new Oracle(a).times(b).toFixed(scale, ORACLE_MODE[mode]);
    if (fits(product)) {
      assert.equal(d(a).multiply(d(b), { scale, mode }).toString(), normalizeZero(product), `multiply ${context}`);
    } else {
      assert.throws(() => d(a).multiply(d(b), { scale, mode }), code("calculation_rejected"), `multiply overflow ${context}`);
    }
    const quotient = new Oracle(a).dividedBy(b).toFixed(scale, ORACLE_MODE[mode]);
    if (fits(quotient)) {
      assert.equal(d(a).divide(d(b), { scale, mode }).toString(), normalizeZero(quotient), `divide ${context}`);
    } else {
      assert.throws(() => d(a).divide(d(b), { scale, mode }), code("calculation_rejected"), `divide overflow ${context}`);
    }
    assert.equal(d(a).round(scale, mode).toString(), normalizeZero(new Oracle(a).toFixed(scale, ORACLE_MODE[mode])), `round ${context}`);
  }
});

test("SPIKE-02 property: allocation sums exactly, stays within one minor unit of the exact share and ignores input order", () => {
  const seed = 424242;
  const rng = random(seed);
  for (let run = 0; run < 1000; run += 1) {
    const currencyCode = rng.pick(["USD", "JPY", "KWD", "INR"]);
    const minor = Money.zero(currencyCode).currency.minorUnits;
    const total = Money.fromDecimal(d(rng.decimal(12, minor)), currencyCode);
    const shares = Array.from({ length: 1 + rng.int(7) }, (_, index) => ({ key: `k${index}`, weight: d(rng.decimal(6, 4)).abs() }));
    if (shares.every((share) => share.weight.isZero())) shares[0] = { key: "k0", weight: d("1") };
    const parts = allocate(total, shares);
    const context = `seed ${seed} run ${run}: ${total} over ${shares.map((share) => share.weight).join(",")}`;

    assert.ok(sumMoney(parts.map((part) => part.amount), currencyCode).equals(total), `sum ${context}`);
    const weightSum = shares.reduce((sum, share) => sum.add(share.weight), d("0"));
    for (const [index, part] of parts.entries()) {
      const exact = new Oracle(total.amount.toString()).times(shares[index]!.weight.toString()).dividedBy(weightSum.toString());
      const distance = new Oracle(part.amount.amount.toString()).minus(exact).abs();
      assert.ok(distance.lessThan(new Oracle(10).pow(-minor)), `within one minor unit ${context}`);
    }
    const reversed = allocate(total, [...shares].reverse());
    assert.deepEqual(
      Object.fromEntries(reversed.map((part) => [part.key, part.amount.toString()])),
      Object.fromEntries(parts.map((part) => [part.key, part.amount.toString()])),
      `order independence ${context}`,
    );
  }
});
