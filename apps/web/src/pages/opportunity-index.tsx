/**
 * The `/opportunity-index` route: the illustrative opportunity index.
 *
 * The page sets two figures beside each other for every listing category — the supply the public
 * listings represent in that category, and the fictional demand figure the client's own table
 * carries for it — and states on every render what those figures are and what the ratio between
 * them is not. Five decisions shape the file, each of which a later reader could otherwise
 * reverse.
 *
 * **It reads one public endpoint and no other.** `GET /listings` is public, so this page sends no
 * `X-Demo-Account` header, needs no demo account and cannot fail for want of a role.
 * `../illustrative/opportunity-index` exists so that the index needs no endpoint of its own: the
 * demand column is compile-time data and the supply column is counted from listings the page
 * already has, which is what keeps the API contract from gaining a route the request never fixed.
 *
 * **The read pages, and the bound is a decision rather than a detail.** The route answers with at
 * most `LISTING_PAGE_SIZE` items, while the index counts *supply across the published set*, so
 * reading page 1 alone would report a supply capped at 20 per category and present it as the
 * exchange's whole supply. The read itself belongs to `../catalogue-read`, whose one reader asks
 * page 1 first — the read that reports `total` — and then asks the pages that cover that total
 * together under its own twenty-five-page bound, so a `total` that is absurd, or a page that never
 * advances, cannot make the page spin, and a catalogue larger than one page does not reach it one
 * round-trip at a time. A bounded, best-effort total over the pages actually read is the honest
 * figure to index, and the page's own reading note states how the column was counted, so a reader
 * is not left to infer it.
 *
 * **The illustrative statement is unconditional, and it is the page's own.** It is rendered ahead
 * of every branch on the read's state, so it is present while the read is in flight, when it
 * failed, and when there is no supply to index at all. `../components/opportunity-index-table`
 * states the same thing again inside its own element; the duplication is deliberate, because the
 * label has to survive the table not being rendered.
 *
 * **Nothing here derives, ranks or recommends.** `deriveOpportunityIndex` is the workspace's single
 * definition of the index, so this page calls it once per read and passes its rows through
 * unchanged: no re-sort, no re-round, no total, no average, no "top" row and no advice about what
 * to build or buy. Every row carries the derivation's own `illustrative` marker into the table, the
 * ratio's scale is stated in words, and nothing here describes the figures as a measurement, a
 * forecast, a market size, a valuation, investment guidance or an offer.
 *
 * **Its vocabulary is imported rather than restated.** The sponsored label comes from
 * `@adem/shared`, so it cannot drift from the value the API, the sponsored-label component and the
 * end-to-end assertions agree on. The three terms the reading list below names — the two figures and
 * the ratio between them — come from `../components/opportunity-index-table`, which is where the
 * table labels the same three values, so both surfaces describe a row in the same words.
 *
 * Appearance belongs to the `.page`, `.page-opportunity-index`, `.notice`, `.empty-state`,
 * `.status-region` and `.table*` rules in `apps/web/src/styles/app.css`, which this module does not
 * import: the page carries no inline style and no class the stylesheet does not already own. It
 * owns the route's single `<main>` landmark and its single `<h1>`, and `id="main-content"` with
 * `tabIndex={-1}` is a pair with the shell's bypass link — the id is that link's target and
 * `tabIndex` is what lets the link move focus here without putting `<main>` in the tab order.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { LISTING_PAGE_SIZE, SPONSORED_LABEL } from "@adem/shared";

import { readCatalogueListings } from "../catalogue-read";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import {
  LABEL_DEMAND,
  LABEL_RATIO,
  LABEL_SUPPLY,
  OpportunityIndexTable,
} from "../components/opportunity-index-table";
import {
  OPPORTUNITY_DEMAND_TABLE,
  RATIO_BASIS_POINT_SCALE,
  deriveOpportunityIndex,
} from "../illustrative/opportunity-index";
import type { OpportunityRow } from "../illustrative/opportunity-index";

/** The route's heading. The page owns the document's single `<h1>` and this is its only text. */
const HEADING = "Opportunity index";

/** The id the basis statement's heading carries, so the section is named by the heading it shows. */
const BASIS_HEADING_ID = "opportunity-index-basis-heading";

/** The id of the section that explains how to read a row. */
const READING_HEADING_ID = "opportunity-index-reading-heading";

/** The heading the table sits under, so the table is reached from the page outline as well. */
const TABLE_HEADING_ID = "opportunity-index-table-heading";

/** Heading of the section that states the index's basis. */
const BASIS_HEADING = "What this index is, and what it is not";

