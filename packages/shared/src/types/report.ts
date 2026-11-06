/**
 * The SGI evaluation report, its per-case evidence, and the three closed
 * vocabularies an evaluation speaks: the outcome, the report label and the
 * fixture case severity.
 *
 * Two append-only tables are typed here. `evaluation_reports` carries every
 * provenance field a report states — the candidate version, the standard
 * version, the outcome, the counts, the rubric reference and the label — and
 * `report_case_results` carries the per-case evidence written in the same
 * transaction as its report. Neither table accepts an update and neither
 * accepts a delete, which is why neither shape below carries a last-modified
 * instant or any other marker of change, and why no field of a report is
 * optional: a report that omitted a provenance field could not be reproduced.
 *
 * A report measures recorded data. The evaluator compares a candidate's
 * recorded outputs against the fixture set's expected outputs as canonical JSON
 * and derives the outcome from the versioned pass rule; nothing is executed, and
 * no field here names a person, a payment or a real currency. The label is
 * closed to the two values in {@link REPORT_LABELS}, so a badge rendered from a
 * report cannot invent a third word for what it measures.
 *
 * Declarations only. This module holds no comparison, no outcome derivation, no
 * label derivation, no validation and no helper of any kind: canonicalisation,
 * scoring and report building live in `@adem/sgi-core`, the label rule that
 * reads `listing_versions.is_fixture_candidate` lives server-side in `apps/api`
 * with the route that applies it, and request validation lives in
 * `packages/shared/src/schemas/evaluations-schema.ts`. Property names are
 * snake_case so the database column, the JSON payload and this type share one
 * spelling and no route needs a renaming layer.
 */

import { REPORT_LABEL_SAMPLE, REPORT_LABEL_VERIFIED_IN_DEMO } from "../constants";

/**
 * The two outcomes an evaluation report may carry, uppercase.
 *
 * They are fixed by migration `0006_reports_and_case_results.sql` as the
 * `outcome` column's `CHECK`, and by the standard's published pass rule: at
 * least 18 of the 20 cases match **and** no `critical` case fails is `PASS`, and
 * anything else is `FAIL`. The outcome is derived from the versioned criteria
 * and never read from a stored default, and the set is closed — a third outcome
 * would silently widen the column's `CHECK`, the schema's `enum` and every
 * status the UI renders.
 */
export const REPORT_OUTCOMES = ["PASS", "FAIL"] as const;

/** One report outcome, as stored in `evaluation_reports.outcome`. */
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

/**
 * The report label vocabulary, closed to exactly two values and built from the
 * single declaration of each in `../constants`.
 *
 * The members are the imported constants rather than re-typed strings, so
 * `SAMPLE` and `VERIFIED-IN-DEMO` have one definition in the repository and no
 * module can spell a third label. The label is total over every report: a `FAIL`
 * report carries one of these two values exactly as a `PASS` report does, which
 * states where the run came from and never that it passed.
 *
 * Which of the two a report carries — `SAMPLE` for a version seeded as a fixture
 * candidate, `VERIFIED-IN-DEMO` for a version published through the API — is
 * decided by `listing_versions.is_fixture_candidate` together with the outcome,
 * server-side in `apps/api` and `@adem/sgi-core`. This module declares the
 * vocabulary only and deliberately declares no function that maps a label.
 *
 * A badge is issued on `PASS` alone, so a `FAIL` report renders its per-case
 * evidence and no badge while still carrying one of these two labels.
 */
export const REPORT_LABELS = [REPORT_LABEL_SAMPLE, REPORT_LABEL_VERIFIED_IN_DEMO] as const;

/** One report label: `SAMPLE` or `VERIFIED-IN-DEMO`, never anything else. */
export type ReportLabel = (typeof REPORT_LABELS)[number];

