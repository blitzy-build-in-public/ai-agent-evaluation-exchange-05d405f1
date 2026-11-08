/**
 * The `/standards` page: the Standard Gate Index's catalogue, the version a reader has open with the
 * thresholds and the pass rule it publishes, and the proposals made against it with their review
 * status.
 *
 * It is the page a buyer reads to learn what a report was scored against, and the page a contributor
 * uses to propose a change and an operator uses to decide one. Nine decisions hold it together, and
 * each is one a later reader could invert.
 *
 * **The address is the selection.** Which standard and which version are open live in the
 * `standard` and `version` query parameters and nowhere else: no context provider, no shared state
 * module and no storage hold a second copy that could disagree with the address. A default is
 * *derived* when a parameter is absent — the catalogue's first standard and its first published
 * version — so the page opens on something real without the reader having written anything, and a
 * version a reader sends someone else is the same version that reader sees.
 *
 * **Two reads, both through `../api-client`.** `listStandards` answers the catalogue once, and
 * `getStandardVersion` answers the selected version whenever the selection changes. This file builds
 * no URL, sets no header and never calls `fetch`: the catalogue and the version are public reads, and
 * the write header belongs to the module that owns it. No data-fetching library exists in the closed
 * dependency inventory, so the two reads are effects with a cancelled flag each.
 *
 * **A version's numbers are never rendered under another version's label.** The version read stores
 * the pair of references it was made for, and a settled answer whose pair no longer matches the
 * selection renders as loading instead of as the number. The page states a pass rule and counts that
 * belong to one version, so a frame of the previous version's evidence under the new version's heading
 * would be exactly the kind of mistake this page exists to prevent.
 *
 * **The thresholds are versioned data, and this release's are provisional.** They are read from the
 * stored version row and rendered as the row states them, with the status shown as a word. Changing
 * them is not an edit: it is a new version, published through the proposal and review path, which is
 * why the page says so beside the numbers rather than leaving a reader to assume they are final. The
 * stored `definition_json` is deliberately not rendered: the row's columns are the criteria, and a
 * serialized copy presented as one would be a second authority for the same rule.
 *
 * **The rubric reference is text, never a link.** The service answers with the built application and
 * serves no documentation directory, so an address into the repository's documents would be answered
 * with this application's own shell rather than with the document it names. The reference and the path
 * it resolves to are therefore both named as text, and no link on this page leaves the product — every
 * link it renders is an internal route or an anchor within this page.
 *
 * **The proposals come from the catalogue read, narrowed defensively.** The contract names no
 * proposals route, so the proposals arrive with the catalogue, and the shape that carries them is the
 * client's normalised one rather than a field this page may assume. Every entry is therefore read
 * structurally and an entry whose status is outside the closed vocabulary is left out rather than
 * rendered as a word the product does not use.
 *
 * **A review moves a status and appends an event; it changes no criterion.** Accepting a proposal does
 * not publish a version, alter a threshold or alter a report — a change to a pass rule still has to be
 * proposed, reviewed and published as a new version in its own right. The control renders one action
 * per member of the review vocabulary, the reason is optional because the contract makes it optional,
 * and the control is rendered only for an operator account: a non-operator sees no review surface at
 * all rather than dead controls that refuse.
 *
 * **The decision is announced by this page, not by the control that made it.** A decided proposal
 * stops being `submitted`, so the control that decided it unmounts in the same update that re-reads
 * the catalogue — an announcement written by a component about to disappear is an announcement no one
 * hears. The page therefore owns the sentence, keyed to the standard it concerns so switching
 * standard cannot carry a stale message across, and the control owns only the refusals that leave it
 * on screen.
 *
 * **Presentation only.** No business rule, no outcome derivation, no label derivation, no arithmetic
 * and no persistence live here: every number, status and identifier is rendered as the service
 * returned it. Appearance belongs to the `.page`, `.standards-catalogue`, `.field*`, `.button*`,
 * `.item-list` and `.status-region` rules of the workspace stylesheet, and this file imports no
 * stylesheet, carries no inline style, reads no storage, cookie, environment value or configuration
 * of its own, and states the product's closed vocabulary through the constants that define it.
 */

import { useCallback, useEffect, useId, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BADGE_SCOPE,
  DEMO_AUTHENTICATION_LABEL,
  PROPOSAL_REVIEW_STATUSES,
  PROPOSAL_STATUSES,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
  STANDARD_STATUSES,
  SYNTHETIC_CURRENCY_LABEL,
  WRITE_RATE_LIMIT_MAX,
} from "@adem/shared";
import type {
  ProposalReviewStatus,
  ProposalStatus,
  StandardProposal,
  StandardProposalReviewBody,
  StandardStatus,
  StandardVersion,
} from "@adem/shared";

import { getSelectedDemoAccountId, getStandardVersion, listStandards, reviewProposal } from "../api-client";
import type { StandardListItem } from "../api-client";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { StandardsProposalForm } from "../components/standards-proposal-form";
import { findDemoAccount } from "../data/demo-accounts";

/**
 * The route this page is mounted at. It is spelled here rather than shared, because the page is its
 * only writer: the shell's route table owns the path itself, and this constant exists so the links
 * below can be built without a literal appearing three times.
 */
const STANDARDS_ROUTE = "/standards";

/** The query parameter naming the open standard, which is the standard's code or its identifier. */
const STANDARD_PARAM = "standard";

/** The query parameter naming the open version, which is the version's label or its identifier. */
const VERSION_PARAM = "version";

/**
 * The `id` of the catalogue region, which is also the anchor the absent-selection states link back
 * to. A page-internal anchor is the one kind of link this page may render that is not a route.
 */
const CATALOGUE_SECTION_ID = "catalogue";

/** The `id` of the proposal form's region, and the target of the empty proposal list's action. */
const PROPOSE_SECTION_ID = "propose";

/**
 * The in-repository document this release's rubric reference resolves to, named as text because the
 * service serves no documentation directory. The plan fixes the mapping between the reference a
 * version records (`SGI-SO-1.0.0#rubric`) and this path for the single standard this release
 * publishes, so the two are stated together rather than one being derived from the other.
 */
const RUBRIC_DOCUMENT_PATH = "docs/STANDARD-SGI-SO-1.0.0.md";

/** The page title, and the one sentence under it that says what the Standard Gate Index is. */
const PAGE_HEADING = "Standards and governance";
const PAGE_SUMMARY =
  "The Standard Gate Index is how recorded behaviour is measured and published here. A standard states what is measured, a version of it fixes the cases and the pass rule, and an evaluation reports what was found against them. Every threshold this release publishes is provisional, and a standard changes only when a new version of it is proposed, reviewed and published.";

/** The catalogue section's heading and the sentence that bounds what a standard is. */
const CATALOGUE_HEADING = "The standards catalogue";
const CATALOGUE_SUMMARY =
  "Each standard is a published rubric and nothing more: it certifies no implementation, states nothing about safety or security, and asserts no general capability. A version is addressed by an identifier that is never rewritten, and every version published under a standard is listed with it.";

/** The selected-version section's heading and the sentence that says what is being shown. */
const VERSION_HEADING = "The selected version";
const VERSION_SUMMARY =
  "What an evaluation is scored against for this version: the case set it measures, the pass rule it applies and the rubric a report cites. These values are stored with the version rather than decided when a candidate is scored, so two runs over one version cannot disagree.";

/** The heading of the paragraph that bounds what a measured outcome means. */
const PROVENANCE_HEADING = "The provenance of the selected version";

/** The proposals section's heading and the sentence that says what a proposal is and is not. */
const PROPOSALS_HEADING = "Proposals and their review status";
const PROPOSALS_SUMMARY =
  "A proposal argues for a change to a standard. Submitting one creates it awaiting review, and only an operator review moves it. A review records a decision and appends a governance event: it publishes no version and changes no criterion, so a change to a pass rule becomes real only by proposing, reviewing and publishing a new version.";

/** The proposal form's heading, the sentence above it, and the label of the read-again control. */
const PROPOSE_HEADING_PREFIX = "Propose a change to";
const PROPOSE_SUMMARY =
  "A proposal states what should change and why. It is created awaiting review, its text is never rewritten afterwards, and a decision on it is recorded as an appended governance event rather than as an edit to what was proposed.";

