import { problem } from "../../problem-model/src/index.ts";
import { Decimal, type RoundingMode } from "./decimal.ts";
import { DEFAULT_ROUNDING, Money } from "./money.ts";

const CIVIL_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DAY_MILLISECONDS = 86_400_000;

/** Parses a civil date (`YYYY-MM-DD`, no time zone) to a day number; rejects impossible dates. */
function dayNumber(date: string): number {
  const match = typeof date === "string" ? CIVIL_DATE.exec(date) : null;
  const [year, month, day] = match === null ? [Number.NaN, Number.NaN, Number.NaN] : [Number(match[1]), Number(match[2]), Number(match[3])];
  const epoch = Date.UTC(year, month - 1, day);
  const check = new Date(epoch);
  if (Number.isNaN(epoch) || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw problem({ code: "invalid_timestamp", detail: "Dates must be valid calendar dates in YYYY-MM-DD form." });
  }
  // Date.UTC of a civil date is an exact multiple of one day, so this division is exact.
  return epoch / DAY_MILLISECONDS;
}

/** Whole days in the half-open interval [start, end). */
export function daysBetween(start: string, end: string): number {
  const days = dayNumber(end) - dayNumber(start);
  if (days < 0) throw problem({ code: "calculation_rejected", detail: "A period cannot end before it starts." });
  return days;
}

/**
 * ACTUAL_DAYS proration (decision D6): `amount × used days ÷ days in period`, computed exactly and
 * rounded once to the currency minor unit. Periods are half-open [start, end) civil-date intervals,
 * so a calendar month has 28, 29, 30 or 31 days.
 */
export function prorateActualDays(
  amount: Money,
  used: { readonly start: string; readonly end: string },
  period: { readonly start: string; readonly end: string },
  mode: RoundingMode = DEFAULT_ROUNDING,
): Money {
  const periodDays = daysBetween(period.start, period.end);
  const usedDays = daysBetween(used.start, used.end);
  if (periodDays === 0) throw problem({ code: "calculation_rejected", detail: "A proration period must contain at least one day." });
  if (dayNumber(used.start) < dayNumber(period.start) || dayNumber(used.end) > dayNumber(period.end)) {
    throw problem({ code: "calculation_rejected", detail: "The prorated interval must lie within the period." });
  }
  const exact = amount.amount.multiply(Decimal.fromInteger(usedDays));
  return Money.of(exact.divide(Decimal.fromInteger(periodDays), { scale: amount.currency.minorUnits, mode }), amount.currency.code);
}