/** What the two columns are, in the order a reader meets them. */
const BASIS_SOURCES =
  "The index is illustrative. Its supply figures are counted from the listings the public search returns right now, and its demand figures come from a fixed, fictional table that ships with this application's own client code. The ratio is then computed in your browser from those two figures: it is a rough comparison of them, and not a measurement, a forecast, investment advice or an offer.";

/** What the figures do not rest on, because a figure that looks measured invites the assumption. */
const BASIS_LIMITS =
  "Nothing here is observed from a real market. There is no real market data behind these figures, no analytics and no personalized tracking, and no figure is a statement about an agent's quality, its safety or the outcome of an evaluation.";

/** Where sponsored placements are, and how a reader recognises one. */
const BASIS_SPONSORED = `Nothing on this page is sponsored. A sponsored placement is kept out of organic ordering and out of this index, and where the product shows one it carries its own ${SPONSORED_LABEL} label.`;

/** What does and does not move between visits, stated so a reader can weigh the index correctly. */
const BASIS_MOVEMENT =
  "The demand table is fixed in the code, so the demand column only changes when the code changes. The supply column changes as listings are published, and this page holds neither column anywhere: nothing on it is stored, and nothing but the public listing read leaves this browser.";

/** How supply was counted, on the row itself, so the paging decision is visible where it matters. */
const SUPPLY_DESCRIPTION = `How many listings this exchange publishes in the category, counted from the public listing search over the whole published set. The search answers with ${String(LISTING_PAGE_SIZE)} listings at a time and this page reads every page of it before it counts.`;

/** What the demand figure is, in the plainest terms available: what it counts, and its status. */
const DEMAND_DESCRIPTION =
  "The fixed, fictional figure the client's own demand table holds for the category, counted in the same unit as the supply column — a listing — so the two figures can be read beside each other and divided into the ratio below. It comes from no source outside this application, it is the same on every visit, and it measures nothing.";

/** The ratio's scale, in words, because the row's ratio is a bare integer. */
const RATIO_DESCRIPTION = `Demand against supply in basis points, on the scale the derivation fixes: ${String(RATIO_BASIS_POINT_SCALE)} means demand equals supply, and a larger figure means demand runs ahead of supply by that much more.`;

/** The reading note's closing sentence: the ordering is the derivation's, and it recommends nothing. */
const ORDERING_NOTE =
  "The rows are ordered by the derivation that produced them — highest ratio first, then by category — and that ordering is not a recommendation, a ranking of categories to build in or a judgement about any listing.";

/** Announced while the read is in flight, through a polite live region that is never hidden. */
const LOADING_MESSAGE =
  "Reading the public listings to build the index. The rows appear as soon as the read finishes, and nothing is sent anywhere.";

/** The successful-but-empty state: nothing is listed, so there is nothing to set demand beside. */
const EMPTY_HEADING = "No supply to index yet";

/** Why the index is empty, in terms the reader can act on, and never as a failure of the read. */
const EMPTY_EXPLANATION =
  "There is no supply to index: no listing has been published yet, or none of the published listings carries a category this index can group by. Until a listing is published there is nothing for the fictional demand table to be set beside, so the index has no rows to show.";

/**
 * Builds the index rows: one read of the public listing search, asked page 1 first and then the
 * pages that cover the reported total together under the shared reader's bound, and one derivation
 * over what it collected.
 *
 * The derivation is called exactly once per read and its result is returned as it stands, so the
 * page adds no second definition of the index — no ordering, no rounding and no row of its own.
 * `OPPORTUNITY_DEMAND_TABLE` is the only demand source the page has: nothing here fetches a demand
 * figure, and there is nowhere in the contract that one could be fetched from.
 */
async function readOpportunityRows(): Promise<readonly OpportunityRow[]> {
  const listings = await readCatalogueListings();
  return deriveOpportunityIndex(listings, OPPORTUNITY_DEMAND_TABLE);
}

/**
 * What one read of the page is doing: the request in flight, the rows it produced, or the failure
 * it ended in.
 *
 * One value rather than three flags, so no combination can describe two states at once: a page that
 * were both loading and failed would render two answers to one question. The three values are
 * exhaustive by construction, and the page renders from them.
 */
type ReadStatus = "loading" | "loaded" | "failed";

