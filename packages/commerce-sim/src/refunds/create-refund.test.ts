/**
 * Unit tests for the refund path: the eligibility rule that decides whether a refund may be appended,
 * and the atomic write that appends it with the pair of reversal entries it rules.
 *
 * Every case runs in process against a real SQLite database held in memory and built from the ordered
 * migrations in `packages/shared/migrations/`, applied in filename order exactly as the server's runner
 * applies them, because this module's contract is a set of statements executed against the real
 * schema: the column shapes of `transactions`, `refunds` and `ledger_entries`, their `CHECK`
 * constraints, the foreign keys and the append-only behaviour are properties of the delivered tables
 * rather than of the functions alone. The connection enables `foreign_keys` and the fixture seeds the
 * accounts, category, listing and version a transaction references, so an append here succeeds against
 * the real relationships rather than because a constraint was switched off. The abort triggers of
 * `0010_append_only_triggers.sql` arrive with those migrations, as they do in the delivered schema:
 * what this file asserts is that repeated refunds only append rows and leave the rows already written
 * exactly as they were, which is the property the module holds, and its atomicity case stands a
 * temporary refusal of its own in front of the delivered table rather than a second schema beside it.
 * The proof that no route rewrites an append-only row belongs to the API's integration suite in
 * `apps/api/test/integration/`, which owns the routes.
 *
 * No HTTP server, no database file and no per-package runner configuration: the file is discovered by
 * the root unit configuration's `packages/ * /src/**` glob.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNTHETIC_CURRENCY_LABEL } from '@adem/shared';
import type { Refund } from '@adem/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMERCE_DISCLOSURE_LABEL, resolveCommerceConfig } from '../config';
import type { CommerceConfig } from '../config';
import { allocate } from '../ledgers/allocate';
import type { CreateRefundInput, RefundRefusal, RefundResult } from './create-refund';
import { computeNetRemaining, createRefund } from './create-refund';

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL('../../../shared/migrations/', import.meta.url));

/**
 * The fiction this file stores, shaped as the identifiers every row of the product carries. All of
 * them are fixed and invented: nothing here derives an identifier, and a fixed one is what lets a
 * case compare what it read with what it wrote.
 */
const OPERATOR_ACCOUNT_ID = '9f0e4a13-7b58-4c26-a93d-5e1f7c2b8d06';
const BUYER_ACCOUNT_ID = 'b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24';
const DEVELOPER_ACCOUNT_ID = '5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9';
const CATEGORY_ID = 'e41b8d76-9c02-4a35-8f61-7d0e5b94c218';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';
const TRANSACTION_ID = '3b1f6c24-9d7a-4e15-8c02-6a4d9f0e5b73';
const OTHER_TRANSACTION_ID = '1f4b7a09-2c58-4d63-9e07-3a8f6b1d4c52';
const MARKETPLACE_CHARGE_ID = 'a2d5c8f1-4b96-4e70-8c31-5f7d9a2b6e04';
const FOUNDER_ALLOCATION_ID = 'c8e1f4a7-6d20-4b53-9f86-1a3c5e7b9d02';
const OTHER_CHARGE_ID = 'e6b9c2d5-8f31-4a64-9c70-2d4f6a8b0e13';
const UNKNOWN_TRANSACTION_ID = '0c4f7a2e-6b19-4d38-a05e-8f1c3d5b7a96';

/** The amount a fixture transaction charges, and the two refunds that split it. */
const TRANSACTION_AMOUNT_MINOR_UNITS = 10000;
const PARTIAL_REFUND_MINOR_UNITS = 4000;

/**
 * One and a half, written as a division: the non-whole amount the invalid-amount cases pass without
 * this file carrying a fractional literal. It is exactly representable, so the value those cases
 * build is precisely the non-whole count the rule must refuse.
 */
const ONE_AND_A_HALF = 3 / 2;

/** One count beyond the range the number type represents exactly, so the amount cannot be a count. */
const BEYOND_SAFE_INTEGER = Number.MAX_SAFE_INTEGER + 1;

/** The instant the injected clock returns, as an ISO-8601 UTC string with milliseconds. */
const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/** The shape the default clock's ISO-8601 UTC instant takes, asserted where no clock is supplied. */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shape `crypto.randomUUID()` produces, asserted so two rows cannot share an identifier. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The resolved configuration, which is the only source of the two labels an entry carries. */
const DEFAULT_CONFIG = resolveCommerceConfig();

