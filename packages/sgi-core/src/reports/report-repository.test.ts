/**
 * The beside-source unit test of `./report-repository`: what `insertReport` appends, what `getReport`
 * reads back, what `findLatestReportId` answers, and the two guards that make the store append-only.
 *
 * Every case runs against a real SQLite database built from the ordered migration files in
 * `packages/shared/migrations/`, because most of what is asserted here is a property of the delivered
 * schema rather than of a function alone: the eleven columns a report fills, the `UNIQUE (report_id,
 * case_id)` pair that makes the evidence set exact, the `CHECK`s a row has to satisfy before it can be
 * stored at all, the foreign key that resolves a cited standard version to its row, and the abort
 * triggers that make a stored report unrewritable. No table is created by hand, so a column the
 * migrations do not declare fails this suite loudly instead of being papered over by a fixture that
 * agrees with the module.
 *
 * **The connection enforces foreign keys, and the rows that key requires are planted as data.**
 * `better-sqlite3` enables `PRAGMA foreign_keys` by default and `apps/api/src/db/connection.ts` turns
 * it on for every server connection, so this suite turns it on too and stores its reports under the
 * constraints the server runs with. `evaluation_reports.candidate_version_id` references
 * `listing_versions`, a table `./report-repository` never reads and never writes, so the fixture
 * plants the four rows that foreign-key chain needs — an account, a category, a listing and one
 * version of it — as synthetic rows belonging to `apps/api`. What the module does with them is
 * unchanged, and that is asserted twice below: it prepares no statement naming any of those tables
 * (by recording the SQL it prepares, the way `../appeals/open-appeal.test.ts` records the SQL it
 * does not prepare), and every planted row is compared byte for byte after the writes. Together they
 * are the evidence that ownership resolution, and the `is_fixture_candidate` flag behind a report's
 * label, belong to `apps/api` and are merely handed in.
 *
 * **What enforcing the key buys.** A report citing the version label `SGI-SO-1.0.0` where the
 * `standard_versions` row identifier belongs is refused by the insert itself rather than stored and
 * then lost by the join on the read, so the resolution `insertReport` performs is observable at the
 * unit level and not merely on the server.
 *
 * **The UPDATE and the DELETE below are issued by the test on purpose.** They are the statements the
 * append-only triggers must abort, and `./report-repository` contains neither: the module appends
 * with a plain `INSERT`, which is exactly what this suite pins.
 *
 * **The evidence is hand-built data.** The records are built by the shipped report builder over a
 * hand-built scored submission rather than read from the fixture pack, so the case ids sit in a
 * deliberately non-ascending order, the canonical strings can carry the shapes a real case set has no
 * reason to offer — a trailing space inside a string value, keys that are not in sorted order, a
 * mismatch whose actual text is well-formed — and the case that proves the stored order is the
 * caller's order rather than a sorted one can exist at all. Nothing here loads the fixture package
 * (`@adem/sgi-fixtures`), which is asserted below rather than promised: the repository appends what
 * it is handed, and a document of fixtures would hide which order the evidence arrived in.
 *
 * Applying the migration files is this package's only filesystem access, and it belongs in a test
 * module: the runner lives in `apps/api/src/db/migrate.ts`, which this package may not import, the
 * unit suite starts no server and opens no database file, and `packages/shared/migrations` owns the
 * schema, so this package declares no DDL of its own. Paths resolve from this module's own location
 * rather than from the working directory. Nothing here reads a clock — every instant is a literal —
 * and the identifiers are readable names rather than the random ones a production writer generates.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CaseSeverity, ReportLabel } from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CaseResult, ScoredSubmission } from "../scoring/score-submission";
import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";
import {
  StandardDriftError,
  UnknownStandardError,
  getStandardVersion,
  registerStandardVersion,
} from "../standards/standard-registry";
import type { StandardVersionRecord } from "../standards/standard-registry";
import { buildReport } from "./build-report";
import type { ReportRecord } from "./build-report";
import { findLatestReportId, getReport, insertReport } from "./report-repository";
import type { StoredReport } from "./report-repository";

/**
 * The delivered migrations, resolved from this module's own location rather than from the working
 * directory, so the schema under test is the one the repository ships wherever the run was started.
 */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

/** The name form every migration file carries: a four-digit version, then its description. */
const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * The number of ordered migration files the suite insists on finding before it will run.
 *
 * It is a floor rather than an equality: the repository appends a numbered file per schema change,
 * and a suite that failed on a legitimate addition would be a tripwire rather than a guard. What the
 * case below checks in full is that the versions present ascend from `0001` with no gap and no
 * repeat, which is what makes a deleted or renumbered file fail the run instead of quietly leaving a
 * table out of the database every other case is written against.
 */
const MINIMUM_SHIPPED_MIGRATIONS = 11;

/** The one provisional standard version, and the label every report below cites. */
const STANDARD_VERSION_LABEL = SGI_SO_1_0_0.versionLabel;

/** A standard version label this release publishes no version of. */
const UNPUBLISHED_STANDARD_VERSION_LABEL = "SGI-SO-9.9.9";

/**
 * The candidate version a report measures, as `apps/api` would resolve it and hand it in.
 *
 * It names the `listing_versions` row the fixture plants, because `evaluation_reports` references
 * that table: the identifier is the API layer's answer, and the report stores it as given.
 */
const CANDIDATE_VERSION_ID = "candidate-version-unit-alpha";

/** A second candidate version, for the cases that assert a report is found per version. */
const OTHER_CANDIDATE_VERSION_ID = "candidate-version-unit-beta";

/**
 * The `accounts.id` the fixture plants, and the account the shipped standard version is published
 * under.
 *
 * `governance_events.actor_account_id` is `NOT NULL REFERENCES accounts (id)`, and this suite runs
 * under the enforced pragma, so the publication this fixture performs names the row planted below
 * rather than adding a second one.
 */
