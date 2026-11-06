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

describe('selectOffer', () => {
  describe('selection', () => {
    for (const offer of everyModel) {
      it(`selects the ${offer.model} offer the listing makes`, () => {
        const result = selectOffer(everyModel, offer.model);

        expect(result).toEqual({ ok: true, offer });
      });
    }

    it('returns the entry it was given rather than a copy of it', () => {
      // Identity, not equality: the caller prices the selection from the returned entry, and a copy
      // would make the amount the caller reads something other than the amount the listing made.
      const result = selectOffer(everyModel, 'purchase');

      expect(result).toEqual({ ok: true, offer: purchase });
      expect(selectedOffer(result)).toBe(purchase);
    });

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

    it('accepts a frozen offer set and an offer set declared as a constant', () => {
      const frozen = Object.freeze([rent, purchase]);

      expect(selectOffer(frozen, 'rent')).toEqual({ ok: true, offer: rent });

      const declaredConstant = [{ model: 'license', amountMinorUnits: 9_600 }] as const;

      expect(selectOffer(declaredConstant, 'license')).toEqual({
        ok: true,
        offer: { model: 'license', amountMinorUnits: 9_600 },
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
  });

  describe('purity', () => {
    it('leaves the offer set it was given untouched', () => {
      const offers: readonly ListingOffer[] = [rent, purchase, license, subscription];

      selectOffer(offers, 'license');
      selectOffer(offers, 'subscription');

      expect(offers).toEqual([rent, purchase, license, subscription]);
    });

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
