/**
 * The illustrative opportunity index: a supply-and-demand table a visitor reads beside the
 * exchange's public listings, derived in the browser from data the page already fetches.
 *
 * Three properties are deliberate.
 *
 * **It needs no API endpoint.** The supply column is counted from the listings a caller already
 * has, and the demand column comes from the compile-time table below, so the page is backed by the
 * one public read it was already making. The API contract fixes no index route; a route added here
 * would widen that contract, and none is added.
 *
 * **It is illustrative, and the rows say so.** Every row carries the literal `illustrative: true`,
 * and the page renders its own statement on every render. The demand figures are fictional: nothing
 * in the product observes real demand, and no figure states anything about an agent's quality, its
 * safety, or the result any purchase could obtain.
 *
 * **It is total and deterministic.** `deriveOpportunityIndex` reads no clock, no locale, no random
 * source and no I/O, mutates neither argument, and returns deeply equal results for equal
 * arguments. An empty supply is the ordinary `[]` rather than a throw, because a category nobody
 * has listed in yet is a state the page explains and not an error.
 *
 * This module derives and nothing else: it holds no catalogue of its own besides the two constants
 * below, renders nothing, requests nothing and stores nothing.
 */

import type { Category, ListingSummary } from "@adem/shared";

/**
 * One row of the illustrative demand table: a fictional count of interest in a listing category.
 *
 * The figure is the table's whole content, so an entry carries no identifier, no timestamp and no
 * source: a demand figure is not a measurement the product can trace, and a shape that looked like
 * a traced one would invite a reader to treat it as evidence.
 */
export interface DemandEntry {
  /**
   * The category the figure belongs to, spelled exactly as the category's stored slug — the token
   * `ListingSummary.category.slug` carries — so a table entry and a listing group on one string
   * with no resolution step between them.
   */
  readonly category_slug: string;

  /**
   * A fictional non-negative integer count of expressed interest in the category, in the same
   * order of magnitude as a seeded listing count so the derived ratio reads sensibly. It measures
   * nothing real, and it is never a claim about an agent, a developer or an outcome.
   */
  readonly demand: number;
}

/**
 * One row of the illustrative opportunity index: the supply the given listings represent in a
 * category, the table's fictional demand for it, and the ratio between the two.
 *
 * The row is what the index renders, and every member is read-only because the index is derived
 * data rather than a record: nothing writes a row back anywhere, and the next derivation produces
 * its own.
 */
export interface OpportunityRow {
  /** The category this row covers, as its slug. Unique within one derivation. */
  readonly category_slug: string;

  /**
   * How many of the given listings sit in this row's category, counted from those listings and
   * never from a constant. A row exists only for a category with at least one listing, so this is
   * always at least 1 and the ratio below can never divide by zero or report a category the
   * exchange does not carry.
   */
  readonly supply: number;

  /**
   * The table's fictional figure for this category, or `0` when the table does not name it. A
   * table that has drifted from the seed therefore degrades to a visible zero rather than a crash
   * or a missing row.
   */
  readonly demand: number;

  /**
   * Demand against supply in basis points: `floor(demand * RATIO_BASIS_POINT_SCALE / supply)`, so
   * `RATIO_BASIS_POINT_SCALE` is a ratio of 1.0 and a larger value means demand exceeds supply by
   * that much more. An integer by construction, and rounded down.
   */
  readonly ratio_basis_points: number;

  /**
   * The marker that makes the illustrative status a property of the value rather than a convention
   * its consumers have to remember. It is the literal `true` rather than `boolean`, so a row that
   * claimed to be anything but illustrative would not type-check.
   */
  readonly illustrative: true;
}

/**
 * The scale the ratio is expressed at: the row's value is demand-to-supply in basis points.
 *
 * `10_000` basis points is a demand-to-supply ratio of 1.0, which keeps every row an integer and
 * spares the index a fraction, a `toFixed`, a locale-sensitive format or a currency-style one.
 */
export const RATIO_BASIS_POINT_SCALE = 10_000;

/**
 * The compile-time, entirely fictional demand table, one entry per seeded listing category.
 *
 * The four keys are the four category slugs `SEED_CATEGORIES` in
 * `apps/api/src/seed/seed-data.ts` publishes and `/api/v1` returns as
 * `ListingSummary.category.slug`. That file owns the seeded set and is the source of truth for it,
 * so the two belong side by side: a seeded slug this table does not name derives `demand: 0` and
 * renders as a visible zero, which is how a drift between them shows up as a reconciliation task
 * rather than as a failure. The figures themselves are made up — fictional and modest, in the order
 * of magnitude of a seeded listing count so the derived ratio is meaningful — and they are frozen
 * so no caller can adjust what the index reports.
 */
export const OPPORTUNITY_DEMAND_TABLE: readonly DemandEntry[] = Object.freeze([
  Object.freeze({ category_slug: "order-intake", demand: 9 }),
  Object.freeze({ category_slug: "depot-routing", demand: 6 }),
  Object.freeze({ category_slug: "record-keeping", demand: 5 }),
  Object.freeze({ category_slug: "notification-drafting", demand: 2 }),
]);

