/**
 * The ADEM API's only public entry: the workspace's exported factory, and the process start-up that
 * the documented `npm start`, the container's start command and a browser run's `webServer` command
 * all reach.
 *
 * `apps/api/package.json` resolves `"."` to this file, so this is the workspace's whole public
 * surface: {@link createServer} is `./server`'s `createApp` under the one name the plan fixes, and
 * nothing else is exported — no Fastify option, route, plugin, hook or error handler is registered
 * here, because the composition root stays the single site where an instance is assembled.
 *
 * **It listens only as the process's entry point.** Every documented way of starting the product
 * launches this file, so `process.argv[1]` is this module; a plain import is not a start. That
 * distinction is a requirement rather than a courtesy: `apps/api/test/integration/test-server.ts`
 * imports {@link createServer} and listens on an ephemeral port of its own, and a server bound to the
 * configured port as a side effect of that import would collide with it and with every suite running
 * beside it. The decision is {@link isProcessEntryPoint}'s, and the guard at the foot of this file is
 * the one statement of this module that is not a declaration.
 *
 * **The start-up order**, once the guard has fired:
 *
 * 1. `./config`'s `resolveConfig()` settles every value the process runs with, from its two optional
 *    environment variables and the product's defaults. This module reads no environment variable
 *    itself: `./config` is the only module of the workspace permitted to, and a contributor's install,
 *    build, test and start run needs no variable and no secret.
 * 2. `./db/connection`'s `openDatabase()` opens the one connection, bringing `.adem/` into being on a
 *    fresh checkout and requesting the three pragmas the schema relies on.
 * 3. `./db/migrate`'s `runMigrations()` brings that connection's schema up to date before any route is
 *    reachable, on the connection this start-up owns. A refusal — an applied migration file whose
 *    bytes no longer hash to the checksum recorded in `schema_migrations` — aborts the start-up with a
 *    non-zero exit and the runner's own message naming the file, and never leaves a listening socket
 *    or an open handle behind.
 * 4. `./server`'s `createApp()`, through {@link createServer}, builds the instance over that
 *    connection and the resolved configuration.
 * 5. The instance listens on `0.0.0.0` — never Fastify's default loopback bind, which would leave the
 *    published container port unanswered — and the address it resolved and the schema version it
 *    started from are logged at info level through Fastify's own logger, which is the API's whole
 *    instrumentation: there is no metrics backend, no tracing exporter and no log shipping, no
 *    external service being callable.
 * 6. `SIGINT` and `SIGTERM` close the instance and then the connection this start-up opened. Closing
 *    the connection is this module's step rather than the composition root's: `createApp` registers
 *    the hook that closes a connection only for a handle it opened itself, and a caller-supplied
 *    handle deliberately outlives the instance — which is what lets the integration harness read its
 *    database after each request.
 *
 * **What this file does not do.** It reads no environment variable, holds no secret and opens no
 * second resource; it carries no migration SQL and no migration bookkeeping, that being `./db/migrate`'s;
 * it registers no route, plugin, hook or handler, all of that being `./server`'s and the route
 * groups'; it never seeds, seeding being the separate and explicitly documented one-time
 * `npm run seed` step that the container deliberately does not run; it computes nothing and imports no
 * domain package for a calculation; and it binds no fixed port, so the configured one decides where
 * this process listens and a caller can listen on an ephemeral port of its own.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The handle's type is imported by name rather than by default, as in `./db/migrate`: the driver's
// type declarations export the namespace their `export =` also exports, so a default *type* import
// resolves to the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { ApiConfig } from "./config";
import { resolveConfig } from "./config";
import { openDatabase } from "./db/connection";
import { runMigrations } from "./db/migrate";
import type { CreateServerOptions } from "./server";
import { createApp } from "./server";

/**
 * The interface the process binds: every interface of its host.
 *
 * Fastify's own default is `127.0.0.1`, which answers only a caller inside the process's own network
 * namespace and would leave the container's published port unanswered, while `docker compose up` has
 * to serve both the web UI and the API through it. It is a constant here rather than a configuration
 * member because it is not an input anyone tunes: a process that listens at all listens for its host's
 * callers.
 */
const LISTEN_HOST = "0.0.0.0";

export type { CreateServerOptions };

/**
 * The workspace's public entry: builds the API instance without listening.
 *
 * Returns the Fastify instance; the caller calls `listen()` (or `ready()`). It refuses nothing — a
 * missing built-web directory is a supported state, and a migration refusal surfaces from the
 * migration runner rather than from here.
 *
 * @param options The caller's database handle or path, its port and built web directory, and its
 *   configuration overrides. Every member is optional, and an absent one resolves to the
 *   configuration's own value, so `createServer()` alone builds the instance the documented
 *   `npm start` runs. `port` settles the port the configuration *resolves* — `./config` accepts a
 *   whole number between 1 and 65535 for it — and never the port the instance listens on: the caller
 *   chooses that in its own `listen` call, which is how the integration harness reaches an ephemeral
 *   port while this factory is handed the resolved one.
 * @returns The instance, with every route, handler and hook registered, before it is listening.
 */
