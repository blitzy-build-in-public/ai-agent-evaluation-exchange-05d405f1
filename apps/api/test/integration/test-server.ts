/**
 * The shared harness every suite of the ADEM API's integration folder is built on: the real
 * `@adem/api` server, started on an ephemeral port over one in-memory SQLite connection, with the
 * schema migrated and the synthetic seed loaded.
 *
 * **Why it exists.** Each suite of `apps/api/test/integration/` needs the same four things — a
 * running server, a request helper that speaks the versioned prefix, the seeded rows, and a way to
 * read the database back — and none of them should know how a server is assembled or hard-code a
 * seeded identifier. {@link startTestServer} builds all four and hands them over as a
 * {@link TestServer}.
 *
 * **One connection, owned here.** A call opens exactly one in-memory handle through
 * `../../src/db/connection`'s `openDatabase` — never a second `new Database(...)` of its own, which
 * the driver would make a second and **empty** database, because better-sqlite3 compiles out
 * shared-cache access to an in-memory database — and passes that one object to the migration runner,
 * the seed and `createServer`. Nothing else in this file opens or closes a handle: {@link
 * TestServer.close} is the only teardown, and `createServer` deliberately does not close a
 * caller-supplied handle, which is what lets a suite read the database after every request.
 *
 * **One ephemeral port, and no environment variable to reach it.** `createServer` returns the
 * instance without listening, and this harness listens on port 0: the kernel's ephemeral port is
 * read back from the socket's own address and exposed as {@link TestServer.baseUrl}, so two harnesses
 * in one process bind two different ports and nothing is pinned to the port the configuration
 * carries. The configuration's own two optional environment inputs are pinned by this file rather
 * than read, so a suite answers the same way in any shell; no database file is created, no network
 * service is called, and nothing here reads a clock beyond the ISO-8601 timestamps the server writes
 * itself.
 *
 * **The built web directory may be absent, and must be allowed to be.** The server registers its
 * static handler only when `<webDir>/index.html` exists and answers for the API alone otherwise, so
 * the integration suite never requires `npm run build`.
 *
 * **Its import discipline is the workspace's.** This file reaches other workspaces by package
 * specifier only — `@adem/shared`, for the demo-session header and the role vocabulary — and this
 * workspace's internals by the relative form, which from this directory is `../../src/…`. There is no
 * `fastify` import (the instance's type is derived from the factory that returns it), no HTTP client
 * (Node 20's global `fetch` is the transport), no assertion library (a suite asserts, this is not a
 * suite) and no fixture or factory module: the two helpers of this folder are this file and
 * `./boundary-check`.
 *
 * **What it refuses.** {@link startTestServer} throws rather than returning a partly built harness:
 * a migration the runner refuses, a seed the `seedDatabase` writer refuses, a configuration it cannot
 * resolve, a port the instance cannot bind, and a socket whose address is missing or is not an
 * address object each leave the handle closed behind the failure. The accessors refuse too — an
 * unknown role, handle, id or candidate names what was asked for and throws, so no suite ever asserts
 * against an un-narrowed optional.
 */

import { fileURLToPath } from "node:url";

import type { Database } from "better-sqlite3";

import { DEMO_ACCOUNT_HEADER } from "@adem/shared";
import type { AccountRole } from "@adem/shared";

import { resolveConfig } from "../../src/config";
import { openDatabase } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { createServer } from "../../src/index";
import { seedDatabase } from "../../src/seed/seed-database";
import type { SeedSummary } from "../../src/seed/seed-database";
import {
  SEED_ALPHA_VERSION_ID,
  SEED_BETA_VERSION_ID,
  SEED_GAMMA_VERSION_ID,
} from "../../src/seed/seed-data";
import { API_PREFIX } from "../../src/server";

/**
 * The versioned prefix every route of the API is served under, re-exported from `../../src/server` so
 * that a suite composing a path of its own — an unmatched path, or an unregistered method on a
 * registered one — reads the literal from its one declaration site instead of retyping it.
 */
export { API_PREFIX };

/**
 * The in-memory database name, in its single spelling for this file.
 *
 * It is a constant rather than a repeated literal because the suites' correctness depends on there
 * being one: the handle this harness opens and the database path the resolved configuration carries
 * are the same name, and a second spelling written anywhere would be a second and empty database that
 * every assertion would silently run against.
 */
