# ADEM threat model

What ADEM's design protects, from whom, and what it deliberately does not defend — written for
contributors, so that an implementer can see which property a change would weaken and which boundary a
change would cross.

This is the model for the repository's own surfaces and actors. `SECURITY.md` is the reporter-facing
document and points here rather than restating the model; `docs/shield/THREAT-MODEL.md` and
`docs/shield/EXCLUSIONS.md` carry the equivalent content for the package that ships to adopters, whose
threats belong to the adopting process rather than to this repository. The tables, their owners and the
mutable-versus-append-only split are `docs/SCHEMA.md`; the order one write path takes is
`docs/DATA-FLOW.md`; the module boundaries this model rests on are `docs/ARCHITECTURE.md`; and the pass
rule the badge's scope belongs to is `docs/STANDARD-SGI-SO-1.0.0.md`. None of those is restated here.

## 1. Posture

ADEM is a **local demonstration and foundation** rather than a production service: one process, one
SQLite file, one container, no external service, no secret, and nothing that has to be configured — the
two inputs the process reads, `ADEM_PORT` and `ADEM_DB_PATH`, are optional and are resolved with working
defaults in `apps/api/src/config.ts`. The model below claims no certification, no independent
verification and no universal safety for the product or for anything built on it, and it describes what
the delivered code actually defends rather than what a deployment might add. One property stands before
every mitigation in it: **nothing in the product executes submitted third-party code.** A candidate is
declarative data — one case identifier and one recorded output per case — compared as canonical JSON by
`packages/sgi-core/src/scoring/`, and there is no `eval`, no dynamic import of submitted content and no
sandbox anywhere in the tree.

## 2. Assets the design protects

1. **The integrity of the fixture set and the versioned pass rule.** Every published outcome is derived
   from the case set in `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/` and from the thresholds stored in
   a `standard_versions` row; if either could be changed quietly, no report would mean anything, which
   is why the criteria are versioned data and a change is a new version rather than an edit.
2. **The append-only historical record** — `standard_versions`, `evaluation_reports`,
   `report_case_results`, `governance_events`, `ledger_entries`, `transactions`, `refunds`,
   `audit_events` and `listing_versions`, together with the per-case evidence nested under each report.
   These nine tables accept one kind of write, a new row, and the product's claim to trust rests on that
   history being unrewritable. The founder-allocation ledger is part of that record and holds no
   personal identity, no beneficiary account and no entitlement: its contract structure is labelled
   `to be determined`.
3. **The separation between roles.** A buyer must not publish listings, a developer must not moderate,
   and neither may read the operator's ledger or audit routes; the roles exist so that each surface's
   actions stay attributable to the account that took them.
4. **The absence of real personal data, credentials and secrets** from the repository and from the
   running system. The demo accounts are seed rows carrying a handle, a role and a display label; no
   column of any table could hold a credential, a contact detail or a personal name, and no module reads
   a secret, a token or a key.
5. **The meaning of the badge and the closed label vocabulary.** `SAMPLE` and `VERIFIED-IN-DEMO`, with
   the scope `structured output on fixture set only`, say one narrow thing about one fixture set; were a
   badge able to imply more, the artefact would mislead the buyer it exists to inform.
6. **The foundation's own reputation.** A public demonstration of simulated commerce can damage it if
   any surface reads as real, which is why every simulated amount carries a disclosure label, every
   sponsored item carries the label `Sponsored`, and no real currency code or currency symbol appears
   anywhere.

Those six are what the measures below exist for. Nothing else in the product is protected by them, and
no measure below is offered as protection for anything else.

## 3. Actors and their reachable writes

Reads are public, with four exceptions: `GET /ledger/marketplace`, `GET /ledger/gate-fees`,
`GET /ledger/founder-allocation` and `GET /audit-events` require the operator role. Every write carries
`X-Demo-Account: <accountId>`, naming one seeded row of `accounts` (its `id` or its `handle`, matched by
exact equality); an absent, blank or unresolvable value is answered `401` by
`apps/api/src/auth/resolve-demo-account.ts`, and a resolvable account whose role the row does not accept
is answered `403` by `apps/api/src/auth/require-role.ts`.

