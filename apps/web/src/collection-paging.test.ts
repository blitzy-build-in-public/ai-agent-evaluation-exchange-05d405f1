/**
 * The paging contract the two collaboration boards share, pinned to what its module documents.
 *
 * `apps/web` has no DOM test environment — no such package is in the dependency inventory — so this
 * workspace's unit tests cover pure functions only, and every assertion below is about values: the
 * page an address asks for, the page a value the address cannot express is refused with, the last page
 * a collection of a stated size has, the address of another page of it, and the four controls with
 * their targets and their stated reasons.
 *
 * Four properties the contract turns on are pinned rather than left to a reader. An absent page and a
 * hand-empty `?page=` both mean page 1, so an address that asks for no particular page is never
 * answered with a refusal. A value outside a whole number of 1 or more is refused with the value as
 * written, so the notice that explains it quotes what the address actually says rather than a value
 * this module replaced. A collection with nothing in it still has a last page, and a page past the end
 * still has a page that holds the collection's rows, which is what the controls send a reader back to.
 * And a page change carries every other parameter of the address through untouched, so the selection
 * or the filters a link carried survive the move.
 *
 * Every expected number and sentence is a literal, so nothing here asserts a value the test cannot
 * reason about from the inputs above it.
 */

import { describe, expect, it } from "vitest";

import {
  ACCEPTED_PAGE_VALUES,
  PAGE_PARAM,
  collectionPageHref,
  collectionPagerControls,
  lastPageNumber,
  readRequestedPage,
} from "./collection-paging";
import type { PagerControl } from "./collection-paging";

/** The address with these parameters, built from pairs so a blank value stays blank. */
function paramsOf(...pairs: ReadonlyArray<readonly [string, string]>): URLSearchParams {
  return new URLSearchParams(pairs.map(([name, value]): [string, string] => [name, value]));
}

/** Values that are not a whole page number of 1 or more, each refused as the address wrote it. */
const REFUSED_PAGE_VALUES: readonly { readonly label: string; readonly value: string }[] = [
  { label: "zero", value: "0" },
  { label: "a negative number", value: "-1" },
  { label: "a fraction", value: "2.5" },
  { label: "a word", value: "abc" },
];

/** A collection's own size, and the last page that size has at the fixed page size of 20. */
const COLLECTION_SIZES: readonly { readonly total: number; readonly lastPage: number }[] = [
  { total: 0, lastPage: 1 },
  { total: 1, lastPage: 1 },
  { total: 20, lastPage: 1 },
  { total: 21, lastPage: 2 },
  { total: 24, lastPage: 2 },
  { total: 28, lastPage: 2 },
  { total: 40, lastPage: 2 },
];

/** The four controls, in the order the row renders them, as one comparable value. */
function controlsOf(page: number, lastPage: number, collectionName: string): readonly PagerControl[] {
  return collectionPagerControls(page, lastPage, collectionName);
}

describe("the paging contract", () => {
  it("names the page parameter the address and the request both spell", () => {
    expect(PAGE_PARAM).toBe("page");
    expect(ACCEPTED_PAGE_VALUES).toBe("a whole page number of 1 or more");
  });
});

describe("readRequestedPage", () => {
  it("asks for page 1 when the address carries no page parameter", () => {
    expect(readRequestedPage(paramsOf())).toEqual({ kind: "requested", page: 1 });
  });

  it("asks for page 1 when the page parameter is written with no value", () => {
    expect(readRequestedPage(paramsOf([PAGE_PARAM, ""]))).toEqual({ kind: "requested", page: 1 });
  });

  it("asks for page 1 when the page parameter is written with spaces alone", () => {
    expect(readRequestedPage(paramsOf([PAGE_PARAM, "   "]))).toEqual({ kind: "requested", page: 1 });
  });

  it("asks for the page the address names", () => {
    expect(readRequestedPage(paramsOf([PAGE_PARAM, "2"]))).toEqual({ kind: "requested", page: 2 });
  });

  it("reads a page written with a trailing zero as the whole number it is", () => {
    expect(readRequestedPage(paramsOf([PAGE_PARAM, "2.0"]))).toEqual({ kind: "requested", page: 2 });
  });

  it("carries every other parameter of the address past the page it reads", () => {
    const requested = readRequestedPage(paramsOf(["id", "challenge-1"], [PAGE_PARAM, "3"]));

    expect(requested).toEqual({ kind: "requested", page: 3 });
  });

  it.each(REFUSED_PAGE_VALUES)("refuses $label as the value the address wrote", ({ value }) => {
    expect(readRequestedPage(paramsOf([PAGE_PARAM, value]))).toEqual({
      kind: "refused",
      value,
    });
  });

  it("refuses a fraction as the value the address wrote rather than rounding it", () => {
    const requested = readRequestedPage(paramsOf([PAGE_PARAM, " 2.5 "]));

    expect(requested).toEqual({ kind: "refused", value: "2.5" });
  });
});

