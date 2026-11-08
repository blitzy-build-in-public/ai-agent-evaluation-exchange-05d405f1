/**
 * The append-only store of SGI evaluation reports: the one writer of `evaluation_reports` with its
 * `report_case_results` evidence, and the two reads a report is fetched and a retest is linked
 * through.
 *
 * **One write, and it is an append.** Both tables are of the nine that
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards with a `RAISE(ABORT)` trigger on
 * an update and on a delete, and both are written below by an `INSERT` and nothing else: no
 * statement in this module rewrites a stored row, removes one, or appends in a conflict-resolving
 * form. The plain `INSERT` is load-bearing rather than stylistic — SQLite resolves an `INSERT OR
 * REPLACE` collision by deleting the row it collides with, a delete that fires no trigger — so a
 * report inserted under an identifier already stored would silently replace the report it collided
 * with, with neither append-only guard running. A report that has become inconvenient is superseded
 * by a new report, never adjusted in place.
 *
 * **A report and its evidence are one act.** {@link insertReport} writes the report row and one
 * evidence row per case inside a single transaction, so the per-case results a reader sees always
 * belong to the outcome the report states. Half a report is not a state these tables can hold.
 *
 * **The label is resolved; the row identifier is stored.** `evaluation_reports.standard_version_id`
 * references `standard_versions.id`, while the value the contract quotes is the version label
 * `SGI-SO-1.0.0`. The label is therefore resolved through the standard registry — the module that
 * owns that table — before anything is written, and the read joins the two tables to hand the label
 * back. This is the one place a naive implementation departs from the contract quietly: a read
 * returning the row identifier where the label belongs would cite criteria no reader could resolve,
 * and a write storing the label where the identifier belongs would break the foreign key.
 *
 * **Insertion order, and why the reads order by `rowid`.** The evidence is inserted in
 * `report.caseResults` order, which is case-set order, and read back with `ORDER BY rowid ASC`, so a
 * report states its cases in the order the standard version defines them. `created_at` cannot supply
 * that order: a report's evidence is written in one act, so its rows share an instant by
 * construction, and a caller that pins the clock — a test, a deterministic fixture — gives them
 * identical ones deliberately. The same tie-break decides {@link findLatestReportId}, whose answer
 * must not depend on which of two equally recent rows the engine happened to return first.
 *
 * **A retest is the caller's link, never a decision taken here.** Nothing in this module derives or
 * rewrites a predecessor: {@link findLatestReportId} answers which report a new one would follow,
 * and the caller passes that identifier into `buildReport` as `priorReportId`. The evaluation request
 * body carries no retest field at all, so the link cannot come from a client, and a stored report is
 * never modified to point anywhere.
 *
 * **Ports and adapters.** The database handle arrives as the first argument of every function below.
 * Nothing here opens a connection, reads an environment variable or the working directory, touches a
 * file, sets a pragma or issues DDL: `apps/api/src/db/connection.ts` owns the connection and its
 * pragmas, and `packages/shared/migrations` owns the schema. No statement is prepared at module load
 * either, because one prepared then would outlive the connection it belongs to.
 *
 * **What it refuses.** Exactly one refusal: `UnknownStandardError` (`code: "unknown_standard"`,
 * imported from `../standards/standard-registry` rather than redeclared), raised when
 * `standardVersionId` names no published standard version, and raised before any row is written.
 * `apps/api` maps that code to the contract's `404`; the `409` and `422` cases in the contract belong
 * to the routes that own them and to no function here. {@link getReport} refuses nothing at all — an
 * unknown identifier is `null`, because a stored report is either there or it is not.
 *
 * **Determinism.** No function below reads a clock, a locale, a timezone, a file or a random source
 * other than `randomUUID`, which names an evidence row rather than a criterion, and no read
 * normalises, rounds or reorders a stored value. Two consecutive reads of one report return deeply
 * equal objects with identical strings, which is what lets the same report be re-read after a
 * governance event and compared byte for byte.
 *
 * **What is out of reach by construction.** Nothing here reads `listings`, `listing_versions`,
 * `accounts`, `categories`, `sponsored_slots` or `audit_events`: the candidate version's identifier,
 * and the `is_fixture_candidate` flag behind a report's label, are resolved by `apps/api` and handed
 * in. No amount, fee, sponsorship or currency appears in this module or in the two tables it writes,
 * so no commercial value can reach a measurement through the report path.
 */

