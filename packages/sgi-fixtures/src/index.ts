/**
 * The single public entry of `@adem/sgi-fixtures`, and the only code module of
 * the workspace: a synchronous, typed reader that turns the read-only fixture
 * pack shipped in `../fixtures/` into plain data.
 *
 * This module performs no comparison and no scoring. Whether a recorded output
 * matches an expected output, how many cases matched, how many `critical` cases
 * failed and whether the outcome is `PASS` or `FAIL` are all decided by
 * `@adem/sgi-core` against the versioned pass rule; the loaders below return the
 * data those decisions read and nothing further. That division is what keeps this
 * workspace the inert data source the architecture describes.
 *
 * A **case-set directory** is a directory directly under `fixtures/` that holds a
 * `cases.json`, and the directory's name is the standard version identifier its
 * case set belongs to. The directory set is discovered rather than named because
 * `loadCandidate` and `loadExpectedOutcomes` take no version parameter: each
 * locates its document inside the discovered directories and throws rather than
 * guessing when none, or more than one, contains it. Discovered names are sorted
 * — this module's only ordering decision, which never reorders loaded data — so
 * the search order and every message read the same everywhere. A fixture pack
 * contributed through the extension seam in `@adem/sgi-core` is added by shipping
 * such a directory, with no change to this rule, to this module or to any scoring
 * code.
 *
 * **Determinism.** Nothing here reads a clock, a locale, a timezone, a random
 * source, a network, an environment variable or the working directory; nothing is
 * cached or held in module-level state, and each call reads its files fresh so a
 * long-lived process cannot serve stale fixture data. Paths resolve from this
 * module's own location, so the same files are read wherever the process was
 * started, and array order is exactly the order the files state. Repeated calls
 * against unchanged files therefore return deeply equal data — the reproducibility
 * the evaluation promises, where two runs of one submission over these fixtures
 * compare byte for byte.
 */

import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseSeverity, ReportOutcome } from "@adem/shared";

/**
 * The two closed vocabularies a parsed document is narrowed to, spelled as values
 * because `@adem/shared` is read here through a type-only import: this workspace
 * declares no runtime dependency, so the shared package's own tuples are not
 * reachable at runtime.
 *
 * Each array is `satisfies`-checked against the union it narrows, so a member
 * added to or removed from the shared vocabulary fails the build on this line
 * instead of leaving a fixture file that silently stops validating.
 */
const CASE_SEVERITIES = ["critical", "standard"] as const satisfies readonly CaseSeverity[];
const REPORT_OUTCOMES = ["PASS", "FAIL"] as const satisfies readonly ReportOutcome[];

/**
 * The declared key set of each document kind the pack publishes.
 *
 * A document carrying an undeclared key is refused rather than half-read: the
 * fixture format fixes these shapes, and a field no reader knows about is a field
 * no reader can be trusted to have seen. The key sets are the shapes the shared
 * JSON schemas state for the same documents.
 */
const CASE_SET_KEYS = ["standard_version_id", "total_cases", "critical_cases", "cases"] as const;
const FIXTURE_CASE_KEYS = ["id", "severity", "input", "expected_output"] as const;
const CANDIDATE_KEYS = [
  "candidate_id",
  "candidate_version_id",
  "standard_version_id",
  "recorded_outputs",
] as const;
const RECORDED_OUTPUT_KEYS = ["case_id", "output"] as const;
const EXPECTED_OUTCOMES_KEYS = ["standard_version_id", "candidates"] as const;
const EXPECTED_OUTCOME_KEYS = [
  "candidate_id",
  "candidate_version_id",
  "outcome",
  "matched_count",
  "total_count",
  "critical_failures",
  "failing_case_ids",
] as const;

