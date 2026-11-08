/**
 * Unit test for the write rate limit's counter store: the one fixed-window map every write route of
 * the API counts into.
 *
 * **What it covers, and against what.** In-process, with no server, no database and no request: it
 * constructs {@link WriteRateLimitStore} with the options the plugin's registration hands it and reads
 * the window each increment answers with.
 *
 * The first case asserts the property this store exists for, at its root cause: the plugin asks a
 * registered store for a child once per route that declares a bound, and the plugin's own store answers
 * with a fresh map every time, so a test that two children are one instance — and that writes through
 * them meet one count — is exactly what makes the bound the client's rather than the route's. The rest
 * assert what one route observes, which must not change: a second client counts in a window of its own,
 * a window that elapsed starts a fresh count, the remaining time is the value the plugin's own store
 * would report for each instant, and the map stays bounded by the capacity it was given.
 *
 * **What it deliberately does not cover.** That a route's `max` is applied to the count, that the
 * refusal is `429` with the one envelope and a numeric `Retry-After`, and that a write on one route is
 * refused once another route spent the bound are behaviours of the assembled server, and they belong to
 * `apps/api/test/integration/route-walk.test.ts`, which asserts them against the real instance.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { WriteRateLimitStore } from "./write-rate-limit-store";

/**
 * The window this suite's stores count in, in milliseconds.
 *
 * It is deliberately not the plugin's own sixty-second default: a value distinct from the fallback is
 * what shows that the window comes from the registration the plugin hands over rather than from this
 * module's own default.
 */
const WINDOW_MS = 20_000;

/**
 * The window the plugin counts in when the registration states none it can use.
 *
 * The number is the plugin's own `defaultTimeWindow` (`node_modules/@fastify/rate-limit/index.js`), and
 * it is written here because it is the reference this store's documented fallback is held to: a case
 * asserting the fallback reads its expected value from the plugin's contract rather than from this
 * module.
 */
const PLUGIN_DEFAULT_WINDOW_MS = 60_000;

/**
 * A fixed instant every fake-clock case measures from.
 *
 * Without one, each case would measure against the moment the suite happened to run, and an elapsed
 * time would be an assumption about how long the assertions between two increments took.
 */
const START = new Date("2026-01-01T00:00:00.000Z");

/**
 * The keys this suite counts under. The plugin derives them from the caller's address, but the store
 * only ever compares them, so the suite states a label per client rather than an address.
 */
const CLIENT_A = "client-a";
const CLIENT_B = "client-b";
const CLIENT_C = "client-c";

/**
 * Counts one write on the store and answers the window it landed in.
 *
 * The store's contract is a callback rather than a return value, and it answers on the same call, so
 * the callback's values are read back here instead of being awaited: a case that had to await would no
 * longer show that an increment is synchronous, which is what keeps a write's rate-limit check one map
 * operation. A synchronous store that never called its callback would leave this helper with no window,
 * so that is reported rather than returned as an undefined value.
 */
function count(
  store: WriteRateLimitStore,
  key: string,
): { readonly current: number; readonly ttl: number } {
  let window: { readonly current: number; readonly ttl: number } | undefined;

  store.incr(key, (error, result) => {
    expect(error).toBeNull();
    window = result;
  });

  if (window === undefined) {
    throw new Error("write-rate-limit-store test: the increment answered no window.");
  }

  return window;
}

/** Builds the store a registration with this window and capacity hands over. */
function storeOf(options: { readonly cache?: number } = {}): WriteRateLimitStore {
  return options.cache === undefined
    ? new WriteRateLimitStore({ timeWindow: WINDOW_MS })
    : new WriteRateLimitStore({ timeWindow: WINDOW_MS, cache: options.cache });
}

/** Moves the fake clock to the given number of milliseconds after {@link START}. */
function setClock(elapsedMs: number): void {
  vi.setSystemTime(new Date(START.getTime() + elapsedMs));
}

