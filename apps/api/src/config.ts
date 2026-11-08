/**
 * The API's single configuration module: the two optional inputs the process reads, and the
 * resolved values every other module of this workspace consumes.
 *
 * `ADEM_PORT` and `ADEM_DB_PATH` are the only inputs the process is given from outside it, both
 * optional and both with a working default, so a contributor's install, build, test and start run
 * and the container need no environment variable and no secret. They are named once, here, because
 * three callers have to agree on the spelling: this server, the Playwright `webServer` that hands
 * the built application a database file of its own, and the compose service.
 *
 * The module is pure apart from those two reads: it runs no query, takes no database handle, reads
 * no file, opens no socket and reads no secret, token, credential or key. The environment is read
 * inside {@link resolveConfig} rather than at module load, so two calls under one environment answer
 * the same values, and this module holds no mutable state a caller could change behind another
 * caller's back.
 *
 * A present but unusable value is a configuration error: {@link ConfigurationError} names the
 * variable and the form it expects, rather than the default being substituted for it. Falling back
 * silently would hide the misconfiguration and start the server on a port, or against a database
 * file, that nobody asked for.
 *
 * The numbers and the labels exposed here are not defined here. The page size and the write rate
 * limit belong to `@adem/shared`, and the fictional commerce assumptions, the synthetic currency
 * label and the disclosure sentence belong to `@adem/commerce-sim`, so this file holds no second
 * copy of a fee, a rate or a label sentence.
 */

import { fileURLToPath } from "node:url";

import { resolveCommerceConfig } from "@adem/commerce-sim";
import type { CommerceConfigOverrides } from "@adem/commerce-sim";
import {
  DEMO_AUTHENTICATION_LABEL,
  LISTING_PAGE_SIZE,
  SYNTHETIC_CURRENCY_LABEL,
  WRITE_RATE_LIMIT_MAX,
  WRITE_RATE_LIMIT_WINDOW,
} from "@adem/shared";

// The two label sentences are reached through this module so that a route prompt, a route and the
// UI can each cite one definition: the demo-only authentication label is `@adem/shared`'s and the
// commerce disclosure sentence is `@adem/commerce-sim`'s. Neither is written out here, and a second
// copy anywhere in this workspace would be a second answer to one question.
export { COMMERCE_DISCLOSURE_LABEL } from "@adem/commerce-sim";
export { DEMO_AUTHENTICATION_LABEL } from "@adem/shared";

/**
 * The name of the environment variable that selects the port the API listens on. Exported so a
 * start-up message, a container definition, a browser-run configuration and the documentation can
 * cite one spelling of it.
 */
export const PORT_ENV_VAR = "ADEM_PORT";

/**
 * The name of the environment variable that selects the SQLite file the API opens. Exported for
 * the same reason as {@link PORT_ENV_VAR}: it points the process at one database file and at
 * nothing else.
 */
export const DATABASE_PATH_ENV_VAR = "ADEM_DB_PATH";

/**
 * The port the API listens on when {@link PORT_ENV_VAR} is not set: the port the product's
 * documented commands and its container both expect.
 */
const DEFAULT_PORT = 3000;

/** The lowest and the highest port a process may bind. */
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * A configuration error: the process was handed a value it cannot start with.
 *
 * Raised by {@link resolveConfig} for a present-but-unusable environment value, and for an override
 * that cannot be a port, a path, a page size, a rate-limit bound or a time window. It carries no
 * status code, because a start-up refusal has no HTTP response behind it, and its message states
 * the variable or the member and the form expected of it while disclosing nothing else: no value
 * read from the environment other than the refused one, and no secret.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * The fictional commerce assumptions the API passes into `@adem/commerce-sim`.
 *
 * Every member is that package's resolved configuration, so a route hands this object to a ledger
 * writer or to the checkout path without restating a number or a label. `currencyLabel` is typed as
 * the literal type of the one label `@adem/shared` declares rather than as a string, so a consumer
 * that renders the label cannot compile while saying anything else.
 */
export interface CommerceConfig {
  /**
   * The synthetic currency label every monetary amount is a count of minor units of. The literal
   * type of `@adem/shared`'s `SYNTHETIC_CURRENCY_LABEL`, which is why no other label can be
   * assigned to it and no real currency code can reach a route, a ledger row or a rendered amount.
   */
  readonly currencyLabel: typeof SYNTHETIC_CURRENCY_LABEL;

