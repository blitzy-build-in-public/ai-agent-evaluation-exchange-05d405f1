/**
 * The ordered, checksum-guarded migration runner: the one path by which the schema in
 * `packages/shared/migrations/` reaches a database.
 *
 * SQLite keeps no migration state of its own, so this module owns two things and nothing else. It
 * creates `schema_migrations` before it applies anything — no migration file creates or references
 * that table, and none may — and it records one row per applied file: the file's numeric version,
 * its name, and the SHA-256 checksum of its bytes. That table is authoritative for both the applied
 * state and the checksum comparison. `PRAGMA user_version` is set as well, at the end of a
 * successful run, to the highest applied version; it is only a cheap integer marker for tooling and
 * for a human reading the database file, and it holds neither the record of which files were
 * applied nor a checksum, a single integer being unable to hold either.
 *
 * An applied migration file is immutable, and the runner holds that rather than assuming it. Before
 * it applies anything it compares every recorded row against its file and refuses the whole run when
 * a file's bytes hash to a different checksum, when the file at a recorded version has been renamed,
 * or when no file carries a recorded version any more. Refusing before the first pending file is
 * applied is the point: a tampered history stops the run instead of having new migrations layered on
 * top of it, and the runner never repairs, renumbers, deletes or rewrites what it found. Changing
 * the schema means adding a new numbered file.
 *
 * Each pending file is applied inside its own `db.transaction(...)`, together with the row that
 * records it, so a file whose SQL fails rolls back completely — its statements and its row alike —
 * and a failed migration never looks applied. A migration file must therefore not open or commit a
 * transaction of its own: the runner already wraps each file in one, and a `BEGIN`/`COMMIT` inside a
 * file would nest unpredictably.
 *
 * A run is idempotent. A version already recorded is neither re-applied nor re-inserted, so a second
 * run over one database is a silent no-op reporting `appliedCount: 0`, which is what lets the seed
 * entry point, the server and the integration harness all migrate a handle that a caller may already
 * have migrated.
 *
 * Rows go into `schema_migrations` and nowhere else. The runner writes none of the nine append-only
 * tables that `packages/shared/migrations/0010_append_only_triggers.sql` guards — `standard_versions`,
 * `evaluation_reports`, `report_case_results`, `governance_events`, `ledger_entries`, `transactions`,
 * `refunds`, `audit_events` and `listing_versions` — and it applies the eighteen triggers that guard
 * them as the last-but-one file. Those triggers are defence in depth behind the rule that no route
 * mutates an append-only resource, and never a security boundary: a connection holding write access
 * can drop one. `schema_migrations` is not one of the nine, so this module writes it.
 *
 * The migrations directory is resolved from this module's own URL rather than from the working
 * directory, so a run started from anywhere over this checkout finds the same files. The database
 * handle belongs to the caller (ports and adapters): this module opens no connection, closes no
 * handle it was given, reads no environment variable and resolves no path from the process state —
 * the one clock its caller may supply being the whole of what it reads beyond the files and the
 * handle.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The handle's type is imported by name, not by default: `@types/better-sqlite3` declares the
// instance shape as a member of the namespace its `export =` also exports, so a default *type*
// import of that package resolves to the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";

/**
 * The migrations directory, resolved from this module rather than from `process.cwd()`.
 *
 * One `../` per directory between this file and the repository root: `apps/api/src/db/` →
 * `apps/api/src/` → `apps/api/` → `apps/` → the root, where `packages/shared/migrations/` sits. The
 * integration suite and a run started from another directory both depend on that: resolving against
 * the working directory would find no migrations at all from outside the checkout's root, and would
 * report an empty directory rather than an error.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../packages/shared/migrations/", import.meta.url),
);

/**
 * The only file names this runner treats as migrations: four zero-padded digits, an underscore, a
 * lowercase description of words joined by underscores, and the `.sql` suffix.
 *
 * Anything else in the directory is ignored rather than refused — a note, an editor's backup, a
 * scratch file — so a stray file cannot stop a run. The pattern carries no `g` flag, so `test` and
 * `exec` against it are stateless. Zero-padding to four digits is what makes a plain lexicographic
 * sort of the matching names the numeric order the schema requires.
 */
const MIGRATION_FILE_NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/**
 * The DDL of the runner's own table. It belongs here and to no migration file: this statement runs
 * before the directory is scanned and before `0001` is applied, so the table an applied file is
 * recorded in exists before any file can be applied. `IF NOT EXISTS` makes a second run harmless.
 */
