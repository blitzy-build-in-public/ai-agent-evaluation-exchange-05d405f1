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
 * **An appeal changes nothing, and the ruling surface is the operator's.** Opening an appeal asks an
 * operator to review the outcome; a ruling is appended as a governance event and the report is left
 * byte for byte as it stands. The page therefore carries the developer's opening form and, for the
 * operator demo account alone, the surface that decides the appeals awaiting a ruling — the operator's
 * documented power, reachable in the product rather than only at the API. Which appeals await a ruling
 * is read from the operator's own audit feed page by page — its newest page and each page before it,
 * in the order the writes happened — rather than from its newest page alone, because the contract names
 * no read that lists appeals — an opening and a ruling are the two writes the feed records for one —
 * and because an appeal whose opening is older than that newest page would otherwise never be offered.
 * The two surfaces are mounted per role rather than hidden, so an account that cannot use one makes no
 * request for it, and the feed read fires for the operator and for no other account.
 *
 * **The rubric reference is text, never a link.** The API serves the built application and no
 * documentation directory, so a link to the document the reference names would be answered with the
 * application's own shell rather than with the document; the reference and the path it resolves to
 * are therefore rendered as text. No link on this page leaves the product, and every link it does
 * render is an internal route.
 *
 * Appearance belongs to the `.page`, `.field*`, `.table*`, `.notice*`, `.status-region` and
 * `.button*` rules of the workspace stylesheet; this file imports no stylesheet, carries no inline
 * style and reads no cookie, environment value or configuration of its own. The selected demo account
 * is read through `../api-client`'s `getSelectedDemoAccountId` and resolved by `../data/demo-accounts`,
 * which is how the page knows whose surfaces to mount; nothing else of the reader's is stored or read.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  APPEAL_RULINGS,
  BADGE_SCOPE,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
} from "@adem/shared";
import type {
  Appeal,
  AppealRuling,
  AppealRulingBody,
  AuditEvent,
  EvaluationReportDetail,
  GovernanceEvent,
  RecordedOutput,
  ReportCaseResult,
  ReportOutcome,
} from "@adem/shared";

import {
  createEvaluation,
  getReport,
  getSelectedDemoAccountId,
  openAppeal,
  ruleAppeal,
} from "../api-client";
import type { AppealRulingResult } from "../api-client";
import { readAuditFeed } from "../audit-feed-read";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { SampleBadge } from "../components/sample-badge";
import { findDemoAccount } from "../data/demo-accounts";
import {
  Timestamp,
  describeRetryWait,
  isRecord,
  readText,
  readWriteFailure,
  statusOf,
  withFullStop,
} from "../payload-reading";
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
 * The five column labels of the per-case evidence table, named once here so the header row and the
 * label each cell prints below the breakpoint are the same five strings and cannot drift apart.
 */
const CASE_COLUMN_LABEL = "Case";
const SEVERITY_COLUMN_LABEL = "Severity";
const EXPECTED_OUTPUT_COLUMN_LABEL = "Expected output";
const RECORDED_OUTPUT_COLUMN_LABEL = "Recorded output";
const RESULT_COLUMN_LABEL = "Result";

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
      /**
       * The notice variant the explanation renders in: the warning triple for the write rate limit,
       * which the reader waits out and sends again, and the error triple for every other refusal.
       */
      readonly variant: "notice--error" | "notice--warning";
      /** Whether the state offers the way back to browsing. */
      readonly offersBrowse: boolean;
    };

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
  // A refusal is stated once: `isRecord` answers false for an array as well as for a primitive.
  if (!isRecord(value)) {
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
  return `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(retryAfterSeconds, "then send it again.")} The reason you wrote has been kept.`;
}

