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
 * **It is bounded, in insertion order within a page, and it states the record's size.** The one query
 * below reads one page of the feed and the count beside it states how many events the feed holds in all.
 * `audit_events` grows with every write in the product, so a read that answered the whole table would
 * grow with it without bound, and this row answers the operator with a page instead: page 1 carries the
 * most recent page of the feed — the writes an operator opens the surface to see — each later page
 * reaches one page further back, and a page carries at most `COLLECTION_PAGE_SIZE` events. The page's own
 * rows keep the feed's insertion order: `created_at` ascending with the implicit `rowid` as the tiebreak,
 * which is what keeps two rows written in the same millisecond in the order they were inserted — in a
 * synchronous single-writer process the ordinary case rather than an edge one — and what makes two calls
 * for the same page answer byte-identical bodies. `total` is how many events the feed holds in all, which
 * is what tells a reader holding a page of at most twenty whether it is seeing the record or a part of it
 * and what leads it to the page before it; without it a short feed and a clipped page would look alike.
 * The page number is the only request input the row takes, declared in `@adem/shared` and shared by every
 * bounded collection read in the product, so the fixed page size cannot be raised from a request and no
 * filter is invented beside it.
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

import type { AuditEvent, AuditResourceType, CollectionPageQuery } from "@adem/shared";
import {
  COLLECTION_PAGE_SIZE,
  DEMO_ACCOUNT_HEADER,
  collectionPageQuerySchema,
  demoAccountHeaderSchema,
} from "@adem/shared";

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
 * The page of the feed one request reads: the `COLLECTION_PAGE_SIZE` events ending at the offset the
 * requested page resolves to, taken from the newest end of the feed.
 *
 * `created_at DESC, rowid DESC` is the feed's own order read backwards, which is what makes page 1 the
 * most recent page of the feed and each later page reach further back; the caller reverses the rows a
 * page read so that one page is answered in the ascending order the feed documents. Both bound values
 * are bound parameters placed after this text, so no number a client sent reaches the statement.
 *
 * `created_at` is indexed by `0011_indexes.sql` (`idx_audit_events_created_at`), which is the index this
 * read walks backwards.
 */
const SELECT_AUDIT_FEED = `SELECT ${SELECTED_COLUMNS} FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`;

/**
 * The one statement that counts the feed: how many events `audit_events` holds, with no filter.
 *
 * It is what makes the bounded page usable rather than merely smaller: a reader that wants the rest of
 * the record asks for the next page, and a reader that wants to know how much feed there is reads this
 * number rather than a second page. It counts the table the page is read from, so `total` and `items`
 * cannot disagree about which feed they describe, and `COUNT(*)` with no grouping answers exactly one
 * row on every call — including an empty table, which holds `0` rather than nothing.
 */
const SELECT_AUDIT_TOTAL = "SELECT COUNT(*) AS total FROM audit_events";

/**
 * The one-column shape {@link countAuditEvents} reads back: the `total` alias its `COUNT(*)` is selected
 * under.
 */
interface AuditEventCountRow {
  /** How many events the feed holds. */
  readonly total: number;
}

/**
 * The body of the `200`: one page of the feed as a labelled collection, the page answered, and the number
 * of events the whole feed holds.
 *
 * The collection is carried under `items`, the key this API's collection reads use — the sponsored slot
 * collection returns the same shape — and the key `listAuditEvents` in `apps/web/src/api-client.ts` reads
 * the feed from. `items` carries at most `COLLECTION_PAGE_SIZE` events, and `total` and `page` are what
 * tell a reader which page of the record it is holding and how much record there is: without them a short
 * feed and a clipped page would be indistinguishable. No cursor and no second collection are added,
 * because the contract fixes none of them for this row.
 */
