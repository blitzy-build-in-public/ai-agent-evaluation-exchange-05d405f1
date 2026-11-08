/**
 * The developer's workspace and, for the operator demo account, the ledger and audit surfaces: the
 * `/developer` route.
 *
 * One page carries two sets of surfaces because the plan gives each of them exactly one home, and
 * they never appear together: the developer half is mounted only for a developer account and the
 * operator half only for the operator account, so a page that cannot use a surface never reads it.
 * A buyer or contributor account is told which account the workspace belongs to rather than being
 * shown a control that would be refused.
 *
 * **Presentation only.** Every read and write goes through `../api-client`, which owns the base path,
 * the demo-account header and the error envelope; no URL, request, header or storage call is built
 * here. This module holds no rule the service owns: the outcome, the label, the counts, the amounts
 * and the retest link all arrive from the service, and a sentence this page writes states what a
 * reader can do about a refusal rather than recomputing what the refusal found.
 *
 * Three decisions shape the developer half.
 *
 * **"This developer's listings" is derived, because the contract has no per-developer read.** The
 * workspace reads the public catalogue once through the shared catalogue reader — the page size is the
 * contract's fixed {@link LISTING_PAGE_SIZE} and is never a parameter — and keeps the listings whose
 * developer handle is the selected account's. A listing's newest page of versions, its claims and the
 * evidence linked to its newest version are then read once per listing under
 * {@link OWNED_DETAIL_READ_LIMIT}, and a listing whose detail cannot be read (a hidden or removed
 * listing is not readable by its id) is left out and counted rather than blanking the workspace.
 *
 * **The evaluation submission is one labelled JSON field.** No route exposes the fixture case set and
 * this workspace may not reach the fixture data, so a per-case input list cannot exist: the field
 * carries the contract's `recorded_outputs` as one JSON array, its own check is a shape check only,
 * and the completeness the service enforces is rendered from the service's own sentence, which names
 * the cases it did not receive. This page invents no case identifier and guesses which are missing.
 *
 * **Nothing is executed and nothing is edited.** A submission is declarative data compared as
 * canonical JSON; an evaluation appends a report, a retest appends a new report beside it, and an
 * appeal appends a governance event while leaving the report it concerns exactly as it stands. This
 * page therefore offers no control that could change a stored measurement. Ruling an appeal is an
 * operator's action, and its surface is the report page's: `/reports/:id` mounts the ruling controls
 * for the operator demo account, which is where an operator decides an appeal this page's form opens.
 *
 * The operator half reads the three append-only ledgers through `../components/ledger-table` and the
 * audit feed as a table in the order the events were written, one page of each at a time: all four of
 * those reads answer the most recent page of their collection and state its whole size. It re-sorts
 * nothing, re-computes no amount and reformats no entry: a ledger is read as history, and an appended
 * reversal stays after the entry it reverses. Every amount stays an integer count of minor units of
 * the synthetic currency `DEMO` with the disclosure label stored beside it, and the founder-allocation
 * ledger states that its contract structure is undecided and carries no personal identity, beneficiary
 * account or entitlement.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  createEvaluation,
  createListing,
  createVersion,
  getListing,
  getSelectedDemoAccountId,
  listAuditEvents,
  listChallenges,
  listLedger,
  listStandards,
  openAppeal,
} from "../api-client";
import type { ChallengeListItem, StandardListItem } from "../api-client";
import { readCatalogueListings } from "../catalogue-read";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { LedgerTable } from "../components/ledger-table";
import { mapWithConcurrency } from "../concurrency";
import { findDemoAccount } from "../data/demo-accounts";
import type { DemoAccount } from "../data/demo-accounts";
import { describePricingModel } from "../labels";
import { Timestamp, describeRetryWait, isRecord, readInstant, readText, readWriteFailure, statusOf } from "../payload-reading";
import {
  COLLECTION_PAGE_SIZE,
  FOUNDER_ALLOCATION_CONTRACT_LABEL,
  LEDGER_NAMES,
  LISTING_PAGE_SIZE,
  NO_REPORT_LABEL,
  PRICING_MODELS,
  SYNTHETIC_CURRENCY_LABEL,
} from "@adem/shared";
import type {
  Appeal,
  AuditEvent,
  Category,
  EvaluationReportDetail,
  EvaluationSubmission,
  FounderAllocationLedgerReadResult,
  LedgerName,
  LedgerReadResult,
  Listing,
  ListingClaim,
  ListingDetail,
  ListingSummary,
  ListingVersion,
  ListingVersionCreateBody,
  PricingModel,
  RecordedOutput,
  ReportLabel,
  ReportOutcome,
  StandardVersion,
} from "@adem/shared";

/** The page's one `h1`, and the summary beneath it that names both of the halves it can show. */
const PAGE_HEADING = "Developer workspace";

/** The summary under the page heading: what a developer does here, and what the operator reads here. */
const PAGE_SUMMARY =
  "This page carries the developer's own listings with the writes their owner makes — publish a " +
  "listing, publish a version of it, run an SGI evaluation against a standard version and open an " +
  "appeal against a report — and, for the operator demo account, the three append-only ledgers and " +
  "the audit feed, which are the operator's reads alone. Every write acts as the demo account " +
  "selected in the header, which separates the demonstration's roles and is not a sign-in; every " +
  "read here is public or operator-only and needs no identity of any kind.";

/** The state rendered when no demo account is selected: which halves exist and where to choose one. */
const UNSELECTED_ACCOUNT_HEADING = "Select a demo account";

const UNSELECTED_ACCOUNT_EXPLANATION =
  "This workspace is shown for the demo account selected in the page header, and none is selected. " +
  "A developer account shows the listings that developer published and the writes its owner makes; " +
  "the operator account shows the three ledgers and the audit feed. Choose one in the demo-account " +
  "switcher — the selection separates the demonstration's roles and is not a sign-in.";

/** The state rendered for an account that holds neither of the two roles this page serves. */
const OTHER_ROLE_HEADING = "This account has no developer or operator surfaces";

/**
 * The explanation for a buyer or contributor account: which account this page serves, and what needs
 * no account at all, so the state is a direction rather than a dead end.
 */
function otherRoleExplanation(account: DemoAccount): string {
  return (
    `The selected demo account is ${account.display_label}, whose role is ${account.role}. The ` +
    "developer surfaces on this page belong to the developer that owns the listings, and the ledger " +
    "and audit surfaces belong to the operator alone, so neither is shown for this account. Choose a " +
    "developer account in the demo-account switcher to publish and evaluate; browsing, searching, " +
    "comparing, reading a report and reading the standards need no account at all."
  );
}

/** The heading and explanation of a section's own read, while it is in flight and when it failed. */
const LISTINGS_LOADING_SENTENCE = "Reading the exchange's listings…";

/** The heading of the developer's own listings section. */
const LISTINGS_HEADING = "Your listings";

/**
 * What the listings section states about where these listings come from: the contract's own shape is
 * why the page reads the whole catalogue instead of asking for one developer's listings.
 */
const LISTINGS_EXPLANATION =
  "The published listings whose owning developer is this account's handle. There is no per-developer " +
  "read in the contract, so this workspace reads the public catalogue — its first page, then the pages " +
  "that cover the total that page reported — and keeps the listings that name this developer; each " +
  "one's version history, its claims with their stated limitations and the evidence linked to its " +
  "newest version are then read per listing.";

/** The state rendered when the selected developer has published nothing. */
const NO_LISTINGS_HEADING = "No listings yet";

const NO_LISTINGS_EXPLANATION =
  "This developer has not published a listing yet, so there is nothing to show here and nothing to " +
  "evaluate. Publishing one adds it to the public exchange and to this workspace, and a listing " +
  "needs a version before an evaluation can measure it.";

/** The label of the no-listings state's one next step, which moves focus to the create form. */
const CREATE_LISTING_ACTION_LABEL = "Publish a listing";

/**
 * The sentence rendered when one of this developer's listings could not be read in detail.
 *
 * The listing is left out rather than blanking the workspace: a listing removed from public view is
 * not readable by its id, which is a state the reader can act on and not a fault of this page.
 */
function describeUnreadableListings(count: number): string {
  return count === 1
    ? "One of this developer's listings could not be read in detail, so it is not among the listings below. A listing that has been removed from public view is not readable by its id; the operator reads it with its history. The other listings are unaffected."
    : `${count} of this developer's listings could not be read in detail, so they are not among the listings below. A listing that has been removed from public view is not readable by its id; the operator reads it with its history. The other listings are unaffected.`;
}

/** The sentence the listings region announces once the workspace has been read. */
function describeListingCount(count: number): string {
  if (count === 1) {
    return "One listing is published by this developer.";
  }
  return `${count} listings are published by this developer.`;
}

/** The sentence rendered when the public challenges board could not be read for the counts. */
const CHALLENGES_UNAVAILABLE_NOTE =
  "The challenge counts are not shown on the listings below: the public challenges board could not " +
  "be read. Every other part of the listing is unaffected.";

/**
 * One listing's challenge count as the workspace read it: the challenges counted, and whether the
 * read that counted them covered the whole board.
 *
 * The board answers one page of itself — its most recent page — so a count taken from one read is
 * the board's own count only while that page came back shorter than `COLLECTION_PAGE_SIZE`. A page
 * that came back exactly full may have challenges older than it that no read here ever counted,
 * which is what the second field tells the sentence to state rather than to hide.
 */
interface ChallengeCountReading {
  /** How many challenges the page of the board that was read named for this listing. */
  readonly count: number;
  /** Whether that read covered the whole board, so the count is the board's own count. */
  readonly boardComplete: boolean;
}

/** How many challenges one listing has collected, said as a sentence rather than as a bare number. */
function describeChallengeCount(reading: ChallengeCountReading): string {
  const count = reading.count;
  if (reading.boardComplete) {
    if (count === 0) {
      return "No challenge has been asked about this listing yet.";
    }
    if (count === 1) {
      return "One challenge has been asked about this listing.";
    }
    return `${count} challenges have been asked about this listing.`;
  }
  if (count === 0) {
    return "No challenge on the board's most recent page asks about this listing; a challenge older than that page is not counted here.";
  }
  if (count === 1) {
    return "One challenge on the board's most recent page concerns this listing; a challenge older than that page is not counted here.";
  }
  return `${count} challenges on the board's most recent page concern this listing; challenges older than that page are not counted here.`;
}

/** The heading of one listing's version history. */
const VERSIONS_HEADING = "Version history";

/**
 * How many versions the listing has published, said beside the page of them the read carried.
 *
 * The count comes from the payload's own `version_total` rather than from the page, which answers
 * one page of the history rather than the history itself: a page shorter than the history is the
 * newest page of a longer one, and a page that holds every version is the history. Neither is
 * inferred here from the size of the list.
 */
function describeVersionTotal(versionTotal: number, listed: number): string {
  const published = `This listing has published ${versionTotal} ${versionTotal === 1 ? "version" : "versions"}`;
  return listed < versionTotal
    ? `${published}; its ${listed} most recent ${listed === 1 ? "is" : "are"} listed here.`
    : `${published}.`;
}

/**
 * What the version history states about the evidence linked beside it, including the one thing the
 * listing payload does not carry: which version the linked report measured.
 *
 * It names the versions the payload carries rather than the listing's versions at large, because the
 * detail read answers one page of the history and states the history's whole size in `version_total`,
 * which is rendered beside this sentence.
 */
const VERSIONS_EXPLANATION =
  "The versions of this listing that the read carries, newest first. A version is never edited, so a " +
  "change is a new version. The evidence linked beside the newest version is the report the listing " +
  "payload carries, which is the one measured against that version; a report is read from its own " +
  "link, and a version that was never evaluated is stated as having no report rather than linked to " +
  "one.";

/** The sentence rendered for a listing that has published no version, whose history is empty. */
const NO_VERSIONS_NOTE =
  "This listing has not published a version yet, so there is nothing for an evaluation to measure.";

/** The labels of the claim a version makes and of the limitation the developer states beside it. */
const CLAIM_LABEL = "What this version claims";
const LIMITATION_LABEL = "What the claim does not cover";
const VERSION_NOTES_LABEL = "Release notes";

/** The link text of a report recorded as a pass, and of one recorded as a failure. */
const REPORT_LINK_LABEL = "Read the SGI report";

/**
 * The link text of a report recorded as a failure. The report page renders the per-case evidence,
 * which is what a reader needs beside a failure, so the link says where it leads.
 */
const REPORT_LINK_FAIL_LABEL = "Read the report (fail — see the per-case evidence)";

/** The heading of the form that publishes a version, and what it states about a version's rule. */
const PUBLISH_HEADING = "Publish a version";

const PUBLISH_EXPLANATION =
  "A version is what an evaluation measures, and it is append-only: a correction is a new version " +
  "and never an edit to one already published. A version string is unique within its listing, so " +
  "publishing a string this listing already carries is refused, and the refusal names it as a " +
  "duplicate rather than as a fault of the request.";

/** The version form's fields, with the rule the contract's schema states for a version string. */
const VERSION_FIELD_LABEL = "Version string";

const VERSION_FIELD_HINT =
  "This listing's own label for the version: at most 32 characters, a letter or digit first, then " +
  "letters, digits and the characters . _ + - — the shapes 1.0.0, 2024-05 and 1.0.0-beta.2 all fit. " +
  "It must be one this listing has not published before.";

