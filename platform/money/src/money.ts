import { problem } from "../../problem-model/src/index.ts";
import { currency, type Currency } from "./currency.ts";
import { Decimal, type RoundingMode } from "./decimal.ts";

/** Default commercial rounding (decision D6). */
export const DEFAULT_ROUNDING: RoundingMode = "HALF_UP";

const CONSTRUCTION = Symbol("Money construction");

function mismatch(): never {
  throw problem({ code: "currency_mismatch", detail: "Amounts in different currencies cannot be combined." });
}

/**
 * A settled monetary amount: always exactly at its currency's minor unit ("10.00 USD", "1000 JPY",
 * "1.250 KWD"). Intermediate calculations use `Decimal`; they become `Money` only through an
 * explicit rounding step, so rounding happens once and visibly (pricing spec section 13).
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: Readonly<Currency>;

  constructor(token: symbol, amount: Decimal, unit: Readonly<Currency>) {
    if (token !== CONSTRUCTION) throw new TypeError("Use Money.of, Money.fromDecimal or Money.zero.");
    this.amount = amount;
    this.currency = unit;
    Object.freeze(this);
  }

  /** Exact: "12.5" USD becomes 12.50; "12.345" USD rejects instead of rounding silently. */
  static of(amount: string | Decimal, currencyCode: string): Money {
    const unit = currency(currencyCode);
    const value = typeof amount === "string" ? Decimal.parse(amount) : amount;
    if (value.scale > unit.minorUnits) {
      throw problem({
        code: "invalid_decimal",
        detail: `${unit.code} amounts allow at most ${unit.minorUnits} fraction digits; round explicitly first.`,
      });
    }
    return new Money(CONSTRUCTION, value.rescale(unit.minorUnits), unit);
  }

  /** The single, explicit rounding step from an intermediate value to a settled amount. */
  static fromDecimal(value: Decimal, currencyCode: string, mode: RoundingMode = DEFAULT_ROUNDING): Money {
    const unit = currency(currencyCode);
    return new Money(CONSTRUCTION, value.round(unit.minorUnits, mode), unit);
  }

  static fromMinorUnits(units: bigint, currencyCode: string): Money {
    const unit = currency(currencyCode);
    return new Money(CONSTRUCTION, Decimal.fromUnits(units, unit.minorUnits), unit);
  }

  static zero(currencyCode: string): Money {
    return Money.fromMinorUnits(0n, currencyCode);
  }

  static isMoney(value: unknown): value is Money {
    return value instanceof Money;
  }

  get minorUnits(): bigint {
    return this.amount.units;
  }

  #same(other: Money): void {
    if (other.currency.code !== this.currency.code) mismatch();
  }

  add(other: Money): Money {
    this.#same(other);
    return new Money(CONSTRUCTION, this.amount.add(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.#same(other);
    return new Money(CONSTRUCTION, this.amount.subtract(other.amount), this.currency);
  }

  /** Price × quantity (or × rate), rounded once to the minor unit. */
  multiply(factor: Decimal, mode: RoundingMode = DEFAULT_ROUNDING): Money {
    return new Money(CONSTRUCTION, this.amount.multiply(factor, { scale: this.currency.minorUnits, mode }), this.currency);
  }

  negate(): Money {
    return new Money(CONSTRUCTION, this.amount.negate(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  compare(other: Money): -1 | 0 | 1 {
    this.#same(other);
    return this.amount.compare(other.amount);
  }

  equals(other: Money): boolean {
    return other.currency.code === this.currency.code && this.amount.equals(other.amount);
  }

  toString(): string {
    return `${this.amount.toString()} ${this.currency.code}`;
  }

  /** API and event representation: amount as a decimal string plus ISO 4217 code. */
  toJSON(): { readonly amount: string; readonly currency: string } {
    return { amount: this.amount.toString(), currency: this.currency.code };
  }

  [Symbol.toPrimitive](hint: string): string {
    if (hint === "number") throw new TypeError("Money cannot be converted to a JavaScript number.");
    return this.toString();
  }
}

/** Sums amounts of one currency; an empty list sums to zero in `currencyCode`. */
export function sumMoney(amounts: readonly Money[], currencyCode: string): Money {
  return amounts.reduce((total, amount) => total.add(amount), Money.zero(currencyCode));
}

export interface AllocationShare {
  /** Stable identifier; also the tie-break order when remainders are equal. */
  readonly key: string;
  /** Non-negative relative weight. */
  readonly weight: Decimal;
}

/**
 * Splits `total` across shares so the parts sum exactly to the total (pricing spec section 13.7).
 * Each share first receives the floor of its exact proportional amount in minor units; the
 * leftover units go one each to the largest remainders, ties broken by ascending `key`. The result
 * is in input order and does not depend on it.
 */
export function allocate(total: Money, shares: readonly AllocationShare[]): readonly { readonly key: string; readonly amount: Money }[] {
  if (shares.length === 0) throw problem({ code: "calculation_rejected", detail: "Allocation needs at least one share." });
  const keys = new Set(shares.map((share) => share.key));
  if (keys.size !== shares.length) throw problem({ code: "calculation_rejected", detail: "Allocation keys must be unique." });
  if (shares.some((share) => share.weight.isNegative())) throw problem({ code: "calculation_rejected", detail: "Allocation weights cannot be negative." });

  const scale = Math.max(...shares.map((share) => share.weight.scale));
  const weights = shares.map((share) => share.weight.rescale(scale).units);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) throw problem({ code: "calculation_rejected", detail: "Allocation weights must not all be zero." });

  const sign = total.minorUnits < 0n ? -1n : 1n;
  const units = total.minorUnits * sign;
  const base = weights.map((weight) => (units * weight) / weightSum);
  const remainders = weights.map((weight) => (units * weight) % weightSum);
  let leftover = units - base.reduce((sum, value) => sum + value, 0n);

  const order = shares
    .map((share, index) => ({ key: share.key, index, remainder: remainders[index]! }))
    .sort((left, right) => (left.remainder === right.remainder ? (left.key < right.key ? -1 : 1) : left.remainder > right.remainder ? -1 : 1));
  for (const entry of order) {
    if (leftover === 0n) break;
    base[entry.index]! += 1n;
    leftover -= 1n;
  }

  return Object.freeze(
    shares.map((share, index) => Object.freeze({ key: share.key, amount: Money.fromMinorUnits(base[index]! * sign, total.currency.code) })),
  );
}
