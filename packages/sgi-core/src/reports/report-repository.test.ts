/**
 * The beside-source unit test of `./report-repository`: what `insertReport` stores, what `getReport`
 * reads back, what `findLatestReportId` answers, and the two guards that make the store append-only.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because most of what is asserted here is a property of the delivered
 * schema rather than of a function alone: the eleven columns a report fills, the `UNIQUE (report_id,
 * case_id)` pair that makes the evidence set exact, the `CHECK`s a row has to satisfy before it can
 * be stored at all, and the abort triggers that make a stored report unrewritable. No table is
 * created by hand, so a column the migrations do not declare fails this suite loudly instead of being
 * papered over by a fixture that agrees with the module.
 *
 * **The connection turns foreign keys off, and says why.** `better-sqlite3` enables
 * `PRAGMA foreign_keys` by default, and `apps/api/src/db/connection.ts` turns it on explicitly for
 * every server connection. `evaluation_reports.candidate_version_id` references `listing_versions`,
 * a table this package never reads and never writes, so a suite running under the enforced pragma
 * would have to plant an account, a listing and a listing version of its own in another module's
 * tables — rows that belong to `apps/api` and that this module is forbidden to own — merely to store
 * a report. The pragma is therefore turned off here, deliberately and for the whole suite, so that
 * every case stores a report while `listings`, `listing_versions` and `accounts` hold no row at all:
 * that is the evidence that the ownership of a version, and the `is_fixture_candidate` flag behind a
 * report's label, are resolved by `apps/api` and merely handed in. What this leaves uncovered is what
 * the foreign key itself enforces on the server's own connection, which the integration suite
 * exercises where a real listing version exists.
 *
 * **The UPDATE and the DELETE below are issued by the test on purpose.** They are the statements the
 * append-only triggers must abort, and `./report-repository` contains neither: the module appends
 * with a plain `INSERT`, which is exactly what this suite pins.
 *
 * The records are built through the shipped scorer and the shipped report builder from the shipped
 * fixture pack, so no threshold, case count, case id or expected output is restated here: a change to
 * the pack or to the standard version reaches this suite as data. Nothing here reads a clock — every
 * instant is a literal — and the identifier forms are the caller's, so the pinned ones below are
 * readable names rather than the random identifiers a production writer generates.
 *
 * Applying the migration files is this package's only filesystem access, and it belongs in a test
 * module: the runner lives in `apps/api/src/db/migrate.ts`, which this package may not import, the
 * unit suite starts no server and opens no database file, and `packages/shared/migrations` owns the
 * schema, so this package declares no DDL of its own. Paths resolve from this module's own location
 * rather than from the working directory.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCaseSet, loadCandidate } from "@adem/sgi-fixtures";
import type { CaseSet } from "@adem/sgi-fixtures";
import type { ReportLabel } from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scoreSubmission } from "../scoring/score-submission";
import type { ScoredSubmission } from "../scoring/score-submission";
import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";
import {
  UnknownStandardError,
  getStandardVersion,
  registerStandardVersion,
} from "../standards/standard-registry";
import { buildReport } from "./build-report";
import type { ReportRecord } from "./build-report";
import { findLatestReportId, getReport, insertReport } from "./report-repository";
import type { StoredReport } from "./report-repository";

/**
 * The delivered migrations, resolved from this module's own location rather than from the working
 * directory, so the schema under test is the one the repository ships wherever the run was started.
 */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

/** The one provisional standard version, and the label every report below cites. */
const STANDARD_VERSION_LABEL = SGI_SO_1_0_0.versionLabel;

/** The candidate version a report measures, as `apps/api` would resolve it and hand it in. */
const CANDIDATE_VERSION_ID = "candidate-version-seeded-alpha";

/** A second candidate version, for the cases that assert a report is found per version. */
const OTHER_CANDIDATE_VERSION_ID = "candidate-version-seeded-beta";

/** The identifier of the first pinned report. */
const FIRST_REPORT_ID = "report-pinned-first";

/** The identifier of the pinned retest report. */
const RETEST_REPORT_ID = "report-pinned-retest";

/** The instant the first pinned report states. */
const SEEDED_INSTANT = "2024-06-01T00:00:00.000Z";