/**
 * Any JSON value: the input and expected output of a fixture case, and the output
 * a candidate recorded for one.
 *
 * Declared locally because `@adem/shared` publishes no equivalent, and typed
 * rather than left as `unknown` because a fixture document is JSON by
 * construction: naming the type here is what lets a case's expected output be
 * compared as canonical JSON without a consumer re-checking what it holds.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** What a fixture case asks for: the instruction to follow and the source it is given. */
export interface FixtureInput {
  /** The instruction the candidate is asked to carry out on the source. */
  instruction: string;
  /** The source text the instruction applies to. */
  source: string;
}

/** One fixture case: what it asks for, what it expects, and how much its failure matters. */
export interface FixtureCase {
  /** The case identifier, unique within its case set. */
  id: string;
  /** Whether a failure of this case fails the candidate outright or counts as one miss. */
  severity: CaseSeverity;
  /** The instruction and source the case presents. */
  input: FixtureInput;
  /** The output a conforming candidate records for this case. */
  expected_output: JsonValue;
}

/** The case set of one standard version: its cases and the two counts that restate them. */
export interface CaseSet {
  /** The standard version identifier the set belongs to, as its directory is named. */
  standard_version_id: string;
  /** The number of cases the set holds, which its own `cases` array must agree with. */
  total_cases: number;
  /** How many of those cases are `critical`, which the array must likewise agree with. */
  critical_cases: number;
  /** The cases themselves, in the order the document states them. */
  cases: FixtureCase[];
}

/** One output a candidate recorded for one fixture case. */
export interface RecordedOutput {
  /** The case the recording is for, which the case set of the standard must define. */
  case_id: string;
  /** The recorded JSON value, compared as canonical JSON and never executed. */
  output: JsonValue;
}

/** A candidate submission as recorded on disk: declarative data, never executed. */
export interface CandidateSubmission {
  /** The candidate's short identifier, naming its file in the pack. */
  candidate_id: string;
  /** The versioned listing the recording belongs to, a value fixed by the data. */
  candidate_version_id: string;
  /** The standard version the recording answers, matching its directory. */
  standard_version_id: string;
  /** One recorded output per case the candidate answered, which may be fewer than the case set. */
  recorded_outputs: RecordedOutput[];
}

/** What one candidate is expected to score under its standard version's pass rule. */
export interface ExpectedOutcome {
  /** The candidate this expectation belongs to. */
  candidate_id: string;
  /** The versioned listing the expectation belongs to. */
  candidate_version_id: string;
  /** The outcome the pass rule yields for the candidate: `PASS` or `FAIL`. */
  outcome: ReportOutcome;
  /** How many cases the candidate is expected to match. */
  matched_count: number;
  /** How many cases the standard version defines. */
  total_count: number;
  /** How many `critical` cases the candidate is expected to fail. */
  critical_failures: number;
  /** The ids of the cases the candidate is expected not to match. */
  failing_case_ids: string[];
}

/** The expected outcomes of every candidate recorded against one standard version. */
export interface ExpectedOutcomes {
  /** The standard version identifier the expectations were recorded for. */
  standard_version_id: string;
  /** One expectation per recorded candidate, in the order the document states them. */
  candidates: ExpectedOutcome[];
}

/**
 * The two shared vocabularies this loader narrows to, re-exported so a consumer
 * reads a fixture's severity and outcome types from the same entry it reads the
 * loader from. Re-exported rather than restated: the shared package owns them,
 * and a second declaration here could drift from it.
 */
export type { CaseSeverity, ReportOutcome };

/** The fixtures directory, resolved from this module's own location and never from the working directory. */
const fixturesRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** A parsed JSON object: the shape every guard below narrows an unknown value to before a field is read. */
type JsonObject = { [key: string]: unknown };

/** Whether a value is a JSON object rather than an array, `null` or a scalar. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is an array, narrowed to `unknown[]` so no element is read as `any`. */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Whether a value is an array holding at least one element. */
function isNonEmptyArray(value: unknown): value is unknown[] {
  return isArray(value) && value.length > 0;
}

