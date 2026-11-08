/**
 * The operator's moderation route — `POST /moderation/listings/{id}/actions` — and the one
 * `UPDATE` statement this workspace issues.
 *
 * It owns one row of the API contract table: role `operator`, success `200` carrying the
 * listing's new status beside the governance event the route appended, and the row's own error
 * cases `404` for a listing no listing carries and `400` for a body its schema refuses. An absent
 * or unresolvable `X-Demo-Account` header is answered `401` and a resolvable account whose role is
 * not the operator's is answered `403`, both from the pair every non-public row uses.
 *
 * **Its power is additive, and that is what the row exists to be.** The action moves one mutable
 * column — `listings.status`, whose closed vocabulary is `active` | `flagged` | `hidden` — and
 * appends two records beside it: a governance event through `@adem/sgi-core`'s `appendEvent`,
 * which is the domain decision, and an audit row through this workspace's `appendAuditEvent`,
 * which is the API write. No statement here reads or writes a measurement or a money record: not an
 * evaluation report, not a case result, not a standard version, and not a ledger entry, a refund or
 * a simulated transaction. Those rows belong to tables other workspaces own, and an operator may
 * take a listing out of view and must never be able to change what a measurement says.
 * `apps/api/test/integration/immutability.test.ts` proves that no route offers the change, and
 * `apps/api/test/integration/trust-separation.test.ts` that no commercial or sponsored value
 * reaches a measurement.
 *
 * **One transaction does all three writes, or none of them.** The status change, the governance
 * event and the audit row are performed inside a single `db.transaction(...)`, so a status can
 * never move without the decision and the write that record it. Both appenders are written to
 * participate in a caller's open transaction: neither opens one and neither commits, so this
 * route's transaction is the unit of atomicity, and a failure in either append rolls the status
 * change back with it.
 *
 * **`flag` records a concern without changing visibility, `hide` removes a listing from search
 * and compare, and `restore` returns a flagged or hidden listing to `active`.** The listing is
 * therefore resolved without any filter on its status — a moderation route that could not address
 * a hidden listing could never return one to visibility — and the hidden state is exactly what
 * `apps/api/src/routes/listings.ts` implements: gone from `GET /listings` and `GET /compare`,
 * still readable with its history by the operator.
 *
 * **The governance event type is the domain package's, and the specific action is carried in the
 * payload.** `appendEvent` refuses any type outside its closed vocabulary, whose member for this
 * append site is `listing_moderated`, so the event states *that a listing was moderated* while the
 * route's payload states *which action was applied* and the audit row names it — `moderation.flagged`,
 * `moderation.hidden` or `moderation.restored`. One event type with the action in the payload is
 * what the trail needs: the reason for a decision and the action it took are both readable from the
 * row, and the vocabulary stays as narrow as `@adem/shared` declares it.
 *
 * **The reason is required, and the schema is what requires it.** `moderationActionBodySchema` puts
 * `reason` in `required` with `minLength: 1`, so an absent or empty reason is the row's `400` before
 * a handler runs; the trim below adds the whitespace-only case, which states no reason either and
 * which the operator's own panel already treats as blank. Nothing here assembles a message out of
 * request text: the reason is stored as written and echoed back by no sentence of this file.
 *
 * The database handle and the resolved configuration arrive by closure (ports and adapters), so this
 * module opens no connection, reads no environment variable, resolves no path and writes no log. A
 * failure is never caught here: the server's single error handler owns `{ error: { code, message } }`.
 */

// The handle's type is imported by name because `@types/better-sqlite3` declares the instance shape
// as a member of the namespace its `export =` also exports, so a default *type* import of that
// package resolves to the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { GovernanceEvent, ListingStatus, ModerationAction } from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  demoAccountHeaderSchema,
  moderationActionBodySchema,
  moderationListingIdParamsSchema,
} from "@adem/shared";

import { appendEvent, canonicalize } from "@adem/sgi-core";
// `@adem/sgi-core` publishes a `GovernanceEvent` of its own — the domain value the appender returns,
// in camelCase — while `@adem/shared` publishes the stored row this file answers with. Both are
// imported, so the returned value is aliased and the two names cannot be confused.
import type { GovernanceEvent as AppendedGovernanceEvent } from "@adem/sgi-core";

import { appendAuditEvent } from "../audit/append-audit-event";
import type { AuditAction } from "../audit/append-audit-event";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import { requireRole } from "../auth/require-role";
import type { ApiConfig } from "../config";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this write needs: the open database handle and the
 * resolved configuration, which arrive by closure from the server factory rather than through
 * Fastify plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the two members structurally instead of importing that type, so that this file
 * and the `apps/api` project compile on their own, before `./register-routes` exists; a
 * `RouteContext` carrying a `Database` and an `ApiConfig` is assignable to this shape, so the
 * registrar's call site is unaffected. The configuration is bound here because this row is a write,
 * and the write rate limit the contract fixes for every write row is read from it rather than
 * restated. `apps/api/src/server.ts` passes both in, so this module opens no connection, reads no
 * environment variable and resolves no path.
 */
