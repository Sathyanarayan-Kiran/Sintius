import { problem } from "../../problem-model/src/index.ts";
import {
  assertIssuedPlatformContext,
  assertNoTenantIdentity,
  currentTenantContext,
  type PlatformCommandContext,
  type TenantId,
} from "../../tenant-context/src/index.ts";
import { canonicalJson, canonicalRequestHash, hashesEqual, type JsonValue } from "./canonical.ts";
import type { IdempotencyPersistence, IdempotencyStore, StoredResponse } from "./ports.ts";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;
const DEFAULT_RETENTION_SECONDS = 7 * 24 * 3600;

export interface IdempotentRequest {
  /** Endpoint family or command name; the same key on two scopes never collides. */
  readonly scope: string;
  /** Raw `Idempotency-Key` header value, or undefined when the client omitted it. */
  readonly key: string | undefined;
  /** Normalized request content (body and identifying path parameters), excluding volatile headers. */
  readonly payload: JsonValue;
}

export interface IdempotentResult {
  readonly response: StoredResponse;
  readonly replayed: boolean;
}

interface TrustedExecutionScope {
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId?: string;
}

interface ExecutorDependencies<U extends { readonly idempotency: IdempotencyStore }> {
  readonly persistence: IdempotencyPersistence<U>;
  readonly clock: () => Date;
  readonly retentionSeconds?: number;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Transaction-aware idempotent execution. The claim, the protected command's writes and the stored
 * response all commit in one transaction, so a failed attempt leaves no record and can be retried,
 * and a committed attempt is replayed verbatim without repeating any effect.
 */
function createScopedExecutor<U extends { readonly idempotency: IdempotencyStore }>(dependencies: ExecutorDependencies<U>) {
  const retentionSeconds = dependencies.retentionSeconds ?? DEFAULT_RETENTION_SECONDS;

  return async function executeForScope(
    context: TrustedExecutionScope,
    request: IdempotentRequest,
    /** Runs before any lookup, so a replay can never bypass current authorization. */
    authorize: () => Promise<void>,
    work: (unitOfWork: U) => Promise<StoredResponse>,
  ): Promise<IdempotentResult> {
    const correlation_id = context.correlationId;

    if (!SCOPE_PATTERN.test(request.scope)) {
      throw problem({ code: "invalid_trusted_context", detail: "Idempotency scope is not a valid command name.", correlation_id });
    }
    if (request.key === undefined || request.key.length === 0) {
      throw problem({ code: "idempotency_key_required", detail: "This operation requires an Idempotency-Key header.", correlation_id });
    }
    if (!KEY_PATTERN.test(request.key)) {
      throw problem({ code: "idempotency_key_invalid", detail: "Idempotency-Key must be 16 to 128 URL-safe characters.", correlation_id });
    }
    assertNoTenantIdentity(request.payload, correlation_id);
    const key = request.key;
    const requestHash = canonicalRequestHash(request.scope, request.payload);

    await authorize();

    const now = dependencies.clock();
    const expiresAt = new Date(now.valueOf() + retentionSeconds * 1000).toISOString();
    const transactionScope = {
      tenantId: context.tenantId,
      correlationId: correlation_id,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
    };

    return dependencies.persistence.runInTransaction(transactionScope, async (unitOfWork): Promise<IdempotentResult> => {
      const claim = await unitOfWork.idempotency.claim({
        tenantId: context.tenantId,
        scope: request.scope,
        key,
        requestHash,
        now: now.toISOString(),
        expiresAt,
      });

      if (claim.kind === "in_progress") {
        throw problem({
          code: "request_in_progress",
          detail: `A request with this key is still being processed. Retry after ${claim.retryAfterSeconds} seconds.`,
          correlation_id,
          retryAfterSeconds: claim.retryAfterSeconds,
        });
      }
      if (claim.kind === "existing") {
        const { record } = claim;
        if (record.tenantId !== context.tenantId) {
          throw problem({ code: "tenant_context_mismatch", detail: "The idempotency store returned a record from another tenant.", correlation_id });
        }
        if (!hashesEqual(record.requestHash, requestHash)) {
          throw problem({
            code: "idempotency_key_reused_with_different_payload",
            detail: "This Idempotency-Key was already used with a different request.",
            correlation_id,
          });
        }
        if (record.status !== "completed" || record.response === undefined) {
          throw problem({ code: "request_in_progress", detail: "A request with this key is still being processed.", correlation_id, retryAfterSeconds: 1 });
        }
        return { response: deepFreeze(structuredClone(record.response)), replayed: true };
      }

      const response = await work(unitOfWork);
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
        throw problem({ code: "invalid_trusted_context", detail: "Stored response status must be an HTTP status code.", correlation_id });
      }
      canonicalJson(response.body);
      const stored: StoredResponse = deepFreeze(structuredClone(response));
      await unitOfWork.idempotency.complete({ tenantId: context.tenantId, scope: request.scope, key, response: stored });
      return { response: stored, replayed: false };
    });
  };
}

/** Idempotent execution for an established tenant context. */
export function createIdempotentExecutor<U extends { readonly idempotency: IdempotencyStore }>(dependencies: ExecutorDependencies<U>) {
  const execute = createScopedExecutor(dependencies);
  return async (
    request: IdempotentRequest,
    authorize: () => Promise<void>,
    work: (unitOfWork: U) => Promise<StoredResponse>,
  ): Promise<IdempotentResult> => execute(currentTenantContext(), request, authorize, work);
}

/**
 * Idempotent execution for an issued platform command targeting a tenant, including provisioning
 * before that tenant exists. The target is the transaction/RLS scope and is never taken from the
 * hashed payload, preventing an untrusted second tenant identity from entering the command body.
 */
export function createPlatformIdempotentExecutor<U extends { readonly idempotency: IdempotencyStore }>(
  dependencies: ExecutorDependencies<U>,
) {
  const execute = createScopedExecutor(dependencies);
  return async (
    context: Readonly<PlatformCommandContext>,
    targetTenantId: TenantId,
    request: IdempotentRequest,
    authorize: () => Promise<void>,
    work: (unitOfWork: U) => Promise<StoredResponse>,
  ): Promise<IdempotentResult> => {
    assertIssuedPlatformContext(context);
    return execute(
      {
        tenantId: targetTenantId,
        correlationId: context.correlationId,
        ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      },
      request,
      authorize,
      work,
    );
  };
}