const UNIT_DEVELOPER_ACCOUNT_ID = "account-unit-developer";

/** The identifier of the first pinned report. */
const FIRST_REPORT_ID = "report-unit-first";

/** The identifier of the pinned retest report. */
const RETEST_REPORT_ID = "report-unit-retest";

/** An identifier no `evaluation_reports` row carries. */
const UNKNOWN_REPORT_ID = "report-unit-never-written";

/** The instant the first pinned report states. */
const FIRST_INSTANT = "2024-07-01T00:00:00.000Z";

/** A later instant, for the case that asserts the newest report wins on `created_at`. */
const LATER_INSTANT = "2024-07-02T00:00:00.000Z";

/**
 * The four fixture cases of the hand-built evidence, in the order the scorer would return them.
 *
 * Case-set order, deliberately **not** ascending by case id, so the evidence a report stores is the
 * order it was handed rather than one sorted into it. The order is what assertion two of `insertReport`
 * rests on, which is why the case that asserts it also asserts that this order is not its own sorted
 * form: a later tidy-up of these four constants would otherwise weaken the case silently.
 */
const CRITICAL_CASE_ID = "so-003";
const PLAIN_CASE_ID = "so-001";
const PADDED_CASE_ID = "so-012";
const MISMATCHING_CASE_ID = "so-017";

/** The same four case ids as one value, in the order the report states them. */
const CASE_IDS_IN_SET_ORDER = [
  CRITICAL_CASE_ID,
  PLAIN_CASE_ID,
  PADDED_CASE_ID,
  MISMATCHING_CASE_ID,
] as const;

/**
 * The expected output of {@link CRITICAL_CASE_ID}, as canonical JSON text, and the recording that
 * matches it. The severity is what makes a failure of this case fail the candidate outright.
 */
const ALLOW_RECORD_JSON = '{"decision":"allow","rule":"rules/allow-read"}';

/** The expected output of {@link PLAIN_CASE_ID}: an ordinary canonical text, matched by its recording. */
const ITEMS_JSON = '{"items":["alpha","beta"],"ok":true}';

/**
 * The expected output of {@link PADDED_CASE_ID}, whose one string value ends with a space **inside**
 * the quotes: the whitespace a canonical form keeps, because it is part of the value rather than
 * between tokens. It is the canary for a read that trimmed, re-serialised or re-canonicalised the
 * stored string, which would move the payload two runs of one submission compare.
 */
const PADDED_NOTE_JSON = '{"note":"padded ","status":"ok"}';

/**
 * The expected output of {@link MISMATCHING_CASE_ID}: canonical JSON text in every respect except its
 * key order, which is deliberately the reverse of canonical, and no case of the four is decided by a
 * stored match of `1` alone.
 */
const ALIGNED_JSON = '{"status":"aligned","attempt":1}';

/** The output the candidate recorded for that case: well-formed JSON that cannot equal it. */
const MISMATCHING_JSON = '{"attempt":2,"status":"aligned"}';

/** The twelve fields a stored report states, sorted, as the closed field-list assertion compares them. */
const STORED_REPORT_FIELD_NAMES = [
  "candidateVersionId",
  "caseResults",
  "createdAt",
  "criticalFailures",
  "label",
  "matchedCount",
  "outcome",
  "priorReportId",
  "reportId",
  "rubricReference",
  "standardVersionId",
  "totalCount",
] as const;

/** The five fields one case's evidence states, sorted, as the same assertion compares them. */
const EVIDENCE_FIELD_NAMES = ["actualJson", "caseId", "expectedJson", "match", "severity"] as const;

/**
 * The tables the report path must not read, each because it belongs to another owner or answers
 * another question: a listing and its versions are the API layer's, an account is the demo session's,
 * a category is browse metadata, and the sponsored slots and the audit feed are commercial and
 * write-log data no evaluation path may consult. A statement naming one of them would mean this
 * module had begun resolving which version it is writing about.
 */
const TABLES_THE_REPORT_PATH_MUST_NOT_READ = [
  "accounts",
  "categories",
  "listings",
  "listing_versions",
  "sponsored_slots",
  "audit_events",
] as const;

/**
 * A module specifier, as an import statement states it rather than as prose mentions it: `from` or a
 * dynamic `import(` or `require(` followed by the quoted name.
 *
 * The anchoring is what lets the case below read this file's own text: the check must fire on a real
 * import and not on a comment, a doc sentence or the pattern's own text. No comment in this file
 * writes the fixture package's name into an import-shaped phrase.
 */
const FIXTURE_PACKAGE_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']@adem\/sgi-fixtures["']/;


/**
 * The statement a report is written with, spelled here as migration `0006` declares the columns, and
 * used by the one case that proves the foreign key is enforced: it binds the version label where the
 * `standard_versions` row identifier belongs, which is the mistake `insertReport` resolves the label
 * to avoid. `./report-repository` itself never writes this statement.
 */
