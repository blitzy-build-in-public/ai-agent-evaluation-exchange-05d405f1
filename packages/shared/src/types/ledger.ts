/**
 * The three ledgers, the closed vocabularies an entry is drawn from, and the append-only shape of
 * one `ledger_entries` row.
 *
 * One table holds all three ledgers and the `ledger` discriminator is the only thing that separates
 * them: the marketplace ledger, the gate-evaluation-fee ledger and the founder-participation
 * allocation ledger. That is why each of the three operator reads filters on the discriminator
 * rather than joining three tables, and why the discriminator is a closed list here rather than a
 * free string.
 *
 * The three keep separate meaning, not merely separate rows. A gate-evaluation fee is recorded in
 * the gate-fee ledger only and is never eligible for an allocation; the founder allocation applies
 * only to an eligible completed simulated marketplace transaction, and never to that fee or to a
 * record of any other commercial arrangement. Nothing here measures anything: no field in this module
 * names a commercial agreement or an evaluation result, so no commercial value reaches an evaluation
 * through this shape.
 *
 * Declarations only — the closed lists, the aliases they derive and the row shapes. The half-up
 * arithmetic lives in `packages/commerce-sim/src/ledgers/allocate.ts`, the eligibility rule in
 * `packages/commerce-sim/src/ledgers/founder-allocation.ts`, and the only reads are the three
 * operator-only routes in `apps/api/src/routes/ledgers.ts`.
 */

import type { MinorUnits } from "./commerce";
import { SYNTHETIC_CURRENCY_LABEL } from "../constants";

/**
 * The three ledgers, in the order the contract table's operator reads name them.
 *
 * The list is closed. A fourth ledger would change what the fee and allocation rules separate, so it
 * arrives by a reviewed change to the contract rather than by writing another `ledger` value.
 * `gate_fees` and `founder_allocation` are as much a part of the separation as `marketplace` is: a
 * gate-evaluation fee recorded anywhere else, or an allocation computed from one, would break the
 * rule that commercial payments are journalled apart from each other and away from measurement.
 */
export const LEDGER_NAMES = ["marketplace", "gate_fees", "founder_allocation"] as const;

/** One of {@link LEDGER_NAMES} — the ledger a row belongs to. */
export type LedgerName = (typeof LEDGER_NAMES)[number];

/**
 * The kinds of entry a ledger row may record, in the order they arise in a transaction's life.
 *
 * `charge` is money the simulation takes in, `allocation` is the founder-participation share
 * computed from an eligible completed marketplace transaction, and `reversal` is the correction a
 * refund appends. A reversal is a new row of this kind and never an edit to the row it corrects,
 * which is what lets a ledger be read as history rather than as a balance.
 */
export const LEDGER_ENTRY_TYPES = ["charge", "allocation", "reversal"] as const;

/** One of {@link LEDGER_ENTRY_TYPES} — the kind of entry a row records. */
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/**
 * The side of the ledger one row falls on.
 *
 * This vocabulary is this module's own definition: the plan fixes the `direction` column but not the
 * words in it, so read it from here rather than looking for a specification that does not exist.
 *
 * The kind of an entry is carried by {@link LedgerEntry.entry_type}, and `direction` records only
 * which side of the ledger the entry falls on. Amounts therefore stay non-negative integers of minor
 * units and no negative amount is ever stored — a reader who takes `direction` for the sign of the
 * amount would build a second, contradictory rule on top of the first.
 */
export const LEDGER_DIRECTIONS = ["debit", "credit"] as const;

