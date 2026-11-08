# Let the operator filter one ledger's entries in the view

Labels: P2, good-first-issue, milestone M5

## Scope

The operator reads three append-only ledgers: the marketplace ledger, the gate-evaluation-fee ledger
and the founder-participation allocation ledger. A ledger that has been open for a while is a long
list, and an operator looking at one transaction's effect currently reads the whole of it. Your task
is a filter in the **view**, so an operator can narrow the rows already returned to the entry types
and to the reference that concerns them, without touching the three reads themselves.

You write two things and nothing else.

1. **The filter in the rendered table.** `apps/web/src/components/ledger-table.tsx` renders one
   ledger's entries; give it a control that narrows what it shows — by entry type, and by the
   reference an entry carries (the transaction or the report it belongs to) — driven by the page's own
   state. `apps/web/src/pages/developer.tsx` and the pages that render the operator views keep the
   data they already fetch: this change filters what is on screen, and the ledger route's response is
   not fetched again with different parameters.
2. **Its test, if you can reach it without a browser.** `apps/web` has no DOM test environment in the
   dependency inventory, so a unit test covers pure functions only: if you extract the narrowing into
   a pure function beside the component, a test beside it asserts what each filter keeps and drops,
   including the empty result - a filter that matches nothing renders the explanatory empty state
   rather than an empty table.

**Why the three reads are not the place to add this.** `GET /ledger/marketplace`,
`GET /ledger/gate-fees` and `GET /ledger/founder-allocation` are three rows of the API contract
table, each with its documented success and its `403` for a resolvable non-operator account. A query
parameter on one of them is a contract change — it belongs in a plan revision with the contract table
updated, the route-walk suite extended and the schema changed together — and not in a starter task
whose whole point is a small, reviewable contribution.

**What must not change, and what not to imply.** Nothing in the view may write, correct or reorder a
ledger entry: the three ledgers are append-only, a refund appends a reversal rather than editing an
entry, and the operator's power over the record is additive. The founder-participation allocation is
a provisional, configurable share of an eligible simulated marketplace transaction — it is not equity,
not entitlement and not payable, and every amount is an integer number of minor units of the synthetic
currency `DEMO` with no real currency code and no currency symbol. The view keeps labelling the
contract structure `to be determined` and keeps carrying no personal identity, beneficiary account or
entitlement. A filter is a way to read the record, never a way to change it.

Read next: `apps/web/src/components/ledger-table.tsx`; `apps/api/src/routes/ledgers.ts` for the three
reads and the one table they filter on `ledger_entries`'s `ledger` column;
`packages/commerce-sim/src/ledgers/ledger-types.ts` for the entry types a row can carry;
`apps/web/src/components/empty-state.tsx` for the explanatory state; `docs/SCHEMA.md` for the
`ledger_entries` table.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- apps/web` exits 0 with any pure-function test you add included, and it
   asserts the narrowing rather than describing it: each filter value keeps exactly the entries it
   names, the two filters compose, and a combination that matches nothing yields an empty list rather
   than an exception.
3. `npm run build` exits 0 and the view is observable: with a seeded database, an operator account
   opens a ledger, applies the filter by entry type and by reference, and sees only the matching rows
   — including a transaction's reversal entries after a refund — with a screenshot or the rendered
   rows in the pull-request description.
4. The empty state is real rather than implied: a filter that matches nothing renders the explanatory
   empty state, and the same page renders the founder-allocation ledger's `to be determined` note
   whichever filter is applied.
5. `npm run test:integration -- --testNamePattern=ledger` exits 0 unchanged: no ledger entry is
   written, edited or deleted by this change, and the three reads keep their documented statuses.
   `git diff --stat -- apps/api/src/routes/ledgers.ts packages/commerce-sim` prints nothing.
6. `npm run scan:exclusions` exits 0 with an empty finding list.
