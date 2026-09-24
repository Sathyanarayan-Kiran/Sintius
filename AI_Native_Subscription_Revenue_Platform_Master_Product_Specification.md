# AI-Native Subscription & Revenue Management Platform
## Master Product Specification Prompt

You are acting as a combined:

- Chief Product Officer
- Subscription-economy domain architect
- Payments architect
- ERP/financial systems architect
- Principal software architect
- UX design lead
- Data architect
- AI/ML architect
- FinOps architect
- Security architect
- Compliance architect
- SaaS engineering lead

Your assignment is to **design and implement a production-grade, enterprise subscription and revenue management platform from first principles**.

The solution must provide functionality comparable to or exceeding leading platforms such as:

- SAP BRIM
- Chargebee
- Recurly
- Zuora
- Stripe Billing
- Paddle
- Maxio
- Oracle Subscription Management
- Salesforce Revenue Cloud

Do not copy their user interfaces, terminology, proprietary workflows or implementation patterns.

Instead, understand the business capabilities these platforms address and create a **next-generation architecture and user experience** that materially simplifies how businesses:

> Design → Sell → Subscribe → Consume → Meter → Rate → Bill → Invoice → Collect → Reconcile → Recognize → Renew → Retain → Expand.

The system should support B2C, B2B, B2B2C and marketplace business models.

---

# 1. PRODUCT VISION

Build the world's most intuitive and intelligent **Subscription & Revenue Operating System**.

The platform must enable organizations to launch new monetization models quickly while providing subscribers with a frictionless experience for understanding, managing and paying for their subscriptions.

The product should solve five fundamental problems.

### Business agility

Businesses should be able to create or change products, prices, bundles, billing rules and promotions **without engineering deployments**.

### Revenue assurance

Every legitimate billable event should:

1. be captured,
2. be priced correctly,
3. become billable,
4. be invoiced,
5. be collected,
6. be reconciled,
7. be recognized appropriately.

Revenue leakage must be detectable automatically.

### Payment success

The system should actively maximize the probability that an invoice gets paid.

Collections should therefore be an intelligent orchestration problem rather than simply:

> Payment fails → retry card → send email → suspend account.

### Subscriber experience

Subscribers should always be able to understand:

- what they subscribed to,
- what they consumed,
- why they were charged,
- when payment is due,
- how they can pay,
- what happens if they do not pay,
- how they can change their subscription.

### Operational simplicity

Complicated subscription operations should become visual, configurable and explainable.

---

# 2. PRIMARY PRODUCT PRINCIPLE

Design the product around the concept:

# Revenue Lifecycle Graph

Represent every commercial relationship as an interconnected graph.

Example:

Customer  
→ Account  
→ Contract  
→ Subscription  
→ Product  
→ Entitlement  
→ Usage  
→ Charge  
→ Invoice  
→ Payment  
→ Settlement  
→ Revenue Event  
→ Ledger Entry.

Every downstream transaction must be traceable back to its originating commercial event.

A user looking at a payment should be able to navigate backward to:

Payment  
→ Invoice  
→ Charge  
→ Usage event  
→ Subscription  
→ Contract  
→ Offer  
→ Product.

And vice versa.

This traceability must be native to the platform.

---

# 3. TARGET CUSTOMERS

Architect the platform to serve:

### Digital/SaaS
- software subscriptions
- cloud platforms
- API businesses
- developer platforms
- AI-token services
- storage
- compute

### Media
- streaming
- news
- gaming
- creator subscriptions

### Telecom
- mobile plans
- broadband
- IoT
- usage-based telecommunications

### Utilities
- electricity
- water
- EV charging
- distributed energy

### Financial services
- account fees
- premium memberships
- data services

### Mobility
- vehicle subscriptions
- fleet services
- charging
- insurance add-ons

### Industrial
- Equipment-as-a-Service
- Machine-as-a-Service
- outcome-based contracts
- predictive maintenance subscriptions

### Consumer services
- memberships
- health clubs
- education
- food delivery
- premium memberships

---

# 4. BUSINESS MODELS

The pricing engine must be able to combine multiple pricing models within the same customer contract.

Support:

- flat recurring price
- one-time charge
- per-seat
- per-device
- per-location
- per-user
- volume pricing
- tiered pricing
- graduated pricing
- package pricing
- block pricing
- usage pricing
- consumption pricing
- prepaid consumption
- postpaid consumption
- minimum commitment
- spend commitment
- minimum + overage
- maximum caps
- stair-step pricing
- progressive pricing
- matrix pricing
- attribute-based pricing
- event-based pricing
- peak/off-peak pricing
- time-of-day pricing
- seasonal pricing
- dynamic pricing
- negotiated contract pricing
- freemium
- free trial
- paid trial
- promotional pricing
- introductory pricing
- loyalty pricing
- ramp pricing
- index-linked pricing
- inflation-linked increases
- outcome-based pricing
- milestone-based billing
- percentage-of-value billing
- revenue-share
- marketplace commission
- hybrid pricing

A single subscription must be capable of combining models.

Example:

Enterprise AI Platform

Base fee: $2,000/month  
+ 100 included seats  
+ $15/additional seat  
+ first 10M tokens included  
+ $0.001 per additional token  
+ premium support at 5% of monthly spend  
+ minimum annual commitment of $36,000.

This configuration must not require source-code changes.

---

# 5. PRODUCT CATALOG

Implement a hierarchical versioned product catalog.

Model:

Portfolio  
→ Product Family  
→ Product  
→ Product Version  
→ Offer  
→ Plan  
→ Rate Card  
→ Charge  
→ Entitlement.

