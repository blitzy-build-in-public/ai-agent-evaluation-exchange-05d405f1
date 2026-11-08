/**
 * The write rate limit's counter store: **one fixed-window counter per client, shared by every write
 * route of this API**.
 *
 * **Why one store and not one per route.** `@fastify/rate-limit` builds one store when it is
 * registered and, in its `onRoute` hook, asks that store for a child once per route that declares
 * `config.rateLimit` — the `pluginComponent.store.child(...)` call in
 * `node_modules/@fastify/rate-limit/index.js`. A child of the plugin's own `LocalStore` is a **new**
 * store with a counter map of its own, so fifteen write routes would count in fifteen buckets and one
 * client could make sixty writes a minute on each of them. The contract fixes **one** bound of sixty
 * write requests per minute per client — the plan's performance requirement, and the mitigation its
 * threat model states for a write flood against the single-writer store — so the counter must be one
 * map, and the store the plugin is registered with is the only seam that makes it one.
 *
 * **What it guarantees.** {@link WriteRateLimitStore.child} answers with the instance itself, and that
 * single member is what makes the bound the client's rather than the route's: every rate-limited
 * route's hook counts into the same map. The key is the string the plugin's own key generator
 * derives — the caller's address, because neither this workspace's registration nor any route
 * configures a `keyGenerator` — so the counter follows the client and not the demo account, the route
 * or the method. Each route's own `max` is still applied per request by the plugin's hook, which is
 * what lets one counter serve fifteen routes that each declare the same sixty.
 *
 * {@link WriteRateLimitStore.incr} keeps the fixed-window semantics the plugin's `LocalStore` has, so
 * a single route behaves exactly as it did: the first write of a window starts the window, a later
 * write inside it increments the count and reports what is left of the window, and a write after the
 * window elapsed starts a fresh one. The count, never the instant of the last refusal, is what the
 * hook compares with the route's `max`.
 *
 * **What it deliberately is not.** It is in-memory and holds at most one window per client, with
 * {@link DEFAULT_KEY_CAPACITY} as the ceiling: there is no persistence, so a restart clears every
 * counter; there is no shared or external store — no Redis, no socket, no second process — because
 * the product is one process with no external service; and it holds no ban, because no route and no
 * registration configures one. The plugin hands `incr` the route's `max` and `ban` as its third and
 * fourth arguments; neither is needed here, and this store implements the two parameters its own
 * contract documents rather than declaring arguments it ignores.
 */

import type { FastifyRateLimitStore } from "@fastify/rate-limit";

/**
 * The window this store counts in when the registration states none it can use, in milliseconds.
 *
 * It is the plugin's own default window (`node_modules/@fastify/rate-limit/index.js`,
 * `defaultTimeWindow`), so a registration that states nothing behaves as it would have without this
 * store. A registration's `timeWindow` arrives here **already parsed**: the plugin converts the
 * configured unit string to milliseconds before it constructs a registered store, which is why no
 * unit string is parsed in this module.
 */
const DEFAULT_WINDOW_MS = 60_000;

/**
 * How many clients' windows one store holds at once when the registration states no capacity.
 *
 * It is the plugin's own `LocalStore` default (`node_modules/@fastify/rate-limit/store/LocalStore.js`,
 * `cache = 5000`), so the memory this store may hold is the memory the plugin would have held. The
 * ceiling is what keeps a map keyed by an address finite: the oldest window is dropped when it is
 * reached, and a client whose window was dropped simply starts a fresh one.
 */
const DEFAULT_KEY_CAPACITY = 5_000;

/**
 * What {@link WriteRateLimitStore} reads from the registration the plugin hands it at construction.
 *
 * The plugin constructs a registered store with its own resolved registration options, whose
 * `timeWindow` is a number of milliseconds. `cache` is not part of that object: the plugin reads its
 * own `cache` option separately and hands it to its `LocalStore` rather than to a registered store, so
 * the running API holds {@link DEFAULT_KEY_CAPACITY} windows, and a caller that constructs this store
 * itself, as its unit test does, may state another capacity.
 */
