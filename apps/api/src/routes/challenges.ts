/**
 * The public challenges board and the two writes that fill it: a buyer's challenge against a listing,
 * and a response to one.
 *
 * It owns one row of the API contract table — `GET /challenges`, `POST /challenges` and
 * `POST /challenges/{id}/responses`, "read public; write buyer or developer", success `200` / `201`,
 * error cases `400`, `404`, `401` — and those three routes are the whole of this group's surface. The
 * read resolves no identity at all. Each write attaches the demo-account header schema, resolves the
 * account `X-Demo-Account` names (the header pair answers `401` when it names none) and checks the
 * role the row requires (`403` when the resolved account's role is not one the row accepts).
 *
 * **The board carries each challenge with its own responses.** The contract table names no
 * per-challenge read route, so this read is the only public read of these two tables and every row it
 * answers with carries the responses written on it — an unanswered challenge carrying the empty list,
 * which is the state the challenges page renders rather than an absent key. The responses of the whole
 * page are read in one statement over the ids the board returned, not in a query per challenge:
 * better-sqlite3 is synchronous and runs on the calling thread, so a per-row query would put the page's
 * row count on the event loop. An empty board is `200` with `items: []`, never an error and never a
 * `404`.
 *
 * **The board's order is total, and it is the answer's own.** The rows are ordered by the instant the
 * challenge was written and then by its id, both ascending, so two calls answer byte-identical bodies
 * and no sponsorship, fee, locale or clock reading can reorder the board. The responses of one
 * challenge are ordered by the table's own `rowid`, which is the order they entered the table: the
 * written instant is application-supplied and may tie or regress, while the rowid is the insertion
 * order the challenge response type states its rows are held in. No collation is named, so SQLite's
 * default `BINARY` comparison decides, and `id` and `rowid` are the primary key and the row's own
 * position, which is what makes both orders total.
 *
 * **This group reads and writes its own two tables and joins nothing.** `challenges` and
 * `challenge_responses` are owned by `apps/api`, so no domain package takes part here: this file
 * imports neither `@adem/sgi-core` nor `@adem/commerce-sim`, and it holds no scoring, ledger or policy
 * arithmetic. The one read of `listings` below selects that table's own moderation column and nothing
 * else — no price, no claim, no measured evidence — which is why a listing's commercial or sponsored
 * detail cannot reach a challenge, a response or the board's order.
 *
 * **The response route is the only writer that may move `challenges.status`,** and its `status` is the
 * only column of that row anything rewrites. The plan fixes the pair: a challenge's status is `open`
 * when it is created and `responded` once it has been answered, and the question is never rewritten.
 * The response insert, the status change and the audit append therefore share one `db.transaction(...)`,
 * so the board can never show a response without the status that admits it, nor a `responded` challenge
 * with nothing behind it. The transaction is closed over the caller's handle; nothing is committed
 * inside it, and a failure anywhere in it leaves neither row changed.
 *
 * **`challenge_responses` is append-only by route design.** The table is deliberately not one of the
 * nine `packages/shared/migrations/0010_append_only_triggers.sql` guards, so nothing may claim a
 * database trigger protects it: the guarantee is that this file inserts and never rewrites a row, and
 * exactly one statement in this file is an `UPDATE`, aiming at `challenges.status`, and no statement is
 * a `DELETE` or an upsert. Response rows are read back in insertion order, so the record of a challenge
 * is the sequence of answers written to it and never a current value someone recomputed.
 *
 * **Repetition is accepted rather than refused.** A second response to an already-answered challenge
 * appends another row and leaves the status `responded`, because the board is a conversation a listing
 * collects and the pages read its answers as a list — `apps/web/src/pages/challenges.tsx` counts them
 * and renders "1 response" or "N responses". The contract row documents no `409` for this route, so
 * refusing a repeat would mean inventing a status the plan does not fix; the alternative reading,
 * refusing a response once the status has moved, is what a later reader might "tighten" this into, and
 * it would both add that undocumented status and drop an answer the board had accepted.
 *
 * **The one two-value role in the plan, and why it is spelled with a list.** The contract row says the
 * writes are for "write buyer or developer", while the plan's actors table lists the response route
 * under the developer's reachable writes. Both hold under the list form below: a challenge may be
 * answered by the developer whose listing was challenged and by the buyer who asked, and only by those
 * two — a contributor or an operator is refused with `403`, and an absent or unresolvable header with
 * `401`. The array is not a wildcard: it names the two roles and nothing else, and it is the only place
 * in the API where a role requirement holds more than one value. Tightening it to a single role is a
 * contract change, not a tidy-up.
 */

