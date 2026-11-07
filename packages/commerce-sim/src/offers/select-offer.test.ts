import { describe, expect, it } from 'vitest';

import type { OfferModel } from '@adem/shared';

import type { ListingOffer, OfferSelection } from './select-offer';
import { selectOffer } from './select-offer';

/**
 * The offers a listing making every model would carry, one entry each at a distinct amount. The
 * amounts are distinct so that a selection reading the wrong entry's amount cannot pass by
 * coincidence, and the entries are named so an identity assertion can name the object it expects.
 */
const rent: ListingOffer = { model: 'rent', amountMinorUnits: 1_200 };
const purchase: ListingOffer = { model: 'purchase', amountMinorUnits: 48_000 };
const license: ListingOffer = { model: 'license', amountMinorUnits: 9_600 };
const subscription: ListingOffer = { model: 'subscription', amountMinorUnits: 800 };

const everyModel: readonly ListingOffer[] = [rent, purchase, license, subscription];

/**
 * Models a listing does not make, including the empty offer set. Each case is the listing's offers
 * and the model asked for, and each must be refused as `not_offered` however many other models the
 * listing does make.
 */
const notOfferedCases: readonly {
  readonly label: string;
  readonly offers: readonly ListingOffer[];
  readonly requested: OfferModel;
}[] = [
  { label: 'nothing at all', offers: [], requested: 'rent' },
  { label: 'a model the listing does not make', offers: [purchase], requested: 'subscription' },
  {
    label: 'one of several models the listing does not make',
    offers: [rent, purchase, license],
    requested: 'subscription',
  },
];

/**
 * Amounts a matched offer may not carry. `Number.MAX_SAFE_INTEGER + 1` is the first integer past the
 * safe range and equals two to the fifty-third power, so it stands for that bound: past it the
 * number type can no longer hold every integer, and an amount in minor units there could not be
 * compared or added without becoming inexact.
 */
const malformedAmountCases: readonly {
  readonly label: string;
  readonly amountMinorUnits: number;
}[] = [
  { label: 'a negative amount', amountMinorUnits: -1 },
  { label: 'a fractional amount', amountMinorUnits: 1.5 },
  { label: 'a not-a-number amount', amountMinorUnits: Number.NaN },
  { label: 'a positive infinite amount', amountMinorUnits: Number.POSITIVE_INFINITY },
  { label: 'a negative infinite amount', amountMinorUnits: Number.NEGATIVE_INFINITY },
  {
    label: 'the first amount past the safe integer range',
    amountMinorUnits: Number.MAX_SAFE_INTEGER + 1,
  },
  // A value that is not a number at all, as distinct from a number out of range: this is what an
  // untyped caller reaches, and it is refused rather than thrown on. `Number.isSafeInteger` answers
  // false for any type without raising, and the comparison after it is never reached for one, so
  // the short-circuit in the check is what keeps a refusal a refusal.
  { label: 'an amount that is not a number', amountMinorUnits: Symbol('amount') as unknown as number },
  { label: 'a missing amount', amountMinorUnits: undefined as unknown as number },
];

/**
 * The two ends of the accepted range. Both are whole and non-negative, so both are legitimate
 * amounts: an offer made at no charge is an amount of zero rather than a malformed one, and the
 * largest amount the number type still holds every integer of is the upper bound of the range.
 */
const validAmountCases: readonly { readonly label: string; readonly amountMinorUnits: number }[] = [
  { label: 'zero', amountMinorUnits: 0 },
  { label: 'the largest safe integer', amountMinorUnits: Number.MAX_SAFE_INTEGER },
];

/**
 * The offer set the purity cases are asked against: three of the four models, one of them carrying a
 * malformed amount. A single shared set is deliberate, because all three paths a selection can walk
 * end on the same list: a model the set makes, a model it does not make, and the malformed entry
 * itself. The malformed entry sits between two well-formed ones, so a comparison that passed by
 * reading only the first or the last entry could not hide a reordering.
 */
const mixedOfferSet: readonly ListingOffer[] = [
  rent,
  { model: 'purchase', amountMinorUnits: -1 },
  license,
];

/**
 * Those three requests, each with the result it must produce: the selection the set makes, and the
 * two refusals. `subscription` is the model the set deliberately does not make.
 */
