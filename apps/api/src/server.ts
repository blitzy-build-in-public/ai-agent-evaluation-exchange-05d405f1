/**
 * The composition root's builder: the one place a Fastify instance is assembled for the ADEM API.
 *
 * `createApp` wires, in one order, what no other module of this workspace owns: the resolved
 * configuration and the database connection, the migration runner's precondition, the write rate
 * limit, the fourteen route groups under the versioned prefix, the built web application's static
 * handler, and the two handlers that give every failure one shape. It holds no business rule — no
 * matched count, outcome, label, allocation, gate fee or reversal is computed here — and the domain
 * packages are reached only indirectly, through the route groups.
 *
 * **Registration order.**
 *
 * 1. The configuration is resolved first, then the connection is settled: the caller's handle when it
 *    supplied one, otherwise a handle this module opens and therefore owns. The `onClose` hook that
 *    closes the connection is registered only for the handle this module opened — the integration
 *    harness passes one `:memory:` handle for a whole file and reads it after each request, so
 *    closing a caller's handle would destroy the database the file's later assertions run against.
 * 2. The instance is created with Fastify's own logger at `info`, which is the API's whole
 *    instrumentation: there is no metrics backend, no tracing exporter and no log shipping, because no
 *    external service may be called.
 * 3. The resolved handle's schema is settled before any route is reachable: the migration runner is
 *    called on it unless the caller supplied both that handle and the run it already made on it (see
 *    {@link CreateServerOptions.migration}), which is the pair that says the schema is established and
 *    is what keeps a start-up to one read and one hash per migration file. The runner is idempotent and
 *    creates `schema_migrations` itself, so a caller that migrated a handle without recording the run
 *    sees a silent no-op rather than a second copy of the schema; no migration logic lives here.
 * 4. `@fastify/rate-limit` is registered with `global: false`, so reads are unlimited and a write
 *    route opts in through the route options each group declares from the resolved configuration, and
 *    with `./write-rate-limit-store` as its store, so **one** counter covers every write route: the
 *    bound is the client's for the whole API rather than a bucket per route. The window the store
 *    counts in is the resolved one the routes register, so the counter and the routes cannot disagree
 *    about the window they are measuring. The plugin's `errorResponseBuilder` answers with the API's
 *    single envelope and status `429`, and the plugin writes the `Retry-After` header in whole seconds
 *    itself before it throws that value, so the builder does not set the header and cannot duplicate
 *    it.
 * 5. The fourteen route groups are mounted inside one encapsulated scope under `/api/v1` by the
 *    folder's own registrar, which is handed the handle and the configuration **by closure**. Neither
 *    is put on the instance: a group that read its database off the instance would depend on
 *    decoration order, and domain code receives its handle as a parameter.
 * 6. The built web application is served from the resolved web directory when `<webDir>/index.html`
 *    exists, and that is decided once, here, at registration time. A checkout whose web build has not
 *    run yet starts anyway and answers for the API alone — a partially built checkout is a supported
 *    state, never a crash. The entry document itself is read from disk per request rather than held
 *    from construction: it is a fraction of a kilobyte, and a build run over a listening server then
 *    serves the entry that build just wrote instead of one naming the asset filenames the build
 *    deleted. A read that fails answers the envelope's 404, like any other absent resource.
 * 7. The single error handler maps every thrown value to the one envelope of
 *    `./errors/error-envelope`. Validation failures, the demo-session header's failure, a domain
 *    package's refusal and a server fault all leave by it, so no handler writes an error body of its
 *    own and no client parses a second shape. It records a refused request at warning level, with the
 *    method, the path, the status and the code, and a server fault at error level with the cause
 *    itself; a request body, the demo header's value and the envelope's sentence are never recorded.
 * 8. The single not-found handler answers an `/api/` path, and a request for something that looks
 *    like a static file, with the envelope and status `404`; it answers every other path with the SPA
 *    entry, read from disk as it answers, and status `200`, which is what lets `/listings`,
 *    `/report/<id>`, `/compare?ids=…` and `/academy` reach the client router. A path under the API's
 *    own root is recorded at warning level like any other refused API request, while a missing asset
 *    and a deep link answered with the SPA entry are not recorded at all — neither is a refusal.
 *    Fastify 4 answers an unregistered path and an unregistered method on a registered path with the
 *    same `404`, and no `PUT`, `PATCH` or `DELETE` handler exists anywhere in this workspace, so an
 *    update or a delete of an append-only record is unreachable by construction rather than by a
 *    check.
 *
 * **What this module deliberately does not do.** It does not listen: `apps/api/src/index.ts` is the
 * workspace's only public entry and the only place a `main`-style start-up lives, so that
 * `apps/api/test/integration/test-server.ts` can build the same instance and listen on an ephemeral
 * port itself. It reads no environment variable — `apps/api/src/config.ts` is the only module of this
 * workspace permitted to read the two optional ones — holds no secret, opens no second socket, makes
 * no external call, and reaches no domain package for a calculation.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Database } from "better-sqlite3";

import type { ApiConfig, ApiConfigOverrides } from "./config";
import { resolveConfig } from "./config";
import { openDatabase } from "./db/connection";
import type { MigrationRun } from "./db/migrate";
import { runMigrations } from "./db/migrate";
import { ERROR_STATUS, STATUS_DEFAULT_CODE } from "./errors/error-codes";
import { ApiError, envelope, toApiError } from "./errors/error-envelope";
import { API_PREFIX, registerRoutes } from "./routes/register-routes";
import { WriteRateLimitStore } from "./write-rate-limit-store";

/**
 * The versioned prefix every route of this API is served under, re-exported from the registrar that
 * applies it.
 *
 * The literal has one declaration site in this workspace — `./routes/register-routes` — and this
 * module reads it from there for its own not-found boundary rather than restating it, so a contract
 * change to the prefix is an edit in one place. The re-export exists so that a caller importing the
 * composition root does not have to reach into the routes folder for it.
 */
