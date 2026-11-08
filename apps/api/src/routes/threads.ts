/**
 * The public discussion board — `GET /threads`, `POST /threads` and `POST /threads/{id}/posts` —
 * and the one row of the API contract table whose error column names no `403`.
 *
 * **The row this file owns.** Reads are public; both writes accept **any resolvable demo account**,
 * whatever its role, and the contract lists `400`, `404` and `401` for them and no `403`. That
 * omission is the contract rather than an oversight: the board is the community contribution
 * surface, so the only role rule is that the `X-Demo-Account` header resolves to one of the seeded
 * accounts. `resolveDemoAccount` alone is therefore called on both writes, and the role check that
 * sits beside it in `../auth` is deliberately neither imported nor called — which is why a
 * wrong-role account answers `201` here and why no handler in this file can produce a `403`. A later
 * reader who "tightens" this into a role check breaks
 * `apps/api/test/integration/route-walk.test.ts`, which asserts `201` for each of the four roles.
 *
 * **The write path is the workspace's one write shape.** Rate limit → JSON-schema validation →
 * `401` for an absent or unresolvable header → the insert together with its audit append inside
 * one transaction → `201` carrying the created row. The rate-limit numbers are read from
 * `ApiConfig.writeRateLimit`, never written out here, so the contract's bound has one definition.
 * The header schema is attached as well as resolved: it is what keeps the requirement executable
 * and self-documenting, and the server's single error handler answers a failed header validation
 * `401` (`toApiError`), the same outcome `resolveDemoAccount` produces for a header that names no
 * seeded account. A malformed body is `400 validation_error` at the edge, before any handler runs.
 *
 * **Append-only respect.** No `UPDATE`, no `DELETE` and no `INSERT OR REPLACE` appears in this
 * file, and no `PUT`, `PATCH` or `DELETE` handler is registered. `thread_posts` is append-only by
 * route design: the only write is an insert, so a correction is a new post rather than an amended
 * one. `threads` is a mutable table that no route in this release modifies either — its title is
 * written once.
 *
 * **Every row is written by this application, in ISO-8601 UTC.** Ids come from `randomUUID()` and
 * `created_at` from `new Date().toISOString()`, never from SQLite's `CURRENT_TIMESTAMP`, whose
 * `YYYY-MM-DD HH:MM:SS` form the contract does not accept. Every value is bound as a parameter.
 *
 * **The board read is deterministic.** Threads are ordered by `created_at` with `id` as the
 * tiebreak and a thread's posts by `created_at` with the implicit `rowid` as the tiebreak, so two
 * calls answer byte-identical bodies including item order, and no clock, locale or collation can
 * reorder the board. A thread's posts travel with the thread: the contract names no per-thread
 * read, and the threads page renders a thread's replies from this one response.
 *
 * **An empty board is an answer, not an error.** `200` with an empty collection, never a `404`, so
 * a fresh database reads as "no discussion has started yet" — which is the state
 * `apps/web/src/pages/threads.tsx` renders with the action that leaves it.
 *
 * **Nothing is delegated and nothing is computed.** `apps/api` owns the `threads` and `thread_posts`
 * tables, so this file holds its own SQL; it imports no domain package — neither `@adem/sgi-core`
 * nor `@adem/commerce-sim` — and contains no scoring, ledger or policy arithmetic. It reads no
 * environment variable, opens no connection (`context.database` is the caller's handle, as ports
 * and adapters require), reads no clock beyond the two insert timestamps, and writes no error body
 * of its own: a failure is thrown as an `ApiError` and rendered by the server's single handler as
 * `{ error: { code, message } }`.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { Thread, ThreadCreateBody, ThreadPost, ThreadPostBody } from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  demoAccountHeaderSchema,
  threadCreateBodySchema,
  threadIdParamsSchema,
  threadPostBodySchema,
} from "@adem/shared";

import { appendAuditEvent } from "../audit/append-audit-event";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import type { ApiConfig } from "../config";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this group needs: the open database handle and the
 * resolved configuration the write rate limit comes from. Both arrive by closure from the server
 * factory rather than through Fastify plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the members structurally instead of importing that type, so that this file and
 * the `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` and an `ApiConfig` is assignable to this shape, so the registrar's call site
 * is unaffected. `apps/api/src/server.ts` passes both in, so this module opens no connection, reads
 * no environment variable and resolves no path.
 */