/** Whether a value is an array whose every element is a non-empty string. */
function isArrayOfNonEmptyStrings(value: unknown): value is string[] {
  return isArray(value) && value.every(isNonEmptyString);
}

/** Whether a value is a string holding at least one character. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Whether a value is an integer greater than or equal to zero. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Whether a value is a JSON value.
 *
 * `JSON.parse` can produce nothing else, so this guard is what carries that fact
 * into the types: without it a parsed `expected_output` or recorded `output`
 * could not be typed as {@link JsonValue} without an assertion.
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isJsonObject(value)) {
    return Object.keys(value).every((key) => isJsonValue(value[key]));
  }
  return false;
}

/** Whether a value is one of the two case severities {@link CaseSeverity} allows. */
function isCaseSeverity(value: unknown): value is CaseSeverity {
  return typeof value === "string" && CASE_SEVERITIES.some((severity) => severity === value);
}

/** Whether a value is one of the two outcomes {@link ReportOutcome} allows. */
function isReportOutcome(value: unknown): value is ReportOutcome {
  return typeof value === "string" && REPORT_OUTCOMES.some((outcome) => outcome === value);
}

/** Whether a value is a fixture input: an object carrying both of its declared non-empty strings. */
function isFixtureInput(value: unknown): value is FixtureInput {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value["instruction"]) &&
    isNonEmptyString(value["source"])
  );
}

/**
 * The one shape a refusal takes: a plain `Error` — a consumer needs no class to
 * catch it — whose message begins `sgi-fixtures:`, states the offending field or
 * id and names the absolute path it was read from. Every refusal below goes
 * through here, so neither the prefix nor the path can be forgotten.
 */
function fail(message: string, context: string): never {
  throw new Error(`sgi-fixtures: ${message} (${context})`);
}

/** The readable part of a caught value, whatever was thrown. */
function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reads a file as UTF-8 text, refusing with the labelled path rather than a bare filesystem error. */
function readText(filePath: string, label: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (cause) {
    return fail(`${label} cannot be read: ${describeCause(cause)}`, filePath);
  }
}

/** Parses JSON, refusing rather than propagating a syntax error and leaving the shape check to the caller. */
function parseJsonDocument(text: string, filePath: string, label: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (cause) {
    return fail(`${label} is not valid JSON: ${describeCause(cause)}`, filePath);
  }
}

/** Reads one fixture document, refusing anything that is not a JSON object. */
function readJsonObject(filePath: string, label: string): JsonObject {
  const parsed = parseJsonDocument(readText(filePath, label), filePath, label);
  if (!isJsonObject(parsed)) {
    return fail(`${label} must be a JSON object`, filePath);
  }
  return parsed;
}

/** Refuses an object carrying a key its document kind does not declare. */
function assertOnlyDeclaredKeys(
  object: JsonObject,
  declared: readonly string[],
  filePath: string,
  label: string,
): void {
  for (const key of Object.keys(object)) {
    if (!declared.includes(key)) {
      fail(`${label} carries the undeclared key "${key}"`, filePath);
    }
  }
}

/** Lists the fixtures directory, refusing when it is unreadable rather than reporting an empty case set. */
function readFixturesRootEntries(): Dirent[] {
  try {
    return readdirSync(fixturesRoot, { withFileTypes: true });
  } catch (cause) {
    return fail(`the fixtures directory cannot be read: ${describeCause(cause)}`, fixturesRoot);
  }
}

/**
 * The names of the case-set directories, sorted.
 *
 * The sort is the default one — UTF-16 code units, never a locale — so the search
 * order and every message read the same in every environment. It orders the search
 * and the messages only: the data a loader returns keeps the order its file states.
 */
function discoverCaseSetDirectories(): string[] {
  return readFixturesRootEntries()
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(fixturesRoot, name, "cases.json")))
    .sort();
}

