import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  PROBLEM_CATALOG,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_STATUSES,
  PlatformProblem,
  isValidTraceId,
  mapErrorToProblemResponse,
  problem,
  redactSensitiveText,
  resolveTraceIds,
  runAtProblemBoundary,
  type ProblemCode,
  type UnexpectedErrorReport,
} from "../src/index.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");

function collectingSink(): { reports: UnexpectedErrorReport[]; record(report: UnexpectedErrorReport): void } {
  const reports: UnexpectedErrorReport[] = [];
  return { reports, record: (report) => void reports.push(report) };
}

// ---------------------------------------------------------------------------------------------
// TC-001-05-01 - Known problem mappings remain stable (contract)
// ---------------------------------------------------------------------------------------------

test("TC-001-05-01 the problem catalog is a stable published contract", () => {
  const golden: ReadonlyArray<readonly [string, number, string]> = [
    ["invalid_trusted_context", 400, "Invalid trusted context"],
    ["untrusted_tenant_context", 400, "Untrusted tenant context"],
    ["tenant_access_denied", 403, "Tenant access denied"],
    ["tenant_not_active", 403, "Tenant unavailable"],
    ["invalid_timestamp", 422, "Invalid timestamp"],
    ["tenant_display_name_required", 422, "Invalid tenant"],
    ["tenant_version_conflict", 409, "Tenant version conflict"],
    ["invalid_tenant_transition", 409, "Invalid tenant transition"],
    ["platform_access_denied", 403, "Platform access denied"],
    ["tenant_not_found", 404, "Tenant not found"],
    ["tenant_already_exists", 409, "Tenant already exists"],
    ["tenant_reason_required", 422, "Reason required"],
    ["tenant_context_missing", 500, "Tenant context required"],
    ["tenant_context_mismatch", 500, "Tenant context mismatch"],
    ["internal_error", 500, "Internal error"],
  ];
  const actual = Object.entries(PROBLEM_CATALOG).map(([code, entry]) => [code, entry.status, entry.title]);
  assert.deepEqual(actual, golden);
  for (const [code, status] of golden) {
    assert.match(code, /^[a-z][a-z0-9_]*$/);
    assert.ok((PROBLEM_STATUSES as readonly number[]).includes(status));
  }
  assert.equal(Object.isFrozen(PROBLEM_CATALOG), true);
});

test("TC-001-05-01 every problem code used in source is registered", () => {
  const found = new Set<string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "tests") continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".ts")) {
        for (const match of readFileSync(path, "utf8").matchAll(/problem\(\{[^}]*?\bcode:\s*"([^"]+)"/gs)) {
          found.add(match[1] as string);
        }
      }
    }
  };
  for (const root of ["platform", "modules", "apps", "services"]) {
    try {
      visit(resolve(repoRoot, root));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  assert.ok(found.size >= 9, "the scan must find the existing problem() call sites");
  for (const code of found) assert.ok(Object.hasOwn(PROBLEM_CATALOG, code), `${code} is not registered in PROBLEM_CATALOG`);
});

test("TC-001-05-01 unregistered codes and contract drift are rejected at construction", () => {
  assert.throws(() => problem({ code: "made_up_code" as ProblemCode, detail: "x" }), TypeError);
  assert.throws(() => problem({ code: "tenant_access_denied", status: 404, detail: "x" }), TypeError);
  assert.throws(() => problem({ code: "tenant_access_denied", title: "Renamed", detail: "x" }), TypeError);
  assert.throws(
    () =>
      new PlatformProblem({
        type: "t",
        title: "Tenant access denied",
        status: 403,
        code: "not_in_catalog" as ProblemCode,
        detail: "x",
      }),
    TypeError,
  );
});

test("TC-001-05-01 every cataloged problem maps to RFC 7807 data with a stable code and correlation ID", () => {
  for (const [code, entry] of Object.entries(PROBLEM_CATALOG)) {
    const response = mapErrorToProblemResponse(problem({ code: code as ProblemCode, detail: "Safe detail." }), {
      correlationId: "corr_trace_1",
    });
    assert.equal(response.status, entry.status);
    assert.equal(response.headers["content-type"], PROBLEM_CONTENT_TYPE);
    assert.equal(response.headers["x-correlation-id"], "corr_trace_1");
    assert.equal(response.body.code, code);
    assert.equal(response.body.title, entry.title);
    assert.equal(response.body.status, entry.status);
    assert.equal(response.body.correlation_id, "corr_trace_1");
    assert.equal(response.body.type, `https://errors.sintius.example/${code}`);
    assert.equal(Object.isFrozen(response.body), true);
  }
});