interface ThreadsRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * One stored row of `threads`, in the shape migration
 * `packages/shared/migrations/0004_challenges_and_threads.sql` declares it: the four columns, in its
 * order, so the select list below can be compared against the schema by reading one line of each.
 *
 * It is the declared result of the prepared statement, which is what removes the need for a cast
 * when the row is mapped.
 */
interface BoardThreadRow {
  readonly id: string;
  readonly title: string;
  readonly author_account_id: string;
  readonly created_at: string;
}

/**
 * One stored row of `thread_posts`, in the shape that migration declares it: the five columns, in
 * its order.
 *
 * `thread_id` is selected although the board read groups by it after the query rather than filtering
 * on it: the column is what the grouping reads, so leaving it out would force a per-thread query.
 */
interface ThreadPostRow {
  readonly id: string;
  readonly thread_id: string;
  readonly author_account_id: string;
  readonly body: string;
  readonly created_at: string;
}

/**
 * The one column {@link SELECT_THREAD_BY_ID} reads: whether a thread a reply names exists.
 *
 * A reply carries the thread's identifier from its path, so the row's other columns are not wanted
 * here — the reply's own row carries what it needs, and reading a title or an author would be a
 * value this route has no use for.
 */
interface ThreadReferenceRow {
  readonly id: string;
}

/**
 * One row of the board as the read answers with: the thread exactly as `threads` holds it, plus the
 * posts it has collected in the order they were written.
 *
 * The shape mirrors the `ThreadListItem` `apps/web/src/api-client.ts` reads, and the posts are nested
 * in the row rather than sent beside the rows: the board is a collection of threads, each of which
 * owns its replies. A thread nobody has answered carries the empty list, so the page renders "no
 * replies yet" rather than an absent key.
 */
interface ThreadBoardItem extends Thread {
  readonly posts: readonly ThreadPost[];
}

/**
 * The body of the board read's `200`: the threads under `items`, the key this API's collection reads
 * use and the one `listThreads` in `apps/web/src/api-client.ts` reads first.
 *
 * The body carries that one key and nothing else: the contract fixes no total, no page and no cursor
 * for this row, and the board is not paginated.
 */
interface ThreadBoardResult {
  readonly items: ThreadBoardItem[];
}

/**
 * The four columns the board read selects from `threads`, named explicitly rather than through
 * `SELECT *`. A row is mapped member by member below, so a column a later migration adds stays out of
 * the payload until this line and {@link BoardThreadRow} are updated together.
 */
const SELECTED_THREAD_COLUMNS = "id, title, author_account_id, created_at";

/**
 * The five columns the board read selects from `thread_posts`, for the same reason as
 * {@link SELECTED_THREAD_COLUMNS}.
 */
const SELECTED_POST_COLUMNS = "id, thread_id, author_account_id, body, created_at";

/**
 * The board's threads, in the one total order the read promises: `created_at ASC` with `id ASC` as
 * the tiebreak.
 *
 * The tiebreak is not decoration. The writer stamps `new Date().toISOString()`, whose millisecond
 * resolution two threads started in one request's worth of work can share, and without a second key
 * SQLite would be free to return such rows in either order — making two calls differ and the read's
 * own claim false. `id` is the primary key, so the order is total and locale-independent (the
 * default `BINARY` collation compares these strings by code point).
 */