const RAW_REPORT_INSERT_SQL = `INSERT INTO evaluation_reports
  (id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
   critical_failures, label, rubric_reference, prior_report_id, created_at)
VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** The single column a `COUNT(*)` query returns. */
interface CountRow {
  /** How many rows the query counted. */
  readonly count: number;
}

/** One row naming a table, as `sqlite_master` reports it. */
interface TableNameRow {
  /** The table's name. */
  readonly name: string;
}

/** One `evaluation_reports` row, typed as migration `0006` declares its columns. */
interface RawReportRow {
  readonly id: string;
  readonly candidate_version_id: string;
  readonly standard_version_id: string;
  readonly outcome: string;
  readonly matched_count: number;
  readonly total_count: number;
  readonly critical_failures: number;
  readonly label: string;
  readonly rubric_reference: string;
  readonly prior_report_id: string | null;
  readonly created_at: string;
}

/** One `report_case_results` row, typed as the same migration declares its columns. */
interface RawCaseResultRow {
  readonly case_id: string;
  readonly severity: string;
  readonly expected_json: string;
  readonly actual_json: string;
  readonly match: number;
}

/** One `listing_versions` row, read whole so a change to any column of it is visible. */
interface RawListingVersionRow {
  readonly id: string;
  readonly listing_id: string;
  readonly version_string: string;
  readonly notes: string;
  readonly is_fixture_candidate: number;
  readonly created_at: string;
}

/**
 * The provenance values of a report that a caller states rather than derives: the two write-time
 * identity values a replay pins, the label the origin produced, and the retest link `apps/api`
 * derived from the reports it stores. Every member is required, so a case states all four and none
 * is left to a default.
 */
interface StatedReportValues {
  /** The report identifier to state. */
  readonly reportId: string;
  /** The ISO-8601 UTC creation instant to state. */
  readonly createdAt: string;
  /** `SAMPLE` or `VERIFIED-IN-DEMO`, from the evaluated version's origin. */
  readonly label: ReportLabel;
  /** The newest earlier report for the same candidate version and standard, or `null` if none. */
  readonly priorReportId: string | null;
}

let db: Database.Database;

/**
 * Every SQL source string the module under test prepared, in the order it prepared them.
 *
 * Filled by {@link installPrepareRecorder}, and the only way to assert the absence of a read: a
 * behavioural case shows what a call wrote, never which tables it touched on the way.
 */
let preparedStatements: string[] = [];

/** The ordered migration files, or a failure naming the file that is not one. */
function migrationFiles(): readonly string[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`the migrations directory ${migrationsDir} holds no .sql file to apply`);
  }
  for (const file of files) {
    if (!MIGRATION_FILE_PATTERN.test(file)) {
      throw new Error(
        `the migrations directory ${migrationsDir} holds "${file}", which is not named NNNN_description.sql`,
      );
    }
  }
  return files;
}

/** The four-digit version of a migration file name, as its ordering key. */
function migrationVersionOf(file: string): string {
  const match = MIGRATION_FILE_PATTERN.exec(file);
  const version = match?.[1];
  if (version === undefined) {
    throw new Error(`"${file}" carries no four-digit version, so the schema's order is unknown`);
  }
  return version;
}

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of migrationFiles()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/**
 * Publishes the shipped standard version through the registry and returns the row identifier it
 * produced, failing the case rather than a later assertion when the row cannot be read back: a report
 * cites that identifier, so a fixture whose standard is missing would fail every case for one reason.
 *
 * The publisher is the fixture's own demo account, which {@link insertForeignKeyParents} has to have
 * planted before this call: the publication appends a `standard_version_published` governance event
 * whose `actor_account_id` references `accounts`.
 */
function seedStandardVersion(database: Database.Database): string {
  const rowId = registerStandardVersion(database, SGI_SO_1_0_0, UNIT_DEVELOPER_ACCOUNT_ID);
  const published = getStandardVersion(database, STANDARD_VERSION_LABEL, STANDARD_VERSION_LABEL);
  if (published === null || published.id !== rowId) {
    throw new Error(
      `expected registerStandardVersion to publish ${STANDARD_VERSION_LABEL} as row ${rowId}`,
    );
  }
  return rowId;
}

/**
 * Plants the four synthetic rows the report's foreign-key chain requires, and nothing else.
 *
 * This is the whole of `apps/api`'s contribution to this suite's fixtures: one demo account, one
 * category, one listing and one version of it, none of which `./report-repository` reads or writes.
 * They exist because `evaluation_reports.candidate_version_id` references `listing_versions` and this
 * suite runs under the enforced pragma; the flag the seed sets on that version is planted as data the
 * module never consults, since the label a report carries arrives as an argument.
 */
