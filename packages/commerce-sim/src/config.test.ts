import { describe, expect, it } from "vitest";

import { SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";

import {
  COMMERCE_DISCLOSURE_LABEL,
  DEFAULT_COMMERCE_CONFIG,
  DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
  DEFAULT_GATE_FEE_MINOR_UNITS,
  resolveCommerceConfig,
} from "./config";
import type { CommerceConfigOverrides } from "./config";

/**
 * The configuration's four fixed facts — the flat gate fee, the founder-participation rate, the one
 * currency label and the one disclosure label — and the two ways a caller reaches them: the frozen
 * default object, and `resolveCommerceConfig` with the overrides it admits.
 *
 * The arithmetic the fee and the rate feed is tested where it lives, in `./ledgers/allocate.test.ts`
 * and the ledger writers beside it. What is tested here is the boundary those modules read from: the
 * defaults themselves, the resolution of an override onto them, the refusals that keep a fractional
 * or negative amount out of the product, and the labelling obligations the disclosure sentence
 * carries. A regression in any of those — a fee that drifts, a rate resolved as a fraction, a label
 * that stops saying the transaction is simulated — reaches here first, because every other module of
 * this package computes from these values rather than from its own copies of them.
 */

/**
 * The values each configured numeric member must refuse, each with the shape a caller actually
 * reaches. `Number.EPSILON` is the fractional case, chosen over a written-out fraction so that no
 * fractional literal appears in this file and so that the case is the smallest possible departure
 * from a whole number. `Number.MAX_SAFE_INTEGER + 2` is the case a whole-number check alone would
 * accept, since the sum is a number and an integer by `Number.isInteger`: only the safe-integer test
 * refuses it, and an amount the number type cannot represent exactly is not a count of minor units.
 */
const refusedGateFeeValues: readonly { readonly label: string; readonly value: number }[] = [
  { label: "negative", value: -1 },
  { label: "fractional", value: Number.EPSILON },
  { label: "not a number at all", value: Number.NaN },
  { label: "positive infinity", value: Number.POSITIVE_INFINITY },
  { label: "negative infinity", value: Number.NEGATIVE_INFINITY },
  { label: "past the safe integer range", value: Number.MAX_SAFE_INTEGER + 2 },
];

/** The same refusals for the rate, which is likewise a whole count of basis points. */
const refusedRateValues: readonly { readonly label: string; readonly value: number }[] = [
  { label: "negative", value: -1 },
  { label: "fractional", value: Number.EPSILON },
  { label: "not a number at all", value: Number.NaN },
  { label: "positive infinity", value: Number.POSITIVE_INFINITY },
  { label: "past the safe integer range", value: Number.MAX_SAFE_INTEGER + 2 },
];

/**
 * The payment-provider names the disclosure label must not carry, assembled from fragments rather
 * than written out. The repository holds no plaintext provider name anywhere — the
 * prohibited-dependency rule in `scripts/` matches candidate dependency names against SHA-256
 * digests for exactly that reason — so a guard that has to name one is built at run time instead of
 * being typed into a committed file. Each pair is one name.
 */
const providerNameFragments: readonly (readonly [string, string])[] = [
  ["str", "ipe"],
  ["pay", "pal"],
  ["ad", "yen"],
  ["brain", "tree"],
];

/** One case-insensitive pattern matching any of the assembled provider names. */
const providerNamePattern = new RegExp(
  providerNameFragments.map(([head, tail]) => `${head}${tail}`).join("|"),
  "i",
);

describe("commerce configuration defaults", () => {
  it("fixes the flat gate fee at 15000 minor units", () => {
    // The fee is 150 in the synthetic label, written as the whole count of minor units it is rather
    // than scaled up from a decimal amount, which is what keeps a fraction out of every fee.
    expect(DEFAULT_GATE_FEE_MINOR_UNITS).toBe(15000);
    expect(Number.isInteger(DEFAULT_GATE_FEE_MINOR_UNITS)).toBe(true);
    expect(DEFAULT_GATE_FEE_MINOR_UNITS).toBeGreaterThanOrEqual(0);
  });

  it("fixes the founder-participation rate at 25 basis points", () => {
    // A quarter of one per cent as a whole number of basis points, never a fraction or a percentage.
    expect(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS).toBe(25);
    expect(Number.isInteger(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS)).toBe(true);
    expect(DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS).toBeGreaterThanOrEqual(0);
  });

  it("takes its currency label from the shared constant, which is the product's one label", () => {
    expect(SYNTHETIC_CURRENCY_LABEL).toBe("DEMO");
    expect(DEFAULT_COMMERCE_CONFIG.currencyLabel).toBe(SYNTHETIC_CURRENCY_LABEL);
  });

  it("carries the two constants as its configured members", () => {
    // The default object is the documented reading of the fee and the rate, so it must not drift
    // from the constants every other module imports directly.
    expect(DEFAULT_COMMERCE_CONFIG.gateFeeMinorUnits).toBe(DEFAULT_GATE_FEE_MINOR_UNITS);
    expect(DEFAULT_COMMERCE_CONFIG.founderAllocationRateBasisPoints).toBe(
      DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
    );
  });

  it("is frozen, so a consumer cannot corrupt the shared default", () => {
    expect(Object.isFrozen(DEFAULT_COMMERCE_CONFIG)).toBe(true);
    expect(() => {
      // The cast is the shape a caller without types reaches, and module code is strict mode, so the
      // write to the frozen default raises rather than being dropped.
      (DEFAULT_COMMERCE_CONFIG as { gateFeeMinorUnits: number }).gateFeeMinorUnits = 0;
    }).toThrow(TypeError);
  });
});

describe("resolveCommerceConfig", () => {
  it("resolves the product's defaults when called with no argument, as a new object", () => {
    const resolved = resolveCommerceConfig();

    expect(resolved).toEqual(DEFAULT_COMMERCE_CONFIG);
    expect(resolved).not.toBe(DEFAULT_COMMERCE_CONFIG);
  });

  it("treats an empty overrides object exactly as it treats no argument", () => {
    expect(resolveCommerceConfig({})).toEqual(resolveCommerceConfig());
  });

  it("resolves a changed gate fee from the resolved configuration", () => {
    // Read back from the resolved config rather than from the overrides literal, so a resolution that
    // dropped the override would fail here.
    const resolved = resolveCommerceConfig({ gateFeeMinorUnits: 20000 });

    expect(resolved.gateFeeMinorUnits).toBe(20000);
    expect(resolved.founderAllocationRateBasisPoints).toBe(
      DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
    );
  });

  it("resolves a changed founder-participation rate from the resolved configuration", () => {
    const resolved = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });

    expect(resolved.founderAllocationRateBasisPoints).toBe(100);
    expect(resolved.gateFeeMinorUnits).toBe(DEFAULT_GATE_FEE_MINOR_UNITS);
  });

  it("accepts a configured gate fee of zero, which means the fee does not apply", () => {
    // Zero is a valid configuration rather than a refusal: it is how a deployment turns the fee off,
    // and the gate-fee ledger writer records no entry for it. Asserting the value, not merely the
    // absence of a throw, is what stops a later reader tightening the guard into refusing it.
    const resolved = resolveCommerceConfig({ gateFeeMinorUnits: 0 });

    expect(resolved.gateFeeMinorUnits).toBe(0);
  });

  it("returns the product's currency label and disclosure label however a caller asks", () => {
    // `CommerceConfigOverrides` omits both labels, so this call site passes only a member the type
    // admits; resolution answers with the product's own two labels either way.
    const resolved = resolveCommerceConfig({ gateFeeMinorUnits: DEFAULT_GATE_FEE_MINOR_UNITS });

    expect(resolved.currencyLabel).toBe(SYNTHETIC_CURRENCY_LABEL);
    expect(resolved.disclosureLabel).toBe(COMMERCE_DISCLOSURE_LABEL);
  });

  it("refuses both labels at the override type, and ignores either one that reaches resolution", () => {
    // A directive that suppresses nothing is a compile error in its turn, so these two hold the
    // refusal in place: `CommerceConfigOverrides` omits both labels, and a call passing either one
    // does not compile. The refusal is what protects the labelling obligation, since a caller free to
    // substitute a currency label or a weaker disclosure sentence would be free to weaken what the
    // product publishes. Resolution reads neither member, so a substitution that reaches it through a
    // caller the types do not cover is neither refused nor honoured — it is ignored, which the
    // cast-based test beside this one proves against the resolved values.
    // @ts-expect-error `CommerceConfigOverrides` omits `currencyLabel`, so this call does not compile
    expect(() => resolveCommerceConfig({ currencyLabel: SYNTHETIC_CURRENCY_LABEL })).not.toThrow();
    // @ts-expect-error `CommerceConfigOverrides` omits `disclosureLabel`, so this call does not compile
    expect(() => resolveCommerceConfig({ disclosureLabel: COMMERCE_DISCLOSURE_LABEL })).not.toThrow();
  });

  it("ignores a currency label and a disclosure label smuggled past the override type", () => {
    // The cast is what a JavaScript caller reaches with no compiler in the way. Both labels are
    // labelling obligations rather than options: a caller free to substitute one would be free to
    // weaken it, so resolution ignores the substitution instead of honouring it.
    const overrides = {
      currencyLabel: "OTHER",
      disclosureLabel: "A weaker sentence.",
    } as unknown as CommerceConfigOverrides;

    const resolved = resolveCommerceConfig(overrides);

    expect(resolved.currencyLabel).toBe(SYNTHETIC_CURRENCY_LABEL);
    expect(resolved.disclosureLabel).toBe(COMMERCE_DISCLOSURE_LABEL);
  });

  it("resolves whole, non-negative numbers for every member, with and without overrides", () => {
    const configs = [
      resolveCommerceConfig(),
      resolveCommerceConfig({ gateFeeMinorUnits: 20000, founderAllocationRateBasisPoints: 100 }),
    ];

    for (const config of configs) {
      expect(Number.isInteger(config.gateFeeMinorUnits)).toBe(true);
      expect(config.gateFeeMinorUnits).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(config.founderAllocationRateBasisPoints)).toBe(true);
      expect(config.founderAllocationRateBasisPoints).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("resolveCommerceConfig refusals", () => {
  it.each(refusedGateFeeValues)(
    "refuses a $label gate fee with a RangeError naming gateFeeMinorUnits",
    ({ value }) => {
      expect(() => resolveCommerceConfig({ gateFeeMinorUnits: value })).toThrow(RangeError);
      expect(() => resolveCommerceConfig({ gateFeeMinorUnits: value })).toThrow(
        "gateFeeMinorUnits",
      );
    },
  );

  it.each(refusedRateValues)(
    "refuses a $label founder rate with a RangeError naming founderAllocationRateBasisPoints",
    ({ value }) => {
      expect(() => resolveCommerceConfig({ founderAllocationRateBasisPoints: value })).toThrow(
        RangeError,
      );
      expect(() => resolveCommerceConfig({ founderAllocationRateBasisPoints: value })).toThrow(
        "founderAllocationRateBasisPoints",
      );
    },
  );
});

describe("simulation labelling", () => {
  it("carries one non-empty disclosure label, the same one the defaults carry", () => {
    expect(COMMERCE_DISCLOSURE_LABEL.length).toBeGreaterThan(0);
    expect(DEFAULT_COMMERCE_CONFIG.disclosureLabel).toBe(COMMERCE_DISCLOSURE_LABEL);
  });

  it("names no currency symbol", () => {
    expect(COMMERCE_DISCLOSURE_LABEL).not.toMatch(/[$\u20ac\u00a3\u00a5]/);
  });

  it("names no payment instrument, no account and no payment provider", () => {
    expect(COMMERCE_DISCLOSURE_LABEL).not.toMatch(/card|iban|account number|bank/i);
    expect(COMMERCE_DISCLOSURE_LABEL).not.toMatch(providerNamePattern);
  });

  it("states that the transaction is simulated and claims no real payment", () => {
    expect(COMMERCE_DISCLOSURE_LABEL).toMatch(/simulated/i);
    expect(COMMERCE_DISCLOSURE_LABEL).not.toMatch(/real payment|charge your|billing/i);
  });
});
