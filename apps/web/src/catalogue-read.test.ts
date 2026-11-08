/**
 * The catalogue read's contract, pinned to what the module documents: page 1 alone is the read that
 * reports `total`, the pages that cover that total are requested together under the bound rather than
 * one at a time, their answers are collected in page order, and the walk ends on the data it was given.
 *
 * The public listing search is replaced by a recording double, so each case can assert what the read
 * asked for and how much of it was in flight at once: the count of requests per render is what the
 * recording double exists to observe, and it is not observable from the returned array.
 * Expectations are stated as values rather than recomputed from the module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_LISTING_SORT, LISTING_PAGE_SIZE } from "@adem/shared";
import type { ListingSearchQuery, ListingSearchResult, ListingSummary } from "@adem/shared";

import { listListings } from "./api-client";
import { readCatalogueListings } from "./catalogue-read";

vi.mock("./api-client", (): { readonly listListings: unknown } => ({
  listListings: vi.fn(),
}));

const listListingsDouble = vi.mocked(listListings);

/** A macrotask turn, so the read's bound is observable rather than hidden by microtask ordering. */
async function tick(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/** One synthetic catalogue row, shaped as the search answers it. */
function summary(index: number): ListingSummary {
  return {
    id: `listing-${String(index)}`,
    slug: `listing-${String(index)}`,
    title: `Listing ${String(index)}`,
    summary: "A synthetic listing.",
    developer_handle: "demo-developer",
    category: { id: "cat-0001", slug: "customer-support", name: "Customer support" },
    pricing_model: "purchase",
    license_code: "MIT",
    version_string: "1.0.0",
    outcome: null,
    standard_version_id: null,
    label: null,
    limitation: null,
  };
}

/** `total` synthetic listings, in the order the search would answer them in. */
function catalogueOf(total: number): ListingSummary[] {
  const all: ListingSummary[] = [];
  for (let index = 1; index <= total; index += 1) {
    all.push(summary(index));
  }
  return all;
}

/** The page of that catalogue, laid out at the contract's fixed page size. */
function pageOf(all: readonly ListingSummary[], page: number): ListingSummary[] {
  const from = (page - 1) * LISTING_PAGE_SIZE;
  return all.slice(from, from + LISTING_PAGE_SIZE);
}

/** What the read asked the search for: the pages, in the order they were requested, and the peak in flight. */
interface RecordedReads {
  readonly pages: number[];
  readonly peakInFlight: number;
}

/**
 * Answers the search from a catalogue of `total` listings while recording every page requested and the
 * highest number of requests in flight, then runs the read against it.
 */
async function readCatalogueOf(total: number): Promise<{ readonly listings: ListingSummary[]; readonly reads: RecordedReads }> {
  const all = catalogueOf(total);
  const pages: number[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  listListingsDouble.mockImplementation(
    async (query: ListingSearchQuery): Promise<ListingSearchResult> => {
      pages.push(query.page);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await tick();
      inFlight -= 1;
      return { items: pageOf(all, query.page), total: all.length, page: query.page };
    },
  );

  const listings = await readCatalogueListings();
  return { listings, reads: { pages, peakInFlight } };
}

/** The identifiers of the listings a read returned, in the order it returned them. */
function identifiersOf(listings: readonly ListingSummary[]): string[] {
  return listings.map((listing: ListingSummary): string => listing.id);
}

/** The totals that name no further page, and so end the read at page 1. */
const UNUSABLE_TOTALS: ReadonlyArray<{ readonly label: string; readonly total: number }> = [
  { label: "a total of zero", total: 0 },
  { label: "a negative total", total: -3 },
  { label: "a total below one page that rounds down to zero", total: 0.4 },
  { label: "a total that is not a number", total: Number.NaN },
  { label: "an unbounded total", total: Number.POSITIVE_INFINITY },
];

beforeEach((): void => {
  listListingsDouble.mockReset();
});

describe("readCatalogueListings", () => {
  it("reads page 1 alone, sending only the page and the sort, when the catalogue fits in one page", async () => {
    const { listings, reads } = await readCatalogueOf(LISTING_PAGE_SIZE - 8);

    expect(reads.pages).toEqual([1]);
    expect(reads.peakInFlight).toBe(1);
    expect(listings).toHaveLength(LISTING_PAGE_SIZE - 8);
    expect(listListingsDouble).toHaveBeenCalledWith({ sort: DEFAULT_LISTING_SORT, page: 1 });
  });

  it("requests the pages that remain together once page 1 has reported the total", async () => {
    const { listings, reads } = await readCatalogueOf(LISTING_PAGE_SIZE * 2 + 5);

    // Three pages, and the two that remained were in flight together rather than one after the other.
    expect(reads.pages).toEqual([1, 2, 3]);
    expect(reads.peakInFlight).toBe(2);
    expect(identifiersOf(listings)).toEqual(
      catalogueOf(LISTING_PAGE_SIZE * 2 + 5).map((row: ListingSummary): string => row.id),
    );
  });

  it("requests every remaining page at once, up to the read bound", async () => {
    const { listings, reads } = await readCatalogueOf(LISTING_PAGE_SIZE * 5);

    // Five pages in total, so four remained: the bound admits all four at once.
    expect(reads.pages).toEqual([1, 2, 3, 4, 5]);
    expect(reads.peakInFlight).toBe(4);
    expect(listings).toHaveLength(LISTING_PAGE_SIZE * 5);
  });

  it("stops at its page bound when the total claims more pages than the read follows", async () => {
    const { listings, reads } = await readCatalogueOf(10_000);

    expect(reads.pages).toHaveLength(25);
    expect(reads.pages[0]).toBe(1);
    expect(reads.pages[24]).toBe(25);
    expect(reads.peakInFlight).toBeLessThanOrEqual(4);
    expect(listings).toHaveLength(25 * LISTING_PAGE_SIZE);
  });

  it.each(UNUSABLE_TOTALS)("reads page 1 alone on $label", async ({ total }) => {
    listListingsDouble.mockImplementation(
      async (query: ListingSearchQuery): Promise<ListingSearchResult> => ({
        items: [summary(1), summary(2), summary(3), summary(4), summary(5)],
        total,
        page: query.page,
      }),
    );

    const listings = await readCatalogueListings();

    expect(listListingsDouble).toHaveBeenCalledTimes(1);
    expect(identifiersOf(listings)).toEqual([
      "listing-1",
      "listing-2",
      "listing-3",
      "listing-4",
      "listing-5",
    ]);
  });

  it("reads page 1 alone when the catalogue is empty", async () => {
    const { listings, reads } = await readCatalogueOf(0);

    expect(reads.pages).toEqual([1]);
    expect(listings).toEqual([]);
  });

  it("propagates the failure of a page and returns nothing", async () => {
    const failure = new Error("the third page failed");
    const all = catalogueOf(LISTING_PAGE_SIZE * 2 + 5);
    listListingsDouble.mockImplementation(
      async (query: ListingSearchQuery): Promise<ListingSearchResult> => {
        if (query.page === 3) {
          throw failure;
        }
        return { items: pageOf(all, query.page), total: all.length, page: query.page };
      },
    );

    await expect(readCatalogueListings()).rejects.toBe(failure);
  });
});
