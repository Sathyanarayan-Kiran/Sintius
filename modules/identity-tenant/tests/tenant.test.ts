import assert from "node:assert/strict";
import test from "node:test";
import { PlatformProblem } from "../../../platform/problem-model/src/index.ts";
import { tenantId } from "../../../platform/tenant-context/src/index.ts";
import { provisionTenant, transitionTenant } from "../domain/tenant.ts";

const time = (minute: number) => new Date(`2026-09-23T10:${String(minute).padStart(2, "0")}:00.000Z`);

test("provisions and activates a tenant with versioned facts", () => {
  const provisioned = provisionTenant(tenantId("tenant_A"), " Acme ", time(0));
  assert.equal(provisioned.tenant.displayName, "Acme");
  assert.equal(provisioned.tenant.state, "PROVISIONING");
  assert.equal(provisioned.event.type, "tenant.provisioned.v1");
  const activated = transitionTenant(provisioned.tenant, "ACTIVE", 1, time(1));
  assert.equal(activated.tenant.state, "ACTIVE");
  assert.equal(activated.tenant.version, 2);
  assert.equal(activated.event.type, "tenant.activated.v1");
  assert.equal(activated.event.aggregateVersion, 2);
});

test("supports suspend and reactivate while CLOSED remains terminal", () => {
  const provisioned = provisionTenant(tenantId("tenant_A"), "Acme", time(0));
  const active = transitionTenant(provisioned.tenant, "ACTIVE", 1, time(1));
  const suspended = transitionTenant(active.tenant, "SUSPENDED", 2, time(2));
  const reactivated = transitionTenant(suspended.tenant, "ACTIVE", 3, time(3));
  const closed = transitionTenant(reactivated.tenant, "CLOSED", 4, time(4));
  assert.throws(
    () => transitionTenant(closed.tenant, "ACTIVE", 5, time(5)),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "invalid_tenant_transition",
  );
});

test("rejects invalid transitions and stale command versions", () => {
  const provisioned = provisionTenant(tenantId("tenant_A"), "Acme", time(0));
  assert.throws(
    () => transitionTenant(provisioned.tenant, "SUSPENDED", 1, time(1)),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "invalid_tenant_transition",
  );
  assert.throws(
    () => transitionTenant(provisioned.tenant, "ACTIVE", 99, time(1)),
    (error: unknown) => error instanceof PlatformProblem && error.problem.code === "tenant_version_conflict",
  );
});
