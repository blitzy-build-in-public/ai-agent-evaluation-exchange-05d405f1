# Add the seeding path to the data-flow document

Labels: P1, good-first-issue, milestone M4

## Scope

`docs/DATA-FLOW.md` follows the data rather than the code. Its numbered sections walk the conventions
every path keeps, then the read path, the write path, the evaluation path, the governance path, the
commerce path and the report-read path, then where determinism lives, then the statuses and limits, and
its flow-diagram section draws two of those paths as plain ASCII. It already fixes the write path's
ordered failure sequence — write rate limit, schema validation, the demo-header resolution, the role
check, one transactional domain call, the audit append, then the response — distinguishes the two
append-only logs, states that a report's retest link and label are server-derived and never
client-supplied, and describes the refund and ledger arithmetic. Do not restate any of it, and do not
duplicate the paths the document already carries in detail, including the retest link and the appeal
ruling.

**The gap is real: every path above begins at an HTTP request against a database that already holds
rows, and nothing in the document says where those rows come from.** Your task is to add one section —
the seeding path — covering the command that makes the database the other paths read, from the script
entry to the rows the integration suites and the browser suites then run against.

Write it the way the neighbouring sections are written: a numbered heading at the level they use, the
steps as an ordered list of root-relative repository paths with the symbol or command each one runs, and
one diagram in the same plain-ASCII form as the two the flow-diagram section carries, appended after
them rather than between them. The ground the section has to cover:

1. **The command and its entry.** `npm run seed` in the root `package.json` reaches
   `apps/api/src/seed/run-seed.ts`, which is executed and never imported by anything.
2. **The two optional inputs.** `resolveConfig` in `apps/api/src/config.ts` resolves `ADEM_DB_PATH`, the
   default database file under the repository root, and `ADEM_PORT`, the default port; a present but
   unusable value is refused rather than silently defaulted, and no secret is read.
3. **The handle and the schema.** `openDatabase` in `apps/api/src/db/connection.ts` opens the resolved
   path, and `runMigrations` in `apps/api/src/db/migrate.ts` applies `packages/shared/migrations/*.sql`
   in filename order, each file inside its own transaction, recording that file's version, name and
   SHA-256 checksum in `schema_migrations` and refusing to start when an applied file's bytes changed.
   On a fresh path this creates the whole schema; on a migrated one it applies nothing.
4. **The seed itself.** `seedDatabase` in `apps/api/src/seed/seed-database.ts` runs on that same handle
   inside one outer transaction: it refuses a database that already holds rows rather than emptying it,
   writes the fictional rows of `apps/api/src/seed/seed-data.ts` in foreign-key order — accounts,
   categories, listings, versions and their claims, then the discussion rows — and registers the one
   standard version through `registerStandardVersion` from `packages/sgi-core/src/index.ts`, so the
   versioned criteria the reports are scored against come from the domain's own writer.
5. **The three reports.** The seed runs the real evaluator over the three candidates in
   `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/`, in the fixed order alpha, beta, gamma:
   score, derive the label, link the retest, append the report and its per-case evidence in case-set
   order, then charge the gate fee in that ledger alone. Nothing submitted is executed, and no clock,
   locale, timezone or random source decides any of it: the report's identifier and instant are
   generated at write time, outside the payload two runs compare.
6. **Which writes are append-only, and what a refusal leaves behind.** The seed inserts into
   `listing_versions`, `standard_versions`, `evaluation_reports`, `report_case_results` and
   `ledger_entries` — five of the nine append-only tables — and never updates a row, deletes one or uses
   a replace-style conflict resolution. A refusal anywhere unwinds the outer transaction, so the
   database is left exactly as it was and there is no partial state to clean up.
7. **Who reads the rows, and what the command reports.** The integration suites call `seedDatabase`
   against their own in-memory connection, so no case needs hand-made data, and `playwright.config.ts`
   gives the browser suites a fresh, run-unique file through its `webServer.env`. Say what the command
   prints and what it exits with on success and on a refusal.

Nothing you write may describe the product as certified or independently verified, or claim that buying
an evaluation guarantees a pass. No line may name a real person, brand, product, private project,
contact detail, credential or token — no address-shaped string, and no run of five or more consecutive
digits. Spell the closed vocabulary exactly where you use it: `SAMPLE`; `VERIFIED-IN-DEMO`; the scope
"structured output on fixture set only"; "Sponsored"; "demo only, no production authentication"; `DEMO`;
"No SGI report yet"; "to be determined"; `SGI-SO-1.0.0`. Leave the existing sections as they are: you add
one section, and a disagreement between the document and the code is a question for the pull request
rather than an edit beside this one.

Read next: `docs/DATA-FLOW.md`, whole, for the house form of a section; `docs/SCHEMA.md` for the tables
and which of them are append-only; `docs/ARCHITECTURE.md` for the boundaries your path crosses;
`docs/ROADMAP.md` and `CONTRIBUTING.md` for where this change sits and how it is proposed.

## Acceptance

1. `docs/DATA-FLOW.md` gains exactly one section and no other change: the six paths it already carries,
   its determinism section, its status and limit tables and its two diagrams keep their content and
   their order, and `git diff --stat` names that one document and no other file.
2. Every step traces to a declared path, symbol or command, and each exists at the path you wrote.
   Check by grepping your added lines for `apps/`, `packages/` and `scripts/` and confirming each path.
3. `ADEM_DB_PATH=<a fresh path of your own> npm run seed` exits 0 and prints one count per seeded table
   and one line per report, and a second run over that same file exits non-zero and changes nothing.
   Paste both results into the pull-request description.
4. The section agrees with the code, by a run rather than by a reading:
   `npm run test:integration -- --testNamePattern="the rows the seed publishes"` and
   `--testNamePattern="the standard and the candidates the seed describes"` both exit 0. Paste both.
5. The added lines carry no address-shaped string and no run of five or more consecutive digits, and
   `npm run scan:exclusions` exits 0 with an empty finding list once that script exists.
6. The pull-request description states which path you added and why the document did not already cover
   it.
