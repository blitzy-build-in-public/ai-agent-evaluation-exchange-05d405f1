/**
 * Unit tests for the standard registry: what `registerStandardVersion` writes — the version row and
 * the `standard_version_published` event that announces it — what its four read paths answer, and the
 * two ways a standard version can be refused.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because what is asserted here is largely a property of the
 * delivered schema rather than of a function alone: the eleven columns a registration fills, the
 * `UNIQUE (standard_id, version_label)` pair that makes a repeated registration idempotent, the
 * three cross-column CHECKs a synthetic version has to satisfy before it can be stored at all, the
 * two `RAISE(ABORT)` triggers that make a published row unrewritable, and the foreign key from
 * `governance_events.actor_account_id` to `accounts.id` that the publication's event has to satisfy.
 * No table is created by hand, so a column the migrations do not declare fails this suite loudly
 * instead of being papered over by a fixture that agrees with the code.
 *
 * Applying the migration files is this package's only filesystem access, and it belongs in a test
 * module: the runner lives in `apps/api/src/db/migrate.ts`, which this package may not import, the
 * unit suite starts no server and opens no database file, and `packages/shared/migrations` owns the
 * schema, so this package declares no DDL of its own. Paths resolve from this module's own location
 * rather than from the working directory.
 *
 * The guarantee the file proves is that of the evidence a published outcome rests on: a version is
 * registered as the criteria row the evaluator reads, its publication is recorded once in the
 * append-only governance log, `getStandardCaseSet` is the only path by which `apps/api` reaches a
 * fixture set, and neither a re-registration nor an update nor a delete can rewrite the criteria an
 * existing report was scored against.
 *
 * Each case opens its own in-memory connection and closes it again, so no case depends on a row
 * another left behind. Nothing here reads a clock, a network, an environment variable or a locale,
 * and the numbers and identifiers the cases expect are written as literals.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SGI_SO_1_0_0, type StandardVersionDefinition } from "./sgi-so-1.0.0";
import {
  StandardDriftError,
  UnknownStandardError,
  getStandard,
  getStandardCaseSet,
  getStandardVersion,
  listStandards,
  registerStandardVersion,
} from "./standard-registry";

/**
 * The delivered migrations, resolved from this module's own location rather than from the working
 * directory, so the schema under test is the one the repository ships wherever the run was started.
 */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

/**
 * Applies every migration in filename order.
 *
 * A directory that cannot be read, or one holding no `.sql` file, is an error rather than an empty
 * schema: no table is created by hand anywhere in this suite, so a migration set that went missing
 * has to fail here instead of leaving every case to pass against nothing.
 */
function applyMigrations(database: Database.Database): void {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`the migrations directory ${migrationsDir} holds no .sql file to apply`);
  }
  for (const file of files) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** A row of `standard_versions`, typed as the migration declares its columns. */
interface StandardVersionRow {
  readonly id: string;
  readonly standard_id: string;
  readonly version_label: string;
  readonly status: string;
  readonly total_cases: number;
  readonly critical_cases: number;
  readonly pass_threshold_matches: number;
  readonly critical_failures_allowed: number;
  readonly rubric_reference: string;
  readonly definition_json: string;
  readonly published_at: string;
}

/** A row of `standards`, typed as the migration declares its columns. */
interface StandardRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly summary: string;
}

/** The single column a `COUNT(*)` query returns. */
interface CountRow {
  readonly count: number;
}

let db: Database.Database;

/** One stored version, read without the registry, failing the case rather than the assertion for an unknown id. */
function storedVersion(id: string): StandardVersionRow {
  const row = db
    .prepare<[string], StandardVersionRow>(
      `SELECT id, standard_id, version_label, status, total_cases, critical_cases,
              pass_threshold_matches, critical_failures_allowed, rubric_reference, definition_json,
              published_at
         FROM standard_versions
        WHERE id = ?`,
    )
    .get(id);
  if (row === undefined) {
    throw new Error(`expected standard_versions to hold a row with id ${id}`);
  }
  return row;
}

