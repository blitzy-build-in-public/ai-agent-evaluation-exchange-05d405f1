/**
 * The atomic simulated checkout: one buyer's offer selection turned into one stored transaction and
 * the two ledger entries that transaction produces, written together so the checkout either
 * completes entirely or stores nothing at all.
 *
 * **One call, one checkout, and never a partial one.** Three rows are written — the `transactions`
 * row, the marketplace charge taken in by it, and the founder-participation allocation computed from
 * that charge — inside one `db.transaction(...)`, so a failure at any of the three rolls the earlier
 * ones back and a checkout that throws is a checkout that stored nothing. The order is load-bearing:
 * the transaction row first, because both entries reference its identifier; then the marketplace
 * charge, because the allocation is computed from the amount that charge journals; then the
 * allocation. The returned `ledgerEntries` array is in that same write order.
 *
 * **Both refusals are decided before the transaction opens.** `selectOffer` runs outside it and its
 * two refusals are returned as they are: an offer model the listing does not make (`not_offered`,
 * the checkout contract's `422`) and a matched offer whose amount is not a whole number of minor
 * units (`invalid_amount`, which the request schema refuses at the edge first). Nothing has been
 * written when either is decided, so a refusal leaves zero `transactions` rows and zero
 * `ledger_entries` rows — the property that distinguishes "refused" from "refused after a partial
 * write". A listing that does not exist is the route's own `404` and is not a reason here: this
 * function is handed the offers of a listing the caller has already resolved.
 *
 * **`config` is resolved with `??`, and that is not a style choice.** `exactOptionalPropertyTypes`
 * makes an optional member exact: `config?: CommerceConfig` may be absent, but a caller may not write
 * `config: undefined` to it, so a destructuring default would be a type error against the optional
 * member while `??` reads the absent case correctly. The resolved configuration is the only source
 * of both labels a row carries, so a caller that omits it gets the product's own labels rather than
 * a row without them.
 *
 * **The clock is resolved once and threaded into all three writers**, so the transaction and the two
 * entries beside it cannot disagree about when the checkout happened. Absent, the system clock
 * answers; supplied, one instant stamps everything this call writes.
 *
 * **No arithmetic, no gate fee, and no price from the client.** The allocation is computed inside
 * `recordFounderAllocation` by the product's single rounding point
 * (`../ledgers/allocate`), so this module multiplies nothing, rounds nothing and formats nothing. A
 * gate-evaluation fee is charged per completed evaluation, PASS or FAIL, in the gate-fee ledger by
 * `recordGateFeeCharge`, whose only caller is the evaluation route; a marketplace transaction is
 * never eligible for one, no member of the input could carry one, and that writer is not reached
 * from this file. The amount is the amount the listing's own offer was made at:
 * {@link CreateCheckoutSimulationInput} declares no amount member at all, so a client cannot name
 * the price of its own simulated purchase.
 *
 * **Insertion only, and nothing here measures anything.** Every row this module writes is an INSERT
 * reached through the sibling writers; no statement against `transactions` or `ledger_entries`
 * appears in this file, and neither table accepts any other kind of write. Both are among the nine
 * append-only tables, and the abort triggers of
 * `packages/shared/migrations/0010_append_only_triggers.sql` stand behind them as defence in depth
 * rather than as a security boundary. Nothing written here is read by an evaluation, and no
 * commercial or sponsored data can reach a measurement through this path: the module imports no
 * scoring code and writes nothing a report reads, which is the trust separation stated as an absent
 * import edge rather than as a rule.
 *
 * **Nothing written here belongs to anyone, and no payment exists.** A row records a simulated
 * checkout by a synthetic buyer account: it carries no personal name, no contact detail and no
 * financial reference, and no amount is a real currency. The founder allocation records a computed
 * share of a simulated transaction and assigns it to no one.
 *
 * **Ports and adapters.** The database handle belongs to the caller: this module opens no
 * connection, reads no environment variable, resolves no path and touches no file.
 */

import type { OfferModel, Transaction } from "@adem/shared";
import type { Database } from "better-sqlite3";

