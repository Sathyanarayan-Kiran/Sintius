import type { ResolveTenantContextInput, TenantContext } from "../../../platform/tenant-context/src/index.ts";
import { resolveTenantContext, runWithTenantContext } from "../../../platform/tenant-context/src/index.ts";

/** Framework-neutral ingress seam. HTTP adapters must construct input from verified claims. */
export function executeInTenantContext<T>(
  input: ResolveTenantContextInput,
  handler: (context: Readonly<TenantContext>) => T,
): T {
  const context = resolveTenantContext(input);
  return runWithTenantContext(context, () => handler(context));
}
