# Jira import package

This directory is generated from the root master product specification. Do not hand-edit the CSV files; run `npm.cmd run backlog:generate` after changing source requirements or curated mappings.

Current generated baseline:

- 1,540 source candidates dispositioned: 1,335 accepted delivery requirements and 205 parent/context records.
- 17 canonical epics and 270 stories: 103 preserved canonical stories plus 167 source-derived gap stories.
- 1,567 acceptance criteria and 1,469 associated tests.
- 1,335/1,335 accepted requirements linked to a story, acceptance criterion and test.
- 0/1,335 accepted requirements currently carry implementation evidence; Jira import does not imply delivery completion.

## Files

- `sintius-jira-issues.csv` — 17 epics plus the complete canonical and source-derived story backlog.
- `sintius-requirement-traceability.csv` — one row for every extracted source candidate, including disposition, source location, story, acceptance-criterion and test links.
- `sintius-test-catalogue.csv` — associated tests, planned automation state and evidence placeholder.

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
| Acceptance Criteria | A multiline text custom field named `Acceptance Criteria` |
| Requirement IDs | A multiline/text custom field named `Requirement IDs` |
| Test IDs | A multiline/text custom field named `Test IDs` |
| Implementation Phase | A text or select custom field |

Import epics and stories in the same job when Jira supports `Issue ID`/`Parent`. If the target Jira configuration does not expose `Parent`, import epics first and map `Epic Link` in a second story import. Preserve `External ID`; it is the stable update and reconciliation key.

The traceability and test CSVs are governance registers rather than Jira issues. They can be imported into Jira Assets, a test-management application, or retained beside Jira as controlled evidence. No row claims implementation or passing test evidence unless that evidence exists.