import { resolveCommerceConfig } from "../config";
import type { CommerceConfig } from "../config";
import { recordFounderAllocation } from "../ledgers/founder-allocation";
import type { LedgerEntry } from "../ledgers/ledger-types";
import { recordMarketplaceCharge } from "../ledgers/marketplace";
import { selectOffer } from "../offers/select-offer";
import type { ListingOffer } from "../offers/select-offer";
import { insertTransaction } from "./checkout-repository";

/**
 * What one simulated checkout is run from: the listing and the version being purchased, the offer
 * model the buyer selected, the offers the listing makes under it, the buyer account running the
 * checkout, and two optional inputs — the configuration to resolve amounts and labels from, and the
 * clock the whole checkout is stamped with.
 *
 * `offers` is the listing's own offer set, resolved by the caller before this function is reached,
 * and it is the only price source on this path. It is a `readonly` array because `selectOffer`
 * accepts one and because a selection narrows an offer set rather than changing it: a frozen array
 * or one declared `as const` type-checks here.
 *
 * There is deliberately **no amount member**. The amount of a simulated purchase is the amount the
 * selected offer was made at, so a price cannot enter this call from a request, which is why the
 * checkout body in `packages/shared/src/schemas/commerce-schema.ts` carries no amount either.
 *
 * `config` and `now` are the two members `exactOptionalPropertyTypes` makes exact: each may be
 * absent, and a caller that means "use the default" omits the member rather than passing
 * `undefined` to it.
 */
export interface CreateCheckoutSimulationInput {
  /** Identifier of the listing the simulated purchase is made from. */
  listingId: string;
  /** Identifier of the listing version the simulated purchase is made for. */
  listingVersionId: string;
  /** The offer model the buyer selected, one of the four the shared vocabulary declares. */
  offerModel: OfferModel;
  /** The offers the listing makes, and the only source of the amount charged. */
  offers: readonly ListingOffer[];
  /** Identifier of the buyer account running the simulated checkout. */
  buyerAccountId: string;
  /**
   * The configuration the amount's labels and the allocation rate are resolved from. Absent, the
   * product's own resolved defaults answer.
   */
  config?: CommerceConfig;
  /** The clock the transaction and both ledger entries are stamped with. Absent, the system clock. */
  now?: () => string;
}

/**
 * Why a simulated checkout was refused, as the two reasons the offer selection can give: an offer
 * model the listing does not make, and a matched offer whose amount is not a whole number of minor
 * units.
 *
 * The union is exactly these two, because the only domain-level refusals on this path are "the
 * listing does not make that offer" and "the resolved amount is not a valid number of minor units".
 * `not_offered` becomes the contract's `422` at the route, and `invalid_amount` is the `400` the
 * request schema answers with at the edge before a handler runs. A listing or version that does not
 * exist is the route's `404` and is decided before this function is reached, so there is no third
 * reason for it here.
 */
export type CheckoutSimulationRefusalReason = "not_offered" | "invalid_amount";

/**
 * What a completed simulated checkout produced: the stored transaction, and the ledger entries
 * appended beside it in the order they were written — the marketplace charge first, then the founder
 * allocation computed from it.
 *
 * The transaction is the row as it was written, carrying the boolean `true` in `simulated` that the
 * checkout contract's `201` payload states, the synthetic currency label and the disclosure label.
 * Its `amount_minor_units` is the amount the selected offer was made at: whole minor units of the
 * synthetic currency, never a real currency code or symbol, and never a value a client supplied.
 *
 * Both members are plain rather than `readonly`, and the entries are a mutable array, because this is
 * what a route hands on: the API's checkout route builds its `201` body from these values, and a
 * `readonly` array would not be assignable to the mutable one at that call site.
 */
export interface CheckoutSimulationResult {
  /** The checkout completed and its rows were written. */
  ok: true;
  /** The stored transaction, with `simulated: true` and the disclosure label. */
  transaction: Transaction;
  /** The entries appended beside it, in write order: the marketplace charge, then the allocation. */
  ledgerEntries: LedgerEntry[];
}

