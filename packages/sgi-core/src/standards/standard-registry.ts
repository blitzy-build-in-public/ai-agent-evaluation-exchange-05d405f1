/**
 * The registry of the Standard Gate Index: the only layer that reads the `standards` catalogue and
 * its `standard_versions` history, the only writer of either table, and the only path in the
 * product from a registered standard version to the fixture case set an evaluation is scored
 * against.
 *
 * **Two tables of its own, and the record of a publication.** `standards` is the seed-only catalogue
 * row — the named thing the community governs, carrying a code, a title and a summary and no threshold
 * of its own. `standard_versions` holds the versioned criteria, and is one of the nine append-only
 * tables `packages/shared/migrations/0010_append_only_triggers.sql` guards with a `RAISE(ABORT)`
 * trigger on both an update and a delete; publishing a version appends the `standard_version_published`
 * decision that announces it through `../events/append-event`, inside the same transaction as the row,
 * so the registry's own table carries the row and the append-only log carries the decision. This module
 * therefore issues `INSERT` and `SELECT` statements only: nowhere below is an existing row rewritten or
 * removed, and no replace-style conflict resolution is used, because SQLite documents that resolution
 * as bypassing a delete trigger. A criterion that has
 * become inconvenient is published as a new version, never widened in place.
 *
 * **The criteria belong to the row.** A version's persisted `definition_json` is a second
 * statement of numbers the row's own columns already carry — `@adem/shared` puts it plainly, that
 * the columns are what the evaluator reads — so a definition is read as a document that may not
 * contradict the row it is stored beside, and the definition handed to a caller is assembled from
 * the columns. A document that disagrees with its row is refused as drift rather than believed.
 *
 * **Resolution: the contract-facing label wins.** Every reference is resolved by the identifier
 * people quote before the row id: a standard by `code` and then by `id`, a version by
 * `version_label` and then by `id`. Each probe asks for at most two rows, so a reference that
 * resolves to more than one row is refused as ambiguous rather than silently resolved to whichever
 * row the query returned first.
 *
 * **The fixture case set.** `apps/api` reaches a fixture set only through `getStandardCaseSet`,
 * because a workspace imports another only through its public entry and `@adem/sgi-fixtures` is
 * not an entry the API workspace may import. The version's persisted fixture-set reference is
 * loaded there and every count the version publishes is checked against the loaded set, so the two
 * halves of a standard version — the criteria in the database and the cases in the fixture
 * package — cannot drift apart unnoticed.
 *
 * **The database handle is passed in.** A domain package receives its connection from the
 * composition root rather than opening one, so every function below takes the `better-sqlite3`
 * handle as its first argument. Nothing here opens a connection, reads a migration file or
 * changes a schema: the schema belongs to `packages/shared/migrations`, and this module only
 * queries it.
 *
 * **Determinism.** No function here reads a clock, a locale, a timezone, an environment variable,
 * a file or a random source other than `randomUUID`, which names rows rather than criteria. Reads
 * are pure SQL plus parsing — no cache, no module-level state, no memoisation — so two runs over
 * one stored version return deeply equal records.
 */

import { randomUUID } from "node:crypto";
import { loadCaseSet, type CaseSet } from "@adem/sgi-fixtures";
import type { Standard, StandardStatus, StandardVersion } from "@adem/shared";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { appendEvent } from "../events/append-event";
import type { StandardVersionDefinition } from "./sgi-so-1.0.0";

/**
 * A `standards` catalogue row together with every version published beneath it, oldest first.
 *
 * The catalogue fields are the row's own; `versions` is what a caller reads to show a standard's
 * history, and it is the append-only order rather than a list a caller may reorder into — nothing
 * in this module offers a write to it.
 */
export interface StandardRecord extends Standard {
  /** The standard's versions, in the order they were published. */
  readonly versions: readonly StandardVersionRecord[];
}

/**
 * A `standard_versions` row together with the criteria it publishes.
 *
 * `definition` is the parsed and verified form of the row's `definition_json`, assembled from the
 * row's columns, and is the value a caller hands to the scorer: `scoreSubmission` reads
 * `passThresholdMatches` and `criticalFailuresAllowed` from it.
 */
export interface StandardVersionRecord extends StandardVersion {
  /** The versioned criteria, ready to hand to the scorer. */
  readonly definition: StandardVersionDefinition;
}

/**
 * Thrown when a standard or standard-version reference that must resolve does not, and when one
 * reference resolves to more than one row.
 *
 * `apps/api` maps the `code` to the contract's `404`, so the message names the reference that
 * failed and no route author has to re-read the database to decide a status.
 */