const IN_MEMORY_DATABASE = ":memory:";

/**
 * The address the harness binds: the loopback address, never the wildcard, so a suite reaches its own
 * server and only its own.
 */
const LOOPBACK_HOST = "127.0.0.1";

/**
 * The port the resolved configuration carries for a harness server.
 *
 * The harness never binds it: `listen` is handed port 0 and the kernel's ephemeral port is read back
 * from the socket, so this member reaches nothing but the instance's own start-up log line. It is
 * pinned rather than left to `../../src/config` for one reason — the configuration reads an optional
 * environment variable for the port, and a suite's socket must not depend on what a shell happens to
 * hold. The value is the lowest port the configuration accepts.
 */
const CONFIGURED_PORT = 1;

/**
 * The directory the built web application is served from, resolved from this module's own location
 * rather than from the working directory. It carries no trailing slash deliberately: the
 * configuration refuses a path whose last segment is empty.
 *
 * The directory may not exist, and that is the state the suites run in — see the module header on why
 * the integration suite must never require a build.
 */
const WEB_DIR = fileURLToPath(new URL("../../../../apps/web/dist", import.meta.url));

/**
 * The server an {@link AppServer}-typed member holds, derived from the factory that returns it.
 *
 * `createServer` is synchronous, and the `Awaited` is kept anyway so that the type follows that
 * factory rather than restating what it returns: if the entry ever became asynchronous, every suite's
 * `await startTestServer()` would keep compiling and this file would need no edit.
 */
type AppServer = Awaited<ReturnType<typeof createServer>>;

/** The configuration overrides `../../src/config`'s resolver accepts, derived from that resolver. */
type ConfigOverrides = NonNullable<Parameters<typeof resolveConfig>[0]>;

/** The write rate-limit section a harness may reconfigure, derived from the resolver's own member. */
type WriteRateLimitOverrides = NonNullable<ConfigOverrides["writeRateLimit"]>;

/** The commerce section a harness may reconfigure, derived from the resolver's own member. */
type CommerceOverrides = NonNullable<ConfigOverrides["commerce"]>;

/**
 * The three fixture candidates of the seeded standard's case set, in the fixed order alpha, beta,
 * gamma. The vocabulary is closed to these three: `apps/api/src/seed/seed-data.ts` seeds one version
 * and one report for each, and no route creates a fourth.
 */
type SeedCandidateId = "seed-alpha" | "seed-beta" | "seed-gamma";

/**
 * The three seeded candidate versions, keyed by candidate, resolved from
 * `apps/api/src/seed/seed-data.ts`'s exported literal constants rather than retyped here: the
 * `listing_versions.id` a fixture candidate carries is fixed data that the fixture pack's recorded
 * submissions also name, so a second copy of it in this file would be a second answer.
 */
const CANDIDATE_VERSION_IDS: Readonly<Record<SeedCandidateId, string>> = Object.freeze({
  "seed-alpha": SEED_ALPHA_VERSION_ID,
  "seed-beta": SEED_BETA_VERSION_ID,
  "seed-gamma": SEED_GAMMA_VERSION_ID,
});

/**
 * One seeded demo account, as {@link TestServer}'s accessors hand it over.
 *
 * The member names are camelCase while the `accounts` row's are snake_case, so a suite reads
 * `account.displayLabel` from a row whose column is `display_label` without a second mapping of its
 * own.
 */
export interface SeedAccount {
  /** The `accounts.id`, which is what the `X-Demo-Account` header carries. */
  readonly id: string;

  /** The fictional handle the row was seeded with. */
  readonly handle: string;

  /** The role every write route checks the resolved account against. */
  readonly role: AccountRole;

  /** The fictional display label the seeded row carries. */
  readonly displayLabel: string;
}

/**
 * One response the harness received, in both the forms a suite asserts against.
 *
 * The text is kept beside the parsed value because the error-shape assertions of the contract read
 * the serialised payload — the single envelope `{ error: { code, message } }` — rather than a
 * re-serialisation of it, and because a response that is not JSON at all has to be reportable as the
 * text it was.
 */
export interface TestResponse {
  /** The status code the server answered with. */
  readonly status: number;

  /** The response's headers, as `fetch` delivered them. */
  readonly headers: Headers;

  /** The parsed body, or `undefined` when the body was not JSON. */
  readonly body: unknown;

  /** The body exactly as it arrived, parsed or not. */
  readonly text: string;