const SELECT_BOARD = `SELECT ${SELECTED_THREAD_COLUMNS} FROM threads ORDER BY created_at ASC, id ASC`;

/**
 * Every reply on the board, in insertion order, in the single query the read makes for posts.
 *
 * One query rather than one per thread: better-sqlite3 is synchronous and runs on the calling
 * thread, so a loop of queries would hold the process for as many round trips as the board has
 * threads. The `rowid` tiebreak keeps two posts written in the same millisecond in the order they
 * were written — the ordinary case in a synchronous single-writer process — which is what makes two
 * calls answer byte-identical bodies.
 *
 * No filter narrows this statement, deliberately. The board read carries no paging and no filter of
 * its own, so it returns every thread and the payload carries every thread's posts: the reply rows
 * read here are exactly the rows the response serves. A `thread_id IN (...)` filter would add a bind
 * count that grows with the board and buys nothing, since nothing read is discarded.
 */
const SELECT_ALL_POSTS = `SELECT ${SELECTED_POST_COLUMNS} FROM thread_posts ORDER BY created_at ASC, rowid ASC`;

/**
 * Whether the thread a reply names exists. The lookup is exact equality on the primary key and reads
 * one column: a reply's thread comes from the path, and the route answers `404` when nothing carries
 * that identifier.
 */
const SELECT_THREAD_BY_ID = "SELECT id FROM threads WHERE id = ?";

/**
 * The one insert into `threads`. Every value is bound; no column is left to a default, because the
 * table declares none and the two generated values are this application's.
 */
const INSERT_THREAD = `INSERT INTO threads (id, title, author_account_id, created_at) VALUES (?, ?, ?, ?)`;

/**
 * The one insert into `thread_posts`, and the only write this table ever receives: a post is a new
 * row, and no statement here amends or removes one.
 */
const INSERT_POST = `INSERT INTO thread_posts (id, thread_id, author_account_id, body, created_at) VALUES (?, ?, ?, ?, ?)`;

/**
 * One stored thread as the board answers with: each field as the column holds it, mapped member by
 * member so the payload's shape is fixed here rather than at the serializer.
 *
 * Nothing is derived, renamed or reformatted — not the author, which is the synthetic account id the
 * write recorded, and not the timestamp, which is the ISO-8601 UTC string the application wrote.
 */
function toBoardThread(row: BoardThreadRow, posts: readonly ThreadPost[]): ThreadBoardItem {
  return {
    id: row.id,
    title: row.title,
    author_account_id: row.author_account_id,
    created_at: row.created_at,
    posts,
  };
}

/**
 * One stored post as the board answers with. As in {@link toBoardThread}, every field is returned as
 * the column holds it.
 */
function toThreadPost(row: ThreadPostRow): ThreadPost {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author_account_id: row.author_account_id,
    body: row.body,
    created_at: row.created_at,
  };
}

/**
 * The board's posts grouped by the thread each belongs to, preserving the order
 * {@link SELECT_ALL_POSTS} fixed: a thread's list therefore holds its replies oldest first, and a
 * thread no post names simply has no entry — the caller renders that as the empty list.
 *
 * The grouping is done here because SQLite's JSON support is not used anywhere in this product and a
 * second query per thread is what the single post query exists to avoid.
 */
function groupPostsByThread(rows: readonly ThreadPostRow[]): Map<string, ThreadPost[]> {
  const grouped = new Map<string, ThreadPost[]>();

  for (const row of rows) {
    const post = toThreadPost(row);
    const collected = grouped.get(post.thread_id);

    if (collected === undefined) {
      grouped.set(post.thread_id, [post]);
    } else {
      collected.push(post);
    }
  }

  return grouped;
}

