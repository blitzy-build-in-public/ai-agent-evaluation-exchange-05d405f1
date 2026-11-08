/**
 * The three operator-only ledger reads: `GET /ledger/marketplace`, `GET /ledger/gate-fees` and
 * `GET /ledger/founder-allocation`. Between them they own three rows of the API contract table —
 * role `operator`, success `200` with that ledger's append-only entries, error case `403` — and three
 * of the four operator-only exceptions to the API's public reads, the fourth being
 * `GET /audit-events`. Every public read resolves no identity at all; these four resolve the demo
 * account `X-Demo-Account` names and require it to be an operator. An absent or unresolvable header is
 * answered `401` — absent through the header schema attached below, unresolvable through
 * `resolveDemoAccount` — and a resolvable account of any other role, a developer or a buyer or a
 * contributor alike, is answered `403` by `requireRole`.
 *
 * **Three ledgers, one table, one discriminator.** All three reads filter the one `ledger_entries`
 * table on its `ledger` column, exactly as `@adem/commerce-sim`'s `listLedgerEntries` does, because
 * that column is the only thing separating the marketplace ledger, the gate-evaluation-fee ledger and
 * the founder-participation allocation ledger. The three keep separate meaning rather than separate
 * rows: a gate-evaluation fee is recorded in the gate-fee ledger only and is never eligible for an
 * allocation, and an allocation applies only to the net amount of an eligible completed simulated
 * marketplace transaction.
 *
 * **The path segment is not the stored name, and the translation lives here.** The gate-fee route is
 * served at `/ledger/gate-fees` while the discriminator is `gate_fees`, the hyphenated segment being
 * the contract's spelling and the underscored name being `LEDGER_NAMES`'s. {@link LEDGER_READ_ROUTES}
 * is the one place the two are paired, so the mapping exists once and is read beside the other two
 * routes.
 *
 * **Insertion order, and nothing else.** Each read answers the entries exactly as the domain package
 * returns them: filtered on the discriminator and ordered by the table's own `rowid`, so an entry a
 * refund appended appears after the entry it corrects and two entries written in the same millisecond
 * keep the order they were written in. Nothing here re-sorts, filters, groups, sums, paginates or
 * derives an amount — the route takes no parameter, and the contract lists no error case but `403`.
 *
 * **The founder-allocation read states the rate each recorded entry was computed from, and it reads
 * that rate out of the entry.** A founder-allocation row carries the basis-point rate it was computed
 * from in its own `description`, written there by `@adem/commerce-sim` at insert time precisely so
 * that the appended row is the durable record of that rate. This route therefore extracts the rate
 * from the stored text and never consults the live commerce configuration: a later configuration
 * change must not retroactively alter what an already-written entry says it was computed from, and an
 * append-only ledger whose explanation drifts with today's settings is not a record of anything.
 *
 * **It writes nothing.** No `INSERT`, `UPDATE` or `DELETE` appears in this file, no transaction is
 * opened, no audit event is appended for a read, and no `PUT`, `PATCH` or `DELETE` handler is
 * registered. `ledger_entries` is one of the nine append-only tables
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards with an aborting trigger, and the
 * operator's power over the record is additive: these rows read the ledgers, and only the checkout
 * and refund routes ever append to them.
 *
 * **Nothing here belongs to anyone.** The founder-allocation payload carries no personal identity, no
 * beneficiary account and no entitlement, and no column of the table could hold one. Its contract
 * structure is labelled "to be determined" by the UI, from the shared constant
 * `FOUNDER_ALLOCATION_CONTRACT_LABEL`; the read invents no field for that note, and every amount in
 * every payload stays an integer count of minor units of the synthetic `DEMO` currency with no
 * currency symbol anywhere.
 */

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type {
  FounderAllocationLedgerReadResult,
  LedgerEntry,
  LedgerName,
  LedgerReadResult,
} from "@adem/shared";
import { DEMO_ACCOUNT_HEADER, demoAccountHeaderSchema } from "@adem/shared";

import {
  DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS,
  listLedgerEntries,
} from "@adem/commerce-sim";

import { resolveDemoAccount } from "../auth/resolve-demo-account";
import { requireRole } from "../auth/require-role";

/**
 * The slice of the folder's single `RouteContext` these three reads need: the open database handle,
 * which arrives by closure from the server factory rather than through Fastify plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the member structurally instead of importing that type, so that this file and the
 * `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` is assignable to this shape, so the registrar's call site is unaffected. Only
 * the member these routes read is declared — the config is not bound to a name, an unused binding
 * being padding, and these reads resolve no fee and no rate from it. `apps/api/src/server.ts` passes
 * the handle in, so this module opens no connection, reads no environment variable and resolves no
 * path.
 */
interface LedgerRouteContext {
  readonly database: Database;
}

/**
 * One ledger read: the path it is served at, and the ledger discriminator it filters on.
 */
interface LedgerReadRoute {
  /** The prefix-relative path of the route. */
  readonly path: string;
  /** The `ledger` value `ledger_entries` rows of this ledger carry. */
  readonly ledger: LedgerName;
}

/**
 * The three reads, in contract-table order, each pairing a path with the ledger it reads.
 *
 * This table is the single place the group's paths are listed and the single place the gate-fee
 * route's hyphenated path segment `gate-fees` is paired with the underscored discriminator
 * `gate_fees` that `LEDGER_NAMES` declares. Both spellings are the contract's — the path is what a
 * client requests, the discriminator is what the column stores — so the pairing belongs here, once,
 * rather than at three call sites.
 *
 * Frozen so a route cannot be added or rewritten after the group is registered, and not exported:
 * the paths are the contract and are read through the routes the function below registers.
 */
