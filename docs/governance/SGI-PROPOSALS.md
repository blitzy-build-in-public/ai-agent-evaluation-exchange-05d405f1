# Standard Gate Index: how a proposal becomes a standard

This is the governance document of the Standard Gate Index: how a standards proposal is submitted, reviewed, ruled and turned into a published standard version, and what the append-only record of those decisions holds. It is written for the four roles that take part — the community contributor who proposes, the developer who lists agents and appeals a report, the operator who reviews, rules and moderates, and the maintainer who reviews the protected paths — and for the anonymous reader, who may read all of it. `docs/governance/` is one of the CODEOWNERS-protected paths in `.github/CODEOWNERS`, so a change to this file is itself a reviewed change. The rubric, the case list, the evidence shape, the seeded outcomes and the report's field list belong to `docs/STANDARD-SGI-SO-1.0.0.md` and are not restated here.

## Why governance exists here

A published outcome is worth reading only if the criteria behind it are fixed, versioned and reviewed by a person. Three properties make that true here, each with an enforcement point rather than an intention behind it.

1. **The pass rule is data stored with the standard version**, not a branch in the scoring code: `standard_versions` carries `total_cases`, `critical_cases`, `pass_threshold_matches`, `critical_failures_allowed`, `status` and `rubric_reference`, and the evaluator reads them from the stored row, so two runs over one version cannot disagree.
2. **The same candidate scored twice yields the same per-case results and the same outcome.** Nothing in the scoring path reads a clock, a locale, a timezone, a random source or the network, and each case is decided by comparing canonical JSON strings.
3. **A decision is a human decision that gets recorded, never an automated one.** No route, job or configuration value can widen a threshold; the one way criteria change is a reviewed proposal that publishes a new standard version.

A change to a case set, a severity, a threshold or a rule is therefore a governance change — proposed, reviewed and published as a new version — and never an edit to a file or to a row.

## Who does what

| Role | What it may do | How it is recognised |
|---|---|---|
| Anonymous reader | Read the standards catalogue, one published version, any report and all of `docs/` | Nothing: `GET /api/v1/standards` and `GET /api/v1/standards/{id}/versions/{v}` are public |
| Community contributor | Submit a standards proposal; open a discussion thread; contribute code, fixture packs and evaluator checks | `X-Demo-Account` names a seeded account whose role is `contributor` |
| Developer | Publish a listing and a version, evaluate its own version, open an appeal against a report | Header names an account whose role is `developer` |
| Operator | Review a proposal, rule an appeal, moderate a listing, read the audit feed and the three ledgers | Header names an account whose role is `operator` |
| Maintainer | Review a change to a CODEOWNERS-protected path and merge it | Repository review, not an API role: no header grants it |

`X-Demo-Account` names one of the six seeded synthetic accounts, by its `id` or its `handle`, matched exactly. It is a **synthetic role selector and never authentication**: it separates roles for this demonstration and asserts nothing about who the caller is, and where the UI shows it, it shows the label `demo only, no production authentication`. An absent, blank or unresolvable value is `401`, a resolvable account whose role the row does not accept is `403`, both are produced before any domain call, and every failure answers the one envelope `{ "error": { "code", "message" } }`. Writes are rate-limited to 60 requests per minute per client and answered `429` with a `Retry-After` header beyond that; reads carry no limit. The order in which a write is admitted — rate limit, schema validation, `401`, `403`, one transactional domain call, the audit append, `201` or `200` — is `docs/DATA-FLOW.md` section 3.

## The proposal lifecycle

A proposal moves through exactly this machine, and nothing else moves it: `submitted` → `accepted` **or** `rejected`.

| Step | What changes | What is appended | What may never change |
|---|---|---|---|
| Submit | One `standard_proposals` row is inserted in status `submitted` | **Nothing**: the inserted row is itself the record of the submission | — |
| Review | That row's `status` moves to `accepted` or `rejected` | **Exactly one** `governance_events` row, of type `proposal_reviewed` | The row's `title`, `rationale`, `standard_id`, `proposer_account_id`, `created_at` and `id` |
| Second review | Nothing | Nothing | The decision already made: answered `409` `already_decided` |

