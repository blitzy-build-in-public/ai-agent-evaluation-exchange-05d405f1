/**
 * Unit tests for the appeal-opening writer.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because what this module promises is a statement
 * executed against a real schema: the shape of the row it writes, the status a fresh
 * appeal carries, the verbatim reason, and the report the call leaves untouched are all
 * properties of the tables rather than of the function alone.
 *
 * The fixture is what a report needs and no more — an account, a category, a listing and
 * one version of it, a standard and one version of that, and the report itself — so an
 * appeal is opened here exactly as a write route opens one.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOVERNANCE_EVENT_TYPES } from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidAppealError, ReportNotFoundError, openAppeal, type Appeal } from "./open-appeal";

/** The ordered migration files, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL("../../../../packages/shared/migrations/", import.meta.url));

/** The developer the report's listing belongs to. */
const OWNER_DEVELOPER_ID = "demo-developer-owner";

/** A second synthetic developer that owns no listing at all. */
const BYSTANDER_DEVELOPER_ID = "demo-developer-bystander";

/** The report the appeals below are opened against. */
const REPORT_ID = "report-seed-alpha-first-run";

/** An id no `evaluation_reports` row carries. */
const UNKNOWN_REPORT_ID = "report-that-was-never-written";

/** A stated ground with surrounding whitespace, stored exactly as submitted. */
const REASON = "  The two failing cases read inputs this version does not accept; the ground is unclear.  ";

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

let db: Database.Database;

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** Writes the rows a report references, then the report itself. */
function insertFixture(database: Database.Database): void {
  const account = database.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)");
  account.run(OWNER_DEVELOPER_ID, "demo-owner", "developer", "Demo owner");
  account.run(BYSTANDER_DEVELOPER_ID, "demo-bystander", "developer", "Demo bystander");
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
}

/** Every stored appeal, in the order the appeals were opened. */
function readAppealRows(): StoredAppealRow[] {
  return db
    .prepare(
      `SELECT id, report_id, developer_account_id, reason, status, created_at
       FROM appeals
       ORDER BY created_at, id`,
    )
    .all() as StoredAppealRow[];
}

/** The only stored appeal, failing the case rather than the assertion when there is none. */
function firstAppealRow(): StoredAppealRow {
  const row = readAppealRows()[0];
  if (row === undefined) {
    throw new Error("expected the appeals table to hold a row");
  }
  return row;
}

/** The stored report, whole, so a case can compare it byte for byte before and after a call. */
function readReportRow(): StoredReportRow {
  const row = db.prepare("SELECT * FROM evaluation_reports WHERE id = ?").get(REPORT_ID) as
    | StoredReportRow
    | undefined;
  if (row === undefined) {
    throw new Error("expected the fixture to hold the report");
  }
  return row;
}

/** How many governance events the log holds. */
function countGovernanceEvents(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM governance_events").get() as { readonly n: number };
  return row.n;
}

/** How many triggers guard a table, by whatever names a migration gave them. */
function triggerCount(table: string): number {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table);
  return rows.length;
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