import { randomUUID } from "node:crypto";

import type { CaseSeverity, ReportLabel, ReportOutcome } from "@adem/shared";
import type { Database } from "better-sqlite3";

import { UnknownStandardError, getStandardVersion } from "../standards/standard-registry";
import type { ReportCaseResult, ReportRecord } from "./build-report";

/**
 * The one statement that appends a report: every column
 * `packages/shared/migrations/0006_reports_and_case_results.sql` declares, named explicitly in that
 * migration's own order with one placeholder each, so the statement and its call site at
 * {@link insertReport} are read together and a column the table later gains is a column this
 * statement does not fill rather than a stored value bound to the wrong name.
 *
 * The verb is plain `INSERT` and must stay plain: see the module header on why a replace-style
 * conflict resolution would defeat the append-only guards on this table. `rowid` is deliberately not
 * among the columns — the table is not declared `WITHOUT ROWID` and the engine assigns it.
 */
const INSERT_REPORT_SQL = `INSERT INTO evaluation_reports
  (id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
   critical_failures, label, rubric_reference, prior_report_id, created_at)
VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The one statement that appends one case result, with the migration's seven columns named
 * explicitly. One row is appended per fixture case, inside the transaction
 * {@link insertReport} opens, so the evidence of a report cannot be half written.
 */
const INSERT_CASE_RESULT_SQL = `INSERT INTO report_case_results
  (id, report_id, case_id, severity, expected_json, actual_json, match)
VALUES
  (?, ?, ?, ?, ?, ?, ?)`;

/**
 * The one statement that reads a report back: the report's own columns, selected explicitly rather
 * than with `*` so a column the table gains cannot arrive in a row this module's `ReportRow` does
 * not describe, joined to `standard_versions` for the version label the contract quotes. The join is
 * what makes the returned `standardVersionId` the label `SGI-SO-1.0.0` rather than the row
 * identifier the column stores; see the label note in the module header.
 */
const SELECT_REPORT_SQL = `SELECT
  r.id, r.candidate_version_id, v.version_label AS standard_version_label, r.outcome,
  r.matched_count, r.total_count, r.critical_failures, r.label, r.rubric_reference,
  r.prior_report_id, r.created_at
FROM evaluation_reports AS r
JOIN standard_versions AS v ON v.id = r.standard_version_id
WHERE r.id = ?`;

/**
 * The one statement that reads a report's per-case evidence, in insertion order — the order the
 * cases were written in, which is the case set's own order. See the module header on why
 * `created_at` cannot supply it.
 */
const SELECT_CASE_RESULTS_SQL = `SELECT case_id, severity, expected_json, actual_json, match
FROM report_case_results
WHERE report_id = ?
ORDER BY rowid ASC`;

/**
 * The one statement that answers which report a new one would follow: the newest report for one
 * candidate version and standard version. `created_at` is the primary order because it is the instant
 * the writer stated, and `rowid` breaks the tie a fast retest produces — see the module header.
 * `LIMIT 1` with both orders is what makes the answer one row rather than the first of several.
 */
const SELECT_LATEST_REPORT_ID_SQL = `SELECT id
FROM evaluation_reports
WHERE candidate_version_id = ? AND standard_version_id = ?
ORDER BY created_at DESC, rowid DESC
LIMIT 1`;

/**
 * One `evaluation_reports` row as this module reads it, declared under the table's own column names
 * so a column renamed in the migration fails here rather than passing as a row of another shape.
 *
 * `standard_version_label` is the joined `standard_versions.version_label` rather than a column of
 * the report, which is why it is aliased apart from the report's own columns. `outcome`, `label` and
 * `severity` below are typed as the shared closed vocabularies because the migration declares each
 * of them as a `CHECK`, so the column can hold nothing else.
 */
interface ReportRow {
  /** Primary key of the row. */
  readonly id: string;
  /** The evaluated version's identifier, referencing `listing_versions.id`. */
  readonly candidate_version_id: string;
  /** The label of the standard version the row cites, joined from `standard_versions`. */
  readonly standard_version_label: string;
  /** `PASS` or `FAIL`. */
  readonly outcome: ReportOutcome;
  /** How many cases matched. */
  readonly matched_count: number;
  /** How many cases were scored. */
  readonly total_count: number;
  /** How many `critical` cases failed. */
  readonly critical_failures: number;
  /** `SAMPLE` or `VERIFIED-IN-DEMO`. */
  readonly label: ReportLabel;
  /** The rubric the report was scored against, e.g. `SGI-SO-1.0.0#rubric`. */
  readonly rubric_reference: string;
  /** The newest earlier report for the same candidate version and standard, or `null` if none. */
  readonly prior_report_id: string | null;
  /** The instant the row was written, as an ISO-8601 UTC string. */
  readonly created_at: string;
}