/** A later instant, for the case that asserts the newest report wins on `created_at`. */
const LATER_INSTANT = "2024-06-02T00:00:00.000Z";

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

/** One row of `PRAGMA table_info`, of which this suite reads the column names. */
interface TableInfoRow {
  /** The column's name. */
  readonly name: string;
}

/** The single column a `COUNT(*)` query returns. */
interface CountRow {
  readonly count: number;
}

/** One `evaluation_reports` row, typed as the migration declares its columns. */
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

/** One `report_case_results` row, typed as the migration declares its columns. */
interface RawCaseResultRow {
  readonly case_id: string;
  readonly expected_json: string;
  readonly actual_json: string;
  readonly match: number;
}

let db: Database.Database;

/** Applies every migration in filename order; a directory with no `.sql` file fails the run. */
function migrationFiles(): readonly string[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`the migrations directory ${migrationsDir} holds no .sql file to apply`);
  }
  return files;
}

/** A fresh in-memory database carrying the delivered schema, with the standard version published. */
function seededDatabase(): Database.Database {
  const database = new Database(":memory:");

  // Off for the whole suite, so no case has to plant a row in a table this package may not own: see
  // the foreign-keys note in the module header. The server's own connection turns it on.
  database.pragma("foreign_keys = OFF");

  for (const file of migrationFiles()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  registerStandardVersion(database, SGI_SO_1_0_0);
  return database;
}

/** The case set of the standard version, read fresh so no case shares loaded state with another. */
function caseSetOf(): CaseSet {
  return loadCaseSet(SGI_SO_1_0_0.fixtureSetId);
}

/** One seed candidate scored against the shipped case set, through the shipped scorer. */
function scoredOf(candidateId: string): ScoredSubmission {
  return scoreSubmission(SGI_SO_1_0_0, caseSetOf(), loadCandidate(candidateId));
}

/**
 * The first report for the pinned candidate version: the two identity values pinned so a later read
 * compares against stated values, the label a seeded fixture candidate earns, and no retest link.
 */
function firstReportRecord(): ReportRecord {
  return buildReport(scoredOf("seed-alpha"), {
    candidateVersionId: CANDIDATE_VERSION_ID,
    standardVersionId: STANDARD_VERSION_LABEL,
    label: "SAMPLE",
    priorReportId: null,
    reportId: FIRST_REPORT_ID,
    createdAt: SEEDED_INSTANT,
  });
}

/** A retest of the same candidate version and standard, stated to follow `priorReportId`. */
function retestReportRecord(priorReportId: string | null, createdAt: string): ReportRecord {
  return buildReport(scoredOf("seed-alpha"), {
    candidateVersionId: CANDIDATE_VERSION_ID,
    standardVersionId: STANDARD_VERSION_LABEL,
    label: "SAMPLE",
    priorReportId,
    reportId: RETEST_REPORT_ID,
    createdAt,
  });
}

/** The column names a table declares, read from the schema rather than assumed. */
function columnNamesOf(rowSource: readonly TableInfoRow[]): string[] {
  return rowSource.map((row) => row.name);
}

/** The column names of one table, read with the pragma that names it. */
function reportColumns(): string[] {
  return columnNamesOf(
    db.prepare<[], TableInfoRow>("PRAGMA table_info(evaluation_reports)").all(),
  );
}

/** The column names of `report_case_results`. */
function caseResultColumns(): string[] {
  return columnNamesOf(
    db.prepare<[], TableInfoRow>("PRAGMA table_info(report_case_results)").all(),
  );
}

/** The column names of `listing_versions`, the table this module must never read. */
function listingVersionColumns(): string[] {
  return columnNamesOf(db.prepare<[], TableInfoRow>("PRAGMA table_info(listing_versions)").all());
}

/** The single number a literal count query returns. */
function scalarCount(sql: string): number {
  const row = db.prepare<[], CountRow>(sql).get();
  if (row === undefined) {
    throw new Error("expected a COUNT(*) row and got none");
  }
  return row.count;
}

/** One stored `evaluation_reports` row, read without the module under test. */
function storedReportRow(id: string): RawReportRow {
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

/** Every stored `report_case_results` row of one report, read without the module under test. */
function storedCaseResultRows(reportId: string): RawCaseResultRow[] {
  return db
    .prepare<[string], RawCaseResultRow>(
      `SELECT case_id, expected_json, actual_json, match
         FROM report_case_results
        WHERE report_id = ?
        ORDER BY rowid ASC`,
    )
    .all(reportId);
}

/** The stored report a reader would fetch, failing the case rather than returning null. */
function storedOrFail(id: string): StoredReport {
  const stored = getReport(db, id);
  if (stored === null) {
    throw new Error(`expected a stored report for identifier ${id}`);
  }
  return stored;
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

/** The `standard_versions` row identifier the registry publishes for the one standard version. */
function publishedStandardVersionRowId(): string {
  const version = getStandardVersion(db, STANDARD_VERSION_LABEL, STANDARD_VERSION_LABEL);
  if (version === null) {
    throw new Error(`expected the seeded database to publish standard version ${STANDARD_VERSION_LABEL}`);
  }
  return version.id;
}

beforeEach(() => {
  db = seededDatabase();
});

afterEach(() => {
  db.close();
});

describe("the schema the statements are written against", () => {
  it("fills every NOT NULL column of evaluation_reports, so a statement that omitted one would fail", () => {
    expect(reportColumns()).toEqual(
      expect.arrayContaining([
        "id",
        "candidate_version_id",
        "standard_version_id",
        "outcome",
        "matched_count",
        "total_count",
        "critical_failures",
        "label",
        "rubric_reference",
        "prior_report_id",
        "created_at",
      ]),
    );

    const record = firstReportRecord();
    insertReport(db, record);
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(1);

    // The same row, written without `label` — a NOT NULL column with no default. The table refuses
    // it, which is what makes the module's own eleven-column statement load-bearing: a statement that
    // had dropped that column would be refused here rather than storing a report with no label.
    expect(() =>
      db
        .prepare(
          `INSERT INTO evaluation_reports
             (id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
              critical_failures, rubric_reference, prior_report_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "report-written-without-a-label",
          CANDIDATE_VERSION_ID,
          publishedStandardVersionRowId(),
          record.outcome,
          record.matchedCount,
          record.totalCount,
          record.criticalFailures,
          record.rubricReference,
          null,
          SEEDED_INSTANT,
        ),
    ).toThrow(/NOT NULL constraint failed/);
  });

  it("fills every NOT NULL column of report_case_results, so the evidence row is complete", () => {
    expect(caseResultColumns()).toEqual(
      expect.arrayContaining([
        "id",
        "report_id",
        "case_id",
        "severity",
        "expected_json",
        "actual_json",
        "match",
      ]),
    );

    const record = firstReportRecord();
    insertReport(db, record);
    const evidence = storedCaseResultRows(record.reportId);
    expect(evidence.length).toBe(record.caseResults.length);

    // The same evidence row, written without `case_id`. Again the table refuses it, so the module's
    // statement cannot be quietly incomplete.
    expect(() =>
      db
        .prepare(
          `INSERT INTO report_case_results
             (id, report_id, case_id, severity, expected_json, actual_json, match)
           VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        )
        .run("case-result-without-a-case", record.reportId, "critical", "1", "1", 1),
    ).toThrow(/NOT NULL constraint failed/);
  });
});

describe("insertReport", () => {
  it("appends the report row and one evidence row per fixture case, in case-set order", () => {
    const record = firstReportRecord();
    insertReport(db, record);

    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(1);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(
      record.caseResults.length,
    );
    expect(record.caseResults.length).toBe(caseSetOf().total_cases);

    // The order the evidence was written in is the case set's own order, and the stored canonical
    // strings are the ones the comparison compared.
    expect(storedCaseResultRows(record.reportId).map((row) => row.case_id)).toStrictEqual(
      caseSetOf().cases.map((fixtureCase) => fixtureCase.id),
    );
    expect(storedCaseResultRows(record.reportId).map((row) => row.expected_json)).toStrictEqual(
      record.caseResults.map((caseResult) => caseResult.expectedJson),
    );
    expect(storedCaseResultRows(record.reportId).map((row) => row.match)).toStrictEqual(
      record.caseResults.map((caseResult) => (caseResult.match ? 1 : 0)),
    );
  });

  it("stores the standard version's row identifier while the read hands the label back", () => {
    const record = firstReportRecord();
    insertReport(db, record);

    const storedRow = storedReportRow(record.reportId);
    expect(storedRow.standard_version_id).toBe(publishedStandardVersionRowId());
    expect(storedRow.standard_version_id).not.toBe(STANDARD_VERSION_LABEL);
    expect(storedOrFail(record.reportId).standardVersionId).toBe(STANDARD_VERSION_LABEL);
  });

  it("refuses an unpublished standard version before any row is written", () => {
    const refusal = captureRefusal(() =>
      insertReport(db, { ...firstReportRecord(), standardVersionId: "SGI-SO-9.9.9" }),
    );

    expect(refusal).toBeInstanceOf(UnknownStandardError);
    if (!(refusal instanceof UnknownStandardError)) {
      throw new Error("expected the refusal to be an UnknownStandardError");
    }
    expect(refusal.code).toBe("unknown_standard");
    expect(refusal.reference).toBe("SGI-SO-9.9.9");
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(0);
  });

  it("stores either label verbatim, a failing report included", () => {
    for (const label of ["SAMPLE", "VERIFIED-IN-DEMO"] satisfies ReportLabel[]) {
      const record: ReportRecord = {
        ...firstReportRecord(),
        reportId: `report-labelled-${label}`,
        label,
        outcome: "FAIL",
        matchedCount: 0,
        criticalFailures: 1,
      };
      insertReport(db, record);

      expect(storedReportRow(record.reportId).label).toBe(label);
      expect(storedReportRow(record.reportId).outcome).toBe("FAIL");
    }
  });

  it("refuses a second report under a stored identifier, leaving the stored row as it was", () => {
    const record = firstReportRecord();
    insertReport(db, record);
    const stored = storedOrFail(record.reportId);

    // A different report carrying an identifier already stored. A replace-style conflict resolution
    // would delete the stored row it collided with — a delete no trigger fires on — and write the
    // new one in its place; the plain INSERT the module issues refuses it instead.
    expect(() =>
      insertReport(db, { ...record, outcome: "FAIL", matchedCount: 0, criticalFailures: 0 }),
    ).toThrow(/constraint failed/);

    expect(storedOrFail(record.reportId)).toStrictEqual(stored);
    expect(storedOrFail(record.reportId).outcome).toBe(record.outcome);
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(1);
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(
      record.caseResults.length,
    );
  });

  it("writes nothing at all when a case result cannot be stored", () => {
    const record = firstReportRecord();
    const brokenCaseResults = record.caseResults.map((caseResult, index) =>
      index === 3 ? { ...caseResult, caseId: null as unknown as string } : caseResult,
    );

    // The report row is inserted first and its evidence row refuses, so the transaction has to leave
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
    const [firstCase] = record.caseResults;
    if (firstCase === undefined) {
      throw new Error("expected the fixture case set to define at least one case");
    }

    // Every case the set defines, and then one of them a second time: the `UNIQUE (report_id,
    // case_id)` pair refuses the repeat, so the report written first in the same transaction is
    // rolled back with it.
    expect(() =>
      insertReport(db, { ...record, caseResults: [...record.caseResults, { ...firstCase }] }),
    ).toThrow(/UNIQUE constraint failed/);

    expect(getReport(db, record.reportId)).toBeNull();
    expect(scalarCount("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(0);
  });
});

describe("the append-only guard", () => {
  it("aborts an update and a delete of a report and of its evidence, leaving both as they were", () => {
    const record = firstReportRecord();
    insertReport(db, record);
    const reportBefore = storedOrFail(record.reportId);

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
    expect(scalarCount("SELECT COUNT(*) AS count FROM report_case_results")).toBe(
      record.caseResults.length,
    );
  });
});

describe("getReport", () => {
  it("returns the stored report with all twelve fields and its evidence, byte for byte", () => {
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
      standardVersionId: record.standardVersionId,
      caseResults: record.caseResults,
      matchedCount: record.matchedCount,
      totalCount: record.totalCount,
      criticalFailures: record.criticalFailures,
      outcome: record.outcome,
      rubricReference: record.rubricReference,
      label: record.label,
      priorReportId: null,
      createdAt: record.createdAt,
    });
    expect(stored.caseResults.map((caseResult) => caseResult.caseId)).toStrictEqual(
      caseSetOf().cases.map((fixtureCase) => fixtureCase.id),
    );
  });

  it("returns deeply equal objects on two consecutive reads", () => {
    const record = firstReportRecord();
    insertReport(db, record);

    expect(getReport(db, record.reportId)).toStrictEqual(getReport(db, record.reportId));
    expect(storedOrFail(record.reportId).caseResults[0]?.expectedJson).toBe(
      record.caseResults[0]?.expectedJson,
    );
    expect(storedOrFail(record.reportId).caseResults[0]?.actualJson).toBe(
      record.caseResults[0]?.actualJson,
    );
  });

  it("answers null for an identifier that matches nothing, without refusing", () => {
    expect(getReport(db, "report-never-written")).toBeNull();
    expect(() => getReport(db, "report-never-written")).not.toThrow();
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

  it("answers the newest report even when two share an instant, tie-broken by insertion order", () => {
    const instant = SEEDED_INSTANT;
    insertReport(db, firstReportRecord());
    insertReport(db, retestReportRecord(FIRST_REPORT_ID, instant));

    // The tie is real rather than incidental: both reports state the same instant, which is what a
    // fast retest and a caller pinning the clock both produce.
    expect(storedOrFail(FIRST_REPORT_ID).createdAt).toBe(storedOrFail(RETEST_REPORT_ID).createdAt);
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBe(
      RETEST_REPORT_ID,
    );
  });

  it("answers the report of the later instant when the two instants differ", () => {
    insertReport(db, firstReportRecord());
    insertReport(db, retestReportRecord(FIRST_REPORT_ID, LATER_INSTANT));

    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBe(
      RETEST_REPORT_ID,
    );
  });

  it("refuses an unpublished standard version rather than answering null", () => {
    const refusal = captureRefusal(() =>
      findLatestReportId(db, CANDIDATE_VERSION_ID, "SGI-SO-9.9.9"),
    );

    expect(refusal).toBeInstanceOf(UnknownStandardError);
    if (!(refusal instanceof UnknownStandardError)) {
      throw new Error("expected the refusal to be an UnknownStandardError");
    }
    expect(refusal.code).toBe("unknown_standard");
  });

  it("supplies the link a retest records, leaving the earlier report as it was", () => {
    insertReport(db, firstReportRecord());
    const earlierReport = storedOrFail(FIRST_REPORT_ID);

    const priorReportId = findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL);
    insertReport(db, retestReportRecord(priorReportId, LATER_INSTANT));

    expect(storedOrFail(RETEST_REPORT_ID).priorReportId).toBe(FIRST_REPORT_ID);
    expect(storedOrFail(FIRST_REPORT_ID)).toStrictEqual(earlierReport);
    expect(findLatestReportId(db, CANDIDATE_VERSION_ID, STANDARD_VERSION_LABEL)).toBe(
      RETEST_REPORT_ID,
    );
  });
});

describe("the tables this module does not touch", () => {
  it("stores a report while no listing version, listing or account row exists at all", () => {
    // The tables exist and are empty: the candidate version's identifier, and the fixture-candidate
    // flag behind a report's label, are resolved by `apps/api` and handed in, so this module neither
    // reads nor writes them.
    expect(listingVersionColumns()).toEqual(expect.arrayContaining(["id", "is_fixture_candidate"]));
    expect(scalarCount("SELECT COUNT(*) AS count FROM listing_versions")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM listings")).toBe(0);
    expect(scalarCount("SELECT COUNT(*) AS count FROM accounts")).toBe(0);

    const record = firstReportRecord();
    insertReport(db, record);

    expect(storedOrFail(record.reportId).candidateVersionId).toBe(CANDIDATE_VERSION_ID);
    expect(scalarCount("SELECT COUNT(*) AS count FROM listing_versions")).toBe(0);
  });
});

