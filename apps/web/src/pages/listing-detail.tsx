/**
 * The `/listings/:id` route: one listing's claims beside the evidence measured against it, its
 * version history, the limitations it states, its license, its pricing model and the offer models
 * it makes — plus the three buyer surfaces and the operator's moderation panel.
 *
 * Nine decisions hold this page together, and each is one a later reader could invert.
 *
 * **The two sides are never conflated.** What a developer asserts is rendered under the heading
 * `Claimed` and nothing else; what the standard recorded is rendered under `Measured in the SGI
 * demo` and nothing else. A claim is developer-written content and a report is a measurement, so a
 * reader who mistook one for the other would be reading the page backwards — and a listing with no
 * report therefore says `No SGI report yet` in the measured half rather than rendering an empty
 * space that could read as a pass.
 *
 * **Presentation only, with one read.** `../api-client` is the only module this page reaches the
 * service through, and `getListing` is the only call it makes: the four writes a visitor can
 * trigger here — an inquiry, a simulated checkout, a challenge and a moderation action — belong to
 * the components rendered below, which own their own fields, their own demo-account handling and
 * their own explanation of a refusal. No URL, header, response body or transport failure is handled
 * in this file.
 *
 * **One `<main>` and one `<h1>`, or none of this page's own.** The absent state is the sibling
 * page's: when the read answers `404`, `./not-found` is returned *instead of* everything below, so
 * the route still has exactly one landmark and one title. Rendering a heading of this page's beside
 * it would put two of each on one route.
 *
 * **A listing the operator can still read keeps its history.** A hidden listing leaves browse and
 * search while staying readable to the operator, so the status is stated above the title block, the
 * version history renders and the moderation panel is offered — never the absent state for a
 * listing the service returned. The same holds after an action: this page re-reads the listing it
 * moderated, and a read that answers `404` for that listing retains what is on screen with the
 * status the action returned, because losing the history at the moment it is hidden would hide the
 * very record the operator is looking at.
 *
 * **The badge is the component's decision, and the report link is a route.** `SampleBadge` returns
 * nothing at all for a `FAIL` report, so it is rendered with the report's own four values and no
 * second condition, no substitute markup and never for a listing without a report. The link goes to
 * the page route `/reports/{id}`; the API's own `/evaluations/{id}` address is `../api-client`'s to
 * build and is never spelled here.
 *
 * **The buyer surfaces are components inside this page, not routes of their own.** The inquiry
 * form, the simulated checkout and the challenge form are rendered here below the evidence, which
 * keeps the thirteen route files the complete route set. The checkout panel receives the listing,
 * the version being bought, that version's claims and the pricing model the listing row declares —
 * and nothing else: it names no price, computes no amount and reads no currency from this page.
 *
 * **The version being bought is derived, never stored as a second truth.** The version selector's
 * value is resolved on every render from the version the reader chose and the listing's own version
 * history — the current version when nothing has been chosen, and the current version again when a
 * refresh leaves the chosen one gone. A selection that outlived its listing therefore cannot send a
 * version this listing no longer has.
 *
 * **The operator panel renders for an operator alone.** The selected demo account is resolved from
 * `../data/demo-accounts` and read at render time, and only the operator role sees the moderation
 * panel: a control that refuses every other role is worse than no control, because it reads as
 * available and then declines. Nothing else on the page changes with the role.
 *
 * **No amount, price, currency symbol or currency code is written here.** The pricing model names
 * the kind of offer a listing makes and the amount belongs to the simulated checkout, which renders
 * the transaction's own integer minor units with the currency label and the disclosure label the
 * response carries. The one monetary thing this page states in its own words is the synthetic
 * currency label, interpolated from the shared vocabulary, so no surface can drift from it.
 *
 * The closed vocabulary — `SAMPLE`, `VERIFIED-IN-DEMO`, the badge scope, `No SGI report yet` and
 * the synthetic currency label — is interpolated from `@adem/shared` wherever a constant exists,
 * and no page text states or implies general safety, certified security, independent certification
 * or a guaranteed pass: an outcome depends on test evidence only, and buying an evaluation buys no
 * influence over one.
 *
 * Appearance comes from the workspace stylesheet's own classes — the route root, `.item-list`, the
 * `.field` family, `.notice`, `.status-region`, `.empty-state` and the components' own blocks. This
 * file imports no stylesheet, carries no inline style, reads no storage of its own, and makes no
 * request outside `../api-client`.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { BADGE_SCOPE, NO_REPORT_LABEL, SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";
import type {
  ListingClaim,
  ListingDetail,
  ListingStatus,
  ListingVersion,
  OfferModel,
  ReportOutcome,
} from "@adem/shared";

import { getListing, getSelectedDemoAccountId } from "../api-client";
import { ChallengeForm } from "../components/challenge-form";
import { CheckoutPanel } from "../components/checkout-panel";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { InquiryForm } from "../components/inquiry-form";
import { ModerationActions } from "../components/moderation-actions";
import { SampleBadge } from "../components/sample-badge";
import { findDemoAccount } from "../data/demo-accounts";
import type { DemoAccount } from "../data/demo-accounts";
import { describePricingModel } from "../labels";
import { Timestamp, isRecord } from "../payload-reading";
import { NotFound } from "./not-found";

/**
 * The page's own title, rendered while the read is in flight and after one has failed. Once the
 * listing has arrived the listing's own title is the `<h1>`, because it is the subject of the page.
 */
const PAGE_HEADING = "Listing";

/** The heading of the side that carries what the listing's developer asserts. */
const CLAIMED_HEADING = "Claimed";

/** The heading of the side that carries what the standard recorded against the current version. */
const MEASURED_HEADING = "Measured in the SGI demo";

/**
 * The disclosure every page showing an outcome owes a reader, worded as the comparison view words
 * it so that one product does not state one duty in two ways.
 */
const EVIDENCE_DISCLOSURE =
  "Measured evidence is what the standard recorded against a version. Buying an evaluation never " +
  "guarantees a pass: an outcome depends on test evidence only.";

