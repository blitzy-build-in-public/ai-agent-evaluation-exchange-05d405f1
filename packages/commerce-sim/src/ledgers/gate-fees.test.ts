/**
 * Unit tests for the flat gate-evaluation fee and its one append to the gate-evaluation-fee ledger.
 *
 * Every case runs in process against a real SQLite database held in memory and built from the ordered
 * migrations in `packages/shared/migrations/`, applied in filename order exactly as the server's
 * runner applies them: the stored column shape, the three closed vocabularies, the non-negative amount
 * guard, the synthetic-currency guard and the table-level pair constraint are properties of the
 * delivered schema rather than of the function alone, so a schema drift has to fail a case here
 * instead of passing silently. The connection enables `foreign_keys`, and the fixture seeds every row
 * a charge references: the developer account, the category, the listing and the version the report
 * chain hangs from, with the standard and its one version, and the two `evaluation_reports` rows this
 * file's own two report identifiers address. The module under test still reads no report and needs
 * none — it stores the report's identifier as a plain column value — while that identifier is a real
 * reference the delivered foreign keys hold. The append-only abort triggers of
 * `0010_append_only_triggers.sql` arrive with those migrations, as they do in the delivered schema:
 * what this file asserts is the property the module holds, that a repeated call only appends rows and
 * leaves the rows already appended as they were. The proof that no route rewrites an append-only row
 * belongs to the API's integration suite in `apps/api/test/integration/`, which owns the routes.
 *
 * No HTTP server, no database file and no per-package runner configuration: the file is discovered by
 * the root unit configuration's `packages/ * /src/**` glob.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNTHETIC_CURRENCY_LABEL } from '@adem/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMMERCE_DISCLOSURE_LABEL, resolveCommerceConfig } from '../config';
import { recordGateFeeCharge } from './gate-fees';
import { listLedgerEntries } from './ledger-repository';

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL('../../../shared/migrations/', import.meta.url));

/**
 * The rows every fixture charge hangs from: the developer who owns the listing, the category that
 * listing sits in, the listing itself and its first version, and the standard, standard version and
 * two reports the gate-evaluation-fee entries name. Every one is fixed and invented, and they are the
 * same demonstration identities this workspace's sibling fixtures store. No buyer account is among
 * them: a fee entry carries the report side alone, so nothing here references one.
 */
const DEVELOPER_ACCOUNT_ID = '5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9';
const CATEGORY_ID = 'e41b8d76-9c02-4a35-8f61-7d0e5b94c218';
const LISTING_ID = 'c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38';
const LISTING_VERSION_ID = '7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e';
const STANDARD_ID = '4c7e2f19-8b53-4d06-a7e2-6f1b9c3d5e80';
const STANDARD_VERSION_ID = '8e2a5c31-7f94-4b60-9d38-1c5e7a2f6b04';

/**
 * The read of one stored row, made by this file's own statement rather than through a module under
 * test, so a returned entry is compared against what the table actually holds. A fee row is addressed
 * by the report it was charged for, which is the reference it carries.
 */
const SELECT_STORED_ROW_SQL = `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE report_id = ?`;

/**
 * One ledger's rows in the sequence they were appended, made by this file's own statement so a case
 * holding two rows can name each of them: `rowid` is the table's own insertion counter, whereas a
 * read addressed by the report would be ambiguous once one evaluation's fee has been appended twice.
 */
const SELECT_STORED_ROWS_OF_LEDGER_SQL = `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE ledger = ?
ORDER BY rowid ASC`;

/** One ledger's row count, taken from the table so a case can assert that a write only appended. */
const COUNT_LEDGER_ROWS_SQL = `SELECT COUNT(*) AS count FROM ledger_entries WHERE ledger = ?`;

/** The whole table's row count, used where a case asserts that nothing was appended at all. */
const COUNT_ALL_ROWS_SQL = `SELECT COUNT(*) AS count FROM ledger_entries`;

/**
 * The fiction this file stores. Both report identifiers are fixed and invented, and each names a
 * seeded `evaluation_reports` row that {@link seedReferencedRows} writes, so the reference a fee
 * carries is a real reference rather than an opaque string.
 */
const REPORT_ID = '3f8c1d50-9a47-4b26-8c15-7e0d94b3a2f1';
const SECOND_REPORT_ID = 'd6b2497a-4c13-4e80-b57f-1a90c3e8d2b4';

/** The instant the injected clock returns, pinned so an appended row carries a known value. */
const FIXTURE_INSTANT = '2024-01-01T00:00:00.000Z';

/** The clock a case appends under, so an inserted instant is a known value rather than a reading. */
const pinnedNow = (): string => FIXTURE_INSTANT;

/** The shape the default clock's ISO-8601 UTC instant takes, asserted where no clock is supplied. */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shape `crypto.randomUUID()` produces; asserted so two appended rows cannot share an id. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The resolved configuration, which is the only source of the amount and of the two labels. */
const CONFIG = resolveCommerceConfig();

/** The plan's default fee for the synthetic label, written as its whole number of minor units. */
const DEFAULT_FEE_MINOR_UNITS = 15000;

