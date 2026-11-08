/**
 * Criterion 6 through the routes: the simulated commerce arithmetic as the API records it, and the
 * three operator-only ledger reads that expose it.
 *
 * **What it evidences.** With the product's default configuration, an eligible completed simulated
 * marketplace transaction of ten thousand minor units produces a founder allocation of twenty-five;
 * a full refund appends a reversal that brings that transaction's net allocation to zero; a partial
 * refund of four thousand reverses ten; a completed run records one flat gate fee and no allocation;
 * a changed configuration moves both numbers; and no ledger entry can be modified.
 *
 * **Why it runs through the routes.** Criterion 6 is stated as an outcome of the built product, and
 * the routes perform none of the arithmetic: they hand the resolved configuration to
 * `@adem/commerce-sim` and answer with the rows the domain wrote. Every amount asserted below is
 * therefore read back from a stored row or from the response a route produced, and the suite
 * re-derives nothing — the only computation it makes is the sum of a transaction's own
 * founder-allocation rows, which is what "net" means here and is the same sum any reader of a ledger
 * makes. An expectation like `25` is not a rate applied by this file: it is the amount the allocation
 * row holds, and the comment beside it traces it to the product's single rounding point
 * (`packages/commerce-sim/src/ledgers/allocate.ts`) and to the fictional price the checkout route
 * fixes for a `purchase` (`apps/api/src/routes/checkout.ts`).
 *
 * **The rate is read out of the row that states it.** A founder-allocation entry carries, in its own
 * `description`, the basis-point rate its amount was computed from, and that stored text is the
 * durable record of the rate: the row is append-only, it is never recomputed, and a later
 * configuration change must not retroactively alter what an existing entry says about itself. The
 * assertions below therefore read the rate from the entry — and from the read's own
 * `rate_basis_points`, which `apps/api/src/routes/ledgers.ts` derives from those same stored
 * sentences rather than from today's configuration — instead of comparing an entry against whatever
 * the configuration happens to hold when a case runs.
 *
 * **Every count is a delta.** A freshly seeded database already holds three gate-fee entries of
 * fifteen thousand minor units, one per seeded fixture candidate, so no assertion here depends on an
 * absolute row count: each one captures what the ledger held before a write and asserts what that
 * write added.
 *
 * **What it deliberately does not repeat.** The plain status walk over the refund row's `409` and
 * `422` belongs to `./route-walk.test.ts`, and the deep append-only proof for `ledger_entries`,
 * `transactions` and `refunds` — an attempted update or delete of a stored row through every route
 * that exists — belongs to `./immutability.test.ts`. This file measures the arithmetic, and its own
 * mutation case asserts the one thing the walk does not cover: that the three operator reads register
 * no method beyond the `GET` the contract lists, so a `PUT`, `PATCH` or `DELETE` on them is answered
 * as the unregistered method it is and leaves every stored row exactly as it was.
 *
 * **No identifier is written here.** The listing, its version, the transaction identifiers, the
 * report identifier and every ledger row come from a response or from a query, so the suite runs
 * against whatever the seed holds rather than against a copy of the seed's values.
 *
 * **Nothing here reads the environment, names a currency symbol or asserts anything beyond the
 * ledger.** Every amount is a whole number of minor units of the synthetic currency label, the
 * disclosure label travels with every row, and no case states or implies that a simulated purchase
 * buys an evaluation outcome, a certification or a guarantee of any kind.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  EvaluationReportDetail,
  EvaluationSubmission,
  FounderAllocationLedgerReadResult,
  LedgerEntry,
  LedgerName,
  LedgerReadResult,
  ListingDetail,
  ListingSearchResult,
  RecordedOutput,
  Refund,
  Transaction,
} from "@adem/shared";
import { SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";

import {
  DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
  DEFAULT_GATE_FEE_MINOR_UNITS,
} from "@adem/commerce-sim";

import { SGI_SO_1_0_0, canonicalize, getStandardCaseSet } from "@adem/sgi-core";

import type { ApiErrorCode } from "../../src/errors/error-codes";
import type { ErrorEnvelope } from "../../src/errors/error-envelope";
import { startTestServer } from "./test-server";
import type { TestResponse, TestServer } from "./test-server";

/**
 * The one price a simulated `purchase` is made at: ten thousand minor units, fixed by the checkout
 * route's own fictional price table.
 *
 * It is asserted rather than assumed, because the amount of a simulated purchase is not a client
 * input — `POST /checkout-simulations` carries a listing, a version and an offer model and no amount
 * — so the figure a ledger row is computed from has to be read back from the response the route
 * answers with.
 */
const PURCHASE_AMOUNT_MINOR_UNITS = 10000;

/**
 * The allocation a ten-thousand-unit transaction produces at the default rate: the product's single
 * rounding point applied exactly, `10000 * 25 / 10000 = 25`, with no fraction to resolve.
 */
const DEFAULT_PURCHASE_ALLOCATION_MINOR_UNITS = 25;

