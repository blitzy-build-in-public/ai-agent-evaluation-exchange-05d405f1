/**
 * The judge of ADEM's Standard Gate Index: the single place a declarative candidate submission
 * is scored, and the producer of the per-case results, the totals, the failing case ids and the
 * `PASS`/`FAIL` outcome an evaluation report is built from.
 *
 * **The rule is versioned data, never a literal.** The two thresholds are read from the standard
 * version handed in, and no threshold, case count, critical-case count or standard identifier is
 * written in this file. A rule that has become inconvenient is therefore published as a new
 * standard version — a new `standard_versions` row — rather than widened here, which is what makes
 * "the same fixture evaluated twice yields identical per-case results and the same outcome, from
 * versioned criteria alone" a property of this code rather than a promise about it.
 *
 * **Pure, and writing nothing.** There is no database handle, no SQL, no file, no ledger, no
 * sponsorship, no path, no environment variable and no network: a standard version, a case set and
 * a submission go in and a plain record comes out. `standard_versions`, `evaluation_reports`,
 * `report_case_results` and `governance_events` are untouched by the scoring path, and because no
 * commercial or sponsored value enters this module, none can reach a measurement through it.
 * Nothing is read from a clock, a locale, a timezone or a random source, two calls over deeply
 * equal arguments return deeply equal results, and none of the three arguments is mutated: every
 * array and object returned is newly built.
 *
 * **Nothing submitted is executed.** A candidate is declarative data — a case id and a recorded
 * JSON value per case — compared as canonical JSON text and never evaluated, imported or
 * interpreted. There is no `eval`, no dynamic import of submitted content and no sandbox in this
 * path.
 *
 * **The refusals this module owns.** `IncompleteSubmissionError` (a well-formed submission that
 * records no output for some fixture case) is what `apps/api` maps to the contract's `422` before
 * any report is written; `UnknownCaseError` and `DuplicateCaseError` (a `case_id` the case set does
 * not define, and a repeated `case_id`) map to `400`, because a malformed submission is a
 * malformed request rather than an incomplete one. `StandardDriftError` is imported from
 * `../standards/standard-registry` rather than redeclared — it carries `code: "standard_drift"`,
 * which maps to `400` — and is raised when the versioned criteria, the case set and the
 * submission's own declared version do not agree. It is the pure twin of `getStandardCaseSet` in
 * that module, which raises the same error when a loaded case set disagrees with the version row
 * it was loaded for, and it is why `apps/api` never imports `@adem/sgi-fixtures` directly.
 *
 * **The order of the checks is part of the contract**, because it decides which refusal fires when
 * a submission has more than one defect: resolve the version label, run the drift checks, then the
 * structural pass over the recorded outputs — which reports a malformed submission — and only
 * after that the completeness check, so a submission that is both malformed and incomplete is
 * answered `400` rather than `422`.
 *
 * **The extension seam.** `ScoreSubmissionOptions.checks` is how a community `EvaluatorCheck`
 * replaces the canonical comparison for the case ids it declares, with no edit to this folder.
 * Nothing else here knows a check exists, and with no checks supplied — which is what the
 * product's own evaluation path does — every case is decided by `./compare-recorded-output`.
 */

import type { CandidateSubmission, CaseSet, JsonValue } from "@adem/sgi-fixtures";
import type { CaseSeverity, ReportOutcome } from "@adem/shared";
import type { StandardVersionDefinition } from "../standards/sgi-so-1.0.0";
import { StandardDriftError } from "../standards/standard-registry";
import type { EvaluatorCheck } from "../extensions/evaluator-check";
import { compareRecordedOutput } from "./compare-recorded-output";
import type { CaseComparison } from "./compare-recorded-output";

