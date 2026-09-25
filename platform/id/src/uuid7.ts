import { randomBytes as nodeRandomBytes } from "node:crypto";
import { problem } from "../../problem-model/src/index.ts";

/**
 * UUIDv7 (RFC 9562 §5.7, decision D7 / SPIKE-03): a time-ordered UUID — a 48-bit millisecond Unix
 * timestamp, the version and variant bits, and 74 bits of randomness. Time ordering gives good
 * B-tree insert locality for a primary key (the reason D7 chose it over a purely random UUIDv4),
 * while the random tail keeps it unguessable and collision-safe within a millisecond.
 *
 * This does not claim to serialize concurrent generation within the same process: two calls in the
 * same millisecond are time-*grouped*, not further ordered by call sequence (no monotonic counter).
 * That is enough for the index-locality property D7 wants and keeps the implementation small; a
 * monotonic variant can be added later without changing the wire format if profiling ever shows a
 * need for it.
 */

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Uuid7Options {
  /** Defaults to the system clock; injected so generation is deterministic in tests. */
  readonly clock?: () => Date;
  /** Defaults to `node:crypto`'s CSPRNG; injected so generation is deterministic in tests. */
  readonly randomBytes?: (size: number) => Uint8Array;
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

/** Generates one UUIDv7 as its canonical lower-case, hyphenated string form. */
export function generateUuidV7(options: Uuid7Options = {}): string {
  const clock = options.clock ?? (() => new Date());
  const randomBytes = options.randomBytes ?? ((size: number) => new Uint8Array(nodeRandomBytes(size)));

  const millisecondsSinceEpoch = BigInt(clock().valueOf());
  if (millisecondsSinceEpoch < 0n) {
    throw problem({ code: "invalid_timestamp", detail: "UUIDv7 generation requires a non-negative timestamp." });
  }
  // The 48-bit timestamp field wraps in the year 10889; masking rather than rejecting an
  // out-of-range future clock keeps this a pure, total function.
  const timestamp = millisecondsSinceEpoch & 0xffff_ffff_ffffn;

  const bytes = new Uint8Array(16);
  const random = randomBytes(10);
  if (random.length !== 10) {
    throw problem({ code: "calculation_rejected", detail: "UUIDv7 generation requires exactly 10 random bytes." });
  }

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes.set(random, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10 (RFC 4122/9562)

  const text = Array.from(bytes, hex).join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/** The 48-bit millisecond timestamp a UUIDv7 was generated with, as a `Date`. Throws on any other UUID version. */
export function timestampOfUuidV7(id: string): Date {
  if (!isUuidV7(id)) {
    throw problem({ code: "invalid_decimal", detail: "Not a well-formed UUIDv7 string." });
  }
  const hexTimestamp = id.replaceAll("-", "").slice(0, 12);
  return new Date(Number(BigInt(`0x${hexTimestamp}`)));
}

/** True only for a canonical, lower-case UUIDv7 string (RFC 9562 version 7, RFC 4122 variant). */
export function isUuidV7(id: string): boolean {
  return typeof id === "string" && UUID_FORMAT.test(id);
}