function insertForeignKeyParents(database: Database.Database): void {
  database
    .prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)")
    .run(UNIT_DEVELOPER_ACCOUNT_ID, "unit-developer", "developer", "Synthetic demo developer");
  database
    .prepare("INSERT INTO categories (id, slug, name) VALUES (?, ?, ?)")
    .run("category-unit", "unit-category", "Synthetic category");
  database
    .prepare(
      `INSERT INTO listings
         (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "listing-unit",
      "account-unit-developer",
      "unit-listing",
      "Synthetic listing",
      "A synthetic listing this suite plants for the foreign keys a report carries.",
      "category-unit",
      "MIT",
      "purchase",
      FIRST_INSTANT,
      FIRST_INSTANT,
    );
  database
    .prepare(
      `INSERT INTO listing_versions
         (id, listing_id, version_string, notes, is_fixture_candidate, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(CANDIDATE_VERSION_ID, "listing-unit", "1.0.0", "Synthetic version", 1, FIRST_INSTANT);
}

/** A fresh in-memory database carrying the delivered schema, the shipped standard and the parent rows. */
function seededDatabase(): Database.Database {
  const database = new Database(":memory:");

  // Outside any transaction, as the server's own connection sets it: the pragma is a no-op inside
  // one, and a suite that turned it on there would silently run without it.
  database.pragma("foreign_keys = ON");

  applyMigrations(database);
  // The parent rows first: publishing the standard appends the publication's governance event, whose
  // actor references the account planted here, and the report the reader tests build references the
  // candidate version it plants.
  insertForeignKeyParents(database);
  seedStandardVersion(database);
  return database;
}

/** One hand-built case result, its verdict taken from the two canonical texts it carries. */
function caseResultOf(
  caseId: string,
  severity: CaseSeverity,
  expectedJson: string,
  actualJson: string,
): CaseResult {
  return { caseId, severity, expectedJson, actualJson, match: expectedJson === actualJson };
}

/**
 * The four hand-built case results, in {@link CASE_IDS_IN_SET_ORDER} order: three matches, one of
 * them the `critical` case, and one mismatch whose recorded output is well-formed JSON.
 */
function handBuiltCaseResults(): CaseResult[] {
  return [
    caseResultOf(CRITICAL_CASE_ID, "critical", ALLOW_RECORD_JSON, ALLOW_RECORD_JSON),
    caseResultOf(PLAIN_CASE_ID, "standard", ITEMS_JSON, ITEMS_JSON),
    caseResultOf(PADDED_CASE_ID, "standard", PADDED_NOTE_JSON, PADDED_NOTE_JSON),
    caseResultOf(MISMATCHING_CASE_ID, "standard", ALIGNED_JSON, MISMATCHING_JSON),
  ];
}

/**
 * The scored submission the reports below are built from: the shape
 * `../scoring/score-submission` declares, hand-built rather than read from a fixture pack, with the
 * totals counting its own evidence so no case states a pair its evidence contradicts.
 *
 * The outcome is stated rather than derived from a version's thresholds: this hand-built set is not
 * the twenty-case set of `SGI-SO-1.0.0`, and the pass rule the product applies belongs to the scorer.
 */
function handBuiltScoredSubmission(): ScoredSubmission {
  const caseResults = handBuiltCaseResults();
  return {
    standardVersionId: STANDARD_VERSION_LABEL,
    candidateVersionId: CANDIDATE_VERSION_ID,
    caseResults,
    matchedCount: caseResults.filter((caseResult) => caseResult.match).length,
    totalCount: caseResults.length,
    criticalFailures: caseResults.filter(
      (caseResult) => !caseResult.match && caseResult.severity === "critical",
    ).length,
    failingCaseIds: caseResults
      .filter((caseResult) => !caseResult.match)
      .map((caseResult) => caseResult.caseId),
    outcome: "FAIL",
  };
}

/**
 * One report record for the hand-built submission, with the four stated values the caller supplies.
 *
 * The pair of version identifiers is taken from the scored submission rather than restated, so the
 * record the builder produces and the submission it was scored from cannot disagree about what was
 * measured — the same reason `buildReport` takes them as one pair.
 */
function reportRecord(
  values: StatedReportValues,
  scored: ScoredSubmission = handBuiltScoredSubmission(),
): ReportRecord {
  return buildReport(scored, {
    candidateVersionId: scored.candidateVersionId,
    standardVersionId: scored.standardVersionId,
    label: values.label,
    priorReportId: values.priorReportId,
    reportId: values.reportId,
    createdAt: values.createdAt,
  });
}

/**
 * The first report for the pinned candidate version: both identity values pinned so a later read
 * compares against stated values, the label a seeded fixture candidate earns, and no retest link.
 */
function firstReportRecord(): ReportRecord {
  return reportRecord({
    reportId: FIRST_REPORT_ID,
    createdAt: FIRST_INSTANT,
    label: "SAMPLE",
    priorReportId: null,
  });
}

/** A retest of the same candidate version and standard, stated to follow `priorReportId`. */
function retestReportRecord(priorReportId: string | null, createdAt: string): ReportRecord {
  return reportRecord({
    reportId: RETEST_REPORT_ID,
    createdAt,
    label: "SAMPLE",
    priorReportId,
  });
}

/** The single number a literal count query returns. */
function scalarCount(sql: string): number {
  const row = db.prepare<[], CountRow>(sql).get();
  if (row === undefined) {
    throw new Error("expected a COUNT(*) row and got none");
  }
  return row.count;
}

/** Every table name the schema declares. */
function tableNames(): string[] {
  return db
    .prepare<[], TableNameRow>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC",
    )
    .all()
    .map((row) => row.name);
}

/** One stored `evaluation_reports` row, read without the module under test. */
function rawReportRow(id: string): RawReportRow {
  const row = db
    .prepare<[string], RawReportRow>(
      `SELECT id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
              critical_failures, label, rubric_reference, prior_report_id, created_at
         FROM evaluation_reports
        WHERE id = ?`,
    )
    .get(id);
  if (row === undefined) {
    throw new Error(`expected evaluation_reports to hold a row with id ${id}`);
  }
  return row;
}

/** Every stored `report_case_results` row of one report, in insertion order. */
function rawCaseResultRows(reportId: string): RawCaseResultRow[] {
  return db
    .prepare<[string], RawCaseResultRow>(
      `SELECT case_id, severity, expected_json, actual_json, match
         FROM report_case_results
        WHERE report_id = ?
        ORDER BY rowid ASC`,
    )
    .all(reportId);
}

/** The planted `listing_versions` row, whole, so a case can compare it before and after a write. */
function rawListingVersionRow(id: string): RawListingVersionRow {
  const row = db
    .prepare<[string], RawListingVersionRow>("SELECT * FROM listing_versions WHERE id = ?")
    .get(id);
  if (row === undefined) {
    throw new Error(`expected listing_versions to hold a row with id ${id}`);
  }
  return row;
}

/** The stored report a reader would fetch, failing the case rather than returning null. */
function storedOrFail(id: string): StoredReport {
  const stored = getReport(db, id);
  if (stored === null) {
    throw new Error(`expected a stored report for identifier ${id}`);
  }
  return stored;
}

/** The `standard_versions` row identifier the registry publishes for the one standard version. */
function publishedStandardVersionRowId(): string {
  const version = getStandardVersion(db, STANDARD_VERSION_LABEL, STANDARD_VERSION_LABEL);
  if (version === null) {
    throw new Error(`expected the fixture to publish standard version ${STANDARD_VERSION_LABEL}`);
  }
  return version.id;
}

/**
 * The version record a caller resolves once and hands to the writers, which is what `apps/api`'s
 * evaluation route does: the record it resolved for a submission rather than the label again.
 */
function resolvedStandardVersion(): StandardVersionRecord {
  const version = getStandardVersion(db, STANDARD_VERSION_LABEL, STANDARD_VERSION_LABEL);
  if (version === null) {
    throw new Error(`expected the fixture to publish standard version ${STANDARD_VERSION_LABEL}`);
  }
  return version;
}

