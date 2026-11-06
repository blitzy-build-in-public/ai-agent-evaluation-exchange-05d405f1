/**
 * Which offer a listing makes, and which it does not.
 *
 * A listing may make the same capability available under more than one of the four offer models,
 * each at its own amount. `selectOffer` resolves the model a caller names against the offers the
 * listing actually makes, so the caller's own offer set is the only price source on this path: no
 * amount is ever read from a request, and no default, fee or converted amount stands in for a
 * missing one.
 *
 * The two refusals are the two halves of what the checkout contract answers with when a selection
 * cannot be priced. A model the listing does not make is its `422` (`not_offered`), and a matched
 * offer whose amount is not a whole number of minor units is its `400` (`invalid_amount`). The
 * first is decided before the second, so an unoffered model is refused as unoffered even when
 * another entry in the same list carries a malformed amount; that order is a decision rather than
 * an accident, and `selectOffer` states it again where a reader meets it.
 *
 * The module is pure and holds no state: no clock, no random source, no environment, no I/O and no
 * database. The same offers and the same requested model therefore yield the same result, which is
 * what makes a selection assertable in a unit test rather than observable only in a running system.
 */

import type { OfferModel } from "@adem/shared";

/**
 * One offer a listing makes: the model it is made under and the amount it is made at.
 *
 * `amountMinorUnits` is a whole count of minor units of the synthetic currency `DEMO` — a
 * non-negative integer, never a fractional amount, and never a real currency code or symbol. The
 * entry is assembled by the caller from the listing's own offers, so the amount here is the
 * listing's price rather than a client's: nothing on the request path supplies one.
 *
 * Both fields are readonly because an entry is handed back to the caller exactly as it arrived —
 * a selection narrows an offer set, it does not build a price.
 */
export interface ListingOffer {
  /** The offer model this entry makes, one of the four the shared vocabulary declares. */
  readonly model: OfferModel;
  /** Amount the offer is made at, in whole minor units of the synthetic currency label. */
  readonly amountMinorUnits: number;
}

/**
 * Why a selection was refused, as the two outcomes the checkout contract answers with: an offer
 * model the listing does not make is its `422`, and an offer whose amount is not a whole number of
 * minor units is its `400`.
 */
export type OfferSelectionRefusalReason = "not_offered" | "invalid_amount";

/**
 * The outcome of a selection: either the entry the listing makes under the requested model, or the
 * one reason it could not be selected.
 *
 * A discriminated result rather than a thrown error or a nullable entry, because a refusal is an
 * ordinary outcome of the checkout path — a buyer may name a model the listing does not make — and
 * the caller needs the reason to answer with the contract's status. The selected entry is the
 * caller's own object, never a copy, so the amount a caller reads is the amount the listing made.
 */
export type OfferSelection =
  | { readonly ok: true; readonly offer: ListingOffer }
  | { readonly ok: false; readonly reason: OfferSelectionRefusalReason };

/**
 * Resolves the offer a listing makes under the requested model.
 *
 * Returns `{ ok: true, offer }` carrying the entry from `offers` itself — the same object the
 * caller passed in, with its amount carried through untouched — or `{ ok: false, reason }` with one
 * of the two refusals. Nothing is copied, re-shaped, rounded or priced here: an amount invented at
 * this point would be a price the listing never made.
 *
 * The refusals are decided in this order, and the order is a decision:
 *
 * 1. The requested model does not appear in `offers` — an empty offer set included — and the result
 *    is `not_offered`, whatever the amounts of the entries that are present. A listing that does not
 *    make the model cannot be priced at all, so nothing further is read.
 * 2. The matched entry's amount is not a non-negative safe integer, and the result is
 *    `invalid_amount`. `Number.isSafeInteger` refuses a negative amount, a fractional one, a
 *    non-finite one and anything past the safe integer range in a single test, and no amount is
 *    adjusted on the way out. The check applies to the matched entry only: an entry the caller did
 *    not select is never inspected.
 *
 * A malformed amount cannot arrive from a request — the checkout body carries no amount, and the
 * offers are assembled server-side from the listing's own data — so that branch is normally
 * unreachable over HTTP. It is a refusal rather than a trusted value all the same, because this
 * function is public to any caller of the package and a malformed offer reaching the domain must
 * not become a transaction.
 *
 * Pure and total over the two declared argument types: it reads no clock, no random source, no
 * environment and no database, never mutates, sorts or reorders `offers` — a frozen array or one
 * declared `as const` type-checks — and answers one of the two result shapes rather than throwing.
 *
 * @param offers The offers the listing makes, in the order the listing states them. The first entry
 *   whose model matches the request is selected: a listing that states one model twice is a
 *   data-integrity problem owned by the seed and the schema, and summing or preferring the largest
 *   of two duplicates would invent pricing behaviour nothing asks for.
 * @param requested The offer model the caller selected.
 * @returns The selected offer, or the reason the selection was refused.
 */
export function selectOffer(
  offers: readonly ListingOffer[],
  requested: OfferModel,
): OfferSelection {
  // The lookup is typed as possibly absent because an offer set is data the caller assembled, not a
  // promise about its contents; that absent case is exactly what the first refusal answers.
  const matched = offers.find((offer) => offer.model === requested);

  if (matched === undefined) {
    return { ok: false, reason: "not_offered" };
  }

  if (!Number.isSafeInteger(matched.amountMinorUnits) || matched.amountMinorUnits < 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  return { ok: true, offer: matched };
}