export { API_PREFIX };

/**
 * The root of the API's own surface: the segment the versioned prefix hangs from, which is `/api`.
 *
 * Derived from {@link API_PREFIX} rather than written as a second literal, so the one declaration
 * site still decides where the API's paths begin. It is the boundary the not-found handler uses: a
 * request under it is answered with the JSON envelope whether it names an unknown path, an
 * unregistered method on a known path, or a path of a future contract version, so a client never
 * receives an HTML document where it expected JSON.
 *
 * A prefix carrying no second segment falls back to the whole prefix, which keeps the boundary
 * meaningful rather than letting a slice at a missing separator widen it.
 */
const API_ROOT_PATH = apiRootPath();

/**
 * The one thing {@link createApp} needs from its caller, every member optional.
 *
 * The default path opens the database the resolved configuration names and serves the web directory
 * the resolved configuration names, so `createApp()` alone builds the instance the documented
 * `npm start` runs.
 */
export interface CreateServerOptions {
  /**
   * A caller-supplied database handle. When given it is used as it stands and **never** closed by this
   * module: the caller opened it and the caller closes it.
   */
  readonly database?: Database;

  /**
   * The run `./db/migrate`'s `runMigrations` has already made on {@link database}, which is the record
   * that handle's schema is established. Read only alongside {@link database}: the two together are
   * what let this module take the handle as it stands instead of calling the runner on it, so a
   * start-up that migrated its own handle reads and hashes each migration file once, not twice.
   *
   * Supplied without {@link database} it decides nothing: a run names the handle it was made on, and a
   * path is a connection this module opens itself. Absent, the runner is called on the resolved handle,
   * so a caller handed a handle it did not migrate still gets a migrated one.
   */
  readonly migration?: MigrationRun;