import { randomUUID } from "node:crypto";

// The handle's type is imported by name because `@types/better-sqlite3` declares the instance shape as
// a member of the namespace its `export =` also exports, so a default *type* import of that package
// resolves to the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type {
  Challenge,
  ChallengeCreateBody,
  ChallengeResponse,
  ChallengeResponseBody,
  ChallengeStatus,
} from "@adem/shared";
import {
  CHALLENGE_STATUSES,
  DEMO_ACCOUNT_HEADER,
  challengeCreateBodySchema,
  challengeIdParamsSchema,
  challengeResponseBodySchema,
  demoAccountHeaderSchema,
} from "@adem/shared";

import { appendAuditEvent } from "../audit/append-audit-event";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import { requireRole } from "../auth/require-role";
import type { ApiConfig } from "../config";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this group needs: the open database handle and the
 * resolved configuration, which arrive by closure from the server factory rather than through Fastify
 * plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells both members it reads structurally instead of importing that type, so that this file
 * and the `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` and an `ApiConfig` is assignable to this shape, so the registrar's call site is
 * unaffected. `apps/api/src/server.ts` passes the handle and the configuration in, so this module opens
 * no connection, reads no environment variable and resolves no path.
 */
interface ChallengeRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * One stored row of `challenges`, in the shape
 * `packages/shared/migrations/0004_challenges_and_threads.sql` declares it, so the select list below
 * can be read against the schema line by line. It is the declared result of the prepared statements,
 * which is what removes the need for a cast when the row is mapped.
 *
 * `status` is a plain `string` here although the column carries
 * `CHECK (status IN ('open', 'responded'))`: the column is stored as text, and narrowing it to
 * {@link ChallengeStatus} is the mapping step's job below, done by searching the shared tuple rather
 * than by asserting the type.
 */
interface ChallengeRow {
  readonly id: string;
  readonly listing_id: string;
  readonly buyer_account_id: string;
  readonly question: string;
  readonly status: string;
  readonly created_at: string;
}

/**
 * One stored row of `challenge_responses`, on the same terms as {@link ChallengeRow}: the five columns
 * that migration declares, in its order, and every one of them text.
 */
interface ChallengeResponseRow {
  readonly id: string;
  readonly challenge_id: string;
  readonly account_id: string;
  readonly body: string;
  readonly created_at: string;
}

/** The one column this group reads from `listings`: the operator moderation state of the challenged listing. */
interface ListingStatusRow {
  readonly status: string;
}

/**
 * One row of the board as this read answers it: the stored challenge, plus the responses it has
 * collected.
 *
 * The shared package declares `Challenge` and `ChallengeResponse` and deliberately no board row, so the
 * pairing is declared here, where it is produced. It is not exported: the file's one export is the
 * registrar below.
 */
interface ChallengeBoardItem extends Challenge {
  /** The responses written on this challenge, in insertion order; the empty list when none has been. */
  readonly responses: readonly ChallengeResponse[];
}

/**
 * The board's `200` body: `items` and nothing else, which is the one envelope key
 * `apps/web/src/api-client.ts` reads a list under, beside the bare-array form it also accepts. No
 * total, no page and no cursor: this read takes no parameter and pages nothing.
 */
