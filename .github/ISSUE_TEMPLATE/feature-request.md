---
name: Feature request
about: Propose a capability for the ADEM foundation — the exchange, the Standard Gate Index, the demo evaluator, ADEM Shield Basic or the simulated commerce.
title: "[feature]: "
labels: ["enhancement"]
---

The ADEM foundation is the MIT-licensed public repository that holds the exchange, the Standard Gate
Index, the deterministic evaluator, the standalone ADEM Shield Basic package and the simulated
commerce, and a proposal for what it should do next is welcome here. The contribution path and the
pull-request checklist are `CONTRIBUTING.md`; the milestones a capability can join are
`docs/ROADMAP.md`; the briefs sized for a first contribution are `docs/starter-tasks/`; a change to a
standard's criteria has an intake form of its own at `.github/ISSUE_TEMPLATE/standards-proposal.md`;
and a defect belongs in `.github/ISSUE_TEMPLATE/bug-report.md`.

_Answer each prompt below in place, and delete a prompt you have answered._

## The capability

_What would it do? Two or three paragraphs is enough: the behaviour someone would see, and the gap in
the foundation it answers. Say whether it adds something new or changes something that exists, and
name every fixed interface it would touch. A status code, a decision shape, a pass rule, a label, the
membership of the append-only set and the API contract are fixed by the documents that own them, so a
proposal that would change one is a decision to raise in the issue rather than a choice to fold into a
feature change._

## Why it belongs in the foundation

_Who does it make the product better for, and what does it let them do that they cannot do today? Name
the roles it serves — developer, buyer, community contributor or operator. What a capability must not
do is worth saying here too: it must not let a fee, a sponsorship or any commercial value reach a
score, a report, a badge or the organic ordering of a listing; it must not make a simulated surface
read as real; and it must not widen what a report or a badge claims, because buying an evaluation
never guarantees a pass and outcomes depend on test evidence only._

## Which module it touches

_Which workspace changes, and which one owns the behaviour? The foundation is `apps/web` (presentation
only; `apps/web/src/api-client.ts` is the only module that calls the API), `apps/api` (the HTTP
surface, the composition root, and the only workspace that opens the database), `packages/shared`
(types, constants, JSON schemas and the ordered migrations), `packages/sgi-core` (standards, scoring,
reports, governance and the extension seams), `packages/sgi-fixtures` (the read-only fixture pack),
`packages/shield` (the standalone policy package), `packages/commerce-sim` (offers, the simulated
checkout, the ledgers and refunds), `examples/extension-fixture-pack`, `docs/` and `scripts/`. Two
boundary rules settle most proposals: `packages/sgi-core` never imports `packages/commerce-sim`,
`apps/api` or any sponsorship data, so no commercial value can reach a measurement by any code path;
and `packages/shield` depends on no other workspace at all, which is what keeps it adoptable on its
own. A proposal that would need either edge is a proposal to change the architecture, and should say
so plainly. Import a workspace by its package name and never by a path inside it: each workspace
exposes exactly one `index.ts`, and that file is the whole contract._

## How it would be verified

_Which command would prove it done, and which observable result would show it? A pure function is
proven by a unit test beside its source, named `<name>.test.ts` and run with `npm run test:unit`
narrowed by a path where that helps, as in `npm run test:unit -- packages/shield`. A route is proven
by an integration test under `apps/api/test/integration/`, run with `npm run test:integration`, and a
new or changed route also carries its JSON schema in `packages/shared/src/schemas/` and a test for
every status the contract documents for it, error cases included. A behaviour only a browser can show
— a page, a form, a rendered label, a keyboard path — is proven by a spec in `e2e/`, run with
`npm run test:e2e`, and anything that renders is checked with `npm run test:a11y` for accessibility
and responsiveness at 1280 px and 360 px. A change to the scan's own rules, to a manifest or to the
licence allowlist is proven by the check that owns it: `npm run scan:exclusions` for the scan and
`npm run deps:report` for the dependency set. Two facts follow
from how the suite is built. `apps/web` has no DOM test environment in the closed dependency
inventory, so its unit tests cover pure functions only and its rendering is proven in the browser. And
nothing in the scoring, policy or ledger path may read a clock, a locale, a timezone, a random source
or the network, because a result has to be reproducible from the fixed fixtures and the versioned
criteria alone. A capability that cannot be verified one of these ways is a proposal whose evidence
has not been designed yet: say what would prove it, or say that you would like help designing it._

## Does it need a new dependency?

- [ ] No new dependency: the capability is built from the standard library and the packages already
      installed.
- [ ] A new package is needed, and this proposal gives its exact registry version, its licence and its
      purpose.

