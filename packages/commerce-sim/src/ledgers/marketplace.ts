/**
 * The marketplace charge for one completed simulated transaction: the single entry a simulated
 * checkout appends to the marketplace ledger beside the transaction it recorded.
 *
 * **One row, appended, and that is the whole of this module.** The entry is composed in memory and
 * handed to `insertLedgerEntry`, which owns the one statement that appends a `ledger_entries` row,
 * so no clause against that table is written here, no upsert form is used and nothing in this file
 * can rewrite a row already stored. `ledger_entries` is one of the nine append-only tables guarded
 * by `packages/shared/migrations/0010_append_only_triggers.sql`; those triggers are defence in
 * depth and never a security boundary, since a connection with write access can drop one, so the
 * guarantee is that this path appends a new row and does nothing else.
 *
 * **The charge half of a pair.** A completed checkout appends two entries: this marketplace charge
 * and the founder-participation allocation computed from it, which `founder-allocation.ts` owns.
 * This module writes only its own half — a charge that carries the transaction and an explicit
 * `null` for the report reference, because a ledger row references a transaction or a report and
 * never both. No eligibility question is answered here: whether an allocation applies is that
 * module's decision, so a call to this function alone leaves the founder-allocation ledger
 * untouched, which is what the separation between a charge and the share computed from it rests on.
 *
 * **The labels are the configuration's, never a caller's.** Both come from the resolved
 * {@link CommerceConfig}, so an amount cannot be journalled without the synthetic currency label the
 * migration's `CHECK` admits and the nonfunctional-demonstration disclosure every simulated amount
 * renders with. There is deliberately no parameter through which a caller could name either: a
 * second source would let a label other than the product's own enter a row.
 *
 * **No arithmetic and no validation.** The amount arrives resolved from the listing's own offer by
 * `../offers/select-offer.ts`, which already refuses a negative, non-integer, non-finite or inexact
 * figure, and the request schema refuses a malformed submission at the edge; the non-
 * negativity guard of `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql` backs that
 * at the table. A second guard here would be a second policy over the same figure, so the amount is
 * carried through exactly as it arrives and no fraction is produced anywhere on this path.
 *
 * **No clock of its own.** `now` is optional on the input and defaults inside `insertLedgerEntry`;
 * a caller that needs one pinned instant for everything a checkout appends passes the same clock
 * here as well, so the transaction and the entries beside it cannot disagree about when they
 * happened. It is forwarded rather than called here for that reason.
 *
 * **Ports and adapters.** The database handle belongs to the caller: this module opens no
 * connection, reads no environment variable, resolves no path and touches no file. Nothing here
 * measures anything and nothing here names anyone — a marketplace charge records what a simulation
 * took in, and no field of it can hold a real currency code, a payment instrument or a person.
 */

import type { Database } from "better-sqlite3";

import type { CommerceConfig } from "../config";
import type { LedgerEntry, LedgerEntryInput } from "./ledger-types";
import { insertLedgerEntry } from "./ledger-repository";

/**
 * The one thing a marketplace charge says. The text is fixed rather than composed from the
 * transaction: it states that the amount is a simulated charge and carries no identifier of a
 * person, no currency symbol and no reference to a processing intermediary, so a reader of the
 * operator ledger view cannot take the row for a real settlement.
 */
const MARKETPLACE_CHARGE_DESCRIPTION = "Simulated marketplace charge";

/**
 * What a marketplace charge is recorded from: the transaction it belongs to, the amount the offer
 * selection resolved, and the configuration its two labels come from.
 *
 * `transactionId` is the identifier of the stored transaction row this charge records, and it is
 * what a later refund's reversal entries reference, so a ledger is read transaction by transaction.
 *
 * `amountMinorUnits` is that transaction's own amount, as a whole number of minor units of the
 * synthetic currency: the offer selection computed it, and this module neither derives, scales nor
 * rounds it.
 *
 * `config` is the resolved configuration and the only source of both labels. The entry carries
 * `config.currencyLabel` and `config.disclosureLabel`, so no amount is journalled without them and
 * no caller-supplied label can substitute for either.
 *
 * `now` is the optional clock this call appends the row under. Supplied, it is the instant the row
 * is stamped with; absent, the writer's own clock is used.
 */
export interface RecordMarketplaceChargeInput {
  /** Identifier of the stored transaction this charge records. */
  readonly transactionId: string;
  /** The transaction's amount, in whole minor units of the synthetic currency. */
  readonly amountMinorUnits: number;
  /** The resolved configuration supplying both labels. */
  readonly config: CommerceConfig;
  /** The optional clock the appended row is stamped with. */
  readonly now?: () => string;
}

/**
 * Appends the marketplace charge for one completed simulated transaction and returns the entry that
 * was appended.
 *
 * Exactly one row is appended per call: a `charge`, on the debit side of the `marketplace` ledger,
 * carrying the transaction's identifier and an explicit `null` for the report reference. The
 * identifier and the insertion instant are generated as the row is written, and the returned entry
 * is the appended row rather than a re-read of it — which proves nothing either way, since an
 * append-only row cannot have changed, and the caller's own `201` payload is built from it.
 *
 * It refuses nothing of its own: it is storage, and every refusal on the ledger path is taken before
 * it is reached. The only failures that can surface are the database's own — the foreign keys, the
 * `CHECK` constraints including the pair that keeps a transaction reference and a report reference
 * from co-occurring, and the abort triggers of `0010_append_only_triggers.sql` — and they propagate
 * unwrapped rather than being re-shaped into an outcome this module would have to invent.
 *
 * A repeated call appends another row: recording the same transaction twice leaves two entries,
 * which is what an append-only ledger means and what the immutability check relies on.
 *
 * @param db - The caller's database handle.
 * @param input - The transaction, the amount, the resolved configuration and the optional clock.
 * @returns The appended entry, carrying the generated identifier and insertion instant.
 */
export function recordMarketplaceCharge(
  db: Database,
  input: RecordMarketplaceChargeInput,
): LedgerEntry {
  const entry: LedgerEntryInput = {
    ledger: "marketplace",
    entry_type: "charge",
    direction: "debit",
    amount_minor_units: input.amountMinorUnits,
    transaction_id: input.transactionId,
    report_id: null,
    currency_label: input.config.currencyLabel,
    disclosure_label: input.config.disclosureLabel,
    description: MARKETPLACE_CHARGE_DESCRIPTION,
  };

  // `exactOptionalPropertyTypes` makes optionality exact: an absent clock and one written as
  // `undefined` are not the same thing, so the member is added to the insert shape only when the
  // caller actually supplied one, and the writer's own clock answers otherwise.
  const clock = input.now;

  return insertLedgerEntry(db, clock === undefined ? entry : { ...entry, now: clock });
}