Support:
- physical products
- digital products
- subscriptions
- services
- bundles
- add-ons
- optional features
- mandatory features
- dependencies
- mutually exclusive products
- cross-product rules.

Every commercial object must support:
- effective-from date
- effective-to date
- version
- market
- currency
- customer segment
- channel
- geography
- tax category
- accounting classification.

Never mutate historical pricing.

Create effective-dated versions instead.

---

# 6. VISUAL PRICING DESIGNER

Pricing configuration is one of the primary areas where this product must differentiate itself.

Create a visual pricing canvas.

Users should be able to construct:

IF

Usage <= 1,000

THEN

Price = ₹10/unit

ELSE IF

Usage <= 10,000

THEN

Price = ₹8/unit

ELSE

Price = ₹6/unit.

Support drag-and-drop:

INPUT

→ DIMENSION

→ RULE

→ RATE

→ DISCOUNT

→ CAP

→ COMMITMENT

→ OUTPUT.

Allow users to test pricing scenarios before activation.

Example:

"Show what this pricing model would have charged our last 10,000 customers."

Provide:
- revenue impact
- ARPU change
- margin impact
- customer winners/losers
- churn-risk cohorts
- bill shock risk.

---

# 7. PRICE EXPERIMENTATION

Include an experimentation system supporting:
- A/B pricing
- geography experiments
- packaging experiments
- trial length experiments
- discount experiments
- renewal pricing experiments.

Never retroactively modify contractual prices.

Cohort membership must be permanently auditable.

---

# 8. SUBSCRIPTION LIFECYCLE

Support:

Create → Activate → Trial → Convert → Upgrade → Downgrade → Add Product → Remove Product → Increase Quantity → Reduce Quantity → Suspend → Pause → Resume → Renew → Extend → Terminate → Reinstate → Win Back.

Every lifecycle event must:
- be effective-dated,
- generate an event,
- preserve history,
- evaluate billing impact,
- evaluate entitlement impact,
- determine proration,
- evaluate revenue recognition impact.

---

# 9. CONTRACT MANAGEMENT

Support formal enterprise subscription contracts.

Contract fields should include:
- contracting parties
- contract number
- start/end date
- renewal policy
- notice period
- minimum commitment
- payment terms
- negotiated pricing
- SLAs
- amendment history
- cancellation terms
- indexation rules
- purchase-order information.

Support contract amendments without destroying original history.

Examples:
- add product
- extend term
- modify volume commitment
- ramp pricing
- change billing frequency
- renegotiate price.

---

# 10. CPQ / QUOTE-TO-SUBSCRIBE

Implement configurable quote management.

Flow:

Opportunity → Quote → Configure Product → Price → Discount → Approval → Contract → Subscription.

Provide guided selling.

Examples:
- "What package should I sell this customer?"
- "What discount can I provide without approval?"
- "Which bundle produces the best value?"

Support integration with:
- Salesforce
- Dynamics
- HubSpot
- SAP
- Oracle.

---

# 11. ENTITLEMENT MANAGEMENT

Billing and entitlement must be separate concepts.

Example:

Subscription = Enterprise Plan

Entitlements:
- 200 users
- analytics enabled
- 5 TB storage
- premium support
- 20M monthly API calls.

Expose entitlement APIs usable by downstream products.

Applications should be able to call:

`GET /customer/{id}/entitlements`

to determine what the customer may access.

---

# 12. USAGE & METERING ENGINE

Create a hyperscale event ingestion layer.

Support events such as:
- API_CALL
- AI_TOKEN
- STORAGE_GB_HOUR
- ENERGY_KWH
- MESSAGE_SENT
- TRANSACTION
- STREAM_MINUTE
- ACTIVE_USER
- DEVICE_HOUR.

Events must contain:

- event_id
- timestamp
- customer_id
- subscription_id
- meter_id
- quantity
- dimensions
- source

Examples of dimensions:
- region
- model
- device
- product
- service tier.

The platform must detect:
- duplicates
- missing events
- late events
- malformed events
- outliers.

Support event corrections without destroying audit history.

---

# 13. REAL-TIME RATING ENGINE

Usage should optionally be priced immediately.

Pipeline:

Usage Event → Validate → Enrich → Aggregate → Apply Allowance → Rate → Discount → Tax Classification → Charge Event.

Support millions of events per minute horizontally.

Rating must be:
- deterministic
- idempotent
- explainable
- replayable.

---

# 14. BILLING ENGINE

Support:
- anniversary billing
- calendar billing
- daily
- weekly
- monthly
- quarterly
- semiannual
- annual
- custom billing schedules
- milestone billing
- event-triggered billing.

Support billing in:
- advance
- arrears
- mixed mode.

Handle:
- proration
- partial periods
- adjustments
- reversals
- credits
- refunds
- write-offs
- deposits.

---

# 15. BILL PREVIEW

Before finalizing any invoice allow:

Preview Invoice.

Show:

Subscription → usage → pricing rule → discounts → credits → tax → invoice amount.

Finance users must be able to inspect the calculation tree.

Implement:

"Why is this charge ₹7,842?"

The system should provide a deterministic explanation rather than an AI hallucination.

---

# 16. CONVERGENT INVOICING

Multiple subscription or charge streams should be combinable.

Example:

Customer has:
- Internet
- Cloud Storage
- Mobile
- AI Services
- Support

Allow:
- one invoice
- or multiple invoices

based upon configurable invoice-grouping rules.

Group by:
- account
- legal entity
- PO
- currency
- business unit
- contract
- product family.

---

# 17. INVOICE EXPERIENCE

Invoices must be interactive rather than merely PDFs.

Subscriber should be able to click a charge and inspect:
- usage
- applicable rate
- allowance
- discounts
- credits
- tax.