interface ChallengeBoardResult {
  readonly items: readonly ChallengeBoardItem[];
}

/**
 * The two paths this group is served at, prefix-relative.
 *
 * The versioned prefix is applied exactly once, by `./register-routes`, which calls {@link
 * registerChallengeRoutes} with its encapsulated scope. That literal appears nowhere in this file and
 * must not: a group that spelled it would be the second place the prefix is decided.
 */
const CHALLENGES_PATH = "/challenges";
const CHALLENGE_RESPONSES_PATH = "/challenges/:id/responses";

/**
 * The six columns every `challenges` read in this file selects, named explicitly rather than through
 * `SELECT *`: a row is mapped member by member below, so a column a later migration adds stays out of
 * the result until this line and {@link ChallengeRow} are updated together, while `SELECT *` would
 * quietly change every row this read answers with.
 */
const CHALLENGE_COLUMNS = "id, listing_id, buyer_account_id, question, status, created_at";

/**
 * The five columns {@link ChallengeResponseRow} declares, for the same reason as
 * {@link CHALLENGE_COLUMNS}.
 */
const RESPONSE_COLUMNS = "id, challenge_id, account_id, body, created_at";

/**
 * The board read: every challenge, in the total order described in this file's header comment.
 *
 * It is unbounded on purpose. The contract row takes no query parameter — there is no status filter, no
 * listing filter and no paging — so a parameterised narrowing here would be a contract this file
 * invented, and the collection the demonstration holds is small. `0011_indexes.sql` declares no index
 * for it, on the stated ground that this read documents no filter to serve.
 */
const SELECT_BOARD =
  `SELECT ${CHALLENGE_COLUMNS} FROM challenges ORDER BY created_at ASC, id ASC`;

/**
 * The board's response read, whose only variable part is the number of bound placeholders for the ids
 * the board just returned.
 *
 * The placeholder count follows the number of rows read from the database and never anything a client
 * sent; every id is bound as a parameter, so no request value is ever concatenated into this statement.
 * The ids are the board's own, so the count is bounded by the board's size, and SQLite's parameter
 * limit is far above it.
 */
const SELECT_RESPONSES_FOR = `SELECT ${RESPONSE_COLUMNS} FROM challenge_responses WHERE challenge_id IN `;

/**
 * The listing read that decides whether a challenge may be created against a listing: its moderation
 * state, and nothing else. A listing this query does not answer for does not exist.
 */
const SELECT_LISTING_STATUS = "SELECT status FROM listings WHERE id = ?";

/**
 * The existence read a response is preceded by: the challenge's own primary key, so the answer is either
 * the row that was asked for or nothing. It selects no other column, because the response route needs no
 * field of the challenge it answers.
 */
const SELECT_CHALLENGE_ID = "SELECT id FROM challenges WHERE id = ?";

/**
 * The one insert path into `challenges`. The status is written explicitly as `'open'` rather than left
 * to the column's default, so the state the route answers with is the state the writer chose, and
 * `created_at` is an ISO-8601 UTC instant the application supplies: SQLite's `CURRENT_TIMESTAMP` yields
 * `YYYY-MM-DD HH:MM:SS`, which this contract does not accept.
 */
const INSERT_CHALLENGE =
  "INSERT INTO challenges (id, listing_id, buyer_account_id, question, status, created_at) " +
  "VALUES (?, ?, ?, ?, ?, ?)";

/** The one insert path into `challenge_responses`, with the same application-written instant. */
const INSERT_RESPONSE =
  "INSERT INTO challenge_responses (id, challenge_id, account_id, body, created_at) " +
  "VALUES (?, ?, ?, ?, ?)";

