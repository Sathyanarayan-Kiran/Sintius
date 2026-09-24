import { problem } from "../../problem-model/src/index.ts";
import { currentTenantContext, type TenantContext } from "./context.ts";

const MAX_SCAN_DEPTH = 16;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/**
 * True when a tenant identity key appears in a plain object graph. Nesting deeper than the scan
 * limit cannot be verified and is treated as containing one (fail closed).
 */
export function containsTenantIdentity(input: unknown): boolean {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== "object" || value === null) return false;
    if (depth > MAX_SCAN_DEPTH) return true;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => visit(item, depth + 1));
    return Object.entries(value).some(([key, child]) => normalizeKey(key) === "tenantid" || visit(child, depth + 1));
  };
  return visit(input, 0);
}

/**
 * Tenant-scoped commands receive their tenant from the trusted context only. Any tenant identity
 * inside the input (at any depth) is an override attempt and is rejected rather than ignored, so
 * a caller cannot believe it selected a tenant.
 */
export function assertNoTenantIdentity(input: unknown, correlationId?: string): void {
  if (containsTenantIdentity(input)) {
    throw problem({
      code: "untrusted_tenant_context",
      detail: "Tenant identity must not be supplied in a command payload.",
      ...(correlationId === undefined ? {} : { correlation_id: correlationId }),
    });
  }
}

export type TenantCommandHandler<Input, Result> = (
  context: Readonly<TenantContext>,
  input: Readonly<Input>,
) => Result | Promise<Result>;

/**
 * Wraps a module command so it (1) fails closed without a trusted context, (2) rejects tenant
 * identity in its input and (3) receives the context as an explicit argument. Platform-scoped
 * commands that create tenants are a separate concern and must not use this wrapper.
 */
export function defineTenantCommand<Input extends object, Result>(
  handler: TenantCommandHandler<Input, Result>,
): (input: Input) => Promise<Result> {
  return async (input: Input): Promise<Result> => {
    const context = currentTenantContext();
    assertNoTenantIdentity(input, context.correlationId);
    return handler(context, input);
  };
}
