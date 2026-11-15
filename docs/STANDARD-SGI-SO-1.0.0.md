# SGI-SO-1.0.0: Structured Output Conformance

The one standard ADEM's Standard Gate Index publishes in this release, and the document an
evaluation report's rubric reference resolves to: a report cites `SGI-SO-1.0.0#rubric`, whose
fragment is the `Rubric` heading below, at `docs/STANDARD-SGI-SO-1.0.0.md#rubric`. The standard's
runtime definition is `packages/sgi-core/src/standards/sgi-so-1.0.0.ts`, its case set is
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/`, and the tables it reads and writes are documented
in `docs/SCHEMA.md`, whose section 12 states the same four numbers this document states.

## Identity

| Field | Value |
|---|---|
| Standard code | `SGI-SO-1.0.0` |
| Title | Structured Output Conformance |
| Status | provisional |
| Scope a badge states | `structured output on fixture set only` |
| Fixture set reference | `SGI-SO-1.0.0`, resolving to `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` |
| Rubric reference a report cites | `SGI-SO-1.0.0#rubric`, resolving to `docs/STANDARD-SGI-SO-1.0.0.md#rubric` |
| Runtime definition | `packages/sgi-core/src/standards/sgi-so-1.0.0.ts` |
| Versioned criteria row | one `standard_versions` row, documented in `docs/SCHEMA.md` section 3 |

`SGI-SO-1.0.0` is the only standard this release publishes, and its thresholds are provisional and
versioned with the standard: they are read from the version record when a submission is scored,
never from a constant in the build, so a change to any of them is a new standard version
(`How this standard changes`).

## What this standard measures, and what it does not

It measures one thing: whether the **recorded** structured output a candidate declared for each
fixture case matches that case's expected output, judged case by case and compared as text. A
candidate is declarative data, and nothing submitted is executed.

It does none of the following, and a reader must not infer any of it from an outcome:

- It does not execute anything, and it does not observe a running agent.
- It does not test safety, security, robustness, latency, cost or general capability.
- It is not a certification, and no report or badge under it is certified by anyone.
- Its evidence is limited to the scope `structured output on fixture set only`: a result here does
  not transfer to another workload, another case set or another standard version.

**Buying an evaluation never guarantees a pass, and outcomes depend on test evidence only.**

## The fixture set

`SGI-SO-1.0.0` defines **20** fixture cases, held in
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` as an object carrying
`standard_version_id` (`SGI-SO-1.0.0`), `total_cases` (`20`), `critical_cases` (`5`) and a `cases`
array. Each case carries an `id`, an `input`, an `expected_output` and a `severity` of `critical` or
`standard`. The shipped set also carries the three candidate submissions in
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/` and the outcomes they must produce in
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/expected-outcomes.json`.

Case ids are the set's own `so-NNN` namespace, running from `so-001` to `so-020` in ascending order.
Exactly **5** of the 20 are `critical`:

| Severity | Case ids |
|---|---|
| `critical` (5) | `so-001`, `so-003`, `so-005`, `so-008`, `so-012` |
| `standard` (15) | `so-002`, `so-004`, `so-006`, `so-007`, `so-009`, `so-010`, `so-011`, `so-013`, `so-014`, `so-015`, `so-016`, `so-017`, `so-018`, `so-019`, `so-020` |

Every path this standard names is written out in full from the repository root —
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json`, not `cases.json` — so a reader resolves a
reference from the checkout without knowing a package's layout convention.

**The case set is read-only.** No case, no severity and no count is edited in place: a change to any
of them is a new standard version (`How this standard changes`). The evaluator enforces that rather
than trusting it: it compares the case set's own identity and counts against the version record it
was loaded for and refuses a run whose two sides disagree (`standard_drift`, which maps to `400`),
so a case set and a standard version cannot drift apart while a report is written against them.

The case set's shape is guarded at the edge by `packages/shared/src/schemas/evaluations-schema.ts`,
which fixes the count at 20 and requires at least one `critical` case. The exact count of five is
asserted as data rather than by the schema, because the schema dialect the product validates with
carries no keyword for it; `docs/SCHEMA.md` section 7 names the two tests that assert it.