| Actor | Role in the system | Reachable writes |
| --- | --- | --- |
| Anonymous reader | Browses the public pages, reads the documentation, takes ADEM Shield Basic, reads any report | None |
| Developer | Publishes listings and versions, runs evaluations on its own versions, opens appeals, answers challenges | `POST /listings`, `POST /listings/{id}/versions` as the owning developer, `POST /evaluations`, `POST /evaluations/{id}/appeals`, `POST /challenges/{id}/responses` |
| Buyer | Searches, filters and compares listings, inspects limitations, posts challenges and inquiries, runs a simulated checkout | `POST /inquiries`, `POST /challenges`, `POST /checkout-simulations` |
| Contributor | Proposes standards and tests, takes part in discussion threads, contributes code and fixture packs | `POST /standards/proposals`, `POST /threads`, `POST /threads/{id}/posts` |
| Operator | Moderates listings, reviews standards proposals, rules on appeals, reads the three ledgers and the audit feed | `POST /standards/proposals/{id}/review`, `POST /appeals/{id}/ruling`, `POST /transactions/{id}/refunds`, `POST /moderation/listings/{id}/actions`, plus the three `GET /ledger/*` reads and `GET /audit-events` |
| Malicious or careless client | Any of the above performed badly: a spoofed demo header, a malformed submission, a write flood, an attempt to rewrite history | Exactly the surface its header's role allows, and no more |

`POST /threads` and `POST /threads/{id}/posts` are the two write rows that admit any resolvable account
and name no `403`; they are the contract's own exception and not a wildcard elsewhere.

## 4. Trust boundaries

**The public UI and the API.** Every request crosses from an uncontrolled browser into the API, and
what enforces it on that crossing is the JSON-schema validation on every write route
(`packages/shared/src/schemas/`), the write rate limit of 60 requests per minute per client returning
`429` with a `Retry-After` header (`apps/api/src/server.ts`), and the role check on every non-public
row. On the client side `apps/web/src/api-client.ts` is the only module that calls `/api/v1`, so no page
and no component can reach around the header those checks read.

**The demo-session header.** `X-Demo-Account` names a synthetic seed row, and it is **trivially
impersonable by design**: it separates roles for a demonstration, asserts nothing about who the caller
is, and must never be treated as authentication — treating it as authentication is the failure mode this
boundary exists to prevent. The load therefore falls on the per-route role check, the write rate limit,
the append-only record and the visible label: the UI renders `demo only, no production authentication`
(`apps/web/src/components/demo-banner.tsx`), and the header's value reaches two parameterised lookups
and no message, log or response.

**The API and the append-only stores.** This is the boundary at which history could be rewritten. No
route registers an update or a delete for an append-only resource, and no write path uses a
replace-style conflict resolution, so a change to a measurement is a new row — a retest inserts a report
pointing at its predecessor, and a refund appends a reversal rather than editing the entry it corrects.
Fastify answers an unregistered method and an unregistered path alike with the same JSON `404`, so the
attempt is unreachable by construction rather than refused by a check; what holds the rule is that no
route offers the change, and what proves it is `apps/api/test/integration/immutability.test.ts`. The
triggers created by `packages/shared/migrations/0010_append_only_triggers.sql` stand behind that as
defence in depth, on the terms section 6 states.

**The API and the domain packages.** A domain package receives a database handle and never an HTTP
request, so no route's shape can reach a calculation: `packages/sgi-core` has no import edge to
`packages/commerce-sim`, to `apps/api`, or to any sponsorship module or column, which is why commercial
pressure cannot reach a measurement through any code path. `sponsored_slots` declares no foreign key at
all, so no SGI query can join it. The static half of that claim is
`apps/api/test/integration/boundary-check.ts`, which walks the import specifiers of every file under
`packages/sgi-core/` and every workspace manifest; the behavioural half is
`apps/api/test/integration/trust-separation.test.ts`, which varies sponsorship and fee data and asserts
that reports, badges and organic ordering stay identical.

**A Shield caller and the policy engine.** In-process and with no privilege change:
`evaluate(call, policy, context)` is an ordinary function call that returns one record
`{ decision, reason, ruleId }`, denying by default when no rule matches and answering `deny` with reason
`malformed` on a call or policy it cannot read, and it never throws. `packages/shield` has no dependency
on any other workspace and no runtime dependency at all, so it is adopted on its own and no route of
`apps/api` is protected by it. Its own boundary is stated in its own words: Shield is **not a gate pass
and not a security guarantee**, and `docs/shield/THREAT-MODEL.md` with `docs/shield/EXCLUSIONS.md` is
where that limit is stated in full.

## 5. Threats the design addresses, and the mitigation for each