/**
 * The two severities a fixture case may carry, matching the `severity` `CHECK`
 * on `report_case_results` and the vocabulary `@adem/sgi-fixtures` gives the
 * case set it publishes.
 *
 * `critical` is the severity the pass rule singles out: a critical case that
 * does not match fails the candidate outright, however many of the other cases
 * match. The 20-case set of standard version `SGI-SO-1.0.0` marks five cases
 * `critical` and the remaining fifteen `standard`, and both counts are versioned
 * data read from the stored standard version rather than constants. The set is
 * closed: a third severity would need a pass rule that does not exist.
 */
export const CASE_SEVERITIES = ["critical", "standard"] as const;

/** One fixture case severity, as stored in `report_case_results.severity`. */
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];

/**
 * The identifier of one fixture case, as stored in
 * `report_case_results.case_id`: a UUID string unique within the case set its
 * standard version names.
 *
 * It is the value {@link RecordedOutput.case_id} states and the value a report's
 * per-case evidence is keyed by, which is how a recorded output is paired with
 * the expected output it is compared against. It identifies a case in the
 * fixture set and never a row of the evaluating database.
 */
export type ReportCaseId = string;

/**
 * The per-case evidence for one fixture case, as `GET /evaluations/{id}` returns
 * it in a report's `case_results`.
 *
 * The stored `report_case_results` row carries these five values beside the `id`
 * that identifies the row and the `report_id` that pairs it with its report,
 * written in the same transaction as that report. This shape deliberately leaves
 * those two keys out: the evidence is always read nested under the report that
 * supplies them.
 *
 * `expected` and `actual` are **canonical JSON strings** — property order fixed
 * and insignificant whitespace removed — which is what makes the comparison
 * byte-stable across repeated runs of the same submission. The canonicaliser
 * `packages/sgi-core/src/scoring/canonical-json.ts` is the single producer of
 * that form, and the two fields are stored in the
 * `report_case_results.expected_json` / `actual_json` columns. They are typed as
 * strings rather than `unknown` on purpose: the compared artefact is the
 * canonical string, so an `unknown` field would invite a second comparison
 * implementation in a consumer.
 *
 * The row is append-only, so it records a result and never a correction to one.
 * Evidence is readable by anyone — `GET /evaluations/{id}` is public and needs
 * no demo account — and it names no person: a case id, a severity, two canonical
 * strings and the match.
 */
export interface ReportCaseResult {
  /** The fixture case this result is for, unique within the standard version. */
  case_id: ReportCaseId;
  /** The severity the case set gave the case: `critical` or `standard`. */
  severity: CaseSeverity;
  /** The case's expected output, canonicalised, as stored in `expected_json`. */
  expected: string;
  /** The candidate's recorded output for the case, canonicalised, as stored in `actual_json`. */
  actual: string;
  /** Whether the canonical `actual` equalled the canonical `expected`. */
  match: boolean;
}

/**
 * One row of `evaluation_reports`: the report an evaluation produces, carrying
 * every provenance field the report states.
 *
 * `id` and `created_at` are generated by the writer at insert time and lie
 * **outside** the compared payload. That exclusion is deliberate: a retest
 * creates a new report per submission, so a payload carrying a fresh identifier
 * or instant could not compare byte for byte between two runs of the same
 * submission, which is the reproducibility the evaluator promises. No field here
 * reads a clock, generates an identifier or carries a default.
 *
 * The row is append-only: nothing updates it and nothing deletes it. A change to
 * the criteria creates a new `standard_versions` row, and a retest inserts a new
 * report whose `prior_report_id` points at its predecessor while the predecessor
 * stays exactly as it was. There is therefore no `updated_at` here, no revision
 * counter and no withdrawal marker — an update route that must not exist cannot
 * be typed — and the label is decided once, at insert, from the candidate
 * version's origin and the outcome.
 *
 * `rubric_reference` holds the string `SGI-SO-1.0.0#rubric`, which resolves to
 * `docs/STANDARD-SGI-SO-1.0.0.md#rubric`, the document stating the rubric, the
 * evidence semantics and the badge scope. It is a field rather than a constant
 * so that a later standard version can carry its own reference.
 */