const NOTES_FIELD_LABEL = "Release notes";

const NOTES_FIELD_HINT =
  "What changed in this version, in the developer's own words. Leave it empty to publish the version " +
  "with no notes recorded.";

/** The heading of the form that publishes a listing, and what it states about the fields it lacks. */
const CREATE_HEADING = "Publish a listing";

const CREATE_EXPLANATION =
  "A listing is this developer's page in the exchange: a title, a summary, the category it sits in, " +
  "the license it is offered under and the pricing model it declares. Its address token and its " +
  "status are the service's rather than a field here, and the owning developer is the demo account " +
  "selected in the header.";

/** The create form's fields. */
const TITLE_FIELD_LABEL = "Title";
const TITLE_FIELD_HINT = "The name a buyer reads in search results and on the listing page.";
const SUMMARY_FIELD_LABEL = "Summary";

const SUMMARY_FIELD_HINT =
  "One paragraph describing what the listing offers, which a search result renders beside the title.";

const CATEGORY_FIELD_LABEL = "Category";

const CATEGORY_FIELD_HINT =
  "The category the listing sits in, which the listing filter narrows on. The catalogue carries the " +
  "categories rather than a route of their own, so these are the categories the published listings " +
  "name.";

const LICENSE_FIELD_LABEL = "License code";

const LICENSE_FIELD_HINT =
  "The license the listing is offered under, as the short code a buyer reads beside it — for " +
  "example MIT.";

const PRICING_FIELD_LABEL = "Pricing model";

const PRICING_FIELD_HINT =
  "How the listing is offered. Every model is displayed as the developer declared it, and a " +
  "simulated checkout elsewhere on the site selects one of the models a listing makes.";

/**
 * What the create form states when the catalogue named no category at all.
 *
 * The categories arrive with the listings, so a catalogue with nothing in it has none to offer and
 * no listing can be published until one is. The form says so in its own words rather than rendering
 * an empty select, and it is a state rather than a failure.
 */
const NO_CATEGORIES_NOTE =
  "No category is available to choose, so a listing cannot be published yet: the categories arrive " +
  "with the published listings, and the catalogue returned none. This is the state of an exchange " +
  "with nothing published in it rather than a failure of this form.";

/** The label of the version form's submit control. */
const PUBLISH_ACTION_LABEL = "Publish this version";

/** The sentence beside the version field when nothing was entered. */
const BLANK_VERSION_SENTENCE = "Enter a version string before publishing it.";

/**
 * The sentence beside the version field when the service refused the string as written, and the one
 * the status region announces in the same case.
 *
 * A `400` on this route is the version string's own problem — a missing, over-long or disallowed
 * label — so the explanation belongs beside the field the reader can edit.
 */
const REFUSED_VERSION_SENTENCE =
  "The service did not accept this version string as written. It must be unique within this listing " +
  "and use the characters a version label allows; edit the field and publish it again, and what you " +
  "typed has been kept.";

const REFUSED_VERSION_STATUS = "The version was not published: see the message beside the version string.";

/**
 * The sentence beside the version field when this listing has already published this string.
 *
 * The contract's `409` is decided by the unique pair of listing and version string, which is a state
 * of the listing rather than a fault of the request, so it is explained in plain words with the one
 * thing the reader can do about it.
 */
const DUPLICATE_VERSION_SENTENCE =
  "This listing has already published this version string, so nothing was published: a version " +
  "string is unique within its listing. Choose another one — a patch above the newest version in " +
  "the history above, for example — and publish that instead.";

/** The sentence a version publication with no demo account renders, and the one for a wrong role. */
const NO_ACCOUNT_VERSION_SENTENCE =
  "No demo account is selected, so the version was not published. Choose a demo account in the " +
  "demo-account switcher, then publish it again — the text you typed has been kept.";

const WRONG_ROLE_VERSION_SENTENCE =
  "Publishing a version needs the demo account of the developer that owns this listing. The " +
  "selected account is not that developer, so nothing was published and the text you typed has " +
  "been kept. Switch to the owning developer account and publish it again.";

/** The sentence a version publication for a listing the service no longer holds renders. */
const MISSING_LISTING_VERSION_SENTENCE =
  "The service no longer holds this listing, so the version was not published. Read this " +
  "developer's listings again to see what is published.";

/** The sentence a version publication whose failure carried no facts renders. */
const UNREADABLE_VERSION_FAILURE =
  "The version was not published. Publish it again; the text you typed has been kept.";

/** What a published version is announced as, once the service has answered. */
function describePublishedVersion(version: ListingVersion): string {
  return `Published ${version.version_string} as a new version of this listing — version ${version.id}, recorded at ${readInstant(version.created_at).text}. An evaluation can now name it as the candidate version it measures.`;
}

/** The label of the create form's submit control, and the sentence the status region announces. */
const CREATE_ACTION_LABEL = "Publish this listing";

/**
 * What the create form adds to a `400` notice: the refusal names the parameter, so the form states
 * what it can — that nothing was written and that the fields still hold what was typed.
 */
const CREATE_REFUSED_DETAIL =
  "The listing's details are validated at the service's edge, and the sentence above names what it " +
  "did not accept. Nothing was written, and everything you typed is still in the fields, so it can " +
  "be corrected and sent again.";

/** The sentences a create refused for want of an account or for a wrong role renders. */
const NO_ACCOUNT_CREATE_SENTENCE =
  "No demo account is selected, so the listing was not published. Choose a demo account in the " +
  "demo-account switcher, then publish it again — everything you typed is still in the fields.";

const WRONG_ROLE_CREATE_SENTENCE =
  "Publishing a listing needs a demo account whose role is developer. The selected account is not a " +
  "developer, so nothing was published and everything you typed is still in the fields. Switch to a " +
  "developer account and publish it again.";

/** The sentence a create whose failure carried no facts renders. */
const UNREADABLE_CREATE_FAILURE =
  "The listing was not published. Publish it again; everything you typed is still in the fields.";

/** What a published listing is announced as, once the service has answered. */
function describeCreatedListing(listing: Listing): string {
  return `Listing published: ${listing.title} — listing ${listing.id}, with the status ${listing.status}. It is among this developer's listings below, and it needs a version before an evaluation can measure it.`;
}

/******* The evaluation form */

/** The heading of the evaluation form and what it states about what an evaluation does. */
const EVALUATION_HEADING = "Run an evaluation";

const EVALUATION_EXPLANATION =
  "An evaluation compares recorded outputs against the standard version's fixture set as data, and " +
  "nothing is executed. The submission names the candidate version, the standard version and one " +
  "recorded output for every fixture case; the report that comes back states the outcome, the label " +
  "and the per-case evidence, and it is appended — no report can be changed afterwards, and the " +
  "outcome follows from the versioned pass rule alone rather than from anything bought or sponsored.";

/** The evaluation form's candidate and standard selects. */
const CANDIDATE_FIELD_LABEL = "Candidate version";

const CANDIDATE_FIELD_HINT =
  "A version of one of this developer's own listings: an evaluation is run by the developer that " +
  "owns the candidate version it measures.";

const STANDARD_FIELD_LABEL = "Standard version";

const STANDARD_FIELD_HINT =
  "The versioned criteria the run is scored against. A version's thresholds are provisional and " +
  "versioned with it, and its rubric is published in the standard's own document.";

/** The recorded-outputs field: its label, the shape it carries, and the example its hint shows. */
const OUTPUTS_FIELD_LABEL = "Recorded outputs, as JSON";

const OUTPUTS_EXAMPLE = '[{"case_id": "<the case identifier>", "output": {"answer": 42}}]';

/**
 * What the recorded-outputs field states about its shape, with the case count read from the standard
 * version the run will be scored against rather than written down here.
 */
function describeOutputsHint(totalCases: number): string {
  return (
    "One JSON array holding one object for every fixture case, and each object carries a case_id " +
    `and the output recorded for that case — for example ${OUTPUTS_EXAMPLE}. The selected standard ` +
    `version defines ${totalCases} cases, so the submission carries one recorded output for each of ` +
    "them; the case identifiers come from that version's published fixture set, which its own " +
    "document states. Nothing here is executed: each output is data compared with the case's " +
    "expected output as canonical JSON."
  );
}

/** The sentences the field's own shape check renders, each tied to the field it explains. */
const UNREADABLE_OUTPUTS_SENTENCE =
  "This field must hold JSON: a single array of objects, one per fixture case. Check the brackets " +
  "and the commas and send it again; nothing was written.";

const OUTPUTS_NOT_ARRAY_SENTENCE =
  "This field must hold one JSON array rather than a single object: the submission is a list " +
  "carrying one entry for every fixture case.";

const OUTPUTS_ENTRY_SENTENCE =
  "Every entry in the array must be a JSON object with a case_id string and an output. An entry " +
  "that carries a case_id without an output is not a submission: an output is required for every " +
  "case.";

/** The sentence beside the field when the service could not read the submission as the required shape. */
const REFUSED_OUTPUTS_SENTENCE =
  "The service could not read this submission as the required shape: a JSON array holding one " +
  "object for every fixture case, each with a case_id and an output. Edit the field and send it " +
  "again; nothing was written.";

const REFUSED_OUTPUTS_STATUS =
  "The evaluation was not run: see the message beside the recorded outputs.";

/**
 * What a `422` states beside the service's own sentence, which is the only thing in the product that
 * names the cases a submission did not carry.
 *
 * This page adds what that sentence does not say — how many cases the standard version defines, that
 * an output is expected for each of them, and that an incomplete submission is refused before any
 * report is written — and it invents no case identifier and guesses which are missing.
 */
function incompleteOutputsDetail(totalCases: number): string {
  return (
    "The submission is missing a recorded output for at least one fixture case. One output is " +
    `expected for every case in the selected standard version, of which there are ${totalCases}, ` +
    "and an incomplete submission is refused before any report is written. The sentence above names " +
    "the cases the service did not receive; the field still holds the submission, so it can be " +
    "completed and sent again."
  );
}

/** The sentences an evaluation refused for want of a version, an account or the owning developer renders. */
const UNRESOLVED_EVALUATION_SENTENCE =
  "The candidate version or the standard version no longer resolves, so nothing was run. Read this " +
  "developer's listings and the standards again to see what is published.";

const NO_ACCOUNT_EVALUATION_SENTENCE =
  "No demo account is selected, so the evaluation was not run. Choose a demo account in the " +
  "demo-account switcher, then send the submission again — it is still in the field.";

const WRONG_ROLE_EVALUATION_SENTENCE =
  "Running an evaluation needs the demo account of the developer that owns the candidate version, " +
  "and the selected account is not that developer, so nothing was run. Switch to the owning " +
  "developer account and send the submission again — it is still in the field.";

/** The sentence an evaluation whose failure carried no facts renders. */
const UNREADABLE_EVALUATION_FAILURE =
  "The evaluation was not run. Send the submission again; it is still in the field.";

/** The label of the evaluation form's submit control, and the status it announces when it refuses. */
const EVALUATION_ACTION_LABEL = "Run this evaluation";
const UNREQUESTED_EVALUATION_STATUS = "The evaluation was not run, and no request was sent.";

/**
 * What the evaluation form states when there is nothing to evaluate: a candidate version is required
 * before the form's controls can mean anything.
 */
const NO_CANDIDATE_VERSIONS_HEADING = "No version to evaluate yet";

const NO_CANDIDATE_VERSIONS_EXPLANATION =
  "An evaluation names the version it measures, and none of this developer's listings has published " +
  "a version yet. Publish a version above and it becomes a candidate for an evaluation.";

/** What the evaluation form states when no standard version is published to score against. */
const NO_STANDARD_VERSIONS_HEADING = "No standard version to score against";

const NO_STANDARD_VERSIONS_EXPLANATION =
  "An evaluation is scored against a published standard version, and the catalogue returned none. " +
  "The standards page states what is published and how a change to the criteria is proposed.";

/** What a completed evaluation is announced as, with the provenance the service recorded. */
function describeCreatedReport(report: EvaluationReportDetail): string {
  const followed =
    report.prior_report_id === null
      ? " No earlier report is recorded for this candidate version and standard version, so this is the first run of them together."
      : ` It records ${report.prior_report_id} as the report it follows.`;
  return (
    `Evaluation recorded as a new report: ${report.id}, with the outcome ${report.outcome} and the ` +
    `label ${report.label}. It matched ${report.matched_count} of ${report.total_count} cases with ` +
    `${report.critical_failures} critical failures.${followed}`
  );
}

/******* The appeal form */

/** The heading of the appeal form and what it states about what an appeal can and cannot do. */
const APPEAL_HEADING = "Open an appeal";

const APPEAL_EXPLANATION =
  "An appeal asks for a report's outcome to be reviewed, with the developer's stated ground. It is " +
  "opened by the developer that owns the measured version, and it leaves the report exactly as it " +
  "stands: a ruling is appended as a governance event, so the report reads the same afterwards. " +
  "Deciding an appeal is the operator's action, and the controls for it are offered on the report " +
  "page to the operator demo account.";

/** The appeal form's report select and its reason field. */
const APPEAL_REPORT_FIELD_LABEL = "Report to appeal";

const APPEAL_REPORT_FIELD_HINT =
  "The reports linked to this developer's listings, each with the outcome and the label it was " +
  "recorded with, followed by any report you recorded on this page. The report a reason is opened " +
  "against comes from this selection rather than from the reason.";

