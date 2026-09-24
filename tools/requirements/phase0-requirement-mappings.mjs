const accepted = (requirementId, implementationPhase, epicIds, storyIds, testIds, atomicStatement, notes = "") => ({
  requirementId,
  validationStatus: "validated",
  disposition: "accepted",
  atomicityStatus: "validated_atomic",
  implementationPhase,
  epicIds,
  storyIds,
  testIds,
  atomicStatement,
  notes
});

const context = (requirementId, atomicStatement, notes) => ({
  requirementId,
  validationStatus: "validated",
  disposition: "parent_context",
  atomicityStatus: "context_only",
  implementationPhase: "Cross-cutting",
  epicIds: [],
  storyIds: [],
  testIds: [],
  atomicStatement,
  notes
});

export const phase0RequirementMappings = [
  context("MSR-100-0C82DBEBDC", "Critical invariants are non-negotiable.", "Parent policy statement; the ten following atomic invariants carry implementation mappings."),
  accepted("MSR-100-D1A3F8F46A","Phase 0",["SUB-E001"],["US-BL-001-02"],["TC-001-02-01","TC-001-02-02"],"Retries must never create a duplicate charge."),
  accepted("MSR-100-F2DB09F026","Phase 2",["SUB-E011"],["US-BL-011-01","US-BL-011-02"],["TC-011-01-02","TC-011-02-01"],"Every acknowledged usage event must remain durably recoverable."),
  accepted("MSR-100-7C5198108C","Phase 2",["SUB-E008"],["US-BL-008-01","US-BL-008-04"],["TC-008-01-02","TC-008-04-01"],"A posted invoice must never be mutated; corrections require linked corrective documents."),
  accepted("MSR-100-E5C72CE8EF","Phase 2",["SUB-E008"],["US-BL-008-02","US-BL-008-03","US-BL-008-04"],["TC-008-02-02","TC-008-03-02","TC-008-04-02"],"Financial-ledger history must be append-only and corrected through balanced entries."),
  accepted("MSR-100-C2940C4995","Phase 1",["SUB-E002","SUB-E005"],["US-BL-002-03","US-BL-005-06"],["TC-002-03-02","TC-005-06-01","TC-005-06-02"],"Pricing activation must require authorized maker-checker approval."),
  accepted("MSR-100-2B6E40A9E3","Phase 0",["SUB-E001","SUB-E017"],["US-BL-001-04","US-BL-017-03"],["TC-001-04-01","TC-001-04-02","TC-017-03-01","TC-017-03-02"],"No tenant must be able to access another tenant's data."),
  accepted("MSR-100-C5EBB5FF61","Phase 5",["SUB-E015"],["US-BL-015-02"],["TC-015-02-01","TC-015-02-02"],"AI-generated financial explanations must contain only grounded, verifiable facts."),
  accepted("MSR-100-D9D23B15BD","Phase 0",["SUB-E005","SUB-E017"],["US-BL-005-05","US-BL-017-01"],["TC-005-05-01","TC-005-05-02","TC-017-01-01"],"Every financial transaction must retain end-to-end source and decision traceability."),
  accepted("MSR-100-445596E4C7","Phase 1",["SUB-E004","SUB-E005","SUB-E008"],["US-BL-004-01","US-BL-005-06","US-BL-008-04"],["TC-004-01-02","TC-005-06-02","TC-008-04-01"],"A pricing change must not apply retroactively unless represented by an explicit correction."),
  accepted("MSR-100-89A23734C0","Phase 5",["SUB-E015","SUB-E017"],["US-BL-015-01","US-BL-017-01"],["TC-015-01-02","TC-017-01-01"],"An AI action must not modify customer financial state without immutable audit evidence."),

  accepted("MSR-103-F379003A15","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"A feature is not complete merely because its interface exists."),
  context("MSR-103-358B046B85", "The Definition of Done comprises the following atomic evidence requirements.", "Parent statement; child requirements carry mappings."),
  accepted("MSR-103-64CE049BC6","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable domain rules must be implemented before a story is complete."),
  accepted("MSR-103-DD99C57C99","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable APIs must be implemented before a story is complete."),
  accepted("MSR-103-2543D58A94","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable user interfaces must be implemented before a story is complete."),
  accepted("MSR-103-8AE91EFF47","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable authorization controls must be implemented before a story is complete."),
  accepted("MSR-103-25618C084B","Phase 0",["SUB-E001","SUB-E017"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable audit evidence must be implemented before a story is complete."),
  accepted("MSR-103-C447F1FCFA","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Expected and unexpected errors must be handled before a story is complete."),
  accepted("MSR-103-E45C091D3E","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable accessibility requirements must be validated before a story is complete."),
  accepted("MSR-103-9A1A617D13","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable observability must be implemented before a story is complete."),
  accepted("MSR-103-84C4CAE9C7","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"All required automated tests must pass before a story is complete."),
  accepted("MSR-103-DC2B7965A0","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"Applicable APIs must be documented before a story is complete."),
  accepted("MSR-103-8C502917E0","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-01"],"The affected user workflow must be documented before a story is complete."),
  accepted("MSR-103-58FA0E5A12","Phase 0",["SUB-E001"],["US-MSR-103-DOD"],["TC-US-MSR-103-DOD-02"],"Financial reconciliation must be tested before an applicable story is complete.")
];

phase0RequirementMappings.push(
  context("MSR-060-1D5278356F", "Audit records contain the following atomic evidence fields.", "Parent context for the following audit-field requirements."),
  ...[
    ["MSR-060-D685CE4383","Every audit record must identify the actor."],
    ["MSR-060-72A98A23A1","Every audit record must identify the action."],
    ["MSR-060-8863CC87AA","Every audit record must identify the affected object."],
    ["MSR-060-7A4D1C60B6","Every audit record must identify when the action occurred."],
    ["MSR-060-84A0B159CD","Every audit record must identify the trusted request or workload origin."],
    ["MSR-060-03F1D3C250","Every audit record must preserve a safe before-state reference."],
    ["MSR-060-7A6587E28A","Every audit record must preserve a safe after-state reference."],
    ["MSR-060-987796DF8F","Every audit record must capture the action reason."]
  ].map(([id, statement]) => accepted(id,"Phase 0",["SUB-E017"],["US-BL-017-01"],["TC-017-01-01","TC-017-01-02"],statement)),
  context("MSR-060-65FD06CA1F", "AI audit records contain the following additional fields.", "Parent context for AI-specific audit-field requirements."),
  ...[
    ["MSR-060-D71BCB321D","Every AI audit record must identify the model and version."],
    ["MSR-060-4E2B7E4C92","Every AI audit record must retain a safe prompt/context reference."],
    ["MSR-060-E62965BC5A","Every AI audit record must identify the tool or action invoked."],
    ["MSR-060-4DD1180FFA","Every AI audit record must identify the governing decision policy."],
    ["MSR-060-647E2C1605","Every AI audit record must identify any required human approval."],
    ["MSR-060-658F940653","Every AI audit record must capture the outcome."]
  ].map(([id, statement]) => accepted(id,"Phase 5",["SUB-E015","SUB-E017"],["US-BL-015-01","US-BL-017-01"],["TC-015-01-02","TC-017-01-01"],statement)),

  context("MSR-061-2C887FB071", "The RBAC catalogue covers the following product personas.", "Parent context for persona-role requirements."),
  ...[
    ["MSR-061-7A36036152","Billing Administrator"],["MSR-061-1B4B96A6E3","Pricing Manager"],
    ["MSR-061-AD99726B55","Collections Agent"],["MSR-061-10DF979CB3","Customer Support"],
    ["MSR-061-FC23E1A2AC","Finance Controller"],["MSR-061-5B5141CF8A","Revenue Accountant"],
    ["MSR-061-090E641078","Sales"],["MSR-061-63FDAF8F3E","Product Manager"],
    ["MSR-061-C9828F9E74","Operations"],["MSR-061-5C468F3F8B","Developer"],
    ["MSR-061-A7460DEF70","Auditor"],["MSR-061-3232EC982D","Executive"]
  ].map(([id, persona]) => accepted(id,"Phase 0",["SUB-E002"],["US-BL-002-03"],["TC-002-03-01"],`The role catalogue must define least-privilege permissions for the ${persona} persona.`)),
  accepted("MSR-061-2B41953787","Phase 0",["SUB-E002"],["US-BL-002-03"],["TC-002-03-01"],"Authorization must support tenant-scoped RBAC and optional attribute-based policy constraints."),

  accepted("MSR-062-8989FE4287","Phase 0",["SUB-E002"],["US-BL-002-03"],["TC-002-03-02"],"Maker-checker approval policy must be tenant-configurable."),
  context("MSR-062-A0B935EEF8", "The following approval cases are required examples.", "Parent context for approval-policy examples."),
  accepted("MSR-062-BC82DFEC91","Phase 1",["SUB-E002","SUB-E005"],["US-BL-002-03","US-BL-005-06"],["TC-002-03-02","TC-005-06-01"],"A discount above 20 percent must require configured approval."),
  accepted("MSR-062-2876276E95","Phase 3",["SUB-E002","SUB-E009"],["US-BL-002-03","US-BL-009-06"],["TC-002-03-02","TC-009-06-01"],"A refund above 10,000 dollars must require configured approval."),
  accepted("MSR-062-B080DE07A3","Phase 1",["SUB-E002","SUB-E005"],["US-BL-002-03","US-BL-005-06"],["TC-002-03-02","TC-005-06-01","TC-005-06-02"],"Pricing activation must require Product and Finance approval."),
  accepted("MSR-062-58A24733E1","Phase 2",["SUB-E002","SUB-E008"],["US-BL-002-03","US-BL-008-04"],["TC-002-03-02","TC-008-04-02"],"A write-off above the configured threshold must require Controller approval."),

  context("MSR-082-0F1E526906", "The tenancy architecture supports the following deployment modes.", "Parent context for deployment-mode requirements."),
  accepted("MSR-082-83D62B3FFC","Phase 0",["SUB-E001","SUB-E002"],["US-BL-001-04","US-BL-002-01"],["TC-001-04-01","TC-002-01-03"],"The platform must support shared multi-tenant SaaS with enforced isolation."),
  accepted("MSR-082-7D8E5BC459","Enterprise",["SUB-E002"],["FUT-E002-01"],["TC-E002-01-01","TC-E002-01-02"],"The platform must support dedicated enterprise deployments."),
  accepted("MSR-082-A110A8A3AA","Phase 0",["SUB-E001","SUB-E017"],["US-BL-001-04","US-BL-017-03"],["TC-001-04-01","TC-017-03-01"],"Strong tenant isolation is mandatory at application and database layers."),

  context("MSR-099-C4C8937702", "The comprehensive quality strategy contains the following test classes.", "Parent context for test-class requirements."),
  ...[
    ["MSR-099-3545E088B4","unit"],["MSR-099-AE15FC3AB2","integration"],
    ["MSR-099-FAD1F141E0","contract"],["MSR-099-3BD4B26263","payment simulation"],
    ["MSR-099-D5B3C5E94F","billing golden"],["MSR-099-4A1081054B","property-based pricing"],
    ["MSR-099-4F087E29FA","load"],["MSR-099-8FCAAE76B0","failover"],
    ["MSR-099-66FC858421","security"],["MSR-099-F29E63D886","financial reconciliation"]
  ].map(([id, testClass]) => accepted(id,"Phase 0",["SUB-E001"],["US-MSR-099-TEST-STRATEGY"],["TC-US-MSR-099-TEST-STRATEGY-01"],`The delivery pipeline must include an applicable ${testClass} test suite.`)),
  accepted("MSR-099-26FB7756F4","Phase 0",["SUB-E001"],["US-MSR-099-TEST-STRATEGY"],["TC-US-MSR-099-TEST-STRATEGY-02"],"Financial calculation tests must use deterministic, versioned golden datasets.")
);
