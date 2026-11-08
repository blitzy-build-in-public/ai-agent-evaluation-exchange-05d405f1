# ADEM schema

The one SQLite database ADEM keeps, table by table: what each table holds, which package owns it,
which tables may never be rewritten, and how the schema is applied.

This is the schema's own reference. How data moves through it — the order one request, one
evaluation, one governance decision and one simulated purchase write in — is `docs/DATA-FLOW.md`;
the module map and the workspace boundaries are `docs/ARCHITECTURE.md`; the trust boundaries and the
mitigations are `docs/THREAT-MODEL.md`; and the pass rule the stored thresholds belong to is
`docs/STANDARD-SGI-SO-1.0.0.md`. None of those is restated here.

## 1. Scope and ownership

ADEM keeps exactly one SQLite database file per server instance — `.adem/adem.sqlite` under the
repository root by default, overridden by `ADEM_DB_PATH` — and that one file holds the whole
product's state. The schema is produced only by the ordered SQL files in
`packages/shared/migrations/`, which `apps/api/src/db/migrate.ts` applies at start-up, so the DDL
committed in the repository is the DDL that runs and no route or module creates a table. Identifiers
are UUID strings, timestamps are ISO-8601 UTC strings written by the application at insert time, and
every monetary field is a non-negative integer count of minor units of the synthetic currency
`DEMO`, whose single spelling is `SYNTHETIC_CURRENCY_LABEL` in `packages/shared/src/constants.ts`.

## 2. Connection pragmas

`apps/api/src/db/connection.ts` opens the one connection and requests three pragmas, each as its own
statement **outside any transaction**:

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Commits go to a separate `-wal` file, so a reader does not block the writer and the writer does not block a reader. |
| `synchronous` | `FULL` | An append-only record is worth the fsync: a report, a ledger entry or an audit row that survives a crash is the whole claim those tables make. |
| `foreign_keys` | `ON` | SQLite leaves foreign keys off by default and the setting is per connection, so the relationships in section 5 hold only because every connection the server opens says so. |

Two consequences are worth knowing before quoting a pragma as a guarantee.

- **WAL on an in-memory database yields `memory`, and that is not an error.** The mode that results
  is deliberately not asserted, because the integration suite in `apps/api/test/integration/` runs
  on one `:memory:` connection and an assertion would refuse every one of its runs.
- **SQLite allows one writer at a time, and this schema does not attempt to change that.** The
  deployment the pragmas suit is the one the product ships: one process, one connection, one
  container. A second writer process is a second source of contention, not a supported mode.

## 3. Table reference

Five kinds of store appear below, and the difference between them is a rule rather than a label:

- **mutable** — a route updates it. `listings` and `appeals` are mutable in one column or one
  purpose only, named in their notes.
- **append-only (nine)** — a route may only INSERT. The nine are named exactly once in section 4.
- **append-only by route design** — the route that writes it only ever inserts, but the table is not
  one of the nine and no trigger guards it.
- **seed/read-only** — written by `apps/api/src/seed/seed-database.ts` and by nothing else.
- **append-only as far as the runner is concerned** — the runner records a file once and never
  replaces the row. `schema_migrations` is the only table of this kind.

