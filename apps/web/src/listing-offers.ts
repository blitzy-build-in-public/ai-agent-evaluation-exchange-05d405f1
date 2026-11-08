/**
 * The offer models one version of a listing is priced at: the offers that version itself states, and
 * none of the offers only its siblings make.
 *
 * A listing's offers are not one set. `ListingDetail.offer_models` is the listing-level union — the
 * model the listing row declares plus every model any of its versions claims — and it is what the
 * listing page renders as the listing's offering. A checkout is a buyer's act on **one version**, and
 * the service prices that version alone: `offersForListing` in `apps/api/src/routes/checkout.ts`
 * collects the claims recorded for the submitted `listing_version_id`, falls back to the pricing model
 * the listing row declares when that version states no claim, and answers `422 not_offered` for a
 * selection outside what it collected. That function is the rule this module mirrors, and the two must
 * agree: a radio this module does not return is a radio the service refuses. Offering more than the
 * route prices — which is what the listing-level union does as soon as one listing's versions claim
 * different models — would put a control on screen that a buyer can select and that the service then
 * rejects.
 *
 * **The set is returned in the vocabulary's own order, without repeats.** `OFFER_MODELS` decides the
 * order, so the same offers always read in the same order whichever order the claims arrived in, and a
 * model claimed twice yields one entry: the radios share one group name, so a second entry would be a
 * second control for a value that is already selectable. Nothing is priced here — the amounts live in
 * `@adem/commerce-sim` and no price reaches the client before the request.
 *
 * **A claim the vocabulary does not know is not an offer.** The claimed models are filtered to the
 * four-member vocabulary rather than asserted into it, which is the same treatment the route gives a
 * stored claim row it cannot map, so a payload carrying a model no price exists for renders no radio.
 *
 * **A version that states no such claim is priced at the model the listing row declares.** A version a
 * developer has just published has no claim recorded against it yet, and the route prices it from the
 * listing row's own `pricing_model`; this module returns that model for the same case, so a freshly
 * published version stays checkable. When neither the version's claims nor that model names an offer
 * the vocabulary knows, the answer is an empty array — the route's own zero-offer case, which the
 * domain refuses with `not_offered` — and the panel renders an explanation in its place rather than an
 * empty control.
 */

import { OFFER_MODELS } from "@adem/shared";
import type { OfferModel, PricingModel } from "@adem/shared";

/**
 * The offer models one version of a listing is priced at, in {@link OFFER_MODELS} order.
 *
 * @param claimedModels The pricing models of the claims recorded for the version being bought, in the
 *   order the payload states them. A model stated more than once yields one entry, and a model the
 *   vocabulary does not know yields none.
 * @param listingModel The pricing model the listing row declares, which prices a version that names no
 *   claimed model the vocabulary knows.
 * @returns The version's offered models; or the listing's declared model when the version names no
 *   claimed model; or an empty array when neither names one of the vocabulary's four models.
 */
export function offerModelsForVersion(
  claimedModels: readonly PricingModel[],
  listingModel: PricingModel,
): OfferModel[] {
  const claimed: OfferModel[] = OFFER_MODELS.filter(
    (model: OfferModel): boolean => claimedModels.includes(model),
  );

  if (claimed.length > 0) {
    return claimed;
  }

  return OFFER_MODELS.filter((model: OfferModel): boolean => model === listingModel);
}
