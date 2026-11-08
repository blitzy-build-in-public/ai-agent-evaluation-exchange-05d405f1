/**
 * The refund path of the simulated commerce package: the eligibility rule that decides whether a
 * refund may be appended at all, and the one atomic write that appends it together with the pair of
 * reversal entries it rules.
 *
 * **A transaction's net position is derived on every call and never stored.** What a transaction has
 * left to refund is its own `amount_minor_units` minus the sum of the `refunds` rows that reference
 * it, both read as this module runs. No column holds a balance, none may be added, and nothing on
 * this path caches one: a stored balance would be a second source of truth for a value the refund
 * rows already state, and a value with two sources can disagree with itself. That is what makes the
 * calling route's `409` (the transaction is already fully refunded) and its `422` (the amount exceeds
 * the net remaining) answerable from those rows alone, with no correction of any kind.
 *
 * **A refund appends; it corrects nothing.** The only rows written on this path are one `refunds` row
 * and the two `ledger_entries` rows that `./reversal-entries.ts` builds for it — the marketplace
 * reversal of the charge the simulated checkout took in, and the founder-allocation reversal of the
 * allocation that charge produced. The transaction, the charge and the allocation all stay exactly as
 * they were stored, and `transactions`, `refunds` and `ledger_entries` are three of the nine
 * append-only tables guarded by `packages/shared/migrations/0010_append_only_triggers.sql`. Those
 * triggers are defence in depth and never a security boundary, so the guarantee is held here: every
 * statement below that writes is an append of a new row.
 *
 * **One transaction, so a half-performed refund cannot exist.** The refund row and its two reversal
 * entries are appended inside one `db.transaction(...)`. A refund whose reversal failed to land would
 * otherwise leave the marketplace ledger and the founder-allocation ledger describing one transaction
 * differently, with nothing in either row to show it. Better-sqlite3 is synchronous and runs on the
 * calling thread, so this module answers with a value rather than a promise: there is no `await` on
 * this path, nothing is queued, and the product's evaluation path is not entered from here at all.
 *
 * **The order in which the refusals are taken is part of the rule, not an accident of the code.** An
 * amount that is not a whole count of at least one minor unit is refused first, because nothing about
 * it can be answered at all; an unknown transaction is refused next; a transaction with nothing left
 * is refused as already fully refunded *before* the over-large test, because a fully refunded
 * transaction also satisfies "the amount is greater than what remains"; and only then is an amount
 * greater than the net remaining refused. Every refusal returns before the transaction opens, so a
 * refused refund writes nothing — not the refund row, not a reversal entry, not a ledger row.
 *
 * **A refund of nothing is refused rather than written.** The request schema admits `0` — its
 * `minimum: 0` in `packages/shared/src/schemas/commerce-schema.ts` is deliberate, so that the meaning
 * of a meaningless amount is carried here rather than at the edge — so a zero amount does reach this
 * module and is refused as an invalid amount. A row stating that nothing was refunded would record an
 * act that did not happen.
 *
 * **Every label and the allocation rate come from the resolved configuration**, never from a caller:
 * both reversal entries carry the configuration's currency label and its disclosure label, and the
 * founder-allocation reversal states the basis-point rate its amount was computed from. Every amount
 * on this path is a whole number of minor units of the synthetic currency, and no arithmetic here can
 * produce a fraction — the only arithmetic in this module is the integer subtraction in
 * {@link remainingAfterRefunds}, which both {@link computeNetRemaining} and {@link createRefund}
 * reach, and the transaction row it subtracts from is read once per request.
 *
 * Nothing here measures anything and nothing here names anyone: no row written by this module can
 * reach an SGI report, an evaluation outcome, a badge or an ordering, and no amount is attributed to
 * a person, a beneficiary or an entitlement.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable, resolves no path and touches no file.
 */

import { randomUUID } from "node:crypto";

import type { Refund, Transaction } from "@adem/shared";
import type { Database } from "better-sqlite3";

