/**
 * The integration proof of `runMigrations` from `apps/api/src/db/migrate.ts`: the one path by which
 * the SQL files in `packages/shared/migrations/` reach a database.
 *
 * What it evidences, in the terms the plan states them:
 *
 * - **A first run applies the delivered set.** Every file the migrations directory carries, in
 *   filename order, each recorded once with its own name and a SHA-256 recomputed here from that
 *   file's bytes, and `PRAGMA user_version` left at the highest applied version.
 * - **A second run is a no-op.** Nothing applied, nothing recorded, the same highest version.
 * - **A tampered history refuses the whole run, before anything is applied.** The three states a
 *   changed, renamed and removed migration file leave are each staged in the database's own
 *   `schema_migrations` rows — never in a tracked file — and each refusal names the offending version
 *   and file.
 * - **A failed file rolls back completely.** Its statements and the row that records it are undone
 *   together, so a migration that failed never looks applied.
 * - **`PRAGMA user_version` is a marker, not the state.** It is set to the highest applied version and
 *   nothing consults it: the applied state, and the checksum comparison, are the `schema_migrations`
 *   rows.
 *
 * Every case runs against a fresh `:memory:` handle, the way the plan says the integration suites
 * hold their database, so no case can reach another's schema or rows. A tampering case stages in
 * `schema_migrations` exactly what an edited or removed file would leave behind: the migration files
 * themselves are tracked and checksum-guarded, and nothing here writes one.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../src/db/migrate";

/**
 * The migrations directory, resolved from this file rather than from the working directory, which is
 * the same way the runner resolves it: one `../` per level between this file and the repository root.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../packages/shared/migrations/", import.meta.url),
);

/** The runner's own file-name grammar, applied here so the expected set is the runner's own set. */
const MIGRATION_FILE_NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/** The migration files the checkout carries, in the order the runner applies them. */
const MIGRATION_FILE_NAMES: readonly string[] = Object.freeze(
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => MIGRATION_FILE_NAME.test(name))
    .sort(),
);

/**
 * The nine append-only tables the plan names, each of which `0010_append_only_triggers.sql` guards
 * with a `BEFORE UPDATE` and a `BEFORE DELETE` trigger running `RAISE(ABORT)`.
 */
const APPEND_ONLY_TABLES: readonly string[] = Object.freeze([
  "standard_versions",
  "evaluation_reports",
  "report_case_results",
  "governance_events",
  "ledger_entries",
  "transactions",
  "refunds",
  "audit_events",
  "listing_versions",
]);

/**
 * The tables `0011_indexes.sql` declares its ten read-path indexes on, which is why that file can
 * only be applied once every one of them exists.
 */
const INDEXED_TABLES: readonly string[] = Object.freeze([
  "listings",
  "evaluation_reports",
  "governance_events",
  "ledger_entries",
  "refunds",
  "audit_events",
]);

/** Handles this file opened, closed after each case. */
const openHandles: Database.Database[] = [];

/** One row of `schema_migrations`, as read back for an assertion. */
interface RecordedRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

/** One schema object: its name, and for a trigger the table it sits on. */
interface SchemaObjectRow {
  readonly name: string;
  readonly tbl_name: string;
}

/** A single-row `COUNT(*)` answer. */
interface CountRow {
  readonly count: number;
}

/** Opens a fresh in-memory database of this file's own and records it for cleanup. */
function newDatabase(): Database.Database {
  const handle = new Database(":memory:");
  openHandles.push(handle);
  return handle;
}

/**
 * Runs `action` and returns the value it threw, so a refusal's message can be read rather than merely
 * counted — every refusal asserted below is one a reader has to be able to act on.
 */
function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to throw, but it returned normally");
}

/** Every schema object of one kind the database holds, by name. */
function schemaObjectNames(database: Database.Database, type: string): string[] {
  return database
    .prepare<[string], { readonly name: string }>(
      "SELECT name FROM sqlite_master WHERE type = ? ORDER BY name",
    )
    .all(type)
    .map((row) => row.name);
}

/** The schema objects and the table each one sits on, for one kind of object. */
function schemaObjects(
  database: Database.Database,
  type: string,
): SchemaObjectRow[] {
  return database
    .prepare<[string], SchemaObjectRow>(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = ? ORDER BY name",
    )
    .all(type);
}

/** Every row the runner recorded, oldest version first. */
function recordedMigrations(database: Database.Database): RecordedRow[] {
  return database
    .prepare<[], RecordedRow>("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    .all();
}

/** How many rows `schema_migrations` holds. */
function recordedRowCount(database: Database.Database): number {
  const row = database
    .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM schema_migrations")
    .get();
  if (row === undefined) {
    throw new Error("expected `SELECT COUNT(*)` to answer one row, and it answered none");
  }
  return row.count;
}

/** The SHA-256 of a migration file's bytes, recomputed here the way the runner computes it. */
function sha256OfMigrationFile(name: string): string {
  return createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, name))).digest("hex");
}

/**
 * A freshly migrated handle with one tampering statement already staged in `schema_migrations`.
 *
 * The staged row is the state an edited, renamed or removed migration file leaves behind, and it is
 * the only state the runner can be shown without editing a tracked file.
 */
