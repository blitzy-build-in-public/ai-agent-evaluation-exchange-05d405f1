---
name: Standards proposal (SGI)
about: Propose a change to a Standard Gate Index standard or case set, which becomes real only as a new standard version published through review.
title: "[sgi]: "
labels: ["standards-proposal"]
---

The **Standard Gate Index** is ADEM's community-governed measurement surface: it publishes versioned
standards, each with a rubric, a pass rule, a fixed fixture set and reproducible PASS or FAIL reports
a buyer can compare against what a listing claims. This release publishes exactly one standard —
`SGI-SO-1.0.0`, "Structured Output Conformance" — whose fixture set is 20 cases of which 5 are
`critical`, whose pass rule is **at least 18 of 20 cases match AND no `critical` case fails**, and
whose rubric reference is `SGI-SO-1.0.0#rubric`.

This form proposes a **new standard version**, never a change to an existing one: a published
version, the case set it names and the pass rule it stores are append-only, so altering any of them
means proposing a version that supersedes it. The process in full — submission, operator review, the
appended governance event and how a version is published — is `docs/governance/SGI-PROPOSALS.md`.
The rubric, the case list, the evidence semantics, the retest and appeal semantics and the report's
field list are `docs/STANDARD-SGI-SO-1.0.0.md`, which is the document a report's rubric reference
resolves to.

_Answer each prompt below in place, and delete a prompt you have answered._

## The standard or case set concerned

_Which standard code and version label does this concern, and what would the proposal add, replace or
threshold differently? Spell out every figure that would change: the case count, the count of
`critical` cases, the match threshold and the critical failures allowed. The figures published today
are 20 cases, 5 of them `critical`, a match threshold of at least 18 of 20, and 0 critical failures
allowed._

## The change

_State precisely what would differ, so the decision can be made without reading any code: which case
ids are added, removed, re-severed or re-expected; for a new case, its id, input, expected output and
severity; and the exact pass rule the new version would carry. Say which version label would carry
the change. A proposal that alters a case, a severity or a threshold inside a published version is
not one this process can accept, because a published version is never edited._

## The rationale

_Why does the change make measurement more useful, honest or reproducible? Say what the case set or
the pass rule in force fails to evidence, and why the proposed one evidences it better. A rationale
resting on a fee, a sponsorship, a commercial arrangement or a more favourable outcome for a paying
party is out of scope: criteria are independent of who buys an evaluation._

## The evidence

_Give the fixture cases and expected outputs you propose, the per-case comparison the change would
alter, and the seeded candidate that motivated it. Evidence here is declarative data that is never
executed: a candidate holds a candidate version id and one recorded output per case, and nothing in
the product runs submitted content, because there is no sandbox, no dynamic import and no code path
that executes anything submitted. Each case is judged by comparing the recorded output against the
expected output as canonical JSON, case by case, with no partial credit and no tolerance. Paste no
credential, token, secret, personal name, contact detail or nonpublic information, including inside
a fixture, log or configuration excerpt; use synthetic identifiers and fictional values only._

## How the change would be judged

_An acceptance note phrased as observable behaviour, so anyone can check it after the change lands:
the suite that would prove it, the case ids that would change, and what the seeded outcomes should
become. The three seeded candidates must keep producing one PASS, one critical-case FAIL and one
threshold FAIL: `seed-alpha` `PASS` at 20 of 20 matches with 0 critical failures; `seed-beta` `FAIL`
at 19 of 20 with 1 critical failure, on `so-003`; `seed-gamma` `FAIL` at 17 of 20 with 0 critical
failures, failing on `so-014`, `so-016` and `so-018`. What holds it is the unit suites of
`packages/sgi-core` and `packages/sgi-fixtures`, the fixture loader's own test, and the
seeded-outcome assertions in `apps/api/test/integration/`. A case set whose identity or counts
disagree with the version record is refused rather than scored._

## The licence and attribution declaration

_Required for any contributed fixture pack. State the licence the pack is offered under and the
attribution file that credits it, as the worked example does with
`examples/extension-fixture-pack/LICENSE` and `examples/extension-fixture-pack/ATTRIBUTION.md`.
Declaring a licence and an attribution for the contribution does not force disclosure of the
contributor's own source code._

## The governance rule

- Standards and pass thresholds change only by publishing a new standard version through review. No
  operator, route, job or configuration value can widen a threshold.
- A proposal moves `submitted` → `accepted` or `rejected` through operator review, which appends one
  governance event. The proposal's own text is never rewritten, and a second decision on an already
  decided proposal is refused.
- An existing standard version is never edited, and its identifier is immutable. A change to a case,
  a severity or a threshold is a new version with its own fixture set, normally delivered as a fixture
  pack registered through the typed seam exported from `packages/sgi-core`, which needs no edit to
  that package's scoring code.
- Nine tables are append-only: `standard_versions`, `evaluation_reports`, `report_case_results`,
  `governance_events`, `ledger_entries`, `transactions`, `refunds`, `audit_events` and
  `listing_versions`. Each accepts a newly inserted row and nothing else, so no update and no delete
  reaches one; `docs/SCHEMA.md` names the set.
- Applied migration files are immutable, and migrations only add. Each applied file's checksum is
  recorded, and a file whose bytes changed stops the server from starting, so a governance change is
  never a migration edit.
- Commercial and sponsored data must never reach a score, a report, a badge or organic ordering. No
  fee, sponsorship or commercial arrangement may influence a threshold, a measurement or an ordering:
  no import path connects the SGI package `packages/sgi-core` to the commerce package
  `packages/commerce-sim` or to sponsorship data, and a gate-evaluation fee is recorded in the
  gate-fee ledger only.

_Confirm before submitting:_

- [ ] This proposal asks for a new standard version, and not for an edit to an existing one.
- [ ] No threshold, no case, no measurement and no ordering in it is influenced by a fee, a
      sponsorship or a commercial arrangement.

## The vocabulary and no-claim rule

- Report labels are `SAMPLE` and `VERIFIED-IN-DEMO` and nothing else: the vocabulary is closed, and
  neither label is a certification.
- A badge's scope is exactly `structured output on fixture set only`, and a badge names the standard
  version, that scope and the report id. A `FAIL` report carries no badge and shows its per-case
  evidence with a plain-language summary instead.
- Buying an evaluation never guarantees a pass: outcomes depend on test evidence only.
- Nothing in a proposal may claim general safety, certified security or independent certification,
  and nothing may present ADEM Shield Basic as a gate pass, a certification or a security guarantee.
- This repository publishes no contact address. Report a suspected vulnerability through the private
  reporting channel that `SECURITY.md` describes, rather than in a public issue.

_Confirm before submitting:_

- [ ] No label outside `SAMPLE` and `VERIFIED-IN-DEMO` is introduced, and no badge claim widens beyond
      the fixture-set scope.
- [ ] Nothing in this proposal claims certification, universal safety or a guaranteed pass.
- [ ] No email address, telephone number, personal name or nonpublic information appears in it.