/**
 * The only `UPDATE` in this file, and the only statement anywhere that moves `challenges.status`:
 * `open` becomes `responded` once the challenge has been answered.
 *
 * It is unconditional on the current status, so answering an already-answered challenge writes the
 * state the row is already in rather than failing — the repeat case this file's header comment accepts
 * — and the question, the asker and the instant the challenge was raised are not touched. The
 * `status` column is mutable by the plan's own assignment to this route; both tables this group reads
 * are outside the nine append-only tables the migration set guards.
 */
const MARK_CHALLENGE_RESPONDED = "UPDATE challenges SET status = 'responded' WHERE id = ?";

/**
 * The stored status as a member of the closed vocabulary, or a defect.
 *
 * The status is narrowed by searching {@link CHALLENGE_STATUSES} for a member equal to the stored
 * string, which yields `ChallengeStatus | undefined` without a cast, and the tuple rather than this
 * function is what makes the vocabulary closed. The column's `CHECK` constraint makes a third value
 * unwritable, so a search that finds nothing describes a row this product cannot have — and refusing
 * loudly is the right answer for it, because a board that silently dropped the row would answer as
 * though the challenge did not exist while it sits in the table.
 */
function toChallengeStatus(stored: string): ChallengeStatus {
  const status = CHALLENGE_STATUSES.find((candidate) => candidate === stored);

  if (status === undefined) {
    throw new TypeError(
      "apps/api: a stored challenge status is not one of the two the shared vocabulary declares, " +
        `received ${JSON.stringify(stored)}`,
    );
  }

  return status;
}

/** One stored challenge row as the row the board answers with, with no responses attached yet. */
function toChallenge(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    listing_id: row.listing_id,
    buyer_account_id: row.buyer_account_id,
    question: row.question,
    status: toChallengeStatus(row.status),
    created_at: row.created_at,
  };
}

/** One stored response row as the response it is, member for member and unchanged. */
function toChallengeResponse(row: ChallengeResponseRow): ChallengeResponse {
  return {
    id: row.id,
    challenge_id: row.challenge_id,
    account_id: row.account_id,
    body: row.body,
    created_at: row.created_at,
  };
}

/**
 * Every challenge on the board, in the total order {@link SELECT_BOARD} fixes.
 *
 * The statement is prepared per call, because a prepared statement belongs to the connection that made
 * it and this module owns no connection: the handle is the caller's, as ports and adapters require.
 * SQLite caches the compiled statement itself, so the per-call `prepare` allocates no plan of its own.
 */
function listChallenges(database: Database): Challenge[] {
  return database.prepare<[], ChallengeRow>(SELECT_BOARD).all().map(toChallenge);
}

/**
 * The responses written on the given challenges, in insertion order, read in one statement.
 *
 * The ids are the board's own, in the board's order, and the result is grouped by the challenge each
 * row carries; a response can belong to no other challenge, because the column references `challenges`.
 * The order inside one challenge is the table's `rowid`, so the answers read as they were written, and
 * the pages that render them keep that order. An empty id list runs no statement at all, which is what
 * keeps an empty board from producing `IN ()`.
 */
function listResponsesFor(
  database: Database,
  challengeIds: readonly string[],
): Map<string, ChallengeResponse[]> {
  const grouped = new Map<string, ChallengeResponse[]>();

  if (challengeIds.length === 0) {
    return grouped;
  }

  const placeholders = challengeIds.map(() => "?").join(", ");
  const ids: string[] = [...challengeIds];
  const sql = `${SELECT_RESPONSES_FOR}(${placeholders}) ORDER BY rowid ASC`;
  const rows = database.prepare<string[], ChallengeResponseRow>(sql).all(...ids);

  for (const row of rows) {
    const response = toChallengeResponse(row);
    const collected = grouped.get(response.challenge_id);

    if (collected === undefined) {
      grouped.set(response.challenge_id, [response]);
    } else {
      collected.push(response);
    }
  }

  return grouped;
}

/**
 * The board's `200` body: every challenge with its own responses, the challenges in the read's total
 * order and each challenge's responses in insertion order.
 */