/** Reads a refusal out of a call that must fail, so its class and its fields can be asserted. */
function captureRefusal(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("the call was expected to refuse, and returned instead");
}

/**
 * Records the SQL source of every statement prepared through `db` from this point on.
 *
 * `prepare` is captured from the instance and replaced with an own property that delegates, rather
 * than spied on through the prototype: better-sqlite3 declares `prepare` on `Database.prototype`,
 * where a spy does not reliably attach. Install this after the migrations and the fixture — in a test
 * body, not in `beforeEach` — so the record holds what the module under test prepared and nothing
 * else; the statements the module prepares inside its own transaction go through the same instance,
 * which is what makes the record complete.
 */
function installPrepareRecorder(): void {
  const original = db.prepare.bind(db) as unknown as (source: string) => unknown;

  preparedStatements = [];
  (db as unknown as { prepare: (source: string) => unknown }).prepare = (source: string) => {
    preparedStatements.push(source);
    return original(source);
  };
}

/** The text of one file beside this one, read from disk. */
function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

beforeEach(() => {
  db = seededDatabase();
});

afterEach(() => {
  db.close();
});

describe("the schema the statements are written against", () => {
  it("applies the ordered migration files the repository ships, with no version missing", () => {
    const files = migrationFiles();
    const versions = files.map(migrationVersionOf);

    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_SHIPPED_MIGRATIONS);
    // A gap, a repeat or a file written out of order fails here rather than leaving a table out of
    // the database every other case is written against.
    expect(versions).toStrictEqual(versions.map((_, index) => String(index + 1).padStart(4, "0")));
  });

  it("declares the tables this module reads and writes, empty, with the standard version published", () => {
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        "evaluation_reports",
        "report_case_results",
        "standard_versions",
        "listing_versions",
      ]),
    );
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(0);
    // Exactly one version is published under the one label every report below cites, so the label
    // resolves to a single row.
    expect(scalarCount("SELECT COUNT(*) AS count FROM standard_versions")).toBe(1);
    // The row the report's candidate identifier references is in place, which is the only reason the
    // fixture plants it.
    expect(rawListingVersionRow(CANDIDATE_VERSION_ID).id).toBe(CANDIDATE_VERSION_ID);
  });
});