/** The control that reads the catalogue again, and the sentence that says why it is there. */
const RELOAD_CATALOGUE_LABEL = "Read the catalogue again";
const RELOAD_CATALOGUE_HINT =
  "A proposal submitted below, and a review decided above, are both read back from the service. The catalogue on screen is what the service answered when it was last read, so read it again to see a submission the service has just taken.";

/** The catalogue read in flight. It is the only content of the region while the first read runs. */
const LOADING_MESSAGE = "Reading the standards catalogue…";

/** What the region announces once a catalogue read has settled over rows the page holds. */
function describeLoadedCatalogue(count: number): string {
  if (count === 0) {
    return "The catalogue is loaded and publishes no standard yet.";
  }
  if (count === 1) {
    return "The catalogue is loaded with one standard.";
  }
  return `The catalogue is loaded with ${count} standards.`;
}

/**
 * The sentence the catalogue's region carries, or `null` when it should carry none.
 *
 * It is `null` in exactly two situations, and both matter. While a later read is in flight over rows
 * that are already on screen there is no state worth announcing, because nothing a reader can see is
 * about to change. And when the first read failed there is nothing to announce here either: the error
 * notice beside this region is the explanation, and a second, vaguer sentence would be the duplicate a
 * screen-reader user hears first.
 */
function describeCatalogueStatus(
  standards: readonly StandardListItem[] | null,
  isLoading: boolean,
): string | null {
  if (standards !== null) {
    return isLoading ? null : describeLoadedCatalogue(standards.length);
  }
  return isLoading ? LOADING_MESSAGE : null;
}

/** The words a version's status renders as, keyed by the closed vocabulary, never inferred. */
const STANDARD_STATUS_LABELS: Readonly<Record<StandardStatus, string>> = Object.freeze({
  provisional: "Provisional",
  active: "Active",
});

/**
 * What each status means for a reader, stated where the status is shown.
 *
 * `provisional` says outright that this release's thresholds are not final, because a reader who took
 * a provisional rule for a settled one would misread every report scored against it.
 */
const STANDARD_STATUS_SENTENCES: Readonly<Record<StandardStatus, string>> = Object.freeze({
  provisional:
    "These thresholds are provisional for this release. They are versioned with this standard version and are not presented as final: a later version may set different ones, and it does so by being published in its own right.",
  active:
    "These thresholds are published and active for this standard version, and they are what a report scored against it recorded.",
});

/** The words a proposal's status renders as, so a status is always read and never inferred from colour. */
const PROPOSAL_STATUS_LABELS: Readonly<Record<ProposalStatus, string>> = Object.freeze({
  submitted: "Submitted",
  accepted: "Accepted",
  rejected: "Rejected",
});

/** What each proposal status means, in one sentence, beside the status itself. */
const PROPOSAL_STATUS_SENTENCES: Readonly<Record<ProposalStatus, string>> = Object.freeze({
  submitted:
    "Awaiting review. An operator review is the only way this status moves, and deciding it records the decision as an appended governance event.",
  accepted:
    "An operator accepted this proposal. That moved this proposal's status and appended a governance event; it published no version and changed no criterion, so a change to a standard's thresholds still needs a new version.",
  rejected:
    "An operator rejected this proposal. The title and the rationale are kept exactly as they were submitted, so the reasoning the decision answered stays readable.",
});

/** What one review decision does, so each action states its own effect rather than sharing a hint. */
interface ReviewDecisionInfo {
  /** The action's own label, which is what a reader and a screen reader both act on. */
  readonly label: string;
  /** What the decision does, in one sentence a reader needs no glossary for. */
  readonly summary: string;
}

/**
 * The panel's copy for each review outcome, keyed by the review vocabulary so a renamed member fails
 * the build here rather than failing the route's enum validation at run time.
 *
 * Neither decision is described as rejecting-with-deletion or accepting-as-publication: the first
 * changes a status and the second changes a status, and both append an event. Copy that implied a
 * review published a version would misstate the governance path the product rests on.
 */
const REVIEW_DECISION_INFO: Readonly<Record<ProposalReviewStatus, ReviewDecisionInfo>> = Object.freeze({
  accepted: Object.freeze({
    label: "Accept the proposal",
    summary:
      "Moves this proposal to accepted and appends a governance event. It publishes no version and changes no threshold: a change to a standard becomes real only by proposing and publishing a new version.",
  }),
  rejected: Object.freeze({
    label: "Reject the proposal",
    summary:
      "Moves this proposal to rejected and appends a governance event. The proposal and its reasoning stay readable as they were submitted, and nothing is deleted.",
  }),
});

/** The reason field's label and the hint that says what a blank field means. */
const REVIEW_REASON_LABEL = "Reason (optional)";
const REVIEW_REASON_HINT =
  "This field may be left blank: a review is not obliged to give a reason. Whatever is written here is recorded with the governance event the decision appends, and that event is never edited.";

/** The group label over the two decisions. */
const REVIEW_DECISION_LEGEND = "Review decision";

/** What the review panel says before anything has been submitted. */
const REVIEW_DECISION_SUMMARY =
  "One decision per proposal. Each appends a governance event and is recorded against the account the switcher has selected.";

/** Shown beside the controls while a decision is in flight, and after one the service applied. */
const REVIEW_SUBMITTING_HINT = "Recording the decision; the actions are unavailable until the service answers.";
const REVIEW_DECIDED_HINT =
  "The decision was recorded. The proposal list is being read again, so the status shown above is about to be the one the service holds.";

/** The sentence the page announces after a decision the service applied. */
function describeDecision(proposalId: string, status: ProposalReviewStatus): string {
  return `Proposal ${proposalId} is now ${status}: the review moved its status and appended a governance event. The catalogue has been read again, so the status shown is the one the service holds.`;
}

/** The sentence the page announces after a proposal it was shown had already been decided. */
function describeAlreadyDecided(proposalId: string): string {
  return `Proposal ${proposalId} had already been decided, so nothing was changed. The catalogue has been read again, so the status shown is the one the service holds.`;
}

/** The sentence the page announces after a review of a proposal the service does not hold. */
function describeNotHeld(proposalId: string): string {
  return `Proposal ${proposalId} is not one the service holds, so nothing was changed. The catalogue has been read again to show the proposals it does hold.`;
}

/** `401`: no demo account is selected, so no request leaves the browser. */
const NO_DEMO_ACCOUNT_REFUSAL = `No demo account is selected, so the decision was not sent. Choose an account in the demo-account switcher above, then decide again — the switcher sets the role a write acts as for this demonstration (${DEMO_AUTHENTICATION_LABEL}), and it is not a sign-in.`;

/** `403`: the selected account's role is not the one the review route requires. */
const NOT_OPERATOR_REFUSAL =
  "The selected demo account is not an operator, so the decision was not sent. Reviewing a proposal needs the operator role: switch to the operator demo account above, then decide again.";

/** `400`: the service refused the review as it was sent. */
const REFUSED_REVIEW_REFUSAL =
  "The service refused the decision as it was sent, so nothing was changed. Reload the page, then decide again.";

/** No response was received at all. */
const TRANSPORT_REFUSAL =
  "The service could not be reached, so the decision was not sent, and nothing was changed. Check that the app is running, then decide again.";

/** Any other refusal, a server fault included: general, and never a status or a code. */
const UNEXPECTED_REFUSAL =
  "The decision could not be recorded. Try again, and report it if the failure keeps happening.";

/**
 * The sentence a throttled decision is refused with: the limit the contract fixes and the wait the
 * response asked for, never a bare status and never a delay of this page's own.
 */
function describeThrottledReview(retryAfterSeconds: number | null): string {
  const limit = `This client has sent the maximum number of writes allowed in a minute (${WRITE_RATE_LIMIT_MAX}).`;
  if (retryAfterSeconds === null || retryAfterSeconds < 1) {
    return `${limit} Wait a moment, then decide again.`;
  }
  const seconds = Math.ceil(retryAfterSeconds);
  return seconds === 1
    ? `${limit} Try again in 1 second.`
    : `${limit} Try again in ${seconds} seconds.`;
}

/** The heading and explanation of the catalogue's empty state: no standard is published yet. */
const EMPTY_CATALOGUE_HEADING = "No standard is published yet";
const EMPTY_CATALOGUE_EXPLANATION =
  "The catalogue holds no standard, so there is no version to read and no proposal to show. A standard appears here when it is published, with a first version carrying the cases and the pass rule an evaluation is scored against.";

