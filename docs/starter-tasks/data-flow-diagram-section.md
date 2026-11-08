# Diagram one more path in the data-flow document

Labels: P1, good-first-issue, milestone M4

## Scope

`docs/DATA-FLOW.md` describes the product's paths as text and diagrams rather than as pictures, so a
reader can diff them, quote a line of them in a review and open them beside the code they describe.
Its sections walk the conventions every path keeps, then the read, write, evaluation, governance,
commerce and report-read paths, then where determinism lives, then statuses and limits. What a
document like this gets wrong over time is the part nobody re-reads, so the contribution is a path
that is under-described today, documented to the same standard as its neighbours.

Your task is to extend the document, **in the document** — no new file, no diagram that exists as an
image only, and no claim the code does not support. Two paths are the best candidates because their
semantics are easy to state wrongly: the retest link, where `POST /evaluations` writes a new report
whose `prior_report_id` is derived server-side from the newest report already stored for the submitted
candidate version and standard version, and the appeal ruling, where an operator's ruling appends a
governance event and leaves the report untouched. Pick one, or one of your own that you can ground in
the code, and write it the way the existing sections are written.

**What the addition has to contain, because a summary is not a flow.** The entry point and who may
call it — a write names a synthetic demo account through the `X-Demo-Account` header, and a missing or
unresolvable account is `401` while the wrong role is `403`. The order of the steps inside the
request, including the validation that happens before anything is written: a submission that lacks a
recorded output for a fixture case is refused with `422` before any report exists, and the write rate
limit answers `429` with `Retry-After` beyond sixty requests per minute per client. What is written,
in which table, in one transaction or several, and which of the nine append-only tables is involved.
What is *not* written — a rule that nothing edits a published report, a standard version or a ledger
entry, and that a change appends rather than rewrites. And the response a caller observes, with its
status.

**Determinism is part of the flow, not a footnote.** Where your path computes anything, say which
inputs decide it: the fixture set and the versioned pass rule, canonical JSON for comparison, and no
clock, locale, timezone or random source anywhere in the scoring path. The report's identifier and
creation instant are generated at write time and lie outside any compared payload, which is exactly
why a retest produces a second report rather than a different verdict.

Nothing you write may describe the product as certified, independently verified or safe for arbitrary
workloads; no surface may claim that buying an evaluation guarantees a pass, because outcomes depend
on test evidence only; and no text, example or comment may name a real person, brand, product, private
project, contact detail, credential or token — no `@` in any string and no run of five or more
consecutive digits.

Read next: `docs/DATA-FLOW.md`, whole, for the house form of a section; `docs/ARCHITECTURE.md` for the
module boundaries your path may cross; `docs/SCHEMA.md` for the tables and which of them are
append-only; `apps/api/src/routes/evaluations.ts` and `apps/api/src/routes/appeals.ts` for the two
candidate paths.

## Acceptance

1. The section is in `docs/DATA-FLOW.md` and nowhere else: `git status --short docs/` shows one
   modified file and no added one for this task.
2. Every step it states is checkable against the code it names, and each named file exists at the path
   written. A step you cannot ground is a step to leave out rather than to soften.
3. The two properties the document is read for are present in your section: the validation that runs
   before a write (with the status it answers), and the statement of what is never edited — an
   append-only table's row, a published standard version, a ledger entry — with the mechanism named
   rather than implied.
4. Your section agrees with the code at the current revision, and the check is a run rather than a
   reading: `npm run test:integration -- --testNamePattern=evaluations` and
   `npm run test:integration -- --testNamePattern=immutability` both exit 0, and the retest and ruling
   behaviour your section describes is the behaviour they assert. Paste both results into the
   pull-request description.
5. No sentence in the section claims certification, independent verification, a guaranteed pass or
   that a policy document or a badge provides technical isolation, and the label vocabulary it quotes
   is the product's own — `SAMPLE` or `VERIFIED-IN-DEMO`, `structured output on fixture set only`,
   `Sponsored`, `demo only, no production authentication`, `DEMO`, `No SGI report yet`, `to be
   determined` — unparaphrased.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