## The candidate form

A candidate is a **declarative submission**: the candidate version identifier, the standard version
identifier, and one recorded output per fixture case. Nothing is executed — there is no `eval`, no
dynamic import of submitted content and no sandbox on this path — and no field of the submission
names a file, a command or an endpoint.

The request body is fixed by `packages/shared/src/schemas/evaluations-schema.ts`:

```json
{
  "candidate_version_id": "00000000-0000-4000-8000-0000000000a1",
  "standard_version_id": "SGI-SO-1.0.0",
  "recorded_outputs": [{ "case_id": "so-001", "output": { "status": "received" } }]
}
```

`output` is any JSON value and is pure data from the moment it arrives until it is compared. The
body carries **no retest field**, structurally: the schema sets `additionalProperties: false`, so a
field a client adds is refused with `400 validation_error` before the handler runs — never silently
dropped — and the retest link is derived server-side
(`Retest semantics`).

**A submission that lacks a recorded output for a fixture case is rejected with `422` before any
report is written**, leaving zero new rows in `evaluation_reports`, `report_case_results` and
`ledger_entries`. A `case_id` the case set does not define, or a repeated `case_id`, is a `400`: a
malformed submission is a malformed request rather than an incomplete one, and the structural check
runs before the completeness check for exactly that reason.

## Rubric

How a single case is judged: the output the candidate recorded for the case is rendered as canonical
JSON, the case's expected output is rendered as canonical JSON, and the two strings are compared.

Canonical JSON fixes object property order — keys sorted by UTF-16 code-unit comparison — and
removes every insignificant byte, emitting no space, tab or newline between tokens. So whitespace
**between** tokens is insignificant, whitespace **inside** a string value is significant, and array
order is significant because the order of an array's elements is data. Three cases in the delivered
set make that boundary checkable: `so-017` states the same keys as its expected output in a
different order and matches; `so-018` records a note carrying a trailing space its expected output
does not carry and does not match; `so-014` records the same codes in a different order and does not
match.

The comparison is a match/non-match boolean per case: it is a match exactly when the two canonical
strings are equal. There is no partial credit, no similarity score, no tolerance, no weighting and
no numeric score attached to a case.

Severity decides what a failure costs:

| Severity | What a failure of the case does |
|---|---|
| `critical` | The case's failure alone makes the candidate `FAIL`, whatever the other nineteen cases did. |
| `standard` | The case counts toward the match threshold and nothing more. |

The three values a report's totals are derived from, all computed from the per-case verdicts:

| Value | How it is derived |
|---|---|
| Matched count | The number of the 20 cases whose canonical actual output equalled the canonical expected output. |
| Critical failures | The number of `critical` cases that did not match. |
| Failing case ids | The ids of the cases that did not match, in fixture order — the order the case set states its cases, which is ascending by id. |

The modules that implement this are `packages/sgi-core/src/scoring/canonical-json.ts` (the single
producer of the canonical form), `packages/sgi-core/src/scoring/compare-recorded-output.ts` (the
per-case boolean and its evidence) and `packages/sgi-core/src/scoring/score-submission.ts` (the
verdicts, the totals and the outcome). Nothing in the scoring path reads a clock, a locale, a
timezone or a random source: two runs over one submission return deeply equal per-case results and
the same outcome.

## The pass rule

**PASS means at least 18 of 20 cases match AND no `critical` case fails; anything else is FAIL.**

Both conditions must hold, and each can fail the candidate on its own:

1. **At least 18 of the 20 cases match.**
2. **No `critical` case fails**, so the critical-failure count is 0.

| Matched count (of 20) | Critical failures | Outcome |
|---|---|---|
| 20 | 0 | `PASS` |
| 19 | 0 | `PASS` |
| 18 | 0 | `PASS` |
| 17 | 0 | `FAIL` |
| 20 | 1 | `FAIL` |
| 18 | 1 | `FAIL` |

