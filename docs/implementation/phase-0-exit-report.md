# Phase 0 exit report — PR 5

**To:** Product Owner
**From:** implementation session, 2026-09-25
**Branch:** `claude/nice-bell-iox4sy`, `master` at the merge of PR #10

## What this PR does

1. **Pipeline controls (US-MSR-103-DOD, US-MSR-099-TEST-STRATEGY).** `tools/requirements/story-dod.ts` rejects a story marked `implemented` unless every one of its tests is `passing`, exists as an automated test titled with its TC ID, and (in CI) actually passed in this run; a financially material story additionally needs a passing `reconciliation`-typed test or a reviewed rationale for why none applies. `tools/requirements/test-strategy.ts` requires every quality-suite class in `docs/pre-implementation/24-testing-strategy.md` §16 to be either applicable now with real evidence, or explicitly marked not-yet-applicable with a reviewed reason. Both run in CI as `npm run check:pipeline-controls`, wired into `.github/workflows/ci.yml` alongside the existing `check:evidence` step. The golden-dataset determinism/provenance class is proven by `docs/implementation/golden/money-proration-allocation.json` and `platform/money/tests/golden-dataset.test.ts` (proration and largest-remainder allocation, mutation-tested).
2. **Honest status for specification-derived tests.** `docs/implementation/specification-test-status.json` is a new, durable, validated overlay for TC IDs on specification-derived stories, which are regenerated fresh on every run and always seeded `not_run`. `MSR-080-3B6F4B3FE4` (OIDC/OAuth2) and `MSR-080-477F636C27` (MFA) are now claimed — each by its own directly titled test — bringing implementation evidence from 16 to **18 of 1,335**. `MSR-080-A555453F8D` (SAML SSO) is not claimed; SAML is federated through the identity provider and is not demonstrable in-repo.
3. **Runnable preview.** `npm start` composes the API on PostgreSQL (`apps/api/src/main.ts`), using a real configured identity provider when `SINTIUS_TENANT_JWKS_URL`/`SINTIUS_PLATFORM_JWKS_URL` are set, or a clearly labelled, fresh, in-memory, local-development-only key set otherwise (`apps/api/src/local-development/identity.ts`) — never a production credential. `npm run demo:exit` (`apps/api/src/local-development/exit-demonstration.ts`) runs the exit scenario against a migrated database: a platform operator provisions and activates two tenants; a user in tenant A runs one command twice with one idempotency key; the script queries the database and prints exactly one record, one audit event and one outbox event for tenant A, and none of that command's evidence for tenant B. Verified locally, twice in a row (it is safe to re-run — every run uses freshly generated tenant IDs).
4. **A pre-existing gap the new DoD gate found and PR 5 fixed.** US-BL-002-01 ("Provision and manage tenant lifecycle") had two roadmap tests (`TC-002-01-01`, `TC-002-01-02`) marked `passing` with no automated test anywhere titled with those exact IDs — the underlying behavior was tested (`modules/identity-tenant/tests/tenant.test.ts`), just never attributed to its TC ID. `check-pipeline-controls.mjs` caught this the first time the story was marked `implemented`; the two existing tests were retitled to close the gap rather than fabricating new coverage. This is exactly the failure class US-MSR-103-DOD exists to catch, and it is worth noting as evidence the control works, not only as a fix.
5. **A pre-existing test flake fixed in passing.** `jwt-authentication.test.ts`'s D11 platform-operator test used a hardcoded `NOW` that had already drifted into the past relative to the environment clock at the start of this session, since a tenant context re-checks token expiry against real time on resolution. It now anchors to `Date.now()`. This was failing before any of this PR's changes and is unrelated to the exit package; flagging it for visibility.

## Story status changes

Five stories moved to `implemented` (100% progress, every test passing, automated and verified against this run's CI-style TAP reports):

- **US-BL-001-01** (tenant context) — remaining item is optional (a Redis adapter, only if multi-instance coherence becomes needed).
- **US-BL-001-05** (problems and trace) — remaining item (UI copy) is already deferred by decision D16 to the first UI story.
- **US-BL-002-01** (tenant lifecycle) — nothing remaining for Phase 0, once the TC-002-01-01/02 titling gap above was closed.
- **US-MSR-103-DOD** (Definition of Done) — this PR's own pipeline control.
- **US-MSR-099-TEST-STRATEGY** (test strategy) — this PR's own pipeline control.

## Proposed deferrals — **not yet confirmed**

Everything below is a proposal for your decision, not a decision already made. Until you confirm, the affected stories stay `in_progress` even though the code and tests behind them are otherwise stable:

- **To Phase 1:** the continuous outbox dispatcher runtime (US-BL-001-03); the approval expiry sweeper and `ApprovalPolicy` management commands (US-BL-002-03); the PostgreSQL audit reader and `audit:read` route (US-BL-017-01).
- **To Phase 6:** idempotency's deterministic failed-final responses, retention source and cleanup job (US-BL-001-02); Redis for multi-instance cache coherence (US-BL-001-01, optional); audit hash-chaining and retention (US-BL-017-01); the move to Kafka; and **newly identified in this PR** — alerting on RLS and missing-database-context denials (US-BL-001-04), which is implemented but was never explicitly placed in a deferral bucket in the prior handover.
- **Waiting on the identity-provider product choice** (an existing open item, not blocking Phase 0): US-BL-002-02's revocation feed/command and admin-web login flow, and US-BL-002-04's credential issuance/rotation at the IdP and mTLS.

If you'd rather see any of these pulled forward into Phase 0 instead of deferred, say so and we'll scope the remaining work as its own tranche before merge.

## Commands run, with results

```
npm run typecheck                       # 0 errors
npm run check:architecture               # 8 owned tables, 108 files pass the money guardrail
npm run check:roadmap                    # 17 epics, 103 canonical stories, 167 source-derived, 1469 tests
npm run check:requirements               # traceability complete, implementation coverage incomplete (18/1335)
SINTIUS_TEST_REPORT_DIR=reports npm test              # 184 passed, 0 failed
SINTIUS_TEST_REPORT_DIR=reports npm run test:postgres # 39 passed, 0 failed
SINTIUS_TEST_REPORT_DIR=reports npm run check:evidence            # 18 requirements verified against this run
SINTIUS_TEST_REPORT_DIR=reports npm run check:pipeline-controls   # Definition of Done and test strategy gates pass
npm start        # boots against PostgreSQL; verified with a live curl of /v1/platform/tenants
npm run demo:exit  # PASS, run twice, both times with the same evidence shape
```

## The three-statement separation

- **Backlog traceability: complete.**
- **Implementation coverage: incomplete (18 of 1,335 requirements with evidence).**
- **Automated execution: only what actually ran** — the commands above, on this branch, against a locally provisioned PostgreSQL 16 server standing in for the CI job's PostgreSQL 17 service (same schema, same migrations; not re-verified against 17 in this session).

## What's needed from you

1. Confirm, adjust or reject the proposed deferrals in the section above.
2. Say "merge" when you're ready — per the working agreement, the Release gate check must pass and you decide the merge timing.