function readBoard(database: Database): ChallengeBoardResult {
  const challenges = listChallenges(database);
  const responses = listResponsesFor(
    database,
    challenges.map((challenge) => challenge.id),
  );

  return {
    items: challenges.map((challenge): ChallengeBoardItem => ({
      ...challenge,
      responses: responses.get(challenge.id) ?? [],
    })),
  };
}

/**
 * Refuses a challenge against a listing that does not exist or that an operator has hidden.
 *
 * A hidden listing leaves search and compare and stays readable, with its history, to the operator — and
 * a public surface may not accept a new question about it, because the listing is not one a reader can
 * reach. `flagged` is deliberately accepted: flagging is a review state and not a withdrawal. The read
 * selects the listing's moderation column alone, so nothing of its price, its claims or its measured
 * evidence takes part in this decision.
 */
function requireChallengeableListing(database: Database, listingId: string): void {
  const listing = database.prepare<[string], ListingStatusRow>(SELECT_LISTING_STATUS).get(listingId);

  if (listing === undefined || listing.status === "hidden") {
    throw ApiError.notFound("This listing does not exist or is not available to challenge.");
  }
}

/**
 * Refuses a response to a challenge that does not exist.
 *
 * The check runs before the write rather than inside it, so an unknown identifier is answered `404` with
 * no statement of the transaction attempted at all. Both run on the same handle in the same
 * single-writer process, so nothing can remove the row between them, and no field of the challenge is
 * carried across: the response needs the identifier alone, which is the one the path already holds.
 */
function requireChallenge(database: Database, challengeId: string): void {
  const challenge = database
    .prepare<[string], { readonly id: string }>(SELECT_CHALLENGE_ID)
    .get(challengeId);

  if (challenge === undefined) {
    throw ApiError.notFound("This challenge does not exist.");
  }
}

/**
 * Writes one challenge and the audit record of it in a single transaction, and answers the row it wrote.
 *
 * The id is generated here with `randomUUID()` and the instant with `new Date().toISOString()`, both at
 * write time: the id is a UUID string as every identifier in this product is, and the instant is an
 * ISO-8601 UTC instant rather than SQLite's own timestamp form. The status written is `open`, which is
 * also the status the answered row states, so the route's body describes the row the transaction left.
 *
 * The audit event is the last step inside the transaction, through the append point that owns the action
 * vocabulary: `challenge.created` against the `challenge` resource, at the `201` this route is about to
 * answer with. Nothing is committed here, and a failure in either statement rolls back both.
 */
function createChallenge(
  database: Database,
  listingId: string,
  buyerAccountId: string,
  question: string,
): Challenge {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const challenge: Challenge = {
    id,
    listing_id: listingId,
    buyer_account_id: buyerAccountId,
    question,
    status: "open",
    created_at: createdAt,
  };

  const write = database.transaction((): void => {
    database
      .prepare<[string, string, string, string, string, string]>(INSERT_CHALLENGE)
      .run(id, listingId, buyerAccountId, question, challenge.status, createdAt);

    appendAuditEvent(database, {
      actorAccountId: buyerAccountId,
      action: "challenge.created",
      resourceType: "challenge",
      resourceId: id,
      statusCode: 201,
    });
  });

  write();

  return challenge;
}

/**
 * Answers one challenge: appends the response, moves the challenge to `responded`, and records the write,
 * all inside one transaction, and answers the row it appended.
 *
 * The three statements are indivisible on purpose. `challenges.status` is the only column a response
 * changes and this route is the only writer that may change it, so a response that landed without the
 * status would leave the board claiming an unanswered question that carries an answer, and a status that
 * moved without the response would leave a `responded` challenge with nothing behind it. A failure in
 * any of the three therefore leaves neither row changed.
 *
 * The response's `account_id` is the resolved demo account's id and is never a body field, and the id
 * and the instant are generated here as they are for a challenge.
 */
