/**
 * The founder-participation allocation one eligible completed simulated marketplace transaction
 * produces: a single new row in the founder-allocation ledger, at the configured rate.
 *
 * **One row, one act.** {@link recordFounderAllocation} appends exactly one entry — an `allocation`,
 * on the `credit` side of the `founder_allocation` ledger, carrying the transaction it was computed
 * from and an explicit `null` report reference — and returns it. The two columns the row's writer
 * generates, its identifier and its insertion instant, are produced there rather than here, so
 * nothing on this path reads a clock of its own.
 *
 * **The arithmetic is not here.** The amount is the product's single rounding point applied to the
 * net amount at the configured rate: `allocate` in `./allocate` is called once, with
 * `config.founderAllocationRateBasisPoints`, and no multiplication, percentage or second rounding
 * appears beside it. The rate is read from the resolved configuration and is never defaulted or
 * re-derived here, so the rate an entry was computed from is the rate the product states.
 *
 * **Eligibility is structural, and that is the point.** The input carries a transaction identifier,
 * that transaction's net amount and the resolved configuration, and nothing else: there is no
 * parameter for a gate-evaluation fee, a sponsored-slot record, an evaluation report or a gross
 * amount, so none of them can reach this function and none of them can allocate. Whether a
 * transaction is eligible is decided by the caller that resolves its net remaining from its
 * reversal rows; what this module holds is the property that only a net marketplace amount can
 * arrive. The parameter name `netAmountMinorUnits` carries that meaning — the caller has already
 * subtracted the reversals, and nothing is subtracted here.
 *
 * **The description states the rate, because the row is the durable record of it.** The basis-point
 * rate the amount was computed from is written into the row's `description`, so the rate stays
 * readable beside the amount it produced and a later configuration change does not retroactively
 * alter what an existing row was computed from: the row is append-only, it is never recomputed, and
 * the operator's founder-allocation read exposes each entry beside the rate it was computed from.
 *
 * **A zero amount still appends its row.** There is no "does not apply" case on this path: an
 * allocation of nothing is a computed allocation on an eligible transaction, and skipping it would
 * make the ledger's history depend on an amount rather than on the event that produced it. The
 * gate-evaluation-fee writer is where a configured value can mean "no entry", and that branch stays
 * there.
 *
 * **Nothing here is assigned to anyone.** An entry records a computed share of a simulated
 * transaction: it carries no personal identity, no beneficiary account and no entitlement, no such
 * column exists in `ledger_entries`, and none may be added. The founder-allocation contract
 * structure is labelled "to be determined" wherever it is shown, and this module asserts nothing
 * about it beyond the entry it appends. The only identifiers a row built here carries are the
 * simulation's own transaction reference and an explicit `null` report reference.
 *
 * **Insertion only.** The one statement this module reaches is the append of
 * `./ledger-repository`; no row already stored is altered by it. Undoing an allocation is a
 * `reversal` row that `../refunds/reversal-entries.ts` builds — a new row of its own, proportional
 * to what it corrects — and it is not built here: this module only ever allocates.
 */

import type { Database } from "better-sqlite3";

import type { CommerceConfig } from "../config";
import { allocate } from "./allocate";
import type { LedgerEntry, LedgerEntryInput } from "./ledger-types";
import { insertLedgerEntry } from "./ledger-repository";

