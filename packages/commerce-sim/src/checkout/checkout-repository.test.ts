/**
 * Unit tests for the append-only transaction writer and its read.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because this module's contract is a statement executed against a
 * real schema: the stored column shape, the integer binding of `simulated`, the `CHECK` constraints
 * on the amount and the label, and the append-only behaviour are properties of the table rather than
 * of the function alone. The connection enables `foreign_keys`, and the fixture seeds the account,
 * category, listing and version a transaction references, so an insert here succeeds against the
 * real relationships rather than because a constraint was switched off.
 *
 * The append-only triggers of `0010_append_only_triggers.sql` are deliberately not stood in for:
 * what this file asserts is that repeated writes only add rows and leave the rows already written
 * untouched. The proof that no route mutates an append-only row belongs to the API's integration
 * suite, which owns the routes and the triggers together.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNTHETIC_CURRENCY_LABEL } from '@adem/shared';
import type { OfferModel } from '@adem/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMERCE_DISCLOSURE_LABEL, resolveCommerceConfig } from '../config';
import { getTransaction, insertTransaction } from './checkout-repository';
import type { TransactionInput } from './checkout-repository';

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL('../../../shared/migrations/', import.meta.url));

/**
 * The fiction this file stores, shaped as the identifiers every row of the product carries. All four
 * are fixed and invented: nothing here derives an identifier, and a fixed one is what lets a case
 * compare what it read with what it wrote.
 */
const BUYER_ACCOUNT_ID = 'b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24';
const DEVELOPER_ACCOUNT_ID = '5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9';
const CATEGORY_ID = 'e41b8d76-9c02-4a35-8f61-7d0e5b94c218';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';

/** The instant the injected clock returns, as an ISO-8601 UTC string with milliseconds. */
const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/** The resolved configuration, which is the only source of the two labels an insert carries. */
const CONFIG = resolveCommerceConfig();

/**
 * The stored shape of one row, read with its own statement rather than through the module under
 * test: a stored-shape assertion made through the reader would only prove the reader agrees with
 * itself. `simulated` is typed as the stored integer because that is what the column holds.
 */
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

/**
 * One offer model with an amount it might be made at, chosen so that a column swapped with its
 * neighbour would be visible: the models and the amounts are all distinct, and the amounts run from
 * a permitted nothing to the largest exactly representable integer.
 */
const OFFER_CASES: ReadonlyArray<{ readonly model: OfferModel; readonly amount: number }> = [
  { model: 'rent', amount: 0 },
  { model: 'purchase', amount: 1 },
  { model: 'license', amount: 10000 },
  { model: 'subscription', amount: 9007199254740991 },
];

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

/** One transaction input, with the two labels taken from the resolved configuration. */
function transactionInput(offerModel: OfferModel, amountMinorUnits: number): TransactionInput {
  return {
    buyer_account_id: BUYER_ACCOUNT_ID,
    listing_id: LISTING_ID,
    listing_version_id: LISTING_VERSION_ID,
    offer_model: offerModel,
    amount_minor_units: amountMinorUnits,
    currency_label: CONFIG.currencyLabel,
    simulated: true,
    disclosure_label: CONFIG.disclosureLabel,
  };
}

/** Every stored row, as the table holds it. */
function storedRows(): StoredTransactionRow[] {
  return db
    .prepare(
      `SELECT id, buyer_account_id, listing_id, listing_version_id, offer_model,
              amount_minor_units, currency_label, simulated, disclosure_label, created_at
       FROM transactions
       ORDER BY created_at, id`,
    )
    .all() as StoredTransactionRow[];
}

/** The one stored row with the given identifier, or `undefined` when the table holds none. */
function storedRow(id: string): StoredTransactionRow | undefined {
  return storedRows().find((row) => row.id === id);
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

describe('insertTransaction', () => {
  it('returns the row it wrote, with a generated identifier and the injected instant', () => {
    const input = transactionInput('purchase', 10000);

    const written = insertTransaction(db, input, { now: () => FIXTURE_INSTANT });

    expect(written.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(written.created_at).toBe(FIXTURE_INSTANT);
    expect(written).toEqual({ ...input, id: written.id, created_at: FIXTURE_INSTANT });
  });

  it('takes the system clock when no clock is supplied', () => {
    const written = insertTransaction(db, transactionInput('rent', 0));

    expect(new Date(written.created_at).toISOString()).toBe(written.created_at);
  });

  it.each(OFFER_CASES)(
    'stores each value in its own column: $model at $amount minor units',
    ({ model, amount }) => {
      const written = insertTransaction(db, transactionInput(model, amount), {
        now: () => FIXTURE_INSTANT,
      });

      expect(storedRow(written.id)).toEqual({
        id: written.id,
        buyer_account_id: BUYER_ACCOUNT_ID,
        listing_id: LISTING_ID,
        listing_version_id: LISTING_VERSION_ID,
        offer_model: model,
        amount_minor_units: amount,
        currency_label: SYNTHETIC_CURRENCY_LABEL,
        simulated: 1,
        disclosure_label: COMMERCE_DISCLOSURE_LABEL,
        created_at: FIXTURE_INSTANT,
      });
    },
  );

  it('appends a row rather than correcting one, leaving the earlier row untouched', () => {
    const first = insertTransaction(db, transactionInput('purchase', 10000), {
      now: () => FIXTURE_INSTANT,
    });
    const second = insertTransaction(db, transactionInput('rent', 2500), {
      now: () => FIXTURE_INSTANT,
    });

    expect(second.id).not.toBe(first.id);
    expect(storedRows()).toHaveLength(2);
    expect(storedRow(first.id)).toEqual({
      id: first.id,
      buyer_account_id: BUYER_ACCOUNT_ID,
      listing_id: LISTING_ID,
      listing_version_id: LISTING_VERSION_ID,
      offer_model: 'purchase',
      amount_minor_units: 10000,
      currency_label: SYNTHETIC_CURRENCY_LABEL,
      simulated: 1,
      disclosure_label: COMMERCE_DISCLOSURE_LABEL,
      created_at: FIXTURE_INSTANT,
    });
  });
});

describe('getTransaction', () => {
  it('restores the boolean the row type declares from the integer the column stores', () => {
    const written = insertTransaction(db, transactionInput('purchase', 10000), {
      now: () => FIXTURE_INSTANT,
    });

    const read = getTransaction(db, written.id);

    expect(read).toEqual(written);
    expect(read?.simulated).toBe(true);
    expect(typeof read?.simulated).toBe('boolean');
    expect(storedRow(written.id)?.simulated).toBe(1);
  });

  it.each(OFFER_CASES)('reads back $model at $amount minor units untouched', ({ model, amount }) => {
    const written = insertTransaction(db, transactionInput(model, amount), {
      now: () => FIXTURE_INSTANT,
    });

    const read = getTransaction(db, written.id);

    expect(read?.offer_model).toBe(model);
    expect(read?.amount_minor_units).toBe(amount);
    expect(read?.amount_minor_units).toBeTypeOf('number');
  });

  it('returns null for an identifier no row carries', () => {
    expect(getTransaction(db, 'd84a1e60-5c3b-4f92-b716-0e2f8a4c93d1')).toBeNull();
  });
});
