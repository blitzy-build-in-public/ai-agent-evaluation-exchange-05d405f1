/**
 * Unit tests for the appeal-ruling writer: `ruleAppeal`, with the two refusals it raises,
 * `AppealNotFoundError` and `AppealAlreadyRuledError`, all from `./rule-appeal`.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because what this module promises is a statement executed
 * against a real schema: the one column it moves, the rows it leaves alone, the event it appends,
 * the refusal a second ruling meets and the trigger behind the appended row are all properties of
 * the tables rather than of the function alone.
 *
 * The appeal under test is opened through the real `openAppeal`, so the row and the log a ruling
 * starts from are the product's own rather than a hand-written approximation of them: the log
 * already holds the opening's `appeal_opened` event before anything here rules, which is what lets
 * a case assert the *ruling's* append rather than the first row of an empty table.
 *
 * What it evidences: criterion 4's ruling half — an appeal ruling moves `appeals.status` and appends
 * exactly one `governance_events` row inside one transaction, while the appealed
 * `evaluation_reports` row *and* its per-case evidence stay byte-identical — together with the
 * contract's `404` and `409` orderings (an unknown id answers `not_found`, an appeal that already
 * carries a terminal status answers `already_ruled` *before* any write), the append-only trigger
 * behind the ruling's event row, and the documented absence of an emptiness rule on the operator's
 * stated ground. The last two are asserted structurally, by recording the SQL the module prepares,
 * because the absence of a write and the absence of a rule are not things a behavioural case can
 * show.
 *
 * The ruling's record is read back the way the product reads it and not only through raw SQL: the
 * appended event is fetched through `../events/list-events`, and the appealed report through
 * `../reports/report-repository`'s `getReport`, so a case fails if the module writes a row the
 * package's own readers cannot see. The stored payload is compared to `canonicalize`'s rendering of
 * the object the module intends, which is the single canonicalisation point
 * `../events/append-event` writes through — the reason that import belongs here rather than in
 * `rule-appeal.ts`, and the assertion a double-encoded payload cannot pass.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPEAL_RULINGS, type AppealRuling } from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listEvents } from "../events/list-events";
import { getReport, type StoredReport } from "../reports/report-repository";
import { canonicalize } from "../scoring/canonical-json";
import { openAppeal, type Appeal } from "./open-appeal";
import { AppealAlreadyRuledError, AppealNotFoundError, ruleAppeal } from "./rule-appeal";

/** The ordered migration files, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL("../../../../packages/shared/migrations/", import.meta.url));

/** The developer the report's listing belongs to, and the account that opens the appeal. */
const OWNER_DEVELOPER_ID = "demo-developer-owner";

/** The operator that rules the appeal: the only role the ruling route admits. */
const OPERATOR_ID = "demo-operator";

/** An account id no `accounts` row carries, which the appended event's foreign key therefore refuses. */
const UNSEEDED_OPERATOR_ID = "operator-that-was-never-seeded";

/** The report the appeals below are opened against. */
const REPORT_ID = "report-seed-alpha-first-run";

/**
 * How many `report_case_results` rows the fixture writes for the report above: the per-case evidence
 * criterion 4 requires to survive a ruling byte for byte. A fixture without evidence would let the
 * immutability case pass over an empty set, so the count is declared and asserted rather than left to
 * whatever the insert statements happen to add.
 */
const FIXTURE_CASE_RESULT_COUNT = 2;

/** An id no `appeals` row carries. */
const UNKNOWN_APPEAL_ID = "appeal-that-was-never-opened";

/**
 * The developer's stated ground, carrying surrounding whitespace and an internal newline: it is
 * evidence stored exactly as submitted, so a ruling must leave it byte for byte.
 */
const DEVELOPER_REASON =
  "  The two failing cases read inputs this version does not accept;\n  the ground is unclear.  ";

/** The operator's stated ground for a ruling, which travels into the appended event only. */
const RULING_REASON = "The per-case evidence the report records does not support the challenge.";

/**
 * The two outcomes a ruling may set, in the order `@adem/shared` declares them. A case reads a member
 * of this list, and the list is asserted against the shared vocabulary below, so an outcome added to
 * or removed from the closed tuple fails here rather than passing a suite that tests neither.
 */
