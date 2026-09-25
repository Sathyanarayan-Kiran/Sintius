# SPIKE-03: UUIDv7 primary keys

**Decision:** D7 (`docs/implementation/decision-proposals.md` §D7). Accepted by the Product Owner on 2026-09-24 (option A: UUIDv7, application-generated, stored as PostgreSQL `uuid`). This spike is the "short insert/index benchmark to confirm" the decision text itself called for, plus the migration plan for the full cutover.

## What this directory contains

- `benchmarks/pg-pk-benchmark.mjs` — the reproducible benchmark. Dependency-free beyond `pg` (already a pinned runtime dependency) and this repo's own `platform/id` UUIDv7 generator; creates two throwaway `UNLOGGED` tables, times a 200,000-row batched insert into each, then compares primary-key index size after `VACUUM (ANALYZE)`. Cleans up after itself.
- `benchmark-results.json` — three runs' results, captured 2026-09-25 against local PostgreSQL 16 (the CI/production service is PostgreSQL 17; directional evidence only, as the decision proposal itself frames SPIKE-03).
- `migration-plan.md` — the full D7 cutover is a breaking, high-blast-radius change (tenant identity flows through RLS policies, JWT claims, API paths and every existing test fixture). This spike implements only the UUIDv7 generator (`platform/id`) and this benchmark; the plan proposes how to execute the actual schema migration in reviewable phases, for confirmation before any tranche starts.

## Run

```
node docs/implementation/spikes/SPIKE-03/benchmarks/pg-pk-benchmark.mjs 200000
```

Requires a reachable PostgreSQL matching `SINTIUS_MIGRATION_DATABASE_URL` (defaults to the same local instance `npm run db:migrate` and the test suites use) with a role that can create and drop tables.

## Result

| | text (UUIDv4-shaped, today's scheme) | uuid (UUIDv7, D7's proposal) |
|---|---|---|
| Median insert time (200k rows, batched) | 1,954 ms | 1,689 ms |
| Median primary-key index size | 14.95 MiB | 8.33 MiB |

UUIDv7 confirms the expected B-tree locality benefit: **~44% smaller primary-key index** and an equal-or-faster batched insert at this row count, over a key shaped like today's `evt_<uuid>`/UUIDv4-style IDs, which carry no relationship to insertion order. This confirms D7's premise. It does not by itself size the cost of the migration — see `migration-plan.md` for that.
