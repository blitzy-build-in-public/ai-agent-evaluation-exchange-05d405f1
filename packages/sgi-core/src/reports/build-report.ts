/**
 * The constructor of an SGI evaluation report: the one place a scored submission becomes the report
 * record a writer persists as an `evaluation_reports` row beside one `report_case_results` row per
 * case, and the one place the closed report-label vocabulary is decided.
 *
 * **Pure, and writing nothing.** A scored submission and the values a report cannot derive come in
 * and a plain record comes out. Nothing here opens a connection, runs SQL, reads a file or an
 * environment variable, resolves a path or reaches the network, which is what lets the whole
 * construction be tested in a forked process with no setup. Persisting the record belongs to
 * `./report-repository` and the schema to `packages/shared/migrations`; the columns of `listings`,
 * `listing_versions` and `accounts` belong to `apps/api` and are never read here, so the flag that
 * makes a report a sample reaches this module only as the caller's already-computed label.
 *
 * **The identity boundary.** `reportId` and `createdAt` are the only values this file generates.
 * They are generated at write time and lie **outside** the payload two runs of one submission
 * compare. That exclusion is deliberate and load-bearing: a retest produces a new report per
 * submission, so a payload carrying a fresh identifier or instant could not compare byte for byte
 * across two runs of the same recording — the reproducibility the evaluator promises. A caller that
 * already holds both values (a test, a replay) supplies them and nothing is generated; `new Date()`
 * below is the only clock read in the file and must never be moved into the case results.
 *
 * **What is copied and what is resolved.** Each per-case field and the four totals come from the
 * scored submission untouched and in the order the scorer returned them, which is case-set order.
 * `expectedJson` and `actualJson` are already canonical JSON text — the artefact the comparison
 * compared and the evidence the report stores — so re-serialising them here would move the compared
 * payload and break the equality of two runs. The counts and the outcome are never recomputed,
 * because the pass rule belongs to the versioned standard and `scoreSubmission` is where it is
 * applied. Two values are resolved rather than copied: `rubricReference`, read from the standard
 * version definition that owns it, and the pair of identity values above.
 *
 * **The label.** `label` passes through as the evidence of origin the caller computed from the
 * candidate version's `is_fixture_candidate` flag and the outcome; {@link deriveReportLabel} is the
 * one statement of that rule. Every report carries one of the two labels, a failed report included,
 * and a badge is issued on a pass alone.
 *
 * **What it refuses.** `UnknownStandardError` (code `unknown_standard`, imported from
 * `../standards/standard-registry` rather than redeclared) when the caller names a standard version
 * this release does not publish: a report citing a rubric reference that belongs to another version
 * would state criteria it was not scored against, and the writer refuses the same label for the same
 * reason. There is no other refusal, and no input returns a partial record — a submission that
 * matched no case still yields a complete record with outcome `FAIL` and a label.
 */

import { randomUUID } from "node:crypto";

import { REPORT_LABEL_SAMPLE, REPORT_LABEL_VERIFIED_IN_DEMO } from "@adem/shared";
import type { CaseSeverity, ReportLabel, ReportOutcome } from "@adem/shared";

import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";
import { UnknownStandardError } from "../standards/standard-registry";
import type { CaseResult, ScoredSubmission } from "../scoring/score-submission";

/**
 * One fixture case's evidence as the report carries it, and as `report_case_results` stores it.
 *
 * Exactly these five members — the case, its severity, the two canonical strings and the verdict —
 * and deliberately no sixth. The comparison also reports which of its outcomes decided a case, and
 * that value is not carried here because a report states what was compared and whether it matched,
 * not how the comparison reached its answer: the artefact is what a reader can reproduce.
 *
 * The field names are camelCase while the wire type in `@adem/shared` is snake_case, and the route
 * layer maps between them; neither shape is the other's alias.
 *
 * `expectedJson` and `actualJson` are the strings `scoreSubmission` produced, canonical JSON text
 * on a matching case as much as on a failing one, so a report read back states byte for byte what
 * the comparison compared.
 */
export interface ReportCaseResult {
  /** The fixture case this result is for, unique within the standard version. */
  readonly caseId: string;

  /** The severity the case set gave the case: `critical` or `standard`. */
  readonly severity: CaseSeverity;

  /** The case's expected output as canonical JSON text. */
  readonly expectedJson: string;

  /** The output the candidate recorded for the case, as canonical JSON text. */
  readonly actualJson: string;

  /** Whether the canonical actual equalled the canonical expected. */
  readonly match: boolean;
}

