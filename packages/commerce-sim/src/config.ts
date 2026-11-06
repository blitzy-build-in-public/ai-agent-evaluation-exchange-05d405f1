/**
 * The commerce simulation's fictional configuration: the flat gate-evaluation fee, the
 * founder-participation rate and the disclosure label every simulated amount renders with.
 *
 * Each value is defined once, here, for the whole product. The other modules of this package —
 * offer selection, the simulated checkout, the three ledger writers and the refund path — read
 * the resolved configuration rather than a number of their own, and `apps/api` references these
 * constants instead of declaring a second copy, so the fee and the rate a ledger row is computed
 * from are the same two values the API reports.
 *
 * Two properties of this module are deliberate, and both are easy to undo by accident.
 *
 * **Amounts are integers, never floats.** An amount is a whole number of minor units of the
 * synthetic currency whose label is declared once as `SYNTHETIC_CURRENCY_LABEL` in `@adem/shared`.
 * The fee is therefore the integer literal `15000` — 150.00 of that label — and never a decimal
 * amount multiplied by a hundred, and the rate is a whole number of basis points and never a
 * fraction or a percentage. No arithmetic belongs in this module at all: the product's single
 * rounding point is the half-up allocation in `./ledgers/allocate.ts`, and a second one here would
 * be a second place for a fraction to be resolved differently.
 *
 * **A currency label cannot be configured.** See {@link CommerceConfigOverrides}.
 *
 * The resolved configuration is a pure function of the overrides a caller passes: nothing here
 * reads a clock, a random source or a file, which is what lets a test reproduce a fee or an
 * allocation exactly.
 */

import { SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";

/**
 * The default flat gate-evaluation fee: 150.00 of the synthetic currency, written as its whole
 * number of minor units.
 *
 * The fee is charged once per completed evaluation, whether that evaluation's outcome is PASS or
 * FAIL, and it is recorded in the gate-evaluation-fee ledger only. It is never eligible for a
 * founder-participation allocation, so an evaluation can be bought and still produce no allocation
 * entry — which is the separation that keeps a fee from being read as a payment for an outcome.
 *
 * The value is a plain integer literal rather than a computed one on purpose: a decimal amount
 * multiplied by a hundred introduces a fraction into a product that promises every amount to be an
 * integer count of minor units.
 */
export const DEFAULT_GATE_FEE_MINOR_UNITS = 15000;

/**
 * The default founder-participation rate: 25 basis points, a quarter of one per cent.
 *
 * The rate applies to the net amount of an eligible completed simulated marketplace transaction.
 * It never applies to a gate-evaluation fee and never to a sponsored-slot record, and the allocation
 * it produces is rounded half up to a whole minor unit by the product's single rounding point,
 * `allocate` in `./ledgers/allocate.ts`.
 *
 * The value is provisional and configurable, and it is a whole number of basis points rather than a
 * percentage or a fraction, so the rate a reader is shown is exactly the rate the arithmetic used.
 */
export const DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS = 25;

/**
 * The label every simulated amount carries, stating in one sentence that the transaction is a
 * nonfunctional demonstration.
 *
 * The wording is a labelling obligation rather than decoration, so it is defined once here and
 * consumed by the API's `disclosure_label` field, by the three ledgers and by the checkout and
 * ledger surfaces of the UI, rather than being written again at each surface where a second copy
 * could drift into saying something weaker. It contains no currency symbol, no real currency code
 * and no reference to a payment provider, a card, a bank or an account of any kind: the simulation
 * processes no payment, so no surface of the product may read as if one existed.
 */
export const COMMERCE_DISCLOSURE_LABEL =
  "Simulated demonstration: no payment is processed, no money moves, and no real currency is involved.";

/**
 * The resolved configuration the simulated commerce path computes from.
 *
 * Every monetary member is a whole number of minor units of the synthetic currency named by
 * {@link currencyLabel}, and is never a float: the rate is likewise a whole number of basis points
 * rather than a fraction. No member can hold a real currency code or a provider reference —
 * `currencyLabel` is typed as the literal type of the one label the product declares, so no other
 * label can be assigned to it, and no member for a provider, a card, a bank or an account is
 * declared at all.
 */
export interface CommerceConfig {
  /**
   * The synthetic currency label, typed as the literal type of `SYNTHETIC_CURRENCY_LABEL` in
   * `@adem/shared` rather than restated as a string. The label therefore has one spelling in the
   * repository, and a consumer that renders it cannot compile while saying anything else.
   */
  readonly currencyLabel: typeof SYNTHETIC_CURRENCY_LABEL;

  /**
   * The flat gate-evaluation fee in whole minor units, charged per completed evaluation. A
   * configured `0` is valid and means the fee configuration does not apply, so the gate-fee ledger
   * writer records no entry.
   */
  readonly gateFeeMinorUnits: number;

  /**
   * The founder-participation rate in whole basis points, applied to the net amount of an eligible
   * completed simulated marketplace transaction. A configured `0` is valid and yields an allocation
   * of nothing.
   */
  readonly founderAllocationRateBasisPoints: number;

  /**
   * The disclosure label every simulated amount renders with; the value of
   * {@link COMMERCE_DISCLOSURE_LABEL}.
   */
  readonly disclosureLabel: string;
}

/**
 * The configuration overrides {@link resolveCommerceConfig} accepts.
 *
 * `currencyLabel` is omitted deliberately, and that omission is the reason this type exists instead
 * of a bare `Partial<CommerceConfig>`: with no way to pass another currency label, the
 * `CHECK (currency_label = <the product's one label>)` constraint the migrations place on every
 * monetary table is unreachable by any code path rather than merely improbable, and the type system
 * refuses the mistake at the call site instead of the database refusing it at the insert.
 *
 * A `disclosureLabel` member is admitted by the type — only the currency label is omitted — but
 * resolution always returns {@link COMMERCE_DISCLOSURE_LABEL}: the product renders one disclosure
 * sentence, and a caller free to substitute another would be free to weaken a labelling obligation.
 * The member carries the default's shape for that reason and nothing more.
 *
 * Every member is optional, and `exactOptionalPropertyTypes` makes optionality exact: a member may
 * be absent, but a member that is present may not be `undefined`. A caller that means "use the
 * default" therefore omits the member rather than passing `undefined` to it, which the compiler
 * refuses — a distinction worth knowing at the call site, since an omitted member and one written
 * as `undefined` would otherwise look interchangeable.
 */
export type CommerceConfigOverrides = Partial<Omit<CommerceConfig, "currencyLabel">>;

/**
 * The default configuration, for a caller that needs the product's resolved values without
 * resolving them — a documentation renderer, a test, or a surface that must state the fee and the
 * rate the simulation runs with.
 *
 * It is frozen so that a consumer cannot mutate the shared default, and it is typed `Readonly` so
 * the compiler refuses the attempt as well. {@link resolveCommerceConfig} never returns this object
 * itself: it builds a new one per call, so a caller cannot reach the default through a returned
 * reference either.
 */
export const DEFAULT_COMMERCE_CONFIG: Readonly<CommerceConfig> = Object.freeze({
  currencyLabel: SYNTHETIC_CURRENCY_LABEL,
  gateFeeMinorUnits: DEFAULT_GATE_FEE_MINOR_UNITS,
  founderAllocationRateBasisPoints: DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
  disclosureLabel: COMMERCE_DISCLOSURE_LABEL,
});

/**
 * Resolves the simulated commerce configuration from the overrides a caller passes.
 *
 * @param overrides The members to resolve a different value for. Absent members resolve to the
 *   product's defaults; a present member whose value is `undefined` is not possible in TypeScript
 *   and resolves to the default if an untyped caller supplies one.
 * @returns A newly built configuration, never `DEFAULT_COMMERCE_CONFIG` itself, so a caller cannot
 *   corrupt the shared default through the returned reference. `currencyLabel` and `disclosureLabel`
 *   always carry the product's single label values; the two numeric members carry the override when
 *   one is present and the default otherwise.
 * @throws {RangeError} If `gateFeeMinorUnits` or `founderAllocationRateBasisPoints` is present and
 *   is negative, not an integer, not finite, or not a safe integer. The message names the offending
 *   member. A value of `0` is accepted for either member: for the fee it means the fee configuration
 *   does not apply and no gate-fee entry is written, and for the rate it means an allocation of
 *   nothing.
 */
export function resolveCommerceConfig(overrides: CommerceConfigOverrides = {}): CommerceConfig {
  const gateFeeMinorUnits =
    overrides.gateFeeMinorUnits === undefined
      ? DEFAULT_GATE_FEE_MINOR_UNITS
      : requireNonNegativeSafeInteger("gateFeeMinorUnits", overrides.gateFeeMinorUnits);

  const founderAllocationRateBasisPoints =
    overrides.founderAllocationRateBasisPoints === undefined
      ? DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS
      : requireNonNegativeSafeInteger(
          "founderAllocationRateBasisPoints",
          overrides.founderAllocationRateBasisPoints,
        );

  return {
    currencyLabel: SYNTHETIC_CURRENCY_LABEL,
    gateFeeMinorUnits,
    founderAllocationRateBasisPoints,
    disclosureLabel: COMMERCE_DISCLOSURE_LABEL,
  };
}

/**
 * Refuses a configured numeric member that is not a whole, non-negative and exactly representable
 * count, and returns it unchanged when it is.
 *
 * The single check answers all four refusals the configuration promises: a value that is negative
 * fails the sign test, and a value that is not an integer, is infinite, is not a number at all
 * (including a non-number an untyped caller passed) or exceeds the range the number type represents
 * exactly all fail the safe-integer test. One check rather than four is what keeps the four from
 * drifting apart.
 */
function requireNonNegativeSafeInteger(memberName: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `resolveCommerceConfig: ${memberName} must be a non-negative safe integer, received ${renderReceived(value)}`,
    );
  }

  return value;
}

/**
 * Renders a received value for a refusal message. A refusal must be the documented `RangeError`
 * whatever an untyped caller passes, which interpolating the value into the message cannot promise:
 * `String` is defined for a symbol, and a value whose own text conversion raises is answered with
 * text read from its type, which no value can influence.
 */
function renderReceived(value: unknown): string {
  try {
    return String(value);
  } catch {
    return `a value of type ${typeof value}`;
  }
}