/**
 * One `report_case_results` row as this module reads it. `match` is the table's `INTEGER` 0 or 1,
 * which the `CHECK (match IN (0, 1))` confines to those two values and which
 * {@link toReportCaseResult} maps back to a boolean; `expected_json` and `actual_json` are the
 * canonical JSON strings the comparison compared, returned exactly as the columns hold them.
 */
interface CaseResultRow {
  /** The fixture case this result is for, unique within its report. */
  readonly case_id: string;
  /** The severity the case set gave the case: `critical` or `standard`. */
  readonly severity: CaseSeverity;
  /** The case's expected output as canonical JSON text. */
  readonly expected_json: string;
  /** The output the candidate recorded for the case, as canonical JSON text. */
  readonly actual_json: string;
  /** 1 when the canonical outputs matched, 0 when they did not. */
  readonly match: number;
}

/** The single column the newest-report read returns, so the row's shape is stated rather than inferred. */
interface ReportIdRow {
  /** Primary key of the newest matching `evaluation_reports` row. */
  readonly id: string;
}

/**
 * One report read back out of the store: every provenance field a report states, its per-case
 * evidence in case-set order, and the two write-time identity values.
 *
 * It is the shape {@link getReport} answers with, and it states the same fields as the
 * {@link ReportRecord} {@link insertReport} wrote, with one deliberate reading: `standardVersionId`
 * is the contract-facing version label the report cites, resolved through the join, and never the
 * `standard_versions` row identifier the column holds. A caller therefore hands a stored report on
 * without translating it, and a report read twice compares equal field for field.
 *
 * `caseResults` reuses `ReportCaseResult` from `./build-report` rather than restating its five
 * fields, so the evidence a report carries and the evidence a report was built with are one type and
 * cannot drift apart.
 *
 * `priorReportId` is `null` for a version's first report and the identifier of its predecessor for a
 * retest. No member records a change, because these rows are append-only: a correction is a new
 * report, and there is no `updatedAt` for one to state.
 */
export interface StoredReport {
  /** Report identifier, generated when the report was written. */
  readonly reportId: string;

  /** The evaluated version's identifier. */
  readonly candidateVersionId: string;

  /** The contract-facing standard version label the report cites, e.g. `SGI-SO-1.0.0`. */
  readonly standardVersionId: string;

  /** One result per fixture case, in the order the cases were written. */
  readonly caseResults: readonly ReportCaseResult[];

  /** How many cases matched. */
  readonly matchedCount: number;

  /** How many cases were scored. */
  readonly totalCount: number;

  /** How many `critical` cases failed. */
  readonly criticalFailures: number;

  /** `PASS` or `FAIL`, as the evaluator derived it from the versioned pass rule. */
  readonly outcome: ReportOutcome;

  /** The rubric the report was scored against, e.g. `SGI-SO-1.0.0#rubric`. */
  readonly rubricReference: string;

  /** `SAMPLE` or `VERIFIED-IN-DEMO`. */
  readonly label: ReportLabel;

  /** The newest earlier report for the same candidate version and standard, or `null` if none. */
  readonly priorReportId: string | null;

  /** The instant the report was written, as an ISO-8601 UTC string. */
  readonly createdAt: string;
}

/**
 * Maps a stored case-result row to the evidence shape its readers are handed.
 *
 * The mapping is written out member by member rather than spread so the correspondence is readable
 * in one place, and it converts exactly one value: the `match` column's `INTEGER` 0 or 1 becomes the
 * boolean `false` or `true`. Nothing else is converted — the two canonical JSON strings are returned
 * as the columns hold them, because the stored string is the compared artefact, and re-serialising it
 * would move the payload the evaluator promises is reproducible.
 */