| Table | Owner package | Key columns | Store kind | Notes |
|---|---|---|---|---|
| `accounts` | `apps/api` | `id`, `handle`, `role` (`developer` \| `buyer` \| `contributor` \| `operator`), `display_label` | Mutable, seed/read-only | Six synthetic rows, one per role plus two extra developers and buyers, resolved from the `X-Demo-Account` header. No credential, session, email or personal-name column exists, and none may be added. `handle` is UNIQUE. |
| `categories` | `apps/api` | `id`, `slug`, `name` | Mutable, seed/read-only | Four categories, the closed set a listing filter draws on. `slug` is UNIQUE. |
| `listings` | `apps/api` | `id`, `developer_account_id`, `slug`, `title`, `summary`, `category_id`, `license_code`, `pricing_model` (`rent` \| `purchase` \| `license` \| `subscription`), `status` (`active` \| `flagged` \| `hidden`), `created_at`, `updated_at` | Mutable | Developer-owned content plus the operator's moderation status, which defaults to `active`. A `hidden` listing leaves search and compare but stays readable to the operator with its history. `slug` is deliberately not UNIQUE: no route documents a conflict for a repeated slug, and listings are addressed by `id`. |
| `listing_versions` | `apps/api` | `id`, `listing_id`, `version_string`, `notes`, `is_fixture_candidate`, `created_at` | **Append-only** | The UNIQUE `(listing_id, version_string)` pair is the contract's `409` on a duplicate version string; the same string under another listing is a different version. `is_fixture_candidate` stores `1` or `0` and is the single stored input to a report's label: `1` for the three seeded candidate fixture references, `0` for every version published through the API. |
| `listing_claims` | `apps/api` | `id`, `listing_version_id`, `claim`, `limitation`, `evidence_summary`, `license_code`, `pricing_model` | Mutable | What a listing claims about one version, beside the limitation it states and a summary of the evidence, so the compare view can set claims against measured evidence. `license_code` and `pricing_model` repeat the listing's values because a claim is compared as claimed for that version. |
| `inquiries` | `apps/api` | `id`, `listing_id`, `buyer_account_id`, `message`, `created_at` | Mutable | Written once by `POST /inquiries`; no route rewrites one in this release. The buyer is a synthetic account, so no personal identity or contact detail is collected. |
| `challenges` | `apps/api` | `id`, `listing_id`, `buyer_account_id`, `question`, `status` (`open` \| `responded`), `created_at` | Mutable | The public challenge board. `status` defaults to `open` and is the only column a response changes. |
| `challenge_responses` | `apps/api` | `id`, `challenge_id`, `account_id`, `body`, `created_at` | Append-only by route design | Written once by `POST /challenges/{id}/responses`. **Not** one of the nine: no trigger guards it, so the route's insert-only behaviour is the whole guarantee. |
| `threads` | `apps/api` | `id`, `title`, `author_account_id`, `created_at` | Mutable | Any resolved demo account may start a thread; the row names that synthetic handle and nothing else. |
| `thread_posts` | `apps/api` | `id`, `thread_id`, `author_account_id`, `body`, `created_at` | Append-only by route design | Written once by `POST /threads/{id}/posts`. Not one of the nine, on the same terms as `challenge_responses`. |
| `standards` | `packages/sgi-core` | `id`, `code` (`SGI-SO-1.0.0`), `title` (`Structured Output Conformance`), `summary` | Mutable, seed-only | One row in this release, written by the seed and not by a migration. `code` is UNIQUE, which is what lets a standard be addressed by the identifier people quote. No timestamp column exists, because nothing reads or orders it by one. |
| `standard_versions` | `packages/sgi-core` | `id`, `standard_id`, `version_label`, `status` (`provisional` \| `active`), `total_cases` (20), `critical_cases` (5), `pass_threshold_matches` (18), `critical_failures_allowed` (0), `rubric_reference`, `definition_json`, `published_at` | **Append-only** | The versioned criteria an evaluation is scored against, held as data rather than as a branch in scoring code, so two runs over one version cannot disagree. The pass rule is read from these columns; changing any of them means inserting a new version row, never editing one. UNIQUE `(standard_id, version_label)` is both the address a version is fetched by and what keeps a published identifier immutable. |
| `standard_proposals` | `packages/sgi-core` | `id`, `standard_id`, `proposer_account_id`, `title`, `rationale`, `status` (`submitted` \| `accepted` \| `rejected`), `created_at` | Mutable | `status` is the only mutable column, and it defaults to `submitted`. Operator review moves it and appends a governance event; the decision is refused with a conflict once made, and the title and rationale are never rewritten by anyone. |
| `evaluation_reports` | `packages/sgi-core` | `id`, `candidate_version_id`, `standard_version_id`, `outcome` (`PASS` \| `FAIL`), `matched_count`, `total_count`, `critical_failures`, `label` (`SAMPLE` \| `VERIFIED-IN-DEMO`), `rubric_reference`, `prior_report_id`, `created_at` | **Append-only** | One evaluation, carrying the provenance every report states. The outcome is derived from the versioned rule in `standard_versions` rather than restated as a constraint here. `label` has no default: which of the two a report takes follows from `listing_versions.is_fixture_candidate` and the outcome, and a FAIL report carries one of the two exactly as a PASS report does. `prior_report_id` is the retest link, nullable for the two cases that make it one — a version's first report points at nothing, and a retest inserts a new report pointing at its predecessor. It is never a client input; `POST /evaluations` carries no retest field and the route derives the value. `id` and `created_at` are generated at write time and lie outside the compared payload. |
| `report_case_results` | `packages/sgi-core` | `id`, `report_id`, `case_id`, `severity` (`critical` \| `standard`), `expected_json`, `actual_json`, `match` | **Append-only** | One row per fixture case per report, written in the same transaction as its report and read nested under it. `expected_json` and `actual_json` hold the canonical JSON the evaluator compared, so the evidence states the compared artefact itself. `match` is `1` or `0`. UNIQUE `(report_id, case_id)` makes the evidence set exact and provides the report-prefixed index every per-case read needs. |
| `governance_events` | `packages/sgi-core` | `id`, `subject_type`, `subject_id`, `event_type`, `actor_account_id`, `reason`, `payload_json`, `created_at` | **Append-only** | The log of what was *decided*: a standard published, a proposal reviewed, a listing moderated, an appeal opened or ruled, a retest created. `subject_type` and `subject_id` are polymorphic and `subject_id` therefore carries no REFERENCES clause; the pairing is held by the writing code in `packages/sgi-core/src/events/`. `subject_type`, `event_type`, and `reason`/`payload_json` are documented there and in `packages/shared/src/types/governance-event.ts` rather than closed by a CHECK. |
| `appeals` | `packages/sgi-core` | `id`, `report_id`, `developer_account_id`, `reason`, `status` (`open` \| `upheld` \| `denied`), `created_at` | Mutable | `status` is the only mutable column, which is why this table is not one of the nine: a ruling moves it to one of its two terminal outcomes and appends a governance event, where the ruling history lives. There is no `ruled_at`, no `ruled_by` and no ruling-reason column for the same reason. The appealed report is untouched by any part of the ruling. |
| `transactions` | `packages/commerce-sim` | `id`, `buyer_account_id`, `listing_id`, `listing_version_id`, `offer_model`, `amount_minor_units`, `currency_label` (`DEMO`), `simulated` (always `1`), `disclosure_label`, `created_at` | **Append-only** | One completed simulated checkout. `currency_label` is guarded to `DEMO`, `simulated` is `1` in every row and can be nothing else, and `disclosure_label` is NOT NULL — so no column of this table can hold a real currency code, a payment instrument, a financial account reference or a processing intermediary's handle. The amount is computed from the offer model the listing makes, not chosen by the client. No balance, status or updated-at column exists: a refund appends to `refunds` instead. |
| `refunds` | `packages/commerce-sim` | `id`, `transaction_id`, `amount_minor_units`, `operator_account_id`, `created_at` | **Append-only** | One appended refund. A transaction's net position is the transaction's amount minus the sum of its refunds, which is what makes the contract's `409` (already fully refunded) and `422` (amount exceeds the net remaining) answerable from these rows without a stored balance and without changing anything. The amount is in the synthetic label carried by the transaction, so this table holds no currency column and no real currency code can appear in it. |
| `ledger_entries` | `packages/commerce-sim` | `id`, `ledger` (`marketplace` \| `gate_fees` \| `founder_allocation`), `entry_type` (`charge` \| `allocation` \| `reversal`), `direction` (`debit` \| `credit`), `amount_minor_units`, `transaction_id`, `report_id`, `currency_label` (`DEMO`), `disclosure_label`, `description`, `created_at` | **Append-only** | One table for all three ledgers, with `ledger` as the discriminator the three operator reads filter on. A gate-evaluation fee is recorded in `gate_fees` only and is never eligible for an allocation; an allocation applies only to the net amount of an eligible completed simulated marketplace transaction, and never to a fee or a sponsored-slot record. `direction` is which side of its ledger a row falls on, never a sign: amounts stay non-negative. A reversal is a new row proportional to what it corrects. The fee and the allocation rate are configuration in `packages/commerce-sim/src/config.ts` — 150.00 `DEMO` and 25 basis points by default — not columns here, and a founder-allocation row states the rate it was computed from in `description`, because a later configuration change must not retroactively alter what an existing row was computed from. |
| `sponsored_slots` | `apps/api` | `id`, `sponsor_label`, `placement_key`, `fee_minor_units`, `created_at` | Seed/read-only | A limited demonstration of advertising, held as seed data and read only by the public `GET /sponsored-slots`. It declares no foreign key at all, and no column of it references or is referenced by any SGI table, so a sponsorship cannot be read as evidence about an agent or as an input to a measurement, and no SGI query can join it. `sponsor_label` and `placement_key` are fictional demo content; the words a reader sees, including the literal `Sponsored`, are copy owned by `packages/shared/src/constants.ts`. |
| `audit_events` | `apps/api` | `id`, `actor_account_id`, `action`, `resource_type`, `resource_id`, `status_code`, `reason`, `created_at` | **Append-only** | The feed of what was *written*, one row per write request, appended by `apps/api/src/audit/append-audit-event.ts` as the last step of that request. `status_code` is the HTTP status the write returned, so a refused write is as auditable as an accepted one, and the CHECK holds it inside 100–599. `action` carries the `<resource>.<verb>` member the writing route states — `listing.created`, `moderation.hidden`, `checkout.simulated` — closed on the write side to its seventeen values by `AUDIT_ACTIONS` and the `AuditAction` union derived from it in `apps/api/src/audit/append-audit-event.ts` — a route writes a member of that tuple or fails to compile — and `resource_type` is one of the twelve resources `AUDIT_RESOURCE_TYPES` declares in `packages/shared/src/types/audit-event.ts`. Both columns are deliberately unconstrained TEXT with no CHECK here, because a row can never be corrected, and the stored row type keeps `action` a plain `string` for that reason. `0009`'s own comment on this column calls it the route's own method and path, which the write side above supersedes — an applied file is never edited, so this row is where the current statement of the two vocabularies lives. `reason` is nullable: the absence is recorded as NULL rather than as an empty string. No column here holds a request body, request metadata, a reader identifier or personal data. |
| `schema_migrations` | `apps/api` (written by the runner) | `version`, `name`, `checksum`, `applied_at` | Append-only as far as the runner is concerned | Where applied migration files are recorded. It is created by `apps/api/src/db/migrate.ts` **before** `0001` is applied, so no migration file creates it, and the runner only ever INSERTs into it. Section 9 states the mechanism. |

