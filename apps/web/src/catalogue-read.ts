/**
 * The catalogue's whole read: every page of the public listing search, in order.
 *
 * Two pages need the published set rather than a page of it — the developer workspace, which has no
 * per-developer read to ask and so walks the catalogue and keeps its own account's listings, and the
 * opportunity index, which counts the whole supply per category — and the contract offers exactly one
 * read for it: `GET /listings`, which answers {@link LISTING_PAGE_SIZE} listings at a time and reports
 * how many it matched in `total` (see `../api-client`).
 *
 * **Page 1 is requested alone; the pages it implies are requested together.** The first page is the
 * read that reports `total`, so it is the only one that cannot be asked for alongside the others. Once
 * it has answered, the pages that cover the reported `total` are known, and they are requested
 * together under a bound instead of one at a time: the walk then costs one round-trip plus
 * ceil(remaining pages / {@link CATALOGUE_PAGE_READ_LIMIT}) waves, rather than one round-trip per page,
 * and the bound keeps a large catalogue from arriving as a single burst at the one process that serves
 * it. Their answers are rearranged into page order before they are collected, so the listing order is
 * the catalogue's own whatever order the answers arrive in.
 *
 * **The walk terminates on the data it was given.** A `total` that is not a finite positive number is
 * read as "no more than what page 1 carried", an empty page 1 ends the read, and no read follows more
 * than {@link MAX_CATALOGUE_PAGES} pages, so a wrong, absurd or slowly advancing `total` cannot make a
 * caller spin. A page beyond the catalogue's end answers `items: []` and contributes nothing, which is
 * the same outcome the page-by-page walk reached by stopping at the first page that carried nothing.
 */

import { DEFAULT_LISTING_SORT, LISTING_PAGE_SIZE } from "@adem/shared";
import type { ListingSearchResult, ListingSummary } from "@adem/shared";

import { listListings } from "./api-client";
import { mapWithConcurrency } from "./concurrency";

/** The page of the catalogue every read starts from, because it is the one that reports `total`. */
const FIRST_CATALOGUE_PAGE = 1;

/**
 * How many pages of the catalogue one read follows before it stops.
 *
 * The bound exists so that the walk ends on the data alone: `total` arrives as a number from the
 * service, and a page that carried nothing would otherwise be asked for again for as long as `total`
 * claimed there was more. Twenty-five pages is five hundred listings at the contract's page size,
 * which is far beyond the seeded set this foundation ships and still a finite, reachable end.
 */
const MAX_CATALOGUE_PAGES = 25;

/**
 * How many catalogue pages one read may have in flight at once.
 *
 * Each of these requests is a full scan-and-sort on the service's side, and the service is one
 * process with one writer, so the bound is deliberately small: it removes the round-trip serialisation
 * without turning a large catalogue into a burst the single writer has to queue behind.
 */
const CATALOGUE_PAGE_READ_LIMIT = 4;

/**
 * Reads every page of the public listing search, in catalogue order.
 *
 * The read is public: it sends no demo account, so it needs no role and no selected account. Page 1 is
 * always requested, because it is the read that reports whether the exchange carries any listing at
 * all; an empty result is the route's ordinary `200` with `items: []` rather than an error, and the
 * remaining pages are derived from the `total` page 1 reported rather than from a guess.
 *
 * @returns Every listing the pages it read carried, in page order and then in each page's own order.
 *   The array is empty when the catalogue is empty.
 * @throws {Error} The failure of the first request that failed, once the requests already made have
 *   settled — an `ApiClientError` for a refusal, or the client's own transport failure.
 */
export async function readCatalogueListings(): Promise<ListingSummary[]> {
  const first = await listListings({ sort: DEFAULT_LISTING_SORT, page: FIRST_CATALOGUE_PAGE });
  const collected: ListingSummary[] = [...first.items];

  const lastPage = lastCataloguePage(first);
  if (lastPage <= FIRST_CATALOGUE_PAGE) {
    return collected;
  }

  const remaining: number[] = [];
  for (let page = FIRST_CATALOGUE_PAGE + 1; page <= lastPage; page += 1) {
    remaining.push(page);
  }

  const results = await mapWithConcurrency(
    remaining,
    CATALOGUE_PAGE_READ_LIMIT,
    (page: number): Promise<ListingSearchResult> =>
      listListings({ sort: DEFAULT_LISTING_SORT, page }),
  );
  for (const result of results) {
    for (const item of result.items) {
      collected.push(item);
    }
  }

  return collected;
}

/**
 * The last page a read of this catalogue follows: the page that covers the `total` page 1 reported, or
 * page 1 itself when there is nothing further to read.
 *
 * `total` is read the way the page-by-page walk read it: a value that is not a finite positive number
 * means "no more than what has already arrived", which ends the read at page 1 rather than extending it,
 * and the page that covers it is bounded by {@link MAX_CATALOGUE_PAGES} so that a `total` the catalogue
 * cannot have is still a finite number of requests.
 */
function lastCataloguePage(first: ListingSearchResult): number {
  if (first.items.length === 0) {
    return FIRST_CATALOGUE_PAGE;
  }

  const total =
    Number.isFinite(first.total) && first.total > 0 ? Math.floor(first.total) : first.items.length;
  const covering = Math.ceil(total / LISTING_PAGE_SIZE);

  return Math.min(Math.max(covering, FIRST_CATALOGUE_PAGE), MAX_CATALOGUE_PAGES);
}
