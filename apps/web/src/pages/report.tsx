/**
 * The `/reports/:id` page: one evaluation report as it was recorded — the label it carries, the
 * badge it may be issued, its provenance, its per-case evidence, and the two actions a developer
 * has against it. The address is the page's own route; the report it shows is the service's
 * evaluations resource, and `../api-client` performs that mapping so no page builds a URL.
 *
 * Seven decisions hold this file together, and each is one a later reader could invert.
 *
 * **A report is evidence, not a verdict, and a failure is an ordinary outcome.** A `FAIL` renders
 * exactly what a `PASS` renders — provenance, totals, per-case evidence, the plain-language summary
 * and the retest path — and differs in two ways only: it carries no badge, and its summary names the
 * cases that did not match. It is never an error state, never toned as a fault, and never given a
 * "something went wrong" reading, because the evidence is the point of the page.
 *
 * **The badge is the component's decision, not this page's.** `../components/sample-badge` returns
 * `null` for a `FAIL` before it builds any markup, and this page therefore renders it unconditionally
 * with the report's own values. No second condition is added here, no substitute badge is rendered,
 * and a `FAIL` carries none.
 *
 * **The plain-language summary is derived from the report alone.** How many cases matched, how many
 * did not, which case identifiers those were and how many of them are `critical` all come from the
 * report's own counts and its `case_results`; no fixture file is read, no case identifier is written
 * down here, and no outcome is derived — the outcome is the service's and this page explains it. The
 * rule it explains is the standard's own: a run passes when at least as many cases match as the
 * standard version publishes as its threshold, with no `critical` case failing, and anything else is
 * a failure. Those thresholds are provisional for this release and versioned with the standard
 * version the report names, and the report payload carries no threshold field: the summary therefore
 * states the rule in the version's own terms and compiles in no figure of its own, so it follows a
 * later version rather than pinning this one.
 *
 * **The canonical JSON strings are shown exactly as stored.** The `expected` and `actual` values are
 * the compared artefact: they are rendered as text in a `<code>` element, neither reformatted nor
 * re-ordered nor re-indented, because a prettified copy would be a different document from the one
 * the comparison read and would break the reproducibility the evaluator promises. They are never
 * injected as markup, so a recorded output can never render as part of the page.
 *
 * **A retest appends, and the link is the service's to write.** The submission body carries the
 * candidate version, the standard version and one recorded output per case, and no retest field: the
 * service derives `prior_report_id` from the newest report already recorded for that candidate
 * version and standard version. The textarea arrives prefilled from this report's own recorded
 * outputs, so sending it unchanged re-runs exactly what was measured; on success the page announces
 * the new report, links to it, and says plainly that the report being read is untouched.
 *
 * **An appeal changes nothing, and this page offers no way to rule one.** Opening an appeal asks an
 * operator to review the outcome; a ruling is appended as a governance event and the report is left
 * byte for byte as it stands. The ruling route has no function in `../api-client` and no surface in
 * the plan, so this page has no control for it and says so rather than implying that a reader could
 * rule their own appeal.
 *
 * **The rubric reference is text, never a link.** The API serves the built application and no
 * documentation directory, so a link to the document the reference names would be answered with the
 * application's own shell rather than with the document; the reference and the path it resolves to
 * are therefore rendered as text. No link on this page leaves the product, and every link it does
 * render is an internal route.
 *
 * Appearance belongs to the `.page`, `.field*`, `.table*`, `.notice*`, `.status-region` and
 * `.button*` rules of the workspace stylesheet; this file imports no stylesheet, carries no inline
 * style and reads no storage, cookie, environment value or configuration of its own.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BADGE_SCOPE,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
} from "@adem/shared";
import type { Appeal, EvaluationReportDetail, RecordedOutput, ReportCaseResult } from "@adem/shared";

import { createEvaluation, getReport, openAppeal } from "../api-client";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { SampleBadge } from "../components/sample-badge";
import { NotFound } from "./not-found";

/** The heading of the page, and the label of the section that carries the report's identity. */
const PAGE_HEADING = "SGI report";

/** The heading of the provenance section: the fields a report states about itself. */
const PROVENANCE_HEADING = "What this report records";

/** The heading of the section explaining what the report measures and what it does not. */
const SCOPE_HEADING = "What this measures, and what it does not";

/** The heading of the per-case evidence section. */
const EVIDENCE_HEADING = "Per-case evidence";

/** The heading of the appeal action. */
const APPEAL_HEADING = "Appeal this report";

/** The heading of the retest action. */
const RETEST_HEADING = "Run the evaluation again";

/** The words a `critical` case's severity renders as, so severity is read and not inferred from colour. */
const CRITICAL_SEVERITY_LABEL = "Critical";

/** The words a `standard` case's severity renders as. */
const STANDARD_SEVERITY_LABEL = "Standard";

/** The words a matched case renders as. */
const MATCH_LABEL = "Match";

/** The words a case that did not match renders as. */
const NO_MATCH_LABEL = "No match";

/**
 * The reading of a failed write, as the two forms of this page render it.
 *
 * A discriminated union rather than one shape with nullable members, because the three readings
 * differ in where the explanation belongs: beside the field, in the form's status region, or — for an
 * incomplete submission — through the error notice that echoes the service's own sentence naming the
 * cases it did not receive.
 */
type WriteFailureReading =
  | {
      /** The field's own content is what failed: the sentence belongs beside the control. */
      readonly kind: "field";
      readonly sentence: string;
      /** What the status region announces, so the failure is not silent to a reader who hears only it. */
      readonly statusSentence: string;
    }
  | {
      /** The service refused the submission as incomplete: its sentence names the missing cases. */
      readonly kind: "incomplete";
      /** The thrown value, handed to the error notice that renders the service's sentence. */
      readonly error: unknown;
    }
  | {
      /** Nothing about the field is wrong: the sentence belongs in the status region. */
      readonly kind: "explained";
      readonly sentence: string;
      /** Whether the state offers the way back to browsing. */
      readonly offersBrowse: boolean;
    };

