/**
 * Unit tests for the atomic simulated checkout.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because what this module promises is a property of the store as much
 * as of the code: three rows written as one act, a refusal that leaves the store exactly as it found
 * it, and an amount the listing's own offer resolved rather than a caller. The connection enables
 * `foreign_keys`, and the fixture seeds the account, category, listing and version the rows
 * reference, so a completed checkout succeeds against the real relationships rather than because a
 * constraint was switched off.
 *
 * The append-only triggers of `0010_append_only_triggers.sql` are applied with the rest of the
 * migrations and are not stood in for. The proof that no route updates or deletes an append-only row
 * belongs to the API's integration suite, which owns the routes and the triggers together; what is
 * asserted here is that every write this path performs is an insertion, and that a refused checkout
 * inserts nothing at all.
 *
 * The fixture is the package's own: the ordered migrations are applied to an in-memory handle with
 * `foreign_keys` on and the parent rows a transaction references seeded, which is the harness every
 * suite in this package uses, so a drift in the delivered schema fails a case here rather than
 * passing behind a hand-written copy of it. One refusal is planted for the atomicity case — a
 * `BEFORE INSERT` trigger that aborts a `founder_allocation` row — because a `CHECK` cannot be added
 * to a table the migrations have already created, and it lives only long enough to make the second of
 * the checkout's three writes fail. It asserts nothing about immutability.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNTHETIC_CURRENCY_LABEL } from '@adem/shared';
import type { OfferModel } from '@adem/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMERCE_DISCLOSURE_LABEL, resolveCommerceConfig } from '../config';
import type { CommerceConfig } from '../config';
import { allocate } from '../ledgers/allocate';
import { listLedgerEntries } from '../ledgers/ledger-repository';
import type { LedgerEntry } from '../ledgers/ledger-types';
import type { ListingOffer } from '../offers/select-offer';
import { createCheckoutSimulation } from './create-checkout-simulation';
import type {
  CheckoutSimulationRefusalReason,
  CheckoutSimulationResult,
  CreateCheckoutSimulationInput,
} from './create-checkout-simulation';

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL('../../../shared/migrations/', import.meta.url));

/**
 * The fiction this file stores, shaped as the identifiers every row of the product carries. All five
 * are fixed and invented: nothing here derives an identifier, and a fixed one is what lets a case
 * compare what it wrote with what it read back.
 */
const BUYER_ACCOUNT_ID = 'b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24';
const DEVELOPER_ACCOUNT_ID = '5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9';
const CATEGORY_ID = 'e41b8d76-9c02-4a35-8f61-7d0e5b94c218';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';

/** The instant the injected clock returns, as an ISO-8601 UTC string with milliseconds. */
const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/** The shape of a generated row identifier, so a generated one is recognised rather than assumed. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The resolved default configuration, which is the source of the two labels a row carries. */
const CONFIG = resolveCommerceConfig();

/**
 * The symbols a real currency's amount would be written with, none of which may appear beside a
 * simulated one: every amount this product stores is a whole count of minor units of the synthetic
 * label, so neither the amount nor the sentence that discloses it carries a currency mark.
 */
const CURRENCY_SYMBOLS = ['$', '€', '£'] as const;

/**
 * The offers the listing makes: a purchase at 10,000 minor units and a rent at 2,500. Both are whole
 * counts of minor units, and the models are distinct so a selection cannot pick the wrong entry.
 */
const OFFERS: readonly ListingOffer[] = [
  { model: 'purchase', amountMinorUnits: 10000 },
  { model: 'rent', amountMinorUnits: 2500 },
];

/**
 * The two refusals the checkout contract can meet, each reaching `not_offered` and `invalid_amount`
 * respectively: a model no entry in the offer set makes, and a matched entry whose amount is not a
 * whole number of minor units.
 */
const REFUSALS: ReadonlyArray<{
  readonly label: string;
  readonly offers: readonly ListingOffer[];
  readonly offerModel: OfferModel;
  readonly reason: CheckoutSimulationRefusalReason;
}> = [
  {
    label: 'a model the listing does not offer',
    offers: OFFERS,
    offerModel: 'subscription',
    reason: 'not_offered',
  },
  {
    label: 'a matched offer whose amount is not a whole number of minor units',
    offers: [
      { model: 'purchase', amountMinorUnits: 10000.5 },
      { model: 'rent', amountMinorUnits: 2500 },
    ],
    offerModel: 'purchase',
    reason: 'invalid_amount',
  },
];