interface ModerationRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * The request's path parameters, in the shape `moderationListingIdParamsSchema` validates: the
 * identifier of the listing the action is applied to.
 *
 * Declared so the handler reads `request.params.id` as a string rather than off an untyped
 * parameter. The listing is a listing and never a listing version, a report or a governance event —
 * `id` names the row `GET /listings/{id}` serves.
 */
interface ModerationRouteParams {
  readonly id: string;
}

/**
 * The request's body, in the shape `moderationActionBodySchema` validates: one action of the closed
 * vocabulary and the reason the contract requires with it.
 *
 * The operator's identity is not a body member and must not become one: it is resolved server-side
 * from the `X-Demo-Account` header, so a client-supplied actor is stripped by the schema's
 * `additionalProperties: false` rather than honoured.
 */
interface ModerationRequestBody {
  readonly action: ModerationAction;
  readonly reason: string;
}

/**
 * The status each action leaves the listing in: `flag` records a concern and leaves the listing
 * visible as `flagged`, `hide` takes it out of search and compare as `hidden`, and `restore`
 * returns it to `active`.
 *
 * A total `Record` over {@link ModerationAction} rather than a computation, so the mapping is
 * exhaustive by construction: adding a fourth action to the shared vocabulary fails this file's
 * build until its status is stated, and no route derives a status from the action's spelling.
 */
const STATUS_FOR_ACTION: Readonly<Record<ModerationAction, ListingStatus>> = Object.freeze({
  flag: "flagged",
  hide: "hidden",
  restore: "active",
});

/**
 * The audit action each moderation action records, from the closed vocabulary of
 * `apps/api/src/audit/append-audit-event.ts`, which names these three values for this route.
 *
 * Typed over the same union as {@link STATUS_FOR_ACTION}, so the two mappings stay exhaustive
 * together and a renamed audit action fails the build here rather than at the append.
 */
const AUDIT_ACTION_FOR_ACTION: Readonly<Record<ModerationAction, AuditAction>> = Object.freeze({
  flag: "moderation.flagged",
  hide: "moderation.hidden",
  restore: "moderation.restored",
});

/**
 * The one stored row this file reads: the listing's current status.
 *
 * Read for existence rather than for its value — the caller needs to know whether the identifier
 * names a listing at all, and the action's target status comes from {@link STATUS_FOR_ACTION}. The
 * query deliberately carries no `status` filter: an already hidden listing is still moderatable,
 * which is how `restore` reaches one.
 */
interface ListingStatusRow {
  readonly status: ListingStatus;
}

/**
 * The existence read, by primary key and nothing else.
 *
 * `status` is typed {@link ListingStatus} although the column is `TEXT`, and that is a true
 * statement about what it holds: `packages/shared/migrations/0002_listings_and_versions.sql`
 * declares `CHECK (status IN ('active', 'flagged', 'hidden'))`, and the one writer of that column
 * outside the seed is the `UPDATE` below, which binds a member of that closed vocabulary.
 */
const SELECT_LISTING_STATUS = "SELECT status FROM listings WHERE id = ?";

/**
 * The one `UPDATE` of `apps/api/src`, and the whole of this workspace's mutating surface on a
 * stored row.
 *
 * It sets `listings.status` — the single mutable column this route may write — and `updated_at`
 * beside it, and it addresses exactly one row by primary key: no `WHERE` clause here is ever
 * widened, no other table is named, and no other column of `listings` is written by any part of
 * this product. `updated_at` is bound as an ISO-8601 UTC string written by the application rather
 * than produced by SQLite's `CURRENT_TIMESTAMP`, whose `YYYY-MM-DD HH:MM:SS` form carries no zone.
 */
const UPDATE_LISTING_STATUS = "UPDATE listings SET status = ?, updated_at = ? WHERE id = ?";

/**
 * What {@link applyModeration} returns to the handler: the status the transaction wrote and the
 * governance event the transaction appended, read back from the appender's own return value rather
 * than re-read from the table — the row is append-only, so a second read would prove nothing and
 * cost a query.
 */
interface AppliedModeration {
  /** The listing's status after the action, as the `UPDATE` bound it. */
  readonly status: ListingStatus;
  /** The appended governance event, in the shape `governance_events` stores it. */
  readonly event: GovernanceEvent;
}