/** The four facts a raised value carries, read defensively because the value is arbitrary. */
interface WriteFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryAfterSeconds: number | null;
}

/** Whether a raised value is an object facts can be read off. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A property that is a non-empty string, or `null`: an empty property is not a fact. */
function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A property that is a finite number, or `null`.
 *
 * `0` is kept rather than treated as absent: it is the status the client reports when no response was
 * received at all, which is a state both forms explain like any other.
 */
function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Narrows a raised value into the facts a sentence can be built from, or `null`. */
function readWriteFailure(error: unknown): WriteFailure | null {
  if (!isRecord(error)) {
    return null;
  }
  const status = readNumber(error["status"]);
  const code = readText(error["code"]);
  const message = readText(error["message"]);
  if (status === null || code === null || message === null) {
    return null;
  }
  return {
    status,
    code,
    message,
    retryAfterSeconds: readNumber(error["retryAfterSeconds"]),
  };
}

/** The HTTP status a raised value carries, or `null` — read for the read failure's `404` alone. */
function statusOf(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  return readNumber(error["status"]);
}

/** A sentence that ends in its own full stop, so two sentences joined always read as two. */
function withFullStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * The wait a throttled write states, built from the whole seconds a `Retry-After` carried.
 *
 * A missing, zero or negative value states that the wait is a moment, so a reader is never told to
 * wait for no time or for a negative one.
 */
function describeRetryWait(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || retryAfterSeconds < 1) {
    return "Wait a moment, then send it again.";
  }
  const wholeSeconds = Math.ceil(retryAfterSeconds);
  return wholeSeconds === 1
    ? "Wait 1 second, then send it again."
    : `Wait ${wholeSeconds} seconds, then send it again.`;
}

/**
 * The recorded output a report's per-case evidence holds for one case, used to prefill a retest.
 *
 * The `actual` value is a canonical JSON string, so it is parsed back into the JSON value the
 * candidate recorded; where that parse fails — which a canonical string written by the evaluator
 * cannot cause, and which only a hand-edited or hand-written payload could — the raw string is
 * carried through instead, so the developer sees the unreadable value in the field and can correct it
 * by hand rather than being handed a silently different submission.
 */
function recordedOutputFor(result: ReportCaseResult): RecordedOutput {
  let output: unknown = result.actual;
  try {
    output = JSON.parse(result.actual) as unknown;
  } catch {
    output = result.actual;
  }
  return { case_id: result.case_id, output };
}

/**
 * The prefilled retest submission: one recorded output per case of the report being read, in the
 * order the report returned them, rendered as indented JSON so a developer can read and edit it.
 *
 * The indentation is a fixed number of spaces rather than a locale- or platform-dependent setting,
 * so the same report prefills the same text in every browser.
 */
function prefillSubmission(report: EvaluationReportDetail): string {
  return JSON.stringify(report.case_results.map(recordedOutputFor), null, 2);
}

/**
 * The sentence beside the submission field when the service could not read the body it was sent.
 *
 * A `400` on this route means the submission was not the required shape at all, which is the field's
 * own problem: the shape is stated in the hint above it and in the message beside it.
 */
const REFUSED_SUBMISSION_SENTENCE =
  "The service could not read this submission as the required shape: a JSON array holding one object for every fixture case, each with a case_id and an output. Edit the field and send it again; nothing was written.";

/** The sentence beside the reason field when the service refused the reason as written. */
const REFUSED_REASON_SENTENCE =
  "The service did not accept this reason as written. Say what the report gets wrong about the evidence the submission gave it, then open the appeal again; the text you typed has been kept.";

/** The sentence beside the reason field when nothing was entered. */
const BLANK_REASON_SENTENCE = "State the ground for the appeal before opening it.";

/** The sentence beside the submission field when the field holds no readable JSON. */
const UNREADABLE_SUBMISSION_SENTENCE =
  "This field must hold JSON: a single array of objects, one per fixture case. Check the brackets and the commas, or reload the page to start again from this report's own recorded outputs.";

/** The sentence beside the submission field when the JSON is not an array. */
const SUBMISSION_NOT_ARRAY_SENTENCE =
  "This field must hold one JSON array, not a single object: the submission is a list carrying one entry for every fixture case.";

/** The sentence beside the submission field when an entry is not an object carrying a case and an output. */
const SUBMISSION_ENTRY_SENTENCE =
  "Every entry in the array must be a JSON object with a case_id string and an output. An entry holding a case_id without an output is not a submission: an output is required for every case.";

/** One entry of a submission the developer edited: a case identifier and the output recorded for it. */
interface RecordedOutputEntry {
  readonly case_id: string;
  readonly output: unknown;
}

/** Whether a parsed value is a submission entry: an object carrying a case identifier and an output. */
function isRecordedOutputEntry(value: unknown): value is RecordedOutputEntry {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }
  const caseId = readText(value["case_id"]);
  // The presence of the key is checked rather than its value: `null` is a recorded output, and an
  // entry that omits the key entirely is the incomplete submission the service answers `422` for.
  return caseId !== null && Object.prototype.hasOwnProperty.call(value, "output");
}

/** The outcome of reading the submission field: the recorded outputs, or the sentence explaining why. */
type SubmissionReading =
  | { readonly ok: true; readonly outputs: RecordedOutput[] }
  | { readonly ok: false; readonly sentence: string };