/**
 * Reads the whole board: every thread in the order {@link SELECT_BOARD} fixes, each carrying its
 * replies in the order {@link SELECT_ALL_POSTS} fixes.
 *
 * An empty board short-circuits before the post query, so a database with no thread reads exactly one
 * table and the answer is `[]` — an ordinary result rather than a refusal, which is what makes the
 * contract row's empty state a `200`.
 *
 * Nothing is written, counted or amended here: the two statements are reads, and a read of either
 * table changes no row and appends no audit event.
 */
function listBoard(database: Database): ThreadBoardItem[] {
  const threads = database.prepare<[], BoardThreadRow>(SELECT_BOARD).all();

  if (threads.length === 0) {
    return [];
  }

  const postsByThread = groupPostsByThread(database.prepare<[], ThreadPostRow>(SELECT_ALL_POSTS).all());

  return threads.map((row: BoardThreadRow): ThreadBoardItem =>
    toBoardThread(row, postsByThread.get(row.id) ?? []),
  );
}

/**
 * Inserts one thread and its audit event, and answers the created row.
 *
 * The id and the timestamp are generated here, before the transaction opens, because they are part of
 * the value the route returns as well as of the row it writes: a caller that had to read them back
 * would be reading its own write to learn what it just created.
 *
 * The insert and the append are one transaction, which is what makes a write and the record of it
 * indivisible: a failure after the insert leaves neither the thread nor its audit row behind, so the
 * operator feed never claims a write that did not happen. `appendAuditEvent` opens no transaction of
 * its own and is called inside this one for exactly that reason.
 *
 * @param database The caller's database handle.
 * @param title The thread's title, validated against `threadCreateBodySchema` before this call.
 * @param authorAccountId `accounts.id` of the resolved demo account — any role.
 * @returns The inserted row, in the shape the `201` carries and `threads` stores.
 */
function insertThread(database: Database, title: string, authorAccountId: string): Thread {
  const thread: Thread = {
    id: randomUUID(),
    title,
    author_account_id: authorAccountId,
    created_at: new Date().toISOString(),
  };

  return database.transaction((): Thread => {
    database
      .prepare(INSERT_THREAD)
      .run(thread.id, thread.title, thread.author_account_id, thread.created_at);

    appendAuditEvent(database, {
      actorAccountId: authorAccountId,
      action: "thread.created",
      resourceType: "thread",
      resourceId: thread.id,
      statusCode: 201,
    });

    return thread;
  })();
}

/**
 * Inserts one reply and its audit event, and answers the created row — or refuses the whole write
 * when the thread the reply names does not exist.
 *
 * The existence check sits inside the transaction rather than before it, so the `404` and the insert
 * cannot be separated by another writer: the check, the insert and the append either all happen or
 * none does. A missing thread raises {@link ApiError.notFound}, and the open transaction rolls back —
 * which is what keeps a reply from ever being written against a thread that is not there.
 *
 * The thread comes from the path and never from the body, so a reply cannot name a thread other than
 * the one its address names.
 *
 * @param database The caller's database handle.
 * @param threadId The thread identifier from the request path.
 * @param body The reply's text, validated against `threadPostBodySchema` before this call.
 * @param authorAccountId `accounts.id` of the resolved demo account — any role.
 * @returns The inserted row, in the shape the `201` carries.
 * @throws {ApiError} `404 not_found` when no thread carries `threadId`.
 */
function insertPost(
  database: Database,
  threadId: string,
  body: string,
  authorAccountId: string,
): ThreadPost {
  const post: ThreadPost = {
    id: randomUUID(),
    thread_id: threadId,
    author_account_id: authorAccountId,
    body,
    created_at: new Date().toISOString(),
  };

  return database.transaction((): ThreadPost => {
    const existingThread = database
      .prepare<[string], ThreadReferenceRow>(SELECT_THREAD_BY_ID)
      .get(threadId);

    if (existingThread === undefined) {
      throw ApiError.notFound("The thread this reply names does not exist.");
    }

    database
      .prepare(INSERT_POST)
      .run(post.id, post.thread_id, post.author_account_id, post.body, post.created_at);

    appendAuditEvent(database, {
      actorAccountId: authorAccountId,
      action: "thread.post_created",
      resourceType: "thread_post",
      resourceId: post.id,
      statusCode: 201,
    });

    return post;
  })();
}