export function createServer(options?: CreateServerOptions): FastifyInstance {
  return createApp(options);
}

/**
 * The one thing {@link startFromEnvironment} needs from its caller: somewhere to record the instance
 * it created.
 *
 * A failed start-up has to be reported, and the report belongs in the instance's own log when an
 * instance exists. That instance is created inside the start-up, after work that can fail, so the
 * failure's reporter — the guard at the foot of this file — holds this observer and reads the instance
 * off it rather than the start-up having to report on itself and then also throw.
 */
interface StartedInstance {
  /** The instance, once the start-up has created one; `undefined` before that and on a failure. */
  instance?: FastifyInstance;
}

/**
 * Whether this module is the process's entry point rather than a module another file imported.
 *
 * The check exists for one requirement: the integration harness imports {@link createServer} and
 * listens on an ephemeral port of its own, so an import must not bind the configured port.
 *
 * Both sides of the comparison are real paths. `process.argv[1]` is spelled however the launcher
 * spelled it — the documented `tsx apps/api/src/index.ts` passes a relative one, an absolute
 * invocation passes an absolute one — while this module's own URL is always absolute, so a plain
 * string comparison would answer `false` for the documented command. Resolving symbolic links on both
 * sides is what makes a checkout reached through one answer `true`.
 *
 * @returns `true` when `process.argv[1]` names this file, and `false` for a process launched with no
 *   script argument at all, or one launched on another file.
 */
function isProcessEntryPoint(): boolean {
  const entryPoint = process.argv[1];

  if (entryPoint === undefined) {
    return false;
  }

  return realPathOf(entryPoint) === realPathOf(fileURLToPath(import.meta.url));
}

/**
 * A path's real path, or its absolute form when the real path cannot be resolved.
 *
 * @param path A filesystem path, relative or absolute.
 * @returns The canonical path with every symbolic link resolved. A path the filesystem cannot resolve
 *   — one that does not exist, or one this process may not inspect — answers with its absolute form
 *   instead: the comparison in {@link isProcessEntryPoint} needs two values to compare, and a failure
 *   to resolve is not a reason to refuse to start.
 */
function realPathOf(path: string): string {
  const absolute = resolve(path);

  try {
    return realpathSync(absolute);
  } catch {
    // The fallback is the handling: an unresolvable path is compared in its absolute form rather than
    // throwing out of a predicate the process's own start-up depends on.
    return absolute;
  }
}

/**
 * Starts the API for the process's entry point: configuration, connection, schema, instance, listen,
 * and the handlers that end it.
 *
 * Returns once the process is listening, and refuses by throwing when the configuration cannot be
 * resolved, when the connection cannot be opened, when the migration runner refuses the database's
 * recorded history, or when the instance cannot bind its port. Every resource this function opened is
 * released before the failure leaves it, so a refused start-up is a process that exits rather than one
 * that half-ran.
 *
 * @param started The observer this start-up records its instance on, so that a failure after the
 *   instance exists is reported through the instance's own logger.
 * @throws {ConfigurationError} From `./config`, for an environment value that is present and unusable.
 * @throws {Error} From `./db/connection` for a connection that cannot be opened, from `./db/migrate`
 *   for a recorded migration whose file changed, was renamed or disappeared, or from Fastify for a
 *   port that cannot be bound.
 */
async function startFromEnvironment(started: StartedInstance): Promise<void> {
  // Resolved first, by the only module permitted to read the environment. A refusal here happens
  // before any resource exists, so there is nothing for the failure path below to release.
  const config: ApiConfig = resolveConfig();

  const database: Database = openDatabase(config.databasePath);

  let instance: FastifyInstance | undefined;

  try {
    // The schema before the routes: a fresh database has none of the tables the route groups query.
    // The composition root applies this same runner to the handle it is given, which is a no-op —
    // a recorded version is applied once — so the entry point can report what a run applied.
    const migration = runMigrations(database);

    // The handle goes in, and the resolved configuration goes in as the override: resolving it once
    // here keeps the port the process binds and the port the instance was built with the same value,
    // and re-applying the resolved values over themselves is a no-op.
    instance = createServer({ database, port: config.port, webDir: config.webDir, config });
    started.instance = instance;

    // `LISTEN_HOST` and not Fastify's default loopback bind: the container publishes this port, so a
    // loopback-only bind would answer nothing from outside the process's own network namespace, while
    // the wildcard answers the published port and the browser suites' `127.0.0.1` alike.
    const address = await instance.listen({ port: config.port, host: LISTEN_HOST });

    instance.log.info(
      {
        address,
        port: config.port,
        appliedMigrations: migration.appliedCount,
        schemaVersion: migration.highestVersion,
      },
      "adem-api is listening.",
    );

    installShutdownHandlers(instance, database);
  } catch (error: unknown) {
    // Both resources are released before the failure leaves this function: the socket of an instance
    // that may already have bound its port, and the connection this start-up opened, which nothing
    // else will close.
    await releaseOwnedResources(instance, database);
    throw error;
  }
}