/**
 * Reads the submission field into the recorded outputs the request body carries.
 *
 * Shape only, deliberately. The field is checked for being JSON, for being an array and for every
 * entry carrying a case identifier and an output — and never for holding one output per fixture case.
 * Completeness is the service's check, made against the case set it loaded, and it is the service that
 * answers a submission missing a case with the sentence naming the cases it did not receive. A second
 * check here would refuse the request before that sentence could be produced, and this page holds no
 * case set of its own to check against: the fixture data is not reachable from this workspace, and a
 * page that listed the cases it expects would be inventing the criteria rather than reading them.
 */
function readSubmission(text: string): SubmissionReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, sentence: UNREADABLE_SUBMISSION_SENTENCE };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, sentence: SUBMISSION_NOT_ARRAY_SENTENCE };
  }
  const entries: unknown[] = parsed;
  const outputs: RecordedOutput[] = [];
  for (const entry of entries) {
    if (!isRecordedOutputEntry(entry)) {
      return { ok: false, sentence: SUBMISSION_ENTRY_SENTENCE };
    }
    outputs.push({ case_id: entry.case_id, output: entry.output });
  }
  return { ok: true, outputs };
}

/** The sentence the appeal form's status region announces when the reason itself was refused. */
const REFUSED_REASON_STATUS = "The appeal was not opened: see the message beside the reason.";

/** The sentence the retest form's status region announces when the submission itself was refused. */
const REFUSED_SUBMISSION_STATUS = "The evaluation was not run: see the message beside the submission.";

/** The sentence the appeal form's status region announces when the page itself refused a blank reason. */
const UNREQUESTED_APPEAL_STATUS = "The appeal was not opened, and no request was sent.";

/** The sentence the retest form's status region announces when the field holds no readable submission. */
const UNREQUESTED_RETEST_STATUS = "The evaluation was not run, and no request was sent.";

/** The sentence a raised value carrying none of the facts renders for an appeal. */
const UNREADABLE_APPEAL_FAILURE =
  "The appeal was not opened. Send it again; the reason you wrote has been kept.";

/** The sentence a raised value carrying none of the facts renders for a retest. */
const UNREADABLE_RETEST_FAILURE =
  "The evaluation was not run. Send the submission again; it is still in the field.";

/**
 * The sentence an appeal that found no demo account renders.
 *
 * A write carries the selected synthetic account in its request header and the client refuses the
 * request before sending it when none is selected, so this is a state a reader can act on rather than
 * a failure of the request as written.
 */
const NO_ACCOUNT_APPEAL_SENTENCE =
  "No demo account is selected, so the appeal was not sent. Choose a demo account in the demo account switcher and open the appeal again — the selected account separates roles for the demonstration and is not a sign-in. The reason you wrote has been kept.";

/** The sentence a retest that found no demo account renders. */
const NO_ACCOUNT_RETEST_SENTENCE =
  "No demo account is selected, so the evaluation was not run. Choose a demo account in the demo account switcher and send the submission again — the selected account separates roles for the demonstration and is not a sign-in. The submission is still in the field.";

/** The sentence an appeal from an account without the developer role renders. */
const WRONG_ROLE_APPEAL_SENTENCE =
  "Opening an appeal needs a demo account whose role is developer, and the selected account is not a developer, so the appeal was not opened. Switch to a developer account and open the appeal again. The reason you wrote has been kept.";

/** The sentence a retest from an account that does not own the candidate version renders. */
const WRONG_ROLE_RETEST_SENTENCE =
  "Running an evaluation needs the demo account of the developer that owns the candidate version this report measured, and the selected account is not that developer, so nothing was run. Switch to the owning developer account and send the submission again. The submission is still in the field.";

/** The sentence an appeal against a report the service no longer holds renders. */
const MISSING_REPORT_APPEAL_SENTENCE =
  "The service no longer holds this report, so the appeal was not opened. A report that has been removed cannot be appealed, and nothing was written.";

/** The sentence a retest whose candidate version or standard version no longer resolves renders. */
const UNRESOLVED_VERSION_RETEST_SENTENCE =
  "The candidate version or the standard version this report names no longer resolves, so nothing was run. A report stays readable as evidence even when the version it measured is no longer offered.";

/** The sentence a throttled appeal renders. */
function throttledAppealSentence(retryAfterSeconds: number | null): string {
  return `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(retryAfterSeconds)} The reason you wrote has been kept.`;
}

/** The sentence a throttled retest renders. */
function throttledRetestSentence(retryAfterSeconds: number | null): string {
  return `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(retryAfterSeconds)} The submission is still in the field.`;
}

/**
 * Reads an appeal's failure into what the form renders, and `null` when nothing has failed.
 *
 * The sentences are this form's own rather than the service's, because the status says what the
 * reader can do about the failure and the service's single sentence for a client error says only that
 * the request was not accepted.
 */
function describeAppealFailure(error: unknown): WriteFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return { kind: "explained", sentence: UNREADABLE_APPEAL_FAILURE, offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return { kind: "field", sentence: REFUSED_REASON_SENTENCE, statusSentence: REFUSED_REASON_STATUS };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_APPEAL_SENTENCE, offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_APPEAL_SENTENCE, offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: MISSING_REPORT_APPEAL_SENTENCE, offersBrowse: true };
    case 429:
      return {
        kind: "explained",
        sentence: throttledAppealSentence(failure.retryAfterSeconds),
        offersBrowse: false,
      };
    default:
      return {
        kind: "explained",
        sentence: `The appeal was not opened. ${withFullStop(failure.message)} The reason you wrote has been kept.`,
        offersBrowse: false,
      };
  }
}