  /**
   * A file path, or the in-memory name `:memory:`, to open when no handle is supplied. This module
   * then owns the connection and closes it when the instance closes. Ignored when {@link database} is
   * supplied, and not recorded as the resolved configuration's database path in that case either: a
   * path nothing opens is not a configuration value.
   */
  readonly databasePath?: string;

  /**
   * The port to resolve the configuration with. Defaults to the resolved configuration's port, which
   * is 3000, or the `ADEM_PORT` environment variable read by `./config`. This module never listens,
   * so the port is resolved here for the caller that does — and is validated here, so a port this
   * process could not bind is refused at construction rather than at start-up.
   */
  readonly port?: number;

  /**
   * The directory the built web application is served from. Defaults to the resolved configuration's
   * web directory, which is `<repository root>/apps/web/dist`.
   */
  readonly webDir?: string;

  /**
   * The configuration members to resolve a different value for, merged over the resolved
   * configuration one level per section — so `{ writeRateLimit: { max: 10_000 } }` raises the write
   * limit while keeping the resolved window. It is how the integration harness lifts the write bound
   * for its own suite without editing a route; the two label sentences are deliberately not
   * overridable, which is `./config`'s rule rather than this module's.
   */
  readonly config?: ApiConfigOverrides;
}

/**
 * Builds the Fastify instance the ADEM API is served by: the fourteen route groups under `/api/v1`,
 * the one error envelope, the write rate limit, the migration runner's precondition, the built web
 * application's static handler and the SPA fallback, in that order.
 *
 * Returns the instance without listening. Fastify defers plugin loading until the instance is ready,
 * so the returned value is valid for a caller that awaits `listen` and for one that awaits `ready`,
 * and this module holds no server of its own: `apps/api/src/index.ts` listens in the product, and
 * `apps/api/test/integration/test-server.ts` listens on an ephemeral port for a suite.
 *
 * Refuses nothing of its own. An absent built-web directory is a supported state rather than an
 * error: an instance built in a checkout whose web build has not run answers for the API alone. That
 * absence is decided once, at registration time; the entry document is not, because it is read from
 * disk per request — a build run over a listening server is therefore served as soon as it finished,
 * and a read that fails while a build replaces the directory answers the envelope's 404 rather than
 * throwing. The three refusals that mean the process cannot start with what it was given are
 * propagated unchanged and are not translated into anything milder: `./config`'s
 * `ConfigurationError` for an unusable environment value or override, `./db/connection`'s own failure
 * to open the path it was given, and the migration runner's refusal when an applied migration file
 * has changed, been renamed or disappeared.
 *
 * @param options The caller's handle or path, the run it already made on that handle, its port and web
 *   directory, and its configuration overrides. Every member is optional; an absent one resolves to the
 *   configuration's own value, except the recorded run, which is read only beside a handle.
 * @returns The instance, with every route, handler and hook registered, before it is listening.
 */