export class UnknownStandardError extends Error {
  /** The machine-readable code a route maps to the contract's `404`. */
  readonly code = "unknown_standard" as const;

  /** The reference that failed to resolve, when the refusal knows it. */
  readonly reference: string | undefined;

  constructor(message: string, reference?: string) {
    super(message);
    this.name = "UnknownStandardError";
    this.reference = reference;
  }
}

/**
 * Thrown when the versioned criteria disagree with each other or with the fixture set the version
 * names: a persisted definition that contradicts its row, a fixture set that cannot be loaded, or
 * a loaded case set whose identity or counts are not the version's.
 *
 * `apps/api` maps the `code` to the contract's `400`. The class is defined here and nowhere else —
 * the scoring path imports it from this module rather than declaring a second one — and every
 * message names the version that failed.
 */
export class StandardDriftError extends Error {
  /** The machine-readable code a route maps to the contract's `400`. */
  readonly code = "standard_drift" as const;

  /** Identifier of the version that drifted, when the refusal knows it. */
  readonly standardVersionId: string | undefined;

  constructor(message: string, standardVersionId?: string) {
    super(message);
    this.name = "StandardDriftError";
    this.standardVersionId = standardVersionId;
  }
}

/** A row of `standards`, as the catalogue stores it. */
interface StandardRow {
  id: string;
  code: string;
  title: string;
  summary: string;
}

/**
 * A row of `standard_versions` joined to the `standards` row it belongs to.
 *
 * `standard_code`, `standard_title` and `standard_summary` are the joined catalogue columns,
 * aliased apart from the version's own columns so one row carries both without a collision.
 *
 * `status` is typed as the shared `StandardStatus` rather than as a string because migration
 * `0005_standards_and_proposals.sql` declares `CHECK (status IN ('provisional', 'active'))`, so the
 * column can hold nothing else; the same migration's three cross-column guards are what make the
 * four counts a combination the pass rule can be applied to.
 */
interface StandardVersionRow {
  id: string;
  standard_id: string;
  version_label: string;
  status: StandardStatus;
  total_cases: number;
  critical_cases: number;
  pass_threshold_matches: number;
  critical_failures_allowed: number;
  rubric_reference: string;
  definition_json: string;
  published_at: string;
  standard_code: string;
  standard_title: string;
  standard_summary: string;
}

/** A parsed `definition_json`: a JSON object whose members are checked one at a time. */
type PersistedDefinition = { readonly [member: string]: unknown };

/**
 * The columns every version read selects, joined to the catalogue row the version belongs to.
 *
 * The join is what supplies a definition's `code`, `title` and `summary`, which live on
 * `standards` rather than on the version. Columns are listed rather than selected with `*`, so a
 * column added to the table cannot arrive in a row this module's interfaces do not describe.
 */
const VERSION_SELECT = `SELECT v.id,
       v.standard_id,
       v.version_label,
       v.status,
       v.total_cases,
       v.critical_cases,
       v.pass_threshold_matches,
       v.critical_failures_allowed,
       v.rubric_reference,
       v.definition_json,
       v.published_at,
       s.code AS standard_code,
       s.title AS standard_title,
       s.summary AS standard_summary
  FROM standard_versions AS v
  JOIN standards AS s ON s.id = v.standard_id`;

/** Whether a value is a JSON object: the only shape a parsed definition may have. */
function isJsonObject(value: unknown): value is PersistedDefinition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The readable part of a caught value, whatever was thrown. */
function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The two values a refusal names a version by: `standard_versions.id` and the contract-facing
 * `version_label`.
 *
 * It is stated as its own private shape so that {@link nameVersion} and {@link refuseDrift} accept
 * either form of the version a caller holds — the `standard_versions` row this module reads, or the
 * {@link StandardVersionRecord} assembled from one — because both carry these two members. Nothing
 * else is named here, because nothing else appears in a refusal, and a record a caller already
 * resolved therefore refuses in the same words as a row this module read itself.
 */
interface VersionIdentity {
  /** `standard_versions.id` of the version that is being refused. */
  readonly id: string;

  /** The version's contract-facing label, e.g. `SGI-SO-1.0.0`. */
  readonly version_label: string;
}

/** How a version is named in a refusal, so the reader sees which row failed. */
function nameVersion(version: VersionIdentity): string {
  return `standard version "${version.id}" (label "${version.version_label}")`;
}

/**
 * Refuses with `StandardDriftError`, naming the version and closing with the rule the refusal
 * enforces: a drifted version is corrected by publishing a new version, never by editing one.
 *
 * `detail` is written as a predicate of the version, so every message reads as one sentence about
 * one row rather than as a fragment a caller has to reassemble. Both forms of a version reach this
 * function — the row read here and the record a caller resolved earlier — so a fixture set that
 * has drifted from its version is refused identically whichever form was handed in.
 */