const nonMutatingRequests: readonly {
  readonly label: string;
  readonly requested: OfferModel;
  readonly expected: OfferSelection;
}[] = [
  {
    label: 'a request the set can fill',
    requested: 'license',
    expected: { ok: true, offer: license },
  },
  {
    label: 'a request for a model the set does not make',
    requested: 'subscription',
    expected: { ok: false, reason: 'not_offered' },
  },
  {
    label: 'a request whose matched amount is malformed',
    requested: 'purchase',
    expected: { ok: false, reason: 'invalid_amount' },
  },
];

/**
 * Narrows a selection to its offer, failing the calling test when the selection was refused. A
 * refusal is reported by its own reason rather than as an undefined offer, so a test that expected a
 * selection and got a refusal says which refusal it got.
 */
function selectedOffer(result: OfferSelection): ListingOffer {
  if (!result.ok) {
    throw new Error(`expected a selection, received the refusal ${result.reason}`);
  }

  return result.offer;
}

/**
 * Reads a selection the way a caller downstream reads it: a selection by the model and amount it
 * carries, a refusal by the reason it gives. The `switch` over `result.ok` and then, in the refusal
 * branch, over both refusal reasons is what keeps this helper compiling only while the result is a
 * discriminated union over exactly those two reasons — a third reason added to `OfferSelection`
 * would have to be answered here, which is where a caller would otherwise meet it as an unhandled
 * case at runtime.
 */
function describeSelection(result: OfferSelection): string {
  if (result.ok) {
    return `selected ${result.offer.model} at ${result.offer.amountMinorUnits} minor units`;
  }

  switch (result.reason) {
    case 'not_offered':
      return 'refused: the listing does not make that model';
    case 'invalid_amount':
      return 'refused: the matched amount is not a whole number of minor units';
  }
}