/** The heading of the section pairing the two sides for the listing's current version. */
const CLAIMS_AND_EVIDENCE_HEADING = "Claims versus measured evidence";

/** The heading of the version history section. */
const VERSION_HISTORY_HEADING = "Version history";

/**
 * What the version history section states about itself: the versions the read carried, newest first,
 * and the rule that makes a history rather than a document — it is what was published, never edited.
 *
 * It names the versions the page carries rather than the listing's versions at large, because the
 * read answers one page of the history and the history's own size is stated beside it.
 */
const VERSION_HISTORY_INTRO =
  "The versions this listing has published that this page carries, newest first, as they were " +
  "published. A version is never edited: a developer publishes a new one.";

/** The heading of the section listing what the listing does not claim and how it is offered. */
const OFFERING_HEADING = "Limitations, license and pricing";

/** The heading over the limitations the listing's claims state. */
const LIMITATIONS_HEADING = "Stated limitations";

/** The heading over the license, the pricing model and the offer models. */
const OFFERING_FACTS_HEADING = "License, pricing model and offer models";

/** The heading over the buyer's inquiry surface. */
const INQUIRY_HEADING = "Inquire about this listing";

/** The state the inquiry section shows in place of the form for an account that cannot inquire. */
const INQUIRY_ROLE_HEADING = "Inquiring about a listing needs a buyer account";

/** What the inquiry surface states about where an inquiry goes. */
const INQUIRY_INTRO =
  "An inquiry is written to the developer who owns this listing. It is sent as the demo account " +
  "selected in the account switcher above.";

/**
 * The heading over the simulated checkout. It deliberately does not repeat the checkout panel's own
 * accessible name ("Simulated checkout"): a section labelled by that heading and the panel it holds
 * would be two landmarks of the same name, which axe reports as `landmark-unique`.
 */
const CHECKOUT_HEADING = "Select an offer";

/** The state the checkout section shows in place of the panel for an account that cannot buy. */
const CHECKOUT_ROLE_HEADING = "Recording a simulated transaction needs a buyer account";

/** The heading over the public challenge surface. */
const CHALLENGE_HEADING = "Challenge these claims";

/** The sentence the challenge surface is introduced with: what a challenge is. */
const CHALLENGE_INTRO =
  "A challenge is a public question about this listing's claims, answered on the public " +
  "challenges board.";

/** The state the challenge section shows in place of the form for an account that cannot challenge. */
const CHALLENGE_ROLE_HEADING = "Challenging a listing's claims needs a buyer account";

/** The heading over the operator's moderation panel. */
const MODERATION_HEADING = "Operator moderation";

/** What the moderation panel states about the operator's power over this listing. */
const MODERATION_INTRO =
  "An operator may flag a listing, take it out of browse and search, or return it. Every action " +
  "moves the listing's status and appends a record of the reason, and no action can change what a " +
  "measurement says.";

/** The label of the version selector: which version a simulated transaction is recorded against. */
const VERSION_SELECT_LABEL = "Version to buy";

/** The hint that describes the version selector. */
const VERSION_SELECT_HINT =
  "The version the simulated transaction is recorded against. The current version is selected to " +
  "begin with.";

/** The row label of the owning developer's handle. */
const DEVELOPER_ROW_LABEL = "Developer";

/** The row label of the listing's category. */
const CATEGORY_ROW_LABEL = "Category";

/** The row label of the license the listing is offered under. */
const LICENSE_ROW_LABEL = "License";

/** The row label of the pricing model the listing declares. */
const PRICING_MODEL_ROW_LABEL = "Pricing model";

/** The row label of the version the page shows as current. */
const CURRENT_VERSION_ROW_LABEL = "Current version";

/** The row label of the listing's moderation status. */
const STATUS_ROW_LABEL = "Status";

/** The row label of the outcome a report recorded. */
const OUTCOME_ROW_LABEL = "Outcome";

/** The row label of the standard version a report was scored against. */
const STANDARD_VERSION_ROW_LABEL = "Standard version";

/** The row label of the report's label. */
const REPORT_LABEL_ROW_LABEL = "Report label";

/** The row label of the scope a report measured. */
const SCOPE_ROW_LABEL = "Scope measured";

/** The row label of the report's identifier. */
const REPORT_ROW_LABEL = "Report";

/** The visible text of the control that opens a report from the listing. */
const REPORT_LINK_LABEL = "Read the SGI report";

/** The row label of the developer-written evidence a claim cites. */
const CLAIM_EVIDENCE_ROW_LABEL = "Evidence cited";

/** The row label of the limitation a claim states for itself. */
const CLAIM_LIMITATION_ROW_LABEL = "Stated limitation of this claim";

/** What a claim that cites no evidence is marked with, so the row is never blank. */
const NO_EVIDENCE_CITED_NOTE = "no evidence cited for this claim";

/** What a claim that states no limitation is marked with. */
const NO_CLAIM_LIMITATION_NOTE = "none stated for this claim";

/** The text that marks the version the listing's linked evidence measures. */
const CURRENT_VERSION_LABEL = "Current version";

/** The sentence that follows a listing whose latest version has no report. */
const NO_REPORT_EXPLANATION =
  "No evaluation has been run for this listing's latest version, so no outcome, standard version, " +
  "label or badge is recorded for it. A listing with no evaluation is an ordinary state of the " +
  "exchange, and it is not a pass.";

/**
 * The sentence that follows a listing that has published no version at all, where the sentence
 * above would name a latest version the listing does not have.
 */
const NO_VERSION_EVIDENCE_EXPLANATION =
  "This listing has published no version, so there is no version an evaluation could be run for " +
  "yet. A version is published before anything can be measured against it, and a listing with no " +
  "measurement is an ordinary state of the exchange and not a pass.";

/** The sentence a failing report is accompanied by, so the absent badge is explained rather than odd. */
const FAIL_EXPLANATION =
  "This report did not pass. A badge is issued on a pass alone, so none is shown; the per-case " +
  "evidence behind the outcome is in the report.";

