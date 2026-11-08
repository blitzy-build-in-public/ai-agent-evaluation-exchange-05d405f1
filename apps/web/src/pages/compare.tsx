/**
 * The `/compare` route: two to four listings side by side, each showing what its developer
 * claims beside the evidence that was measured against it.
 *
 * Five decisions hold this page together, and each is one a later reader could invert.
 *
 * **The address is the whole of the selection.** `?ids=` is what the compare control on a listing
 * card writes and what this page reads, so a comparison is an address a buyer can keep, send or
 * reopen, and no context provider, shared module or stored key is involved. Every control here
 * changes that parameter and nothing else: the page renders from the address, and removing a
 * listing rewrites it.
 *
 * **A selection the contract refuses is answered without a request.** Fewer than
 * `COMPARE_MIN_IDS` identifiers is the row's own prompt to add a listing, and more than
 * `COMPARE_MAX_IDS` is explained before anything is sent: `GET /compare` answers `400` for both,
 * and this page can say what is wrong without asking a service that would refuse it. Neither state
 * depends on the service being reachable.
 *
 * **An identifier that names no listing costs that column and nothing else.** The comparison route
 * answers for every identifier at once, so one identifier that names no listing — or one an
 * operator has hidden — makes the whole read `404`, and the response says nothing about which
 * identifier failed. The requested identifiers are therefore asked for one by one through the
 * public listing read, and the columns that survive are compared again. Only when exactly one
 * survives is its own listing read turned into that column, because the comparison route cannot be
 * asked for a single listing. An absent column is explained where the reader is looking rather than
 * by failing the page.
 *
 * **The page holds no rule of its own.** It derives no outcome, counts no case, computes no amount
 * and prints no label it did not receive: the provenance a column shows arrives from the service,
 * and the closed vocabulary it prints — `SAMPLE`, `VERIFIED-IN-DEMO`, `structured output on fixture
 * set only`, `No SGI report yet`, `DEMO` — belongs to `@adem/shared` and to the components that
 * render it. It also knows nothing of fees or sponsored placements: a comparison shows claims,
 * measured evidence, limitations, license and pricing model, and buying an evaluation buys no
 * influence over an outcome.
 *
 * **The comparison reflows rather than scrolls.** The blocks `.compare-table` lays out stack into
 * one reading column each below its breakpoint, so no column has to be reached sideways at 360px
 * (criterion 9). Nothing here sets a width, and every control is a real `<button>` or `<a>` with the
 * workspace's focus ring.
 *
 * Presentation only, with one API caller: `../api-client` is the only module this page reaches the
 * service through, so no URL, header, response or transport failure is handled here.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { COMPARE_ID_SEPARATOR, COMPARE_MAX_IDS, COMPARE_MIN_IDS } from "@adem/shared";
import type { CompareEntry, ListingClaim, ListingDetail } from "@adem/shared";
import { ApiClientError, compareListings, getListing, getSelectedDemoAccountId } from "../api-client";
import { CompareTable } from "../components/compare-table";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { InquiryForm } from "../components/inquiry-form";
import { findDemoAccount } from "../data/demo-accounts";
import type { DemoAccount } from "../data/demo-accounts";

/**
 * The compare query's identifier parameter, spelled exactly as `GET /compare?ids=a,b,c`, as the
 * compare route's query schema and as `listing-card.tsx`'s compare control spell it. `@adem/shared`
 * carries the separator and the two bounds and no constant for the parameter's own name, so it is
 * named once here, at the page that reads it.
 */
const COMPARE_IDS_PARAMETER = "ids";

/** The route this page owns, used by the links that rebuild the selection from part of it. */
const COMPARE_PATH = "/compare";

/** Where a reader chooses another listing; a listing card's compare control writes `ids` there. */
const LISTINGS_PATH = "/listings";

/** The page's own heading, and the one `<h1>` of the route. */
const PAGE_HEADING = "Compare listings";

/** What a comparison shows, in the order the page renders it. */
const PAGE_INTRO =
  "Two to four listings side by side: what each developer claims, the evidence the standard " +
  "measured against the listing's latest version, the SGI version that evidence names, the " +
  "limitations the listing states, and the license and pricing model it is offered under.";

/**
 * The disclosure this view owes a reader, stated wherever an outcome is shown: an evaluation's
 * outcome is a reading of the recorded test evidence, and nothing a buyer can pay for changes it.
 */