/** The heading and explanation of the proposal list's empty state, with its way to the form. */
const EMPTY_PROPOSALS_HEADING = "No proposals yet";
const EMPTY_PROPOSALS_EXPLANATION =
  "No proposal has been made against this standard. Any contributor demo account may submit one in the form below; it is created awaiting review, and only an operator review moves it.";
const EMPTY_PROPOSALS_ACTION_LABEL = "Go to the proposal form";

/** The sentence the version section shows while the catalogue read is in flight, or after it failed. */
const VERSION_AWAITING_CATALOGUE =
  "The selected version is read from the catalogue, because it is the catalogue that states which versions a standard publishes. It appears here once that read has settled; if the read failed, the notice above says what it reported and offers to send it again.";

/** The sentence the version section shows when the catalogue answered with no standard at all. */
const VERSION_WITHOUT_CATALOGUE =
  "The catalogue holds no standard, so there is no version to read, no threshold to show and no rubric reference to cite. A standard appears here when it is published, with a first version carrying its cases and its pass rule.";

/** The heading and explanation of a selection naming a standard the catalogue does not hold. */
const UNKNOWN_STANDARD_HEADING = "That standard is not in the catalogue";
const SHOW_CATALOGUE_LABEL = "Show the catalogue";

/**
 * The heading and explanation of a selection naming a version the open standard does not publish,
 * and of a standard that publishes no version at all.
 */
const UNKNOWN_VERSION_HEADING = "That version is not published under this standard";
const NO_VERSION_HEADING = "This standard publishes no version yet";
const MISSING_VERSION_HEADING = "That version could not be read";

/** The heading of the rubric paragraph, and of the paragraph about what a report carries. */
const RUBRIC_HEADING = "The rubric this version cites";
const REPORT_MEANING_HEADING = "What a report against this version carries";

/**
 * Whether a value is a JSON object rather than an array, `null` or a primitive. Every value read off a
 * payload goes through it, so a shape of any other kind is handled rather than assumed.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value as a non-blank string, or `null` when it is absent, blank or not a string. */
function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() === "" ? null : value;
}

/** A value as a string, and the empty string when it is not one — for a field the page may render blank. */
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A value as a whole, non-negative number, or `null`.
 *
 * The four counts a version publishes are rendered as they arrive, so a value that is a fraction, a
 * negative or not a number at all is refused here rather than printed as a threshold no report could
 * have been scored against.
 */
function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A finite number, for the status and the wait a refused call carries. */
function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A value as a member of a closed vocabulary, or `null` when it names no member of it. */
function readMember<T extends string>(value: unknown, vocabulary: readonly T[]): T | null {
  return typeof value === "string" && (vocabulary as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** A value as a member of the standard-status vocabulary. */
function readStandardStatus(value: unknown): StandardStatus | null {
  return readMember(value, STANDARD_STATUSES);
}

/**
 * One version as the page renders it, or `null` when an entry cannot be rendered in full.
 *
 * The fields are read structurally rather than taken on trust, because the shape that carries a
 * version is the API client's normalised one: an entry this page could not address or could not state
 * a threshold for is left out rather than rendered with blanks, since the whole of what this section
 * does is state exactly these numbers.
 */
function narrowVersion(value: unknown): StandardVersion | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value["id"]);
  const standardId = readText(value["standard_id"]);
  const versionLabel = readText(value["version_label"]);
  const status = readStandardStatus(value["status"]);
  const totalCases = readCount(value["total_cases"]);
  const criticalCases = readCount(value["critical_cases"]);
  const passThresholdMatches = readCount(value["pass_threshold_matches"]);
  const criticalFailuresAllowed = readCount(value["critical_failures_allowed"]);
  const rubricReference = readText(value["rubric_reference"]);
  const publishedAt = readText(value["published_at"]);
  if (
    id === null ||
    standardId === null ||
    versionLabel === null ||
    status === null ||
    totalCases === null ||
    criticalCases === null ||
    passThresholdMatches === null ||
    criticalFailuresAllowed === null ||
    rubricReference === null ||
    publishedAt === null
  ) {
    return null;
  }
  return {
    id,
    standard_id: standardId,
    version_label: versionLabel,
    status,
    total_cases: totalCases,
    critical_cases: criticalCases,
    pass_threshold_matches: passThresholdMatches,
    critical_failures_allowed: criticalFailuresAllowed,
    rubric_reference: rubricReference,
    definition_json: readString(value["definition_json"]),
    published_at: publishedAt,
  };
}

/** The versions a standard's row carries, in the order the read returned them, entries narrowed. */
function narrowVersions(value: unknown): readonly StandardVersion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const versions: StandardVersion[] = [];
  for (const entry of value) {
    const version = narrowVersion(entry);
    if (version !== null) {
      versions.push(version);
    }
  }
  return versions;
}

/**
 * One proposal as the page renders it, or `null` when an entry cannot be rendered.
 *
 * An entry whose `status` is outside {@link PROPOSAL_STATUSES} is dropped rather than shown under a
 * word the product does not use: the status is what the review trail is read from, and a status
 * invented on the page would state a decision the service never recorded.
 */
function narrowProposal(value: unknown): StandardProposal | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value["id"]);
  const standardId = readText(value["standard_id"]);
  const proposerAccountId = readText(value["proposer_account_id"]);
  const title = readText(value["title"]);
  const rationale = readText(value["rationale"]);
  const status = readMember(value["status"], PROPOSAL_STATUSES);
  const createdAt = readText(value["created_at"]);
  if (
    id === null ||
    standardId === null ||
    proposerAccountId === null ||
    title === null ||
    rationale === null ||
    status === null ||
    createdAt === null
  ) {
    return null;
  }
  return {
    id,
    standard_id: standardId,
    proposer_account_id: proposerAccountId,
    title,
    rationale,
    status,
    created_at: createdAt,
  };
}

/** The proposals a standard's row carries, in the order the read returned them, entries narrowed. */
function narrowProposals(value: unknown): readonly StandardProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const proposals: StandardProposal[] = [];
  for (const entry of value) {
    const proposal = narrowProposal(entry);
    if (proposal !== null) {
      proposals.push(proposal);
    }
  }
  return proposals;
}

/**
 * The catalogue as the page renders it: every standard whose code and identifier can be addressed,
 * each with its own versions and proposals narrowed in turn.
 *
 * A row without a code or an identifier is dropped, because a standard the page cannot link to or ask
 * the service about cannot be read at all, while a row whose summary is blank is kept and simply
 * renders without one.
 */
function narrowStandards(value: unknown): readonly StandardListItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const standards: StandardListItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = readText(entry["id"]);
    const code = readText(entry["code"]);
    const title = readText(entry["title"]);
    if (id === null || code === null || title === null) {
      continue;
    }
    standards.push({
      id,
      code,
      title,
      summary: readString(entry["summary"]),
      versions: narrowVersions(entry["versions"]),
      proposals: narrowProposals(entry["proposals"]),
    });
  }
  return standards;
}

/**
 * The reference a standard is addressed by: its code, which is the identifier people quote, and its
 * row identifier only when the row carries no code.
 *
 * Both are accepted by the route, so either would answer; the code is preferred because it is the
 * stable published reference and the identifier is the storage detail.
 */
function standardReference(standard: StandardListItem): string {
  const code = standard.code.trim();
  return code === "" ? standard.id.trim() : code;
}

/**
 * The reference a version is addressed by: its published label, and its row identifier only when the
 * row carries no label.
 *
 * The label is what a report cites in its rubric reference and what a reader can compare across two
 * versions, so it is the one the address carries.
 */
function versionReference(version: StandardVersion): string {
  const label = version.version_label.trim();
  return label === "" ? version.id.trim() : label;
}

/** A query parameter as a non-blank value, or `null` when it is absent, blank or repeated away. */
function readParam(params: URLSearchParams, name: string): string | null {
  const raw = params.get(name);
  if (raw === null) {
    return null;
  }
  const value = raw.trim();
  return value === "" ? null : value;
}