Any critical failure is a `FAIL` however many cases matched, and a matched count below 18 is a
`FAIL` however few critical cases failed.

Where the four numbers live, so that the rule is data a new standard version changes rather than a
branch in the scoring code:

| Number | Value | Stated in |
|---|---|---|
| Total cases | 20 | `packages/sgi-core/src/standards/sgi-so-1.0.0.ts` (`totalCases`), the `standard_versions.total_cases` column, and the `total_cases` key of `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` |
| Critical cases | 5 | the same three places (`criticalCases`, `standard_versions.critical_cases`, `critical_cases`) |
| Matches required for a pass | 18 | `sgi-so-1.0.0.ts` (`passThresholdMatches`) and `standard_versions.pass_threshold_matches` |
| Critical failures allowed | 0 | `sgi-so-1.0.0.ts` (`criticalFailuresAllowed`) and `standard_versions.critical_failures_allowed` |

The evaluator reads the criteria from the version record and applies them as
`matched_count >= pass_threshold_matches AND critical_failures <= critical_failures_allowed`. The
four columns are documented in `docs/SCHEMA.md` section 3, their cross-column guards are section 6,
and the same four numbers are stated in `docs/SCHEMA.md` section 12 and in
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json`. Where those and
`packages/sgi-core/src/standards/sgi-so-1.0.0.ts` ever disagree, the standard definition is what the
evaluator reads.

## The report

One evaluation produces one report, carrying the provenance a reader needs to trace it back to both
the version it measured and the criteria it was scored against:

| Field | Meaning |
|---|---|
| Report id | The report's identifier, generated at write time. |
| Candidate version id | The versioned listing the run measured. |
| Standard version id | The versioned criteria applied: `SGI-SO-1.0.0`. |
| Per-case result | One entry per fixture case: the case id, its severity, the expected output, the recorded output, and the match boolean. Both outputs are the canonical JSON strings the comparison actually compared. |
| Matched count | How many of the cases matched. |
| Total count | How many cases were scored: 20. |
| Critical failures | How many `critical` cases failed. |
| Outcome | `PASS` or `FAIL`, from the versioned pass rule. |
| Rubric reference | `SGI-SO-1.0.0#rubric`, resolving to `docs/STANDARD-SGI-SO-1.0.0.md#rubric`. |
| Label | `SAMPLE` or `VERIFIED-IN-DEMO`. |
| Prior report id | The retest link, `null` for a version's first report (`Retest semantics`). |
| Created at | The write instant, an ISO-8601 UTC string. |

**The label rule is total, and it reads one stored input.** The label states where the run came
from — the origin of the candidate version, held in `listing_versions.is_fixture_candidate` — and
never whether it passed, so it does not consult the outcome at all:

| `is_fixture_candidate` | Outcome | Label |
|---|---|---|
| true (seeded fixture candidate) | `PASS` | `SAMPLE` |
| true | `FAIL` | `SAMPLE` |
| false (version published through the API) | `PASS` | `VERIFIED-IN-DEMO` |
| false | `FAIL` | `VERIFIED-IN-DEMO` |

`listing_versions.is_fixture_candidate` holds `1` for the three seeded candidate fixture references
and `0` for every version published through the API. **The label vocabulary is closed to `SAMPLE`
and `VERIFIED-IN-DEMO`**: no third word exists, the stored column admits no other value, and
neither label is a certification or a synonym for one — a label says where a run came from, and the
badge, issued on a pass alone, is what carries the outcome (`The badge`).

## Evidence semantics

What a report presents, and what each part of it means:

- **The expected and actual values are recorded verbatim per case**, as the canonical JSON strings
  the comparison compared, with the match boolean beside them. The stored evidence is therefore the
  compared artefact itself rather than two values a reader would have to canonicalise again, and one
  evidence row exists per fixture case per report.
- **The values are the candidate's recorded strings, not a live execution.** Nothing was run to
  produce them, and nothing in the report states or implies that an agent behaved the way its
  recording says it would.
