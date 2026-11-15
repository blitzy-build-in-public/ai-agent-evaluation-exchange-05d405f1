/**
 * Unit tests for the founder-allocation writer: the one row an eligible completed simulated
 * marketplace transaction appends to the founder-allocation ledger.
 *
 * Every case runs in process against a real SQLite database held in memory and built from the ordered
 * migrations in `packages/shared/migrations/`, applied in filename order exactly as the server's
 * runner applies them: the ledger discriminator, the entry kinds, the two directions, the non-negative
 * amount guard, the synthetic-currency guard and the table-level pair constraint that keeps a
 * transaction reference and a report reference from co-occurring are properties of the delivered
 * schema rather than of the function alone, so a schema drift has to fail a case here instead of
 * passing silently. The connection enables `foreign_keys`, and the fixture seeds every row an
 * allocation references — the buyer and the developer with their category, listing and version, and
 * the two transactions this file's own two identifiers name — so the transaction an allocation is
 * computed from is a row of the delivered tables and the delivered reference holds. The append-only
 * abort triggers of `0010_append_only_triggers.sql` arrive with those migrations, as they do in the
 * delivered schema: what this file asserts is the property the writer holds, that repeated calls only
 * append rows and leave the rows already appended as they were written. The proof that no route
 * rewrites an append-only row belongs to the API's integration suite in `apps/api/test/integration/`,
 * which owns the routes.
 *
 * No HTTP server, no database file and no per-package runner configuration: the file is discovered
 * by the root unit configuration's `packages/ * /src/**` glob.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";

import { COMMERCE_DISCLOSURE_LABEL, resolveCommerceConfig } from "../config";
import type { CommerceConfig } from "../config";
import { allocate } from "./allocate";
import { recordFounderAllocation } from "./founder-allocation";
import type { RecordFounderAllocationInput } from "./founder-allocation";
import { listLedgerEntries } from "./ledger-repository";

/** The ordered migrations, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

/**
 * The rows every fixture allocation hangs from: the buyer whose transactions are journalled, the
 * developer who owns the listing, the category that listing sits in, the listing itself and its first
 * version. All five are fixed and invented, and they are the same demonstration identities this
 * workspace's sibling fixtures store.
 */
const BUYER_ACCOUNT_ID = "b2c7d1e9-4f60-4a83-9e57-1c8b3d0f6a24";
const DEVELOPER_ACCOUNT_ID = "5d3a9c07-2e81-4f6b-9a40-8c1f6d27b3e9";
const CATEGORY_ID = "e41b8d76-9c02-4a35-8f61-7d0e5b94c218";
const LISTING_ID = "c5e9a27b-1d34-4f80-b65c-2a7e9d1f4b38";
const LISTING_VERSION_ID = "7a3d8f51-6c20-4b97-8e14-d9f2a5c30b6e";

/** The columns a stored row is read through, in the table's own order. */
const SELECT_STORED_ENTRY_SQL = `SELECT
  id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
  currency_label, disclosure_label, description, created_at
FROM ledger_entries
WHERE id = ?`;

/**
 * The eleven columns of `ledger_entries`, alphabetically. Asserting a stored row's own key set
 * against this list is what proves a row built by the writer carries no field of its own — a
 * beneficiary, an entitlement, an identity or any other attribution would be a column the table does
 * not have and a value the writer had to invent.
 */
const LEDGER_ENTRY_COLUMNS: readonly string[] = [
  "amount_minor_units",
  "created_at",
  "currency_label",
  "description",
  "direction",
  "disclosure_label",
  "entry_type",
  "id",
  "ledger",
  "report_id",
  "transaction_id",
];

/**
 * The fiction this file stores: two fixed, invented transaction identifiers, each naming a seeded
 * transaction row that {@link seedReferencedRows} writes, so the reference an allocation carries is a
 * real reference rather than an opaque string.
 */
const TRANSACTION_ID = "1f2b6d84-9a30-4c57-8e12-6b4d7c05a9f3";
const SECOND_TRANSACTION_ID = "5d8e3c17-2b64-4a09-8f51-3c7a0e9b6d24";