/**
 * The note rendered in place of a limitations list when the claims the page carries state none.
 *
 * It names the claims the page lists rather than the listing's claims at large: the limitations are
 * collected from the version history this read answered, which is one page of the history.
 */
const NO_LIMITATIONS_NOTE = "No limitations are stated for the claims listed above.";

/** The note rendered in place of a claims list when the listing states no claim. */
const NO_CLAIMS_NOTE = "This listing states no claims yet.";

/** The note rendered for one version that states no claim. */
const NO_VERSION_CLAIMS_NOTE = "No claim is stated for this version.";

/** The row label of the offer models a listing makes. */
const OFFER_MODELS_ROW_LABEL = "Offer models";

/** The note rendered in place of an offer list when the listing makes no offer. */
const NO_OFFER_MODELS_NOTE = "This listing makes no offer, so no transaction can be recorded against it.";

/** The heading of the state a listing that has published no version renders in the history section. */
const NO_VERSIONS_HEADING = "No versions published yet";

/** The explanation of that state. */
const NO_VERSIONS_EXPLANATION =
  "This listing has published no version. A developer publishes a version before anything can be " +
  "measured against it, so there is nothing to show here yet.";

/**
 * What the page states about money in its own words: the pricing model names an offer kind and no
 * amount is stated outside the simulated checkout, which renders the amount the response carries.
 */
const PRICING_MODEL_NOTE = `The pricing model names the kind of offer this listing makes. No amount is stated here: an amount is recorded only by the simulated checkout, in minor units of the synthetic currency ${SYNTHETIC_CURRENCY_LABEL}, with the disclosure label the response carries.`;

/**
 * What the checkout surface states about itself, interpolating the one synthetic currency label.
 *
 * It states what the surface is rather than instructing the reader to use it, because the surface is
 * withheld from an account whose role the service refuses: the sentence above the state that explains
 * that must not tell the reader to choose an offer model there is no control for. The panel itself
 * names the models and carries the action.
 */
const CHECKOUT_INTRO = `A simulated transaction is recorded against one of the offer models this listing makes. The transaction is nonfunctional: no money moves, and the amount it records is an integer count of minor units of the synthetic currency ${SYNTHETIC_CURRENCY_LABEL}.`;

/** The heading of the state a listing with no published version renders in place of a checkout. */
const NOTHING_TO_BUY_HEADING = "No version to buy";

/** The explanation of that state. */
const NOTHING_TO_BUY_EXPLANATION =
  "This listing has published no version yet, so there is nothing for a simulated transaction to " +
  "be recorded against. A developer publishes a version, and an evaluation measures it.";

/**
 * Why one of this page's buyer writes is not offered the selected account: which account is selected,
 * which role the surface needs and where to choose one. `surface` names the surface as the sentence's
 * subject — "An inquiry", "The simulated checkout", "A challenge" — so each state says exactly what is
 * missing. The surface is withheld rather than offered and then refused, which is how `/developer`
 * treats a half its account holds no role for. A visitor who has selected no account keeps every
 * surface as it was: the write's own explanation answers for the absent account.
 */
function buyerRoleExplanation(account: DemoAccount, surface: string): string {
  return (
    `The selected demo account is ${account.display_label}, whose role is ${account.role}. ${surface} ` +
    "is the buyer's write, so it is not shown for this account. Choose a buyer account in the " +
    "demo-account switcher in the page header to use it."
  );
}

/** The announced message the page shows while its one read is in flight. */
const LOADING_MESSAGE =
  "Reading this listing. The page fills in when the service answers; an address that names no " +
  "listing is answered with the absent state instead.";

/**
 * The notice a hidden listing is read with: the state, who reads it, and what returns it to browse.
 * It is rendered above the title block, so an operator opening the link straight from a search
 * result cannot miss the state the listing is in.
 */
const HIDDEN_NOTICE =
  "This listing is hidden. It is not visible in browse or search, and it remains readable here with " +
  "its full version history. Only the operator role reads it in this state, and Restore below " +
  "returns it to browse.";

/** The notice a flagged listing is read with. */
const FLAGGED_NOTICE =
  "This listing is flagged. It stays visible in browse and search with this status stated; a flag " +
  "records a concern and does not change whether the listing is visible.";

/**
 * The notice rendered when the public read has stopped returning this listing after a moderation
 * action: the history on screen is the one the action was taken on, and it stays readable.
 */
const RETAINED_NOTICE =
  "The public read no longer returns this listing: it is hidden from browse and search. The version " +
  "history shown here is the one that was read before the listing was hidden, kept so that what is " +
  "stored stays readable to an operator, and Restore below returns it to browse.";

/** The absent state's heading: the listing is unknown, or it is gone from public view. */
const NOT_FOUND_HEADING = "Listing not found";

/**
 * The absent state's explanation. It states both readings of a `404` — an address that names no
 * listing, and a listing that has been hidden from public view — and states what was *not* done,
 * because a reader who fears a deletion should know that nothing was deleted.
 */
const NOT_FOUND_MESSAGE =
  "This listing is unknown to the exchange, or it has been taken out of public view. Nothing was " +
  "deleted: a listing that still exists keeps its versions, its claims and its reports, and every " +
  "listing that remains is still browsable.";

/**
 * The reading of one listing state, as this page renders it in words. Typed as a total record over
 * the closed vocabulary, so a fourth state fails the build here rather than rendering as a bare
 * identifier beside the label.
 */
const LISTING_STATUS_LABELS: Readonly<Record<ListingStatus, string>> = Object.freeze({
  active: "Active",
  flagged: "Flagged",
  hidden: "Hidden",
});

/** The readable name of each offer model a listing may make. */
const OFFER_MODEL_LABELS: Readonly<Record<OfferModel, string>> = Object.freeze({
  rent: "Rent",
  purchase: "Purchase",
  license: "License",
  subscription: "Subscription",
});

/** The state of the page's one read: what is on screen, and what went wrong when something did. */
type ReadState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "ready"; readonly listing: ListingDetail };

