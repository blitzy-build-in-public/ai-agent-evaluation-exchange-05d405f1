/**
 * The one presentation of each closed vocabulary a listing carries.
 *
 * A closed vocabulary's value is data: `rent`, `purchase`, `license` and `subscription` are what
 * the API contract, the shared schema's `enum` and the column's `CHECK` constraint hold, while a
 * reader is shown a label. Those are two different strings, and a surface that spells its own label
 * for a shared value renders one vocabulary several ways — a filter reading `Purchase` beside a
 * card reading `purchase` for the same listing. Every surface therefore names such a value through
 * this module, so the presentation is stated once, a change to it is one edit, and no two screens
 * can disagree about how the exchange spells its own vocabulary.
 *
 * Presentation only: nothing here fetches, derives, validates or holds state, and each record below
 * is total over the union `@adem/shared` declares, so a value added to a vocabulary fails the
 * workspace's typecheck here rather than reaching a page as a raw identifier.
 */

import type { PricingModel } from "@adem/shared";

/**
 * The readable name of each pricing model the contract accepts, keyed by the value the payload
 * carries.
 */
export const PRICING_MODEL_LABELS: Readonly<Record<PricingModel, string>> = {
  rent: "Rent",
  purchase: "Purchase",
  license: "License",
  subscription: "Subscription",
};

/**
 * The readable name of one pricing model, for every surface that presents a listing: the search
 * filter's options, a result card, a comparison column, the listing detail page, and the developer
 * page's own summary row and create form.
 */
export function describePricingModel(model: PricingModel): string {
  return PRICING_MODEL_LABELS[model];
}
