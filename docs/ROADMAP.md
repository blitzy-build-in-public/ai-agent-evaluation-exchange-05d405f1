# ADEM roadmap — the milestones a contributor can aim at

ADEM is the Agent Development Exchange and Marketplace: a public open-source foundation whose first
version runs locally with no secrets, in which a developer lists an agent, a deterministic evaluator
produces a reproducible Standard Gate Index report, and a buyer compares a listing's claims against
its measured evidence. This roadmap is ordered by dependency rather than by date, so each milestone
names what must exist before the next one can pass and what command proves it.

## How to read this document

The milestones below are ordered by dependency, not by date. A milestone is complete only when its
exit condition passes on the built product, and every check it names runs from the repository root.
No milestone is scheduled: nothing here is an announcement, a release promise or a commitment about
when any capability arrives.

## M1 — Foundation builds (P0, infrastructure)

**Delivers.** The repository skeleton and everything that makes the tree buildable and testable: the
workspace declaration with its root scripts, the strict compiler configuration inherited by every
workspace, the three test configurations, the container files, the CI pipeline, and `packages/shared`
in full — its constants, domain types, JSON schemas and the twelve ordered migrations that create the
tables, the append-only triggers and the read-path indexes.

**Touches.** `package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.json`,
`vitest.unit.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `Dockerfile`,
`docker-compose.yml`, `.gitignore`, `.dockerignore`, `.github/workflows/ci.yml`, `packages/shared/**`
including `packages/shared/migrations/0001`–`0012`, among them `0012_amount_integer_guards.sql`.

**Priority tier:** P0 — the infrastructure every other milestone is built on.

**Exit condition.** From a clean checkout: `npm ci` exits 0, `npm run build` exits 0, and an empty
unit run (`npm run test:unit` with no test file in the tree yet) succeeds; and the twelve migrations
apply in filename order to an in-memory database, with the append-only triggers created on all nine
append-only tables.

## M2 — Exchange discovery (P0)

**Delivers.** A buyer can browse, search, filter and compare two to four listings side by side —
claims against measured evidence, the `SGI-SO-1.0.0` version, limitations, licence and pricing model
— and a developer can publish a listing and a version. A listing with no evaluation shows
"No SGI report yet", and an empty search or an empty listing set renders an explanatory empty state
rather than an error trace.

**Touches.** `apps/web/src/pages/{home,mission,listings,listing-detail,compare,developer}.tsx`,
`apps/web/src/components/{search-filters,listing-card,compare-table,nav,empty-state,error-notice}.tsx`,
`apps/web/src/api-client.ts`, `apps/web/src/app.tsx`, `apps/api/src/routes/{listings,compare}.ts`,
`apps/api/src/{server,index,config}.ts`, `apps/api/src/db/**`, `apps/api/src/auth/**`,
`apps/api/src/errors/**`, `apps/api/src/seed/**`.

**Priority tier:** P0 — exchange discovery.

**Exit condition.** `npm run seed` succeeds and the exchange half of `npm run test:e2e` passes on seed
data: browse, search, filter and compare run against the seeded listings, with no hand-made data and
no environment variable.

## M3 — SGI and the deterministic evaluator (P0)

**Delivers.** A developer runs an evaluation against the provisional standard `SGI-SO-1.0.0` and
receives a reproducible PASS/FAIL report carrying the candidate version, the standard version,
per-case evidence, the totals and outcome, a rubric reference and exactly one label — `SAMPLE` or
`VERIFIED-IN-DEMO`. A badge names the standard version, the scope
"structured output on fixture set only", and the report ID; a FAIL report carries no badge. Standard
versions are immutable, a retest creates a new report linked to the prior one, and an appeal ruling
appends a governance event while the report it concerns is unchanged.

**Touches.** `packages/sgi-fixtures/**` (20 cases, 5 of them `critical`, and the three seed
candidates), `packages/sgi-core/src/{standards,scoring,reports,proposals,appeals,events}/**`,
`apps/api/src/routes/{standards,evaluations,appeals}.ts`,
`apps/web/src/pages/{standards,report}.tsx`, `apps/web/src/components/sample-badge.tsx`,
`docs/STANDARD-SGI-SO-1.0.0.md`, `packages/shared/migrations/{0005,0006,0007,0010}_*.sql`.

**Priority tier:** P0 — the Standard Gate Index, the deterministic evaluator and the sample badges.

**Exit condition.** Criterion 3 and criterion 4 pass. Two runs over the same candidate fixture yield
byte-identical per-case results and outcomes (`npm run test:unit -- packages/sgi-core`,
`npm run test:integration -- --testNamePattern=evaluations`), and no route mutates a report, a case
result or a governance event while an appeal ruling leaves the report identical
(`npm run test:integration -- --testNamePattern=immutability`).

## M4 — Collaboration and Shield (P1)

**Delivers.** Challenges, threads and inquiries work end to end on the public boards, with the demo
accounts carrying the visible label "demo only, no production authentication". ADEM Shield Basic
ships as a separate, free, standalone package that requires no signup, denies by default when no rule
matches, never throws on a malformed call or policy, and carries its own threat model and exclusions
list. The extension seams are exported from `sgi-core`'s single public entry, and
`examples/extension-fixture-pack/` proves a community addition builds and passes with no edit to the
scoring path. The contributor documents — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and
the starter tasks — are in place.

**Touches.** `apps/web/src/pages/{challenges,threads}.tsx`,
`apps/web/src/components/{challenge-form,thread-reply-form,inquiry-form,demo-account-switcher,demo-banner}.tsx`,
`apps/web/src/data/demo-accounts.ts`, `apps/api/src/routes/{inquiries,challenges,threads}.ts`,
`packages/shield/**`, `docs/shield/{README,THREAT-MODEL,EXCLUSIONS,POLICY-FORMAT}.md`,
`packages/sgi-core/src/extensions/**`, `examples/extension-fixture-pack/**`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, `SECURITY.md`, `docs/starter-tasks/`.

**Priority tier:** P1 — Shield Basic, buyer challenges, collaboration, contributor documents and the
extension seams.

**Exit condition.** Criterion 5's Shield suite passes (`npm run test:unit -- packages/shield`),
criterion 8's API half passes (`npm run test:integration -- --testNamePattern="route walk"`), and the
example extension's own acceptance test passes
(`npm run test:unit -- examples/extension-fixture-pack`) with `git diff --stat -- packages/sgi-core/src/scoring`
empty for the change that adds it.

## M5 — Participation and commerce simulation (P2)

**Delivers.** The Gate Readiness Academy with a self-assessment computed locally and nothing
persisted; the illustrative opportunity index, stated as illustrative on every render; and the
limited sponsor-slot demonstration, disclosed as advertising, labelled `Sponsored`, returned in its
own collection rather than interleaved with organic results, and carrying no personalised tracking.
It also delivers the commercial simulation: offer selection across rent, purchase, licence and
subscription, the simulated checkout, the gate-fee ledger kept separate from the marketplace ledger,
the provisional founder-participation allocation, and refunds as appended reversals. Amounts are
integer minor units of the synthetic currency `DEMO` with no real currency code or symbol, every
simulated amount carries a disclosure label, and the founder ledger's contract structure is labelled
"to be determined" with no personal identity, beneficiary account or entitlement.

**Touches.** `apps/web/src/pages/{academy,opportunity-index}.tsx`,
`apps/web/src/components/{self-assessment,opportunity-index-table,sponsored-label,checkout-panel,ledger-table}.tsx`,
`apps/web/src/illustrative/opportunity-index.ts`,
`apps/api/src/routes/{sponsored,checkout,refunds,ledgers}.ts`, `packages/commerce-sim/**`,
`packages/shared/migrations/{0008,0009}_*.sql`.

**Priority tier:** P2 — the Academy, the opportunity index, the sponsor slot, and the commerce and
fee ledgers.

**Exit condition.** Criterion 6's ledger arithmetic passes (`npm run test:unit -- packages/commerce-sim`,
`npm run test:integration -- --testNamePattern=ledger`): an eligible transaction of 10,000 minor
units allocates 25 with the default configuration, a full refund appends a reversal bringing the net
allocation to 0, a partial refund of 4,000 reverses 10, a gate fee produces no allocation, and no
ledger entry can be modified. The rendered `Sponsored` label passes
(`npm run test:e2e -- --grep sponsored`).

## M6 — Release readiness

**Delivers.** The whole product verified from a clean checkout, the artefacts a first pull request
carries, and the contributor entry points: the full suite green; the exclusion-scan output, the
regenerated `docs/DEPENDENCIES.md` and the completed `docs/REVIEW-CHECKLIST.md` riding with the first
pull request; this roadmap, the starter tasks and the issue templates published in-repository; and
the foundation's first public version tagged in-repository. It adds no product capability. No
deployment and no announcement is part of it: both require separate approval.

**Touches.** `README.md`, `docs/ROADMAP.md`, `docs/REVIEW-CHECKLIST.md`, `docs/DEPENDENCIES.md`,
`docs/starter-tasks/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/**`,
`.github/workflows/ci.yml`, `e2e/**`, `scripts/**`.

**Priority tier:** release readiness across every tier; it is reached only when the milestones it
verifies have passed.

**Exit condition.** On a clean checkout: `npm test`, `npm run test:e2e` and `npm run test:a11y` all
exit 0 from the seed, with no hand-made data and no environment variable; `npm run scan:exclusions`
exits 0 with an empty finding list; `npm run deps:report` exits 0 and regenerates `docs/DEPENDENCIES.md`
unchanged; and the README walkthrough alone carries a new contributor through `npm install`,
`npm run build`, `npm test` and `npm start`.

## Priority tiers and the cut order

The request fixes the tiers, and work is ordered by them rather than by size:

- **P0** — exchange discovery, the Standard Gate Index, the deterministic evaluator and the sample
  badges, with the end-to-end developer-to-buyer loop.
- **P1** — ADEM Shield Basic, buyer challenges, collaboration, contributor documents and the
  extension seams.
- **P2** — the Academy, the opportunity index, the sponsor slot, and the commerce and fee ledgers.

When the line budget is at risk, optional work is removed from the lowest tier upward, in this order:

1. **Participation** — the Academy, the illustrative opportunity index and the sponsor slot.
2. **Commerce simulation** — offer selection, the simulated checkout, the gate-fee ledger, the
   founder-allocation ledger and refunds.
3. **P1 items**, only if those removals are still not enough: first the example extension and the
   extension seams' example coverage, then the community documents beyond the mandatory set, then
   buyer challenges and collaboration, and finally ADEM Shield Basic, which is P1's first item and
   therefore the last of P1 to go.

A lower-tier capability never displaces a higher-tier one, and P0 work is never cut: exchange
discovery, the Standard Gate Index, the deterministic evaluator, the sample badges and the
end-to-end loop stay in the plan whatever else leaves. The plan's own allocation sits inside the
request's budget band — a target of 65,000 to 80,000 lines with a hard ceiling of 90,000, and an
estimate of 71,000 lines with 18,000 lines of test and fixture reserve inside it. Optional work is
cut to fit the ceiling and nothing is ever padded to reach a target: a capability is removed rather
than shrunk, so a deferred capability leaves the plan with its files rather than arriving smaller.

## Deferred capabilities

Each capability below is deferred, with the reason and the constraint the reason rests on.

| Deferred capability | Why it is deferred | Constraint the reason rests on |
| --- | --- | --- |
| Real payments, payouts, settlement and bank connections | No money movement is permitted | A provider integration would put a payment provider's name in the repository and open a money path the hard exclusions forbid |
| Production authentication and sensitive personal data | Unapproved; synthetic accounts only | Real credentials or personal data would breach the prohibition on real personal information and on secrets in the repository |
| Execution of submitted third-party agent code, and any production sandbox | Unsafe until isolation is separately reviewed; fixtures only | Executing a candidate would break the evaluator's determinism and the rule that a submission is declarative data |
| Advanced orchestration, live rentals and deployments | Outside the foundation | They would need external services, which the interaction rules forbid — no import path and no network call exists for one |
| Enterprise compliance and external connectors | Outside the foundation | They would need accounts, data flows and legal review that the exclusions exclude |
| Paid live advertising and personalised ad profiling | No real ads and no tracking | Personalised tracking contradicts the privacy limit and the sponsor-slot design, which is a labelled demonstration |
| Automated standards governance without human oversight | Trust requires human review | A pass threshold changes only through a reviewed proposal that creates a new standard version, never by an edit |
| A public campaign for ADEM Shield Basic | Not approved | No campaign copy or branding may be generated, and no announcement is made |
| Deployment, announcements and outreach | Separate approval is needed | No workflow deploys, no release is announced and no hosting provider is referenced |

A deferred capability is **removed rather than stubbed**: nothing deferred is planned, stubbed or
partially implemented anywhere in the repository, and a deferred item is not described as upcoming.

## What "done" means for a milestone

- Its files build: `npm run build` (and `npm run typecheck`) exit 0.
- The suite that covers the work passes: `npm test` for the unit, integration and scan legs,
  `npm run test:e2e` for the browser loop, `npm run test:a11y` for accessibility and responsiveness.
- `npm run scan:exclusions` exits 0 with an empty finding list.
- `npm run deps:report` exits 0 and leaves `docs/DEPENDENCIES.md` unchanged.
- Any change to a fixed interface, to a status code or to an append-only store is raised as a plan
  revision rather than taken as an implementation choice.

Passing an exit condition measures exactly the checks it names, on the fixtures the standard version
fixes, and nothing beyond them: it is not a certification of safety or security, and it says nothing
about an agent outside those fixtures.

## Where a new contributor starts

- `docs/starter-tasks/` — twelve labeled briefs mapped to the extension seams and the documentation;
  each states its own scope, the milestone it belongs to and the command that proves it done.
- `CONTRIBUTING.md` — the contribution path and the pull-request checklist, including the artefacts a
  first pull request carries.
- `packages/sgi-core` — the extension seams `FixturePack`, `EvaluatorCheck` and `ListingCategory`,
  exported from the package's single public entry alongside `scoreSubmission` and the registry, with
  `examples/extension-fixture-pack/` as the worked example of a fixture pack contributed without
  touching `packages/sgi-core/src/scoring/`.

For what the first version works at and what it deliberately does not, see `../README.md`.