/**
 * Ends the process on `SIGINT` and `SIGTERM`: the server closed, then the connection released.
 *
 * The first signal of either kind starts the one shutdown; the flag below makes a signal of the other
 * kind a no-op, and a second signal of the same kind finds no listener, so the platform's own handling
 * takes the process down instead of a second `close` racing the first.
 *
 * `process.exit()` is deliberately absent. Once the instance and the connection are closed nothing
 * keeps the event loop alive, so the process ends on its own with the code it earned — which is what
 * makes a clean signal shutdown observable as a clean one rather than as a code chosen for it.
 *
 * @param instance The listening instance.
 * @param database The connection this start-up opened, which the composition root does not close.
 */
function installShutdownHandlers(instance: FastifyInstance, database: Database): void {
  let shuttingDown = false;

  const shutDown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    instance.log.info({ signal }, "adem-api is shutting down.");
    void releaseOwnedResources(instance, database);
  };

  process.once("SIGINT", () => shutDown("SIGINT"));
  process.once("SIGTERM", () => shutDown("SIGTERM"));
}

/**
 * Releases the resources a start-up opened: the instance first, then the connection.
 *
 * Both paths that end the process's life use it — a start-up that failed after opening them, and the
 * signal shutdown of a start-up that succeeded — and the order is the one that matters in both: a
 * request already accepted finishes while the connection is still under it, and the connection is
 * closed whether or not closing the instance went well.
 *
 * Never throws and never rejects. The failure being handled is the one that matters, so a failure
 * while releasing is reported on its own line instead of replacing it.
 *
 * @param instance The instance, or `undefined` when the start-up failed before creating one.
 * @param database The connection this start-up opened.
 */
async function releaseOwnedResources(instance: FastifyInstance | undefined, database: Database): Promise<void> {
  if (instance !== undefined) {
    try {
      await instance.close();
    } catch (error: unknown) {
      reportReleaseFailure(instance, error, "adem-api did not close cleanly.");
    }
  }

  try {
    database.close();
  } catch (error: unknown) {
    reportReleaseFailure(instance, error, "adem-api could not close its database connection.");
  }
}

/**
 * Reports a failure to release a resource, through the instance's own logger when there is one.
 *
 * @param instance The instance, or `undefined` when the start-up failed before creating one.
 * @param error The value the release threw, of any type.
 * @param sentence What could not be done, which is the report's message.
 */
function reportReleaseFailure(instance: FastifyInstance | undefined, error: unknown, sentence: string): void {
  if (instance === undefined) {
    console.error(`${sentence} ${detailOf(error)}`);
  } else {
    instance.log.error({ err: error }, sentence);
  }

  // A resource that could not be released is as much a failed run as the failure that led here, so the
  // process still leaves with a non-zero code.
  process.exitCode = 1;
}

/**
 * Reports a failed start-up and records it in the process's exit code.
 *
 * The report is one line wherever it goes: through the start-up instance's own logger when the failure
 * happened late enough for one to exist, and on standard error when it did not — a configuration
 * refusal, a connection that could not be opened, or the migration runner refusing a changed file, each
 * of which arrives with its own message naming the file or the variable an operator acts on.
 *
 * @param started The observer the start-up records its instance on, still empty when nothing was
 *   created.
 * @param error The value the start-up threw, of any type.
 */
function reportStartupFailure(started: StartedInstance, error: unknown): void {
  if (started.instance === undefined) {
    console.error(`adem-api: the process could not start: ${detailOf(error)}`);
  } else {
    // The instance's logger carries the error itself, so the message needs no repetition here.
    started.instance.log.error({ err: error }, "adem-api: the process could not start.");
  }

  // The exit code rather than `process.exit()`: nothing is listening and everything this start-up
  // opened has been released, so the process ends on its own with the code the operator reads.
  process.exitCode = 1;
}

/**
 * The sentence a thrown value is reported with.
 *
 * @param error The thrown value, of any type.
 * @returns The value's own message when it has one — an `Error` and every subclass, the configuration
 *   module's refusal and the migration runner's among them — and its text form when it does not, so a
 *   failure is never reported as unnamed.
 */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The one effect of this module, and the last thing in it on purpose: everything the guard and the
// start-up behind it depend on has been read by the time a reader reaches it. `isProcessEntryPoint()`
// is what keeps a plain import by the integration harness from starting a server, and the top-level
// `await` is the form this module's own entry point takes.
if (isProcessEntryPoint()) {
  const started: StartedInstance = {};

  try {
    await startFromEnvironment(started);
  } catch (error: unknown) {
    // Reported and not rethrown: an unhandled rejection would print the failure a second time and end
    // the process with a code it did not choose. The error path only records — a failed start-up must
    // never leave a listening socket behind, and `startFromEnvironment` has already released whatever
    // it opened.
    reportStartupFailure(started, error);
  }
}