  /** The parsed body, typed by the caller's own parameter. */
  json<T>(): T;
}

/**
 * What one request may be given beside its method and path.
 *
 * Every member is optional, and `exactOptionalPropertyTypes` makes that exact: a member is either
 * absent or present with a value, so a caller meaning "no demo header" omits `account` rather than
 * writing it as `undefined`.
 */
export interface RequestOptions {
  /**
   * The demo account to send in the `X-Demo-Account` header. A {@link SeedAccount} contributes its
   * id; a **string is sent verbatim**, which is how a suite probes an account the server cannot
   * resolve. Omitting it sends no such header at all, which is how every suite reaches its `401`
   * cases.
   */
  account?: string | SeedAccount;

  /**
   * Further headers to send, merged last so that a suite may override one the harness would
   * otherwise set — the content type included.
   */
  headers?: Record<string, string>;

  /**
   * Query parameters to append. A member whose value is `undefined` is dropped rather than
   * serialised as the text `undefined`.
   */
  query?: Record<string, string | number | undefined>;
}

/**
 * What {@link startTestServer} may be configured with.
 *
 * Both configuration sections exist for one reason: a suite exercising all twenty contract rows, and
 * the immutability and trust-separation suites, writes far more than the sixty requests a minute the
 * product allows one client, and would observe `429` where the contract documents a status. A suite
 * that means to assert the limit starts its own server with a low one; no other suite should meet it
 * by accident.
 */
export interface TestServerOptions {
  /** The write rate-limit section to resolve a different value for. */
  readonly writeRateLimit?: WriteRateLimitOverrides;

  /** The commerce section to resolve a different value for — the gate fee and the allocation rate. */
  readonly commerce?: CommerceOverrides;

  /** Whether to load the seed. Defaults to `true`; `false` starts a migrated but empty database. */
  readonly seed?: boolean;
}

/**
 * One seeded candidate version, as {@link TestServer.candidateVersion} hands it over.
 *
 * It is the mapping the evaluation route needs: `id` is the `candidate_version_id` a submission
 * carries, and `listingId` is the listing whose owning developer is the only account that may start
 * an evaluation or publish a version of it.
 */
export interface SeedCandidateVersion {
  /** The candidate version's `listing_versions.id`, which is also the fixture pack's candidate id. */
  readonly id: string;

  /** The listing that owns the version. */
  readonly listingId: string;

  /** The developer-chosen version string, unique within that listing. */
  readonly versionString: string;
}

/**
 * A started harness: the running server, the one connection behind it, and the helpers a suite acts
 * through.
 *
 * The five request and accessor members are the whole vocabulary a suite needs — no suite builds a
 * URL, opens a connection, sends a header by hand or hard-codes a seeded identifier. {@link query}
 * and {@link database} exist beside them because several criteria are stated as byte-for-byte
 * before-and-after comparisons of a stored row, which needs a read the contract does not expose.
 */
export interface TestServer {
  /** The origin the instance is bound to: `http://127.0.0.1:` and the ephemeral port it resolved. */
  readonly baseUrl: string;

  /** The one connection this harness owns, open for the harness's lifetime. */
  readonly database: Database;

  /** The listening instance. */
  readonly server: AppServer;

  /** What the seed wrote, or `null` when {@link TestServerOptions.seed} was `false`. */
  readonly seed: SeedSummary | null;

  /** The six seeded demo accounts, in the order the seed inserted them. */
  readonly accounts: readonly SeedAccount[];

  /**
   * Sends one request over the versioned prefix and returns it in both forms.
   *
   * Returns the response whatever its status: a refusal is an ordinary result a suite asserts, never
   * an exception.
   */
  request(method: string, path: string, options?: RequestOptions): Promise<TestResponse>;

  /** Sends a `GET`. */
  get(path: string, options?: RequestOptions): Promise<TestResponse>;

