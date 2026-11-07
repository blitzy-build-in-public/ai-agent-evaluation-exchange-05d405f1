import { describe, expect, it } from 'vitest';

import { SYNTHETIC_CURRENCY_LABEL } from '@adem/shared';
import type { Refund, Transaction } from '@adem/shared';

import { COMMERCE_DISCLOSURE_LABEL, resolveCommerceConfig } from '../config';
import type { CommerceConfig } from '../config';
import { allocate } from '../ledgers/allocate';
import type { LedgerEntryInput } from '../ledgers/ledger-types';
import { buildReversalEntries } from './reversal-entries';

const DEFAULT_CONFIG = resolveCommerceConfig();

/**
 * The fixture identifiers, shaped as the v4 UUID strings every stored row's identifier is. They are
 * fictional and fixed: nothing here derives an identifier, and a fixed one is what lets a case
 * compare the entry it built with the transaction and the refund it was built from.
 */
const TRANSACTION_ID = '3b1f6c24-9d7a-4e15-8c02-6a4d9f0e5b73';
const REFUND_ID = 'd84a1e60-5c3b-4f92-b716-0e2f8a4c93d1';
const BUYER_ACCOUNT_ID = 'b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24';
const OPERATOR_ACCOUNT_ID = '9f0e4a13-7b58-4c26-a93d-5e1f7c2b8d06';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';

const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/**
 * One half, written as a power of two: the fraction the refusal cases pass without this file carrying
 * a fractional literal, and an exactly representable value, so the amount and the rate those cases
 * build are precisely the non-whole numbers the allocation must refuse.
 */
const ONE_HALF = 2 ** -1;

/**
 * The nine fields a `ledger_entries` insert shape carries, alphabetically. Asserting the key set of
 * each built entry against this list is what proves the two generated columns — the row's
 * identifier and its insertion instant — are absent from what the builder returns: a shape carrying
 * either would be a writer supplying a value the table generates.
 */
const INSERT_FIELDS: readonly string[] = [
  'amount_minor_units',
  'currency_label',
  'description',
  'direction',
  'disclosure_label',
  'entry_type',
  'ledger',
  'report_id',
  'transaction_id',
];

/**
 * The refunded amount and the transaction's own amount, as two separate figures on purpose: a
 * partial refund reverses part of the charge, so a builder that read the transaction's amount
 * instead of the refund's would pass a case where the two are equal and fail this one.
 */
const TRANSACTION_AMOUNT_MINOR_UNITS = 10000;

function refundOf(amountMinorUnits: number): Refund {
  return {
    id: REFUND_ID,
    transaction_id: TRANSACTION_ID,
    amount_minor_units: amountMinorUnits,
    operator_account_id: OPERATOR_ACCOUNT_ID,
    created_at: FIXTURE_INSTANT,
  };
}

function transactionOf(amountMinorUnits: number): Transaction {
  return {
    id: TRANSACTION_ID,
    buyer_account_id: BUYER_ACCOUNT_ID,
    listing_id: LISTING_ID,
    listing_version_id: LISTING_VERSION_ID,
    offer_model: 'purchase',
    amount_minor_units: amountMinorUnits,
    currency_label: SYNTHETIC_CURRENCY_LABEL,
    simulated: true,
    disclosure_label: COMMERCE_DISCLOSURE_LABEL,
    created_at: FIXTURE_INSTANT,
  };
}

/**
 * Reads the two entries the builder returns, refusing a result that carries fewer.
 *
 * The guard is on the indexed reads rather than on the length alone because the two entries are
 * addressed individually below: answering the first two positions explicitly is what keeps the
 * field-by-field assertions from being written against a possibly absent entry.
 */
function requireBoth(entries: readonly LedgerEntryInput[]): readonly [LedgerEntryInput, LedgerEntryInput] {
  const first = entries[0];
  const second = entries[1];

  if (first === undefined || second === undefined) {
    throw new Error('buildReversalEntries must return both reversal entries');
  }

  return [first, second];
}

function buildFor(
  refundedAmountMinorUnits: number,
  transactionAmountMinorUnits: number,
  config: CommerceConfig = DEFAULT_CONFIG,
): readonly [LedgerEntryInput, LedgerEntryInput] {
  return requireBoth(
    buildReversalEntries({
      refund: refundOf(refundedAmountMinorUnits),
      transaction: transactionOf(transactionAmountMinorUnits),
      config,
    }),
  );
}