/**
 * Reads a retest's failure into what the form renders, and `null` when nothing has failed.
 *
 * An incomplete submission (`422`) is the one status that keeps the field valid: the shape was
 * accepted and a case is missing, which is not something the reader typed wrongly, so the explanation
 * is rendered by the error notice — which echoes the service's own sentence naming the cases it did
 * not receive — rather than marked beside the control.
 */
function describeRetestFailure(error: unknown): WriteFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return { kind: "explained", sentence: UNREADABLE_RETEST_FAILURE, offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return {
        kind: "field",
        sentence: REFUSED_SUBMISSION_SENTENCE,
        statusSentence: REFUSED_SUBMISSION_STATUS,
      };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_RETEST_SENTENCE, offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_RETEST_SENTENCE, offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: UNRESOLVED_VERSION_RETEST_SENTENCE, offersBrowse: false };
    case 422:
      return { kind: "incomplete", error };
    case 429:
      return {
        kind: "explained",
        sentence: throttledRetestSentence(failure.retryAfterSeconds),
        offersBrowse: false,
      };
    default:
      return {
        kind: "explained",
        sentence: `The evaluation was not run. ${withFullStop(failure.message)} The submission is still in the field.`,
        offersBrowse: false,
      };
  }
}

/** What a report's own evidence says about the cases that did not match. */
interface OutcomeSummary {
  /** The case identifiers the evidence records as not matching. */
  readonly failedCaseIds: readonly string[];
  /** Those of them whose severity is `critical`, taken from the same evidence. */
  readonly criticalFailedCaseIds: readonly string[];
}

/**
 * The cases a report's evidence records as not matching, and how many of those are `critical`.
 *
 * Both lists come from the per-case evidence and never from a fixture file or a written-down list of
 * identifiers: this page is shown the cases that were compared, and it names only those. The counts
 * the report states about itself are rendered in the provenance list beside them, so a reader sees the
 * stored totals and the evidence that produced them in the same view.
 */
function summariseOutcome(report: EvaluationReportDetail): OutcomeSummary {
  const failed = report.case_results.filter((result: ReportCaseResult): boolean => !result.match);
  return {
    failedCaseIds: failed.map((result: ReportCaseResult): string => result.case_id),
    criticalFailedCaseIds: failed
      .filter((result: ReportCaseResult): boolean => result.severity === "critical")
      .map((result: ReportCaseResult): string => result.case_id),
  };
}

/**
 * The case identifiers as a sentence reads them: each one as its own `<code>` value, separated by
 * commas and joined by "and" before the last.
 *
 * Rendering the identifiers as markup rather than as one joined string is what keeps a long identifier
 * wrapping inside the paragraph at a narrow width, and what lets a reader copy one identifier without
 * copying its punctuation.
 */
function CaseIdList(props: { readonly caseIds: readonly string[] }): JSX.Element {
  const lastIndex = props.caseIds.length - 1;
  return (
    <>
      {props.caseIds.map((caseId: string, index: number): JSX.Element => (
        <span key={caseId}>
          {index === 0 ? null : index === lastIndex ? " and " : ", "}
          <code>{caseId}</code>
        </span>
      ))}
    </>
  );
}

/**
 * The plain-language summary of one report: what the run did, which cases did not match, whether any
 * of those were critical, and what the standard's rule makes of it.
 *
 * Every number in it is the report's own — `matched_count`, `total_count`, `critical_failures` and the
 * per-case evidence — and the outcome is stated as the service recorded it rather than derived here.
 * The rule is stated in the standard version's own terms — the threshold that version publishes,
 * rather than a figure compiled in here — so a reader who is not a specialist can tell a pass from a
 * failure without reading the evidence table first.
 */
function OutcomeSummary(props: { readonly report: EvaluationReportDetail }): JSX.Element {
  const report = props.report;
  const summary = summariseOutcome(report);

  return (
    <p>
      This run matched <strong>{report.matched_count}</strong> of{" "}
      <strong>{report.total_count}</strong> cases, and the service recorded it as{" "}
      <strong>{report.outcome}</strong>.{" "}
      {summary.failedCaseIds.length === 0 ? (
        "Every case in the report matched."
      ) : summary.failedCaseIds.length === 1 ? (
        <>
          One case did not match: <CaseIdList caseIds={summary.failedCaseIds} />.
        </>
      ) : (
        <>
          {summary.failedCaseIds.length} cases did not match:{" "}
          <CaseIdList caseIds={summary.failedCaseIds} />.
        </>
      )}{" "}
      {summary.criticalFailedCaseIds.length === 0 ? (
        report.critical_failures > 0 ? (
          <>The report records {report.critical_failures} critical failures.</>
        ) : (
          "No critical case failed."
        )
      ) : summary.criticalFailedCaseIds.length === 1 ? (
        <>
          The critical case that failed: <CaseIdList caseIds={summary.criticalFailedCaseIds} />.
        </>
      ) : (
        <>
          The critical cases that failed:{" "}
          <CaseIdList caseIds={summary.criticalFailedCaseIds} />.
        </>
      )}{" "}
      A pass needs at least as many matches as the standard version this report names publishes as
      its threshold — the {report.total_count} cases recorded here are the set it applies to — with
      no critical case failing; anything else is a failure.
    </p>
  );
}