import type { CommerceConfig } from "../config";
import { insertLedgerEntries } from "../ledgers/ledger-repository";
import type { LedgerEntry } from "../ledgers/ledger-types";
import { buildReversalEntries } from "./reversal-entries";

/**
 * The one statement that reads a `transactions` row: an explicit column list in the migration's own
 * order, addressed by the row's identifier. The row is read rather than assumed so that an unknown
 * identifier is an ordinary outcome — the calling route's `404` — and so that the transaction handed
 * to the reversal builder is the stored one rather than a shape assembled from the caller's input.
 */
const SELECT_TRANSACTION_SQL = `SELECT
  id, buyer_account_id, listing_id, listing_version_id, offer_model,
  amount_minor_units, currency_label, simulated, disclosure_label, created_at
FROM transactions
WHERE id = ?`;

/**
 * The one statement that sums a transaction's refund rows. `COALESCE` is what makes the sum of an
 * unrefunded transaction `0` rather than a null the caller would have to interpret: a transaction
 * with no refund rows has had nothing refunded, which is the same arithmetic as having refunded
 * nothing. No stored balance is read, because none exists.
 */
const SELECT_REFUNDED_TOTAL_SQL = `SELECT COALESCE(SUM(amount_minor_units), 0) AS refunded
FROM refunds
WHERE transaction_id = ?`;

/**
 * The one statement that appends a `refunds` row: an explicit column list in the migration's own
 * order, one placeholder per column, no `*` and no value interpolated into the text. The five values
 * are bound positionally by {@link createRefund} in exactly this order, so the statement and its call
 * site are read together.
 */
const INSERT_REFUND_SQL = `INSERT INTO refunds
  (id, transaction_id, amount_minor_units, operator_account_id, created_at)
VALUES
  (?, ?, ?, ?, ?)`;

/**
 * The stored shape of a `transactions` row, differing from {@link Transaction} in exactly one column.
 *
 * SQLite has no boolean type: `simulated` is declared
 * `INTEGER NOT NULL DEFAULT 1 CHECK (simulated = 1)` in
 * `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql`, so the driver hands this column
 * back as the integer `1` rather than as `true`. Reading a row straight into a {@link Transaction}
 * would therefore be a claim the returned value does not keep, which is why {@link readTransaction}
 * takes this shape and restores the boolean on the way out.
 */
interface TransactionRow extends Omit<Transaction, "simulated"> {
  /** The stored integer form of the row's simulation marker: `1` in every row the table admits. */
  readonly simulated: 0 | 1;
}

/** The one-column shape the refund-sum read answers with. */
interface RefundedTotalRow {
  /** The sum of this transaction's refund rows, in whole minor units; `0` when it has none. */
  readonly refunded: number;
}

/**
 * Why a refund was refused, as the closed list of reasons the calling route maps to a status.
 *
 * Every member is an ordinary outcome and never an exception: this module answers with one of these
 * rather than throwing, so a refusal cannot be mistaken for a defect in the caller's code. The status
 * each one becomes belongs to the route that owns the HTTP surface, and the mapping is written here
 * only so that the route and this module read one list rather than two; a surface that answers
 * differently maps the same reason to whatever it answers with.
 *
 * - `transaction_not_found`: no `transactions` row carries the given identifier — the route's `404`.
 * - `already_fully_refunded`: the transaction's net remaining is `0`, so its refund rows already
 *   account for its whole amount — the route's `409`.
 * - `exceeds_net_remaining`: the amount is greater than what the transaction has left — the route's
 *   `422`.
 * - `invalid_amount`: the amount is not a whole count of at least one minor unit, so it is not an
 *   amount this product can be asked to refund — the route's `400`.
 */
export type RefundRefusalReason =
  | "transaction_not_found"
  | "already_fully_refunded"
  | "exceeds_net_remaining"
  | "invalid_amount";