const RULINGS: AppealRuling[] = ["upheld", "denied"];

/**
 * The outcome an appeal is first ruled with and the outcome a second ruling attempts: both
 * directions of "the same outcome again" and "the opposite outcome", because a ruling is final and
 * neither is a second ruling the contract admits.
 */
const RULING_ATTEMPTS: [AppealRuling, AppealRuling][] = [
  ["upheld", "upheld"],
  ["upheld", "denied"],
  ["denied", "denied"],
  ["denied", "upheld"],
];

/** The stored shape of one `appeals` row. */
interface StoredAppealRow {
  readonly id: string;
  readonly report_id: string;
  readonly developer_account_id: string;
  readonly reason: string;
  readonly status: string;
  readonly created_at: string;
}

/** The stored shape of one `evaluation_reports` row, whole, so a change to any column is visible. */
interface StoredReportRow {
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

/** The stored shape of one `governance_events` row, as `0007` declares its columns. */
interface StoredEventRow {
  readonly id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly event_type: string;
  readonly actor_account_id: string;
  readonly reason: string | null;
  readonly payload_json: string | null;
  readonly created_at: string;
}

/**
 * The stored shape of one `report_case_results` row, whole, so a case can compare the evidence of the
 * appealed report — expected output, recorded output and match — byte for byte across a ruling.
 */
interface StoredCaseResultRow {
  readonly id: string;
  readonly report_id: string;
  readonly case_id: string;
  readonly severity: string;
  readonly expected_json: string;
  readonly actual_json: string;
  readonly match: number;
}

/** How many rows one `COUNT(*)` query reports. */
interface CountRow {
  readonly count: number;
}

/**
 * The tables no statement of the ruling path may name, each because it belongs to the measurement
 * rather than to the appeal: the appealed report and its per-case results are append-only, and the
 * ruling's record lives in `governance_events` instead. A statement naming either would mean the
 * ruling had begun to touch the evidence it rules on.
 */
const TABLES_THE_RULING_PATH_MUST_NOT_TOUCH = ["evaluation_reports", "report_case_results"] as const;

let db: Database.Database;

/**
 * Every SQL source string the module under test prepared, in the order it prepared them.
 *
 * Filled by {@link installPrepareRecorder}, and the only way to assert the absence of a write: a
 * behavioural case shows what a call wrote, never which tables it left alone on the way.
 */
let preparedStatements: string[] = [];

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** Writes the rows the report references, the operator that rules it, then the report itself. */
function insertFixture(database: Database.Database): void {
  const account = database.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)");
  account.run(OWNER_DEVELOPER_ID, "demo-owner", "developer", "Demo owner");
  account.run(OPERATOR_ID, "demo-operator", "operator", "Demo operator");
  database.prepare("INSERT INTO categories (id, slug, name) VALUES (?, ?, ?)").run("cat-a", "cat-a", "Demo category");
  database
    .prepare(
      `INSERT INTO listings
         (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "listing-owner",
      OWNER_DEVELOPER_ID,
      "demo-listing",
      "Demo listing",
      "A synthetic listing",
      "cat-a",
      "MIT",
      "purchase",
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    );
  database
    .prepare(
      "INSERT INTO listing_versions (id, listing_id, version_string, notes, is_fixture_candidate, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("version-seed-alpha", "listing-owner", "1.0.0", "First version", 1, "2024-01-02T00:00:00.000Z");
  database
    .prepare("INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)")
    .run("standard-sgi-so", "SGI-SO-1.0.0", "Structured Output Conformance", "The one provisional standard");
  database
    .prepare(
      `INSERT INTO standard_versions
         (id, standard_id, version_label, status, total_cases, critical_cases, pass_threshold_matches,
          critical_failures_allowed, rubric_reference, definition_json, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "standard-version-sgi-so-1.0.0",
      "standard-sgi-so",
      "1.0.0",
      "provisional",
      20,
      5,
      18,
      0,
      "SGI-SO-1.0.0#rubric",
      "{}",
      "2024-01-03T00:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO evaluation_reports
         (id, candidate_version_id, standard_version_id, outcome, matched_count, total_count,
          critical_failures, label, rubric_reference, prior_report_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      REPORT_ID,
      "version-seed-alpha",
      "standard-version-sgi-so-1.0.0",
      "FAIL",
      2,
      20,
      5,
      "SAMPLE",
      "SGI-SO-1.0.0#rubric",
      null,
      "2024-01-04T00:00:00.000Z",
    );

  // Two case-result rows for that report: one case that matched and one critical case that did not,
  // which is the evidence the report's FAIL rests on. Both carry fixed canonical JSON text rather
  // than values rendered here, because the stored string is the artefact the evaluator compared and a
  // re-rendering would prove nothing about the copy a ruling must leave alone.
  const caseResult = database.prepare(
    `INSERT INTO report_case_results (id, report_id, case_id, severity, expected_json, actual_json, match)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  caseResult.run("case-result-so-001", REPORT_ID, "so-001", "critical", '{"answer":"yes"}', '{"answer":"yes"}', 1);
  caseResult.run("case-result-so-002", REPORT_ID, "so-002", "critical", '{"count":3}', '{"count":2}', 0);
}

/** Opens one appeal through the real opener, which is the row and the log a ruling starts from. */
function openFixtureAppeal(): Appeal {
  return openAppeal(db, {
    reportId: REPORT_ID,
    developerAccountId: OWNER_DEVELOPER_ID,
    reason: DEVELOPER_REASON,
  });
}

/**
 * Every stored appeal row, in the order the appeals were opened.
 *
 * The order is `created_at` then `rowid` rather than `created_at` then `id`, which is the order the
 * product's own log reader uses: two appeals opened inside the same millisecond carry distinct
 * random ids, and ordering those by id would order the trail by chance.
 */
function readAppealRows(): StoredAppealRow[] {
  return db
    .prepare<[], StoredAppealRow>(
      `SELECT id, report_id, developer_account_id, reason, status, created_at
       FROM appeals
       ORDER BY created_at, rowid`,
    )
    .all();
}

/** One stored appeal row by id, failing the case rather than the assertion when it is absent. */
function readAppealRow(appealId: string): StoredAppealRow {
  const row = db
    .prepare<[string], StoredAppealRow>(
      `SELECT id, report_id, developer_account_id, reason, status, created_at
       FROM appeals
       WHERE id = ?`,
    )
    .get(appealId);
  if (row === undefined) {
    throw new Error(`expected the appeals table to hold ${appealId}`);
  }
  return row;
}

/** The stored report, whole, so a case can compare it byte for byte before and after a call. */
function readReportRow(): StoredReportRow {
  const row = db.prepare<[string], StoredReportRow>("SELECT * FROM evaluation_reports WHERE id = ?").get(REPORT_ID);
  if (row === undefined) {
    throw new Error("expected the fixture to hold the report");
  }
  return row;
}

/**
 * The appealed report's per-case evidence, whole, in `case_id` order.
 *
 * The order is the case's own rather than the order the rows were written in, so a change a ruling
 * made to an evidence row reads as a changed value rather than as a shifted position, and two
 * snapshots of an untouched table compare equal whichever order the engine would have returned them
 * in.
 */
function readCaseResultRows(): StoredCaseResultRow[] {
  return db
    .prepare<[string], StoredCaseResultRow>(
      `SELECT id, report_id, case_id, severity, expected_json, actual_json, match
       FROM report_case_results
       WHERE report_id = ?
       ORDER BY case_id`,
    )
    .all(REPORT_ID);
}

/**
 * The appealed report through the package's own reader, failing the case rather than the assertion
 * when the reader answers nothing.
 *
 * The same report the raw read above returns, but as `GET /evaluations/{id}` serves it: the label the
 * contract quotes resolved through the join, and the evidence mapped to its public shape. Asserting
 * only through raw SQL would prove the columns are untouched while leaving a reader that could no
 * longer see the row untested.
 */
function readStoredReport(): StoredReport {
  const report = getReport(db, REPORT_ID);
  if (report === null) {
    throw new Error("expected the package's own reader to return the fixture's report");
  }
  return report;
}

/**
 * Every stored governance event, in the order the log was written.
 *
 * Ordered by `created_at` then `rowid`, which is insertion order even where two events share an
 * instant — an opening and the ruling that answers it are often written inside the same millisecond,
 * and `governance_events` is read back as a trail rather than as a set. The statement is
 * parameterised with the row shape rather than its result cast to it, so the reader's own typing is
 * checked against the columns it selects.
 */
function readEventRows(): StoredEventRow[] {
  return db
    .prepare<[], StoredEventRow>(
      `SELECT id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at
       FROM governance_events
       ORDER BY created_at, rowid`,
    )
    .all();
}

/** The stored events of one type, so a case can assert the ruling's row rather than "some row". */
function readEventsOfType(eventType: string): StoredEventRow[] {
  return readEventRows().filter((row) => row.event_type === eventType);
}

/** The first event the log holds, failing the case rather than the assertion when the log is empty. */
function firstEventRow(): StoredEventRow {
  const row = readEventRows()[0];
  if (row === undefined) {
    throw new Error("expected the governance log to hold a row");
  }
  return row;
}

/** The only ruling the log holds, failing the case rather than the assertion when it holds none. */
function firstRulingRow(): StoredEventRow {
  const row = readEventsOfType("appeal_ruled")[0];
  if (row === undefined) {
    throw new Error("expected the governance log to hold an appeal_ruled row");
  }
  return row;
}

/** The payload text of the only ruling, failing the case when it stores none. */
function rulingPayloadText(): string {
  const { payload_json: payloadJson } = firstRulingRow();
  if (payloadJson === null) {
    throw new Error("expected the appended ruling to store a payload");
  }
  return payloadJson;
}

/** How many case results the fixture holds, read back so a case can assert a ruling wrote none. */
function countCaseResults(): number {
  const row = db.prepare<[], CountRow>("SELECT COUNT(*) AS count FROM report_case_results").get();
  if (row === undefined) {
    throw new Error("expected COUNT(*) to return one row");
  }
  return row.count;
}

/** How many triggers guard a table, by whatever names a migration gave them. */
function triggerCount(table: string): number {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table);
  return rows.length;
}

/**
 * Records the SQL source of every statement prepared through `db` from this point on.
 *
 * `prepare` is captured from the instance and replaced with an own property that delegates, rather
 * than spied on through the prototype: better-sqlite3 declares `prepare` on `Database.prototype`,
 * where a spy does not reliably attach. Install this after the migrations and the fixture — in a
 * test body, not in `beforeEach` — and copy {@link preparedStatements} immediately after the call
 * under test returns or throws, before a helper query of this suite prepares a statement of its own
 * and lands in the record.
 */
function installPrepareRecorder(): void {
  const original = db.prepare.bind(db) as unknown as (source: string) => unknown;

  preparedStatements = [];
  (db as unknown as { prepare: (source: string) => unknown }).prepare = (source: string) => {
    preparedStatements.push(source);
    return original(source);
  };
}

/**
 * One recorded statement, failing the case rather than the assertion when the record is short: an
 * index read is `string | undefined` under `noUncheckedIndexedAccess`, and a case that asserted
 * against an absent statement would assert nothing at all.
 */
function recordedStatement(record: readonly string[], index: number): string {
  const source = record[index];
  if (source === undefined) {
    throw new Error(`expected the recorder to hold a statement at index ${index}, and it holds ${record.length}`);
  }
  return source;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  insertFixture(db);
});

afterEach(() => {
  db.close();
});

describe("ruleAppeal", () => {
  it("takes its outcomes from the vocabulary @adem/shared declares", () => {
    // The ruling body's `enum` is this tuple, so a case list that had drifted from it would be
    // testing an outcome the contract cannot carry — or missing one it can.
    expect(RULINGS).toStrictEqual([...APPEAL_RULINGS]);
  });

  it.each(RULINGS)("moves the stored status to %s, returns the ruling, and appends one event", (ruling) => {
    const appeal = openFixtureAppeal();
    const rowBefore = readAppealRow(appeal.id);
    expect(readEventRows()).toHaveLength(1);

    const ruled = ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling,
      reason: RULING_REASON,
    });

    expect(readAppealRows()).toHaveLength(1);
    expect(readAppealRow(appeal.id)).toStrictEqual({ ...rowBefore, status: ruling });
    expect(ruled).toStrictEqual({
      id: appeal.id,
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: DEVELOPER_REASON,
      status: ruling,
      createdAt: appeal.createdAt,
    });

    // The log holds the opening and the ruling, in that order: a ruling records a decision in the
    // same trail rather than moving the appeal out of it, and it appends a row of its own rather than
    // rewriting the opening's. The count is two rather than one because the fixture opens through the
    // real `openAppeal`, which records the opening in this same log; what the ruling adds is the one
    // row asserted here, so the delta is asserted rather than the total.
    expect(readEventRows()).toHaveLength(2);
    expect(readEventRows().map((row) => row.event_type)).toStrictEqual(["appeal_opened", "appeal_ruled"]);
    expect(readEventsOfType("appeal_ruled")).toHaveLength(1);
    const event = firstRulingRow();
    expect(event.subject_type).toBe("appeal");
    expect(event.subject_id).toBe(appeal.id);
    expect(event.actor_account_id).toBe(OPERATOR_ID);
    expect(event.reason).toBe(RULING_REASON);
    expect(event.id).not.toBe(firstEventRow().id);
    // The row's identity is generated rather than derived from the appeal: a version-4 UUID, as the
    // package's only appender builds it, and an ISO-8601 UTC instant with milliseconds.
    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(event.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(event.created_at))).toBe(false);

    // The same record read back the way the product reads it, through the package's own read path
    // rather than by this suite's SQL: the filtered read returns exactly the ruling's event, and the
    // subject read returns the appeal's whole trail, its opening first. A ruling that wrote a row
    // `listEvents` could not return, or wrote it against another subject, fails here.
    expect(
      listEvents(db, { subjectType: "appeal", subjectId: appeal.id, eventType: "appeal_ruled" }),
    ).toStrictEqual([
      {
        id: event.id,
        subjectType: "appeal",
        subjectId: appeal.id,
        eventType: "appeal_ruled",
        actorAccountId: OPERATOR_ID,
        reason: RULING_REASON,
        payload: { appealId: appeal.id, reportId: REPORT_ID, previousStatus: "open", status: ruling },
        createdAt: event.created_at,
      },
    ]);
    expect(
      listEvents(db, { subjectType: "appeal", subjectId: appeal.id }).map((trail) => trail.eventType),
    ).toStrictEqual(["appeal_opened", "appeal_ruled"]);

    // One transaction, two writes: the row's new state and the event that records it are both present
    // after the call and name the same outcome, which is the observable consequence of the two being
    // written together — a reader can see neither the status moved without its record nor the record
    // without the status. The rollback case below reads the same pair the other way round.
    expect(JSON.parse(rulingPayloadText())).toMatchObject({
      appealId: appeal.id,
      previousStatus: "open",
      status: readAppealRow(appeal.id).status,
    });
  });

  it.each(RULINGS)("carries %s in the event's payload as a canonical object naming the prior status", (ruling) => {
    const appeal = openFixtureAppeal();

    ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling,
      reason: RULING_REASON,
    });

    // Two assertions, deliberately: the parsed members name the member that is wrong, and the stored
    // text is compared to `canonicalize`'s own rendering of the object the module intends, which is
    // the single canonicalisation point `../events/append-event` writes through. The second form is
    // what a double-encoded payload — the JSON of a string rather than the JSON of the object — cannot
    // pass, and it is why the oracle is imported here rather than written into `rule-appeal.ts`.
    expect(JSON.parse(rulingPayloadText())).toStrictEqual({
      appealId: appeal.id,
      reportId: REPORT_ID,
      previousStatus: "open",
      status: ruling,
    });
    expect(rulingPayloadText()).toBe(
      canonicalize({ appealId: appeal.id, reportId: REPORT_ID, previousStatus: "open", status: ruling }),
    );
  });

  it.each(RULINGS)("leaves the appealed report and its evidence byte-identical when it rules %s", (ruling) => {
    const appeal = openFixtureAppeal();
    const reportBefore = readReportRow();
    const caseResultsBefore = readCaseResultRows();
    const storedBefore = readStoredReport();
    expect(caseResultsBefore).toHaveLength(FIXTURE_CASE_RESULT_COUNT);

    ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling,
      reason: RULING_REASON,
    });

    // The immutability guarantee the appeal exists to demonstrate: the measurement, and the per-case
    // evidence its outcome rests on, are re-read whole and unchanged in every column, while the
    // appeal's own row has moved on.
    expect(readReportRow()).toStrictEqual(reportBefore);
    expect(readCaseResultRows()).toStrictEqual(caseResultsBefore);
    expect(countCaseResults()).toBe(FIXTURE_CASE_RESULT_COUNT);

    // And unchanged through the package's own reader, which is the copy a buyer is served once the
    // ruling has been recorded: a report the reader could no longer fetch, or one whose mapped
    // evidence had moved, fails here rather than only in the API's own immutability suite.
    expect(readStoredReport()).toStrictEqual(storedBefore);

    expect(readAppealRow(appeal.id).status).toBe(ruling);
    expect(readAppealRow(appeal.id).reason).toBe(DEVELOPER_REASON);
  });

  it("rules only the appeal it names, leaving a second appeal on the same report open", () => {
    const first = openFixtureAppeal();
    const second = openFixtureAppeal();
    const secondRowBefore = readAppealRow(second.id);

    ruleAppeal(db, {
      appealId: first.id,
      operatorAccountId: OPERATOR_ID,
      ruling: "upheld",
      reason: RULING_REASON,
    });

    // Two developers may contest one report and a ruling decides one challenge: the module's
    // single-column update is what leaves the second appeal awaiting its own ruling.
    expect(readAppealRow(first.id).status).toBe("upheld");
    expect(readAppealRow(second.id)).toStrictEqual(secondRowBefore);
    expect(readEventRows().map((row) => row.event_type)).toStrictEqual([
      "appeal_opened",
      "appeal_opened",
      "appeal_ruled",
    ]);
  });
});

describe("a second ruling on an appeal that already carries a terminal status", () => {
  it.each(RULING_ATTEMPTS)(
    "refuses %s on an appeal already ruled %s, naming the stored status and writing nothing",
    (first, second) => {
      const appeal = openFixtureAppeal();
      ruleAppeal(db, {
        appealId: appeal.id,
        operatorAccountId: OPERATOR_ID,
        ruling: first,
        reason: RULING_REASON,
      });
      const rowBefore = readAppealRow(appeal.id);
      const logBefore = readEventRows();

      installPrepareRecorder();
      let failure: unknown;
      try {
        ruleAppeal(db, {
          appealId: appeal.id,
          operatorAccountId: OPERATOR_ID,
          ruling: second,
          reason: RULING_REASON,
        });
      } catch (error) {
        failure = error;
      }
      const prepared = [...preparedStatements];

      expect(failure).toBeInstanceOf(AppealAlreadyRuledError);
      expect((failure as AppealAlreadyRuledError).code).toBe("already_ruled");
      expect((failure as AppealAlreadyRuledError).name).toBe("AppealAlreadyRuledError");
      // The stored status is what makes the refusal actionable, and it is the status the *first*
      // ruling set: the refused call is not the one that decided anything.
      expect((failure as AppealAlreadyRuledError).message).toContain(appeal.id);
      expect((failure as AppealAlreadyRuledError).message).toContain(`status ${first}`);

      // Nothing was written: the row and the log compare row for row with what the first ruling left.
      expect(readAppealRow(appeal.id)).toStrictEqual(rowBefore);
      expect(readEventRows()).toStrictEqual(logBefore);

      // And nothing was even prepared past the read: the guard runs inside the transaction, but
      // before either write is reached, so a refused ruling prepares no statement that could have
      // left a half-written decision behind.
      expect(prepared).toHaveLength(1);
      expect(recordedStatement(prepared, 0)).toMatch(/\bFROM appeals\b/);
      expect(prepared.filter((source) => /\bUPDATE\b/i.test(source))).toEqual([]);
      expect(prepared.filter((source) => /\bINSERT\b/i.test(source))).toEqual([]);
    },
  );

  it("refuses an unknown appeal id as not_found, which is the check that answers it", () => {
    const logBefore = readEventRows();

    installPrepareRecorder();
    let failure: unknown;
    try {
      ruleAppeal(db, {
        appealId: UNKNOWN_APPEAL_ID,
        operatorAccountId: OPERATOR_ID,
        ruling: "upheld",
        reason: RULING_REASON,
      });
    } catch (error) {
      failure = error;
    }
    const prepared = [...preparedStatements];

    expect(failure).toBeInstanceOf(AppealNotFoundError);
    // The absence is answered by the not-found check rather than by the already-ruled one: an id no
    // row carries has no status to report, so `already_ruled` would name a status that is not there.
    expect(failure).not.toBeInstanceOf(AppealAlreadyRuledError);
    expect((failure as AppealNotFoundError).code).toBe("not_found");
    expect((failure as AppealNotFoundError).name).toBe("AppealNotFoundError");
    expect((failure as AppealNotFoundError).message).toContain(UNKNOWN_APPEAL_ID);

    expect(readAppealRows()).toHaveLength(0);
    expect(readEventRows()).toStrictEqual(logBefore);
    expect(prepared).toHaveLength(1);
    expect(recordedStatement(prepared, 0)).toMatch(/\bFROM appeals\b/);
  });
});

describe("the statements ruleAppeal prepares", () => {
  it("reads the appeal, updates its status and appends the ruling, and prepares nothing else", () => {
    const appeal = openFixtureAppeal();

    installPrepareRecorder();
    ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling: "upheld",
      reason: RULING_REASON,
    });
    const prepared = [...preparedStatements];

    // The executable form of the module's own list: inside the one transaction, one `SELECT` on
    // `appeals`, one `UPDATE` on `appeals` and one `INSERT` into `governance_events`. Anything
    // else — a second read, a helper's lookup, a statement against another table — fails here.
    expect(prepared).toHaveLength(3);
    expect(recordedStatement(prepared, 0)).toMatch(/\bFROM appeals\b/);
    expect(recordedStatement(prepared, 1)).toMatch(/UPDATE appeals SET status = \? WHERE id = \?/);
    expect(recordedStatement(prepared, 2)).toMatch(/\bINSERT INTO governance_events\b/i);

    // The one write an append-only table accepts is a new row: a `DELETE` would remove one, and a
    // REPLACE-style conflict clause — which SQLite documents as bypassing a `BEFORE DELETE` trigger —
    // would go through without either trigger running. Neither clause appears in what a ruling
    // prepares, which is the assertion the row count alone cannot make.
    expect(prepared.filter((source) => /\bDELETE\b/i.test(source))).toEqual([]);
    expect(prepared.filter((source) => /INSERT\s+OR\s+REPLACE/i.test(source))).toEqual([]);
  });

  it("sets the status column and no other column of the appeals row", () => {
    const appeal = openFixtureAppeal();

    installPrepareRecorder();
    ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling: "upheld",
      reason: RULING_REASON,
    });
    const prepared = [...preparedStatements];

    // The UPDATE names one assignment, which is what keeps `reason` — the developer's evidence —
    // out of a ruling's reach even if the module's behaviour changed later.
    const update = prepared.filter((source) => /UPDATE appeals SET/i.test(source));
    expect(update).toHaveLength(1);
    expect(update[0]).toBe("UPDATE appeals SET status = ? WHERE id = ?");
  });

  it("prepares no statement naming the appealed report or its case results", () => {
    const appeal = openFixtureAppeal();

    installPrepareRecorder();
    ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling: "upheld",
      reason: RULING_REASON,
    });
    const prepared = [...preparedStatements];

    const forbiddenStatements = TABLES_THE_RULING_PATH_MUST_NOT_TOUCH.filter((table) =>
      prepared.some((source) => new RegExp(`\\b${table}\\b`).test(source)),
    );

    expect(forbiddenStatements).toEqual([]);
  });
});

describe("the transaction a ruling writes", () => {
  it("rolls the status change back when the appended event is refused, leaving the appeal open", () => {
    const appeal = openFixtureAppeal();
    const rowBefore = readAppealRow(appeal.id);
    const logBefore = readEventRows();

    installPrepareRecorder();
    let failure: unknown;
    try {
      ruleAppeal(db, {
        appealId: appeal.id,
        operatorAccountId: UNSEEDED_OPERATOR_ID,
        ruling: "upheld",
        reason: RULING_REASON,
      });
    } catch (error) {
      failure = error;
    }
    const prepared = [...preparedStatements];

    // The refusal comes from the database, on the `actor_account_id` foreign key of the appended
    // event rather than from a check in the module, so the failure lands between the two writes.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/FOREIGN KEY constraint failed/);
    // Both writes were reached — the record shows their statements were prepared — so the rollback
    // asserted below is the transaction's doing rather than an early return's.
    expect(prepared).toHaveLength(3);
    expect(recordedStatement(prepared, 1)).toMatch(/UPDATE appeals SET status = \? WHERE id = \?/);
    expect(recordedStatement(prepared, 2)).toMatch(/\bINSERT INTO governance_events\b/i);

    // One transaction, two writes: the status change is undone together with the event that would
    // have recorded it, and the appeal is left exactly as the opener wrote it.
    expect(db.inTransaction).toBe(false);
    expect(readAppealRow(appeal.id)).toStrictEqual(rowBefore);
    expect(rowBefore.status).toBe("open");
    expect(readEventRows()).toStrictEqual(logBefore);
    expect(readEventsOfType("appeal_ruled")).toEqual([]);
    expect(readEventRows()).toHaveLength(1);
    expect(firstEventRow().event_type).toBe("appeal_opened");
  });
});

describe("the append-only rule behind a ruling's event", () => {
  it("refuses an update and a delete of the ruling's row", () => {
    const appeal = openFixtureAppeal();
    ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling: "upheld",
      reason: RULING_REASON,
    });
    const event = firstRulingRow();

    // Defence in depth, not a security boundary: the guarantee is that no route offers the mutation,
    // and this is the guard-rail under it. Both attempts must be refused, and the row must survive
    // them byte for byte.
    expect(() => db.prepare("UPDATE governance_events SET reason = ? WHERE id = ?").run("rewritten", event.id)).toThrow(
      /governance_events is append-only: rows may not be updated/,
    );
    expect(() => db.prepare("DELETE FROM governance_events WHERE id = ?").run(event.id)).toThrow(
      /governance_events is append-only: rows may not be deleted/,
    );
    expect(firstRulingRow()).toStrictEqual(event);
  });

  it("leaves the appeals row unguarded, which is what keeps a ruling's status update legal", () => {
    // The difference between the two tables is the point: `governance_events` carries both triggers,
    // and `appeals` carries none, because its `status` is the one column a ruling writes.
    expect(triggerCount("governance_events")).toBe(2);
    expect(triggerCount("appeals")).toBe(0);
  });
});

describe("the operator's stated ground", () => {
  it("stores an empty-string reason as stated, while the row keeps the developer's reason", () => {
    const appeal = openFixtureAppeal();

    const ruled = ruleAppeal(db, {
      appealId: appeal.id,
      operatorAccountId: OPERATOR_ID,
      ruling: "denied",
      reason: "",
    });
    const event = firstRulingRow();

    // No emptiness rule is imposed on a ruling's reason: an appeal ruled with no stated ground is a
    // terse decision recorded as such rather than a refusal, and the absence is stored as the empty
    // string rather than as the null the schema reserves for the kinds that decide by what they point
    // at. The rule the opener does impose on a developer's reason is untouched by this.
    expect(event.reason).toBe("");
    expect(event.reason).not.toBeNull();
    expect(event.reason).not.toBe(DEVELOPER_REASON);
    expect(JSON.parse(rulingPayloadText())).toStrictEqual({
      appealId: appeal.id,
      reportId: REPORT_ID,
      previousStatus: "open",
      status: "denied",
    });

    // The developer's ground is untouched by what the operator did or did not state.
    expect(readAppealRow(appeal.id).reason).toBe(DEVELOPER_REASON);
    expect(ruled.reason).toBe(DEVELOPER_REASON);
  });
});
