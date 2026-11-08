# ADEM data flow

How one request, one evaluation, one governance decision and one simulated purchase move through
ADEM: who writes what, in what order, and which records may never be rewritten.

This document assumes the module map, the workspace boundaries and the reasoning behind them, which
`docs/ARCHITECTURE.md` states. The tables, their owners and the mutable-versus-append-only split are
`docs/SCHEMA.md`; the pass rule, the evidence semantics and the retest and appeal semantics of the one
provisional standard are `docs/STANDARD-SGI-SO-1.0.0.md`; the threat model and the trust boundaries are
`docs/THREAT-MODEL.md`; the proposal process is `docs/governance/SGI-PROPOSALS.md`. None of those is
restated here — this file follows the data.

## 1. Conventions that hold for every path

- **Transport and versioning.** JSON over HTTP/1.1 on one port: 3000 by default, set through the
  optional `ADEM_PORT` input in `apps/api/src/config.ts`. Every route is served under the single
  prefix `/api/v1`, declared as `API_PREFIX` in `apps/api/src/routes/register-routes.ts` and applied
  once by Fastify's own encapsulation, so a route group owns prefix-relative paths only and no group
  file contains the literal.
- **One failure body.** Every failure — a payload or a media type the framework itself refuses,
  validation, auth, role, not-found, unprocessable, throttling, internal — answers the one shape
  `{ "error": { "code": "<code>", "message": "<message>" } }`, built by the `envelope` function in
  `apps/api/src/errors/error-envelope.ts` and sent by the composition root's single error handler. The
  status for a code comes from the one map in
  `apps/api/src/errors/error-codes.ts`; no route chooses a status and no handler writes an error body of
  its own.
- **Reads are public, with four exceptions.** The three operator reads `GET /ledger/marketplace`,
  `GET /ledger/gate-fees` and `GET /ledger/founder-allocation`, and `GET /audit-events`, require the
  demo header and the operator role. Every other `GET` in the register answers without any request
  header at all.
- **Writes carry `X-Demo-Account: <accountId>`.** The value names one of the seeded rows of `accounts`
  (its `id` or its `handle`, matched exactly), and it is a **synthetic role selector and never
  authentication**: it separates roles for this demonstration and asserts nothing about who the caller
  is. An absent, blank or unresolvable value is `401`; a resolvable account whose role the row does not
  accept is `403`. The UI renders `demo only, no production authentication`, the value of
  `DEMO_AUTHENTICATION_LABEL` in `packages/shared/src/constants.ts`.
- **Every monetary value is an integer count of minor units of the synthetic currency `DEMO`.** No real
  currency code and no currency symbol appears anywhere, and every simulated amount carries the
  disclosure sentence `COMMERCE_DISCLOSURE_LABEL` from `packages/commerce-sim/src/config.ts`. The one
  place a fraction is ever produced and resolved is `packages/commerce-sim/src/ledgers/allocate.ts`.
- **Evidence is compared as canonical JSON.** A candidate's recorded output and a case's expected output
  are rendered by `packages/sgi-core/src/scoring/canonical-json.ts` and the two strings are compared;
  see section 8 for the boundary a contributor must not move.
- **One store, migrated at start-up.** A single SQLite file, opened once by the composition root, with
  `packages/shared/migrations/*.sql` applied in order by `apps/api/src/db/migrate.ts`. The runner records
  each applied file's version, name and SHA-256 checksum in `schema_migrations` and refuses to start when
  an applied file's bytes changed, which is what makes an applied migration immutable in practice: a
  schema change is a new numbered file.

## 2. Read path

1. **Schema validation.** The route's own JSON schema — the ones used by more than one workspace live in
   `packages/shared/src/schemas/` — validates the query string, the path parameters and the body. A value
   that fails `type`, `enum`, `minimum` or `maxLength` is `400 validation_error`. Every free-text field
   carries a stated `maxLength`, so an over-long value is refused here rather than stored and then carried
   by every read that serves it. Defaults are applied at this point, which is why a client may omit the
   listing search's `sort` and `page`.
2. **One read.** The handler issues a single read: a domain call into `@adem/sgi-core` or
   `@adem/commerce-sim`, or a statement against the tables `apps/api` owns. Nothing is cached between
   requests and no second round trip is made to assemble an answer.
3. **Answer as stored.** The row is mapped to the wire shape and answered `200`. Nothing is rounded,
   reformatted or derived on the way out: a summary states a stored report's outcome, standard version
   label and label exactly as the columns hold them.