## 4. The nine append-only tables

Exactly nine tables forbid an UPDATE and a DELETE, because the product's claim to trust rests on
their history being unrewritable:

`standard_versions`, `evaluation_reports`, `report_case_results`, `governance_events`,
`ledger_entries`, `transactions`, `refunds`, `audit_events`, `listing_versions`.

Two things hold that rule, and the first is the one the project relies on.

- **No route updates or deletes an append-only resource.** The API registers no `PUT`, no `PATCH` and
  no `DELETE`, and no write path uses a replace-style conflict resolution: SQLite resolves
  `INSERT OR REPLACE` by deleting the row it collides with, and that delete fires no delete trigger, so
  the append-only paths add rows only. A change to a measurement is a new row — a retest inserts a
  report pointing at its predecessor, and a refund appends a reversal rather than editing the entry it
  corrects.
- **As defence in depth**, `packages/shared/migrations/0010_append_only_triggers.sql` creates a
  `BEFORE UPDATE` and a `BEFORE DELETE` trigger running `RAISE(ABORT)` on each of the nine, and
  `0012_amount_integer_guards.sql` recreates the six of those triggers that stood on the tables it
  rebuilds. Section 10 says what those triggers are and are not.

`challenge_responses` and `thread_posts` are append-only by route design and are **not** among the
nine: no trigger guards either, and the writing route's insert-only behaviour is the whole guarantee.
The same nine names appear in `docs/DATA-FLOW.md`, and the write path that keeps to them is stated
there.

