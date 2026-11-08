/**
 * Unit tests for the append-only ledger writer and its ordered read.
 *
 * Every case runs in process against a real SQLite database held in memory and built from the
 * ordered migrations in `packages/shared/migrations/`, applied in filename order exactly as the
 * server's runner applies them: the stored column shape, the three closed vocabularies, the
 * non-negative amount guard, the label guard and the table-level pair constraint are properties of
 * the delivered schema rather than of the function alone, so a schema drift has to fail a case here
 * instead of passing silently. The connection enables `foreign_keys`, and the fixture seeds every row
 * an appended entry references — the buyer and the developer with their category, listing and
 * version, the transaction, and the report with the standard and standard version it is traced to —
 * so both reference sides of an entry are rows of the delivered tables and the delivered references
 * hold. The append-only abort triggers of `0010_append_only_triggers.sql` arrive with those
 * migrations, as they do in the delivered schema: what this file asserts is the property the module
 * holds, that repeated writes only append rows and leave the rows already appended untouched. The
 * proof that no route rewrites an append-only row belongs to the API's integration suite in
 * `apps/api/test/integration/`, which owns the routes.
 *
 * No HTTP server, no database file and no per-package runner configuration: the file is discovered
 * by the root unit configuration's `packages/ * /src/**` glob.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerEntryInput } from './ledger-types';
import { insertLedgerEntries, insertLedgerEntry, listLedgerEntries } from './ledger-repository';

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL('../../../shared/migrations/', import.meta.url));

/** The columns every case reads a stored row through, in the table's own order. */
const SELECT_STORED_ENTRY_SQL = `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE id = ?`;

/**
 * The rows every fixture entry hangs from: the buyer whose transaction is journalled, the developer
 * who owns the listing, the category that listing sits in, the listing itself and its first version,
 * and the standard, standard version and report the gate-evaluation-fee entry names. Every one is
 * fixed and invented, and they are the same demonstration identities this workspace's sibling
 * fixtures store.
 */
const BUYER_ACCOUNT_ID = 'b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24';
const DEVELOPER_ACCOUNT_ID = '5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9';
const CATEGORY_ID = 'e41b8d76-9c02-4a35-8f61-7d0e5b94c218';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';
const STANDARD_ID = '4c7e2f19-8b53-4d06-a7e2-6f1b9c3d5e80';
const STANDARD_VERSION_ID = '8e2a5c31-7f94-4b60-9d38-1c5e7a2f6b04';

/**
 * The fiction this file stores. Both identifiers are fixed and invented, and each of the two names a
 * seeded row of the delivered tables: the transaction `TRANSACTION_ID` addresses and the report
 * `REPORT_ID` addresses are written by {@link seedReferencedRows}, so a reference an entry carries is
 * a real reference rather than an opaque string.
 */
const TRANSACTION_ID = '1f2b6d84-9a30-4c57-8e12-6b4d7c05a9f3';
const REPORT_ID = 'a7c4e01b-5d92-4b68-9f37-2e8c1a60d4b5';

/** The instant the injected clock returns, pinned so rows can deliberately share it. */
const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/** A second pinned instant, so a batch can be appended with an instant per entry. */
const LATER_FIXTURE_INSTANT = '2024-01-02T00:00:00.000Z';

/** The clock a case appends under, so an inserted instant is a known value rather than a reading. */
const pinnedNow = (): string => FIXTURE_INSTANT;

/** The shape the default clock's ISO-8601 UTC instant takes, asserted where no clock is supplied. */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shape `crypto.randomUUID()` produces; asserted so two rows cannot share an identifier. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The two labels every fixture entry carries: the table's own synthetic currency label and the
 * demonstration disclosure label a simulated amount is written with. Both are written out here
 * rather than read from the package's configuration, because what this suite asserts is that the
 * repository stores and returns the two values verbatim — the resolved configuration has its own test
 * beside it — and because a repository test that reached for the configuration would fail for a
 * reason that is not its own. The currency label is the one value the table's `CHECK` admits: a
 * fixture naming any other label is refused at the insert rather than passing here, which is what
 * keeps a real currency code out of the data at this level too.
 */
const CURRENCY_LABEL = 'DEMO' as const;