/**
 * The eleven members a ledger row has, and therefore the whole of what an appended entry can carry.
 * The list is the assertion that makes "no field through which an evaluation result could be read"
 * checkable: a commercial or measured value added to the row would have to appear here first.
 */
const ENTRY_MEMBERS = [
  'amount_minor_units',
  'created_at',
  'currency_label',
  'description',
  'direction',
  'entry_type',
  'id',
  'ledger',
  'report_id',
  'transaction_id',
  'disclosure_label',
];

/**
 * Fees a case records, as the configured amount in whole minor units: a fee the product's default
 * does not carry, so a case proves the amount read is the configured one rather than a value written
 * into the module, and the smallest fee the configuration admits, so the boundary below the default
 * is covered as well.
 */
const CHANGED_FEE_CASES: ReadonlyArray<{ readonly feeMinorUnits: number }> = [
  { feeMinorUnits: 20000 },
  { feeMinorUnits: 1 },
];

/** The stored shape of one row, under the table's own column names. */
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
 * developer account, the category, the listing that developer owns and its first version, the
 * standard and the one standard version the pass thresholds are held in, and the two reports this
 * file's own two identifiers name. Both reports hang from the same versioned parents, which is why one
 * of each is seeded for the pair.
 */
function seedReferencedRows(): void {
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

  db.prepare('INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)').run(
    STANDARD_ID,
    'SGI-SO-1.0.0',
    'Structured Output Conformance',
    'A seeded standard the fixture reports are traced to.',
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

  const insertReport = db.prepare(
    `INSERT INTO evaluation_reports
       (id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
        critical_failures, label, rubric_reference, prior_report_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // One row per report identifier this file charges a fee for, so each fee's reference names an
  // evaluation that exists and neither report claims a predecessor of its own.
  for (const reportId of [REPORT_ID, SECOND_REPORT_ID]) {
    insertReport.run(
      reportId,
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
}

/** Reads the stored row a report identifier names, independently of any reader under test. */
function storedRowForReport(reportId: string): StoredLedgerEntryRow | undefined {
  return db.prepare<[string], StoredLedgerEntryRow>(SELECT_STORED_ROW_SQL).get(reportId);
}

/** Reads one ledger's stored rows in the sequence they were appended. */
function storedRowsOfLedger(ledger: string): StoredLedgerEntryRow[] {
  return db.prepare<[string], StoredLedgerEntryRow>(SELECT_STORED_ROWS_OF_LEDGER_SQL).all(ledger);
}

/** Counts one ledger's rows, so a case can assert that a write only appended rows. */
function storedRowCountOfLedger(ledger: string): number {
  const row = db.prepare<[string], { readonly count: number }>(COUNT_LEDGER_ROWS_SQL).get(ledger);

  return row?.count ?? 0;
}

/** Counts every row the table holds, so a case can assert that nothing was appended at all. */
function storedRowCount(): number {
  const row = db.prepare<[], { readonly count: number }>(COUNT_ALL_ROWS_SQL).get();

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

describe('recordGateFeeCharge', () => {
  describe('the appended charge', () => {
    it('appends one charge of the default flat amount, carrying the report and no transaction', () => {
      const returned = recordGateFeeCharge(db, {
        reportId: REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });

      const entries = listLedgerEntries(db, 'gate_fees');

      // Exactly one row was appended, and the entry the ledger read hands back is the row the table
      // holds: the writer's answer is not merely self-consistent with the ledger read.
      expect(entries).toHaveLength(1);

      const appended = entries[0];

      expect(appended).toMatchObject({
        ledger: 'gate_fees',
        entry_type: 'charge',
        direction: 'debit',
        amount_minor_units: CONFIG.gateFeeMinorUnits,
        transaction_id: null,
        report_id: REPORT_ID,
        currency_label: SYNTHETIC_CURRENCY_LABEL,
        disclosure_label: COMMERCE_DISCLOSURE_LABEL,
        created_at: FIXTURE_INSTANT,
      });
      expect(appended?.id).toMatch(UUID_V4);

      // The description is stored and readable, and it names no amount, no person and no provider.
      expect(String(appended?.description).trim()).not.toBe('');

      expect(returned).toEqual(appended);
      expect(storedRowForReport(REPORT_ID)).toEqual(appended);
      expect(storedRowCount()).toBe(1);
    });

    it('charges the plan default of 150.00 of the synthetic label under the default configuration', () => {
      // The configured amount and the plan's figure are asserted to be one value before the entry is
      // read, so the number below is anchored to the configuration rather than restated beside it.
      expect(CONFIG.gateFeeMinorUnits).toBe(DEFAULT_FEE_MINOR_UNITS);

      const returned = recordGateFeeCharge(db, {
        reportId: REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });

      expect(returned?.amount_minor_units).toBe(DEFAULT_FEE_MINOR_UNITS);
      expect(storedRowForReport(REPORT_ID)?.amount_minor_units).toBe(DEFAULT_FEE_MINOR_UNITS);
    });

    it.each(CHANGED_FEE_CASES)(
      'copies a configured fee of $feeMinorUnits minor units exactly',
      ({ feeMinorUnits }) => {
        const config = resolveCommerceConfig({ gateFeeMinorUnits: feeMinorUnits });

        const returned = recordGateFeeCharge(db, {
          reportId: REPORT_ID,
          config,
          now: pinnedNow,
        });

        expect(returned?.amount_minor_units).toBe(feeMinorUnits);
        expect(Number.isInteger(returned?.amount_minor_units)).toBe(true);
        expect(storedRowForReport(REPORT_ID)?.amount_minor_units).toBe(feeMinorUnits);
      },
    );

    it('takes the system clock when no clock is supplied', () => {
      const returned = recordGateFeeCharge(db, { reportId: REPORT_ID, config: CONFIG });

      expect(returned?.created_at).toMatch(ISO_UTC_INSTANT);
      expect(storedRowForReport(REPORT_ID)?.created_at).toBe(returned?.created_at);
    });
  });

  describe('the flat fee, whatever the evaluation reported', () => {
    it('appends the same amount for two evaluations of different reports', () => {
      const first = recordGateFeeCharge(db, {
        reportId: REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });
      const second = recordGateFeeCharge(db, {
        reportId: SECOND_REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });

      // Two evaluations, two report identifiers and two entries of exactly the same amount: the fee
      // is a property of the configuration and of nothing the evaluations reported.
      expect(first?.amount_minor_units).toBe(CONFIG.gateFeeMinorUnits);
      expect(second?.amount_minor_units).toBe(first?.amount_minor_units);
      expect(first?.report_id).toBe(REPORT_ID);
      expect(second?.report_id).toBe(SECOND_REPORT_ID);
      expect(storedRowCount()).toBe(2);
      expect(first).not.toEqual(second);
      expect(first?.id).not.toBe(second?.id);
    });

    it('carries no member through which an evaluation result could be read', () => {
      const returned = recordGateFeeCharge(db, {
        reportId: REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });

      // The row is the ledger's own eleven members and nothing else: no field of it names what the
      // evaluation found, which is what keeps the fee independent of the measurement by construction.
      expect(Object.keys(returned ?? {}).sort()).toEqual([...ENTRY_MEMBERS].sort());
      expect(Object.keys(storedRowForReport(REPORT_ID) ?? {}).sort()).toEqual([...ENTRY_MEMBERS].sort());
    });
  });

  describe('the configured fee that does not apply', () => {
    it('appends nothing and answers with nothing when the configured fee is zero', () => {
      const config = resolveCommerceConfig({ gateFeeMinorUnits: 0 });

      const returned = recordGateFeeCharge(db, { reportId: REPORT_ID, config, now: pinnedNow });

      // The call answered with nothing, the table is empty and the gate-fee ledger holds no entry:
      // a fee configuration that does not apply leaves no row behind rather than a row of nothing.
      expect(returned).toBeNull();
      expect(storedRowCount()).toBe(0);
      expect(storedRowCountOfLedger('gate_fees')).toBe(0);
      expect(listLedgerEntries(db, 'gate_fees')).toEqual([]);
      expect(storedRowForReport(REPORT_ID)).toBeUndefined();
    });
  });

  describe('what a recorded fee never reaches', () => {
    it('appends no founder-participation and no marketplace entry', () => {
      recordGateFeeCharge(db, { reportId: REPORT_ID, config: CONFIG, now: pinnedNow });

      // A gate fee is journalled in the gate-fee ledger alone: the other two ledgers hold nothing
      // after the call, which is the property the product's commercial rules rest on.
      expect(storedRowCountOfLedger('gate_fees')).toBe(1);
      expect(storedRowCountOfLedger('founder_allocation')).toBe(0);
      expect(storedRowCountOfLedger('marketplace')).toBe(0);
      expect(storedRowCount()).toBe(1);
      expect(listLedgerEntries(db, 'founder_allocation')).toEqual([]);
      expect(listLedgerEntries(db, 'marketplace')).toEqual([]);
    });
  });

  describe('repeated calls', () => {
    it('appends a further row for a further call and leaves the row already appended as it was', () => {
      const first = recordGateFeeCharge(db, {
        reportId: REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });

      const second = recordGateFeeCharge(db, {
        reportId: REPORT_ID,
        config: CONFIG,
        now: pinnedNow,
      });

      // Two calls, two rows: a fee is a record of a completed evaluation and each completed
      // evaluation appends its own, so the count only grows and the row first appended reads back
      // exactly as it was written — the second row is a further append and not a replacement of it.
      expect(second).not.toEqual(first);
      expect(second?.id).not.toBe(first?.id);
      expect(storedRowCountOfLedger('gate_fees')).toBe(2);
      expect(listLedgerEntries(db, 'gate_fees')).toHaveLength(2);
      expect(first?.created_at).toBe(FIXTURE_INSTANT);
      expect(second?.amount_minor_units).toBe(first?.amount_minor_units);

      const appended = storedRowsOfLedger('gate_fees');
      expect(appended).toHaveLength(2);
      expect(appended[0]).toEqual(first);
      expect(appended[1]).toEqual(second);
    });
  });
});