1. `status` is the row's **only** mutable column, and the operator review route is its only writer. The title and rationale are the contributor's own argument and are returned exactly as submitted, so a later reader sees the reasoning the decision answered.
2. The transition is one-way: `submitted` is the initial state and not a review outcome, so no review reopens or un-decides a proposal, and a decided proposal is `409` `already_decided` whether the second attempt agrees with the first outcome or reverses it.
3. A withdrawn or superseded proposal is a new proposal, not an edit to the decided one, and approving one does not itself change the Standard Gate Index: the change becomes real only as a published version.

## Submitting a proposal

| Method and path | Role | Success | Error cases |
|---|---|---|---|
| `POST /api/v1/standards/proposals` | contributor | `201` with the proposal in status `submitted` | `400` `validation_error` for a body its schema refuses, `400` `invalid_proposal` for a blank `title` or `rationale`, `401`, `403` for a resolvable non-contributor, `404` `unknown_standard` when `standard_id` names no catalogue row |

The body carries three required strings — `standard_id`, `title`, `rationale` — and nothing else. `status` is not a body field and cannot be made one, so a proposer cannot decide its own proposal, and the proposer is resolved from the header rather than supplied. The text is stored exactly as submitted, untrimmed.

`submitProposal` in `packages/sgi-core/src/proposals/submit-proposal.ts`, reached only through the package's single public entry `packages/sgi-core/src/index.ts`, validates the text before touching the database, resolves the standard by row id or by the code `SGI-SO-1.0.0`, and inserts one row carrying the **resolved row id** — never the reference it was addressed by, because `standard_id` is a foreign key and a review's trail must point at the row. The route appends the audit action `proposal.submitted` in the same transaction, so the proposal and the record of who wrote it stand or fall together, and it appends **no** governance event: the append sites are the six in section 10.

The reads beside it answer the stored versioned criteria verbatim and recompute nothing. `GET /api/v1/standards` answers the catalogue, each standard with its versions and its proposals. `GET /api/v1/standards/{id}/versions/{v}` answers one published version, addressed by the standard's row id or its code and by the version's row id or its label `SGI-SO-1.0.0`, carrying the four thresholds, the status, the rubric reference and the parsed definition. An absent collection is `200` with an empty list, never an error.

**The front door is an issue, not a route.** `.github/ISSUE_TEMPLATE/standards-proposal.md` asks for the standard or case set concerned, the change and its rationale, the evidence that supports it, the acceptance note, and the licence and attribution declaration for any contributed fixture pack. That template describes this same process, so the two must agree; where they would drift, this document governs. The issue is how a proposal is discussed and triaged; it becomes real in the database through the route above.

## Reviewing a proposal

| Method and path | Role | Success | Error cases |
|---|---|---|---|
| `POST /api/v1/standards/proposals/{id}/review` | operator | `200` with the proposal in its new state | `400` for a body or decision value its schema refuses, `401`, `403` for a resolvable non-operator, `404` `not_found` for an identifier no row carries, `409` `already_decided` when the stored status is no longer `submitted` |

The body's required field is named `status` because that is the column the review moves, and its values are `accepted` or `rejected`; it maps into the `decision` parameter of `reviewProposal` in `packages/sgi-core/src/proposals/review-proposal.ts`. That function reads the row by id, refuses a second review before writing as `409` `already_decided`, moves the `status` column and nothing else, appends **exactly one** `governance_events` row, and returns the proposal with its text unchanged. The appended event carries `subject_type` `standard_proposal`, the proposal's id as `subject_id`, the type `proposal_reviewed`, the reviewing account, the stated reason where one was given, a canonical-JSON payload (the proposal, its standard, the status it came from and the status it moved to) and an ISO-8601 UTC instant. All of it runs in **one transaction**, and one event type covers both outcomes because every reader of the trail switches on a closed vocabulary. The route appends the audit action `proposal.reviewed`; it never writes `governance_events` and never touches `standard_versions`.

**What a reviewer must decide**, and record by deciding:

1. Does the change need a new standard version, or is it an edit the plan does not permit? Any change to a threshold, a case, a severity or the pass rule is the former.
2. Do the proposed thresholds and the selection of `critical` cases keep the pass rule meaningful? A threshold that can be met while a critical case fails, or a critical set that omits the cases the rule turns on, is not a change to accept.
3. Is the case set self-consistent: the stated total and critical counts equal to what the case file holds, and each case's severity stated once?
4. Does it keep comparison canonical and deterministic — no clock, locale, timezone, random source or network anywhere in scoring?
5. Does it keep a candidate a declarative submission that is never executed? Fixtures only.
6. Does it keep commercial, fee and sponsored data entirely out of scoring, gate outcomes, badges and organic ordering?
7. Does it keep the label vocabulary closed to `SAMPLE` and `VERIFIED-IN-DEMO`, and the badge's claims narrow — the standard version, the scope `structured output on fixture set only` and the report id, and nothing about safety, certification or a guaranteed pass?

The decision is recorded **only** as the status change plus the appended event: the proposal has no ruled-at, ruled-by or ruling-reason column, and adding one would create a second authority for a fact the event already holds. Human review is mandatory; automated standards governance is explicitly deferred, and nothing in this process is automatic.

## Publishing a new standard version

1. **Criteria change only by publishing a new version, and an existing version is never edited.** `registerStandardVersion` in `packages/sgi-core/src/standards/standard-registry.ts` issues `INSERT` and `SELECT` only, and registering an already-published label with different criteria is refused as drift, naming the member that differs. A version's identifier is immutable because `standard_versions` is append-only, guarded by the `BEFORE UPDATE` and `BEFORE DELETE` triggers raising `ABORT` in `packages/shared/migrations/0010_append_only_triggers.sql` — **defence in depth and never a security boundary**, since a connection holding write access can drop one. The guarantee is that no route offers the mutation, and `apps/api/test/integration/immutability.test.ts` proves it.
2. **Thresholds are provisional and versioned with the standard.** They are stored columns on the version row — `total_cases`, `critical_cases`, `pass_threshold_matches`, `critical_failures_allowed`, `status`, `rubric_reference`, `definition_json` — read from there and never from a literal in code. `scoreSubmission` in `packages/sgi-core/src/scoring/score-submission.ts` applies the rule the row states, and `getStandardCaseSet` refuses as `standard_drift` (`400`) when a loaded fixture set's identity or counts are not the version's, so the criteria in the database and the cases in the fixture package cannot drift apart unnoticed.
3. **A change to the case set is a new version with its own fixture set**, not an edit to `SGI-SO-1.0.0`; `docs/starter-tasks/new-standard-version-case-set.md` is the worked contribution route for it. The `rubric_reference` a report stores is `SGI-SO-1.0.0#rubric`, which resolves to the anchor `#rubric` in `docs/STANDARD-SGI-SO-1.0.0.md`.
4. **Applied migration files are immutable, and migrations only add:** none may drop or rewrite anything. `apps/api/src/db/migrate.ts` records each applied file's version, name and SHA-256 checksum in `schema_migrations` and refuses to start the server when an applied file's bytes changed, so a governance change is never a migration edit.
5. **The tables are `standards`, `standard_versions`, `standard_proposals`, `governance_events` and `appeals`**, created by `packages/shared/migrations/0005_standards_and_proposals.sql` and `packages/shared/migrations/0007_governance_events_and_appeals.sql`; their columns, constraints and ownership are `docs/SCHEMA.md` and are not repeated here. `standard_versions` and `governance_events` are **append-only**; `standard_proposals` and `appeals` are mutable in the `status` column only and are **not** among the nine append-only tables.
6. **Publication is its own act.** The closed vocabulary carries `standard_version_published` for the append site that announces a newly published version, and it never means "standard updated". No call site in this release appends it: `registerStandardVersion` writes the version row and imports no event writer, no route publishes a version, the versions are seeded, and approving a proposal publishes nothing. A report keeps citing the standard version it was scored under, because `standard_version_id` and `rubric_reference` are stored per report.