export interface EvaluationReport {
  /** Report identifier, generated at write time and outside the compared payload. */
  id: string;
  /** The evaluated version, referencing `listing_versions.id`. */
  candidate_version_id: string;
  /** The criteria the evaluation read, referencing `standard_versions.id`. */
  standard_version_id: string;
  /** `PASS` or `FAIL`, derived from the versioned pass rule. */
  outcome: ReportOutcome;
  /** How many cases matched. */
  matched_count: number;
  /** How many cases the standard version defines, 20 for `SGI-SO-1.0.0`. */
  total_count: number;
  /** How many `critical` cases failed, where any value above zero is a `FAIL`. */
  critical_failures: number;
  /** `SAMPLE` or `VERIFIED-IN-DEMO`, from the version's origin and the outcome. */
  label: ReportLabel;
  /** The rubric the report was scored against, e.g. `SGI-SO-1.0.0#rubric`. */
  rubric_reference: string;
  /** The newest earlier report for the same candidate version and standard, or null if none. */
  prior_report_id: string | null;
  /** Insert instant as an ISO-8601 UTC string, outside the compared payload. */
  created_at: string;
}

/**
 * A report together with its per-case evidence, as `GET /evaluations/{id}`
 * returns it.
 *
 * The read is public and unauthenticated: anyone may read any report and its
 * evidence, and nothing here is withheld from an anonymous reader. This shape
 * adds the evidence to {@link EvaluationReport} and changes nothing else, so the
 * report a reader sees is the stored row and not a recomputation.
 *
 * Opening and ruling an appeal touches neither the source rows of this shape nor
 * the report they form, so the same `GET /evaluations/{id}` returns the same
 * report before and after a ruling.
 */
export interface EvaluationReportDetail extends EvaluationReport {
  /** The per-case evidence, written in the same transaction as the report. */
  case_results: ReportCaseResult[];
}

/**
 * One recorded output a submission states for one fixture case.
 *
 * `output` is whatever JSON value the candidate recorded for that case. A
 * submission is declarative data: nothing in this product executes it, so the
 * value is compared against the case's expected output as canonical JSON and is
 * never evaluated, imported or interpreted. The evaluator reads no candidate
 * code, and no field here names a file, a command or an endpoint.
 */
export interface RecordedOutput {
  /** The fixture case this output is recorded for. */
  case_id: ReportCaseId;
  /** The recorded JSON value, compared as canonical JSON and never executed. */
  output: unknown;
}

/**
 * The `POST /evaluations` body, written by the **developer** that owns the
 * candidate version.
 *
 * **The body holds no retest field.** The candidate form is the version
 * identifier plus one recorded output per case, so `prior_report_id` can never
 * be a client input: the server derives the retest link itself, from the newest
 * existing report for the submitted candidate version and standard version, and
 * records no link (`null`) when that version has no prior report. A retest
 * therefore returns a new report pointing at its predecessor while the
 * predecessor is untouched.
 *
 * `recorded_outputs` is a list rather than a map because completeness is checked
 * against the loaded fixture set: a submission missing a recorded output for a
 * fixture case is rejected with **`422` before any report is written**, and the
 * pair a list keeps visible — the case id and its output — is what that check
 * reads. The rule lives in the route `apps/api/src/routes/evaluations.ts` and
 * not in this type: a submission arrives as data, so neither a fixed count nor a
 * required-field constraint here can stand in for the comparison against the
 * case set.
 *
 * The developer's identity comes from the resolved demo session and never from a
 * body field: a missing or unresolvable `X-Demo-Account` header is `401`, and a
 * resolvable account whose role is not `developer`, or that does not own the
 * version, is `403`.
 */
export interface EvaluationSubmission {
  /** The version being evaluated, referencing `listing_versions.id`. */
  candidate_version_id: string;
  /** The criteria to score against, referencing `standard_versions.id`. */
  standard_version_id: string;
  /** One entry per fixture case, where a case with no entry is the contract's `422`. */
  recorded_outputs: RecordedOutput[];
}