/**
 * The refunded part of a second transaction, and the allocation its reversal corrects:
 * `4000 * 25 / 10000 = 10`, again exact.
 */
const PARTIAL_REFUND_MINOR_UNITS = 4000;
const PARTIAL_REFUND_REVERSAL_MINOR_UNITS = 10;

/** What the partially refunded transaction has left to refund: `10000 - 4000`. */
const NET_REMAINING_AFTER_PARTIAL_REFUND_MINOR_UNITS = 6000;

/** One minor unit past that net remaining, which is the eligibility boundary this suite asserts. */
const AMOUNT_PAST_NET_REMAINING_MINOR_UNITS = NET_REMAINING_AFTER_PARTIAL_REFUND_MINOR_UNITS + 1;

/** The flat fee and the allocation rate a second server is started with: both are configurable fiction. */
const OVERRIDE_GATE_FEE_MINOR_UNITS = 20000;
const OVERRIDE_ALLOCATION_RATE_BASIS_POINTS = 100;

/** The allocation the override rate gives the same ten-thousand-unit purchase: `10000 * 100 / 10000`. */
const OVERRIDE_PURCHASE_ALLOCATION_MINOR_UNITS = 100;

/** The path a simulated checkout is posted to, prefix-relative as the harness expects it. */
const CHECKOUT_PATH = "/checkout-simulations";

/** The path an operator's refund is posted to, prefix-relative, with the transaction as a path segment. */
const refundsPath = (transactionId: string): string => `/transactions/${transactionId}/refunds`;

/** The three operator reads, each paired with the `ledger` discriminator it filters on. */
const LEDGER_READS: readonly { readonly path: string; readonly ledger: LedgerName }[] = Object.freeze([
  Object.freeze({ path: "/ledger/marketplace", ledger: "marketplace" }),
  Object.freeze({ path: "/ledger/gate-fees", ledger: "gate_fees" }),
  Object.freeze({ path: "/ledger/founder-allocation", ledger: "founder_allocation" }),
]);

/**
 * The eleven fields one `ledger_entries` row carries, and therefore the whole of what any of the
 * three reads may hand a client.
 *
 * Asserted as an exact key set rather than field by field, because the claim it guards is an absence:
 * a founder-allocation entry carries no personal identity, no beneficiary account and no entitlement,
 * and the contract structure it belongs to is labelled "to be determined" (`FOUNDER_ALLOCATION_
 * CONTRACT_LABEL` in `@adem/shared`) exactly because it is provisional. A field added to a payload
 * would fail here, which is the point.
 */
const LEDGER_ENTRY_FIELDS: readonly string[] = Object.freeze([
  "amount_minor_units",
  "created_at",
  "currency_label",
  "description",
  "direction",
  "disclosure_label",
  "entry_type",
  "id",
  "ledger",
  "report_id",
  "transaction_id",
]);

/** The whole of `ledger_entries`, in insertion order, canonicalised as the before-and-after snapshot. */
const LEDGER_ENTRY_SNAPSHOT_SQL = "SELECT * FROM ledger_entries ORDER BY rowid ASC";

/**
 * The stored rows of one ledger in the order the contract documents: ascending instant, and the
 * table's own `rowid` as the tie-break for two rows appended within the same millisecond.
 */
const STORED_LEDGER_ORDER_SQL =
  "SELECT id FROM ledger_entries WHERE ledger = ? ORDER BY created_at ASC, rowid ASC";

/** How many rows one ledger holds, read as a delta around a write. */
const COUNT_BY_LEDGER_SQL = "SELECT COUNT(*) AS total FROM ledger_entries WHERE ledger = ?";

/** One transaction's founder-allocation rows, in insertion order: its allocation and its reversals. */
const FOUNDER_ROWS_FOR_TRANSACTION_SQL =
  "SELECT * FROM ledger_entries WHERE ledger = 'founder_allocation' AND transaction_id = ? ORDER BY rowid ASC";

/** How many refund rows one transaction carries, read as a delta around a refused refund. */
const COUNT_REFUNDS_FOR_TRANSACTION_SQL =
  "SELECT COUNT(*) AS total FROM refunds WHERE transaction_id = ?";

/** One report's gate-fee rows: the flat fee a completed run appends, and nothing else. */
const GATE_FEE_ROWS_FOR_REPORT_SQL =
  "SELECT * FROM ledger_entries WHERE ledger = 'gate_fees' AND report_id = ? ORDER BY rowid ASC";

/** Every gate-fee row the database holds, in insertion order: what makes the fee's flatness checkable. */
const ALL_GATE_FEE_ROWS_SQL =
  "SELECT * FROM ledger_entries WHERE ledger = 'gate_fees' ORDER BY rowid ASC";

/** One report's founder-allocation rows, which must stay empty: a fee is never eligible to allocate. */
const ALLOCATION_ROWS_FOR_REPORT_SQL =
  "SELECT * FROM ledger_entries WHERE ledger = 'founder_allocation' AND report_id = ? ORDER BY rowid ASC";