/** Every catalogue row, ordered by code, read without the registry. */
function standardRows(): StandardRow[] {
  return db
    .prepare<[], StandardRow>("SELECT id, code, title, summary FROM standards ORDER BY code ASC")
    .all();
}

/** The identifier of the one catalogue row, failing the case when the catalogue holds none or several. */
function onlyStandardRowId(): string {
  const [row, ...rest] = standardRows();
  if (row === undefined || rest.length > 0) {
    throw new Error(`expected exactly one standards row, found ${rest.length + (row === undefined ? 0 : 1)}`);
  }
  return row.id;
}

/** How many version rows are stored, read without the registry. */
function versionCount(): number {
  const row = db.prepare<[], CountRow>("SELECT COUNT(*) AS count FROM standard_versions").get();
  if (row === undefined) {
    throw new Error("expected the count query to return a row");
  }
  return row.count;
}

/**
 * The `accounts.id` this suite publishes under, planted before each case.
 *
 * `governance_events.actor_account_id` is `NOT NULL REFERENCES accounts (id)` in
 * `packages/shared/migrations/0007_governance_events_and_appeals.sql`, and the connection below
 * enforces foreign keys, so a publication with no account row to name would be refused by the
 * schema rather than appended. The handle and the label are fictional, as every demo row's are.
 */
const PUBLISHER_ACCOUNT_ID = "account-unit-publisher";

/** A row of `governance_events`, typed as the migration declares its columns. */
interface GovernanceEventRow {
  readonly id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly event_type: string;
  readonly actor_account_id: string;
  readonly reason: string | null;
  readonly payload_json: string | null;
  readonly created_at: string;
}

/** Every `governance_events` row, in insertion order, read without the registry. */
function governanceEvents(): GovernanceEventRow[] {
  return db
    .prepare<[], GovernanceEventRow>(
      `SELECT id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at
         FROM governance_events
        ORDER BY rowid ASC`,
    )
    .all();
}

/**
 * The payload one appended event carries, parsed.
 *
 * The column holds serialized JSON text or SQL `NULL`, so a reader that asserted on it directly would
 * be comparing a string; a row that carries no payload at all fails here with that fact rather than
 * with a parser's own error.
 */
function payloadOf(event: GovernanceEventRow): unknown {
  if (event.payload_json === null) {
    throw new Error(`the appended ${event.event_type} governance event carries no payload`);
  }
  return JSON.parse(event.payload_json) as unknown;
}

/**
 * The value a call expected to refuse threw, or a failure when the call returned instead.
 *
 * The caught value is deliberately not narrowed here: each case asserts the class it expects with
 * its own `toBeInstanceOf`, so a refusal of the wrong kind fails the case rather than being cast
 * into looking like the expected one.
 */
function refusalFrom(attempt: () => unknown): unknown {
  let threw = false;
  let refusal: unknown;
  try {
    attempt();
  } catch (error) {
    threw = true;
    refusal = error;
  }
  if (!threw) {
    throw new Error("expected the call to refuse, but it returned");
  }
  return refusal;
}

beforeEach(() => {
  db = new Database(":memory:");
  // SQLite leaves foreign keys off by default, and every version row references the catalogue row
  // the same registration inserts — while the publication's governance event references the account
  // planted here.
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  db.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)").run(
    PUBLISHER_ACCOUNT_ID,
    "unit-operator",
    "operator",
    "Synthetic demo operator",
  );
});

afterEach(() => {
  db.close();
});