function toReportCaseResult(row: CaseResultRow): ReportCaseResult {
  return {
    caseId: row.case_id,
    severity: row.severity,
    expectedJson: row.expected_json,
    actualJson: row.actual_json,
    match: row.match === 1,
  };
}

/**
 * The `standard_versions` row identifier a report cites, resolved from the contract-facing version
 * label through the standard registry — the module that owns that table and the only reader of it in
 * this package. Reading the column directly here would make this module a second owner of another
 * module's table, so the registry is asked instead, with the label used for both of its references.
 *
 * This is the only refusal in this file: a report citing a standard version this release does not
 * publish would state criteria it was not scored against, and the refusal fires before any row is
 * written.
 *
 * @param db - The caller's database handle.
 * @param standardVersionId - The contract-facing version label the report cites, e.g. `SGI-SO-1.0.0`.
 * @returns The `standard_versions.id` a report's foreign key stores.
 * @throws {UnknownStandardError} when this release publishes no such standard version; `apps/api`
 * maps its `code` to the contract's `404`.
 */
function resolveStandardVersionRowId(db: Database, standardVersionId: string): string {
  const version = getStandardVersion(db, standardVersionId, standardVersionId);
  if (version === null) {
    throw new UnknownStandardError(
      `this release publishes no standard version "${standardVersionId}", so an evaluation cannot cite the criteria it was scored against: a report's standard version is resolved from the version that owns it rather than assumed, and a published version is superseded by publishing a new one`,
      standardVersionId,
    );
  }
  return version.id;
}

/**
 * Appends one report and its per-case evidence, as one act.
 *
 * The report row and one case-result row per case are written inside a single transaction, so a
 * report a reader can fetch always carries the whole evidence set its outcome rests on: a failure
 * partway through leaves no row of that report behind. Nothing is sorted or reordered — the evidence
 * is appended in `report.caseResults` order, which is case-set order — and every value is written as
 * the record states it, including the two canonical JSON strings, which are stored verbatim because
 * the stored string is the artefact the comparison compared.
 *
 * The cited standard version is resolved from its label before the transaction opens, so an
 * unresolvable label refuses with nothing written. `standard_version_id` then holds the resolved
 * `standard_versions` row identifier, never the label: see the label note in the module header.
 *
 * The method returns nothing because the caller already holds the record, identifiers included:
 * {@link ReportRecord} is built before this call, `reportId` and `createdAt` included, and the `201`
 * payload is built from the same value, so a re-read here would prove nothing about a row that
 * cannot have changed.
 *
 * A retest is not this function's business. Linking a new report to its predecessor is done by the
 * caller, which asks {@link findLatestReportId} which report a new one follows and passes that
 * identifier in as `priorReportId`; an existing report is never rewritten to point anywhere, and the
 * evaluation request body carries no retest field for one to arrive from.
 *
 * @param db - The caller's database handle.
 * @param report - The complete report record to append, evidence included.
 * @returns Nothing; the appended rows are the caller's own record, stored.
 * @throws {UnknownStandardError} when `report.standardVersionId` is not a standard version this
 * release publishes. No row is written in that case.
 * @throws Whatever the database raises otherwise — the append-only triggers of migration `0010`, the
 * table's `CHECK` constraints and its foreign keys — unwrapped, because a report that cannot be
 * stored is a defect in what was handed in rather than an outcome to be re-shaped here.
 */
export function insertReport(db: Database, report: ReportRecord): void {
  const standardVersionRowId = resolveStandardVersionRowId(db, report.standardVersionId);

  const appendReport = db.transaction((): void => {
    // A plain INSERT, deliberately: a replace-style conflict resolution would delete the stored row
    // it collided with, and the append-only triggers of migration 0010 fire on an UPDATE and a
    // DELETE, not on that hidden delete — so a second report under an existing identifier would
    // silently overwrite the first. See the module header.
    db.prepare(INSERT_REPORT_SQL).run(
      report.reportId,
      report.candidateVersionId,
      standardVersionRowId,
      report.outcome,
      report.matchedCount,
      report.totalCount,
      report.criticalFailures,
      report.label,
      report.rubricReference,
      report.priorReportId,
      report.createdAt,
    );

    const insertCaseResult = db.prepare(INSERT_CASE_RESULT_SQL);
    for (const caseResult of report.caseResults) {
      insertCaseResult.run(
        randomUUID(),
        report.reportId,
        caseResult.caseId,
        caseResult.severity,
        caseResult.expectedJson,
        caseResult.actualJson,
        // The column is an INTEGER guarded by `CHECK (match IN (0, 1))`, so the boolean is written
        // as one of the two values the table admits rather than left for the driver to decide.
        caseResult.match ? 1 : 0,
      );
    }
  });

  appendReport();
}