describe('buildReversalEntries', () => {
  describe('the pair it returns', () => {
    it('returns exactly two entries, the marketplace reversal before the founder-allocation reversal', () => {
      const entries = buildReversalEntries({
        refund: refundOf(4000),
        transaction: transactionOf(TRANSACTION_AMOUNT_MINOR_UNITS),
        config: DEFAULT_CONFIG,
      });

      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.ledger)).toEqual(['marketplace', 'founder_allocation']);
    });

    it('records both entries as reversals', () => {
      const [marketplace, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(marketplace.entry_type).toBe('reversal');
      expect(founder.entry_type).toBe('reversal');
    });

    it('records each entry on the side opposite the entry it corrects', () => {
      // A charge sits on the debit side of the marketplace ledger and an allocation on the credit
      // side of the founder-allocation ledger, so each reversal carries the other direction.
      const [marketplace, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(marketplace.direction).toBe('credit');
      expect(founder.direction).toBe('debit');
    });

    it('carries the nine insert fields and neither generated column', () => {
      const [marketplace, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(Object.keys(marketplace).sort()).toEqual([...INSERT_FIELDS]);
      expect(Object.keys(founder).sort()).toEqual([...INSERT_FIELDS]);
      expect(marketplace).not.toHaveProperty('id');
      expect(marketplace).not.toHaveProperty('created_at');
    });
  });

  describe('the marketplace reversal', () => {
    it('reverses the refunded amount and references the transaction it corrects', () => {
      const [marketplace] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(marketplace).toMatchObject({
        ledger: 'marketplace',
        entry_type: 'reversal',
        direction: 'credit',
        amount_minor_units: 4000,
        transaction_id: TRANSACTION_ID,
        report_id: null,
        currency_label: SYNTHETIC_CURRENCY_LABEL,
        disclosure_label: COMMERCE_DISCLOSURE_LABEL,
      });
      expect(marketplace.description).toContain(TRANSACTION_ID);
    });

    it('reverses the refunded amount rather than the amount of the transaction', () => {
      const [partialReversal] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);
      const [fullReversal] = buildFor(TRANSACTION_AMOUNT_MINOR_UNITS, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(partialReversal.amount_minor_units).toBe(4000);
      expect(fullReversal.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
    });

    it('references the transaction it corrects and no report at all', () => {
      const [marketplace, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      // A reversal corrects a transaction, so both entries name it; neither names an evaluation
      // report, because nothing on this path measures anything.
      expect(marketplace.transaction_id).toBe(TRANSACTION_ID);
      expect(founder.transaction_id).toBe(TRANSACTION_ID);
      expect(marketplace.report_id).toBeNull();
      expect(founder.report_id).toBeNull();
    });
  });

  describe('the founder-allocation reversal', () => {
    it('states the configured rate on the entry it computed the amount from', () => {
      const [, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      // The appended row is the durable record of the rate its amount was computed from, so the rate
      // is asserted as the decimal string of the configured value beside the unit it is expressed in
      // rather than as a written-out sentence: the wording belongs to the module under test.
      expect(founder.description).toContain(String(DEFAULT_CONFIG.founderAllocationRateBasisPoints));
      expect(founder.description).toContain('basis points');
      expect(founder.description).toContain(TRANSACTION_ID);
    });

    it('changes only the founder entry when the configured rate changes', () => {
      // The rate reaches the founder-allocation reversal alone: the marketplace reversal carries the
      // refunded amount through untouched, so the two ledgers cannot disagree about what the refund
      // states however the allocation is configured.
      const changedRate = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });
      const [marketplace, founder] = buildFor(
        TRANSACTION_AMOUNT_MINOR_UNITS,
        TRANSACTION_AMOUNT_MINOR_UNITS,
        changedRate,
      );

      expect(founder.amount_minor_units).toBe(100);
      expect(founder.description).toContain(String(changedRate.founderAllocationRateBasisPoints));
      expect(founder.description).toContain('basis points');
      expect(marketplace.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
    });

    it('carries the currency and disclosure labels of the configuration it was handed', () => {
      // Both labels have a single legal value in this product — the currency label is typed as that
      // literal and resolution always returns the one disclosure sentence — so the rate is the
      // member a fixture can vary to tell a configuration-sourced entry from a hardcoded one. The
      // label assertions still hold the entry to the configuration it was passed.
      const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });
      const [marketplace, founder] = buildFor(3000, TRANSACTION_AMOUNT_MINOR_UNITS, config);

      for (const entry of [marketplace, founder]) {
        expect(entry.currency_label).toBe(config.currencyLabel);
        expect(entry.disclosure_label).toBe(config.disclosureLabel);
      }
    });
  });

  describe('the arithmetic it delegates', () => {
    it('reverses a partial refund of 4000 minor units to 10 minor units at 25 basis points', () => {
      // The anchor is what makes this case able to fail: without it, comparing the entry with the
      // allocation function itself would hold for any rate the builder might have applied.
      expect(allocate(4000, 25)).toBe(10);

      const [, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(founder.amount_minor_units).toBe(10);
    });

    it('reverses a full refund of 10000 minor units to 25 minor units at 25 basis points', () => {
      expect(allocate(TRANSACTION_AMOUNT_MINOR_UNITS, 25)).toBe(25);

      const [marketplace, founder] = buildFor(TRANSACTION_AMOUNT_MINOR_UNITS, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(marketplace.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
      expect(founder.amount_minor_units).toBe(25);
    });

    it('returns whole minor units for every case', () => {
      const refundedAmounts = [0, 1, 100, 200, 4000, 10000, 999999];

      for (const refundedAmount of refundedAmounts) {
        const [marketplace, founder] = buildFor(refundedAmount, TRANSACTION_AMOUNT_MINOR_UNITS);

        expect(Number.isInteger(marketplace.amount_minor_units)).toBe(true);
        expect(Number.isInteger(founder.amount_minor_units)).toBe(true);
      }
    });

    it('takes its founder amount from the single rounding point at the configured rate', () => {
      // Both amounts are compared with what they must be derived from rather than with a second
      // implementation of the arithmetic: a builder applying a rate of its own — the default
      // hardcoded, the rate doubled, the rate of a different configuration — fails here however well
      // the anchored cases above pass.
      const cases: readonly {
        readonly refundedAmountMinorUnits: number;
        readonly rateBasisPoints: number;
      }[] = [
        { refundedAmountMinorUnits: 1, rateBasisPoints: 1 },
        { refundedAmountMinorUnits: 4000, rateBasisPoints: 25 },
        { refundedAmountMinorUnits: 10000, rateBasisPoints: 100 },
        { refundedAmountMinorUnits: 999999, rateBasisPoints: 2500 },
        { refundedAmountMinorUnits: 4000, rateBasisPoints: 0 },
      ];

      for (const { refundedAmountMinorUnits, rateBasisPoints } of cases) {
        const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: rateBasisPoints });
        const [marketplace, founder] = buildFor(
          refundedAmountMinorUnits,
          TRANSACTION_AMOUNT_MINOR_UNITS,
          config,
        );

        expect(founder.amount_minor_units).toBe(
          allocate(refundedAmountMinorUnits, config.founderAllocationRateBasisPoints),
        );
        expect(marketplace.amount_minor_units).toBe(refundedAmountMinorUnits);
      }
    });

    it('answers a refund of nothing with its two entries and no refusal', () => {
      const [marketplace, founder] = buildFor(0, TRANSACTION_AMOUNT_MINOR_UNITS);

      expect(marketplace.amount_minor_units).toBe(0);
      expect(founder.amount_minor_units).toBe(0);
    });
  });

  describe('what it never emits', () => {
    it('emits no allocation-typed entry, because a reversal repays rather than allocates', () => {
      const entries = buildReversalEntries({
        refund: refundOf(4000),
        transaction: transactionOf(TRANSACTION_AMOUNT_MINOR_UNITS),
        config: DEFAULT_CONFIG,
      });

      expect(entries.filter((entry) => entry.entry_type === 'allocation')).toHaveLength(0);
      expect(entries.every((entry) => entry.entry_type === 'reversal')).toBe(true);
    });

    it('writes no currency symbol, payment path or personal reference into a description', () => {
      const [marketplace, founder] = buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS);
      const forbidden = /[$€£¥₹]|provider|card|bank|account|entitlement|beneficiary/i;

      expect(marketplace.description).not.toMatch(forbidden);
      expect(founder.description).not.toMatch(forbidden);
    });
  });

  describe('purity', () => {
    it('leaves the refund, the transaction and the configuration as it found them', () => {
      const refund = Object.freeze(refundOf(4000));
      const transaction = Object.freeze(transactionOf(TRANSACTION_AMOUNT_MINOR_UNITS));
      const config = Object.freeze(resolveCommerceConfig());

      const before = JSON.stringify({ refund, transaction, config });

      buildReversalEntries({ refund, transaction, config });

      expect(JSON.stringify({ refund, transaction, config })).toBe(before);
    });

    it('returns equal but distinct entries for equal arguments', () => {
      const input = {
        refund: refundOf(4000),
        transaction: transactionOf(TRANSACTION_AMOUNT_MINOR_UNITS),
        config: DEFAULT_CONFIG,
      };

      const first = buildReversalEntries(input);
      const second = buildReversalEntries(input);

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(requireBoth(first)[0]).not.toBe(requireBoth(second)[0]);
      expect(requireBoth(first)[1]).not.toBe(requireBoth(second)[1]);
    });

    it('returns entries that are no member of the input it was handed', () => {
      const input = {
        refund: refundOf(4000),
        transaction: transactionOf(TRANSACTION_AMOUNT_MINOR_UNITS),
        config: DEFAULT_CONFIG,
      };
      const inputMembers: readonly unknown[] = [input, input.refund, input.transaction, input.config];

      // The entries are built, not borrowed: a builder returning a slice of what it was handed would
      // let a later write into a returned entry reach the stored refund or transaction it came from.
      for (const entry of buildReversalEntries(input)) {
        expect(inputMembers).not.toContain(entry);
      }
    });

    it('answers a later caller from a fresh array after the earlier result was changed', () => {
      const input = {
        refund: refundOf(4000),
        transaction: transactionOf(TRANSACTION_AMOUNT_MINOR_UNITS),
        config: DEFAULT_CONFIG,
      };

      const first = buildReversalEntries(input);
      requireBoth(first)[0].description = 'changed by the caller';
      first.push(requireBoth(first)[1]);

      const second = buildReversalEntries(input);

      expect(second).toHaveLength(2);
      expect(second[0]?.description).toContain(TRANSACTION_ID);
    });
  });

  describe('refusals', () => {
    it('propagates the RangeError for a negative refunded amount and names the argument', () => {
      expect(() => buildFor(-1, TRANSACTION_AMOUNT_MINOR_UNITS)).toThrow(RangeError);
      expect(() => buildFor(-1, TRANSACTION_AMOUNT_MINOR_UNITS)).toThrow('amountMinorUnits');
    });

    it('propagates the RangeError for a fractional refunded amount', () => {
      // The fraction is written as a power of two rather than as a fractional literal, so this file
      // holds no fractional amount for a reader to copy; a half is exactly representable, so what the
      // call passes is precisely the non-whole amount the allocation refuses.
      expect(() => buildFor(ONE_HALF, TRANSACTION_AMOUNT_MINOR_UNITS)).toThrow(RangeError);
      expect(() => buildFor(ONE_HALF, TRANSACTION_AMOUNT_MINOR_UNITS)).toThrow('amountMinorUnits');
    });

    it('propagates the RangeError for a configured rate that is not a whole number', () => {
      // A rate a half above a whole number, as an untyped caller can build one: the configuration
      // this object stands for is never resolved here, so the rate reaches the allocation, which is
      // what refuses it.
      const malformedRate: CommerceConfig = {
        currencyLabel: SYNTHETIC_CURRENCY_LABEL,
        gateFeeMinorUnits: DEFAULT_CONFIG.gateFeeMinorUnits,
        founderAllocationRateBasisPoints:
          DEFAULT_CONFIG.founderAllocationRateBasisPoints + ONE_HALF,
        disclosureLabel: DEFAULT_CONFIG.disclosureLabel,
      };

      expect(() => buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS, malformedRate)).toThrow(RangeError);
      expect(() => buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS, malformedRate)).toThrow(
        'rateBasisPoints',
      );
    });

    it('refuses nothing when the amount is whole and the rate is whole', () => {
      const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: 0 });

      expect(() => buildFor(4000, TRANSACTION_AMOUNT_MINOR_UNITS, config)).not.toThrow();
    });
  });
});