**Empty is an ordinary state, never an error.** A read that matches nothing answers `200` with
`items: []`, and the pages that render such a collection render an explanation rather than an error
trace. Paging is fixed: page size is `LISTING_PAGE_SIZE` = 20 from `packages/shared/src/constants.ts`,
`page` is the only paging input (an integer of 1 or more; a page whose offset the store cannot
address is refused the row's `400` with a sentence naming the parameter), and the search query
contract declares no page-size property, so
`limit`, `size` and `per_page` are not part of it.

**A concrete example — `GET /api/v1/listings?q=depot&page=2`.**

1. `listingSearchQuerySchema` validates `q` and `page`; `?page=0` would fail `minimum: 1` and answer
   `400 validation_error`, and `?model=bogus` would fail the `PRICING_MODELS` enum the same way.
2. `apps/api/src/routes/listings.ts` runs two statements over one row source that joins each matching
   listing to its newest version and to that version's newest report — the count that fills `total` and
   the page itself, ordered by a deterministic total order ending in `listings.id` so two calls answer
   byte-identical bodies. A `category` filter is resolved first, in one statement of its own, and a
   `standard` filter in two — the standard by its code, then its version row — so a value that names
   no category or no published standard version answers `400`.
3. The response is `200 { items, total, page }`. `items` holds that page's summaries — identity,
   category, developer handle, pricing model, license, latest version string, and the latest report's
   outcome, standard version and label — where a version that has never been evaluated states `null` in
   those last three rather than a substituted word. `total` counts the filtered set, a page past the
   last is `200` with `items: []`, and a page whose offset the store cannot bind is refused as an
   invalid parameter, `400 validation_error`, with a sentence naming it.

**Three more public reads a contributor meets first.** `GET /api/v1/listings/{id}` answers `200` with the
listing's most recent page of versions together with the claims those versions make, its evidence and its
limitations, or `404` for an identifier that names no listing; the pages of the history behind that one
are reached through the read's own `page`, which `docs/SCHEMA.md` section 8 bounds;
a listing an operator has hidden is still readable by the operator and `404` for everyone else.
`GET /api/v1/compare?ids=a,b,c` answers `200` with one column per requested listing in request order,
`400` for a list outside two to four distinct identifiers, and `404` if any identifier names no listing
or one that is hidden — the whole request fails rather than answering a partial comparison.
`GET /api/v1/sponsored-slots` answers `200` with its own labelled collection, every item carrying
`sponsored: true` and rendered with the literal label `Sponsored`, in a block of its own below the organic
results and never interleaved with them; an empty table is `items: []`.

**Reads are not rate-limited.** `@fastify/rate-limit` is registered without a global default, so a route
that wants a limit names it and no read carries one.

## 3. Write path

Every non-public row follows the same ordered sequence, and the order is what decides which status a
caller is answered with when a request has more than one defect.

1. **Write rate limit.** At most 60 write requests per minute per client, with one counter shared by
   every write route, so that sixty is the client's total across all of them. Beyond it the plugin answers
   `429 rate_limited` with a `Retry-After` header, and the UI renders a visible retry message rather than
   an error trace.
2. **JSON-schema validation.** The route's body, query and path schemas validate the request; a failure is
   `400 validation_error`. An absent or empty `X-Demo-Account` header fails the header schema here, and
   the error handler answers it `401` because the failure concerns that header.
3. **Demo-account resolution.** `apps/api/src/auth/resolve-demo-account.ts` looks the header's value up
   against the seeded `accounts` rows. An absent, blank or unresolvable value is `401 unauthorized`, and
   this module is the only producer of `401` in the workspace.
4. **Role assertion.** `apps/api/src/auth/require-role.ts` answers `403 forbidden` when the resolved
   account's role is not one the row accepts. It is default deny — an empty requirement list refuses —
   and it answers the role question only; whether a listing, a version or a report is the caller's own is
   a resource question the owning route answers with its own `403` or `404`. Two rows skip this step
   deliberately: `POST /threads` and `POST /threads/{id}/posts` admit any resolvable demo account and
   their contract row lists no `403`. `POST /challenges/{id}/responses` is the one row whose write role
   is two-valued, buyer or developer.
5. **One domain call inside one transaction.** The handler calls one function of `@adem/sgi-core` or
   `@adem/commerce-sim`, which writes its own tables; several domain writers open a transaction of their
   own that better-sqlite3 nests inside this one as a savepoint, so one request is one unit of work. A
   refusal a domain package raises carries the package's own stable string as the envelope's `code` and
   takes its status from the one code-to-status map; the codes and their statuses are listed in
   section 9. For the append-only tables the only write on this path is an INSERT of a new row — a
   correction is a new row or a new version, never an edit.
6. **Audit event.** `apps/api/src/audit/append-audit-event.ts` appends one `audit_events` row **inside the
   same transaction**, so a write and the record of it succeed or fail together. The row carries the five
   facts an audited write fixes — actor, action, resource, the status the route is about to send, and an
   optional short stated reason — and nothing else: no request body, no header value, no personal data.
   The action comes from the closed tuple `AUDIT_ACTIONS`, which holds one value per write row of the
   contract (`listing.created`, `evaluation.created`, `checkout.simulated`, `refund.created`,
   `moderation.flagged` and its two siblings, and so on). An operator reads the feed back through
   `GET /audit-events`.
7. **`201` or `200` with the created resource** — the payload is the stored row, not a recomputation of
   it.

**Two append-only logs, two questions.** `audit_events` answers *what was written*: it is the
operator-facing feed of every accepted write, appended by the API layer and read through
`GET /audit-events`. `governance_events` answers *what was decided*: it records a domain decision — a
standards-proposal review, a listing moderation action, an appeal's opening, an appeal's ruling, a
standard version's publication, a retest — and is appended only through
`packages/sgi-core/src/events/append-event.ts`, never by a route statement. A moderation action writes
to both, in one transaction, because a reader of the moderation trail and a reader of the write feed are
asking different questions; neither log is a view over the other and neither imports the other's writer.

**No route mutates an append-only resource.** The nine append-only tables are `standard_versions`,
`evaluation_reports`, `report_case_results`, `governance_events`, `ledger_entries`, `transactions`,
`refunds`, `audit_events` and `listing_versions`. No route registers a `PUT`, a `PATCH` or a `DELETE`,
and no write path uses a replace-style conflict resolution: SQLite documents `INSERT OR REPLACE` as
resolving a collision by deleting the row it collides with, which fires no delete trigger, so the
append-only paths add rows only. As defence in depth, `packages/shared/migrations/0010_append_only_triggers.sql`
creates a `BEFORE UPDATE` and a `BEFORE DELETE` trigger raising `ABORT` on each of the nine. Those
triggers are guard rails and never a security boundary — a connection holding write access can drop one
or rewrite the schema — and what holds the rule is that no route offers the change.

**An unregistered method and an unregistered path answer alike.** Fastify 4 has no
method-not-allowed branch: a request naming a method the register does not serve on a path it does serve
is answered with the same JSON `404` envelope as a path that does not exist. That is why an update or a
delete attempt against an append-only resource finds no accepting route and is answered `404`: this API
has no method-not-allowed answer at all, and `apps/api/test/integration/immutability.test.ts` relies on
it. The two flows in section 10 draw this sequence left to right with the status that ends each failure
stage.

## 4. Evaluation path

`POST /api/v1/evaluations` is the load-bearing flow: it is the one place a candidate's claims become a
measured report. It is synchronous — there is no queue and no worker — and the handler in
`apps/api/src/routes/evaluations.ts` runs the following steps in this fixed order.

1. **Admission.** The write rate limit, then `evaluationSubmissionBodySchema` in
   `packages/shared/src/schemas/evaluations-schema.ts`, then `401` for an absent or unresolvable demo
   header, then `403` for a resolvable account whose role is not `developer`.
2. **The body.** `{ candidate_version_id, standard_version_id, recorded_outputs: [{ case_id, output }] }`
   — the candidate version, the standard version, and one recorded output per fixture case. There is
   **no retest field**, and that is structural rather than conventional: the scope's request-body
   policy holds the body to the schema's `additionalProperties: false`, so a client that sent a retest
   link is answered `400 validation_error` rather than having the field dropped or accepted — and a
   value of the wrong JSON type for a declared field is refused the same way.
3. **The candidate version, from this workspace's own table.** One row of `listing_versions` joined to
   its listing, addressed by `candidate_version_id`. No row is `404 not_found`; a version whose listing
   belongs to another developer is `403 forbidden`. The row also supplies `is_fixture_candidate`, the one
   stored input the report's label is decided from.
4. **The versioned criteria and the case set.** The standard version is resolved from `standard_versions`;
   nothing matching is `404 not_found`, and a stored definition that contradicts the fixture set it names
   is refused as `standard_drift`, which maps to `400`. The case set is then loaded through the domain
   package, so the route never imports the fixture package directly.
5. **Scoring.** `scoreSubmission` in `packages/sgi-core/src/scoring/score-submission.ts` applies the
   versioned pass rule: it runs the drift checks, then the structural pass over the recorded outputs — a
   `case_id` the case set does not define is `unknown_case` and a repeated one is `duplicate_case`, both
   `400` — and only then the completeness check. A well-formed submission that records no output for a
   fixture case is refused as `incomplete_submission`, which maps to `422`, **before anything is written
   at all**: a rejected submission leaves zero new rows in `evaluation_reports`, `report_case_results` and
   `ledger_entries`. Each remaining case is then decided by comparing the canonical JSON of its recorded
   output against the canonical JSON of its expected output, and a recorded output holding a value
   canonical JSON cannot represent — a number JSON cannot carry, such as the `1e999` a client can send
   because the submission schema leaves `output` unconstrained, a value that refers to itself, a member
   that cannot be read, or a value that is not JSON data — is refused as `unrenderable_value`, which maps
   to `400`, before anything is written. Nothing submitted is executed: a candidate is declarative data
   compared as text, and there is no evaluation of submitted content anywhere on this path.
6. **The label.** `deriveReportLabel` in `packages/sgi-core/src/reports/build-report.ts` decides it from
   the candidate version's stored `is_fixture_candidate` flag alone. The rule is **total over every
   report** — a failed report carries exactly the label a passed one does, because the label states where
   the run came from and never that it passed — so the four combinations are:

   | `is_fixture_candidate` | outcome | label |
   | --- | --- | --- |
   | true (seeded fixture candidate) | `PASS` | `SAMPLE` |
   | true | `FAIL` | `SAMPLE` |
   | false (version published through the API) | `PASS` | `VERIFIED-IN-DEMO` |
   | false | `FAIL` | `VERIFIED-IN-DEMO` |

7. **One transaction, one act.** Inside a single `db.transaction(...)`:
   - `findLatestReportId` reads the newest existing report for the submitted candidate version **and**
     standard version. That identifier becomes the new report's `prior_report_id`, and it is
     **server-derived and never a client input**, so a retest appends a new report pointing at its
     predecessor while the predecessor stays byte-identical. A version with no earlier report records
     `null`. The read happens inside the same transaction that appends the report it points away from,
     so the predecessor cannot change between the two.
   - `buildReport` assembles the record: the per-case evidence copied in case-set order, the matched and
     total counts, the critical failures and the outcome exactly as the scorer derived them, the rubric
     reference resolved from the standard version that owns it (`SGI-SO-1.0.0#rubric`), the label from
     step 6 and the retest link, with the report identifier and the creation instant generated at write
     time.
   - `insertReport` appends the `evaluation_reports` row and one `report_case_results` row per case, in
     case-set order. A plain INSERT: both tables are append-only, and a report that has become
     inconvenient is superseded by a new report, never adjusted in place.
   - `recordGateFeeCharge` records the flat fictional gate-evaluation fee **once per completed
     evaluation, whether the outcome is `PASS` or `FAIL`**, in the gate-evaluation-fee ledger only. The
     fee is never eligible for a founder allocation, so buying an evaluation can never move a
     measurement or an allocation.
   - The audit event is appended (`evaluation.created`, resource `evaluation_report`, status 201).
8. **`201` with the report.** The response is the record just written, in the wire spelling: identifier,
   candidate version id, standard version label, outcome, matched count, total count, critical failures,
   label, rubric reference, prior report id, creation instant, and the per-case evidence as
   `{ case_id, severity, expected, actual, match }` with `expected` and `actual` the canonical JSON strings
   the comparison actually compared.

**The seeded outcomes, and what they demonstrate.** `apps/api/src/seed/seed-database.ts` runs the real
evaluator over the three candidate fixtures in
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/`, so a fresh database holds three reports before
anyone calls the API. Their expected outcomes are recorded in `expected-outcomes.json` and asserted by the
integration suite:

| candidate | outcome | matched / total | critical failures | failing case ids | label |
| --- | --- | --- | --- | --- | --- |
| `seed-alpha` | `PASS` | 20 / 20 | 0 | none | `SAMPLE` |
| `seed-beta` | `FAIL` | 19 / 20 | 1 | `so-003` (a `critical` case) | `SAMPLE` |
| `seed-gamma` | `FAIL` | 17 / 20 | 0 | `so-014`, `so-016`, `so-018` | `SAMPLE` |

The three are the pass rule's three outcomes in one place: a clean pass, a pass-threshold pass with a
fatal `critical` failure, and a failure of the threshold alone. The rule they are scored against is the
one `SGI-SO-1.0.0` publishes and is read from the stored `standard_versions` row rather than from a
number in the build: at least 18 of 20 cases match **and** no `critical` case fails, anything else `FAIL`.
The case set holds 20 cases, 5 of them `critical` (`so-001`, `so-003`, `so-005`, `so-008`, `so-012`), and
`packages/shared/src/schemas/evaluations-schema.ts` guards the shape of that set without ever deriving an
outcome from its counts.

**A retest in one sentence.** A second submission for the same candidate version and standard version
appends a second report whose `prior_report_id` names the first, and the first is untouched — the
retest semantics are stated in `docs/STANDARD-SGI-SO-1.0.0.md`, and this file only says how the link is
produced.

## 5. Governance path

**A proposal is submitted and reviewed, and nothing else moves it.** A contributor calls
`POST /api/v1/standards/proposals` (contributor role, `201`, status `submitted`; `400` for a body its
schema refuses, `401`, `403`). The inserted row is itself the record of the submission, so no governance
event is appended for it. An operator then calls `POST /api/v1/standards/proposals/{id}/review`
(operator, `200` with the proposal in its new state; `409 already_decided` when the stored status is no
longer `submitted`, `403` for a non-operator, `404` for an identifier no row carries). The review sets the
proposal's `status` to `accepted` or `rejected` and appends one `governance_events` row of type
`proposal_reviewed` inside the same transaction, so the status and the record of the decision cannot
diverge. `packages/sgi-core/src/proposals/review-proposal.ts` sets that one column and nothing else:
the contributor's title and rationale are returned exactly as submitted, and the decision's only record
is the appended event. One event type covers both outcomes and the outcome travels in the event's
payload, because the event vocabulary is closed and every reader of the trail switches on it.

**A standard change is a new standard version, never an edit.** `standard_versions` is append-only: its
thresholds, its case count, its critical-case count and its rubric reference are versioned data, and the
evaluator reads them from the stored row. Approving a proposal does not publish a version, and no route
in this release publishes one — the versions are seeded, and the standards routes publish nothing but
read. The event vocabulary carries `standard_version_published` for that publication path, which is a
new row announcing a new version and never an amendment to an existing one; the registry's insert path
appends that event in the same transaction as the row, so a published version and the record of its
publication cannot diverge, and a publication whose label is already stored appends nothing. The
thresholds and the process are `docs/STANDARD-SGI-SO-1.0.0.md` and `docs/governance/SGI-PROPOSALS.md`;
the column that holds them is `docs/SCHEMA.md`.

**An appeal is opened against a report and ruled through an appended event.** A developer calls
`POST /api/v1/evaluations/{id}/appeals` (developer, `201` with the appeal in status `open`; `404` for a
report no row carries; `400` for a reason that states nothing). Opening it appends one `appeals` row, one
`appeal_opened` governance event, and the route's own audit row, in one transaction. An operator then
calls `POST /api/v1/appeals/{id}/ruling` (operator, `200` with the appeal in its new state; `409` when it
is already ruled — a ruling is final and either outcome a second time is a second ruling; `404`; `403`).
The ruling moves the appeal's own `status` to `upheld` or `denied` and appends one `appeal_ruled` event,
inside one transaction, and it reaches nothing else: no statement on this path names `evaluation_reports`
or `report_case_results`, so **the appealed report and its per-case evidence stay byte-identical** and the
public `GET /api/v1/evaluations/{id}` answers the same report before and after the ruling. The same
additive rule governs moderation: `POST /api/v1/moderation/listings/{id}/actions` (operator, `200`;
`404` for a listing no row carries, `400` for a body whose schema refuses it, including a missing reason)
moves the one mutable column `listings.status` — to `flagged`, to `hidden`, or back to `active` — and
appends a `listing_moderated` event and an audit row beside it, in one transaction, while touching no
measurement and no money record, which is what makes an operator's power additive rather than
corrective. `flag` records a concern without changing visibility, `hide` takes a listing out of search
and compare while leaving it readable to the operator with its history, and `restore` returns a flagged
or hidden listing to `active`.

## 6. Commerce path

**Offer selection to simulated checkout.** A buyer chooses an offer model the listing makes and calls
`POST /api/v1/checkout-simulations` with `{ listing_id, listing_version_id, offer_model }` (buyer role,
`201`). The body carries **no amount**: the offers are built from the pricing models the listing's own
claims state and priced by the one fictional price table in the route, so a buyer cannot name the price of
its own simulated purchase. An identifier naming no listing, a listing the operator has hidden, or a
version that belongs to another listing is `404`; an offer model the listing does not make is
`422 not_offered`, decided by the domain package before any transaction opens, so a refused checkout
leaves zero `transactions` rows and zero `ledger_entries` rows. A completed checkout writes three rows
inside one transaction — the domain package's own transaction, which the route nests inside its own —
in this order, and returns `201`:

1. the `transactions` row, carrying the buyer, the versioned listing, the offer model, the amount as an
   integer count of minor units, the `DEMO` label, `simulated: true` and the disclosure label;
2. the marketplace ledger entry — the charge the transaction took in;
3. the founder-allocation entry, computed from that charge by the product's single rounding point.

The route's audit row is appended inside the same enclosing transaction as the three, so a simulated
checkout and the record of it cannot diverge.

The allocation is the configurable rate — 25 basis points by default, `DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS`
in `packages/commerce-sim/src/config.ts` — applied to the net amount of an **eligible completed simulated
marketplace transaction** and rounded half up in `packages/commerce-sim/src/ledgers/allocate.ts`, the one
place in the product where a fraction is produced or resolved. Eligibility is structural rather than a
checked rule: `recordFounderAllocation` accepts a transaction identifier, a net amount and the resolved
configuration and **nothing else** — there is no parameter for a gate fee, a sponsored-slot record, an
evaluation report or a gross amount — so no other kind of amount can reach the allocation. A zero
allocation still appends its row, because the row records the event rather than the amount, and the entry
states in its own description the basis-point rate it was computed from, so a later configuration change
cannot retroactively alter what a stored row says.

**A refund appends; it corrects nothing.** An operator calls `POST /api/v1/transactions/{id}/refunds`
with `{ amount_minor_units }` (operator, `201` with the appended reversal entries and the refund row).
What a transaction has left to refund is derived on every call as its own amount minus the sum of the
`refunds` rows that reference it, and is **stored nowhere** — no column holds a balance and none may be
added — which is what makes the two refusals computable without mutating anything: `409` when the
transaction is already fully refunded, `422` when the amount exceeds the net remaining, `404` for an
unknown transaction, and `400` for an amount that is not a whole count of at least one minor unit (the
shared schema deliberately admits `0`, so a refund of nothing reaches the domain and is refused there,
because a row stating that nothing was refunded would record an act that did not happen). All four
refusals are decided before the transaction opens. An accepted refund writes one `refunds` row and the
two `ledger_entries` reversal rows the refund rules — the marketplace reversal of the charge and the
founder-allocation reversal of the allocation that charge produced — proportionally to the refunded
amount, inside one transaction, plus the route's audit row. Nothing already stored is edited or removed:
`transactions`, `refunds` and `ledger_entries` are three of the nine append-only tables, and the operator
reads the net position back by reading the rows.

**The three ledgers, and what separates them.** One `ledger_entries` table carries all three ledgers,
discriminated by its `ledger` column: `marketplace` (the charges a simulated checkout took in, and their
reversals), `gate_fees` (the flat fictional evaluation fee, charged per completed evaluation, PASS or
FAIL) and `founder_allocation` (the allocations and their reversals). They are read back by the three
operator routes `GET /api/v1/ledger/marketplace`, `GET /api/v1/ledger/gate-fees` and
`GET /api/v1/ledger/founder-allocation` (`200`, insertion order, `403` for a resolvable non-operator
account and `401` when the header names none). A gate fee is recorded in the gate-fee ledger only and is
never eligible for an allocation, so a fee can never be read as a payment for an outcome. The
founder-allocation read states the rate each entry was computed from, read out of the entry's own stored
description rather than from today's configuration. Every amount stays an integer count of minor units
of `DEMO` with no currency symbol, and the founder-allocation ledger carries **no personal identity, no
beneficiary account and no entitlement** — it assigns a computed share of a simulated transaction to no
one, and its contract structure is labelled `to be determined` wherever it is shown.

## 7. Report read path

`GET /api/v1/evaluations/{id}` is public and resolves no identity at all — a garbage header, a
wrong-role header and an absent header are answered alike. `200` answers the report with its per-case
evidence in case-set order, each entry `{ case_id, severity, expected, actual, match }` where `expected`
and `actual` are the canonical JSON strings the comparison compared; `404 not_found` answers an
identifier no row carries, because a stored report is either there or it is not. Two reads of one report,
and a read of a report just written, answer byte-identical bodies — including after an appeal ruling,
which is how the immutability of a measurement is observable from outside.

**What a reader sees on each outcome.**

- On a `PASS`, the badge names the standard version, the scope `structured output on fixture set only`
  and the report id, and nothing else. It never states or implies general safety, certified security or
  independent certification, and the two-word label vocabulary is closed to `SAMPLE` and
  `VERIFIED-IN-DEMO`.
- On a `FAIL`, there is **no badge**. The report page shows the per-case evidence with a plain-language
  summary of what did not match, and the report still carries its label — a failed report is labelled
  exactly as a passed one is.
- A listing whose latest version has never been evaluated states `null` in the evidence fields and
  renders `No SGI report yet`, the ordinary state of the exchange rather than an error.
- A report for an unknown identifier renders the not-found page with a link back to browse.

## 8. Where determinism lives

Reproducibility is a property of this code rather than a promise about it, and it rests on four
boundaries a contributor must not move.

1. **Comparison is canonical JSON.** `packages/sgi-core/src/scoring/canonical-json.ts` renders a value
   with its object keys sorted by UTF-16 code unit, no space, tab or newline between tokens, and array
   elements in the order they are held. Two sides of whitespace are the point: whitespace *between*
   tokens is insignificant, so a case stating its keys in another order matches; whitespace *inside* a
   string value is data, so a trailing space does not match; and array order is data, so reordered
   elements do not match either. No locale-aware comparison is used anywhere on this path, because it
   would order keys differently on machines with different locales and one value would render several
   strings.
2. **The pass rule is versioned data, not a branch in the code.** The thresholds are read from the stored
   standard version — its total-case count, its critical-case count, its pass threshold and its allowed
   critical failures — and no threshold, case count or standard identifier is written into the scoring
   module. A rule that has become inconvenient is published as a new standard version through the
   proposal and review process, not widened in place.
3. **Nothing in the scoring path reads a clock, a locale, a timezone, a random source, a file or a
   network.** A standard version, a case set and a submission go in and a plain record comes out, and
   two calls over deeply equal arguments return deeply equal results. A community `EvaluatorCheck` that
   replaces the canonical comparison for the cases it declares is held to the same rule: a check whose
   verdict varies between two runs of one submission breaks an invariant of the report rather than
   merely looking odd.
4. **The report's identifier and creation instant lie outside the compared payload.** Both are generated
   at write time and neither is part of what two runs compare, which is why two evaluations of the same
   recording produce identical per-case arrays and an identical outcome, with only the report id, its
   creation instant and its `prior_report_id` link differing. The evidence rows therefore share an
   instant by construction and are read back in insertion order — the case set's own order — rather than
   ordered by `created_at`.

A correction to a measurement is a new report, so the reproducibility claim holds for a retest as well:
the retest states the same cases and the same outcome and links to the report it follows.

## 9. Statuses and limits

Every status the flows above can produce, with the code the envelope carries and what it means. A code
that is a domain refusal keeps the domain package's own stable string as the envelope's `code` rather
than being rewritten to a generic name, and takes its status from the one map in
`apps/api/src/errors/error-codes.ts`:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `validation_error` | The request failed the shape its endpoint validates — a value that fails `type`, `enum`, `minimum` or `maxLength` (every free-text field carries a stated maximum), or an absent or empty `X-Demo-Account` header, which this status answers because the failure concerns that header |
| `401` | `unauthorized` | The demo header is absent, blank, or names no seeded account |
| `403` | `forbidden` | The resolved demo account's role is not one the row accepts, or the resource belongs to another developer |
| `404` | `not_found` | The named row does not exist — an unknown listing or version, a hidden listing for a non-operator, an unknown report, proposal, appeal or transaction — or the path, or the method on that path, is not registered |
| `409` | `conflict` | The resource cannot take the write in the state it is in: a duplicate version string, an already-decided proposal, an already-ruled appeal, an already fully refunded transaction |
| `413` | `payload_too_large` | The request body is larger than the route's limit — 1 MiB by default — which Fastify refuses before any schema runs |
| `415` | `unsupported_media_type` | The request's media type has no parser registered, which Fastify refuses before any schema runs |
| `422` | `unprocessable` | The request is well formed and the state forbids it: a submission with no recorded output for a fixture case, an offer model the listing does not make, an amount above the net remaining |
| `429` | `rate_limited` | More than 60 write requests per minute per client; the response carries `Retry-After` |
| `500` | `internal_error` | A defect rather than a client condition; the client receives a fixed sentence naming no path, identifier or cause |

The domain refusal codes, each mapped to one of the statuses above:

| Code | Status | Produced by |
| --- | --- | --- |
| `unknown_standard` | `404` | A standard version this release does not publish |
| `transaction_not_found` | `404` | No simulated transaction carries the identifier |
| `already_decided` | `409` | The proposal is no longer `submitted` |
| `already_ruled` | `409` | The appeal is no longer `open` |
| `already_fully_refunded` | `409` | The refund rows already account for the whole amount |
| `incomplete_submission` | `422` | The submission records no output for a fixture case |
| `not_offered` | `422` | The listing does not make the selected offer model |
| `exceeds_net_remaining` | `422` | The refund amount is larger than what is left |
| `unknown_case` | `400` | The submission names a case the case set does not define |
| `duplicate_case` | `400` | The submission records two outputs for one case |
| `invalid_proposal` | `400` | The proposal body states nothing usable |
| `invalid_appeal` | `400` | The appeal's reason is empty or whitespace |
| `standard_drift` | `400` | The stored standard definition and its fixture set disagree |
| `invalid_amount` | `400` | The amount is not a whole count of at least one minor unit |
| `unrenderable_value` | `400` | A recorded output holds a value canonical JSON cannot represent, such as a number JSON cannot carry |

**Limits.** Page size is 20 and there is no page-size parameter. Writes are capped at 60 requests per
minute per client, answered `429` with `Retry-After` beyond that; reads are unlimited. Evaluation is
synchronous inside the request — no queue, no worker, no job — so a report is written before the `201` is
sent. The whole product is one process over one SQLite file, with no external service, no secret and no
required environment variable; the two optional inputs are `ADEM_PORT` (default 3000) and `ADEM_DB_PATH`
(default `<repository root>/.adem/adem.sqlite`), both resolved in `apps/api/src/config.ts`.

## 10. Flow diagrams

The two flows above are drawn here as plain ASCII on purpose: the repository ships no diagram tooling, so
a diagram has to be readable in a plain editor and diff cleanly. Stages run left to right, and each
failure stage ends at the status it answers with.

**Write path** — every non-public row of the API register:

```text
caller -- JSON over HTTP/1.1 on one port, under the /api/v1 prefix
   |
   v
[1] write rate limit ------------ 60 per minute per client ------------> 429 rate_limited  (+ Retry-After)
   | within the bound
   v
[2] JSON-schema validation ------ body / query / path -----------------> 400 validation_error
   | valid                              (an absent or empty X-Demo-Account header too)
   v
[3] X-Demo-Account resolution --- header absent, blank, or naming no seeded account
   | apps/api/src/auth/resolve-demo-account.ts -----------------------> 401 unauthorized
   v
[4] role assertion -------------- resolved account lacks the row's role -> 403 forbidden
   | apps/api/src/auth/require-role.ts      (two thread rows skip this step)
   v
[5] one domain call in one transaction -- a domain refusal ------------> 404 not_found
   |  INSERTs only, for append-only tables     mapped by its stable   -> 409 conflict
   v                                           code                   -> 422 unprocessable
[6] audit event appended in the same transaction (audit_events)         -> 400 validation_error
   | apps/api/src/audit/append-audit-event.ts
   v
[7] 201 / 200 with the created resource (the stored row, not a recomputation)

unregistered path, or an unregistered method on a registered path ------> 404 not_found
```

**Evaluation path** — `POST /api/v1/evaluations`, the one flow the product is built around:

```text
developer -- { candidate_version_id, standard_version_id, recorded_outputs: [{ case_id, output }] }
   |           no retest field: the body policy answers an undeclared one 400 before the handler runs
   v
[rate limit] -> [schema] -> [401] -> [developer role 403]
   v
candidate version row --- listing_versions JOIN listings --- no such version --> 404 not_found
   | the row supplies is_fixture_candidate
   v
ownership: the version's listing belongs to another developer ---------------> 403 forbidden
   v
versioned criteria (standard_versions) --- nothing published matches --------> 404 not_found
   |                                       definition contradicts set ------> 400 standard_drift
   v
scoring (packages/sgi-core/src/scoring/score-submission.ts)
   |-- structural pass -- case_id unknown / repeated ------------------------> 400 validation_error
   |-- completeness ---- a fixture case with no recorded output -------------> 422 unprocessable
   |                                                            (before anything is written)
   \-- per case: canonicalize(expected) vs canonicalize(actual)
                 -> matched_count, critical_failures, outcome
   v
label = deriveReportLabel(is_fixture_candidate, outcome)     SAMPLE | VERIFIED-IN-DEMO
   v
[one transaction]
   prior_report_id = newest earlier report for this version and standard, else null
   insertReport        -> evaluation_reports + one report_case_results row per case
   recordGateFeeCharge -> gate-evaluation-fee ledger (PASS or FAIL, this ledger only)
   appendAuditEvent    -> audit_events ("evaluation.created", 201)
   v
201 report  { outcome, counts, label, rubric_reference "SGI-SO-1.0.0#rubric",
              prior_report_id, created_at, case_results[{ case_id, expected, actual, match }] }
   v
GET /api/v1/evaluations/{id} (public) re-reads the same report, unchanged by any appeal ruling
```