## 5. Relationships

Foreign keys are enforced, because every connection sets `foreign_keys = ON` outside any transaction
(section 2). The edges are:

| From | To | Note |
|---|---|---|
| `listings.developer_account_id` | `accounts.id` | The developing account. |
| `listing_versions.listing_id` | `listings.id` | A version belongs to one listing. |
| `listing_claims.listing_version_id` | `listing_versions.id` | A claim is made about one version. |
| `inquiries.listing_id` | `listings.id` | The listing inquired about. |
| `inquiries.buyer_account_id` | `accounts.id` | The inquiring account. |
| `challenges.listing_id` | `listings.id` | The listing challenged. |
| `challenges.buyer_account_id` | `accounts.id` | The asking account. |
| `challenge_responses.challenge_id` | `challenges.id` | A response answers one challenge. |
| `challenge_responses.account_id` | `accounts.id` | The responding account. |
| `threads.author_account_id` | `accounts.id` | The account that started the thread. |
| `thread_posts.thread_id` | `threads.id` | A post belongs to one thread. |
| `thread_posts.author_account_id` | `accounts.id` | The posting account. |
| `standard_versions.standard_id` | `standards.id` | A version belongs to one standard; UNIQUE `(standard_id, version_label)` addresses it. |
| `standard_proposals.standard_id` | `standards.id` | The standard proposed to be changed. |
| `standard_proposals.proposer_account_id` | `accounts.id` | The proposing account. |
| `evaluation_reports.candidate_version_id` | `listing_versions.id` | The version measured. |
| `evaluation_reports.standard_version_id` | `standard_versions.id` | The versioned criteria applied. |
| `evaluation_reports.prior_report_id` | `evaluation_reports.id` | Self-referencing and nullable: this is how a retest links to its predecessor. |
| `report_case_results.report_id` | `evaluation_reports.id` | The evidence belongs to one report. |
| `governance_events.subject_id` | — (polymorphic) | Paired with `subject_type` rather than referenced: SQLite cannot point one column at several tables, so the pairing is held by `packages/sgi-core/src/events/`. |
| `governance_events.actor_account_id` | `accounts.id` | The account that acted. |
| `appeals.report_id` | `evaluation_reports.id` | The report appealed. |
| `appeals.developer_account_id` | `accounts.id` | The appealing account. |
| `transactions.buyer_account_id` | `accounts.id` | The buying account. |
| `transactions.listing_id` | `listings.id` | The listing bought. |
| `transactions.listing_version_id` | `listing_versions.id` | The version bought. |
| `refunds.transaction_id` | `transactions.id` | The transaction refunded. |
| `refunds.operator_account_id` | `accounts.id` | The operator that ruled the refund. |
| `ledger_entries.transaction_id` | `transactions.id` | Set for a marketplace charge, the allocation computed from it, and a reversal of either. |
| `ledger_entries.report_id` | `evaluation_reports.id` | Set for a gate-evaluation fee, which carries the report it was charged for. |
| `audit_events.actor_account_id` | `accounts.id` | The account whose role authorised the write. |

`ledger_entries` references a transaction **or** a report and never both; that exclusivity is a
constraint rather than a pair of nullable edges, and section 6 states it. `sponsored_slots` declares
no foreign key at all, which is the isolation section 3 describes. Every reference is declared
`NOT NULL` except `evaluation_reports.prior_report_id`, which is null exactly for a version's first
report.

## 6. Constraints

The migration files fix the following, and each one is refused at the insert rather than checked
later. Enum `CHECK`s:

| Column | Admitted values |
|---|---|
| `accounts.role` | `developer`, `buyer`, `contributor`, `operator` |
| `listings.pricing_model`, `listing_claims.pricing_model`, `transactions.offer_model` | `rent`, `purchase`, `license`, `subscription` |
| `listings.status` | `active`, `flagged`, `hidden` |
| `challenges.status` | `open`, `responded` |
| `standard_versions.status` | `provisional`, `active` |
| `standard_proposals.status` | `submitted`, `accepted`, `rejected` |
| `evaluation_reports.outcome` | `PASS`, `FAIL` |
| `evaluation_reports.label` | `SAMPLE`, `VERIFIED-IN-DEMO` |
| `report_case_results.severity` | `critical`, `standard` |
| `report_case_results.match`, `listing_versions.is_fixture_candidate` | `0`, `1` |
| `ledger_entries.ledger` | `marketplace`, `gate_fees`, `founder_allocation` |
| `ledger_entries.entry_type` | `charge`, `allocation`, `reversal` |
| `ledger_entries.direction` | `debit`, `credit` |
| `transactions.simulated` | `1` only |

Beyond the enums:

- **No real currency can enter the data.** `CHECK (currency_label = 'DEMO')` stands on
  `transactions` and on `ledger_entries` — every monetary table that carries a label column — and the
  literal is the value of `SYNTHETIC_CURRENCY_LABEL` in `packages/shared/src/constants.ts`, which a
  `.sql` file cannot import and which `packages/commerce-sim/src/config.ts` therefore hands to every
  insert. `refunds` and `sponsored_slots` hold no currency column of their own: an amount there is in
  the one label the schema knows, and no real currency code can appear in either.