  /** Sends a `POST`, serialising the body as JSON when one is given. */
  post(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse>;

  /** The first seeded account, in insertion order, carrying the given role. */
  accountForRole(role: AccountRole): SeedAccount;

  /** The seeded account whose id, or failing that whose handle, is the given value. */
  accountFor(handleOrId: string): SeedAccount;

  /** The `accounts.id` of the developer that owns the given listing. */
  accountOf(listingId: string): string;

  /** The account that owns the given listing. */
  owningDeveloper(listingId: string): SeedAccount;

  /** The seeded fixture candidate version of the given candidate. */
  candidateVersion(candidateId: SeedCandidateId): SeedCandidateVersion;

  /** The newest seeded report for the given candidate, which `GET /evaluations/{id}` answers for. */
  seededReportId(candidateId: SeedCandidateId): string;

  /** Reads rows straight from the harness's connection. */
  query<T>(sql: string, ...params: readonly unknown[]): T[];

  /** Closes the instance and then the connection. Idempotent. */
  close(): Promise<void>;
}

/**
 * Starts the harness: one in-memory connection, the schema, the seed, the resolved configuration and
 * the listening instance, in that order.
 *
 * Returns a started {@link TestServer}, which the caller must close. It refuses rather than returning
 * a partly built one: a migration the runner refuses because an applied file changed, a seed the
 * writer refuses because the database already holds rows, a configuration the resolver refuses, a
 * port the instance cannot bind, and an address the socket does not report each throw with the
 * connection closed behind the failure, so a refused start-up leaves no listening socket and no open
 * handle for a later case to trip over.
 *
 * @param options The configuration sections to resolve a different value for, and whether to load the
 *   seed. Absent, the product's own configuration and the seed are used.
 * @returns The started harness, whose `baseUrl` and `database` are the two things a suite reaches the
 *   server and the data through.
 * @throws {ConfigurationError} From `../../src/config`, for an override that cannot be resolved.
 * @throws {Error} From the migration runner, the seed writer, the connection or `listen`, each
 *   propagated unchanged so a suite reads the same refusal the product's own start-up would.
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const database = openDatabase(IN_MEMORY_DATABASE);

  let server: AppServer | undefined;

  try {
    // The schema before the seed, and before the instance is built: the route groups query tables a
    // fresh database does not have, and the seed writes rows into them. The composition root applies
    // this same runner to the handle it is given and a recorded version is applied once, so the
    // harness stays self-contained whether or not that call happens.
    runMigrations(database);

    // The seed runs once per database and refuses a populated one, which is why each suite's own
    // forked process creating its own connection is what makes one seed call per suite correct.
    const seed = options.seed === false ? null : seedDatabase(database);

    const config = resolveConfig(configOverridesFor(options));

    // The caller's handle goes in, so the instance opens no second connection — and never closes this
    // one, since it closes a handle only when it is the module that opened it.
    server = createServer({ database, webDir: WEB_DIR, config });

    await server.listen({ port: 0, host: LOOPBACK_HOST });

    return new HarnessServer({
      baseUrl: `http://${LOOPBACK_HOST}:${ephemeralPortOf(server)}`,
      database,
      server,
      seed,
      accounts: readSeedAccounts(database),
    });
  } catch (error: unknown) {
    if (server !== undefined) {
      try {
        await server.close();
      } catch {
        // The start-up's own failure is the one reported: a second failure while releasing a
        // half-built instance would replace it with one that says less about what went wrong.
      }
    }

    database.close();
    throw error;
  }
}

/**
 * The one implementation of {@link TestServer}.
 *
 * A class rather than an object literal for one reason: `implements TestServer` makes the compiler
 * check the whole surface — every member, its arity and its return type — at this file, so a later
 * edit that narrows or drops a member fails to compile here rather than in six suites.
 *
 * It holds no state beyond the five members it was built from and one flag: the request helpers read
 * the connection they were handed, the accessors read the same connection, and no case can change
 * what another case sees except by writing through the API, which is exactly what the suites test.
 */
class HarnessServer implements TestServer {
  readonly baseUrl: string;

  readonly database: Database;

  readonly server: AppServer;

  readonly seed: SeedSummary | null;

  readonly accounts: readonly SeedAccount[];

  /** Whether {@link close} has run, so that teardown is safe to call from more than one hook. */
  #closed = false;

  constructor(members: HarnessMembers) {
    this.baseUrl = members.baseUrl;
    this.database = members.database;
    this.server = members.server;
    this.seed = members.seed;
    this.accounts = members.accounts;
  }