function refuseDrift(version: VersionIdentity, detail: string): never {
  throw new StandardDriftError(
    `${nameVersion(version)} ${detail}. A standard version is append-only, so its criteria are corrected by publishing a new version rather than by editing this one.`,
    version.id,
  );
}

/**
 * Parses `definition_json` and refuses the two ways the persisted text cannot be read at all: text
 * that is not JSON, and JSON that is not an object.
 *
 * What the object then states is checked member by member by {@link checkMember}, which is where a
 * document that contradicts the row it is stored beside is refused.
 */
function parsePersistedDefinition(row: StandardVersionRow): PersistedDefinition {
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(row.definition_json);
  } catch (cause) {
    refuseDrift(row, `stores a definition_json that is not valid JSON (${describeCause(cause)})`);
  }
  if (!isJsonObject(parsed)) {
    refuseDrift(row, "stores a definition_json that is not a JSON object");
  }
  return parsed;
}

/**
 * Checks one member of a persisted definition against the column that stores the same value.
 *
 * `required` marks the members a published definition must state: without them the document does
 * not say which criteria it belongs to and its own counts could not be checked against the row. A
 * member the document omits otherwise is read from the column, which is what the row publishes
 * either way; a member it states must equal the column it duplicates, because a version whose two
 * statements of one criterion disagree has no criterion an evaluator could apply.
 */
function checkMember(
  row: StandardVersionRow,
  persisted: PersistedDefinition,
  member: string,
  columnName: string,
  columnValue: string | number,
  required: boolean,
): void {
  const stated: unknown = persisted[member];
  if (stated === undefined) {
    if (required) {
      refuseDrift(row, `stores a definition_json that does not state "${member}"`);
    }
    return;
  }
  if (stated !== columnValue) {
    refuseDrift(
      row,
      `stores a definition_json that states "${member}" as ${JSON.stringify(stated)} while its ${columnName} column holds ${JSON.stringify(columnValue)}`,
    );
  }
}

/**
 * Reads the criteria a version publishes: the row's own columns, plus the one member of a
 * definition that no column carries.
 *
 * Every member a column also stores is checked against it first — the five a definition must state
 * and the seven a document may omit — and the returned value is assembled from the columns.
 * `fixtureSetId` is the exception and is taken from the document, because it names the fixture case
 * set the version is scored against and no `standard_versions` column holds it. A caller that
 * receives this definition therefore always holds the criteria the row publishes, and never a
 * value missing a member the row stores.
 */
function readDefinition(row: StandardVersionRow): StandardVersionDefinition {
  const persisted = parsePersistedDefinition(row);

  // The members a published definition must state: the version it belongs to, the fixture set it
  // names and the three counts the pass rule is arithmetic on.
  checkMember(row, persisted, "versionLabel", "version_label", row.version_label, true);
  checkMember(row, persisted, "totalCases", "total_cases", row.total_cases, true);
  checkMember(row, persisted, "criticalCases", "critical_cases", row.critical_cases, true);
  checkMember(row, persisted, "rubricReference", "rubric_reference", row.rubric_reference, true);

  // The members a document may state as well: each duplicates a column, so a document that states
  // one must agree with it, and a document that omits one leaves the column as the only statement.
  checkMember(row, persisted, "code", "standards.code", row.standard_code, false);
  checkMember(row, persisted, "title", "standards.title", row.standard_title, false);
  checkMember(row, persisted, "summary", "standards.summary", row.standard_summary, false);
  checkMember(row, persisted, "status", "status", row.status, false);
  checkMember(
    row,
    persisted,
    "passThresholdMatches",
    "pass_threshold_matches",
    row.pass_threshold_matches,
    false,
  );
  checkMember(
    row,
    persisted,
    "criticalFailuresAllowed",
    "critical_failures_allowed",
    row.critical_failures_allowed,
    false,
  );
  checkMember(row, persisted, "publishedAt", "published_at", row.published_at, false);

  const fixtureSetId: unknown = persisted["fixtureSetId"];
  if (typeof fixtureSetId !== "string" || fixtureSetId.length === 0) {
    refuseDrift(row, 'stores a definition_json that does not state "fixtureSetId" as a non-empty string');
  }

  return {
    code: row.standard_code,
    versionLabel: row.version_label,
    title: row.standard_title,
    summary: row.standard_summary,
    status: row.status,
    totalCases: row.total_cases,
    criticalCases: row.critical_cases,
    passThresholdMatches: row.pass_threshold_matches,
    criticalFailuresAllowed: row.critical_failures_allowed,
    rubricReference: row.rubric_reference,
    fixtureSetId,
    publishedAt: row.published_at,
  };
}

