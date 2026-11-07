/**
 * The `/` route: the home page of the exchange, and the page the route walk starts from.
 *
 * Two jobs sit here. The page says what ADEM is and — in the same breath — what it is not, so a
 * visitor reads the honest version of the product before reading anything else; and it hands that
 * visitor four ways forward, into the listings, the comparison, the standard and the developer's own
 * surface. Every link is a route of this application: the API serves the built single-page app and
 * no documentation directory, so a link to a document would be answered with the app shell rather
 * than with the document it named.
 *
 * Five decisions shape the file, each stated here because a later reader could otherwise undo one of
 * them into a defect.
 *
 * **Both reads are public and go through `../api-client`.** The page holds no URL, no request header
 * and no call of its own: `listListings` and `listSponsoredSlots` are the whole of its I/O, and
 * neither needs a demo account, so opening the home page never depends on a selected role. The
 * selected demo account is the client's business and not this page's, which is why no write, no
 * header and no storage call appears below.
 *
 * **The sponsored block is a separate, labelled collection.** It renders after the organic results
 * and never inside them, its heading is the one-word label the closed vocabulary fixes, and every
 * item carries that same label beside the sponsor's fictional handle. Nothing here sorts, blends or
 * links a sponsorship into the listings, and the page holds no counter, no cookie and no tracking
 * script of any kind.
 *
 * **An empty, failed or other-placement sponsorship renders nothing at all** — no heading, no box,
 * no empty state and no error text. That is the requirement for this block rather than an oversight,
 * and it is why `../components/empty-state` explains the listings read and is never used for this
 * one: the absence of an advertisement is not a state a reader needs to be told about.
 *
 * **A failed listings read costs this page one block, not the page.** That block renders the error
 * notice with a retry which re-runs that one read, and everything else — the mission summary, the
 * routes, the sponsored block — stays as it was. A `200` carrying no results is not a failure but
 * the exchange's own empty state, which is explained rather than reported as an error.
 *
 * **The vocabulary is imported, never retyped.** The labels, the badge scope, the "no report" copy
 * and the synthetic currency name come from `@adem/shared`, so the wording here cannot drift from
 * the value the API, the badge, the ledger and the end-to-end assertions all agree on. Nothing on
 * this page states or implies general safety, certified security, independent certification or a
 * guaranteed pass, and no sponsored item is described as recommended, verified or trusted.
 *
 * The page owns the document's single `<main>` landmark and its single `<h1>`; the shell renders the
 * header, the navigation, the demonstration banner and the account switcher, and no landmark of its
 * own. `id="main-content"` and `tabIndex={-1}` are a pair with the shell's bypass link — the id is
 * that link's target and `tabIndex` is what lets the link move focus here without putting `<main>`
 * in the tab order — so neither is a free name to rename.
 *
 * The heading outline is `h1`, then one `h2` per section, with the one `h3` inside a section being
 * the empty listings state's, so no level is skipped. The class names are the stylesheet's own:
 * `.page` and `.page-home` on the route root, `.item-list` and `.item-list__item` for the lists,
 * `.status-region` for the one polite live region, and `.sponsored-block`, which owns its heading,
 * its list and the `.sponsored-label` chip the disclosure component renders.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  BADGE_SCOPE,
  DEFAULT_LISTING_SORT,
  DEMO_AUTHENTICATION_LABEL,
  NO_REPORT_LABEL,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
  SPONSORED_LABEL,
  SYNTHETIC_CURRENCY_LABEL,
} from "@adem/shared";
import type {
  ListingSearchResult,
  ListingSummary,
  SponsoredPlacementKey,
  SponsoredSlotListItem,
  SponsoredSlotListResult,
} from "@adem/shared";

import { listListings, listSponsoredSlots } from "../api-client";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { ListingCard } from "../components/listing-card";
import { SponsoredLabel } from "../components/sponsored-label";

/**
 * The one surface this page's sponsored block belongs to, typed from the closed placement
 * vocabulary rather than held as a bare string: a placement key that left that vocabulary would
 * fail the build here instead of silently emptying this page's block.
 */
const HOME_PLACEMENT: SponsoredPlacementKey = "home";

/**
 * How many organic results the home page shows before sending a reader to the listings page for the
 * rest. The read's own page size is the contract's fixed 20 and is not this page's to change; this
 * is only how much of the first page a landing page renders.
 */
