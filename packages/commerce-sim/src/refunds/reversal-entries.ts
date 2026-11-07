/**
 * The pair of reversal entries a refund appends: one beside the marketplace charge the simulated
 * checkout recorded, and one beside the founder-participation allocation that charge produced.
 *
 * A refund corrects two ledger rows at once, and it corrects them the only way a ledger in this
 * product accepts a correction — by appending a new row proportional to the amount the refund
 * states, never by rewriting the row it corrects. Returning both rows from one builder is what
 * makes that pair a single act rather than two writes a caller could half-perform: a marketplace
 * reversal that landed without its founder-allocation counterpart would leave two ledgers
 * describing the same transaction differently, with nothing in either row to show it.
 *
 * **Two entries, in a fixed order.** The marketplace reversal is built first and the
 * founder-allocation reversal second, so the rows are returned in the order they are to be written
 * and a reader of the ledger sees them as they happened. Each carries the transaction that was
 * reversed and an explicit `null` for `report_id`: a reversal references a transaction and never an
 * evaluation report, and nothing in either entry measures anything.
 *
 * **The directions are the opposite of what each corrects.** A charge falls on the debit side of
 * the marketplace ledger and an allocation on the credit side of the founder-allocation ledger, so
 * the marketplace reversal is a `credit` and the founder-allocation reversal is a `debit`. That
 * convention is stated for the package in `../ledgers/ledger-types.ts` and read from there rather
 * than restated, and `direction` is never the sign of an amount: every amount here stays a
 * non-negative whole number of minor units.
 *
 * **The arithmetic is not here.** The marketplace reversal carries the refunded amount through
 * untouched, and the founder-allocation reversal is the product's single rounding point applied to
 * that amount: `allocate` in `../ledgers/allocate.ts` is called once and nothing else on this path
 * derives, scales or rounds an amount. Its `RangeError` for an amount that is not a non-negative
 * safe integer is the only refusal this module can produce, and it propagates unwrapped, because
 * such an amount is a caller defect rather than an outcome a builder invents a shape for. Whether a
 * refund is eligible at all, and whether its amount fits the transaction's derived net remaining,
 * is decided before this builder is reached, from the transaction's own refund rows.
 *
 * **Labels come from the resolved configuration**, never from a caller: each entry carries
 * `config.currencyLabel` and `config.disclosureLabel`, so an amount cannot be written without the
 * synthetic currency label and the nonfunctional-demonstration disclosure every amount in this
 * product renders with. The founder-allocation reversal's `description` also states the
 * basis-point rate it was computed from, because the appended row is the durable record of that
 * rate — a later configuration change must not retroactively alter what an existing row was
 * computed from.
 *
 * **Pure and total.** No clock, no random source, no environment, no I/O and no database: the same
 * refund, transaction and configuration always yield equal entries, and neither the input nor any
 * member of it is touched — the fields read below are read exactly as they arrive. The two columns a
 * stored entry carries besides these nine — its identifier and its insertion instant — are produced
 * as the row is written, so neither appears in what this module builds.
 */

import type { Refund, Transaction } from "@adem/shared";

import type { CommerceConfig } from "../config";
import { allocate } from "../ledgers/allocate";
import type { LedgerEntryInput } from "../ledgers/ledger-types";

/**
 * What a reversal pair is built from: the refund that rules it, the transaction it corrects and the
 * resolved configuration its two labels and its rate come from.
 *
 * `refund` is a stored row of the `refunds` table, and its `amount_minor_units` is the refunded
 * amount — the amount the marketplace reversal carries and the amount the founder-allocation
 * reversal is computed from. A `0` is a permitted amount and not a refusal: an amount of nothing is
 * a domain decision taken where a refund's eligibility and the transaction's net remaining are
 * read, and this builder answers it as it answers any other amount.
 *
 * `transaction` is the stored row of the `transactions` table being reversed. Its `id` becomes each
 * entry's `transaction_id`; its own `amount_minor_units` is deliberately not read here, because a
 * partial refund reverses a part of the charge rather than the whole of it, and taking the
 * transaction's amount would silently reverse more than the refund states.
 *
 * `config` is the resolved configuration and the only source of the currency label, the disclosure
 * label and the allocation rate. There is no label and no rate parameter, because a caller free to
 * name either would be free to write an amount without its labelling obligation or to record an
 * allocation computed from a rate other than the one the product states.
 */
export interface BuildReversalEntriesInput {
  /** The stored refund that rules the reversal, whose amount is the amount reversed. */
  readonly refund: Refund;
  /** The stored transaction being reversed, whose identity both entries carry. */
  readonly transaction: Transaction;
  /** The resolved configuration supplying both labels and the allocation rate. */
  readonly config: CommerceConfig;
}

/**
 * Builds the two reversal entries a refund appends, in the order they are to be written: the
 * marketplace reversal first, then the founder-allocation reversal.
 *
 * Returns a freshly built two-element array of insert shapes. Neither the array nor either entry is
 * retained between calls, so a caller may hand the result straight to the writer and may keep or
 * discard it afterwards; two calls with equal arguments return equal but distinct objects.
 *
 * It refuses nothing of its own. The only throw is the `RangeError` {@link allocate} raises for an
 * amount or a rate that is not a non-negative safe integer, and it propagates unwrapped: the
 * refunded amount is not validated, not clamped and not special-cased here, and a refund of nothing
 * yields its two entries rather than a refusal. The function performs no I/O, holds no mutable state
 * and never reads a clock or a random source.
 *
 * @param input The refund, the transaction it corrects and the resolved configuration.
 * @returns Exactly two entries: the marketplace reversal, a `credit` of the refunded amount against
 *   the transaction, and the founder-allocation reversal, a `debit` of that amount at the
 *   configured rate. Each carries the transaction's identifier, an explicit `null` report
 *   reference, and the configuration's currency and disclosure labels.
 * @throws {RangeError} From {@link allocate}, if the refunded amount or the configured rate is not a
 *   non-negative safe integer, or if the product of the two is not one.
 */
export function buildReversalEntries(input: BuildReversalEntriesInput): LedgerEntryInput[] {
  // No refusal path belongs here: the refunded amount is neither validated nor clamped nor
  // special-cased below, so the only throw this function can make is `allocate`'s `RangeError`.
  //
  // The one call to the product's single rounding point, made once so the amount the entry carries
  // and the rate its description states cannot come from two evaluations that could differ.
  const founderReversalAmountMinorUnits = allocate(
    input.refund.amount_minor_units,
    input.config.founderAllocationRateBasisPoints,
  );

  const marketplaceReversal: LedgerEntryInput = {
    ledger: "marketplace",
    entry_type: "reversal",
    direction: "credit",
    amount_minor_units: input.refund.amount_minor_units,
    transaction_id: input.transaction.id,
    report_id: null,
    currency_label: input.config.currencyLabel,
    disclosure_label: input.config.disclosureLabel,
    description: `Simulated refund reversal of the marketplace charge for transaction ${input.transaction.id}`,
  };

  const founderAllocationReversal: LedgerEntryInput = {
    ledger: "founder_allocation",
    entry_type: "reversal",
    direction: "debit",
    amount_minor_units: founderReversalAmountMinorUnits,
    transaction_id: input.transaction.id,
    report_id: null,
    currency_label: input.config.currencyLabel,
    disclosure_label: input.config.disclosureLabel,
    description: `Simulated refund reversal of the founder allocation computed at ${String(
      input.config.founderAllocationRateBasisPoints,
    )} basis points for transaction ${input.transaction.id}`,
  };

  return [marketplaceReversal, founderAllocationReversal];
}
