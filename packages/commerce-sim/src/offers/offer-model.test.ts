import { describe, expect, it } from "vitest";

import { OFFER_MODELS, isOfferModel } from "./offer-model";

/**
 * Values that are not an offer model, in the shapes an untyped caller actually reaches: a
 * different string, an empty string, an absent value, the other primitives, and the container
 * shapes that carry a model's text without being the model. Two of these exist to catch a
 * specific rewrite rather than a typo. The boxed `String` is an object rather than a string
 * primitive, so a guard that coerced its argument instead of testing its type would accept
 * it; and the symbol is the one primitive most conversions throw on, so it is the case that
 * proves the guard refuses without raising.
 */
const nonModelValues: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: "a different string", value: "lease" },
  { label: "an empty string", value: "" },
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "zero", value: 0 },
  { label: "true", value: true },
  { label: "a symbol", value: Symbol("rent") },
  { label: "a plain object", value: {} },
  { label: "an empty array", value: [] },
  { label: "an array holding a model", value: ["rent"] },
  { label: "a boxed String holding a model", value: new String("rent") },
];

describe("isOfferModel", () => {
  describe("the shared vocabulary", () => {
    it.each([...OFFER_MODELS])("accepts %s", (model) => {
      expect(isOfferModel(model)).toBe(true);
    });

    it("holds exactly four models, each distinct", () => {
      // The anti-drift check for the vocabulary the `POST /checkout-simulations` body
      // validates against and migration `0002` constrains with a `CHECK`. A fifth model, or a
      // model listed twice, would widen the checkout contract and the offer display without a
      // plan revision, and the duplicate would surface at the `export *` in `@adem/shared` as
      // a name collision rather than as a wrong count.
      expect(OFFER_MODELS).toHaveLength(4);
      expect(new Set(OFFER_MODELS).size).toBe(OFFER_MODELS.length);
    });
  });

  describe("refusals", () => {
    it.each(nonModelValues)("refuses $label", ({ value }) => {
      expect(isOfferModel(value)).toBe(false);
    });
  });
});
