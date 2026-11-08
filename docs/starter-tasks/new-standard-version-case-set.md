# Add a case set as a new standard version

Labels: P0, good-first-issue, milestone M3

## Scope

`SGI-SO-1.0.0` — "Structured Output Conformance", 20 fixture cases of which 5 are `critical`, the
pass rule "at least 18 of 20 cases match AND no `critical` case fails", rubric reference
`SGI-SO-1.0.0#rubric` — is **versioned data that is never edited**. Its numbers, its case set and its
row stay exactly as they are: the `standard_versions` row is append-only, guarded by the
`RAISE(ABORT)` triggers in `packages/shared/migrations/0010_append_only_triggers.sql` (guard rails,
not a security boundary). Criteria change only by **publishing a new standard version** through
`docs/governance/SGI-PROPOSALS.md`; the numbers that process works with, and the vocabulary every
surface keeps, are `docs/STANDARD-SGI-SO-1.0.0.md`. You add three things, and nothing else.

1. **Your case set.** One directory named with your version label under
   `packages/sgi-fixtures/fixtures/`, holding `cases.json` in the shape
   `packages/sgi-fixtures/src/index.ts` reads: `standard_version_id` (your label), `total_cases`,
   `critical_cases`, and a `cases` array whose every case carries `id`, `severity` (`critical` or
   `standard`), `input` (`instruction`, `source`) and `expected_output`. It belongs there because
   `loadCaseSet` resolves a case set only from such a directory, and `getStandardCaseSet` is the one
   path from a standard version to the cases it is scored against — so a version whose case set is
   not there cannot be scored. Keep case ids in a namespace of your own:
   `so-001`…`so-020` are the shipped set's. Candidate submissions, if you ship them, go in that
   directory's `candidates/`, each declarative — `candidate_id`, `candidate_version_id`,
   `standard_version_id` (your label) and `recorded_outputs` of `case_id` plus `output`; nothing is
   executed — under candidate ids no other case-set directory uses, because `loadCandidate` refuses
   an id it finds in more than one.
2. **Your expected outcomes** — each candidate's `outcome`, `matched_count`, `total_count`,
   `critical_failures` and ascending `failing_case_ids` — recorded in your version's own
   `<name>.test.ts` beside its definition and asserted by recomputation. Not as a second
   `expected-outcomes.json` under `packages/sgi-fixtures/fixtures/`: `loadCandidate` and
   `loadExpectedOutcomes` take no version, search every case-set directory and refuse when more than
   one holds the document they read, so a second copy breaks the shipped suites.
3. **Your version's definition and row.** A new `<name>.ts` beside
   `packages/sgi-core/src/standards/sgi-so-1.0.0.ts` holding a `StandardVersionDefinition` that
   mirrors its fields — `code`, `versionLabel`, `title`, a non-claiming `summary`,
   `status: "provisional"`, `totalCases`, `criticalCases`, `passThresholdMatches`,
   `criticalFailuresAllowed`, a `rubricReference` of the form `<your label>#rubric`, `fixtureSetId`
   (your case-set directory's name) and a fixed ISO-8601 UTC `publishedAt` literal — and its row
   through `registerStandardVersion(db, definition)` in
   `packages/sgi-core/src/standards/standard-registry.ts`, which `INSERT`s only, writes nothing when
   the same definition is registered twice, and refuses a changed definition for an already-published
   label as drift. No route publishes a version, so wire the registration where the shipped one runs,
   in `apps/api/src/seed/seed-database.ts`.

**The consistency your version must satisfy.** `totalCases` and `criticalCases` must agree with your
`cases` array and with the two counts your `cases.json` states, and your case set's
`standard_version_id`, your definition's `fixtureSetId` and every submission's
`standard_version_id` must agree with each other: `scoreSubmission` in
`packages/sgi-core/src/scoring/score-submission.ts` raises `StandardDriftError` on any disagreement
rather than scoring the run. `packages/sgi-core/src/standards/sgi-so-1.0.0.test.ts` is the drift
guard to copy for your version's test.

**What you must never do.** Edit `SGI-SO-1.0.0`'s numbers or its case set in place; add, edit or
delete anything under `packages/shared/migrations/`, because an applied migration is immutable and
its recorded checksum stops the server from starting; `UPDATE` or `DELETE` a `standard_versions` row,
which no route offers; change a status code, a fixed interface in `packages/sgi-core/src/extensions/`
or the shape of a report; or present a version, a report or a badge as certified.

**Data, and the vocabulary.** Deterministic: no clock, locale, timezone, random source, environment
read or network in your fixture data or your definition — `publishedAt` is a fixed literal and every
count is an integer. Fictional and clean: no real brand, company, product, personal name, contact
detail, credential or token — no `@` in any string and no run of five or more consecutive digits,
because the exclusion scan and the manual review both read these files. Report labels stay closed to
`SAMPLE` and `VERIFIED-IN-DEMO`; a badge names the standard version, the scope
`structured output on fixture set only` and the report id, and a `FAIL` report carries none; nothing
states or implies general safety, certified security or independent certification, and buying an
evaluation never guarantees a pass — outcomes depend on test evidence only.

Read next: `docs/governance/SGI-PROPOSALS.md` and the intake form
`.github/ISSUE_TEMPLATE/standards-proposal.md`; `docs/STANDARD-SGI-SO-1.0.0.md`; `CONTRIBUTING.md`;
`docs/ROADMAP.md`.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- packages/sgi-core` and `npm run test:unit -- packages/sgi-fixtures` both
   exit 0, including your version's own test, which loads your case set, checks `total_cases` and
   `critical_cases` against your cases array, asserts your critical case ids, and recomputes each
   candidate's outcome, matched count, critical failures and failing case ids from the case set and
   asserts them equal to what you recorded.
3. `npm run seed` exits 0 and `npm run test:integration -- --testNamePattern=evaluations` exits 0,
   with the three shipped seeded outcomes unchanged: `seed-alpha` `PASS`, 20 matched, 0 critical
   failures, no failing cases; `seed-beta` `FAIL`, 19 matched, 1 critical failure on `so-003`;
   `seed-gamma` `FAIL`, 17 matched, 0 critical failures, failing on `so-014`, `so-016` and `so-018`.
4. `git diff --stat -- packages/sgi-core/src/standards/sgi-so-1.0.0.ts
   packages/sgi-fixtures/fixtures/SGI-SO-1.0.0 packages/shared/migrations` prints nothing: the
   published standard, its case set and every applied migration are untouched. Paste that empty
   output into the pull-request description.
5. Observable: with a database the seed has written, `GET /api/v1/standards` lists the standard with
   both versions, and `GET /api/v1/standards/{id}/versions/{your label}` returns your versioned
   thresholds verbatim, including your `rubricReference`.
6. `npm run scan:exclusions` exits 0 with an empty finding list, and no file you added holds an `@`
   or a run of five or more consecutive digits.