/** The clock a case appends under, so an inserted instant is a known value rather than a reading. */
const pinnedNow = (): string => FIXTURE_INSTANT;

/**
 * The stored shape of a `refunds` row, read through this file's own statement rather than through the
 * module under test: an assertion made through the reader would only prove the reader agrees with
 * itself.
 */
interface StoredRefundRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly amount_minor_units: number;
  readonly operator_account_id: string;
  readonly created_at: string;
}

/** The stored shape of a `ledger_entries` row, as the table holds it. */
interface StoredLedgerRow {
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

let db: Database.Database;

/** Applies every migration in filename order, which is the order the server's runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
}

/** Seeds the rows a transaction references, so its foreign keys hold. */
function seedParents(): void {
  const insertAccount = db.prepare('INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)');

  insertAccount.run(OPERATOR_ACCOUNT_ID, 'demo-operator-handle', 'operator', 'Demo operator account');
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
}

/**
 * Appends one `transactions` row with the given identifier and amount, bypassing the checkout writer.
 * It is an append of a new row — the only kind of write this table accepts — and it exists so a case
 * can address a stored transaction without a checkout having to run first.
 */
function appendTransactionRow(id: string, amountMinorUnits: number): void {
  db.prepare(
    `INSERT INTO transactions
       (id, buyer_account_id, listing_id, listing_version_id, offer_model,
        amount_minor_units, currency_label, simulated, disclosure_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    BUYER_ACCOUNT_ID,
    LISTING_ID,
    LISTING_VERSION_ID,
    'purchase',
    amountMinorUnits,
    SYNTHETIC_CURRENCY_LABEL,
    1,
    COMMERCE_DISCLOSURE_LABEL,
    FIXTURE_INSTANT,
  );
}

/**
 * Appends one `ledger_entries` row, bypassing the ledger writer: the pre-existing history a refund
 * corrects, so a case can prove that history is left exactly as it was.
 */
function appendLedgerRow(row: {
  readonly id: string;
  readonly ledger: string;
  readonly entry_type: string;
  readonly direction: string;
  readonly amount_minor_units: number;
  readonly transaction_id: string;
  readonly description: string;
}): void {
  db.prepare(
    `INSERT INTO ledger_entries
       (id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
        currency_label, disclosure_label, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.ledger,
    row.entry_type,
    row.direction,
    row.amount_minor_units,
    row.transaction_id,
    null,
    SYNTHETIC_CURRENCY_LABEL,
    COMMERCE_DISCLOSURE_LABEL,
    row.description,
    FIXTURE_INSTANT,
  );
}

/** The count of rows one table holds. */
function countRows(
  database: Database.Database,
  table: 'transactions' | 'refunds' | 'ledger_entries',
): number {
  const row = database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };

  return row.total;
}

/** Every stored `refunds` row, in insertion order. */
function storedRefundRows(): StoredRefundRow[] {
  return db
    .prepare(
      `SELECT id, transaction_id, amount_minor_units, operator_account_id, created_at
       FROM refunds
       ORDER BY rowid ASC`,
    )
    .all() as StoredRefundRow[];
}

/** Every stored `ledger_entries` row, in insertion order. */
function storedLedgerRows(): StoredLedgerRow[] {
  return db
    .prepare(
      `SELECT id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
              currency_label, disclosure_label, description, created_at
       FROM ledger_entries
       ORDER BY rowid ASC`,
    )
    .all() as StoredLedgerRow[];
}

/** The column names of one table, in the order the table declares them. */
function columnNames(table: 'transactions' | 'refunds'): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ReadonlyArray<{ name: string }>;

  return rows.map((row) => row.name);
}

/** Everything refunded to one transaction, summed from the stored refund rows. */
function totalRefundedMinorUnits(transactionId: string): number {
  const rows = storedRefundRows().filter((row) => row.transaction_id === transactionId);

  return rows.reduce((total, row) => total + row.amount_minor_units, 0);
}

/**
 * The net founder allocation of one transaction: the allocation its charge produced at the default
 * rate, less the founder-allocation reversals its refunds appended. The anchors in the cases below
 * state the expected figures, so this helper computes what the rows say rather than what a case
 * believes it wrote.
 */
