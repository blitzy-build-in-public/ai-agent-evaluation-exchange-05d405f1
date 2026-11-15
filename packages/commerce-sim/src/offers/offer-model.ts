/**
 * The four offer models a listing may make, and the runtime guard that recognises one.
 *
 * The vocabulary is declared exactly once, in `packages/shared/src/types/commerce.ts`:
 * `OFFER_MODELS` is the `as const` tuple there and `OfferModel` the union derived from it.
 * This module republishes that one declaration to the consumers of `@adem/commerce-sim` — a
 * value re-export and a type re-export — and adds the runtime half, which `@adem/shared`
 * cannot carry because that package declares types, tuples and JSON schemas and no logic.
 *
 * Nothing here declares a second union or a second tuple, and no re-typed four-value list
 * exists anywhere in `packages/commerce-sim`. A copy is the bug this arrangement prevents:
 * the same four values are the `enum` the `POST /checkout-simulations` body validates
 * against in `packages/shared/src/schemas/commerce-schema.ts` and the `CHECK` constraint on
 * `listings.pricing_model` in migration `0002`, so a copy that fell out of step would admit
 * a model the checkout contract rejects, or refuse one it accepts.
 *
 * `OFFER_MODELS` is a runtime value and `OfferModel` a type, which is why the two imports
 * below take different forms: `verbatimModuleSyntax` emits the type import as nothing and
 * keeps the value import as a real binding, so widening the tuple's type here could not
 * reach a compiled consumer even if it were attempted.
 */

import { OFFER_MODELS } from "@adem/shared";
import type { OfferModel } from "@adem/shared";

/** The four-model vocabulary, re-exported so this package's entry republishes it unchanged. */
export { OFFER_MODELS };

/**
 * One offer model a listing may make: `rent`, `purchase`, `license` or `subscription`.
 *
 * The union is declared once in `@adem/shared`, derived from that package's `OFFER_MODELS`
 * tuple, and re-exported here rather than restated. It is the same enum the
 * `POST /checkout-simulations` body validates against in
 * `packages/shared/src/schemas/commerce-schema.ts`, so what a caller may type and what the
 * wire contract accepts are one definition rather than two that agree today.
 *
 * An offer model a listing does not offer is a domain refusal rather than a type error — the
 * API contract's `422` — and it is decided in the sibling `./select-offer`, never here.
 */
export type { OfferModel };

/**
 * Recognises an offer model at runtime, for a value whose type is unknown: a query
 * parameter, a request body field, or a column read back from the database.
 *
 * Returns `true` only for a string that is one of the four {@link OFFER_MODELS}, and `false`
 * for every other value — another string, an empty string, `null`, `undefined`, another
 * primitive, an object, an array, a symbol, or a boxed `String` carrying a model's text. A
 * boxed `String` is an object rather than a string primitive and is refused rather than
 * coerced, so no value is accepted by resemblance.
 *
 * Pure: it performs no I/O, reads no clock, mutates nothing, and throws in no case. A value
 * it does not recognise is answered with `false` rather than an error, so a caller validates
 * untrusted input without a `try`. Narrowing a value with this guard is what lets a caller
 * treat it as an {@link OfferModel} afterwards; refusing a model a listing does not offer is
 * a separate, domain decision, made in `./select-offer`.
 *
 * @param value - Any value, of any type.
 * @returns `true` if the value is one of the four models, `false` otherwise.
 */
export function isOfferModel(value: unknown): value is OfferModel {
  if (typeof value !== "string") {
    return false;
  }

  // `OFFER_MODELS` is typed as the literal tuple `readonly ["rent", "purchase", "license",
  // "subscription"]`, not as a string array, so its `includes` accepts only those four
  // literals and a test against an arbitrary string would fail to compile instead of
  // returning `false`. The cast widens the receiver to `readonly string[]` for the
  // membership test only; the exported tuple keeps its literal type, which is what keeps
  // `OfferModel` the four-model union.
  return (OFFER_MODELS as readonly string[]).includes(value);
}
