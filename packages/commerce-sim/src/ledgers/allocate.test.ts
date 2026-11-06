import { describe, expect, it } from 'vitest';

import { allocate } from './allocate';

/**
 * The arithmetic the acceptance criteria fix, as the amount in whole minor units, the rate
 * in basis points and the allocation each pair must yield. Ten thousand minor units at the
 * default twenty-five basis points is the headline case; four thousand at the same rate is
 * the partial-refund case. Two hundred at twenty-five basis points is the half-up tie — its
 * product is exactly one half of ten thousand — and it is the only case here that tells
 * half-up apart from half-even or from truncation.
 */
const allocationCases = [
  { amountMinorUnits: 10000, rateBasisPoints: 25, expected: 25 },
  { amountMinorUnits: 0, rateBasisPoints: 25, expected: 0 },
  { amountMinorUnits: 4000, rateBasisPoints: 25, expected: 10 },
  { amountMinorUnits: 2000, rateBasisPoints: 25, expected: 5 },
  { amountMinorUnits: 200, rateBasisPoints: 25, expected: 1 },
  { amountMinorUnits: 100, rateBasisPoints: 25, expected: 0 },
  { amountMinorUnits: 10000, rateBasisPoints: 200, expected: 200 },
];

/**
 * Arguments that are not numbers at all, in either position: a refusal has to be the
 * documented `RangeError` whoever calls the function, so an untyped caller's value may not
 * escape as a conversion failure, and the message still names the offending argument. A
 * symbol and an object whose own text conversion raises are the two shapes an untyped caller
 * reaches; every fixture is typed as the parameter's type through `unknown`, as an untyped
 * caller's value is.
 */
const nonNumberCases = [
  {
    label: 'a symbol as the amount',
    amountMinorUnits: Symbol('amount') as unknown as number,
    rateBasisPoints: 25,
    offendingArgument: 'amountMinorUnits',
  },
  {
    label: 'a symbol as the rate',
    amountMinorUnits: 10000,
    rateBasisPoints: Symbol('rate') as unknown as number,
    offendingArgument: 'rateBasisPoints',
  },
  {
    label: 'an amount whose text conversion raises',
    amountMinorUnits: { toString: null } as unknown as number,
    rateBasisPoints: 25,
    offendingArgument: 'amountMinorUnits',
  },
  {
    label: 'a rate whose text conversion raises',
    amountMinorUnits: 10000,
    rateBasisPoints: { toString: null } as unknown as number,
    offendingArgument: 'rateBasisPoints',
  },
];

describe('allocate', () => {
  describe('arithmetic', () => {
    for (const { amountMinorUnits, rateBasisPoints, expected } of allocationCases) {
      it(`allocates ${expected} minor units from ${amountMinorUnits} at ${rateBasisPoints} basis points`, () => {
        expect(allocate(amountMinorUnits, rateBasisPoints)).toBe(expected);
      });
    }

    it('yields a whole number of minor units for every case', () => {
      const results = allocationCases.map(({ amountMinorUnits, rateBasisPoints }) =>
        allocate(amountMinorUnits, rateBasisPoints),
      );

      expect(results).not.toHaveLength(0);
      expect(results.every((result) => Number.isInteger(result))).toBe(true);
    });

    it('returns the same allocation for the same arguments', () => {
      // The anchor is what makes this case able to fail: without it, comparing the function
      // with its own return would hold for any deterministic allocation, a wrong one included.
      const first = allocate(10000, 25);
      const second = allocate(10000, 25);

      expect(first).toBe(25);
      expect(second).toBe(first);
    });
  });

  describe('refusals', () => {
    it('refuses a negative amount and names the argument', () => {
      expect(() => allocate(-1, 25)).toThrow(RangeError);
      expect(() => allocate(-1, 25)).toThrow('amountMinorUnits');
    });

    it('refuses a negative rate and names the argument', () => {
      expect(() => allocate(10000, -25)).toThrow(RangeError);
      expect(() => allocate(10000, -25)).toThrow('rateBasisPoints');
    });

    it('refuses a fractional amount', () => {
      expect(() => allocate(10.5, 25)).toThrow(RangeError);
    });

    it('refuses a fractional rate and names the argument', () => {
      expect(() => allocate(10000, 2.5)).toThrow(RangeError);
      expect(() => allocate(10000, 2.5)).toThrow('rateBasisPoints');
    });

    it('refuses NaN as the amount', () => {
      expect(() => allocate(Number.NaN, 25)).toThrow(RangeError);
    });

    it('refuses an infinite amount', () => {
      expect(() => allocate(Number.POSITIVE_INFINITY, 25)).toThrow(RangeError);
    });

    it('refuses a non-finite rate', () => {
      expect(() => allocate(10000, Number.NaN)).toThrow(RangeError);
      expect(() => allocate(10000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it('refuses an amount past the safe integer range', () => {
      expect(() => allocate(Number.MAX_SAFE_INTEGER + 1, 25)).toThrow(RangeError);
    });

    it('refuses a rate past the safe integer range and names the argument', () => {
      expect(() => allocate(10000, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
      expect(() => allocate(10000, Number.MAX_SAFE_INTEGER + 1)).toThrow('rateBasisPoints');
    });

    it('refuses a product past the safe integer range instead of rounding an inexact value', () => {
      // Both arguments are safe integers, so the checks on them pass and the product alone is
      // inexact. This is the only case that exercises the product check, and without it a call
      // whose product overflows would return an allocation rounded from a wrong value.
      expect(() => allocate(Number.MAX_SAFE_INTEGER, 10000)).toThrow(RangeError);
      expect(() => allocate(Number.MAX_SAFE_INTEGER, 10000)).toThrow('amountMinorUnits');
    });

    // Values that are not numbers, as distinct from numbers out of range: the refusals above
    // cover the range, this group covers the type, which is what an untyped caller reaches.
    describe('values that are not numbers', () => {
      for (const { label, amountMinorUnits, rateBasisPoints, offendingArgument } of nonNumberCases) {
        it(`refuses ${label} with the documented RangeError naming ${offendingArgument}`, () => {
          expect(() => allocate(amountMinorUnits, rateBasisPoints)).toThrow(RangeError);
          expect(() => allocate(amountMinorUnits, rateBasisPoints)).toThrow(offendingArgument);
        });
      }
    });
  });
});