function netFounderAllocationMinorUnits(transactionId: string): number {
  const entries = storedLedgerRows().filter(
    (row) => row.ledger === 'founder_allocation' && row.transaction_id === transactionId,
  );

  return entries.reduce(
    (total, row) => (row.direction === 'credit' ? total + row.amount_minor_units : total - row.amount_minor_units),
    0,
  );
}

/**
 * The overrides a case may apply to the fixture refund input: the transaction it addresses and the
 * resolved configuration it computes from. Everything else the input carries stays the fixture's own,
 * and the clock is pinned so an appended refund states a known instant rather than a reading.
 */
interface RefundInputOverrides {
  /** Identifier of the transaction to refund; defaults to the fixture transaction. */
  readonly transactionId?: string;
  /** The resolved configuration to compute from; defaults to the product's default configuration. */
  readonly config?: CommerceConfig;
}

/** One refund input addressed at the fixture transaction, with the resolved default configuration. */
function refundInput(amountMinorUnits: number, overrides: RefundInputOverrides = {}): CreateRefundInput {
  return {
    transactionId: overrides.transactionId ?? TRANSACTION_ID,
    amountMinorUnits,
    operatorAccountId: OPERATOR_ACCOUNT_ID,
    config: overrides.config ?? DEFAULT_CONFIG,
    now: pinnedNow,
  };
}

/**
 * The same fixture input with no clock member at all, so a case can observe the clock this module
 * falls back to. The member is absent rather than present and `undefined`: `exactOptionalPropertyTypes`
 * makes those two different, and it is the absent form the module documents as the default.
 */
function refundInputWithoutClock(amountMinorUnits: number): CreateRefundInput {
  return {
    transactionId: TRANSACTION_ID,
    amountMinorUnits,
    operatorAccountId: OPERATOR_ACCOUNT_ID,
    config: DEFAULT_CONFIG,
  };
}

/** Reads a result that must have appended a refund, naming the refusal when it did not. */
function requireSuccess(result: RefundResult | RefundRefusal): RefundResult {
  if (!result.ok) {
    throw new Error(`expected the refund to be appended, received the refusal ${result.reason}`);
  }

  return result;
}

/** Reads a result that must be a refusal, naming what was appended when it was not. */
function requireRefusal(result: RefundResult | RefundRefusal): RefundRefusal {
  if (result.ok) {
    throw new Error('expected a refusal, received an appended refund');
  }

  return result;
}