/**
 * The address that opens one standard's one version.
 *
 * The standard is written explicitly, because choosing a standard also chooses a version: a link that
 * carried only the standard would answer with whichever version the previous standard's selection
 * named, which is a version of a different standard and therefore an address that reports a version
 * as missing when the reader only asked for a standard.
 */
function selectionPath(params: URLSearchParams, standardRef: string, versionRef: string): string {
  const next = new URLSearchParams(params);
  next.set(STANDARD_PARAM, standardRef);
  if (versionRef === "") {
    next.delete(VERSION_PARAM);
  } else {
    next.set(VERSION_PARAM, versionRef);
  }
  return `${STANDARDS_ROUTE}?${next.toString()}`;
}

/** The address that opens another version of the standard already open, rewriting only that parameter. */
function versionSelectionPath(params: URLSearchParams, versionRef: string): string {
  const next = new URLSearchParams(params);
  next.set(VERSION_PARAM, versionRef);
  return `${STANDARDS_ROUTE}?${next.toString()}`;
}

/** The address of the catalogue itself, which every absent-selection state offers as its way back. */
function cataloguePath(): string {
  return `${STANDARDS_ROUTE}#${CATALOGUE_SECTION_ID}`;
}

/** The standard the catalogue read holds for a reference, or `null` when none carries it. */
function findStandard(
  standards: readonly StandardListItem[],
  reference: string,
): StandardListItem | null {
  return (
    standards.find(
      (standard: StandardListItem): boolean =>
        standard.code === reference || standard.id === reference,
    ) ?? null
  );
}

/** The version a standard publishes for a reference, or `null` when none carries it. */
function findVersion(standard: StandardListItem, reference: string): StandardVersion | null {
  return (
    standard.versions.find(
      (version: StandardVersion): boolean =>
        version.version_label === reference || version.id === reference,
    ) ?? null
  );
}

/** The first standard of the catalogue, which is the default selection when the address names none. */
function firstStandard(standards: readonly StandardListItem[]): StandardListItem | null {
  return standards.length === 0 ? null : (standards[0] ?? null);
}

/** The first version a standard publishes, which is the default when the address names none. */
function firstVersion(standard: StandardListItem): StandardVersion | null {
  return standard.versions.length === 0 ? null : (standard.versions[0] ?? null);
}

/**
 * The selection the address and the catalogue together resolve to.
 *
 * A discriminated union rather than one shape with nullable members, because the states differ in
 * what the page owes a reader: one is a version to render, three are explanations naming the value
 * that could not be resolved and offering the way back, and one is the ordinary state of a standard
 * that has not published a version yet.
 */
type Selection =
  | {
      /** The catalogue read has not settled, so nothing can be resolved yet. */
      readonly kind: "loading";
    }
  | {
      /** The catalogue settled and holds no standard. */
      readonly kind: "empty";
    }
  | {
      /** The address names a standard the catalogue does not hold. */
      readonly kind: "unknown-standard";
      readonly asked: string;
    }
  | {
      /** The standard publishes no version, and the address asked for none by name. */
      readonly kind: "no-version";
      readonly standard: StandardListItem;
    }
  | {
      /** The address names a version the open standard does not publish. */
      readonly kind: "unknown-version";
      readonly standard: StandardListItem;
      readonly asked: string;
    }
  | {
      /** A standard and one of its versions, both resolved: the state the page reads a version for. */
      readonly kind: "ready";
      readonly standard: StandardListItem;
      readonly version: StandardVersion;
      readonly standardRef: string;
      readonly versionRef: string;
    };

/**
 * Resolve the open standard and version from the address and the catalogue.
 *
 * The address is read first and the catalogue second, and neither is stored: a parameter that names
 * something real selects it, a parameter that names nothing is reported as unknown rather than
 * silently replaced by the default, and only an absent parameter falls back to the catalogue's first
 * standard and its first published version.
 */
function resolveSelection(
  standards: readonly StandardListItem[] | null,
  requestedStandard: string | null,
  requestedVersion: string | null,
): Selection {
  if (standards === null) {
    return { kind: "loading" };
  }
  if (standards.length === 0) {
    return { kind: "empty" };
  }

  const standard =
    requestedStandard === null ? firstStandard(standards) : findStandard(standards, requestedStandard);
  if (standard === null) {
    return { kind: "unknown-standard", asked: requestedStandard ?? "" };
  }

  const version = requestedVersion === null ? firstVersion(standard) : findVersion(standard, requestedVersion);
  if (version === null) {
    if (requestedVersion === null) {
      return { kind: "no-version", standard };
    }
    return { kind: "unknown-version", standard, asked: requestedVersion };
  }

  return {
    kind: "ready",
    standard,
    version,
    standardRef: standardReference(standard),
    versionRef: versionReference(version),
  };
}

/**
 * The pass rule of one version, in one sentence a reader needs no glossary for.
 *
 * It is built from the version's own numbers rather than from a rule written here, so a version whose
 * thresholds differ explains its own rule, and the counts a reader compares are the counts it states.
 * A version that publishes no case is stated as unscorable rather than as a rule over zero cases.
 */
function describePassRule(version: StandardVersion): string {
  const total = version.total_cases;
  if (total <= 0) {
    return "This version publishes no fixture case, so no candidate could be scored against it: the pass rule has nothing to apply to.";
  }
  const matches = `at least ${version.pass_threshold_matches} of the ${total} cases match`;
  const critical =
    version.critical_failures_allowed === 0
      ? "no critical case fails"
      : version.critical_failures_allowed === 1
        ? "no more than one critical case fails"
        : `no more than ${version.critical_failures_allowed} critical cases fail`;
  return `A candidate passes when ${matches} and ${critical}; anything else is a failure.`;
}

/**
 * The sentence that bounds what a measured outcome means: the label vocabulary, the badge and its
 * scope, and the boundary between evidence and certification.
 *
 * Every closed-vocabulary word is rendered from the constant that defines it, so this page cannot
 * drift from the badge, the report or the documentation by paraphrase, and the badge's scope is
 * stated as the whole of what a badge covers rather than as one property among several.
 */
function describeReportMeaning(): string {
  return `A report scored against a version carries exactly one of two labels: ${REPORT_LABEL_SAMPLE} for a version seeded as a fixture candidate, and ${REPORT_LABEL_VERIFIED_IN_DEMO} for a version published through the API. A badge is issued on a pass alone; it names the standard version the report was scored against, the report's identifier and the scope "${BADGE_SCOPE}", and that scope is the whole of what it covers. Nothing here is independent certification, and nothing here states or implies general safety or certified security.`;
}

/**
 * The sentence that keeps trust separation visible where a reader has just read the pass rule.
 *
 * It states the two things a buyer could otherwise only assume: that nothing commercial reaches a
 * measurement, and that paying for an evaluation cannot advance a candidate. Both are properties of the
 * design rather than promises about it, and each names what it is about — the fee's ledger, a
 * sponsorship's order, and the evidence a result follows from.
 */
function describeTrustSeparation(): string {
  return `An outcome rests on the recorded evidence alone, and buying an evaluation never guarantees a pass. Nothing commercial reaches a measurement: a gate-evaluation fee is recorded in its own ledger in the synthetic currency ${SYNTHETIC_CURRENCY_LABEL} and never affects a report, a badge, or a listing's place in search, and a sponsorship never affects an outcome either.`;
}

/**
 * The catalogue read, and the state of the read that produced it.
 *
 * `null` rows are the absence of any answer, which is what separates the first read — the only one
 * that shows a loading state — from every later read, which keeps what is already on screen.
 */
interface CatalogueRead {
  /** The standards the service answered, or `null` before any read has settled. */
  readonly standards: readonly StandardListItem[] | null;
  /** Whether a read is in flight. */
  readonly isLoading: boolean;
  /** The value a failed read threw, or `null`. */
  readonly failure: unknown;
}

/**
 * The version read, keyed by the pair of references it was made for.
 *
 * The key is not bookkeeping: it is what stops a settled answer for one version being rendered under
 * the heading of another, which would state one version's pass rule as another's.
 */
type VersionRead =
  | { readonly status: "loading"; readonly key: string }
  | { readonly status: "ready"; readonly key: string; readonly version: StandardVersion }
  | { readonly status: "missing"; readonly key: string }
  | { readonly status: "failed"; readonly key: string; readonly failure: unknown };

