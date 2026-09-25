/**
 * Platform operator access (decision D11). Platform staff authenticate against a separate audience,
 * hold no tenant memberships and always use MFA. Their authority comes from platform roles asserted
 * by the platform identity provider and mapped here to a small reviewed permission catalog, so no
 * tenant role can ever imply platform power and no platform role grants access inside a tenant.
 */

export const PLATFORM_AUDIENCE = "sintius-platform";

export const PLATFORM_PERMISSION_CATALOG = Object.freeze(["platform:tenant:provision", "platform:tenant:lifecycle"] as const);

export type PlatformPermission = (typeof PLATFORM_PERMISSION_CATALOG)[number];

/** Reviewed platform roles. A role name the catalog does not know grants nothing. */
export const PLATFORM_ROLES: Readonly<Record<string, readonly PlatformPermission[]>> = Object.freeze({
  platform_tenant_provisioner: Object.freeze(["platform:tenant:provision"] as const),
  platform_tenant_lifecycle_operator: Object.freeze(["platform:tenant:lifecycle"] as const),
});

export function isPlatformPermission(value: string): value is PlatformPermission {
  return (PLATFORM_PERMISSION_CATALOG as readonly string[]).includes(value);
}

/** Deny by default: the union of the known roles' permissions, sorted for a stable principal. */
export function platformPermissionsFor(roles: readonly string[]): readonly PlatformPermission[] {
  const granted = new Set<PlatformPermission>();
  for (const role of roles) {
    if (!Object.hasOwn(PLATFORM_ROLES, role)) continue;
    for (const permission of PLATFORM_ROLES[role]!) granted.add(permission);
  }
  return Object.freeze([...granted].sort());
}