Support:
- PDF
- HTML
- JSON
- XML
- UBL/e-invoice formats.

Allow customizable invoice templates.

---

# 18. ACCOUNTS RECEIVABLE

Implement a full subledger.

Support:
- invoices
- debit notes
- credit notes
- unapplied cash
- partial payments
- overpayments
- deposits
- payment plans
- write-offs
- disputes
- refunds.

Maintain customer account balance in near real-time.

---

# 19. PAYMENT ORCHESTRATION

Do not tightly couple the system to one payment processor.

Create a Payment Orchestration Layer.

Architecture:

Subscription Platform → Payment Orchestrator → Gateway A / Gateway B / Gateway C / Bank / Wallet / UPI.

Support intelligent routing based on:
- geography
- currency
- amount
- acceptance rate
- gateway health
- transaction cost
- fraud risk
- payment method.

---

# 20. PAYMENT METHODS

Design global payment-method support.

Examples:
- Cards
- Bank transfer
- ACH
- SEPA Direct Debit
- BACS
- UPI
- UPI AutoPay
- Net Banking
- Wallets
- Apple Pay
- Google Pay
- PayPal
- BNPL
- Direct debit
- Virtual accounts
- Wire transfer
- Cash collection partners
- Cheque
- Purchase-order settlement.

Payment-method support must be connector-driven.

---

# 21. SMART PAYMENT ROUTING

Optimize payment routing.

Example:

Customer located in India  
INR transaction  
UPI mandate available

→ UPI.

European customer

→ SEPA.

Card transaction rejected at Gateway A

→ evaluate whether retry through Gateway B is permitted and sensible.

Keep routing policy configurable.

---

# 22. PAYMENT SUCCESS ENGINE

Build a machine-learning-supported Payment Success Engine.

Predict:

`P(payment success | customer, payment method, gateway, timestamp, history)`.

Use this to determine:
- retry time
- retry mechanism
- preferred gateway
- communication timing
- payment method recommendation.

Provide deterministic fallback rules whenever AI is unavailable.

---

# 23. COLLECTIONS INTELLIGENCE

Create a Collection Risk Score.

Predict likelihood of late or failed payment.

Possible signals:
- historical payment behavior
- payment-method expiry
- failed authorization history
- invoice size deviation
- contract value
- payment method
- country
- payment-day behavior
- payment promise history
- dispute behavior.

Return:

Payment Risk: LOW / MEDIUM / HIGH

with explainable contributing factors.

Never use sensitive protected attributes.

---

# 24. PRE-DUE COLLECTIONS

Example:

Invoice due September 30.

System predicts high likelihood of failure.

September 23:
"Your payment method expires this month."

September 26:
"Your upcoming invoice is ₹18,400."

September 29:
"Payment is due tomorrow. Confirm payment method."

September 30:
Attempt collection at historically successful time.

The objective is:

# Prevent delinquency, not merely recover from it.

---

# 25. OMNICHANNEL COLLECTIONS

Create communication orchestration across:
- email
- SMS
- WhatsApp
- mobile push
- in-app
- customer portal
- chatbot
- account-manager task.

Collections workflow designer:

Payment Due  
↓  
Has autopay?  
YES → schedule collection  
NO → send reminder  
↓  
Payment successful?  
YES → receipt  
NO  
↓  
Risk score?  
HIGH → alternative payment recommendation  
MEDIUM → retry  
LOW → standard reminder.

Make workflows configurable through a visual designer.

---

# 26. PAYMENT LINKS

Every reminder should optionally contain:

# Pay Now

Generate secure, expiring payment links.

The subscriber should be able to complete payment with minimal steps.

No login should be mandatory when security policy permits payment through a signed link.

---

# 27. ONE-CLICK PAYMENT EXPERIENCE

For existing verified payment methods:

"Your subscription payment of ₹1,499 is due tomorrow."

[Pay ₹1,499]

[Change payment method]

[Need help]

Do not deliberately introduce friction.

---

# 28. SUBSCRIBER PAYMENT INBOX

Create a unified subscriber billing inbox.

Display:
- Upcoming amount and due date
- Overdue balances
- Credits
- Autopay status
- Payment method.

Allow subscribers to pay multiple invoices together where supported.

---

# 29. PAYMENT CALENDAR

Give subscribers a calendar showing:
- upcoming charges
- expected invoice amounts
- renewals
- trial endings
- promotional expiries
- scheduled price changes.

This reduces surprise and bill shock.

---

# 30. BILL SHOCK PREVENTION

Continuously monitor expected consumption.

Example:

"You have consumed 85% of your monthly API allocation."

"At your current usage rate your bill may reach approximately ₹14,300 versus your normal ₹8,000."

Offer:
- Upgrade plan
- Set usage limit
- Alert at threshold
- Continue

This should be a core customer-trust capability.

---

# 31. FLEXIBLE PAYMENT ARRANGEMENTS

Depending upon merchant policy permit subscribers to:
- request extension
- split invoice
- establish installment plan
- change billing day
- select alternative payment method
- use wallet balance
- redeem credits.

Merchant defines eligibility rules.

AI can recommend but may not independently approve exceptions outside policy.

---

# 32. CUSTOMER SELF-SERVICE PORTAL

The portal must feel closer to a polished consumer fintech product than enterprise billing software.

Navigation:

Home  
Subscriptions  
Usage  
Bills  
Payments  
Payment Methods  
Orders  
Credits  
Support.

Users can:
- upgrade
- downgrade
- pause
- resume
- add seats
- remove seats
- buy add-ons
- cancel
- renew
- change billing frequency
- update payment methods
- download invoices
- inspect usage
- pay balances
- configure alerts.