/** The four ledger rows a fixture transaction starts with: its charge and the allocation it produced. */
function seedChargedTransaction(): void {
  appendTransactionRow(TRANSACTION_ID, TRANSACTION_AMOUNT_MINOR_UNITS);
  appendLedgerRow({
    id: MARKETPLACE_CHARGE_ID,
    ledger: 'marketplace',
    entry_type: 'charge',
    direction: 'debit',
    amount_minor_units: TRANSACTION_AMOUNT_MINOR_UNITS,
    transaction_id: TRANSACTION_ID,
    description: 'Simulated marketplace charge for a completed checkout',
  });
  appendLedgerRow({
    id: FOUNDER_ALLOCATION_ID,
    ledger: 'founder_allocation',
    entry_type: 'allocation',
    direction: 'credit',
    amount_minor_units: allocate(TRANSACTION_AMOUNT_MINOR_UNITS, 25),
    transaction_id: TRANSACTION_ID,
    description: 'Simulated founder allocation computed at 25 basis points',
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  seedParents();
  seedChargedTransaction();
});

afterEach(() => {
  db.close();
});

describe('computeNetRemaining', () => {
  it('returns the whole amount for a transaction whose refund rows do not exist yet', () => {
    // The anchor: with no refund rows at all, what remains is the whole charge, and a rule that
    // answered `0` here would refuse the first refund of every transaction.
    expect(storedRefundRows()).toHaveLength(0);

    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
  });

  it('returns the amount less everything refunded, recomputed on every call', () => {
    requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    expect(totalRefundedMinorUnits(TRANSACTION_ID)).toBe(PARTIAL_REFUND_MINOR_UNITS);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(
      TRANSACTION_AMOUNT_MINOR_UNITS - PARTIAL_REFUND_MINOR_UNITS,
    );
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(6000);

    requireSuccess(
      createRefund(db, refundInput(TRANSACTION_AMOUNT_MINOR_UNITS - PARTIAL_REFUND_MINOR_UNITS)),
    );

    expect(totalRefundedMinorUnits(TRANSACTION_ID)).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(0);
  });

  it('returns 0 for an identifier no transaction carries', () => {
    expect(storedRefundRows()).toHaveLength(0);
    expect(computeNetRemaining(db, UNKNOWN_TRANSACTION_ID)).toBe(0);
  });

  it("is unaffected by another transaction's refunds", () => {
    appendTransactionRow(OTHER_TRANSACTION_ID, TRANSACTION_AMOUNT_MINOR_UNITS);

    requireSuccess(
      createRefund(
        db,
        refundInput(TRANSACTION_AMOUNT_MINOR_UNITS, { transactionId: OTHER_TRANSACTION_ID }),
      ),
    );

    expect(computeNetRemaining(db, OTHER_TRANSACTION_ID)).toBe(0);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
  });

  it('reads a position derived from the refund rows, because no table stores a balance', () => {
    // The columns the migrations declare, stated here so that a balance column proposed later fails
    // this case rather than becoming a second source of truth beside the refund rows.
    expect(columnNames('transactions')).toEqual([
      'id',
      'buyer_account_id',
      'listing_id',
      'listing_version_id',
      'offer_model',
      'amount_minor_units',
      'currency_label',
      'simulated',
      'disclosure_label',
      'created_at',
    ]);
    expect(columnNames('refunds')).toEqual([
      'id',
      'transaction_id',
      'amount_minor_units',
      'operator_account_id',
      'created_at',
    ]);

    requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(
      TRANSACTION_AMOUNT_MINOR_UNITS - totalRefundedMinorUnits(TRANSACTION_ID),
    );
  });
});

describe('createRefund — the refund it appends', () => {
  it('appends the refund row it returns, with a generated identifier and the pinned instant', () => {
    const result = requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    expect(result.ok).toBe(true);
    expect(result.refund.id).toMatch(UUID_V4);
    expect(result.refund).toEqual({
      id: result.refund.id,
      transaction_id: TRANSACTION_ID,
      amount_minor_units: PARTIAL_REFUND_MINOR_UNITS,
      operator_account_id: OPERATOR_ACCOUNT_ID,
      created_at: FIXTURE_INSTANT,
    });
    expect(storedRefundRows()).toEqual([result.refund]);
  });

  it('takes the system clock when no clock is supplied', () => {
    const result = requireSuccess(createRefund(db, refundInputWithoutClock(PARTIAL_REFUND_MINOR_UNITS)));

    expect(result.refund.created_at).toMatch(ISO_UTC_INSTANT);
    expect(new Date(result.refund.created_at).toISOString()).toBe(result.refund.created_at);
  });

  it('appends exactly the pair of reversals it returns, the marketplace one first', () => {
    const appendedBefore = new Set(storedLedgerRows().map((row) => row.id));

    const result = requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    const appended = storedLedgerRows().filter((row) => !appendedBefore.has(row.id));

    expect(result.reversalEntries).toHaveLength(2);
    expect(result.reversalEntries.map((entry) => entry.ledger)).toEqual([
      'marketplace',
      'founder_allocation',
    ]);
    expect(appended).toHaveLength(2);
    expect(result.reversalEntries).toEqual(appended);
    expect(countRows(db, 'ledger_entries')).toBe(appendedBefore.size + 2);
  });

  it('stamps the refund and both of its reversals with one instant', () => {
    const result = requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    expect(result.reversalEntries.map((entry) => entry.created_at)).toEqual([
      FIXTURE_INSTANT,
      FIXTURE_INSTANT,
    ]);
    expect(storedRefundRows().map((row) => row.created_at)).toEqual([FIXTURE_INSTANT]);
  });

  it('appends no allocation entry and no gate-fee row of its own', () => {
    const result = requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    // A refund corrects two ledgers and starts nothing: the allocation a refund reverses was the
    // checkout's, and a gate-evaluation fee is never eligible for an allocation.
    expect(result.reversalEntries.every((entry) => entry.entry_type === 'reversal')).toBe(true);
    expect(storedLedgerRows().filter((row) => row.ledger === 'gate_fees')).toHaveLength(0);
    expect(storedLedgerRows().filter((row) => row.entry_type === 'allocation')).toHaveLength(1);
  });

  it('carries the labels of the resolved configuration on both reversals', () => {
    const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });
    const result = requireSuccess(
      createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS, { config })),
    );

    for (const entry of result.reversalEntries) {
      expect(entry.currency_label).toBe(config.currencyLabel);
      expect(entry.disclosure_label).toBe(config.disclosureLabel);
      expect(entry.report_id).toBeNull();
      expect(entry.transaction_id).toBe(TRANSACTION_ID);
    }
  });
});