/** The one-column shape a `COUNT(*)` read answers with. */
interface CountRow {
  /** The count the statement returned. */
  readonly total: number;
}

/**
 * The `201` body of the operator's refund write: the two reversal entries it appended, in write
 * order, and the `refunds` row itself.
 *
 * Declared here rather than imported because the route that builds it keeps its own result interface
 * module-local, which is the same reason `./boundary-check` and the other suites describe a payload
 * by the fields the contract states instead of reaching into a route's declarations.
 */
interface RefundReversalBody {
  readonly entries: LedgerEntry[];
  readonly refund: Refund;
}

/**
 * One seeded listing that makes a `purchase` offer, paired with one of its versions that claims it.
 *
 * Both identifiers are resolved from responses, so the suite needs no copy of the seed's values: the
 * listing comes from the public search filtered on the model, and the version from the claim the
 * listing's detail payload carries for that same model — which is also the claim the checkout route
 * reads to build the offers it hands the domain.
 */
interface PurchaseFixture {
  readonly listingId: string;
  readonly listingVersionId: string;
}

/**
 * Asserts that a response is the contract's single failure body, with the given status and code.
 *
 * The shape is checked as strictly as the contract states it: one `error` member, exactly `code` and
 * `message` inside it, and a non-empty sentence, so a refusal that leaked a stack line, a status code
 * or a second detail member fails here rather than passing as "an error object".
 */
function expectFailure(response: TestResponse, status: number, code: ApiErrorCode): void {
  expect(response.status).toBe(status);

  const body = response.json<ErrorEnvelope>();
  expect(Object.keys(body)).toStrictEqual(["error"]);
  expect(Object.keys(body.error)).toStrictEqual(["code", "message"]);
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
}

/**
 * One scalar the harness's own connection answers: a `COUNT(*)` or any other single-column read.
 *
 * Counts are always taken as a difference around a write, never as an absolute, because the seeded
 * database already holds three gate-fee entries and a suite that asserted "three" would be asserting
 * the seed rather than the route.
 */
function scalarOf(server: TestServer, sql: string, ...params: readonly unknown[]): number {
  const rows = server.query<CountRow>(sql, ...params);

  return rows[0]?.total ?? 0;
}

/** How many rows one ledger holds right now, read through the harness's own connection. */
function ledgerEntryCount(server: TestServer, ledger: LedgerName): number {
  return scalarOf(server, COUNT_BY_LEDGER_SQL, ledger);
}

/** How many refund rows one transaction carries right now. */
function refundCountOf(server: TestServer, transactionId: string): number {
  return scalarOf(server, COUNT_REFUNDS_FOR_TRANSACTION_SQL, transactionId);
}

/** One transaction's founder-allocation rows, in insertion order. */
function founderRowsOf(server: TestServer, transactionId: string): LedgerEntry[] {
  return server.query<LedgerEntry>(FOUNDER_ROWS_FOR_TRANSACTION_SQL, transactionId);
}

/**
 * One transaction's net allocation, as the sum of the rows the ledger holds for it: the allocations
 * it carries minus the reversals a refund appended.
 *
 * The figure is never re-derived from the rate — a rate applied a second time here would be a second
 * implementation of the arithmetic under test — and `direction` is deliberately not read as the sign
 * of an amount, because it is not: `entry_type` says what a row is and every amount stays a
 * non-negative count of minor units.
 */
function netAllocationMinorUnits(server: TestServer, transactionId: string): number {
  let net = 0;

  for (const entry of founderRowsOf(server, transactionId)) {
    if (entry.entry_type === "allocation") {
      net += entry.amount_minor_units;
    } else if (entry.entry_type === "reversal") {
      net -= entry.amount_minor_units;
    } else {
      throw new Error(
        `the founder-allocation ledger holds a "${entry.entry_type}" entry for one transaction, and only an allocation or a reversal belongs there`,
      );
    }
  }

  return net;
}

/**
 * The rate a stored entry states about itself, read out of its own `description`, or `null` when it
 * states none.
 *
 * This is a reading and not a computation: the digits are taken from the text the ledger's writer put
 * there — `Simulated founder allocation of a completed marketplace transaction at 25 basis points`
 * and its reversal twin — and nothing is scaled, rounded or compared against a configuration. It is
 * used only for rows whose history this suite did not create, such as the rows a seed wrote; every
 * entry this suite appends is asserted against the whole sentence instead.
 */