/** The record for one stored version row, with its criteria read and verified. */
function toVersionRecord(row: StandardVersionRow): StandardVersionRecord {
  return {
    id: row.id,
    standard_id: row.standard_id,
    version_label: row.version_label,
    status: row.status,
    total_cases: row.total_cases,
    critical_cases: row.critical_cases,
    pass_threshold_matches: row.pass_threshold_matches,
    critical_failures_allowed: row.critical_failures_allowed,
    rubric_reference: row.rubric_reference,
    definition_json: row.definition_json,
    published_at: row.published_at,
    definition: readDefinition(row),
  };
}

/**
 * The `standards` rows a reference resolves to: none, one, or the two a probe stops at.
 *
 * The contract-facing label wins — `code` is probed first and `id` only when no code matches — and
 * each probe asks for at most two rows, which is what makes an ambiguous reference detectable.
 * Migration `0005_standards_and_proposals.sql` declares `code` UNIQUE and `id` PRIMARY KEY, so a
 * probe cannot find two rows today; asking for two anyway is what keeps the refusal in
 * {@link resolveStandard} true by construction rather than by trusting a schema this package only
 * queries.
 */
function findStandardRows(db: SqliteDatabase, reference: string): StandardRow[] {
  const byCode = db
    .prepare<[string], StandardRow>(
      "SELECT id, code, title, summary FROM standards WHERE code = ? LIMIT 2",
    )
    .all(reference);
  if (byCode.length > 0) {
    return byCode;
  }
  return db
    .prepare<[string], StandardRow>(
      "SELECT id, code, title, summary FROM standards WHERE id = ? LIMIT 2",
    )
    .all(reference);
}

/**
 * Resolves a standard reference to its catalogue row, or `null` when nothing matches.
 *
 * A reference that resolves to two rows identifies no single standard, so it is refused as unknown
 * rather than resolved to the first row a query happened to return.
 */
function resolveStandard(db: SqliteDatabase, reference: string): StandardRow | null {
  const [row, ...rest] = findStandardRows(db, reference);
  if (rest.length > 0) {
    throw new UnknownStandardError(
      `standard reference "${reference}" resolves to more than one catalogue row, so it identifies no single standard`,
      reference,
    );
  }
  return row ?? null;
}

/**
 * The versions of one standard that a label-or-id reference resolves to.
 *
 * As with a standard reference the contract-facing label wins, and the probe is scoped to the
 * standard because `UNIQUE (standard_id, version_label)` makes a version label unique within its
 * standard rather than across the catalogue.
 */
function findVersionRowsOfStandard(
  db: SqliteDatabase,
  standardId: string,
  versionReference: string,
): StandardVersionRow[] {
  const byLabel = db
    .prepare<[string, string], StandardVersionRow>(
      `${VERSION_SELECT} WHERE v.standard_id = ? AND v.version_label = ? LIMIT 2`,
    )
    .all(standardId, versionReference);
  if (byLabel.length > 0) {
    return byLabel;
  }
  return db
    .prepare<[string, string], StandardVersionRow>(
      `${VERSION_SELECT} WHERE v.standard_id = ? AND v.id = ? LIMIT 2`,
    )
    .all(standardId, versionReference);
}

/**
 * The version rows a label-or-id reference resolves to when no standard is named.
 *
 * `getStandardCaseSet` receives a version identifier alone, so the label is probed across the whole
 * catalogue. The label of this release embeds its standard code and is therefore unique
 * catalogue-wide today; the probe keeps a future label two standards both publish from being
 * resolved to whichever version the query returned first.
 */
function findVersionRowsByReference(db: SqliteDatabase, versionReference: string): StandardVersionRow[] {
  const byLabel = db
    .prepare<[string], StandardVersionRow>(`${VERSION_SELECT} WHERE v.version_label = ? LIMIT 2`)
    .all(versionReference);
  if (byLabel.length > 0) {
    return byLabel;
  }
  return db
    .prepare<[string], StandardVersionRow>(`${VERSION_SELECT} WHERE v.id = ? LIMIT 2`)
    .all(versionReference);
}

/** Resolves a version reference of one named standard, or `null` when nothing matches. */
function resolveVersionRow(
  db: SqliteDatabase,
  standard: StandardRow,
  versionReference: string,
): StandardVersionRow | null {
  const [row, ...rest] = findVersionRowsOfStandard(db, standard.id, versionReference);
  if (rest.length > 0) {
    throw new UnknownStandardError(
      `standard "${standard.code}" holds more than one version resolving to "${versionReference}", so it identifies no single version`,
      versionReference,
    );
  }
  return row ?? null;
}