  /**
   * The flat fictional gate-evaluation fee in whole minor units, charged per completed evaluation
   * and recorded in the gate-evaluation-fee ledger only. `@adem/commerce-sim` owns the value; a
   * configured `0` is valid and means the fee configuration does not apply.
   */
  readonly gateFeeMinorUnits: number;

  /**
   * The provisional founder-participation rate in whole basis points, applied to the net amount of
   * an eligible completed simulated marketplace transaction by `@adem/commerce-sim`'s allocation.
   */
  readonly founderAllocationRateBasisPoints: number;

  /**
   * The disclosure sentence every simulated amount is labelled with; the value of
   * `@adem/commerce-sim`'s `COMMERCE_DISCLOSURE_LABEL`.
   */
  readonly disclosureLabel: string;
}

/**
 * The fully resolved configuration of one API process: what the composition root binds its
 * connection, its rate limit, its static handler and its commerce calls to.
 *
 * Every member is resolved — none is optional and none is read again later — so a consumer holds
 * one value for the life of the process. Nothing here is a secret: the two environment-derived
 * members are a port and a path, and neither may be written into a response body.
 */
export interface ApiConfig {
  /**
   * The port the API listens on: the value of the `ADEM_PORT` environment variable when it is set,
   * and 3000 when it is not.
   */
  readonly port: number;

  /**
   * The SQLite file the API opens. Defaults to `<repository root>/.adem/adem.sqlite`, and it is the
   * member the container's named volume and the browser-run configuration each resolve to a value
   * of their own.
   */
  readonly databasePath: string;

  /**
   * The directory the built web application is served from, which is `<repository root>/apps/web/dist`
   * unless a caller overrides it. Not an environment input: it is named here so the default lives
   * in one place.
   */
  readonly webDir: string;

  /**
   * How many listing results one page of search holds, fixed by the API contract at `@adem/shared`'s
   * `LISTING_PAGE_SIZE`. A page beyond the last is a valid request that answers with an empty page,
   * never with a page of another size.
   */
  readonly pageSize: number;

  /**
   * The write rate limit every write route registers: at most `max` write requests per `timeWindow`
   * per client, beyond which the route answers 429 with a `Retry-After` header. Both numbers are
   * `@adem/shared`'s, and `timeWindow` stays the unit string `@fastify/rate-limit` accepts rather
   * than a millisecond count, so a route passes it straight through.
   */
  readonly writeRateLimit: { readonly max: number; readonly timeWindow: string };

  /**
   * The label the UI renders wherever a demo account is used to write, stating that a demo session
   * is not an authentication of any identity; the value of `@adem/shared`'s
   * `DEMO_AUTHENTICATION_LABEL`, re-exported from this module for the same one-definition reason.
   */
  readonly demoAuthLabel: string;

  /** The fictional commerce assumptions, resolved by `@adem/commerce-sim`. */
  readonly commerce: CommerceConfig;
}

/**
 * The overrides {@link resolveConfig} accepts: a partial of {@link ApiConfig} whose two nested
 * sections are themselves partial, so `resolveConfig({ writeRateLimit: { max: 10_000 } })` raises
 * the bound while keeping the resolved window. Every member {@link ApiConfig} declares may be
 * overridden, and each one a caller does supply replaces the resolved value for that member alone.
 *
 * `commerce` is `@adem/commerce-sim`'s own override type, which admits the gate fee and the
 * founder-participation rate and deliberately not the two label sentences: a caller free to
 * substitute a weaker disclosure sentence would be free to weaken the labelling duty the product
 * owes every simulated amount.
 */
export type ApiConfigOverrides = Omit<Partial<ApiConfig>, "writeRateLimit" | "commerce"> & {
  readonly writeRateLimit?: Partial<ApiConfig["writeRateLimit"]>;
  readonly commerce?: CommerceConfigOverrides;
};

/**
 * The database file the API opens when {@link DATABASE_PATH_ENV_VAR} is not set:
 * `<repository root>/.adem/adem.sqlite`.
 *
 * The path is derived from this module's own location and never from the process's working
 * directory, so the server opens the same file however it was launched — by the documented
 * commands, by the container's start command or by a browser run's web server. It is a function
 * rather than a module constant so that no module-level value exists for a caller to capture or
 * replace.
 *
 * @returns An absolute path to the default database file, which need not exist yet: the connection
 *   creates its directory and its file.
 */
