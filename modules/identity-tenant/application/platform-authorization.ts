import { problem } from "../../../platform/problem-model/src/index.ts";
import { assertIssuedPlatformContext, type PlatformCommandContext } from "../../../platform/tenant-context/src/index.ts";
import { PLATFORM_AUDIENCE, isPlatformPermission, type PlatformPermission } from "../domain/platform-access.ts";
import type { PlatformAuthorizer } from "./ports.ts";

/**
 * Production platform authorizer (decision D11). A platform command is allowed only for a trusted
 * platform context whose principal authenticated as a platform operator: an interactive human on
 * the platform audience, with MFA, holding the permission through a reviewed platform role. Tenant
 * users and workloads never satisfy it, whatever their tenant roles or scopes.
 */
export function createPlatformAuthorizer(): PlatformAuthorizer {
  return Object.freeze({
    async assertAllowed(context: Readonly<PlatformCommandContext>, permission: PlatformPermission): Promise<void> {
      assertIssuedPlatformContext(context);
      const allowed =
        isPlatformPermission(permission) &&
        context.principalKind === "interactive" &&
        context.assurance === "mfa" &&
        context.audiences.includes(PLATFORM_AUDIENCE) &&
        context.scopes.includes(permission);
      if (!allowed) {
        throw problem({
          code: "platform_access_denied",
          detail: "The platform action is not permitted.",
          correlation_id: context.correlationId,
        });
      }
    },
  });
}