- **The totals and the failing case ids are the derived counts** stated in `Rubric`: how many cases
  matched, how many failed, how many of the failures were `critical`, and which case ids failed.
- **The report identifier and the creation instant are generated at write time and lie outside the
  compared payload.** Two runs over the same submission produce identical per-case arrays and the
  same outcome while their report ids and timestamps differ, and that exclusion is deliberate: it is
  what makes reproducibility checkable rather than merely asserted.
- **Evidence is read nested under its report** by the public `GET /api/v1/evaluations/{id}`, and the
  report read path is `docs/DATA-FLOW.md` section 7.
- **A listing whose version has no report yet renders `No SGI report yet`** in place of an outcome,
  a report id or a badge. An empty state is an ordinary state: it is explained rather than answered
  with an error trace.

## Retest semantics

A retest for the same candidate version creates a **new** report, linked to the prior one through
`prior_report_id`. A report is never amended to carry a second run, and a version's history of runs
is a chain of reports read newest-first.

The link is **derived server-side** by the evaluation route: it reads the newest existing report for
the submitted candidate version **and** standard version and records that report's identifier, or
records `null` when that version has no prior report. It is never a client input — the request body
carries no retest field — so a caller cannot forge a predecessor. The read happens inside the same
transaction that appends the new report, so the predecessor cannot change between the two, and the
predecessor itself is left untouched: no statement on this path updates or deletes a report, and
both `evaluation_reports` and `report_case_results` are append-only.

`docs/DATA-FLOW.md` section 4 states the write path step by step, including where in the transaction
the link is read and where the report and its evidence rows are inserted.

## Appeal semantics

An appeal is a developer's challenge to one report, and a ruling is the operator's answer to it.
Neither changes a measurement.

- **Open an appeal.** `POST /api/v1/evaluations/{id}/appeals`, developer role, `201` with the appeal
  in status `open`. `404` when no report carries that id, `400` when the stated reason is empty or
  nothing but whitespace, `403` when the resolved developer did not publish the listing version the
  report measures, and `401`/`403` from the write header and role rules every write route shares.
- **Rule an appeal.** `POST /api/v1/appeals/{id}/ruling`, operator role, `200` with the appeal in its
  new state, `upheld` or `denied`. `409` when the appeal already carries a terminal ruling — a
  ruling being final, the same outcome a second time is as much a second ruling as the opposite one,
  and neither reopens an appeal — `404` when no appeal carries that id, and `403` for a resolvable
  account that is not an operator.

**A ruling appends a governance event to the append-only `governance_events` table and moves the
appeal's own status.** It issues no statement against the report or against the per-case evidence a
report carries, so the appealed report stays byte-identical: `GET /api/v1/evaluations/{id}` returns
the same report before and after a ruling, and the ruling's history lives in the governance log
beside it. An operator can never alter a measurement, and the routes reachable with the operator
role are additive only.

The appeal sits inside the standard's governance, and the proposal and review process behind the
standard itself is `docs/governance/SGI-PROPOSALS.md`.

## The badge

A badge is issued on `PASS` alone. It names four values and nothing else: the report's label, the
standard version, the scope `structured output on fixture set only`, and the report id. No icon, no
score, no rank and no claim travels with it.

A `FAIL` report carries **no badge at all** — no dimmed badge and no substitute — and shows its
per-case evidence with a plain-language summary in the badge's place. `SampleBadge` in
`apps/web/src/components/sample-badge.tsx` returns nothing for a `FAIL` report, so the rule is held
by the component rather than left to each page, and the report page
`apps/web/src/pages/report.tsx` renders it with the evidence and the summary.

Neither a badge nor a report may ever state or imply any of the following, each of which is false of
what a fixture-set result evidences:

- general safety, or safety for any workload beyond this fixture set;
- certified security;
- independent certification, or that anyone certified, approved or verified the result;
- a guaranteed pass, or that an evaluation can be bought into a pass;
- that a fixture-set result transfers to another workload, another case set or another standard
  version.

## The seeded worked examples