function statedRateBasisPoints(entry: LedgerEntry): number | null {
  const digits = /([0-9]+) basis points/.exec(entry.description)?.[1];

  if (digits === undefined) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** The sentence the allocation writer records, with the rate its amount was computed from. */
function allocationDescription(rateBasisPoints: number): string {
  return `Simulated founder allocation of a completed marketplace transaction at ${String(rateBasisPoints)} basis points`;
}

/** The sentence the refund path records on the founder-allocation reversal it appends. */
function allocationReversalDescription(rateBasisPoints: number, transactionId: string): string {
  return `Simulated refund reversal of the founder allocation computed at ${String(rateBasisPoints)} basis points for transaction ${transactionId}`;
}

/**
 * Asserts the properties every entry any of the three reads answers with carries, whatever its ledger:
 * the eleven fields and no more, a non-negative whole number of minor units of the synthetic label,
 * the disclosure label beside the amount, and exactly one of the two references populated.
 */
function expectLedgerEntryShape(entry: LedgerEntry, ledger: LedgerName): void {
  expect(entry.ledger).toBe(ledger);
  expect(Object.keys(entry).sort()).toStrictEqual([...LEDGER_ENTRY_FIELDS].sort());

  // An amount is an integer count of minor units of the one synthetic label: never a fraction, never
  // a negative, never a real currency code and never a currency symbol.
  expect(Number.isSafeInteger(entry.amount_minor_units)).toBe(true);
  expect(entry.amount_minor_units).toBeGreaterThanOrEqual(0);
  expect(entry.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
  expect(entry.disclosure_label.length).toBeGreaterThan(0);

  // A row references a transaction or a report and never both, which is the pairing the migration's
  // own CHECK keeps apart: a fee names the evaluation it was charged for, a marketplace row names the
  // simulated transaction it belongs to.
  expect(entry.transaction_id === null || entry.report_id === null).toBe(true);
}

/**
 * Resolves the seeded listing this suite checks out, through the routes alone.
 *
 * The search is filtered on the model so that the answer is a listing that makes a `purchase` offer,
 * and the version is the one its own claim states the offer for. Nothing is hard-coded and nothing is
 * read from the seed's data module: the suite runs against whatever the database holds.
 *
 * @throws {Error} When the seeded database holds no purchase listing, or none whose claims record the
 *   model — a defect in the fixture data rather than an outcome of the product.
 */
async function resolvePurchaseFixture(server: TestServer): Promise<PurchaseFixture> {
  const search = await server.get("/listings", { query: { model: "purchase", page: 1 } });
  expect(search.status).toBe(200);

  const listing = search.json<ListingSearchResult>().items[0];

  if (listing === undefined) {
    throw new Error(
      "the seeded database holds no listing whose pricing model is purchase, so this suite has nothing to check out",
    );
  }

  expect(listing.pricing_model).toBe("purchase");

  const detailResponse = await server.get(`/listings/${listing.id}`);
  expect(detailResponse.status).toBe(200);

  const detail = detailResponse.json<ListingDetail>();
  const purchaseClaim = detail.claims.find((claim) => claim.pricing_model === "purchase");

  if (purchaseClaim === undefined) {
    throw new Error(
      `the seeded listing ${detail.id} makes no purchase claim, so its offers do not include the model this suite checks out`,
    );
  }

  // The detail payload's own offer set is what the checkout panel would validate a selection against,
  // so it is asserted here as the second, independent statement that this version carries the offer.
  expect(detail.offer_models).toContain("purchase");

  return { listingId: detail.id, listingVersionId: purchaseClaim.listing_version_id };
}

/**
 * Runs one simulated purchase as the buyer and answers with the stored transaction.
 *
 * The body carries the three fields the contract lists and no amount: the price of a simulated
 * purchase is the route's fictional table and is never a client input, which is why the amount is
 * asserted from the response rather than sent with the request.
 */
async function checkoutPurchase(
  server: TestServer,
  fixture: PurchaseFixture,
): Promise<Transaction> {
  const response = await server.post(
    CHECKOUT_PATH,
    {
      listing_id: fixture.listingId,
      listing_version_id: fixture.listingVersionId,
      offer_model: "purchase",
    },
    { account: server.accountForRole("buyer") },
  );

  expect(response.status).toBe(201);

  return response.json<Transaction>();
}

/** Posts one operator refund of the given amount and answers with the response, whatever its status. */
async function refund(
  server: TestServer,
  transactionId: string,
  amountMinorUnits: number,
): Promise<TestResponse> {
  return server.post(
    refundsPath(transactionId),
    { amount_minor_units: amountMinorUnits },
    { account: server.accountForRole("operator") },
  );
}

/**
 * Builds the declarative submission this suite completes one run with: every fixture case of the
 * versioned case set, each recorded with that case's own expected output, which is the shape the
 * fixture pack's passing candidate carries.
 *
 * The case set is read through `@adem/sgi-core`'s loader rather than from the fixture package, which
 * this workspace does not depend on and must not import. Nothing is executed: a submission is data
 * compared as canonical JSON, by the domain package, on the other side of the route.
 */
function passingSubmission(server: TestServer, candidateVersionId: string): EvaluationSubmission {
  const caseSet = getStandardCaseSet(server.database, SGI_SO_1_0_0.versionLabel);

  return {
    candidate_version_id: candidateVersionId,
    standard_version_id: SGI_SO_1_0_0.versionLabel,
    recorded_outputs: caseSet.cases.map(
      (fixtureCase): RecordedOutput => ({
        case_id: fixtureCase.id,
        output: fixtureCase.expected_output,
      }),
    ),
  };
}

/**
 * One `ledger_entries` row as an untyped snapshot: whatever `SELECT *` returned, told only that its
 * columns are JSON scalars.
 *
 * It is a type alias with an index signature rather than the eleven-field `LedgerEntry` interface
 * because `canonicalize` takes a JSON value, and a value type with an index signature is the shape
 * that says "these columns are JSON data" without claiming which columns exist — which is exactly
 * what a snapshot must not claim, since it exists to notice a row that changed.
 */
type LedgerSnapshotRow = { readonly [column: string]: string | number | null };

/** The canonical text of every ledger row the database holds, for a before-and-after comparison. */
function ledgerSnapshot(server: TestServer): string {
  // The canonical form is what makes the comparison byte-for-byte: two reads of an unchanged table
  // render identically, whatever order SQLite handed the columns in.
  return canonicalize(server.query<LedgerSnapshotRow>(LEDGER_ENTRY_SNAPSHOT_SQL));
}

/**
 * Criterion 6 in one suite: the three operator reads, the allocation and reversal arithmetic a
 * simulated checkout and refund produce, the flat fee a completed run records, a changed
 * configuration, and the impossibility of modifying a stored row.
 *
 * One harness server carries the default-configuration cases, and the changed-configuration block
 * starts a second one of its own and closes it in its own teardown, so the two configurations are
 * compared from two databases rather than by reconfiguring one under the first suite's feet.
 */
describe("the operator ledger reads and the simulated commerce arithmetic", () => {
  let server: TestServer;
  let purchase: PurchaseFixture;

  beforeAll(async () => {
    server = await startTestServer();
    purchase = await resolvePurchaseFixture(server);
  });

  afterAll(async () => {
    await server.close();
  });

  describe("the three operator reads", () => {
    it("answers each ledger in insertion order", async () => {
      const operator = server.accountForRole("operator");

      for (const { path, ledger } of LEDGER_READS) {
        const response = await server.get(path, { account: operator });

        expect(response.status).toBe(200);

        const body = response.json<LedgerReadResult>();
        expect(body.ledger).toBe(ledger);

        // Insertion order, which `created_at` alone cannot state: the domain's read orders these rows
        // by the table's own rowid, so the answer must equal the same rows ordered by the instant with
        // that counter as the tie-break. Comparing the two identifier sequences is what makes the
        // claim checkable rather than merely plausible.
        const stored = server.query<{ readonly id: string }>(STORED_LEDGER_ORDER_SQL, ledger);
        expect(body.entries.map((entry) => entry.id)).toStrictEqual(stored.map((row) => row.id));

        for (const [index, entry] of body.entries.entries()) {
          expectLedgerEntryShape(entry, ledger);

          const previous = body.entries[index - 1];
          if (previous !== undefined) {
            expect(previous.created_at <= entry.created_at).toBe(true);
          }
        }
      }
    });

    it("answers a resolvable non-operator with 403 and an absent header with 401", async () => {
      const buyer = server.accountForRole("buyer");

      for (const { path } of LEDGER_READS) {
        // A resolvable account of the wrong role: the contract's `403`, in the one failure body.
        expectFailure(await server.get(path, { account: buyer }), 403, "forbidden");

        // No header at all, which is the same `401` an unresolvable one earns. Reads are public
        // everywhere else in the contract; these three are the operator's, and nothing about them —
        // not even their emptiness — is readable without the role.
        expectFailure(await server.get(path), 401, "unauthorized");
      }
    });

    it("states the rate its founder-allocation entries were computed from, and attributes them to no one", async () => {
      const response = await server.get("/ledger/founder-allocation", {
        account: server.accountForRole("operator"),
      });

      expect(response.status).toBe(200);

      const body = response.json<FounderAllocationLedgerReadResult>();

      // The read's own members and nothing beside them: no beneficiary, no entitlement, no account, no
      // total. The founder-allocation contract structure is provisional — the UI and the docs label it
      // "to be determined" — and this payload is where that shows as an absence.
      expect(Object.keys(body).sort()).toStrictEqual(["entries", "ledger", "rate_basis_points"]);
      expect(body.ledger).toBe("founder_allocation");

      // The rate is the one the stored rows state, and a ledger holding no entry states the product's
      // own default rather than reaching for a configuration to explain a row of yesterday's.
      expect(body.rate_basis_points).toBe(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS);

      for (const entry of body.entries) {
        expectLedgerEntryShape(entry, "founder_allocation");

        // Every entry carries, in the text its writer put there, the rate its amount was computed
        // from. The stored row is the durable record of that rate, so an entry keeps stating it
        // however the configuration changes afterwards.
        expect(statedRateBasisPoints(entry)).toBe(body.rate_basis_points);
      }
    });
  });

  describe("the founder allocation a simulated purchase produces", () => {
    it("charges the fictional base amount and appends one allocation at the configured rate", async () => {
      const transaction = await checkoutPurchase(server, purchase);

      // The amount is the route's and never the client's: a purchase is priced at ten thousand minor
      // units by the checkout route's own fictional table, and the payload states the synthetic label
      // and the literal marker that keep the transaction readable as the simulation it is.
      expect(transaction.amount_minor_units).toBe(PURCHASE_AMOUNT_MINOR_UNITS);
      expect(transaction.simulated).toBe(true);
      expect(transaction.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
      expect(transaction.offer_model).toBe("purchase");
      expect(transaction.disclosure_label.length).toBeGreaterThan(0);

      const rows = founderRowsOf(server, transaction.id);

      // Exactly one allocation, produced by the product's single rounding point applied to the charged
      // amount at the default rate: 10000 * 25 basis points / 10000 = 25, with no fraction to resolve.
      expect(rows).toHaveLength(1);

      const allocation = rows[0];
      if (allocation === undefined) {
        throw new Error("the simulated checkout stored no founder-allocation row for its transaction");
      }

      expectLedgerEntryShape(allocation, "founder_allocation");
      expect(allocation.entry_type).toBe("allocation");
      expect(allocation.amount_minor_units).toBe(DEFAULT_PURCHASE_ALLOCATION_MINOR_UNITS);
      expect(allocation.transaction_id).toBe(transaction.id);

      // An allocation references a simulated transaction and never a report: the fee and the
      // allocation live in separate ledgers precisely so that nothing commercial reaches a measurement.
      expect(allocation.report_id).toBeNull();

      // The row states the rate its amount was computed from, in the writer's own sentence.
      expect(allocation.description).toBe(
        allocationDescription(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS),
      );
    });

    it("appends a proportional reversal on a full refund, bringing the net allocation to zero", async () => {
      const transaction = await checkoutPurchase(server, purchase);

      const response = await refund(server, transaction.id, PURCHASE_AMOUNT_MINOR_UNITS);
      expect(response.status).toBe(201);

      const body = response.json<RefundReversalBody>();

      // The pair a refund appends, in write order: the marketplace reversal of the charge the checkout
      // took in, then the founder-allocation reversal of the allocation that charge produced. Nothing
      // was edited — the correction is two new rows, and the rows they correct are still there.
      expect(body.entries.map((entry) => entry.ledger)).toStrictEqual([
        "marketplace",
        "founder_allocation",
      ]);
      expect(body.refund.transaction_id).toBe(transaction.id);
      expect(body.refund.amount_minor_units).toBe(PURCHASE_AMOUNT_MINOR_UNITS);

      const reversal = body.entries[1];
      if (reversal === undefined) {
        throw new Error("the refund answered with fewer than the two reversal entries it appends");
      }

      expectLedgerEntryShape(reversal, "founder_allocation");
      expect(reversal.entry_type).toBe("reversal");

      // The whole charge was reversed, so the reversal mirrors the whole allocation:
      // 10000 * 25 basis points / 10000 = 25.
      expect(reversal.amount_minor_units).toBe(DEFAULT_PURCHASE_ALLOCATION_MINOR_UNITS);
      expect(reversal.description).toBe(
        allocationReversalDescription(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS, transaction.id),
      );

      // Net is the sum of the stored rows: the allocation the checkout appended minus the reversal the
      // refund appended, which for a full refund is zero.
      expect(netAllocationMinorUnits(server, transaction.id)).toBe(0);
    });

    it("reverses only the refunded part on a partial refund", async () => {
      const transaction = await checkoutPurchase(server, purchase);

      const response = await refund(server, transaction.id, PARTIAL_REFUND_MINOR_UNITS);
      expect(response.status).toBe(201);

      const reversal = response.json<RefundReversalBody>().entries[1];
      if (reversal === undefined) {
        throw new Error("the refund answered with fewer than the two reversal entries it appends");
      }

      // 4000 * 25 basis points / 10000 = 10, again the single rounding point with nothing to round.
      expect(reversal.amount_minor_units).toBe(PARTIAL_REFUND_REVERSAL_MINOR_UNITS);

      // The transaction's net allocation is what its own rows still state: 25 - 10 = 15.
      expect(netAllocationMinorUnits(server, transaction.id)).toBe(
        DEFAULT_PURCHASE_ALLOCATION_MINOR_UNITS - PARTIAL_REFUND_REVERSAL_MINOR_UNITS,
      );
    });

    it("computes eligibility from the refund rows: one unit past the net remaining is refused and writes nothing", async () => {
      const transaction = await checkoutPurchase(server, purchase);

      expect((await refund(server, transaction.id, PARTIAL_REFUND_MINOR_UNITS)).status).toBe(201);

      const ledgerRowsBefore = ledgerEntryCount(server, "founder_allocation");
      const refundRowsBefore = refundCountOf(server, transaction.id);
      const reversalRowsBefore = founderRowsOf(server, transaction.id).length;

      // One minor unit more than the refund rows leave. The domain derives the net remaining from
      // those rows on every call — no balance is stored anywhere — and refuses before its transaction
      // opens, which is what makes the deltas below the proof that a refusal writes nothing at all.
      const refused = await refund(server, transaction.id, AMOUNT_PAST_NET_REMAINING_MINOR_UNITS);
      expectFailure(refused, 422, "exceeds_net_remaining");

      expect(refundCountOf(server, transaction.id)).toBe(refundRowsBefore);
      expect(founderRowsOf(server, transaction.id)).toHaveLength(reversalRowsBefore);
      expect(ledgerEntryCount(server, "founder_allocation")).toBe(ledgerRowsBefore);

      // And the amount that does fit completes: 10000 - 4000 = 6000, whose reversal is
      // 6000 * 25 basis points / 10000 = 15, leaving the transaction's net allocation at zero.
      const accepted = await refund(
        server,
        transaction.id,
        NET_REMAINING_AFTER_PARTIAL_REFUND_MINOR_UNITS,
      );
      expect(accepted.status).toBe(201);

      const acceptedReversal = accepted.json<RefundReversalBody>().entries[1];
      expect(acceptedReversal?.amount_minor_units).toBe(
        DEFAULT_PURCHASE_ALLOCATION_MINOR_UNITS - PARTIAL_REFUND_REVERSAL_MINOR_UNITS,
      );
      expect(netAllocationMinorUnits(server, transaction.id)).toBe(0);
    });
  });

  describe("the gate fee a completed run records", () => {
    it("appends one flat fee for the completed run and no allocation for its report", async () => {
      const candidate = server.candidateVersion("seed-alpha");
      const developer = server.accountForRole("developer");

      // The developer that owns the listing is the only account that may have its version measured.
      expect(server.accountOf(candidate.listingId)).toBe(developer.id);

      const feesBefore = ledgerEntryCount(server, "gate_fees");

      const response = await server.post("/evaluations", passingSubmission(server, candidate.id), {
        account: developer,
      });
      expect(response.status).toBe(201);

      const report = response.json<EvaluationReportDetail>();

      // The fee is a fee for a completed run and never for what the run found: nothing below reads the
      // report's outcome, and the seeded database already carries the same fifteen-thousand-unit fee
      // beside a passing report, a critical-case failure and a threshold failure alike.
      const fees = server.query<LedgerEntry>(GATE_FEE_ROWS_FOR_REPORT_SQL, report.id);
      expect(fees).toHaveLength(1);

      const fee = fees[0];
      if (fee === undefined) {
        throw new Error("a completed run recorded no gate-fee row for the report it wrote");
      }

      expectLedgerEntryShape(fee, "gate_fees");
      expect(fee.entry_type).toBe("charge");
      expect(fee.amount_minor_units).toBe(DEFAULT_GATE_FEE_MINOR_UNITS);
      expect(fee.report_id).toBe(report.id);

      // A fee is attached to the evaluation it was charged for and to no simulated transaction.
      expect(fee.transaction_id).toBeNull();

      // One fee and no allocation: a gate fee is journalled in the gate-fee ledger only and is never
      // eligible for a founder allocation, so nothing an evaluation costs can reach an allocation —
      // and, in the other direction, no commercial value reaches the measurement it is charged for.
      expect(ledgerEntryCount(server, "gate_fees")).toBe(feesBefore + 1);
      expect(server.query<LedgerEntry>(ALLOCATION_ROWS_FOR_REPORT_SQL, report.id)).toStrictEqual([]);

      // The fee is flat: every gate-fee row the database holds — the three the seed wrote for its
      // fixture candidates and the one this run appended — carries the same configured amount, and the
      // count is read as "more than one" rather than as a total, because the seed's rows are the seed's.
      const allFees = server.query<LedgerEntry>(ALL_GATE_FEE_ROWS_SQL);
      expect(allFees.length).toBeGreaterThan(1);

      for (const row of allFees) {
        expect(row.amount_minor_units).toBe(DEFAULT_GATE_FEE_MINOR_UNITS);
      }
    });
  });

  describe("a changed commerce configuration", () => {
    let configured: TestServer;
    let configuredPurchase: PurchaseFixture;

    beforeAll(async () => {
      // Both numbers are configurable fiction — the flat fee and the allocation rate are the plan's
      // provisional assumptions and never real economic terms — so this second server proves they flow
      // through to what the ledgers record. The override carries only the two members the commerce
      // configuration accepts: the synthetic currency label and the disclosure sentence are not
      // configurable at all, by the type's own design, so a caller cannot weaken the labelling duty.
      configured = await startTestServer({
        commerce: {
          gateFeeMinorUnits: OVERRIDE_GATE_FEE_MINOR_UNITS,
          founderAllocationRateBasisPoints: OVERRIDE_ALLOCATION_RATE_BASIS_POINTS,
        },
      });
      configuredPurchase = await resolvePurchaseFixture(configured);
    });

    afterAll(async () => {
      await configured.close();
    });

    it("writes the configured fee and the configured allocation", async () => {
      const transaction = await checkoutPurchase(configured, configuredPurchase);

      const rows = founderRowsOf(configured, transaction.id);
      expect(rows).toHaveLength(1);

      const allocation = rows[0];
      if (allocation === undefined) {
        throw new Error("the simulated checkout stored no founder-allocation row for its transaction");
      }

      // The same ten-thousand-unit purchase under a rate of a hundred basis points:
      // 10000 * 100 / 10000 = 100, by the same single rounding point.
      expect(allocation.amount_minor_units).toBe(OVERRIDE_PURCHASE_ALLOCATION_MINOR_UNITS);
      expect(allocation.description).toBe(
        allocationDescription(OVERRIDE_ALLOCATION_RATE_BASIS_POINTS),
      );

      const feesBefore = ledgerEntryCount(configured, "gate_fees");
      const candidate = configured.candidateVersion("seed-beta");

      const response = await configured.post(
        "/evaluations",
        passingSubmission(configured, candidate.id),
        { account: configured.owningDeveloper(candidate.listingId) },
      );
      expect(response.status).toBe(201);

      const report = response.json<EvaluationReportDetail>();
      const fees = configured.query<LedgerEntry>(GATE_FEE_ROWS_FOR_REPORT_SQL, report.id);

      expect(fees).toHaveLength(1);
      expect(fees[0]?.amount_minor_units).toBe(OVERRIDE_GATE_FEE_MINOR_UNITS);
      expect(ledgerEntryCount(configured, "gate_fees")).toBe(feesBefore + 1);
      expect(configured.query<LedgerEntry>(ALLOCATION_ROWS_FOR_REPORT_SQL, report.id)).toStrictEqual(
        [],
      );
    });

    it("leaves an entry's own stated rate untouched by a later configuration", async () => {
      // The same purchase on two servers, each running its own configuration. The entry each one
      // appends states the rate its own server was configured with, and the row is append-only and
      // never recomputed, so nothing that happens afterwards can rewrite what an entry says about
      // itself — nor can a read explain an existing row by today's configuration.
      const underDefault = await checkoutPurchase(server, purchase);
      const underOverride = await checkoutPurchase(configured, configuredPurchase);

      const defaultEntry = founderRowsOf(server, underDefault.id)[0];
      const overrideEntry = founderRowsOf(configured, underOverride.id)[0];

      expect(defaultEntry?.description).toBe(
        allocationDescription(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS),
      );
      expect(overrideEntry?.description).toBe(
        allocationDescription(OVERRIDE_ALLOCATION_RATE_BASIS_POINTS),
      );

      const defaultRead = await server.get("/ledger/founder-allocation", {
        account: server.accountForRole("operator"),
      });
      const overrideRead = await configured.get("/ledger/founder-allocation", {
        account: configured.accountForRole("operator"),
      });

      expect(defaultRead.status).toBe(200);
      expect(overrideRead.status).toBe(200);

      const defaultBody = defaultRead.json<FounderAllocationLedgerReadResult>();
      const overrideBody = overrideRead.json<FounderAllocationLedgerReadResult>();

      // Each read reports the rate its own stored entries state, and every entry it answers with states
      // that same rate: the ledger is the record of what was computed, not of what is configured now.
      expect(defaultBody.rate_basis_points).toBe(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS);
      expect(overrideBody.rate_basis_points).toBe(OVERRIDE_ALLOCATION_RATE_BASIS_POINTS);

      for (const entry of defaultBody.entries) {
        expect(statedRateBasisPoints(entry)).toBe(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS);
      }

      for (const entry of overrideBody.entries) {
        expect(statedRateBasisPoints(entry)).toBe(OVERRIDE_ALLOCATION_RATE_BASIS_POINTS);
      }
    });
  });

  describe("a stored ledger entry cannot be modified", () => {
    it("answers no mutating method on any of the three reads and leaves every row as it was", async () => {
      const operator = server.accountForRole("operator");
      const before = ledgerSnapshot(server);

      for (const { path } of LEDGER_READS) {
        for (const method of ["PUT", "PATCH", "DELETE"] as const) {
          // Fastify 4 has no method-not-allowed branch: a method this group does not register falls
          // through to the not-found handler, which answers the contract's `404` in the one failure
          // body. The deeper append-only proof — an attempted update or delete of a stored row through
          // every route that exists, and the appeal ruling that leaves a report byte-identical —
          // belongs to `./immutability.test.ts`, and this case asserts only what the walk does not:
          // that these three reads register the `GET` the contract lists and nothing else.
          expectFailure(await server.request(method, path, { account: operator }), 404, "not_found");
        }
      }

      // The rows are canonicalised and compared as text, so a single column of a single row that moved
      // — an amount, an instant, a description the read might have "helpfully" rewritten — fails here.
      expect(ledgerSnapshot(server)).toBe(before);
    });
  });
});
