import { problem } from "../../problem-model/src/index.ts";

/**
 * Rounding modes (docs/pre-implementation/12-pricing-engine-specification.md section 13).
 * HALF_UP rounds a tie away from zero and is the default commercial mode (decision D6).
 * DOWN truncates toward zero; UP rounds any remainder away from zero.
 */
export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "DOWN" | "UP";

export const ROUNDING_MODES: readonly RoundingMode[] = Object.freeze(["HALF_UP", "HALF_EVEN", "DOWN", "UP"]);

/** Total significant digits, matching PostgreSQL `numeric(38, s)`. */
export const MAX_PRECISION = 38;
/** Rates and intermediates use at most `numeric(38,18)`. */
export const MAX_SCALE = 18;

const DECIMAL_PATTERN = /^(-)?(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const POWERS: bigint[] = Array.from({ length: MAX_SCALE * 2 + MAX_PRECISION + 1 }, (_, index) => 10n ** BigInt(index));
const CONSTRUCTION = Symbol("Decimal construction");

function pow10(exponent: number): bigint {
  return POWERS[exponent] ?? 10n ** BigInt(exponent);
}

function reject(detail: string): never {
  throw problem({ code: "calculation_rejected", detail });
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) reject(`Scale must be an integer from 0 to ${MAX_SCALE}.`);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function digitCount(value: bigint): number {
  return value === 0n ? 1 : abs(value).toString().length;
}

/** Divides with the requested rounding. `divisor` must be non-zero. */
function roundedQuotient(dividend: bigint, divisor: bigint, mode: RoundingMode): bigint {
  const negative = dividend < 0n !== divisor < 0n;
  const numerator = abs(dividend);
  const denominator = abs(divisor);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n) {
    const twice = remainder * 2n;
    const roundAway =
      mode === "UP" ||
      (mode === "HALF_UP" && twice >= denominator) ||
      (mode === "HALF_EVEN" && (twice > denominator || (twice === denominator && quotient % 2n === 1n)));
    if (roundAway) quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

function assertMode(mode: RoundingMode): void {
  if (!ROUNDING_MODES.includes(mode)) reject("Unknown rounding mode.");
}

/**
 * Exact fixed-point decimal: `units × 10^-scale`, with at most 38 significant digits and scale 18.
 * Every operation is exact or takes an explicit scale and rounding mode; nothing is coerced, and
 * overflow, excess scale and division by zero reject with `calculation_rejected`. The scale is
 * part of the value's representation ("1.50" stays "1.50") but not of its numeric equality.
 */
export class Decimal {
  readonly #units: bigint;
  readonly #scale: number;

  constructor(token: symbol, units: bigint, scale: number) {
    if (token !== CONSTRUCTION) throw new TypeError("Use Decimal.parse or Decimal.fromUnits.");
    if (digitCount(units) > MAX_PRECISION) reject(`The result exceeds ${MAX_PRECISION} significant digits.`);
    this.#units = units;
    this.#scale = scale;
    Object.freeze(this);
  }

  /** Strict canonical text: optional minus, no leading zeros, no exponent, no plus sign, no spaces. */
  static parse(text: string): Decimal {
    const match = typeof text === "string" ? DECIMAL_PATTERN.exec(text) : null;
    if (match === null) {
      throw problem({ code: "invalid_decimal", detail: "Decimal values must be plain strings such as \"12.50\" or \"-0.125\"." });
    }
    const fraction = match[3] ?? "";
    if (fraction.length > MAX_SCALE) throw problem({ code: "invalid_decimal", detail: `Decimal values allow at most ${MAX_SCALE} fraction digits.` });
    const digits = `${match[2]}${fraction}`.replace(/^0+(?=[0-9])/, "");
    if (digits.length > MAX_PRECISION) throw problem({ code: "invalid_decimal", detail: `Decimal values allow at most ${MAX_PRECISION} significant digits.` });
    const units = BigInt(digits);
    return new Decimal(CONSTRUCTION, match[1] === "-" ? -units : units, fraction.length);
  }

  static fromUnits(units: bigint, scale: number): Decimal {
    if (typeof units !== "bigint") reject("Decimal units must be a bigint.");
    assertScale(scale);
    return new Decimal(CONSTRUCTION, units, scale);
  }

  /** Whole numbers only; a fractional `number` is refused because it may already be inexact. */
  static fromInteger(value: number | bigint): Decimal {
    if (typeof value === "number" && !Number.isSafeInteger(value)) reject("Only safe integers can be converted from number.");
    return new Decimal(CONSTRUCTION, BigInt(value), 0);
  }

  static isDecimal(value: unknown): value is Decimal {
    return value instanceof Decimal;
  }

  get units(): bigint {
    return this.#units;
  }

  get scale(): number {
    return this.#scale;
  }

  /** Units at a larger or equal scale, exactly. */
  #unitsAt(scale: number): bigint {
    return this.#units * pow10(scale - this.#scale);
  }

  add(other: Decimal): Decimal {
    const scale = Math.max(this.#scale, other.#scale);
    return new Decimal(CONSTRUCTION, this.#unitsAt(scale) + other.#unitsAt(scale), scale);
  }

  subtract(other: Decimal): Decimal {
    const scale = Math.max(this.#scale, other.#scale);
    return new Decimal(CONSTRUCTION, this.#unitsAt(scale) - other.#unitsAt(scale), scale);
  }

  /**
   * Exact product when its scale fits (sum of scales ≤ 18). Otherwise, or when the caller wants a
   * specific output scale, `rounding` states the scale and mode explicitly.
   */
  multiply(other: Decimal, rounding?: { readonly scale: number; readonly mode: RoundingMode }): Decimal {
    const exactScale = this.#scale + other.#scale;
    const product = this.#units * other.#units;
    if (rounding === undefined) {
      if (exactScale > MAX_SCALE) reject(`The exact product has scale ${exactScale}; state an output scale and rounding mode.`);
      return new Decimal(CONSTRUCTION, product, exactScale);
    }
    assertScale(rounding.scale);
    assertMode(rounding.mode);
    if (rounding.scale >= exactScale) return new Decimal(CONSTRUCTION, product * pow10(rounding.scale - exactScale), rounding.scale);
    return new Decimal(CONSTRUCTION, roundedQuotient(product, pow10(exactScale - rounding.scale), rounding.mode), rounding.scale);
  }

  /** Division always states its output scale and rounding mode. */
  divide(divisor: Decimal, rounding: { readonly scale: number; readonly mode: RoundingMode }): Decimal {
    assertScale(rounding.scale);
    assertMode(rounding.mode);
    if (divisor.#units === 0n) reject("Division by zero.");
    // (a / 10^as) / (b / 10^bs) scaled by 10^s  =  a × 10^(bs + s) / (b × 10^as)
    const dividend = this.#units * pow10(divisor.#scale + rounding.scale);
    const denominator = divisor.#units * pow10(this.#scale);
    return new Decimal(CONSTRUCTION, roundedQuotient(dividend, denominator, rounding.mode), rounding.scale);
  }

  /** To a smaller scale with rounding, or a larger scale exactly. */
  round(scale: number, mode: RoundingMode): Decimal {
    assertScale(scale);
    assertMode(mode);
    if (scale >= this.#scale) return new Decimal(CONSTRUCTION, this.#unitsAt(scale), scale);
    return new Decimal(CONSTRUCTION, roundedQuotient(this.#units, pow10(this.#scale - scale), mode), scale);
  }

  /** Changes the scale only when no digit is lost; otherwise rejects. */
  rescale(scale: number): Decimal {
    assertScale(scale);
    if (scale >= this.#scale) return new Decimal(CONSTRUCTION, this.#unitsAt(scale), scale);
    const divisor = pow10(this.#scale - scale);
    if (this.#units % divisor !== 0n) reject(`The value ${this.toString()} cannot be represented at scale ${scale} without rounding.`);
    return new Decimal(CONSTRUCTION, this.#units / divisor, scale);
  }

  negate(): Decimal {
    return new Decimal(CONSTRUCTION, -this.#units, this.#scale);
  }

  abs(): Decimal {
    return this.#units < 0n ? this.negate() : this;
  }

  /** -1, 0 or 1. */
  sign(): -1 | 0 | 1 {
    return this.#units === 0n ? 0 : this.#units < 0n ? -1 : 1;
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  isNegative(): boolean {
    return this.#units < 0n;
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.#scale, other.#scale);
    const left = this.#unitsAt(scale);
    const right = other.#unitsAt(scale);
    return left === right ? 0 : left < right ? -1 : 1;
  }

  /** Numeric equality: "1.5" equals "1.50". */
  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  /** Canonical text at this value's scale; zero is never signed. */
  toString(): string {
    const digits = abs(this.#units).toString().padStart(this.#scale + 1, "0");
    const whole = digits.slice(0, digits.length - this.#scale);
    const fraction = this.#scale === 0 ? "" : `.${digits.slice(digits.length - this.#scale)}`;
    return `${this.#units < 0n ? "-" : ""}${whole}${fraction}`;
  }

  /** Decimals cross JSON and PostgreSQL boundaries as strings, never as JSON numbers. */
  toJSON(): string {
    return this.toString();
  }

  /** Refuses implicit numeric conversion (`+decimal`, `decimal * 2`), which would lose exactness. */
  [Symbol.toPrimitive](hint: string): string {
    if (hint === "number") throw new TypeError("Decimal cannot be converted to a JavaScript number.");
    return this.toString();
  }
}