## Retests

A retest for the same candidate version and standard version creates a **new** report linked to its predecessor; the existing report is untouched. The link is server-derived and never a client input: the body of `POST /api/v1/evaluations` carries no retest field at all, and Fastify removes an unexpected one before the handler runs. The route obtains the predecessor from `findLatestReportId(db, candidateVersionId, standardVersionId)` in `packages/sgi-core/src/reports/report-repository.ts`, which returns the newest existing report for the same candidate **and** standard version, or `null` when that version has no prior report, inside the same transaction that appends the new report.

**The label never follows the outcome.** `deriveReportLabel` in `packages/sgi-core/src/reports/build-report.ts` decides it from one stored input, the candidate version's `is_fixture_candidate` flag: a fixture-candidate version is labelled `SAMPLE` and any other version `VERIFIED-IN-DEMO`, on `PASS` and `FAIL` alike. A **badge** is issued on `PASS` alone and names the standard version, the scope `structured output on fixture set only` and the report id; a `FAIL` report carries **no badge** and shows its per-case evidence with a plain-language summary instead. The evidence shape, the field list and the seeded outcomes are `docs/STANDARD-SGI-SO-1.0.0.md`.

The retest's own record in code is the report's `prior_report_id` plus the route's audit action `evaluation.created`. The closed vocabulary carries `retest_created` for the retest append site; as with a version's publication, no call site in this release appends it.

## Appeals

| Method and path | Role | Success | Error cases |
|---|---|---|---|
| `POST /api/v1/evaluations/{id}/appeals` | developer | `201` with the appeal in status `open` | `400` `invalid_appeal` for a blank reason, `404` `not_found` for a report no row carries, `401`, `403` for a resolvable non-developer |
| `POST /api/v1/appeals/{id}/ruling` | operator | `200` with the appeal in its new state, `upheld` or `denied` | `404` `not_found`, `409` `already_ruled` when a terminal ruling exists, `401`, `403` |

Both rows are owned by `apps/api/src/routes/appeals.ts`, and the ruling body's required field is named `status` — the column the ruling sets — mapping into the domain's `ruling` parameter.

**Opening.** `openAppeal` in `packages/sgi-core/src/appeals/open-appeal.ts` validates the stated reason before any read, verifies the report exists with one read against `evaluation_reports` alone, then inserts one `appeals` row and appends one `appeal_opened` governance event **in one transaction**, so an appeal and the record of its opening cannot diverge. The stated ground is stored verbatim. The domain performs no ownership lookup, deliberately: resolving whether the developer owns the version the report measures would mean reading `listings` and `listing_versions`, which `apps/api` owns, and the route's role check supplies the `403`. The route appends the audit action `appeal.opened`.

**Ruling.** `ruleAppeal` in `packages/sgi-core/src/appeals/rule-appeal.ts` refuses an unknown appeal as `404` `not_found` and one that already carries a terminal ruling as `409` `already_ruled`, before anything is written — a ruling is final, and the same outcome a second time is as much a second ruling as the opposite one. It then moves the appeal's own `status` and appends **one** `appeal_ruled` event whose payload carries the outcome and the status it moved from, in one transaction. The operator's ground travels into the event only; the row keeps the developer's reason. The route appends the audit action `appeal.ruled`.

1. **A ruling never changes a measurement.** Neither the route nor the domain reads or writes `evaluation_reports` or `report_case_results` on this path, the ruling's whole history lives in `governance_events`, and `GET /api/v1/evaluations/{id}` returns the identical report afterwards.
2. **An appeal cannot turn a `FAIL` into a `PASS`.** The remedy is a retest against a new submission, not a rewrite of the evidence.

The check is `apps/api/test/integration/immutability.test.ts`: it opens and rules an appeal on a seeded report, asserts the log grew by exactly one event for that subject, asserts the report payload is byte-identical afterwards, and asserts a second ruling answers `409` and appends nothing.

## The append-only record