describe("the standard registry against the delivered schema", () => {
  it("registers SGI-SO-1.0.0 as the criteria row the evaluator reads, under one catalogue row", () => {
    const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    expect(versionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const row = storedVersion(versionId);
    expect(row.version_label).toBe("SGI-SO-1.0.0");
    expect(row.status).toBe("provisional");
    expect(row.total_cases).toBe(20);
    expect(row.critical_cases).toBe(5);
    expect(row.pass_threshold_matches).toBe(18);
    expect(row.critical_failures_allowed).toBe(0);
    expect(row.rubric_reference).toBe("SGI-SO-1.0.0#rubric");
    expect(row.published_at).toBe("2024-06-01T00:00:00.000Z");
    // The row is the evaluator's authority and the document beside it is its second statement: a
    // registration whose two statements disagreed would leave a version no rule could be applied to.
    expect(JSON.parse(row.definition_json)).toEqual(SGI_SO_1_0_0);

    // The version hangs off a catalogue row, which the registration creates because the seed is not
    // what wrote it here; the code, title and summary come from the definition it was handed.
    const catalogue = standardRows();
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.code).toBe("SGI-SO-1.0.0");
    expect(catalogue[0]?.title).toBe("Structured Output Conformance");
    expect(catalogue[0]?.summary).toBe(SGI_SO_1_0_0.summary);
    expect(row.standard_id).toBe(catalogue[0]?.id);
  });

  it("appends one standard_version_published event naming the new version row and the publisher", () => {
    const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    const events = governanceEvents();
    expect(events).toHaveLength(1);
    const [event] = events;

    if (event === undefined) {
      throw new Error("expected the publication to append one governance event, found none");
    }

    // The publication and the record of it are one act, so the event names the row the same call
    // created rather than a row a reader has to look up; the actor is the account the caller supplied.
    expect(event.event_type).toBe("standard_version_published");
    expect(event.subject_type).toBe("standard_version");
    expect(event.subject_id).toBe(versionId);
    expect(event.actor_account_id).toBe(PUBLISHER_ACCOUNT_ID);

    // No reason: a publication decides by what it points at, so the vocabulary stores the absence
    // rather than a fabricated string. The payload states the standard and the label a reader needs
    // to attribute the row without a second query.
    expect(event.reason).toBeNull();
    expect(payloadOf(event)).toEqual({ code: "SGI-SO-1.0.0", versionLabel: "SGI-SO-1.0.0" });
  });

  it("reads the standard back through listStandards with its one version and that version's criteria", () => {
    registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    const standards = listStandards(db);

    expect(standards).toHaveLength(1);
    const standard = standards[0];
    expect(standard?.code).toBe("SGI-SO-1.0.0");
    expect(standard?.title).toBe("Structured Output Conformance");
    expect(standard?.summary).toBe(SGI_SO_1_0_0.summary);
    // One version is stored, so the array's length is the fact to assert: the order the query imposes
    // on several versions is not observable from a single row.
    expect(standard?.versions).toHaveLength(1);
    const version = standard?.versions[0];
    expect(version?.version_label).toBe("SGI-SO-1.0.0");
    expect(version?.status).toBe("provisional");
    expect(version?.total_cases).toBe(20);
    expect(version?.critical_cases).toBe(5);
    expect(version?.pass_threshold_matches).toBe(18);
    expect(version?.critical_failures_allowed).toBe(0);
    expect(version?.rubric_reference).toBe("SGI-SO-1.0.0#rubric");
    expect(version?.definition).toEqual(SGI_SO_1_0_0);
  });

  it("groups each standard's versions out of one catalogue-wide read, in publication order", () => {
    // An empty catalogue is the read's first state: the version read answers no row, the grouping
    // finds no standard, and the answer is the empty array rather than a refusal.
    expect(listStandards(db)).toEqual([]);

    // The first standard's versions are published in the opposite order to the one they are
    // registered in, so the order asserted below can only come from `published_at`: the
    // catalogue-wide read fixes one order for every version row, and splitting the rows by standard
    // has to keep it within each standard.
    registerStandardVersion(
      db,
      {
        ...SGI_SO_1_0_0,
        versionLabel: "SGI-SO-1.0.1",
        publishedAt: "2024-07-01T00:00:00.000Z",
      },
      PUBLISHER_ACCOUNT_ID,
    );
    registerStandardVersion(
      db,
      {
        ...SGI_SO_1_0_0,
        versionLabel: "SGI-SO-1.0.2",
        publishedAt: "2024-06-02T00:00:00.000Z",
      },
      PUBLISHER_ACCOUNT_ID,
    );
    registerStandardVersion(
      db,
      {
        ...SGI_SO_1_0_0,
        code: "SGI-EXT-1.0.0",
        versionLabel: "SGI-EXT-1.0.0",
      },
      PUBLISHER_ACCOUNT_ID,
    );

    // A catalogue row no version names, which the schema permits and neither writer commits: it is
    // answered with the empty version list rather than left out of the catalogue.
    db.prepare<[string, string, string, string]>(
      "INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)",
    ).run(
      "stan0000-zero-0000-0000-000000000000",
      "SGI-ZERO-1.0.0",
      "A standard with no published version",
      "Stands for a catalogue row whose versions have not been published yet.",
    );

    const standards = listStandards(db);

    expect(standards).toHaveLength(3);
    // The catalogue is ordered by code and each standard carries only its own versions: two
    // statements answer the whole catalogue whatever the number of standards in it.
    expect(standards.map((standard) => standard.code)).toEqual([
      "SGI-EXT-1.0.0",
      "SGI-SO-1.0.0",
      "SGI-ZERO-1.0.0",
    ]);
    expect(standards[0]?.versions.map((version) => version.version_label)).toEqual([
      "SGI-EXT-1.0.0",
    ]);
    expect(standards[1]?.versions.map((version) => version.version_label)).toEqual([
      "SGI-SO-1.0.2",
      "SGI-SO-1.0.1",
    ]);
    expect(standards[2]?.versions).toEqual([]);
  });

  it("writes a row no statement rewrites: both append-only triggers refuse and the row is left as published", () => {
    const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    // packages/shared/migrations/0010_append_only_triggers.sql guards standard_versions with a
    // BEFORE UPDATE and a BEFORE DELETE trigger, each running RAISE(ABORT), so a statement that
    // reaches the table by some path other than the registry's INSERT is refused by the schema.
    expect(() =>
      db.prepare("UPDATE standard_versions SET total_cases = 21 WHERE id = ?").run(versionId),
    ).toThrow(/standard_versions is append-only/);
    expect(() => db.prepare("DELETE FROM standard_versions WHERE id = ?").run(versionId)).toThrow(
      /standard_versions is append-only/,
    );

    const row = storedVersion(versionId);
    expect(row.id).toBe(versionId);
    expect(row.total_cases).toBe(20);
    expect(row.published_at).toBe("2024-06-01T00:00:00.000Z");
  });

  it("registers an identical definition as the row it already has, writing nothing the second time", () => {
    const first = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);
    const published = storedVersion(first);

    const second = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    // The second registration finds the row the first call published and returns it instead of failing
    // on the unique pair or publishing the criteria a second time — and the publication is recorded
    // once for the same reason: the append sits on the insert path alone, so a re-registration that
    // finds the row already there appends no second event.
    expect(second).toBe(first);
    expect(versionCount()).toBe(1);
    expect(standardRows()).toHaveLength(1);
    expect(storedVersion(first)).toStrictEqual(published);
    expect(governanceEvents()).toHaveLength(1);
  });

  it("refuses a second registration that changes a published criterion and leaves the row as published", () => {
    const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);
    const drifted: StandardVersionDefinition = { ...SGI_SO_1_0_0, totalCases: 19 };

    const failure = refusalFrom(() => registerStandardVersion(db, drifted, PUBLISHER_ACCOUNT_ID));

    expect(failure).toBeInstanceOf(StandardDriftError);
    expect((failure as StandardDriftError).name).toBe("StandardDriftError");
    expect((failure as StandardDriftError).code).toBe("standard_drift");
    expect((failure as StandardDriftError).standardVersionId).toBe(versionId);
    expect((failure as StandardDriftError).message).toContain("totalCases");

    // The refusal is reached by comparing the registration against what is stored, before any
    // statement is prepared, so the version that was already published is untouched — and the log
    // holds the one publication the first call appended, no more.
    const row = storedVersion(versionId);
    expect(row.total_cases).toBe(20);
    expect(row.published_at).toBe("2024-06-01T00:00:00.000Z");
    expect(versionCount()).toBe(1);
    expect(governanceEvents()).toHaveLength(1);
  });

  it("refuses a version whose criteria its fixture set cannot satisfy, when the case set is read", () => {
    // The cross-column CHECKs in 0005_standards_and_proposals.sql permit 19 total cases with 5
    // critical cases, an 18-case threshold and no critical failure allowed, so this variant is the
    // reachable one: the row is insertable and the disagreement with the 20-case fixture set surfaces
    // when the set is loaded rather than when the row is written.
    const nineteenCaseVersion = registerStandardVersion(
      db,
      {
        ...SGI_SO_1_0_0,
        versionLabel: "SGI-SO-1.1.0",
        totalCases: 19,
      },
      PUBLISHER_ACCOUNT_ID,
    );

    const wrongCounts = refusalFrom(() => getStandardCaseSet(db, nineteenCaseVersion));

    expect(wrongCounts).toBeInstanceOf(StandardDriftError);
    expect((wrongCounts as StandardDriftError).code).toBe("standard_drift");
    expect((wrongCounts as StandardDriftError).standardVersionId).toBe(nineteenCaseVersion);
    expect((wrongCounts as StandardDriftError).message).toContain("publishes 19 cases");
    expect((wrongCounts as StandardDriftError).message).toContain("loads with 20 cases");

    // The other way a version drifts from its case set: it names one no directory answers, which the
    // fixture loader refuses and the registry wraps in the same refusal.
    const absentFixtureVersion = registerStandardVersion(
      db,
      {
        ...SGI_SO_1_0_0,
        versionLabel: "SGI-SO-1.2.0",
        fixtureSetId: "SGI-SO-1.0.0-absent",
      },
      PUBLISHER_ACCOUNT_ID,
    );

    const unloadableSet = refusalFrom(() => getStandardCaseSet(db, absentFixtureVersion));

    expect(unloadableSet).toBeInstanceOf(StandardDriftError);
    expect((unloadableSet as StandardDriftError).code).toBe("standard_drift");
    expect((unloadableSet as StandardDriftError).message).toContain("SGI-SO-1.0.0-absent");
  });

  it("returns the delivered fixture case set for a registered version", () => {
    registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    // `apps/api` reaches a fixture case set only through this function, because a workspace is
    // imported through its public entry alone and the API workspace may not import the fixture
    // package, so this is the path an evaluation at the HTTP boundary depends on.
    const caseSet = getStandardCaseSet(db, "SGI-SO-1.0.0");

    expect(caseSet.standard_version_id).toBe("SGI-SO-1.0.0");
    expect(caseSet.total_cases).toBe(20);
    expect(caseSet.critical_cases).toBe(5);
    expect(caseSet.cases).toHaveLength(20);
  });

  it("returns the same case set for a record a caller already resolved, reading no row for it", () => {
    const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);
    const resolved = getStandardVersion(db, "SGI-SO-1.0.0", "SGI-SO-1.0.0");
    if (resolved === null) {
      throw new Error("expected the registered version to resolve");
    }

    // The evaluation route resolves its standard version once per request and hands that record to
    // this read rather than the reference again: the set it receives is the set the reference form
    // returns, taken from the record's own criteria and naming the record's own version.
    expect(resolved.id).toBe(versionId);
    expect(getStandardCaseSet(db, resolved)).toEqual(getStandardCaseSet(db, "SGI-SO-1.0.0"));
  });

  it.each<[string, Partial<StandardVersionDefinition>, string]>([
    [
      "names a fixture set no directory answers",
      { fixtureSetId: "SGI-SO-1.0.0-absent" },
      "SGI-SO-1.0.0-absent",
    ],
    ["publishes counts the loaded set does not carry", { totalCases: 19 }, "publishes 19 cases"],
  ])(
    "refuses a resolved record whose definition %s, as it refuses the same drift for a reference",
    (_described, drift, expectedMessage) => {
      const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);
      const resolved = getStandardVersion(db, "SGI-SO-1.0.0", "SGI-SO-1.0.0");
      if (resolved === null) {
        throw new Error("expected the registered version to resolve");
      }

      // The record form skips the read, never the checks: every comparison the reference form makes is
      // made against the record's own criteria, so a record whose definition has drifted from the
      // fixture set is refused in the same words, naming the version the record identifies.
      const failure = refusalFrom(() =>
        getStandardCaseSet(db, { ...resolved, definition: { ...resolved.definition, ...drift } }),
      );

      expect(failure).toBeInstanceOf(StandardDriftError);
      expect((failure as StandardDriftError).name).toBe("StandardDriftError");
      expect((failure as StandardDriftError).code).toBe("standard_drift");
      expect((failure as StandardDriftError).standardVersionId).toBe(versionId);
      expect((failure as StandardDriftError).message).toContain(`standard version "${versionId}"`);
      expect((failure as StandardDriftError).message).toContain(expectedMessage);
    },
  );

  it("refuses an unknown version reference from the case-set read while the record reads answer null", () => {
    registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);

    const failure = refusalFrom(() => getStandardCaseSet(db, "does-not-exist"));

    expect(failure).toBeInstanceOf(UnknownStandardError);
    expect((failure as UnknownStandardError).name).toBe("UnknownStandardError");
    expect((failure as UnknownStandardError).code).toBe("unknown_standard");
    expect((failure as UnknownStandardError).reference).toBe("does-not-exist");

    // The two answers differ on purpose: a caller about to score a submission has nothing to score
    // without a case set and would otherwise have to test for a silent absence, while the record
    // reads answer null and leave the status to the route that turns it into a not-found response.
    expect(getStandard(db, "does-not-exist")).toBeNull();
    expect(getStandardVersion(db, "does-not-exist", "SGI-SO-1.0.0")).toBeNull();
  });

  it("resolves a standard and a version by the label the contract quotes and by the row id a report stores", () => {
    const versionId = registerStandardVersion(db, SGI_SO_1_0_0, PUBLISHER_ACCOUNT_ID);
    const standardId = onlyStandardRowId();

    const byCode = getStandard(db, "SGI-SO-1.0.0");
    const byRowId = getStandard(db, standardId);

    expect(byCode?.id).toBe(standardId);
    expect(byRowId?.id).toBe(standardId);
    expect(byRowId?.versions).toEqual(byCode?.versions);
    expect(byCode?.versions.map((version) => version.id)).toEqual([versionId]);

    // The registry takes the standard reference first and the version reference second, and each
    // accepts either a label or a row id, so the call a route makes from the two labels the contract
    // quotes and the call a report makes from stored identifiers return the same version.
    const byLabels = getStandardVersion(db, "SGI-SO-1.0.0", "SGI-SO-1.0.0");
    expect(byLabels?.id).toBe(versionId);
    expect(byLabels?.definition).toEqual(SGI_SO_1_0_0);
    expect(getStandardVersion(db, standardId, versionId)).toEqual(byLabels);
    expect(getStandardVersion(db, "SGI-SO-1.0.0", versionId)).toEqual(byLabels);

    // A version's row id addresses a `standard_versions` row and never a `standards` row, so the two
    // identifiers are resolved in separate namespaces and one cannot stand in for the other.
    expect(getStandardVersion(db, versionId, "SGI-SO-1.0.0")).toBeNull();
  });
});