  /**
   * Sends one request over {@link API_PREFIX} and returns the response in both of its forms.
   *
   * The path is prefix-relative — `"/listings"`, `"/evaluations"` — and the prefix is prepended here,
   * so no suite retypes it and none can reach a route outside the contract's namespace by accident. A
   * suite probing an unmatched path composes it from the re-exported `API_PREFIX` instead.
   *
   * The demo header is sent **only** when an account is given, which is what makes the two refusals
   * distinguishable: an absent header and an unresolvable one are both `401`, a resolvable account
   * with the wrong role is `403`, and a mutating attempt that the suites expect to be answered `403`
   * or `404` must therefore carry a resolved account — otherwise the `401` it would earn instead
   * could be mistaken for the proof it was meant to be.
   *
   * The body is read once as text and parsed once: the raw text is kept because the contract's error
   * assertions read the serialised envelope, and a body that is not JSON is kept as text rather than
   * thrown over, because "no JSON body" is an ordinary state for a refusal to be in.
   *
   * @param method The HTTP method. Any method may be sent, so a suite can attempt an update or a
   *   delete of an append-only resource and assert that no route accepts it.
   * @param path A prefix-relative path, query string excluded.
   * @param options The demo account, further headers and query parameters.
   * @param body An already-serialised body. It is a parameter of the implementation and not of
   *   {@link TestServer.request}, which the suites use: {@link HarnessServer.post} is its only caller.
   * @returns The response, whatever its status. It refuses nothing, and never retries.
   */
  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
    body?: string,
  ): Promise<TestResponse> {
    const url = new URL(`${API_PREFIX}${path}`, this.baseUrl);

    // An absent value is dropped rather than serialised: a suite building a query from optional
    // members must not send the text "undefined" for the ones it left out.
    const query: Record<string, string | number | undefined> = options.query ?? {};
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }

    const headers = new Headers();

    if (options.account !== undefined) {
      headers.set(
        DEMO_ACCOUNT_HEADER,
        typeof options.account === "string" ? options.account : options.account.id,
      );
    }