/**
 * What one founder-allocation append is computed from: the transaction the allocation belongs to,
 * that transaction's net amount, the resolved configuration and an optional clock.
 *
 * The four members are the whole input, and the shape is the eligibility rule stated in the type.
 * `transactionId` and `netAmountMinorUnits` are the only two facts about the source — a transaction
 * identifier and an amount — so a gate-evaluation fee, a sponsored-slot record, an evaluation
 * report, a gross amount or a price cannot be passed in through a member that does not exist. There
 * is deliberately no `source`, no `kind`, no `reportId`, no `grossAmount` and no `netOfFees`: adding
 * any of them would let something other than a net marketplace amount allocate.
 *
 * `netAmountMinorUnits` is a whole number of minor units of the synthetic currency and is named for
 * what it must already be — the net position of the transaction, with its reversals subtracted by
 * the caller. The amount is never negative and never fractional; `allocate` refuses either, so a
 * value that is one raises the documented `RangeError` rather than producing an entry.
 *
 * `config` is the resolved configuration and the only source of the allocation rate, the synthetic
 * currency label and the disclosure label. There is no rate parameter and no label parameter,
 * because a caller free to name either would be free to record an allocation computed from a rate
 * other than the one the product states or to write an amount without its labelling obligation.
 *
 * `now` is the optional injectable clock the append runs under; a caller that needs a fixed instant
 * — a test, a deterministic fixture — supplies one, and a caller that supplies none appends under
 * the system clock.
 */
export interface RecordFounderAllocationInput {
  /** The transaction the allocation is computed from, carried on the entry as its reference. */
  readonly transactionId: string;
  /** The transaction's net amount in whole minor units, with its reversals already subtracted. */
  readonly netAmountMinorUnits: number;
  /** The resolved configuration supplying the rate and both labels. */
  readonly config: CommerceConfig;
  /** The clock this append runs under, defaulting to the system clock when absent. */
  readonly now?: () => string;
}

/**
 * Appends the founder-participation allocation for one eligible completed simulated marketplace
 * transaction and returns the entry it appended.
 *
 * The allocation is computed at the rate the resolved configuration carries, by the product's single
 * rounding point, and the appended entry records the transaction it was computed from, the
 * configuration's synthetic currency and disclosure labels, and — in its description — the
 * basis-point rate it was computed from. One call appends one row, whatever the computed amount is,
 * a zero included.
 *
 * It refuses nothing of its own. The one throw it can make is the `RangeError` {@link allocate}
 * raises for a net amount or a configured rate that is not a non-negative safe integer, or for a
 * product past the range the number type represents exactly; it propagates unwrapped, because such a
 * value is a caller defect rather than an outcome to invent an entry shape for, and no row is
 * appended when it is raised. A failed append reaches the caller unwrapped as well: the database's
 * own foreign-key, `CHECK` and abort-trigger failures are not re-shaped here.
 *
 * @param db The caller's database handle.
 * @param input The transaction the allocation belongs to, its net amount, the resolved configuration
 *   supplying the rate and both labels, and the optional clock.
 * @returns The appended entry: the nine stored values with the generated identifier and instant.
 * @throws {RangeError} From {@link allocate}, if the net amount or the configured rate is not a
 *   non-negative safe integer, or if their product is not one.
 */
export function recordFounderAllocation(
  db: Database,
  input: RecordFounderAllocationInput,
): LedgerEntry {
  // The one call to the product's single rounding point, made once so the amount the entry carries
  // and the rate its description states cannot come from two evaluations that could differ.
  const amountMinorUnits = allocate(
    input.netAmountMinorUnits,
    input.config.founderAllocationRateBasisPoints,
  );

  const entry: LedgerEntryInput = {
    ledger: "founder_allocation",
    entry_type: "allocation",
    direction: "credit",
    amount_minor_units: amountMinorUnits,
    transaction_id: input.transactionId,
    report_id: null,
    currency_label: input.config.currencyLabel,
    disclosure_label: input.config.disclosureLabel,
    description: `Simulated founder allocation of a completed marketplace transaction at ${String(
      input.config.founderAllocationRateBasisPoints,
    )} basis points`,
  };

  // The clock travels only when the caller supplied one: `exactOptionalPropertyTypes` makes a member
  // present and holding an explicit `undefined` a different thing from an absent member, and an
  // absent one is what tells the append to answer with the system clock.
  return input.now === undefined
    ? insertLedgerEntry(db, entry)
    : insertLedgerEntry(db, { ...entry, now: input.now });
}