const EVIDENCE_DISCLOSURE =
  "Measured evidence is what the standard recorded against a version. Buying an evaluation never " +
  "guarantees a pass: an outcome depends on test evidence only.";

/** The control that sends a reader to the listings to widen the selection. */
const ADD_ANOTHER_LABEL = "Add another listing";

/** The control that drops one listing from the comparison, on a column or on an absent block. */
const REMOVE_FROM_COMPARISON_LABEL = "Remove from comparison";

/** The way back to browsing, offered beside an absent column and in the selection area. */
const BROWSE_LABEL = "Browse listings";

/** The heading over the columns that could be loaded. */
const SIDE_BY_SIDE_HEADING = "Side by side";

/** The heading over the blocks that explain a requested listing which could not be loaded. */
const ABSENT_SECTION_HEADING = "Listings that could not be shown";

/**
 * The heading of one absent column. It is rendered at `h3` so the outline stays
 * `h1 → h2 → h3` under the page's single `<h1>` and beside `compare-table.tsx`'s per-listing `h3`.
 */
const ABSENT_BLOCK_HEADING = "Listing not shown in this comparison";

/**
 * The id of the sentence that states the lower bound of a comparison. It is rendered only while the
 * selection holds exactly `COMPARE_MIN_IDS` listings, and the remove controls are described by it
 * then: removing one of the last two leaves a single listing, and the reader is told so before
 * acting rather than after.
 */
const MINIMUM_IDS_NOTICE_ID = "compare-minimum-selection-notice";

/** The polite status line a comparison in flight shows, so the state is announced, never a blank. */
const LOADING_MESSAGE = "Loading the comparison.";

/** The code the contract carries for a `400`; the refusal the page raises for itself is one. */
const VALIDATION_ERROR_CODE = "validation_error";

/**
 * The identifiers named by an `ids` parameter: split on the separator the contract joins them with,
 * trimmed, and with the empty tokens a stray or trailing separator produces dropped.
 *
 * A `null` parameter — no comparison asked for at all — yields the empty list. Nothing else is
 * repaired here: a single odd token is the reader's own address, and the page answers it with the
 * state its count implies rather than quietly rewriting what was asked for.
 */
function parseCompareIds(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return value
    .split(COMPARE_ID_SEPARATOR)
    .map((token: string): string => token.trim())
    .filter((token: string): boolean => token !== "");
}

/** The address that names a comparison of exactly these identifiers, in this order. */
function comparisonPath(ids: readonly string[]): string {
  if (ids.length === 0) {
    return COMPARE_PATH;
  }
  return `${COMPARE_PATH}?${COMPARE_IDS_PARAMETER}=${ids.join(COMPARE_ID_SEPARATOR)}`;
}

/**
 * The HTTP status a thrown value carries, or `null` when it carries none.
 *
 * The status is read structurally rather than by class, exactly as `error-notice.tsx` and
 * `inquiry-form.tsx` read it, so a failure raised from any path is understood the same way. Only a
 * whole, non-negative number counts; anything else — a bare string, a primitive, an object with no
 * status — is a failure this page cannot place and never a `404` it resolves per identifier.
 */
function failureStatus(value: unknown): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  try {
    const status = Reflect.get(value, "status");
    return typeof status === "number" && Number.isInteger(status) && status >= 0 ? status : null;
  } catch {
    return null;
  }
}

/** Whether the selection is one the compare contract accepts. */
function isComparableCount(count: number): boolean {
  return count >= COMPARE_MIN_IDS && count <= COMPARE_MAX_IDS;
}

/** The sentence that states how much of a comparison the address currently names. */
function selectionSummary(count: number): string {
  if (count === 0) {
    return "No listing is selected for comparison.";
  }
  if (count === 1) {
    return `One listing is selected, and a comparison shows between ${COMPARE_MIN_IDS} and ${COMPARE_MAX_IDS} listings.`;
  }
  return `${count} listings are selected, of the ${COMPARE_MAX_IDS} a comparison can show.`;
}

/** Why the reader cannot add a fifth listing, stated before the control is offered rather than after. */
const AT_LIMIT_EXPLANATION = `A comparison holds at most ${COMPARE_MAX_IDS} listings. Remove one from a column to compare another.`;