---

# 33. EXPLAINABLE BILLING

Include:

# Explain My Bill

Subscriber asks:

"Why is my bill higher than last month?"

System should ground its response in actual bill data.

Example:

"Your September bill increased by ₹1,240. ₹920 resulted from 460 additional premium API requests and ₹320 resulted from adding two seats on September 12."

Every explanation should reference actual underlying transaction records.

---

# 34. CUSTOMER-SPECIFIC PERSONALIZATION

Permit subscriber UI personalization based upon:
- account type
- subscribed products
- geography
- lifecycle state
- payment status.

Do not dark-pattern subscribers into retaining subscriptions.

Cancellation should be transparent.

Retention offers may be presented when merchant policy allows.

---

# 35. CHURN MANAGEMENT

Implement voluntary and involuntary churn separately.

### Involuntary churn

Payment failure.

Use:
- pre-due reminders
- account updater
- intelligent retries
- alternate rails
- payment links
- collections workflows.

### Voluntary churn

Customer cancellation intent.

Capture reason and optionally offer:
- pause
- downgrade
- alternate package
- temporary discount.

Respect immediate cancellation where contract and law permit it.

---

# 36. PROMOTIONS ENGINE

Support:
- coupons
- referral codes
- loyalty programs
- credits
- introductory offers
- bundles
- free months
- percentage discount
- fixed discounts.

Promotions can be constrained by:
- market
- channel
- customer type
- product
- date
- cohort
- usage
- contract.

---

# 37. TAX ENGINE

Design provider-neutral taxation.

Integrate with systems such as:
- Avalara
- Vertex
- TaxJar
- SAP tax services
- regional tax services.

Support:
- VAT
- GST
- sales tax
- withholding tax
- reverse charge
- tax exemptions.

Determine tax based upon jurisdiction and configurable merchant rules.

---

# 38. MULTI-CURRENCY

Support:
- transaction currency
- billing currency
- settlement currency
- reporting currency.

Maintain FX-rate source and timestamp.

Never overwrite historical FX calculations.

---

# 39. MULTI-ENTITY

Support businesses operating across legal entities.

Maintain separate:
- tax registrations
- invoice numbering
- bank accounts
- gateways
- accounting integrations.

---

# 40. MARKETPLACE SUPPORT

Support:

Customer → Marketplace → Seller → Subscription.

Include:
- commissions
- platform fees
- seller settlement
- refunds
- split payments
- seller statements
- reconciliation.

---

# 41. REVENUE RECOGNITION

Create a revenue subledger capable of supporting relevant accounting requirements including configurable recognition schedules.

Separate:

Billing

from

Revenue Recognition.

Support:
- contract modifications
- credits
- refunds
- allocation rules
- deferred revenue.

Maintain immutable auditability.

---

# 42. FINANCE INTEGRATION

Integrate with:
- SAP S/4HANA
- SAP ECC
- Oracle Fusion
- Oracle EBS
- NetSuite
- Dynamics 365 Finance
- QuickBooks
- Xero
- generic accounting systems.

Provide journal-level integration APIs.

Support:
- Accounts Receivable
- Revenue
- Deferred Revenue
- Cash
- Tax
- Gateway Fees
- Refunds
- Write-offs.

---

# 43. RECONCILIATION ENGINE

Automatically reconcile:

Invoice ↔ Payment ↔ Gateway Transaction ↔ Processor Settlement ↔ Bank Deposit ↔ General Ledger.

Flag discrepancies.

---

# 44. REVENUE LEAKAGE DETECTION

AI should continuously look for:
- Usage without charge
- Entitlement without active subscription
- Subscription without invoice
- Invoice without payment attempt
- Payment without reconciliation
- Incorrect price
- Unexpected discount
- Expired promotion still active
- Missing usage feed
- Incorrect tax
- Duplicate charge
- Unbilled contract commitment.

Every detection must include supporting evidence.

---

# 45. DISPUTE MANAGEMENT

Subscribers can dispute:
- invoice
- charge
- usage
- tax
- payment.

Create dispute case workflow:

Raised → Triaged → Investigated → Accepted / Rejected → Credit / Correction → Closed.

Maintain SLA and audit trail.

---

# 46. REFUND MANAGEMENT

Support:
- full refund
- partial refund
- credit balance
- future invoice credit.

Before initiating refund calculate:
- payment processor
- original transaction
- refundable amount
- tax implications
- accounting implications.

---

# 47. AI REVENUE COPILOT

Create a grounded AI assistant across the platform.

Examples:
- "Why did MRR drop last month?"
- "Which subscribers are at risk of payment failure?"
- "Show subscriptions renewing next month above $100K."
- "Why wasn't Acme Corp invoiced?"
- "Create a pricing plan with $99 base plus $0.02 per API call beyond 50,000."
- "Simulate the impact of a 7% annual price increase."
- "Which payment gateway has the lowest success rate in India?"

AI may prepare changes.

It must not autonomously make financially material production configuration changes without policy-authorized approval.

---

# 48. NATURAL-LANGUAGE CONFIGURATION

Allow:

"Create a new Professional Plan at ₹2,499/month with 10 users included and ₹199 for every additional user."

System generates configuration draft.

Display resulting rule.

User reviews.

User activates.

AI-generated configurations must go through the same validations as manually created configurations.

---

# 49. AUTONOMOUS REVENUE OPERATIONS

Implement bounded AI agents.

Examples:
- Collections Agent
- Leakage Agent
- Reconciliation Agent
- Pricing Analyst Agent
- Customer Care Agent.

All agent actions must be auditable.

---

# 50. BUSINESS RULES ENGINE