/**
 * The status a moderation action returned, held beside the read rather than inside it.
 *
 * It is what makes a status change visible at once, before the re-read that confirms it answers,
 * and it is scoped to one listing identifier so a value recorded for one listing can never describe
 * another. `keptBecauseNotReturned` records the one case where the re-read cannot confirm anything:
 * the public read stopped returning the listing, so the history on screen is the one retained.
 */
interface OperatorEdit {
  /** The listing the action was applied to; an edit for another id is ignored. */
  readonly listingId: string;
  /** The status the action returned, which is what the page states until the read confirms it. */
  readonly status: ListingStatus;
  /** Whether the public read stopped returning this listing after the action. */
  readonly keptBecauseNotReturned: boolean;
}

/**
 * The HTTP status a thrown value carries, or `null` when it carries none.
 *
 * The status is read structurally rather than by class, exactly as the sibling pages read it, so a
 * failure raised from any path is understood the same way. Only a whole, non-negative number counts;
 * anything else — a bare string, a primitive, an object with no status — is a failure this page
 * cannot place, and it is never mistaken for the `404` this page answers with the absent state.
 */
function failureStatus(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value["status"];
  return typeof status === "number" && Number.isInteger(status) && status >= 0 ? status : null;
}

/**
 * The state a failed read renders: a listing the service does not return is the absent state, and
 * every other failure is one the reader can send again.
 *
 * `404` alone is treated this way, because the contract fixes it as "unknown or removed": both
 * readings are the same to a reader — there is no listing at this address — and the absent state
 * offers the way back to browsing, which a notice with a retry control does not.
 */
function readFailureState(error: unknown): ReadState {
  if (failureStatus(error) === 404) {
    return { kind: "missing" };
  }
  return { kind: "failed", error };
}

/** Whether a developer-written field carries text, so an empty one is explained rather than blank. */
function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/** The readable name of one listing status. */
function describeStatus(status: ListingStatus): string {
  return LISTING_STATUS_LABELS[status];
}

/** The readable name of one offer model. */
function describeOfferModel(model: OfferModel): string {
  return OFFER_MODEL_LABELS[model];
}

/**
 * The claims made for one version, in the order the payload states them.
 *
 * A claim belongs to a version — `listing_version_id` is what pairs them — so the pairing is read
 * here rather than assumed positionally: a claim is rendered beside the version it is made for and
 * never beside whichever version happened to be first.
 */
function claimsForVersion(claims: readonly ListingClaim[], versionId: string): ListingClaim[] {
  return claims.filter((claim: ListingClaim): boolean => claim.listing_version_id === versionId);
}

/**
 * The limitations a listing's claims state, in the order the claims are read, with the repeats
 * dropped: two versions of one listing routinely state the same limitation, and a section that
 * listed it once per version would read as twice the caveat it is.
 */
function collectLimitations(claims: readonly ListingClaim[]): string[] {
  const seen = new Set<string>();
  const limitations: string[] = [];
  for (const claim of claims) {
    const limitation = claim.limitation.trim();
    if (limitation === "" || seen.has(limitation)) {
      continue;
    }
    seen.add(limitation);
    limitations.push(claim.limitation);
  }
  return limitations;
}

/**
 * One fact of a listing, as a labelled row: the label is visible text beside its value, so no value
 * is identified by its position or its colour alone, and the row survives being read at 360px.
 */
function Fact(props: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <li className="item-list__item">
      <strong>{`${props.label}:`}</strong> {props.children}
    </li>
  );
}

/**
 * The notice a listing's own status is read with, rendered above the title block, or nothing at all
 * for an active listing that the read returned.
 *
 * A hidden or flagged status is never omitted for the operator, because the operator is the one
 * role that reads a listing in either state and a page that hid the state would be hiding the thing
 * the reader came for. The retained notice takes precedence over the status notice: when the public
 * read has stopped returning this listing, what a reader needs to know first is why the listing
 * they are looking at cannot be reopened.
 */
function ListingStatusNotice(props: {
  readonly status: ListingStatus;
  readonly keptBecauseNotReturned: boolean;
}): JSX.Element | null {
  if (props.keptBecauseNotReturned) {
    return <p className="notice notice--warning">{RETAINED_NOTICE}</p>;
  }
  if (props.status === "hidden") {
    return <p className="notice notice--info">{HIDDEN_NOTICE}</p>;
  }
  if (props.status === "flagged") {
    return <p className="notice notice--warning">{FLAGGED_NOTICE}</p>;
  }
  return null;
}

/** The chip class for one report outcome, mirroring the mapping the report page uses. */
function outcomeChipClass(outcome: ReportOutcome): string {
  return outcome === "PASS" ? "chip chip--pass" : "chip chip--fail";
}

/**
 * What the standard measured against the listing's current version: the report's own provenance and
 * the badge that report may carry, or the plain statement that no report exists.
 *
 * The four report values are read together, because the payload states them as one all-or-nothing
 * group: `report_id`, `outcome`, `standard_version_id` and `label` are all `null` for a version with
 * no report and all present for one with a report. Rendering the badge with the report's own values
 * and no condition of this page's is what keeps a `FAIL` report from being given one — the badge
 * component returns nothing for a failure before it builds any markup.
 *
 * The report identifier is rendered as text beside the link to the report page, so the identifier a
 * reader sees is the one the report's own record carries, and the link is a route of this
 * application: the API's own address for the resource is `../api-client`'s to speak.
 *
 * The version being measured is passed in rather than assumed, because the state with no report has
 * two readings: a listing that has published no version can have no evaluation for one, and telling
 * its reader that none "has been run" for a latest version would name a version that does not
 * exist. The absence of a version is therefore explained as the absence of the thing that would be
 * measured, while the sentence for a version that carries no report is kept exactly as it stands.
 */
