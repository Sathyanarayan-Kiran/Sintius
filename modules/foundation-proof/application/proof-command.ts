import { randomUUID } from "node:crypto";
import type { AuditRecorder } from "../../../platform/audit/src/index.ts";
import { buildEventEnvelope } from "../../../platform/event-envelope/src/index.ts";
import { createIdempotentExecutor, type StoredResponse } from "../../../platform/idempotency/src/index.ts";
import { problem } from "../../../platform/problem-model/src/index.ts";
import { currentTenantContext } from "../../../platform/tenant-context/src/index.ts";
import {
  FOUNDATION_PROOF_PERMISSION,
  type FoundationProofAuthorizer,
  type FoundationProofPersistence,
  type FoundationProofRecord,
} from "./ports.ts";

export const FOUNDATION_PROOF_AUDIT_FIELDS = Object.freeze({ ProofRecord: Object.freeze(["label"]) });

export interface RecordFoundationProofInput {
  readonly label: string;
}

export interface FoundationProofCommandMetadata {
  readonly idempotencyKey?: string;
}

export interface FoundationProofResult {
  readonly proofRecordId: string;
  readonly label: string;
  readonly recordedAt: string;
}

function normalizedLabel(value: string, correlationId: string): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (label.length === 0 || label.length > 200) {
    throw problem({
      code: "invalid_trusted_context",
      detail: "Foundation proof label must contain 1 to 200 characters.",
      correlation_id: correlationId,
    });
  }
  return label;
}

function resultFrom(response: StoredResponse, correlationId: string): Readonly<FoundationProofResult> {
  const body = response.body;
  const invalid = () =>
    problem({ code: "invalid_trusted_context", detail: "Stored foundation proof response is invalid.", correlation_id: correlationId });
  if (response.status !== 201 || typeof body !== "object" || body === null || Array.isArray(body)) throw invalid();
  const { proof_record_id: proofRecordId, label, recorded_at: recordedAt } = body as Readonly<Record<string, unknown>>;
  if (typeof proofRecordId !== "string" || typeof label !== "string" || typeof recordedAt !== "string") throw invalid();
  return Object.freeze({ proofRecordId, label, recordedAt });
}

/** Test-only Phase 0 command proving the active-tenant foundation controls in one transaction. */
export function createFoundationProofCommand(dependencies: {
  readonly persistence: FoundationProofPersistence;
  readonly authorizer: FoundationProofAuthorizer;
  readonly audit: AuditRecorder;
  readonly clock: () => Date;
  readonly newProofRecordId?: () => string;
  readonly newEventId?: () => string;
}) {
  const newProofRecordId = dependencies.newProofRecordId ?? (() => `proof_${randomUUID()}`);
  const executeIdempotently = createIdempotentExecutor({ persistence: dependencies.persistence, clock: dependencies.clock });

  return async (
    input: RecordFoundationProofInput,
    metadata: FoundationProofCommandMetadata = {},
  ): Promise<Readonly<FoundationProofResult>> => {
    const context = currentTenantContext();
    const label = normalizedLabel(input.label, context.correlationId);
    const recordedAt = dependencies.clock();
    const proofRecordId = newProofRecordId();
    const record: Readonly<FoundationProofRecord> = Object.freeze({
      tenantId: context.tenantId,
      proofRecordId,
      label,
      actorId: context.actorId,
      correlationId: context.correlationId,
      recordedAt: recordedAt.toISOString(),
    });
    const envelope = buildEventEnvelope(
      {
        eventType: "foundation.proof_recorded.v1",
        sourceContext: "foundation-proof",
        aggregateType: "FoundationProofRecord",
        aggregateId: proofRecordId,
        aggregateVersion: 1,
        occurredAt: recordedAt,
        classification: "INTERNAL_OPERATIONAL",
        data: { proof_record_id: proofRecordId, label },
      },
      { clock: () => recordedAt, ...(dependencies.newEventId === undefined ? {} : { newEventId: dependencies.newEventId }) },
    );

    const executed = await executeIdempotently(
      { scope: "foundation.proof.record", key: metadata.idempotencyKey, payload: { label } },
      () => dependencies.authorizer.assertPermission(FOUNDATION_PROOF_PERMISSION),
      async (unitOfWork) => {
        await unitOfWork.records.insert(record);
        await dependencies.audit.recordForCurrentContext(unitOfWork.audit, {
          action: "foundation.proof_recorded",
          target: { type: "ProofRecord", id: proofRecordId },
          occurredAt: recordedAt,
          after: { label },
        });
        await unitOfWork.outbox.append(envelope);
        return {
          status: 201,
          body: { proof_record_id: proofRecordId, label, recorded_at: record.recordedAt },
        };
      },
    );
    return resultFrom(executed.response, context.correlationId);
  };
}