/** The key one version read is stored and compared by. */
function versionReadKey(standardRef: string, versionRef: string): string {
  return `${standardRef}\u0000${versionRef}`;
}

/** The HTTP status a raised value carries, or `null` — read for the read failure's `404` alone. */
function statusOf(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  return readNumber(error["status"]);
}

/**
 * What the review panel shows for one refused decision.
 *
 * A discriminated union rather than one shape with a nullable sentence, because the two readings are
 * handled by different surfaces: a refusal that leaves the proposal decidable is rendered by this
 * control's own region, while a refusal that says the list on screen is out of date is announced by the
 * page together with the re-read it asks for, so the reader is told what happened exactly once.
 */
type ReviewRefusal =
  | {
      /** A refusal this control explains beside the actions, which stay available. */
      readonly kind: "explained";
      readonly sentence: string;
    }
  | {
      /** A refusal that the page's region announces, because the list on screen is out of date. */
      readonly kind: "stale";
      readonly sentence: string;
    };

/**
 * A named property of a raised value as a finite number, or `null`.
 *
 * The wait a throttled response states is read this way rather than off the client's own error type:
 * the value crossed one module boundary, and a property renamed there would otherwise fail here as a
 * missing number rather than as a build error.
 */
function readNumberOf(error: unknown, key: string): number | null {
  if (!isRecord(error)) {
    return null;
  }
  return readNumber(error[key]);
}

/**
 * What the panel shows for one refused call, by status.
 *
 * Every branch names what happened and what the reader can do next, and none of them renders a status
 * code, a response body or a stack: a refusal is an explanation here, not a trace. Two statuses are
 * read as the service saying the proposal on screen has moved on — `409`, the contract's conflict for
 * a proposal that already holds a terminal status, and `404`, a proposal the service does not hold —
 * and for those the page announces the sentence and reads the catalogue again, because offering a
 * retry for a decision that cannot succeed would be the one thing this surface must not do.
 */
function describeReviewRefusal(error: unknown, proposalId: string): ReviewRefusal {
  const status = statusOf(error);
  if (status === null) {
    return { kind: "explained", sentence: UNEXPECTED_REFUSAL };
  }
  switch (status) {
    case 400:
      return { kind: "explained", sentence: REFUSED_REVIEW_REFUSAL };
    case 401:
      return { kind: "explained", sentence: NO_DEMO_ACCOUNT_REFUSAL };
    case 403:
      return { kind: "explained", sentence: NOT_OPERATOR_REFUSAL };
    case 404:
      return { kind: "stale", sentence: describeNotHeld(proposalId) };
    case 409:
      return { kind: "stale", sentence: describeAlreadyDecided(proposalId) };
    case 429:
      return {
        kind: "explained",
        sentence: describeThrottledReview(readNumberOf(error, "retryAfterSeconds")),
      };
    case 0:
      // No response arrived at all, which the client reports as this status and which is a state of its
      // own rather than a fault of the request that was sent.
      return { kind: "explained", sentence: TRANSPORT_REFUSAL };
    default:
      return { kind: "explained", sentence: UNEXPECTED_REFUSAL };
  }
}

/**
 * The link label for one standard in the catalogue, which names the standard rather than the version:
 * a reader choosing between standards is choosing a standard, and the version it opens is stated
 * beside the link instead.
 */
function describeCatalogueLink(standard: StandardListItem, isOpen: boolean): string {
  return isOpen ? `Open ${standard.code} (the version shown below)` : `Open ${standard.code}`;
}

/**
 * What the catalogue says about the versions a standard publishes, beside the link that opens one.
 *
 * The count is stated because a reader deciding whether to open a standard benefits from knowing
 * whether it has one version or several, and the clause is honest about which version the link opens:
 * the first in the catalogue's order, which is the order the service returns.
 */
function describePublishedVersions(standard: StandardListItem, version: StandardVersion): string {
  if (standard.versions.length > 1) {
    return `— ${standard.versions.length} versions are published under this standard, and the link opens the first in the catalogue's order.`;
  }
  return version.version_label === standard.code
    ? "— its only published version."
    : `— its only published version, labelled ${version.version_label}.`;
}

/**
 * One standard of the catalogue: what it is, and the link that opens it.
 *
 * The link carries the standard *and* its first published version, because choosing a standard also
 * chooses a version and an address that carried only the standard would answer with whatever version
 * the previous selection named. A standard that publishes no version yet is stated as such rather than
 * linked to nothing, and the standard already open is marked with `aria-current` so the catalogue says
 * which of its entries the page below is showing.
 */
function CatalogueItem(props: {
  readonly standard: StandardListItem;
  readonly params: URLSearchParams;
  readonly isOpen: boolean;
}): JSX.Element {
  const standard = props.standard;
  const version = firstVersion(standard);

  return (
    <li>
      <h3>
        <code>{standard.code}</code> — {standard.title}
      </h3>
      {standard.summary.trim() === "" ? null : <p>{standard.summary}</p>}
      <p>
        {version === null ? (
          <>
            This standard publishes no version yet, so there are no thresholds to read and no version to
            open.
          </>
        ) : (
          <>
            <Link
              to={selectionPath(props.params, standardReference(standard), versionReference(version))}
              aria-current={props.isOpen ? "true" : undefined}
            >
              {describeCatalogueLink(standard, props.isOpen)}
            </Link>{" "}
            {describePublishedVersions(standard, version)}
          </>
        )}
      </p>
    </li>
  );
}

/**
 * The catalogue: every standard the service holds, the state of the read that produced them, and the
 * two ways that read ends without rows.
 *
 * The region is rendered once and only its content changes, so the node exists before the status it
 * announces does, and the error notice is rendered only when a failure exists — the notice renders a
 * generic explanation for a value that is not a failure, so a page that always rendered it would show
 * an error where none happened.
 */