/** The sentence a throttled retest renders. */
function throttledRetestSentence(retryAfterSeconds: number | null): string {
  return `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(retryAfterSeconds, "then send it again.")} The submission is still in the field.`;
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
    return { kind: "explained", sentence: UNREADABLE_APPEAL_FAILURE, variant: "notice--error", offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return { kind: "field", sentence: REFUSED_REASON_SENTENCE, statusSentence: REFUSED_REASON_STATUS };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_APPEAL_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_APPEAL_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: MISSING_REPORT_APPEAL_SENTENCE, variant: "notice--error", offersBrowse: true };
    case 429:
      return {
        kind: "explained",
        sentence: throttledAppealSentence(failure.retryAfterSeconds),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return {
        kind: "explained",
        sentence: `The appeal was not opened. ${withFullStop(failure.message)} The reason you wrote has been kept.`,
        variant: "notice--error",
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
    return { kind: "explained", sentence: UNREADABLE_RETEST_FAILURE, variant: "notice--error", offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return {
        kind: "field",
        sentence: REFUSED_SUBMISSION_SENTENCE,
        statusSentence: REFUSED_SUBMISSION_STATUS,
      };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_RETEST_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_RETEST_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: UNRESOLVED_VERSION_RETEST_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 422:
      return { kind: "incomplete", error };
    case 429:
      return {
        kind: "explained",
        sentence: throttledRetestSentence(failure.retryAfterSeconds),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return {
        kind: "explained",
        sentence: `The evaluation was not run. ${withFullStop(failure.message)} The submission is still in the field.`,
        variant: "notice--error",
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
 * The chip class for one report outcome: `.chip` carries the geometry every consumer of a report's
 * own values shares, and the direction modifier carries the tint the outcome tokens name, so this
 * page states an outcome in the same treatment the listing card gives the same value. The word
 * itself is the meaning, so the chip reads without its tint.
 */
function outcomeChipClass(outcome: ReportOutcome): string {
  return outcome === "PASS" ? "chip chip--pass" : "chip chip--fail";
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
      <span className={outcomeChipClass(report.outcome)}>{report.outcome}</span>.{" "}
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
  readonly variant: "notice--error" | "notice--warning";
  readonly offersBrowse: boolean;
}): JSX.Element {
  return (
    <div className={`notice ${props.variant}`}>
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
 * The instant renders through the workspace's one reading of a stored instant, which takes the date
 * and the time from the stored string and states the instant is in UTC — no locale- or
 * timezone-dependent formatter, no clock and no reader-dependent output, so this page shows a record
 * rather than a rendering of one and the same record reads identically everywhere. The earlier
 * report, when there is one, is the retest chain: the address is the page's own route for that
 * report, which is a route of this application and never an address of the service.
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
        <dd>
          <span className={outcomeChipClass(report.outcome)}>{report.outcome}</span>
        </dd>
        <dt>Cases matched</dt>
        <dd>
          {report.matched_count} of {report.total_count}
        </dd>
        <dt>Critical cases that failed</dt>
        <dd>{report.critical_failures}</dd>
        <dt>Recorded at</dt>
        <dd><Timestamp value={report.created_at} /></dd>
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
            <table className="table table--dense">
              <caption>
                Per-case evidence for report <code>{report.id}</code>, in the order the evaluation
                recorded it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">{CASE_COLUMN_LABEL}</th>
                  <th scope="col">{SEVERITY_COLUMN_LABEL}</th>
                  <th scope="col">{EXPECTED_OUTPUT_COLUMN_LABEL}</th>
                  <th scope="col">{RECORDED_OUTPUT_COLUMN_LABEL}</th>
                  <th scope="col">{RESULT_COLUMN_LABEL}</th>
                </tr>
              </thead>
              <tbody>
                {report.case_results.map((result: ReportCaseResult): JSX.Element => (
                  <tr key={result.case_id}>
                    <th scope="row" data-label={CASE_COLUMN_LABEL}>
                      <code>{result.case_id}</code>
                    </th>
                    <td data-label={SEVERITY_COLUMN_LABEL}>
                      {result.severity === "critical" ? CRITICAL_SEVERITY_LABEL : STANDARD_SEVERITY_LABEL}
                    </td>
                    <td data-label={EXPECTED_OUTPUT_COLUMN_LABEL}>
                      <code>{result.expected}</code>
                    </td>
                    <td data-label={RECORDED_OUTPUT_COLUMN_LABEL}>
                      <code>{result.actual}</code>
                    </td>
                    <td data-label={RESULT_COLUMN_LABEL}>
                      {result.match ? MATCH_LABEL : NO_MATCH_LABEL}
                    </td>
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
 * The report page: one read of one report, the two actions a developer has against it, and — for the
 * operator demo account — the surface that rules the appeals awaiting a decision.
 *
 * It owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which renders the
 * header, the navigation, the demonstration banner and the account switcher — must not wrap it in
 * another landmark. Reading a report needs no demo account, so the one request every reader makes is
 * public and carries no header; the writes the page offers carry the selected account, which
 * `../api-client` attaches and which a reader selects in the shell. Which surfaces are mounted follows
 * the selected account's role, so an account that cannot use one makes no request for it: the ruling
 * section's own read is one of the operator-only reads, and it fires only for the operator.
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

  // Resolved on every render rather than held in state: the switcher in the page header writes the
  // selection, and this page follows it, so switching account mounts or unmounts the operator's
  // surface in the same update. The lookup answers `null` for an absent or unrecognised selection,
  // which is the state of a reader who has chosen no account.
  const account = findDemoAccount(getSelectedDemoAccountId());
  const isOperator = account !== null && account.role === "operator";

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
          {/* Both developer actions are keyed by the report they act on, so a draft, a success and a
              failure belong to one report and are dropped when the reader opens another. The two keys
              carry the action's own prefix because they are siblings: one key for both would be the
              duplicate React reconciles the two sections against, and a reader's appeal draft would
              be the retest form's state. */}
          <AppealSection key={`appeal-${state.report.id}`} reportId={state.report.id} />
          {/* The operator's surface is mounted for that account alone, so no other account reads the
              audit feed it derives the appeals from: a read that would be refused is not made. */}
          {isOperator ? <AppealRulingSection key={`ruling-${state.report.id}`} /> : null}
          <RetestSection key={`retest-${state.report.id}`} report={state.report} />
        </>
      ) : null}
    </main>
  );
}

/**
 * The appeal action: a developer's request that this report's outcome be reviewed.
 *
 * Opening an appeal is the developer's to do; deciding one is the operator's, and the operator's own
 * surface for it is {@link AppealRulingSection}, which the page mounts for that account and no other.
 * This section therefore carries a reason field and a submit control and nothing more. An appeal never
 * changes the report it concerns — a ruling is appended as a governance event — and the copy says so,
 * because a reader who expected an appeal to amend the evidence would read the page afterwards and
 * think nothing had happened.
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
        whatever the ruling is. Deciding an appeal is the operator's action, and the surface for it is
        offered on this page to the operator demo account alone.
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
            <ExplainedFailureNotice
              sentence={reading.sentence}
              variant={reading.variant}
              offersBrowse={reading.offersBrowse}
            />
          )}
          {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
        </div>
      </form>
    </section>
  );
}


/******* The operator's ruling surface */

/** The heading of the operator's ruling section. */
const RULING_HEADING = "Appeals awaiting a ruling";

/** What the section states about the operator's power and about what a ruling does not do. */
const RULING_SUMMARY =
  "Ruling an appeal is the operator's action: it records the decision, appends a governance event and " +
  "leaves the report the appeal concerns exactly as it stands. This surface is offered while the " +
  "operator demo account is selected, and the appeals below are read from that account's own audit " +
  "feed page by page — the newest page first and each page before it, in the order the writes " +
  "happened — rather than from its newest page alone: an appeal whose opening is older than that page " +
  "would otherwise never be offered.";

/** The appeal selection's label and the hint that says where the offered appeals come from. */
const RULING_APPEAL_FIELD_LABEL = "Appeal to rule";
const RULING_APPEAL_FIELD_HINT =
  "Each appeal below has been opened and not yet ruled, newest first, read from the operator's audit " +
  "feed page by page — the newest page first and each page before it, in the order the writes " +
  "happened — because the contract names no read that lists appeals: an opening and a ruling are what " +
  "that feed records for one. The appeal a ruling is sent for comes from this selection rather than " +
  "from the ground.";

/** The ruling group's legend and the sentence that says what a decision does. */
const RULING_DECISION_LEGEND = "Ruling";
const RULING_DECISION_SUMMARY =
  "One ruling per appeal. Each appends a governance event carrying the ground written below, and is " +
  "recorded against the account the switcher has selected.";

/**
 * The label of each ruling the closed vocabulary offers, in the vocabulary's own order.
 *
 * A total `Record` over {@link AppealRuling} rather than a written-out pair, so the control renders one
 * button per member of `APPEAL_RULINGS` — the tuple the route's request schema validates against — and
 * a ruling added to or removed from that vocabulary fails this file's build instead of leaving a
 * decision unreachable.
 */
const RULING_LABELS: Readonly<Record<AppealRuling, string>> = Object.freeze({
  upheld: "Uphold the appeal",
  denied: "Deny the appeal",
});

/** The ground field's label and the hint that says what a blank field means. */
const RULING_GROUND_FIELD_LABEL = "Ground (optional)";
const RULING_GROUND_FIELD_HINT =
  "This field may be left blank: a ruling is not obliged to give a reason. Whatever is written here is " +
  "recorded with the governance event the ruling appends, and that event is never edited.";

/** Shown beside the controls while a ruling is in flight. */
const RULING_SUBMITTING_HINT =
  "Recording the ruling; the controls are unavailable until the service answers.";

/** The empty state, for when the feed holds no appeal awaiting a decision. */
const NO_PENDING_APPEALS_HEADING = "No appeal awaits a ruling";
const NO_PENDING_APPEALS_EXPLANATION =
  "The operator's audit feed holds no appeal that has been opened and not yet ruled, so there is " +
  "nothing to decide here. An appeal a developer opens enters this list when the feed is read again; a " +
  "ruled appeal never returns to it, because a ruling is final.";

/** The control that reads the feed again, and what it states. */
const RULING_RELOAD_LABEL = "Read the audit feed again";
const RULING_RELOAD_HINT =
  "An appeal opened since this page was read appears above once the feed is read again. The list comes " +
  "from the service and never from this page's own copy of it.";

/** What the section says when the audit feed itself could not be read. */
const RULING_FEED_FAILURE_DETAIL =
  "The appeals awaiting a ruling are read from the operator's audit feed, which is one of the " +
  "operator-only reads. If the selected account is not the operator, switch to the operator demo " +
  "account and read the list again.";

/** The sentence a ruling that found no demo account renders. */
const NO_ACCOUNT_RULING_SENTENCE =
  "No demo account is selected, so the ruling was not sent. Choose the operator demo account in the demo account switcher and rule the appeal again — the selected account separates roles for the demonstration and is not a sign-in. The ground you wrote has been kept.";

/** The sentence a ruling from an account without the operator role renders. */
const NOT_OPERATOR_RULING_SENTENCE =
  "Ruling an appeal needs a demo account whose role is operator, and the selected account is not the operator, so no ruling was recorded. Switch to the operator account and rule the appeal again. The ground you wrote has been kept.";

/** The sentence a ruling of an appeal the service does not hold renders. */
const MISSING_APPEAL_RULING_SENTENCE =
  "The service does not hold that appeal, so no ruling was recorded. The audit feed is read again to show the appeals it does hold, and nothing was written.";

/** The sentence a ruling of an appeal that already carries a terminal status renders. */
const ALREADY_RULED_RULING_SENTENCE =
  "That appeal has already been ruled, and a ruling is final: only an appeal that is still open can be ruled. The audit feed is read again to show what still awaits a decision, and nothing was written.";

/** The sentence a ruling the service refused as it was sent renders. */
const REFUSED_RULING_SENTENCE =
  "An appeal is ruled upheld or denied, and the service did not accept the ruling sent, so nothing was recorded. Choose one of the two rulings and send it again.";

/** The sentence a raised value carrying none of the facts renders for a ruling. */
const UNREADABLE_RULING_FAILURE =
  "The ruling was not recorded. Send it again; the ground you wrote has been kept.";

/** The sentence a throttled ruling renders. */
function throttledRulingSentence(retryAfterSeconds: number | null): string {
  return `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(retryAfterSeconds, "then send it again.")} The ground you wrote has been kept.`;
}

/**
 * Reads a ruling's failure into what the section renders, and `null` when nothing has failed.
 *
 * The sentences are this section's own rather than the service's, because the status says what the
 * operator can do about the failure — which account to switch to, whether the record has moved on —
 * while the service's single sentence for a client error says only that the request was not accepted.
 * The `409` and the `404` both re-read the audit feed where they are handled, because in both cases the
 * list on screen is out of date rather than the request being wrong.
 */
function describeRulingFailure(error: unknown): WriteFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return {
      kind: "explained",
      sentence: UNREADABLE_RULING_FAILURE,
      variant: "notice--error",
      offersBrowse: false,
    };
  }
  switch (failure.status) {
    case 400:
      return {
        kind: "explained",
        sentence: REFUSED_RULING_SENTENCE,
        variant: "notice--error",
        offersBrowse: false,
      };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_RULING_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: NOT_OPERATOR_RULING_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: MISSING_APPEAL_RULING_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 409:
      return { kind: "explained", sentence: ALREADY_RULED_RULING_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 429:
      return {
        kind: "explained",
        sentence: throttledRulingSentence(failure.retryAfterSeconds),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return {
        kind: "explained",
        sentence: `The ruling was not recorded. ${withFullStop(failure.message)} The ground you wrote has been kept.`,
        variant: "notice--error",
        offersBrowse: false,
      };
  }
}

/**
 * The action each of the two writes records against an appeal, as `apps/api`'s audit vocabulary spells
 * them.
 *
 * They are written here rather than imported because that vocabulary is declared in the API
 * workspace's own audit module, which this workspace cannot reach: what crosses the boundary is the
 * audit row, not the code that spells it. A rename on the API side would therefore leave this
 * derivation finding nothing rather than failing to compile, which is why the empty list it then
 * produces is an explained state — "no appeal awaits a ruling" — and not a silent blank.
 */
const APPEAL_OPENED_ACTION = "appeal.opened";
const APPEAL_RULED_ACTION = "appeal.ruled";

/** The resource type both of those writes record, and which this derivation requires. */
const APPEAL_RESOURCE_TYPE = "appeal";

/**
 * One appeal the operator may rule, as the audit feed states it.
 *
 * The feed is the only read that names an appeal: the contract's appeals rows are a write-only pair,
 * so what is known about one here is what its opening recorded — which row it is, when it was opened
 * and which account opened it. The developer's own ground is not in this row and is not needed to rule
 * an appeal; the operator's ground is what the ruling records.
 */
export interface PendingAppeal {
  /** The appeal's identifier: the `resource_id` both writes name. */
  readonly appealId: string;
  /** When the appeal was opened, as the opening's audit row recorded it. */
  readonly openedAt: string;
  /** The account that opened it, as that row recorded the actor. */
  readonly developerAccountId: string;
}

/**
 * The appeals awaiting a ruling, derived from the operator's audit feed as the surface reads it — every
 * page of it the walk reached — newest first.
 *
 * An appeal awaits a ruling when the feed holds an `appeal.opened` row for it and no `appeal.ruled`
 * row for the same resource: the two writes are the whole life of an appeal in the log, and a ruled
 * appeal is excluded by that second row rather than by a status this page would have to be told. The
 * feed arrives in the order the writes happened — oldest first — so the result is reversed to put the
 * newest opening first, which is the order an operator wants to work through. A list derived from one
 * page of that feed would stop offering an appeal as soon as a page's worth of writes had been
 * recorded after it was opened, which is why the whole feed is read rather than its newest page.
 *
 * It is a pure function of the events it is handed: no request, no clock and no storage, so the list
 * is determined by the feed and by nothing else. An empty feed and a feed holding no open appeal both
 * answer the empty list, which the section renders as an explained state rather than as a failure.
 */
export function appealsAwaitingRuling(events: readonly AuditEvent[]): readonly PendingAppeal[] {
  const isAppealRow = (event: AuditEvent): boolean =>
    event.resource_type === APPEAL_RESOURCE_TYPE;

  const ruled = new Set(
    events
      .filter(
        (event: AuditEvent): boolean => isAppealRow(event) && event.action === APPEAL_RULED_ACTION,
      )
      .map((event: AuditEvent): string => event.resource_id),
  );

  return events
    .filter(
      (event: AuditEvent): boolean =>
        isAppealRow(event) && event.action === APPEAL_OPENED_ACTION && !ruled.has(event.resource_id),
    )
    .map(
      (event: AuditEvent): PendingAppeal => ({
        appealId: event.resource_id,
        openedAt: event.created_at,
        developerAccountId: event.actor_account_id,
      }),
    )
    .reverse();
}

/** The state of the section's one read: the audit feed, and what went wrong when it did. */
type PendingAppealsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "ready"; readonly events: readonly AuditEvent[] };

/**
 * The ruling the closed vocabulary states this page renders for an event's ground, or the sentence that
 * says the ruling recorded none.
 *
 * A ground is optional on the route, and a ruling taken without one stores the absence — an empty
 * string in the appended event's `reason`, which is how this page reads it — so neither reading renders
 * a blank. The ground itself is rendered exactly as the event stores it, because it is the operator's
 * own words and the record of why the decision was taken.
 */
function RulingGround(props: { readonly event: GovernanceEvent }): JSX.Element {
  const stated = readText(props.event.reason);

  return stated === null ? (
    <em>No ground was recorded with this ruling.</em>
  ) : (
    <>{stated}</>
  );
}

/**
 * The operator's ruling surface: the appeals awaiting a decision, the ruling to record against one, and
 * the event that records it.
 *
 * **The appeals are read from the operator's own audit feed.** The contract names no read that lists
 * appeals — an appeal is opened and ruled through two write rows and returned by neither — so the feed
 * of what was written is how an operator sees one to decide, and {@link appealsAwaitingRuling} derives
 * the list from it. The feed is read page by page, from its newest page back and in the order the
 * writes happened, rather than its newest page alone, because the feed is bounded and an appeal whose
 * opening had fallen past that page would otherwise never be offered to the surface that rules it. It
 * is one of the operator-only reads, which is why the section is mounted only for the operator
 * account: an account that cannot use this surface makes no request for it.
 *
 * **A ruling is final and changes no measurement.** The write moves the appeal's own status and
 * appends a governance event; the report above is read from the service and reads the same before and
 * after a ruling. Both the control's copy and the notice say so, because an operator who expected a
 * ruling to alter the evidence would read the page afterwards and think nothing had happened.
 *
 * **The decision and its record are rendered together.** The notice states the appeal's new status and
 * the appended event's identifier, type, actor, stated ground and instant, because the event is the
 * only place the ground exists: the appeal row carries no ruling reason, so a surface that reported
 * only the status would hide the decision's ground from the person who stated it. An answer that
 * carried no event is reported as such rather than passed over.
 *
 * **A refusal is a sentence, never a trace.** Each status the ruling row can answer is rendered as this
 * section's own words: which account to switch to (`401`, `403`), that the record has moved on (`404`,
 * `409`, both of which re-read the feed), that the field itself was refused (`400`) and how long a
 * throttled write must wait (`429`). No status code, no response body and no server sentence is shown
 * for a refusal this section explains in full, which is the same treatment the two forms above give
 * their own failures.
 */
function AppealRulingSection(): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-ruling-heading`;
  const appealFieldId = `${idPrefix}-appeal`;
  const appealHintId = `${idPrefix}-appeal-hint`;
  const groundFieldId = `${idPrefix}-ground`;
  const groundHintId = `${idPrefix}-ground-hint`;
  const decisionHintId = `${idPrefix}-decision-hint`;
  const reloadHintId = `${idPrefix}-reload-hint`;

  const [state, setState] = useState<PendingAppealsState>({ kind: "loading" });
  const [readToken, setReadToken] = useState<number>(0);
  const [chosenAppealId, setChosenAppealId] = useState<string | null>(null);
  const [ground, setGround] = useState<string>("");
  const [pending, setPending] = useState<AppealRuling | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [ruled, setRuled] = useState<AppealRulingResult | null>(null);

  useEffect((): (() => void) => {
    // The flag is what keeps a slow answer from a feed the operator has moved on from writing over the
    // list now on screen, which a plain sequence of requests would do.
    let cancelled = false;
    setState({ kind: "loading" });
    void readAuditFeed().then(
      (events: AuditEvent[]): void => {
        if (!cancelled) {
          setState({ kind: "ready", events });
        }
      },
      (caught: unknown): void => {
        if (!cancelled) {
          setState({ kind: "failed", error: caught });
        }
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [readToken]);

  const reloadFeed = useCallback((): void => {
    setReadToken((current: number): number => current + 1);
  }, []);

  const awaiting = state.kind === "ready" ? appealsAwaitingRuling(state.events) : [];
  // The selection is resolved against the appeals actually offered, so an appeal a re-read no longer
  // lists cannot remain selected and be ruled as a stale identifier. Until the operator chooses one, the
  // newest opening is the appeal the controls act on.
  const chosen =
    awaiting.find((appeal: PendingAppeal): boolean => appeal.appealId === chosenAppealId) ??
    awaiting[0] ??
    null;

  const isBusy = pending !== null;
  const canRule = chosen !== null && !isBusy;
  const reading = describeRulingFailure(failure);

  const handleGroundChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setGround(event.target.value);
  };

  const applyRuling = async (ruling: AppealRuling): Promise<void> => {
    if (chosen === null || isBusy) {
      return;
    }

    setFailure(null);
    setRuled(null);
    setPending(ruling);

    // The body is built with the ground present only when one was written: an optional field carried as
    // an explicit empty string would state a ground of nothing, and the contract's shape admits absent
    // and string alike while the product distinguishes the two.
    const stated = ground.trim();
    const body: AppealRulingBody =
      stated === "" ? { status: ruling } : { status: ruling, reason: stated };

    try {
      const result = await ruleAppeal(chosen.appealId, body);
      setGround("");
      setChosenAppealId(result.appeal.id);
      setRuled(result);
      // A ruled appeal leaves the list, and the list is the service's answer rather than this page's
      // assumption: the feed is read again so what appears is what the service now holds.
      reloadFeed();
    } catch (caught: unknown) {
      setFailure(caught);
      // A refusal that says the list on screen is stale reads it again: a `409` means the appeal has
      // been ruled since the feed was read, and a `404` means the service no longer holds it at all.
      // Neither is fixed by sending the same ruling again, so no retry is offered for either.
      const status = statusOf(caught);
      if (status === 404 || status === 409) {
        reloadFeed();
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{RULING_HEADING}</h2>
      <p>{RULING_SUMMARY}</p>

      {state.kind === "failed" ? (
        <ErrorNotice
          error={state.error}
          onRetry={reloadFeed}
          detail={statusOf(state.error) === 403 ? <p>{RULING_FEED_FAILURE_DETAIL}</p> : null}
        />
      ) : null}

      {state.kind === "loading" ? (
        <div className="status-region" role="status" aria-live="polite">
          <p>
            Reading the appeals awaiting a ruling. This section fills in when the service answers; the
            audit feed is one of the operator-only reads, so an account that is not the operator is
            answered with a refusal here rather than with a list.
          </p>
        </div>
      ) : null}

      {state.kind === "ready" && awaiting.length === 0 ? (
        <EmptyState
          headingLevel={3}
          heading={NO_PENDING_APPEALS_HEADING}
          explanation={NO_PENDING_APPEALS_EXPLANATION}
        />
      ) : null}

      {chosen === null ? null : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={appealFieldId}>
              {RULING_APPEAL_FIELD_LABEL}
            </label>
            <select
              id={appealFieldId}
              value={chosen.appealId}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setChosenAppealId(event.target.value)
              }
              aria-describedby={appealHintId}
            >
              {awaiting.map(
                (appeal: PendingAppeal): JSX.Element => (
                  <option key={appeal.appealId} value={appeal.appealId}>
                    {`${appeal.appealId} — opened ${appeal.openedAt} by ${appeal.developerAccountId}`}
                  </option>
                ),
              )}
            </select>
            <p className="field__hint" id={appealHintId}>
              {RULING_APPEAL_FIELD_HINT}
            </p>
          </div>

          <fieldset className="field">
            <legend className="field__label">{RULING_DECISION_LEGEND}</legend>
            <p className="field__hint" id={decisionHintId}>
              {RULING_DECISION_SUMMARY}
            </p>

            <div className="field">
              <label className="field__label" htmlFor={groundFieldId}>
                {RULING_GROUND_FIELD_LABEL}
              </label>
              {/* A free-text statement of why an appeal is upheld or denied has no autofill purpose, so
                  this field declares none rather than claiming one it does not have. */}
              <textarea
                id={groundFieldId}
                rows={4}
                value={ground}
                onChange={handleGroundChange}
                autoComplete="off"
                aria-describedby={groundHintId}
              />
              <p className="field__hint" id={groundHintId}>
                {RULING_GROUND_FIELD_HINT}
              </p>
            </div>

            {/* One control per member of the closed vocabulary, labelled from a total record over it, so
                a ruling added to `APPEAL_RULINGS` becomes reachable here rather than needing a new
                control to be written. A ruling that leaves the vocabulary fails the build instead. */}
            {APPEAL_RULINGS.map(
              (ruling: AppealRuling): JSX.Element => (
                <button
                  key={ruling}
                  type="button"
                  className="button button--primary"
                  disabled={!canRule}
                  aria-busy={pending === ruling}
                  aria-describedby={decisionHintId}
                  onClick={(): void => {
                    void applyRuling(ruling);
                  }}
                >
                  {RULING_LABELS[ruling]}
                </button>
              ),
            )}

            {pending === null ? null : (
              <p className="field__hint">{RULING_SUBMITTING_HINT}</p>
            )}
          </fieldset>

          <p>
            <button
              type="button"
              className="button button--secondary"
              aria-describedby={reloadHintId}
              onClick={reloadFeed}
            >
              {RULING_RELOAD_LABEL}
            </button>
          </p>
          <p className="field__hint" id={reloadHintId}>
            {RULING_RELOAD_HINT}
          </p>
        </>
      )}

      {/* The region is rendered whether or not an appeal is offered, and it is rendered with the section
          so the node exists before the status it announces does. That placement is required rather than
          cosmetic: a ruling the service records takes an appeal out of the list, so the last appeal ruled
          leaves nothing for the controls above to act on, and a notice written inside that block would
          unmount with it before anyone read it. `role="status"` is already a polite live region; the
          assertion beside it is for a reader who maps the role differently. */}
      <div className="status-region" role="status" aria-live="polite">
        {ruled === null ? null : (
          <div className="notice notice--success">
            <p>
              Appeal <code>{ruled.appeal.id}</code> is now{" "}
              <strong>{ruled.appeal.status}</strong>. This report has not changed: the evidence above is
              read from the report the service holds, and a ruling appends a governance event rather than
              amending a measurement.
            </p>
            {ruled.event === null ? (
              <p>
                The service's answer carried no record of the appended event, so its trail cannot be
                shown here. The ruling itself was recorded: the appeal's status above is the one the
                service holds, and the feed is read again so the appeals listed above are the ones still
                awaiting a decision.
              </p>
            ) : (
              <dl>
                <dt>Appended event</dt>
                <dd>
                  <code>{ruled.event.id}</code>
                </dd>
                <dt>Event type</dt>
                <dd>
                  <code>{ruled.event.event_type}</code>
                </dd>
                <dt>Recorded by</dt>
                <dd>
                  <code>{ruled.event.actor_account_id}</code>
                </dd>
                <dt>Stated ground</dt>
                <dd>
                  <RulingGround event={ruled.event} />
                </dd>
                <dt>Recorded at</dt>
                <dd>
                  <code>{ruled.event.created_at}</code>
                </dd>
              </dl>
            )}
          </div>
        )}
        {reading === null || reading.kind !== "explained" ? null : (
          <ExplainedFailureNotice
            sentence={reading.sentence}
            variant={reading.variant}
            offersBrowse={reading.offersBrowse}
          />
        )}
      </div>
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
                <span className={outcomeChipClass(created.outcome)}>{created.outcome}</span>.
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
            <ExplainedFailureNotice
              sentence={reading.sentence}
              variant={reading.variant}
              offersBrowse={reading.offersBrowse}
            />
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