/**
 * One report and its per-case evidence by report identifier, or `null` when no such report exists.
 *
 * The read is public and unauthenticated — `GET /evaluations/{id}` needs no demo account — and it is
 * a pure read: nothing is recomputed, no value is rounded or reformatted, and the two canonical JSON
 * strings come back exactly as the columns hold them. Two consecutive calls for one identifier
 * return deeply equal objects with identical strings, which is the guarantee a re-read after a
 * governance event is compared byte for byte against, and the reason an appeal ruling can append a
 * governance event while the report it concerns stays as it was.
 *
 * The evidence is returned in the order it was written, which is the case set's order, and the cited
 * standard version is returned as the label the contract quotes, joined from `standard_versions`,
 * rather than as the row identifier the column stores. `apps/web`'s report page and badge render
 * their label and scope from the contract's response shape, which `apps/api` maps from this record.
 *
 * An identifier that matches nothing is `null` and never a refusal: a report is either stored or it
 * is not, and the route that owns the contract turns the `null` into its `404`.
 *
 * @param db - The caller's database handle.
 * @param id - The `evaluation_reports.id` to read.
 * @returns The stored report with its evidence, or `null` when no report carries that identifier.
 */
export function getReport(db: Database, id: string): StoredReport | null {
  const row = db.prepare<[string], ReportRow>(SELECT_REPORT_SQL).get(id);
  if (row === undefined) {
    return null;
  }

  const caseResults = db
    .prepare<[string], CaseResultRow>(SELECT_CASE_RESULTS_SQL)
    .all(id)
    .map(toReportCaseResult);

  return {
    reportId: row.id,
    candidateVersionId: row.candidate_version_id,
    standardVersionId: row.standard_version_label,
    caseResults,
    matchedCount: row.matched_count,
    totalCount: row.total_count,
    criticalFailures: row.critical_failures,
    outcome: row.outcome,
    rubricReference: row.rubric_reference,
    label: row.label,
    priorReportId: row.prior_report_id,
    createdAt: row.created_at,
  };
}

/**
 * The identifier of the newest stored report for one candidate version and standard version, or
 * `null` when that version has no report for that standard version yet.
 *
 * This is where a retest link comes from, and the only place: the caller passes the returned
 * identifier to `buildReport` as `priorReportId`. It is never a client input, because the evaluation
 * request body carries no retest field, so a submission cannot name its own predecessor and a report
 * cannot be made to point at a report of someone else's choosing.
 *
 * The newest report is the greatest `created_at`, and `rowid` breaks a tie between reports sharing
 * an instant — which a fast retest can genuinely produce, and which a caller pinning the clock
 * produces deliberately. Without that tie-break the answer would depend on the order the engine
 * happened to return two equally recent rows in, and the link a report recorded could vary between
 * two identical runs. It is also why an unknown label refuses through
 * {@link resolveStandardVersionRowId} rather than answering `null`: `null` states that this version
 * has no earlier report, which is a different thing from a standard version that does not exist.
 *
 * @param db - The caller's database handle.
 * @param candidateVersionId - The evaluated listing version's identifier.
 * @param standardVersionId - The contract-facing standard version label, e.g. `SGI-SO-1.0.0`.
 * @returns The newest earlier report's identifier, or `null` when there is none.
 * @throws {UnknownStandardError} when `standardVersionId` is not a standard version this release
 * publishes.
 */
export function findLatestReportId(
  db: Database,
  candidateVersionId: string,
  standardVersionId: string,
): string | null {
  const standardVersionRowId = resolveStandardVersionRowId(db, standardVersionId);

  const row = db
    .prepare<[string, string], ReportIdRow>(SELECT_LATEST_REPORT_ID_SQL)
    .get(candidateVersionId, standardVersionRowId);

  return row === undefined ? null : row.id;
}

