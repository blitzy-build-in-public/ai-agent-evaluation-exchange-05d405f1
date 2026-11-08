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
 * **The board read is bounded, and deterministic within the page.** It answers one page of
 * `COLLECTION_PAGE_SIZE` threads — page 1 is the newest page of the board, `?page=2` the page before
 * it — ordered by `created_at` with `id` as the tiebreak, and each page's own threads carry their
 * replies ordered by `created_at` with the implicit `rowid` as the tiebreak, so two calls answer
 * byte-identical bodies including item order, and no clock, locale or collation can reorder the
 * board. The page's rows are read from the newest end and reversed, which is what makes one page
 * read oldest first rather than upside down. The payload therefore no longer grows with the number
 * of threads on the board or with the reply volume written across it: it carries the page's threads
 * and the replies belonging to them. A thread's replies still travel with the thread — the contract
 * names no per-thread read, and the threads page renders a thread's replies from this one response —
 * so the one collection the response still follows in size is a single thread's own reply list,
 * which is that thread's own content rather than a slice of the board.
 *
 * **An empty page is an answer, not an error.** `200` with an empty collection, never a `404`, so a
 * fresh database reads as "no discussion has started yet" and a page past the board's last reads as
 * the board's own total with nothing on it — which is the state
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

import type {
  CollectionPageQuery,
  Thread,
  ThreadCreateBody,
  ThreadPost,
  ThreadPostBody,
} from "@adem/shared";
import {
  COLLECTION_PAGE_SIZE,
  DEMO_ACCOUNT_HEADER,
  collectionPageQuerySchema,
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
 * The one column the board read's count answers: how many threads the whole board holds, whatever
 * page of it is being read.
 *
 * It is the declared result of the prepared statement, which is what removes the need for a cast
 * when the count is read — the same reason {@link BoardThreadRow} is declared.
 */
interface BoardThreadTotalRow {
  readonly total: number;
}

/**
 * One stored row of `thread_posts`, in the shape that migration declares it: the five columns, in
 * its order.
 *
 * `thread_id` is selected because the grouping reads it after the query: the statement is already
 * narrowed to the page's own threads, and this is the column that says which of them each reply
 * belongs to, so without it the rows could not be placed at all. Reading the replies per thread
 * instead is what the single statement exists to avoid.
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
 * The body of the board read's `200`: one page of the board under `items`, with the page it answered
 * and the number of threads the whole board holds.
 *
 * `items` is the key this API's collection reads use and the one `listThreads` in
 * `apps/web/src/api-client.ts` reads first. The page is bounded at `COLLECTION_PAGE_SIZE` threads —
 * page 1 carrying the newest page of the board — so the payload grows neither with the number of
 * threads the board holds nor with the replies written across it; each item still carries its own
 * replies, because the contract names no per-thread read. `total` counts the whole board rather than
 * the page, so a client can tell the page it holds from the board it came from, and `page` echoes
 * the resolved query parameter: a page past the last answers `items: []` beside the board's own
 * `total`, which is an ordinary answer rather than a refusal.
 */
interface ThreadBoardResult {
  readonly items: ThreadBoardItem[];
  readonly total: number;
  readonly page: number;
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
 * One page of the board's threads, read from the newest end: `created_at DESC` with `id DESC` as the
 * tiebreak, `LIMIT ? OFFSET ?`.
 *
 * The window is taken over the newest end because page 1 has to be the most recent page of the board,
 * and the caller reverses the page's rows so that the page itself reads in the one total order the
 * read promises: `created_at ASC` with `id ASC`.
 *
 * The tiebreak is not decoration. The writer stamps `new Date().toISOString()`, whose millisecond
 * resolution two threads started in one request's worth of work can share, and without a second key
 * SQLite would be free to return such rows in either order — making two calls differ and the read's
 * own claim false. `id` is the primary key, so the order is total and locale-independent (the
 * default `BINARY` collation compares these strings by code point).
 *
 * Both numbers are bound: the fixed page size and the requested page's offset. The statement text is
 * therefore the same for every page and carries no placeholder count that grows with the board.
 */
const SELECT_BOARD = `SELECT ${SELECTED_THREAD_COLUMNS} FROM threads ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;

/**
 * How many threads the whole board holds, in the one count the read states as `total`.
 *
 * It is a count over `threads` alone and answers exactly one row, so it costs one statement per read
 * whatever page is asked for. It is what lets a client tell the page it holds from the board it came
 * from, which is the reason the response carries a `total` at all.
 */
const SELECT_BOARD_TOTAL = "SELECT COUNT(*) AS total FROM threads";

/**
 * The replies belonging to the page's own threads, in insertion order, in the single query the read
 * makes for posts.
 *
 * One query rather than one per thread: better-sqlite3 is synchronous and runs on the calling
 * thread, so a loop of queries would hold the process for as many round trips as the page has
 * threads. The `rowid` tiebreak keeps two posts written in the same millisecond in the order they
 * were written — the ordinary case in a synchronous single-writer process — which is what makes two
 * calls answer byte-identical bodies.
 *
 * The filter is the same window {@link SELECT_BOARD} reads, spelled as a subquery over `threads`
 * rather than as a `thread_id IN (...)` list composed in the handler: the statement carries exactly
 * two bound numbers and no placeholder that grows with the board, and the rows it reads are exactly
 * the rows the response serves — the replies of the page's own threads, and no other thread's. A
 * thread on the page that nobody has answered contributes no row here, which the caller renders as
 * the empty list.
 */
const SELECT_ALL_POSTS = `SELECT ${SELECTED_POST_COLUMNS} FROM thread_posts WHERE thread_id IN (SELECT id FROM threads ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?) ORDER BY created_at ASC, rowid ASC`;

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
 * Reads one page of the board: the page's threads in the order {@link SELECT_BOARD} fixes, each
 * carrying its replies in the order {@link SELECT_ALL_POSTS} fixes, beside the count
 * {@link SELECT_BOARD_TOTAL} states.
 *
 * The offset is the fixed page size times the zero-based page number, and it is the only arithmetic
 * in this file: it is paging rather than a domain value, and no amount, outcome or label is computed
 * here. The window is read newest first, because that is what makes `LIMIT` take the newest page, and
 * the page's rows are reversed in memory so the page itself reads oldest first — the order the board
 * documents and the order the payload carries.
 *
 * An empty page short-circuits before the post query, and that branch still saves a statement: the
 * count and the page read answer `items: []` with the requested page and the board's own total, and
 * the reply table is never read. It is also what makes an empty answer an ordinary result rather than
 * a refusal — neither a board with no thread at all nor a page past its last throws — which is what
 * the contract row's `200` empty state requires.
 *
 * Nothing is written or amended here: all three statements are reads, and a read of either table
 * changes no row and appends no audit event. The `total` is a count read from `threads`, never a
 * stored balance that a write maintains.
 *
 * @param database - The caller's database handle.
 * @param page - The requested page, 1-based, already resolved from the query schema's default.
 * @returns The page's threads with their replies, and the page and total the response states.
 */
function listBoard(database: Database, page: number): ThreadBoardResult {
  const totalRow = database.prepare<[], BoardThreadTotalRow>(SELECT_BOARD_TOTAL).get();
  const total = totalRow === undefined ? 0 : totalRow.total;

  const offset = COLLECTION_PAGE_SIZE * (page - 1);

  const rows = database
    .prepare<[number, number], BoardThreadRow>(SELECT_BOARD)
    .all(COLLECTION_PAGE_SIZE, offset);

  // Read newest first and reversed here: `LIMIT` has to take the newest page, and the page it takes
  // has to read in the board's documented order rather than upside down.
  const threads = rows.reverse();

  if (threads.length === 0) {
    return { items: [], total, page };
  }

  const postsByThread = groupPostsByThread(
    database.prepare<[number, number], ThreadPostRow>(SELECT_ALL_POSTS).all(COLLECTION_PAGE_SIZE, offset),
  );

  return {
    items: threads.map((row: BoardThreadRow): ThreadBoardItem =>
      toBoardThread(row, postsByThread.get(row.id) ?? []),
    ),
    total,
    page,
  };
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
 * @param database - The caller's database handle.
 * @param title - The thread's title, validated against `threadCreateBodySchema` before this call.
 * @param authorAccountId - `accounts.id` of the resolved demo account — any role.
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
 * @param database - The caller's database handle.
 * @param threadId - The thread identifier from the request path.
 * @param body - The reply's text, validated against `threadPostBodySchema` before this call.
 * @param authorAccountId - `accounts.id` of the resolved demo account — any role.
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
 * The three paths are prefix-relative: the versioned prefix — `API_PREFIX`, declared once in the
 * sibling `./register-routes` — is applied exactly once, by `./register-routes`, which calls this
 * function with its encapsulated scope. That literal appears nowhere in this file and must not: a group
 * that spelled it would be the second place the prefix is decided.
 *
 * **No `403` is reachable from here.** Both writes resolve the demo account and stop there — the
 * workspace's role check is neither called nor imported — because this row accepts any account that
 * resolves, whatever its role. The refusals this file can produce are therefore `401 unauthorized`
 * (the header schema at the edge, and `resolveDemoAccount` for a header that names no seeded
 * account), `400 validation_error` (the two body schemas, the parameter schema and the board's query
 * schema, all at the edge) and `404 not_found` (the reply write, when the thread its path names does
 * not exist). Tightening the two writes into a role check would answer `403` where the contract
 * answers `201`.
 *
 * The board read carries the query schema and no identity: the page is the only thing that read takes
 * from the request, and the schema is what bounds it, so `?page=0`, `?page=-1` and `?page=abc` are a
 * `400 validation_error` at the edge rather than an unvalidated number reaching the handler, while an
 * absent parameter is the schema's own default of 1. The route declares no header, so it stays the
 * public read the contract lists, and reads are unlimited (the 60-per-minute limit is on writes).
 * Both writes carry the same two options — the header and shape schema, and the resolved rate limit —
 * read from `ApiConfig.writeRateLimit`, so the contract's bound is written once for the whole
 * workspace. Neither handler catches anything: the server's single error handler owns
 * `{ error: { code, message } }`, so no handler-local error body exists to disagree with it.
 */
export function registerThreadRoutes(app: FastifyInstance, context: ThreadsRouteContext): void {
  // Resolved once, from the configuration, and shared by both writes: the numbers come from
  // `@adem/shared` through `ApiConfig`, and a literal here would be the second definition of a bound
  // the contract fixes in one place.
  const writeRateLimit = {
    max: context.config.writeRateLimit.max,
    timeWindow: context.config.writeRateLimit.timeWindow,
  };

  app.get<{ readonly Querystring: CollectionPageQuery }>(
    "/threads",
    { schema: collectionPageQuerySchema },
    (request, reply) => {
      // The page is the schema's and is already resolved when this handler runs: the validator coerces
      // the query string to an integer and fills the default of 1, so no default and no parse appears
      // here. An unexpected query key — `?limit=100` — is removed by the validator before this handler
      // runs, because the schema declares `additionalProperties: false`: it is neither honoured nor
      // refused, so the fixed page size cannot be raised from a request.
      const result: ThreadBoardResult = listBoard(context.database, request.query.page);
      return reply.code(200).send(result);
    },
  );

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
