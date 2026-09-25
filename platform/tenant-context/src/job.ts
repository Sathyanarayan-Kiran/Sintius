import { isValidTraceId, problem } from "../../problem-model/src/index.ts";
import {
  activeTenantContext,
  resolveTenantContext,
  runWithTenantContext,
  type AuthenticatedPrincipal,
  type TenantId,
  type TenantOperationalState,
} from "./context.ts";

const JOB_NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export interface TenantJobRun {
  /** Stable job name, such as `idempotency.purge`. */
  readonly jobName: string;
  /** The scheduler's identifier for this run; the job's correlation ID is derived from it. */
  readonly runId: string;
  /** A verified workload credential bound to exactly this tenant. */
  readonly principal: Readonly<AuthenticatedPrincipal>;
  readonly tenantId: TenantId;
  /** Read by the scheduler from the tenant record, as the ingress does for requests. */
  readonly tenantState: TenantOperationalState;
  readonly causationId?: string;
}

/**
 * Establishes the trusted context for one tenant's share of a scheduled or background job, the
 * way the HTTP ingress does for a request. A job starts at the root (never inside a request or
 * another tenant's job), runs as a workload principal whose credential is bound to that one
 * tenant, and gets a correlation ID derived from its run, so its audit rows, events and database
 * transactions carry the same tenant binding as any command. A job that spans tenants calls this
 * once per tenant, each with that tenant's credential.
 */
export function runTenantJob<T>(run: TenantJobRun, operation: () => T): T {
  if (activeTenantContext() !== undefined) {
    throw problem({
      code: "tenant_context_mismatch",
      detail: "A tenant job must start outside any existing tenant context.",
    });
  }
  if (!JOB_NAME_PATTERN.test(run.jobName)) {
    throw problem({ code: "invalid_trusted_context", detail: "jobName must be a lowercase job identifier." });
  }
  const correlationId = `job:${run.jobName}:${run.runId}`;
  if (!isValidTraceId(correlationId)) {
    throw problem({ code: "invalid_trusted_context", detail: "runId must be a valid trace identifier." });
  }
  if (run.principal.kind !== "workload") {
    throw problem({
      code: "workload_scope_denied",
      detail: "Tenant jobs run as workload principals.",
      correlation_id: correlationId,
    });
  }
  if (run.principal.tenantMemberships.length !== 1) {
    throw problem({
      code: "workload_scope_denied",
      detail: "A job credential must be bound to exactly one tenant.",
      correlation_id: correlationId,
    });
  }
  // Membership, principal validity, expiry and tenant state are enforced by the shared resolver.
  const context = resolveTenantContext({
    principal: run.principal,
    selectedTenantId: run.tenantId,
    tenantState: run.tenantState,
    correlationId,
    ...(run.causationId === undefined ? {} : { causationId: run.causationId }),
  });
  return runWithTenantContext(context, operation);
}