function writeResponse(
  database: Database,
  challengeId: string,
  responderAccountId: string,
  body: string,
): ChallengeResponse {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const response: ChallengeResponse = {
    id,
    challenge_id: challengeId,
    account_id: responderAccountId,
    body,
    created_at: createdAt,
  };

  const write = database.transaction((): void => {
    database
      .prepare<[string, string, string, string, string]>(INSERT_RESPONSE)
      .run(id, challengeId, responderAccountId, body, createdAt);

    database.prepare<[string]>(MARK_CHALLENGE_RESPONDED).run(challengeId);

    appendAuditEvent(database, {
      actorAccountId: responderAccountId,
      action: "challenge.responded",
      resourceType: "challenge_response",
      resourceId: id,
      statusCode: 201,
    });
  });

  write();

  return response;
}

/**
 * Registers this group's three routes — the board, a buyer's challenge and a response to one — on the
 * instance it is handed, in contract-table order.
 *
 * The paths are prefix-relative: the versioned prefix is applied exactly once, by `./register-routes`,
 * which calls this function with its encapsulated scope.
 *
 * Each write attaches the demo-account header schema beside its own body schema, so an absent or blank
 * header fails at the edge and is answered `401` by the server's single error handler. Each write then
 * resolves the account the header names — `401` when it names no seeded account — checks the role its
 * row requires and answers `403` when the resolved account's role is not one the row accepts, and only
 * then touches the database. The read attaches no schema and resolves no identity: its row's role is
 * public, so it answers `200` alike for an absent header, an unknown one and one naming any role, and an
 * empty board is `200` with an empty collection rather than an error.
 *
 * Both writes carry the write rate limit, taken from the resolved configuration rather than restated as
 * a number here, so the contract's `60` per minute and its window have one definition. No failure is
 * caught in this file: the server's single error handler owns `{ error: { code, message } }`, so no
 * handler-local error body exists to disagree with it.
 */
export function registerChallengeRoutes(app: FastifyInstance, context: ChallengeRouteContext): void {
  const { max, timeWindow } = context.config.writeRateLimit;

  app.get(CHALLENGES_PATH, (_request, reply) => {
    const result: ChallengeBoardResult = readBoard(context.database);

    return reply.code(200).send(result);
  });

  app.post<{ Body: ChallengeCreateBody }>(
    CHALLENGES_PATH,
    {
      schema: { ...demoAccountHeaderSchema, ...challengeCreateBodySchema },
      config: { rateLimit: { max, timeWindow } },
    },
    (request, reply) => {
      // Creation is the buyer's: a developer, a contributor and an operator are each refused with `403`.
      const buyer = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "buyer",
      );

      requireChallengeableListing(context.database, request.body.listing_id);

      // The question is stored as the body carries it: the schema's `minLength` is the contract's own
      // requirement that it not be empty, and this route neither trims it nor validates it a second time.
      const challenge = createChallenge(
        context.database,
        request.body.listing_id,
        buyer.id,
        request.body.question,
      );

      return reply.code(201).send(challenge);
    },
  );

  app.post<{ Params: { id: string }; Body: ChallengeResponseBody }>(
    CHALLENGE_RESPONSES_PATH,
    {
      schema: {
        ...demoAccountHeaderSchema,
        ...challengeIdParamsSchema,
        ...challengeResponseBodySchema,
      },
      config: { rateLimit: { max, timeWindow } },
    },
    (request, reply) => {
      // The plan's one two-valued write role: the developer whose listing was challenged and the buyer
      // who asked may both answer. The list is not a wildcard — the two roles named are the only ones
      // accepted — and the contract row states this pair as "write buyer or developer". Do not narrow it.
      const responder = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        ["developer", "buyer"],
      );

      requireChallenge(context.database, request.params.id);

      const response = writeResponse(
        context.database,
        request.params.id,
        responder.id,
        request.body.body,
      );

      return reply.code(201).send(response);
    },
  );
}