/** The instant the injected clock answers with, and a second pinned one. */
const FIXTURE_INSTANT = "2024-01-01T00:00:00.000Z";
const LATER_FIXTURE_INSTANT = "2024-01-02T00:00:00.000Z";

/** The clock a case appends under, so a written instant is a known value rather than a reading. */
const pinnedNow = (): string => FIXTURE_INSTANT;

/** The shape the default clock's ISO-8601 UTC instant takes, asserted where no clock is supplied. */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shape `crypto.randomUUID()` produces; asserted so two rows cannot share an identifier. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The resolved configuration, which is the only source of the rate and of the two labels. */
const CONFIG = resolveCommerceConfig();

/** The rate the product's default configuration carries, as the entry's description states it. */
const DEFAULT_RATE_BASIS_POINTS = 25;

/** A changed configuration, so a case can tell a configured rate from a written-in one. */
const CHANGED_RATE_CONFIG = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });

/**
 * One half, written as a power of two: the fraction a refusal case passes without this file carrying
 * a fractional literal. A half is exactly representable, so what a call received is precisely the
 * non-whole number the allocation refuses.
 */
const ONE_HALF = 2 ** -1;

/**
 * The four members of the input shape, so the key set a caller can pass is asserted rather than
 * assumed. The literal is typed as the exported interface, which makes a fifth member written here a
 * compile error: the shape is held to four members by the type checker, and this case holds the
 * runtime reading of it.
 */
const INPUT_MEMBERS: RecordFounderAllocationInput = {
  transactionId: TRANSACTION_ID,
  netAmountMinorUnits: 10000,
  config: CONFIG,
  now: pinnedNow,
};

/** The stored shape of one row, declared under the table's own column names. */
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
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/**
 * Seeds every row the fixture's allocations reference, in the order the delivered references require:
 * the two accounts, the category, the listing the developer owns and its first version, and the two
 * transactions this file's own two identifiers name.
 */