describe("lastPageNumber", () => {
  it.each(COLLECTION_SIZES)("answers page $lastPage for a collection of $total", ({ total, lastPage }) => {
    expect(lastPageNumber(total)).toBe(lastPage);
  });

  it("answers page 1 for a total the product's own arithmetic cannot page", () => {
    expect(lastPageNumber(Number.POSITIVE_INFINITY)).toBe(1);
    expect(lastPageNumber(Number.NaN)).toBe(1);
  });
});

describe("collectionPageHref", () => {
  it("carries every other parameter of the address through a page change", () => {
    const address = paramsOf(["id", "thread-4"], [PAGE_PARAM, "1"]);

    expect(collectionPageHref("/threads", address, 2)).toBe("/threads?id=thread-4&page=2");
  });

  it("writes the page parameter as the address's own last parameter", () => {
    const address = paramsOf(["id", "thread-4"], [PAGE_PARAM, "2"]);

    expect(collectionPageHref("/threads", address, 3)).toBe("/threads?id=thread-4&page=3");
  });

  it("drops the page parameter on the collection's first page", () => {
    const address = paramsOf(["id", "thread-4"], [PAGE_PARAM, "7"]);

    expect(collectionPageHref("/threads", address, 1)).toBe("/threads?id=thread-4");
  });

  it("leaves no trailing separator when the first page carries nothing else", () => {
    expect(collectionPageHref("/threads", paramsOf([PAGE_PARAM, "2"]), 1)).toBe("/threads");
    expect(collectionPageHref("/challenges", paramsOf(), 1)).toBe("/challenges");
  });

  it("replaces a page value the contract does not hold rather than carrying it along", () => {
    const address = paramsOf(["id", "thread-4"], [PAGE_PARAM, "abc"]);

    expect(collectionPageHref("/threads", address, 2)).toBe("/threads?id=thread-4&page=2");
  });
});

describe("collectionPagerControls", () => {
  it("offers both directions from a middle page and blocks neither", () => {
    expect(controlsOf(2, 3, "board")).toEqual([
      { label: "First page", targetPage: 1, blockedReason: null },
      { label: "Previous page", targetPage: 1, blockedReason: null },
      { label: "Next page", targetPage: 3, blockedReason: null },
      { label: "Last page", targetPage: 3, blockedReason: null },
    ]);
  });

  it("blocks the two backward controls on the first page and names why", () => {
    expect(controlsOf(1, 3, "board")).toEqual([
      { label: "First page", targetPage: 1, blockedReason: "this is the first page" },
      { label: "Previous page", targetPage: 1, blockedReason: "this is the first page" },
      { label: "Next page", targetPage: 2, blockedReason: null },
      { label: "Last page", targetPage: 3, blockedReason: null },
    ]);
  });

  it("blocks the two forward controls on the last page of a collection of several pages", () => {
    expect(controlsOf(3, 3, "board")).toEqual([
      { label: "First page", targetPage: 1, blockedReason: null },
      { label: "Previous page", targetPage: 2, blockedReason: null },
      { label: "Next page", targetPage: 3, blockedReason: "this is the last page" },
      { label: "Last page", targetPage: 3, blockedReason: "this is the last page" },
    ]);
  });

  it("states that the collection fits on one page when it has only one", () => {
    expect(controlsOf(1, 1, "board")).toEqual([
      { label: "First page", targetPage: 1, blockedReason: "this is the first page" },
      { label: "Previous page", targetPage: 1, blockedReason: "this is the first page" },
      { label: "Next page", targetPage: 1, blockedReason: "the board fits on one page" },
      { label: "Last page", targetPage: 1, blockedReason: "the board fits on one page" },
    ]);
  });

  it("sends a reader past the end back to the last page that holds rows", () => {
    expect(controlsOf(99, 2, "board")).toEqual([
      { label: "First page", targetPage: 1, blockedReason: null },
      { label: "Previous page", targetPage: 2, blockedReason: null },
      { label: "Next page", targetPage: 2, blockedReason: "the board stops at page 2" },
      { label: "Last page", targetPage: 2, blockedReason: null },
    ]);
  });

  it("states where the rows stop, and not where the reader stands, from two pages past the end", () => {
    const controls = controlsOf(42, 3, "board");

    expect(controls[1]).toEqual({ label: "Previous page", targetPage: 3, blockedReason: null });
    expect(controls[2]).toEqual({
      label: "Next page",
      targetPage: 3,
      blockedReason: "the board stops at page 3",
    });
    expect(controls[3]).toEqual({ label: "Last page", targetPage: 3, blockedReason: null });
  });

  it("names the collection the caller is paging through in the reasons that state one", () => {
    const controls = controlsOf(1, 1, "ledger");

    expect(controls[2]?.blockedReason).toBe("the ledger fits on one page");
    expect(controls[3]?.blockedReason).toBe("the ledger fits on one page");
  });
});