export function defaultDatabasePath(): string {
  return fileURLToPath(new URL("../../../.adem/adem.sqlite", import.meta.url));
}

/**
 * The directory the built web application is served from when nothing overrides it:
 * `<repository root>/apps/web/dist`.
 *
 * @returns An absolute path to the built web application directory. It is returned whether or not
 *   that build exists: a server started before the web build answers for the API and reports the
 *   missing directory through its own static handler rather than failing at start-up.
 */
export function defaultWebDir(): string {
  return fileURLToPath(new URL("../../../apps/web/dist", import.meta.url));
}

/**
 * Resolves the API's configuration from the environment, the product's shared constants and the
 * simulated commerce configuration, with the caller's overrides applied over them.
 *
 * The environment is read on every call, so one environment yields one configuration however many
 * times it is resolved, and the module keeps no state between calls. A member an override supplies
 * is not read from the environment at all: the override settles that member, and refusing a start-up
 * over an input that would then be discarded would be a refusal for a reason that does not apply.
 *
 * The result is deeply frozen — the configuration, its `writeRateLimit` and its `commerce` — so no
 * consumer can mutate a configuration another consumer is holding; a consumer that needs different
 * values resolves its own.
 *
 * @param overrides The members to resolve a different value for. An absent member resolves to the
 *   environment's value where one is read, and to the product's default otherwise.
 * @returns A newly built configuration, frozen, whose members carry the resolved values.
 * @throws {ConfigurationError} If `ADEM_PORT` is set and is not a whole number between 1 and 65535,
 *   if `ADEM_DB_PATH` is set and cannot name a file, or if an override is not a whole number in
 *   range for `port`, not a filesystem path for `databasePath` or `webDir`, not a whole number
 *   greater than zero for `pageSize` or `writeRateLimit.max`, or not a non-empty string for
 *   `writeRateLimit.timeWindow`. The message names the variable or the member and the form expected
 *   of it.
 * @throws {RangeError} From `@adem/commerce-sim`'s own resolver, if an overridden `commerce` member
 *   is negative, not an integer or not a safe integer. The refusal is deliberately not translated:
 *   that package owns the fee and the rate, and the wording of its refusals with them.
 */
export function resolveConfig(overrides: ApiConfigOverrides = {}): ApiConfig {
  const port = overrides.port === undefined ? environmentPort() : requirePortNumber("port", overrides.port);
  const databasePath =
    overrides.databasePath === undefined
      ? environmentDatabasePath()
      : requirePath("databasePath", overrides.databasePath);
  const webDir = overrides.webDir === undefined ? defaultWebDir() : requirePath("webDir", overrides.webDir);
  const pageSize =
    overrides.pageSize === undefined ? LISTING_PAGE_SIZE : requirePositiveInteger("pageSize", overrides.pageSize);

  const writeRateLimitOverrides = overrides.writeRateLimit;

  const writeRateLimit = Object.freeze({
    max:
      writeRateLimitOverrides?.max === undefined
        ? WRITE_RATE_LIMIT_MAX
        : requirePositiveInteger("writeRateLimit.max", writeRateLimitOverrides.max),
    timeWindow:
      writeRateLimitOverrides?.timeWindow === undefined
        ? WRITE_RATE_LIMIT_WINDOW
        : requireNonEmptyString("writeRateLimit.timeWindow", writeRateLimitOverrides.timeWindow),
  });

  return Object.freeze({
    port,
    databasePath,
    webDir,
    pageSize,
    writeRateLimit,
    demoAuthLabel: DEMO_AUTHENTICATION_LABEL,
    commerce: freezeCommerceConfiguration(overrides.commerce),
  });
}

/**
 * Resolves the commerce section: `@adem/commerce-sim`'s configuration for the overrides a caller
 * passes, frozen, in this module's own field set. The values are that package's, never a copy of
 * them held here, and it validates an override from this caller exactly as it does from any other.
 */
function freezeCommerceConfiguration(overrides: CommerceConfigOverrides | undefined): CommerceConfig {
  const resolved = resolveCommerceConfig(overrides);

  return Object.freeze({
    currencyLabel: resolved.currencyLabel,
    gateFeeMinorUnits: resolved.gateFeeMinorUnits,
    founderAllocationRateBasisPoints: resolved.founderAllocationRateBasisPoints,
    disclosureLabel: resolved.disclosureLabel,
  });
}