function seedReferencedRows(): void {
  const insertAccount =
    db.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)");

  insertAccount.run(BUYER_ACCOUNT_ID, "demo-buyer-handle", "buyer", "Demo buyer account");
  insertAccount.run(
    DEVELOPER_ACCOUNT_ID,
    "demo-developer-handle",
    "developer",
    "Demo developer account",
  );

  db.prepare("INSERT INTO categories (id, slug, name) VALUES (?, ?, ?)").run(
    CATEGORY_ID,
    "demo-category",
    "Demo category",
  );

  db.prepare(
    `INSERT INTO listings
       (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    LISTING_ID,
    DEVELOPER_ACCOUNT_ID,
    "demo-listing",
    "Demo listing",
    "A seeded listing used to reference a real row.",
    CATEGORY_ID,
    "MIT",
    "purchase",
    "active",
    FIXTURE_INSTANT,
    FIXTURE_INSTANT,
  );

  db.prepare(
    `INSERT INTO listing_versions
       (id, listing_id, version_string, notes, is_fixture_candidate, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(LISTING_VERSION_ID, LISTING_ID, "1.0.0", "The first version.", 0, FIXTURE_INSTANT);

  const insertTransaction = db.prepare(
    `INSERT INTO transactions
       (id, buyer_account_id, listing_id, listing_version_id, offer_model,
        amount_minor_units, currency_label, simulated, disclosure_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // One row per identifier this file computes an allocation from, so each allocation's reference is a
  // row the transactions table holds. The two labels are the table's own: the synthetic currency
  // label its `CHECK` admits and the resolved configuration's disclosure label.
  for (const transactionId of [TRANSACTION_ID, SECOND_TRANSACTION_ID]) {
    insertTransaction.run(
      transactionId,
      BUYER_ACCOUNT_ID,
      LISTING_ID,
      LISTING_VERSION_ID,
      "purchase",
      INPUT_MEMBERS.netAmountMinorUnits,
      SYNTHETIC_CURRENCY_LABEL,
      1,
      CONFIG.disclosureLabel,
      FIXTURE_INSTANT,
    );
  }
}

/** An input for one append, with no clock supplied. */
function inputFor(
  netAmountMinorUnits: number,
  config: CommerceConfig = CONFIG,
  transactionId: string = TRANSACTION_ID,
): RecordFounderAllocationInput {
  return { transactionId, netAmountMinorUnits, config };
}

/** The same input under the pinned clock, for a case that asserts the instant it was written with. */
function pinnedInputFor(
  netAmountMinorUnits: number,
  config: CommerceConfig = CONFIG,
): RecordFounderAllocationInput {
  return { ...inputFor(netAmountMinorUnits, config), now: pinnedNow };
}

/** Reads one stored row by its identifier, independently of the reader under test. */
function readStoredRow(id: string): StoredLedgerEntryRow | undefined {
  return db.prepare<[string], StoredLedgerEntryRow>(SELECT_STORED_ENTRY_SQL).get(id);
}

/** Counts the rows the table holds, so a case can assert that a write only appended rows. */
function storedRowCount(): number {
  const row = db
    .prepare<[], { readonly count: number }>("SELECT COUNT(*) AS count FROM ledger_entries")
    .get();

  return row?.count ?? 0;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  seedReferencedRows();
});

afterEach(() => {
  db.close();
});

describe("recordFounderAllocation", () => {
  describe("the entry it appends", () => {
    it("allocates 25 minor units from a net amount of 10000 at the product's default rate", () => {
      // The anchor first: without it, comparing the entry with the allocation function itself would
      // hold for any rate the writer might have applied, a wrong one included.
      expect(allocate(10000, DEFAULT_RATE_BASIS_POINTS)).toBe(25);

      const entry = recordFounderAllocation(db, pinnedInputFor(10000));

      expect(entry.amount_minor_units).toBe(25);
      expect(Number.isInteger(entry.amount_minor_units)).toBe(true);
    });

    it("records an allocation on the credit side of the founder-allocation ledger", () => {
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));

      expect(entry).toMatchObject({
        ledger: "founder_allocation",
        entry_type: "allocation",
        direction: "credit",
      });
    });

    it("carries the transaction it was computed from and an explicit null report reference", () => {
      // A row of this table references a transaction or a report and never both, so the report side
      // is written as an explicit null rather than left absent.
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));

      expect(entry.transaction_id).toBe(TRANSACTION_ID);
      expect(entry.report_id).toBeNull();
    });

    it("returns the row it appended, as the read of that ledger reports it", () => {
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));

      expect(readStoredRow(entry.id)).toEqual(entry);
      expect(listLedgerEntries(db, "founder_allocation")).toEqual([entry]);
      expect(storedRowCount()).toBe(1);
    });

    it("carries the currency label and the disclosure label of the configuration it was handed", () => {
      // Both labels have a single legal value in this product — the currency label is typed as the
      // one the shared constant declares, and resolution always answers with the one disclosure
      // sentence — so the rate is the member a fixture can vary to tell a configuration-sourced
      // entry from a hardcoded one. The label assertions still hold the entry to its configuration.
      const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: 100 });
      const entry = recordFounderAllocation(db, pinnedInputFor(10000, config));

      expect(SYNTHETIC_CURRENCY_LABEL).toBe("DEMO");
      expect(COMMERCE_DISCLOSURE_LABEL).toBe(config.disclosureLabel);
      expect(entry.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
      expect(entry.currency_label).toBe(config.currencyLabel);
      expect(entry.disclosure_label).toBe(config.disclosureLabel);
    });

    it("carries no personal identity, beneficiary or entitlement field", () => {
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));
      const stored = readStoredRow(entry.id);

      expect(stored).toBeDefined();
      expect(Object.keys(stored ?? {}).sort()).toEqual([...LEDGER_ENTRY_COLUMNS]);
      expect(Object.keys(entry).sort()).toEqual([...LEDGER_ENTRY_COLUMNS]);

      // An entry is a computed share of a simulated transaction and assigns it to no one: no name,
      // no beneficiary, no entitlement and no payout appears in what it records.
      expect(entry.description).not.toMatch(/beneficiary|entitlement|payout|equity|identity/i);
    });

    it("is asked for a transaction, its net amount, a configuration and a clock, and nothing else", () => {
      // Four members, and the type checker refuses a fifth written into this literal: a shape that
      // admitted a gate fee, a report reference or a gross amount would be a shape through which
      // something other than a net marketplace amount could allocate.
      expect(Object.keys(INPUT_MEMBERS).sort()).toEqual([
        "config",
        "netAmountMinorUnits",
        "now",
        "transactionId",
      ]);
    });
  });

  describe("the rate it records", () => {
    it("states in the entry the basis-point rate its amount was computed from", () => {
      // The appended row is the durable record of that rate, so it is asserted as the decimal text
      // of the configured value beside the unit it is expressed in rather than as a written-out
      // sentence: the wording belongs to the module under test.
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));

      expect(entry.description).toContain(String(DEFAULT_RATE_BASIS_POINTS));
      expect(entry.description).toContain("basis points");
    });

    it("states a changed rate and computes the amount at it", () => {
      expect(allocate(10000, 100)).toBe(100);

      const entry = recordFounderAllocation(db, pinnedInputFor(10000, CHANGED_RATE_CONFIG));

      expect(entry.amount_minor_units).toBe(100);
      expect(entry.description).toContain(
        String(CHANGED_RATE_CONFIG.founderAllocationRateBasisPoints),
      );
      expect(entry.description).toContain("basis points");
    });

    it("takes its amount from the configured rate for every rate, the default included", () => {
      // Each amount is compared with what it must be derived from rather than with a second
      // implementation of the arithmetic, so a writer applying a rate of its own — the default
      // written in, the rate doubled — fails here however well the anchored cases above pass.
      const rates = [0, 1, DEFAULT_RATE_BASIS_POINTS, 100, 2500];

      for (const rateBasisPoints of rates) {
        const config = resolveCommerceConfig({ founderAllocationRateBasisPoints: rateBasisPoints });
        const entry = recordFounderAllocation(db, pinnedInputFor(10000, config));

        expect(entry.amount_minor_units).toBe(allocate(10000, rateBasisPoints));
        expect(Number.isInteger(entry.amount_minor_units)).toBe(true);
      }
    });

    it("keeps the rate durable: a row read back states the rate it was written at, whatever is resolved later", () => {
      const written = recordFounderAllocation(db, pinnedInputFor(10000));

      // A different configuration is resolved after the row was appended, and the row already
      // written still states the rate it was computed from: neither the row nor its description
      // follows the configuration the product is resolved with now.
      expect(CHANGED_RATE_CONFIG.founderAllocationRateBasisPoints).toBe(100);
      expect(written.description).toContain(String(DEFAULT_RATE_BASIS_POINTS));
      expect(written.description).not.toContain(
        String(CHANGED_RATE_CONFIG.founderAllocationRateBasisPoints),
      );
      expect(readStoredRow(written.id)).toEqual(written);
    });
  });

  describe("the clock and the history", () => {
    it("writes the instant the supplied clock answers with into created_at", () => {
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));

      expect(entry.created_at).toBe(FIXTURE_INSTANT);
    });

    it("appends under the system clock when no clock is supplied", () => {
      const first = recordFounderAllocation(db, inputFor(10000));
      const second = recordFounderAllocation(db, inputFor(10000));

      expect(first.id).not.toBe(second.id);
      expect(first.id).toMatch(UUID_V4);
      expect(second.id).toMatch(UUID_V4);

      // An ISO-8601 UTC instant, never SQLite's timestamp format and never a local one.
      expect(first.created_at).toMatch(ISO_UTC_INSTANT);
      expect(second.created_at).toMatch(ISO_UTC_INSTANT);
    });

    it("appends a second row on a second call and leaves the row already written as it was", () => {
      const first = recordFounderAllocation(db, pinnedInputFor(10000));
      const countAfterFirst = storedRowCount();

      const second = recordFounderAllocation(db, pinnedInputFor(10000, CHANGED_RATE_CONFIG));

      // Two calls appended exactly two rows, the second is its own row, and the first reads back
      // value for value as it was written.
      expect(storedRowCount()).toBe(countAfterFirst + 1);
      expect(second.id).not.toBe(first.id);

      const appended = listLedgerEntries(db, "founder_allocation");
      expect(appended).toEqual([first, second]);
      expect(readStoredRow(first.id)).toEqual(first);
    });

    it("appends its row for a net amount of nothing, at an allocation of nothing", () => {
      // An allocation of nothing on an eligible transaction is a computed allocation, so its row is
      // appended: the ledger's history follows the event rather than the amount it produced.
      const entry = recordFounderAllocation(db, pinnedInputFor(0));

      expect(entry.amount_minor_units).toBe(0);
      expect(storedRowCount()).toBe(1);
      expect(listLedgerEntries(db, "founder_allocation")).toEqual([entry]);
    });
  });

  describe("refusals", () => {
    it("propagates the RangeError for a negative net amount, names the argument and appends nothing", () => {
      expect(() => recordFounderAllocation(db, inputFor(-1))).toThrow(RangeError);
      expect(() => recordFounderAllocation(db, inputFor(-1))).toThrow("amountMinorUnits");
      expect(storedRowCount()).toBe(0);
    });

    it("propagates the RangeError for a fractional net amount", () => {
      // Written as a power of two rather than as a fractional literal, so this file holds no
      // fractional amount for a reader to copy.
      expect(() => recordFounderAllocation(db, inputFor(ONE_HALF))).toThrow(RangeError);
      expect(() => recordFounderAllocation(db, inputFor(ONE_HALF))).toThrow("amountMinorUnits");
      expect(storedRowCount()).toBe(0);
    });

    it("propagates the RangeError when the product of the amount and the rate is not a safe integer", () => {
      // Both values pass their own checks and the product alone is past the range the number type
      // represents exactly, so a writer that read an inexact product would record a wrong amount.
      expect(() =>
        recordFounderAllocation(db, inputFor(Number.MAX_SAFE_INTEGER)),
      ).toThrow(RangeError);
      expect(() =>
        recordFounderAllocation(db, inputFor(Number.MAX_SAFE_INTEGER)),
      ).toThrow("amountMinorUnits");
      expect(storedRowCount()).toBe(0);
    });

    it("propagates the RangeError for a configured rate that is not a whole number", () => {
      // A rate half a basis point above a whole one, as a caller without types can build one: the
      // rate reaches the allocation, which is what refuses it, and the entry is never appended.
      const malformedConfig: CommerceConfig = {
        currencyLabel: SYNTHETIC_CURRENCY_LABEL,
        gateFeeMinorUnits: CONFIG.gateFeeMinorUnits,
        founderAllocationRateBasisPoints: DEFAULT_RATE_BASIS_POINTS + ONE_HALF,
        disclosureLabel: CONFIG.disclosureLabel,
      };

      expect(() => recordFounderAllocation(db, inputFor(10000, malformedConfig))).toThrow(RangeError);
      expect(() => recordFounderAllocation(db, inputFor(10000, malformedConfig))).toThrow(
        "rateBasisPoints",
      );
      expect(storedRowCount()).toBe(0);
    });
  });

  describe("what it never appends", () => {
    it("appends no entry of another ledger and no other entry kind", () => {
      recordFounderAllocation(db, pinnedInputFor(10000));

      expect(listLedgerEntries(db, "marketplace")).toEqual([]);
      expect(listLedgerEntries(db, "gate_fees")).toEqual([]);

      const appended = listLedgerEntries(db, "founder_allocation");
      expect(appended.every((entry) => entry.ledger === "founder_allocation")).toBe(true);
      expect(appended.every((entry) => entry.entry_type === "allocation")).toBe(true);
    });

    it("appends no reversal, which is a new row built where a refund is ruled", () => {
      recordFounderAllocation(db, pinnedInputFor(10000));

      const appended = listLedgerEntries(db, "founder_allocation");

      expect(appended.filter((entry) => entry.entry_type === "reversal")).toHaveLength(0);
      expect(appended.filter((entry) => entry.direction === "debit")).toHaveLength(0);
    });

    it("writes no currency symbol, payment path or attribution into the description", () => {
      const entry = recordFounderAllocation(db, pinnedInputFor(10000));
      const forbidden = /[$€£¥₹]|provider|card|bank|beneficiary|entitlement|equity/i;

      expect(entry.description).not.toMatch(forbidden);
      expect(entry.description).toMatch(/simulated/i);
    });
  });
});