/**
 * The limitations a listing's claims state, in the order the claims are read.
 *
 * It is the one field of a column the listing's own representation does not carry as a list, and it
 * is collected here only for the single column that has to be built from a listing read — see
 * {@link compareColumnFromListing}. A claim that states none contributes nothing, so a column never
 * renders an empty entry where a limitation would be.
 */
function collectStatedLimitations(claims: readonly ListingClaim[]): string[] {
  return claims
    .map((claim: ListingClaim): string => claim.limitation)
    .filter((limitation: string): boolean => limitation.trim() !== "");
}

/**
 * One column, built from a listing's own public representation instead of from the comparison
 * route's.
 *
 * This is reached in exactly one situation: the comparison read answered `404` because at least one
 * requested identifier names no listing, and exactly one identifier survived the per-identifier
 * reads. A comparison of one listing cannot be asked for — the route refuses fewer than
 * {@link COMPARE_MIN_IDS} identifiers with a `400` — so the survivor's claims, measured evidence,
 * license and pricing model come from the listing read that already resolved it. Every field is
 * taken as the service stated it: this function renames the listing's fields into a column and
 * derives no outcome, no count, no label and no amount.
 */
function compareColumnFromListing(listing: ListingDetail): CompareEntry {
  return {
    listing_id: listing.id,
    title: listing.title,
    claims: listing.claims,
    report_id: listing.report_id,
    outcome: listing.outcome,
    standard_version_id: listing.standard_version_id,
    label: listing.label,
    limitations: collectStatedLimitations(listing.claims),
    license_code: listing.license_code,
    pricing_model: listing.pricing_model,
  };
}

/** One requested identifier with the listing it resolved to, or `null` when none did. */
interface ListingProbe {
  /** The identifier as the address named it. */
  readonly id: string;
  /** The listing the identifier resolved to, or `null` when it names none. */
  readonly listing: ListingDetail | null;
}

/** One identifier asked for on its own; a `404` is the answer that it names no listing. */
async function probeListing(id: string): Promise<ListingProbe> {
  try {
    return { id, listing: await getListing(id) };
  } catch (error: unknown) {
    if (failureStatus(error) === 404) {
      return { id, listing: null };
    }
    throw error;
  }
}

/**
 * The columns of a comparison whose one read answered `404`: each requested identifier is asked for
 * on its own, and the listings that survive are compared again.
 *
 * Two or more survivors are put back through the comparison route, so their columns are the ones the
 * route builds; a single survivor is the column {@link compareColumnFromListing} builds, because no
 * comparison of one listing exists to ask for. No survivor returns no column at all, and the page
 * then explains every requested identifier rather than failing.
 *
 * A failure that is not a `404` on any of these reads — the listing read of an identifier that is
 * neither resolvable nor absent, or the second comparison itself — is raised to the page, which
 * renders it as the failure it is.
 */
async function compareSurvivingListings(
  ids: readonly string[],
): Promise<readonly CompareEntry[]> {
  const probes = await Promise.all(ids.map(probeListing));
  const surviving = probes.filter((probe: ListingProbe): boolean => probe.listing !== null);

  if (surviving.length >= COMPARE_MIN_IDS) {
    const survivorIds = surviving.map((probe: ListingProbe): string => probe.id);
    return (await compareListings(survivorIds)).entries;
  }

  const only = surviving[0];
  if (only === undefined || only.listing === null) {
    return [];
  }
  return [compareColumnFromListing(only.listing)];
}

/**
 * The comparison of the identifiers the address names.
 *
 * The comparison route is the read that answers with every column at once, and it is what this page
 * uses whenever it can. Its `404` is the one failure the page resolves itself, because that
 * response carries no column and does not say which identifier caused it; every other failure is
 * left to the page to render as it stands.
 */
async function loadComparison(ids: readonly string[]): Promise<readonly CompareEntry[]> {
  try {
    const comparison = await compareListings(ids);
    return comparison.entries;
  } catch (error: unknown) {
    if (failureStatus(error) !== 404) {
      throw error;
    }
    return await compareSurvivingListings(ids);
  }
}

/**
 * What the page knows about the comparison of the identifiers it is currently showing.
 *
 * `idsKey` is the address's own identifier list, and a state whose key is not the key being rendered
 * is a state for a selection the reader has already left: the page shows the comparison in flight
 * rather than the previous selection's columns under the new address. `error` is `unknown` because
 * it is whatever a call in `../api-client` threw, and nothing here narrows it beyond the status it
 * may carry.
 */
