/**
 * The version-scoped offer set's contract, pinned to what the module documents: the models one
 * version's claims state are that version's whole offered set, in the vocabulary's own order with a
 * repeated model yielding one entry, and the listing row's declared model is the answer for a version
 * that names no claim at all.
 *
 * Expectations are stated as values rather than recomputed from the module or from `OFFER_MODELS`, so
 * a change to the vocabulary or to the filter fails here instead of agreeing with whatever it finds.
 * The case this module exists to resolve is the first one below: a version whose claim names a model
 * the listing row does not declare must offer that claim alone, because the claim alone is what the
 * checkout route prices for that version — offering the listing-level union instead is what a buyer
 * could select and the service would answer `422 not_offered` for.
 */

import { describe, expect, it } from "vitest";

import type { OfferModel, PricingModel } from "@adem/shared";

import { offerModelsForVersion } from "./listing-offers";

/**
 * A claimed model the listing row does not declare, with the set it alone must produce: the listing's
 * own model is absent from every expectation below.
 */
const CLAIMS_THE_LISTING_DOES_NOT_DECLARE: ReadonlyArray<{
  readonly label: string;
  readonly claimed: readonly PricingModel[];
  readonly listingModel: PricingModel;
  readonly expected: readonly OfferModel[];
}> = [
  {
    label: "a license claimed under a purchase listing",
    claimed: ["license"],
    listingModel: "purchase",
    expected: ["license"],
  },
  {
    label: "a purchase claimed under a license listing, read twice",
    claimed: ["purchase", "purchase"],
    listingModel: "license",
    expected: ["purchase"],
  },
  {
    label: "a rent claimed under a subscription listing",
    claimed: ["rent"],
    listingModel: "subscription",
    expected: ["rent"],
  },
];

/** The same claimed models read in different orders, each with the one order this set is returned in. */
const CLAIM_ORDERS: ReadonlyArray<{
  readonly label: string;
  readonly claimed: readonly PricingModel[];
  readonly expected: readonly OfferModel[];
}> = [
  {
    label: "the vocabulary's own order",
    claimed: ["rent", "license"],
    expected: ["rent", "license"],
  },
  {
    label: "the vocabulary in reverse",
    claimed: ["license", "rent"],
    expected: ["rent", "license"],
  },
  {
    label: "a subscription read before a rent",
    claimed: ["subscription", "rent"],
    expected: ["rent", "subscription"],
  },
  {
    label: "a license read between two purchased claims",
    claimed: ["purchase", "license", "purchase"],
    expected: ["purchase", "license"],
  },
  {
    label: "all four read from the last to the first",
    claimed: ["subscription", "license", "purchase", "rent"],
    expected: ["rent", "purchase", "license", "subscription"],
  },
];

/** A model the listing row declares, and the set alone that prices a version stating no claim. */
const LISTING_MODELS: ReadonlyArray<{
  readonly label: string;
  readonly listingModel: PricingModel;
  readonly expected: readonly OfferModel[];
}> = [
  { label: "rent", listingModel: "rent", expected: ["rent"] },
  { label: "purchase", listingModel: "purchase", expected: ["purchase"] },
  { label: "license", listingModel: "license", expected: ["license"] },
  { label: "subscription", listingModel: "subscription", expected: ["subscription"] },
];

/** A version that names no claim at all, which is the input the listing's own model prices. */
const NO_CLAIMS: readonly PricingModel[] = [];

describe("offerModelsForVersion", () => {
  it.each(CLAIMS_THE_LISTING_DOES_NOT_DECLARE)(
    "offers the version's claim alone, and not the listing's declared model, for $label",
    ({ claimed, listingModel, expected }) => {
      expect(offerModelsForVersion(claimed, listingModel)).toEqual(expected);
    },
  );

  it.each(CLAIM_ORDERS)(
    "returns the claimed models in the vocabulary's order whatever order they were read in: $label",
    ({ claimed, expected }) => {
      expect(offerModelsForVersion(claimed, "purchase")).toEqual(expected);
    },
  );

  it.each(LISTING_MODELS)(
    "offers exactly the listing's declared model when the version states no claim: $label",
    ({ listingModel, expected }) => {
      expect(offerModelsForVersion(NO_CLAIMS, listingModel)).toEqual(expected);
    },
  );

  it("returns a fresh array, so a caller cannot reach the vocabulary through what it is handed", () => {
    const offered = offerModelsForVersion(["rent"], "rent");

    expect(offered).toEqual(["rent"]);
    expect(offered).not.toBe(offerModelsForVersion(["rent"], "rent"));
  });
});