export interface WriteRateLimitStoreOptions {
  /** The window's length in milliseconds, as the plugin resolved and parsed it. */
  readonly timeWindow?: number;

  /** How many clients' windows may be held at once, spelled as the plugin's `cache` option names it. */
  readonly cache?: number;
}

/**
 * One client's window as an increment reports it: the number of writes the window holds, and how long
 * the window has left in milliseconds. The pair is the plugin's own store contract, and the remaining
 * time is what the plugin turns into the `Retry-After` and `x-ratelimit-reset` headers.
 */
interface ClientWindow {
  /** How many writes have been counted in this window, this one included. */
  readonly current: number;

  /** The instant, in epoch milliseconds, this window opened at. */
  readonly iterationStartMs: number;
}

/**
 * The callback an increment answers on, spelled as the plugin's own store contract declares it: the
 * error is always `null` from this store — it has no failing mode — and the window is always given.
 */
type WriteRateLimitIncrementCallback = (
  error: Error | null,
  window?: { readonly current: number; readonly ttl: number },
) => void;

/**
 * The window a registration asks for, in milliseconds, or {@link DEFAULT_WINDOW_MS}.
 *
 * A value that is not a positive, finite number of milliseconds — absent, zero, negative, `NaN` or
 * infinite — is not a window this store can count in, so the default is used rather than a nonsensical
 * one being counted in. A positive value is taken exactly as the plugin resolved it, without rounding:
 * the plugin has already truncated a number and parsed a unit string, and a second conversion here
 * would be a second answer to the same question.
 */
function windowOf(timeWindow: number | undefined): number {
  return typeof timeWindow === "number" && Number.isFinite(timeWindow) && timeWindow > 0
    ? timeWindow
    : DEFAULT_WINDOW_MS;
}

/**
 * The key capacity a registration asks for, or {@link DEFAULT_KEY_CAPACITY}.
 *
 * A value that is not a whole number of clients greater than zero is not a ceiling a map can be held
 * to, so the default is used instead.
 */
function capacityOf(cache: number | undefined): number {
  return typeof cache === "number" && Number.isInteger(cache) && cache > 0
    ? cache
    : DEFAULT_KEY_CAPACITY;
}

/**
 * The counter store the write rate limit is registered with: one fixed-window map for every write
 * route of the API, keyed by the client the plugin's key generator resolved.
 *
 * It is constructed once, by the plugin, at registration. {@link WriteRateLimitStore.child} hands the
 * same instance back for every route, so no route can open a bucket of its own, and every method is
 * synchronous — the plugin awaits the callback, and this store answers it from the same call — which
 * keeps a write's rate-limit check a single map operation rather than a promise chain.
 *
 * The map's order is the order of last use: an increment re-inserts its key, so the entry at the front
 * is always the client that has gone longest without a write. That order is what the capacity's
 * eviction and the pruning walk both read.
 */
export class WriteRateLimitStore implements FastifyRateLimitStore {
  /** The window every client's counter is measured in, in milliseconds. */
  readonly #timeWindow: number;

  /** How many clients' windows may be held at once. */
  readonly #capacity: number;

  /** One window per client, ordered from the least to the most recently used. */
  readonly #windows: Map<string, ClientWindow>;

  /** How many increments have run since the last full sweep of expired windows. */
  #incrementsSinceSweep: number;

  /**
   * Builds the store over the registration's own options.
   *
   * @param options - The registration's resolved window and optional key capacity; an absent or unusable
   *   one falls back to the documented default rather than throwing, because a registration that
   *   states neither is the product's normal case.
   */
  constructor(options: WriteRateLimitStoreOptions = {}) {
    this.#timeWindow = windowOf(options.timeWindow);
    this.#capacity = capacityOf(options.cache);
    this.#windows = new Map<string, ClientWindow>();
    this.#incrementsSinceSweep = 0;
  }