export function createApp(options: CreateServerOptions = {}): FastifyInstance {
  const overrides: ApiConfigOverrides = {
    ...options.config,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.webDir === undefined ? {} : { webDir: options.webDir }),
    // Recorded only when this module is the one that will open a connection on it.
    ...(options.database === undefined && options.databasePath !== undefined
      ? { databasePath: options.databasePath }
      : {}),
  };

  const config: ApiConfig = resolveConfig(overrides);

  const ownsConnection = options.database === undefined;
  const database = options.database ?? openDatabase(config.databasePath);

  const instance = Fastify({ logger: { level: "info" } });

  // Registered before the work that can fail, so a handle this module opened is closed even when a
  // later registration throws: the caller closes the instance, and the instance closes the handle.
  if (ownsConnection) {
    instance.addHook("onClose", async (): Promise<void> => {
      database.close();
    });
  }

  // The schema, before any route is reachable. The runner is skipped only for the caller that supplied
  // both the handle and the run it already made on it: either one alone leaves the handle's schema
  // unestablished, so the runner is called here — on a caller's handle it did not migrate, and on the
  // connection this module opened for a path. Honouring a recorded run is what keeps one start-up to
  // one read and one hash per migration file rather than two.
  if (options.database === undefined || options.migration === undefined) {
    runMigrations(database);
  }

  instance.register(fastifyRateLimit, {
    // Reads are unlimited and a write opts in through its own route options, which each group
    // declares from the resolved configuration: the limit is the routes' policy, and this option is
    // what keeps the plugin from applying one of its own to every route.
    global: false,
    // One counter for all of them. The plugin asks a registered store for a child once per
    // rate-limited route and its own store answers with a fresh map each time, so without this the
    // bound would be measured on every write route separately — sixty writes a minute on each rather
    // than the client's sixty in total. `./write-rate-limit-store` hands the one instance back for
    // every route, and the window it counts in is the same resolved one the routes register.
    store: WriteRateLimitStore,
    timeWindow: config.writeRateLimit.timeWindow,
    errorResponseBuilder: (_request, context) =>
      new ApiError(
        ERROR_STATUS.rate_limited,
        "rate_limited",
        `Too many write requests; retry in ${context.after}.`,
      ),
  });

  registerRoutes(instance, { database, config });

  // The built web application, served only when it exists. Whether it exists is decided here, once:
  // the static handler's registration cannot change under a running server. The entry document is
  // deliberately *not* read here — see the not-found handler below. The `wildcard` option is stated
  // because it is the one that makes a missing asset reach the handler below — the plugin's wildcard
  // route calls the not-found handler when its file is absent — rather than the plugin answering a
  // 404 of its own that no envelope shapes.
  const spaEntryPath = join(config.webDir, "index.html");
  const servesBuiltWebApp = existsSync(spaEntryPath);

  if (servesBuiltWebApp) {
    instance.register(fastifyStatic, { root: config.webDir, wildcard: true });
  }

  // One handler for every failure. The mapping belongs to `./errors/error-envelope`, so the status a
  // client is answered with, the code and the sentence it reads all come from the same place as the
  // closed vocabulary `./errors/error-codes` defines, and a route that throws never also formats.
  instance.setErrorHandler((error, request, reply) => {
    const apiError = mapFailure(error);

    if (failureLogLevel(apiError.status) === "error") {
      // The cause is recorded here and never sent: the client reads the envelope's own generic
      // sentence, so no stack, driver report, statement or path leaves the process in a response body.
      request.log.error({ err: error }, "The request failed and was answered with a server fault.");
    } else {
      // A refused request is recorded at warning level with the facts an operator needs to diagnose
      // it, so a client-caused failure is distinguishable from routine traffic by level alone. The
      // body, the demo header's value and the envelope's own sentence are never recorded.
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: apiError.status,
          code: apiError.code,
        },
        "The request was refused and answered with a client error.",
      );
    }

    sendApiError(reply, apiError);
  });

  instance.setNotFoundHandler((request, reply) => {
    const path = pathnameOf(request.url);

    // An `/api/` path, and a request whose last segment carries a file extension, are answered with
    // the envelope: an unknown path, an unregistered method on a known path and a missing asset are
    // each the absence of a resource, and answering a request for a script with the application shell
    // and a 200 would hand a loader an HTML document it would then try to execute as code.
    if (isApiPath(path) || looksLikeStaticFile(path)) {
      // One value is built for both the record and the response, so the status and the code logged are
      // the ones the client is answered with. A path under the API's own root is a refused API request
      // and is recorded like one; a missing asset is not, because it is an absence rather than a
      // refusal.
      const notFound = ApiError.notFound();

      if (isApiPath(path)) {
        request.log.warn(
          {
            method: request.method,
            url: request.url,
            statusCode: notFound.status,
            code: notFound.code,
          },
          "The request was refused and answered with a client error.",
        );
      }

      sendApiError(reply, notFound);
      return;
    }

    // A document request for any other path is a deep link: the client router owns the route, so the
    // SPA entry is answered with 200. It is read from disk here, per request, rather than held from
    // construction: a build run over this listening server rewrites the entry to name the assets it
    // just wrote, so a document captured at start-up would name files that build deleted. The entry is
    // a fraction of a kilobyte and only a deep link reads it. A read that fails — the file removed by
    // an in-flight build, or unreadable — falls through to the same 404 as any other absent resource.
    if (servesBuiltWebApp && isDocumentRequest(request.method)) {
      const document = readFileText(spaEntryPath);

      if (document !== undefined) {
        reply.type("text/html; charset=utf-8").send(document);
        return;
      }
    }

    sendApiError(reply, ApiError.notFound());
  });

  // The one line this process logs about itself, through Fastify's own logger: the port the
  // configuration resolved and whether the built web application is being served. Those are the two
  // facts an operator of a partially built checkout needs to tell a served product from an
  // API-only one.
  instance.addHook("onReady", async (): Promise<void> => {
    instance.log.info(
      { port: config.port, servingBuiltWebApp: servesBuiltWebApp, webDir: config.webDir },
      "adem-api ready",
    );
  });

  return instance;
}