/**
 * One report: every provenance field a report states, the per-case evidence it carries, and the two
 * write-time identity values.
 *
 * It is the shape `./report-repository` persists and reads back, so a report a caller holds and a
 * report a reader fetches state the same fields. `candidateVersionId` and `standardVersionId` are
 * the identifiers the report cites — the versioned listing it measured and the criteria it was
 * scored against — and `rubricReference` resolves to the rubric document section stating the rubric,
 * the evidence semantics and the badge scope.
 *
 * `priorReportId` is the newest earlier report for the same candidate version and the same standard
 * version, or `null` when that version has no earlier report. It is **never a client input**: the
 * evaluation request body carries no retest field at all, and `apps/api` derives the link itself
 * from the reports it stores, so a caller cannot forge one.
 *
 * `reportId` and `createdAt` are generated at write time and lie outside the compared payload — see
 * the identity boundary in this module's header. Every other member is a copy of what was evaluated
 * or of the version's origin, which is why no field is optional and no member records a change: the
 * row is append-only, and a correction is a new report rather than an edit to this one.
 */
export interface ReportRecord {
  /** Report identifier, generated at write time and outside the compared payload. */
  readonly reportId: string;

  /** The evaluated version's identifier, which the caller resolved from its own tables. */
  readonly candidateVersionId: string;

  /** The contract-facing standard version label the report cites, e.g. `SGI-SO-1.0.0`. */
  readonly standardVersionId: string;

  /** One result per fixture case, in case-set order. */
  readonly caseResults: readonly ReportCaseResult[];

  /** How many cases matched. */
  readonly matchedCount: number;

  /** How many cases were scored, which is the case set's own size. */
  readonly totalCount: number;

  /** How many `critical` cases failed, where any value above the allowed count is a `FAIL`. */
  readonly criticalFailures: number;

  /** `PASS` or `FAIL`, derived by the scorer from the versioned pass rule. */
  readonly outcome: ReportOutcome;

  /** The rubric the report was scored against, e.g. `SGI-SO-1.0.0#rubric`. */
  readonly rubricReference: string;

  /** `SAMPLE` or `VERIFIED-IN-DEMO`, from the version's origin and the outcome. */
  readonly label: ReportLabel;

  /** The newest earlier report for the same candidate version and standard, or null if none. */
  readonly priorReportId: string | null;

  /** Insert instant as an ISO-8601 UTC string, outside the compared payload. */
  readonly createdAt: string;
}

/**
 * The inputs of {@link buildReport}: the four provenance values the caller resolved, plus the two
 * identity values a caller that already holds them supplies.
 *
 * `candidateVersionId` and `standardVersionId` are passed in rather than derived, because the caller
 * resolved them from its own tables and handed the same pair to `scoreSubmission`; a builder that
 * re-derived them would need the tables this package does not read and could disagree with the
 * scorer about which version was measured.
 *
 * `label` is the caller's evidence of origin, computed from the candidate version's
 * `is_fixture_candidate` flag and the outcome through {@link deriveReportLabel}. `priorReportId` is
 * the link a retest records, derived by `apps/api` from the stored reports rather than sent by a
 * client.
 *
 * `reportId` and `createdAt` are optional and read only as absent or supplied — never as an explicit
 * `undefined` — so a caller that holds neither gets both generated. They exist for the callers that
 * must state them: a test pinning a record, and a replay reconstructing one.
 */
export interface BuildReportOptions {
  /** The evaluated version's identifier, as the caller resolved it. */
  readonly candidateVersionId: string;

  /** The contract-facing standard version label, not a `standard_versions` row identifier. */
  readonly standardVersionId: string;

  /** The report's label, computed from the version's origin and the outcome. */
  readonly label: ReportLabel;

  /** The newest earlier report for the same candidate version and standard, or null if none. */
  readonly priorReportId: string | null;

  /** The report identifier to state; generated when absent. */
  readonly reportId?: string;

  /** The ISO-8601 UTC creation instant to state; the current instant when absent. */
  readonly createdAt?: string;
}

/**
 * The rubric reference of the standard version a report cites, resolved from the version that owns
 * it so the string has one definition in the repository.
 *
 * It refuses with `UnknownStandardError` (`code: "unknown_standard"`, which a route maps to the
 * contract's `404`) when the label is not one this release publishes. Failing loudly is the point:
 * a quiet fallback would let a report cite the rubric of a standard version it was not scored
 * against, and the writer refuses the same label for the same reason, so a silent default here
 * would make the write and the later read disagree about the criteria of one report.
 *
 * @param standardVersionId - The contract-facing label the report cites.
 * @returns The rubric reference published by that version.
 * @throws {UnknownStandardError} when this release publishes no such standard version.
 */