type ComparisonFetch =
  | { readonly kind: "loading"; readonly idsKey: string }
  | { readonly kind: "ready"; readonly idsKey: string; readonly entries: readonly CompareEntry[] }
  | { readonly kind: "failed"; readonly idsKey: string; readonly error: unknown };

/** The entry a requested identifier resolved to, or `undefined` when none did. */
function findEntry(
  entries: readonly CompareEntry[],
  id: string,
): CompareEntry | undefined {
  return entries.find((entry: CompareEntry): boolean => entry.listing_id === id);
}

/** What removing one of the last two listings does, stated before the reader acts. */
const MINIMUM_IDS_EXPLANATION = `A comparison needs at least ${COMPARE_MIN_IDS} listings, so removing one leaves a single listing and this page then asks for another.`;

/** The prompt to add a listing, in the two shapes the address can make it necessary. */
function promptExplanation(count: number): string {
  if (count === 0) {
    return `A comparison sets between ${COMPARE_MIN_IDS} and ${COMPARE_MAX_IDS} listings side by side, so it needs at least two. Choose one from the listings, then add another: the compare control on a card writes both into this address.`;
  }
  return `This address names one listing, and a comparison sets between ${COMPARE_MIN_IDS} and ${COMPARE_MAX_IDS} listings side by side, so it needs at least two. Add one more to compare them.`;
}

/** Why a selection above the upper bound is explained instead of sent. */
function tooManyExplanation(count: number): string {
  return `A comparison sets at most ${COMPARE_MAX_IDS} listings side by side, and this address names ${count}. Show the first ${COMPARE_MAX_IDS}, or browse the listings to choose another set.`;
}

/** The label of the control that rewrites an over-long selection to the four it can show. */
const TRIM_TO_BOUND_LABEL = `Show the first ${COMPARE_MAX_IDS} listings`;

/** What the page says about a `400`: nothing was written, and the address can be reset. */
const RESET_EXPLANATION =
  "This comparison could not be sent as the address asked for it. Resetting the selection clears " +
  "the address, and the listings are still there to choose from.";

/** The label of the control that clears an address the comparison route refuses. */
const RESET_LABEL = "Reset the selection";

/**
 * The sentence that says how much of a comparison could not be loaded, and which listings a reader
 * is therefore looking at.
 *
 * Both halves are stated by their own count, because the sentence describes the set that is on
 * screen: with one of two identifiers loaded, "each of them is explained below" would speak of a
 * single column, and the reader would look for a second one that is not there. The set that loaded
 * is named by its count — "the one listing that loaded", "the 3 listings that loaded" — and the
 * absent set by its own, singular or plural. A comparison in which nothing loaded keeps the wording
 * it has always carried, because then there is no listing to describe.
 */
function absentNote(absentCount: number, requestedCount: number, shownCount: number): string {
  const opening =
    absentCount === 1
      ? `One of the ${requestedCount} requested listings could not be loaded`
      : `${absentCount} of the ${requestedCount} requested listings could not be loaded`;
  if (shownCount === 0) {
    return `${opening}, so there is no listing to compare here yet. Each one is explained below, and browsing the listings is the way back.`;
  }

  const shown =
    shownCount === 1 ? "the one listing that loaded" : `the ${shownCount} listings that loaded`;
  const explained =
    absentCount === 1
      ? "The listing that could not be loaded is explained below."
      : `The ${absentCount} listings that could not be loaded are explained below.`;

  return `${opening}, so this comparison shows ${shown}. ${explained}`;
}

/** Why one requested identifier has no column, in words that hold whether or not other columns loaded. */
function absentExplanation(id: string): string {
  return `No listing could be loaded for the identifier "${id}". It may have been removed, or hidden from public view by moderation, and a comparison can only show the listings that load.`;
}

/** The heading over the buyer's inquiry inside one listing's block, at the level its groups use. */
const INQUIRY_HEADING = "Ask about this listing";

/** The state one block's footer shows in place of the inquiry form for an account that cannot send one. */
const INQUIRY_ROLE_HEADING = "Sending an inquiry needs a buyer account";

/**
 * Why a column's footer offers no inquiry form: which account is selected, which role the write needs
 * and where to choose one. `POST /inquiries` is the buyer's write, so the form is withheld from every
 * other role rather than offered and then refused, as `/developer` withholds a half its account holds
 * no role for. No account selected keeps the form as it was, with the write explaining the account;
 * the remove-from-comparison control beside it belongs to the comparison and stays in every case.
 */