describe("write rate limit store", () => {
  afterEach(() => {
    // Every case that drives the clock turns it back, so a case that reads the real one — or the
    // afterEach hooks of the forked worker around this file — is never left on a frozen instant.
    vi.useRealTimers();
  });

  describe("shared counter", () => {
    it("answers every route with the one store, so two routes' writes meet one bound", () => {
      const store = storeOf();

      // Two routes of the API. The plugin asks the registered store for a child once per route that
      // declares `config.rateLimit`; the plugin's own store answers with a new store and a fresh counter
      // map here, which is the reported defect — a bucket per route.
      const firstRoute = store.child();
      const secondRoute = store.child();

      expect(firstRoute).toBe(store);
      expect(secondRoute).toBe(store);
      expect(secondRoute).toBe(firstRoute);

      // The consequence the identity exists for: writes through two routes, one client, one count.
      expect(count(store, CLIENT_A).current).toBe(1);
      expect(count(secondRoute, CLIENT_A).current).toBe(2);
      expect(count(firstRoute, CLIENT_A).current).toBe(3);
      expect(count(store, CLIENT_A).current).toBe(4);
    });

    it("counts a second client in a window of its own", () => {
      const store = storeOf();

      expect(count(store, CLIENT_A).current).toBe(1);
      expect(count(store, CLIENT_A).current).toBe(2);
      expect(count(store, CLIENT_B).current).toBe(1);
      expect(count(store, CLIENT_B).current).toBe(2);
      expect(count(store, CLIENT_A).current).toBe(3);
    });
  });

  describe("fixed window", () => {
    /**
     * A second write inside the window, at the given number of milliseconds after the first, and the
     * remaining time it must report: the window's length less the elapsed part of it. The last two
     * entries are the boundary either side of the window's end.
     */
    const SECOND_WRITE: ReadonlyArray<readonly [number, number]> = [
      [0, WINDOW_MS],
      [1, WINDOW_MS - 1],
      [WINDOW_MS / 2, WINDOW_MS / 2],
      [WINDOW_MS - 1, 1],
    ];

    it.each(SECOND_WRITE)(
      "counts a second write %i ms into the window as its second and reports %i ms left",
      (elapsedMs, remainingMs) => {
        vi.useFakeTimers();
        setClock(0);

        const store = storeOf();

        expect(count(store, CLIENT_A)).toEqual({ current: 1, ttl: WINDOW_MS });

        setClock(elapsedMs);

        expect(count(store, CLIENT_A)).toEqual({ current: 2, ttl: remainingMs });
      },
    );

    /**
     * A write at or after the instant the window ends, and the count it must start: the window has
     * elapsed, so nothing of the writes before it is remembered.
     */
    const ELAPSED: readonly number[] = [WINDOW_MS, WINDOW_MS + 1, WINDOW_MS * 5];

    it.each(ELAPSED)("starts a fresh window for a write %i ms in", (elapsedMs) => {
      vi.useFakeTimers();
      setClock(0);

      const store = storeOf();

      expect(count(store, CLIENT_A).current).toBe(1);
      expect(count(store, CLIENT_A).current).toBe(2);

      setClock(elapsedMs);

      expect(count(store, CLIENT_A)).toEqual({ current: 1, ttl: WINDOW_MS });
    });
  });

  describe("bounded map", () => {
    it("drops the least recently used client's window when its capacity is reached", () => {
      const store = storeOf({ cache: 2 });

      expect(count(store, CLIENT_A).current).toBe(1);
      expect(count(store, CLIENT_B).current).toBe(1);
      expect(count(store, CLIENT_B).current).toBe(2);

      // One client more than the capacity holds: the window of the client that has gone longest
      // without a write is dropped, and the two most recent are kept.
      expect(count(store, CLIENT_C).current).toBe(1);

      // Nothing about the dropped client is remembered, so its next write starts a fresh window — the
      // same answer a client that had not written for a whole window would receive.
      expect(count(store, CLIENT_A)).toEqual({ current: 1, ttl: WINDOW_MS });

      // The windows the map still holds carry their own counts on, which is what shows one window was
      // evicted rather than the map being cleared.
      expect(count(store, CLIENT_C).current).toBe(2);
      expect(count(store, CLIENT_A).current).toBe(2);
    });

    /**
     * A capacity a map cannot be held to, and the number of clients the store must still hold after it
     * falls back: more than a fallback of nothing would, so a capacity of zero cannot silently mean a
     * map that drops every window as it is written.
     */
    const UNUSABLE_CAPACITY: readonly number[] = [0, -1, 2.5, Number.NaN];

    it.each(UNUSABLE_CAPACITY)("falls back from a capacity of %s rather than evicting", (cache) => {
      const store = new WriteRateLimitStore({ timeWindow: WINDOW_MS, cache });

      expect(count(store, CLIENT_A).current).toBe(1);
      expect(count(store, CLIENT_B).current).toBe(1);
      expect(count(store, CLIENT_C).current).toBe(1);

      // With no eviction, the first client's window is intact: a fallback of zero would have dropped it
      // by the second write, and the count would be one.
      expect(count(store, CLIENT_A).current).toBe(2);
    });
  });

  describe("options the registration cannot use", () => {
    /**
     * A window the store cannot count in, and the plugin's own default it must fall back to. The
     * fallback is the window the plugin's `LocalStore` counts in when the registration states none, so
     * a registration that states nothing behaves as it would have without this store.
     */
    const UNUSABLE_WINDOW: ReadonlyArray<readonly [string, number | undefined]> = [
      ["an absent window", undefined],
      ["a zero window", 0],
      ["a negative window", -1],
      ["a window that is not a number", Number.NaN],
      ["an infinite window", Number.POSITIVE_INFINITY],
    ];

    it.each(UNUSABLE_WINDOW)(
      "counts in the plugin's own sixty-second window given %s",
      (_stated, timeWindow) => {
        vi.useFakeTimers();
        setClock(0);

        const store =
          timeWindow === undefined
            ? new WriteRateLimitStore()
            : new WriteRateLimitStore({ timeWindow });

        expect(count(store, CLIENT_A)).toEqual({
          current: 1,
          ttl: PLUGIN_DEFAULT_WINDOW_MS,
        });

        // The fallback is a window the store actually counts in, not only the number it reports once:
        // the last millisecond of it is still inside the window.
        setClock(PLUGIN_DEFAULT_WINDOW_MS - 1);

        expect(count(store, CLIENT_A)).toEqual({ current: 2, ttl: 1 });

        setClock(PLUGIN_DEFAULT_WINDOW_MS);

        expect(count(store, CLIENT_A)).toEqual({
          current: 1,
          ttl: PLUGIN_DEFAULT_WINDOW_MS,
        });
      },
    );
  });
});