function migratedThenTampered(tamper: (database: Database.Database) => void): Database.Database {
  const database = newDatabase();
  runMigrations(database);
  tamper(database);
  return database;
}

/**
 * Runs the runner again over a tampered handle and returns the message of the refusal it raised.
 *
 * It also asserts the two things "refused before applying anything" means: the row count in
 * `schema_migrations` is unchanged and no new table appeared, so a refusal cannot have been reported
 * after a pending file was applied.
 */
function expectRefusalBeforeApplying(database: Database.Database): string {
  const rowsBefore = recordedRowCount(database);
  const tablesBefore = schemaObjectNames(database, "table");

  const refusal = thrownBy(() => runMigrations(database));

  expect(refusal).toBeInstanceOf(Error);
  expect(recordedRowCount(database)).toBe(rowsBefore);
  expect(schemaObjectNames(database, "table")).toStrictEqual(tablesBefore);
  return (refusal as Error).message;
}

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    if (handle.open) {
      handle.close();
    }
  }
});

describe("runMigrations on a fresh database", () => {
  it("applies the delivered set in filename order and records each file's own checksum", () => {
    const database = newDatabase();

    const run = runMigrations(database);

    // The set is the thirteen files the directory carries — the plan's eleven plus
    // `0012_amount_integer_guards.sql`, which adds the integrality guard on the four amount columns,
    // and `0013_newest_row_and_filter_indexes.sql`, which adds the five read-path indexes the
    // newest-row and filter reads need — read from the directory so a removed or added file fails
    // here rather than passing as an empty sweep.
    expect(MIGRATION_FILE_NAMES).toHaveLength(13);
    expect(run.appliedCount).toBe(13);
    expect(run.appliedFiles).toStrictEqual(MIGRATION_FILE_NAMES);
    expect(run.highestVersion).toBe(13);

    const rows = recordedMigrations(database);
    expect(rows).toHaveLength(13);
    rows.forEach((row, index) => {
      expect(row.version).toBe(index + 1);
      expect(row.name).toBe(MIGRATION_FILE_NAMES[index]);
      // Recomputed from the file's bytes rather than compared with the row's own value: a row that
      // recorded something other than the file's checksum satisfies the latter and not this.
      expect(row.checksum).toBe(sha256OfMigrationFile(row.name));
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    // The highest applied version, as the integer marker the plan describes.
    expect(database.pragma("user_version", { simple: true })).toBe(13);

    // 0010's eighteen triggers: an updating and a deleting guard on each of the nine append-only
    // tables, and on no other table.
    const triggerRows = schemaObjects(database, "trigger");
    expect(triggerRows).toHaveLength(18);
    expect([...new Set(triggerRows.map((row) => row.tbl_name))].sort()).toStrictEqual(
      [...APPEND_ONLY_TABLES].sort(),
    );
    const triggerNames = triggerRows.map((row) => row.name);
    for (const table of APPEND_ONLY_TABLES) {
      expect(triggerNames).toContain(`trg_${table}_no_update`);
      expect(triggerNames).toContain(`trg_${table}_no_delete`);
    }

    // The tables 0011's indexes serve: every one of them is in place by the time that file is applied,
    // which is the ordering 0011 depends on. 0012 follows it, rebuilding four tables — ledger_entries
    // and refunds among them — recreating `idx_refunds_transaction_id` verbatim and creating
    // `idx_ledger_entries_ledger` on the discriminator alone, the single-key form the three operator
    // ledger reads are served by.
    const tableNames = schemaObjectNames(database, "table");
    for (const table of INDEXED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });

  it("is idempotent: a second run applies nothing and adds no row", () => {
    const database = newDatabase();
    const first = runMigrations(database);
    expect(first.appliedCount).toBe(13);

    const second = runMigrations(database);

    expect(second.appliedCount).toBe(0);
    expect(second.appliedFiles).toStrictEqual([]);
    expect(second.highestVersion).toBe(13);
    expect(recordedRowCount(database)).toBe(13);
    expect(database.pragma("user_version", { simple: true })).toBe(13);
  });

  it("sets PRAGMA user_version to the highest applied version and never reads it as state", () => {
    const database = newDatabase();

    const first = runMigrations(database);

    expect(first.highestVersion).toBe(13);
    expect(database.pragma("user_version", { simple: true })).toBe(first.highestVersion);
    // Set on the connection outside any transaction, and the run leaves none open behind it.
    expect(database.inTransaction).toBe(false);

    // A single integer cannot hold a checksum, and nothing consults it: with the marker zeroed the
    // next run still reports nothing applied, because what was applied was read from the
    // `schema_migrations` rows and their checksums were compared against the files.
    database.pragma("user_version = 0");

    const second = runMigrations(database);

    expect(second).toStrictEqual({ appliedFiles: [], appliedCount: 0, highestVersion: 13 });
    expect(database.pragma("user_version", { simple: true })).toBe(13);
    expect(recordedRowCount(database)).toBe(13);
  });
});

describe("runMigrations against a tampered history", () => {
  it("refuses when an applied file's recorded checksum no longer matches its bytes", () => {
    const database = migratedThenTampered((handle) => {
      handle
        .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
        .run("0".repeat(64));
    });

    const message = expectRefusalBeforeApplying(database);

    // Observed wording: `apps/api: runMigrations: version 0001 (0001_accounts_and_categories.sql) has
    // changed since it was applied, so the file no longer hashes to the checksum recorded in
    // schema_migrations. An applied migration file is immutable: ...`
    expect(message).toContain("version 0001");
    expect(message).toContain("0001_accounts_and_categories.sql");
    expect(message).toContain("has changed since it was applied");
  });

  it("refuses when the file at a recorded version has been renamed", () => {
    const database = migratedThenTampered((handle) => {
      handle
        .prepare("UPDATE schema_migrations SET name = ? WHERE version = 1")
        .run("0001_renamed.sql");
    });

    const message = expectRefusalBeforeApplying(database);

    // Observed wording: `apps/api: runMigrations: version 0001 was applied as "0001_renamed.sql" and
    // the file at that version is now named "0001_accounts_and_categories.sql" (<path>). An applied
    // migration file is immutable: renaming one leaves the recorded state it produced
    // unattributable. ...`
    expect(message).toContain('version 0001 was applied as "0001_renamed.sql"');
    expect(message).toContain('is now named "0001_accounts_and_categories.sql"');
  });

  it("refuses when the record carries a version no file serves, which is what a removed file leaves", () => {
    const database = migratedThenTampered((handle) => {
      handle
        .prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(9999, "9999_nothing.sql", "f".repeat(64), "2024-03-19T09:00:00.000Z");
    });

    const message = expectRefusalBeforeApplying(database);

    // Observed wording: `apps/api: runMigrations: version 9999 was applied as "9999_nothing.sql" and
    // no migration file carries that version. An applied migration file is immutable: a removed or
    // renumbered file cannot be reconciled with the state it recorded. ...`
    expect(message).toContain("version 9999");
    expect(message).toContain('"9999_nothing.sql"');
    expect(message).toContain("no migration file carries that version");
  });

  it("refuses before the first pending file is applied, with a pending file behind the refusal", () => {
    const database = migratedThenTampered((handle) => {
      handle
        .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
        .run("0".repeat(64));
      // The refusal above is staged while a file is pending as well: deleting the version-11 row leaves
      // `0011_indexes.sql` pending, and applying it would collide with the indexes the first run
      // created. A run that applied the pending file before verifying the recorded history would
      // therefore fail with the driver's own "already exists" rather than with the refusal asserted
      // here, which is what makes this case evidence for "refuses before the first pending file is
      // applied" rather than for the refusal alone.
      handle.prepare("DELETE FROM schema_migrations WHERE version = ?").run(11);
    });

    const rowsBefore = recordedRowCount(database);
    const tablesBefore = schemaObjectNames(database, "table");
    const refusal = thrownBy(() => runMigrations(database));

    expect(refusal).toBeInstanceOf(Error);
    const message = (refusal as Error).message;
    expect(message).toContain("version 0001");
    expect(message).toContain("has changed since it was applied");
    expect(message).not.toContain("already exists");
    expect(recordedRowCount(database)).toBe(rowsBefore);
    expect(schemaObjectNames(database, "table")).toStrictEqual(tablesBefore);
    expect(recordedMigrations(database).map((row) => row.version)).not.toContain(11);
  });
});

describe("runMigrations when a pending file fails", () => {
  it("rolls its statements and its recording row back together", () => {
    const database = newDatabase();
    runMigrations(database);

    // `0011_indexes.sql` creates its ten indexes in file order and carries no `IF NOT EXISTS`:
    // `idx_listings_status` at line 20 and `idx_listings_category_id` at line 25 come first, then
    // `idx_listings_pricing_model` at line 26. Deleting the version-11 row and dropping those two
    // earliest indexes leaves exactly the state a re-run has to reconcile — 0011 is pending again,
    // its first two statements apply, and its third collides with the index still in place.
    database.prepare("DELETE FROM schema_migrations WHERE version = ?").run(11);
    database.exec("DROP INDEX idx_listings_status");
    database.exec("DROP INDEX idx_listings_category_id");

    const rowsBefore = recordedRowCount(database);
    const refusal = thrownBy(() => runMigrations(database));

    expect(refusal).toBeInstanceOf(Error);
    // Observed wording from the driver: "index idx_listings_pricing_model already exists".
    expect((refusal as Error).message).toContain("idx_listings_pricing_model");

    // The rollback: the two statements the failed file did execute are gone again, the later index
    // the collision came from is untouched, and no version-11 row was recorded — so the migration did
    // not fail halfway into the schema.
    const indexNames = schemaObjectNames(database, "index");
    expect(indexNames).not.toContain("idx_listings_status");
    expect(indexNames).not.toContain("idx_listings_category_id");
    expect(indexNames).toContain("idx_listings_pricing_model");
    expect(recordedRowCount(database)).toBe(rowsBefore);
    expect(recordedMigrations(database).map((row) => row.version)).not.toContain(11);
    expect(database.inTransaction).toBe(false);
  });
});