function inquiryRoleExplanation(account: DemoAccount): string {
  return (
    `The selected demo account is ${account.display_label}, whose role is ${account.role}. An ` +
    "inquiry is the buyer's write, so the form is not shown for this account. Choose a buyer account " +
    "in the demo-account switcher in the page header to send one."
  );
}

/** Everything the rendered states read: the address's identifiers, the columns and the two actions. */
interface ComparisonProps {
  /** The identifiers the address names, in the order it names them. */
  readonly requestedIds: readonly string[];
  /** The columns that could be loaded, in the order the service returned them. */
  readonly entries: readonly CompareEntry[];
  /** The requested identifiers that produced no column, in the address's own order. */
  readonly unshownIds: readonly string[];
  /** Drops one identifier from the address and renders the comparison that remains. */
  readonly onRemove: (id: string) => void;
}

/**
 * One listing's block footer: the inquiry a buyer can send about the version being compared, and the
 * control that drops the listing from the comparison.
 *
 * Both belong to the column rather than to the page, which is why they are rendered through
 * `CompareTable`'s footer slot: a reader comparing four listings can ask about each one without
 * losing the others, and the remove control sits with the listing it removes.
 */
function renderColumnFooter(entry: CompareEntry, props: ComparisonProps): ReactNode {
  const removesOneOfTwo = props.requestedIds.length === COMPARE_MIN_IDS;
  // The selected demo account, resolved on every render, and whether this column can offer its
  // inquiry: the form is the buyer's write and the service refuses every other role with `403`. The
  // remove control below it is rendered for every account alike, because dropping a listing from the
  // comparison writes nothing and belongs to the comparison rather than to a role.
  const selectedAccount = findDemoAccount(getSelectedDemoAccountId());

  return (
    <>
      {selectedAccount !== null && selectedAccount.role !== "buyer" ? (
        <EmptyState
          heading={INQUIRY_ROLE_HEADING}
          headingLevel={4}
          explanation={inquiryRoleExplanation(selectedAccount)}
        />
      ) : (
        <>
          <h4>{INQUIRY_HEADING}</h4>
          <InquiryForm listingId={entry.listing_id} />
        </>
      )}
      <button
        type="button"
        className="button button--secondary"
        aria-label={`${REMOVE_FROM_COMPARISON_LABEL}: ${entry.title}`}
        aria-describedby={removesOneOfTwo ? MINIMUM_IDS_NOTICE_ID : undefined}
        onClick={() => {
          props.onRemove(entry.listing_id);
        }}
      >
        {REMOVE_FROM_COMPARISON_LABEL}
      </button>
    </>
  );
}

/** The way out of an absent column: back to browsing, or on with the listings that remain. */
function renderAbsentActions(id: string, props: ComparisonProps): ReactNode {
  const removesOneOfTwo = props.requestedIds.length === COMPARE_MIN_IDS;

  return (
    <ul>
      <li>
        <Link to={LISTINGS_PATH}>{BROWSE_LABEL}</Link>
      </li>
      <li>
        <button
          type="button"
          className="button button--secondary"
          aria-label={`${REMOVE_FROM_COMPARISON_LABEL}: ${id}`}
          aria-describedby={removesOneOfTwo ? MINIMUM_IDS_NOTICE_ID : undefined}
          onClick={() => {
            props.onRemove(id);
          }}
        >
          {REMOVE_FROM_COMPARISON_LABEL}
        </button>
      </li>
    </ul>
  );
}

/**
 * The comparison itself: the columns that loaded, one block each, and — for every requested
 * identifier that produced none — its own block naming the identifier it could not show.
 *
 * The note above them states how many of the requested listings could not be loaded, and it is a
 * polite status region because it appears once the read resolves: without it, a reader would see a
 * comparison quietly missing a column. A page whose every requested listing failed renders the
 * blocks and the note and no comparison at all, rather than a failure: an identifier that names no
 * listing is an ordinary state of an exchange where listings are moderated.
 */