describe("insertReport", () => {
  it("appends the report row and one evidence row per case, in the order it was handed", () => {
    const record = firstReportRecord();
    insertReport(db, record);

    expect(record.caseResults.map((caseResult) => caseResult.caseId)).toStrictEqual([
      ...CASE_IDS_IN_SET_ORDER,
    ]);
    // The order is what this case rests on: the four ids are deliberately not ascending, so a
    // statement that sorted them, and a reader that ordered by anything but insertion order, both
    // fail here rather than passing by accident of an alphabetical fixture.
    expect([...CASE_IDS_IN_SET_ORDER]).not.toStrictEqual([...CASE_IDS_IN_SET_ORDER].sort());

    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(1);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(
      record.caseResults.length,
    );

    const storedEvidence = rawCaseResultRows(record.reportId);
    expect(storedEvidence.map((row) => row.case_id)).toStrictEqual([...CASE_IDS_IN_SET_ORDER]);
    expect(storedEvidence.map((row) => row.severity)).toStrictEqual([
      "critical",
      "standard",
      "standard",
      "standard",
    ]);
    // The two canonical texts are stored as the comparison produced them, and the verdict is the
    // table's own 0 or 1: the failing case of the four is the only zero.
    expect(storedEvidence.map((row) => row.expected_json)).toStrictEqual(
      record.caseResults.map((caseResult) => caseResult.expectedJson),
    );
    expect(storedEvidence.map((row) => row.actual_json)).toStrictEqual(
      record.caseResults.map((caseResult) => caseResult.actualJson),
    );
    expect(storedEvidence.map((row) => row.match)).toStrictEqual([1, 1, 1, 0]);
  });

  it("stores the standard version's row identifier while the read hands the label back", () => {
    const record = firstReportRecord();
    insertReport(db, record);

    const storedRow = rawReportRow(record.reportId);
    expect(storedRow.standard_version_id).toBe(publishedStandardVersionRowId());
    expect(storedRow.standard_version_id).not.toBe(STANDARD_VERSION_LABEL);
    expect(storedOrFail(record.reportId).standardVersionId).toBe(STANDARD_VERSION_LABEL);
  });

  it("cannot store the label where the row identifier belongs, which is why the label is resolved", () => {
    const record = firstReportRecord();

    // The failure a module that stored the label directly would meet on this schema, and the reason
    // the read's join has a row to find at all. The foreign key refuses the statement rather than
    // storing a report whose criteria no read of the contract's shape could resolve.
    expect(() =>
      db
        .prepare(RAW_REPORT_INSERT_SQL)
        .run(
          "report-unit-written-with-a-label",
          CANDIDATE_VERSION_ID,
          STANDARD_VERSION_LABEL,
          record.outcome,
          record.matchedCount,
          record.totalCount,
          record.criticalFailures,
          record.label,
          record.rubricReference,
          null,
          record.createdAt,
        ),
    ).toThrow(/FOREIGN KEY constraint failed/);

    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
  });

  it("refuses an unpublished standard version before any row is written", () => {
    insertReport(db, firstReportRecord());
    const reportsBefore = scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports");
    const evidenceBefore = scalarCount("SELECT COUNT(*) AS count FROM report_case_results");

    const refusal = captureRefusal(() =>
      insertReport(db, {
        ...firstReportRecord(),
        standardVersionId: UNPUBLISHED_STANDARD_VERSION_LABEL,
      }),
    );

    expect(refusal).toBeInstanceOf(UnknownStandardError);
    if (!(refusal instanceof UnknownStandardError)) {
      throw new Error("expected the refusal to be an UnknownStandardError");
    }
    expect(refusal.code).toBe("unknown_standard");
    expect(refusal.reference).toBe(UNPUBLISHED_STANDARD_VERSION_LABEL);
    // The refusal fires before the transaction opens, so the counts are the ones from before.
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(reportsBefore);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(evidenceBefore);
  });

  it("stores a report under the version its caller already resolved, reading no row for it", () => {
    const resolved = resolvedStandardVersion();
    // Resolved before the recorder is installed, so the fixture's own lookups are not part of what the
    // record below is asserted to have prepared.
    const publishedRowId = publishedStandardVersionRowId();
    const record = firstReportRecord();
    installPrepareRecorder();

    insertReport(db, record, resolved);

    // The stored foreign key is the resolved record's own row identifier and the read hands the label
    // back, so the report a caller resolved once for a submission cites that same version.
    expect(resolved.id).toBe(publishedRowId);
    expect(rawReportRow(FIRST_REPORT_ID).standard_version_id).toBe(resolved.id);
    expect(storedOrFail(FIRST_REPORT_ID).standardVersionId).toBe(STANDARD_VERSION_LABEL);
    // The read the record form skips is the resolution probe, the one statement that looks a version
    // up in `standard_versions`; its absence is the whole saving, and the appends that make the report
    // are asserted beside it so this case cannot pass by having written nothing at all. The probe is
    // named rather than the table, because the report read above joins the same table for its label.
    expect(preparedStatements.some((source) => /FROM\s+standard_versions/.test(source))).toBe(false);
    expect(
      preparedStatements.some((source) => /INSERT\s+INTO\s+evaluation_reports/i.test(source)),
    ).toBe(true);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(
      record.caseResults.length,
    );
  });

  it("refuses a resolved version labelled otherwise than the report cites, writing no row", () => {
    const resolved = resolvedStandardVersion();
    const record: ReportRecord = {
      ...firstReportRecord(),
      standardVersionId: UNPUBLISHED_STANDARD_VERSION_LABEL,
    };

    const refusal = captureRefusal(() => insertReport(db, record, resolved));

    // A resolved record is not taken on trust: the module stores a report against the version it was
    // scored against and never another, so the disagreement is refused — and it is refused as drift
    // rather than as an unknown version, because the record resolved and it is the report that names
    // something else. The message names both labels, which is what lets a reader see the mismatch
    // without re-reading the database.
    expect(refusal).toBeInstanceOf(StandardDriftError);
    if (!(refusal instanceof StandardDriftError)) {
      throw new Error("expected the refusal to be a StandardDriftError");
    }
    expect(refusal.name).toBe("StandardDriftError");
    expect(refusal.code).toBe("standard_drift");
    expect(refusal.standardVersionId).toBe(resolved.id);
    expect(refusal.message).toContain(STANDARD_VERSION_LABEL);
    expect(refusal.message).toContain(UNPUBLISHED_STANDARD_VERSION_LABEL);
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(0);
  });

  it("stores either label verbatim, on a failing report as much as a passing one", () => {
    const template = firstReportRecord();

    for (const label of ["SAMPLE", "VERIFIED-IN-DEMO"] satisfies readonly ReportLabel[]) {
      const record: ReportRecord = {
        ...template,
        reportId: `report-unit-labelled-${label}`,
        label,
        // The totals and the outcome are stated rather than counted from the evidence: the module
        // copies what the scorer derived and never recounts it, so a stated pair the evidence would
        // not produce is exactly what pins the copy.
        outcome: "PASS",
        matchedCount: template.caseResults.length,
        criticalFailures: 0,
      };
      insertReport(db, record);

      const storedRow = rawReportRow(record.reportId);
      expect(storedRow.label).toBe(label);
      expect(storedRow.outcome).toBe("PASS");
      expect(storedRow.matched_count).toBe(template.caseResults.length);
      expect(storedOrFail(record.reportId).label).toBe(label);
    }

    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(2);
  });

  it("refuses a second report under a stored identifier, leaving the stored row as it was", () => {
    const record = firstReportRecord();
    insertReport(db, record);
    const stored = storedOrFail(record.reportId);

    // A different report carrying an identifier already stored. The plain INSERT the module issues is
    // refused by the primary key, where a replace-style conflict resolution would first delete the
    // stored row — a delete no trigger fires on, as the module header states — and write the new one
    // in its place. Either way the stored report is unchanged, which is what this case pins.
    expect(() =>
      insertReport(db, { ...record, matchedCount: 0, criticalFailures: 0 }),
    ).toThrow(/constraint failed/);

    expect(storedOrFail(record.reportId)).toStrictEqual(stored);
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(1);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(
      record.caseResults.length,
    );
  });

  it("writes nothing at all when a case result cannot be stored", () => {
    const record = firstReportRecord();
    // A locally-typed test double rather than a widened one: only the null reaches the table, and the
    // column's NOT NULL guard is what refuses it.
    const brokenCaseResults = record.caseResults.map((caseResult, index) =>
      index === 0 ? { ...caseResult, caseId: null as unknown as string } : caseResult,
    );

    // The report row is inserted first and an evidence row refuses, so the transaction has to leave
    // no report behind: a report whose evidence is half written is not a state these tables hold.
    expect(() => insertReport(db, { ...record, caseResults: brokenCaseResults })).toThrow(
      /NOT NULL constraint failed/,
    );

    expect(getReport(db, record.reportId)).toBeNull();
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(0);
  });

  it("writes nothing at all when the evidence repeats a case, which the evidence pair forbids", () => {
    const record = firstReportRecord();
    const [firstCaseResult] = record.caseResults;
    if (firstCaseResult === undefined) {
      throw new Error("expected the hand-built evidence to hold a case result");
    }

    // Every case the report states, and then one of them twice: `UNIQUE (report_id, case_id)`
    // refuses the repeat, so the report row written first in the same transaction rolls back with it.
    expect(() =>
      insertReport(db, { ...record, caseResults: [...record.caseResults, { ...firstCaseResult }] }),
    ).toThrow(/UNIQUE constraint failed/);

    expect(getReport(db, record.reportId)).toBeNull();
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(0);
  });
});