Exactly nine tables forbid an `UPDATE` and a `DELETE`, named once in `docs/SCHEMA.md` section 4: `standard_versions`, `evaluation_reports`, `report_case_results`, `governance_events`, `ledger_entries`, `transactions`, `refunds`, `audit_events` and `listing_versions`. `standard_proposals` and `appeals` are **not** among them, which is what makes a review and a ruling legal at all: each moves one status column and appends an event, and the history the row cannot hold lives in the log beside it.

An appended row accepts exactly one kind of write — a newly inserted row. `appendEvent` in `packages/sgi-core/src/events/append-event.ts` is the single insert path into `governance_events`: a plain `INSERT`, never a replace-style conflict resolution, which SQLite documents as bypassing a delete trigger, with the payload stored as canonical JSON so two runs that append the same payload write byte-identical text. `listEvents` reads events in insertion order (`created_at ASC`, then `rowid ASC`) and returns an empty list rather than an error when nothing matches. The vocabulary is closed, declared once in `packages/shared/src/types/governance-event.ts` and enforced by the appender before anything is written; a type outside it is refused with `unknown_event_type`.

| Append site | Event type | Call site |
|---|---|---|
| A standards proposal's review | `proposal_reviewed` | `packages/sgi-core/src/proposals/review-proposal.ts` |
| A listing's moderation | `listing_moderated` | `apps/api/src/routes/moderation.ts` |
| An appeal's opening | `appeal_opened` | `packages/sgi-core/src/appeals/open-appeal.ts` |
| An appeal's ruling | `appeal_ruled` | `packages/sgi-core/src/appeals/rule-appeal.ts` |
| A standard version's publication | `standard_version_published` | Declared in the vocabulary; no call site appends it in this release |
| A retest | `retest_created` | Declared in the vocabulary; no call site appends it in this release |

**What an operator may and may not do.** An operator may moderate a listing — the action `flag`, `hide` or `restore`, moving the one mutable column `listings.status` and appending a `listing_moderated` event — review a proposal, rule an appeal, and read the ledgers and the audit feed. An operator may not alter a standard version, a report, its per-case evidence or an appended event: those routes do not exist. The operator's power is additive only.

**The triggers are not the proof.** `packages/shared/migrations/0010_append_only_triggers.sql` creates a `BEFORE UPDATE` and a `BEFORE DELETE` trigger running `RAISE(ABORT)` on each of the nine, standing behind the rule as defence in depth; they are not a security boundary, and nothing here claims that a policy or a trigger isolates anything. The rule is that no route offers the mutation, and `apps/api/test/integration/immutability.test.ts` proves it by attempting an update and a delete against each of the nine through every route that exists, asserting that none accepts the attempt and that every stored row is byte-identical afterwards.

## Commercial and sponsored data stay out

Fees, sponsorship and commercial data never reach a score, a report, a badge or the organic ordering of a listing. The reason is structural rather than procedural: **no import path exists** from `packages/sgi-core` to the commerce package `packages/commerce-sim` or to sponsorship data, so no code path can carry a commercial value into a measurement. Two checks hold it, answering different questions:

- `apps/api/test/integration/boundary-check.ts` walks the import specifiers of every file under `packages/sgi-core/` and every workspace manifest and reports each forbidden edge. Being static, it holds for code paths no test ever runs.
- `apps/api/test/integration/trust-separation.test.ts` is the behavioural half: it varies sponsorship and fee data and asserts that reports, badges and organic ordering are identical.

Sponsored items are returned in their own labelled collection, each carrying `sponsored: true` and rendered with the literal label `Sponsored`, in a block of its own below the organic results and never interleaved with them. A gate-evaluation fee is recorded in the gate-fee ledger only, once per completed evaluation whether the outcome is `PASS` or `FAIL`, and is never eligible for an allocation. Amounts are integer minor units of the synthetic currency `DEMO`; no real currency code and no currency symbol appears anywhere; the founder-allocation structure is labelled `to be determined` and carries no personal identity, beneficiary account or entitlement. **Buying an evaluation never guarantees a pass: outcomes depend on test evidence only.**

## Maintaining review over the protected paths