function CatalogueSection(props: {
  readonly read: CatalogueRead;
  readonly params: URLSearchParams;
  readonly openStandardRef: string | null;
  readonly onRetry: () => void;
}): JSX.Element {
  const headingId = `${useId()}-catalogue-heading`;
  const standards = props.read.standards;
  const status = describeCatalogueStatus(standards, props.read.isLoading);

  return (
    <section id={CATALOGUE_SECTION_ID} aria-labelledby={headingId}>
      <h2 id={headingId}>{CATALOGUE_HEADING}</h2>
      <p>{CATALOGUE_SUMMARY}</p>

      <div className="status-region" role="status">
        {status === null ? null : <p>{status}</p>}
      </div>

      {props.read.failure === null ? null : (
        <ErrorNotice error={props.read.failure} onRetry={props.onRetry} />
      )}

      {standards === null ? null : standards.length === 0 ? (
        <EmptyState
          heading={EMPTY_CATALOGUE_HEADING}
          explanation={EMPTY_CATALOGUE_EXPLANATION}
          headingLevel={3}
        />
      ) : (
        <ul className="standards-catalogue">
          {standards.map(
            (standard: StandardListItem): JSX.Element => (
              <CatalogueItem
                key={standard.id}
                standard={standard}
                params={props.params}
                isOpen={props.openStandardRef === standardReference(standard)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/** The link back to the catalogue that every absent-selection state offers as its one next step. */
function catalogueAction(): JSX.Element {
  return <Link to={cataloguePath()}>{SHOW_CATALOGUE_LABEL}</Link>;
}

/**
 * The version section: the selected version's thresholds, its pass rule, the rubric it cites, and what
 * a report scored against it carries.
 *
 * Five states reach this section and each is rendered as what it is rather than as a failure: the
 * catalogue still being read, a catalogue holding no standard, an address naming a standard or a
 * version that does not exist, a standard that publishes no version yet, and — the ordinary case — a
 * resolved version whose read is loading, missing, refused or answered.
 */
function VersionSection(props: {
  readonly selection: Selection;
  readonly read: VersionRead;
  readonly params: URLSearchParams;
  readonly onRetry: () => void;
}): JSX.Element {
  const headingId = `${useId()}-version-heading`;
  const selection = props.selection;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{VERSION_HEADING}</h2>
      <p>{VERSION_SUMMARY}</p>

      {selection.kind === "loading" ? <p>{VERSION_AWAITING_CATALOGUE}</p> : null}

      {selection.kind === "empty" ? <p>{VERSION_WITHOUT_CATALOGUE}</p> : null}

      {selection.kind === "unknown-standard" ? (
        <EmptyState
          heading={UNKNOWN_STANDARD_HEADING}
          explanation={`This address asks for the standard "${selection.asked}", which the catalogue does not hold. The catalogue below lists the standards the service publishes, and its own first entry is what this page opens when the address names none.`}
          action={catalogueAction()}
          headingLevel={3}
        />
      ) : null}

      {selection.kind === "no-version" ? (
        <EmptyState
          heading={NO_VERSION_HEADING}
          explanation={`The catalogue holds ${selection.standard.code}, and it publishes no version, so there are no thresholds, no pass rule and no rubric reference to read here. A version appears when one is published under the standard.`}
          action={catalogueAction()}
          headingLevel={3}
        />
      ) : null}

      {selection.kind === "unknown-version" ? (
        <EmptyState
          heading={UNKNOWN_VERSION_HEADING}
          explanation={`This address asks for version "${selection.asked}" of ${selection.standard.code}, and that standard does not publish it. The versions it does publish are listed with the standard in the catalogue below.`}
          action={catalogueAction()}
          headingLevel={3}
        />
      ) : null}

      {selection.kind === "ready" ? (
        <SelectedVersion
          selection={selection}
          read={props.read}
          params={props.params}
          onRetry={props.onRetry}
        />
      ) : null}
    </section>
  );
}

/**
 * The resolved version's own content: where it stands, then its identity and thresholds, the pass rule,
 * the rubric reference as text, and the two paragraphs that bound what a report scored against it
 * means.
 */
function SelectedVersion(props: {
  readonly selection: Extract<Selection, { readonly kind: "ready" }>;
  readonly read: VersionRead;
  readonly params: URLSearchParams;
  readonly onRetry: () => void;
}): JSX.Element {
  const standardRef = props.selection.standardRef;
  const versionRef = props.selection.versionRef;
  const read = props.read;

  if (read.key !== versionReadKey(standardRef, versionRef) || read.status === "loading") {
    // The selection changed and the read for it has not settled. A settled answer for another version
    // is never rendered: it would state one version's pass rule under another version's heading.
    return (
      <div className="status-region" role="status">
        <p>
          Reading this version's thresholds. They appear as soon as the service answers, and they always
          belong to the version named in the address rather than to one read before it.
        </p>
      </div>
    );
  }

  if (read.status === "missing") {
    return (
      <EmptyState
        heading={MISSING_VERSION_HEADING}
        explanation={`The service answered that it holds no version for the pair this page asked about: standard "${standardRef}" and version "${versionRef}". An identifier an older link carries, or a catalogue that has changed since, reaches this state rather than an empty version.`}
        action={catalogueAction()}
        headingLevel={3}
      />
    );
  }

  if (read.status === "failed") {
    return <ErrorNotice error={read.failure} onRetry={props.onRetry} />;
  }

  return <VersionDetail standard={props.selection.standard} version={read.version} params={props.params} />;
}

/**
 * The version's identity, thresholds, pass rule, rubric reference and the bounds on what it means.
 *
 * The four counts are rendered as labelled pairs in a definition list rather than as a table: each
 * pair is one name and one value, and a table would be a grid claiming a structure this content does
 * not have. Every number is the version's own, with the case count it is measured against beside it,
 * so the rule can be checked by reading rather than assumed.
 */
function VersionDetail(props: {
  readonly standard: StandardListItem;
  readonly version: StandardVersion;
  readonly params: URLSearchParams;
}): JSX.Element {
  const standard = props.standard;
  const version = props.version;

  return (
    <>
      <h3>{PROVENANCE_HEADING}</h3>
      <dl>
        <dt>Standard</dt>
        <dd>
          <code>{standard.code}</code> — {standard.title}
        </dd>
        <dt>Version</dt>
        <dd>
          <code>{version.version_label}</code>
        </dd>
        <dt>Version identifier</dt>
        <dd>
          <code>{version.id}</code>
        </dd>
        <dt>Status</dt>
        <dd>
          {STANDARD_STATUS_LABELS[version.status]}. {STANDARD_STATUS_SENTENCES[version.status]}
        </dd>
        <dt>Published</dt>
        <dd>
          <code>{version.published_at}</code>
        </dd>
        <dt>Fixture cases</dt>
        <dd>{version.total_cases}</dd>
        <dt>Critical cases</dt>
        <dd>{version.critical_cases}</dd>
        <dt>Matches required for a pass</dt>
        <dd>
          {version.pass_threshold_matches} of {version.total_cases}
        </dd>
        <dt>Critical failures allowed</dt>
        <dd>{version.critical_failures_allowed}</dd>
        <dt>Pass rule</dt>
        <dd>{describePassRule(version)}</dd>
        <dt>Rubric reference</dt>
        <dd>
          <code>{version.rubric_reference}</code>
        </dd>
      </dl>

      {standard.versions.length > 1 ? (
        <VersionSwitcher
          standard={standard}
          openVersionRef={versionReference(version)}
          params={props.params}
        />
      ) : null}

      <p>
        These thresholds are versioned data recorded with this standard version, and they are what an
        evaluation is scored against. Changing them is not an edit to this version: it is a new version,
        proposed through the proposal path below, reviewed, and published in its own right. That is why
        a report scored against this version stays reproducible against the criteria it recorded, and
        why the serialized definition stored beside the row is not rendered here: the version's own
        columns are the criteria, and a copy presented as authority for the same rule would be a second
        one.
      </p>

      <h3>{RUBRIC_HEADING}</h3>
      <p>
        This version records its rubric reference as <code>{version.rubric_reference}</code>. In this
        repository that reference resolves to the document <code>{RUBRIC_DOCUMENT_PATH}</code>, which
        states the rubric, the evidence semantics, the retest and appeal semantics and the scope of a
        badge. Both are named here as text rather than linked: the service answers with the built
        application and serves no documentation directory, so an address into the repository's documents
        would open this application's own page instead of the document it names.
      </p>

      <h3>{REPORT_MEANING_HEADING}</h3>
      <p>{describeReportMeaning()}</p>
      <p>{describeTrustSeparation()}</p>
    </>
  );
}

/**
 * The published versions of the open standard, as links that rewrite only the version parameter.
 *
 * The list is rendered only when a standard publishes more than one version: with a single version
 * there is nothing to switch to, and a one-item list linking to itself would be a control that does
 * nothing. Each other version's link preserves the standard already in the address, so opening one is a
 * link a reader can send and a version's view is linkable on its own.
 */
function VersionSwitcher(props: {
  readonly standard: StandardListItem;
  readonly openVersionRef: string;
  readonly params: URLSearchParams;
}): JSX.Element {
  return (
    <>
      <h4>Published versions of {props.standard.code}</h4>
      <ul>
        {props.standard.versions.map(
          (version: StandardVersion): JSX.Element => {
            const reference = versionReference(version);
            return (
              <li key={version.id}>
                {reference === props.openVersionRef ? (
                  <>
                    <code>{version.version_label}</code>{" "}
                    <strong>(the version shown above)</strong>
                  </>
                ) : (
                  <Link to={versionSelectionPath(props.params, reference)}>
                    Read version {version.version_label}
                  </Link>
                )}
              </li>
            );
          },
        )}
      </ul>
    </>
  );
}

/**
 * The operator's review control for one submitted proposal.
 *
 * Five decisions shape it.
 *
 * **It renders one action per member of the review vocabulary**, labelled with what that decision does,
 * so the vocabulary has one definition — the one the route's request schema validates against — and a
 * renamed member fails the build here rather than failing that validation at run time.
 *
 * **The reason is optional, exactly as the contract makes it.** No control here is disabled for a blank
 * reason and no refusal is invented for one: a review is not obliged to justify itself, and a hint says
 * so rather than leaving a reader to guess whether a blank field will be refused.
 *
 * **It announces only what leaves it on screen.** A decided proposal stops being `submitted`, so this
 * control is unmounted by the same update that re-reads the catalogue; a sentence written by a
 * component about to disappear is a sentence no one hears. The durable announcement therefore belongs
 * to the page, and this control's own region carries the refusals that leave it mounted.
 *
 * **Nothing here can touch a measurement.** A decision moves a proposal's status and appends a
 * governance event. No control here publishes a version, rewrites a threshold or reaches a report, and
 * none is offered: the operator's power is additive, and the copy says so rather than implying that
 * accepting a proposal changes a standard.
 *
 * **A refusal that says the page's list is stale re-reads it.** A `409` means this proposal has moved
 * on since the catalogue was read, and a `404` means the service no longer holds it at all, so both
 * answer by asking the page to read the catalogue again rather than by offering a retry that would
 * fail identically.
 */
function ProposalReviewControl(props: {
  readonly proposalId: string;
  readonly onReviewed: (announcement: string) => void;
}): JSX.Element {
  const idPrefix = useId();
  const reasonId = `${idPrefix}-reason`;
  const reasonHintId = `${idPrefix}-reason-hint`;
  const decisionHintId = `${idPrefix}-decision-hint`;

  const [reason, setReason] = useState<string>("");
  const [pending, setPending] = useState<ProposalReviewStatus | null>(null);
  const [isDecided, setIsDecided] = useState<boolean>(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const isBusy = pending !== null || isDecided;

  // The sentence beside the actions, which states why they cannot be used: a decision in flight, or one
  // that has landed and is about to be read back. It is absent at rest, so no empty paragraph is
  // rendered and no control is described by nothing.
  const hintSentence =
    pending !== null ? REVIEW_SUBMITTING_HINT : isDecided ? REVIEW_DECIDED_HINT : null;

  const handleReasonChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setReason(event.target.value);
  };

  const applyDecision = async (status: ProposalReviewStatus): Promise<void> => {
    setRefusal(null);
    setPending(status);

    // The body is built with the reason present only when one was written: an optional field carried
    // as an explicit `undefined` is not what the contract's shape admits.
    const trimmedReason = reason.trim();
    const body: StandardProposalReviewBody =
      trimmedReason === "" ? { status } : { status, reason: trimmedReason };

    // What this call has to say afterwards, decided where the call's outcome is known and applied
    // outside the block below, so a defect in the page's own callback is never reported to the operator
    // as a refused decision.
    let announcement: string | null = null;
    let refusalSentence: string | null = null;

    try {
      await reviewProposal(props.proposalId, body);
      setIsDecided(true);
      announcement = describeDecision(props.proposalId, status);
    } catch (error: unknown) {
      const reading = describeReviewRefusal(error, props.proposalId);
      if (reading.kind === "stale") {
        // The list on screen is out of date: the page announces the sentence together with the re-read
        // it asks for, so this control renders no second sentence and offers no retry for a decision
        // that cannot succeed as the page currently holds it.
        announcement = reading.sentence;
      } else {
        refusalSentence = reading.sentence;
      }
    } finally {
      setPending(null);
    }

    setRefusal(refusalSentence);
    if (announcement !== null) {
      props.onReviewed(announcement);
    }
  };

  return (
    <fieldset className="field">
      <legend className="field__label">{REVIEW_DECISION_LEGEND}</legend>
      <p className="field__hint">{REVIEW_DECISION_SUMMARY}</p>

      <div className="field">
        <label className="field__label" htmlFor={reasonId}>
          {REVIEW_REASON_LABEL}
        </label>
        <textarea
          id={reasonId}
          name="reason"
          rows={3}
          value={reason}
          onChange={handleReasonChange}
          aria-describedby={reasonHintId}
          autoComplete="off"
          disabled={isBusy}
        />
        <p className="field__hint" id={reasonHintId}>
          {REVIEW_REASON_HINT}
        </p>
      </div>

      <div className="field__group">
        {PROPOSAL_REVIEW_STATUSES.map(
          (status: ProposalReviewStatus): JSX.Element => (
            <button
              key={status}
              type="button"
              className={status === "accepted" ? "button button--primary" : "button button--secondary"}
              disabled={isBusy}
              aria-busy={pending === status}
              aria-describedby={hintSentence === null ? undefined : decisionHintId}
              onClick={(): void => {
                void applyDecision(status);
              }}
            >
              {REVIEW_DECISION_INFO[status].label}
            </button>
          ),
        )}
      </div>

      <ul className="item-list">
        {PROPOSAL_REVIEW_STATUSES.map(
          (status: ProposalReviewStatus): JSX.Element => (
            <li className="item-list__item" key={status}>
              <strong>{REVIEW_DECISION_INFO[status].label}:</strong>{" "}
              {REVIEW_DECISION_INFO[status].summary}
            </li>
          ),
        )}
      </ul>

      {hintSentence === null ? null : (
        <p className="field__hint" id={decisionHintId}>
          {hintSentence}
        </p>
      )}

      {/* The region is rendered with the control and only its content changes, so the node exists
          before the refusal it announces arrives. `role="status"` is already a polite live region. */}
      <div className="status-region" role="status">
        {refusal === null ? null : (
          <div className="notice notice--error">
            <p>{refusal}</p>
          </div>
        )}
      </div>
    </fieldset>
  );
}

/**
 * One proposal: what it argues, who made it, the status it holds, and — for an operator, and only for
 * one still awaiting review — the control that decides it.
 *
 * The proposer is named by the handle the switcher lists that account under, because a reader
 * comparing proposals is comparing people's arguments; an account the switcher does not list falls back
 * to its identifier, which is still a fact the service recorded. The status is always a word as well as
 * a styling hook, so a decision is never conveyed by colour alone.
 */
function ProposalItem(props: {
  readonly proposal: StandardProposal;
  readonly isOperator: boolean;
  readonly onReviewed: (announcement: string) => void;
}): JSX.Element {
  const proposal = props.proposal;
  const proposer = findDemoAccount(proposal.proposer_account_id);

  return (
    <li className="item-list__item">
      <h3>{proposal.title}</h3>
      <p>{proposal.rationale}</p>
      <p>
        Proposed by{" "}
        {proposer === null ? (
          <code>{proposal.proposer_account_id}</code>
        ) : (
          <strong>{proposer.handle}</strong>
        )}
        {proposer === null
          ? ", an account the demo-account switcher does not list."
          : ` (${proposer.display_label}).`}
      </p>
      <p>
        <strong>{PROPOSAL_STATUS_LABELS[proposal.status]}.</strong>{" "}
        {PROPOSAL_STATUS_SENTENCES[proposal.status]}
      </p>
      {props.isOperator && proposal.status === "submitted" ? (
        <ProposalReviewControl proposalId={proposal.id} onReviewed={props.onReviewed} />
      ) : null}
    </li>
  );
}

/**
 * The proposals of the open standard and the two ways this page writes one: the contributor's form, and
 * the operator's decision on a proposal that has not been decided yet.
 *
 * The section is rendered only for a resolved standard, because a proposal is always a proposal about
 * something: asking a reader to propose a change to a standard the address does not name would be
 * asking for a proposal with no subject.
 *
 * The decision announcement lives in the region below rather than in the control that made it, and the
 * region is rendered with the section and stays mounted, so the sentence is present in the document
 * before it is written into the region. This is the page's own polite region: the control unmounts as
 * soon as the decision lands, and an announcement written by a component about to disappear is one no
 * screen-reader user hears.
 */
function ProposalsSection(props: {
  readonly standard: StandardListItem;
  readonly isOperator: boolean;
  readonly announcement: string | null;
  readonly onReviewed: (announcement: string) => void;
  readonly onReload: () => void;
}): JSX.Element {
  const headingId = `${useId()}-proposals-heading`;
  const formHeadingId = `${useId()}-propose-heading`;
  const proposals = props.standard.proposals;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{PROPOSALS_HEADING}</h2>
      <p>{PROPOSALS_SUMMARY}</p>

      <div className="status-region" role="status">
        {props.announcement === null ? null : (
          <p className="notice notice--success">{props.announcement}</p>
        )}
      </div>

      {props.isOperator ? null : (
        <p>
          Deciding a proposal is the operator's action, so it is offered only while the operator demo
          account is selected in the switcher above. The status stated with each proposal is the one the
          service holds for it.
        </p>
      )}

      {proposals.length === 0 ? (
        <EmptyState
          heading={EMPTY_PROPOSALS_HEADING}
          explanation={EMPTY_PROPOSALS_EXPLANATION}
          action={<a href={`#${PROPOSE_SECTION_ID}`}>{EMPTY_PROPOSALS_ACTION_LABEL}</a>}
          headingLevel={3}
        />
      ) : (
        <ul className="item-list">
          {proposals.map(
            (proposal: StandardProposal): JSX.Element => (
              <ProposalItem
                key={proposal.id}
                proposal={proposal}
                isOperator={props.isOperator}
                onReviewed={props.onReviewed}
              />
            ),
          )}
        </ul>
      )}

      <p>
        <button type="button" className="button button--secondary" onClick={props.onReload}>
          {RELOAD_CATALOGUE_LABEL}
        </button>
      </p>
      <p className="field__hint">{RELOAD_CATALOGUE_HINT}</p>

      <section id={PROPOSE_SECTION_ID} aria-labelledby={formHeadingId}>
        <h3 id={formHeadingId}>
          {PROPOSE_HEADING_PREFIX} {props.standard.code}
        </h3>
        <p>{PROPOSE_SUMMARY}</p>
        <StandardsProposalForm standardId={props.standard.id} />
      </section>
    </section>
  );
}

/**
 * The `/standards` route: the catalogue, the selected version's thresholds and pass rule, and the
 * proposals made against the standard it belongs to.
 *
 * This page owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which
 * renders the header, the navigation, the demonstration banner and the account switcher — must not
 * wrap it in another landmark. The outline it produces is one `h1`, then an `h2` per section, then an
 * `h3` per standard, per proposal and per explanatory state, so no level is skipped.
 *
 * All of the page's state is about reads and about what the page has just been told: the catalogue, the
 * version read keyed by the pair of references it was made for, and the sentence a decision produced.
 * The *selection* is not state at all: it is resolved from the address and the catalogue on every
 * render, so no second copy of it can disagree with the address a reader has.
 */
export function Standards(): JSX.Element {
  const [searchParams] = useSearchParams();

  // The catalogue read: the rows it answered, whether a read is in flight, what a failed read threw, and
  // the counter that asks for another one.
  const [standards, setStandards] = useState<readonly StandardListItem[] | null>(null);
  const [isCatalogueLoading, setIsCatalogueLoading] = useState<boolean>(true);
  const [catalogueFailure, setCatalogueFailure] = useState<unknown>(null);
  const [catalogueReadCount, setCatalogueReadCount] = useState<number>(0);

  // The version read, keyed by the references it was made for, plus the counter that re-runs it.
  const [versionRead, setVersionRead] = useState<VersionRead>({ status: "loading", key: "" });
  const [versionReadCount, setVersionReadCount] = useState<number>(0);

  // The sentence a decision produced, with the standard it concerns: the key is what stops a message
  // about one standard being read under another after the address changes.
  const [reviewAnnouncement, setReviewAnnouncement] = useState<{
    readonly standardRef: string;
    readonly sentence: string;
  } | null>(null);

  const requestedStandard = readParam(searchParams, STANDARD_PARAM);
  const requestedVersion = readParam(searchParams, VERSION_PARAM);
  const selection = resolveSelection(standards, requestedStandard, requestedVersion);

  // The references the version read is made for, or `null` when the selection resolves to no version.
  const selectedStandardRef = selection.kind === "ready" ? selection.standardRef : null;
  const selectedVersionRef = selection.kind === "ready" ? selection.versionRef : null;

  // Who is acting: the account the switcher has selected, narrowed rather than trusted, because the
  // lookup answers `null` for an absent, stale or hand-written value rather than throwing.
  const selectedAccount = findDemoAccount(getSelectedDemoAccountId());
  const isOperator = selectedAccount !== null && selectedAccount.role === "operator";

  /**
   * Read the catalogue again.
   *
   * The read is marked in flight here rather than only in the effect, because this is the moment a
   * caller knows what is on screen is stale: a proposal submitted a moment ago, or a decision just
   * recorded, must not be reported against a list read before it happened.
   */
  const reloadCatalogue = useCallback((): void => {
    setIsCatalogueLoading(true);
    setCatalogueReadCount((previous: number): number => previous + 1);
  }, []);

  /** Read the selected version again, for a failure that offers a retry. */
  const retryVersion = useCallback((): void => {
    setVersionReadCount((previous: number): number => previous + 1);
  }, []);

  /**
   * A decision was recorded, or a refusal said the list on screen is stale: announce it and re-read.
   *
   * Both halves are needed. The announcement is what tells a reader — including one who hears only the
   * polite region — that the decision landed, and the re-read is what puts the status the service now
   * holds on screen in the service's own answer rather than in this page's assumption.
   */
  const handleReviewed = useCallback(
    (sentence: string): void => {
      if (selectedStandardRef !== null) {
        setReviewAnnouncement({ standardRef: selectedStandardRef, sentence });
      }
      reloadCatalogue();
    },
    [reloadCatalogue, selectedStandardRef],
  );

  /**
   * The catalogue read, and the first of the page's two effects.
   *
   * A failed read keeps the rows already on screen and reports the failure beside them: a reader who
   * can still read the catalogue they were given is better served than one whose page empties because a
   * later read failed. The cancelled flag stops a settled read from writing state after the page has
   * gone or after a newer read has replaced it.
   */
  useEffect((): (() => void) => {
    let cancelled = false;

    setIsCatalogueLoading(true);
    setCatalogueFailure(null);

    listStandards().then(
      (rows: StandardListItem[]): void => {
        if (cancelled) {
          return;
        }
        setStandards(narrowStandards(rows));
        setIsCatalogueLoading(false);
      },
      (failure: unknown): void => {
        if (cancelled) {
          return;
        }
        setCatalogueFailure(failure);
        setIsCatalogueLoading(false);
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [catalogueReadCount]);

  /**
   * The version read, keyed by the references it is made for.
   *
   * It re-runs when the selection changes and not when a catalogue re-read merely returns the same
   * standard again, which is why the references and not the rows are its dependencies: a decision on a
   * proposal re-reads the catalogue, and re-reading a version whose thresholds cannot have changed
   * would be a request spent on nothing.
   */
  useEffect((): (() => void) | void => {
    if (selectedStandardRef === null || selectedVersionRef === null) {
      return;
    }

    let cancelled = false;
    const key = versionReadKey(selectedStandardRef, selectedVersionRef);
    setVersionRead({ status: "loading", key });

    getStandardVersion(selectedStandardRef, selectedVersionRef).then(
      (version: StandardVersion): void => {
        if (cancelled) {
          return;
        }
        const narrowed = narrowVersion(version);
        // A version whose fields cannot be read is reported as a failure rather than rendered with
        // blanks: this section exists to state these numbers, and a blank would state nothing.
        setVersionRead(
          narrowed === null
            ? { status: "failed", key, failure: null }
            : { status: "ready", key, version: narrowed },
        );
      },
      (failure: unknown): void => {
        if (cancelled) {
          return;
        }
        // `404` is the contract's "unknown standard or unknown version", so it is answered with the
        // explanation that names what could not be found rather than with a retry that cannot succeed.
        setVersionRead(
          statusOf(failure) === 404 ? { status: "missing", key } : { status: "failed", key, failure },
        );
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [selectedStandardRef, selectedVersionRef, versionReadCount]);

  const announcement =
    reviewAnnouncement !== null && reviewAnnouncement.standardRef === selectedStandardRef
      ? reviewAnnouncement.sentence
      : null;

  return (
    <main id="main-content" tabIndex={-1} className="page page-standards">
      <section aria-labelledby="standards-purpose-heading">
        <h1 id="standards-purpose-heading">{PAGE_HEADING}</h1>
        <p>{PAGE_SUMMARY}</p>
      </section>

      <CatalogueSection
        read={{ standards, isLoading: isCatalogueLoading, failure: catalogueFailure }}
        params={searchParams}
        openStandardRef={selectedStandardRef}
        onRetry={reloadCatalogue}
      />

      <VersionSection
        selection={selection}
        read={versionRead}
        params={searchParams}
        onRetry={retryVersion}
      />

      {selection.kind === "ready" ? (
        <ProposalsSection
          standard={selection.standard}
          isOperator={isOperator}
          announcement={announcement}
          onReviewed={handleReviewed}
          onReload={reloadCatalogue}
        />
      ) : null}
    </main>
  );
}

// The default export is what the shell's route table imports and the named export is what a test or a
// later page may import by name, so both exist on purpose.
export default Standards;