/**
 * The level a failure is recorded at, decided by the status it is answered with.
 *
 * The handler's one logging policy, in one place, so that the record a failure produces and the
 * assertion that pins it read the same rule: a failure the server caused is recorded at error level
 * with its cause, and a request the API refused is recorded at warning level with the facts an
 * operator needs. The instance's logger is built at `info`, which emits both levels, so no record
 * depends on the configured level.
 *
 * @param status The status the failure is answered with.
 * @returns `error` at `500` and above, `warn` below it.
 */
export function failureLogLevel(status: number): "warn" | "error" {
  return status >= 500 ? "error" : "warn";
}

/**
 * The segment {@link API_PREFIX} hangs from, which is the root of the API's own surface.
 *
 * @returns `/api` for the `/api/v1` prefix. A prefix carrying no second segment answers with the whole
 *   prefix, so the boundary a caller derives from it stays meaningful.
 */
function apiRootPath(): string {
  const versionSeparator = API_PREFIX.indexOf("/", 1);
  return versionSeparator === -1 ? API_PREFIX : API_PREFIX.slice(0, versionSeparator);
}

/**
 * Whether a request path belongs to the API's own surface, and so must be answered with JSON.
 *
 * @param path A request path with its query and fragment removed.
 * @returns `true` for {@link API_ROOT_PATH} itself and for every path below it, at any contract
 *   version: a client that asked the API for something the API does not serve must not be handed the
 *   web application's HTML.
 */
function isApiPath(path: string): boolean {
  return path === API_ROOT_PATH || path.startsWith(`${API_ROOT_PATH}/`);
}

/**
 * A request target's path: everything before its query string or fragment.
 *
 * @param url The request target as Fastify delivers it, query and fragment included.
 * @returns The path alone. A target carrying neither separator is returned unchanged.
 */