/**
 * The amounts an offer cannot be made at, each refused before anything is written: a negative count
 * of minor units, a fractional one, and a value that is not a number at all. `Number.isSafeInteger`
 * refuses all three in one test, which is why no amount is adjusted on the way out.
 */
const INVALID_AMOUNTS: readonly number[] = [-1, 12.5, Number.NaN];

/** The stored shape of one `transactions` row, with `simulated` as the integer the column holds. */
interface StoredTransactionRow {
  readonly id: string;
  readonly buyer_account_id: string;
  readonly listing_id: string;
  readonly listing_version_id: string;
  readonly offer_model: string;
  readonly amount_minor_units: number;
  readonly currency_label: string;
  readonly simulated: number;
  readonly disclosure_label: string;
  readonly created_at: string;
}

/** The four stored columns of a `ledger_entries` row that identify what a checkout journalled. */
interface StoredLedgerRow {
  readonly ledger: string;
  readonly entry_type: string;
  readonly amount_minor_units: number;
  readonly transaction_id: string | null;
}

let db: Database.Database;

/** Applies every migration in filename order, which is the order the server's runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
}

/** Seeds the four rows a transaction references, so its foreign keys hold. */
function seedParents(): void {
  db.prepare('INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)').run(
    BUYER_ACCOUNT_ID,
    'demo-buyer-handle',
    'buyer',
    'Demo buyer account',
  );
  db.prepare('INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)').run(
    DEVELOPER_ACCOUNT_ID,
    'demo-developer-handle',
    'developer',
    'Demo developer account',
  );
  db.prepare('INSERT INTO categories (id, slug, name) VALUES (?, ?, ?)').run(
    CATEGORY_ID,
    'demo-category',
    'Demo category',
  );
  db.prepare(
    `INSERT INTO listings
       (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    LISTING_ID,
    DEVELOPER_ACCOUNT_ID,
    'demo-listing',
    'Demo listing',
    'A seeded listing used to reference a real row.',
    CATEGORY_ID,
    'MIT',
    'purchase',
    'active',
    FIXTURE_INSTANT,
    FIXTURE_INSTANT,
  );
  db.prepare(
    `INSERT INTO listing_versions
       (id, listing_id, version_string, notes, is_fixture_candidate, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(LISTING_VERSION_ID, LISTING_ID, '1.0.0', 'The first version.', 0, FIXTURE_INSTANT);
}

/** One checkout input over the seeded listing, with the offered set and the clock the fixture pins. */
function checkoutInput(
  overrides: Partial<CreateCheckoutSimulationInput> = {},
): CreateCheckoutSimulationInput {
  return {
    listingId: LISTING_ID,
    listingVersionId: LISTING_VERSION_ID,
    offerModel: 'purchase',
    offers: OFFERS,
    buyerAccountId: BUYER_ACCOUNT_ID,
    now: () => FIXTURE_INSTANT,
    ...overrides,
  };
}

/** Runs a checkout the case expects to complete, refusing a refusal rather than asserting on one. */
function completedCheckout(input: CreateCheckoutSimulationInput): CheckoutSimulationResult {
  const result = createCheckoutSimulation(db, input);

  if (!result.ok) {
    throw new Error(`expected a completed checkout, received the refusal ${result.reason}`);
  }

  return result;
}

/**
 * The ledger entry at an index, refusing an array shorter than the case expects. Indexing a
 * `readonly` array with `noUncheckedIndexedAccess` yields a possibly absent entry, and a case that
 * needs one says so here rather than asserting its way to a value.
 */
function entryAt(entries: readonly LedgerEntry[], index: number): LedgerEntry {
  const entry = entries[index];

  if (entry === undefined) {
    throw new Error(`expected a ledger entry at index ${String(index)}`);
  }

  return entry;
}

/** How many rows a table holds, read with this file's own statement rather than through the writers. */
function countRows(table: 'transactions' | 'ledger_entries'): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };

  return row.total;
}