function MeasuredEvidence(props: {
  readonly listing: ListingDetail;
  readonly currentVersion: ListingVersion | null;
}): JSX.Element {
  const listing = props.listing;
  const reportId = listing.report_id;
  const outcome = listing.outcome;
  const standardVersionId = listing.standard_version_id;
  const label = listing.label;

  if (reportId === null || outcome === null || standardVersionId === null || label === null) {
    return (
      <>
        <p>{NO_REPORT_LABEL}</p>
        <p>
          {props.currentVersion === null ? NO_VERSION_EVIDENCE_EXPLANATION : NO_REPORT_EXPLANATION}
        </p>
      </>
    );
  }

  return (
    <>
      <SampleBadge
        outcome={outcome}
        label={label}
        standardVersionId={standardVersionId}
        reportId={reportId}
      />
      <ul className="item-list">
        <Fact label={OUTCOME_ROW_LABEL}>
          <span className={outcomeChipClass(outcome)}>{outcome}</span>
        </Fact>
        <Fact label={STANDARD_VERSION_ROW_LABEL}>{standardVersionId}</Fact>
        <Fact label={REPORT_LABEL_ROW_LABEL}>
          <span className="chip chip--label">{label}</span>
        </Fact>
        <Fact label={SCOPE_ROW_LABEL}>{BADGE_SCOPE}</Fact>
        <Fact label={REPORT_ROW_LABEL}>{reportId}</Fact>
      </ul>
      <p>
        <Link to={`/reports/${encodeURIComponent(reportId)}`}>{REPORT_LINK_LABEL}</Link>
      </p>
      {outcome === "FAIL" ? <p>{FAIL_EXPLANATION}</p> : null}
    </>
  );
}

/**
 * The claims one version makes, each kept beside the evidence it cites and the limitation its own
 * developer states for it.
 *
 * A claim detached from those two is exactly what this view exists to prevent, which is why a claim
 * that cites nothing and one that states no limitation are both marked in words rather than left as
 * an empty space a reader could read as an absence of caveats. The note rendered for a version that
 * states no claim is passed in, because the same absence reads differently for the version being
 * compared and for one in the history below.
 */