/** A disclosure label of this fixture's own; the suite asserts it round-trips, not how it reads. */
const DISCLOSURE_LABEL =
  'Simulated demonstration: no money moves and no real currency is involved.';

/** One appended entry of the marketplace ledger: a charge, which carries the transaction. */
const MARKETPLACE_CHARGE: LedgerEntryInput = {
  ledger: 'marketplace',
  entry_type: 'charge',
  direction: 'debit',
  amount_minor_units: 10000,
  transaction_id: TRANSACTION_ID,
  report_id: null,
  currency_label: CURRENCY_LABEL,
  disclosure_label: DISCLOSURE_LABEL,
  description: 'Simulated marketplace charge for a completed checkout',
};

/** One appended entry of the gate-evaluation-fee ledger: a charge, which carries the report. */
const GATE_FEE_CHARGE: LedgerEntryInput = {
  ledger: 'gate_fees',
  entry_type: 'charge',
  direction: 'debit',
  amount_minor_units: 15000,
  transaction_id: null,
  report_id: REPORT_ID,
  currency_label: CURRENCY_LABEL,
  disclosure_label: DISCLOSURE_LABEL,
  description: 'Simulated gate-evaluation fee for a completed evaluation report',
};

/** One appended entry of the founder-allocation ledger: an allocation, which carries the transaction. */
const FOUNDER_ALLOCATION: LedgerEntryInput = {
  ledger: 'founder_allocation',
  entry_type: 'allocation',
  direction: 'credit',
  amount_minor_units: 25,
  transaction_id: TRANSACTION_ID,
  report_id: null,
  currency_label: CURRENCY_LABEL,
  disclosure_label: DISCLOSURE_LABEL,
  description: 'Simulated founder allocation computed at 25 basis points',
};

/** The marketplace reversal of a refunded charge, the first half of the pair a refund appends. */
const MARKETPLACE_REVERSAL: LedgerEntryInput = {
  ledger: 'marketplace',
  entry_type: 'reversal',
  direction: 'credit',
  amount_minor_units: 4000,
  transaction_id: TRANSACTION_ID,
  report_id: null,
  currency_label: CURRENCY_LABEL,
  disclosure_label: DISCLOSURE_LABEL,
  description: 'Simulated refund reversal of the marketplace charge',
};

/** The founder-allocation reversal of the same refund, the second half of that pair. */
const FOUNDER_ALLOCATION_REVERSAL: LedgerEntryInput = {
  ledger: 'founder_allocation',
  entry_type: 'reversal',
  direction: 'debit',
  amount_minor_units: 10,
  transaction_id: TRANSACTION_ID,
  report_id: null,
  currency_label: CURRENCY_LABEL,
  disclosure_label: DISCLOSURE_LABEL,
  description: 'Simulated refund reversal of the founder allocation',
};

/** The pair a refund appends, in the order it is to be written and therefore by one call. */
const REVERSAL_PAIR: readonly [LedgerEntryInput, LedgerEntryInput] = [
  MARKETPLACE_REVERSAL,
  FOUNDER_ALLOCATION_REVERSAL,
];

/**
 * One entry of each of the three ledgers, so a case that drives the writer meets every ledger name,
 * every entry kind and both reference sides.
 */