/**
 * The record for one catalogue row together with the versions published beneath it.
 *
 * The versions are handed in rather than read here, so this function issues no statement of its own
 * and the read a caller needs is the caller's to choose: {@link listStandards} passes the whole
 * catalogue's versions, read once and grouped in memory, and {@link getStandard} passes the one
 * standard's rows from {@link readVersionRowsOfStandard}. Each row still goes through
 * {@link toVersionRecord}, so a version whose persisted definition contradicts its row is refused on
 * both paths.
 */
function toStandardRecord(
  standard: StandardRow,
  versions: readonly StandardVersionRow[],
): StandardRecord {
  return {
    id: standard.id,
    code: standard.code,
    title: standard.title,
    summary: standard.summary,
    versions: versions.map(toVersionRecord),
  };
}

/**
 * The version rows of one standard, in the order they were published.
 *
 * `published_at` is the version's own fixed literal and `rowid` is insertion order, so the tie-break
 * keeps two versions published in the same instant in the order they were written. This is the
 * scoped read {@link getStandard} makes; {@link listStandards} reads every standard's versions in one
 * statement through {@link readEveryVersionRow} and splits them itself.
 */
function readVersionRowsOfStandard(db: SqliteDatabase, standardId: string): StandardVersionRow[] {
  return db
    .prepare<[string], StandardVersionRow>(
      `${VERSION_SELECT} WHERE v.standard_id = ? ORDER BY v.published_at ASC, v.rowid ASC`,
    )
    .all(standardId);
}

/**
 * Every version row in the catalogue, in the order they were published: one statement for the whole
 * catalogue rather than one statement per standard.
 *
 * The read is exactly as wide as what {@link listStandards} returns, because that read hands back
 * every version of every standard; splitting the rows by standard happens in this process rather than
 * in the database, so the number of statements a catalogue request issues does not grow as standards
 * are added. The order is the one a single standard's read fixes, and one ordering of the table
 * preserves the order within each standard, which is what lets {@link groupVersionRowsByStandard}
 * divide the rows without re-sorting them.
 *
 * No `standard_id IN (?, ?, …)` list is built from the catalogue's ids: its placeholders would grow
 * with the catalogue, and SQLite refuses a statement past its variable ceiling rather than degrading,
 * so such a read would fail at a catalogue size instead of costing more.
 */
function readEveryVersionRow(db: SqliteDatabase): StandardVersionRow[] {
  return db
    .prepare<[], StandardVersionRow>(`${VERSION_SELECT} ORDER BY v.published_at ASC, v.rowid ASC`)
    .all();
}

/**
 * The members of a definition, in the order a registration is compared against what is stored.
 *
 * Spelled as data so the comparison cannot silently skip a member: a member added to
 * `StandardVersionDefinition` and left out here would be a criterion two registrations could
 * disagree about without either being refused.
 */
const DEFINITION_MEMBERS = [
  "code",
  "versionLabel",
  "title",
  "summary",
  "status",
  "totalCases",
  "criticalCases",
  "passThresholdMatches",
  "criticalFailuresAllowed",
  "rubricReference",
  "fixtureSetId",
  "publishedAt",
] as const satisfies readonly (keyof StandardVersionDefinition)[];

/** Refuses a registration whose criteria differ from those already published under that label. */
function compareWithStored(
  stored: StandardVersionDefinition,
  candidate: StandardVersionDefinition,
  standardVersionId: string,
): void {
  for (const member of DEFINITION_MEMBERS) {
    if (stored[member] !== candidate[member]) {
      throw new StandardDriftError(
        `standard version "${standardVersionId}" is already published with "${member}" ${JSON.stringify(stored[member])}, which this registration states as ${JSON.stringify(candidate[member])}. A standard version is append-only, so a change to a standard is published as a new version rather than written into this one.`,
        standardVersionId,
      );
    }
  }
}

/**
 * The `standards` row for a definition's code, inserted when the catalogue holds none yet.
 *
 * Reusing the existing row is what makes a second `npm run seed` leave the catalogue untouched,
 * and inserting the row when it is absent is what lets a seed be the first writer of it. An
 * existing row is never updated: the title and summary it was published with stay as published.
 */