describe("the append-only guard", () => {
  it("aborts an update and a delete of a report and of its evidence, leaving both as they were", () => {
    const record = firstReportRecord();
    insertReport(db, record);
    const reportBefore = storedOrFail(record.reportId);
    const evidenceBefore = rawCaseResultRows(record.reportId);

    // Four statements the append-only triggers of migration 0010 must abort, and the only UPDATE and
    // DELETE this suite issues. They are the test's own: `./report-repository` contains neither, which
    // the case after this one asserts by recording the SQL it prepares. The triggers are defence in
    // depth rather than the guarantee itself — a connection with write access can drop one — and the
    // guarantee is that no route offers the mutation.
    expect(() =>
      db.prepare("UPDATE evaluation_reports SET matched_count = 0 WHERE id = ?").run(record.reportId),
    ).toThrow(/append-only/);
    expect(() =>
      db.prepare("DELETE FROM evaluation_reports WHERE id = ?").run(record.reportId),
    ).toThrow(/append-only/);
    expect(() =>
      db
        .prepare("UPDATE report_case_results SET match = 0 WHERE report_id = ?")
        .run(record.reportId),
    ).toThrow(/append-only/);
    expect(() =>
      db.prepare("DELETE FROM report_case_results WHERE report_id = ?").run(record.reportId),
    ).toThrow(/append-only/);

    expect(storedOrFail(record.reportId)).toStrictEqual(reportBefore);
    expect(rawCaseResultRows(record.reportId)).toStrictEqual(evidenceBefore);
    expect(rawReportRow(record.reportId).matched_count).toBe(record.matchedCount);
  });
});

describe("getReport", () => {
  it("returns every provenance field and the evidence byte for byte, and two reads compare equal", () => {
    const record = firstReportRecord();
    insertReport(db, record);
    const stored = storedOrFail(record.reportId);

    expect(Object.keys(stored).sort()).toStrictEqual([...STORED_REPORT_FIELD_NAMES]);
    for (const caseResult of stored.caseResults) {
      expect(Object.keys(caseResult).sort()).toStrictEqual([...EVIDENCE_FIELD_NAMES]);
    }

    expect(stored).toStrictEqual({
      reportId: record.reportId,
      candidateVersionId: record.candidateVersionId,
      standardVersionId: STANDARD_VERSION_LABEL,
      caseResults: record.caseResults,
      matchedCount: record.matchedCount,
      totalCount: record.totalCount,
      criticalFailures: record.criticalFailures,
      outcome: record.outcome,
      rubricReference: record.rubricReference,
      label: record.label,
      priorReportId: null,
      createdAt: FIRST_INSTANT,
    });
    expect(stored.createdAt).toBe(FIRST_INSTANT);
    expect(stored.priorReportId).toBeNull();

    // The verdict is the column's 0 or 1 mapped back to a boolean, in both directions.
    expect(stored.caseResults.map((caseResult) => caseResult.match)).toStrictEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(stored.caseResults.every((caseResult) => typeof caseResult.match === "boolean")).toBe(
      true,
    );

    // The two canonical texts come back character for character, including the whitespace inside one
    // case's string value, which a read that re-serialised or re-canonicalised would have moved.
    expect(stored.caseResults.map((caseResult) => caseResult.expectedJson)).toStrictEqual([
      ALLOW_RECORD_JSON,
      ITEMS_JSON,
      PADDED_NOTE_JSON,
      ALIGNED_JSON,
    ]);
    expect(stored.caseResults.map((caseResult) => caseResult.actualJson)).toStrictEqual([
      ALLOW_RECORD_JSON,
      ITEMS_JSON,
      PADDED_NOTE_JSON,
      MISMATCHING_JSON,
    ]);
    expect(stored.caseResults[2]?.expectedJson).toBe(PADDED_NOTE_JSON);

    // Two consecutive reads are deeply equal: the guarantee a re-read after an appeal ruling is
    // compared against, since a ruling appends a governance event and never touches the report.
    expect(getReport(db, record.reportId)).toStrictEqual(getReport(db, record.reportId));
    expect(getReport(db, record.reportId)).toStrictEqual(stored);
  });

  it("answers null for an identifier that matches nothing, without refusing", () => {
    expect(getReport(db, UNKNOWN_REPORT_ID)).toBeNull();
    expect(() => getReport(db, UNKNOWN_REPORT_ID)).not.toThrow();
  });
});