/** A document located inside one discovered case-set directory. */
interface LocatedDocument {
  /** The case-set directory holding the document, which names a standard version. */
  directoryName: string;
  /** The absolute path of the document. */
  filePath: string;
}

/**
 * Refuses an identifier that is not a single path segment.
 *
 * Every path this module reads is composed by joining an identifier to
 * {@link fixturesRoot}, and `node:path` resolves `..` as it joins, so an
 * identifier such as `../other` would name a file outside the fixtures
 * directory. It is refused here, before a caller's identifier reaches a path of
 * its own, and no shape beyond that one segment is required: a case-set
 * directory's name and a candidate's file name are each one segment, so a pack
 * naming them differently from this one still loads.
 *
 * A value that is not a string at all is refused by the same rule and with the
 * same message, because this is the boundary a caller outside these types
 * reaches: reading the value as an unknown first keeps a refusal in place where
 * inspecting it directly would raise the language's own `TypeError` instead.
 */
function assertIdentifierSegment(identifier: string, subject: string): void {
  const value: unknown = identifier;
  if (
    typeof value !== "string" ||
    value === "" ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    fail(
      `${subject} "${String(value)}" is not a single path segment: it must not be empty, "." or "..", nor contain "/" or "\\"`,
      fixturesRoot,
    );
  }
}

/**
 * Finds the one case-set directory holding `relativePath`.
 *
 * Nothing names a version here, so a match in no directory and a match in more
 * than one are both refusals: the first names every directory searched, the second
 * names every directory that holds the document, and neither guesses which was
 * meant.
 */
function locateCaseSetDocument(relativePath: string, subject: string): LocatedDocument {
  const directories = discoverCaseSetDirectories();
  const matches = directories.filter((name) => existsSync(join(fixturesRoot, name, relativePath)));
  const [directoryName, ...others] = matches;
  if (directoryName === undefined) {
    const searched = directories.length === 0 ? "no case-set directory exists" : directories.join(", ");
    return fail(
      `no case-set directory contains ${relativePath}, so ${subject} cannot be read; searched ${searched}`,
      fixturesRoot,
    );
  }
  if (others.length > 0) {
    return fail(
      `${relativePath} for ${subject} exists in more than one case-set directory: ${matches.join(
        ", ",
      )}`,
      fixturesRoot,
    );
  }
  return { directoryName, filePath: join(fixturesRoot, directoryName, relativePath) };
}

/**
 * Reads and validates the case set of the directory named `directoryName`.
 *
 * Shared by the public case-set loader and by the candidate validator, so a
 * candidate's `case_id`s are checked against the same parsed case set its own
 * standard publishes rather than against a second reading of the same file.
 */