function standardRowFor(db: SqliteDatabase, definition: StandardVersionDefinition): StandardRow {
  const [existing, ...rest] = findStandardRows(db, definition.code);
  if (rest.length > 0) {
    throw new UnknownStandardError(
      `standard code "${definition.code}" resolves to more than one catalogue row, so it identifies no single standard`,
      definition.code,
    );
  }
  if (existing !== undefined) {
    return existing;
  }

  const created: StandardRow = {
    id: randomUUID(),
    code: definition.code,
    title: definition.title,
    summary: definition.summary,
  };
  db
    .prepare<[string, string, string, string]>(
      "INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)",
    )
    .run(created.id, created.code, created.title, created.summary);
  return created;
}

/**
 * Publishes one new version row and returns its identifier.
 *
 * `definition_json` is the definition as serialized, and `published_at` is the fixed literal the
 * definition carries — never `CURRENT_TIMESTAMP`, never `datetime('now')` and never a clock read
 * in TypeScript, because the versioned criteria have to be the same on every run and every
 * machine.
 */
function insertVersionRow(
  db: SqliteDatabase,
  standardId: string,
  definition: StandardVersionDefinition,
): string {
  const id = randomUUID();
  db
    .prepare<
      [string, string, string, string, number, number, number, number, string, string, string]
    >(
      `INSERT INTO standard_versions (
         id, standard_id, version_label, status, total_cases, critical_cases,
         pass_threshold_matches, critical_failures_allowed, rubric_reference, definition_json, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      standardId,
      definition.versionLabel,
      definition.status,
      definition.totalCases,
      definition.criticalCases,
      definition.passThresholdMatches,
      definition.criticalFailuresAllowed,
      definition.rubricReference,
      JSON.stringify(definition),
      definition.publishedAt,
    );
  return id;
}

/**
 * The version rows grouped by the standard each belongs to, preserving the order they arrive in.
 *
 * Rows arrive in the order {@link readEveryVersionRow} fixed — `published_at` and then `rowid` — and
 * appending each row to its own standard's array keeps that order inside every group, so each entry
 * is the list {@link readVersionRowsOfStandard} returns for that standard. Grouping here is what
 * keeps a second query per standard out of the catalogue read. A standard no version names is absent
 * from the map, which the caller answers as the empty list.
 */
function groupVersionRowsByStandard(
  rows: readonly StandardVersionRow[],
): Map<string, StandardVersionRow[]> {
  const grouped = new Map<string, StandardVersionRow[]>();

  for (const row of rows) {
    const collected = grouped.get(row.standard_id);

    if (collected === undefined) {
      grouped.set(row.standard_id, [row]);
    } else {
      collected.push(row);
    }
  }

  return grouped;
}

/**
 * Every standard in the catalogue, each with its versions in the order they were published.
 *
 * Two statements answer the whole catalogue whatever its size: the catalogue rows, ordered by `code`,
 * and every version row read once and divided by `standard_id` in this process rather than by one
 * query per standard. What a caller receives is unchanged by the read — a standard's versions are the
 * same ordered list, and a standard with no version carries the empty list.
 *
 * The catalogue is ordered by `code`, and a standard's versions by `published_at` and then by
 * `rowid`: insertion order is the append-only history's order, and the `rowid` tie-break keeps two
 * versions published in the same instant in the order they were written. An empty catalogue returns
 * an empty array rather than refusing, and a version whose persisted definition contradicts its row
 * is refused with `StandardDriftError` rather than returned as a record no caller could trust.
 */
export function listStandards(db: SqliteDatabase): StandardRecord[] {
  const standards = db
    .prepare<[], StandardRow>("SELECT id, code, title, summary FROM standards ORDER BY code ASC")
    .all();
  const versionsByStandard = groupVersionRowsByStandard(readEveryVersionRow(db));

  return standards.map((standard) =>
    toStandardRecord(standard, versionsByStandard.get(standard.id) ?? []),
  );
}

/**
 * One standard by its code or its row id, with its versions, or `null` when nothing matches.
 *
 * The code is probed first, so a reference that is both an existing code and another row's id
 * resolves to the code. Refuses with `UnknownStandardError` when the reference resolves to more than
 * one catalogue row, and with `StandardDriftError` when a version beneath the standard contradicts
 * its own row.
 */
export function getStandard(db: SqliteDatabase, reference: string): StandardRecord | null {
  const standard = resolveStandard(db, reference);
  return standard === null
    ? null
    : toStandardRecord(standard, readVersionRowsOfStandard(db, standard.id));
}

/**
 * One version of one standard, by the standard's code or row id and the version's label or row id,
 * or `null` when nothing matches.
 *
 * **Turning the contract-facing label into a foreign key.** A caller holding only the labels the
 * contract quotes calls `getStandardVersion(db, "SGI-SO-1.0.0", "SGI-SO-1.0.0")` and receives the
 * record whose `id` is the `standard_versions.id` a report stores beside its candidate version. The
 * idiom is to refuse with `UnknownStandardError` when the call returns `null`, which is the
 * contract's `404`, and to hand `record.definition` to the scorer rather than re-reading the row.
 *
 * The version label is probed before the row id, and both probes are scoped to the standard. Refuses
 * with `UnknownStandardError` when the standard reference or the version reference resolves to more
 * than one row, and with `StandardDriftError` when the version's persisted definition contradicts
 * the row it is stored beside.
 */
export function getStandardVersion(
  db: SqliteDatabase,
  reference: string,
  versionLabel: string,
): StandardVersionRecord | null {
  const standard = resolveStandard(db, reference);
  if (standard === null) {
    return null;
  }
  const row = resolveVersionRow(db, standard, versionLabel);
  return row === null ? null : toVersionRecord(row);
}

/**
 * Publishes a standard version and returns its identifier, or the identifier it already has.
 *
 * One transaction covers the whole call: the parent catalogue row is resolved by `definition.code`
 * and inserted only when it does not exist; a version already published under `definition.versionLabel`
 * is compared against the registration member by member; and a version not yet published is inserted
 * together with one `standard_version_published` governance event. The only writes are `INSERT`s —
 * never a rewrite of a row, a removal or a replace-style conflict resolution, because
 * `standard_versions` is append-only and SQLite's conflict resolution would bypass the delete trigger
 * guarding it.
 *
 * **The publication is recorded where it happens.** The appended event names the `standard_version`
 * row this call created, the publisher, and the standard's code and the version label the definition
 * carries; it stores **no reason**, because a publication decides by what it points at and the
 * vocabulary's own rule is that such an event stores the absence rather than a fabricated string
 * (`appendEvent` admits an omitted reason). The event is written through
 * `../events/append-event` inside the transaction above and on the insert path alone, so a published
 * version and the record of its publication cannot diverge, and the re-registration below appends
 * nothing.
 *
 * Idempotent by design: registering the same definition twice returns the identifier of the row the
 * first call published and writes nothing the second time, which is what makes `npm run seed` safe
 * to run repeatedly against one database file. Refuses with `StandardDriftError` when that label is
 * already published with different criteria, naming the member that differs: a change to a standard
 * is published as a new version, never written into a version that already exists. Refuses with
 * `UnknownStandardError` when the definition's code resolves to more than one catalogue row.
 *
 * @param db - The caller's database handle.
 * @param definition - The versioned criteria to publish, as `./sgi-so-1.0.0` declares them.
 * @param publishedByAccountId - `accounts.id` of the account publishing the version. The caller
 *   supplies the actor rather than this module resolving one: the registry opens no connection and
 *   knows no session, so `apps/api` passes the resolved operator's identifier. The column it reaches,
 *   `governance_events.actor_account_id`, is `NOT NULL REFERENCES accounts (id)`, so the account row
 *   must exist before this call.
 * @returns The identifier of the `standard_versions` row the definition is published as.
 * @throws {StandardDriftError} When the label is already published with criteria that differ.
 * @throws {UnknownStandardError} When the definition's code resolves to more than one catalogue row.
 */
export function registerStandardVersion(
  db: SqliteDatabase,
  definition: StandardVersionDefinition,
  publishedByAccountId: string,
): string {
  const register = db.transaction((): string => {
    const standard = standardRowFor(db, definition);
    const [existing, ...rest] = findVersionRowsOfStandard(db, standard.id, definition.versionLabel);
    if (rest.length > 0) {
      throw new StandardDriftError(
        `standard "${standard.code}" holds more than one version labelled "${definition.versionLabel}", so the label does not identify one published version`,
      );
    }
    if (existing === undefined) {
      const versionId = insertVersionRow(db, standard.id, definition);

      // The record of the publication, inside the transaction that wrote the row: a published version
      // and the appended decision that announces it are one act, and the append-only log is where the
      // product states what was decided. No reason is passed — a publication decides by what it points
      // at — and the payload names the standard and the label in the code's own vocabulary.
      appendEvent(db, {
        subjectType: "standard_version",
        subjectId: versionId,
        eventType: "standard_version_published",
        actorAccountId: publishedByAccountId,
        payload: { code: standard.code, versionLabel: definition.versionLabel },
      });

      return versionId;
    }
    const stored = toVersionRecord(existing);
    compareWithStored(stored.definition, definition, stored.id);
    return stored.id;
  });
  return register();
}

/**
 * The version a case set is loaded for, as the two things {@link getStandardCaseSet} needs from it:
 * how a refusal names it, and the criteria that name the fixture case set.
 *
 * A caller that hands in a reference has its row read here, and it is here that a reference resolving
 * to no version or to more than one is refused. A caller that hands in the record it already resolved
 * gets that record back untouched: the row behind it is not read again and its `definition_json` is
 * not parsed and checked a second time, which is what lets one request resolve one row once.
 */
function resolveCaseSetVersion(
  db: SqliteDatabase,
  version: string | StandardVersionRecord,
): { readonly identity: VersionIdentity; readonly definition: StandardVersionDefinition } {
  if (typeof version !== "string") {
    return { identity: version, definition: version.definition };
  }

  const [row, ...rest] = findVersionRowsByReference(db, version);
  if (rest.length > 0) {
    throw new UnknownStandardError(
      `standard version reference "${version}" resolves to more than one version, so it identifies no single version`,
      version,
    );
  }
  if (row === undefined) {
    throw new UnknownStandardError(
      `no standard version matches "${version}"`,
      version,
    );
  }
  return { identity: row, definition: readDefinition(row) };
}

/**
 * The fixture case set a registered standard version is scored against, loaded from the fixture set
 * its persisted definition names.
 *
 * **Two forms of one version.** `version` is either a reference a caller holds — a version label or
 * a `standard_versions.id`, read and resolved here — or a {@link StandardVersionRecord} the caller
 * has already resolved, in which case that record's own `id`, its own `version_label` and its own
 * already-parsed `definition` are used and no row is read. The record form is sound because
 * `standard_versions` is append-only: no route updates or deletes one, so a record resolved earlier
 * in the same request is the row itself, and reading it again would only repeat the read and the
 * member-by-member check of a document that cannot have changed in the meantime. One evaluation
 * request therefore resolves its standard version once and passes that record to every reader that
 * needs it.
 *
 * This is the only path in the product from a standard version to a case set: the API workspace may
 * import `@adem/sgi-core` but not `@adem/sgi-fixtures`, so a route reaches a case set through here.
 * The version's criteria are read through the same reader the record path uses, which already
 * refuses a definition whose stated counts contradict the row's columns, so the counts checked below
 * are the row's own — and a record handed in has been through that same reader, so the form a caller
 * sends cannot change which checks run or what is refused.
 *
 * Refuses with `UnknownStandardError` when the reference resolves to no version or to more than one,
 * which is the contract's `404`. Refuses with `StandardDriftError`, naming the version and both count
 * pairs, when the version and the fixture set have drifted apart: when the set cannot be loaded at
 * all; when the set identifies itself as another standard version than the one the definition names;
 * when the set's `total_cases` or `critical_cases` is not the version's; or when the set's `cases`
 * array disagrees with the two counts it states. The case set is returned exactly as the fixture
 * package loads it, because the scorer consumes it as that package defines it.
 */
export function getStandardCaseSet(
  db: SqliteDatabase,
  version: string | StandardVersionRecord,
): CaseSet {
  const { identity, definition } = resolveCaseSetVersion(db, version);

  let caseSet: CaseSet;
  try {
    caseSet = loadCaseSet(definition.fixtureSetId);
  } catch (cause) {
    refuseDrift(
      identity,
      `names the fixture set "${definition.fixtureSetId}", which cannot be loaded (${describeCause(cause)})`,
    );
  }

  if (caseSet.standard_version_id !== definition.fixtureSetId) {
    refuseDrift(
      identity,
      `names the fixture set "${definition.fixtureSetId}", but the loaded case set identifies itself as "${caseSet.standard_version_id}"`,
    );
  }

  if (
    caseSet.total_cases !== definition.totalCases ||
    caseSet.critical_cases !== definition.criticalCases
  ) {
    refuseDrift(
      identity,
      `publishes ${definition.totalCases} cases of which ${definition.criticalCases} are critical, but fixture set "${definition.fixtureSetId}" loads with ${caseSet.total_cases} cases of which ${caseSet.critical_cases} are critical`,
    );
  }

  // The fixture package's loader already refuses a document whose `cases` array disagrees with the
  // two counts that document states; the comparison is repeated because this function's contract is
  // that the case set it returns agrees with the version it was asked for, whatever the loader does
  // with it in a later release.
  const criticalCases = caseSet.cases.filter((fixtureCase) => fixtureCase.severity === "critical")
    .length;
  if (caseSet.cases.length !== caseSet.total_cases || criticalCases !== caseSet.critical_cases) {
    refuseDrift(
      identity,
      `names the fixture set "${definition.fixtureSetId}", which states ${caseSet.total_cases} cases of which ${caseSet.critical_cases} are critical, but carries ${caseSet.cases.length} cases of which ${criticalCases} are critical`,
    );
  }

  return caseSet;
}