  /**
   * Counts one write for the key the plugin's key generator produced — the client's address — and
   * reports the window the write landed in.
   *
   * The semantics are the plugin's `LocalStore`'s, so a single route's observable behaviour is
   * unchanged by this store: a key with no open window starts one holding this write and reporting the
   * whole window remaining; a key whose window is still open counts one more and reports what is left
   * of it; a key whose window elapsed starts a fresh window holding this write alone. The plugin
   * compares `current` with the route's `max` itself and answers `429` beyond it, so nothing about
   * which requests are refused is decided here.
   *
   * The map is kept finite on the way: expired windows at the front are dropped, the oldest window is
   * dropped when the capacity is reached, and a full sweep runs at most once per capacity increments
   * to reclaim windows that expired behind a live one.
   *
   * @param key - The client the plugin resolved, which is the address no `keyGenerator` overrides.
   * @param callback - Called synchronously with `null` and the window, as the store contract requires.
   */
  incr(key: string, callback: WriteRateLimitIncrementCallback): void {
    const nowMs = Date.now();

    this.#prune(nowMs);

    const open = this.#windows.get(key);
    const window: ClientWindow =
      open === undefined || open.iterationStartMs + this.#timeWindow <= nowMs
        ? { current: 1, iterationStartMs: nowMs }
        : { current: open.current + 1, iterationStartMs: open.iterationStartMs };

    // Re-inserted rather than mutated in place, which is what keeps the map ordered from the least to
    // the most recently used client: a stale entry can then never be in front of a live one.
    this.#windows.delete(key);
    this.#windows.set(key, window);

    if (this.#windows.size > this.#capacity) {
      this.#dropOldest();
    }

    this.#incrementsSinceSweep += 1;

    if (this.#incrementsSinceSweep >= this.#capacity) {
      this.#sweep(nowMs);
    }

    callback(null, {
      current: window.current,
      ttl: window.iterationStartMs + this.#timeWindow - nowMs,
    });
  }

  /**
   * Answers with this store, which is the whole of the shared-counter guarantee.
   *
   * The plugin calls this once per route that declares `config.rateLimit`, and its own `LocalStore`
   * answers with a fresh store there — a counter map per route, which is the bound being measured per
   * route instead of per client. Returning the same instance is what makes every write route count
   * into one map, and the route's own `max`, which the plugin applies to the count the map answers,
   * still comes from the route.
   *
   * The route options are deliberately not declared: this store keeps no per-route state, so the
   * argument decides nothing here.
   *
   * @returns This store, for every route that asks.
   */
  child(): WriteRateLimitStore {
    return this;
  }

  /**
   * Drops the expired windows at the front of the map and stops at the first live one.
   *
   * The front of the map holds the clients that have gone longest without a write, so this walk costs
   * one comparison when the front window is still open — the common case — and only removes entries it
   * has already proved expired. It is not exhaustive by itself: an unevenly used map can leave an
   * expired window behind a live one, which the full sweep {@link WriteRateLimitStore.incr} runs
   * afterwards reclaims.
   */
  #prune(nowMs: number): void {
    for (const [key, window] of this.#windows) {
      if (window.iterationStartMs + this.#timeWindow > nowMs) {
        return;
      }

      this.#windows.delete(key);
    }
  }

  /**
   * Drops every window that has expired, wherever it sits in the map.
   *
   * This is the exhaustive counterpart of the walk {@link WriteRateLimitStore.incr} runs first, and it
   * is reserved for the moment the map is at its ceiling and the cheap walk freed nothing: it runs at
   * most once per capacity increments, so a full scan of the map costs an amortized constant per write.
   */
  #sweep(nowMs: number): void {
    for (const [key, window] of this.#windows) {
      if (window.iterationStartMs + this.#timeWindow <= nowMs) {
        this.#windows.delete(key);
      }
    }

    this.#incrementsSinceSweep = 0;
  }

  /**
   * Drops the window at the front of the map: the least recently used client's.
   *
   * The client whose window is dropped is not refused and is not remembered as refused — the next
   * write it makes starts a fresh window, which is the same answer a client that had not written for a
   * whole window would receive.
   */
  #dropOldest(): void {
    for (const key of this.#windows.keys()) {
      this.#windows.delete(key);

      return;
    }
  }
}