/** Every stored transaction, in insertion order. */
function storedTransactions(): StoredTransactionRow[] {
  return db
    .prepare(
      `SELECT id, buyer_account_id, listing_id, listing_version_id, offer_model,
              amount_minor_units, currency_label, simulated, disclosure_label, created_at
       FROM transactions
       ORDER BY rowid`,
    )
    .all() as StoredTransactionRow[];
}

/** Every stored ledger entry, in insertion order, as the four columns a checkout is judged by. */
function storedLedgerRows(): StoredLedgerRow[] {
  return db
    .prepare(
      `SELECT ledger, entry_type, amount_minor_units, transaction_id
       FROM ledger_entries
       ORDER BY rowid`,
    )
    .all() as StoredLedgerRow[];
}

/**
 * Refuses the founder-allocation insert at the table, leaving the first two writes of a checkout
 * standing until the surrounding transaction rolls them back. SQLite cannot add a `CHECK` to an
 * existing table — which is why migration `0012` rebuilds the tables it guards rather than altering
 * them — so the refusal a case needs is planted as the trigger form the schema itself uses for its
 * append-only refusals: `RAISE(ABORT)` on the row the case refuses.
 */
function refuseFounderAllocationInserts(): void {
  db.exec(`CREATE TRIGGER refuse_founder_allocation_insert
BEFORE INSERT ON ledger_entries
WHEN NEW.ledger = 'founder_allocation'
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries refuses a founder_allocation row in this case');
END;`);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  seedParents();
});

afterEach(() => {
  db.close();
});

