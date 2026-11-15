# Let the operator filter one ledger's entries in the view

Labels: P2, good-first-issue, milestone M5

## Scope

The operator reads three append-only ledgers through `apps/api/src/routes/ledgers.ts`:
`GET /api/v1/ledger/marketplace`, `GET /api/v1/ledger/gate-fees` and
`GET /api/v1/ledger/founder-allocation`. Each answers `200` with that ledger's entries **in insertion
order**, and the founder-allocation read also states the `rate_basis_points` its recorded entries
carry. Each is an operator-only read: the demo account the `X-Demo-Account` header names must hold the
operator role, so a resolvable account of any other role is answered `403`, and an absent or
unresolvable header is answered `401`. `apps/web/src/components/ledger-table.tsx` renders what those
reads returned, in the order received — one block per entry carrying its entry type, its direction,
its `amount_minor_units` beside the entry's own `currency_label` and `disclosure_label`, its
description, and the `transaction_id` or `report_id` it references — and, for the founder-allocation
ledger, the `rate_basis_points` from the read and the `to be determined` statement about that
ledger's contract structure. The page that owns the three reads and renders every ledger through it
is the operator half of `apps/web/src/pages/developer.tsx`. A ledger that has been open for a while is
a long list, and an operator looking at one transaction's effect currently reads the whole of it: your
task is a filter that narrows the rows already on screen.

**Put the filter in the view, and nowhere else.** The control belongs in `ledger-table.tsx`, over the
rows it was handed — by entry type, by direction or by the amount, or by the rate the founder-
allocation ledger states — plus the operator half of `developer.tsx` if the ledger selection needs it.
The three paths, their roles and their statuses are rows of the published API contract, so **do not
add a query parameter, a filter field or a status to `apps/api/src/routes/ledgers.ts`**: a parameter
on one of them is a contract change, and it belongs in a plan revision with the contract table, the
request schemas and the route-walk suite moved together, rather than in a first contribution. The API
stays a pure read — no write, no transaction, no arithmetic, no aggregation and no re-sorting — and a
narrowed view is never a second read.

**The store is append-only, and the filter must respect it.** `ledger_entries` is one of the nine
append-only tables, guard-railed by the `RAISE(ABORT)` triggers
`packages/shared/migrations/0010_append_only_triggers.sql` creates on it: it accepts a new row and
nothing else, no route updates or deletes it, and there is no update or delete to add. Your filter
must not re-sort, rewrite, merge or mutate an entry, must not recompute an amount, and must not
recompute the founder rate from the live commerce configuration — that rate is read back out of the
stored entries' own descriptions, which is the rate those entries were computed from, so a later
configuration change never retroactively alters what an entry already appended says about itself.
Never edit a migration: an applied migration is immutable, and its recorded checksum is what stops the
server from starting when one changes.

**Labels, wording and the vocabulary.** Every amount stays an integer count of minor units of the
synthetic currency `DEMO`, rendered with the entry's own currency and disclosure labels and never with
a real currency code or a currency symbol. The founder-allocation view keeps its `to be determined`
statement and still carries no personal identity, beneficiary account or entitlement — the allocation
is a provisional simulated share, not equity, not an entitlement and not payable. The demo-session
label `demo only, no production authentication` and the sponsored label `Sponsored` are unchanged
wherever they appear. A filter is a way to read the record, never a way to change what it says.

**The control, and the accessibility it needs.** Your filter is a real, labelled form control — a
`label` element naming it, not a placeholder — reachable by keyboard and operable with it, with a
visible focus state, and the change of result is announced in a polite live region, so a screen-reader
user is told the view narrowed instead of discovering it. One reason this view renders per-entry
label/value blocks rather than one wide table is that every value stays beside the label naming it at
360 px, and a filter must not undo that: the ledger still does not scroll horizontally at that width.
A filter matching nothing is a state rather than a failure, and it renders the explanatory empty state
`apps/web/src/components/empty-state.tsx` provides.

**Your test, if you can reach it without a browser.** `apps/web` has no DOM test environment in the
closed dependency inventory, so a unit test covers pure functions only: keep the narrowing in a pure
function beside the component, and assert what each filter value keeps and drops, that two filters
compose, and what a combination matching nothing yields.

Read next: `CONTRIBUTING.md` and `docs/ROADMAP.md`. The table the three reads filter on is declared in
`packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql`.

## Acceptance

Every command runs from the repository root, and `npm run typecheck` stays the static gate.

1. `npm run test:integration -- --testNamePattern=ledger` exits 0 unchanged: the three reads still
   answer `200`, `403` and `401` exactly as documented, the founder-allocation read still states each
   entry's own rate, a `PUT`, `PATCH` or `DELETE` against a ledger path is still answered with the
   single `{ "error": { "code", "message" } }` envelope and `404`, and a `ledger_entries` snapshot
   compared before and after the run is byte-identical.
2. `npm run test:a11y` exits 0 at both audited widths — it audits the homepage, a listing page, a
   comparison and a report — and the operator ledger view you changed shows no horizontal scroll at
   360 px.
3. Observable, by hand as the operator: filtering by the field you chose leaves only the matching rows
   visible, while the unfiltered view still shows every entry in the order the API returned it; the
   unfiltered view's entry count, and each entry's amount, reference and labels, are unchanged by
   filtering; and the founder-allocation view still carries its `to be determined` statement.
4. No contract change: `npm run test:integration -- --testNamePattern="route walk"` exits 0, and
   `apps/api/src/routes/ledgers.ts` has gained no query parameter and no new status —
   `git diff --stat -- apps/api/src/routes/ledgers.ts` prints nothing.
5. `git diff --stat -- packages/shared/migrations` prints nothing.
6. `npm run test:unit -- apps/web` exits 0 with your pure-function test included, and
   `npm run scan:exclusions` exits 0 with an empty finding list.