const CREATE_SCHEMA_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  checksum   TEXT    NOT NULL,
  applied_at TEXT    NOT NULL
)`;

/**
 * The one statement that records an applied file: an explicit column list, one placeholder per
 * column, and no value concatenated into the text. The four values are bound positionally in exactly
 * this order.
 *
 * A plain `INSERT`, deliberately: `INSERT OR REPLACE` is absent because SQLite documents its replace
 * path as bypassing a `DELETE` trigger, and a recorded migration is never replaced — a version is
 * applied once and the row that says so stands.
 */
const INSERT_MIGRATION_SQL = `INSERT INTO schema_migrations (version, name, checksum, applied_at)
VALUES (?, ?, ?, ?)`;

/** The one read of the applied state: every recorded row, in no particular order. */
const SELECT_APPLIED_SQL = "SELECT version, name, checksum FROM schema_migrations";

/**
 * What {@link runMigrations} did, for a caller that reports it.
 *
 * `run-seed.ts` and the server's entry point log a summary from this; the integration harness
 * ignores it. It is deliberately small and named rather than an inline object type, because it is
 * this module's whole public surface beside the function that returns it.
 */
export interface MigrationRun {
  /** File names applied in this run, in order. Empty when the database was already up to date. */
  readonly appliedFiles: readonly string[];
  /** How many files this run applied. */
  readonly appliedCount: number;
  /** Highest applied version recorded after the run; 0 when no migration exists. */
  readonly highestVersion: number;
}

/**
 * One migration file as the runner sees it: its version, its name, where it was read from, the
 * checksum of its bytes, and its SQL.
 *
 * The bytes are read once and reach the checksum undecoded, so the recorded checksum is the hash of
 * exactly what the file holds; `sql` is that same buffer decoded for the only purpose a migration
 * has, being executed.
 */
interface MigrationFile {
  /** The version parsed from the file name's four leading digits, without leading zeros. */
  readonly version: number;
  /** The file's name, as recorded in `schema_migrations.name` and as returned to the caller. */
  readonly name: string;
  /** Absolute path the file was read from, used only in a refusal message. */
  readonly path: string;
  /** SHA-256 of the file's bytes, as a lowercase hexadecimal string. */
  readonly checksum: string;
  /** The file's text, decoded from those same bytes, ready for `db.exec`. */
  readonly sql: string;
}

/**
 * One row of `schema_migrations`, as read back.
 *
 * `applied_at` is deliberately not read: nothing in the runner's decision depends on when a file was
 * applied, and the value a run generates is written, never compared.
 */
interface RecordedMigration {
  /** The version the row records. */
  readonly version: number;
  /** The file name the row records, compared against the file at that version. */
  readonly name: string;
  /** The checksum the row records, compared against the file's own bytes. */
  readonly checksum: string;
}

/**
 * The clock {@link runMigrations} uses when its caller supplies none: an ISO-8601 UTC instant with
 * milliseconds and a trailing `Z`.
 *
 * Not SQLite's `CURRENT_TIMESTAMP`, whose `YYYY-MM-DD HH:MM:SS` form is not the string every other
 * table in this schema stores and is not what a caller supplying a fixed instant supplies either.
 */
const defaultNow = (): string => new Date().toISOString();

/**
 * Creates `schema_migrations` when it does not exist, and does nothing when it does.
 *
 * @param db - The caller's database handle.
 */
function createSchemaMigrationsTable(db: Database): void {
  db.exec(CREATE_SCHEMA_MIGRATIONS_SQL);
}

/**
 * Reads the migration files from {@link MIGRATIONS_DIR} and orders them.
 *
 * Names that do not match {@link MIGRATION_FILE_NAME} are ignored, so a stray file in the directory
 * is neither applied nor an error. Matching names are sorted lexicographically, which the four
 * zero-padded digits make the numeric order. Each file is read once as bytes; the checksum is taken
 * from those bytes undecoded and the SQL from the same bytes decoded.
 *
 * @returns The matching migration files, ascending by version, each carrying its checksum and SQL.
 * @throws {Error} When the directory cannot be read, when a file's leading digits do not parse as a
 * version, when two files claim one version, or when a matching file cannot be read.
 */
function discoverMigrationFiles(): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (error) {
    throw new Error(
      `apps/api: runMigrations: the migrations directory could not be read at ${MIGRATIONS_DIR}. ` +
        "The schema is applied from the SQL files this directory holds, so a run cannot proceed " +
        "without it; check that the checkout still carries packages/shared/migrations/.",
      { cause: error },
    );
  }

  const matches = entries.filter((name) => MIGRATION_FILE_NAME.test(name)).sort();

  const files: MigrationFile[] = [];
  const claimed = new Map<number, string>();

  for (const name of matches) {
    // `noUncheckedIndexedAccess` makes every capture `string | undefined`, so the group is narrowed
    // before it is parsed rather than asserted.
    const digits = MIGRATION_FILE_NAME.exec(name)?.[1];
    if (digits === undefined) {
      throw new Error(
        `apps/api: runMigrations: the migration file name "${name}" does not yield a version, so ` +
          "the order it belongs in cannot be determined. A migration file is named NNNN_description.sql.",
      );
    }

    const version = Number.parseInt(digits, 10);
    if (!Number.isInteger(version)) {
      throw new Error(
        `apps/api: runMigrations: the digits "${digits}" of the migration file name "${name}" do ` +
          "not parse as a version, so the file cannot be ordered against the others.",
      );
    }

    // Two names carrying one version would be two files claiming one slot in the order, and the
    // runner could not say which of them a recorded row belonged to.
    const previous = claimed.get(version);
    if (previous !== undefined) {
      throw new Error(
        `apps/api: runMigrations: the migration files "${previous}" and "${name}" both claim ` +
          `version ${formatVersion(version)}. One version names one file, so neither can be applied.`,
      );
    }
    claimed.set(version, name);

    const path = join(MIGRATIONS_DIR, name);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      throw new Error(
        `apps/api: runMigrations: the migration file "${name}" could not be read at ${path}.`,
        { cause: error },
      );
    }

    files.push({
      version,
      name,
      path,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      sql: bytes.toString("utf8"),
    });
  }

  return files;
}

/**
 * Reads every row of `schema_migrations`, keyed by version.
 *
 * @param db - The caller's database handle, whose `schema_migrations` table already exists.
 * @returns One entry per applied version.
 */
function readRecordedMigrations(db: Database): Map<number, RecordedMigration> {
  const rows = db.prepare<[], RecordedMigration>(SELECT_APPLIED_SQL).all();

  const recorded = new Map<number, RecordedMigration>();
  for (const row of rows) {
    recorded.set(row.version, {
      version: row.version,
      name: row.name,
      checksum: row.checksum,
    });
  }

  return recorded;
}

/**
 * Compares every recorded row against its file, before anything is applied.
 *
 * @param recorded - The applied state, keyed by version.
 * @param files - The migration files as discovered, which are the candidate counterpart of each row.
 * @throws {Error} When a recorded version has no file, when the file at a recorded version is named
 * otherwise than the row records, or when that file's bytes hash to a different checksum. Each
 * refusal names the version and the file, and states that an applied migration file is immutable.
 */
function verifyRecordedMigrations(
  recorded: ReadonlyMap<number, RecordedMigration>,
  files: readonly MigrationFile[],
): void {
  const filesByVersion = new Map<number, MigrationFile>();
  for (const file of files) {
    filesByVersion.set(file.version, file);
  }

  for (const row of recorded.values()) {
    const file = filesByVersion.get(row.version);

    if (file === undefined) {
      throw new Error(
        `apps/api: runMigrations: version ${formatVersion(row.version)} was applied as ` +
          `"${row.name}" and no migration file carries that version. An applied migration file is ` +
          "immutable: a removed or renumbered file cannot be reconciled with the state it recorded. " +
          "Changing the schema means adding a new numbered file and restoring this one.",
      );
    }

    if (file.name !== row.name) {
      throw new Error(
        `apps/api: runMigrations: version ${formatVersion(row.version)} was applied as ` +
          `"${row.name}" and the file at that version is now named "${file.name}" (${file.path}). ` +
          "An applied migration file is immutable: renaming one leaves the recorded state it produced " +
          "unattributable. Changing the schema means adding a new numbered file.",
      );
    }

    if (file.checksum !== row.checksum) {
      throw new Error(
        `apps/api: runMigrations: version ${formatVersion(row.version)} (${file.name}) has changed ` +
          "since it was applied, so the file no longer hashes to the checksum recorded in " +
          "schema_migrations. An applied migration file is immutable: restoring the file, or " +
          "changing the schema through a new numbered file, is the only way forward.",
      );
    }
  }
}

/**
 * The highest recorded version, or `0` when nothing is recorded.
 *
 * @param recorded - The applied state, keyed by version.
 * @returns The greatest recorded version.
 */
function highestRecordedVersion(recorded: ReadonlyMap<number, RecordedMigration>): number {
  let highest = 0;
  for (const version of recorded.keys()) {
    if (version > highest) {
      highest = version;
    }
  }
  return highest;
}

/**
 * Sets `PRAGMA user_version` to an applied version, outside any transaction.
 *
 * The value is the only thing interpolated into the statement, and only after it has been checked to
 * be a non-negative integer, so no other value can reach the pragma's text.
 *
 * @param db - The caller's database handle.
 * @param version - The highest applied version.
 * @throws {Error} When `version` is not a non-negative integer.
 */
function setUserVersion(db: Database, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(
      `apps/api: runMigrations: refusing to set PRAGMA user_version to ${String(version)}, which ` +
        "is not a non-negative integer.",
    );
  }

  db.pragma(`user_version = ${version}`);
}

/**
 * The four-digit form of a version, as a file name spells it, for a refusal message.
 *
 * @param version - The version to spell.
 * @returns The version padded to four digits.
 */
function formatVersion(version: number): string {
  return version.toString().padStart(4, "0");
}

/**
 * Applies every pending migration in order and returns what it did.
 *
 * Returns a {@link MigrationRun}. Refuses (throws) when an applied migration's file has changed, has
 * been renamed, or has disappeared, when the migrations directory is unreadable, when a file name
 * does not match `NNNN_description.sql`, or when a file's SQL fails — in which case that file's
 * transaction, including its `schema_migrations` row, is rolled back completely.
 *
 * The order is the files' own: `schema_migrations` is created, the directory is read and ordered,
 * every recorded row is verified against its file, and only then is each pending file applied inside
 * its own transaction together with the row that records it. A version already recorded is skipped,
 * so a second run over one database applies nothing and reports `appliedCount: 0`. After every
 * transaction has committed the highest recorded version is set as `PRAGMA user_version`, outside
 * any transaction.
 *
 * A migration file must not open or commit a transaction of its own: each file is wrapped in one
 * here, and a `BEGIN`/`COMMIT` inside a file would nest unpredictably.
 *
 * @param db - The caller's database handle. It is used as given and never closed here.
 * @param options - The optional clock, defaulting to the system clock. It supplies the `applied_at`
 * instant recorded with each file applied in this run and is consulted once per applied file.
 * @returns What this run applied, and the highest applied version recorded once it finished.
 * @throws {Error} When the migrations directory or a migration file cannot be read, when a file name
 * yields no version or two files claim one version, when an applied file has changed, been renamed or
 * disappeared, or when a file's SQL fails — the last of these rolling that file's transaction back.
 */
export function runMigrations(
  db: Database,
  options?: { readonly now?: () => string },
): MigrationRun {
  const now = options?.now ?? defaultNow;

  // Before the directory is scanned and before anything is applied: the table an applied file is
  // recorded in has to exist first, which is also why no migration file may create it.
  createSchemaMigrationsTable(db);

  const files = discoverMigrationFiles();
  const recorded = readRecordedMigrations(db);

  // Verification precedes application, so a tampered history refuses the run rather than having new
  // migrations layered on top of it.
  verifyRecordedMigrations(recorded, files);

  const insertApplied = db.prepare<[number, string, string, string]>(INSERT_MIGRATION_SQL);

  // One wrapper, called once per pending file: each call opens its own transaction, which is what
  // makes a file's statements and its recording row indivisible.
  const applyOne = db.transaction((migration: MigrationFile): void => {
    db.exec(migration.sql);
    insertApplied.run(migration.version, migration.name, migration.checksum, now());
  });

  const appliedFiles: string[] = [];

  for (const file of files) {
    if (recorded.has(file.version)) {
      continue;
    }

    applyOne(file);

    // Reached only once the transaction has committed: a file whose SQL threw rolled back its row
    // with it, and is not reported as applied.
    recorded.set(file.version, {
      version: file.version,
      name: file.name,
      checksum: file.checksum,
    });
    appliedFiles.push(file.name);
  }

  const highestVersion = highestRecordedVersion(recorded);
  setUserVersion(db, highestVersion);

  return {
    appliedFiles,
    appliedCount: appliedFiles.length,
    highestVersion,
  };
}
