/**
 * The operator-only `GET /audit-events` read: the append-only feed of what the API wrote.
 *
 * It owns one row of the API contract table — `GET /audit-events`, role `operator`, success `200`,
 * error case `403` — and it is the fourth and last of the operator-only exceptions to the API's
 * public reads, the other three being `GET /ledger/marketplace`, `GET /ledger/gate-fees` and
 * `GET /ledger/founder-allocation`. Every public read resolves no identity at all; these four rows
 * resolve the demo account `X-Demo-Account` names and require it to be an operator. An absent or
 * unresolvable header is therefore answered `401` — absent through the header schema attached below,
 * unresolvable through `resolveDemoAccount` — and a resolvable account of any other role, a developer
 * or a buyer or a contributor alike, is answered `403` by `requireRole`.
 *
 * **It reads one table and joins nothing.** The feed is `audit_events`, this workspace's own table,
 * written by `apps/api/src/audit/append-audit-event.ts` as the last step of each write request. It is
 * deliberately not the domain package's governance log: that one records what was *decided* — a
 * proposal review, an appeal ruling, a moderation decision, a standard publication, a retest — it
 * lives in `packages/sgi-core`, and it is appended only through that package's `appendEvent`. A
 * decision is already readable from the route that produced it and from the subject it concerns,
 * while this feed answers the different question of who acted and how the request ended. Reading the
 * two logs together here would merge two records with two owners and two meanings, so no statement in
 * this file names the governance log and none reads it. No other table is read either — not
 * `accounts`, not `listings` — so an event is never enriched with data it does not carry.
 *
 * **It is complete and in insertion order, and that completeness is its whole value.** The one query
 * below reads every row ordered by `created_at` and then by rowid, with no filter, no paging, no
 * aggregation and no second ordering key. The rowid tiebreak is what keeps two rows written in the
 * same millisecond in the order they were inserted, which in a synchronous single-writer process is
 * the ordinary case rather than an edge one, and it is what makes two calls answer byte-identical
 * bodies. A filter or a page size here would invent surface the contract does not have: the row takes
 * no query parameter and lists no error case but `403`.
 *
 * **It writes nothing.** No `INSERT`, `UPDATE` or `DELETE` appears in this file, no transaction is
 * opened, no event is appended for a read, and no `PUT`, `PATCH` or `DELETE` handler is registered.
 * `audit_events` is one of the nine append-only tables
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards with an aborting trigger, and the
 * operator's power over the record is additive: this row reads the feed, and only the write routes it
 * describes ever add to it.
 *
 * **It carries no personal data.** A row holds the synthetic account id whose role authorised the
 * write, the action, the resource, the status and a short stated reason, and nothing else: no request
 * body, no header value, no network address, no user agent. Nothing in the payload is derived,
 * defaulted or reformatted — each field is returned as the column stores it.
 */

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { AuditEvent, AuditResourceType } from "@adem/shared";
import { DEMO_ACCOUNT_HEADER, demoAccountHeaderSchema } from "@adem/shared";

import { resolveDemoAccount } from "../auth/resolve-demo-account";
import { requireRole } from "../auth/require-role";

/**
 * The slice of the folder's single `RouteContext` this read needs: the open database handle, which
 * arrives by closure from the server factory rather than through Fastify plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the member structurally instead of importing that type, so that this file and the
 * `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` is assignable to this shape, so the registrar's call site is unaffected. Only
 * the member this route reads is declared — the config is not bound to a name, an unused binding being
 * padding. `apps/api/src/server.ts` passes the handle in, so this module opens no connection, reads no
 * environment variable and resolves no path.
 */
interface AuditRouteContext {
  readonly database: Database;
}

/**
 * One stored row of `audit_events`, in the shape migration
 * `packages/shared/migrations/0009_sponsored_slots_and_audit_events.sql` declares it: the eight
 * columns, in its order, so the select list below can be compared against the schema by reading one
 * line of each.
 *
 * It is the declared result of the prepared statement, which is what removes the need for a cast when
 * the row is mapped.
 *
 * `action` is a plain `string` because the column is deliberately unconstrained `TEXT`: a row can
 * never be corrected, so a `CHECK` enumerating today's actions could refuse a legitimate later one for
 * good. The vocabulary is closed on the write side, by `AUDIT_ACTIONS` in
 * `apps/api/src/audit/append-audit-event.ts`, which is the only insert path into this table, and the
 * shared row type keeps it open for the same reason. This reader therefore reports the string the
 * writer stored and holds no vocabulary of its own that could disagree with it.
 *
 * `resource_type` is the closed {@link AuditResourceType} although the column is unconstrained
 * `TEXT`, and that is a true statement about what the column holds: `appendAuditEvent` is the single
 * insert path into this table and its `AuditEventInput.resourceType` is that union, so a row naming a
 * resource outside the contract's twelve cannot be written. The list itself is declared once, in
 * `packages/shared/src/types/audit-event.ts`, and taken from there by the writer and by this reader
 * rather than restated here.
 *
 * `reason` is `string | null`, as the column is nullable and the shared row type declares it: a write
 * that states no ground records the absence as SQL `NULL`, and this reader passes that `null` on
 * rather than substituting an empty string for it.
 */
