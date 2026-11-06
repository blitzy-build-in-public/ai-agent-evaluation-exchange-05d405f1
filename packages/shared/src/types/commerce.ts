/**
 * The simulated-commerce vocabulary: the four offer models a listing may make, the
 * minor-units alias every monetary field in this product is typed with, and the
 * append-only transaction and refund rows the commerce simulation writes.
 *
 * Three shapes here are deliberately narrower than a first sketch would make them. A
 * transaction's `simulated` field is the literal `true` rather than a boolean, so a
 * transaction that is not simulated cannot be typed at all; every simulated amount
 * carries a `disclosure_label`; and neither row declares a property that could hold a
 * real currency code or a provider reference. "No money movement" therefore holds in the
 * type rather than in a caller's discretion.
 *
 * Both rows are append-only. A refund appends a reversal entry and never edits or deletes
 * a ledger entry, and the net remaining is derived as the transaction amount minus the sum
 * of its refunds rather than stored — which is why neither row carries a balance, a status
 * or an updated-at field. Each of those would be a second source of truth for a value the
 * product computes, and a value with two sources can disagree with itself.
 *
 * Declarations only: no rounding, no amount rendering and no validation. The product's
 * single rounding point is `allocate` in `packages/commerce-sim/src/ledgers/allocate.ts`,
 * and validation is the job of `packages/shared/src/schemas/commerce-schema.ts`.
 */

import { SYNTHETIC_CURRENCY_LABEL } from "../constants";

/**
 * The four offer models a listing may make: rent, purchase, license and subscription.
 *
 * This tuple is the JSON Schema `enum` the `POST /checkout-simulations` body validates
 * against in `packages/shared/src/schemas/commerce-schema.ts`, so the offer type and the
 * wire contract cannot drift apart. An offer model a listing does not offer is the
 * contract's `422`, and the same tuple feeds the offer display a listing renders. The set
 * is closed: a fifth model would widen the checkout contract and the offer display, which
 * is a plan revision rather than an implementation choice.
 *
 * `PRICING_MODELS` in the sibling `listing.ts` is a separate, identically-shaped tuple on
 * purpose. The two are not merged and neither is re-exported from the other: the plan
 * names both, and a duplicate identifier across this folder would break the `export *`
 * in `src/index.ts`.
 */
export const OFFER_MODELS = ["rent", "purchase", "license", "subscription"] as const;

/**
 * One offer model a listing may make, derived from {@link OFFER_MODELS} rather than
 * restated, so the vocabulary has exactly one definition in the repository.
 */
export type OfferModel = (typeof OFFER_MODELS)[number];

/**
 * An amount in whole minor units of the synthetic currency `DEMO`: a non-negative
 * integer, and never a fractional amount.
 *
 * Every monetary field in the product is typed with this alias rather than with a bare
 * `number`, so a reader meets no amount that could be taken for a real one. There is no
 * real currency code and no currency symbol anywhere in the product, and the label itself
 * is declared once, as `SYNTHETIC_CURRENCY_LABEL` in `../constants`, with the database
 * backing it through the `CHECK` constraint in
 * `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql`.
 *
 * The rate and the fee the simulation uses are configuration rather than types: the flat
 * gate-evaluation fee defaults to 150.00 `DEMO` (15000 minor units) and the
 * founder-participation rate to 25 basis points, both owned by
 * `packages/commerce-sim/src/config.ts`. The only place a fraction is ever resolved is the
 * half-up allocation in `packages/commerce-sim/src/ledgers/allocate.ts`; no arithmetic
 * belongs in this alias.
 */
export type MinorUnits = number;