/**
 * Everything {@link createRefund} is given.
 *
 * `config` is the resolved configuration and the only source of both labels and of the allocation
 * rate, exactly as it is for a simulated checkout: there is no label and no rate parameter here, so a
 * caller cannot write an amount without its labelling obligation or record an allocation computed
 * from a rate the product does not state.
 *
 * `now` is the injectable clock, and it is optional rather than a member whose absence is written as
 * `undefined` — `exactOptionalPropertyTypes` makes the two distinct, so a caller that wants an
 * instant of its own supplies this function. A refund's instant is read once and threaded to the two
 * reversal entries, so one refund and its reversals can share a single instant rather than drifting
 * apart by however long an insert took.
 */
export interface CreateRefundInput {
  /** Identifier of the transaction being refunded. */
  readonly transactionId: string;
  /** Amount to refund, as a whole number of at least one minor unit of the synthetic currency. */
  readonly amountMinorUnits: number;
  /** Identifier of the operator account the calling route resolved from its demo header. */
  readonly operatorAccountId: string;
  /** The resolved configuration supplying both labels and the allocation rate. */
  readonly config: CommerceConfig;
  /** The clock the refund and its reversal entries are stamped by; defaults to the system clock. */
  readonly now?: () => string;
}

/**
 * The refund that was appended, on the success branch of {@link createRefund}.
 *
 * `refund` is the appended `refunds` row, and `reversalEntries` are exactly the two `ledger_entries`
 * rows appended for it, in the order they were written: the marketplace reversal first and the
 * founder-allocation reversal second. They are the entries this refund appended and never the whole
 * ledger: a caller answering the route's `201` renders the correction that was just recorded, and a
 * read of a ledger is a different operation with its own surface.
 */
export interface RefundResult {
  /** The appended refund row. */
  readonly ok: true;
  /** The refund row this call appended. */
  readonly refund: Refund;
  /** The two reversal entries appended for that refund, in the order they were written. */
  readonly reversalEntries: LedgerEntry[];
}

/**
 * The refusal of {@link createRefund}, on the failure branch.
 *
 * It carries the reason and nothing else. A refusal is not a partial success and this shape states
 * that: there is no refund, no entry and no count of anything written, because a refused refund
 * writes nothing at all.
 */
export interface RefundRefusal {
  /** Always `false`: the refund was not appended. */
  readonly ok: false;
  /** Which refusal this was, from the closed list of reasons. */
  readonly reason: RefundRefusalReason;
}

/**
 * The clock {@link createRefund} uses when its caller supplies none: an ISO-8601 UTC instant with
 * milliseconds and a trailing `Z`, never SQLite's `CURRENT_TIMESTAMP`, whose `YYYY-MM-DD HH:MM:SS`
 * form carries neither.
 */
const defaultNow = (): string => new Date().toISOString();

/**
 * Reads the stored transaction with the given identifier, or `undefined` when the table holds none.
 *
 * The stored integer in `simulated` is mapped back to the boolean the row type declares: the
 * column's `CHECK (simulated = 1)` admits `1` and nothing else, so the restoration is exact rather
 * than a coercion of whatever arrived, and the transaction handed to the reversal builder is a
 * {@link Transaction} whose every field came from the stored row. `amount_minor_units` is not
 * touched — SQLite stores it as an integer, the driver returns it as one, and no conversion, scaling
 * or rounding belongs on a read path.
 *
 * @param db The caller's database handle.
 * @param transactionId Identifier of the transaction to read.
 * @returns The stored transaction, or `undefined` when the table holds no row for that identifier.
 */
function readTransaction(db: Database, transactionId: string): Transaction | undefined {
  const row = db.prepare<[string], TransactionRow>(SELECT_TRANSACTION_SQL).get(transactionId);

  return row === undefined ? undefined : { ...row, simulated: true };
}

/**
 * Reads the sum of the refund rows that reference a transaction, in whole minor units of the
 * synthetic currency: the figure the net remaining is derived from, and the only read of the
 * `refunds` table beside the append itself.
 *
 * The statement's `COALESCE` is what makes a transaction with no refund rows answer `0` rather than a
 * null a caller would have to interpret — a transaction with nothing refunded is the same arithmetic
 * as one whose refunds sum to nothing — and an identifier nothing references answers `0` for the same
 * reason: there is nothing to sum.
 *
 * @param db The caller's database handle.
 * @param transactionId Identifier of the transaction whose refund rows are summed.
 * @returns The refunded total in whole minor units, `0` when the transaction has no refund rows.
 */
