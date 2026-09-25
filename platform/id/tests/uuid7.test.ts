import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../problem-model/src/index.ts";
import { generateUuidV7, isUuidV7, timestampOfUuidV7 } from "../src/uuid7.ts";

/**
 * Decision D7 (SPIKE-03): UUIDv7 primary keys. The property under test throughout is time
 * ordering — the whole reason D7 chose UUIDv7 over UUIDv4 is B-tree insert locality, so an ID
 * generated later must sort after one generated earlier.
 */

const fixedRandom = (byte: number) => (size: number) => new Uint8Array(size).fill(byte);
const time = (isoString: string) => () => new Date(isoString);

test("D7 generates a well-formed UUIDv7: version 7, variant 10, canonical lower-case format", () => {
  for (let i = 0; i < 50; i += 1) {
    const id = generateUuidV7();
    assert.ok(isUuidV7(id), `${id} is not recognized as a well-formed UUIDv7`);
    assert.equal(id, id.toLowerCase(), "UUIDv7 text form is canonical lower-case");
    assert.equal(id.length, 36);
    assert.equal(id[14], "7", "the version nibble must be 7");
    assert.ok("89ab".includes(id[19]!), "the variant nibble must be 8, 9, a or b");
  }
});

test("D7 encodes the millisecond timestamp exactly and round-trips through timestampOfUuidV7", () => {
  const instant = "2027-03-14T09:26:53.589Z";
  const id = generateUuidV7({ clock: time(instant), randomBytes: fixedRandom(0xab) });
  assert.equal(timestampOfUuidV7(id).toISOString(), instant);
});

test("D7 two IDs generated in the same millisecond differ only in their random bits", () => {
  const clock = time("2027-01-01T00:00:00.000Z");
  const a = generateUuidV7({ clock, randomBytes: () => new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]) });
  const b = generateUuidV7({ clock, randomBytes: () => new Uint8Array([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a]) });
  assert.notEqual(a, b);
  assert.equal(a.slice(0, 13), b.slice(0, 13), "the timestamp and version fields are identical within the same millisecond");
  assert.equal(timestampOfUuidV7(a).toISOString(), timestampOfUuidV7(b).toISOString());
});

test("D7 IDs generated with an increasing clock sort in generation order — the property the whole decision is for", () => {
  const instants = ["2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.001Z", "2025-06-15T12:30:45.999Z", "2030-12-31T23:59:59.999Z"];
  const ids = instants.map((instant) => generateUuidV7({ clock: time(instant) }));
  const lexicallySorted = [...ids].sort();
  assert.deepEqual(lexicallySorted, ids, "lexical (== byte, == UUID-text) order must match generation order");
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(timestampOfUuidV7(ids[i]!).valueOf() > timestampOfUuidV7(ids[i - 1]!).valueOf());
  }
});

test("D7 generation is unique across many real (non-injected) calls", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5_000; i += 1) {
    const id = generateUuidV7();
    assert.ok(!seen.has(id), `duplicate UUIDv7 generated: ${id}`);
    seen.add(id);
  }
});

const code = (expected: string) => (error: unknown) => error instanceof PlatformProblem && error.problem.code === expected;

test("D7 rejects a negative timestamp and a malformed random-byte source", () => {
  assert.throws(() => generateUuidV7({ clock: time("1969-12-31T23:59:59.999Z") }), code("invalid_timestamp"));
  assert.throws(() => generateUuidV7({ randomBytes: () => new Uint8Array(4) }), code("calculation_rejected"), "exactly 10 random bytes are required");
});

test("D7 isUuidV7 rejects non-v7 UUIDs and malformed strings", () => {
  assert.equal(isUuidV7("f47ac10b-58cc-4372-a567-0e02b2c3d479"), false, "a UUIDv4 must be rejected");
  assert.equal(isUuidV7("not-a-uuid"), false);
  assert.equal(isUuidV7(generateUuidV7().toUpperCase()), false, "upper-case is not the canonical form");
  assert.throws(() => timestampOfUuidV7("not-a-uuid"), code("invalid_decimal"));
});

test("D7 a far-future clock wraps the 48-bit timestamp field rather than throwing", () => {
  // 2^48 ms after the epoch is year 10889; masking (not rejecting) keeps generation a total
  // function — an operational clock error should not itself crash ID generation.
  const farFuture = new Date(2 ** 48);
  const id = generateUuidV7({ clock: () => farFuture });
  assert.ok(isUuidV7(id));
  assert.equal(timestampOfUuidV7(id).valueOf(), 0, "the timestamp field wrapped to zero");
});