    // Only when a body is present: a request that sends nothing declares no content type.
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }

    // Merged last, so a suite can override anything above — the content type included.
    const extraHeaders: Record<string, string> = options.headers ?? {};
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });

    const text = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // The parse failure is the handling: a body that is not JSON leaves `body` undefined and
      // `text` as it arrived, which is what the two assertions about a non-JSON body read.
      parsed = undefined;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: parsed,
      text,
      json<T>(): T {
        if (parsed === undefined) {
          throw new Error(
            `test-server: the response to ${method} ${url.pathname} carried no JSON body, so it cannot be read as one (status ${response.status}).`,
          );
        }

        return parsed as T;
      },
    };
  }

  /** Sends a `GET`; see {@link HarnessServer.request} for the path form and the headers. */
  async get(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request("GET", path, options);
  }

  /**
   * Sends a `POST`, serialising the body as JSON.
   *
   * The content type is set here rather than in {@link HarnessServer.request} because a `POST` states
   * one whether or not it carries a body, while every other method declares one only when it does. A
   * caller's own header is merged over it, so a suite probing a media type the route refuses can still
   * state what it means to send.
   */
  async post(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options?.headers,
    };

    return this.request(
      "POST",
      path,
      { ...options, headers },
      body === undefined ? undefined : JSON.stringify(body),
    );
  }

  /**
   * The first seeded account, in the order the seed inserted them, that carries the given role.
   *
   * The order is what makes the answer deterministic, and it is the seed's own: the first developer
   * owns every seeded listing, the first buyer raised the seeded open challenge. A suite must not
   * assume the roles of the two extra accounts — the second developer and the second buyer exist so
   * that ownership and the two challenge states are reachable — and should reach an account through
   * this accessor rather than by handle.
   *
   * @throws {Error} When no seeded account carries the role, which can only mean the seed was not
   *   loaded.
   */
  accountForRole(role: AccountRole): SeedAccount {
    const found = this.accounts.find((account) => account.role === role);

    if (found === undefined) {
      throw new Error(
        `test-server: none of the seeded accounts carries the role "${role}". The harness loads the six synthetic accounts unless \`seed: false\` was passed.`,
      );
    }

    return found;
  }

  /**
   * The seeded account whose id is the given value, or failing that whose handle is.
   *
   * The match is exact on both, with no prefix, case-insensitive or `LIKE` behaviour: a suite probing
   * an account the server cannot resolve must be able to pass a value that genuinely matches nothing.
   *
   * @throws {Error} When no seeded account carries the value as its id or as its handle.
   */
  accountFor(handleOrId: string): SeedAccount {
    const found =
      this.accounts.find((account) => account.id === handleOrId) ??
      this.accounts.find((account) => account.handle === handleOrId);

    if (found === undefined) {
      throw new Error(
        `test-server: none of the seeded accounts carries "${handleOrId}" as its id or as its handle.`,
      );
    }

    return found;
  }

  /**
   * The `accounts.id` of the developer that owns the given listing.
   *
   * It is read from the row rather than assumed, because the seeded listings are not all owned by the
   * account a suite might expect and because the ownership check is the difference between the `403`
   * a wrong developer earns and the `403` a wrong role earns.
   *
   * @throws {Error} When no listing carries the id.
   */
  accountOf(listingId: string): string {
    const row = this.database
      .prepare<[string], ListingOwnerRow>("SELECT developer_account_id FROM listings WHERE id = ?")
      .get(listingId);

    if (row === undefined) {
      throw new Error(`test-server: no listing carries the id "${listingId}".`);
    }

    return row.developer_account_id;
  }

  /** The account that owns the given listing; {@link HarnessServer.accountFor} resolves it. */
  owningDeveloper(listingId: string): SeedAccount {
    return this.accountFor(this.accountOf(listingId));
  }

  /**
   * The seeded fixture candidate version of the given candidate.
   *
   * The three version identifiers are the seed's exported constants rather than values retyped here,
   * and the row is read back with `is_fixture_candidate = 1` as part of the lookup, so a mismatch
   * between the constant and the row it names is a refusal rather than a wrong candidate.
   *
   * @throws {Error} When the row is absent or does not carry the fixture-candidate flag.
   */
  candidateVersion(candidateId: SeedCandidateId): SeedCandidateVersion {
    return readCandidateVersion(this.database, candidateId);
  }

  /**
   * The newest seeded report for the given candidate, which `GET /evaluations/{id}` answers for.
   *
   * Newest first, with the row order as the tie-break, so the answer is the same on every run even
   * when two reports share an instant — which a retest for one candidate version can produce.
   *
   * @throws {Error} When the candidate has no report, which can only mean the seed was not loaded.
   */
  seededReportId(candidateId: SeedCandidateId): string {
    return readSeededReportId(this.database, candidateId);
  }

  /**
   * Reads rows straight from the harness's connection — a test-only escape hatch, and a requirement
   * rather than a shortcut.
   *
   * Several criteria are stated as byte-for-byte comparisons of a stored row before and after a
   * refused mutation, and as identifications the contract deliberately does not expose: a report's
   * identifier, a ledger entry's, a proposal's, a transaction's, the one `standard_versions` row. A
   * read through the API could not make those comparisons, and a suite that opened a connection of its
   * own would read a second, empty database.
   *
   * The one cast below is the boundary of the escape hatch: the driver returns its rows as `unknown`,
   * and only the caller's own type parameter says what shape it asked for.
   *
   * @param sql A single statement, with `?` placeholders for the parameters that follow.
   * @param params The values to bind, positionally.
   * @returns The rows the statement selected, typed by the caller.
   */
  query<T>(sql: string, ...params: readonly unknown[]): T[] {
    return this.database.prepare(sql).all(...params) as T[];
  }

  /**
   * Closes the instance and then the one connection behind it, and does nothing when already closed.
   *
   * The order is the requirement: closing the instance answers every in-flight request before the
   * handle it reads through disappears. Idempotence is what lets a suite call this from `afterAll`
   * without a second call — after a case that failed halfway — throwing over the real failure.
   */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;

    await this.server.close();
    this.database.close();
  }
}

/** The five things {@link HarnessServer} is built from, every one of them the start-up's own. */
interface HarnessMembers {
  /** The origin the instance is bound to. */
  readonly baseUrl: string;

  /** The one connection the harness opened and owns. */
  readonly database: Database;

  /** The listening instance. */
  readonly server: AppServer;

  /** What the seed wrote, or `null` when it was skipped. */
  readonly seed: SeedSummary | null;

  /** The seeded accounts, in insertion order. */
  readonly accounts: readonly SeedAccount[];
}

/** One `accounts` row, in the snake_case the column names are spelled in. */
interface AccountRow {
  readonly id: string;
  readonly handle: string;
  readonly role: AccountRole;
  readonly display_label: string;
}

/** One `listings` row, restricted to the account it belongs to. */
interface ListingOwnerRow {
  readonly developer_account_id: string;
}

