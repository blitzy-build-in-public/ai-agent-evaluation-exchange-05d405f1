/**
 * The flat gate-evaluation fee: one charge per completed evaluation, appended to the
 * gate-evaluation-fee ledger and to no other ledger.
 *
 * **One flat fee, whatever the evaluation found.** The fee is the configured flat amount, charged
 * once for each completed evaluation, and it does not vary with what that evaluation reported. That
 * independence is a property of the signature rather than of any arithmetic: this module is handed
 * the completed evaluation's report identifier and the resolved configuration, and nothing else, so
 * no value from which a result could be read is ever in scope. The amount is copied from
 * `config.gateFeeMinorUnits` and never computed, and this module holds no arithmetic at all — the
 * product's single rounding point is the half-up founder-allocation arithmetic in this folder, and
 * no second one belongs on a fee.
 *
 * **The gate-evaluation-fee ledger only, and never an allocation.** A gate fee is journalled in the
 * gate-fee ledger and is never eligible for a founder-participation allocation, so nothing here
 * reaches an allocation writer and no row of that ledger can be appended from this module. The
 * appended row therefore carries `report_id` and an explicit `null` `transaction_id`, which is the
 * pairing `ledger_entries` keeps apart: a fee is attached to the evaluation it was charged for and
 * to no simulated transaction.
 *
 * **Insertion only.** The one statement issued here appends a new row through
 * {@link insertLedgerEntry}, and this module holds no statement of its own. A fee records what
 * happened and is never rewritten: `ledger_entries` is one of the nine append-only tables that
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards with abort triggers, and those
 * triggers are defence in depth rather than a security boundary, since a connection with write access
 * can drop one — what makes the rule hold is that this code appends and that no route offers
 * anything else.
 *
 * **A configured fee of nothing appends nothing.** `resolveCommerceConfig` accepts `0` for the fee
 * and refuses a negative, non-integer, non-finite or unsafe value with a `RangeError`, so the amount
 * read here is already a valid whole number of minor units and the only comparison this module makes
 * is against zero. A zero fee is the configuration stating that it does not apply, and a row
 * recording an amount of nothing would carry no information.
 *
 * **Both labels come from the resolved configuration**, never from a caller: each appended row
 * carries `config.currencyLabel` and `config.disclosureLabel`, so a simulated amount cannot be
 * written without the synthetic currency label and the nonfunctional-demonstration disclosure every
 * amount in this product renders with. The description is a fixed sentence, and it carries no
 * currency symbol, no payment provider and no personal data.
 *
 * **The clock is the caller's.** `now` is optional on the input and is forwarded to the writer, which
 * generates the row's identifier and its insertion instant; the writer falls back to the system clock
 * when no clock is supplied. This module holds no clock and no random source of its own.
 *
 * **No report is read and no HTTP concern lives here.** The evaluation report is referenced by its
 * identifier as a plain column value: this module imports nothing from another workspace, queries no
 * evaluation report and joins nothing. Whether a fee is recorded for a given request, and what status
 * that request is answered with, is the route's decision — the API's evaluation route
 * (`apps/api/src/routes/evaluations.ts`) is this function's only caller, and nothing inside this
 * package invokes it.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable, resolves no path and touches no file.
 */

import type Database from "better-sqlite3";

import type { CommerceConfig } from "../config";
import type { LedgerEntry, LedgerEntryInput } from "./ledger-types";
import { insertLedgerEntry } from "./ledger-repository";

/**
 * The caller's database handle, taken from the driver's own declaration so every module of this
 * package speaks about the same connection type.
 */
type SqliteDatabase = Database.Database;

/**
 * What one gate-evaluation fee is recorded from: the report of the completed evaluation, and the
 * resolved configuration the amount and the two labels come from.
 *
 * `reportId` is an identifier and deliberately not the report: passing the row, or anything read off
 * it, would let the fee depend on what the evaluation found, and a fee that varies with a result is
 * exactly what this product's commercial rules forbid. The identifier is stored as the row's
 * `report_id`; nothing here reads the report it names.
 *
 * `config` is the resolved configuration and the only source of the amount, the currency label and
 * the disclosure label. There is no amount parameter and no label parameter, because a caller free to
 * name either would be free to charge an amount the product does not state or to write an amount
 * without its labelling obligation.
 *
 * `now` is the optional clock the appended row is stamped with, forwarded to the writer, which
 * defaults to the system clock when it is absent. It is a member of the input rather than a further
 * parameter so that a caller holding a batch of fee records can pin each row's instant where the row
 * is built; it is not a member of the row and therefore never reaches the returned entry.
 */
export interface RecordGateFeeChargeInput {
  /** Identifier of the completed evaluation's report, which the appended row carries. */
  readonly reportId: string;
  /** The resolved configuration: the only source of the amount and of both labels. */
  readonly config: CommerceConfig;
  /** The clock the appended row is stamped with; the system clock when none is supplied. */
  readonly now?: () => string;
}

/**
 * Appends the gate-evaluation fee of one completed evaluation to the gate-evaluation-fee ledger, and
 * returns the entry that was appended.
 *
 * The entry is a `charge` on the `debit` side of the `gate_fees` ledger, carrying the configured flat
 * amount, the report identifier it was charged for, an explicit `null` transaction reference and the
 * configuration's two labels. It is returned as the row was built rather than as a re-read of it —
 * which proves nothing either way, since an append-only row cannot have changed — so the caller's
 * `201` payload can be built from it.
 *
 * It answers `null` and appends nothing when the configured fee is zero, which is the configuration
 * stating that the fee does not apply. That is the only branch in the function and the only way it
 * can answer with nothing.
 *
 * It refuses nothing: the amount is read from a configuration that has already refused any value
 * which is not a non-negative whole number of minor units, the report is referenced by an identifier
 * that is stored as given and never resolved against anything, and every other refusal on this path
 * is taken before the call — the request schema at the edge and the route's own ownership check. The
 * only failures that can surface from here are the database's own — the foreign keys, the `CHECK`
 * constraints including the pair that keeps a transaction reference and a report reference from
 * co-occurring, and the abort triggers of
 * `packages/shared/migrations/0010_append_only_triggers.sql` — and they propagate unwrapped rather
 * than being re-shaped into an answer this module would have to invent.
 *
 * @param db The caller's database handle.
 * @param input The report identifier, the resolved configuration and the optional clock.
 * @returns The appended entry, or `null` when the configured fee is zero and nothing was appended.
 */
export function recordGateFeeCharge(
  db: SqliteDatabase,
  input: RecordGateFeeChargeInput,
): LedgerEntry | null {
  if (input.config.gateFeeMinorUnits === 0) {
    return null;
  }

  const entry: LedgerEntryInput = {
    ledger: "gate_fees",
    entry_type: "charge",
    direction: "debit",
    amount_minor_units: input.config.gateFeeMinorUnits,
    transaction_id: null,
    report_id: input.reportId,
    currency_label: input.config.currencyLabel,
    disclosure_label: input.config.disclosureLabel,
    description: `Simulated gate evaluation fee for report ${input.reportId}`,
  };

  // The clock is passed only when the caller supplied one, so the object handed to the writer either
  // carries a clock of its own or carries no clock member at all: with `exactOptionalPropertyTypes` a
  // member written as `undefined` is not the same as an absent one, and the writer's own default is
  // what an absent member selects.
  return input.now === undefined
    ? insertLedgerEntry(db, entry)
    : insertLedgerEntry(db, { ...entry, now: input.now });
}