const HOMEPAGE_RESULT_LIMIT = 6;

/** The sentence the listings block announces while its read is in flight. */
const LISTINGS_LOADING_MESSAGE =
  "Loading the listings the exchange serves. The rest of this page is ready to read.";

/** The sentence the listings block shows when the read succeeded and nothing is published. */
const NO_LISTINGS_HEADING = "No listings are published yet";

/** Why there is nothing to show, in the reader's own terms. */
const NO_LISTINGS_EXPLANATION =
  "Nothing is published to the exchange yet. A developer publishes a listing and a version of it, and both appear here as soon as they are created.";

/**
 * The listings read's state: in flight, settled with results, or refused. Kept as one value rather
 * than as separate `loading`/`error`/`data` variables so no render can find a combination of them
 * that never happened.
 */
type ListingsState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly listings: readonly ListingSummary[];
      readonly total: number;
    }
  | { readonly status: "failed"; readonly failure: unknown };

/**
 * The sponsorship read's state. It carries its own `loading` and `failed` members even though both
 * render nothing, so that the block's three outcomes stay distinguishable in the code rather than
 * collapsing into an empty array whose emptiness means three different things.
 */
type SponsoredState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly slots: readonly SponsoredSlotListItem[] }
  | { readonly status: "failed" };

/** One sponsored item as this page renders it: the fictional sponsor's label and the item's key. */
interface HomeSponsoredItem {
  /** The React list key: the slot's identifier, or a positional fallback when it carries none. */
  readonly key: string;
  /** The sponsor's fictional label, rendered beside the disclosure label. */
  readonly sponsorLabel: string;
}

/**
 * A value as displayable text, or `null` when there is nothing to display.
 *
 * The reads answer with payloads this page did not construct, so a field that is absent, blank or
 * not a string at all is treated as a field with no text rather than rendered: an item that would
 * otherwise print `undefined`, `null` or an empty line is left out instead. This is the only place
 * the page inspects the shape of a value it did not type itself.
 */
function readableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Whether a value is an object this page may read fields from. A collection whose element is not an
 * object is dropped rather than spread into a render, because a render that throws leaves the reader
 * with a blank page in place of the rest of the home page.
 */
function isReadableRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * The items of this page's own placement, ready to render.
 *
 * Two omissions are deliberate. An item placed on another surface is dropped, because the home page
 * owns the `home` block and the listings page owns the `listings` block. An item whose sponsor label
 * is missing, blank or not a string is dropped as well: an item this page cannot name is one whose
 * disclosure would be incomplete, and half a disclosure is worse than none. Neither omission
 * reorders or reinterprets what remains — the collection is rendered in the order it arrived.
 */
function sponsoredItemsForHome(slots: readonly SponsoredSlotListItem[]): readonly HomeSponsoredItem[] {
  const items: HomeSponsoredItem[] = [];
  slots.forEach((slot: SponsoredSlotListItem, index: number): void => {
    if (!isReadableRecord(slot) || slot.placement_key !== HOME_PLACEMENT) {
      return;
    }
    const sponsorLabel = readableText(slot.sponsor_label);
    if (sponsorLabel === null) {
      return;
    }
    items.push({
      key: readableText(slot.id) ?? `sponsored-slot-${String(index)}`,
      sponsorLabel,
    });
  });
  return items;
}

/**
 * One sentence stating what the exchange holds and how much of it this page shows, so the block
 * reads as a window onto the listings rather than as the whole of them.
 */
function describeResultCount(total: number, shown: number): string {
  const noun = total === 1 ? "listing" : "listings";
  if (shown >= total) {
    return `The exchange holds ${String(total)} published ${noun}, and every one of them is shown here.`;
  }
  return `The exchange holds ${String(total)} published ${noun}; the first ${String(shown)} are shown here.`;
}

/**
 * The organic results: the cards, or the explained empty state. Called only once the read has
 * settled successfully — the loading sentence and the failure notice are rendered beside it — and
 * written as a plain function of the two values it renders so the block can be reasoned about
 * without a component instance.
 *
 * No badge is rendered per card: a badge is issued on a pass alone and belongs beside the per-case
 * evidence it summarises, on the listing and report pages. A card whose version has no report shows
 * the shared "no report" copy instead, which is a state of the product rather than a failure of it.
 */