Provide a general rule framework.

Example:

WHEN

invoice.amount > ₹100,000

AND

customer.segment = Enterprise

AND

payment_status = Failed

THEN

assign Account Manager

AND

send WhatsApp alert

AND

do not suspend service for 7 days.

Provide visual rule builder and advanced expression mode.

---

# 51. WORKFLOW ENGINE

Events should drive workflows.

Examples:
- subscription.created
- subscription.renewed
- usage.received
- invoice.generated
- invoice.due
- payment.failed
- payment.received
- contract.expiring.

Workflow:

Trigger → Condition → Action → Wait → Branch → Approval → Integration.

---

# 52. NO-CODE CUSTOMIZATION

Administrators should be able to customize:
- objects
- fields
- forms
- layouts
- validation rules
- business rules
- workflows
- notifications
- roles
- dashboards.

Avoid requiring custom source-code forks.

---

# 53. LOW-CODE EXTENSIBILITY

Provide sandboxed extension framework.

Allow:
- serverless functions
- custom calculators
- custom UI widgets
- workflow extensions
- external service connectors.

Extensions must have:
- versioning
- permissions
- observability
- rollback.

---

# 54. API-FIRST DESIGN

Every major operation available through UI must have an API.

Use REST and optionally GraphQL where appropriate.

Provide:
- webhooks
- idempotency keys
- API versioning.

---

# 55. EVENT-DRIVEN ARCHITECTURE

Use domain events as a first-class primitive.

Example:
- SubscriptionCreated
- UsageReceived
- ChargeRated
- InvoiceFinalized
- PaymentAttempted
- PaymentFailed
- PaymentSucceeded
- RevenueScheduled
- SubscriptionCancelled.

Use event streaming infrastructure suitable for high scale.

Ensure reliable delivery patterns such as transactional outbox where appropriate.

---

# 56. CORE DOMAIN SERVICES

Architect logical services/modules for:
- Identity
- Tenant Management
- Customer
- Account
- Catalog
- Pricing
- Quotes
- Contracts
- Subscriptions
- Entitlements
- Usage
- Metering
- Rating
- Billing
- Invoice
- Tax
- Payments
- Collections
- Credits
- Revenue Recognition
- Reconciliation
- Accounting
- Notifications
- Workflow
- Rules
- Analytics
- AI
- Audit
- Integrations.

Do not split into microservices prematurely.

Define bounded contexts clearly and choose deployment boundaries based upon scale and operational need.

---

# 57. FINANCIAL LEDGER

Financial records require stronger guarantees than ordinary application records.

Implement double-entry accounting concepts where appropriate.

Ledger entries should be immutable.

Corrections should occur through reversals or adjustments.

Never silently edit posted financial records.

---

# 58. IDEMPOTENCY

All financial APIs must protect against duplicate execution.

Repeating the same request must not charge a customer twice.

---

# 59. CONSISTENCY MODEL

Explicitly identify where strong consistency is required.

Examples:
- payment posting
- invoice finalization
- ledger posting
- entitlement state when financially material.

Use eventual consistency where appropriate for:
- analytics
- dashboards
- reporting views
- notifications.

---

# 60. AUDITABILITY

Record:
- who
- did what
- to which object
- when
- from where
- before value
- after value
- reason.

Configuration changes must be auditable.

AI actions must additionally record:
- model
- prompt/context reference
- tool/action invoked
- decision policy
- human approval
- outcome.

Never record secrets or complete payment credentials.

---

# 61. ROLE-BASED ACCESS

Personas:
- Billing Administrator
- Pricing Manager
- Collections Agent
- Customer Support
- Finance Controller
- Revenue Accountant
- Sales
- Product Manager
- Operations
- Developer
- Auditor
- Executive.

Support RBAC plus optional attribute-based policies.

---

# 62. APPROVAL CONTROLS

Configurable maker-checker.

Examples:
- Discount > 20% → approval
- Refund > $10,000 → approval
- Pricing activation → Product + Finance approval
- Write-off > threshold → Controller approval.

---

# 63. SUBSCRIBER UX DESIGN LANGUAGE

Visual style:
- premium
- modern
- calm
- minimal
- highly legible
- fintech-quality
- responsive
- accessible.

Avoid the appearance of traditional ERP screens.

Use progressive disclosure.

Complexity should appear only when needed.

---

# 64. ADMIN EXPERIENCE

Main navigation:

Home  
Customers  
Catalog  
Pricing  
Subscriptions  
Usage  
Billing  
Payments  
Collections  
Revenue  
Analytics  
Workflows  
Integrations  
Developers  
Settings.

Global command/search bar:

"Search customers, invoices, payments, subscriptions…"

Support keyboard-first navigation.

---

# 65. REVENUE COMMAND CENTER

Homepage should answer:

How much recurring revenue do we have?

How much are we expected to collect?

How much is overdue?

How much is at risk?

Where are payments failing?

Where is revenue leaking?

Which subscriptions are renewing?

What changed since yesterday?

Suggested KPI cards:
- ARR
- MRR
- NRR
- GRR
- Active Subscribers
- Expansion MRR
- Churn MRR
- Payment Success Rate
- Collection Rate
- DSO
- Failed Payments
- Recovered Revenue
- Outstanding AR
- Revenue at Risk.

---

# 66. COLLECTIONS COMMAND CENTER

Create an operations cockpit.

Metrics:
- Due today
- Due this week
- Overdue
- At-risk amount
- Recovery rate
- Promise-to-pay
- Payment failures
- Gateway failures.

Queues:
- High-value at risk
- Card expiry
- Repeated failures
- Promise broken
- Disputed
- Manual follow-up.