describe("openAppeal", () => {
  it("inserts exactly one appeal in status open and returns it", () => {
    const appeal: Appeal = openAppeal(db, {
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: REASON,
    });
    const rows = readAppealRows();

    expect(rows).toHaveLength(1);
    expect(firstAppealRow()).toStrictEqual({
      id: appeal.id,
      report_id: REPORT_ID,
      developer_account_id: OWNER_DEVELOPER_ID,
      reason: REASON,
      status: "open",
      created_at: appeal.createdAt,
    });
  });

  it("generates a UUID identifier and an ISO-8601 UTC instant for the row", () => {
    const appeal = openAppeal(db, {
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: REASON,
    });

    expect(appeal.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(appeal.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(appeal.createdAt))).toBe(false);
    expect(firstAppealRow().created_at).toBe(appeal.createdAt);
  });

  it("returns the appeal from its input and the values it generated", () => {
    const appeal = openAppeal(db, {
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: REASON,
    });

    expect(appeal).toStrictEqual({
      id: appeal.id,
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: REASON,
      status: "open",
      createdAt: appeal.createdAt,
    });
  });

  it("stores the developer's reason verbatim, untrimmed", () => {
    openAppeal(db, { reportId: REPORT_ID, developerAccountId: OWNER_DEVELOPER_ID, reason: REASON });

    expect(firstAppealRow().reason).toBe(REASON);
    expect(firstAppealRow().reason).not.toBe(REASON.trim());
  });

  it("leaves the appealed report byte-identical", () => {
    const before = readReportRow();

    openAppeal(db, { reportId: REPORT_ID, developerAccountId: OWNER_DEVELOPER_ID, reason: REASON });

    expect(readReportRow()).toStrictEqual(before);
  });

  it("appends no governance event, though the shared vocabulary declares appeal_opened", () => {
    openAppeal(db, { reportId: REPORT_ID, developerAccountId: OWNER_DEVELOPER_ID, reason: REASON });

    expect(GOVERNANCE_EVENT_TYPES).toContain("appeal_opened");
    expect(countGovernanceEvents()).toBe(0);
  });

  it("does not verify that the named developer owns the report", () => {
    const appeal = openAppeal(db, {
      reportId: REPORT_ID,
      developerAccountId: BYSTANDER_DEVELOPER_ID,
      reason: REASON,
    });

    expect(appeal.developerAccountId).toBe(BYSTANDER_DEVELOPER_ID);
    expect(firstAppealRow().developer_account_id).toBe(BYSTANDER_DEVELOPER_ID);
  });

  it("opens a second appeal against the same report, leaving the first row unchanged", () => {
    const first = openAppeal(db, {
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: REASON,
    });
    const firstRowBefore = firstAppealRow();

    const second = openAppeal(db, {
      reportId: REPORT_ID,
      developerAccountId: OWNER_DEVELOPER_ID,
      reason: "A second reading of the same evidence.",
    });
    const rows = readAppealRows();

    expect(rows).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id].sort());
    expect(rows).toContainEqual(firstRowBefore);
  });

  it.each(["", " ", "\n\t  "])("refuses %j as a reason, writing nothing", (reason) => {
    let failure: unknown;

    try {
      openAppeal(db, { reportId: REPORT_ID, developerAccountId: OWNER_DEVELOPER_ID, reason });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InvalidAppealError);
    expect((failure as InvalidAppealError).code).toBe("invalid_appeal");
    expect((failure as InvalidAppealError).name).toBe("InvalidAppealError");
    expect((failure as InvalidAppealError).field).toBe("reason");
    expect(readAppealRows()).toHaveLength(0);
  });

  it("refuses a blank reason before it reads the report", () => {
    expect(() =>
      openAppeal(db, { reportId: UNKNOWN_REPORT_ID, developerAccountId: OWNER_DEVELOPER_ID, reason: "   " }),
    ).toThrow(InvalidAppealError);
    expect(readAppealRows()).toHaveLength(0);
  });

  it("refuses an unknown report id and writes nothing", () => {
    let failure: unknown;

    try {
      openAppeal(db, { reportId: UNKNOWN_REPORT_ID, developerAccountId: OWNER_DEVELOPER_ID, reason: REASON });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ReportNotFoundError);
    expect((failure as ReportNotFoundError).code).toBe("not_found");
    expect((failure as ReportNotFoundError).name).toBe("ReportNotFoundError");
    expect((failure as ReportNotFoundError).message).toContain(UNKNOWN_REPORT_ID);
    expect(readAppealRows()).toHaveLength(0);
  });
});

describe("the appeals table openAppeal writes", () => {
  it("closes the status vocabulary to the three outcomes an appeal can hold", () => {
    const insert = db.prepare(
      `INSERT INTO appeals (id, report_id, developer_account_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    expect(() =>
      insert.run("appeal-a", REPORT_ID, OWNER_DEVELOPER_ID, REASON, "escalated", "2024-01-05T00:00:00.000Z"),
    ).toThrow(/CHECK constraint failed/);
  });

  it("carries no append-only trigger, which is what keeps a ruling's update legal", () => {
    expect(triggerCount("appeals")).toBe(0);
  });
});
