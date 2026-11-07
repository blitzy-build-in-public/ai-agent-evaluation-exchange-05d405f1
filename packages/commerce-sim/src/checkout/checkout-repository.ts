/**
 * The append-only persistence half of the simulated checkout: the one write path into
 * `transactions`, and the one read that hands a stored row back in the shape the checkout
 * contract states.
 *
 * A transaction accepts exactly one kind of write — a newly inserted row — so no statement in this
 * module carries an upsert clause, and this module never updates and never deletes. `INSERT OR
 * REPLACE` is refused here for a reason worth knowing rather than as a style preference: its replace
 * path removes the existing row, which bypasses the `DELETE` trigger that
 * `packages/shared/migrations/0010_append_only_triggers.sql` places on this table. `transactions` is
 * one of the nine append-only tables, the guarantee is that no route offers a mutation, and the
 * trigger stands behind that guarantee as defence in depth rather than as a security boundary.
 *
 * Two properties of a stored row are the product's labelling obligation, and neither is a caller's
 * string: `currency_label` arrives as the resolved configuration's currency label and
 * `disclosure_label` as its disclosure label, both owned by `../config.ts`, and the migration's
 * `CHECK (currency_label = 'DEMO')` refuses any other label at the table itself. The amount is
 * equally not a client's: it is selected from the listing's own offers by
 * `../offers/select-offer.ts` before this module is reached, so no price enters here from a request.
 * This module therefore holds no price lookup, no per-offer amount table and no default amount.
 *
 * Nothing here measures anything and nothing here names anyone: no column of `transactions` can hold
 * a real currency code, a payment instrument or a processing intermediary's reference, and this
 * module writes nothing that an evaluation reads.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable, resolves no path and touches no file.
 */

import { randomUUID } from "node:crypto";

import type { Transaction } from "@adem/shared";
import type { Database } from "better-sqlite3";

/**
 * The insert shape of a `transactions` row: the stored row without the two columns the writer
 * generates. It is exactly the shape `packages/commerce-sim/src/index.ts` re-exports for callers of
 * this package.
 *
 * Derived from {@link Transaction} rather than restated, so a column added to the row reaches this
 * shape without an edit here and a writer and its table cannot drift apart. Two properties of the
 * row survive that derivation and are load-bearing: `simulated` stays the literal `true`, which is
 * what makes a transaction that is not simulated impossible to construct, and `currency_label` stays
 * the literal type of the product's one synthetic label, which is what keeps any other label out of
 * a caller's reach.
 *
 * The amount is a whole number of minor units of that label and is never a client input: it is
 * resolved from the listing's own offer by `../offers/select-offer.ts` before an insert is built.
 * `id` and `created_at` are absent because the table generates neither and this writer supplies
 * both, so a caller cannot name the identity or the instant of a transaction.
 */
export type TransactionInput = Omit<Transaction, "id" | "created_at">;

/**
 * The one statement that writes a `transactions` row: an explicit column list in the migration's own
 * order, one placeholder per column, no `*` and no value concatenated into the text. The ten values
 * are bound positionally by {@link insertTransaction} in exactly this order, so the statement and
 * its call site are read together.
 */
const INSERT_TRANSACTION_SQL = `INSERT INTO transactions
  (id, buyer_account_id, listing_id, listing_version_id, offer_model,
   amount_minor_units, currency_label, simulated, disclosure_label, created_at)
VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The one statement that reads a `transactions` row back: the same explicit column list as the
 * insert, addressed by the row's identifier.
 */
const SELECT_TRANSACTION_SQL = `SELECT
  id, buyer_account_id, listing_id, listing_version_id, offer_model,
  amount_minor_units, currency_label, simulated, disclosure_label, created_at