interface AuditEventRow {
  readonly id: string;
  readonly actor_account_id: string;
  readonly action: string;
  readonly resource_type: AuditResourceType;
  readonly resource_id: string;
  readonly status_code: number;
  readonly reason: string | null;
  readonly created_at: string;
}

/**
 * The eight columns this reader selects, named explicitly rather than through `SELECT *`.
 *
 * A row is mapped member by member below, so a column a later migration adds is dropped from the
 * result until this line and the interface above are updated, while `SELECT *` would quietly change
 * the payload of every answer.
 */
const SELECTED_COLUMNS =
  "id, actor_account_id, action, resource_type, resource_id, status_code, reason, created_at";

/**
 * The one query this file runs: every stored event, in insertion order, with no parameter and no
 * filter.
 *
 * `created_at ASC` is the feed's primary order and `rowid ASC` its tiebreak. The tiebreak is not
 * decoration: the writer stamps `new Date().toISOString()`, whose millisecond resolution two writes
 * of one request's worth of work can share, and without it two such rows would come back in an order
 * SQLite is free to choose — making two calls differ and the feed's own claim, that it is the order
 * the writes happened, false. `rowid` is the implicit rowid of an ordinary rowid table, monotonic
 * within this database because the table has no deletion path. Both keys are integers or
 * fixed-format strings, so the order is total and locale-independent, and no collation is applied to
 * it.
 *
 * `created_at` is indexed by `0011_indexes.sql` (`idx_audit_events_created_at`), which is the index
 * this read runs on.
 */
const SELECT_AUDIT_FEED = `SELECT ${SELECTED_COLUMNS} FROM audit_events ORDER BY created_at ASC, rowid ASC`;

/**
 * The body of the `200`: the feed as a labelled collection.
 *
 * The collection is carried under `items`, the key this API's collection reads use — the sponsored
 * slot collection returns the same shape — and the key `listAuditEvents` in
 * `apps/web/src/api-client.ts` reads the feed from. The body carries that one key and nothing else:
 * no total, no page, no cursor and no count, because the contract fixes none of them for this row.
 */
interface AuditFeedResult {
  readonly items: AuditEvent[];
}

/**
 * One stored row as the event the read answers with: each field as the column holds it, mapped member
 * by member so the payload's shape is fixed here rather than at the serializer.
 *
 * Nothing is derived, renamed or reformatted. In particular `action` is copied exactly as the writing
 * route recorded it — this reader neither validates it against a list nor translates it — and
 * `reason` stays `null` where the write stated none.
 */
function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actor_account_id: row.actor_account_id,
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    status_code: row.status_code,
    reason: row.reason,
    created_at: row.created_at,
  };
}

/**
 * Reads the whole feed, in the order {@link SELECT_AUDIT_FEED} fixes.
 *
 * The rows come back whole and unfiltered, and each is returned as the event it is: no paging, no
 * total, no cursor and no field this file invents. An empty table yields `[]` — an ordinary answer
 * rather than a refusal, which is what makes the operator's first look at a fresh database read as
 * "nothing has been written yet" rather than as a failure.
 *
 * The statement is prepared per call because a prepared statement belongs to the connection that made
 * it, and this module owns no connection: the handle is the caller's, as ports and adapters require.
 * SQLite caches the compiled statement itself, so the per-call `prepare` allocates no plan of its own.
 *
 * Nothing is written, counted or amended here: a read of this table changes no row and appends no
 * event of its own.
 */
function listAuditEvents(database: Database): AuditEvent[] {
  return database.prepare<[], AuditEventRow>(SELECT_AUDIT_FEED).all().map(toAuditEvent);
}

/**
 * Registers this group's one route — `GET /audit-events` — on the instance it is handed.
 *
 * The path is prefix-relative: the versioned prefix — `API_PREFIX`, from `apps/api/src/server.ts` —
 * is applied exactly once, by `./register-routes`, which calls this function with its encapsulated
 * scope. That literal appears nowhere in this file and must not: a group that spelled it would be the
 * second place the prefix is decided.
 *
 * The header schema is the whole of the request's contract here — the row takes no body, no path
 * parameter and no query string, so nothing else is attached. It is what makes an absent header a
 * validation failure at the edge, which the server's single error handler answers `401 unauthorized`
 * for this header and `400 validation_error` for every other schema rejection. The role check below
 * then answers `403` for a resolvable account that is not an operator, and the account it returns is
 * deliberately not bound to a name: a read acts on behalf of nobody, records nothing and needs no
 * actor, so only the refusal is wanted from the call. `resolveDemoAccount` precedes it and answers
 * `401` for a header that names no seeded account.
 *
 * The route carries no rate-limit option: the 60-per-minute limit is on writes, and reads are
 * unlimited. A failure is not caught here either — the server's single error handler owns
 * `{ error: { code, message } }`, so no handler-local error body exists to disagree with it.
 */
export function registerAuditRoutes(app: FastifyInstance, context: AuditRouteContext): void {
  app.get(
    "/audit-events",
    { schema: demoAccountHeaderSchema },
    (request, reply) => {
      // Called for its refusal: `401` when the header names no seeded account, `403` when it names
      // one whose role is not the operator's.
      requireRole(
        resolveDemoAccount(
          context.database,
          request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()],
        ),
        "operator",
      );

      const result: AuditFeedResult = { items: listAuditEvents(context.database) };
      return reply.code(200).send(result);
    },
  );
}