Each item must offer recommended next action.

---

# 67. CUSTOMER 360

Customer page should display:
- Identity
- MRR / ARR
- Account balance
- Active subscriptions
- Contract
- Entitlements
- Usage
- Invoices
- Payments
- Credits
- Collections
- Communications
- Support issues
- Revenue impact
- Timeline.

---

# 68. LINEAR TRANSACTION EXPLORER

Create a unique graphical visualization.

Contract ↓ Subscription ↓ Usage ↓ Rated Charge ↓ Invoice ↓ Payment ↓ Settlement ↓ Revenue ↓ Ledger.

Each node clickable.

Highlight broken or incomplete chains.

---

# 69. ANALYTICS

Support metrics:
- MRR
- ARR
- ARPU
- ARPA
- NRR
- GRR
- Logo churn
- Revenue churn
- Expansion
- Contraction
- Activation
- Trial conversion
- Renewal
- Payment success
- Recovery
- DSO
- Collections effectiveness
- Delinquency
- LTV
- Cohort retention.

Allow slicing by:
- product
- plan
- market
- channel
- segment
- currency
- legal entity
- sales channel
- acquisition cohort.

---

# 70. REAL-TIME ALERTS

Example alerts:
- Payment success rate down 7%.
- Gateway X experiencing elevated failures.
- Usage feed from Service Y has stopped.
- Potential duplicate invoices detected.
- ₹4.2M revenue at risk this week.
- Large customer approaching usage cap.
- Unusual refund spike detected.

---

# 71. FORECASTING

Forecast:
- MRR
- ARR
- Cash collections
- Renewals
- Churn
- Usage revenue
- Overdue receivables.

Separate contractual forecast from probabilistic forecast.

Never present AI forecasts as accounting truth.

---

# 72. CUSTOM REPORT BUILDER

Users select:
- Object
- Metrics
- Dimensions
- Filters
- Time range
- Visualization.

Allow report scheduling and exports.

---

# 73. GLOBAL SEARCH

Search:
- customer name
- invoice
- subscription
- payment
- email
- contract
- transaction ID
- gateway reference
- PO
- product.

Results should appear instantly.

---

# 74. CUSTOM FIELDS

Admins can add custom fields to core objects.

Types:
- Text
- Number
- Currency
- Date
- Boolean
- List
- Reference
- Formula.

Custom fields available through API, workflow and reporting.

---

# 75. IMPORT / MIGRATION

Provide tools to migrate from:
- SAP BRIM
- Chargebee
- Recurly
- Zuora
- Stripe Billing
- custom platforms.

Migration framework:

Extract → Map → Transform → Validate → Reconcile → Dry run → Cutover.

Preserve:
- customers
- contracts
- subscriptions
- balances
- credits
- invoices
- payment references
- price history.

---

# 76. CONFIGURATION PROMOTION

Support environments:
- Development
- Test
- UAT
- Production.

Configuration packages can move between environments.

Support dependency checks and rollback.

---

# 77. OBSERVABILITY

Every financial transaction should have distributed tracing.

Provide correlation IDs.

Metrics, logs and traces must be integrated.

---

# 78. RELIABILITY

Target production architecture for:
- 99.99% availability for critical financial capabilities where commercially appropriate.
- No single point of failure.
- Multi-zone deployment.
- Backups.
- Point-in-time recovery.
- Disaster recovery.
- Graceful degradation.

---

# 79. PERFORMANCE

Target:
- UI interaction < 2 seconds for common workflows.
- Search < 1 second where practical.
- APIs p95 < 500 ms for standard operations excluding external dependencies.
- Usage infrastructure horizontally scalable.
- Financial batch processes restartable and resumable.

---

# 80. SECURITY

Implement:
- OIDC/OAuth2
- SAML SSO
- MFA
- RBAC
- ABAC where appropriate
- encryption in transit
- encryption at rest
- key rotation
- secrets management
- rate limiting
- WAF
- fraud controls
- secure audit logs.

Design toward applicable compliance expectations such as:
- SOC 2
- ISO 27001
- PCI DSS scope minimization
- GDPR
- regional privacy laws.

Never store raw payment credentials unnecessarily.

Use payment-provider tokenization.

---

# 81. DATA RESIDENCY

Architect optional regional deployment.

Examples:
- US
- EU
- India
- APAC.

Tenant data residency should be configurable where required.

---

# 82. TENANCY

Support:
- multi-tenant SaaS
- dedicated enterprise deployment.

Strong tenant isolation is mandatory.

Tenant ID must be enforced throughout storage and access layers.

---

# 83. DEVELOPER EXPERIENCE

Provide:
- API documentation
- SDKs
- CLI
- Webhook tester
- API explorer
- sandbox
- sample applications
- event simulator
- usage generator
- Postman collections.

Developers should be able to create a simple subscription within minutes.

---

# 84. INTEGRATION MARKETPLACE

Connector framework for:
- CRM
- ERP
- Tax
- Payments
- Banks
- Data Warehouse
- Messaging
- Customer Support
- Identity
- CPQ
- Analytics.

Examples:
- Salesforce
- SAP
- Oracle
- NetSuite
- Stripe
- Adyen
- Razorpay
- PayPal
- Avalara
- Snowflake
- Databricks
- Slack
- Teams
- Twilio
- WhatsApp providers.

---

# 85. DIFFERENTIATION STRATEGY

The system must not win by having a larger checklist.

It should win through six integrated advantages.

## Advantage 1 — Revenue Lifecycle Graph
Complete traceability from product offer to accounting.

## Advantage 2 — Preventive Collections
Predict and prevent payment failure before dunning begins.

