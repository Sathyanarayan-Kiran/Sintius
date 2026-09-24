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
  readonly credentialId: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface IssueAuthenticatedPrincipalInput {
  readonly actorId: string;
  readonly kind: AuthenticatedPrincipal["kind"];
  readonly tenantMemberships: readonly (TenantId | string)[];
  readonly assurance: AuthenticatedPrincipal["assurance"];
  readonly credentialId: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly principalKind: AuthenticatedPrincipal["kind"];
  readonly correlationId: string;
  readonly causationId?: string;
  readonly assurance: AuthenticatedPrincipal["assurance"];
  readonly credentialId: string;
  readonly audiences: readonly string[];
  readonly scopes: readonly string[];
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
const issuedPrincipals = new WeakSet<object>();

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

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function authenticationMetadataFailed(): never {
  throw problem({ code: "authentication_failed", detail: "Authenticated principal metadata is invalid." });
}

export function tenantId(value: string): TenantId {
  return requireNonBlank(value, "tenantId") as TenantId;
}

export function actorId(value: string): ActorId {
  return requireNonBlank(value, "actorId") as ActorId;
}

/**
 * Trusted authentication adapters use this constructor after verifying a credential. Context
 * resolvers reject structurally similar object literals, so application code cannot manufacture
 * authority by supplying principal-shaped data.
 */
export function issueAuthenticatedPrincipal(input: IssueAuthenticatedPrincipalInput): Readonly<AuthenticatedPrincipal> {
  const kindIsValid = input.kind === "interactive" || input.kind === "workload";
  const assuranceIsValid = input.assurance === "single-factor" || input.assurance === "mfa" || input.assurance === "workload";
  const assuranceMatchesKind = input.kind === "workload" ? input.assurance === "workload" : input.assurance !== "workload";
  if (
    !kindIsValid ||
    !assuranceIsValid ||
    !assuranceMatchesKind ||
    !isNonBlankString(input.actorId) ||
    !isNonBlankString(input.credentialId) ||
    !isNonBlankString(input.issuer) ||
    !isNonBlankString(input.expiresAt) ||
    !Array.isArray(input.tenantMemberships) ||
    input.tenantMemberships.some((value) => !isNonBlankString(value)) ||
    !Array.isArray(input.audiences) ||
    input.audiences.length === 0 ||
    input.audiences.some((value) => !isNonBlankString(value)) ||
    !Array.isArray(input.scopes) ||
    input.scopes.some((value) => !isNonBlankString(value))
  ) {
    authenticationMetadataFailed();
  }
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiry)) authenticationMetadataFailed();
  const principal = Object.freeze({
    actorId: actorId(input.actorId),
    kind: input.kind,
    tenantMemberships: Object.freeze([...new Set(input.tenantMemberships.map((value) => tenantId(value)))]),
    assurance: input.assurance,
    credentialId: input.credentialId,
    issuer: input.issuer,
    audiences: Object.freeze([...new Set(input.audiences)]),
    scopes: Object.freeze([...new Set(input.scopes)]),
    expiresAt: new Date(expiry).toISOString(),
  });
  issuedPrincipals.add(principal);
  return principal;
}

export function assertIssuedAuthenticatedPrincipal(principal: Readonly<AuthenticatedPrincipal>, correlationId?: string): void {
  if (!issuedPrincipals.has(principal)) {
    throw problem({
      code: "authentication_failed",
      detail: "The authenticated principal is not trusted.",
      ...(correlationId === undefined ? {} : { correlation_id: correlationId }),
    });
  }
}

function assertPrincipalCurrent(principal: Readonly<AuthenticatedPrincipal>, correlationId: string): void {
  assertIssuedAuthenticatedPrincipal(principal, correlationId);
  const expiry = Date.parse(principal.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw problem({
      code: "authentication_failed",
      detail: "The authenticated principal is no longer valid.",
      correlation_id: correlationId,
    });
  }
}

export function resolveTenantContext(input: ResolveTenantContextInput): Readonly<TenantContext> {
  assertPrincipalCurrent(input.principal, input.correlationId);
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
    assurance: input.principal.assurance,
    correlationId: requireNonBlank(input.correlationId, "correlationId"),
    credentialId: input.principal.credentialId,
    audiences: Object.freeze([...input.principal.audiences]),
    scopes: Object.freeze([...input.principal.scopes]),
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
      active.assurance !== context.assurance ||
      active.correlationId !== context.correlationId ||
      active.credentialId !== context.credentialId ||
      active.audiences.join("\u0000") !== context.audiences.join("\u0000") ||
      active.scopes.join("\u0000") !== context.scopes.join("\u0000"))
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
