import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Decimal } from "../src/decimal.ts";
import { Money, allocate } from "../src/money.ts";
import { prorateActualDays } from "../src/proration.ts";

/**
 * US-MSR-099-TEST-STRATEGY (master specification §99, §5 of docs/pre-implementation/24-testing-
 * strategy.md): "for financial calculations use deterministic golden datasets"; "golden outputs
 * are stored as committed fixtures with their expected calculation-trace content hash ... a diff
 * in output for an unchanged input/engine-version combination is always a defect, never expected
 * drift." This is the money-domain instance of that rule: it recomputes every fixture in
 * docs/implementation/golden/money-proration-allocation.json from the real proration and
 * allocation functions, checks the recomputed output against the stored expected value AND against
 * a recomputed content hash (so a silent edit to `expected` alone, without updating its hash, is
 * itself a detected tamper), checks the whole dataset's provenance hash, and proves the engine is
 * deterministic by running every fixture twice and requiring byte-identical output both times.
 */
const path = resolve(import.meta.dirname, "../../../docs/implementation/golden/money-proration-allocation.json");
const dataset = JSON.parse(readFileSync(path, "utf8")) as {
  readonly engineVersion: string;
  readonly datasetHash: string;
  readonly proration: readonly {
    readonly id: string;
    readonly amount: { readonly value: string; readonly currency: string };
    readonly used: { readonly start: string; readonly end: string };
    readonly period: { readonly start: string; readonly end: string };
    readonly expected: { readonly value: string; readonly currency: string };
    readonly contentHash: string;
  }[];
  readonly allocation: readonly {
    readonly id: string;
    readonly total: { readonly value: string; readonly currency: string };
    readonly shares: readonly { readonly key: string; readonly weight: string }[];
    readonly expected: readonly { readonly key: string; readonly value: string; readonly currency: string }[];
    readonly contentHash: string;
  }[];
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function runProration(fixture: (typeof dataset.proration)[number]): string {
  const amount = Money.of(fixture.amount.value, fixture.amount.currency);
  return prorateActualDays(amount, fixture.used, fixture.period).toString();
}

function runAllocation(fixture: (typeof dataset.allocation)[number]): readonly string[] {
  const total = Money.of(fixture.total.value, fixture.total.currency);
  const shares = fixture.shares.map((share) => ({ key: share.key, weight: Decimal.parse(share.weight) }));
  return allocate(total, shares).map((part) => part.amount.toString());
}

test("TC-PLATFORM-MONEY-GOLDEN-01 golden proration and allocation dataset matches stored expectations and content hashes, deterministically", () => {
  assert.ok(dataset.proration.length > 0 && dataset.allocation.length > 0, "the golden dataset must not be empty");

  for (const fixture of dataset.proration) {
    const expectedContentHash = hash({ id: fixture.id, kind: "proration", amount: fixture.amount, used: fixture.used, period: fixture.period, expected: fixture.expected });
    assert.equal(fixture.contentHash, expectedContentHash, `${fixture.id}: the fixture's own content hash no longer matches its recorded expected value — the fixture was tampered with`);
    const first = runProration(fixture);
    const second = runProration(fixture);
    assert.equal(first, second, `${fixture.id}: proration is not deterministic across two runs of the same fixture`);
    assert.equal(first, `${fixture.expected.value} ${fixture.expected.currency}`, `${fixture.id}: golden proration output drifted for an unchanged input/engine-version combination`);
  }

  for (const fixture of dataset.allocation) {
    const expectedContentHash = hash({ id: fixture.id, kind: "allocation", total: fixture.total, shares: fixture.shares, expected: fixture.expected });
    assert.equal(fixture.contentHash, expectedContentHash, `${fixture.id}: the fixture's own content hash no longer matches its recorded expected value — the fixture was tampered with`);
    const first = runAllocation(fixture);
    const second = runAllocation(fixture);
    assert.deepEqual(first, second, `${fixture.id}: allocation is not deterministic across two runs of the same fixture`);
    assert.deepEqual(first, fixture.expected.map((part) => `${part.value} ${part.currency}`), `${fixture.id}: golden allocation output drifted for an unchanged input/engine-version combination`);
  }

  const provenanceHash = hash({
    proration: dataset.proration.map((fixture) => ({ id: fixture.id, contentHash: fixture.contentHash })),
    allocation: dataset.allocation.map((fixture) => ({ id: fixture.id, contentHash: fixture.contentHash })),
  });
  assert.equal(dataset.datasetHash, provenanceHash, "the dataset's provenance hash no longer matches its fixtures — the dataset file was tampered with or corrupted");
});
