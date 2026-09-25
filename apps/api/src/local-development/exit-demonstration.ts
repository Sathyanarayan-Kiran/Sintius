import { randomUUID } from "node:crypto";
import pg from "pg";
import { createAuthenticator } from "../../../../modules/identity-tenant/application/authentication.ts";
import { PostgresCredentialStatusStore } from "../../../../modules/identity-tenant/infrastructure/postgres/credential-status.ts";
import { composePostgresApi } from "../composition/postgres.ts";
import { createBearerAuthenticator, createPlatformBearerAuthenticator } from "../http/bearer-authenticator.ts";
import { createLocalDevelopmentIdentityProvider } from "./identity.ts";

/**
 * `npm run demo:exit`: the Phase 0 exit scenario (HANDOVER_PROMPT_CODEX.md §6.3), narrated. It uses
 * the same composition root as `npm start` (composePostgresApi) and a fresh, LOCAL DEVELOPMENT ONLY
 * key set (identity.ts) — never a production credential. It expects a migrated PostgreSQL database
 * reachable at SINTIUS_MIGRATION_DATABASE_URL / SINTIUS_DATABASE_URL / SINTIUS_DISPATCHER_DATABASE_URL
 * (the same defaults `npm run db:migrate` and the test suites use), and is safe to run repeatedly:
 * every run uses freshly generated tenant IDs, so it never collides with or depends on prior runs.
 */

const { Pool } = pg;
const adminUrl = process.env["SINTIUS_MIGRATION_DATABASE_URL"] ?? "postgresql://sintius_admin@127.0.0.1:54329/sintius";
const appUrl = process.env["SINTIUS_DATABASE_URL"] ?? "postgresql://sintius_app@127.0.0.1:54329/sintius";