function readCaseSet(directoryName: string): CaseSet {
  assertIdentifierSegment(directoryName, "the case-set directory name");
  const label = "cases.json";
  const filePath = join(fixturesRoot, directoryName, label);
  const document = readJsonObject(filePath, label);
  assertOnlyDeclaredKeys(document, CASE_SET_KEYS, filePath, label);

  const standardVersionId = document["standard_version_id"];
  if (!isNonEmptyString(standardVersionId)) {
    return fail(`${label} declares no non-empty string standard_version_id`, filePath);
  }
  if (standardVersionId !== directoryName) {
    return fail(
      `${label} declares standard_version_id "${standardVersionId}" but is read from directory "${directoryName}"`,
      filePath,
    );
  }

  const cases = document["cases"];
  if (!isNonEmptyArray(cases)) {
    return fail(`${label} carries no non-empty cases array`, filePath);
  }

  const totalCases = document["total_cases"];
  if (!isNonNegativeInteger(totalCases)) {
    return fail(`${label} declares no non-negative integer total_cases`, filePath);
  }
  if (totalCases !== cases.length) {
    return fail(`${label} declares total_cases ${totalCases} but contains ${cases.length}`, filePath);
  }

  const criticalCases = document["critical_cases"];
  if (!isNonNegativeInteger(criticalCases)) {
    return fail(`${label} declares no non-negative integer critical_cases`, filePath);
  }

  const fixtureCases: FixtureCase[] = [];
  const seenCaseIds = new Set<string>();
  let criticalCount = 0;
  for (const [index, value] of cases.entries()) {
    const caseLabel = `${label} case at index ${index}`;
    if (!isJsonObject(value)) {
      return fail(`${caseLabel} must be a JSON object`, filePath);
    }
    assertOnlyDeclaredKeys(value, FIXTURE_CASE_KEYS, filePath, caseLabel);

    const id = value["id"];
    if (!isNonEmptyString(id)) {
      return fail(`${caseLabel} declares no non-empty string id`, filePath);
    }
    if (seenCaseIds.has(id)) {
      return fail(`${label} repeats the case id "${id}"`, filePath);
    }
    seenCaseIds.add(id);

    const severity = value["severity"];
    if (!isCaseSeverity(severity)) {
      return fail(
        `${caseLabel} declares severity "${String(severity)}", outside "critical" and "standard"`,
        filePath,
      );
    }

    const input = value["input"];
    if (!isFixtureInput(input)) {
      return fail(
        `${caseLabel} carries no input object with non-empty "instruction" and "source" strings`,
        filePath,
      );
    }

    const expectedOutput = value["expected_output"];
    if (!isJsonValue(expectedOutput)) {
      return fail(`${caseLabel} carries no JSON expected_output`, filePath);
    }

    if (severity === "critical") {
      criticalCount += 1;
    }
    fixtureCases.push({ id, severity, input, expected_output: expectedOutput });
  }

  if (criticalCases !== criticalCount) {
    return fail(
      `${label} declares critical_cases ${criticalCases} but ${criticalCount} of its cases are critical`,
      filePath,
    );
  }

  return {
    standard_version_id: standardVersionId,
    total_cases: totalCases,
    critical_cases: criticalCases,
    cases: fixtureCases,
  };
}

/** Reads and validates one candidate document found at `filePath` in the case-set directory `directoryName`. */
function readCandidate(
  directoryName: string,
  candidateId: string,
  filePath: string,
): CandidateSubmission {
  const label = `candidates/${candidateId}.json`;
  const document = readJsonObject(filePath, label);
  assertOnlyDeclaredKeys(document, CANDIDATE_KEYS, filePath, label);

  const candidateIdValue = document["candidate_id"];
  if (!isNonEmptyString(candidateIdValue)) {
    return fail(`${label} declares no non-empty string candidate_id`, filePath);
  }
  if (candidateIdValue !== candidateId) {
    return fail(
      `${label} declares candidate_id "${candidateIdValue}" but was requested as candidate "${candidateId}"`,
      filePath,
    );
  }

  const candidateVersionId = document["candidate_version_id"];
  if (!isNonEmptyString(candidateVersionId)) {
    return fail(`${label} declares no non-empty string candidate_version_id`, filePath);
  }

  const standardVersionId = document["standard_version_id"];
  if (!isNonEmptyString(standardVersionId)) {
    return fail(`${label} declares no non-empty string standard_version_id`, filePath);
  }
  if (standardVersionId !== directoryName) {
    return fail(
      `${label} declares standard_version_id "${standardVersionId}" but is read from directory "${directoryName}"`,
      filePath,
    );
  }

  const recordedOutputs = document["recorded_outputs"];
  if (!isArray(recordedOutputs)) {
    return fail(`${label} carries no recorded_outputs array`, filePath);
  }

  const knownCaseIds = new Set(readCaseSet(directoryName).cases.map((fixtureCase) => fixtureCase.id));
  const seenCaseIds = new Set<string>();
  const recorded: RecordedOutput[] = [];
  for (const [index, value] of recordedOutputs.entries()) {
    const entryLabel = `${label} recorded_outputs entry at index ${index}`;
    if (!isJsonObject(value)) {
      return fail(`${entryLabel} must be a JSON object`, filePath);
    }
    assertOnlyDeclaredKeys(value, RECORDED_OUTPUT_KEYS, filePath, entryLabel);

    const caseId = value["case_id"];
    if (!isNonEmptyString(caseId)) {
      return fail(`${entryLabel} declares no non-empty string case_id`, filePath);
    }
    if (seenCaseIds.has(caseId)) {
      return fail(`${label} records more than one output for case "${caseId}"`, filePath);
    }
    seenCaseIds.add(caseId);

    if (!knownCaseIds.has(caseId)) {
      return fail(
        `${entryLabel} names case "${caseId}", which the case set of "${directoryName}" does not define`,
        filePath,
      );
    }

    const output = value["output"];
    if (!isJsonValue(output)) {
      return fail(`${entryLabel} carries no JSON output`, filePath);
    }
    recorded.push({ case_id: caseId, output });
  }

  return {
    candidate_id: candidateIdValue,
    candidate_version_id: candidateVersionId,
    standard_version_id: standardVersionId,
    recorded_outputs: recorded,
  };
}