function renderReadyState(props: ComparisonProps): JSX.Element {
  return (
    <>
      {props.unshownIds.length === 0 ? null : (
        <p className="status-region" role="status">
          {absentNote(props.unshownIds.length, props.requestedIds.length, props.entries.length)}
        </p>
      )}

      {props.entries.length === 0 ? null : (
        <section aria-labelledby="compare-side-by-side-heading">
          <h2 id="compare-side-by-side-heading">{SIDE_BY_SIDE_HEADING}</h2>
          <CompareTable
            entries={props.entries}
            renderColumnFooter={(entry: CompareEntry): ReactNode => renderColumnFooter(entry, props)}
          />
        </section>
      )}

      {props.unshownIds.length === 0 ? null : (
        <section aria-labelledby="compare-absent-heading">
          <h2 id="compare-absent-heading">{ABSENT_SECTION_HEADING}</h2>
          {props.unshownIds.map(
            (id: string): JSX.Element => (
              <EmptyState
                key={id}
                headingLevel={3}
                heading={ABSENT_BLOCK_HEADING}
                explanation={absentExplanation(id)}
                action={renderAbsentActions(id, props)}
              />
            ),
          )}
        </section>
      )}
    </>
  );
}

/**
 * The selection the comparison contract refuses for its size: named as the `400` it would be
 * answered with, with the bound stated in words and the address itself offered as the way out.
 *
 * No request is sent for this state — the route refuses more than `COMPARE_MAX_IDS` identifiers —
 * so the refusal here is the page's own, carrying the status and the code the contract carries for
 * a `400`. The trim control rewrites the address to the four listings a comparison can show.
 */
function renderTooManyState(requestedIds: readonly string[]): JSX.Element {
  const count = requestedIds.length;

  return (
    <ErrorNotice
      error={
        new ApiClientError(
          400,
          VALIDATION_ERROR_CODE,
          `A comparison shows between ${COMPARE_MIN_IDS} and ${COMPARE_MAX_IDS} listings; ${count} were selected.`,
        )
      }
      detail={
        <>
          <p>{tooManyExplanation(count)}</p>
          <p>
            <Link to={comparisonPath(requestedIds.slice(0, COMPARE_MAX_IDS))}>
              {TRIM_TO_BOUND_LABEL}
            </Link>
          </p>
        </>
      }
    />
  );
}

/**
 * The comparison in flight. The message is a polite status region rather than an empty grid, so a
 * screen-reader user is told what is happening instead of finding a page with nothing in it.
 */
function renderLoadingState(): JSX.Element {
  return (
    <p className="status-region" role="status">
      {LOADING_MESSAGE}
    </p>
  );
}

/**
 * A comparison that failed. Every failure renders through `ErrorNotice`, which owns the sentence for
 * the status it carries, and the retry control reads the address's identifiers again.
 *
 * A `400` additionally gets the way out of an address the route refuses: the page states that
 * nothing was written and offers the comparison without a selection, which is a valid request by
 * construction because it asks for none.
 */
function renderFailureState(error: unknown, onRetry: () => void): JSX.Element {
  if (failureStatus(error) !== 400) {
    return <ErrorNotice error={error} onRetry={onRetry} />;
  }

  return (
    <ErrorNotice
      error={error}
      onRetry={onRetry}
      detail={
        <>
          <p>{RESET_EXPLANATION}</p>
          <p>
            <Link to={COMPARE_PATH}>{RESET_LABEL}</Link>
          </p>
        </>
      }
    />
  );
}

/** The prompt to add a listing, which is what a comparison of fewer than two identifiers needs. */
const PROMPT_HEADING = "Add a listing to compare";

/**
 * The `/compare` route: the comparison the address names, and the states the address can make
 * necessary without a request.
 *
 * The page owns the route's single `<main>` landmark and its single `<h1>`. Its heading outline is
 * `h1`, then one `h2` per rendered section — the prompt, the comparison, the blocks of the listings
 * that could not be shown — and, inside them, `compare-table.tsx`'s per-listing `h3` with their `h4`
 * groups and the absent blocks' `h3`, so no level is skipped.
 */