/**
 * The result of one fixture case, as `report_case_results` stores it.
 *
 * Exactly these five members, and deliberately no more: `./compare-recorded-output` also reports
 * which of its three outcomes decided a case, and this record does not carry it, because
 * `../reports/build-report` writes one evidence row per case field for field — the five values
 * below. A sixth member here would have to be stripped there.
 *
 * `expectedJson` and `actualJson` are **canonical JSON text** on every case, including a case that
 * does not match: they are both the compared artefact and the evidence the report stores, so a
 * report read back from the database states byte for byte what the comparison compared.
 */
export interface CaseResult {
  /** The fixture case this result is for, unique within the standard version. */
  caseId: string;

  /** The severity the case set gave the case: `critical` or `standard`. */
  severity: CaseSeverity;

  /** The case's expected output as canonical JSON text. */
  expectedJson: string;

  /** The output the candidate recorded for the case, as canonical JSON text. */
  actualJson: string;

  /** Whether the canonical actual equalled the canonical expected. */
  match: boolean;
}

/**
 * A scored submission: everything a report needs, and nothing that varies between two runs of the
 * same submission.
 *
 * It carries no report identifier and no instant, because both are generated at write time and lie
 * outside the payload two runs compare. `standardVersionId` is the contract-facing version label
 * and `candidateVersionId` is the identifier the submission declares, so a caller hands one record
 * to the report builder rather than reassembling that pair itself.
 *
 * `caseResults` is in **case-set order** — the order the fixture document states, which is the
 * order a reader walks the evidence in — and `failingCaseIds` is ascending by UTF-16 code unit.
 */
export interface ScoredSubmission {
  /** The standard version label the criteria were read from. */
  standardVersionId: string;

  /** The versioned listing the submission is for, as the submission declares it. */
  candidateVersionId: string;

  /** One result per fixture case, in case-set order. */
  caseResults: CaseResult[];

  /** How many cases matched. */
  matchedCount: number;

  /** How many cases were scored, which is the case set's own size. */
  totalCount: number;

  /** How many `critical` cases failed, where any value above the allowed count is a `FAIL`. */
  criticalFailures: number;

  /** The ids of the cases that did not match, ascending. */
  failingCaseIds: string[];

  /** `PASS` or `FAIL`, derived from the standard version's own thresholds. */
  outcome: ReportOutcome;
}

/**
 * The optional inputs of {@link scoreSubmission}.
 *
 * `checks` is the community extension seam: each `EvaluatorCheck` replaces the built-in canonical
 * comparison for the case ids it declares, and the first check in the array whose `appliesTo`
 * includes a case id is the one used for that case. The product's own evaluation path supplies no
 * checks, so an ordinary run is decided entirely by the canonical comparison.
 *
 * A check supplied here must be as deterministic as that comparison — no clock, no locale, no
 * timezone, no network and no random source — because the reproducibility the evaluator promises
 * covers contributions too: a check whose verdict varies between two runs of one submission breaks
 * an invariant of the report rather than merely looking odd.
 *
 * Optional, and read only as absent or supplied: no caller passes `{ checks: undefined }`.
 */
export interface ScoreSubmissionOptions {
  /** The checks that replace the canonical comparison for the cases they declare. */
  readonly checks?: readonly EvaluatorCheck[];
}

/**
 * Raised when a submission records no output for one or more fixture cases.
 *
 * The submission is well formed — every `case_id` it states is one the case set defines and none
 * is repeated — but it does not cover the case set its standard version publishes, so those cases
 * have nothing to compare and no report can be written for it. `apps/api` maps `code` to the
 * contract's `422` before any report is written: this is the difference between a submission that
 * answers fewer cases than the standard defines and one that is malformed.
 *
 * `missingCaseIds` holds the case ids with no recording, in **case-set order**, so the refusal
 * reads the same way on every run.
 */
export class IncompleteSubmissionError extends Error {
  /** The machine-readable code `apps/api` maps to the contract's `422`. */
  readonly code = "incomplete_submission" as const;

  /** The fixture cases the submission recorded no output for, in case-set order. */
  readonly missingCaseIds: readonly string[];