function pathnameOf(url: string): string {
  const separator = url.search(/[?#]/);
  return separator === -1 ? url : url.slice(0, separator);
}

/**
 * Whether a path names a file rather than a route of the client application.
 *
 * @param path A request path with its query and fragment removed.
 * @returns `true` when the last segment carries a dot. No route of this product's client application
 *   does — they are `/`, `/listings`, `/report/<id>`, `/compare`, `/academy` and their siblings — so a
 *   path whose last segment has an extension is a request for an asset, which exists or does not.
 */
function looksLikeStaticFile(path: string): boolean {
  return path.slice(path.lastIndexOf("/") + 1).includes(".");
}

/**
 * Whether a request is one a browser made for a document.
 *
 * @param method The request's HTTP method, as Fastify delivers it in upper case.
 * @returns `true` for `GET` and `HEAD`, the two methods the client application is reached by. Every
 *   other method on a path this API does not serve is answered with the envelope and a 404, so a
 *   mutation attempt is never answered with a document and a 200.
 */
function isDocumentRequest(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/**
 * Reads a file's UTF-8 text, answering `undefined` rather than throwing when the read fails.
 *
 * A file this process serves can be replaced or removed under it while it listens — `vite build`
 * empties the web output directory before it writes the next one, and a container's image swap
 * replaces the whole directory — so reading one is a request-time event with a failure mode rather
 * than a construction-time certainty. This function performs the read and reports its failure; what
 * an unreadable file means for the answer is the caller's decision, not this function's.
 *
 * @param filePath The path of the file to read.
 * @returns The file's contents as text, or `undefined` when it is absent, is a directory, is
 *   unreadable, or is replaced mid-read.
 */
function readFileText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    // The `undefined` is the handling: the caller answers the request with the envelope's 404 rather
    // than letting a filesystem failure leave the handler as a server fault.
    return undefined;
  }
}

/**
 * Answers a request with an {@link ApiError} in the one envelope.
 *
 * @param reply The reply to send on.
 * @param error The mapped failure: its `status`, its `code` of the closed vocabulary and the sentence
 *   the client reads are the whole of what is sent, and nothing is added to the body.
 */
function sendApiError(reply: FastifyReply, error: ApiError): void {
  reply.status(error.status).send(envelope(error.code, error.message));
}

/**
 * The {@link ApiError} a thrown value is answered with.
 *
 * The mapping is `./errors/error-envelope`'s, and this function adds the one case that mapper cannot
 * see: a failure Fastify itself raised carries no code of the closed vocabulary but does carry the
 * status it was raised with — a body that is not valid JSON, a payload above the route's limit, a
 * media type the route does not accept — and that status is a client error the contract has a code
 * for. Answering the fallback's 500 for one would tell a client the server failed when the request
 * did. Only a 4xx status is read this way: a fault at 5xx keeps the generic sentence and the 500 the
 * mapper chose, because its message is a driver report rather than a sentence.
 *
 * Exported so `apps/api/test/integration/error-mapping.test.ts` can assert the mapping this handler
 * performs on the failures Fastify really raises, rather than a copy of it written in the suite; the
 * composition root is otherwise its only caller.
 *
 * @param error The value a route, a hook or a plugin threw, of any type.
 * @returns The mapped error, which is always an `ApiError`: this function never throws, so a mapping
 *   that cannot be made cannot turn one failure into two.
 */
export function mapFailure(error: unknown): ApiError {
  const mapped = toApiError(error);

  if (mapped.code !== "internal_error") {
    return mapped;
  }

  const status = clientErrorStatus(error);
  const code = status === undefined ? undefined : STATUS_DEFAULT_CODE[status];

  if (code === undefined) {
    return mapped;
  }

  // Handed back through the mapper so the sentence is gated by the same rule as any other: a value
  // that cannot be sent is replaced with the sentence the envelope's own vocabulary supplies for the
  // status, and the code this branch chose is preserved rather than generalised.
  return toApiError({ code, message: memberOf(error, "message") });
}

/**
 * The status a framework-raised failure carries, when it carries one in the client-error range.
 *
 * @param error The thrown value, of any type.
 * @returns The whole number in the 400–499 range the value carries in `statusCode`, or `undefined`
 *   when it carries none: a value that is not an object, a value without the member, and a member that
 *   is not an integer in range all answer `undefined`, so a status the contract does not define is
 *   never passed through.
 */
function clientErrorStatus(error: unknown): number | undefined {
  const statusCode = memberOf(error, "statusCode");

  return typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

/**
 * Reads a member from a thrown value, of any type.
 *
 * @param value The thrown value.
 * @param key The member's name.
 * @returns The member, or `undefined` for a value that is not an object and for a value carrying no
 *   such member.
 */
function memberOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}
