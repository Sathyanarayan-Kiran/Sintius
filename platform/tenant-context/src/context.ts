import { AsyncLocalStorage } from "node:async_hooks";
import { problem } from "../../problem-model/src/index.ts";

declare const tenantIdBrand: unique symbol;
declare const actorIdBrand: unique symbol;

export type TenantId = string & { readonly [tenantIdBrand]: true };
export type ActorId = string & { readonly [actorIdBrand]: true };
export type TenantOperationalState = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "CLOSED";

export interface AuthenticatedPrincipal {
  readonly actorId: ActorId;
  readonly kind: "interactive" | "workload";
  readonly tenantMemberships: readonly TenantId[];
  readonly assurance: "single-factor" | "mfa" | "workload";
}

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly principalKind: AuthenticatedPrincipal["kind"];
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface ResolveTenantContextInput {
  readonly principal: AuthenticatedPrincipal;
  readonly selectedTenantId: TenantId;
  readonly tenantState: TenantOperationalState;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly bodyTenantId?: string;
}

const storage = new AsyncLocalStorage<Readonly<TenantContext>>();

/**
 * Branded types are erased at runtime, so a context object literal could be forged. Only contexts
 * minted by this module (the resolver or a derivation of an existing one) may be activated.
 */
const issuedContexts = new WeakSet<object>();

function issue(context: TenantContext): Readonly<TenantContext> {
  const frozen = Object.freeze(context);
  issuedContexts.add(frozen);
  return frozen;
}

function requireNonBlank(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw problem({
      title: "Invalid trusted context",
      status: 400,
      code: "invalid_trusted_context",
      detail: `${field} must not be blank.`,
    });
  }
  return value;
}

export function tenantId(value: string): TenantId {
  return requireNonBlank(value, "tenantId") as TenantId;
}

export function actorId(value: string): ActorId {
  return requireNonBlank(value, "actorId") as ActorId;
}

export function resolveTenantContext(input: ResolveTenantContextInput): Readonly<TenantContext> {
  if (input.bodyTenantId !== undefined) {
    throw problem({
      title: "Untrusted tenant context",
      status: 400,
      code: "untrusted_tenant_context",
      detail: "Tenant identity must not be supplied in a request body.",
      correlation_id: input.correlationId,
    });
  }

  if (!input.principal.tenantMemberships.includes(input.selectedTenantId)) {
    throw problem({
      title: "Tenant access denied",
      status: 403,
      code: "tenant_access_denied",
      detail: "The authenticated principal is not authorized for the selected tenant.",
      correlation_id: input.correlationId,
    });
  }

  if (input.tenantState !== "ACTIVE") {
    throw problem({
      title: "Tenant unavailable",
      status: 403,
      code: "tenant_not_active",
      detail: "The selected tenant is not active.",
      correlation_id: input.correlationId,
    });
  }

  const context: TenantContext = {
    tenantId: input.selectedTenantId,
    actorId: input.principal.actorId,
    principalKind: input.principal.kind,
    correlationId: requireNonBlank(input.correlationId, "correlationId"),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  };
  return issue(context);
}

/**
 * Returns a child context for work caused by another command or event. Only the causation ID may
 * change; tenant, actor, principal kind and correlation ID are inherited and cannot be overridden.
 */
export function withCausation(context: Readonly<TenantContext>, causationId: string): Readonly<TenantContext> {
  assertIssued(context);
  const { causationId: _previous, ...inherited } = context;
  return issue({ ...inherited, causationId: requireNonBlank(causationId, "causationId") });
}

function assertIssued(context: Readonly<TenantContext>): void {
  if (!issuedContexts.has(context)) {
    throw problem({
      title: "Tenant context mismatch",
      status: 500,
      code: "tenant_context_mismatch",
      detail: "Only a context issued by the trusted resolver may be activated.",
    });
  }
}

export function runWithTenantContext<T>(context: Readonly<TenantContext>, operation: () => T): T {
  assertIssued(context);
  const active = storage.getStore();
  if (
    active !== undefined &&
    (active.tenantId !== context.tenantId ||
      active.actorId !== context.actorId ||
      active.principalKind !== context.principalKind ||
      active.correlationId !== context.correlationId)
  ) {
    throw problem({
      title: "Tenant context mismatch",
      status: 500,
      code: "tenant_context_mismatch",
      detail: "A different trusted context cannot replace the active one.",
    });
  }
  return storage.run(context, operation);
}

export function currentTenantContext(): Readonly<TenantContext> {
  const context = storage.getStore();
  if (context === undefined) {
    throw problem({
      title: "Tenant context required",
      status: 500,
      code: "tenant_context_missing",
      detail: "A trusted tenant context was required but was not established.",
    });
  }
  return context;
}