FROM transactions
WHERE id = ?`;

/**
 * The stored shape of a `transactions` row, differing from {@link Transaction} in exactly one column.
 *
 * SQLite has no boolean type: `simulated` is declared
 * `INTEGER NOT NULL DEFAULT 1 CHECK (simulated = 1)` in
 * `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql`, so the driver hands this
 * column back as the integer `1` rather than as `true`. Reading a row as a {@link Transaction}
 * directly would therefore be a claim the returned value does not keep, which is why the read in
 * {@link getTransaction} restores the boolean from this shape rather than passing it on.
 */
interface TransactionRow extends Omit<Transaction, "simulated"> {
  /** The stored integer form of the row's simulation marker: `1` in every row the table admits. */
  simulated: 0 | 1;
}

/**
 * The clock {@link insertTransaction} uses when its caller supplies none: an ISO-8601 UTC instant
 * with milliseconds and a trailing `Z`, never SQLite's `CURRENT_TIMESTAMP`, whose
 * `YYYY-MM-DD HH:MM:SS` form carries neither.
 */
const defaultNow = (): string => new Date().toISOString();

/**
 * Appends one completed simulated transaction and returns the row that was written.
 *
 * The row is built in memory from the caller's input and the two generated values, and the returned
 * value is that row rather than a re-read of it: this is what guarantees the caller — and the `201`
 * payload the checkout route builds from it — carries the boolean `true` in `simulated` rather than
 * the integer SQLite would hand back. A re-read would also prove nothing, since the row is
 * append-only and cannot have changed.
 *
 * `options.now` is the injectable clock, defaulting to {@link defaultNow}. It is a third parameter
 * rather than a member of {@link TransactionInput} deliberately: that shape is fixed as the row
 * without `id` and `created_at`, `Transaction` declares no clock field, and a member holding a
 * function would put a value in an insert shape whose table has no column for it. A caller that
 * needs a fixed instant — a test, a deterministic fixture — passes one here and does not have to
 * reach for the input shape to do it.
 *
 * This function refuses nothing: it is storage, and every refusal on the checkout path is taken
 * before it is reached. An offer model the listing does not make, and a listing or version that does
 * not exist, are decided upstream; a malformed submission is refused by the request schema. The only
 * failures that can surface from here are the database's own — the foreign keys, the `CHECK`
 * constraints and the append-only trigger of
 * `packages/shared/migrations/0010_append_only_triggers.sql` — and they propagate unwrapped rather
 * than being re-shaped into an outcome this module would have to invent.
 *
 * @param db - The caller's database handle.
 * @param input - The eight values the table stores besides the two written here.
 * @param options - The optional clock, defaulting to the system clock.
 * @returns The appended transaction, carrying the generated identifier and insertion instant.
 */
export function insertTransaction(
  db: Database,
  input: TransactionInput,
  options?: { now?: () => string },
): Transaction {
  const now = options?.now ?? defaultNow;

  const row: Transaction = { ...input, id: randomUUID(), created_at: now() };

  db.prepare(INSERT_TRANSACTION_SQL).run(
    row.id,
    row.buyer_account_id,
    row.listing_id,
    row.listing_version_id,
    row.offer_model,
    row.amount_minor_units,
    row.currency_label,
    // SQLite has no boolean type, so the row's marker is stored as an integer and bound through
    // this map. The row stays the single source of the value: the column's
    // `CHECK (simulated = 1)` accepts the `1` this produces and refuses the `0` that would make a
    // row claim it is not a simulation.
    row.simulated ? 1 : 0,
    row.disclosure_label,
    row.created_at,
  );

  return row;
}

/**
 * Returns the stored transaction with the given identifier, or `null` when no row carries it.
 *
 * `null` rather than `undefined` so the caller's absence check reads as one comparison, and so the
 * return type states the absence rather than leaving it to the driver's own convention. It never
 * throws: an unknown identifier is an ordinary outcome of a read by identifier — the contract
 * answers it with its `404` where the surface calls for one — and not a failure of this function.
 *
 * The stored integer in `simulated` is mapped back to the boolean the row type declares on the way
 * out: the column's `CHECK (simulated = 1)` admits `1` and nothing else, and the value handed to the
 * caller is the literal `true` the checkout contract's payload states. `amount_minor_units` is not
 * touched: SQLite stores it as an integer, the driver returns it as one, and no conversion, scaling
 * or rounding belongs on a read path.
 *
 * @param db - The caller's database handle.
 * @param id - Identifier of the transaction to read.
 * @returns The stored transaction, or `null` when the table holds no row for that identifier.
 */
export function getTransaction(db: Database, id: string): Transaction | null {
  const row = db.prepare<[string], TransactionRow>(SELECT_TRANSACTION_SQL).get(id);

  if (row === undefined) {
    return null;
  }

  // The boolean is restored from the column rather than the driver's integer being passed on: a
  // caller reading `1` would break both the checkout contract's `201` payload and any strict
  // comparison against `true`. The column's `CHECK (simulated = 1)` is what makes the restoration
  // exact — `1` is the only value the table admits — so this is not a coercion of whatever arrived.
  return { ...row, simulated: true };
}