function ClaimList(props: {
  readonly claims: readonly ListingClaim[];
  readonly emptyNote: string;
}): JSX.Element {
  if (props.claims.length === 0) {
    return <p>{props.emptyNote}</p>;
  }

  return (
    <ul className="item-list">
      {props.claims.map(
        (claim: ListingClaim): JSX.Element => (
          <li className="item-list__item" key={claim.id}>
            <p>{claim.claim}</p>
            <p>
              <strong>{`${CLAIM_LIMITATION_ROW_LABEL}:`}</strong>{" "}
              {hasText(claim.limitation) ? claim.limitation : NO_CLAIM_LIMITATION_NOTE}
            </p>
            <p>
              <strong>{`${CLAIM_EVIDENCE_ROW_LABEL}:`}</strong>{" "}
              {hasText(claim.evidence_summary) ? claim.evidence_summary : NO_EVIDENCE_CITED_NOTE}
            </p>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * The facts a reader needs to place one listing: who owns it, what it is, how it is offered, which
 * version is current and what state it is in. Each is a labelled row so no value is identified by
 * its position alone, and the row for the current version is omitted rather than filled with an
 * invented value when the listing has published no version at all.
 */
function ListingFacts(props: {
  readonly listing: ListingDetail;
  readonly status: ListingStatus;
  readonly currentVersion: ListingVersion | null;
}): JSX.Element {
  const listing = props.listing;
  return (
    <ul className="item-list">
      <Fact label={DEVELOPER_ROW_LABEL}>{listing.developer_handle}</Fact>
      <Fact label={CATEGORY_ROW_LABEL}>{listing.category.name}</Fact>
      <Fact label={LICENSE_ROW_LABEL}>{listing.license_code}</Fact>
      <Fact label={PRICING_MODEL_ROW_LABEL}>{describePricingModel(listing.pricing_model)}</Fact>
      {props.currentVersion === null ? null : (
        <Fact label={CURRENT_VERSION_ROW_LABEL}>{props.currentVersion.version_string}</Fact>
      )}
      <Fact label={STATUS_ROW_LABEL}>{describeStatus(props.status)}</Fact>
    </ul>
  );
}

/**
 * The heart of the page: what this listing claims on one side and what was measured against it on
 * the other, for the version the linked evidence belongs to.
 *
 * The two sides are two sibling headings rather than one table or one list, because they answer two
 * different questions — what a developer asserts, and what the criteria recorded — and a reader who
 * read them as one would be reading a claim as a measurement. The disclosure sentence above them
 * states the duty this page owes every buyer: an outcome depends on test evidence only and no
 * purchase changes it.
 *
 * The measured side is rendered from the listing's linked evidence and never from the claims: a
 * claim citing evidence is a developer's pointer, and the report is the measurement.
 */
function ClaimsAndEvidenceSection(props: {
  readonly listing: ListingDetail;
  readonly currentVersion: ListingVersion | null;
}): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-claims-heading`;
  const currentVersion = props.currentVersion;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{CLAIMS_AND_EVIDENCE_HEADING}</h2>
      <p>{EVIDENCE_DISCLOSURE}</p>

      <h3>{CLAIMED_HEADING}</h3>
      {currentVersion === null ? (
        <p>{NO_CLAIMS_NOTE}</p>
      ) : (
        <>
          <p>{`Claims made for version ${currentVersion.version_string}.`}</p>
          <ClaimList
            claims={claimsForVersion(props.listing.claims, currentVersion.id)}
            emptyNote={NO_CLAIMS_NOTE}
          />
        </>
      )}

      <h3>{MEASURED_HEADING}</h3>
      <MeasuredEvidence listing={props.listing} currentVersion={currentVersion} />
    </section>
  );
}

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
 * The listing's version history as published: the page of versions the read carried, newest first,
 * with the claims each version makes and the report link a version carries, and the size of the
 * whole history stated above them.
 *
 * The current version is marked in words rather than by position or weight, because "the newest
 * one" is a fact a reader should be able to read. The link to a report is rendered only for the
 * version the linked evidence belongs to, since the listing payload carries exactly one report
 * identifier: attaching it to another version would attribute a measurement to a version it does
 * not describe.
 */
function VersionHistorySection(props: {
  readonly listing: ListingDetail;
  readonly currentVersion: ListingVersion | null;
}): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-history-heading`;
  const listing = props.listing;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{VERSION_HISTORY_HEADING}</h2>
      <p>{VERSION_HISTORY_INTRO}</p>

      {/* The size of the history, from the payload's own total: the read above answers one page of
          it, so the section states what the listing has published in all beside the page it carries.
          A listing that has published no version is stated by the empty state's own explanation
          rather than twice. */}
      {listing.versions.length === 0 ? null : (
        <p>{describeVersionTotal(listing.version_total, listing.versions.length)}</p>
      )}

      {listing.versions.length === 0 ? (
        <EmptyState
          heading={NO_VERSIONS_HEADING}
          explanation={NO_VERSIONS_EXPLANATION}
          headingLevel={3}
        />
      ) : (
        <ol className="item-list">
          {listing.versions.map((version: ListingVersion): JSX.Element => {
            const isCurrent =
              props.currentVersion !== null && props.currentVersion.id === version.id;
            return (
              <li className="item-list__item" key={version.id}>
                <h3>{`Version ${version.version_string}`}</h3>
                {isCurrent ? (
                  <p>
                    <strong>{`${CURRENT_VERSION_LABEL}:`}</strong> this is the current version, and
                    the version the measured evidence above belongs to.
                  </p>
                ) : null}
                <p>
                  Published <Timestamp value={version.created_at} />.
                </p>
                {hasText(version.notes) ? <p>{version.notes}</p> : null}
                <ClaimList
                  claims={claimsForVersion(listing.claims, version.id)}
                  emptyNote={NO_VERSION_CLAIMS_NOTE}
                />
                {isCurrent ? (
                  <p>
                    {listing.report_id === null ? (
                      NO_REPORT_LABEL
                    ) : (
                      <Link to={`/reports/${encodeURIComponent(listing.report_id)}`}>
                        {REPORT_LINK_LABEL}
                      </Link>
                    )}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * What the listing does not claim, and how it is offered: every limitation the claims the page
 * carries state, its license, its pricing model and the offer models it makes.
 *
 * The limitations are collected from the claims rather than typed anywhere, and the repeats are
 * dropped, so a listing whose two versions state the same caveat states it once here. The pricing
 * model names the kind of offer and never an amount: the amount is recorded by the simulated
 * checkout from the transaction the service returns, which is where the currency and disclosure
 * labels come from.
 */
function OfferingSection(props: { readonly listing: ListingDetail }): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-offering-heading`;
  const listing = props.listing;
  const limitations = collectLimitations(listing.claims);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{OFFERING_HEADING}</h2>

      <h3>{LIMITATIONS_HEADING}</h3>
      {limitations.length === 0 ? (
        <p>{NO_LIMITATIONS_NOTE}</p>
      ) : (
        <ul>
          {limitations.map(
            (limitation: string, index: number): JSX.Element => (
              // Two claims may state the identical limitation, and the identical text would make an
              // unstable key, so the collected position is what identifies a row here.
              <li key={`${listing.id}-limitation-${index}`}>{limitation}</li>
            ),
          )}
        </ul>
      )}

      <h3>{OFFERING_FACTS_HEADING}</h3>
      <ul className="item-list">
        <Fact label={LICENSE_ROW_LABEL}>{listing.license_code}</Fact>
        <Fact label={PRICING_MODEL_ROW_LABEL}>{describePricingModel(listing.pricing_model)}</Fact>
        <Fact label={OFFER_MODELS_ROW_LABEL}>
          {listing.offer_models.length === 0
            ? NO_OFFER_MODELS_NOTE
            : listing.offer_models.map(describeOfferModel).join(", ")}
        </Fact>
      </ul>
      <p>{PRICING_MODEL_NOTE}</p>
    </section>
  );
}

/**
 * The buyer's simulated checkout: the version being bought and the offer model to record, with the
 * recording itself left to the panel that owns it.
 *
 * The one piece of state here is the version the reader chose, and it is deliberately not the
 * answer: the version used is resolved on every render as the chosen one when it is still one of
 * this listing's versions and the current version otherwise. That is what keeps a selection from
 * outliving the listing it was made for — a refresh that leaves the chosen version gone falls back
 * to the current version instead of sending an identifier the service would refuse.
 *
 * The selector is rendered only when the listing has published more than one version, because a
 * control with a single option asks a reader to choose what there is no choice about. The panel
 * receives the listing, that version, the claims that version makes and the pricing model the
 * listing row declares — the version's own offers, which are the ones the service prices it at — and
 * nothing else: it names no price, computes no amount and reads no currency from here.
 */
function CheckoutSection(props: {
  readonly listing: ListingDetail;
  readonly currentVersion: ListingVersion | null;
}): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-checkout-heading`;
  const versionFieldId = `${idPrefix}-version`;
  const versionHintId = `${idPrefix}-version-hint`;
  const [chosenVersionId, setChosenVersionId] = useState<string | null>(null);

  // The selected demo account, resolved on every render: the shell re-renders this route when the
  // switcher's selection changes, so a render-time read follows it. The version selector and the panel
  // below exist only to record a simulated transaction, and that write is the buyer's, so both are
  // withheld from an account the service would refuse with `403` — the selector alone would offer a
  // choice with nothing to record it. No account selected keeps the section exactly as it was: the
  // panel's own explanation answers for the missing account.
  const selectedAccount = findDemoAccount(getSelectedDemoAccountId());
  const canWriteAsBuyer = selectedAccount === null || selectedAccount.role === "buyer";

  const versions = props.listing.versions;
  const chosenVersion =
    versions.find(
      (version: ListingVersion): boolean => version.id === chosenVersionId,
    ) ?? props.currentVersion;

  function handleVersionChange(event: ChangeEvent<HTMLSelectElement>): void {
    setChosenVersionId(event.target.value);
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{CHECKOUT_HEADING}</h2>
      <p>{CHECKOUT_INTRO}</p>

      {selectedAccount !== null && !canWriteAsBuyer ? (
        <EmptyState
          heading={CHECKOUT_ROLE_HEADING}
          headingLevel={3}
          explanation={buyerRoleExplanation(selectedAccount, "The simulated checkout")}
        />
      ) : chosenVersion === null ? (
        <EmptyState
          heading={NOTHING_TO_BUY_HEADING}
          explanation={NOTHING_TO_BUY_EXPLANATION}
          headingLevel={3}
        />
      ) : (
        <>
          {versions.length > 1 ? (
            <div className="field">
              <label className="field__label" htmlFor={versionFieldId}>
                {VERSION_SELECT_LABEL}
              </label>
              <select
                id={versionFieldId}
                value={chosenVersion.id}
                onChange={handleVersionChange}
                aria-describedby={versionHintId}
              >
                {versions.map(
                  (version: ListingVersion): JSX.Element => (
                    <option key={version.id} value={version.id}>
                      {version.version_string}
                    </option>
                  ),
                )}
              </select>
              <p className="field__hint" id={versionHintId}>
                {VERSION_SELECT_HINT}
              </p>
            </div>
          ) : null}
          <CheckoutPanel
            listingId={props.listing.id}
            listingVersionId={chosenVersion.id}
            versionClaims={claimsForVersion(props.listing.claims, chosenVersion.id)}
            listingModel={props.listing.pricing_model}
          />
        </>
      )}
    </section>
  );
}

/**
 * The listing page's content once the read has returned a listing: the status notice, the title
 * block with the facts a reader places the listing by, then the claims-versus-evidence pair, the
 * version history, the offering, and the three buyer surfaces and the operator's panel.
 *
 * The current version is the first entry of the version history, which is the order the payload
 * states — newest first — and the version the listing's linked evidence is measured against. The
 * two facts are the same fact, so it is derived once here and passed down rather than recomputed
 * per section, and a listing that has published no version yields `null` rather than an invented
 * value.
 */
function ListingContent(props: {
  readonly listing: ListingDetail;
  readonly status: ListingStatus;
  readonly keptBecauseNotReturned: boolean;
  readonly isOperator: boolean;
  readonly onStatusChanged: (status: ListingStatus) => void;
}): JSX.Element {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const inquiryHeadingId = `${idPrefix}-inquiry-heading`;
  const challengeHeadingId = `${idPrefix}-challenge-heading`;
  const moderationHeadingId = `${idPrefix}-moderation-heading`;
  const currentVersion = props.listing.versions[0] ?? null;

  // The selected demo account, resolved on every render: the shell re-renders this route when the
  // switcher's selection changes, so a render-time read follows it. The inquiry and the challenge
  // below are both the buyer's writes, and the service refuses every other role with `403`, so a
  // surface an account cannot use is not offered it — the rule `/developer` already follows for a
  // half its account holds no role for. No read here is gated: reading a listing is public, and the
  // panel below is gated on the role already resolved by the page. A visitor who has selected no
  // account keeps every surface as it was, and each write's own explanation answers for the account.
  const selectedAccount = findDemoAccount(getSelectedDemoAccountId());
  const canWriteAsBuyer = selectedAccount === null || selectedAccount.role === "buyer";

  return (
    <>
      {/* The status notice comes before the title block, so a reader opening this address from a
          search result meets the state the listing is in before anything else. */}
      <ListingStatusNotice
        status={props.status}
        keptBecauseNotReturned={props.keptBecauseNotReturned}
      />

      <section aria-labelledby={headingId}>
        <h1 id={headingId}>{props.listing.title}</h1>
        <p>{props.listing.summary}</p>
        <ListingFacts
          listing={props.listing}
          status={props.status}
          currentVersion={currentVersion}
        />
      </section>

      <ClaimsAndEvidenceSection listing={props.listing} currentVersion={currentVersion} />
      <VersionHistorySection listing={props.listing} currentVersion={currentVersion} />
      <OfferingSection listing={props.listing} />

      {/* The buyer's inquiry sits below the evidence on purpose: a reader is asked to make contact
          with a listing after reading what it claims and what was measured against it, never before. */}
      <section aria-labelledby={inquiryHeadingId}>
        <h2 id={inquiryHeadingId}>{INQUIRY_HEADING}</h2>
        <p>{INQUIRY_INTRO}</p>
        {selectedAccount !== null && !canWriteAsBuyer ? (
          <EmptyState
            heading={INQUIRY_ROLE_HEADING}
            headingLevel={3}
            explanation={buyerRoleExplanation(selectedAccount, "An inquiry")}
          />
        ) : (
          <InquiryForm listingId={props.listing.id} />
        )}
      </section>

      <CheckoutSection listing={props.listing} currentVersion={currentVersion} />

      <section aria-labelledby={challengeHeadingId}>
        <h2 id={challengeHeadingId}>{CHALLENGE_HEADING}</h2>
        <p>{CHALLENGE_INTRO}</p>
        {selectedAccount !== null && !canWriteAsBuyer ? (
          <EmptyState
            heading={CHALLENGE_ROLE_HEADING}
            headingLevel={3}
            explanation={buyerRoleExplanation(selectedAccount, "A challenge")}
          />
        ) : (
          <ChallengeForm listingId={props.listing.id} />
        )}
      </section>

      {/* The operator's panel is rendered for the operator role alone. Every other role sees no
          moderation control at all rather than a control that refuses it, because a row of dead
          buttons reads as available and then declines. */}
      {props.isOperator ? (
        <section aria-labelledby={moderationHeadingId}>
          <h2 id={moderationHeadingId}>{MODERATION_HEADING}</h2>
          <p>{MODERATION_INTRO}</p>
          <ModerationActions
            listingId={props.listing.id}
            currentStatus={props.status}
            onStatusChanged={props.onStatusChanged}
          />
        </section>
      ) : null}
    </>
  );
}

/**
 * The listing page: one read of one listing, and the surfaces a visitor acts through on it.
 *
 * It owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which renders
 * the header, the navigation, the demonstration banner and the account switcher — must not wrap it
 * in another landmark. Reading a listing needs no demo account, so the one request this page makes
 * is the public listing read, which `../api-client` asks as the selected synthetic account when one
 * is selected — that is how the operator reads a hidden listing with the history it keeps — and as
 * nobody when none is; the writes it offers carry that account too, which a reader selects in the
 * shell.
 *
 * Three readings of one address are the address's own rather than failures of a request: an address
 * that names no listing (or one taken out of public view) renders the absent-state page, a listing
 * being read renders its heading with an announced message so a slow answer is never a blank screen,
 * and a listing the service returned in a moderated state renders in full with that state stated.
 *
 * The selected demo account is read at render time, so the operator's panel follows whichever role
 * the account switcher holds when this page renders and is re-read on every re-render — including
 * the re-read a moderation action causes.
 */
export function ListingDetailPage(): JSX.Element {
  const params = useParams();
  // `noUncheckedIndexedAccess` types the route's parameter as possibly absent. An address with no
  // segment at all cannot name a listing — the route always supplies one — and the absent state is
  // what such an address already means, so it needs no request of its own.
  const listingId = params["id"] ?? "";
  const headingId = `${useId()}-heading`;

  const [readState, setReadState] = useState<ReadState>({ kind: "loading" });
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const [operatorEdit, setOperatorEdit] = useState<OperatorEdit | null>(null);

  // The listing the last successful read returned, kept so that a refresh for the same address can
  // tell a read that replaced a listing from a read that has nothing to replace. A ref rather than
  // state: nothing renders from it, and the effect below must read it without re-rendering.
  const heldListing = useRef<ListingDetail | null>(null);

  const refresh = useCallback((): void => {
    setRefreshToken((current: number): number => current + 1);
  }, []);

  useEffect((): (() => void) => {
    if (listingId === "") {
      setReadState({ kind: "missing" });
      return (): void => {};
    }
    // A read of a listing already on screen keeps it in place while it is in flight: an operator who
    // has just moderated this listing must not watch its history disappear behind a loading message.
    const replacesHeldListing = heldListing.current !== null && heldListing.current.id === listingId;
    if (!replacesHeldListing) {
      setReadState({ kind: "loading" });
    }
    // The flag is what keeps a slow answer for a listing the reader has already left from writing
    // over the listing now on screen, which a plain sequence of requests would do.
    let cancelled = false;
    void getListing(listingId).then(
      (listing: ListingDetail): void => {
        if (cancelled) {
          return;
        }
        heldListing.current = listing;
        setOperatorEdit(null);
        setReadState({ kind: "ready", listing });
      },
      (caught: unknown): void => {
        if (cancelled) {
          return;
        }
        // A moderation action can take the listing out of the public read. The history on screen is
        // the one the action was taken on, and dropping it for the absent state at that exact moment
        // would hide the record the operator is looking at, so it is retained and the notice above
        // the title says why.
        if (replacesHeldListing && failureStatus(caught) === 404) {
          setOperatorEdit((current: OperatorEdit | null): OperatorEdit | null =>
            current === null || current.listingId !== listingId
              ? current
              : { ...current, keptBecauseNotReturned: true },
          );
          return;
        }
        heldListing.current = null;
        setReadState(readFailureState(caught));
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [listingId, refreshToken]);

  const listing = readState.kind === "ready" ? readState.listing : null;
  // An edit describes the listing it was recorded for and no other, so one recorded for a listing the
  // reader has left is ignored rather than applied to whatever is on screen.
  const edit =
    listing !== null && operatorEdit !== null && operatorEdit.listingId === listing.id
      ? operatorEdit
      : null;
  const status =
    listing === null ? null : edit === null ? listing.status : edit.status;
  const isOperator = findDemoAccount(getSelectedDemoAccountId())?.role === "operator";

  function handleStatusChanged(nextStatus: ListingStatus): void {
    if (listing === null) {
      return;
    }
    // The returned status is adopted at once — it is the status the operator just asked for — and the
    // read that follows is what confirms it. The service stays the authority: a successful read
    // clears the adopted status and every section renders the listing as it now stands.
    setOperatorEdit({
      listingId: listing.id,
      status: nextStatus,
      keptBecauseNotReturned: false,
    });
    refresh();
  }

  if (readState.kind === "missing") {
    // The absent-state page owns the landmark and the heading, so nothing of this page renders
    // beside it: it is returned in place of the whole page rather than inside one.
    return <NotFound heading={NOT_FOUND_HEADING} message={NOT_FOUND_MESSAGE} />;
  }

  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` lets that link move
    // focus here without putting the landmark itself in the tab order.
    <main id="main-content" tabIndex={-1} className="page page-listing-detail">
      {readState.kind === "loading" ? (
        <section aria-labelledby={headingId}>
          <h1 id={headingId}>{PAGE_HEADING}</h1>
          <div className="status-region" role="status" aria-live="polite">
            <p>{LOADING_MESSAGE}</p>
          </div>
        </section>
      ) : readState.kind === "failed" ? (
        <section aria-labelledby={headingId}>
          <h1 id={headingId}>{PAGE_HEADING}</h1>
          <ErrorNotice error={readState.error} onRetry={refresh} />
        </section>
      ) : (
        <ListingContent
          listing={readState.listing}
          status={status ?? readState.listing.status}
          keptBecauseNotReturned={edit === null ? false : edit.keptBecauseNotReturned}
          isOperator={isOperator}
          onStatusChanged={handleStatusChanged}
        />
      )}
    </main>
  );
}

// The default export is what the shell's route table imports for `/listings/:id`, the named export
// is the component's own name, and `ListingDetail` follows the route-name convention its sibling
// pages export (`Compare` in compare.tsx, `Listings` in listings.tsx), so the route table compiles
// whichever import form it uses. All three name the same component.
export { ListingDetailPage as ListingDetail };
export default ListingDetailPage;