| Threat | Mitigation | Where it lives |
| --- | --- | --- |
| A write without a demo account, or with a spoofed or unresolvable one, publishes content | `401` when the `X-Demo-Account` header is absent, blank or names no seeded account; `403` when a resolvable account's role is not the row's; and a visible label disclosing that the accounts are synthetic | `apps/api/src/auth/resolve-demo-account.ts`, `apps/api/src/auth/require-role.ts`, `apps/web/src/components/demo-banner.tsx` |
| A malformed or hostile request body corrupts or overloads a handler | JSON-schema validation on every write route before a handler runs, and one error envelope `{ error: { code, message } }` that carries a validation failure as `400` and answers every other failure in the same shape | `apps/api/src/errors/error-envelope.ts`, `packages/shared/src/schemas/` |
| A submission is used as an execution vector | A candidate is declarative data compared as strings: nothing submitted is evaluated, imported or interpreted, and there is no sandbox to escape | `packages/sgi-core/src/scoring/` |
| A submission that records no output for a fixture case is scored anyway | `POST /evaluations` answers `422` before any report is written, so the refused submission leaves no report row, no case result and no fee entry | `apps/api/src/routes/evaluations.ts` |
| History is rewritten to change an outcome | No route registers an update or a delete for an append-only resource, and no write path replaces a row; behind that, a `BEFORE UPDATE` and a `BEFORE DELETE` trigger raise `ABORT` on each of the nine append-only tables | `packages/shared/migrations/0010_append_only_triggers.sql`, `apps/api/src/routes/` |
| An operator alters a measurement, or a fee or a sponsorship buys a better result | The operator's routes are additive: they move one mutable column or append an event, and none of them touches a report, a case result or a ledger entry. No import path connects commercial or sponsored data to scoring, reports, badges or ordering | `apps/api/src/routes/moderation.ts`, `apps/api/src/routes/standards.ts`, `apps/api/src/routes/ledgers.ts`, `apps/api/test/integration/trust-separation.test.ts` |
| A write flood exhausts the single-writer store | Write routes are rate-limited to 60 requests per minute per client and answer `429` with `Retry-After`, and the UI renders a visible retry message rather than an error trace. The bound is a fair-use limit on one client's writes: it is not denial-of-service protection | `apps/api/src/server.ts`, `apps/web/src/components/error-notice.tsx` |
| A secret, a credential, a real contact detail or a prohibited dependency reaches the repository | No secret is read at start-up, and the exclusion scan fails the build on the four classes it detects — email address, telephone-number pattern, credential material, prohibited dependency. It reports without deleting and is supplementary: it sees no personal name, and it is not a privacy guarantee | `scripts/scan-exclusions.ts`, `scripts/exclusion-rules.ts`, `docs/REVIEW-CHECKLIST.md`, `.github/workflows/ci.yml` |
| A badge or report over-claims and misleads a buyer | The label vocabulary is closed to `SAMPLE` and `VERIFIED-IN-DEMO`, a badge names the standard version, the scope `structured output on fixture set only` and the report ID, a `FAIL` report carries no badge, a listing with no evaluation shows `No SGI report yet` in place of an outcome, and no surface states that buying an evaluation guarantees a pass | `apps/web/src/components/sample-badge.tsx`, `docs/STANDARD-SGI-SO-1.0.0.md` |
| A simulated purchase is mistaken for a real one | Integer minor units of the synthetic currency `DEMO` and no currency symbol anywhere, a disclosure label on every simulated amount, `simulated: true` on the transaction response, and the nonfunctional demonstration label | `packages/commerce-sim/src/config.ts`, `apps/api/src/routes/checkout.ts`, `apps/web/src/components/checkout-panel.tsx` |

## 6. Two things that are deliberately not vulnerabilities

**The `X-Demo-Account` header is a synthetic role selector, not authentication.** It names a seed row,
any client can send any name, and that is the design rather than a defect in it: the header separates
roles for a demonstration and asserts nothing about who the caller is. It creates no session, carries no
credential and is checked against no credential store, and what bounds a spoofed value is the role check
on the target route, the write rate limit, the append-only record of what was written, and the
disclosure label the UI shows.

**A SQLite `RAISE(ABORT)` trigger is defence in depth, not a security boundary.** The triggers created
by `packages/shared/migrations/0010_append_only_triggers.sql` refuse an update or a delete that reaches
one of the nine append-only tables, and they are worth having. They are also not a boundary: SQLite
offers no command that disables a trigger, but a connection holding write access can drop one, and the
writable-schema escape hatch can rewrite the schema itself. What makes the rule hold is therefore the
absence of the route — no route updates or deletes an append-only resource — and it is proven by
`apps/api/test/integration/immutability.test.ts` rather than by the trigger.

