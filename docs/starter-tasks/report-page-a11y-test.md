# Widen the audited surface of the report page and its neighbouring states

Labels: P0, good-first-issue, milestone M3

## Scope

Criterion 9 of the specification is checked by `e2e/a11y.spec.ts`, which audits four pages — the
homepage, a listing page, a compare page and a report page — at the two widths the two accessibility
projects set, 1280 px and 360 px. What it does **not** yet cover is the report page in its other
state: a report whose outcome is `FAIL`, which renders per-case evidence and a plain-language summary
and carries no badge at all, and a listing page whose listing has no evaluation yet and therefore
shows `No SGI report yet`. Both are first-class product states, and an inaccessible state is exactly
as much a defect as an inaccessible happy path.

Your task is to widen what the audit walks, **not what it requires**: the same four pages, the same
axe rule set, the same two widths, the same impact filter, and the seeded data the suite already
relies on — the seed publishes three candidates whose outcomes are one `PASS`, one critical-case
`FAIL` and one threshold `FAIL`, so the failing report page is reachable without inventing a row.

**Why the widths and the projects are not yours to multiply.** `playwright.config.ts` declares
exactly three projects, one per test kind, and the two accessibility ones are what `npm run test:a11y`
selects. A third width is a change to that contract, to the script and to the statement of it in
`docs/ARCHITECTURE.md`, so it belongs in a plan revision rather than in a starter task. Adding a fifth
audited page is not the task either: the four pages are the criterion's own list, and the contribution
here is the state coverage inside them.

**What must not change.** The audit's rule set stays axe's default for the whole document: no rule is
disabled, no node is excluded, and no filter is applied other than axe's own documented `impact`
value, where only `serious` and `critical` fail the run. A narrowed rule set would quietly change what
the criterion means. The no-horizontal-scroll assertion stays part of every audited page, read from
the project's own configured viewport rather than from a number written in the spec.

Nothing you add may assert a certification, an independent verification or a guaranteed pass, and no
fixture, label or comment may name a real person, brand, product, contact detail, credential or
private project. The audited pages carry the product's closed label vocabulary — `SAMPLE` or
`VERIFIED-IN-DEMO`, the badge's scope `structured output on fixture set only`, `Sponsored` on a
sponsored item, `demo only, no production authentication` for a demo session, `DEMO` for a simulated
amount, `No SGI report yet` for a listing with no evaluation, and `to be determined` for the
founder-allocation structure — and a paraphrase of any of them is a finding rather than a variant.

Read next: `e2e/a11y.spec.ts`, which owns the rule set, the impact filter and the scroll assertion;
`playwright.config.ts` for the three projects and the width each sets; `apps/api/src/seed/seed-data.ts`
for the seeded reports and their outcomes; `apps/web/src/pages/report.tsx` and
`apps/web/src/components/sample-badge.tsx` for the two report states.

## Acceptance

1. `npm run build` exits 0, because the browser suites run against the built application.
2. `CLONE_INDEX=<your index> npm run test:a11y` exits 0 on both projects — the desktop one at 1280 px
   and the mobile one at 360 px — with zero serious or critical axe-core violations on every audited
   page, including the failing report page you added to the walk and the listing page with no report.
3. The scroll assertion holds where you added coverage: at 360 px the document's `scrollWidth` is no
   greater than the viewport width for each newly audited state, asserted through the suite's own
   helper rather than by eye.
4. The failing report page carries **no** badge and its per-case evidence is present, while the
   passing report carries the badge naming the standard version, the scope
   `structured output on fixture set only` and the report id — asserted in the same file, because the
   badge is a trust artefact and its absence on a `FAIL` is part of the criterion.
5. `CLONE_INDEX=<your index> npm run test:e2e` exits 0, which is the check that the seeded data the
   audit walks is the data the rest of the browser suite walks.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
