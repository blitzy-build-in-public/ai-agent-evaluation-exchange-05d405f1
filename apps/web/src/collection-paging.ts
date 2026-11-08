/**
 * The paging contract the two collaboration boards share: which page an address asks for, which
 * pages a collection of a stated size has, the address of another page of it, and the controls a
 * pager offers — all of it as pure functions over values a caller already holds.
 *
 * Both boards read one bounded page of a collection the service counts in full, so both need the
 * same five answers, and a second spelling of any of them is where the two would drift: a page read
 * from an address by one rule and rendered by another, or a past-the-end page explained as a missing
 * collection by one board and as an empty page by the other. The rule the whole module turns on is
 * stated once here — the page size is the fixed {@link COLLECTION_PAGE_SIZE} of the shared constants
 * and is never a client input, so a collection's last page is arithmetic over its own `total` rather
 * than something a page guesses from the rows it happens to hold.
 *
 * A value the contract cannot express is refused rather than replaced: an address carrying
 * `?page=abc` is reported as it stands, with the value quoted as written, because a page that
 * silently read page 1 while its address asked for something else would be a page whose own address
 * is not what it shows. The other end is the same rule — a page beyond the last is not an error the
 * service answers and not a value this module invents a fix for: it is an ordinary page that holds
 * nothing, which is why {@link lastPageNumber} has a well-defined answer for every collection,
 * empty ones included.
 *
 * The address a page of the collection is read at is built here too, so a parameter this module does
 * not know about — a board's own selection, a filter, anything a reader's link carries — survives a
 * page change untouched. Nothing in this file reads a clock, a locale, storage or the network: it is
 * arithmetic and string building over the values it was given, which is what lets a page change be
 * reproduced from the address alone.
 */

import { COLLECTION_PAGE_SIZE } from "@adem/shared";

/**
 * The query parameter that names which page of a collection to read. It is spelled exactly as the
 * shared collection-page schema spells it, so the address a board renders and the request the client
 * builds from it name the same page by the same word.
 */
export const PAGE_PARAM = "page";

/**
 * What the board reads accept as a page, in a reader's terms. It is the sentence a refusal notice
 * states, so the value an address cannot express is answered with what could be sent in its place.
 */
export const ACCEPTED_PAGE_VALUES = "a whole page number of 1 or more";

/**
 * The page an address asks for: the number to read, or the value the address carries where the
 * contract cannot express it.
 *
 * An absent parameter and one written with no value both mean page 1: `?page=` is an address that
 * asks for no particular page, and answering it with a refusal would report a mistake the reader did
 * not make. A value that is not a whole number of 1 or more is refused with the value as written, so
 * the notice that explains it can quote what the address actually says.
 */
export type RequestedPage =
  | { readonly kind: "requested"; readonly page: number }
  | { readonly kind: "refused"; readonly value: string };

/**
 * Reads the page an address carries, and what the address states when it carries no page this
 * contract can express.
 *
 * The value is read the way the listing search reads its own page parameter — trimmed, then taken as
 * a number — so the two paged surfaces of the product accept exactly the same spellings of a page:
 * `2` and `2.0` are page two, while `0`, `-1`, `2.5` and `abc` are values the contract does not
 * hold.
 */
export function readRequestedPage(params: URLSearchParams): RequestedPage {
  const raw = params.get(PAGE_PARAM);
  if (raw === null) {
    return { kind: "requested", page: 1 };
  }
  const value = raw.trim();
  if (value === "") {
    return { kind: "requested", page: 1 };
  }
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return { kind: "refused", value };
  }
  return { kind: "requested", page };
}

/**
 * The last page a collection of this size has, and page 1 for a collection that holds nothing.
 *
 * Both edges matter and neither is a special case a caller has to guard: an empty collection has a
 * last page a pager can name rather than a page zero that no address can express, and a page past
 * the last still has a page that holds the collection's rows, which is where the controls and the
 * past-the-end state send a reader. A total the product's own arithmetic cannot page — not a finite
 * number — is read as the single page it must fit in, so a caller holding a count it could not read
 * renders a pager over one page rather than an unusable one.
 */