interface AuditFeedResult {
  readonly items: AuditEvent[];
  /** How many events the whole feed holds, so a client can tell the page from the record. */
  readonly total: number;
  /** The 1-based page of the feed this body answers, echoed from the request's `page`. */
  readonly page: number;
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
 * Reads one page of the feed, in the order {@link SELECT_AUDIT_FEED} fixes.
 *
 * The rows come back windowed and unfiltered: the page's own events are read from the newest end of the
 * feed and reversed into the ascending insertion order the feed documents, and no event is added,
 * dropped or rewritten on the way out. An empty page — an empty table, or a page past the last one —
 * yields `[]`, an ordinary answer rather than a refusal, which is what makes the operator's first look
 * at a fresh database read as "nothing has been written yet" rather than as a failure.
 *
 * The statement is prepared per call because a prepared statement belongs to the connection that made
 * it, and this module owns no connection: the handle is the caller's, as ports and adapters require.
 * SQLite caches the compiled statement itself, so the per-call `prepare` allocates no plan of its own.
 *
 * The offset is the only arithmetic in this file and it is paging rather than a domain value: the fixed
 * page size times the zero-based page number, computed by the caller that resolved the page. Nothing is
 * written, counted or amended here: a read of this table changes no row and appends no event of its own.
 */
function listAuditEvents(database: Database, offset: number): AuditEvent[] {
  const rows = database
    .prepare<[number, number], AuditEventRow>(SELECT_AUDIT_FEED)
    .all(COLLECTION_PAGE_SIZE, offset);

  return rows.reverse().map(toAuditEvent);
}

/**
 * Counts every event the feed holds.
 *
 * The number is the one a page cannot answer by itself: {@link listAuditEvents} returns at most
 * `COLLECTION_PAGE_SIZE` events, so a caller holding a page of twenty cannot tell whether the feed holds
 * twenty or twenty thousand without it. `COUNT(*)` over the whole table answers exactly one row on every
 * call, including the empty table, which holds `0` rather than nothing.
 */
function countAuditEvents(database: Database): number {
  const row = database.prepare<[], AuditEventCountRow>(SELECT_AUDIT_TOTAL).get();

  return row?.total ?? 0;
}

/**
 * Registers this group's one route — `GET /audit-events` — on the instance it is handed.
 *
 * The path is prefix-relative: the versioned prefix — `API_PREFIX`, declared once in the sibling
 * `./register-routes` — is applied exactly once, by `./register-routes`, which calls this function with
 * its encapsulated scope. That literal appears nowhere in this file and must not: a group that spelled
 * it would be the second place the prefix is decided.
 *
 * The header schema and the shared collection-page query schema are the whole of the request's contract
 * here: the row takes no body and no path parameter, so the two together are the request shape to
 * validate. The header half is what makes an absent header a validation failure at the edge, which the
 * server's single error handler answers `401 unauthorized` for this header and `400 validation_error` for
 * every other schema rejection — the page query's own `?page=0`, `?page=-1` and `?page=abc` among them.
 * The role check below then answers `403` for a resolvable account that is not an operator, and the
 * account it returns is deliberately not bound to a name: a read acts on behalf of nobody, records
 * nothing and needs no actor, so only the refusal is wanted from the call. `resolveDemoAccount` precedes
 * it and answers `401` for a header that names no seeded account.
 *
 * The page query schema declares `additionalProperties: false`, which is what makes an unexpected query
 * key harmless rather than a refusal: Fastify's validator removes it before this handler runs, so
 * `?limit=100` neither widens the page nor answers a `400` and the fixed page size below cannot be raised
 * from a request. `page` arrives already resolved to a number by that schema's default, so this handler
 * neither re-reads the query string nor defaults the page itself.
 *
 * The route carries no rate-limit option: the 60-per-minute limit is on writes, and reads are
 * unlimited. A failure is not caught here either — the server's single error handler owns
 * `{ error: { code, message } }`, so no handler-local error body exists to disagree with it.
 */
export function registerAuditRoutes(app: FastifyInstance, context: AuditRouteContext): void {
  app.get<{ readonly Querystring: CollectionPageQuery }>(
    "/audit-events",
    { schema: { ...demoAccountHeaderSchema, ...collectionPageQuerySchema } },
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

      // The page's offset, in the one form the feed's read takes it: as many of the newest events as the
      // pages before this one held. It is paging rather than a domain value, and the page size is the
      // shared constant rather than a number read from the query.
      const offset = COLLECTION_PAGE_SIZE * (request.query.page - 1);

      const result: AuditFeedResult = {
        items: listAuditEvents(context.database, offset),
        total: countAuditEvents(context.database),
        page: request.query.page,
      };

      return reply.code(200).send(result);
    },
  );
}