test("TC-001-05-01 response bodies expose only allow-listed fields and preserve field errors", () => {
  const known = problem({
    code: "invalid_timestamp",
    detail: "Bad instant.",
    errors: [{ path: "/effective_at", code: "invalid_format", message: "Must be RFC 3339." }],
  });
  const response = mapErrorToProblemResponse(known, { correlationId: "corr_2" });
  assert.deepEqual(Object.keys(response.body).sort(), ["code", "correlation_id", "detail", "errors", "status", "title", "type"]);
  assert.deepEqual(response.body.errors, [{ path: "/effective_at", code: "invalid_format", message: "Must be RFC 3339." }]);
  assert.equal(Object.isFrozen(known.problem.errors), true);
  assert.equal(known.toJSON(), known.problem);
});

test("TC-001-05-01 the trusted ingress correlation ID wins and untrusted values are never reflected", () => {
  const carried = problem({ code: "tenant_access_denied", detail: "Denied.", correlation_id: "corr_from_problem" });

  assert.equal(mapErrorToProblemResponse(carried, { correlationId: "corr_ingress" }).body.correlation_id, "corr_ingress");
  assert.equal(mapErrorToProblemResponse(carried, {}).body.correlation_id, "corr_from_problem");

  const injected = mapErrorToProblemResponse(carried, { correlationId: "abc\r\nSet-Cookie: session=1" });
  assert.equal(injected.body.correlation_id, "corr_from_problem");

  const generated = mapErrorToProblemResponse(problem({ code: "tenant_not_active", detail: "Inactive." }), {
    correlationId: "bad id with spaces",
  });
  assert.match(generated.body.correlation_id as string, /^corr_[0-9a-f-]{36}$/);
  assert.equal(generated.headers["x-correlation-id"], generated.body.correlation_id);
});

test("TC-001-05-01 trace identifiers are validated and generated when missing", () => {
  for (const valid of ["corr_1", "a", "req:2026-09-24.abc", "A".repeat(128)]) assert.equal(isValidTraceId(valid), true);
  for (const invalid of ["", " ", "a b", "a\nb", "-leading", "A".repeat(129), 42, null, undefined]) {
    assert.equal(isValidTraceId(invalid), false, String(invalid));
  }
  assert.deepEqual(resolveTraceIds({ correlationId: "corr_ok", causationId: "cmd_1" }), { correlationId: "corr_ok", causationId: "cmd_1" });
  assert.deepEqual(resolveTraceIds({ correlationId: "x y", causationId: "x y" }, () => "gen_1"), { correlationId: "gen_1" });
  assert.deepEqual(resolveTraceIds(undefined, () => "gen_2"), { correlationId: "gen_2" });
});

test("TC-001-05-01 expected 4xx problems are not reported as unexpected errors", () => {
  const sink = collectingSink();
  mapErrorToProblemResponse(problem({ code: "tenant_version_conflict", detail: "Stale." }), { correlationId: "corr_3" }, sink);
  assert.equal(sink.reports.length, 0);
});

// ---------------------------------------------------------------------------------------------
// TC-001-05-02 - Unexpected error redaction (security)
// ---------------------------------------------------------------------------------------------

test("TC-001-05-02 unexpected exceptions return a sanitized 500 and keep redacted internal evidence", () => {
  const sink = collectingSink();
  const failure = new Error(
    "connect failed for tenant tenant_B password=hunter2 Bearer abc.def.ghi sk_live_ABC123 card 4242 4242 4242 4242",
  );
  const response = mapErrorToProblemResponse(failure, { correlationId: "corr_4", causationId: "cmd_9", route: "POST /tenants" }, sink, () =>
    new Date("2026-09-24T10:00:00.000Z"),
  );

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "internal_error");
  assert.equal(response.body.title, "Internal error");
  assert.equal(response.body.correlation_id, "corr_4");
  const wire = JSON.stringify(response);
  for (const secret of ["hunter2", "abc.def.ghi", "sk_live_ABC123", "4242", "tenant_B", "connect failed", "Error:", "at "]) {
    assert.equal(wire.includes(secret), false, `response leaked ${secret}`);
  }

  assert.equal(sink.reports.length, 1);
  const [report] = sink.reports as [UnexpectedErrorReport];
  assert.equal(report.reason, "unhandled_exception");
  assert.equal(report.correlationId, "corr_4");
  assert.equal(report.causationId, "cmd_9");
  assert.equal(report.route, "POST /tenants");
  assert.equal(report.occurredAt, "2026-09-24T10:00:00.000Z");
  assert.equal(report.responseCode, "internal_error");
  assert.equal(report.errorName, "Error");
  assert.match(report.errorMessage, /connect failed for tenant tenant_B/);
  for (const secret of ["hunter2", "abc.def.ghi", "sk_live_ABC123", "4242 4242"]) {
    assert.equal(report.errorMessage.includes(secret), false, `evidence leaked ${secret}`);
    assert.equal((report.stack ?? "").includes(secret), false, `stack leaked ${secret}`);
  }
  assert.match(report.errorMessage, /\[REDACTED/);
});

