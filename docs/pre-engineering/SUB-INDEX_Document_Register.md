# SUB-INDEX — Document Register

**Document ID:** SUB-INDEX
**Title:** Document Register
**Version:** 0.1 (Draft)
**Status:** Living document — updated after every new artifact
**Owner:** Technical Program Manager
**Created Date:** 2026-09-23
**Last Updated:** 2026-09-23 (Gate 4 complete — all 22 numbered documents drafted)
**Source:** [Subscription_Platform_Pre_Engineering_Documentation_Master_Prompt.md](../../Subscription_Platform_Pre_Engineering_Documentation_Master_Prompt.md)

This register tracks every document in the pre-engineering suite defined by the master prompt. Engineering implementation does not begin until Gate 4 is satisfied (§17 of the master prompt) and every document below is at minimum "Review" status (semantic version ≥ 0.5).

A second, independent documentation suite ([`docs/pre-implementation/`](../pre-implementation/README.md)) also covers this domain. The two are reconciled in [`docs/CANONICAL_SPEC_INDEX.md`](../CANONICAL_SPEC_INDEX.md) — read that before starting implementation. Implementation itself is gated by [`docs/HANDOVER_PROMPT_IMPLEMENTATION.md`](../HANDOVER_PROMPT_IMPLEMENTATION.md).

## Numbered documents

| Document ID | Name | Purpose | Dependencies | Status | Version |
|---|---|---|---|---|---|
| SUB-0000 | [Product Manifesto & Principles](SUB-0000_Product_Manifesto.md) | Immutable product philosophy, principles, differentiators, anti-goals | None | Draft | 0.1 |
| SUB-0001 | [Product Requirements Document](SUB-0001_Product_Requirements_Document.md) | Complete enterprise PRD: personas, journeys, BR/FR requirements | SUB-0000 | Draft | 0.1 |
| SUB-0002 | [Competitive Capability Matrix](SUB-0002_Competitive_Capability_Matrix.md) | Capability comparison against 9 reference platforms | SUB-0000, SUB-0001 | Draft | 0.1 |
| SUB-0003 | [MVP Scope & Release Strategy](SUB-0003_MVP_Scope_Release_Strategy.md) | MVP/R2/Enterprise capability classification and release strategy | SUB-0001, SUB-0002 | Draft | 0.1 |
| SUB-0004 | [Domain Model](SUB-0004_Domain_Model.md) | All domain entities, bounded contexts, aggregate roots | SUB-0001, SUB-0003 | Draft | 0.1 |
| SUB-0005 | [State Machine Specification](SUB-0005_State_Machine_Specification.md) | Formal state machines for 10 financially material entities | SUB-0004 | Draft | 0.1 |
| SUB-0006 | [Revenue Lifecycle Graph Specification](SUB-0006_Revenue_Lifecycle_Graph_Specification.md) | Core traceability concept: nodes, edges, lineage, broken-chain detection | SUB-0004, SUB-0005 | Draft | 0.1 |
| SUB-0007 | [Pricing & Rating Engine Specification](SUB-0007_Pricing_Rating_Engine_Specification.md) | Full pricing engine: 30 models, formulas, golden examples | SUB-0004, SUB-0005 | Draft | 0.1 |
| SUB-0008 | [Billing & Invoicing Specification](SUB-0008_Billing_Invoicing_Specification.md) | Billing cycles, invoice lifecycle, corrections | SUB-0007 | Draft | 0.1 |
| SUB-0009 | [Payments & Collections Specification](SUB-0009_Payments_Collections_Specification.md) | Payment orchestration, methods, Payment Success Engine, collections | SUB-0005, SUB-0008 | Draft | 0.1 |
| SUB-0010 | [Accounting & Revenue Specification](SUB-0010_Accounting_Revenue_Specification.md) | AR, cash application, revenue recognition, journal generation | SUB-0008, SUB-0009 | Draft | 0.1 |
| SUB-0011 | [System Architecture](SUB-0011_System_Architecture.md) | Logical architecture, C4/sequence diagrams, all 11 mandatory architecture ADRs | SUB-0004–SUB-0010 | Draft | 0.1 |
| SUB-0012 | [Data Architecture & ERD](SUB-0012_Data_Architecture_ERD.md) | Physical data model, ERD, partitioning, retention | SUB-0004, SUB-0011 | Draft | 0.1 |
| SUB-0013 | [API & Event Contracts](SUB-0013_API_Event_Contracts.md) | REST conventions, endpoint catalog, domain event catalog | SUB-0004–SUB-0011 | Draft | 0.1 |
| SUB-0014 | [Security, Privacy & Compliance Architecture](SUB-0014_Security_Privacy_Compliance_Architecture.md) | AuthN/AuthZ, tenant isolation, PCI/SOC2/ISO/GDPR alignment | SUB-0011–SUB-0013 | Draft | 0.1 |
| SUB-0015 | [UX Information Architecture & Interaction Specification](SUB-0015_UX_Information_Architecture_Interaction_Specification.md) | Navigation, 12 primary screens, interaction/accessibility rules | SUB-0004–SUB-0014 | Draft | 0.1 |
| SUB-0016 | [AI & Agent Governance Specification](SUB-0016_AI_Agent_Governance_Specification.md) | 6 agents, autonomy levels L0–L3, hallucination prevention | SUB-0001, SUB-0006, SUB-0014 | Draft | 0.1 |
| SUB-0017 | [Integration Architecture](SUB-0017_Integration_Architecture.md) | Connector architecture for ERP/CRM/payments/tax/messaging/data | SUB-0009, SUB-0011 | Draft | 0.1 |
| SUB-0018 | [Non-Functional Requirements](SUB-0018_Non_Functional_Requirements.md) | Measurable availability/performance/scale/security/accessibility targets | SUB-0001, SUB-0011 | Draft | 0.1 |
| SUB-0019 | [Test Strategy & Financial Correctness Framework](SUB-0019_Test_Strategy_Financial_Correctness_Framework.md) | Full test taxonomy, 8-invariant Financial Correctness Framework, golden scenarios | SUB-0005–SUB-0018 | Draft | 0.1 |
| SUB-0020 | [Engineering Implementation Blueprint](SUB-0020_Engineering_Implementation_Blueprint.md) | Repo structure, tech choices, coding standards, CI/CD | SUB-0011–SUB-0019 | Draft | 0.1 |
| SUB-0021 | [MVP Delivery Backlog](SUB-0021_MVP_Delivery_Backlog.md) | Epic → Feature → User Story → AC → Tasks → Test Cases for all 17 epics | SUB-0001–SUB-0020 | Draft | 0.1 |