/**
 * Registers this group's three routes — `GET /threads`, `POST /threads` and
 * `POST /threads/{id}/posts` — on the instance it is handed, in the contract table's order.
 *
 * The three paths are prefix-relative: the versioned prefix — `API_PREFIX`, from
 * `apps/api/src/server.ts` — is applied exactly once, by `./register-routes`, which calls this
 * function with its encapsulated scope. That literal appears nowhere in this file and must not: a
 * group that spelled it would be the second place the prefix is decided.
 *
 * **No `403` is reachable from here.** Both writes resolve the demo account and stop there — the
 * workspace's role check is neither called nor imported — because this row accepts any account that
 * resolves, whatever its role. The refusals this file can produce are therefore `401 unauthorized`
 * (the header schema at the edge, and `resolveDemoAccount` for a header that names no seeded
 * account), `400 validation_error` (the two body schemas and the parameter schema at the edge) and
 * `404 not_found` (the reply write, when the thread its path names does not exist). Tightening the
 * two writes into a role check would answer `403` where the contract answers `201`.
 *
 * The board read carries no route options at all: the row takes no parameter and has no error case to
 * validate, reads are unlimited (the 60-per-minute limit is on writes), and a public read that can
 * fail its documented contract would be the defect. Both writes carry the same two options — the
 * header and shape schema, and the resolved rate limit — read from `ApiConfig.writeRateLimit`, so the
 * contract's bound is written once for the whole workspace. Neither handler catches anything: the
 * server's single error handler owns `{ error: { code, message } }`, so no handler-local error body
 * exists to disagree with it.
 */
export function registerThreadRoutes(app: FastifyInstance, context: ThreadsRouteContext): void {
  // Resolved once, from the configuration, and shared by both writes: the numbers come from
  // `@adem/shared` through `ApiConfig`, and a literal here would be the second definition of a bound
  // the contract fixes in one place.
  const writeRateLimit = {
    max: context.config.writeRateLimit.max,
    timeWindow: context.config.writeRateLimit.timeWindow,
  };

  app.get("/threads", (_request, reply) => {
    const result: ThreadBoardResult = { items: listBoard(context.database) };
    return reply.code(200).send(result);
  });

  app.post<{ Body: ThreadCreateBody }>(
    "/threads",
    {
      schema: { ...demoAccountHeaderSchema, ...threadCreateBodySchema },
      config: { rateLimit: writeRateLimit },
    },
    (request, reply) => {
      // The header is read by its lowercased name, which is how Fastify exposes request header names;
      // the mixed-case key yields `undefined` and is answered `401` as an absent header. No role is
      // required beyond the account resolving — see this function's own note on the missing `403`.
      const account = resolveDemoAccount(
        context.database,
        request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()],
      );

      const thread = insertThread(context.database, request.body.title, account.id);

      return reply.code(201).send(thread);
    },
  );

  app.post<{ Body: ThreadPostBody; Params: { id: string } }>(
    "/threads/:id/posts",
    {
      schema: { ...demoAccountHeaderSchema, ...threadIdParamsSchema, ...threadPostBodySchema },
      config: { rateLimit: writeRateLimit },
    },
    (request, reply) => {
      // Resolved for its actor and for its refusal, never for a role: a reply is open to any demo
      // account, exactly as starting a thread is. The thread comes from the path, so a body cannot
      // name another one; an unknown identifier is answered `404` inside the write's transaction.
      const account = resolveDemoAccount(
        context.database,
        request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()],
      );

      const post = insertPost(
        context.database,
        request.params.id,
        request.body.body,
        account.id,
      );

      return reply.code(201).send(post);
    },
  );
}