/**
 * The body of the `200`: the listing's new status and the record of the decision that produced it.
 *
 * Two keys, because the operator needs both and they answer different questions. `listing.status`
 * is a mutable column and states where the listing stands now; `event` is the append-only row the
 * action appended and names the decision — the reason behind the status, and the reference an
 * operator can cite afterwards, since the status may move again while the event never changes.
 *
 * `apps/web/src/api-client.ts`'s `moderateListing` reads exactly these two members — the status to
 * show and `event.id` for the appender's reference — so the payload's shape is fixed by the one
 * client that consumes it rather than chosen here.
 */
interface ModerationActionResult {
  readonly listing: {
    /** The moderated listing's identifier, as the path named it. */
    readonly id: string;
    /** The listing's status after the action. */
    readonly status: ListingStatus;
  };
  /** The governance event the action appended, as `governance_events` stores it. */
  readonly event: GovernanceEvent;
}

/**
 * Reads the stored status of one listing, or `undefined` when the identifier names no listing.
 *
 * The query carries no filter but its primary key: a listing is resolved whatever state it is in,
 * which is what lets `restore` address a hidden one. The statement is prepared per call because a
 * prepared statement belongs to the connection that made it, and this module owns no connection:
 * the handle is the caller's, as ports and adapters require. SQLite caches the compiled statement
 * itself, so the per-call `prepare` allocates no plan of its own.
 */
function readListingStatus(database: Database, listingId: string): ListingStatus | undefined {
  const row = database.prepare<[string], ListingStatusRow>(SELECT_LISTING_STATUS).get(listingId);

  return row === undefined ? undefined : row.status;
}

/**
 * The appended event as the row `governance_events` stores it: the appender's own values in the
 * table's snake_case spelling, with the payload the appender canonicalised.
 *
 * Every identifying member comes from the value `appendEvent` returned, never from a second
 * statement — the row is append-only, so the appender's answer is the row. The two members it does
 * not carry in stored form are restated here rather than derived: `reason` is the operator's stated
 * reason, which is the `event.reason` the appender was given, and `payload_json` is
 * `canonicalize({ action })`, the same canonical JSON of the same payload the appender stored — the
 * canonicalisation is a pure function of its input, so the text is byte-identical and no row is
 * read back to obtain it.
 *
 * Nothing is invented, defaulted or reformatted: a member the event does not carry is `null`, which
 * is what the column holds.
 */
function toStoredEvent(
  event: AppendedGovernanceEvent,
  reason: string,
  action: ModerationAction,
): GovernanceEvent {
  return {
    id: event.id,
    subject_type: "listing",
    subject_id: event.subjectId,
    event_type: event.eventType,
    actor_account_id: event.actorAccountId,
    reason,
    payload_json: canonicalize({ action }),
    created_at: event.createdAt,
  };
}

/**
 * The whole of one moderation action: the listing's new status, the governance decision and the
 * audit row, as three writes that stand or fall together.
 *
 * **It is meant to be wrapped in a transaction, never called as it stands.** The function performs
 * no `BEGIN` and no `COMMIT` of its own — it is passed to `db.transaction(...)` by
 * {@link registerModerationRoutes}, and that wrapper is what makes the three writes indivisible and
 * what rolls all three back when any of them refuses. Neither appender opens a transaction either,
 * so the wrapper's is the only one and it is the unit of atomicity: a route that failed after the
 * `UPDATE` and before the audit row would otherwise leave a status change with no record of who
 * made it or why.
 *
 * In order:
 *
 * 1. The listing is read by primary key, and an identifier naming none is refused `404`. The read
 *    happens before anything is written, so an unknown listing writes nothing at all.
 * 2. The one `UPDATE` of this workspace sets `listings.status` and `updated_at` on that one row.
 *    The status comes from {@link STATUS_FOR_ACTION} and `updated_at` from the clock, as an
 *    ISO-8601 UTC string, because a row records the instant the application acted.
 * 3. The governance event is appended through `@adem/sgi-core`'s `appendEvent`, with the listing as
 *    its subject, the resolved operator as its actor, the operator's stated reason and the closed
 *    vocabulary's member for this append site — `listing_moderated`. The action taken rides in the
 *    payload, so the trail distinguishes a hide from a restore at one event type.
 * 4. The audit row is appended through this workspace's `appendAuditEvent` — the API-layer record
 *    of the write, whose action names the specific action and whose actor is the same resolved
 *    operator. This module never writes `governance_events` itself, and that module never writes
 *    this one's table: each log has one writer, and one record does not stand in for the other.
 *
 * Nothing else is written: not a version, not a claim, not a report and not a ledger entry, and no
 * measurement any part of this product takes is reachable from here.
 *
 * @param database - The caller's database handle.
 * @param listingId - The listing the action is applied to.
 * @param action - One action of the closed vocabulary, as the request's schema validated it.
 * @param reason - The operator's stated reason, already known to be non-blank.
 * @param actorAccountId - `accounts.id` of the resolved operator.
 * @returns The status that was written and the appended event.
 * @throws {ApiError} With `404 not_found` when no listing carries `listingId`.
 * @throws {UnknownEventTypeError} Never for the call above, whose event type is a member of
 *   `@adem/sgi-core`'s closed vocabulary; a value outside it would be a defect in this file.
 */