test("TC-001-05-02 non-Error throwables and spoofed problem-like objects are sanitized", () => {
  const sink = collectingSink();
  const spoofed = { problem: { status: 403, code: "tenant_access_denied", title: "Tenant access denied", detail: "tenant_B exists" } };
  const cases: unknown[] = ["token=abc123", null, undefined, 42, { status: 403, detail: "secret" }, spoofed, Object.assign(new Error("boom"), { status: 404 })];
  for (const thrown of cases) {
    const response = mapErrorToProblemResponse(thrown, { correlationId: "corr_5" }, sink);
    assert.equal(response.status, 500);
    assert.equal(response.body.code, "internal_error");
    assert.equal(JSON.stringify(response).includes("tenant_B"), false);
    assert.equal(JSON.stringify(response).includes("abc123"), false);
  }
  assert.equal(sink.reports.length, cases.length);
  assert.equal(sink.reports[0]?.errorName, "string");
  assert.equal(sink.reports[0]?.errorMessage, "token=[REDACTED]");
});

test("TC-001-05-02 cataloged server problems return their safe body and are still reported internally", () => {
  const sink = collectingSink();
  const response = mapErrorToProblemResponse(problem({ code: "tenant_context_missing", detail: "Context missing." }), { correlationId: "corr_6" }, sink);
  assert.equal(response.status, 500);
  assert.equal(response.body.code, "tenant_context_missing");
  assert.equal(sink.reports.length, 1);
  assert.equal(sink.reports[0]?.reason, "server_problem");
});

test("TC-001-05-02 a failing telemetry sink never changes the response", () => {
  const throwingSink = {
    record: (): void => {
      throw new Error("sink offline");
    },
  };
  const response = mapErrorToProblemResponse(new Error("boom"), { correlationId: "corr_7" }, throwingSink);
  assert.equal(response.status, 500);
  assert.equal(response.body.correlation_id, "corr_7");
});

test("TC-001-05-02 the boundary converts synchronous and asynchronous failures and passes successes through", async () => {
  const sink = collectingSink();
  const context = { correlationId: "corr_8" };

  const success = await runAtProblemBoundary(context, () => "value", sink);
  assert.deepEqual(success, { ok: true, value: "value" });

  const syncFailure = await runAtProblemBoundary(context, () => {
    throw problem({ code: "tenant_access_denied", detail: "Denied." });
  }, sink);
  assert.equal(syncFailure.ok, false);
  assert.equal(syncFailure.ok === false && syncFailure.response.status, 403);

  const asyncFailure = await runAtProblemBoundary(context, async () => {
    await Promise.resolve();
    throw new Error("db password=secret");
  }, sink);
  assert.equal(asyncFailure.ok === false && asyncFailure.response.status, 500);
  assert.equal(JSON.stringify(asyncFailure).includes("secret"), false);
  assert.equal(sink.reports.length, 1);
});

test("TC-001-05-02 redaction covers credentials, tokens and Luhn-valid card numbers only", () => {
  assert.equal(redactSensitiveText("Authorization: Bearer abc123.def"), "Authorization: [REDACTED]");
  assert.equal(redactSensitiveText("Bearer abc123.def"), "Bearer [REDACTED]");
  assert.equal(redactSensitiveText("jwt eyJhbGciOi.eyJzdWIiOiIx.c2ln here"), "jwt [REDACTED_JWT] here");
  assert.equal(redactSensitiveText("key " + "sk_" + "test_4eC39HqLyjWDarjtT1zdp7dc"), "key [REDACTED_KEY]");
  assert.equal(redactSensitiveText('{"client_secret":"s3cr3t","ok":1}'), '{"client_secret":"[REDACTED]","ok":1}');
  assert.equal(redactSensitiveText("api_key='k-1' and password: p@ss"), "api_key='[REDACTED]' and password: [REDACTED]");
  assert.equal(redactSensitiveText("pan 4242-4242-4242-4242 ok"), "pan [REDACTED_PAN] ok");
  assert.equal(redactSensitiveText("order 1234567890123456 kept"), "order 1234567890123456 kept");
  assert.equal(redactSensitiveText("tenant tenant_A version 12"), "tenant tenant_A version 12");
  const long = redactSensitiveText("x".repeat(5000));
  assert.equal(long.length, 2000 + "...[truncated]".length);
});