function readRefundedTotal(db: Database, transactionId: string): number {
  const row = db.prepare<[string], RefundedTotalRow>(SELECT_REFUNDED_TOTAL_SQL).get(transactionId);

  return row?.refunded ?? 0;
}

/**
 * What a transaction has left to refund: its own amount minus what its refund rows already account
 * for.
 *
 * This is the module's one subtraction and its only arithmetic, so the figure the route's `409` and
 * its `422` are decided on is computed in exactly one place. No rate is applied and no fraction can
 * arise, because the amount and every refund row are whole counts of minor units, and the product's
 * one rounding point (`../ledgers/allocate.ts`) is reached by the reversal builder rather than here.
 *
 * It is private and takes the transaction itself rather than reading one, because both callers
 * already hold the row: {@link computeNetRemaining} reads it for the identifier it is handed, and
 * {@link createRefund} reads it once and computes the net remaining from that same row rather than
 * asking for it to be read a second time. A transaction that has been refunded in full answers `0`
 * here, which is the arithmetic the two refusal reasons share.
 *
 * @param transaction The stored transaction, read by the caller.
 * @param refundedTotal What that transaction's refund rows already account for, in minor units.
 * @returns The transaction's amount less its refunded total, in whole minor units.
 */
function remainingAfterRefunds(transaction: Transaction, refundedTotal: number): number {
  return transaction.amount_minor_units - refundedTotal;
}

/**
 * Returns what a transaction has left to refund, in whole minor units of the synthetic currency: the
 * transaction's own amount minus the sum of the refund rows that reference it.
 *
 * The figure is recomputed from the stored rows on every call and is stored nowhere, so no balance
 * exists that could drift away from the refunds it would be derived from, and a refund appended
 * between two calls is reflected by the second call without anything being kept in step.
 *
 * A transaction **with no refund rows** answers with its whole amount: it has had nothing refunded,
 * and the statement's `COALESCE` is what states that rather than a default applied here. An
 * **unknown identifier** answers with `0`, because there is no amount to subtract from and a figure
 * this function cannot state is not one it invents; the caller's own existence check is what turns an
 * unknown identifier into the route's `404`, and a transaction that has already been refunded in full
 * also answers `0`, which is the arithmetic both cases share.
 *
 * This function refuses nothing and throws nothing of its own: it reads two values, and both an
 * unknown identifier and an unrefunded transaction are ordinary states rather than failures. It is
 * the answer for a caller that holds only an identifier; a caller that has already read the row
 * computes the same figure from it through {@link remainingAfterRefunds} and {@link readRefundedTotal}
 * rather than having this function read that row again.
 *
 * @param db The caller's database handle.
 * @param transactionId Identifier of the transaction to measure.
 * @returns The net remaining in whole minor units, or `0` when no transaction carries the identifier.
 */
export function computeNetRemaining(db: Database, transactionId: string): number {
  const transaction = readTransaction(db, transactionId);

  if (transaction === undefined) {
    return 0;
  }

  return remainingAfterRefunds(transaction, readRefundedTotal(db, transactionId));
}