/** One of {@link LEDGER_DIRECTIONS} — the side of the ledger a row falls on. */
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/**
 * One row of `ledger_entries`, owned by `@adem/commerce-sim` and written only by the simulated
 * commerce path.
 *
 * The row references **either** a transaction **or** a report and **never both**: a gate-fee entry
 * carries the `report_id` it was charged for, while a marketplace charge, its allocation or that
 * allocation's reversal carries the `transaction_id`. Exactly one of the two is populated; both are
 * non-optional fields holding `null` for the absent side, because an optional field would admit an
 * explicitly written `undefined`, which no reader of a serialized row expects.
 *
 * Every entry carries the synthetic currency label — the value of
 * {@link SYNTHETIC_CURRENCY_LABEL}, backed by the `CHECK (currency_label = <that label>)` constraint
 * in `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql`. No real currency code and no
 * currency symbol exists anywhere in the product, and no column of this table can hold one.
 *
 * The row is **append-only**: the only write it accepts is an inserted new row. A refund therefore
 * appends a reversal entry proportional to the refunded amount rather than editing the entry it
 * corrects, and the net position of a transaction is derived by reading its rows. That is why the
 * shape carries no amended-at field, no status field and no reversed flag — any of them would be a
 * mutable column on a table whose history is the guarantee. The `BEFORE UPDATE` and `BEFORE DELETE`
 * triggers in `packages/shared/migrations/0010_append_only_triggers.sql` stand behind that rule as
 * defence in depth and never as a security boundary, since a connection with write access can drop
 * one; what makes it hold is that no route updates or deletes such a row.
 *
 * The founder-allocation ledger **carries no personal identity, beneficiary account or entitlement**,
 * its contract structure being labelled "to be determined" wherever it is shown — the copy constant
 * `FOUNDER_ALLOCATION_CONTRACT_LABEL`, owned by `packages/shared/src/constants.ts` and rendered by
 * the UI. An entry's amount is a computed share of a simulated transaction, and nothing in this
 * shape assigns it to anyone.
 */
export interface LedgerEntry {
  /** Primary key of the row, generated when it is inserted. */
  id: string;
  /** The ledger this row belongs to, from the closed list above. */
  ledger: LedgerName;
  /** What the row records: a `charge`, an `allocation` or a `reversal`. */
  entry_type: LedgerEntryType;
  /** Which side of the ledger the row falls on; see {@link LEDGER_DIRECTIONS}. */
  direction: LedgerDirection;
  /**
   * The amount, as a non-negative whole number of minor units of the synthetic currency — the label
   * {@link SYNTHETIC_CURRENCY_LABEL} names, and the only currency the product has.
   *
   * Typed as {@link MinorUnits} rather than `number` so the unit travels with the value: a rate in
   * basis points and a case count are plain numbers and must not be read as this.
   */
  amount_minor_units: MinorUnits;
  /**
   * `transactions.id` for a marketplace charge, its allocation or a reversal of either, and an
   * explicit `null` for a gate-fee entry. Never populated together with {@link report_id}.
   */
  transaction_id: string | null;
  /**
   * `evaluation_reports.id` for a gate-evaluation fee and an explicit `null` for a marketplace
   * entry. Never populated together with {@link transaction_id}.
   */
  report_id: string | null;
  /**
   * The currency label, whose only legal value is {@link SYNTHETIC_CURRENCY_LABEL}. Referenced as a
   * type query so the literal is defined once, in `packages/shared/src/constants.ts`.
   */
  currency_label: typeof SYNTHETIC_CURRENCY_LABEL;
  /**
   * The disclosure label every simulated amount renders with, stating that the transaction is a
   * nonfunctional demonstration. Required rather than optional: an amount a reader could mistake for
   * a real one is a defect, so a row cannot be written without it.
   */
  disclosure_label: string;
  /** Plain-language description of what the entry records, readable by an operator. */
  description: string;
  /** Insert time, as an ISO-8601 UTC string written when the row is created. */
  created_at: string;
}

/**
 * The response of each of the three operator ledger reads — `GET /ledger/marketplace`,
 * `GET /ledger/gate-fees` and `GET /ledger/founder-allocation`.
 *
 * Entries are returned in insertion order, so the history reads as it happened and a reversal
 * appears after the entry it corrects. A ledger with no rows answers with an empty `entries` array
 * and no error: an unused ledger is a state, not a failure.
 */
export interface LedgerReadResult {
  /** Which of the three ledgers these entries were read from. */
  ledger: LedgerName;
  /** Every entry of that ledger, in insertion order. */
  entries: LedgerEntry[];
}

/**
 * The response of `GET /ledger/founder-allocation`, which additionally exposes the configured rate
 * its entries were computed from.
 *
 * The rate is an integer number of basis points — the default is 25, meaning 0.25 per cent — and
 * never a percentage expressed as a fraction of a whole, so the value read back is exactly the value
 * the allocation used, with no rounding and no precision lost on the way out. It is read from the commerce simulation's
 * configuration (`packages/commerce-sim/src/config.ts`), and it is exposed because an amount is only
 * interpretable beside the rate that produced it; the rows themselves stay the record of what was
 * actually computed.
 */
export interface FounderAllocationLedgerReadResult extends LedgerReadResult {
  /** The configured allocation rate, in whole basis points. */
  rate_basis_points: number;
}