function rubricReferenceOf(standardVersionId: string): string {
  if (standardVersionId !== SGI_SO_1_0_0.versionLabel) {
    throw new UnknownStandardError(
      `this release publishes no standard version "${standardVersionId}", so a report cannot cite the rubric it was scored against: a rubric reference is read from the version that owns it rather than assumed, and a published version is superseded by publishing a new one`,
      standardVersionId,
    );
  }
  return SGI_SO_1_0_0.rubricReference;
}

/**
 * Copies one comparison result into the evidence shape the report carries.
 *
 * The five values are taken as they stand, in one place, so that a field the comparison adds is a
 * compile error here rather than an evidence field that silently reaches no reader.
 */
function toReportCaseResult(caseResult: CaseResult): ReportCaseResult {
  return {
    caseId: caseResult.caseId,
    severity: caseResult.severity,
    expectedJson: caseResult.expectedJson,
    actualJson: caseResult.actualJson,
    match: caseResult.match,
  };
}

/**
 * Builds the report record for one scored submission.
 *
 * The per-case evidence is rebuilt one case at a time, in the order the scorer returned it, copying
 * each field verbatim; the matched and total counts, the critical failures and the outcome are
 * copied from the scored submission and never recomputed, because the pass rule is versioned data
 * the scorer applies. `rubricReference` is resolved from the standard version named in `options`,
 * and `label` and `priorReportId` pass through unchanged. `reportId` and `createdAt` are the two
 * generated values, lying outside the payload two runs of one submission compare.
 *
 * The scored submission is not mutated and nothing it carries is aliased into the record: the
 * returned evidence array and each of its members are new, so a caller may keep handing the same
 * scored value to this function — which is exactly what a reproducibility check does.
 *
 * @param scored - The scored submission: the per-case results in case-set order, the totals and the
 * outcome, as `scoreSubmission` derived them.
 * @param options - The report's provenance values and, optionally, the two write-time identity
 * values a caller that already holds them supplies.
 * @returns The complete report record, carrying every provenance field and one evidence entry per
 * case.
 * @throws {UnknownStandardError} when `options.standardVersionId` is not a standard version this
 * release publishes.
 */
export function buildReport(scored: ScoredSubmission, options: BuildReportOptions): ReportRecord {
  const caseResults = scored.caseResults.map(toReportCaseResult);

  // Resolved before the record below is constructed, so a refusal fires before an identifier or an
  // instant is generated for a report that will not be written.
  const rubricReference = rubricReferenceOf(options.standardVersionId);

  return {
    reportId: options.reportId === undefined ? randomUUID() : options.reportId,
    candidateVersionId: options.candidateVersionId,
    standardVersionId: options.standardVersionId,
    caseResults,
    matchedCount: scored.matchedCount,
    totalCount: scored.totalCount,
    criticalFailures: scored.criticalFailures,
    outcome: scored.outcome,
    rubricReference,
    label: options.label,
    priorReportId: options.priorReportId,
    createdAt: options.createdAt === undefined ? new Date().toISOString() : options.createdAt,
  };
}

/**
 * The label a report carries, from the origin of the candidate version it evaluated.
 *
 * The rule is **total** and depends on the origin alone: a version seeded as a fixture candidate
 * yields `SAMPLE`, a version published through the API yields `VERIFIED-IN-DEMO`, and the outcome is
 * not consulted — so a failed report carries a label exactly as a passed one does, which states
 * where the run came from and never that it passed.
 *
 * `outcome` is part of the rule's stated shape and is deliberately unused: a label that varied with
 * an outcome would make the vocabulary say two things at once, and the badge — issued on a pass
 * alone — is what carries the outcome beside the label. Do not make the result depend on it.
 *
 * @param isFixtureCandidate - Whether the evaluated version was seeded as a fixture candidate.
 * @param outcome - The report's outcome, required by the rule's shape and not read.
 * @returns `SAMPLE` for a fixture candidate, `VERIFIED-IN-DEMO` otherwise.
 */
export function deriveReportLabel(isFixtureCandidate: boolean, outcome: ReportOutcome): ReportLabel {
  void outcome;
  return isFixtureCandidate ? REPORT_LABEL_SAMPLE : REPORT_LABEL_VERIFIED_IN_DEMO;
}