`.github/CODEOWNERS` declares maintainer review for seven paths: `packages/sgi-core/`, `packages/sgi-fixtures/`, `packages/shield/`, `packages/commerce-sim/`, `docs/governance/`, `scripts/scan-exclusions.ts` and `.github/`. In practice:

- A change to scoring, to a standard version, to a case set or to the fixture package needs a maintainer's review **and** a new standard version wherever the criteria change. A change that edits a published version instead is refused by design, so it is a review finding rather than a merge.
- A change to a security-critical module belongs to the same scope `SECURITY.md` names for a security fix, so a vulnerability report and a routine change to one of these packages arrive the same way.
- A change to this document is itself a reviewed change, because `docs/governance/` is on the list.
- The file uses the single generic placeholder `MAINTAINER-PLACEHOLDER`, with a comment stating that the project owner must replace it before the repository is published. Until then the paths have no effective owner and no review is requested automatically: ownership is declared, not yet assignable.

**How this document changes.** A change to `docs/governance/SGI-PROPOSALS.md` arrives as a reviewed pull request: it is a Markdown policy document, not an append-only record and not a migration. The rules it describes cannot be changed by editing code or an applied migration — a criteria change reaches the product only through a reviewed proposal that publishes a new standard version. `CONTRIBUTING.md` states the contribution path and the pull-request checklist, and `docs/ROADMAP.md` states the milestones and priority tiers.

## Boundaries and non-goals

- Governance requires human review, and nothing in this process is automated.
- The accounts resolved from `X-Demo-Account` are synthetic and the header is a role selector, not authentication; the visible label is `demo only, no production authentication`.
- Submitted third-party agent code is never executed: a candidate is a declarative submission compared as data, on fixtures only.
- No real money moves; every amount is an integer in minor units of `DEMO`.
- Commercial payments, gate fees and sponsored content never influence a measurement, a gate outcome, a badge or organic ordering, and buying an evaluation never guarantees a pass.
- The report labels are `SAMPLE` and `VERIFIED-IN-DEMO`; nothing here is, or implies, independent certification, and a fixture-set result says nothing about an agent outside those fixtures.
- Out of scope and needing separate approval: production authentication, real payments, execution sandboxes, paid live advertising and personalised tracking, enterprise compliance and connectors, and deployment, announcements and outreach.

## Where to go next

Documents: `docs/STANDARD-SGI-SO-1.0.0.md` (the rubric, the pass rule, the evidence and how that standard changes); `docs/SCHEMA.md` (the tables, their owners and the mutable-versus-append-only split); `docs/DATA-FLOW.md` (the write, evaluation and governance paths step by step); `docs/ROADMAP.md` (milestones and priority tiers); `docs/starter-tasks/new-standard-version-case-set.md` and `docs/starter-tasks/standard-proposal-document.md` (the worked contribution routes); `.github/ISSUE_TEMPLATE/standards-proposal.md` (the intake form for a proposal); and `CONTRIBUTING.md`, `README.md` and `SECURITY.md` (the contribution path, the product's own account of what works, and the scope of a security fix).

Code: `apps/api/src/routes/standards.ts` and `apps/api/src/routes/appeals.ts` (the five routes above); `packages/sgi-core/src/proposals/`, `packages/sgi-core/src/appeals/` and `packages/sgi-core/src/events/append-event.ts` (the domain behaviour and the single writer of the append-only log); `packages/sgi-core/src/standards/standard-registry.ts` (the catalogue, the versions and the case set a version is scored against); `packages/sgi-core/src/reports/` (report construction, the label rule and the retest link); `packages/sgi-core/src/index.ts` (the package's single public entry, through which every call above is reached and the extension seams `FixturePack`, `EvaluatorCheck`, `ListingCategory` and the registry are exported — a contributor's extension arrives through those seams, as `examples/extension-fixture-pack/` demonstrates, and never by editing `packages/sgi-core/src/scoring/`); and `packages/shared/migrations/0005_standards_and_proposals.sql`, `0007_governance_events_and_appeals.sql` and `0010_append_only_triggers.sql` (the tables and the defence-in-depth guards).