function renderListings(listings: readonly ListingSummary[], total: number): JSX.Element {
  const shown = listings.slice(0, HOMEPAGE_RESULT_LIMIT);

  if (shown.length === 0) {
    return (
      <EmptyState
        heading={NO_LISTINGS_HEADING}
        headingLevel={3}
        explanation={NO_LISTINGS_EXPLANATION}
        action={<Link to="/developer">Publish a listing</Link>}
      />
    );
  }

  return (
    <>
      <ul className="item-list">
        {shown.map((listing: ListingSummary, index: number): JSX.Element => (
          <li
            className="item-list__item"
            key={listing.id === "" ? `listing-${String(index)}` : listing.id}
          >
            <ListingCard listing={listing} />
          </li>
        ))}
      </ul>
      <p>{describeResultCount(total, shown.length)}</p>
      <p>
        <Link to="/listings">Browse, search and filter every published listing</Link>
      </p>
    </>
  );
}

/**
 * The home page: what ADEM is, what it does not do, where to go next, the first page of the
 * exchange's listings, and the labelled sponsored block below them.
 *
 * The page reads twice, on mount, and never again except for an explicit retry of the listings
 * block. Both reads are independent — neither awaits the other and neither shares a state value —
 * so a sponsorship that fails leaves the listings untouched and the other way round. Neither is
 * retried automatically: an unreachable service is a state the reader decides what to do about.
 */