## Advantage 3 — Subscriber Financial Experience
Turn billing from an opaque back-office process into a transparent consumer experience.

## Advantage 4 — Monetization Studio
Allow sophisticated pricing to be configured and simulated visually.

## Advantage 5 — Autonomous Revenue Operations
Use bounded, explainable AI agents to identify leakage, reconcile transactions and optimize collections.

## Advantage 6 — Composable Platform
Everything accessible through UI, API, events, rules, workflow, and extensions.

---

# 86. MVP

Do not attempt to build every enterprise feature initially.

Build a credible vertical slice.

### MVP modules
- Authentication
- Tenants
- Customers
- Product Catalog
- Pricing
- Subscriptions
- Invoices
- Payment integration
- Payment methods
- Basic usage metering
- Dunning
- Customer portal
- Notifications
- Basic reporting
- Audit.

Support initially:
- flat recurring
- per-seat
- usage-based
- tiered
- one-time charges.

Payment connectors:
- Stripe plus a provider abstraction layer.

If targeting India, add Razorpay/UPI early.

---

# 87. MVP DIFFERENTIATOR

Even the MVP must contain one differentiator competitors cannot dismiss as merely another billing UI.

Implement:

# Payment & Collections Intelligence

For every customer display:
- Upcoming Amount
- Payment Risk
- Preferred Payment Channel
- Next Best Collection Action.

---

# 88. SECOND RELEASE

Add:
- Contracts
- Entitlements
- Advanced usage
- Rating
- Payment orchestration
- Revenue leakage
- Advanced analytics
- Collections workflows
- Multi-currency
- Multi-entity
- Tax abstraction
- ERP integration.

---

# 89. ENTERPRISE RELEASE

Add:
- Revenue recognition
- Marketplace
- Advanced reconciliation
- Advanced CPQ
- AI agents
- Configuration promotion
- Complex contract amendments
- Revenue forecasting
- Regional deployments
- Enterprise governance.

---

# 90. RECOMMENDED TECHNICAL ARCHITECTURE

Select technologies pragmatically and justify choices.

A viable architecture could use:

Frontend:
- React / Next.js
- TypeScript

Design System:
- component-based accessible design system

Backend:
- TypeScript/Node, Java/Kotlin or Go depending domain

API:
- REST
- OpenAPI

Database:
- PostgreSQL

Cache:
- Redis

Event streaming:
- Kafka-compatible platform

Search:
- OpenSearch

Analytics:
- columnar warehouse/ClickHouse-style architecture where appropriate

Object storage:
- S3-compatible storage

Workflow:
- Temporal-style durable workflow orchestration

Observability:
- OpenTelemetry

Deployment:
- Docker
- Kubernetes where justified.

Do not introduce technology simply because it is fashionable.

---

# 91. DATA MODEL

Define initial entities including:

Tenant, User, Role, Customer, Account, Contact, Product, ProductVersion, Offer, Plan, RateCard, PriceRule, Contract, ContractAmendment, Subscription, SubscriptionItem, Entitlement, Meter, UsageEvent, RatedEvent, Charge, Invoice, InvoiceLine, CreditNote, Payment, PaymentAttempt, PaymentMethod, Gateway, Refund, CollectionCase, DunningCampaign, Communication, TaxRecord, RevenueSchedule, JournalEntry, Settlement, ReconciliationMatch, Workflow, Rule, AuditEvent.

For each entity provide:
- primary key
- tenant key
- business key
- important attributes
- relationships
- status transitions
- audit fields.

---

# 92. API CONTRACT

Produce OpenAPI specifications for MVP endpoints.

At minimum:
- /customers
- /products
- /plans
- /subscriptions
- /usage-events
- /invoices
- /payments
- /payment-methods
- /credits
- /notifications
- /webhooks.

Include:
- authentication
- authorization
- pagination
- filtering
- error model
- idempotency
- correlation IDs.

---

# 93. DOMAIN EVENTS

Define event schemas.

Examples:
- customer.created
- subscription.created
- subscription.changed
- subscription.cancelled
- usage.received
- usage.rated
- invoice.generated
- invoice.finalized
- invoice.due
- payment.attempted
- payment.failed
- payment.succeeded
- refund.completed.

Use schema versioning.

---

# 94. UX DELIVERABLES

For every important screen produce:
- purpose
- user persona
- information hierarchy
- components
- states
- empty state
- error state
- loading state
- permissions
- actions
- keyboard behavior
- mobile behavior.

Create designs for:
- Revenue Dashboard
- Customer 360
- Subscription Detail
- Product Catalog
- Pricing Designer
- Usage Explorer
- Invoice Detail
- Payment Detail
- Collections Dashboard
- Workflow Builder
- Customer Portal.

---

# 95. DESIGN DETAIL — CUSTOMER 360

Header:

ACME Corp  
Enterprise  
ARR ₹4.2M  
Balance ₹342K  
Payment Risk HIGH.

Tabs:
- Overview
- Subscriptions
- Usage
- Invoices
- Payments
- Contracts
- Communications
- Timeline.

Right panel:
AI Revenue Assistant.

Suggested action:
"Payment method for upcoming ₹342K invoice expires in 9 days."

---

# 96. DESIGN DETAIL — INVOICE

Header:

INV-20381  
₹42,840  
Due Sep 30  
Status: OPEN.

Action bar:
- Collect
- Send
- Download
- Credit
- Dispute
- More.

Each invoice line should be expandable.

Provide:
Explain invoice.

---

# 97. DESIGN DETAIL — COLLECTIONS

Top:
- ₹28.4M Receivable
- ₹4.8M At Risk
- ₹2.1M Overdue
- 94.8% Payment Success.