export function ComparePage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedIds = parseCompareIds(searchParams.get(COMPARE_IDS_PARAMETER));
  const idsKey = requestedIds.join(COMPARE_ID_SEPARATOR);

  // The retry count is a dependency of the read rather than part of the address: retrying a failure
  // re-asks for the comparison the reader is already looking at, and must not rewrite what it names.
  const [attempt, setAttempt] = useState(0);
  const [comparison, setComparison] = useState<ComparisonFetch>({ kind: "loading", idsKey });

  useEffect(() => {
    const ids = idsKey === "" ? [] : idsKey.split(COMPARE_ID_SEPARATOR);

    // Fewer than two or more than four identifiers is not a comparison the contract accepts, so no
    // request is sent for one: the page explains the bound itself, and the state a reader sees never
    // depends on a service answering a request the contract refuses.
    if (!isComparableCount(ids.length)) {
      return;
    }

    let cancelled = false;
    setComparison({ kind: "loading", idsKey });

    void loadComparison(ids).then(
      (entries: readonly CompareEntry[]): void => {
        if (!cancelled) {
          setComparison({ kind: "ready", idsKey, entries });
        }
      },
      (error: unknown): void => {
        if (!cancelled) {
          setComparison({ kind: "failed", idsKey, error });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [idsKey, attempt]);

  // A result for a selection the reader has already left is not shown: the comparison in flight is
  // the honest state, and it lasts until the read for the current address resolves.
  const current: ComparisonFetch =
    comparison.idsKey === idsKey ? comparison : { kind: "loading", idsKey };

  const unshownIds: readonly string[] =
    current.kind === "ready"
      ? requestedIds.filter(
          (id: string): boolean => findEntry(current.entries, id) === undefined,
        )
      : [];

  function removeFromComparison(id: string): void {
    const remaining = requestedIds.filter((candidate: string): boolean => candidate !== id);
    const next = new URLSearchParams(searchParams);

    // A selection the reader has emptied is the address without the parameter, which is the state
    // that asks for a listing; a selection of one keeps naming it, so the page can say so.
    if (remaining.length === 0) {
      next.delete(COMPARE_IDS_PARAMETER);
    } else {
      next.set(COMPARE_IDS_PARAMETER, remaining.join(COMPARE_ID_SEPARATOR));
    }

    setSearchParams(next);
  }

  function retry(): void {
    setAttempt((value: number): number => value + 1);
  }

  const count = requestedIds.length;
  const comparable = isComparableCount(count);

  let state: JSX.Element;
  if (!comparable) {
    state =
      count > COMPARE_MAX_IDS ? (
        renderTooManyState(requestedIds)
      ) : (
        <EmptyState
          heading={PROMPT_HEADING}
          explanation={promptExplanation(count)}
          action={<Link to={LISTINGS_PATH}>{BROWSE_LABEL}</Link>}
        />
      );
  } else if (current.kind === "loading") {
    state = renderLoadingState();
  } else if (current.kind === "failed") {
    state = renderFailureState(current.error, retry);
  } else {
    state = renderReadyState({
      requestedIds,
      entries: current.entries,
      unshownIds,
      onRemove: removeFromComparison,
    });
  }

  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` lets that link move
    // focus here without putting the landmark itself in the tab order.
    <main id="main-content" tabIndex={-1} className="page page-compare">
      <section aria-labelledby="compare-page-heading">
        <h1 id="compare-page-heading">{PAGE_HEADING}</h1>
        <p>{PAGE_INTRO}</p>
        <p>{EVIDENCE_DISCLOSURE}</p>
        <p>{selectionSummary(count)}</p>

        {/* The control that widens the comparison is offered only while the contract accepts one
            more listing; at the upper bound the reason is stated in its place, and below the lower
            bound the prompt's own action is what a reader needs. */}
        {count < COMPARE_MIN_IDS ? null : count < COMPARE_MAX_IDS ? (
          <p>
            <Link to={LISTINGS_PATH}>{ADD_ANOTHER_LABEL}</Link>
          </p>
        ) : (
          <p>{AT_LIMIT_EXPLANATION}</p>
        )}

        {/* Removing the last two listings leaves one, which is a different state of the page rather
            than more of this one, so the reader is told before the remove controls are used. */}
        {count === COMPARE_MIN_IDS ? (
          <p id={MINIMUM_IDS_NOTICE_ID}>{MINIMUM_IDS_EXPLANATION}</p>
        ) : null}
      </section>

      {state}
    </main>
  );
}

// The default export is what app.tsx's route table imports, `ComparePage` is the component's own
// name, and `Compare` follows the route-name convention its sibling pages use (Academy, Mission,
// NotFound) so the route table can import the page under whichever name it reads best with. All
// three name the same component on purpose.
export { ComparePage as Compare };
export default ComparePage;

