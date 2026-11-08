/**
 * The operator's audit feed as a whole: every page of it, in the order the writes happened.
 *
 * **Why the walk exists.** The operator's ruling surface decides the appeals awaiting a ruling, and
 * the contract names no read that lists appeals: an appeal is opened and ruled through two write
 * rows, and the feed of what was written is the only place both appear. That feed is bounded — one
 * page of `COLLECTION_PAGE_SIZE` events, page 1 holding its most recent page — so a surface reading
 * one page of it would stop offering an appeal as soon as a page's worth of writes had been recorded
 * after the appeal was opened, and the appeal would become unrulable with no error and no partial
 * state to notice. The ruling surface therefore reads the whole feed, page by page, and derives its
 * list from every event the operator is entitled to see.
 *
 * **Page 1 is requested alone; the pages it implies are requested together.** The first page is the
 * read that reports `total`, so it is the only one that cannot be asked for alongside the others.
 * Once it has answered, the pages that cover the reported `total` are known, and they are requested
 * together under a bound instead of one at a time: the walk then costs one round-trip plus
 * ceil(remaining pages / {@link AUDIT_FEED_PAGE_READ_LIMIT}) waves, rather than one round-trip per
 * page, and the bound keeps a long feed from arriving as a single burst at the one process that
 * serves it.
 *
 * **The pages are asked for from the oldest towards page 2, and page 1's events are collected
 * last.** Page 1 holds the feed's newest page and each later page reaches one page further back,
 * while the events within any one page are in the ascending order the feed documents. Asking for the
 * remaining pages in descending order therefore makes each answer's own place in the result the
 * place of the page it answers: the pool returns its results in the order the items were given, so
 * the oldest page's events come first and page 1's events close the list — the result is every page
 * the walk read, in the insertion order the writes happened, with the oldest event first, and nothing
 * has to be reordered once the answers are in.
 *
 * **The walk terminates on the data it was given.** `total` is read as a count of events, so it is
 * usable only as a whole number above zero: a value that is not one — a fractional count, `NaN`, an
 * unbounded one, zero or a negative number — is read as "no more than what page 1 carried", which
 * covers exactly one page and ends the read there. An empty page 1 ends the read as well, and no read
 * follows more than {@link MAX_AUDIT_FEED_PAGES} pages, so a wrong, absurd or slowly advancing
 * `total` cannot make a caller spin. A page beyond the feed's end answers `items: []` and contributes
 * nothing.
 */

import { COLLECTION_PAGE_SIZE } from "@adem/shared";
import type { AuditEvent } from "@adem/shared";

import { listAuditEvents } from "./api-client";
import type { AuditFeedReadResult } from "./api-client";
import { mapWithConcurrency } from "./concurrency";

/** The page of the feed every read starts from, because it is the one that reports `total`. */
const FIRST_AUDIT_FEED_PAGE = 1;

/**
 * How many pages of the feed one read follows before it stops.
 *
 * The bound exists so that the walk ends on the data alone: `total` arrives as a number from the
 * service, and a page that carried nothing would otherwise be asked for again for as long as `total`
 * claimed there was more. Twenty-five pages is five hundred events at the contract's page size, which
 * is far beyond the seeded exchange this foundation ships and still a finite, reachable end.
 */
const MAX_AUDIT_FEED_PAGES = 25;

/**
 * How many feed pages one read may have in flight at once.
 *
 * Each of these requests reads a page of an append-only table and counts the whole table beside it,
 * and the service is one process with one writer, so the bound is deliberately small: it removes the
 * round-trip serialisation without turning a long feed into a burst the single writer has to queue
 * behind.
 */
const AUDIT_FEED_PAGE_READ_LIMIT = 4;

/**
 * Reads every page of the operator's audit feed, in the order the writes happened.
 *
 * The read is operator-only — `GET /audit-events` is one of the API's four non-public reads — so it
 * carries the demo account header, and a caller that is not the operator is refused by the service
 * rather than answered with a partial feed. Page 1 is always requested, because it is the read that
 * reports whether the feed holds any event at all and how many it holds in all; an empty feed is the
 * route's ordinary `200` with `items: []`, which this read answers with the empty list rather than an
 * error.
 *
 * @returns Every event the pages it read carried, in the insertion order the feed documents: the
 *   oldest event first and the newest last. The array is empty when the feed is empty.
 * @throws {Error} The failure of the first request that failed, once the requests already made have
 *   settled — an `ApiClientError` for a refusal (the `403` of an account that is not the operator
 *   among them), or the client's own transport failure.
 */
export async function readAuditFeed(): Promise<AuditEvent[]> {
  const first = await listAuditEvents(FIRST_AUDIT_FEED_PAGE);
  const lastPage = lastAuditFeedPage(first);

  // Descending, so an answer's own place in the list below is the place of the page it answers:
  // page 1 holds the newest page of the feed, and the oldest page is the one furthest back.
  const remainingPages: number[] = [];
  for (let page = lastPage; page > FIRST_AUDIT_FEED_PAGE; page -= 1) {
    remainingPages.push(page);
  }

  const collected: AuditEvent[] = [];
  if (remainingPages.length > 0) {
    const remaining = await mapWithConcurrency(
      remainingPages,
      AUDIT_FEED_PAGE_READ_LIMIT,
      (page: number): Promise<AuditFeedReadResult> => listAuditEvents(page),
    );
    for (const answer of remaining) {
      for (const event of answer.items) {
        collected.push(event);
      }
    }
  }

  // The page that reported the total is the feed's newest page, so its events come last.
  for (const event of first.items) {
    collected.push(event);
  }

  return collected;
}

/**
 * The last page a read of this feed follows: the page that covers the `total` page 1 reported, or
 * page 1 itself when there is nothing further to read.
 *
 * `total` is used only as a count of events — a whole number above zero. Anything else is the absence
 * of a usable count rather than a count to page through, so it covers no more than what page 1 has
 * already carried and ends the read there instead of extending it, and the page that covers it is
 * bounded by {@link MAX_AUDIT_FEED_PAGES} so that a `total` the feed cannot have is still a finite
 * number of requests.
 */
function lastAuditFeedPage(first: AuditFeedReadResult): number {
  if (first.items.length === 0) {
    return FIRST_AUDIT_FEED_PAGE;
  }

  const total = Number.isSafeInteger(first.total) && first.total > 0 ? first.total : first.items.length;
  const covering = Math.ceil(total / COLLECTION_PAGE_SIZE);

  return Math.min(Math.max(covering, FIRST_AUDIT_FEED_PAGE), MAX_AUDIT_FEED_PAGES);
}