describe('createRefund — the arithmetic of criterion 6', () => {
  it('reverses a partial refund of 4000 minor units to a founder reversal of 10', () => {
    // The anchors are what make these cases able to fail: without them, comparing the appended rows
    // with the allocation function would hold for any rate the path might have applied.
    expect(allocate(PARTIAL_REFUND_MINOR_UNITS, 25)).toBe(10);

    const result = requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    expect(result.reversalEntries[0]?.amount_minor_units).toBe(PARTIAL_REFUND_MINOR_UNITS);
    expect(result.reversalEntries[1]?.amount_minor_units).toBe(10);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(6000);
  });

  it('brings the net founder allocation to 0 once the transaction is refunded in full', () => {
    expect(allocate(TRANSACTION_AMOUNT_MINOR_UNITS, 25)).toBe(25);
    expect(netFounderAllocationMinorUnits(TRANSACTION_ID)).toBe(25);

    const result = requireSuccess(createRefund(db, refundInput(TRANSACTION_AMOUNT_MINOR_UNITS)));

    expect(result.reversalEntries[1]?.amount_minor_units).toBe(25);
    expect(netFounderAllocationMinorUnits(TRANSACTION_ID)).toBe(0);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(0);
  });

  it('brings the net founder allocation to 0 across two refunds that split the amount', () => {
    expect(allocate(6000, 25)).toBe(15);

    requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));
    expect(netFounderAllocationMinorUnits(TRANSACTION_ID)).toBe(15);

    requireSuccess(createRefund(db, refundInput(6000)));

    expect(netFounderAllocationMinorUnits(TRANSACTION_ID)).toBe(0);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(0);
  });

  it('changes the founder reversal when the resolved rate changes', () => {
    const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });

    expect(allocate(TRANSACTION_AMOUNT_MINOR_UNITS, 100)).toBe(100);

    const result = requireSuccess(
      createRefund(db, refundInput(TRANSACTION_AMOUNT_MINOR_UNITS, { config })),
    );

    expect(result.reversalEntries[1]?.amount_minor_units).toBe(100);
    expect(result.reversalEntries[0]?.amount_minor_units).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
  });
});