function step(label: string): void {
  console.log(`\n=== ${label} ===`);
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const local = await createLocalDevelopmentIdentityProvider();
  const authentication = createAuthenticator({
    policies: { findById: async (id) => [local.tenantPolicy, local.platformPolicy].find((policy) => policy.id === id) },
    verifier: local.verifier,
    credentialStatus: new PostgresCredentialStatusStore({ connectionString: appUrl }),
    clock: () => new Date(),
  });
  const api = composePostgresApi({
    authenticator: createBearerAuthenticator({ providerId: local.tenantPolicy.id, audience: "sintius-api", authenticator: authentication }),
    platformAuthenticator: createPlatformBearerAuthenticator({ providerId: local.platformPolicy.id, authenticator: authentication }),
    connectionString: appUrl,
    enableFoundationProof: true,
  });

  const suffix = randomUUID().slice(0, 8);
  const tenantA = `demo-tenant-a-${suffix}`;
  const tenantB = `demo-tenant-b-${suffix}`;
  const userActorId = `demo_user_${suffix}`;

  const inject = (method: "POST", url: string, token: string, headers: Record<string, string> = {}, body?: unknown) =>
    api.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  try {
    step("1. A platform operator provisions and activates tenant A");
    const operatorToken = await local.mintPlatformOperatorToken({
      subject: "demo_operator",
      roles: ["platform_tenant_provisioner", "platform_tenant_lifecycle_operator"],
    });
    const created = await inject("POST", "/v1/platform/tenants", operatorToken, { "idempotency-key": randomUUID() }, {
      tenant_id: tenantA,
      display_name: "Demo Tenant A",
      initial_administrator_actor_id: `admin_${tenantA}`,
    });
    if (created.statusCode !== 201) throw new Error(`provisioning tenant A failed: ${created.statusCode} ${created.body}`);
    const activated = await inject("POST", `/v1/platform/tenants/${tenantA}/activate`, operatorToken, { "idempotency-key": randomUUID(), "if-match": created.headers["etag"] as string }, {});
    if (activated.statusCode !== 200) throw new Error(`activating tenant A failed: ${activated.statusCode} ${activated.body}`);
    console.log(`tenant A "${tenantA}" is ACTIVE (version ${activated.json<{ version: number }>().version})`);

    step("2. The same operator provisions and activates tenant B, kept empty of any command");
    const createdB = await inject("POST", "/v1/platform/tenants", operatorToken, { "idempotency-key": randomUUID() }, {
      tenant_id: tenantB,
      display_name: "Demo Tenant B",
      initial_administrator_actor_id: `admin_${tenantB}`,
    });
    if (createdB.statusCode !== 201) throw new Error(`provisioning tenant B failed: ${createdB.statusCode} ${createdB.body}`);
    const activatedB = await inject("POST", `/v1/platform/tenants/${tenantB}/activate`, operatorToken, { "idempotency-key": randomUUID(), "if-match": createdB.headers["etag"] as string }, {});
    if (activatedB.statusCode !== 200) throw new Error(`activating tenant B failed: ${activatedB.statusCode} ${activatedB.body}`);
    console.log(`tenant B "${tenantB}" is ACTIVE; it will never receive any command in this demonstration`);

    step("3. A tenant-A user is granted a role, then authenticates");
    await admin.query(`INSERT INTO tenant_role (tenant_id, role_code, permissions) VALUES ($1, 'demo_operator', '["foundation:proof:execute"]')`, [tenantA]);
    await admin.query(`INSERT INTO tenant_role_assignment (tenant_id, actor_id, role_code) VALUES ($1, $2, 'demo_operator')`, [tenantA, userActorId]);
    const userToken = await local.mintTenantUserToken({ subject: userActorId, tenantIds: [tenantA] });
    console.log(`"${userActorId}" authenticated for tenant A with the demo_operator role (foundation:proof:execute)`);

    step("4. The user runs the same command twice with one idempotency key");
    const idempotencyKey = randomUUID();
    const correlationId = `demo-${suffix}`;
    const headers = { "idempotency-key": idempotencyKey, "x-correlation-id": correlationId };
    const first = await inject("POST", "/v1/foundation/proofs", userToken, headers, { label: "phase-0-exit-demo" });
    if (first.statusCode !== 201) throw new Error(`first command failed: ${first.statusCode} ${first.body}`);
    const replay = await inject("POST", "/v1/foundation/proofs", userToken, headers, { label: "phase-0-exit-demo" });
    if (replay.statusCode !== 201) throw new Error(`replay failed: ${replay.statusCode} ${replay.body}`);
    const sameResponse = JSON.stringify(first.json()) === JSON.stringify(replay.json());
    console.log(`first call: 201 ${JSON.stringify(first.json())}`);
    console.log(`retry with the same key: 201 ${JSON.stringify(replay.json())}`);
    console.log(sameResponse ? "the retry replayed the stored response verbatim (no second effect)" : "MISMATCH: the retry did not replay the stored response");
    if (!sameResponse) throw new Error("the idempotent replay did not return the original response");

    step("5. Exactly one record, one audit event and one outbox event exist for tenant A — tenant B sees none of this command's evidence");
    // Tenant B legitimately has its own provisioning/activation audit trail from step 2; what must
    // be zero is any trace of tenant A's foundation-proof command in tenant B's rows.
    const evidence = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM foundation_proof_record WHERE tenant_id = $1) AS tenant_a_records,
         (SELECT count(*)::int FROM audit_event WHERE tenant_id = $1 AND action = 'foundation.proof_recorded') AS tenant_a_audit_events,
         (SELECT count(*)::int FROM outbox_event WHERE tenant_id = $1 AND event_type LIKE '%foundation.proof_recorded%') AS tenant_a_outbox_events,
         (SELECT count(*)::int FROM foundation_proof_record WHERE tenant_id = $2) AS tenant_b_records,
         (SELECT count(*)::int FROM audit_event WHERE tenant_id = $2 AND action = 'foundation.proof_recorded') AS tenant_b_audit_events,
         (SELECT count(*)::int FROM outbox_event WHERE tenant_id = $2 AND event_type LIKE '%foundation.proof_recorded%') AS tenant_b_outbox_events`,
      [tenantA, tenantB],
    );
    const row = evidence.rows[0] as Record<string, number>;
    console.log(`tenant A: ${row["tenant_a_records"]} record(s), ${row["tenant_a_audit_events"]} audit event(s), ${row["tenant_a_outbox_events"]} outbox event(s)`);
    console.log(`tenant B: ${row["tenant_b_records"]} record(s), ${row["tenant_b_audit_events"]} audit event(s) of this command, ${row["tenant_b_outbox_events"]} outbox event(s) — its own provisioning audit trail is untouched`);
    const exactlyOneForA = row["tenant_a_records"] === 1 && row["tenant_a_audit_events"] === 1 && row["tenant_a_outbox_events"] === 1;
    const nothingForB = row["tenant_b_records"] === 0 && row["tenant_b_audit_events"] === 0 && row["tenant_b_outbox_events"] === 0;
    if (!exactlyOneForA || !nothingForB) throw new Error("the exit scenario's evidence did not match: expected exactly one for tenant A and nothing for tenant B");

    console.log("\nPASS: provisioned and activated a tenant as a platform operator; a user ran one command twice with one");
    console.log("idempotency key and produced exactly one record, one audit event and one outbox event; tenant B saw nothing.");
  } finally {
    await api.close();
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error("\nFAIL:", error);
  process.exitCode = 1;
});