/** Reads and validates the expected-outcomes document found at `filePath`. */
function readExpectedOutcomes(filePath: string): ExpectedOutcomes {
  const label = "expected-outcomes.json";
  const document = readJsonObject(filePath, label);
  assertOnlyDeclaredKeys(document, EXPECTED_OUTCOMES_KEYS, filePath, label);

  const standardVersionId = document["standard_version_id"];
  if (!isNonEmptyString(standardVersionId)) {
    return fail(`${label} declares no non-empty string standard_version_id`, filePath);
  }

  const candidates = document["candidates"];
  if (!isNonEmptyArray(candidates)) {
    return fail(`${label} carries no non-empty candidates array`, filePath);
  }

  const outcomes: ExpectedOutcome[] = [];
  const seenCandidateIds = new Set<string>();
  for (const [index, value] of candidates.entries()) {
    const entryLabel = `${label} candidate at index ${index}`;
    if (!isJsonObject(value)) {
      return fail(`${entryLabel} must be a JSON object`, filePath);
    }
    assertOnlyDeclaredKeys(value, EXPECTED_OUTCOME_KEYS, filePath, entryLabel);

    const candidateId = value["candidate_id"];
    if (!isNonEmptyString(candidateId)) {
      return fail(`${entryLabel} declares no non-empty string candidate_id`, filePath);
    }
    if (seenCandidateIds.has(candidateId)) {
      return fail(`${label} repeats the candidate id "${candidateId}"`, filePath);
    }
    seenCandidateIds.add(candidateId);

    const candidateVersionId = value["candidate_version_id"];
    if (!isNonEmptyString(candidateVersionId)) {
      return fail(`${entryLabel} declares no non-empty string candidate_version_id`, filePath);
    }

    const outcome = value["outcome"];
    if (!isReportOutcome(outcome)) {
      return fail(
        `${entryLabel} declares outcome "${String(outcome)}", outside "PASS" and "FAIL"`,
        filePath,
      );
    }

    const matchedCount = value["matched_count"];
    if (!isNonNegativeInteger(matchedCount)) {
      return fail(`${entryLabel} declares no non-negative integer matched_count`, filePath);
    }

    const totalCount = value["total_count"];
    if (!isNonNegativeInteger(totalCount)) {
      return fail(`${entryLabel} declares no non-negative integer total_count`, filePath);
    }

    const criticalFailures = value["critical_failures"];
    if (!isNonNegativeInteger(criticalFailures)) {
      return fail(`${entryLabel} declares no non-negative integer critical_failures`, filePath);
    }

    const failingCaseIds = value["failing_case_ids"];
    if (!isArrayOfNonEmptyStrings(failingCaseIds)) {
      return fail(`${entryLabel} carries no failing_case_ids array of case ids`, filePath);
    }

    outcomes.push({
      candidate_id: candidateId,
      candidate_version_id: candidateVersionId,
      outcome,
      matched_count: matchedCount,
      total_count: totalCount,
      critical_failures: criticalFailures,
      failing_case_ids: failingCaseIds,
    });
  }

  return { standard_version_id: standardVersionId, candidates: outcomes };
}

