# Implementation record

Implementation is governed by [`docs/HANDOVER_PROMPT_IMPLEMENTATION.md`](../HANDOVER_PROMPT_IMPLEMENTATION.md) and [`docs/CANONICAL_SPEC_INDEX.md`](../CANONICAL_SPEC_INDEX.md).

## Current status

| Phase | Status | Evidence |
|---|---|---|
| Step Zero | Complete from the local snapshot; runtime decision recorded locally with a live-artifact sync note | [Decision Ledger](../decision-ledger.html) |
| SPIKE-01 Backend runtime | Complete; Product Owner selected TypeScript on Node.js 24 LTS | [Runtime selection proposal](spikes/SPIKE-01/runtime-selection-proposal.md) |
| Phase 0 backlog decomposition | Complete | [Implementation-ready stories](phase-0-backlog.md) |
| Phase 0 repository/application scaffolding | In progress; first tenant-context and tenant-lifecycle slice implemented | [Repository README](../../README.md) |
| Open decisions | Options and recommendations awaiting Product Owner confirmation | [Decision proposals](decision-proposals.md) |

## Live implementation tracking

Open the local [implementation roadmap](implementation-roadmap.html) to review all 17 canonical epics, the preserved 103-story delivery catalogue, the additional source-derived requirement stories, acceptance criteria, associated tests, implementation progress, blockers, and test status. The canonical [story catalogue](implementation-roadmap-data.js) is validated against every `BL-*` ID, while the generated [normalized backlog](normalized-backlog.json) provides complete master-specification traceability. Browser status edits persist locally and can be exported or imported as JSON.

The [Master Requirement Register](requirement-register.html) uses the original root specification as its independent coverage denominator. Automated extraction currently captures every numbered source section and reports validation, story mapping, test mapping, and implementation evidence separately. The roadmap must not be described as fully master-covered until the register's honest coverage status becomes `complete`.

The complete normalization pass dispositions all 1,540 extracted candidates. Every accepted requirement must map to a valid story and test or the automated coverage gate fails. The register distinguishes curated review from deterministic normalization and reports implementation evidence separately, so backlog completeness is never presented as implementation completeness.

The [Jira import package](jira/README.md) contains the Jira issue hierarchy, the one-row-per-candidate traceability register, and the associated test catalogue. Regenerate all derived artifacts with `npm.cmd run backlog:generate`.

The live Decision Ledger remains inaccessible from this environment. The local ledger records the confirmed runtime decision and clearly marks it for later synchronization to the live artifact.