Queues:
- Needs Attention
- High Value
- Payment Method Expiring
- Retry Scheduled
- Promise to Pay
- Manual Collection.

Timeline visualization should show expected cash collection by day.

---

# 98. DESIGN DETAIL — PRICING STUDIO

Left:
Components.

Center:
Visual pricing flow.

Right:
Properties.

Bottom:
Simulator.

---

# 99. QUALITY ENGINEERING

Implement comprehensive test strategy:
- Unit tests
- Integration tests
- Contract tests
- Payment simulations
- Billing golden tests
- Property-based pricing tests
- Load tests
- Failover tests
- Security tests
- Financial reconciliation tests.

For financial calculations use deterministic golden datasets.

---

# 100. CRITICAL INVARIANTS

Treat these as non-negotiable.

- Never double-charge due to retries.
- Never lose accepted usage events.
- Never silently mutate posted invoices.
- Never silently modify financial ledger history.
- Never allow unauthorized pricing activation.
- Never expose one tenant's data to another.
- Never allow AI to fabricate financial explanations.
- Never permit a financial transaction without traceability.
- Never apply a pricing change retroactively unless explicitly modeled as a correction.
- Never permit an unlogged AI action to modify customer financial state.

---

# 101. IMPLEMENTATION METHOD

Do not generate the entire application in one pass.

Work sequentially.

For every major capability:

1. Define requirements.
2. Define domain model.
3. Define states.
4. Define APIs.
5. Define events.
6. Define security.
7. Define UX.
8. Define database model.
9. Implement backend.
10. Implement frontend.
11. Implement tests.
12. Instrument observability.
13. Document.
14. Validate acceptance criteria.

---

# 102. FIRST IMPLEMENTATION EPICS

Create delivery backlog for:

- SUB-001 Platform Foundation
- SUB-002 Identity & Tenant Management
- SUB-003 Customer Management
- SUB-004 Product Catalog
- SUB-005 Pricing Engine
- SUB-006 Subscription Lifecycle
- SUB-007 Billing Engine
- SUB-008 Invoice Management
- SUB-009 Payments
- SUB-010 Customer Portal
- SUB-011 Usage & Metering
- SUB-012 Collections
- SUB-013 Notifications
- SUB-014 Analytics
- SUB-015 AI Revenue Intelligence
- SUB-016 Integration Framework
- SUB-017 Audit & Compliance.

Break each epic into:
- Features
- User Stories
- Acceptance Criteria
- API requirements
- Data requirements
- UX requirements
- Security requirements
- Test requirements.

---

# 103. DEFINITION OF DONE

A feature is not complete merely because its interface exists.

Done means:
- Domain rules implemented
- API implemented
- UI implemented
- Authorization implemented
- Audit implemented
- Errors handled
- Accessibility validated
- Observability implemented
- Tests passing
- API documented
- User workflow documented
- Financial reconciliation tested where applicable.

---

# 104. NORTH-STAR METRICS

### Merchant metrics
- Payment Success Rate
- Collection Rate
- Revenue Leakage Rate
- Days Sales Outstanding
- Time to Launch New Pricing
- Billing Accuracy
- Subscription Retention
- Revenue Recovery.

### Subscriber metrics
- Successful Self-Service Rate
- Payment Completion Time
- Billing Dispute Rate
- Unexpected Bill Rate
- Support Contacts per 1,000 Subscribers.

### Platform metrics
- Billing Accuracy
- API Availability
- Event Processing Latency
- Invoice Processing Time
- Payment Processing Reliability.

---

# 105. FINAL PRODUCT PHILOSOPHY

Do not build:

"a better invoice generator."

Do not build:

"a cloned Chargebee."

Do not build:

"a lighter SAP BRIM."

Build:

# The operating system for recurring commercial relationships.

The fundamental product promise should be:

> Businesses can monetize almost anything, subscribers can always understand what they owe and why, and the platform relentlessly moves legitimate revenue from commercial agreement to collected cash with minimal friction.

Optimize simultaneously for:

BUSINESS FLEXIBILITY

+

FINANCIAL CONTROL

+

SUBSCRIBER TRUST

+

PAYMENT SUCCESS.

When forced to choose between adding another configuration screen and removing complexity from the experience, prefer removing complexity while preserving enterprise-grade capability.

The product should make sophisticated subscription economics accessible to organizations without requiring them to become billing-system experts.

---

# 106. INITIAL OUTPUT REQUIRED FROM THE IMPLEMENTATION AI

Before writing production code, produce the following artifacts in order:

1. Product Requirements Document
2. Competitive capability matrix
3. Domain model
4. System context diagram
5. Logical architecture
6. Revenue Lifecycle Graph design
7. Data model / ERD
8. Subscription state machine
9. Invoice state machine
10. Payment state machine
11. Collection state machine
12. Pricing engine specification
13. API specification
14. Event taxonomy
15. Security architecture
16. Multi-tenancy architecture
17. UX information architecture
18. Wireframes for ten primary screens
19. MVP backlog
20. Epic → Feature → User Story → Acceptance Criteria decomposition
21. Technical implementation plan
22. Repository structure
23. Coding standards
24. Testing strategy
25. Deployment architecture
26. MVP implementation.

Do not jump immediately into UI code.

First establish correct commercial, financial and architectural foundations.

For every major architectural choice state:
- decision
- alternatives considered
- advantages
- disadvantages
- rationale
- implications.

When requirements are ambiguous, make a sensible enterprise-grade assumption, explicitly document it, and continue rather than blocking implementation.

The resulting platform should be capable of starting as a focused SaaS product but evolving into an enterprise-grade revenue-management platform capable of supporting high-volume global subscription businesses.