The seed runs the real evaluator over the three candidate fixtures, so a fresh database already
holds three reports before anyone calls the API. The outcomes are recorded in
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/expected-outcomes.json`, and the integration suite
asserts them against it:

| Candidate | Candidate version id | Outcome | Matched / total | Critical failures | Failing case ids | Label |
|---|---|---|---|---|---|---|
| `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/seed-alpha.json` | `00000000-0000-4000-8000-0000000000a1` | `PASS` | 20 / 20 | 0 | none | `SAMPLE` |
| `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/seed-beta.json` | `00000000-0000-4000-8000-0000000000b2` | `FAIL` | 19 / 20 | 1 (`so-003`, a `critical` case) | `so-003` | `SAMPLE` |
| `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/seed-gamma.json` | `00000000-0000-4000-8000-0000000000c3` | `FAIL` | 17 / 20 | 0 | `so-014`, `so-016`, `so-018` | `SAMPLE` |

The three together are the pass rule's three outcomes in one place: a clean pass, a run above the
match threshold defeated by a single `critical` failure, and a failure of the match threshold alone
with no critical failure at all. Each candidate version id is the fixed UUID the seed writes for
that version and is the `candidate_version_id` its own candidate file states.

All three versions are seeded with `listing_versions.is_fixture_candidate` set, which is why their
seeded reports are labelled `SAMPLE` on `PASS` and `FAIL` alike. The assertion that these three
outcomes, these matched counts and these failing case ids hold is
`apps/api/test/integration/api-contract.test.ts`.

## How this standard changes

Thresholds, the case set and the pass rule change **only** by publishing a new standard version
through review. Nothing in the running system can widen a threshold — not an operator, not a route,
and not a configuration value.

1. **Propose.** A contributor submits a proposal with
   `POST /api/v1/standards/proposals` (contributor role, `201`, status `submitted`; `400` for a body
   its schema refuses, `401` and `403` from the write header and role rules). The inserted proposal
   row is itself the record of the submission.
2. **Review.** An operator calls `POST /api/v1/standards/proposals/{id}/review` (operator role,
   `200` with the status moved to `accepted` or `rejected` and a governance event appended; `409`
   when the proposal has already been decided, `403` for a non-operator, `404` for a standard the
   proposal names that does not exist).
3. **Publish.** An accepted change creates a **new** row in `standard_versions` rather than editing
   one. Approving a proposal does not itself publish a version: the new version is inserted as its
   own row, and the version it supersedes stays exactly as it was. Existing reports keep citing the
   standard version they were produced under, because `standard_version_id` and `rubric_reference`
   are stored per report.

A change to a case file, a severity, a threshold or this document is therefore a governance change
rather than an edit, and it requires maintainer review: `packages/sgi-core/`, `packages/sgi-fixtures/`
and `docs/governance/` are CODEOWNERS-protected paths in `.github/CODEOWNERS`. The process in full is
`docs/governance/SGI-PROPOSALS.md`, and the intake form a proposal starts from is
`.github/ISSUE_TEMPLATE/standards-proposal.md`.

## Endpoints that produce and return a report

| Method and path | Role | Success | Error cases |
|---|---|---|---|
| `POST /api/v1/evaluations` | developer, owner of the candidate version | `201` with the report | `400` malformed submission, `404` unknown candidate version or standard version, `422` a submission missing a recorded output for a fixture case, `403` a version whose listing belongs to another developer |
| `GET /api/v1/evaluations/{id}` | public | `200` with the report and its per-case evidence | `404` unknown report |

The evaluation is synchronous and deterministic: there is no queue and no worker, the run completes
inside the request, and two runs over the same submission and standard version return the same
per-case results and the same outcome — the report identifier and the creation instant differ, as
`Evidence semantics` states. Every failure, whatever produced it, answers the one envelope
`{ "error": { "code", "message" } }`. The demo-account header every write carries, its `401` and
`403` outcomes, and the write rate limit of 60 requests per minute per client answered `429` with a
`Retry-After` header are `docs/DATA-FLOW.md` section 1.