/**
 * Runs one simulated checkout: resolves the offer the listing makes under the requested model, then
 * writes the transaction and the two ledger entries it produces inside one transaction.
 *
 * The outcome is a discriminated result rather than a thrown error, because a refusal is an ordinary
 * outcome of the checkout path — a buyer may name a model the listing does not make — and the caller
 * needs the reason to answer with the contract's status.
 *
 * What it returns: on success, {@link CheckoutSimulationResult} carrying the stored transaction, with
 * the boolean `true` in `simulated`, the synthetic currency label, the disclosure label and the
 * injected instant, and the two appended entries in write order. On refusal,
 * `{ ok: false, reason }` with one of the two {@link CheckoutSimulationRefusalReason} members, and
 * **no row written**: the third write this call would have performed never happens, so a refused
 * checkout leaves the store exactly as it found it.
 *
 * What it refuses: a model the listing does not make, decided before anything is written, and an
 * offer whose amount is not a whole, non-negative, exactly representable count of minor units. It
 * creates no listing, no version and no account: the identifiers it is given are references the
 * caller established, and a reference that does not exist is refused by the database's own foreign
 * keys rather than repaired here.
 *
 * What it propagates: the database's own failures, unwrapped, and the `RangeError` the allocation
 * arithmetic raises when a net amount or a configured rate is not a whole non-negative count. Either
 * one rolls the whole checkout back, because all three writes sit inside one transaction; nothing is
 * caught, re-shaped or continued past here, since a half-written checkout is the one outcome this
 * function exists to make impossible.
 *
 * @param db - The caller's database handle, whose pragmas and migrations the caller owns.
 * @param input - The listing, version, offer model, offers, buyer and the two optional inputs.
 * @returns The stored transaction with its ledger entries, or the reason the selection was refused.
 */
export function createCheckoutSimulation(
  db: Database,
  input: CreateCheckoutSimulationInput,
): CheckoutSimulationResult | { ok: false; reason: CheckoutSimulationRefusalReason } {
  // The selection is taken before the transaction opens, and that order is the refusal contract: a
  // refusal must leave the store untouched, so nothing may be written before the offer is chosen.
  const selection = selectOffer(input.offers, input.offerModel);

  if (!selection.ok) {
    return { ok: false, reason: selection.reason };
  }

  // `??` rather than a destructuring default: `config` is an exact optional member, so it may be
  // absent while `config: undefined` may not be passed, which is the case `??` reads and a default
  // in a destructuring pattern would not compile against.
  const config = input.config ?? resolveCommerceConfig();

  // One clock for the whole checkout, resolved once and handed to all three writers: a second
  // resolution could stamp the entries with an instant other than the transaction's.
  const now = input.now ?? ((): string => new Date().toISOString());

  // The callback is synchronous on purpose: better-sqlite3 runs on the calling thread, and a
  // callback returning a promise throws rather than committing. Returning the transaction's own
  // value is what makes the three writes one act — the earlier rows are rolled back when any of
  // them fails.
  return db.transaction((): CheckoutSimulationResult => {
    const transaction = insertTransaction(
      db,
      {
        buyer_account_id: input.buyerAccountId,
        listing_id: input.listingId,
        listing_version_id: input.listingVersionId,
        offer_model: selection.offer.model,
        // The amount the listing's own offer was made at, never a client's.
        amount_minor_units: selection.offer.amountMinorUnits,
        currency_label: config.currencyLabel,
        simulated: true,
        disclosure_label: config.disclosureLabel,
      },
      { now },
    );

    const marketplaceEntry = recordMarketplaceCharge(db, {
      transactionId: transaction.id,
      amountMinorUnits: transaction.amount_minor_units,
      config,
      now,
    });

    const allocationEntry = recordFounderAllocation(db, {
      transactionId: transaction.id,
      // Nothing has been refunded yet, so the transaction's own amount is its net amount. A later
      // refund appends reversal rows; this initial allocation is never recomputed from them.
      netAmountMinorUnits: transaction.amount_minor_units,
      config,
      now,
    });

    return { ok: true, transaction, ledgerEntries: [marketplaceEntry, allocationEntry] };
  })();
}
