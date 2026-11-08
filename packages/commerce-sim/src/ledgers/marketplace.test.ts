/**
 * Unit tests for the marketplace charge of one completed simulated transaction.
 *
 * Every case runs in process against a real SQLite database held in memory and built from the ordered
 * migrations in `packages/shared/migrations/`, applied in filename order exactly as the server's
 * runner applies them: the three closed vocabularies, the non-negative amount guard, the
 * synthetic-currency guard and the table-level pair constraint are properties of the delivered schema
 * rather than of the function alone, so a schema drift has to fail a case here instead of passing
 * silently. The connection enables `foreign_keys`, and the fixture seeds every row a charge
 * references — the buyer and the developer with their category, listing and version, and the two
 * transactions this file's own two identifiers name — so the transaction side of an entry is a row of
 * the delivered tables and the delivered references hold. The append-only abort triggers of
 * `0010_append_only_triggers.sql` arrive with those migrations, as they do in the delivered schema:
 * what this file asserts is the property the module holds, that a call appends one new row and leaves
 * the rows already appended untouched. The proof that no route rewrites an append-only row belongs to
 * the API's integration suite in `apps/api/test/integration/`, which owns the routes.
 *
 * No HTTP server, no database file and no per-package runner configuration: the file is discovered
 * by the root unit configuration's `packages/ * /src/**` glob.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCommerceConfig } from '../config';
import { listLedgerEntries } from './ledger-repository';
import { recordMarketplaceCharge } from './marketplace';

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL('../../../shared/migrations/', import.meta.url));

/**
 * The rows every fixture entry hangs from: the buyer whose transactions are journalled, the developer
 * who owns the listing, the category that listing sits in, the listing itself and its first version.
 * All five are fixed and invented, and they are the same demonstration identities this workspace's
 * sibling fixtures store.
 */
const BUYER_ACCOUNT_ID = 'b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24';
const DEVELOPER_ACCOUNT_ID = '5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9';
const CATEGORY_ID = 'e41b8d76-9c02-4a35-8f61-7d0e5b94c218';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';

/**
 * The fiction this file journals. Both identifiers and the amount are fixed and invented, and each
 * identifier names a seeded transaction row that {@link seedReferencedRows} writes, so the reference
 * a charge carries is a real reference rather than an opaque string.
 */
const TRANSACTION_ID = '1f2b6d84-9a30-4c57-8e12-6b4d7c05a9f3';
const SECOND_TRANSACTION_ID = '5d9c3a71-40e8-4b26-9f15-7c2a6d08e3b4';

/** The transaction's own amount, in whole minor units of the synthetic currency. */
const TRANSACTION_AMOUNT_MINOR_UNITS = 10000;

/** The instant the injected clock returns, pinned so an appended instant is a known value. */
const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/** The clock a case appends under, so the row's instant is the argument and not a reading. */
const pinnedNow = (): string => FIXTURE_INSTANT;

/** The shape the default clock's ISO-8601 UTC instant takes, asserted where none is supplied. */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shape `crypto.randomUUID()` produces; asserted so two appended rows cannot share an id. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The resolved configuration, which is the only source of the two labels an entry carries. */
const CONFIG = resolveCommerceConfig();

/**
 * A resolved configuration whose two numbers differ from the product's defaults, so a case can show
 * that neither number reaches a marketplace charge: the amount is the transaction's and the fee the
 * simulation is configured with must never appear in this ledger.
 */
const CHANGED_CONFIG = resolveCommerceConfig({
  gateFeeMinorUnits: 7777,
  founderAllocationRateBasisPoints: 1,
});

let db: Database.Database;

/** Applies every migration in filename order, which is the order the server's runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
}

/**
 * Seeds every row the fixture's charges reference, in the order the delivered references require: the
 * two accounts, the category, the listing the developer owns and its first version, and the two
 * transactions this file's own two identifiers name.
 */
