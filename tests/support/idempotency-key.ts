/** Deterministic RFC 9562 version-4-shaped UUIDs for tests; production clients generate real ones. */
export function testIdempotencyKey(sequence: number | string): string {
  const numeric = typeof sequence === "number" ? sequence : [...sequence].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 0xffffffffffff, 7);
  return `00000000-0000-4000-8000-${numeric.toString(16).padStart(12, "0")}`;
}