/**
 * The illustrative opportunity index.
 *
 * The read is one paged public listing call in an effect, and the page renders exactly one of four
 * things from its outcome: an announced loading message, the error notice with a retry, the
 * explanatory empty state, or the table. Every branch keeps the heading, the basis statement and
 * the reading note in place, so no state and no failure is ever a blank screen or an error trace.
 *
 * Nothing is fetched during render, no URL is built here and no demo account is sent: the read is
 * public, so the page needs no selected account to work, and a reader who has selected nothing can
 * still read the index. The cancelled flag in the effect's cleanup is what stops a superseded read —
 * a retry, or an unmount — from writing its result into a page that has moved on.
 */
export function OpportunityIndex(): JSX.Element {
  const [status, setStatus] = useState<ReadStatus>("loading");
  const [rows, setRows] = useState<readonly OpportunityRow[]>([]);
  const [failure, setFailure] = useState<unknown>(null);
  const [reloadCount, setReloadCount] = useState<number>(0);

  // The read runs on mount and on every retry. The retry is a counter rather than a second effect,
  // so there is one read path and a retry cannot leave the previous read's result standing.
  useEffect((): (() => void) => {
    let isCancelled = false;

    setStatus("loading");
    setFailure(null);

    void readOpportunityRows()
      .then((derived): void => {
        if (!isCancelled) {
          setRows(derived);
          setStatus("loaded");
        }
      })
      .catch((error: unknown): void => {
        if (!isCancelled) {
          setFailure(error);
          setStatus("failed");
        }
      });

    return (): void => {
      isCancelled = true;
    };
  }, [reloadCount]);

  const retry = (): void => {
    setReloadCount((count: number): number => count + 1);
  };

  const isLoading = status === "loading";
  const hasFailed = status === "failed";
  const hasRows = status === "loaded" && rows.length > 0;
  const isEmpty = status === "loaded" && rows.length === 0;

  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` is what lets that link
    // move focus here without putting the landmark itself in the tab order, so the two stay in step
    // with the shell rather than being renamed freely.
    <main id="main-content" tabIndex={-1} className="page page-opportunity-index">
      <h1>{HEADING}</h1>

      <p>
        The opportunity index sets two figures beside each other for every listing category: how many
        listings this exchange publishes in that category right now, and a fictional demand figure for
        it. Reading the two together shows the shape of the public catalogue, and nothing more than
        that.
      </p>

      {/* The basis, stated on every render and ahead of every branch below, so it is present while the
          read is in flight, when it failed and when there is no supply to index at all. `notice
          notice--info` is the stylesheet's own prominent surface, which is why the statement needs no
          markup of its own beyond its heading and its paragraphs: it is ordinary visible text and
          never a tooltip, a title attribute or an accessible name carrying it alone. */}
      <section className="notice notice--info" aria-labelledby={BASIS_HEADING_ID}>
        <h2 id={BASIS_HEADING_ID}>{BASIS_HEADING}</h2>
        <p>{BASIS_SOURCES}</p>
        <p>{BASIS_LIMITS}</p>
        <p>{BASIS_SPONSORED}</p>
        <p>{BASIS_MOVEMENT}</p>
      </section>

      <section aria-labelledby={READING_HEADING_ID}>
        <h2 id={READING_HEADING_ID}>How to read a row</h2>
        <dl>
          <dt>{LABEL_SUPPLY}</dt>
          <dd>{SUPPLY_DESCRIPTION}</dd>
          <dt>{LABEL_DEMAND}</dt>
          <dd>{DEMAND_DESCRIPTION}</dd>
          <dt>{LABEL_RATIO}</dt>
          <dd>{RATIO_DESCRIPTION}</dd>
        </dl>
        <p>{ORDERING_NOTE}</p>
      </section>

      {isLoading ? (
        // One polite live region stating that the read is in flight. It is visible, wraps and is
        // never collapsed, so it is a status a reader can see as well as hear.
        <p className="status-region" role="status" aria-live="polite">
          {LOADING_MESSAGE}
        </p>
      ) : null}

      {hasFailed ? <ErrorNotice error={failure} onRetry={retry} /> : null}

      {isEmpty ? (
        <EmptyState
          heading={EMPTY_HEADING}
          explanation={EMPTY_EXPLANATION}
          action={<Link to="/listings">Browse listings</Link>}
        />
      ) : null}

      {hasRows ? (
        <section aria-labelledby={TABLE_HEADING_ID}>
          <h2 id={TABLE_HEADING_ID}>Index by listing category</h2>
          <OpportunityIndexTable rows={rows} />
        </section>
      ) : null}
    </main>
  );
}

// The default export is what app.tsx's route table imports for the /opportunity-index route, and the
// named export is what a test or a sibling module imports. Both exist on purpose.
export default OpportunityIndex;