  constructor(missingCaseIds: readonly string[]) {
    super(
      `submission records no output for ${missingCaseIds.length} fixture case(s): ${missingCaseIds.join(
        ", ",
      )}`,
    );
    this.name = "IncompleteSubmissionError";
    this.missingCaseIds = missingCaseIds;
  }
}

/**
 * Raised when a submission records an output for a case id its standard version's case set does
 * not define.
 *
 * `apps/api` maps `code` to the contract's `400`: the submission names a case that does not exist,
 * so it is malformed rather than merely incomplete, and no report is written for it.
 */
export class UnknownCaseError extends Error {
  /** The machine-readable code `apps/api` maps to the contract's `400`. */
  readonly code = "unknown_case" as const;

  /** The case id the case set does not define. */
  readonly caseId: string;

  constructor(caseId: string) {
    super(`submission records an output for case "${caseId}", which the case set does not define`);
    this.name = "UnknownCaseError";
    this.caseId = caseId;
  }
}

/**
 * Raised when a submission records more than one output for the same case id.
 *
 * A case has one recorded output, so a repeat leaves no single value to compare and the submission
 * is malformed: `apps/api` maps `code` to the contract's `400`, and no report is written for it.
 */
export class DuplicateCaseError extends Error {
  /** The machine-readable code `apps/api` maps to the contract's `400`. */
  readonly code = "duplicate_case" as const;

  /** The repeated case id. */
  readonly caseId: string;

  constructor(caseId: string) {
    super(`submission records more than one output for case "${caseId}"`);
    this.name = "DuplicateCaseError";
    this.caseId = caseId;
  }
}

/**
 * The verdict for one case: the first supplied check that declares the case id, or the built-in
 * canonical comparison.
 *
 * The first match wins, so a check is consulted for exactly the cases it declares and for no
 * others, and with `checks` absent or empty every case takes the canonical path — which is what
 * makes the seam a pure addition to the shipped scoring behaviour. A value a check returns is used
 * as it stands: it is not validated or re-wrapped, because a check is validated where it is
 * registered, at composition time.
 *
 * An error a check throws is deliberately not caught. A throwing check is a defect in a
 * contribution rather than a request the product can answer, so the call refuses instead of
 * quietly scoring the case as a match.
 */
function selectComparison(
  caseId: string,
  expected: JsonValue,
  recorded: JsonValue,
  checks: readonly EvaluatorCheck[] | undefined,
): CaseComparison {
  if (checks !== undefined) {
    for (const check of checks) {
      if (check.appliesTo.includes(caseId)) {
        return check.compare(expected, recorded);
      }
    }
  }
  return compareRecordedOutput(expected, recorded);
}