describe("findLatestReportId", () => {
  it("answers null before any report exists, and for a candidate version that has none", () => {
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBeNull();

    insertReport(db, firstReportRecord());

    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBe(
      FIRST_REPORT_ID,
    );
    expect(findLatestReportId(db, OTHER_CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBeNull();
  });

  it("supplies the link a retest records, leaving the earlier report as it was", () => {
    insertReport(db, firstReportRecord());
    const earlierReport = storedOrFail(FIRST_REPORT_ID);

    // The caller's link, never a client's and never derived inside the writer: the route asks this
    // question and hands the answer to `buildReport`.
    const priorReportId = findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL);
    expect(priorReportId).toBe(FIRST_REPORT_ID);

    insertReport(db, retestReportRecord(priorReportId, LATER_INSTANT));

    expect(rawReportRow(RETEST_REPORT_ID).prior_report_id).toBe(FIRST_REPORT_ID);
    expect(storedOrFail(RETEST_REPORT_ID).priorReportId).toBe(FIRST_REPORT_ID);
    expect(storedOrFail(FIRST_REPORT_ID)).toStrictEqual(earlierReport);
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBe(
      RETEST_REPORT_ID,
    );
  });

  it("answers the newest report even when two share an instant, tie-broken by insertion order", () => {
    insertReport(db, firstReportRecord());
    insertReport(db, retestReportRecord(FIRST_REPORT_ID, FIRST_INSTANT));

    // The tie is real rather than incidental: both reports state the same instant, which a fast
    // retest and a caller pinning the clock both produce. `created_at` alone would leave the answer
    // to the order the engine happened to return two equally recent rows in, so the later row wins
    // on `rowid` — and the report a retest records as its predecessor is therefore fixed.
    expect(storedOrFail(FIRST_REPORT_ID).createdAt).toBe(storedOrFail(RETEST_REPORT_ID).createdAt);
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBe(
      RETEST_REPORT_ID,
    );
  });

  it("refuses an unpublished standard version rather than answering null", () => {
    const refusal = captureRefusal(() =>
      findLatestReportId(db, CANDIDATE_VERSION_ID, UNPUBLISHED_STANDARD_VERSION_LABEL),
    );

    // `null` states that this candidate version has no earlier report, which is a different thing
    // from a standard version that does not exist; the two answers stay distinguishable.
    expect(refusal).toBeInstanceOf(UnknownStandardError);
    if (!(refusal instanceof UnknownStandardError)) {
      throw new Error("expected the refusal to be an UnknownStandardError");
    }
    expect(refusal.code).toBe("unknown_standard");
  });

  it("answers the same link for a version its caller already resolved", () => {
    insertReport(db, firstReportRecord());
    const resolved = resolvedStandardVersion();

    // The route holds the record it resolved for the submission and asks this question with it rather
    // than with the label again: the comparison binds the record's own row identifier, so the link a
    // retest records is the one the label form answers.
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, resolved)).toBe(FIRST_REPORT_ID);
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, resolved)).toBe(
      findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL),
    );
    // A record form reads no row of `standard_versions` at all, so a version no report cites yet is
    // answered as it is for the label form: `null` rather than a refusal.
    expect(findLatestReportId(db, OTHER_CANDIDATE_VERSION_ID, resolved)).toBeNull();
  });
});

describe("the tables this module must not touch", () => {
  it("stores a report while the rows its foreign keys require are left exactly as they were", () => {
    const versionBefore = rawListingVersionRow(CANDIDATE_VERSION_ID);
    const countsBefore = {
      accounts: scalarCount("SELECT COUNT(*) AS count FROM accounts"),
      categories: scalarCount("SELECT COUNT(*) AS count FROM categories"),
      listings: scalarCount("SELECT COUNT(*) AS count FROM listings"),
      versions: scalarCount("SELECT COUNT(*) AS count FROM listing_versions"),
    };

    insertReport(db, firstReportRecord());
    insertReport(db, retestReportRecord(FIRST_REPORT_ID, LATER_INSTANT));

    // The rows are the fixture's and not this module's: it adds none, changes none, and stores the
    // candidate identifier it was handed rather than looking one up. The flag the planted version
    // carries is data the module never reads, because the label a report states arrives as an
    // argument — which is what leaves ownership resolution, and the fixture-candidate flag behind a
    // label, with `apps/api`.
    expect(storedOrFail(FIRST_REPORT_ID).candidateVersionId).toBe(CANDIDATE_VERSION_ID);
    expect(rawListingVersionRow(CANDIDATE_VERSION_ID)).toStrictEqual(versionBefore);
    expect({
      accounts: scalarCount("SELECT COUNT(*) AS count FROM accounts"),
      categories: scalarCount("SELECT COUNT(*) AS count FROM categories"),
      listings: scalarCount("SELECT COUNT(*) AS count FROM listings"),
      versions: scalarCount("SELECT COUNT(*) AS count FROM listing_versions"),
    }).toStrictEqual(countsBefore);
  });

  it("prepares no statement that names a table belonging to another owner", () => {
    installPrepareRecorder();

    insertReport(db, firstReportRecord());
    storedOrFail(FIRST_REPORT_ID);

    // What the module did prepare, so the check below cannot pass by having recorded nothing at all:
    // the two appends, the standard version it resolves the label through, and the report read.
    expect(
      preparedStatements.some((source) => /INSERT\s+INTO\s+evaluation_reports/i.test(source)),
    ).toBe(true);
    expect(
      preparedStatements.some((source) => /INSERT\s+INTO\s+report_case_results/i.test(source)),
    ).toBe(true);
    expect(preparedStatements.some((source) => /standard_versions/.test(source))).toBe(true);
    expect(preparedStatements.some((source) => /FROM\s+evaluation_reports/i.test(source))).toBe(true);

    // The executable form of the decision the module header states: resolving which version a report
    // measures, or which origin its label came from, would mean reading the API layer's listings and
    // versions and the demo session's accounts here, and the contract already supplies both as the
    // route's own values. A statement naming one of these tables fails this case, which is what stops
    // such a read from being added later as a helpful-looking lookup.
    const forbiddenReads = TABLES_THE_REPORT_PATH_MUST_NOT_READ.filter((table) =>
      preparedStatements.some((source) => new RegExp(`\\b${table}\\b`).test(source)),
    );
    expect(forbiddenReads).toStrictEqual([]);
  });
});

describe("the fixtures this suite does not load", () => {
  it("imports no fixture module, in this suite or in the module under test", () => {
    const suiteSource = sourceOf("./report-repository.test.ts");
    const moduleSource = sourceOf("./report-repository.ts");

    // Both reads are shown to have returned the file, so neither check below can pass by reading
    // nothing: an empty or missing read would satisfy them for the wrong reason.
    expect(suiteSource).toContain("describe(");
    expect(moduleSource).toContain("insertReport");

    // The evidence is hand-built and the module appends what it is handed, so neither reads the
    // fixture pack, whose loader has its own suite. Asserted rather than commented on, because an
    // import added later would be invisible in the behaviour of every other case here.
    expect(suiteSource).not.toMatch(FIXTURE_PACKAGE_IMPORT_PATTERN);
    expect(moduleSource).not.toMatch(FIXTURE_PACKAGE_IMPORT_PATTERN);
  });
});