/**
 * Appends a refund of a simulated transaction, together with the two reversal entries it rules: the
 * marketplace reversal of the charge the checkout took in and the founder-allocation reversal of the
 * allocation that charge produced.
 *
 * Returns the appended refund and the two entries appended for it, in the order they were written, or
 * a {@link RefundRefusal} carrying one of the four reasons. No refusal of its own is thrown — an
 * invalid amount, an unknown transaction, a transaction with nothing left and an amount greater than
 * what remains are all ordinary outcomes the caller answers with a status it owns — and a refusal
 * writes nothing whatsoever, because each one returns before the transaction below opens.
 *
 * The transaction is the unit of atomicity: the refund row and its pair of reversals are appended
 * inside one `db.transaction(...)`, so a refund that failed to append its reversals leaves no refund
 * row behind and no ledger corrected in half. The instant is read once through the injected clock and
 * threaded to both reversal entries, so a refund and its reversals can share one instant when a
 * caller pins one. Every amount is a whole number of minor units of the synthetic currency, and both
 * labels arrive from the resolved configuration rather than from the caller.
 *
 * @param db The caller's database handle.
 * @param input The transaction to refund, the amount, the operator account, the resolved
 *   configuration and the optional clock.
 * @returns The appended refund and the two reversal entries appended for it, or a refusal naming why
 *   nothing was appended.
 * @throws Whatever the database raises if the append itself fails — a foreign key, a `CHECK`
 *   constraint — and `RangeError` from {@link buildReversalEntries} if the refunded amount or the
 *   configured rate is not a value the allocation can compute from. In every such case the
 *   transaction is rolled back and nothing remains appended.
 */
export function createRefund(
  db: Database,
  input: CreateRefundInput,
): RefundResult | RefundRefusal {
  // An amount that is not a whole count of at least one minor unit is refused before anything is
  // read: a fraction, a negative count, a value that is not a number at all, an infinity and a count
  // beyond what the number type represents exactly are all answered the same way, and a `0` — which
  // the request schema deliberately admits — is refused here rather than by the schema, because a
  // refund of nothing is not an act this path can record.
  if (!Number.isSafeInteger(input.amountMinorUnits) || input.amountMinorUnits < 1) {
    return { ok: false, reason: "invalid_amount" };
  }

  const transaction = readTransaction(db, input.transactionId);

  if (transaction === undefined) {
    return { ok: false, reason: "transaction_not_found" };
  }

  // The net remaining is computed from the row read just above rather than by asking
  // `computeNetRemaining` for it: that function reads the transaction row itself to answer, and a
  // request that reads a transaction twice for one question spends a statement on a row it already
  // holds. The arithmetic is the same one site — `remainingAfterRefunds` — and the sum of this
  // transaction's refund rows is the only thing left to read.
  const netRemaining = remainingAfterRefunds(
    transaction,
    readRefundedTotal(db, input.transactionId),
  );

  // Checked before the over-large test below, and the order is load-bearing: a transaction whose
  // refunds already account for its whole amount satisfies "the amount is greater than what remains"
  // as well, and it is the already-fully-refunded answer the caller owes its client in that state.
  if (netRemaining === 0) {
    return { ok: false, reason: "already_fully_refunded" };
  }

  if (input.amountMinorUnits > netRemaining) {
    return { ok: false, reason: "exceeds_net_remaining" };
  }

  const clock = input.now ?? defaultNow;

  // One transaction for the refund row and its reversal pair. `insertLedgerEntries` opens its own
  // transaction so that the two reversals are one act as well; better-sqlite3 nests that as a
  // savepoint inside this one, so the refund, the marketplace reversal and the founder-allocation
  // reversal all commit together or none of them do.
  const appendRefund = db.transaction((): RefundResult => {
    const refund: Refund = {
      id: randomUUID(),
      transaction_id: transaction.id,
      amount_minor_units: input.amountMinorUnits,
      operator_account_id: input.operatorAccountId,
      created_at: clock(),
    };

    // The reversal pair is built, never derived here: the marketplace amount and the founder share
    // are `./reversal-entries.ts`' business, and the rate it applies is the configuration's.
    const reversalInputs = buildReversalEntries({ refund, transaction, config: input.config });

    db.prepare(INSERT_REFUND_SQL).run(
      refund.id,
      refund.transaction_id,
      refund.amount_minor_units,
      refund.operator_account_id,
      refund.created_at,
    );

    const reversalEntries = insertLedgerEntries(
      db,
      reversalInputs.map((entry) => ({ ...entry, now: clock })),
    );

    return { ok: true, refund, reversalEntries };
  });

  return appendRefund();
}

