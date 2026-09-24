import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../idempotency/src/index.ts";
import type { TenantId } from "../../tenant-context/src/index.ts";

export type AuditSnapshot = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditActor {
  readonly id: string;
  readonly kind: "interactive" | "workload";
}

/**
 * Immutable, tenant-scoped evidence of who did what. It is an internal fact and is never a
 * substitute for the domain event. `before` and `after` hold only allow-listed, redacted fields.
 */
export interface AuditEvent {
  readonly auditEventId: string;
  readonly tenantId: TenantId;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly reason?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly approvalId?: string;
  readonly before?: AuditSnapshot;
  readonly after?: AuditSnapshot;
  /** SHA-256 over the canonical form of every other field; detects later alteration. */
  readonly evidenceHash: string;
}

export type UnsealedAuditEvent = Omit<AuditEvent, "evidenceHash">;

export function computeEvidenceHash(event: Readonly<UnsealedAuditEvent>): string {
  return createHash("sha256").update(canonicalJson(event)).digest("hex");
}

/** True only when the stored hash matches the event's current content. */
export function verifyAuditEvent(event: Readonly<AuditEvent>): boolean {
  const { evidenceHash, ...rest } = event;
  const expected = Buffer.from(computeEvidenceHash(rest), "utf8");
  const actual = Buffer.from(String(evidenceHash), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