/**
 * Reads the port from the environment: the value of {@link PORT_ENV_VAR} when it is set, and
 * {@link DEFAULT_PORT} when it is not. A value that is set to nothing is refused rather than
 * treated as unset, because the two mean different things to whoever set it.
 */
function environmentPort(): number {
  const configured = process.env.ADEM_PORT;

  return configured === undefined ? DEFAULT_PORT : requirePortText(PORT_ENV_VAR, configured);
}

/**
 * Reads the database path from the environment: the value of {@link DATABASE_PATH_ENV_VAR} when it
 * is set, and {@link defaultDatabasePath} when it is not. A relative value is passed through
 * unchanged, because it is resolved against the working directory of the process that opens it.
 */
function environmentDatabasePath(): string {
  const configured = process.env.ADEM_DB_PATH;

  return configured === undefined ? defaultDatabasePath() : requirePath(DATABASE_PATH_ENV_VAR, configured);
}

/**
 * Refuses a port that is not a whole number between {@link MIN_PORT} and {@link MAX_PORT}, and
 * returns it when it is. One rule covers both forms a port arrives in, so the accepted range is
 * stated in one place.
 */
function requirePortNumber(origin: string, value: number): number {
  if (!Number.isInteger(value) || value < MIN_PORT || value > MAX_PORT) {
    throw new ConfigurationError(
      `${origin} must be a whole number between ${MIN_PORT} and ${MAX_PORT}, received ${String(value)}`,
    );
  }

  return value;
}

/**
 * Reads a port from its text form, refusing anything that is not one or more digits: a sign, a
 * decimal part, a unit, text around the digits and an empty value are each refused here rather than
 * coerced, because a coerced port is a port nobody asked for. Whitespace around the digits is the
 * one exception, because it carries no meaning for a number and a value quoted into a shell
 * variable commonly arrives with it.
 */
function requirePortText(origin: string, value: string): number {
  const digits = value.trim();

  if (!/^[0-9]+$/.test(digits)) {
    throw new ConfigurationError(
      `${origin} must be a whole number between ${MIN_PORT} and ${MAX_PORT}, received ${JSON.stringify(value)}`,
    );
  }

  return requirePortNumber(origin, Number(digits));
}

/**
 * Refuses a value that cannot name a file or a directory, and returns it unchanged when it can.
 *
 * An accepted value is used exactly as given: a relative path is resolved by the caller that opens
 * it, while the default is absolute because it is derived from this module's own location.
 *
 * A value that names no file is refused: one ending in a separator, one whose last segment is the
 * containing directory itself, and one carrying a NUL character, which no path may contain. Each
 * would otherwise be accepted here and rejected later by the driver or the static handler, which is
 * a worse place to learn about it — and a value the filesystem would refuse is not a value this
 * process can start with.
 */
function requirePath(origin: string, value: string): string {
  if (value.trim() === "") {
    throw new ConfigurationError(`${origin} must be a filesystem path, received an empty value`);
  }

  if (value.includes("\u0000")) {
    throw new ConfigurationError(`${origin} must be a filesystem path, received a value containing a NUL character`);
  }

  const lastSegment = value.split("/").pop() ?? "";

  if (lastSegment === "" || lastSegment === "." || lastSegment === "..") {
    throw new ConfigurationError(
      `${origin} must be a filesystem path naming a file or a directory, received ${JSON.stringify(value)}`,
    );
  }

  return value;
}

/**
 * Refuses a member that is not a whole number greater than zero, and returns it when it is. A
 * fractional or non-positive value is refused rather than rounded or clamped: a count nobody can
 * honour is a configuration mistake, and a bounded or rounded one would be a different contract
 * from the one the route registers.
 */
function requirePositiveInteger(origin: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError(`${origin} must be a whole number greater than zero, received ${String(value)}`);
  }

  return value;
}

/**
 * Refuses a member that is not a string with something in it, and returns it when it is. An
 * accepted value is used exactly as given, whitespace included, because the rate-limit plugin
 * parses the unit string itself.
 */
function requireNonEmptyString(origin: string, value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(`${origin} must be a non-empty string, received ${JSON.stringify(value)}`);
  }

  return value;
}