If you are about to report either of these two as a vulnerability, read this section first: `SECURITY.md`
records both as deliberately expected non-vulnerabilities, and a report that the demo header can be
spoofed or that a trigger can be dropped restates the design instead of finding a defect in it.

## 7. Non-goals: what this system deliberately does not defend

Each entry is a capability the product does not have, and each reason is the reason it is not built
here.

- **Production authentication, authorization over real identities, session management or credential
  storage.** There is no identity to authenticate and no credential to store: the demo accounts are
  synthetic seed rows, so there is nothing here for an identity provider to attach to.
- **Real money movement, settlement, payout or provider integration.** No money moves; commerce is a
  labelled simulation, and a payment integration would create a money path the product deliberately does
  not have.
- **Real personal data of any kind**, including contact details and financial information. None is
  collected, and none may be added: the demo identities are fictional, and the audit feed holds no
  request body, header value or network address. A write that states a ground does record that ground:
  a moderation action's reason, an appeal opened or ruled with one, stored in the row's `reason` column
  as the `audit_events` row of `docs/SCHEMA.md` documents, and null where the write states none. That
  stated ground is the only request text the feed holds, and it is not personal data.
- **Isolation, sandboxing or safe execution of third-party agent code.** The evaluator compares recorded
  values as data and runs nothing, and isolation has not been reviewed, so execution of submitted code
  is out of scope until it is.
- **Resistance to denial-of-service beyond the stated rate limit, including volumetric attacks, and any
  high-availability or multi-instance deployment.** The write limit bounds one client's write rate; it
  is not DoS protection, and the store is a single-writer SQLite file in one process by design.
- **Enterprise compliance, external connectors, audit certification or regulatory conformance.** None is
  claimed, and each would need review and evidence this foundation does not have.
- **Encryption at rest, key management or secret rotation.** There is no secret to rotate and no key
  management path, and no encryption at rest is applied to the database file.
- **Security review of community extensions.** An extension is the contributor's responsibility under
  its own licence declaration; the example under `examples/extension-fixture-pack/` carries its own
  `LICENSE` and `ATTRIBUTION.md`, and its presence in this repository is not a review of it.
- **Deployment, publication or announcement hardening.** Deploying, announcing or promoting the product
  needs separate approval and is not covered by anything above.

**Do not attempt any of these here.** None is planned, stubbed or partially implemented in this work,
and building one would invalidate the parts of this model it touches before a reviewer could see the
change.

## 8. Reporting a vulnerability, and what a security fix covers

Report a suspected vulnerability through the hosting platform's private vulnerability reporting channel
described in `SECURITY.md`. That document deliberately publishes no email address, no telephone number
and no other personal contact detail, because a real contact detail is itself a prohibited item in this
repository; this document does the same, and offers no contact route of its own.

In scope for a security fix are exactly the `.github/CODEOWNERS`-protected paths:
`packages/sgi-core/`, `packages/sgi-fixtures/`, `packages/shield/`, `packages/commerce-sim/`,
`docs/governance/`, `scripts/scan-exclusions.ts` and `.github/`.

`docs/shield/THREAT-MODEL.md` and `docs/shield/EXCLUSIONS.md` carry the equivalent content for the
package that ships to adopters. No document in this repository describes any part of the system as
certified, independently verified or safe for arbitrary workloads, and no report, badge, page or
README states or implies a guaranteed pass.

## 9. What would change this model

The limits are honest ones. A real deployment with operators and a public origin, a real identity
provider, real money movement, execution of third-party code, or paid advertising with personalised
profiling would each invalidate part of the model above — the demo-session boundary, the role
separation, the simulated-commerce labelling, the no-execution property or the sponsored-content
separation, one of them at least. Any of them requires separate approval before it is built, and this
model has to be replaced rather than extended when one arrives. None is designed here, because a design
sketch would read as the assurance this document is careful not to give.

## Read next

- `SECURITY.md` — how to report an issue, and what is covered.
- `docs/shield/THREAT-MODEL.md` and `docs/shield/EXCLUSIONS.md` — the same material for ADEM Shield
  Basic, whose boundary is its adopter's process rather than this repository.
- `docs/SCHEMA.md` — the tables, their owners and the nine append-only ones.
- `docs/DATA-FLOW.md` — the order each write path takes.
- `docs/STANDARD-SGI-SO-1.0.0.md` — the pass rule and the badge scope.