export function Home(): JSX.Element {
  const [listingsState, setListingsState] = useState<ListingsState>({ status: "loading" });
  const [sponsoredState, setSponsoredState] = useState<SponsoredState>({ status: "loading" });
  const [listingsAttempt, setListingsAttempt] = useState(0);

  // The listings read. `listingsAttempt` is its only input, so a retry re-runs this read alone and
  // leaves the sponsorship read, and every other block on the page, exactly as it was. The
  // `cancelled` flag stops a settled read from writing state after the page has gone: without it a
  // slow answer arriving after a navigation would set state on a component that no longer exists.
  useEffect((): (() => void) => {
    let cancelled = false;
    setListingsState({ status: "loading" });

    listListings({ sort: DEFAULT_LISTING_SORT, page: 1 })
      .then((result: ListingSearchResult): void => {
        if (!cancelled) {
          setListingsState({ status: "ready", listings: result.items, total: result.total });
        }
      })
      .catch((failure: unknown): void => {
        if (!cancelled) {
          setListingsState({ status: "failed", failure });
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [listingsAttempt]);

  // The sponsorship read, independent of the one above. Its failure is an empty block and nothing
  // more — no message, no retry control and no state the reader has to dismiss — so its rejection is
  // recorded as its own state rather than surfaced.
  useEffect((): (() => void) => {
    let cancelled = false;

    listSponsoredSlots()
      .then((result: SponsoredSlotListResult): void => {
        if (!cancelled) {
          setSponsoredState({ status: "ready", slots: result.items });
        }
      })
      .catch((): void => {
        if (!cancelled) {
          setSponsoredState({ status: "failed" });
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, []);

  // Empty in every state but a settled, successful read: while the read is in flight, after it
  // failed, and when the collection holds nothing for this surface. The block renders on this value
  // alone, which is what makes "render nothing" the single behaviour for all three.
  const homeSponsoredItems: readonly HomeSponsoredItem[] =
    sponsoredState.status === "ready" ? sponsoredItemsForHome(sponsoredState.slots) : [];

  /** Sends the listings block back to its loading state and runs that read once more. */
  function handleRetryListings(): void {
    setListingsAttempt((attempt: number): number => attempt + 1);
  }

  return (
    <main id="main-content" tabIndex={-1} className="page page-home">
      <section aria-labelledby="home-purpose-heading">
        <h1 id="home-purpose-heading">
          ADEM — the Agent Development Exchange and Marketplace: compare what a listing claims
          against what was measured
        </h1>
        <p>
          ADEM is a new, independent, public, open-source foundation for an AI agent exchange, and
          this repository is its working first version. An independent developer or a small team
          publishes an agent without asking anyone's permission, and a buyer compares what a listing
          claims against what an evaluation actually measured about the version on offer.
        </p>
        <p>
          The evidence comes from a community-governed Standard Gate Index. One provisional standard,{" "}
          <code>SGI-SO-1.0.0</code>, Structured Output Conformance, scores a candidate against a
          fixed fixture set of 20 cases, five of them critical, using only the recorded output the
          candidate's developer submitted. Nothing is executed: the recorded data is compared, and
          the same submission scored again yields the same per-case results and the same outcome.
          Every report carries exactly one label, {REPORT_LABEL_SAMPLE} or{" "}
          {REPORT_LABEL_VERIFIED_IN_DEMO}, and a version that has not been evaluated shows "
          {NO_REPORT_LABEL}" in place of both an outcome and a badge.
        </p>
        <p>
          <Link to="/mission">Read the full mission statement, including what ADEM does not do</Link>
        </p>
      </section>

      <section aria-labelledby="home-entry-points-heading">
        <h2 id="home-entry-points-heading">Start here</h2>
        <ul className="item-list">
          <li className="item-list__item">
            <p>
              <Link to="/listings">Browse listings and search the exchange</Link>
            </p>
            <p>
              Search and filter every published listing, and open one to read its claims, its version
              history and the evidence behind the version on offer.
            </p>
          </li>
          <li className="item-list__item">
            <p>
              <Link to="/compare">Compare two to four listings side by side</Link>
            </p>
            <p>
              A comparison sets each listing's claims against its measured evidence, with the
              standard version, the label, the stated limitations, the license and the pricing model.
            </p>
          </li>
          <li className="item-list__item">
            <p>
              <Link to="/standards">Read the standard and how it is governed</Link>
            </p>
            <p>
              The provisional standard with its rubric, its pass rule and the proposals a community
              raises to change it. A standard version is never edited: a change creates a new version
              through review.
            </p>
          </li>
          <li className="item-list__item">
            <p>
              <Link to="/developer">Publish a listing and run an evaluation</Link>
            </p>
            <p>
              A developer publishes a listing and a version of it, runs a simulated evaluation on
              that version, and receives a reproducible report to show a buyer or to appeal.
            </p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="home-works-heading">
        <h2 id="home-works-heading">What works today</h2>
        <p>
          Everything below runs end to end in this repository, on synthetic data, from the commands
          the README documents.
        </p>
        <ul className="item-list">
          <li className="item-list__item">
            <strong>Browse, search, filter and compare.</strong> Every public page reads the exchange
            without an account, and a comparison sets two to four listings side by side with their
            claims, their measured evidence, their stated limitations, their license and their
            pricing model.
          </li>
          <li className="item-list__item">
            <strong>Publish, then be measured.</strong> A developer publishes a listing and a version
            of it, runs a simulated evaluation, and receives a report reproducible from the fixture
            set and the pass rule alone: the same submission scored again gives the same per-case
            results and the same outcome.
          </li>
          <li className="item-list__item">
            <strong>A report a buyer can read and question.</strong> A report carries the candidate
            version, the standard version, per-case evidence, the totals, the outcome, the rubric
            reference and one of the two labels. A passing report carries a sample badge naming the
            standard version, the report identifier and the scope "{BADGE_SCOPE}"; a failing report
            carries its per-case evidence and no badge at all. An appeal is decided by appending a
            governance event and leaves the report exactly as it was written.
          </li>
          <li className="item-list__item">
            <strong>Inquiries and a simulated checkout.</strong> A buyer posts an inquiry about a
            listing, selects one of the offers that listing makes, and runs a checkout simulation
            whose amounts are whole minor units of the synthetic currency{" "}
            {SYNTHETIC_CURRENCY_LABEL} with a disclosure label on every amount. A refund appends a
            proportional reversal entry; nothing already recorded is edited or removed.
          </li>
          <li className="item-list__item">
            <strong>A challenges board and discussion threads.</strong> A buyer raises a challenge
            against a listing, its developer answers, and anyone takes part in the public threads.
          </li>
          <li className="item-list__item">
            <strong>ADEM Shield Basic, and a standard governed by review.</strong> Shield Basic is a
            separate, free, open-source package that decides allow, deny or needs-approval on a tool
            call, needs no signup, and denies by default when no rule matches. The standard itself
            changes only by proposal and review: a proposal moves from submitted to accepted or
            rejected through operator review, and standard versions, reports and governance events
            are append-only.
          </li>
        </ul>
      </section>

      <section aria-labelledby="home-gaps-heading">
        <h2 id="home-gaps-heading">What does not work yet</h2>
        <p>
          Each of these is a limit of this first version rather than a caveat added to it, and each
          is stated here so that nothing below is read as more than it is.
        </p>
        <ul className="item-list">
          <li className="item-list__item">
            <strong>No production authentication.</strong> The demonstration accounts are synthetic
            rows selected by a request header, and the label beside the switcher reads "
            {DEMO_AUTHENTICATION_LABEL}". There is no sign-in, no credential store, no session and no
            real identity anywhere in this repository, and no route treats that header as
            authentication of anyone.
          </li>
          <li className="item-list__item">
            <strong>No real payments and no money movement.</strong> Every amount is a whole count of
            minor units of the synthetic currency {SYNTHETIC_CURRENCY_LABEL}: there is no real
            currency code or symbol in the product and no payment provider is integrated. Buying an
            evaluation never guarantees a pass — an outcome depends on test evidence alone.
          </li>
          <li className="item-list__item">
            <strong>No execution of submitted agent code.</strong> An evaluation compares recorded
            output as data against fixed expected outputs, so third-party code submitted as a
            candidate is never run, imported or interpreted, and this repository holds no sandbox for
            it.
          </li>
          <li className="item-list__item">
            <strong>No independent certification.</strong> A report's label states where the run came
            from, and a badge's scope is "{BADGE_SCOPE}". Neither says anything about general safety
            or certified security, and neither is certification by an independent body.
          </li>
          <li className="item-list__item">
            <strong>Sponsored slots are a demonstration.</strong> Every sponsored item is labelled{" "}
            {SPONSORED_LABEL} and kept out of the organic results. There is no personalized ad
            profiling, no per-reader measurement and no analytics beyond aggregate local counters.
          </li>
          <li className="item-list__item">
            <strong>No automated governance, and nothing deployed from here.</strong> A standards
            proposal needs human review, and the standard, the scoring code and the security-critical
            packages require maintainer review before a change merges. Nothing in the running product
            calls an external service, and deployment and public announcement need separate approval.
          </li>
          <li className="item-list__item">
            <strong>The privacy review is manual.</strong> An automated scan looks for a small number
            of detectable patterns — credential and secret shapes, contact details and prohibited
            dependencies — and it is supplementary rather than a guarantee: it does not prove that no
            private information is present, so a maintainer reviews the repository against a written
            checklist.
          </li>
        </ul>
      </section>

      <section aria-labelledby="home-listings-heading">
        <h2 id="home-listings-heading">Listings on the exchange</h2>
        <p>
          The first page of what developers have published, as the exchange serves it. Each card
          carries the outcome, the standard version and the label of the evidence behind the listing's
          latest version, or shows "{NO_REPORT_LABEL}" in place of both.
        </p>

        {/* One polite live region for this block's read, present from the first render so that its
            announcement is reliable: its content is the loading sentence while the read is in
            flight and nothing once the read has settled. The failure notice below carries a region
            of its own, and its retry control sits outside that region. */}
        <div className="status-region" role="status" aria-live="polite">
          {listingsState.status === "loading" ? <p>{LISTINGS_LOADING_MESSAGE}</p> : null}
        </div>

        {listingsState.status === "failed" ? (
          <ErrorNotice error={listingsState.failure} onRetry={handleRetryListings} />
        ) : null}

        {listingsState.status === "ready"
          ? renderListings(listingsState.listings, listingsState.total)
          : null}
      </section>

      {/* The sponsored block renders after the organic results and is never interleaved with them.
          When the read is in flight, failed, empty, or carries only another surface's placements,
          `homeSponsoredItems` is empty and this whole subtree — its heading included — renders
          nothing at all, which is exactly the behaviour this block owes a reader. */}
      {homeSponsoredItems.length === 0 ? null : (
        <section className="sponsored-block" aria-labelledby="home-sponsored-heading">
          <h2 id="home-sponsored-heading">{SPONSORED_LABEL}</h2>
          <p>
            These placements are labelled advertising, shown as a limited demonstration. They sit
            below the listings above and are never sorted into them, and a sponsorship buys no
            ranking, no evaluation outcome and no badge. Nothing here measures a reader: this
            demonstration carries no personalized tracking and no analytics beyond aggregate local
            counters.
          </p>
          <ul>
            {homeSponsoredItems.map((item: HomeSponsoredItem): JSX.Element => (
              <li key={item.key}>
                <p>
                  <SponsoredLabel />{" "}
                  {item.sponsorLabel}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// app.tsx's route table imports the default export, and the named export travels with it so the page
// can also be imported by name — the same pair, for the same reason, as mission.tsx and not-found.tsx.
export default Home;