- **Amounts are non-negative integers, and the integer half is guarded.** Four amount columns
  (`transactions.amount_minor_units`, `refunds.amount_minor_units`, `ledger_entries.amount_minor_units`,
  `sponsored_slots.fee_minor_units`) carry `CHECK (column >= 0)`, and each also carries
  `CHECK (typeof(column) = 'integer')`. The second guard is not redundant: SQLite's type affinity does
  not keep a REAL, TEXT or BLOB value out of an INTEGER column, so `>= 0` alone admits `10.5` and
  `abc`. The four count columns of `standard_versions` carry the same pair of forms — `>= 0` plus a
  `typeof(...) = 'integer'` guard — so a ledger that sums an amount, and a pass rule that compares a
  count, both read integers. The writer side holds the same line a layer up: the configuration refuses
  a non-integer fee or rate, the request schemas accept `type: 'integer'` only, and the product's
  single rounding point, `packages/commerce-sim/src/ledgers/allocate.ts`, resolves its one fraction to
  a whole unit before a row is built.
- **A transaction's net position is derived, never stored.** `refunds.amount_minor_units` admits `0`
  and no stricter bound: whether a given refund amount is acceptable is the route's decision, computed
  from the refund rows against the transaction's amount, rather than a constraint's.
- **A standard version cannot contradict itself.** `standard_versions` carries
  `critical_cases <= total_cases`, `pass_threshold_matches <= total_cases` and
  `critical_failures_allowed <= critical_cases`; the seeded row holds 5 ≤ 20, 18 ≤ 20 and 0 ≤ 5. A row
  that can never be corrected must not be writable in a state the evaluator could not apply.
- **A report cannot contradict itself.** `evaluation_reports` carries `matched_count <= total_count`
  and `critical_failures <= total_count`.
- **A ledger entry names one reference.** `ledger_entries` carries
  `CHECK ((transaction_id IS NULL) <> (report_id IS NULL))`, which refuses the two states a reader
  could not interpret: a row naming both and a row naming neither.
- **A status is a status.** `audit_events.status_code` is held inside 100–599, so a value outside the
  range such a status can occupy is refused at the write rather than stored.
- **Uniqueness.** `accounts.handle`, `categories.slug` and `standards.code` are UNIQUE;
  `listing_versions` is UNIQUE on `(listing_id, version_string)`; `standard_versions` on
  `(standard_id, version_label)`; `report_case_results` on `(report_id, case_id)`.
- **Non-null keys and foreign keys.** Every `id` is declared `TEXT PRIMARY KEY NOT NULL` and so is
  every referencing column, because SQLite's legacy rule would otherwise let a non-INTEGER primary key
  hold NULL — admitting a row no id-based read could address — and a NULL foreign key would silently
  disable the edge. `evaluation_reports.prior_report_id` is the one nullable reference, on the terms
  section 5 gives. Two columns name a row without a `REFERENCES` clause, deliberately:
  `governance_events.subject_id`, which is polymorphic and paired with `subject_type`, and
  `audit_events.resource_id`, which names its resource through the `resource_type`/`resource_id` pair.
- **Timestamps carry no default.** Every `created_at`, `updated_at`, `published_at` and `applied_at`
  is NOT NULL with no `DEFAULT`, because SQLite's `CURRENT_TIMESTAMP` yields a form this contract does
  not accept: the application writes the ISO-8601 UTC string at insert time.

## 7. Validation at the edge, before the database

Every write route validates its body, its query string and its path parameters against a JSON schema
from `packages/shared/src/schemas/` **before a handler runs**, and these constraints back those
schemas rather than replacing them. What the schemas fix, and the status each failure produces:

| Schemas | What they fix before the handler |
|---|---|
| `auth-header-schema.ts` | The write header `X-Demo-Account`. `401` when it is absent or names an account the server cannot resolve, `403` when the resolved account's role is not the route's. |
| `listings-schema.ts` | Required fields by name and type; the search filters and the sort enum; the pagination object, with the page size fixed at `LISTING_PAGE_SIZE` (20) so a client cannot ask for a larger page; the compare list of two to four ids; the version body whose duplicate string is the `409` the UNIQUE pair produces. |
| `evaluations-schema.ts` | The submission's candidate version id, standard version id and recorded outputs; a fixture case set of exactly `FIXTURE_CASE_COUNT` (20) cases, whose ids are unique and of which at least one is `critical`. A submission that lacks a recorded output for a fixture case is the contract's `422` **before any report is written**. |
| `commerce-schema.ts` | The inquiry body; the checkout body (listing, version and offer model — and no amount, because the amount is computed from the model); the refund amount as a non-negative integer. An offer model the listing does not offer is the contract's `422`; an already fully refunded transaction is `409`, and an amount beyond the net remaining is `422` — both computed from the refund rows. |
| `challenges-threads-schema.ts` | The challenge question, the challenge response body, the thread title and the thread post body. |
| `moderation-schema.ts` | The moderation action, closed to `flag`, `hide` and `restore`, with its reason; and the standard proposal body and review body, whose decision is the `409` for an already-decided proposal. |

Two limits of what the schemas can say are worth stating, because the schema vocabulary is closed and
the guard has to live somewhere:

- **Exactly twenty cases is a schema count; exactly five of them being critical is asserted as
  data.** `minItems`/`maxItems` fix the set at 20 and a `contains` requires at least one `critical`
  case, but "exactly five are critical" needs `minContains`/`maxContains`, keywords of the 2019-09
  vocabulary that draft-07 — the dialect the product's validator implements — does not carry. The
  exact critical count is therefore asserted as data by the two readers of the delivered pack,
  `packages/sgi-fixtures/src/load-fixtures.test.ts` against
  `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json`, and the fixture-count group in
  `packages/shared/src/schemas/schemas.test.ts`.
- **A missing case is a request error, not a scored failure.** The schema cannot know a case set's
  ids; the route compares the submitted case ids against the version's case set and answers `422`
  when one is absent, before a report row exists.


## 8. The ordered migration files

The schema arrives in thirteen files, applied in filename order, and they are additive: an applied
file is never edited, which is why the integrality guard on the amount columns is `0012` rather
than a change to `0008`.

| File | What it produces |
|---|---|
| `0001_accounts_and_categories.sql` | `accounts` and `categories`, with their enum `CHECK`s, their UNIQUE columns and `idx_accounts_role`. |
| `0002_listings_and_versions.sql` | `listings`, `listing_versions` (UNIQUE `(listing_id, version_string)`, `is_fixture_candidate` defaulting to `0`) and `listing_claims`. |
| `0003_inquiries.sql` | `inquiries`, with `idx_inquiries_listing_id` and `idx_inquiries_buyer_account_id`. |
| `0004_challenges_and_threads.sql` | `challenges`, `challenge_responses`, `threads` and `thread_posts`. |
| `0005_standards_and_proposals.sql` | `standards`, `standard_versions` (the pass rule as columns, with `typeof(...) = 'integer'` guards on all four counts, the three cross-column guards and UNIQUE `(standard_id, version_label)`) and `standard_proposals`. |
| `0006_reports_and_case_results.sql` | `evaluation_reports` (including the nullable, self-referencing `prior_report_id` and the two cross-column guards) and `report_case_results`, with UNIQUE `(report_id, case_id)`. |
| `0007_governance_events_and_appeals.sql` | `governance_events` and `appeals`. |
| `0008_commerce_ledgers_and_refunds.sql` | `transactions`, `refunds` and `ledger_entries`, carrying `CHECK (currency_label = 'DEMO')` on the two labelled monetary tables and the transaction-or-report exclusivity on `ledger_entries`. |
| `0009_sponsored_slots_and_audit_events.sql` | `sponsored_slots` and `audit_events`. A reader who starts at that applied file is routed to section 3's `audit_events` row for the current statement of the `action` and `resource_type` vocabularies: the file's own comment on `action` is superseded, its `resource_type` clause stands, and the file's bytes stay as they were applied. |
| `0010_append_only_triggers.sql` | Eighteen triggers — a `BEFORE UPDATE` and a `BEFORE DELETE` running `RAISE(ABORT)` on each of the nine append-only tables of section 4. |
| `0011_indexes.sql` | The read-path indexes listed below, and nothing else: no table, no trigger, no row. |
| `0012_amount_integer_guards.sql` | The `typeof(...) = 'integer'` guard on the four amount columns, which SQLite cannot add to an existing table, so the file rebuilds `transactions`, `refunds`, `ledger_entries` and `sponsored_slots` with the guard in place, carrying every rowid across in its original order, recreating the two indexes those tables carry afterwards — `idx_refunds_transaction_id` verbatim, and `idx_ledger_entries_ledger` on the rebuilt `ledger_entries`, the index the ledger reads run on today — and recreating the six triggers of `0010` that guarded them. A stored value the guards cannot admit makes the copy fail and the whole file roll back: an amount already written is never rewritten, so such a database refuses to apply this file rather than having a journalled amount silently rounded or dropped. |
| `0013_newest_row_and_filter_indexes.sql` | The five read-path indexes `0011` does not declare, and nothing else: `listing_claims (listing_version_id)`, `listing_versions (listing_id, created_at)`, `evaluation_reports (candidate_version_id, created_at)`, `listings (slug)` and `challenge_responses (challenge_id)`. |

The read-path indexes `0011` declares, and the ledger index `0012` creates on the table it rebuilds,
with the read each one serves:

| Index | The read it serves |
|---|---|
| `idx_listings_status` | No read in this release: the only status predicate the code writes is an inequality, `l.status <> 'hidden'` in `apps/api/src/routes/listings.ts`, which no B-tree index serves, and the search's row source scans `listings`. Kept as declared headroom. |
| `idx_listings_category_id`, `idx_listings_pricing_model`, `idx_listings_license_code` | The three closed filters the search row names beside the free-text `q`. Each is selective on its own, so each gets its own single-column index rather than a composite a filter subset could not use. |
| `idx_evaluation_reports_standard_version_id` | No read in this release either: the standard filter is a predicate on the derived column `report_standard_version_row_id`, and the search plan drives from `listings` and reaches a report by candidate version, so this index answers neither that filter nor any other read. Kept as declared headroom. |
| `idx_evaluation_reports_candidate_version_id` (`candidate_version_id`, `standard_version_id`, `created_at`) | One read in that column order: the retest lookup that derives `prior_report_id` from the newest existing report for the submitted candidate version and standard version, both keys equated. The listing summary's latest-report join for a candidate version reads the newest row by `created_at`, which is this index's third key, so it is served by `idx_evaluation_reports_candidate_version_created_at` (`0013`) instead — see the table below, which names every read that one answers. |
| `idx_ledger_entries_ledger` | The three operator-only ledger reads, each filtering on the discriminator and reading its rows in the order they were appended — `rowid` order, which is why the index is on the discriminator alone. The index on the table today is the one `0012` recreates there when it rebuilds `ledger_entries`; the `(ledger, created_at)` spelling `0011` itself declares was dropped with the table that carried it. |
| `idx_refunds_transaction_id` | The net-remaining computation behind the refund contract's `409` and `422`: a transaction's amount minus the sum of its refunds, read from the refund rows because no balance is stored beside them. |
| `idx_audit_events_created_at` | The operator audit feed, read in insertion order. |
| `idx_governance_events_subject` (`subject_type`, `subject_id`) | Governance events read with the subject they concern, so a proposal's review trail and an appeal's ruling trail are visible from the log alone. |

`0013_newest_row_and_filter_indexes.sql` declares five more, by the read each one serves:

| Index | The read it serves |
|---|---|
| `idx_listing_claims_listing_version_id` | The limitation subquery of the listing row source, which the search and the detail read both project, and the claims of one listing read for the detail page and for compare. Without it each of those reads scanned the whole `listing_claims` table. |
| `idx_listing_versions_listing_id_created_at` (`listing_id`, `created_at`) | Every "newest version" read: the listing row source's newest-version join, the compare read's newest-version probe and the detail read's version history, which orders one listing's versions by `created_at DESC, rowid DESC`. |
| `idx_evaluation_reports_candidate_version_created_at` (`candidate_version_id`, `created_at`) | Every "newest report" read: the listing row source's newest-report join, the detail read's latest-report lookup and the compare read's latest-report statement. `idx_evaluation_reports_candidate_version_id` cannot serve them — `created_at` is its third key while only the first is equated — and it stays for the retest lookup, which equates the first two keys. |
| `idx_listings_slug` | The slug walk of `POST /listings`: `freeSlug` asks whether a token is taken once per suffix it tries, inside the create-listing transaction. A slug is deliberately not UNIQUE, so no other index covers the column. |
| `idx_challenge_responses_challenge_id` | The challenge board's batched response read, which selects the responses of the ids the board returned on every `GET /challenges`. |

Three indexes stand outside `0011` and are deliberately not repeated there: `idx_accounts_role`
(`0001`) and the two inquiry indexes (`0003`), plus the three UNIQUE constraints of `0002`, `0005`
and `0006` that already provide the indexes for `listing_versions` `(listing_id, version_string)`,
`standard_versions` `(standard_id, version_label)` and `report_case_results` `(report_id, case_id)`.
Those three serve no read in this release either, and are kept as declared headroom: `accounts` is
read by `id` and by `handle`, with a role compared in application code rather than in SQL, and
`inquiries` is written by `POST /inquiries` and read by nothing, so neither index answers a query.
Read paths left unindexed on purpose, so no later change adds an index that cannot be used: the
free-text `q` match on `listings.title` and `listings.summary` is a `LIKE '%…%'` comparison no B-tree
index can serve; `GET /compare` resolves each of its two to four ids by primary key; the challenge and
thread board reads document no filter and order by their instant with an identifier tie-break, an
order a scan serves and for which no index is added; `GET /evaluations/{id}` reads its report by
primary key, with its per-case evidence served by the `(report_id, case_id)` UNIQUE index; and the
governance event log read whole, or narrowed by `event_type` alone, scans `governance_events`.

### Bounded collection reads

Eight reads answer with a collection that grows as the product is used — the operator audit feed
`GET /audit-events`, the three ledger reads `GET /ledger/marketplace`, `GET /ledger/gate-fees` and
`GET /ledger/founder-allocation`, the two boards `GET /challenges` and `GET /threads`, the proposals
`GET /standards` carries for each standard, and a listing's version history `GET /listings/{id}` —
and each answers **one page** of it: `COLLECTION_PAGE_SIZE` rows (20, from
`packages/shared/src/constants.ts`), applied in SQL as `LIMIT ? OFFSET ?` on seven of the eight and,
on the catalogue, as a per-standard recency rank, because one standard's proposal history must not
fill a page the other standards share. Page 1 is the most recent page of the collection and each
later page reaches one page further back, while the rows inside a page are in the order that read
documents: insertion order for the audit feed and the three ledgers, insertion order within each
standard for the catalogue's proposals, oldest first for the two boards, and newest first for a
listing's version history. `?page=` is the only paging input, the one
`collectionPageQuerySchema` and `CollectionPageQuery` in
`packages/shared/src/schemas/pagination-schema.ts` declare, so the page size cannot be raised from a
request: `?limit=`, `?pageSize=`, `?size=` and an `X-Page-Size:` header are not part of the schema,
and the validator removes an unexpected query key before the handler runs, exactly as on the listing
search, while `?page=0`, `?page=-1` and `?page=abc` are refused
`400 validation_error` through the one error envelope. `page` is bounded at both ends by
`PAGE_NUMBER_MAX` (450359962737049, from the same `constants.ts`), the largest page whose offset —
and, on the catalogue, whose rank window — the paging arithmetic still states as an exact whole
number, so a page above it is refused that `400` at the edge rather than rounded into a `500`. The
listing search declares the lower bound alone and refuses a page whose offset the store cannot
address in its own route, which is the same `400` with a sentence naming the parameter the client
sent. Each response states the page it answered
and how much of the collection exists: `page` and `total` on the audit feed, the two boards and each
ledger; `page` on the catalogue, with `proposal_total` on each item beside that standard's own page
of proposals; and `version_total` on a listing's detail — which is what lets a reader tell a short
collection from a clipped page and ask for the next one. The nested rows of a page are read for the
parents that page carries rather than for the whole collection: a thread's replies are read for the
page's threads and a challenge's responses for the page's challenges, so the rows of one parent are
that parent's own content. The pages that render the four operator reads and the two boards state
the page they show and offer controls that reach the pages before and after it, while the pages
that render the catalogue's proposals and a listing's version history show the newest page, and
the older pages of those two are reached through each read's own `page`.
The paged board reads order by their instant with
an identifier tie-break and page through that order, which no index serves and none is added for —
an applied migration is immutable, so such an index is a new numbered migration rather than a change
to `0011`.