/**
 * One row of the append-only `transactions` table, and the response body of a completed
 * simulated checkout.
 *
 * `simulated` is the literal `true`, not a boolean: a transaction that is not simulated
 * cannot be typed at all, so "no money movement" is a property of this type rather than a
 * rule a caller is asked to respect. `disclosure_label` carries the nonfunctional demo
 * label that every simulated amount must render with, beside the amount's
 * `currency_label`.
 *
 * `currency_label` is typed from the `SYNTHETIC_CURRENCY_LABEL` constant, so it resolves to
 * that constant's literal value and the label has one spelling in the repository. No
 * property of this row can hold a real currency code or a provider reference: none is
 * declared here, and the `CHECK` constraint on the column refuses any other label at the
 * database.
 *
 * The amount is the amount of the selected offer model, computed by the simulation. A
 * client submits a listing, a version and an offer model, and never an amount — which is
 * why {@link CheckoutSimulationBody} has no amount field.
 *
 * The row is append-only: a refund appends reversal entries rather than editing this
 * record, so it carries no balance, no status and no updated-at field.
 */
export interface Transaction {
  /** Identifier of the transaction, unique across the ledger. */
  id: string;
  /** Identifier of the buyer account that ran the simulated checkout. */
  buyer_account_id: string;
  /** Identifier of the listing the simulated purchase was made from. */
  listing_id: string;
  /** Identifier of the listing version the simulated purchase was made for. */
  listing_version_id: string;
  /** The offer model the buyer selected, one of {@link OFFER_MODELS}. */
  offer_model: OfferModel;
  /** Amount charged by the simulation, in whole minor units of the synthetic label. */
  amount_minor_units: MinorUnits;
  /** Literal type of the synthetic currency label declared in `../constants`. */
  currency_label: typeof SYNTHETIC_CURRENCY_LABEL;
  /** Always the literal `true`: a transaction that is not simulated cannot be typed. */
  simulated: true;
  /** The nonfunctional demo label rendered with every simulated amount. */
  disclosure_label: string;
  /** ISO-8601 UTC instant of the simulated transaction, written at insert time. */
  created_at: string;
}

/**
 * The body of `POST /checkout-simulations`, submitted by a buyer account with the demo
 * account header.
 *
 * `amount_minor_units` is deliberately absent: the amount comes from the offer model the
 * listing makes, never from the client, so a caller cannot name the price of its own
 * simulated purchase. An offer model the listing does not offer is the contract's `422`,
 * and a refusal of a real payment never arises here because no real payment exists.
 */
export interface CheckoutSimulationBody {
  /** Identifier of the listing being purchased from. */
  listing_id: string;
  /** Identifier of the listing version being purchased. */
  listing_version_id: string;
  /** The offer model the buyer selected, one of {@link OFFER_MODELS}. */
  offer_model: OfferModel;
}

/**
 * One row of the append-only `refunds` table: the reversal an operator's refund appends,
 * returned as the reversal entries it produces.
 *
 * A refund appends a reversal entry and never edits or deletes a ledger entry; it edits
 * neither the transaction nor the allocation that transaction produced. The net remaining
 * is derived — the transaction's amount minus the sum of its refunds — rather than
 * stored, which is what makes the contract's `409` (the transaction is already fully
 * refunded) and `422` (the amount exceeds the net remaining) computable without any
 * mutation, and why this row carries no balance, no status and no reversed flag.
 *
 * The amount is in whole minor units of the same synthetic label as the transaction it
 * reverses.
 */
export interface Refund {
  /** Identifier of the refund, unique across the ledger. */
  id: string;
  /** Identifier of the {@link Transaction} this refund reverses. */
  transaction_id: string;
  /** Refunded amount in whole minor units of the synthetic label. */
  amount_minor_units: MinorUnits;
  /** Identifier of the operator account that ruled the refund. */
  operator_account_id: string;
  /** ISO-8601 UTC instant of the refund, written at insert time. */
  created_at: string;
}

/**
 * The body of `POST /transactions/{id}/refunds`, submitted by an operator account.
 *
 * The schema permits a non-negative integer and no more: whether the amount fits the
 * transaction's net remaining is a domain check the route performs against the refund
 * rows, so an over-large amount is the contract's `422` and a fully refunded transaction
 * is its `409`, neither of them a schema failure.
 */
export interface RefundCreateBody {
  /** Amount to refund, in whole minor units of the synthetic label. */
  amount_minor_units: MinorUnits;
}