describe('createCheckoutSimulation', () => {
  describe('a completed checkout', () => {
    it('writes the transaction and both ledger entries, in write order', () => {
      const { transaction, ledgerEntries } = completedCheckout(checkoutInput());

      // The stored transaction: the boolean the contract's payload states, both labels from the
      // resolved configuration, and the amount the listing's own offer was made at.
      expect(transaction).toEqual({
        id: transaction.id,
        buyer_account_id: BUYER_ACCOUNT_ID,
        listing_id: LISTING_ID,
        listing_version_id: LISTING_VERSION_ID,
        offer_model: 'purchase',
        amount_minor_units: 10000,
        currency_label: SYNTHETIC_CURRENCY_LABEL,
        simulated: true,
        disclosure_label: COMMERCE_DISCLOSURE_LABEL,
        created_at: FIXTURE_INSTANT,
      });
      expect(transaction.id).toMatch(UUID_PATTERN);
      expect(transaction.simulated).toBe(true);
      expect(typeof transaction.simulated).toBe('boolean');
      // Every amount in this product is a whole count of minor units, and the one the listing made
      // is carried through untouched.
      expect(Number.isInteger(transaction.amount_minor_units)).toBe(true);

      // Two entries, in the order they were appended: the charge taken in, then the allocation
      // computed from it. Both reference the transaction and neither names a report.
      expect(ledgerEntries).toHaveLength(2);

      const marketplace = entryAt(ledgerEntries, 0);
      expect(marketplace).toMatchObject({
        ledger: 'marketplace',
        entry_type: 'charge',
        direction: 'debit',
        amount_minor_units: 10000,
        transaction_id: transaction.id,
        report_id: null,
        currency_label: SYNTHETIC_CURRENCY_LABEL,
        disclosure_label: COMMERCE_DISCLOSURE_LABEL,
        created_at: FIXTURE_INSTANT,
      });
      expect(marketplace.id).toMatch(UUID_PATTERN);

      const allocation = entryAt(ledgerEntries, 1);
      expect(allocation).toMatchObject({
        ledger: 'founder_allocation',
        entry_type: 'allocation',
        direction: 'credit',
        amount_minor_units: allocate(10000, CONFIG.founderAllocationRateBasisPoints),
        transaction_id: transaction.id,
        report_id: null,
        currency_label: SYNTHETIC_CURRENCY_LABEL,
        disclosure_label: COMMERCE_DISCLOSURE_LABEL,
        created_at: FIXTURE_INSTANT,
      });
      expect(allocation.id).toMatch(UUID_PATTERN);
      // Criterion 6's arithmetic at the default rate: 10,000 minor units at 25 basis points is 25.
      expect(allocation.amount_minor_units).toBe(25);
      // The appended row is the durable record of the rate its amount was computed from.
      expect(allocation.description).toMatch(/25 basis points/);

      // What the store holds matches what the call returned, in the same order.
      expect(storedTransactions()).toEqual([
        {
          id: transaction.id,
          buyer_account_id: BUYER_ACCOUNT_ID,
          listing_id: LISTING_ID,
          listing_version_id: LISTING_VERSION_ID,
          offer_model: 'purchase',
          amount_minor_units: 10000,
          currency_label: SYNTHETIC_CURRENCY_LABEL,
          simulated: 1,
          disclosure_label: COMMERCE_DISCLOSURE_LABEL,
          created_at: FIXTURE_INSTANT,
        },
      ]);
      expect(storedLedgerRows()).toEqual([
        {
          ledger: 'marketplace',
          entry_type: 'charge',
          amount_minor_units: 10000,
          transaction_id: transaction.id,
        },
        {
          ledger: 'founder_allocation',
          entry_type: 'allocation',
          amount_minor_units: 25,
          transaction_id: transaction.id,
        },
      ]);

      // The journal as the operator surfaces read it: one charge in the marketplace ledger, one
      // allocation in the founder ledger, and a gate-fee ledger the checkout never touched — a
      // gate-evaluation fee is charged per completed evaluation by the evaluation path.
      expect(countRows('transactions')).toBe(1);
      expect(countRows('ledger_entries')).toBe(2);
      expect(listLedgerEntries(db, 'marketplace')).toHaveLength(1);
      expect(listLedgerEntries(db, 'founder_allocation')).toHaveLength(1);
      expect(listLedgerEntries(db, 'gate_fees')).toHaveLength(0);

      const [marketplaceOnDisk] = listLedgerEntries(db, 'marketplace');
      expect(marketplaceOnDisk?.amount_minor_units).toBe(transaction.amount_minor_units);
      expect(marketplaceOnDisk?.transaction_id).toBe(transaction.id);
    });

    it('resolves the allocation from the configuration it is given, and journals no gate fee', () => {
      const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });

      const { transaction, ledgerEntries } = completedCheckout(checkoutInput({ config }));

      // The supplied rate is the rate the entry was computed from: 10,000 minor units at 100 basis
      // points is 100, where the default rate produced 25 for the same amount.
      expect(entryAt(ledgerEntries, 1).amount_minor_units).toBe(allocate(10000, 100));
      expect(entryAt(ledgerEntries, 1).amount_minor_units).toBe(100);
      expect(entryAt(ledgerEntries, 1).description).toMatch(/100 basis points/);

      // A checkout journals exactly these two ledgers. A gate-evaluation fee is charged per
      // completed evaluation in the gate-fee ledger by the evaluation path, so a configured fee of
      // any size produces no entry here.
      expect(config.gateFeeMinorUnits).toBe(15000);
      expect(ledgerEntries.map((entry) => entry.ledger)).toEqual([
        'marketplace',
        'founder_allocation',
      ]);
      expect(storedLedgerRows().map((row) => row.ledger)).not.toContain('gate_fees');
      expect(countRows('ledger_entries')).toBe(2);
      expect(transaction.amount_minor_units).toBe(10000);

      // A configured fee reaches neither amount a checkout journals: the fee belongs to the
      // evaluation path, and no member of a checkout input could carry one.
      const feeConfig = resolveCommerceConfig({ gateFeeMinorUnits: 50000 });
      const second = completedCheckout(checkoutInput({ config: feeConfig }));

      expect(feeConfig.gateFeeMinorUnits).toBe(50000);
      expect(second.transaction.amount_minor_units).toBe(10000);
      expect(entryAt(second.ledgerEntries, 0).amount_minor_units).toBe(10000);
      expect(entryAt(second.ledgerEntries, 1).amount_minor_units).toBe(
        allocate(10000, feeConfig.founderAllocationRateBasisPoints),
      );
      expect(entryAt(second.ledgerEntries, 1).amount_minor_units).toBe(25);
      expect(listLedgerEntries(db, 'gate_fees')).toHaveLength(0);
    });

    it('appends a second checkout beside the first, leaving the first row untouched', () => {
      const first = completedCheckout(checkoutInput());
      const second = completedCheckout(checkoutInput({ offerModel: 'rent' }));

      expect(second.transaction.id).not.toBe(first.transaction.id);
      expect(countRows('transactions')).toBe(2);
      expect(countRows('ledger_entries')).toBe(4);

      // Each checkout journals its own pair, in write order and at its own offer's amount, and the
      // gate-fee ledger stays empty for both. This is the append-only property observed through the
      // module's own reads, with no trigger involved.
      expect(listLedgerEntries(db, 'marketplace').map((entry) => entry.amount_minor_units)).toEqual([
        10000,
        2500,
      ]);
      expect(
        listLedgerEntries(db, 'founder_allocation').map((entry) => entry.amount_minor_units),
      ).toEqual([25, allocate(2500, CONFIG.founderAllocationRateBasisPoints)]);
      expect(listLedgerEntries(db, 'gate_fees')).toHaveLength(0);

      // The row written first still reads back exactly as it was written.
      const stored = storedTransactions();
      expect(stored).toHaveLength(2);
      expect(stored[0]).toEqual({ ...first.transaction, simulated: 1 });
      expect(stored[1]).toEqual({ ...second.transaction, simulated: 1 });
    });

    it('states the simulation in the row: the synthetic label, and no currency symbol', () => {
      const { transaction } = completedCheckout(checkoutInput());

      for (const symbol of CURRENCY_SYMBOLS) {
        expect(transaction.disclosure_label).not.toContain(symbol);
        expect(transaction.currency_label).not.toContain(symbol);
      }

      expect(transaction.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
      expect(storedTransactions()[0]?.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
      // The amount is a whole count of minor units of that label, so a currency mark has nowhere to
      // appear — on the row, or in the sentence that discloses it.
      expect(Number.isInteger(storedTransactions()[0]?.amount_minor_units)).toBe(true);
    });
  });

  describe('a refused checkout', () => {
    it.each(REFUSALS)('refuses $label and writes no row at all', ({ offers, offerModel, reason }) => {
      const result = createCheckoutSimulation(db, checkoutInput({ offers, offerModel }));

      expect(result).toEqual({ ok: false, reason });
      // The refusal is decided before the transaction opens, so no row of any of the three writes
      // exists afterwards: this is what distinguishes a refusal from a partial write.
      expect(countRows('transactions')).toBe(0);
      expect(countRows('ledger_entries')).toBe(0);
    });

    it.each(INVALID_AMOUNTS)(
      'refuses an offer made at %s minor units, and writes no row at all',
      (amountMinorUnits) => {
        const result = createCheckoutSimulation(
          db,
          checkoutInput({ offers: [{ model: 'purchase', amountMinorUnits }] }),
        );

        // Nothing throws for any of the three shapes an unusable amount takes, and the store is left
        // exactly as it was found. The branch is unreachable over HTTP, which is why the refused
        // amount is asserted here rather than at the edge.
        expect(result).toEqual({ ok: false, reason: 'invalid_amount' });
        expect(countRows('transactions')).toBe(0);
        expect(countRows('ledger_entries')).toBe(0);
      },
    );
  });

  describe('atomicity', () => {
    it('leaves the store untouched when the allocation write is refused by the table', () => {
      refuseFounderAllocationInserts();

      expect(() => createCheckoutSimulation(db, checkoutInput())).toThrow(
        /refuses a founder_allocation row/,
      );

      // The same input completes when that refusal is absent — the case above writes all three rows
      // — so the transaction row and the marketplace entry had both been written before the third
      // write failed, and the surrounding transaction rolled both of them back.
      expect(countRows('transactions')).toBe(0);
      expect(countRows('ledger_entries')).toBe(0);
    });

    it('leaves the store untouched when the allocation arithmetic refuses the configured rate', () => {
      // A hand-built configuration is the only way a fractional rate reaches the arithmetic: the
      // configuration resolver refuses one, while the members themselves are typed `number`.
      const config: CommerceConfig = {
        ...CONFIG,
        founderAllocationRateBasisPoints: 0.5,
      };

      expect(() => createCheckoutSimulation(db, checkoutInput({ config }))).toThrow(RangeError);

      // A failure that is not the database's rolls the checkout back just as a refused insert does.
      expect(countRows('transactions')).toBe(0);
      expect(countRows('ledger_entries')).toBe(0);
    });
  });
});