const REASON_FIELD_LABEL = "Ground for the appeal";

const REASON_FIELD_HINT =
  "Say what this report gets wrong about the evidence the submission gave it. The reason, and the " +
  "ruling that answers it, are recorded as governance events.";

/** The state rendered when this developer has no linked report yet, so there is nothing to appeal. */
const NO_APPEALABLE_REPORT_HEADING = "No report to appeal yet";

const NO_APPEALABLE_REPORT_EXPLANATION =
  "No report is linked to this developer's listings yet, so there is nothing to appeal. Run an " +
  "evaluation above and the report it records becomes one this form can name.";

/** The label of the appeal form's submit control, and the sentences its refusals render. */
const APPEAL_ACTION_LABEL = "Open the appeal";

const BLANK_REASON_SENTENCE = "State the ground for the appeal before opening it.";

const REFUSED_REASON_SENTENCE =
  "The service did not accept this reason as written. Say what the report gets wrong about the " +
  "evidence the submission gave it, then open the appeal again — the text you typed has been kept.";

const REFUSED_REASON_STATUS = "The appeal was not opened: see the message beside the reason.";

const NO_ACCOUNT_APPEAL_SENTENCE =
  "No demo account is selected, so the appeal was not sent. Choose a demo account in the " +
  "demo-account switcher, then open it again — the reason you wrote has been kept.";

const WRONG_ROLE_APPEAL_SENTENCE =
  "Opening an appeal needs the demo account of the developer that owns the appealed report. The " +
  "selected account is not that developer, so nothing was opened and the reason you wrote has been " +
  "kept. Switch to the owning developer account and open it again.";

const MISSING_REPORT_APPEAL_SENTENCE =
  "The service no longer holds the report this appeal names, so the appeal was not opened. Read " +
  "this developer's listings again to see which reports are linked.";

const UNREADABLE_APPEAL_FAILURE =
  "The appeal was not opened. Open it again; the reason you wrote has been kept.";

const UNREQUESTED_APPEAL_STATUS = "The appeal was not opened, and no request was sent.";

/** What an opened appeal is announced as, including the guarantee the copy above states. */
function describeOpenedAppeal(appeal: Appeal): string {
  return `Appeal opened: ${appeal.id}, recorded with the status ${appeal.status}. The report has not changed: a ruling is appended as a governance event, and no control on this page rules an appeal.`;
}

/******* The operator surfaces */

/** The heading of the operator's ledger reads, and what they state about the three ledgers. */
const OPERATOR_LEDGERS_HEADING = "The three ledgers";

/**
 * What the ledger section states about the three ledgers, in this page's own words.
 *
 * The bound is stated here as well as in each ledger's own count below, because every one of the
 * three reads answers one page of its ledger rather than the whole history: the ledgers are
 * append-only, so a reader who took a page for the record would be reading a part as the whole.
 *
 * The founder-allocation ledger's contract structure is stated here as well as on the ledger view
 * itself, so the words a reader must see are present wherever this section is read, and the currency
 * label is stated here rather than left to be inferred from an amount: every amount in every ledger
 * is a whole number of minor units of the synthetic currency named below.
 */
const OPERATOR_LEDGERS_EXPLANATION =
  `The marketplace ledger, the gate-fee ledger and the founder-allocation ledger, each read one page ` +
  `at a time — the page it answers is the ledger's most recent entries, in the order they were ` +
  `appended. An amount is a whole number of minor units of the synthetic ` +
  `currency ${SYNTHETIC_CURRENCY_LABEL}, and every entry carries its own disclosure label: this is a ` +
  `nonfunctional demonstration in which no real payment, settlement or payout exists, and no amount ` +
  `here is a payment of any kind. The founder-participation contract structure is ` +
  `${FOUNDER_ALLOCATION_CONTRACT_LABEL}, and that ledger carries no personal identity, beneficiary ` +
  `account or entitlement. A refund appends reversal entries and edits nothing, and no entry is ever ` +
  `changed or deleted.`;

/** The heading of a ledger whose read returned no entries, and what that state means. */
const LEDGER_HEADINGS: Readonly<Record<LedgerName, string>> = Object.freeze({
  marketplace: "Marketplace ledger",
  gate_fees: "Gate-fee ledger",
  founder_allocation: "Founder-allocation ledger",
});

const LEDGER_EMPTY_EXPLANATION =
  "No entries have been recorded in this ledger yet. An entry is appended as it happens and an " +
  "existing entry is never edited, so an empty ledger is a state rather than a failure.";

/** What a ledger states while its read is in flight, named so that three reads are tellable apart. */
function describeLedgerLoading(ledger: LedgerName): string {
  return `Reading ${LEDGER_HEADINGS[ledger]}…`;
}

/**
 * How many entries the ledger holds, said above the page of them the read answered.
 *
 * The count is the read's own `total` rather than the length of the page, because the read answers one
 * page of the ledger: a page shorter than the ledger is its most recent page, and a page that holds
 * every entry is the ledger itself. Neither is inferred here from the size of the list.
 */
function describeLedgerTotal(total: number, listed: number): string {
  const held = `This ledger holds ${total} ${total === 1 ? "entry" : "entries"}`;
  return listed < total
    ? `${held}; its ${listed} most recent ${listed === 1 ? "is" : "are"} listed here.`
    : `${held}.`;
}

/**
 * What a failed ledger or audit read adds when the refusal was a role refusal.
 *
 * The operator half is mounted only for the operator account, so this should be unreachable; it is
 * stated anyway, because a refusal must read as an explanation rather than as a status code.
 */
const OPERATOR_ROLE_DETAIL =
  "The three ledger reads and the audit feed are operator-only reads, so only the operator demo " +
  "account may make them. Choose the operator account in the demo-account switcher and read them " +
  "again.";

/** The heading of the audit feed and what it states about what it holds and what it is not. */
const AUDIT_HEADING = "The audit feed";

const AUDIT_EXPLANATION =
  "The append-only feed of what was written — the actor, the action, the resource, its status and " +
  "the reason — in the order the writes happened. The feed is read one page at a time, its most " +
  "recent page first, so the rows below are that page of events and not the whole record. It is " +
  "distinct from the governance events that record decisions: a moderation action, a proposal " +
  "review and an appeal ruling append a governance event, and every write appends an audit event. " +
  "Neither feed is ever amended, and nothing here is sorted, filtered or re-keyed.";

/** The state an audit feed with nothing in it renders, and the caption the table carries. */
const AUDIT_EMPTY_HEADING = "Nothing in the audit feed yet";

const AUDIT_EMPTY_EXPLANATION =
  "No write has been recorded yet. An event is appended as the write happens and is never amended, " +
  "so a write made anywhere in the exchange appears here in the order it happened.";

const AUDIT_LOADING_SENTENCE = "Reading the audit feed…";

const AUDIT_TABLE_CAPTION =
  "Audit events, in the order the writes happened: the feed's most recent page, because the read " +
  "answers one page of it at a time. Each row is a write that was recorded, and no row is amended " +
  "afterwards.";

/**
 * The audit table's seven column labels, in the order the reading route records them and each stated
 * in words rather than as a field name. They are named here because the header row and the label
 * every cell prints below the breakpoint are the same seven strings.
 */
const ACTOR_COLUMN_LABEL = "Actor";
const ACTION_COLUMN_LABEL = "Action";
const RESOURCE_TYPE_COLUMN_LABEL = "Resource type";
const RESOURCE_ID_COLUMN_LABEL = "Resource ID";
const STATUS_COLUMN_LABEL = "Status";
const REASON_COLUMN_LABEL = "Reason";
const RECORDED_COLUMN_LABEL = "Recorded";

const AUDIT_COLUMNS: readonly string[] = Object.freeze([
  ACTOR_COLUMN_LABEL,
  ACTION_COLUMN_LABEL,
  RESOURCE_TYPE_COLUMN_LABEL,
  RESOURCE_ID_COLUMN_LABEL,
  STATUS_COLUMN_LABEL,
  REASON_COLUMN_LABEL,
  RECORDED_COLUMN_LABEL,
]);

/** What a column renders for a field the row left empty, so no cell is rendered blank. */
const NO_REASON_NOTE = "no reason was recorded";


/**
 * The sentence a throttled write renders: what the limit is, how long the response says to wait, and
 * what the reader keeps, which is the one part each form states in its own words.
 */
function throttledSentence(kept: string, retryAfterSeconds: number | null): string {
  return `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(retryAfterSeconds, "then send it again.")} ${kept}`;
}

/**
 * What one refusal renders, in the three forms a form can use it.
 *
 * `field` names what the reader can change in the control itself and carries the sentence the status
 * region announces; `explained` is a sentence this page writes in full, for a state the reader
 * resolves by switching account or waiting; and `notice` hands the failure to the error notice, which
 * echoes the service's own sentence for the statuses where the service knows what this page cannot —
 * which parameter, which record, which case — and never renders a trace.
 */
type WriteFailureReading =
  | { readonly kind: "field"; readonly sentence: string; readonly statusSentence: string }
  | {
      readonly kind: "explained";
      readonly sentence: string;
      /**
       * The notice variant the explanation renders in: the warning triple for the write rate limit,
       * which the reader waits out and sends again, and the error triple for every other refusal.
       */
      readonly variant: "notice--error" | "notice--warning";
      readonly offersBrowse: boolean;
    }
  | { readonly kind: "notice"; readonly error: unknown; readonly detail: ReactNode };

/** Whether a raised value is a role refusal, read for the ledger and audit reads' explanation. */
function isForbidden(error: unknown): boolean {
  return statusOf(error) === 403;
}

/**
 * The reading a form renders: its own check when one refused the control, and the service's refusal
 * otherwise, so the two can never both be shown for one attempt.
 */
function readingFor(
  localSentence: string | null,
  localStatusSentence: string,
  serviceReading: WriteFailureReading | null,
): WriteFailureReading | null {
  return localSentence === null
    ? serviceReading
    : { kind: "field", sentence: localSentence, statusSentence: localStatusSentence };
}

/**
 * The sentence a reading puts beside its control, or `null` when the reading is not the control's.
 *
 * Only the field kind marks the control invalid: a missing account, a wrong role or a rate limit is
 * not something the reader can fix by editing the field.
 */
function fieldSentenceOf(reading: WriteFailureReading | null): string | null {
  return reading !== null && reading.kind === "field" ? reading.sentence : null;
}

/**
 * A refusal this page explains in its own words, rendered inside a form's polite status region so the
 * explanation is announced. It is never the error notice, which holds a live region of its own.
 */
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
          <Link to="/listings">Browse the published listings</Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The reading a form renders beside its status region when the service's own sentence is the useful
 * part: the error notice owns that rendering, and it holds a polite live region of its own, so it is
 * rendered beside the form's region rather than nested inside it.
 */
function FailedRequestNotice(props: {
  readonly error: unknown;
  readonly detail: ReactNode;
}): JSX.Element {
  return <ErrorNotice error={props.error} detail={props.detail} />;
}

/**
 * The reading a version publication's failure renders, and `null` when nothing has failed.
 *
 * The two statuses that are the field's own — a string the schema rejects and a string this listing
 * already published — are marked beside the field, and every other status is either a state the
 * reader resolves elsewhere or one the error notice explains.
 */
function describeVersionFailure(error: unknown): WriteFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return { kind: "explained", sentence: UNREADABLE_VERSION_FAILURE, variant: "notice--error", offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return {
        kind: "field",
        sentence: REFUSED_VERSION_SENTENCE,
        statusSentence: REFUSED_VERSION_STATUS,
      };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_VERSION_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_VERSION_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: MISSING_LISTING_VERSION_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 409:
      return {
        kind: "field",
        sentence: DUPLICATE_VERSION_SENTENCE,
        statusSentence: REFUSED_VERSION_STATUS,
      };
    case 429:
      return {
        kind: "explained",
        sentence: throttledSentence(
          "The text you typed has been kept.",
          failure.retryAfterSeconds,
        ),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return { kind: "notice", error, detail: null };
  }
}

/** The reading a listing publication's failure renders, and `null` when nothing has failed. */
function describeCreateFailure(error: unknown): WriteFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return { kind: "explained", sentence: UNREADABLE_CREATE_FAILURE, variant: "notice--error", offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return { kind: "notice", error, detail: <p>{CREATE_REFUSED_DETAIL}</p> };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_CREATE_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_CREATE_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 429:
      return {
        kind: "explained",
        sentence: throttledSentence(
          "Everything you typed is still in the fields.",
          failure.retryAfterSeconds,
        ),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return { kind: "notice", error, detail: null };
  }
}

/**
 * The reading an evaluation's failure renders, and `null` when nothing has failed.
 *
 * A `422` is the one status that keeps the field valid: the shape was accepted and a case is missing,
 * which is not what the reader typed wrongly, so the explanation is the error notice echoing the
 * service's sentence that names the cases it did not receive. `totalCases` is read from the standard
 * version the run will be scored against, so the expectation is stated with the version's own count.
 */
function describeEvaluationFailure(
  error: unknown,
  totalCases: number,
): WriteFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return { kind: "explained", sentence: UNREADABLE_EVALUATION_FAILURE, variant: "notice--error", offersBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return {
        kind: "field",
        sentence: REFUSED_OUTPUTS_SENTENCE,
        statusSentence: REFUSED_OUTPUTS_STATUS,
      };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_EVALUATION_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_EVALUATION_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: UNRESOLVED_EVALUATION_SENTENCE, variant: "notice--error", offersBrowse: true };
    case 422:
      return { kind: "notice", error, detail: <p>{incompleteOutputsDetail(totalCases)}</p> };
    case 429:
      return {
        kind: "explained",
        sentence: throttledSentence(
          "The submission is still in the field.",
          failure.retryAfterSeconds,
        ),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return { kind: "notice", error, detail: null };
  }
}