/** The notice a failure that says nothing about the field renders, with the way back to browsing. */
function ExplainedFailureNotice(props: {
  readonly sentence: string;
  readonly offersBrowse: boolean;
}): JSX.Element {
  return (
    <div className="notice notice--error">
      <p>{props.sentence}</p>
      {props.offersBrowse ? (
        <p>
          <Link to="/listings">Browse listings</Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The notice an incomplete submission renders: the service's own sentence, which names the cases it
 * did not receive, and the expectation stated in words beside it.
 *
 * The error notice is used rather than a sentence of this page's own for one reason: it is the one
 * component that renders the service's sentence for a `422`, and that sentence is the only thing in
 * the product that knows which cases the submission left out. This page adds what the sentence does
 * not say — that a submission carries one output for every case of the standard version, and that an
 * incomplete one is refused before any report is written — and it invents no case identifier.
 */
function IncompleteSubmissionNotice(props: {
  readonly error: unknown;
  readonly totalCases: number;
}): JSX.Element {
  return (
    <ErrorNotice
      error={props.error}
      detail={
        <p>
          The submission is missing a recorded output for at least one fixture case. One output is
          expected for every case in this standard version, of which there are {props.totalCases}, and
          an incomplete submission is refused before any report is written. The sentence above names
          the cases the service did not receive; nothing has been written, and the submission is still
          in the field so it can be corrected and sent again.
        </p>
      }
    />
  );
}


/** The state of the page's one read: what is on screen, and what went wrong when something did. */
type ReportPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "ready"; readonly report: EvaluationReportDetail };

/**
 * The state a failed read renders: a report the service does not hold is the absent state, and every
 * other failure is a failure the reader can send again.
 *
 * `404` alone is treated this way. The contract fixes it as "unknown or removed", so both readings
 * are the same to a reader — there is no report at this address — and the absent-state page offers the
 * way back to browsing, which a notice with a retry control does not.
 */
function readFailureState(error: unknown): ReportPageState {
  return statusOf(error) === 404 ? { kind: "missing" } : { kind: "failed", error };
}

/**
 * The provenance of one report: every field it states about itself, in one definition list.
 *
 * The instant is rendered exactly as it was stored — an ISO-8601 UTC string — rather than through a
 * date formatter, because a formatted instant would differ per browser, per machine and per locale,
 * and this page shows a record rather than a rendering of one. The earlier report, when there is one,
 * is the retest chain: the address is the page's own route for that report, which is a route of this
 * application and never an address of the service.
 */
function ProvenanceSection(props: { readonly report: EvaluationReportDetail }): JSX.Element {
  const report = props.report;
  const headingId = `${useId()}-provenance-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{PROVENANCE_HEADING}</h2>
      <dl>
        <dt>Report ID</dt>
        <dd>
          <code>{report.id}</code>
        </dd>
        <dt>Label</dt>
        <dd>
          <code>{report.label}</code>
        </dd>
        <dt>Candidate version</dt>
        <dd>
          <code>{report.candidate_version_id}</code>
        </dd>
        <dt>Standard version</dt>
        <dd>
          <code>{report.standard_version_id}</code>
        </dd>
        <dt>Outcome</dt>
        <dd>{report.outcome}</dd>
        <dt>Cases matched</dt>
        <dd>
          {report.matched_count} of {report.total_count}
        </dd>
        <dt>Critical cases that failed</dt>
        <dd>{report.critical_failures}</dd>
        <dt>Recorded at</dt>
        <dd>
          <code>{report.created_at}</code>
        </dd>
        <dt>Earlier report for this candidate version</dt>
        <dd>
          {report.prior_report_id === null ? (
            <>
              None: this is the first report recorded for this candidate version and standard version.
            </>
          ) : (
            <Link to={`/reports/${report.prior_report_id}`}>Earlier report for this version</Link>
          )}
        </dd>
      </dl>
      <p>
        A report is written once and is never edited. A retest appends a new report and records the one
        it follows, which is what the earlier report above links to, so a history of runs reads in the
        order it happened and the evidence a buyer read stays the evidence the service holds.
      </p>
    </section>
  );
}

/**
 * What the report measures and what it does not: the rubric it was scored against, the scope a badge
 * covers, the closed label vocabulary, and the boundary between evidence and certification.
 *
 * The rubric reference is text and never a link, and so is the path it resolves to: the API serves the
 * built application and no documentation directory, so an address into the repository's documents
 * would be answered with the application's own shell rather than with the document it names. Every
 * word of the closed vocabulary is rendered from the constant that defines it, so this page cannot
 * drift from the badge, the report or the documentation by paraphrase.
 */
function ScopeSection(props: { readonly report: EvaluationReportDetail }): JSX.Element {
  const report = props.report;
  const headingId = `${useId()}-scope-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{SCOPE_HEADING}</h2>
      <p>
        The rubric this report was scored against is recorded as <code>{report.rubric_reference}</code>.
        In this repository that reference resolves to the document{" "}
        <code>docs/STANDARD-SGI-SO-1.0.0.md</code>, which states the rubric, the evidence semantics, the
        retest and appeal semantics and the scope of a badge. The document is named here as text rather
        than linked: the service answers with the built application and not with a documentation
        directory, so a link to it would open the application's own page instead.
      </p>
      <p>
        A badge is issued on a pass alone. It names the standard version, the report's identifier and the
        scope "{BADGE_SCOPE}", and that scope is the whole of what a badge measures. A report that
        failed carries no badge at all and shows its per-case evidence instead.
      </p>
      <p>
        Every report carries exactly one of two labels: {REPORT_LABEL_SAMPLE} for a version seeded as a
        fixture candidate, and {REPORT_LABEL_VERIFIED_IN_DEMO} for a version published through the API.
        The label states where the run came from and never that it passed — this report carries{" "}
        {report.label}.
      </p>
      <p>
        Nothing on this page is independent certification, and nothing here states or implies general
        safety or certified security. Buying an evaluation never guarantees a pass: the outcome above is
        decided by the recorded evidence under the standard's rule alone. The rule's thresholds are
        provisional for this release and versioned with the standard version named above, so a later
        version changes them by being proposed, reviewed and published as a new version, never by an edit
        to the version this report was scored against.
      </p>
    </section>
  );
}

/**
 * The per-case evidence: one row per fixture case, holding the identifier, the severity, the expected
 * output, the recorded output and whether the two matched.
 *
 * A real table rather than a grid of boxes, with a caption naming the report and a row header per case,
 * because the evidence is tabular: every case carries the same five facts and a reader compares them
 * across the rows. The two outputs are canonical JSON strings rendered in a `<code>` element exactly as
 * stored — never reformatted, never re-ordered and never injected as markup — because they are the
 * compared artefact and a pretty-printed copy would be a different document from the one the
 * comparison read. The result is a word as well as a styling hook, so a match is never conveyed by a
 * colour alone.
 *
 * The empty case is a state of its own rather than an empty table: the service can answer with a report
 * whose evidence it recorded none of, and a reader is then owed an explanation rather than a header row
 * with nothing under it.
 */
function EvidenceSection(props: { readonly report: EvaluationReportDetail }): JSX.Element {
  const report = props.report;
  const headingId = `${useId()}-evidence-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{EVIDENCE_HEADING}</h2>
      {report.case_results.length === 0 ? (
        <EmptyState
          headingLevel={3}
          heading="No per-case evidence in this report"
          explanation="The service answered with this report but recorded no per-case results for it, so there is nothing to show case by case. The outcome, the totals and the provenance above are what the report itself records."
          action={<Link to="/standards">Read the standards catalogue</Link>}
        />
      ) : (
        <>
          <p>
            Each row is one fixture case as the evaluation recorded it: the case identifier, the severity
            the case set gave it, the expected output, the recorded output and whether the two matched.
            The outputs are the canonical JSON strings the comparison read — property order fixed and
            insignificant whitespace removed — rendered exactly as they are stored, so the same
            submission reads the same here on every run.
          </p>
          <div className="table__wrapper">
            <table className="table">
              <caption>
                Per-case evidence for report <code>{report.id}</code>, in the order the evaluation
                recorded it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Expected output</th>
                  <th scope="col">Recorded output</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {report.case_results.map((result: ReportCaseResult): JSX.Element => (
                  <tr key={result.case_id}>
                    <th scope="row">
                      <code>{result.case_id}</code>
                    </th>
                    <td>
                      {result.severity === "critical" ? CRITICAL_SEVERITY_LABEL : STANDARD_SEVERITY_LABEL}
                    </td>
                    <td>
                      <code>{result.expected}</code>
                    </td>
                    <td>
                      <code>{result.actual}</code>
                    </td>
                    <td>{result.match ? MATCH_LABEL : NO_MATCH_LABEL}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}


/**
 * The report page: one read of one report, and the two actions a developer has against it.
 *
 * It owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which renders the
 * header, the navigation, the demonstration banner and the account switcher — must not wrap it in
 * another landmark. Reading a report needs no demo account, so the one request this page makes is
 * public and carries no header; the two writes it offers carry the selected account, which
 * `../api-client` attaches and which a reader selects in the shell.
 *
 * Two states are the route's own addresses rather than failures of the request: a report the service
 * does not hold renders the absent-state page, and a report that is being read renders its heading with
 * an announced message, so a slow answer is never a blank screen. A `FAIL` report is neither: it is the
 * ordinary outcome this page exists to show, and it renders in full.
 */
export function ReportPage(): JSX.Element {
  const params = useParams();
  // `noUncheckedIndexedAccess` types the route's parameter as possibly absent. An address with no
  // segment at all cannot be a report — the route always supplies one — and the absent state is what
  // such an address already means, so it needs no request of its own.
  const reportId = params["id"] ?? "";
  const headingId = `${useId()}-heading`;

  const [state, setState] = useState<ReportPageState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback((): void => {
    setReloadToken((current: number): number => current + 1);
  }, []);

  useEffect((): (() => void) => {
    if (reportId === "") {
      setState({ kind: "missing" });
      return (): void => {};
    }
    // The flag is what keeps a slow answer for a report the reader has already left from writing over
    // the report now on screen, which a plain sequence of requests would do.
    let cancelled = false;
    setState({ kind: "loading" });
    void getReport(reportId).then(
      (report: EvaluationReportDetail): void => {
        if (!cancelled) {
          setState({ kind: "ready", report });
        }
      },
      (caught: unknown): void => {
        if (!cancelled) {
          setState(readFailureState(caught));
        }
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [reportId, reloadToken]);

  if (state.kind === "missing") {
    // The absent-state page owns the landmark and the heading, so nothing of this page renders beside
    // it: it is returned in place of the whole page rather than inside one.
    return (
      <NotFound
        heading="Report not found"
        message="This report is unknown to the service, or the address does not name one. Reports are append-only once written, so a report that has been recorded stays readable at its own address; an address that never named one cannot be read."
      />
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="page page-report">
      <section aria-labelledby={headingId}>
        <h1 id={headingId}>{PAGE_HEADING}</h1>
        {state.kind === "ready" ? (
          <>
            {/* The badge decides for itself: `SampleBadge` returns nothing at all for a `FAIL` report,
                so no condition is stated here, no substitute badge is rendered, and a failing report
                cannot be given one by a later edit to this page. */}
            <SampleBadge
              outcome={state.report.outcome}
              label={state.report.label}
              standardVersionId={state.report.standard_version_id}
              reportId={state.report.id}
            />
            <OutcomeSummary report={state.report} />
          </>
        ) : state.kind === "loading" ? (
          <div className="status-region" role="status" aria-live="polite">
            <p>
              Reading the report. This page fills in when the service answers; an address that names no
              report is answered with the absent state instead.
            </p>
          </div>
        ) : (
          <ErrorNotice error={state.error} onRetry={reload} />
        )}
      </section>

      {state.kind === "ready" ? (
        <>
          <ProvenanceSection report={state.report} />
          <ScopeSection report={state.report} />
          <EvidenceSection report={state.report} />
          {/* Both actions are keyed by the report they act on, so a draft, a success and a failure
              belong to one report and are dropped when the reader opens another. The two keys carry
              the action's own prefix because they are siblings: one key for both would be the
              duplicate React reconciles the two sections against, and a reader's appeal draft would
              be the retest form's state. */}
          <AppealSection key={`appeal-${state.report.id}`} reportId={state.report.id} />
          <RetestSection key={`retest-${state.report.id}`} report={state.report} />
        </>
      ) : null}
    </main>
  );
}

/**
 * The appeal action: a developer's request that this report's outcome be reviewed.
 *
 * Opening an appeal is the developer's to do and ruling one is not, which is why the section carries a
 * reason field and a submit control and nothing more. An appeal never changes the report it concerns —
 * a ruling is appended as a governance event — and the copy says so, because a reader who expected an
 * appeal to amend the evidence would read the page afterwards and think nothing had happened.
 */
function AppealSection(props: { readonly reportId: string }): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-appeal-heading`;
  const reasonFieldId = `${idPrefix}-reason`;
  const reasonHintId = `${idPrefix}-reason-hint`;
  const reasonErrorId = `${idPrefix}-reason-error`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [reason, setReason] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [appeal, setAppeal] = useState<Appeal | null>(null);

  const serviceReading = describeAppealFailure(failure);
  const reading: WriteFailureReading | null =
    localError === null
      ? serviceReading
      : { kind: "field", sentence: localError, statusSentence: UNREQUESTED_APPEAL_STATUS };
  const fieldSentence = reading !== null && reading.kind === "field" ? reading.sentence : null;

  const handleReasonChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setReason(event.target.value);
    if (localError !== null) {
      setLocalError(null);
    }
    // A reason the service refused is the field's own problem, so editing the field answers it; a
    // failure about the account, the report or the rate limit stands, because typing cannot fix one.
    if (serviceReading !== null && serviceReading.kind === "field") {
      setFailure(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (reason.trim() === "") {
      setAppeal(null);
      setFailure(null);
      setLocalError(BLANK_REASON_SENTENCE);
      return;
    }
    setLocalError(null);
    setFailure(null);
    setAppeal(null);
    setIsSubmitting(true);
    try {
      const created = await openAppeal(props.reportId, { reason });
      setReason("");
      setAppeal(created);
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{APPEAL_HEADING}</h2>
      <p>
        An appeal asks an operator to review this report's outcome. It is opened by the developer that
        owns the measured version with a stated ground, and it leaves this report exactly as it stands:
        the ruling is recorded as an appended governance event, so the evidence above stays readable
        whatever the ruling is. Deciding an appeal is an operator's action, which is why this page
        carries no control for it.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className={fieldSentence === null ? "field" : "field field--error"}>
          <label className="field__label" htmlFor={reasonFieldId}>
            Ground for the appeal
          </label>
          {/* A free-text statement of why the report is contested has no autofill purpose, so this
              field declares none rather than claiming one it does not have. */}
          <textarea
            id={reasonFieldId}
            rows={5}
            value={reason}
            onChange={handleReasonChange}
            required
            autoComplete="off"
            aria-invalid={fieldSentence !== null}
            aria-describedby={fieldSentence === null ? reasonHintId : `${reasonErrorId} ${reasonHintId}`}
          />
          <p className="field__hint" id={reasonHintId}>
            Say what this report gets wrong about the evidence the submission gave it. The reason, and
            the ruling that answers it, are recorded as governance events.
          </p>
          {fieldSentence === null ? null : (
            <p className="field__error" id={reasonErrorId}>
              {fieldSentence}
            </p>
          )}
        </div>

        <button
          type="submit"
          className="button button--primary"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          aria-describedby={isSubmitting ? submitHintId : undefined}
        >
          Open appeal
        </button>

        {isSubmitting ? (
          <p className="field__hint" id={submitHintId}>
            Opening the appeal: this button is unavailable until the service answers.
          </p>
        ) : null}

        {/* The region is rendered with the form and only its content changes on submit, so the node
            exists before the status it announces does. `role="status"` is already a polite live
            region; the assertion beside it is for a reader who maps the role differently. */}
        <div className="status-region" role="status" aria-live="polite">
          {appeal === null ? null : (
            <div className="notice notice--success">
              <p>
                Appeal opened: <code>{appeal.id}</code>, recorded with the status{" "}
                <strong>{appeal.status}</strong>.
              </p>
              <p>
                This report has not changed. A ruling is appended as a governance event, and the evidence
                above is read from the report the service holds, so it reads the same after a ruling as it
                does now.
              </p>
            </div>
          )}
          {reading === null || reading.kind !== "explained" ? null : (
            <ExplainedFailureNotice sentence={reading.sentence} offersBrowse={reading.offersBrowse} />
          )}
          {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
        </div>
      </form>
    </section>
  );
}


/**
 * The retest action: the same standard version run against the same candidate version again.
 *
 * The submission is the declarative form an evaluation takes — one recorded output for every fixture
 * case, compared as data with nothing executed — and the field arrives prefilled from this report's own
 * recorded outputs, so sending it unchanged re-runs exactly what was measured. The body carries no
 * retest field: the service derives the link to the previous report from the newest report already
 * recorded for this candidate version and standard version, which is why the page states the append in
 * words after the write rather than offering a field for it.
 *
 * The field's own check is a shape check — JSON, an array, and one object with a case identifier and an
 * output per entry — and never a completeness check. Completeness is the service's, made against the
 * case set it loaded, and its refusal is the only thing in the product that can name the cases a
 * submission left out; refusing here first would replace that sentence with a guess.
 */
function RetestSection(props: { readonly report: EvaluationReportDetail }): JSX.Element {
  const report = props.report;
  const idPrefix = useId();
  const headingId = `${idPrefix}-retest-heading`;
  const submissionFieldId = `${idPrefix}-submission`;
  const submissionHintId = `${idPrefix}-submission-hint`;
  const submissionErrorId = `${idPrefix}-submission-error`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [submission, setSubmission] = useState<string>((): string => prefillSubmission(report));
  const [localSentence, setLocalSentence] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [created, setCreated] = useState<EvaluationReportDetail | null>(null);

  const serviceReading = describeRetestFailure(failure);
  const reading: WriteFailureReading | null =
    localSentence === null
      ? serviceReading
      : { kind: "field", sentence: localSentence, statusSentence: UNREQUESTED_RETEST_STATUS };
  const fieldSentence = reading !== null && reading.kind === "field" ? reading.sentence : null;

  const handleSubmissionChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setSubmission(event.target.value);
    if (localSentence !== null) {
      setLocalSentence(null);
    }
    // The same rule as the appeal form's reason: a submission the service could not read as the
    // required shape is answered by editing the field, while a missing case, an account or a rate
    // limit stands until it is resolved or sent again.
    if (serviceReading !== null && serviceReading.kind === "field") {
      setFailure(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    const read = readSubmission(submission);
    if (!read.ok) {
      setCreated(null);
      setFailure(null);
      setLocalSentence(read.sentence);
      return;
    }
    setLocalSentence(null);
    setFailure(null);
    setCreated(null);
    setIsSubmitting(true);
    try {
      const newReport = await createEvaluation({
        candidate_version_id: report.candidate_version_id,
        standard_version_id: report.standard_version_id,
        recorded_outputs: read.outputs,
      });
      setCreated(newReport);
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{RETEST_HEADING}</h2>
      <p>
        A retest runs the standard version {report.standard_version_id} against the candidate version{" "}
        <code>{report.candidate_version_id}</code> again. The submission holds one recorded output for
        every fixture case: the evaluator compares recorded data and executes nothing, so the field is a
        document rather than a program. A retest appends a new report and leaves this one untouched —
        the field carries no retest option, because the service derives the link to the report a run
        follows from the reports already recorded for this candidate version and standard version.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className={fieldSentence === null ? "field" : "field field--error"}>
          <label className="field__label" htmlFor={submissionFieldId}>
            Recorded outputs for {report.candidate_version_id}, as JSON
          </label>
          {/* The submission is machine data, so it carries the monospaced input class; the field holds
              no personal information and asks for none. */}
          <textarea
            id={submissionFieldId}
            rows={14}
            className="field__input--mono"
            value={submission}
            onChange={handleSubmissionChange}
            required
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fieldSentence !== null}
            aria-describedby={
              fieldSentence === null ? submissionHintId : `${submissionErrorId} ${submissionHintId}`
            }
          />
          <p className="field__hint" id={submissionHintId}>
            One JSON array holding one object for every fixture case: each object carries a{" "}
            <code>case_id</code> and the output recorded for that case. The field arrives prefilled with
            this report's own recorded outputs, so sending it unchanged re-runs exactly what was
            measured; edit an output to record a different answer, and leave the{" "}
            <code>case_id</code> values as they are.
          </p>
          {fieldSentence === null ? null : (
            <p className="field__error" id={submissionErrorId}>
              {fieldSentence}
            </p>
          )}
        </div>

        <button
          type="submit"
          className="button button--primary"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          aria-describedby={isSubmitting ? submitHintId : undefined}
        >
          Run the evaluation again
        </button>

        {isSubmitting ? (
          <p className="field__hint" id={submitHintId}>
            Running the evaluation: this button is unavailable until the service answers.
          </p>
        ) : null}

        {/* An incomplete submission leaves the field valid — the shape was accepted and a case is
            missing — so its explanation is the error notice, which echoes the service's own sentence
            naming the cases it did not receive. That notice holds a polite region of its own, so it is
            rendered beside the form's region rather than nested inside it. */}
        {reading !== null && reading.kind === "incomplete" ? (
          <IncompleteSubmissionNotice error={reading.error} totalCases={report.total_count} />
        ) : null}

        <div className="status-region" role="status" aria-live="polite">
          {created === null ? null : (
            <div className="notice notice--success">
              <p>
                Evaluation recorded as a new report: <code>{created.id}</code>, with the outcome{" "}
                <strong>{created.outcome}</strong>.
              </p>
              <p>
                <Link to={`/reports/${created.id}`}>Read the new report</Link>
              </p>
              <p>
                The report you were reading is untouched: this is a separate report of its own, and the
                service wrote the link that points back at it.{" "}
                {created.prior_report_id === null ? (
                  "This new report records no earlier report for the candidate version."
                ) : (
                  <>
                    It records <code>{created.prior_report_id}</code> as the report it follows.
                  </>
                )}
              </p>
            </div>
          )}
          {reading === null || reading.kind !== "explained" ? null : (
            <ExplainedFailureNotice sentence={reading.sentence} offersBrowse={reading.offersBrowse} />
          )}
          {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
        </div>
      </form>
    </section>
  );
}

// The default export is what the shell's route table imports for `/reports/:id`, and the named export
// is what a reader of this module imports; both exist on purpose, as they do in ./not-found.
export default ReportPage;