/** One `listing_versions` row, restricted to the three columns a candidate's accessor returns. */
interface CandidateVersionRow {
  readonly id: string;
  readonly listing_id: string;
  readonly version_string: string;
}

/** One `evaluation_reports` row, restricted to the identifier a suite needs from it. */
interface ReportIdRow {
  readonly id: string;
}

/**
 * The configuration {@link startTestServer} resolves, with each section added only when the caller
 * supplied one.
 *
 * `exactOptionalPropertyTypes` makes a member written as `undefined` a different thing from an absent
 * member, so the sections are spread conditionally rather than passed through: an explicitly
 * `undefined` section is a type error, not a way to ask for the default.
 *
 * The port and the database path are pinned. The port is the harness's own business — see
 * {@link CONFIGURED_PORT} — and the path is the connection this call opened, which the instance is
 * handed directly and therefore never opens, so naming it here keeps the resolved configuration
 * truthful about which database the server is reading.
 */
function configOverridesFor(options: TestServerOptions): ConfigOverrides {
  return {
    port: CONFIGURED_PORT,
    databasePath: IN_MEMORY_DATABASE,
    ...(options.writeRateLimit === undefined ? {} : { writeRateLimit: options.writeRateLimit }),
    ...(options.commerce === undefined ? {} : { commerce: options.commerce }),
  };
}

/**
 * The ephemeral port an instance resolved, read from the socket it bound.
 *
 * The address is narrowed structurally rather than by importing `node:net`: `null` means the socket is
 * not listening, and the string form is a pipe or a Unix-domain address, which the harness never asks
 * for and could not send an HTTP request to. Both are refused with the reason.
 *
 * @throws {Error} When the socket reports no address, or an address that is not a TCP one.
 */
function ephemeralPortOf(server: AppServer): number {
  const address = server.server.address();

  if (address === null) {
    throw new Error(
      "test-server: the instance is not listening, so it has no address. `listen` must have resolved before the harness reads the port.",
    );
  }

  if (typeof address === "string") {
    throw new Error(
      `test-server: the instance bound the address "${address}" rather than a TCP port, and the harness sends its requests over HTTP.`,
    );
  }

  return address.port;
}

/**
 * The seeded accounts, in the order the seed inserted them.
 *
 * The order is not decoration: {@link TestServer.accountForRole} answers with the first account
 * carrying a role, and the seed's insertion order is what makes "the developer" a single account
 * rather than one of two. It is read back from the database rather than taken from the seed's own
 * data module, so a suite asserts against rows the database actually holds.
 */
function readSeedAccounts(database: Database): readonly SeedAccount[] {
  const rows = database
    .prepare<[], AccountRow>("SELECT id, handle, role, display_label FROM accounts ORDER BY rowid ASC")
    .all();

  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    role: row.role,
    displayLabel: row.display_label,
  }));
}

/**
 * One fixture candidate's version row, resolved from the seed's own constant for that candidate.
 *
 * @throws {Error} When no row carries that identifier with the fixture-candidate flag set.
 */
function readCandidateVersion(database: Database, candidateId: SeedCandidateId): SeedCandidateVersion {
  const row = database
    .prepare<[string], CandidateVersionRow>(
      "SELECT id, listing_id, version_string FROM listing_versions WHERE id = ? AND is_fixture_candidate = 1",
    )
    .get(CANDIDATE_VERSION_IDS[candidateId]);

  if (row === undefined) {
    throw new Error(
      `test-server: no seeded listing version is the "${candidateId}" fixture candidate. The harness seeds the three candidate versions unless \`seed: false\` was passed.`,
    );
  }

  return {
    id: row.id,
    listingId: row.listing_id,
    versionString: row.version_string,
  };
}

/**
 * The newest report written for the given candidate's version.
 *
 * @throws {Error} When the candidate's version carries no report.
 */
function readSeededReportId(database: Database, candidateId: SeedCandidateId): string {
  const row = database
    .prepare<[string], ReportIdRow>(
      "SELECT id FROM evaluation_reports WHERE candidate_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(CANDIDATE_VERSION_IDS[candidateId]);

  if (row === undefined) {
    throw new Error(
      `test-server: no report was seeded for the "${candidateId}" fixture candidate. The harness seeds one report per candidate unless \`seed: false\` was passed.`,
    );
  }

  return row.id;
}

