# Write a standards proposal and take it through review

Labels: P1, good-first-issue, milestone M4

## Scope

A proposal is the **only route by which the Standard Gate Index changes**: you write it, an operator
reviews it, and it is either accepted or rejected — `submitted` → `accepted` or `rejected`, and
nothing else moves it. A proposal may not edit an existing standard version, its thresholds, its case
set or its `standard_versions` row: a change to criteria becomes a **new standard version** after
acceptance, which is the separate task in `docs/starter-tasks/new-standard-version-case-set.md`.
Applied migrations are immutable too — migrations only add, and the runner records each applied
file's checksum and refuses to start when a file's bytes changed — so a criteria change is never a
migration edit. The standard's numbers stay provisional and versioned with the standard.

You write it by filling the sections of `.github/ISSUE_TEMPLATE/standards-proposal.md`: the standard
or case set concerned (this release has exactly one — `SGI-SO-1.0.0`, "Structured Output
Conformance", 20 fixture cases of which 5 are `critical`, the pass rule "at least 18 of 20 cases
match AND no `critical` case fails", rubric reference `SGI-SO-1.0.0#rubric`); the change; the
rationale; the evidence that supports it, declared as fixture data and expected outputs that are
never executed; how the change would be judged, as an acceptance note phrased in observable
behaviour; and the licence and attribution declaration for any contributed fixture pack.

Submission is a contributor write: `POST /api/v1/standards/proposals` answers `201` with the proposal
in status `submitted`, and its body carries only `standard_id`, `title` and `rationale` — you are
resolved from the `X-Demo-Account` header, and `status` is not a body field, so nobody can decide
their own proposal. `400` for a body its schema refuses or a blank title or rationale, `401` with no
header or an account the server cannot resolve, `403` for a resolvable non-contributor, `404` when
`standard_id` names no catalogue row. Review is an operator write:
`POST /api/v1/standards/proposals/{id}/review` answers `200`, moves the status to `accepted` or
`rejected`, and appends **exactly one** `proposal_reviewed` governance event; `409` `already_decided`
when the proposal no longer carries `submitted` — a second review is refused whether it agrees with
the first decision or reverses it — `403` for a non-operator, `404` for an identifier no row carries.
A review never rewrites the proposal's own text: the title and rationale come back exactly as
submitted, so a later reader sees the reasoning the decision answered. Reads are public:
`GET /api/v1/standards` answers the catalogue with each standard's versions and its proposals and
their review status, and `GET /api/v1/standards/{id}/versions/{v}` answers one published version.
The code that owns all of it, which you can read to see the behaviour rather than trust this page:
`apps/api/src/routes/standards.ts`, `packages/sgi-core/src/proposals/submit-proposal.ts`,
`packages/sgi-core/src/proposals/review-proposal.ts`, and `packages/sgi-core/src/events/append-event.ts`
— the single insert path into the append-only governance log.

The rules your text must respect. Commercial or sponsored data must never reach scoring, a report, a
badge or organic ordering, and no import path connects them: do not propose creating one. Nothing in
a proposal may claim certification, independent verification, universal safety or a guaranteed pass —
buying an evaluation never guarantees a pass, because outcomes depend on test evidence only.
Automated governance without human review is out of scope: every status change is a decision by an
operator account, recorded as an appended event, and nothing in this process is automatic.

Keep the words the product uses, spelled exactly: `SGI-SO-1.0.0`; "Structured Output Conformance";
the 20-case fixture set with 5 `critical` cases; the pass rule "at least 18 of 20 cases match AND no
`critical` case fails"; the rubric reference `SGI-SO-1.0.0#rubric`; the report labels `SAMPLE` and
`VERIFIED-IN-DEMO`, and no others; a badge's scope "structured output on fixture set only"; and "to be
determined" for the founder-allocation contract structure if you mention commerce at all.

Write for a reader who has only this repository: address them as "you", and never name a person as
the assignee. No real personal name, contact detail, email address, telephone-number pattern,
credential, token, private-project reference or nonpublic information belongs in a proposal,
including inside a fixture, a log or a configuration excerpt — the exclusion scan reads every tracked
file and the manual privacy review reads this folder, so use a fictional handle and fictional values
wherever you need an example.

Read next: `docs/governance/SGI-PROPOSALS.md` for the process in full — the roles, the lifecycle, what
a reviewer decides and what a review appends; `docs/STANDARD-SGI-SO-1.0.0.md` for the rubric that
reference resolves to, the case list, the evidence semantics and the report's field list;
`docs/starter-tasks/new-standard-version-case-set.md` for the task that publishes an accepted change
as a new version; `CONTRIBUTING.md` for the contribution path and the pull-request checklist; and
`docs/ROADMAP.md` for the milestone and priority tier this belongs to.

## Acceptance

1. Observable on a freshly seeded instance. `npm run seed`, then `npm start`; submit your proposal as
   a contributor demo account by sending the `X-Demo-Account` header on the write and observe `201`
   with `status: "submitted"`; `GET http://localhost:3000/api/v1/standards` shows the proposal under
   the standard carrying that status; review it once with an operator account and observe `200` with
   `accepted` (or `rejected`) and exactly one appended governance event; a second review of the same
   proposal answers `409` and appends nothing.
2. `npm run test:integration -- --testNamePattern="route walk"` exits 0: it walks both standards rows
   and asserts their documented statuses, including the `409` `already_decided`, the `403` and the
   `401`.
3. The document itself: every section of `.github/ISSUE_TEMPLATE/standards-proposal.md` is filled, the
   governance rule is stated accurately — a new standard version is the only route by which criteria
   change, and an existing version and every applied migration are immutable — and no sentence claims
   certification, independent verification or a guaranteed pass.
4. Once the exclusion scan is present in the tree, `npm run scan:exclusions` exits 0 with an empty
   finding list; before that, check by hand that no string in your proposal holds an `@` or a run of
   five or more consecutive digits.