export function lastPageNumber(total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));
}

/**
 * The address of one page of the same collection.
 *
 * Every other parameter is carried through untouched, so the selection, the filters and anything else
 * a reader's link held survive the move, and the page parameter is dropped rather than written as
 * `1` on the collection's first page: the shortest address that means a page is the one the page
 * itself offers, and a reader who followed it can see that nothing was set. No trailing separator is
 * left on an address that carries nothing else.
 */
export function collectionPageHref(
  path: string,
  params: URLSearchParams,
  targetPage: number,
): string {
  const next = new URLSearchParams(params);
  if (targetPage <= 1) {
    next.delete(PAGE_PARAM);
  } else {
    next.set(PAGE_PARAM, String(targetPage));
  }
  const serialized = next.toString();
  return serialized === "" ? path : `${path}?${serialized}`;
}

/** One paging control: where it moves a reader to, or why it cannot move at all. */
export interface PagerControl {
  /** The control's own label, which is also its key in the row a pager renders. */
  readonly label: string;
  /** The page the control moves to when it can move. */
  readonly targetPage: number;
  /** Why the control cannot move, or `null` when it can. */
  readonly blockedReason: string | null;
}

/** The reason a control states when it cannot move backwards: there is nothing before the first page. */
const FIRST_PAGE_REASON = "this is the first page";

/** The reason a control states on a collection that has nowhere further to go. */
const LAST_PAGE_REASON = "this is the last page";

/**
 * The four paging controls, each either moving a reader or stating why it cannot.
 *
 * Two questions decide what a control says, and they are not the same question: whether the reader
 * stands on the last page, and whether they have gone past it. A reader past the end still has a page
 * that holds the collection's rows to return to, so Last stays a real link back to it and Previous
 * steps back to it as well rather than to the empty page in between — which is the page the
 * past-the-end state's own link already offers. Only a reader standing on the last page is told that
 * it is the last one.
 *
 * The collection is named in the one reason that states a size and in the reason that states where
 * the rows stop, because "the results fit on one page" says nothing about what fitted: a control
 * reads as a sentence about the collection the reader is paging through.
 */
export function collectionPagerControls(
  page: number,
  lastPage: number,
  collectionName: string,
): readonly PagerControl[] {
  const atFirstPage = page <= 1;
  const onLastPage = page === lastPage;
  const pastLastPage = page > lastPage;
  const lastPageReason =
    lastPage === 1 ? `the ${collectionName} fits on one page` : LAST_PAGE_REASON;

  // Next cannot move once the reader has reached the last page or gone beyond it, and which of the two
  // it is decides the reason it states: on the last page the collection ends there, while past it the
  // rows stopped at a page the reader has already left behind.
  let nextBlockedReason: string | null = null;
  if (onLastPage) {
    nextBlockedReason = lastPageReason;
  } else if (pastLastPage) {
    nextBlockedReason = `the ${collectionName} stops at page ${String(lastPage)}`;
  }

  return [
    {
      label: "First page",
      targetPage: 1,
      blockedReason: atFirstPage ? FIRST_PAGE_REASON : null,
    },
    {
      label: "Previous page",
      // The greater lower bound of the last page and the page before this one: from two or more pages
      // past the end, Previous lands on the last page that holds rows rather than walking the reader
      // back through the empty pages in between.
      targetPage: Math.max(1, Math.min(lastPage, page - 1)),
      blockedReason: atFirstPage ? FIRST_PAGE_REASON : null,
    },
    {
      label: "Next page",
      targetPage: Math.min(lastPage, page + 1),
      blockedReason: nextBlockedReason,
    },
    {
      label: "Last page",
      targetPage: lastPage,
      blockedReason: onLastPage ? lastPageReason : null,
    },
  ];
}