function moderateListing(
  database: Database,
  listingId: string,
  action: ModerationAction,
  reason: string,
  actorAccountId: string,
): AppliedModeration {
  const currentStatus = readListingStatus(database, listingId);

  if (currentStatus === undefined) {
    throw ApiError.notFound("No listing carries that identifier.");
  }

  const status: ListingStatus = STATUS_FOR_ACTION[action];
  const updatedAt = new Date().toISOString();

  database.prepare<[ListingStatus, string, string]>(UPDATE_LISTING_STATUS).run(status, updatedAt, listingId);

  const event = appendEvent(database, {
    subjectType: "listing",
    subjectId: listingId,
    // The domain package's closed vocabulary: `appendEvent` refuses any other spelling, so this
    // value is read from `GOVERNANCE_EVENT_TYPES` rather than invented per action.
    eventType: "listing_moderated",
    actorAccountId,
    reason,
    payload: { action },
  });

  appendAuditEvent(database, {
    actorAccountId,
    action: AUDIT_ACTION_FOR_ACTION[action],
    resourceType: "listing",
    resourceId: listingId,
    statusCode: 200,
    reason,
  });

  return { status, event: toStoredEvent(event, reason, action) };
}

/**
 * Registers this group's one route — `POST /moderation/listings/:id/actions` — on the instance it is
 * handed.
 *
 * The path is prefix-relative: the versioned prefix — `API_PREFIX`, from `apps/api/src/server.ts` —
 * is applied exactly once, by `./register-routes`, which calls this function with its encapsulated
 * scope. That literal appears nowhere in this file and must not: a group that spelled it would be
 * the second place the prefix is decided.
 *
 * The options carry three things. The `schema` spread is the request's whole contract — the path
 * parameter, the body and the demo-session header, each from `@adem/shared` so the API and the web
 * client validate against one definition — and it is what makes a missing or empty `reason`, an
 * action outside `MODERATION_ACTIONS` and an absent header failures at the edge, before the handler
 * runs: the server's single error handler answers the header's failure `401 unauthorized` and every
 * other schema rejection `400 validation_error`. The `config.rateLimit` entry is the write rate the
 * contract fixes for every write row, read from the resolved configuration rather than restated, so
 * this route is throttled at the same numbers as every other write and a beyond-limit request is
 * answered `429` with a `Retry-After` header by the registered plugin. Both are numbers only: no
 * secret, no credential and no environment variable is read or carried here.
 *
 * The handler resolves the operator first — `401` when the demo header names no seeded account,
 * `403` when the account it names is not the operator — then refuses a reason that is only
 * whitespace, which states no reason either and which the operator's own panel already treats as
 * blank. Everything else is one call into the transaction built above, and the failure order is the
 * contract's: rate limit, schema validation, `401`, `403`, the transaction, then `200`.
 *
 * A failure is never caught here: the server's single error handler owns `{ error: { code, message }
 * }`, so no handler-local error body exists to disagree with it.
 */
export function registerModerationRoutes(app: FastifyInstance, context: ModerationRouteContext): void {
  // Built once, when the group is registered, and reused per request: better-sqlite3 compiles a
  // transaction wrapper once, and the wrapper is what makes the three writes below indivisible.
  const applyModeration = context.database.transaction(
    (listingId: string, action: ModerationAction, reason: string, actorAccountId: string): AppliedModeration =>
      moderateListing(context.database, listingId, action, reason, actorAccountId),
  );

  app.post<{ Params: ModerationRouteParams; Body: ModerationRequestBody }>(
    "/moderation/listings/:id/actions",
    {
      schema: {
        ...moderationListingIdParamsSchema,
        ...moderationActionBodySchema,
        ...demoAccountHeaderSchema,
      },
      config: { rateLimit: context.config.writeRateLimit },
    },
    (request, reply) => {
      const operator = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "operator",
      );

      const listingId = request.params.id;
      const { action, reason } = request.body;

      if (reason.trim().length === 0) {
        throw ApiError.validation("A moderation action requires a reason that is not blank.");
      }

      const applied = applyModeration(listingId, action, reason, operator.id);

      const result: ModerationActionResult = {
        listing: { id: listingId, status: applied.status },
        event: applied.event,
      };

      return reply.code(200).send(result);
    },
  );
}