describe('createRefund — the refusals', () => {
  const INVALID_AMOUNTS: ReadonlyArray<{ readonly label: string; readonly amount: number }> = [
    { label: 'a zero amount', amount: 0 },
    { label: 'a negative amount', amount: -1 },
    { label: 'a fractional amount', amount: ONE_AND_A_HALF },
    { label: 'a value that is not a number', amount: Number.NaN },
    { label: 'an infinite amount', amount: Number.POSITIVE_INFINITY },
    { label: 'a count beyond the exactly representable range', amount: BEYOND_SAFE_INTEGER },
  ];

  it.each(INVALID_AMOUNTS)('refuses $label without appending anything', ({ amount }) => {
    const result = createRefund(db, refundInput(amount));

    expect(requireRefusal(result).reason).toBe('invalid_amount');
    expect(countRows(db, 'refunds')).toBe(0);
    expect(countRows(db, 'ledger_entries')).toBe(2);
  });

  it('refuses a transaction no row carries without appending anything', () => {
    const result = createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS, {
      transactionId: UNKNOWN_TRANSACTION_ID,
    }));

    expect(requireRefusal(result).reason).toBe('transaction_not_found');
    expect(countRows(db, 'refunds')).toBe(0);
    expect(countRows(db, 'ledger_entries')).toBe(2);
  });

  it('refuses a refund of a transaction whose refunds already account for its whole amount', () => {
    requireSuccess(createRefund(db, refundInput(TRANSACTION_AMOUNT_MINOR_UNITS)));

    const result = createRefund(db, refundInput(1));

    expect(requireRefusal(result).reason).toBe('already_fully_refunded');
    expect(countRows(db, 'refunds')).toBe(1);
    expect(countRows(db, 'ledger_entries')).toBe(4);
  });

  it('answers an over-large amount on a fully refunded transaction as already fully refunded', () => {
    // Both refusals apply once nothing remains, and the order the rule states is what decides which
    // one the caller's client is told: a transaction with nothing left is fully refunded, whatever
    // amount was asked for.
    requireSuccess(createRefund(db, refundInput(TRANSACTION_AMOUNT_MINOR_UNITS)));

    const result = createRefund(db, refundInput(TRANSACTION_AMOUNT_MINOR_UNITS * 2));

    expect(requireRefusal(result).reason).toBe('already_fully_refunded');
    expect(countRows(db, 'refunds')).toBe(1);
    expect(countRows(db, 'ledger_entries')).toBe(4);
  });

  it('refuses an amount greater than the net remaining without appending anything', () => {
    requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    const result = createRefund(db, refundInput(7000));

    expect(requireRefusal(result).reason).toBe('exceeds_net_remaining');
    expect(countRows(db, 'refunds')).toBe(1);
    expect(countRows(db, 'ledger_entries')).toBe(4);
  });

  it('accepts the whole net remaining and refuses one minor unit more', () => {
    requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    expect(requireRefusal(createRefund(db, refundInput(6001))).reason).toBe('exceeds_net_remaining');
    expect(requireSuccess(createRefund(db, refundInput(6000))).refund.amount_minor_units).toBe(6000);
  });
});

describe('createRefund — the append it holds to', () => {
  it('leaves every stored row exactly as it was and appends only its own three', () => {
    const transactionsBefore = db.prepare('SELECT * FROM transactions ORDER BY rowid').all();
    const refundsBefore = storedRefundRows();
    const ledgerBefore = storedLedgerRows();

    requireSuccess(createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS)));

    const transactionsAfter = db.prepare('SELECT * FROM transactions ORDER BY rowid').all();

    expect(transactionsAfter).toEqual(transactionsBefore);
    expect(storedRefundRows().slice(0, refundsBefore.length)).toEqual(refundsBefore);
    expect(storedLedgerRows().slice(0, ledgerBefore.length)).toEqual(ledgerBefore);
    expect(countRows(db, 'transactions')).toBe(transactionsBefore.length);
    expect(countRows(db, 'refunds')).toBe(refundsBefore.length + 1);
    expect(countRows(db, 'ledger_entries')).toBe(ledgerBefore.length + 2);
  });

  it('appends nothing at all when a reversal cannot be written', () => {
    // A temporary refusal on the delivered table stands in for an append the schema refuses, so that
    // the refund row and its pair are shown to be one act. `createRefund` appends the refund row, then
    // the marketplace reversal and then the founder-allocation reversal, so the refusal lands on the
    // last of the three writes and takes the two before it with it. The trigger is created for this
    // one case and nothing else in the suite meets it.
    const refundsBefore = countRows(db, 'refunds');
    const ledgerEntriesBefore = countRows(db, 'ledger_entries');

    // The anchor: the fixture has already appended the transaction's charge and its allocation, so the
    // two counts this case holds constant are the fixture's own and not an empty database's.
    expect(refundsBefore).toBe(0);
    expect(ledgerEntriesBefore).toBe(2);

    db.exec(
      `CREATE TRIGGER refuse_founder_allocation_append
         BEFORE INSERT ON ledger_entries
         WHEN NEW.ledger = 'founder_allocation'
       BEGIN
         SELECT RAISE(ABORT, 'the founder-allocation ledger refuses this append');
       END`,
    );

    expect(() => createRefund(db, refundInput(PARTIAL_REFUND_MINOR_UNITS))).toThrow();
    expect(countRows(db, 'refunds')).toBe(refundsBefore);
    expect(countRows(db, 'ledger_entries')).toBe(ledgerEntriesBefore);
    expect(computeNetRemaining(db, TRANSACTION_ID)).toBe(TRANSACTION_AMOUNT_MINOR_UNITS);
  });
});