function seedReferencedRows(): void {
  const insertAccount =
    db.prepare('INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)');

  insertAccount.run(BUYER_ACCOUNT_ID, 'demo-buyer-handle', 'buyer', 'Demo buyer account');
  insertAccount.run(
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

  const insertTransaction = db.prepare(
    `INSERT INTO transactions
       (id, buyer_account_id, listing_id, listing_version_id, offer_model,
        amount_minor_units, currency_label, simulated, disclosure_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // One row per identifier this file journals a charge against, so each charge's reference is a row
  // the transactions table holds. The two labels are the table's own: the synthetic currency label
  // its `CHECK` admits and the resolved configuration's disclosure label.
  for (const transactionId of [TRANSACTION_ID, SECOND_TRANSACTION_ID]) {
    insertTransaction.run(
      transactionId,
      BUYER_ACCOUNT_ID,
      LISTING_ID,
      LISTING_VERSION_ID,
      'purchase',
      TRANSACTION_AMOUNT_MINOR_UNITS,
      'DEMO',
      1,
      CONFIG.disclosureLabel,
      FIXTURE_INSTANT,
    );
  }
}

/** One stored row, read through this file's own statement rather than through the module under test. */
interface StoredLedgerEntryRow {
  readonly id: string;
  readonly ledger: string;
  readonly entry_type: string;
  readonly direction: string;
  readonly amount_minor_units: number;
  readonly transaction_id: string | null;
  readonly report_id: string | null;
  readonly currency_label: string;
  readonly disclosure_label: string;
  readonly description: string;
  readonly created_at: string;
}

/** Reads one stored row by its identifier, independently of the module under test. */
function readStoredRow(id: string): StoredLedgerEntryRow | undefined {
  return db
    .prepare<[string], StoredLedgerEntryRow>(
      `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE id = ?`,
    )
    .get(id);
}

/** Counts every stored row, so a case can assert that a call only appended rows. */
function storedRowCount(): number {
  const row = db
    .prepare<[], { readonly count: number }>('SELECT COUNT(*) AS count FROM ledger_entries')
    .get();

  return row?.count ?? 0;
}

/** Counts the stored rows of one ledger, so a case can assert which ledger a call wrote to. */
function storedRowCountInLedger(ledger: string): number {
  const row = db
    .prepare<[string], { readonly count: number }>(
      'SELECT COUNT(*) AS count FROM ledger_entries WHERE ledger = ?',
    )
    .get(ledger);

  return row?.count ?? 0;
}

/**
 * The input one call is made with. The clock is attached only when a case supplies one, because
 * `exactOptionalPropertyTypes` makes an absent member and one written as `undefined` different
 * things.
 */
function inputFor(
  transactionId: string,
  amountMinorUnits: number = TRANSACTION_AMOUNT_MINOR_UNITS,
  overrides: { readonly config?: typeof CONFIG; readonly now?: () => string } = {},
) {
  const input = {
    transactionId,
    amountMinorUnits,
    config: overrides.config ?? CONFIG,
  };

  return overrides.now === undefined ? input : { ...input, now: overrides.now };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  seedReferencedRows();
});

afterEach(() => {
  db.close();
});

describe('recordMarketplaceCharge', () => {
  it('appends one charge to the marketplace ledger and returns the appended row', () => {
    const appended = recordMarketplaceCharge(db, inputFor(TRANSACTION_ID));

    expect(appended).toMatchObject({
      ledger: 'marketplace',
      entry_type: 'charge',
      direction: 'debit',
      amount_minor_units: TRANSACTION_AMOUNT_MINOR_UNITS,
    });
    expect(appended.id).toMatch(UUID_V4);

    // Exactly one row was appended by the one call, and the returned entry is that stored row:
    // reading the table through a statement of this file's own shows the same values.
    expect(storedRowCount()).toBe(1);
    expect(readStoredRow(appended.id)).toEqual(appended);
    expect(listLedgerEntries(db, 'marketplace')).toEqual([appended]);
  });

  it('carries the transaction reference and an explicit null for the report reference', () => {
    const appended = recordMarketplaceCharge(db, inputFor(TRANSACTION_ID));

    expect(appended.transaction_id).toBe(TRANSACTION_ID);
    expect(appended.report_id).toBeNull();

    // The pair constraint of migration 0008 accepts the row, which is the statement that it names
    // the transaction side and not both sides at once.
    const stored = readStoredRow(appended.id);
    expect(stored?.transaction_id).toBe(TRANSACTION_ID);
    expect(stored?.report_id).toBeNull();
  });

  it('journals the amount it was given, as a whole number of minor units', () => {
    const appended = recordMarketplaceCharge(
      db,
      inputFor(TRANSACTION_ID, TRANSACTION_AMOUNT_MINOR_UNITS),
    );

    // The amount is the transaction's own figure, carried through untouched: the simulation's
    // charge for the buyer's selected offer, and a whole number of minor units and never a
    // fraction of one.
    expect(appended.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
    expect(Number.isInteger(appended.amount_minor_units)).toBe(true);
    expect(readStoredRow(appended.id)?.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
  });

  it('takes both labels from the resolved configuration rather than from a caller', () => {
    const appended = recordMarketplaceCharge(
      db,
      inputFor(SECOND_TRANSACTION_ID, TRANSACTION_AMOUNT_MINOR_UNITS, { config: CHANGED_CONFIG }),
    );

    // The two labels are the configuration's own members, and the currency label is the product's
    // one synthetic label, which is what the column's `CHECK` admits.
    expect(appended.currency_label).toBe(CHANGED_CONFIG.currencyLabel);
    expect(appended.currency_label).toBe('DEMO');
    expect(appended.disclosure_label).toBe(CHANGED_CONFIG.disclosureLabel);

    const stored = readStoredRow(appended.id);
    expect(stored?.currency_label).toBe(CHANGED_CONFIG.currencyLabel);
    expect(stored?.disclosure_label).toBe(CHANGED_CONFIG.disclosureLabel);
  });

  it('states in the row that the charge is simulated, in plain single-byte text', () => {
    const appended = recordMarketplaceCharge(db, inputFor(TRANSACTION_ID));

    expect(appended.description).toContain('Simulated');

    // No currency symbol and no other character outside printable ASCII can reach the description:
    // a reader of the operator ledger view must not meet an amount that reads as a real one.
    expect(appended.description).toMatch(/^[\x20-\x7E]+$/);
  });

  it('appends a second row for a second transaction and leaves the first row untouched', () => {
    const first = recordMarketplaceCharge(db, { ...inputFor(TRANSACTION_ID), now: pinnedNow });

    expect(storedRowCount()).toBe(1);

    const second = recordMarketplaceCharge(db, {
      ...inputFor(SECOND_TRANSACTION_ID),
      now: pinnedNow,
    });

    // A call appends a new row and nothing else: the count grew by one and the row appended by the
    // earlier call reads back value for value as it was written.
    expect(storedRowCount()).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(readStoredRow(first.id)).toEqual(first);

    // Both rows are the marketplace ledger's, in insertion order, oldest first.
    expect(listLedgerEntries(db, 'marketplace')).toEqual([first, second]);
  });

  it('stamps the appended row with the clock the caller pinned', () => {
    const appended = recordMarketplaceCharge(db, { ...inputFor(TRANSACTION_ID), now: pinnedNow });

    expect(appended.created_at).toBe(FIXTURE_INSTANT);
    expect(readStoredRow(appended.id)?.created_at).toBe(FIXTURE_INSTANT);
  });

  it('stamps the appended row under the system clock when no clock is supplied', () => {
    const appended = recordMarketplaceCharge(db, inputFor(TRANSACTION_ID));

    // An ISO-8601 UTC instant with milliseconds and a trailing `Z`, never SQLite's timestamp form.
    expect(appended.created_at).toMatch(ISO_UTC_INSTANT);
  });

  it('is unaffected by the configured gate fee: the amount is the transaction\'s own', () => {
    const defaultFee = recordMarketplaceCharge(db, {
      ...inputFor(TRANSACTION_ID),
      now: pinnedNow,
    });
    const changedFee = recordMarketplaceCharge(db, {
      ...inputFor(SECOND_TRANSACTION_ID, TRANSACTION_AMOUNT_MINOR_UNITS, { config: CHANGED_CONFIG }),
      now: pinnedNow,
    });

    // Two configurations whose gate fees differ produce two charges of the transaction's amount:
    // neither the default fee nor the configured one is a marketplace amount.
    expect(defaultFee.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
    expect(changedFee.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
    expect(defaultFee.amount_minor_units).not.toBe(CONFIG.gateFeeMinorUnits);
    expect(changedFee.amount_minor_units).not.toBe(CHANGED_CONFIG.gateFeeMinorUnits);
  });

  it('writes to the marketplace ledger alone, leaving the allocation ledger empty', () => {
    const appended = recordMarketplaceCharge(db, inputFor(TRANSACTION_ID));

    // Recording the charge decides nothing about a founder-participation allocation: eligibility
    // belongs to `founder-allocation.ts`, so this call alone journals no allocation row, and the
    // gate-fee ledger is equally untouched by it.
    expect(storedRowCountInLedger('marketplace')).toBe(1);
    expect(storedRowCountInLedger('founder_allocation')).toBe(0);
    expect(storedRowCountInLedger('gate_fees')).toBe(0);
    expect(listLedgerEntries(db, 'founder_allocation')).toEqual([]);
    expect(appended.ledger).toBe('marketplace');
  });
});
