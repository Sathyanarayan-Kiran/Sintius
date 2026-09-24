import { problem } from "../../problem-model/src/index.ts";

export interface Currency {
  readonly code: string;
  /** ISO 4217 minor-unit exponent: USD 2, JPY 0, KWD 3. */
  readonly minorUnits: number;
}

/**
 * Version-controlled currency metadata (pricing spec section 13: minor units are data, not an
 * assumption fixed for all time). A change to an existing entry needs a new version string and a
 * migration story for stored amounts. MVP launch scope is USD; the others back the SPIKE-02
 * golden cases for 0-, 2- and 3-decimal currencies.
 */
export const CURRENCY_TABLE_VERSION = "iso4217-2026-09";

const CURRENCIES: ReadonlyMap<string, Readonly<Currency>> = new Map(
  (
    [
      ["USD", 2],
      ["EUR", 2],
      ["GBP", 2],
      ["CAD", 2],
      ["AUD", 2],
      ["INR", 2],
      ["JPY", 0],
      ["KRW", 0],
      ["KWD", 3],
      ["BHD", 3],
      ["OMR", 3],
      ["JOD", 3],
      ["TND", 3],
    ] as const
  ).map(([code, minorUnits]) => [code, Object.freeze({ code, minorUnits })]),
);

export function currency(code: string): Readonly<Currency> {
  const found = typeof code === "string" ? CURRENCIES.get(code) : undefined;
  if (found === undefined) throw problem({ code: "unsupported_currency", detail: "The currency is not supported." });
  return found;
}

export function supportedCurrencies(): readonly string[] {
  return Object.freeze([...CURRENCIES.keys()]);
}