/** The reading an appeal's failure renders, and `null` when nothing has failed. */
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
      return {
        kind: "field",
        sentence: REFUSED_REASON_SENTENCE,
        statusSentence: REFUSED_REASON_STATUS,
      };
    case 401:
      return { kind: "explained", sentence: NO_ACCOUNT_APPEAL_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 403:
      return { kind: "explained", sentence: WRONG_ROLE_APPEAL_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 404:
      return { kind: "explained", sentence: MISSING_REPORT_APPEAL_SENTENCE, variant: "notice--error", offersBrowse: false };
    case 429:
      return {
        kind: "explained",
        sentence: throttledSentence(
          "The reason you wrote has been kept.",
          failure.retryAfterSeconds,
        ),
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return { kind: "notice", error, detail: null };
  }
}


/**
 * One entry of a submission: a fixture case identifier and the output recorded for it.
 *
 * The pair is what the service's completeness check reads, which is why the field is a list of pairs
 * rather than a map from case to output.
 */
interface RecordedOutputEntry {
  readonly case_id: string;
  readonly output: unknown;
}

/**
 * Whether a parsed value is a submission entry: an object carrying a case identifier and an output.
 *
 * The presence of the `output` key is checked rather than its value, because `null` is a recorded
 * output while an entry that omits the key is the incomplete submission the service answers `422`
 * for.
 */
function isRecordedOutputEntry(value: unknown): value is RecordedOutputEntry {
  // A refusal is stated once: `isRecord` answers false for an array as well as for a primitive.
  if (!isRecord(value)) {
    return false;
  }
  const caseId = readText(value["case_id"]);
  return caseId !== null && Object.prototype.hasOwnProperty.call(value, "output");
}

/** The outcome of reading the recorded-outputs field: the outputs, or why the field was refused. */
type OutputsReading =
  | { readonly ok: true; readonly outputs: RecordedOutput[] }
  | { readonly ok: false; readonly sentence: string };

/**
 * Reads the recorded-outputs field into the outputs the request body carries.
 *
 * Shape only, deliberately. The field is checked for being JSON, for being an array and for every
 * entry carrying a case identifier and an output — and never for carrying one output per fixture
 * case. Completeness is the service's check, made against the fixture set it loaded, and it is the
 * service that answers a submission missing a case with the sentence naming the cases it did not
 * receive. A second check here would refuse the request before that sentence could be produced, and
 * this page holds no case set to check against: the fixture data is not reachable from this
 * workspace, and a page that listed the cases it expects would be inventing the criteria rather than
 * reading them.
 */
function readOutputs(text: string): OutputsReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, sentence: UNREADABLE_OUTPUTS_SENTENCE };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, sentence: OUTPUTS_NOT_ARRAY_SENTENCE };
  }
  const entries: unknown[] = parsed;
  const outputs: RecordedOutput[] = [];
  for (const entry of entries) {
    if (!isRecordedOutputEntry(entry)) {
      return { ok: false, sentence: OUTPUTS_ENTRY_SENTENCE };
    }
    outputs.push({ case_id: entry.case_id, output: entry.output });
  }
  return { ok: true, outputs };
}

/** The address of one listing: a route of this application, never an address of the service. */
function listingPath(listingId: string): string {
  return `/listings/${listingId}`;
}

/** The address of one report: likewise a route of this application. */
function reportPath(reportId: string): string {
  return `/reports/${reportId}`;
}

/** The category's display name, or its identifier when no name was resolved, so nothing renders blank. */
function categoryLabel(category: Category): string {
  return category.name === "" ? category.id : category.name;
}

/** Whether a select's value is one of the pricing models the contract fixes. */
function isPricingModel(value: string): value is PricingModel {
  return (PRICING_MODELS as readonly string[]).includes(value);
}

/** One of the developer's own listings: the catalogue row and the detail read for it. */
interface OwnedListing {
  readonly summary: ListingSummary;
  readonly detail: ListingDetail;
}

/**
 * What reading this developer's listings produced: their own listings, the number of their listings
 * whose detail could not be read, and the catalogue rows every read collected.
 *
 * The catalogue is kept because the create form's categories come from it: the contract has no
 * categories route, so the categories a listing can be placed in are the ones the published listings
 * already name, and the whole catalogue carries them rather than this developer's own listings alone.
 */
interface OwnedListingsRead {
  readonly listings: readonly OwnedListing[];
  readonly unreadableCount: number;
  readonly catalogue: readonly ListingSummary[];
}

/**
 * How many of this developer's listing details one read may have in flight at once.
 *
 * The detail is read for every one of this developer's listings rather than for the listing a reader
 * opens, because the page renders each of them with its version history, its claims and the report link
 * its newest version carries — `e2e/route-walk.spec.ts` asserts those visible on load for the demo
 * developer account — and the contract's only read for a listing's versions and claims is the listing's
 * own detail read, since a catalogue summary carries neither. The reads are batched under this bound
 * rather than deferred behind an interaction, and the bound is deliberately small: the API is one
 * process whose storage calls are synchronous, so a burst wider than this one queues behind the writer
 * without finishing any sooner.
 */
const OWNED_DETAIL_READ_LIMIT = 4;

/**
 * This developer's listings, each with its detail.
 *
 * The catalogue is read once through {@link readCatalogueListings} and filtered by the summary's
 * developer handle, which is the only read that can answer "this developer's listings" while the
 * contract has no per-developer route, and then each listing's detail is read for its version history,
 * its claims and its linked evidence, {@link OWNED_DETAIL_READ_LIMIT} of them at a time. One detail
 * that cannot be read — a listing no longer in public view is not readable by its id — is left out and
 * counted rather than failing the workspace the developer is working in.
 */
async function readOwnedListings(handle: string): Promise<OwnedListingsRead> {
  const catalogue = await readCatalogueListings();
  const summaries = catalogue.filter(
    (summary: ListingSummary): boolean => summary.developer_handle === handle,
  );
  const reads = await mapWithConcurrency(
    summaries,
    OWNED_DETAIL_READ_LIMIT,
    async (summary: ListingSummary): Promise<OwnedListing | null> => {
      try {
        return { summary, detail: await getListing(summary.id) };
      } catch {
        return null;
      }
    },
  );
  const listings: OwnedListing[] = [];
  let unreadableCount = 0;
  for (const read of reads) {
    if (read === null) {
      unreadableCount += 1;
    } else {
      listings.push(read);
    }
  }
  return { listings, unreadableCount, catalogue };
}

/**
 * One report this developer may read or appeal: the provenance a report's link states.
 *
 * The outcome and the label are the service's, carried through exactly as they were recorded, and a
 * report is held under this shape rather than as the whole report because a listing payload states
 * the report's identity and outcome without its per-case evidence.
 */
interface OwnedReport {
  readonly id: string;
  readonly outcome: ReportOutcome;
  readonly label: ReportLabel;
}

/**
 * The report a listing's payload links, or `null` when it links none.
 *
 * The three fields of the report provenance are null together, so a partially populated trio is
 * treated as no report: a link built from an incomplete trio would name a report this page cannot
 * describe.
 */
function linkedReport(detail: ListingDetail): OwnedReport | null {
  const id = detail.report_id;
  const outcome = detail.outcome;
  const label = detail.label;
  if (id === null || outcome === null || label === null) {
    return null;
  }
  return { id, outcome, label };
}

/** The reports of one developer, in the order read, with each report appearing once. */
function mergeReports(
  first: readonly OwnedReport[],
  second: readonly OwnedReport[],
): OwnedReport[] {
  const seen = new Set<string>();
  const merged: OwnedReport[] = [];
  for (const report of [...first, ...second]) {
    if (seen.has(report.id)) {
      continue;
    }
    seen.add(report.id);
    merged.push(report);
  }
  return merged;
}

/** The reports linked to this developer's listings, in the order the listings and versions are read. */
function linkedReportsOf(listings: readonly OwnedListing[]): OwnedReport[] {
  const reports: OwnedReport[] = [];
  for (const listing of listings) {
    const report = linkedReport(listing.detail);
    if (report !== null) {
      reports.push(report);
    }
  }
  return reports;
}

/** One candidate version the evaluation form offers: an identifier, and what it is a version of. */
interface CandidateVersionOption {
  readonly versionId: string;
  readonly listingTitle: string;
  readonly versionString: string;
}

/**
 * The versions of this developer's own listings that their detail reads carry, as the evaluation
 * form offers them.
 *
 * Only these versions are offered, because the route requires the selected developer to own the
 * candidate version: an option this page could not submit would be a control that always refuses.
 * The order is the order the version histories were read in, newest first within each listing, and
 * each listing contributes the newest page of its history because that is what its detail read
 * answered with.
 */
function candidateVersionOptions(listings: readonly OwnedListing[]): CandidateVersionOption[] {
  const options: CandidateVersionOption[] = [];
  for (const listing of listings) {
    for (const version of listing.detail.versions) {
      options.push({
        versionId: version.id,
        listingTitle: listing.summary.title,
        versionString: version.version_string,
      });
    }
  }
  return options;
}

/** One standard version the evaluation form offers, with the case count its thresholds are stated for. */
interface StandardVersionOption {
  readonly versionId: string;
  readonly label: string;
  readonly totalCases: number;
}

/**
 * Every published standard version, as the evaluation form offers them.
 *
 * The label names the standard's code and the version's label, and the case count travels with the
 * option because the field's helper text and a `422`'s explanation are both stated with the version's
 * own number rather than with a count written into this page.
 */
function standardVersionOptions(standards: readonly StandardListItem[]): StandardVersionOption[] {
  const options: StandardVersionOption[] = [];
  for (const standard of standards) {
    for (const version of standard.versions) {
      options.push({
        versionId: version.id,
        label: standardVersionLabel(standard, version),
        totalCases: version.total_cases,
      });
    }
  }
  return options;
}

/** One standard version said in words: the standard's code and the version's own label. */
function standardVersionLabel(standard: StandardListItem, version: StandardVersion): string {
  return `${standard.code} — version ${version.version_label}`;
}

/**
 * The categories the published listings name, each once, in the order the listings are read.
 *
 * There is no categories route in the contract, so the categories a listing can be placed in are the
 * ones the catalogue already carries. A row whose category id was not resolved is skipped: it names
 * no category a listing could be placed in.
 */
function categoryOptions(listings: readonly ListingSummary[]): Category[] {
  const seen = new Set<string>();
  const options: Category[] = [];
  for (const listing of listings) {
    const category = listing.category;
    if (category.id === "" || seen.has(category.id)) {
      continue;
    }
    seen.add(category.id);
    options.push(category);
  }
  return options;
}