/**
 * Reads one listing's grouping key, or `null` when it carries none this index can group by.
 *
 * `ListingSummary.category` is a `Category` object of `{ id, slug, name }` rather than a bare slug
 * string, so the token to group on is `category.slug`. The shared contract declares the member
 * required, but a payload arrives as JSON from `/api/v1` and `apps/web` holds no validator, so the
 * read is widened to `Category | undefined` and a listing whose category did not arrive is skipped:
 * an incomplete row set is a state the page explains, while a thrown property read would surface as
 * the error trace this product never renders. An empty token is skipped for the same reason — it
 * groups nothing and no table entry can be looked up by it.
 */
function categorySlugOf(listing: ListingSummary): string | null {
  const category: Category | undefined = listing.category;
  if (category === undefined) {
    return null;
  }

  const slug: string = category.slug;
  return slug.length > 0 ? slug : null;
}

/**
 * Orders two derived rows: the larger ratio first, then the smaller category slug.
 *
 * The slug comparison is plain code-unit comparison (`<` and `>`), never a locale-sensitive
 * collation and never a locale-sensitive number or text format: the order the page renders must not
 * depend on the reader's machine, region or language. A slug is the grouping key and therefore
 * unique per row, so the two rules together are a total order — the derived rows do not depend on
 * the order the arguments arrived in either.
 */
function compareOpportunityRows(left: OpportunityRow, right: OpportunityRow): number {
  if (left.ratio_basis_points !== right.ratio_basis_points) {
    return right.ratio_basis_points - left.ratio_basis_points;
  }

  if (left.category_slug < right.category_slug) {
    return -1;
  }

  return left.category_slug > right.category_slug ? 1 : 0;
}

/**
 * Derives the illustrative opportunity index from listings a caller already holds and the fictional
 * demand table.
 *
 * Returns one row per category that at least one of `listings` sits in, ordered by
 * `ratio_basis_points` descending and then by `category_slug` ascending, and `[]` when `listings`
 * is empty. An empty supply is a normal result and not a refusal: the page renders the explanatory
 * empty state of the index, which is why nothing here throws and nothing here returns `null`.
 *
 * The rules a caller can rely on:
 *
 * - **Supply comes from the arguments.** A row's `supply` counts the given listings in that
 *   category, so it is at least 1 and a category named only in `demand` produces no row at all.
 * - **An absent demand entry is zero.** A category the table does not name gets `demand: 0`, and
 *   therefore `ratio_basis_points: 0`.
 * - **A repeated `category_slug` keeps its first occurrence.** The first entry the reader finds in
 *   the table is the one the row shows, and a later duplicate cannot silently replace it.
 * - **The ratio rounds down.** `ratio_basis_points` is `floor(demand * RATIO_BASIS_POINT_SCALE /
 *   supply)`, computed as exact integer division `(numerator - (numerator % supply)) / supply` over
 *   non-negative integers so the result can never be a fraction, `Infinity` or `NaN`. It rounds
 *   down rather than to nearest half because the product has exactly one documented half-up
 *   rounding point — the commerce simulation's founder allocation — and a second one here would be
 *   a second place for a half to be resolved.
 * - **A listing whose category key is absent or empty is skipped.** It cannot be grouped, and it is
 *   neither a throw nor a row of its own.
 *
 * Neither argument is mutated: the supply count, the demand lookup and the sorted copy are this
 * call's own, so the caller's arrays keep their order and their contents.
 */
export function deriveOpportunityIndex(
  listings: readonly ListingSummary[],
  demand: readonly DemandEntry[],
): readonly OpportunityRow[] {
  const supplyBySlug = new Map<string, number>();
  for (const listing of listings) {
    const slug = categorySlugOf(listing);
    if (slug === null) {
      continue;
    }

    const supply = supplyBySlug.get(slug);
    supplyBySlug.set(slug, supply === undefined ? 1 : supply + 1);
  }

  const demandBySlug = new Map<string, number>();
  for (const entry of demand) {
    if (!demandBySlug.has(entry.category_slug)) {
      demandBySlug.set(entry.category_slug, entry.demand);
    }
  }

  const rows: OpportunityRow[] = [];
  for (const [slug, supply] of supplyBySlug) {
    const demandFigure = demandBySlug.get(slug) ?? 0;
    const numerator = demandFigure * RATIO_BASIS_POINT_SCALE;
    const ratio = (numerator - (numerator % supply)) / supply;

    rows.push({
      category_slug: slug,
      supply,
      demand: demandFigure,
      ratio_basis_points: ratio,
      illustrative: true,
    });
  }

  // The sort runs on this call's own copy, so the ordering step is visibly separate from the
  // counting above and no argument is rearranged under its caller.
  return [...rows].sort(compareOpportunityRows);
}