/**
 * Reads the case set of one standard version, from the case-set directory its
 * identifier names.
 *
 * Returns the case set as its document states it. It refuses — throwing a plain
 * `Error` whose message begins `sgi-fixtures:` and names the path it concerns —
 * when the requested identifier is not a single path segment, so it can name no
 * directory outside `fixtures/`; when the file cannot be read or is not a JSON
 * object; when an undeclared key appears at the document's top level or in a case;
 * when `standard_version_id` is not the requested identifier; when `cases` is not
 * a non-empty array; when `total_cases` or `critical_cases` is not a non-negative
 * integer or disagrees with that array; when a case `id` is empty, not a string or
 * repeated; when a `severity` is outside `critical` and `standard`; when a case's
 * `input` lacks its two non-empty strings; or when a case carries no JSON
 * `expected_output`. It never returns partial data and never falls back to a
 * default case set.
 */
export function loadCaseSet(standardVersionId: string): CaseSet {
  return readCaseSet(standardVersionId);
}

/**
 * Reads one candidate submission by its identifier, from the `candidates/`
 * directory of whichever case-set directory holds its file.
 *
 * Returns the submission as recorded. It refuses when `candidateId` is not a
 * single path segment, so no identifier can name a file outside `fixtures/`; when
 * no case-set directory holds `candidates/<candidateId>.json`, when more than one
 * holds it — naming every directory that matched — and on any structural defect:
 * an unreadable file, a document that is not a JSON object, an undeclared key at
 * the top level or in a recorded output, a `candidate_id` or `candidate_version_id`
 * that is missing, empty or not a string, a `candidate_id` that is not the
 * identifier the submission was requested by, a `standard_version_id` that does
 * not match its directory, a `recorded_outputs` that is not an array, a repeated
 * `case_id`, or a `case_id` the case set of that standard does not define.
 *
 * **Incomplete coverage is not a defect here.** A submission may legitimately
 * answer fewer cases than its standard defines — the API turns a missing fixture
 * case into `422` before any report is written — so how much of the case set a
 * submission covers is deliberately unchecked by this loader.
 */
export function loadCandidate(candidateId: string): CandidateSubmission {
  assertIdentifierSegment(candidateId, "the candidate identifier");
  const located = locateCaseSetDocument(
    `candidates/${candidateId}.json`,
    `candidate "${candidateId}"`,
  );
  return readCandidate(located.directoryName, candidateId, located.filePath);
}

/**
 * Reads the expected outcomes recorded for every candidate of the standard
 * version whose case-set directory holds `expected-outcomes.json`.
 *
 * Returns the expectations as recorded. It refuses when no case-set directory
 * holds that document and when more than one holds it, naming every directory
 * that matched. It likewise refuses a document that cannot be read, is not a JSON
 * object, carries an undeclared key at its top level or in an entry, declares no
 * non-empty string `standard_version_id`, carries no non-empty `candidates`
 * array, or repeats a `candidate_id`, and refuses an entry whose `candidate_id`
 * or `candidate_version_id` is missing, empty or not a string, whose `outcome`
 * is outside `PASS` and `FAIL`, whose `matched_count`, `total_count` or
 * `critical_failures` is not a non-negative integer, or whose `failing_case_ids`
 * is not an array of case ids.
 */
export function loadExpectedOutcomes(): ExpectedOutcomes {
  const located = locateCaseSetDocument("expected-outcomes.json", "the expected-outcomes document");
  return readExpectedOutcomes(located.filePath);
}