describe('selectOffer', () => {
  describe('selection', () => {
    for (const offer of everyModel) {
      it(`selects the ${offer.model} offer the listing makes`, () => {
        const result = selectOffer(everyModel, offer.model);

        expect(result).toEqual({ ok: true, offer });
        // Identity, not equality, and on every model rather than one: the caller prices the selection
        // from the entry it gets back, so a copy or a re-shaped literal would make the amount the
        // caller reads something other than the amount the listing made while still comparing equal.
        expect(selectedOffer(result)).toBe(offer);
        expect(selectedOffer(result).amountMinorUnits).toBe(offer.amountMinorUnits);
      });
    }

    it('selects the first entry when a listing states one model twice', () => {
      // The choice between duplicates is first-wins rather than a sum or a largest-of: the offers
      // are the listing's own data, so the first is the one it stated.
      const statedTwice: readonly ListingOffer[] = [
        { model: 'subscription', amountMinorUnits: 800 },
        { model: 'subscription', amountMinorUnits: 2_400 },
      ];

      const result = selectOffer(statedTwice, 'subscription');

      expect(selectedOffer(result).amountMinorUnits).toBe(800);
    });

    for (const { label, amountMinorUnits } of validAmountCases) {
      it(`selects an offer whose amount is ${label}`, () => {
        const offers: readonly ListingOffer[] = [{ model: 'rent', amountMinorUnits }];

        const result = selectOffer(offers, 'rent');

        expect(selectedOffer(result).amountMinorUnits).toBe(amountMinorUnits);
      });
    }

    it('resolves every model from a frozen offer set', () => {
      // The `readonly ListingOffer[]` parameter is proven rather than declared: a signature that
      // demanded a mutable array would not compile here, and a frozen list turns a sort or a splice
      // inside the function into an error rather than a silent reordering of the listing's offers.
      const frozen = Object.freeze([...everyModel]);

      for (const offer of frozen) {
        expect(selectOffer(frozen, offer.model)).toEqual({ ok: true, offer });
      }

      expect(frozen).toEqual([rent, purchase, license, subscription]);
    });

    it('accepts an offer set declared as a constant', () => {
      const declaredConstant = [
        { model: 'license', amountMinorUnits: 9_600 },
        { model: 'rent', amountMinorUnits: 1_200 },
      ] as const;

      expect(selectOffer(declaredConstant, 'license')).toEqual({
        ok: true,
        offer: { model: 'license', amountMinorUnits: 9_600 },
      });
      expect(selectOffer(declaredConstant, 'rent')).toEqual({
        ok: true,
        offer: { model: 'rent', amountMinorUnits: 1_200 },
      });
    });
  });

  describe('refusals', () => {
    for (const { label, offers, requested } of notOfferedCases) {
      it(`refuses ${label} as not_offered`, () => {
        expect(selectOffer(offers, requested)).toEqual({ ok: false, reason: 'not_offered' });
      });
    }

    for (const { label, amountMinorUnits } of malformedAmountCases) {
      it(`refuses ${label} on the matched offer`, () => {
        const offers: readonly ListingOffer[] = [{ model: 'rent', amountMinorUnits }];

        expect(selectOffer(offers, 'rent')).toEqual({ ok: false, reason: 'invalid_amount' });
      });
    }

    it('decides an unoffered model before reading any amount', () => {
      // The two checks in the one order that keeps the reason meaningful: a malformed amount on an
      // entry the caller did not ask for must not turn an unoffered model into a bad amount.
      const offers: readonly ListingOffer[] = [{ model: 'purchase', amountMinorUnits: -1 }];

      expect(selectOffer(offers, 'rent')).toEqual({ ok: false, reason: 'not_offered' });
      expect(selectOffer(offers, 'purchase')).toEqual({ ok: false, reason: 'invalid_amount' });
    });

    it('inspects only the entry the request matched', () => {
      const offers: readonly ListingOffer[] = [
        { model: 'rent', amountMinorUnits: -5 },
        { model: 'purchase', amountMinorUnits: 48_000 },
      ];

      const result = selectOffer(offers, 'purchase');

      expect(selectedOffer(result).amountMinorUnits).toBe(48_000);
    });

    it('carries the offer on a selection and the reason on a refusal, never both', () => {
      // Totality of the result: every call answers one of the two shapes, and the reason a refusal
      // gives is the only place the caller reads, so no call can be answered by a thrown error.
      const selected = selectOffer(everyModel, 'purchase');
      const refused = selectOffer([], 'rent');

      expect(Object.keys(selected).sort()).toEqual(['offer', 'ok']);
      expect(Object.keys(refused).sort()).toEqual(['ok', 'reason']);
    });

    it('answers a caller that branches on the result through its discriminant', () => {
      // The shape a caller downstream — the checkout route, `create-checkout-simulation.ts` —
      // branches on, read here through a helper that handles every refusal reason the type declares:
      // a third reason, or a result that stopped being discriminated on `ok`, would stop compiling in
      // `describeSelection` rather than reach a caller as an unhandled case.
      expect(describeSelection(selectOffer(everyModel, 'purchase'))).toBe(
        'selected purchase at 48000 minor units',
      );
      expect(describeSelection(selectOffer([], 'rent'))).toBe(
        'refused: the listing does not make that model',
      );
      expect(describeSelection(selectOffer([{ model: 'rent', amountMinorUnits: 1.5 }], 'rent'))).toBe(
        'refused: the matched amount is not a whole number of minor units',
      );
    });
  });

  describe('purity', () => {
    for (const { label, requested, expected } of nonMutatingRequests) {
      it(`leaves the offer set untouched after ${label}`, () => {
        // A list of its own per case, so a case is not weakened by a mutation an earlier one left
        // behind, and the order it must still carry is anchored to a literal rather than read back
        // from the same list: comparing a list with itself would hold for any reordering.
        const offers: readonly ListingOffer[] = [...mixedOfferSet];
        const snapshot = structuredClone(offers);

        expect(selectOffer(offers, requested)).toEqual(expected);

        // A deep snapshot taken before the call, compared after it, on every path: an implementation
        // that sorted the set to find its entry, or removed the entry it refused, would answer the
        // same result and still fail here, which equality against the return value alone could not see.
        expect(offers).toEqual(snapshot);
        expect(offers).toHaveLength(3);
        expect(offers.map((offer) => offer.model)).toEqual(['rent', 'purchase', 'license']);
      });
    }

    it('answers the same selection twice for the same offers and model', () => {
      // The first call is anchored to a known selection, so this case can fail: without the anchor a
      // comparison of the function with its own return would hold for any behaviour, a wrong one
      // included.
      const first = selectOffer(everyModel, 'purchase');
      const second = selectOffer(everyModel, 'purchase');

      expect(first).toEqual({ ok: true, offer: purchase });
      expect(second).toEqual(first);
    });
  });
});