const ENTRY_CASES: ReadonlyArray<{ readonly label: string; readonly input: LedgerEntryInput }> = [
  { label: 'marketplace charge', input: MARKETPLACE_CHARGE },
  { label: 'gate-evaluation fee charge', input: GATE_FEE_CHARGE },
  { label: 'founder-allocation', input: FOUNDER_ALLOCATION },
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

/**
 * Seeds every row the fixture's entries reference, in the order the delivered references require: the
 * two accounts, the category, the listing the developer owns and its first version, the transaction a
 * marketplace or founder-allocation entry carries, and the report a gate-evaluation-fee entry carries
 * together with the standard and the standard version that report is traced to.
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

  db.prepare(
    `INSERT INTO transactions
       (id, buyer_account_id, listing_id, listing_version_id, offer_model,
        amount_minor_units, currency_label, simulated, disclosure_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    TRANSACTION_ID,
    BUYER_ACCOUNT_ID,
    LISTING_ID,
    LISTING_VERSION_ID,
    'purchase',
    MARKETPLACE_CHARGE.amount_minor_units,
    CURRENCY_LABEL,
    1,
    DISCLOSURE_LABEL,
    FIXTURE_INSTANT,
  );

  db.prepare('INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)').run(
    STANDARD_ID,
    'SGI-SO-1.0.0',
    'Structured Output Conformance',
    'A seeded standard the fixture report is traced to.',
  );

  db.prepare(
    `INSERT INTO standard_versions
       (id, standard_id, version_label, status, total_cases, critical_cases,
        pass_threshold_matches, critical_failures_allowed, rubric_reference, definition_json, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    STANDARD_VERSION_ID,
    STANDARD_ID,
    'SGI-SO-1.0.0',
    'active',
    20,
    5,
    18,
    0,
    'SGI-SO-1.0.0#rubric',
    '{}',
    FIXTURE_INSTANT,
  );

  db.prepare(
    `INSERT INTO evaluation_reports
       (id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
        critical_failures, label, rubric_reference, prior_report_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    REPORT_ID,
    LISTING_VERSION_ID,
    STANDARD_VERSION_ID,
    'PASS',
    20,
    20,
    0,
    'SAMPLE',
    'SGI-SO-1.0.0#rubric',
    null,
    FIXTURE_INSTANT,
  );
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

/** Reads one stored row by its identifier, independently of the reader under test. */
function readStoredRow(id: string): StoredLedgerEntryRow | undefined {
  return db.prepare<[string], StoredLedgerEntryRow>(SELECT_STORED_ENTRY_SQL).get(id);
}

/** Counts the rows the table holds, so a case can assert that a write only appended rows. */
function storedRowCount(): number {
  const row = db
    .prepare<[], { readonly count: number }>('SELECT COUNT(*) AS count FROM ledger_entries')
    .get();

  return row?.count ?? 0;
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

describe('insertLedgerEntry', () => {
  it.each(ENTRY_CASES)('appends the $label entry and reads it back intact', ({ input }) => {
    const appended = insertLedgerEntry(db, { ...input, now: pinnedNow });

    // The nine stored values are carried through exactly as they arrived, and the two generated here
    // are a fresh identifier and the instant the pinned clock answers with.
    expect(appended).toEqual({ ...input, id: appended.id, created_at: FIXTURE_INSTANT });
    expect(appended.id).toMatch(UUID_V4);

    // The returned entry is the stored row: reading the table through a statement of this file's own
    // shows the same eleven values, so the writer's answer is not merely self-consistent.
    expect(readStoredRow(appended.id)).toEqual(appended);

    // And it is the only row of its ledger, read back in insertion order.
    expect(listLedgerEntries(db, input.ledger)).toEqual([appended]);
  });

  it('gives every appended row its own identifier, under the default clock when none is supplied', () => {
    const first = insertLedgerEntry(db, MARKETPLACE_CHARGE);
    const second = insertLedgerEntry(db, MARKETPLACE_CHARGE);

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(UUID_V4);
    expect(second.id).toMatch(UUID_V4);

    // The system clock answers with an ISO-8601 UTC instant, never SQLite's timestamp format.
    expect(first.created_at).toMatch(ISO_UTC_INSTANT);
    expect(second.created_at).toMatch(ISO_UTC_INSTANT);
  });

  it('only appends rows: writing the same values again leaves the rows already written untouched', () => {
    const first = insertLedgerEntry(db, { ...FOUNDER_ALLOCATION, now: pinnedNow });
    const countAfterFirst = storedRowCount();

    insertLedgerEntry(db, { ...FOUNDER_ALLOCATION, now: pinnedNow });
    insertLedgerEntry(db, { ...FOUNDER_ALLOCATION, now: pinnedNow });

    // Two writes appended exactly two rows, and the first row reads back value for value as it was
    // written: the history is a sequence of appended rows and never a rewritten one.
    expect(storedRowCount()).toBe(countAfterFirst + 2);

    const appended = listLedgerEntries(db, 'founder_allocation');
    expect(appended).toHaveLength(3);
    expect(appended[0]).toEqual(first);
    expect(readStoredRow(first.id)).toEqual(first);
  });
});

describe('insertLedgerEntries', () => {
  it('appends every entry in one call and returns them in input order', () => {
    const appended = insertLedgerEntries(db, REVERSAL_PAIR.map((entry) => ({ ...entry, now: pinnedNow })));

    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({
      ledger: 'marketplace',
      description: MARKETPLACE_REVERSAL.description,
      created_at: FIXTURE_INSTANT,
    });
    expect(appended[1]).toMatchObject({
      ledger: 'founder_allocation',
      description: FOUNDER_ALLOCATION_REVERSAL.description,
      created_at: FIXTURE_INSTANT,
    });

    // Each ledger read returns its own half of the pair, in the order the two were appended.
    expect(listLedgerEntries(db, 'marketplace')).toEqual([appended[0]]);
    expect(listLedgerEntries(db, 'founder_allocation')).toEqual([appended[1]]);
    expect(storedRowCount()).toBe(2);
  });

  it('appends each entry under the clock that entry carries', () => {
    const appended = insertLedgerEntries(db, [
      { ...MARKETPLACE_REVERSAL, now: pinnedNow },
      { ...FOUNDER_ALLOCATION_REVERSAL, now: () => LATER_FIXTURE_INSTANT },
    ]);

    expect(appended[0]?.created_at).toBe(FIXTURE_INSTANT);
    expect(appended[1]?.created_at).toBe(LATER_FIXTURE_INSTANT);

    for (const entry of appended) {
      expect(readStoredRow(entry.id)).toEqual(entry);
    }
  });

  it('appends nothing and returns an empty array for an empty input', () => {
    const appended = insertLedgerEntries(db, []);

    expect(appended).toEqual([]);
    expect(storedRowCount()).toBe(0);
    expect(listLedgerEntries(db, 'marketplace')).toEqual([]);
  });
});

describe('listLedgerEntries', () => {
  it('returns an empty array for a ledger no row was appended to', () => {
    expect(listLedgerEntries(db, 'marketplace')).toEqual([]);
    expect(listLedgerEntries(db, 'gate_fees')).toEqual([]);
    expect(listLedgerEntries(db, 'founder_allocation')).toEqual([]);
  });

  it('returns only the rows of the ledger it was asked for', () => {
    const appended = insertLedgerEntries(
      db,
      ENTRY_CASES.map(({ input }) => ({ ...input })),
    );

    expect(appended).toHaveLength(3);
    expect(storedRowCount()).toBe(3);

    // One row per ledger, so a read that returned a row of another ledger could not also return the
    // one row it should: the count and the discriminator together settle the separation.
    for (const { input } of ENTRY_CASES) {
      const rows = listLedgerEntries(db, input.ledger);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ledger: input.ledger,
        entry_type: input.entry_type,
        direction: input.direction,
        amount_minor_units: input.amount_minor_units,
        transaction_id: input.transaction_id,
        report_id: input.report_id,
        description: input.description,
      });
    }
  });

  it('returns the rows in append order even when a pinned clock gives them one instant', () => {
    for (const position of [0, 1, 2]) {
      insertLedgerEntry(db, {
        ...MARKETPLACE_CHARGE,
        description: `Appended in position ${String(position)}`,
        now: pinnedNow,
      });
    }

    const rows = listLedgerEntries(db, 'marketplace');

    // Three rows share one instant, so only the insertion sequence can order them: the read returns
    // the sequence they were appended in, and it keeps returning it as more rows arrive.
    expect(rows.map((row) => row.description)).toEqual([
      'Appended in position 0',
      'Appended in position 1',
      'Appended in position 2',
    ]);
    expect(rows.map((row) => row.created_at)).toEqual([
      FIXTURE_INSTANT,
      FIXTURE_INSTANT,
      FIXTURE_INSTANT,
    ]);

    insertLedgerEntry(db, {
      ...MARKETPLACE_CHARGE,
      description: 'Appended in position 3',
      now: pinnedNow,
    });

    expect(listLedgerEntries(db, 'marketplace').map((row) => row.description)).toEqual([
      'Appended in position 0',
      'Appended in position 1',
      'Appended in position 2',
      'Appended in position 3',
    ]);
  });
});
