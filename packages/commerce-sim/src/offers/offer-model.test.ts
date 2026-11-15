import { describe, expect, it } from "vitest";

import { OFFER_MODELS, isOfferModel } from "./offer-model";

/**
 * Values that are not an offer model, in the shapes an untyped caller actually reaches: a
 * different string, an empty or whitespace-only string, a model spelled in the wrong case, an
 * absent value, the other primitives, and the container shapes that carry a model's text
 * without being the model. Five of these exist to catch a specific rewrite rather than a typo,
 * because each is what one plausible loosening of the guard would let through. The boxed
 * `String` is an object rather than a string primitive, so a guard that coerced its argument
 * instead of testing its type would accept it; a model differing only in case or only in
 * trailing whitespace is what a case-insensitive or trimming comparison would accept; and the
 * symbol and the object whose text conversion raises are the two values whose conversion
 * throws, so each proves the guard refuses by testing the type rather than by coercing.
 */
const nonModelValues: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: "a different string", value: "lease" },
  { label: "an empty string", value: "" },
  { label: "a whitespace-only string", value: " " },
  { label: "a model in the wrong case", value: "Rent" },
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "zero", value: 0 },
  { label: "a number other than zero", value: 1 },
  { label: "true", value: true },
  { label: "false", value: false },
  { label: "a symbol", value: Symbol("rent") },
  { label: "a plain object", value: {} },
  { label: "an empty array", value: [] },
  { label: "an array holding a model", value: ["rent"] },
  { label: "a boxed String holding a model", value: new String("rent") },
  { label: "an object whose text conversion raises", value: { toString: null } },
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

    it("names the four models of the checkout contract, in order", () => {
      // Pinned by value and by order, which the count and the uniqueness above cannot catch: a
      // renamed or re-ordered member would leave both of those green while changing what the
      // `POST /checkout-simulations` body accepts and what the `CHECK` on `listings.pricing_model`
      // admits, so the contract would be redefined in silence.
      expect([...OFFER_MODELS]).toEqual(["rent", "purchase", "license", "subscription"]);
    });
  });

  describe("refusals", () => {
    it.each(nonModelValues)("refuses $label", ({ value }) => {
      expect(isOfferModel(value)).toBe(false);
    });
  });

  describe("narrowing", () => {
    it("narrows a value to an offer model, so a caller may treat it as one", () => {
      // The compile-time half of the guard's contract: `value.toUpperCase()` type-checks only
      // because the true branch narrows `unknown` to the four-model union, so an assertion
      // here fails to build rather than fails to run if the guard stops narrowing.
      const uppercaseModel = (value: unknown): string =>
        isOfferModel(value) ? value.toUpperCase() : "";

      expect(uppercaseModel("rent")).toBe("RENT");
      expect(uppercaseModel("subscription")).toBe("SUBSCRIPTION");
      expect(uppercaseModel("lease")).toBe("");
      expect(uppercaseModel("Rent")).toBe("");
    });
  });
});
