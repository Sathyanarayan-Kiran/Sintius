import pg from "pg";
import type { ActorId, TenantId } from "../../../../platform/tenant-context/src/index.ts";
import type { PermissionGrantStore } from "../../application/authorization-ports.ts";
import type { ConstraintOperator, ConstraintValue, Permission, PermissionConstraint, RoleSnapshot, RoleStatus } from "../../domain/authorization.ts";

const { Pool } = pg;

/** Stored limits are data: anything malformed becomes a limit no request can satisfy (fail closed). */
function limitFrom(value: unknown): Readonly<PermissionConstraint> {
  const item = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const scalar = (candidate: unknown): candidate is ConstraintValue => typeof candidate === "string" || typeof candidate === "number";
  const limitValue = Array.isArray(item.value) ? item.value.filter(scalar) : scalar(item.value) ? item.value : "";
  return Object.freeze({
    permission: String(item.permission) as Permission,
    attribute: typeof item.attribute === "string" ? item.attribute : "",
    operator: (typeof item.operator === "string" ? item.operator : "invalid") as ConstraintOperator,
    value: limitValue,
  });
}

/**
 * Live role lookup for `createTenantAuthorizer`. Every lookup is its own read transaction bound to
 * the requested tenant, so forced RLS applies in addition to the explicit tenant filter, and a
 * revoked assignment stops granting on the next evaluation. Unknown permission strings are passed
 * through and discarded by the deny-by-default domain evaluator.
 */
export class PostgresPermissionGrantStore implements PermissionGrantStore {
  readonly #pool;

  constructor(options: { readonly connectionString?: string; readonly maxConnections?: number } = {}) {
    this.#pool = new Pool({
      connectionString: options.connectionString ?? process.env.SINTIUS_DATABASE_URL ?? "postgresql://sintius_app@127.0.0.1:54329/sintius",
      max: options.maxConnections ?? 5,
    });
  }

  async loadAssignedRoles(tenantId: TenantId, actorId: ActorId): Promise<readonly Readonly<RoleSnapshot>[]> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await client.query(
        `SELECT role.role_code, role.permissions, role.status, role.permission_limits
           FROM tenant_role_assignment assignment
           JOIN tenant_role role
             ON role.tenant_id = assignment.tenant_id AND role.role_code = assignment.role_code
          WHERE assignment.tenant_id = $1
            AND assignment.actor_id = $2
            AND assignment.status = 'active'
            AND assignment.tenant_id = current_setting('app.tenant_id', true)
          ORDER BY role.role_code`,
        [tenantId, actorId],
      );
      await client.query("COMMIT");
      return result.rows.map((row) =>
        Object.freeze({
          roleCode: String(row.role_code),
          permissions: Object.freeze(
            (Array.isArray(row.permissions) ? row.permissions : []).filter((value: unknown): value is Permission => typeof value === "string"),
          ),
          status: String(row.status) as RoleStatus,
          limits: Object.freeze((Array.isArray(row.permission_limits) ? row.permission_limits : []).map(limitFrom)),
        }),
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