/**
 * Scores one declarative candidate submission against one standard version's fixture case set.
 *
 * It returns a {@link ScoredSubmission}: the resolved standard version label, the submission's
 * candidate version id, one {@link CaseResult} per fixture case in case-set order, the matched and
 * total counts, the critical failures, the failing case ids in ascending order, and the
 * `PASS`/`FAIL` outcome. The outcome is derived from the standard version's own
 * `passThresholdMatches` and `criticalFailuresAllowed`, so changing the rule means publishing a new
 * standard version rather than editing this file. Two runs over one submission return deeply equal
 * results, and none of `standard`, `fixtures` or `submission` is mutated, nor is anything written
 * anywhere.
 *
 * The steps run in a fixed order, because that order decides which refusal fires when a submission
 * has more than one defect:
 *
 * 1. The version label is resolved from the standard's `versionLabel`, which is the identifier a
 *    report cites, and the case set's identity is the version's `fixtureSetId` — the reference the
 *    fixture loader resolves and the identifier a loaded case set carries, which is the same
 *    comparison the standards registry makes when it loads a case set for a version. Neither is a
 *    literal.
 * 2. Six drift checks run, all raising `StandardDriftError` (`code: "standard_drift"`): the case
 *    set's identity, the version the submission declares, the case set's two published counts
 *    against the version's, and the case set's own internal consistency — its `cases` array against
 *    its `total_cases`, and its `critical` cases against its `critical_cases`.
 * 3. One pass over `submission.recorded_outputs` in submission order refuses a `case_id` the case
 *    set does not define with `UnknownCaseError` (400), and a repeated one with
 *    `DuplicateCaseError` (400). The first offending recording in submission order decides which of
 *    the two fires, which is deterministic because the recordings are an ordered array.
 * 4. Completeness is checked in case-set order and raises `IncompleteSubmissionError` (422) for the
 *    cases left unrecorded. Structure precedes completeness because a malformed submission is a
 *    malformed request: a submission carrying an unknown or repeated case id is answered `400` even
 *    when it also fails to cover the case set. The fixture loader deliberately does not enforce
 *    coverage, which is why this check exists here.
 * 5. Each case is compared in case-set order, through the extension seam when checks were supplied
 *    and through the canonical comparison otherwise. Both canonical strings the comparison reports
 *    are carried into the result, so the stored evidence is exactly what was compared.
 * 6. The matched count, the critical failures and the failing case ids are derived from those
 *    results — the ids sorted by UTF-16 code unit — and the outcome is read from the standard
 *    version's `passThresholdMatches` and `criticalFailuresAllowed`, which are two criteria of the
 *    standard rather than two constants of this file.
 *
 * Within a scored run every case has a recording by step 4, so no case can end with an empty
 * `actualJson`: the `"absent"` outcome of `./compare-recorded-output` is unreachable here and is
 * deliberately not branched on.
 *
 * Nothing submitted is executed, and no case's recording is read as anything other than data.
 *
 * @param standard - The versioned criteria, including the two counts the outcome is derived from.
 * @param fixtures - The case set the version's fixture reference resolves to.
 * @param submission - The candidate's declarative recordings, one per case.
 * @param options - Optional community checks that replace the canonical comparison for the cases
 * they declare.
 * @returns The per-case results in case-set order, the totals, the failing case ids ascending and
 * the outcome.
 * @throws {StandardDriftError} when the criteria, the case set and the submission's declared
 * version do not agree, or the case set is internally inconsistent.
 * @throws {UnknownCaseError} when a recorded output names a case id the case set does not define.
 * @throws {DuplicateCaseError} when a recorded output repeats a case id.
 * @throws {IncompleteSubmissionError} when a fixture case has no recorded output.
 * @throws {UnrenderableValueError} when a recorded output, or a case's expected output, is a value
 * canonical JSON cannot represent — one that refers to itself, one holding a member that cannot be
 * read, or one that is not JSON data. The refusal comes from `./canonical-json` and carries
 * `code: "unrenderable_value"`. It is a property of the value, never of its size or its shape: a
 * well-formed recording of any depth is scored, not refused.
 * @throws Whatever a supplied check throws: a check that fails is a contribution defect, and the
 * call refuses rather than scoring the case as a match.
 */