/** How many challenges each listing has collected, counted over one read of the public board. */
function challengeCounts(challenges: readonly ChallengeListItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const challenge of challenges) {
    counts.set(challenge.listing_id, (counts.get(challenge.listing_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The state of one service read: in flight, failed, or the value it answered with.
 *
 * The three states are mutually exclusive rather than flags on one object, so a section that renders
 * a failed read cannot also render the value of an earlier one, and `loading` carries nothing that
 * could be mistaken for data.
 */
type ReadState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "ready"; readonly value: T };

/**
 * Runs one service read on mount and whenever its reload token changes, and keeps the state of that
 * read.
 *
 * The read is asked for in an effect rather than during a render, so no request is made by rendering
 * the page, and the cancelled flag is what keeps a reader from being shown a stale answer: a response
 * that arrives after a newer read was asked for — or after the page moved on — is discarded. Each
 * caller owns its own token, so re-reading one section never re-reads another, and a form's caller
 * bumps the token that covers what its write changed.
 *
 * **A re-read keeps the value already on screen.** Every write here re-reads what it changed, and a
 * write's own announcement lives inside the section it belongs to — a published version and a
 * recorded report are announced by the form that wrote them, and a refund by the ledger view that
 * appended it. Emptying the section while the re-read is in flight would unmount the form and destroy
 * the very notice that says the write happened, so a state that already holds a value keeps it until
 * the newer read replaces it. A read that has failed, or has never answered, has no value to keep and
 * states that it is reading.
 */
function useServiceRead<T>(read: () => Promise<T>, reloadToken: number): ReadState<T> {
  const [state, setState] = useState<ReadState<T>>({ kind: "loading" });

  useEffect((): (() => void) => {
    let cancelled = false;

    setState((previous: ReadState<T>): ReadState<T> =>
      previous.kind === "ready" ? previous : { kind: "loading" },
    );
    read().then(
      (value: T): void => {
        if (!cancelled) {
          setState({ kind: "ready", value });
        }
      },
      (error: unknown): void => {
        if (!cancelled) {
          setState({ kind: "failed", error });
        }
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [read, reloadToken]);

  return state;
}

/**
 * The value of a read that has answered, or `null` while it is in flight or has failed.
 *
 * A section that renders data rather than the state of the read asks this, so a value is never
 * rendered before it arrived and a failed read is never rendered as if it had answered with nothing.
 */
function readyValueOf<T>(state: ReadState<T>): T | null {
  return state.kind === "ready" ? state.value : null;
}


/** How the workspace reads the catalogue, said with the page size the contract fixes. */
const PAGING_NOTE =
  `The catalogue answers ${LISTING_PAGE_SIZE} listings at a time and reports how many it matched in ` +
  "total, so the workspace reads the pages that cover that total rather than one page of it.";

/** What a section states while the read it depends on is still in flight. */
const EVALUATION_WAITING_SENTENCE = "Reading this developer's versions…";
const STANDARDS_WAITING_SENTENCE = "Reading the published standard versions…";
const APPEAL_WAITING_SENTENCE = "Reading this developer's reports…";

/** The identifiers the page's headings and focus targets are addressed by. */
const CREATE_REGION_ID = "developer-create-region";
const PAGE_HEADING_ID = "developer-page-heading";
const LISTINGS_HEADING_ID = "developer-listings-heading";
const CREATE_HEADING_ID = "developer-create-heading";
const EVALUATION_HEADING_ID = "developer-evaluation-heading";
const APPEAL_HEADING_ID = "developer-appeal-heading";

/**
 * The `/developer` route: the developer's workspace for a developer account, the three ledgers and
 * the audit feed for the operator account, and an explanation for an account that holds neither role.
 *
 * The selected account is resolved on every render rather than held in state. The switcher in the
 * page header writes the selection, and this page follows it: a re-render with another account
 * carries another workspace half, and the halves are mounted rather than merely hidden because a
 * surface the account cannot use must not make its reads — the ledger and audit reads answer `403`
 * for every role but the operator's, and the developer half's catalogue walk is this page's own
 * derivation of "this developer's listings" rather than a read a buyer or contributor has any use
 * for. An account that holds neither role therefore performs no read at all and is told which
 * account the workspace belongs to.
 */
export function DeveloperPage(): JSX.Element {
  const account = findDemoAccount(getSelectedDemoAccountId());
  const isDeveloper = account !== null && account.role === "developer";
  const isOperator = account !== null && account.role === "operator";

  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` is what lets that link
    // move focus here without putting the landmark itself in the tab order.
    <main id="main-content" tabIndex={-1} className="page page-developer">
      <section aria-labelledby={PAGE_HEADING_ID}>
        <h1 id={PAGE_HEADING_ID}>{PAGE_HEADING}</h1>
        <p>{PAGE_SUMMARY}</p>
      </section>

      {account === null ? (
        <EmptyState
          heading={UNSELECTED_ACCOUNT_HEADING}
          explanation={UNSELECTED_ACCOUNT_EXPLANATION}
        />
      ) : null}

      {isDeveloper && account !== null ? <DeveloperWorkspace account={account} /> : null}

      {isOperator ? <OperatorSurfaces /> : null}

      {account !== null && !isDeveloper && !isOperator ? (
        <EmptyState heading={OTHER_ROLE_HEADING} explanation={otherRoleExplanation(account)} />
      ) : null}
    </main>
  );
}

/**
 * The developer half: this developer's listings, and the four writes a listing's owner makes.
 *
 * The section's reads are independent and each is re-read on its own token, so a refusal of one read
 * is explained and retried without touching the others: the listings and their details, the public
 * challenges board the counts come from — read as its most recent page, which is what the board
 * answers with — and the standards catalogue the evaluation form offers. A write re-reads the
 * listings, because a listing a write created, a version it published and a report it recorded are
 * all read from the service rather than added to this page's own copy of them.
 */
function DeveloperWorkspace(props: { readonly account: DemoAccount }): JSX.Element {
  const handle = props.account.handle;

  const [listingsToken, setListingsToken] = useState<number>(0);
  const [challengesToken, setChallengesToken] = useState<number>(0);
  const [standardsToken, setStandardsToken] = useState<number>(0);

  /**
   * The reports recorded in this session, which is what makes a report just written selectable in the
   * appeal form: the appeal's options are read from the linked evidence the listings carry, and a
   * report the listings do not link yet would otherwise be missing until the next read.
   */
  const [sessionReports, setSessionReports] = useState<readonly OwnedReport[]>([]);
  const createRegionRef = useRef<HTMLElement>(null);

  const readListings = useCallback(
    (): Promise<OwnedListingsRead> => readOwnedListings(handle),
    [handle],
  );
  const readChallenges = useCallback((): Promise<ChallengeListItem[]> => listChallenges(), []);
  const readStandards = useCallback((): Promise<StandardListItem[]> => listStandards(), []);

  const listings = useServiceRead(readListings, listingsToken);
  const challenges = useServiceRead(readChallenges, challengesToken);
  const standards = useServiceRead(readStandards, standardsToken);

  const reloadListings = useCallback((): void => {
    setListingsToken((previous: number): number => previous + 1);
  }, []);
  const reloadChallenges = useCallback((): void => {
    setChallengesToken((previous: number): number => previous + 1);
  }, []);
  const reloadStandards = useCallback((): void => {
    setStandardsToken((previous: number): number => previous + 1);
  }, []);

  const ownedListingsRead = readyValueOf(listings);
  const challengeRows = readyValueOf(challenges);
  const standardRows = readyValueOf(standards);

  const counts = useMemo(
    (): ReadonlyMap<string, number> | null =>
      challengeRows === null ? null : challengeCounts(challengeRows),
    [challengeRows],
  );

  /**
   * Whether the board read the counts were taken from covered the whole board.
   *
   * The public board answers one page of itself, so only a page that came back shorter than the
   * product's fixed page size says the board held nothing more; a page that came back exactly full
   * may have left older challenges uncounted, and the sentence states which of the two it is.
   */
  const boardComplete = challengeRows !== null && challengeRows.length < COLLECTION_PAGE_SIZE;

  const categories = useMemo(
    (): Category[] =>
      ownedListingsRead === null ? [] : categoryOptions(ownedListingsRead.catalogue),
    [ownedListingsRead],
  );

  const candidates = useMemo(
    (): CandidateVersionOption[] =>
      ownedListingsRead === null ? [] : candidateVersionOptions(ownedListingsRead.listings),
    [ownedListingsRead],
  );

  const standardOptions = useMemo(
    (): StandardVersionOption[] => (standardRows === null ? [] : standardVersionOptions(standardRows)),
    [standardRows],
  );

  /**
   * The reports the appeal form can name: the ones this developer's listings link, then the ones
   * recorded in this session that the listings do not link yet. Each appears once.
   */
  const appealableReports = useMemo(
    (): OwnedReport[] =>
      mergeReports(
        ownedListingsRead === null ? [] : linkedReportsOf(ownedListingsRead.listings),
        sessionReports,
      ),
    [ownedListingsRead, sessionReports],
  );

  /** A report was recorded: keep it for the appeal form, then read the listings again. */
  const handleEvaluated = useCallback(
    (report: EvaluationReportDetail): void => {
      setSessionReports((previous: readonly OwnedReport[]): readonly OwnedReport[] =>
        mergeReports(previous, [{ id: report.id, outcome: report.outcome, label: report.label }]),
      );
      reloadListings();
    },
    [reloadListings],
  );

  /** The no-listings state's one next step: move focus to the create form rather than leaving the state. */
  const focusCreateRegion = useCallback((): void => {
    createRegionRef.current?.focus();
  }, []);

  const listingsStatus =
    listings.kind === "loading"
      ? LISTINGS_LOADING_SENTENCE
      : ownedListingsRead === null
        ? null
        : describeListingCount(ownedListingsRead.listings.length);

  return (
    <>
      <section aria-labelledby={LISTINGS_HEADING_ID}>
        <h2 id={LISTINGS_HEADING_ID}>{LISTINGS_HEADING}</h2>
        <p>{LISTINGS_EXPLANATION}</p>
        <p>{PAGING_NOTE}</p>

        {/* One region, mounted with the page and never unmounted, so the sentence that replaces its
            content is announced: the workspace being read and the listings arriving are both status
            changes. */}
        <div className="status-region" role="status" aria-live="polite">
          {listingsStatus === null ? null : <p>{listingsStatus}</p>}
        </div>

        {listings.kind === "failed" ? (
          <ErrorNotice error={listings.error} onRetry={reloadListings} />
        ) : null}

        {/* The counts are one read, and a refusal of it omits the counts rather than failing the page:
            the listings themselves are read and rendered whether or not the board answered. */}
        {challenges.kind === "failed" ? (
          <p>
            {CHALLENGES_UNAVAILABLE_NOTE}{" "}
            <button type="button" className="button button--secondary" onClick={reloadChallenges}>
              Read the challenges board again
            </button>
          </p>
        ) : null}

        {ownedListingsRead !== null && ownedListingsRead.unreadableCount > 0 ? (
          <p>{describeUnreadableListings(ownedListingsRead.unreadableCount)}</p>
        ) : null}

        {ownedListingsRead === null ? null : ownedListingsRead.listings.length === 0 ? (
          <EmptyState
            heading={NO_LISTINGS_HEADING}
            explanation={NO_LISTINGS_EXPLANATION}
            action={
              <button type="button" className="button button--secondary" onClick={focusCreateRegion}>
                {CREATE_LISTING_ACTION_LABEL}
              </button>
            }
          />
        ) : (
          <ul className="item-list">
            {ownedListingsRead.listings.map(
              (entry: OwnedListing): JSX.Element => (
                <li key={entry.summary.id} className="item-list__item">
                  <ListingBlock
                    entry={entry}
                    challengeCount={
                      counts === null
                        ? null
                        : { count: counts.get(entry.summary.id) ?? 0, boardComplete }
                    }
                    onVersionPublished={reloadListings}
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      {/* The region the no-listings state's action focuses: `tabIndex={-1}` is what makes the section
          focusable by that action without adding a stop to the tab order. */}
      <section
        id={CREATE_REGION_ID}
        ref={createRegionRef}
        tabIndex={-1}
        aria-labelledby={CREATE_HEADING_ID}
      >
        <h2 id={CREATE_HEADING_ID}>{CREATE_HEADING}</h2>
        <CreateListingForm categories={categories} onCreated={reloadListings} />
      </section>

      <section aria-labelledby={EVALUATION_HEADING_ID}>
        <h2 id={EVALUATION_HEADING_ID}>{EVALUATION_HEADING}</h2>
        <p>{EVALUATION_EXPLANATION}</p>

        {/* One explanation at a time: a failed read of either the standards catalogue or this
            developer's versions replaces the form rather than leaving it offering options that were
            never read, and the form is mounted only once every option it offers has arrived. */}
        {standards.kind === "failed" ? (
          <ErrorNotice error={standards.error} onRetry={reloadStandards} />
        ) : listings.kind === "failed" ? (
          <ErrorNotice error={listings.error} onRetry={reloadListings} />
        ) : standards.kind === "loading" || listings.kind === "loading" ? (
          <p>{standards.kind === "loading" ? STANDARDS_WAITING_SENTENCE : EVALUATION_WAITING_SENTENCE}</p>
        ) : candidates.length === 0 ? (
          <EmptyState
            heading={NO_CANDIDATE_VERSIONS_HEADING}
            explanation={NO_CANDIDATE_VERSIONS_EXPLANATION}
            headingLevel={3}
          />
        ) : standardOptions.length === 0 ? (
          <EmptyState
            heading={NO_STANDARD_VERSIONS_HEADING}
            explanation={NO_STANDARD_VERSIONS_EXPLANATION}
            headingLevel={3}
          />
        ) : (
          <EvaluationForm
            candidates={candidates}
            standards={standardOptions}
            onEvaluated={handleEvaluated}
          />
        )}
      </section>

      <section aria-labelledby={APPEAL_HEADING_ID}>
        <h2 id={APPEAL_HEADING_ID}>{APPEAL_HEADING}</h2>
        <p>{APPEAL_EXPLANATION}</p>

        {/* The reports the form can name are read from this developer's listings, so a failed read of
            them is explained here rather than leaving the section reading for ever. */}
        {listings.kind === "failed" ? (
          <ErrorNotice error={listings.error} onRetry={reloadListings} />
        ) : listings.kind === "loading" ? (
          <p>{APPEAL_WAITING_SENTENCE}</p>
        ) : appealableReports.length === 0 ? (
          <EmptyState
            heading={NO_APPEALABLE_REPORT_HEADING}
            explanation={NO_APPEALABLE_REPORT_EXPLANATION}
            headingLevel={3}
          />
        ) : (
          <AppealForm reports={appealableReports} />
        )}
      </section>
    </>
  );
}


/** The status sentence a version publication whose own check refused the field announces. */
const UNREQUESTED_VERSION_STATUS = "The version was not published, and no request was sent.";

/** The claim one version makes, or `null` when that version makes none. */
function claimFor(detail: ListingDetail, versionId: string): ListingClaim | null {
  return (
    detail.claims.find((claim: ListingClaim): boolean => claim.listing_version_id === versionId) ??
    null
  );
}

/**
 * The evidence a listing's payload links, as the newest version's row renders it.
 *
 * The link's words say where it leads — a report recorded as a failure carries its per-case evidence
 * on the report page, which is what a reader needs beside it — and the outcome, the label and the
 * standard version are rendered exactly as the report recorded them rather than derived here.
 */
function LinkedEvidence(props: {
  readonly report: OwnedReport;
  readonly standardVersionId: string | null;
}): JSX.Element {
  const report = props.report;
  const measuredAgainst =
    props.standardVersionId === null
      ? ""
      : `, measured against the standard version ${props.standardVersionId}`;

  return (
    <p>
      <Link to={reportPath(report.id)}>
        {report.outcome === "FAIL" ? REPORT_LINK_FAIL_LABEL : REPORT_LINK_LABEL}
      </Link>
      {`. Recorded as `}
      <strong>{report.outcome}</strong>
      {` with the label `}
      <strong>{report.label}</strong>
      {`${measuredAgainst}. A report is a record of what was measured: it certifies nothing beyond the standard version's own scope.`}
    </p>
  );
}

/**
 * One of this developer's listings: what it is, its version history with the claim each version makes,
 * the evidence linked to its newest version, how many challenges it has collected, and the form that
 * publishes its next version.
 *
 * Every value rendered here comes from the listing's own payload — the version strings, the claims
 * with their stated limitations, the linked report and the challenge count — so the block states what
 * the listing published rather than what this page expects a listing to carry.
 */
function ListingBlock(props: {
  readonly entry: OwnedListing;
  readonly challengeCount: ChallengeCountReading | null;
  readonly onVersionPublished: () => void;
}): JSX.Element {
  const summary = props.entry.summary;
  const detail = props.entry.detail;
  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const versionsHeadingId = `${idPrefix}-versions`;
  const newestVersion = detail.versions[0] ?? null;
  const report = linkedReport(detail);

  return (
    <article aria-labelledby={titleId}>
      <h3 id={titleId}>
        <Link to={listingPath(summary.id)}>{summary.title}</Link>
      </h3>

      <p className="listing-card__meta">
        <span>{categoryLabel(summary.category)}</span>
        <span>{`Pricing model: ${describePricingModel(summary.pricing_model)}`}</span>
        <span>{`License: ${summary.license_code}`}</span>
        <span>{`Newest version: ${summary.version_string === "" ? NO_VERSIONS_NOTE : summary.version_string}`}</span>
      </p>

      {summary.limitation === null ? null : (
        <p>{`The latest claim states this limitation: ${summary.limitation}`}</p>
      )}

      <h4 id={versionsHeadingId}>{VERSIONS_HEADING}</h4>
      <p>{VERSIONS_EXPLANATION}</p>

      {/* The size of the history, from the payload's own total: the detail read answers one page of
          it, so the block states what the listing has published in all beside the page it carries.
          A listing that has published no version is stated by the note below rather than twice. */}
      {detail.versions.length === 0 ? null : (
        <p>{describeVersionTotal(detail.version_total, detail.versions.length)}</p>
      )}

      {detail.versions.length === 0 ? (
        <p>{NO_VERSIONS_NOTE}</p>
      ) : (
        <ul className="item-list">
          {detail.versions.map(
            (version: ListingVersion): JSX.Element => {
              const claim = claimFor(detail, version.id);
              const isNewest = newestVersion !== null && newestVersion.id === version.id;
              return (
                <li key={version.id} className="item-list__item">
                  <p>
                    <strong>{version.version_string}</strong>
                    {", recorded "}
                    <Timestamp value={version.created_at} />
                  </p>

                  {version.notes === "" ? null : (
                    <p>{`${VERSION_NOTES_LABEL}: ${version.notes}`}</p>
                  )}

                  {claim === null ? null : (
                    <>
                      <p>{`${CLAIM_LABEL}: ${claim.claim}`}</p>
                      <p>{`${LIMITATION_LABEL}: ${claim.limitation}`}</p>
                    </>
                  )}

                  {/* The listing payload links one report: the one measured against its newest
                      version. An earlier version is not claimed to have a report or to lack one,
                      because the payload states neither, and a report is read from its own link. */}
                  {isNewest ? (
                    report === null ? (
                      <p className="listing-card__no-report">{NO_REPORT_LABEL}</p>
                    ) : (
                      <LinkedEvidence report={report} standardVersionId={detail.standard_version_id} />
                    )
                  ) : null}
                </li>
              );
            },
          )}
        </ul>
      )}

      {props.challengeCount === null ? null : <p>{describeChallengeCount(props.challengeCount)}</p>}

      <h4>{PUBLISH_HEADING}</h4>
      <p>{PUBLISH_EXPLANATION}</p>
      <PublishVersionForm
        listingId={summary.id}
        listingTitle={summary.title}
        onPublished={props.onVersionPublished}
      />
    </article>
  );
}

/** The body a version publication sends: the version string, and notes only when some were written. */
function versionBody(versionString: string, notes: string): ListingVersionCreateBody {
  const trimmedNotes = notes.trim();
  return trimmedNotes === ""
    ? { version_string: versionString }
    : { version_string: versionString, notes: trimmedNotes };
}

/**
 * The form that publishes one version of one listing, and the explanation of whatever refused it.
 *
 * A version string this listing already published is the contract's `409` and is explained beside the
 * field as the duplicate it is rather than as an error trace, and every other refusal is either a
 * state the reader resolves by switching account or one the error notice explains in the service's
 * own words. A published version is announced politely and the workspace is read again, so the new
 * version appears in the history above because it was read from the service.
 */
function PublishVersionForm(props: {
  readonly listingId: string;
  readonly listingTitle: string;
  readonly onPublished: () => void;
}): JSX.Element {
  const idPrefix = useId();
  const versionFieldId = `${idPrefix}-version`;
  const versionHintId = `${idPrefix}-version-hint`;
  const versionErrorId = `${idPrefix}-version-error`;
  const notesFieldId = `${idPrefix}-notes`;
  const notesHintId = `${idPrefix}-notes-hint`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [versionString, setVersionString] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [localSentence, setLocalSentence] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [published, setPublished] = useState<ListingVersion | null>(null);

  const serviceReading = describeVersionFailure(failure);
  const reading = readingFor(localSentence, UNREQUESTED_VERSION_STATUS, serviceReading);
  const fieldSentence = fieldSentenceOf(reading);

  /** An edit to either field answers a refusal that was the field's own, and only that one. */
  const clearFieldRefusal = (): void => {
    if (localSentence !== null) {
      setLocalSentence(null);
    }
    if (serviceReading !== null && serviceReading.kind === "field") {
      setFailure(null);
    }
  };

  const handleVersionChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setVersionString(event.target.value);
    clearFieldRefusal();
  };

  const handleNotesChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setNotes(event.target.value);
    clearFieldRefusal();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    const trimmed = versionString.trim();
    if (trimmed === "") {
      setPublished(null);
      setFailure(null);
      setLocalSentence(BLANK_VERSION_SENTENCE);
      return;
    }

    setLocalSentence(null);
    setFailure(null);
    setPublished(null);
    setIsSubmitting(true);
    try {
      const created = await createVersion(props.listingId, versionBody(trimmed, notes));
      setVersionString("");
      setNotes("");
      setPublished(created);
      props.onPublished();
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className={fieldSentence === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={versionFieldId}>
          {VERSION_FIELD_LABEL}
        </label>
        <input
          id={versionFieldId}
          type="text"
          value={versionString}
          onChange={handleVersionChange}
          required
          autoComplete="off"
          spellCheck={false}
          aria-invalid={fieldSentence !== null}
          aria-describedby={fieldSentence === null ? versionHintId : `${versionErrorId} ${versionHintId}`}
        />
        <p className="field__hint" id={versionHintId}>
          {VERSION_FIELD_HINT}
        </p>
        {fieldSentence === null ? null : (
          <p className="field__error" id={versionErrorId}>
            {fieldSentence}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={notesFieldId}>
          {NOTES_FIELD_LABEL}
        </label>
        <textarea
          id={notesFieldId}
          rows={3}
          value={notes}
          onChange={handleNotesChange}
          autoComplete="off"
        />
        <p className="field__hint" id={notesHintId}>
          {NOTES_FIELD_HINT}
        </p>
      </div>

      {/* The listing's title names the version being published, so a reader working through several
          listings knows which one this control publishes into, and a screen reader announces it
          with the control rather than only from the heading above. */}
      <button
        type="submit"
        className="button button--primary"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        aria-describedby={isSubmitting ? submitHintId : undefined}
      >
        {`${PUBLISH_ACTION_LABEL} for ${props.listingTitle}`}
      </button>

      {isSubmitting ? (
        <p className="field__hint" id={submitHintId}>
          Publishing the version: this button is unavailable until the service answers.
        </p>
      ) : null}

      {/* The region is rendered with the form and only its content changes on submit, so the node
          exists before the status it announces does. The error notice holds a polite region of its
          own, so a refusal it explains is rendered beside this region rather than inside it. */}
      <div className="status-region" role="status" aria-live="polite">
        {published === null ? null : (
          <div className="notice notice--success">
            <p>{describePublishedVersion(published)}</p>
          </div>
        )}
        {reading !== null && reading.kind === "explained" ? (
          <ExplainedFailureNotice
            sentence={reading.sentence}
            variant={reading.variant}
            offersBrowse={reading.offersBrowse}
          />
        ) : null}
        {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
      </div>

      {reading !== null && reading.kind === "notice" ? (
        <FailedRequestNotice error={reading.error} detail={reading.detail} />
      ) : null}
    </form>
  );
}


/** The sentence the create form's status region announces when its own check refused a field. */
const CREATE_INCOMPLETE_SENTENCE =
  "The listing was not published, and no request was sent: every field below needs a value.";

/** The sentence beside each create field when it holds nothing. */
const BLANK_TITLE_SENTENCE = "Enter a title before publishing the listing.";
const BLANK_SUMMARY_SENTENCE = "Enter a one-paragraph summary before publishing the listing.";
const BLANK_CATEGORY_SENTENCE = "Choose the category the listing sits in.";
const BLANK_LICENSE_SENTENCE = "Enter the license code the listing is offered under.";

/** What the submit control states when no category exists to place a listing in. */
const NO_CATEGORY_SUBMIT_HINT =
  "A listing needs a category, and the catalogue named none, so this form cannot publish one yet.";

/** The create form's own field errors: one sentence per field, and `null` for a field that was accepted. */
interface CreateFieldErrors {
  readonly title: string | null;
  readonly summary: string | null;
  readonly category: string | null;
  readonly license: string | null;
}

/** No field errors: the state the form opens in and returns to after a field is edited. */
const NO_CREATE_FIELD_ERRORS: CreateFieldErrors = Object.freeze({
  title: null,
  summary: null,
  category: null,
  license: null,
});

/** Whether any field carries an error, which is what makes the form's own check the reading. */
function hasCreateFieldErrors(errors: CreateFieldErrors): boolean {
  return (
    errors.title !== null || errors.summary !== null || errors.category !== null || errors.license !== null
  );
}

/**
 * The form that publishes a listing, and the explanation of whatever refused it.
 *
 * The developer's identity comes from the demo account selected in the header rather than from a
 * field, and the service derives the listing's address token and its status, so neither is a field
 * here. The four blank-field checks are this form's own, because a value the reader can supply is
 * cheap to ask for before a request is sent; everything else the service decides is rendered from its
 * own refusal, and a `400` is explained by the error notice, which echoes the sentence naming the
 * parameter it did not accept.
 *
 * A refusal the service gave is deliberately left on screen while a field is edited: it names what
 * the service did not accept, and a reader correcting the field is reading it. Only the field's own
 * error is cleared by typing in it, and the next submission replaces the refusal either way.
 */
function CreateListingForm(props: {
  readonly categories: readonly Category[];
  readonly onCreated: () => void;
}): JSX.Element {
  const idPrefix = useId();
  const titleFieldId = `${idPrefix}-title`;
  const titleHintId = `${idPrefix}-title-hint`;
  const titleErrorId = `${idPrefix}-title-error`;
  const summaryFieldId = `${idPrefix}-summary`;
  const summaryHintId = `${idPrefix}-summary-hint`;
  const summaryErrorId = `${idPrefix}-summary-error`;
  const categoryFieldId = `${idPrefix}-category`;
  const categoryHintId = `${idPrefix}-category-hint`;
  const categoryErrorId = `${idPrefix}-category-error`;
  const licenseFieldId = `${idPrefix}-license`;
  const licenseHintId = `${idPrefix}-license-hint`;
  const licenseErrorId = `${idPrefix}-license-error`;
  const pricingFieldId = `${idPrefix}-pricing`;
  const pricingHintId = `${idPrefix}-pricing-hint`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [title, setTitle] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(null);
  const [licenseCode, setLicenseCode] = useState<string>("");
  const [pricingModel, setPricingModel] = useState<PricingModel>(PRICING_MODELS[0]);
  const [fieldErrors, setFieldErrors] = useState<CreateFieldErrors>(NO_CREATE_FIELD_ERRORS);
  const [failure, setFailure] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [created, setCreated] = useState<Listing | null>(null);

  const hasCategories = props.categories.length > 0;
  // The chosen category is resolved against the categories that are actually offered, so a category
  // that a re-read no longer carries cannot remain selected and be submitted as a stale identifier.
  const categoryId =
    props.categories.find((category: Category): boolean => category.id === chosenCategoryId)?.id ??
    props.categories[0]?.id ??
    "";

  const serviceReading = describeCreateFailure(failure);
  const reading: WriteFailureReading | null = hasCreateFieldErrors(fieldErrors)
    ? { kind: "explained", sentence: CREATE_INCOMPLETE_SENTENCE, variant: "notice--error", offersBrowse: false }
    : serviceReading;

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
    setFieldErrors((previous: CreateFieldErrors): CreateFieldErrors => ({ ...previous, title: null }));
  };

  const handleSummaryChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setSummary(event.target.value);
    setFieldErrors((previous: CreateFieldErrors): CreateFieldErrors => ({
      ...previous,
      summary: null,
    }));
  };

  const handleCategoryChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setChosenCategoryId(event.target.value);
    setFieldErrors((previous: CreateFieldErrors): CreateFieldErrors => ({
      ...previous,
      category: null,
    }));
  };

  const handleLicenseChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setLicenseCode(event.target.value);
    setFieldErrors((previous: CreateFieldErrors): CreateFieldErrors => ({
      ...previous,
      license: null,
    }));
  };

  const handlePricingChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    if (isPricingModel(value)) {
      setPricingModel(value);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const errors: CreateFieldErrors = {
      title: title.trim() === "" ? BLANK_TITLE_SENTENCE : null,
      summary: summary.trim() === "" ? BLANK_SUMMARY_SENTENCE : null,
      category: categoryId === "" ? BLANK_CATEGORY_SENTENCE : null,
      license: licenseCode.trim() === "" ? BLANK_LICENSE_SENTENCE : null,
    };
    if (hasCreateFieldErrors(errors)) {
      setCreated(null);
      setFailure(null);
      setFieldErrors(errors);
      return;
    }

    setFieldErrors(NO_CREATE_FIELD_ERRORS);
    setFailure(null);
    setCreated(null);
    setIsSubmitting(true);
    try {
      const listing = await createListing({
        title: title.trim(),
        summary: summary.trim(),
        category_id: categoryId,
        license_code: licenseCode.trim(),
        pricing_model: pricingModel,
      });
      setTitle("");
      setSummary("");
      setLicenseCode("");
      setCreated(listing);
      props.onCreated();
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className={fieldErrors.title === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={titleFieldId}>
          {TITLE_FIELD_LABEL}
        </label>
        <input
          id={titleFieldId}
          type="text"
          value={title}
          onChange={handleTitleChange}
          required
          autoComplete="off"
          aria-invalid={fieldErrors.title !== null}
          aria-describedby={
            fieldErrors.title === null ? titleHintId : `${titleErrorId} ${titleHintId}`
          }
        />
        <p className="field__hint" id={titleHintId}>
          {TITLE_FIELD_HINT}
        </p>
        {fieldErrors.title === null ? null : (
          <p className="field__error" id={titleErrorId}>
            {fieldErrors.title}
          </p>
        )}
      </div>

      <div className={fieldErrors.summary === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={summaryFieldId}>
          {SUMMARY_FIELD_LABEL}
        </label>
        <textarea
          id={summaryFieldId}
          rows={4}
          value={summary}
          onChange={handleSummaryChange}
          required
          autoComplete="off"
          aria-invalid={fieldErrors.summary !== null}
          aria-describedby={
            fieldErrors.summary === null ? summaryHintId : `${summaryErrorId} ${summaryHintId}`
          }
        />
        <p className="field__hint" id={summaryHintId}>
          {SUMMARY_FIELD_HINT}
        </p>
        {fieldErrors.summary === null ? null : (
          <p className="field__error" id={summaryErrorId}>
            {fieldErrors.summary}
          </p>
        )}
      </div>

      <div className={fieldErrors.category === null ? "field" : "field field--error"}>
        {/* A `label` element whose `for` names no control is a defect a browser reports, so the
            field's name is stated as text when there is nothing to offer. */}
        {hasCategories ? (
          <label className="field__label" htmlFor={categoryFieldId}>
            {CATEGORY_FIELD_LABEL}
          </label>
        ) : (
          <p className="field__label">{CATEGORY_FIELD_LABEL}</p>
        )}
        {/* The categories arrive with the published listings, so a catalogue that named none leaves
            the field with nothing to offer. The form states that in its own words rather than
            rendering a select with no options, and the submit control below says the same. */}
        {hasCategories ? (
          <select
            id={categoryFieldId}
            value={categoryId}
            onChange={handleCategoryChange}
            required
            aria-invalid={fieldErrors.category !== null}
            aria-describedby={
              fieldErrors.category === null ? categoryHintId : `${categoryErrorId} ${categoryHintId}`
            }
          >
            {props.categories.map(
              (category: Category): JSX.Element => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(category)}
                </option>
              ),
            )}
          </select>
        ) : (
          <p className="field__error">{NO_CATEGORIES_NOTE}</p>
        )}
        <p className="field__hint" id={categoryHintId}>
          {CATEGORY_FIELD_HINT}
        </p>
        {fieldErrors.category === null ? null : (
          <p className="field__error" id={categoryErrorId}>
            {fieldErrors.category}
          </p>
        )}
      </div>

      <div className={fieldErrors.license === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={licenseFieldId}>
          {LICENSE_FIELD_LABEL}
        </label>
        <input
          id={licenseFieldId}
          type="text"
          value={licenseCode}
          onChange={handleLicenseChange}
          required
          autoComplete="off"
          spellCheck={false}
          aria-invalid={fieldErrors.license !== null}
          aria-describedby={
            fieldErrors.license === null ? licenseHintId : `${licenseErrorId} ${licenseHintId}`
          }
        />
        <p className="field__hint" id={licenseHintId}>
          {LICENSE_FIELD_HINT}
        </p>
        {fieldErrors.license === null ? null : (
          <p className="field__error" id={licenseErrorId}>
            {fieldErrors.license}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={pricingFieldId}>
          {PRICING_FIELD_LABEL}
        </label>
        <select id={pricingFieldId} value={pricingModel} onChange={handlePricingChange} aria-describedby={pricingHintId}>
          {PRICING_MODELS.map(
            (model: PricingModel): JSX.Element => (
              <option key={model} value={model}>
                {describePricingModel(model)}
              </option>
            ),
          )}
        </select>
        <p className="field__hint" id={pricingHintId}>
          {PRICING_FIELD_HINT}
        </p>
      </div>

      <button
        type="submit"
        className="button button--primary"
        disabled={isSubmitting || !hasCategories}
        aria-busy={isSubmitting}
        aria-describedby={isSubmitting || !hasCategories ? submitHintId : undefined}
      >
        {CREATE_ACTION_LABEL}
      </button>

      {isSubmitting || !hasCategories ? (
        <p className="field__hint" id={submitHintId}>
          {isSubmitting
            ? "Publishing the listing: this button is unavailable until the service answers."
            : NO_CATEGORY_SUBMIT_HINT}
        </p>
      ) : null}

      <div className="status-region" role="status" aria-live="polite">
        {created === null ? null : (
          <div className="notice notice--success">
            <p>{describeCreatedListing(created)}</p>
            <p>
              <Link to={listingPath(created.id)}>Read the listing's public page</Link>
            </p>
          </div>
        )}
        {reading !== null && reading.kind === "explained" ? (
          <ExplainedFailureNotice
            sentence={reading.sentence}
            variant={reading.variant}
            offersBrowse={reading.offersBrowse}
          />
        ) : null}
        {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
      </div>

      {reading !== null && reading.kind === "notice" ? (
        <FailedRequestNotice error={reading.error} detail={reading.detail} />
      ) : null}
    </form>
  );
}


/**
 * The form that runs one evaluation, and the explanation of whatever refused it.
 *
 * The candidate version is chosen from this developer's own listings' versions, because the route
 * requires the selected developer to own the version it measures, and the standard version from the
 * published catalogue. The recorded outputs are the contract's own body field entered as one JSON
 * array: no route exposes the fixture case set and this workspace may not reach the fixture data, so a
 * per-case input list cannot exist, and the field's own check is a shape check rather than a
 * completeness check. A submission missing a case is refused by the service before any report is
 * written, and that refusal is rendered with the service's own sentence, which is the only thing in
 * the product that names the cases it did not receive.
 *
 * The body carries no retest field: the service derives the link to a prior report itself, which is
 * why this form states the report a run follows rather than offering anywhere to write it.
 */
function EvaluationForm(props: {
  readonly candidates: readonly CandidateVersionOption[];
  readonly standards: readonly StandardVersionOption[];
  readonly onEvaluated: (report: EvaluationReportDetail) => void;
}): JSX.Element {
  const idPrefix = useId();
  const candidateFieldId = `${idPrefix}-candidate`;
  const candidateHintId = `${idPrefix}-candidate-hint`;
  const standardFieldId = `${idPrefix}-standard`;
  const standardHintId = `${idPrefix}-standard-hint`;
  const outputsFieldId = `${idPrefix}-outputs`;
  const outputsHintId = `${idPrefix}-outputs-hint`;
  const outputsErrorId = `${idPrefix}-outputs-error`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [chosenCandidateId, setChosenCandidateId] = useState<string | null>(null);
  const [chosenStandardId, setChosenStandardId] = useState<string | null>(null);
  const [outputsText, setOutputsText] = useState<string>("");
  const [localSentence, setLocalSentence] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [created, setCreated] = useState<EvaluationReportDetail | null>(null);

  // Both selections are resolved against the options that are actually offered, so the first option
  // is selected until the reader chooses another and a re-read cannot leave a stale identifier
  // selected. The standard version defaults to the one published catalogue entry.
  const candidate =
    props.candidates.find(
      (option: CandidateVersionOption): boolean => option.versionId === chosenCandidateId,
    ) ??
    props.candidates[0] ??
    null;
  const standard =
    props.standards.find(
      (option: StandardVersionOption): boolean => option.versionId === chosenStandardId,
    ) ??
    props.standards[0] ??
    null;
  const totalCases = standard === null ? 0 : standard.totalCases;

  const serviceReading = describeEvaluationFailure(failure, totalCases);
  const reading = readingFor(localSentence, UNREQUESTED_EVALUATION_STATUS, serviceReading);
  const fieldSentence = fieldSentenceOf(reading);
  const canSubmit = candidate !== null && standard !== null && !isSubmitting;

  const handleOutputsChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setOutputsText(event.target.value);
    if (localSentence !== null) {
      setLocalSentence(null);
    }
    // A submission the service could not read as the required shape is the field's own problem, so
    // editing the field answers it; a missing case, an account or a rate limit stands until it is
    // resolved or sent again.
    if (serviceReading !== null && serviceReading.kind === "field") {
      setFailure(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || candidate === null || standard === null) {
      return;
    }

    const read = readOutputs(outputsText);
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
      const body: EvaluationSubmission = {
        candidate_version_id: candidate.versionId,
        standard_version_id: standard.versionId,
        recorded_outputs: read.outputs,
      };
      const report = await createEvaluation(body);
      setCreated(report);
      props.onEvaluated(report);
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={candidateFieldId}>
          {CANDIDATE_FIELD_LABEL}
        </label>
        <select
          id={candidateFieldId}
          value={candidate === null ? "" : candidate.versionId}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setChosenCandidateId(event.target.value)
          }
          aria-describedby={candidateHintId}
        >
          {props.candidates.map(
            (option: CandidateVersionOption): JSX.Element => (
              <option key={option.versionId} value={option.versionId}>
                {`${option.listingTitle} — ${option.versionString}`}
              </option>
            ),
          )}
        </select>
        <p className="field__hint" id={candidateHintId}>
          {CANDIDATE_FIELD_HINT}
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={standardFieldId}>
          {STANDARD_FIELD_LABEL}
        </label>
        <select
          id={standardFieldId}
          value={standard === null ? "" : standard.versionId}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setChosenStandardId(event.target.value)
          }
          aria-describedby={standardHintId}
        >
          {props.standards.map(
            (option: StandardVersionOption): JSX.Element => (
              <option key={option.versionId} value={option.versionId}>
                {option.label}
              </option>
            ),
          )}
        </select>
        <p className="field__hint" id={standardHintId}>
          {STANDARD_FIELD_HINT}
        </p>
      </div>

      <div className={fieldSentence === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={outputsFieldId}>
          {OUTPUTS_FIELD_LABEL}
        </label>
        {/* The submission is machine data, so it carries the monospaced input class and no spell
            check. The field holds no personal information and asks for none: a case identifier and
            the output recorded for it. */}
        <textarea
          id={outputsFieldId}
          rows={14}
          className="field__input--mono"
          value={outputsText}
          onChange={handleOutputsChange}
          required
          autoComplete="off"
          spellCheck={false}
          aria-invalid={fieldSentence !== null}
          aria-describedby={
            fieldSentence === null ? outputsHintId : `${outputsErrorId} ${outputsHintId}`
          }
        />
        <p className="field__hint" id={outputsHintId}>
          {describeOutputsHint(totalCases)}
        </p>
        {fieldSentence === null ? null : (
          <p className="field__error" id={outputsErrorId}>
            {fieldSentence}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="button button--primary"
        disabled={!canSubmit}
        aria-busy={isSubmitting}
        aria-describedby={isSubmitting ? submitHintId : undefined}
      >
        {EVALUATION_ACTION_LABEL}
      </button>

      {isSubmitting ? (
        <p className="field__hint" id={submitHintId}>
          Running the evaluation: this button is unavailable until the service answers.
        </p>
      ) : null}

      {/* The region is rendered with the form and only its content changes on submit, so the node
          exists before the status it announces does. */}
      <div className="status-region" role="status" aria-live="polite">
        {created === null ? null : (
          <div className="notice notice--success">
            <p>{describeCreatedReport(created)}</p>
            <p>
              <Link to={reportPath(created.id)}>Read the report, with its per-case evidence</Link>
            </p>
          </div>
        )}
        {reading !== null && reading.kind === "explained" ? (
          <ExplainedFailureNotice
            sentence={reading.sentence}
            variant={reading.variant}
            offersBrowse={reading.offersBrowse}
          />
        ) : null}
        {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
      </div>

      {/* An incomplete submission leaves the field valid — the shape was accepted and a case is
          missing — so its explanation is the error notice, which echoes the service's sentence naming
          the cases it did not receive. That notice holds a polite region of its own, so it is rendered
          beside the form's region rather than nested inside it. */}
      {reading !== null && reading.kind === "notice" ? (
        <FailedRequestNotice error={reading.error} detail={reading.detail} />
      ) : null}
    </form>
  );
}


/**
 * The form that opens an appeal against one report, and the explanation of whatever refused it.
 *
 * The report comes from the selection and the ground from the reason field; the appellant's identity
 * is the demo account selected in the header, so neither is a field. Opening an appeal is the only
 * action this form offers: ruling one is the operator's action, and its controls are mounted on
 * `/reports/:id` for the operator demo account, so this form offers none and its copy says where they
 * are rather than implying that an appeal cannot be decided here.
 */
function AppealForm(props: { readonly reports: readonly OwnedReport[] }): JSX.Element {
  const idPrefix = useId();
  const reportFieldId = `${idPrefix}-report`;
  const reportHintId = `${idPrefix}-report-hint`;
  const reasonFieldId = `${idPrefix}-reason`;
  const reasonHintId = `${idPrefix}-reason-hint`;
  const reasonErrorId = `${idPrefix}-reason-error`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [chosenReportId, setChosenReportId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [localSentence, setLocalSentence] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [opened, setOpened] = useState<Appeal | null>(null);

  // The selection is resolved against the reports actually offered, so a report a re-read no longer
  // links cannot remain selected and be appealed as a stale identifier.
  const report =
    props.reports.find((candidate: OwnedReport): boolean => candidate.id === chosenReportId) ??
    props.reports[0] ??
    null;

  const serviceReading = describeAppealFailure(failure);
  const reading = readingFor(localSentence, UNREQUESTED_APPEAL_STATUS, serviceReading);
  const fieldSentence = fieldSentenceOf(reading);
  const canSubmit = report !== null && !isSubmitting;

  const handleReasonChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setReason(event.target.value);
    if (localSentence !== null) {
      setLocalSentence(null);
    }
    // A reason the service refused is the field's own problem, so editing the field answers it; a
    // failure about the account, the report or the rate limit stands because typing cannot fix one.
    if (serviceReading !== null && serviceReading.kind === "field") {
      setFailure(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || report === null) {
      return;
    }
    if (reason.trim() === "") {
      setOpened(null);
      setFailure(null);
      setLocalSentence(BLANK_REASON_SENTENCE);
      return;
    }

    setLocalSentence(null);
    setFailure(null);
    setOpened(null);
    setIsSubmitting(true);
    try {
      const appeal = await openAppeal(report.id, { reason });
      setReason("");
      setOpened(appeal);
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={reportFieldId}>
          {APPEAL_REPORT_FIELD_LABEL}
        </label>
        <select
          id={reportFieldId}
          value={report === null ? "" : report.id}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setChosenReportId(event.target.value)
          }
          aria-describedby={reportHintId}
        >
          {props.reports.map(
            (candidate: OwnedReport): JSX.Element => (
              <option key={candidate.id} value={candidate.id}>
                {`${candidate.id} — outcome ${candidate.outcome}, label ${candidate.label}`}
              </option>
            ),
          )}
        </select>
        <p className="field__hint" id={reportHintId}>
          {APPEAL_REPORT_FIELD_HINT}
        </p>
      </div>

      <div className={fieldSentence === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={reasonFieldId}>
          {REASON_FIELD_LABEL}
        </label>
        {/* A free-text statement of why a report is contested has no autofill purpose, so this field
            declares none rather than claiming one it does not have. */}
        <textarea
          id={reasonFieldId}
          rows={5}
          value={reason}
          onChange={handleReasonChange}
          required
          autoComplete="off"
          aria-invalid={fieldSentence !== null}
          aria-describedby={
            fieldSentence === null ? reasonHintId : `${reasonErrorId} ${reasonHintId}`
          }
        />
        <p className="field__hint" id={reasonHintId}>
          {REASON_FIELD_HINT}
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
        disabled={!canSubmit}
        aria-busy={isSubmitting}
        aria-describedby={isSubmitting ? submitHintId : undefined}
      >
        {APPEAL_ACTION_LABEL}
      </button>

      {isSubmitting ? (
        <p className="field__hint" id={submitHintId}>
          Opening the appeal: this button is unavailable until the service answers.
        </p>
      ) : null}

      <div className="status-region" role="status" aria-live="polite">
        {opened === null ? null : (
          <div className="notice notice--success">
            <p>{describeOpenedAppeal(opened)}</p>
          </div>
        )}
        {reading !== null && reading.kind === "explained" ? (
          <ExplainedFailureNotice
            sentence={reading.sentence}
            variant={reading.variant}
            offersBrowse={reading.offersBrowse}
          />
        ) : null}
        {reading !== null && reading.kind === "field" ? <p>{reading.statusSentence}</p> : null}
      </div>

      {reading !== null && reading.kind === "notice" ? (
        <FailedRequestNotice error={reading.error} detail={reading.detail} />
      ) : null}
    </form>
  );
}



/** The identifiers the operator sections' headings are addressed by. */
const LEDGERS_HEADING_ID = "developer-ledgers-heading";
const AUDIT_HEADING_ID = "developer-audit-heading";

/**
 * The operator half of the page: the three append-only ledgers and the audit feed.
 *
 * Every read here is operator-only, which is why this half is mounted only for the operator account
 * and why the surface is not rendered for any other role at all: a read that would be refused is not
 * made. Each ledger is its own panel with its own read and its own reload token, so a refusal of one
 * is explained and retried without touching the others, and a refund re-reads every ledger and the
 * audit feed because the entries it appended belong to both.
 */
function OperatorSurfaces(): JSX.Element {
  const [ledgerToken, setLedgerToken] = useState<number>(0);
  const [auditToken, setAuditToken] = useState<number>(0);

  /**
   * A refund appended reversal entries: the ledgers are read again so the appended entries appear
   * after the entries they reverse, and the audit feed is read again because a refund is audited.
   *
   * Nothing is patched into this page's own copy of a ledger: the entries that appear are the ones
   * the service returned, in the order it returned them.
   */
  const handleRefunded = useCallback((): void => {
    setLedgerToken((previous: number): number => previous + 1);
    setAuditToken((previous: number): number => previous + 1);
  }, []);

  const reloadLedgers = useCallback((): void => {
    setLedgerToken((previous: number): number => previous + 1);
  }, []);

  const reloadAudit = useCallback((): void => {
    setAuditToken((previous: number): number => previous + 1);
  }, []);

  return (
    <>
      <section aria-labelledby={LEDGERS_HEADING_ID}>
        <h2 id={LEDGERS_HEADING_ID}>{OPERATOR_LEDGERS_HEADING}</h2>
        <p>{OPERATOR_LEDGERS_EXPLANATION}</p>

        {LEDGER_NAMES.map(
          (ledger: LedgerName): JSX.Element => (
            <LedgerPanel
              key={ledger}
              ledger={ledger}
              reloadToken={ledgerToken}
              onRetry={reloadLedgers}
              onRefunded={handleRefunded}
            />
          ),
        )}
      </section>

      <section aria-labelledby={AUDIT_HEADING_ID}>
        <h2 id={AUDIT_HEADING_ID}>{AUDIT_HEADING}</h2>
        <p>{AUDIT_EXPLANATION}</p>
        <AuditFeed reloadToken={auditToken} onRetry={reloadAudit} />
      </section>
    </>
  );
}

/**
 * One ledger: its read, and the view that renders whatever it answered with.
 *
 * The ledger's own size is stated above the view, from the read's `total`, because the read answers
 * one page of the ledger rather than the whole history and a page on its own cannot tell a short
 * ledger from a clipped one.
 *
 * A ledger with no entries is an ordinary state and is rendered as an explanation rather than as a
 * table with unexplained header rows, and a failed read is rendered as the explanation the error
 * notice carries with a retry control. A refusal for want of the operator role adds what the notice
 * cannot know — that these are the operator-only reads — so it never surfaces as a status code.
 */
function LedgerPanel(props: {
  readonly ledger: LedgerName;
  readonly reloadToken: number;
  readonly onRetry: () => void;
  readonly onRefunded: () => void;
}): JSX.Element {
  const ledger = props.ledger;
  const read = useCallback(
    (): Promise<LedgerReadResult | FounderAllocationLedgerReadResult> => listLedger(ledger),
    [ledger],
  );
  const state = useServiceRead(read, props.reloadToken);

  if (state.kind === "failed") {
    return (
      <ErrorNotice
        error={state.error}
        onRetry={props.onRetry}
        detail={isForbidden(state.error) ? <p>{OPERATOR_ROLE_DETAIL}</p> : null}
      />
    );
  }

  if (state.kind === "loading") {
    return <p className="ledger-table__note">{describeLedgerLoading(ledger)}</p>;
  }

  if (state.value.entries.length === 0) {
    // The empty state is rendered here rather than by the ledger view's own note, so that a ledger
    // with nothing in it is explained by the same component every other empty state uses; the
    // founder-allocation ledger's contract structure is stated in the section's own copy above, so it
    // is readable even where this view is replaced.
    return (
      <EmptyState
        heading={LEDGER_HEADINGS[ledger]}
        explanation={LEDGER_EMPTY_EXPLANATION}
        headingLevel={3}
      />
    );
  }

  // The result is handed to the ledger view exactly as it was read: nothing here re-sorts,
  // re-computes, aggregates or reformats an entry, and the refund control the view owns appends
  // through the service rather than editing anything this page holds. The ledger's own size is
  // stated beside the view, because the read answers one page of the ledger and that page is what
  // the view renders.
  return (
    <>
      <p className="ledger-table__note">
        {describeLedgerTotal(state.value.total, state.value.entries.length)}
      </p>
      <LedgerTable ledger={ledger} result={state.value} onRefunded={props.onRefunded} />
    </>
  );
}

/**
 * The audit feed: one read, and the table that renders whatever it answered with.
 *
 * The feed is what was *written*, and the page the read answers is in the order the events were
 * written — an append-only feed whose order is its meaning. Nothing here sorts, filters or re-keys
 * it: the rows rendered are the rows the read answered, and the page's own bound is stated in the
 * section's explanation and in the table's caption.
 */
function AuditFeed(props: {
  readonly reloadToken: number;
  readonly onRetry: () => void;
}): JSX.Element {
  const read = useCallback((): Promise<AuditEvent[]> => listAuditEvents(), []);
  const state = useServiceRead(read, props.reloadToken);

  if (state.kind === "failed") {
    return (
      <ErrorNotice
        error={state.error}
        onRetry={props.onRetry}
        detail={isForbidden(state.error) ? <p>{OPERATOR_ROLE_DETAIL}</p> : null}
      />
    );
  }

  if (state.kind === "loading") {
    return <p>{AUDIT_LOADING_SENTENCE}</p>;
  }

  if (state.value.length === 0) {
    return (
      <EmptyState heading={AUDIT_EMPTY_HEADING} explanation={AUDIT_EMPTY_EXPLANATION} headingLevel={3} />
    );
  }

  return <AuditTable events={state.value} />;
}

/**
 * The audit events as a table, in the order the read returned them.
 *
 * Five facts and two timestamps, the two instants rendered through the workspace's one reading of a
 * stored instant: the action is copied verbatim as the writing route recorded it rather than narrowed
 * to a vocabulary this page invents, and an event that recorded no reason states that it recorded
 * none instead of rendering a blank cell.
 */
function AuditTable(props: { readonly events: readonly AuditEvent[] }): JSX.Element {
  return (
    <div className="table__wrapper">
      <table className="table table--ledger table--dense">
        <caption>{AUDIT_TABLE_CAPTION}</caption>
        <thead>
          <tr>
            {AUDIT_COLUMNS.map(
              (column: string): JSX.Element => (
                <th key={column} scope="col">
                  {column}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {props.events.map(
            (event: AuditEvent): JSX.Element => (
              <tr key={event.id}>
                <td data-label={ACTOR_COLUMN_LABEL}>
                  <span className="table__identifier">{event.actor_account_id}</span>
                </td>
                <td data-label={ACTION_COLUMN_LABEL}>{event.action}</td>
                <td data-label={RESOURCE_TYPE_COLUMN_LABEL}>{event.resource_type}</td>
                <td data-label={RESOURCE_ID_COLUMN_LABEL}>
                  <span className="table__identifier">{event.resource_id}</span>
                </td>
                <td data-label={STATUS_COLUMN_LABEL}>{event.status_code}</td>
                <td data-label={REASON_COLUMN_LABEL}>
                  {event.reason === null ? <em>{NO_REASON_NOTE}</em> : event.reason}
                </td>
                <td data-label={RECORDED_COLUMN_LABEL}>
                  <Timestamp value={event.created_at} />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

// The default export is what the shell's route table imports for `/developer`, and the named export
// is what a reader of this module imports; both exist on purpose, as they do in ./not-found.
export default DeveloperPage;