## 9. How migration state is tracked

`apps/api/src/db/migrate.ts` is the only path by which the schema is applied, and its state lives in
`schema_migrations`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  checksum   TEXT    NOT NULL,
  applied_at TEXT    NOT NULL
)
```

1. The runner creates `schema_migrations` when it does not exist, before it reads the directory and
   before `0001` is applied, so the table an applied file is recorded in exists before any file can be
   applied.
2. It reads every `packages/shared/migrations/NNNN_description.sql` in ascending version order,
   ignoring anything else in the directory, and takes the SHA-256 checksum of each file's bytes.
3. It verifies before it applies: every recorded row is compared against its file, and the run is
   refused when a file at a recorded version has been renamed, has gone missing, or hashes to a
   different checksum than the row records.
4. Each pending file is applied inside its own transaction, with a plain INSERT of one
   `schema_migrations` row carrying the version, the file name, the checksum and the applied
   timestamp. The row and the file's own DDL commit together or roll back together.
5. When every pending file has been applied, the runner sets `PRAGMA user_version` to the highest
   applied version, outside any transaction.

**`schema_migrations` is authoritative** for both the applied state and the checksum comparison.
`PRAGMA user_version` is a single integer and holds no name and no checksum; it exists only as a
cheap marker for tooling and for a human who opens the file, and nothing decides whether to apply a
file by reading it.

The consequence for a contributor is a rule about the files themselves: **migrations only add**.
Nothing is dropped or rewritten except by the one rebuild a guard needs, an applied file is never
edited or renumbered, and a change to the schema is a new numbered file. The checksum check is what
makes that rule a fact rather than a convention — editing an applied file does not change the
database, it refuses the server's start-up. A contributor who meets that refusal on a database
created from an earlier revision of the checkout has two remedies and needs no third: recreate the
database file, since the only rows it holds are the seeded demo data, or point `ADEM_DB_PATH` at a
fresh path and let the runner apply the current files into it.

## 10. Triggers: what they are and are not

The eighteen triggers of `0010`, and the six `0012` recreates, are **defence in depth and never a
security boundary**. SQLite offers no statement that disables a trigger, but a connection holding
write access can drop one, and `PRAGMA writable_schema=ON` can rewrite the schema itself. What
the project relies on is the first paragraph of section 4: no route updates or deletes an append-only
resource. `apps/api/test/integration/immutability.test.ts` proves that by attempting an UPDATE and a
DELETE against each of the nine through every route that exists and re-reading the stored row, and by
confirming that an appeal ruling appends a governance event while the report it concerns comes back
byte-identical. The threat model and the trust boundaries are `docs/THREAT-MODEL.md`.

## 11. Working with the database locally

The default database file is `.adem/adem.sqlite` under the repository root, resolved from
`apps/api/src/config.ts` rather than from the process's working directory, and `ADEM_DB_PATH` names a
different file for a throwaway run; a relative value is resolved against that same repository root, so
a value written relative to your checkout root means one file whether `npm run seed` or `npm start`
reads it. The `.adem/` directory is gitignored; the connection creates it on first use, so a fresh
checkout needs no step. Any SQLite client opens the file — nothing about it is
private to better-sqlite3 — and the schema a reader finds there is the one this document describes.
`npm run seed` loads the synthetic demo data through the exported `seedDatabase` of
`apps/api/src/seed/seed-database.ts` — **once, against a fresh database**: a file that already holds
rows is refused rather than emptied, so a second run exits non-zero and changes nothing, and the
remedy is another `ADEM_DB_PATH` or removing `.adem/adem.sqlite`. The integration suite uses an
in-memory database instead of a file, so running the suite never touches a contributor's database.
A write is
visible in the `-wal` file until the writer checkpoints, so the file a reader opens without the
`-wal` beside it can be behind the last few commits.

## 12. Where the numbers come from

The four counts in `standard_versions` — 20 cases, 5 of them critical, a threshold of 18 matches and
0 critical failures allowed — are the same numbers `docs/STANDARD-SGI-SO-1.0.0.md` publishes, that
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` records as its case set, and that
`packages/sgi-core/src/standards/sgi-so-1.0.0.ts` holds as the runtime definition the evaluator
reads. A change to any of them means a new standard version, not an edit.
