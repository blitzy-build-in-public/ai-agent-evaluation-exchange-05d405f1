/**
 * The audit feed read's contract, pinned to what the module documents: page 1 alone is the read that
 * reports `total`, the pages that cover that total are requested together under the bound rather than
 * one at a time, their answers are collected so that the oldest event comes first, and the walk ends
 * on the data it was given.
 *
 * The feed read is replaced by a recording double, so each case can assert what the walk asked for and
 * how much of it was in flight at once: which pages of the feed the ruling surface reaches is the whole
 * subject of the finding this read exists to resolve, and it is not observable from the returned array.
 * Expectations are stated as values rather than recomputed from the module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { COLLECTION_PAGE_SIZE } from "@adem/shared";
import type { AuditEvent } from "@adem/shared";

import { listAuditEvents } from "./api-client";
import type { AuditFeedReadResult } from "./api-client";
import { readAuditFeed } from "./audit-feed-read";

vi.mock("./api-client", (): { readonly listAuditEvents: unknown } => ({
  listAuditEvents: vi.fn(),
}));

const listAuditEventsDouble = vi.mocked(listAuditEvents);

/** A macrotask turn, so the walk's bound is observable rather than hidden by microtask ordering. */
async function tick(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/** One synthetic audit row, shaped as the feed answers it. */
function auditEvent(index: number): AuditEvent {
  return {
    id: `event-${String(index)}`,
    actor_account_id: "account-operator",
    action: "listing.created",
    resource_type: "listing",
    resource_id: `listing-${String(index)}`,
    status_code: 201,
    reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

/** `total` synthetic events, in the order the feed holds them: the oldest first. */
function feedOf(total: number): AuditEvent[] {
  const all: AuditEvent[] = [];
  for (let index = 1; index <= total; index += 1) {
    all.push(auditEvent(index));
  }
  return all;
}

/**
 * The page of that feed, laid out at the contract's fixed page size from the newest end: page 1 holds
 * the most recent entries and each later page reaches one page further back, while the events within
 * one page stay in the ascending order the feed documents.
 */
function pageOf(all: readonly AuditEvent[], page: number): AuditEvent[] {
  const end = all.length - (page - 1) * COLLECTION_PAGE_SIZE;
  return all.slice(Math.max(0, end - COLLECTION_PAGE_SIZE), Math.max(0, end));
}

/** What the walk asked the feed for: the pages, in the order they were requested, and the peak in flight. */
interface RecordedReads {
  readonly pages: number[];
  readonly peakInFlight: number;
}

/**
 * Answers the feed from a feed of `total` events while recording every page requested and the highest
 * number of requests in flight, then runs the walk against it. `claimedTotal` is what the read reports
 * as the feed's size, so a case can state a size the feed it answers from does not hold.
 */
async function readFeedOf(
  total: number,
  claimedTotal: number = total,
): Promise<{ readonly events: AuditEvent[]; readonly reads: RecordedReads }> {
  const all = feedOf(total);
  const pages: number[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  listAuditEventsDouble.mockImplementation(
    async (page: number): Promise<AuditFeedReadResult> => {
      pages.push(page);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await tick();
      inFlight -= 1;
      return { items: pageOf(all, page), total: claimedTotal, page };
    },
  );

  const events = await readAuditFeed();
  return { events, reads: { pages, peakInFlight } };
}

/** The identifiers of the events a read returned, in the order it returned them. */
function identifiersOf(events: readonly AuditEvent[]): string[] {
  return events.map((event: AuditEvent): string => event.id);
}

/** The totals that name no further page, and so end the walk at page 1. */
const UNUSABLE_TOTALS: ReadonlyArray<{ readonly label: string; readonly total: number }> = [
  { label: "a total of zero", total: 0 },
  { label: "a negative total", total: -3 },
  { label: "a fractional total below one event", total: 0.4 },
  { label: "a fractional total that would claim another page", total: COLLECTION_PAGE_SIZE * 2 + 0.5 },
  { label: "a total that is not a number", total: Number.NaN },
  { label: "an unbounded total", total: Number.POSITIVE_INFINITY },
];

beforeEach((): void => {
  listAuditEventsDouble.mockReset();
});

describe("readAuditFeed", () => {
  it("reads page 1 alone, sending only the page, when the feed fits in one page", async () => {
    const { events, reads } = await readFeedOf(COLLECTION_PAGE_SIZE - 12);

    expect(reads.pages).toEqual([1]);
    expect(reads.peakInFlight).toBe(1);
    expect(listAuditEventsDouble).toHaveBeenCalledWith(1);
    expect(identifiersOf(events)).toEqual(
      feedOf(COLLECTION_PAGE_SIZE - 12).map((event: AuditEvent): string => event.id),
    );
  });

  it("requests the pages that remain together once page 1 has reported the total", async () => {
    const { events, reads } = await readFeedOf(COLLECTION_PAGE_SIZE * 2 + 5);

    // Three pages: page 1 alone, then the two that remained together rather than one after the other.
    expect(reads.pages).toEqual([1, 3, 2]);
    expect(reads.peakInFlight).toBe(2);
    expect(listAuditEventsDouble).toHaveBeenCalledWith(2);
    expect(listAuditEventsDouble).toHaveBeenCalledWith(3);
    expect(identifiersOf(events)).toEqual(
      feedOf(COLLECTION_PAGE_SIZE * 2 + 5).map((event: AuditEvent): string => event.id),
    );
  });

  it("requests every remaining page at once, up to the walk's bound", async () => {
    const { events, reads } = await readFeedOf(COLLECTION_PAGE_SIZE * 5);

    // Five pages in total, so four remained: the bound admits all four at once.
    expect(reads.pages).toEqual([1, 5, 4, 3, 2]);
    expect(reads.peakInFlight).toBe(4);
    expect(events).toHaveLength(COLLECTION_PAGE_SIZE * 5);
  });

  it("collects the pages in the order the writes happened, page 2's events before page 1's", async () => {
    const all = feedOf(COLLECTION_PAGE_SIZE + 6);
    const older = pageOf(all, 2);
    const newer = pageOf(all, 1);

    const { events, reads } = await readFeedOf(COLLECTION_PAGE_SIZE + 6);

    expect(reads.pages).toEqual([1, 2]);
    expect(older).toHaveLength(6);
    expect(newer).toHaveLength(COLLECTION_PAGE_SIZE);
    expect(identifiersOf(events)).toEqual([...identifiersOf(older), ...identifiersOf(newer)]);
    expect(identifiersOf(events)[0]).toBe("event-1");
    expect(identifiersOf(events)[COLLECTION_PAGE_SIZE + 5]).toBe(
      `event-${String(COLLECTION_PAGE_SIZE + 6)}`,
    );
  });

  it("stops at its page bound when the total claims more pages than the walk follows", async () => {
    const { events, reads } = await readFeedOf(COLLECTION_PAGE_SIZE * 25, 10_000);

    expect(reads.pages).toHaveLength(25);
    expect(reads.pages[0]).toBe(1);
    expect(reads.pages[1]).toBe(25);
    expect(reads.pages[24]).toBe(2);
    expect(reads.peakInFlight).toBeLessThanOrEqual(4);
    expect(events).toHaveLength(25 * COLLECTION_PAGE_SIZE);
    // Collected oldest first, so the first event is the oldest the walk reached, not page 1's newest.
    expect(identifiersOf(events)[0]).toBe("event-1");
    expect(identifiersOf(events)[24 * COLLECTION_PAGE_SIZE]).toBe(
      `event-${String(24 * COLLECTION_PAGE_SIZE + 1)}`,
    );
  });

  it.each(UNUSABLE_TOTALS)("reads page 1 alone on $label", async ({ total }) => {
    listAuditEventsDouble.mockImplementation(
      async (page: number): Promise<AuditFeedReadResult> => ({
        items: [auditEvent(1), auditEvent(2), auditEvent(3), auditEvent(4), auditEvent(5)],
        total,
        page,
      }),
    );

    const events = await readAuditFeed();

    expect(listAuditEventsDouble).toHaveBeenCalledTimes(1);
    expect(listAuditEventsDouble).toHaveBeenCalledWith(1);
    expect(identifiersOf(events)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
    ]);
  });

  it("reads page 1 alone when the feed is empty", async () => {
    const { events, reads } = await readFeedOf(0);

    expect(reads.pages).toEqual([1]);
    expect(events).toEqual([]);
  });

  it("propagates the failure of a page and returns nothing", async () => {
    const failure = new Error("the second page failed");
    const all = feedOf(COLLECTION_PAGE_SIZE * 2 + 5);
    listAuditEventsDouble.mockImplementation(
      async (page: number): Promise<AuditFeedReadResult> => {
        if (page === 2) {
          throw failure;
        }
        return { items: pageOf(all, page), total: all.length, page };
      },
    );

    await expect(readAuditFeed()).rejects.toBe(failure);
  });
});
