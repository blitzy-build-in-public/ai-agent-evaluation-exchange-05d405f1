/**
 * The bounded pool's contract, pinned to what the module documents: every item processed exactly once,
 * the results in the items' own order, never more than the bound in flight, and a failure propagated to
 * the caller without starting anything further.
 *
 * These are the properties the pages that fan their reads out depend on, so they are asserted as
 * observations of real calls rather than as implementation detail: every case counts the calls in flight
 * and the items a call was started for, which is what a wider burst or a dropped item would move.
 * Expectations are stated as values rather than recomputed from the module, so a case fails when the
 * behaviour changes and never merely when the implementation is rewritten.
 *
 * Each case's own call decides how long it takes, which is what makes the bound observable: a call that
 * resolved without awaiting anything would let the pool hand out the next item in a microtask, before a
 * second worker had ever started.
 */

import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./concurrency";

/**
 * A macrotask turn, so a call's await point is a real turn of the event loop rather than a microtask.
 */
async function tick(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/** What one run of the pool observed: the results, the highest number of calls in flight, the items started. */
interface RunObservation<Result> {
  readonly results: Result[];
  readonly peakInFlight: number;
  readonly itemsStarted: number[];
  readonly failure: unknown;
}

/**
 * Runs the pool over `items` while counting the calls in flight and the items each call was started for,
 * so a case can assert the bound, the order and what a failure did to the items that had not started.
 */
async function observe<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item) => Promise<Result>,
): Promise<RunObservation<Result>> {
  let inFlight = 0;
  let peakInFlight = 0;
  const itemsStarted: number[] = [];

  try {
    const results = await mapWithConcurrency(items, limit, async (item: Item): Promise<Result> => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      itemsStarted.push(Number(item));
      try {
        return await run(item);
      } finally {
        inFlight -= 1;
      }
    });
    return { results, peakInFlight, itemsStarted, failure: null };
  } catch (error: unknown) {
    return { results: [], peakInFlight, itemsStarted, failure: error };
  }
}

/** A call that takes one turn and doubles its item, so the pool's bound is what limits the concurrency. */
async function doublingCall(item: number): Promise<number> {
  await tick();
  return item * 2;
}

/** How a bound that is not a whole number of one or more is read, and the bound it becomes. */
const BOUND_CASES: ReadonlyArray<{
  readonly label: string;
  readonly limit: number;
  readonly bound: number;
}> = [
  { label: "reads a bound of one as one", limit: 1, bound: 1 },
  { label: "reads a bound of three as three", limit: 3, bound: 3 },
  { label: "reads a bound of zero as one", limit: 0, bound: 1 },
  { label: "reads a negative bound as one", limit: -3, bound: 1 },
  { label: "reads a fractional bound below one as one", limit: 0.5, bound: 1 },
  { label: "reads a fractional bound as its whole part", limit: 2.9, bound: 2 },
  { label: "reads a bound that is not a number as one", limit: Number.NaN, bound: 1 },
  { label: "reads an unbounded value as one", limit: Number.POSITIVE_INFINITY, bound: 1 },
];

describe("mapWithConcurrency", () => {
  it.each(BOUND_CASES)("$label", async ({ limit, bound }) => {
    const observation = await observe([1, 2, 3, 4, 5, 6], limit, doublingCall);

    expect(observation.peakInFlight).toBe(bound);
    expect(observation.results).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("runs the whole list at once when the bound is larger than the list", async () => {
    const observation = await observe([1, 2, 3], 10, doublingCall);

    expect(observation.peakInFlight).toBe(3);
    expect(observation.results).toEqual([2, 4, 6]);
  });

  it("makes no call at all for an empty list", async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 4, async (item: never): Promise<never> => {
      calls += 1;
      return item;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("returns the results in the items' own order although the calls finish in another one", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 5, async (item: number): Promise<number> => {
      // The earliest item waits longest, so the completion order is the reverse of the item order.
      for (let wait = 0; wait < 6 - item; wait += 1) {
        await tick();
      }
      return item;
    });

    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects with a call's own failure and starts no item after it", async () => {
    const failure = new Error("the second item failed");
    const observation = await observe([1, 2, 3, 4, 5, 6], 2, async (item: number): Promise<number> => {
      if (item === 2) {
        throw failure;
      }
      // The other call in flight outlives the failure by a turn, which is the window in which the pool
      // must not hand out the next item.
      await tick();
      return item;
    });

    expect(observation.failure).toBe(failure);
    expect(observation.itemsStarted).toEqual([1, 2]);
  });
});