## Companion documents

| Document ID | Name | Purpose | Status | Version |
|---|---|---|---|---|
| SUB-INDEX | [Document Register](SUB-INDEX_Document_Register.md) (this document) | Tracks every document's status and dependencies | Living | 0.1 |
| SUB-GLOSSARY | [Shared Glossary](SUB-GLOSSARY.md) | Single authoritative term definitions across the suite | Living | 0.1 |
| SUB-TRACEABILITY_MATRIX | [Requirements Traceability Matrix](SUB-TRACEABILITY_MATRIX.md) | BR → FR → Entity → State Machine → API → Event → UI → Security → Story → Test | Living | 0.1 |
| SUB-ADR-REGISTER | [Architectural Decision Records](SUB-ADR-REGISTER.md) | All major technical/domain decisions with alternatives and rationale | Living | 0.1 |

## Review gate status

| Gate | Required documents | Status |
|---|---|---|
| Gate 1 — Product Readiness | SUB-0000–SUB-0006 | **Complete** (Draft v0.1) — pending human review to advance to v0.5 |
| Gate 2 — Financial Domain Readiness | SUB-0007–SUB-0010 | **Complete** (Draft v0.1) — pending human review to advance to v0.5 |
| Gate 3 — Architecture Readiness | SUB-0011–SUB-0018 | **Complete** (Draft v0.1) — pending human review to advance to v0.5 |
| Gate 4 — Engineering Readiness | SUB-0019–SUB-0021 | **Complete** (Draft v0.1) — pending human review to advance to v0.5, then v1.0 Approved Baseline |

Per the master prompt §17, engineering implementation does not begin until Gate 4 is satisfied. All four gates are now structurally complete at Draft v0.1; per master prompt §16/§20, engineering implementation additionally requires every document to advance to Approved Baseline (v1.0) through human review, and requires resolution of the highest-priority entries in the Human Decision Register (SUB-0001 §19) — this register does not declare that review or those decisions complete on its own authority.

## Change log

| Date | Change |
|---|---|
| 2026-09-23 | Register created; Gate 1 (SUB-0000–SUB-0006) documents drafted at v0.1. |
| 2026-09-23 | Gate 2 (SUB-0007–SUB-0010) documents drafted at v0.1: Pricing & Rating Engine, Billing & Invoicing, Payments & Collections, Accounting & Revenue. |
| 2026-09-23 | Gate 3 (SUB-0011–SUB-0018) documents drafted at v0.1: System Architecture (all 11 mandatory ADRs), Data Architecture & ERD, API & Event Contracts, Security/Privacy/Compliance, UX Information Architecture, AI & Agent Governance, Integration Architecture, Non-Functional Requirements. |
| 2026-09-23 | Gate 4 (SUB-0019–SUB-0021) documents drafted at v0.1: Test Strategy & Financial Correctness Framework, Engineering Implementation Blueprint, MVP Delivery Backlog. All 22 numbered documents and all 4 companion registers now exist at Draft v0.1. |