_The inventory is closed, and adding a package is a change of five parts. First, the inventory entry,
with the exact registry version, the licence and the purpose. Second, that exact version string in the
manifest — no caret, no tilde, no range. Third, a licence inside the allowlist the gate applies, which
is the data in `scripts/license-allowlist.json`: read that file rather than any summary of it, because
it is the list the gate applies, and widening it is a reviewable diff. Its always-allowed set is MIT,
ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD, and MPL-2.0 is permitted for development-only
dependencies — such a licence must never appear in a runtime graph, because one permitted for
development alone is not one that may be distributed. Fourth, a purpose record so the generated
report can answer for the package. Fifth, a regenerated report: `npm run deps:report` rewrites
`docs/DEPENDENCIES.md` from the dependency graph `package-lock.json` resolves and exits non-zero on
a licence outside the allowlist, and the regenerated document is committed with the manifest change.
Install at the repository root, never inside a workspace, and never hand-edit `package-lock.json`.
Three classes of package cannot be added at all, whatever their licence: a payment provider's
library, an analytics or tracking SDK, and an advertising SDK._

## Hard exclusions that decline a request at the source

_These are boundaries the project will not implement in this work — not preferences, not omissions,
and not capabilities that might arrive later. They are held where a request enters, so a capability
resting on one is declined in the issue rather than discovered in review. A request that rests on
buying a better outcome, or that would widen a report's label vocabulary beyond `SAMPLE` and
`VERIFIED-IN-DEMO`, is declined for the same reason: criteria and labels are independent of who pays._

- **Real payments, payouts, settlement or bank connections.** No money movement is permitted, so a
  money path is refused and a payment provider's name may not appear anywhere; the commerce surfaces
  stay provider-neutral simulations of the synthetic currency `DEMO`.
- **Production authentication, real user accounts or sensitive personal data.** Unapproved: the
  accounts are synthetic and the write header is a role selector rather than authentication, so real
  credentials or personal data would breach the prohibition on both.
- **Execution of submitted third-party agent code, or a production sandbox.** Unsafe until isolation
  is separately reviewed: a candidate is a declarative submission compared as data on fixtures, and
  nothing submitted is executed.
- **Paid live advertising, personalised ad profiling or any ad tracking.** No real ads and no
  tracking: the privacy limit is aggregate local counters at most, and a sponsor slot is a limited,
  labelled demonstration rather than a campaign.
- **Advanced agent orchestration, live rentals and deployments.** Outside the foundation: they would
  need external services, and nothing in the product calls an external network service.
- **Enterprise compliance and external connectors.** Outside the foundation: they would need accounts,
  data flows and legal review that these boundaries exclude.
- **Automated standards governance without human oversight.** Trust requires human review: a case set,
  a severity, a threshold or the pass rule changes only through a reviewed proposal that publishes a
  new standard version, never by an edit.
- **A public campaign for ADEM Shield Basic.** Not approved: no campaign copy or branding is
  generated, and ADEM Shield Basic is not a gate pass, a certification or a security guarantee.
- **Deployment, announcements and outreach.** Separate approval is needed: no workflow deploys, no
  release is announced and no hosting provider is referenced.

_If your idea falls under one of these, the honest answer is that it is out of scope for this
repository rather than something to wait for._

## Where to start instead

_`docs/starter-tasks/` holds twelve labeled briefs, each with a title, a scope and an acceptance note,
sized for a first contribution and mapped to the extension seams and the documentation rather than to
the core. One of them may already be the change you have in mind._

- **The seams are the designed growth path.** `FixturePack`, `EvaluatorCheck` and `ListingCategory`,
  with the registry that resolves them, are exported from `packages/sgi-core`'s single public entry.
  Adding a fixture pack, an evaluator check or a listing category **must not** require editing that
  package's scoring code, and `examples/extension-fixture-pack/` is the worked proof: one pack, its
  case set, its own tests, and an empty diff against `packages/sgi-core/src/scoring/` for the change
  that adds it.
- **`docs/ROADMAP.md` places a capability.** The milestones run M1 the foundation builds, M2 exchange
  discovery, M3 the Standard Gate Index and the deterministic evaluator, M4 collaboration and ADEM
  Shield Basic, M5 participation and the commerce simulation, and M6 release readiness, and each
  milestone names the command that proves it done. The tiers are P0 for exchange discovery, the
  Standard Gate Index, the deterministic evaluator and the sample badges; P1 for ADEM Shield Basic,
  buyer challenges, collaboration, contributor documents and the extension seams; and P2 for the
  Academy, the opportunity index, the sponsor slot and the commerce and fee ledgers. When the line
  budget is at risk, optional work is removed from the lowest tier upward — Participation first, then
  Commerce simulation, then P1 items from the example extension inward — and a lower-tier capability
  never displaces a higher-tier one. **P0 is never cut.**
- **You keep your rights.** The project is MIT-licensed, and contributing does not force you to
  disclose your own source code. What a contributed extension declares is its own licence and its
  attribution, as `examples/extension-fixture-pack/LICENSE` and
  `examples/extension-fixture-pack/ATTRIBUTION.md` do.