export function scoreSubmission(
  standard: StandardVersionDefinition,
  fixtures: CaseSet,
  submission: CandidateSubmission,
  options?: ScoreSubmissionOptions,
): ScoredSubmission {
  const standardVersionId = standard.versionLabel;
  const caseSetId = standard.fixtureSetId;

  if (fixtures.standard_version_id !== caseSetId) {
    throw new StandardDriftError(
      `standard version "${standardVersionId}" names the fixture set "${caseSetId}", but the case set handed in identifies itself as "${fixtures.standard_version_id}"`,
      standardVersionId,
    );
  }

  if (submission.standard_version_id !== standardVersionId) {
    throw new StandardDriftError(
      `standard version "${standardVersionId}" was asked to score a submission declared against standard version "${submission.standard_version_id}"`,
      standardVersionId,
    );
  }

  if (fixtures.total_cases !== standard.totalCases) {
    throw new StandardDriftError(
      `standard version "${standardVersionId}" publishes ${standard.totalCases} cases, but the case set "${caseSetId}" states ${fixtures.total_cases}`,
      standardVersionId,
    );
  }

  if (fixtures.critical_cases !== standard.criticalCases) {
    throw new StandardDriftError(
      `standard version "${standardVersionId}" publishes ${standard.criticalCases} critical cases, but the case set "${caseSetId}" states ${fixtures.critical_cases}`,
      standardVersionId,
    );
  }

  if (fixtures.cases.length !== fixtures.total_cases) {
    throw new StandardDriftError(
      `case set "${caseSetId}" states ${fixtures.total_cases} cases but carries ${fixtures.cases.length}`,
      standardVersionId,
    );
  }

  const caseSetCriticalCount = fixtures.cases.filter(
    (fixtureCase) => fixtureCase.severity === "critical",
  ).length;
  if (caseSetCriticalCount !== fixtures.critical_cases) {
    throw new StandardDriftError(
      `case set "${caseSetId}" states ${fixtures.critical_cases} critical cases but ${caseSetCriticalCount} of its cases are critical`,
      standardVersionId,
    );
  }

  const caseIds = new Set<string>(fixtures.cases.map((fixtureCase) => fixtureCase.id));
  const recordedById = new Map<string, JsonValue>();

  for (const recordedOutput of submission.recorded_outputs) {
    if (!caseIds.has(recordedOutput.case_id)) {
      throw new UnknownCaseError(recordedOutput.case_id);
    }
    if (recordedById.has(recordedOutput.case_id)) {
      throw new DuplicateCaseError(recordedOutput.case_id);
    }
    recordedById.set(recordedOutput.case_id, recordedOutput.output);
  }

  const missingCaseIds = fixtures.cases
    .filter((fixtureCase) => !recordedById.has(fixtureCase.id))
    .map((fixtureCase) => fixtureCase.id);
  if (missingCaseIds.length > 0) {
    throw new IncompleteSubmissionError(missingCaseIds);
  }

  const caseResults: CaseResult[] = [];
  for (const fixtureCase of fixtures.cases) {
    const recorded = recordedById.get(fixtureCase.id);
    if (recorded === undefined) {
      // Unreachable: the completeness check above proved every case id has a recording. Stated as
      // an incomplete submission rather than compared as an absent one, because a case with no
      // recording is not a case that failed.
      throw new IncompleteSubmissionError([fixtureCase.id]);
    }

    const comparison = selectComparison(
      fixtureCase.id,
      fixtureCase.expected_output,
      recorded,
      options?.checks,
    );

    caseResults.push({
      caseId: fixtureCase.id,
      severity: fixtureCase.severity,
      expectedJson: comparison.expectedCanonical,
      actualJson: comparison.actualCanonical,
      match: comparison.match,
    });
  }

  const matchedCount = caseResults.filter((caseResult) => caseResult.match).length;
  const criticalFailures = caseResults.filter(
    (caseResult) => !caseResult.match && caseResult.severity === "critical",
  ).length;

  // Sorted by UTF-16 code unit rather than by a locale's collation rules: a locale-aware comparison
  // would order this list differently on machines with different locales, so two runs of one
  // submission would not compare equal. The shipped case set already states its cases in ascending
  // id order, so this is a guarantee of the returned value rather than a correction to it.
  const failingCaseIds = caseResults
    .filter((caseResult) => !caseResult.match)
    .map((caseResult) => caseResult.caseId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  // The pass rule, read from the standard version alone. No threshold, case count or critical-case
  // count appears in this file: a rule changed here would leave the published standard and the
  // evaluator disagreeing about the same report.
  const outcome: ReportOutcome =
    matchedCount >= standard.passThresholdMatches &&
    criticalFailures <= standard.criticalFailuresAllowed
      ? "PASS"
      : "FAIL";

  return {
    standardVersionId,
    candidateVersionId: submission.candidate_version_id,
    caseResults,
    matchedCount,
    totalCount: caseResults.length,
    criticalFailures,
    failingCaseIds,
    outcome,
  };
}