const LEDGER_READ_ROUTES: readonly LedgerReadRoute[] = Object.freeze([
  Object.freeze({ path: "/ledger/marketplace", ledger: "marketplace" }),
  Object.freeze({ path: "/ledger/gate-fees", ledger: "gate_fees" }),
  Object.freeze({ path: "/ledger/founder-allocation", ledger: "founder_allocation" }),
]);

/**
 * The basis-point rate a founder-allocation row states about itself, as the writers spell it:
 * `Simulated founder allocation of a completed marketplace transaction at 25 basis points`, and
 * `Simulated refund reversal of the founder allocation computed at 25 basis points for transaction
 * <id>`.
 *
 * Anchored on the unit rather than on either sentence, so both writers — the allocation and the
 * reversal a refund appends — are read by the same rule and a rewording that keeps the unit keeps
 * working. Matched without the `g` flag, so the pattern carries no state between calls.
 */
const BASIS_POINT_RATE_IN_DESCRIPTION = /([0-9]+) basis points/;

/**
 * The rate one stored entry states, or `null` when it states none.
 *
 * The digits are read out of the row's own text and converted to the number `rate_basis_points`
 * declares: a rate written into a row is data the row carries, and reading it back is not arithmetic
 * — nothing is computed, scaled or rounded here, and the amount beside it is never touched. A
 * digits run that does not convert to a safe integer states no rate this product can report, so it
 * answers `null` rather than an approximation.
 */
function storedRateBasisPoints(entry: LedgerEntry): number | null {
  const digits = BASIS_POINT_RATE_IN_DESCRIPTION.exec(entry.description)?.[1];

  if (digits === undefined) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * The rate the founder-allocation read reports: the rate the most recent recorded entry states about
 * itself.
 *
 * The entries are walked from the last one backwards, because the newest entry is the rate the ledger
 * most recently used and the read reports one scalar rather than a rate per row. Entries computed
 * under different rates are the expected case rather than the exception — a configuration change
 * applies to the transactions that follow it and can never touch a row already appended — so the
 * reported rate is the latest one stated, while every entry keeps stating its own in the payload
 * beside its amount.
 *
 * An entry that states no rate is passed over. A ledger holding no entry that states one — an empty
 * ledger, which the plan answers `200` with an empty list rather than an error — reports the
 * product's default allocation rate `DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS`, the constant the
 * configuration itself defaults to: no entry exists, so no stored rate is contradicted, and the read
 * never reaches for today's configuration to explain a row of yesterday's.
 */
function founderAllocationRateBasisPoints(entries: readonly LedgerEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry !== undefined) {
      const stated = storedRateBasisPoints(entry);

      if (stated !== null) {
        return stated;
      }
    }
  }

  return DEFAULT_FOUNDER_ALLOCATION_RATE_BASIS_POINTS;
}

/**
 * Builds the `200` body for one ledger read: the ledger that was read and its entries in insertion
 * order, plus the rate the recorded entries were computed from when the ledger is the
 * founder-allocation one.
 *
 * The body is exactly the shape `@adem/shared` declares — `LedgerReadResult` for the two ledgers that
 * have no rate to state, `FounderAllocationLedgerReadResult` for the founder-allocation ledger, whose
 * `rate_basis_points` a client cannot interpret an allocation without. No other field is added: the
 * payload carries no count, no total, no page and no note, and the entry rows are handed on member
 * for member as the domain package read them, each with its entry type, its direction, its integer
 * amount in minor units of the synthetic currency, the one of `transaction_id` or `report_id` it
 * populates, its currency label, its disclosure label, its description and its instant.
 */
function ledgerReadResult(
  ledger: LedgerName,
  entries: LedgerEntry[],
): LedgerReadResult | FounderAllocationLedgerReadResult {
  if (ledger === "founder_allocation") {
    return {
      ledger,
      entries,
      rate_basis_points: founderAllocationRateBasisPoints(entries),
    };
  }

  return { ledger, entries };
}

/**
 * Registers this group's three routes — the operator-only ledger reads — on the instance it is
 * handed.
 *
 * The paths are prefix-relative: the versioned prefix — `API_PREFIX`, from `apps/api/src/server.ts` —
 * is applied exactly once, by `./register-routes`, which calls this function with its encapsulated
 * scope. That literal appears nowhere in this file and must not: a group that spelled it would be the
 * second place the prefix is decided.
 *
 * Each route carries the demo-account header schema and nothing else: the row takes no body, no path
 * parameter and no query string, so there is no further request shape to validate. The schema is what
 * makes an absent header a validation failure at the edge, which the server's single error handler
 * answers `401 unauthorized` for this header and `400 validation_error` for every other schema
 * rejection. The role check below then answers `403` for a resolvable account that is not an operator,
 * and the account it returns is deliberately not bound to a name: a read acts on behalf of nobody,
 * records nothing and needs no actor, so only the refusal is wanted from the call.
 * `resolveDemoAccount` precedes it and answers `401` for a header that names no seeded account.
 *
 * No route carries a rate-limit option: the 60-per-minute limit is on writes, and reads are
 * unlimited. No failure is caught here either — the server's single error handler owns
 * `{ error: { code, message } }`, so no handler-local error body exists to disagree with it.
 */
export function registerLedgerRoutes(app: FastifyInstance, context: LedgerRouteContext): void {
  for (const route of LEDGER_READ_ROUTES) {
    app.get(route.path, { schema: demoAccountHeaderSchema }, (request, reply) => {
      // Called for its refusal: `401` when the header names no seeded account, `403` when it names
      // one whose role is not the operator's.
      requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "operator",
      );

      const entries = listLedgerEntries(context.database, route.ledger);

      return reply.code(200).send(ledgerReadResult(route.ledger, entries));
    });
  }
}
