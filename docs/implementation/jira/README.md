# Jira import package

This directory is generated from the root master product specification. Do not hand-edit the CSV files; run `npm.cmd run backlog:generate` after changing source requirements or curated mappings.

Current generated baseline:

- 1,540 source candidates dispositioned: 1,335 accepted delivery requirements and 205 parent/context records.
- 17 canonical epics and 270 stories: 103 preserved canonical stories plus 167 source-derived gap stories.
- 1,567 acceptance criteria and 1,469 associated tests.
- 1,335/1,335 accepted requirements linked to a story, acceptance criterion and test.
- 18/1,335 accepted requirements currently carry implementation evidence (`docs/implementation/implementation-evidence.json`); a story's `Status`/`Implementation Status` below reflects delivery, not the same evidence count — a story can be `implemented` while the specification requirements it maps to still await review.

## Files

- `sintius-jira-issues.csv` — 17 epics plus the complete canonical and source-derived story backlog, in one file. `Status`, `Implementation Status` and `Progress` are derived every run from each story's durable status in `docs/implementation/implementation-roadmap-data.js`; an epic's `Status` rolls up from every story assigned to it (canonical and source-derived).
- `sintius-jira-epics.csv` / `sintius-jira-stories.csv` — the same rows, split by issue type, for a **two-pass import** (below). Use these two instead of the combined file when the target Jira project's importer needs epics to exist before it can link stories to them (typical for team-managed projects).
- `sintius-requirement-traceability.csv` — one row for every extracted source candidate, including disposition, source location, story, acceptance-criterion and test links.
- `sintius-test-catalogue.csv` — associated tests, planned automation state and evidence placeholder.
- `jira-epic-keys.json` — editable source (see "Two-pass import" below), not generated.

## Two-pass import (epics, then stories)

1. Import `sintius-jira-epics.csv` first. Jira assigns each epic a real issue key (e.g. `SINT-1`).
2. Record those keys in `jira-epic-keys.json` (editable source, not generated) — `{"SUB-E001": "SINT-1", "SUB-E002": "SINT-2", ...}`, keyed by each epic's `External ID` from `sintius-jira-epics.csv`.
3. Run `npm run backlog:generate`. `sintius-jira-stories.csv` regenerates with each story's `Epic Link` set to the real Jira key you just recorded, instead of the internal epic ID (`SUB-E00x`) — so the story import can link directly to an *existing* epic rather than asking Jira to create/match one by name.
4. Import `sintius-jira-stories.csv`.

An epic missing from `jira-epic-keys.json` still gets its stories generated; their `Epic Link` just falls back to the internal epic ID, which Jira's field-mapping screen can still resolve manually (map each distinct `Epic Link` value found in the file to an existing epic) — the mapping file only saves you from doing that by hand for every epic.

## Jira CSV import mapping

Use Jira's external system CSV importer and map columns as follows:

| CSV column | Jira field |
|---|---|
| Issue ID | Issue ID |
| Issue Type | Issue Type |
| Summary | Summary |
| Description | Description |
| Epic Name | Epic Name (company-managed projects) |
| Epic Link | Epic Link (company-managed projects) |
| Parent | Parent (team-managed or current Jira hierarchy) |
| External ID | A text custom field named `External ID` |
| Status | Status (maps to Jira's default To Do / In Progress / Done; see below) |
| Implementation Status | A text or select custom field named `Implementation Status` (preserves `not_started` / `in_progress` / `implemented` / `blocked`, since Jira's default workflow has no `Blocked` status) |
| Progress | A number custom field named `Progress` (0–100) |
| Acceptance Criteria | A multiline text custom field named `Acceptance Criteria` |
| Requirement IDs | A multiline/text custom field named `Requirement IDs` |
| Test IDs | A multiline/text custom field named `Test IDs` |
| Implementation Phase | A text or select custom field |

Import epics and stories in the same job when Jira supports `Issue ID`/`Parent`. If the target Jira configuration does not expose `Parent`, import epics first and map `Epic Link` in a second story import. Preserve `External ID`; it is the stable update and reconciliation key — every subsequent status sync (manual re-import or the automated pipeline below) matches on it, never on Jira's own issue key.

The traceability and test CSVs are governance registers rather than Jira issues. They can be imported into Jira Assets, a test-management application, or retained beside Jira as controlled evidence. No row claims implementation or passing test evidence unless that evidence exists.

## Keeping Jira status in sync after the initial import

A one-time CSV import gives you the backlog shape (epics, stories, acceptance criteria, links) but its `Status` is a snapshot from generation time. Two ways to keep it current, in increasing order of effort:

1. **Re-import periodically.** Re-run `npm run backlog:generate` (or let CI do it) and re-import `sintius-jira-issues.csv` through Jira's CSV importer using **update** mode keyed on `External ID`. Jira's importer only touches fields present in the CSV, so this updates `Status`/`Implementation Status`/`Progress` without disturbing sprint assignments, comments or manual triage. Low effort, not real-time.
2. **Push status transitions from CI on every merge to `master`** (the recommended pipeline — see the proposal in this session's reply, or a future `docs/implementation/jira-sync.md` if this is adopted). A CI step reads the same `implementation-roadmap-data.js` this file is generated from, diffs it against the last-synced state, and calls the Jira REST API (`POST /rest/api/3/issue/{key}/transitions`, matched by `External ID` via a saved JQL search or a stored `External ID → issue key` map) to move only the stories whose status changed. Real-time, requires a Jira API token as a CI secret and someone to own the mapping.
