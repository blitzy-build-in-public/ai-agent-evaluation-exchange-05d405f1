/**
 * The two appeal rows of the API contract table: a developer's challenge to one evaluation report,
 * and the operator's ruling that answers it.
 *
 * The rows, exactly as the contract states them and as the routes below register them:
 * `POST /evaluations/:id/appeals` (developer, `201` with the appeal in status `open`) and
 * `POST /appeals/:id/ruling` (operator, `200` with the appeal in its new state beside the
 * governance event the ruling appended). An opening's `201` answers the appeal it created, whose
 * ground is stored in that row and in the event the opening appends; a ruling's `200` answers the
 * event beside the appeal, because a ruling's ground has no column to live in and the operator reads
 * the decision where it is shown. Both paths are prefix-relative: the versioned prefix is
 * applied exactly once, by the sibling `./register-routes` that calls this function, and the
 * literal for it appears nowhere in this file.
 *
 * **A ruling records a decision and never changes a measurement.** This is the file in which "an
 * operator cannot alter a measurement" becomes observable over HTTP, and the property is held by
 * what this file does not do: it issues no statement against the report or against the per-case
 * evidence a report carries — no read for an existence check included — and it offers no route,
 * verb or clause through which either could be amended or removed. The report's existence is
 * verified by `@adem/sgi-core`'s `openAppeal`, which reads its own table, and whether an appeal
 * exists and whether it already carries a terminal status is decided by that package's
 * `ruleAppeal`. A ruling appends a governance event and moves the appeal's own `status`; the
 * appealed report and its per-case evidence stay byte-identical, which is what the public
 * `GET /evaluations/{id}` returns before and after a ruling. The ruling's answer carries that
 * event beside the appeal — read back from the append-only log, filtered by the subject the
 * decision concerns — so the ground the operator stated is readable where the decision is shown,
 * which is the shape the sibling `./moderation` answer already has.
 *
 * **No ownership lookup, deliberately.** Whether the developer appealing a report owns the listing
 * version that report measures is not resolved here, and no table outside this workspace's own is
 * consulted to find out: the row's `403` is the demo-account role check below, and the domain
 * package takes the developer as given rather than reading `listings` and `listing_versions`, which
 * belong to this workspace. Resolving it here would put a cross-table read in a route and duplicate
 * knowledge the domain package deliberately declined to hold.
 *
 * **The failure order is the contract's**, and it is the same for both rows: the write rate limit,
 * then JSON-schema validation at the edge, then `401` for a demo-account header that is absent or
 * names no seeded account, then `403` for a resolvable account whose role the row does not accept,
 * then the domain call and this route's audit append inside one transaction, then `201` or `200`. A
 * refusal carries a stable `code` and no HTTP status, so it is mapped through `toApiError`, the one
 * place a code becomes a status and a client-facing sentence: `not_found` is `404`, `invalid_appeal`
 * is `400` and `already_ruled` is `409`. Nothing here decides a status from domain state, and no
 * handler writes an error body — the composition root's single error handler renders every failure
 * as `{ error: { code, message } }`, and the account resolved by `resolveDemoAccount` and the role
 * asserted by `requireRole` reach it unchanged.
 *
 * **The four refusals these rows answer are this file's sentences**, not the domain package's. The
 * classes are exported from `@adem/sgi-core`'s entry and each names one refusal: a report no row
 * carries and an appeal no row carries are `404 not_found`, a blank ground is `400 invalid_appeal`,
 * and a second ruling is `409 already_ruled`. The package writes its messages for a log — each
 * begins with the package's own name — so the two helpers below replace that message with this
 * route's sentence while keeping the status and the code `toApiError` derived from it, and a refusal
 * this file does not know keeps whatever `toApiError` gives it. No client of these two rows reads a
 * sentence naming an internal module.
 *
 * **One transaction, two writes.** The domain call and the audit row go in one
 * `db.transaction(...)`, so a write and the record of it are indivisible: a failure after the
 * domain call leaves neither behind. `appendAuditEvent` opens no transaction of its own for that
 * reason, and `ruleAppeal` opens one that better-sqlite3 nests inside this one as a savepoint, so a
 * failure anywhere in the ruling rolls back the status move and the governance event together.
 *
 * **Only one write is this file's own**: the audit row. The appeal's status move and the governance
 * event are `ruleAppeal`'s writes, reached through the package entry and never by a statement here,
 * and the event the ruling answers with is *read* back rather than written — one `SELECT` over the
 * log by the subject the decision concerns, inside the same transaction that wrote it. No upsert or
 * replace-style clause appears anywhere below — SQLite documents one as bypassing an append-only
 * delete trigger — and nothing below amends or removes a row. The audit row carries the actor, the
 * action, the resource, the status and, where the caller stated one, that ground: the developer's
 * reason for an opening and the operator's for a ruling, each passed on exactly as the route
 * received it, because a row that stated a ground and a reader told none was recorded would be two
 * accounts of one write.
 *
 * **Domain records are camelCase; the wire shape is snake_case.** This file is the mapping layer
 * between them, which is why the ruling's body field is `status` — the column the ruling sets —
 * while `ruleAppeal`'s parameter for the same value is named `ruling`, and why an event is mapped
 * member by member onto the stored row the contract's `GovernanceEvent` declares.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable, resolves no path and reads no clock. The write rate limit is the
 * one the composition root resolved, never a literal here.
 */

import type { RateLimitOptions } from "@fastify/rate-limit";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type {
  Appeal,
  AppealCreateBody,
  AppealRuling,
  AppealRulingBody,
  GovernanceEvent,
} from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  appealCreateBodySchema,
  appealIdParamsSchema,
  appealRulingBodySchema,
  demoAccountHeaderSchema,
  evaluationIdParamsSchema,
} from "@adem/shared";
import type {
  Appeal as AppealRecord,
  GovernanceEvent as AppendedGovernanceEvent,
  GovernanceEventType,
} from "@adem/sgi-core";
import {
  AppealAlreadyRuledError,
  AppealNotFoundError,
  InvalidAppealError,
  ReportNotFoundError,
  canonicalize,
  listEvents,
  openAppeal,
  ruleAppeal,
} from "@adem/sgi-core";

import { appendAuditEvent } from "../audit/append-audit-event";
import { requireRole } from "../auth/require-role";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import type { ApiConfig } from "../config";
import { ApiError, toApiError } from "../errors/error-envelope";

/**
 * The two members of the folder's single `RouteContext` these two writes need: the open database
 * handle the appeal and the audit row are written through, and the resolved configuration the write
 * rate limit comes from.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the members structurally instead of importing that type, as the sibling
 * `./audit`, `./ledgers` and `./sponsored` do, so that this file and the `apps/api` project compile
 * on their own, before `./register-routes` exists; a `RouteContext` carrying a `Database` and an
 * `ApiConfig` is assignable to this shape, so the registrar's call site is unaffected. Both members
 * are declared because both are read — the rate limit is never a literal in this file.
 */
interface AppealRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * The governance subject kind an appeal's decisions are recorded against, and the vocabulary member
 * a ruling appends and this file reads back.
 *
 * Both are named once, here, so the write and the read cannot name different rows: `ruleAppeal`
 * appends the event under this pair and {@link recordAppealRuling} reads it back under the same
 * pair. The subject spelling is the one the product uses for an appeal — the appender's subject set
 * is deliberately open, so nothing but this constant closes it — and the event type is typed as the
 * closed vocabulary's own member, so a rename in `@adem/sgi-core` fails this declaration rather than
 * a stored value.
 */
const APPEAL_SUBJECT_TYPE = "appeal";

/** The vocabulary member a ruling appends and this file reads back; see {@link APPEAL_SUBJECT_TYPE}. */
const APPEAL_RULED_EVENT_TYPE: GovernanceEventType = "appeal_ruled";

/**
 * One appeal's domain record as the wire shape `@adem/shared` declares for the same row.
 *
 * The package returns camelCase (`reportId`, `developerAccountId`, `createdAt`) and the stored row
 * and the response are snake_case, so the mapping is done here, member by member, rather than by
 * spreading the record and hoping the names agree. Every value is passed on exactly as the domain
 * package returned it: nothing is derived, renamed, defaulted or reformatted, so a client reads the
 * facts the row holds.
 */
function toWireAppeal(appeal: AppealRecord): Appeal {
  return {
    id: appeal.id,
    report_id: appeal.reportId,
    developer_account_id: appeal.developerAccountId,
    reason: appeal.reason,
    status: appeal.status,
    created_at: appeal.createdAt,
  };
}

/**
 * One appended governance event as the row `governance_events` stores it: the package's own values
 * in the table's snake_case spelling, with the payload the appender canonicalised.
 *
 * Every identifying member comes from the value `listEvents` returned, which *is* the row: the log
 * is append-only, so the reader's answer is what the table holds and a second statement could say
 * nothing more. `subject_type` is restated as the literal the read was filtered by rather than taken
 * from the event's own open `string`: the query named that subject kind, so every row answering it
 * carries it, and the wire type declares the closed vocabulary a row must be a member of.
 * `payload_json` is `canonicalize(payload)`, the same canonical JSON `appendEvent` stored for the
 * same payload value — canonicalisation is a pure function of its input, so the text is
 * byte-identical and no stored string is parsed and re-rendered to obtain it — and `null` where the
 * event carries no payload, which is what the column holds.
 */
function toStoredEvent(event: AppendedGovernanceEvent): GovernanceEvent {
  const { payload } = event;

  return {
    id: event.id,
    subject_type: APPEAL_SUBJECT_TYPE,
    subject_id: event.subjectId,
    event_type: event.eventType,
    actor_account_id: event.actorAccountId,
    reason: event.reason ?? null,
    payload_json: payload === undefined ? null : canonicalize(payload),
    created_at: event.createdAt,
  };
}

/**
 * The sentence an opening states for a report identifier no row carries.
 *
 * It is the sentence the evaluations read row states for the same fact — `GET /evaluations/{id}`
 * answers an unknown report with these words, and the report page's absent state reads from that
 * answer — so one condition is phrased one way wherever a client meets it, and no identifier is echoed
 * back.
 */
const REPORT_NOT_HELD_SENTENCE = "No evaluation report carries this identifier.";

/**
 * The sentence an opening states for a ground that is empty or nothing but whitespace.
 *
 * The body schema already requires a non-empty reason, so this is the refusal the domain's own
 * whitespace rule earns: it names the field's rule and nothing about the request's shape, because a
 * client that sent the field a value the rule refuses has a field to fix rather than a body to
 * rebuild.
 */
const BLANK_GROUND_SENTENCE = "An appeal needs a stated ground, and a blank ground states none.";

/** The sentence a ruling states for an appeal identifier no row carries. */
const APPEAL_NOT_HELD_SENTENCE = "No appeal carries this identifier.";

/**
 * The sentence a ruling states for an appeal that already carries a terminal status.
 *
 * A ruling is final, so the same outcome a second time is refused as much as the opposite one, and
 * the sentence says why rather than repeating the stored status: what the operator can act on is
 * that this appeal is already decided, and the ruling's history is read from the event the first
 * decision appended.
 */
const APPEAL_ALREADY_RULED_SENTENCE =
  "That appeal has already been ruled, and a ruling is final: only an appeal that is still open can be ruled.";

/**
 * A refused call as this file answers it: the status and the code {@link toApiError} derived from
 * the refusal, with the sentence this route states for it.
 *
 * The status is taken from the mapper rather than chosen here — `toApiError` is the one place a code
 * becomes a status — so the contract's statuses stay in one definition and a change to that mapping
 * moves this route with it, and the code is passed through unchanged, so a client reads the code the
 * row's contract names. Only the message is replaced: `@adem/sgi-core` writes its messages for a
 * log, each beginning with the name of the module that refused, which belongs in a log and not in an
 * explanation shown to a client.
 */
function withStatedSentence(error: unknown, sentence: string): ApiError {
  const mapped = toApiError(error);

  return new ApiError(mapped.status, mapped.code, sentence);
}

/**
 * Opens one appeal and records the write, in one transaction, and answers the domain package's
 * refusals with the envelope's own errors.
 *
 * The appeal is written first and the audit row second, because the audit row names the row the
 * write created and that id exists only once `openAppeal` has answered. Both are inside one
 * `db.transaction(...)`: `appendAuditEvent` joins the open transaction rather than opening its own,
 * so an appeal and the record of its opening cannot diverge.
 *
 * The refusals are mapped rather than answered with a status chosen here: `@adem/sgi-core` raises
 * `ReportNotFoundError` (`code` `not_found`, the contract's `404`) for a report no row carries and
 * `InvalidAppealError` (`code` `invalid_appeal`, the contract's `400`) for a reason that is empty or
 * nothing but whitespace, even though the body schema already requires `minLength: 1`. Mapping them
 * through `toApiError` is what keeps this row's two failure statuses independent of the composition
 * root: the root's own error handler maps the same way, and an `ApiError` it receives passes
 * through it unchanged.
 *
 * The two refusals are recognised by their classes, which the package exports, and each is answered
 * with this file's own sentence rather than the package's: see {@link openingRefusal}. The audit row
 * records the ground the developer stated, because the row states one and an operator reading the
 * feed is owed it.
 *
 * @param database - The caller's database handle.
 * @param input - The appealed report, the developer opening the appeal, and the stated reason.
 * @returns The opened appeal, in status `open`.
 * @throws {ApiError} `404 not_found` for a report no row carries, and `400 invalid_appeal` for a
 *   ground that is empty or nothing but whitespace.
 */
function recordAppealOpening(
  database: Database,
  input: {
    readonly reportId: string;
    readonly developerAccountId: string;
    readonly reason: string;
  },
): AppealRecord {
  try {
    return database.transaction(() => {
      const appeal = openAppeal(database, input);

      appendAuditEvent(database, {
        actorAccountId: input.developerAccountId,
        action: "appeal.opened",
        resourceType: "appeal",
        resourceId: appeal.id,
        statusCode: 201,
        reason: input.reason,
      });

      return appeal;
    })();
  } catch (error) {
    throw openingRefusal(error);
  }
}

/**
 * The refusal an opening answers with, in this file's own words.
 *
 * `openAppeal` makes exactly two refusals, and each is recognised by its own class — both exported
 * from `@adem/sgi-core`'s entry, which is the only path this file may reach the package by — so an
 * unknown report and a blank ground are answered with the sentences
 * {@link REPORT_NOT_HELD_SENTENCE} and {@link BLANK_GROUND_SENTENCE} state, at the status and with
 * the code {@link withStatedSentence} takes from the mapper. Anything else — a failed audit append,
 * a driver refusal — is left to `toApiError`, which answers an unmapped value `500 internal_error`
 * rather than offering it a sentence that would misdescribe it.
 *
 * The whitespace case reaches here even though the body schema requires a non-empty reason: the
 * schema admits `" "`, and the domain refuses it with `invalid_appeal` rather than scoring a
 * mis-shapen request, so the field's rule is the one the client reads.
 */
function openingRefusal(error: unknown): ApiError {
  if (error instanceof ReportNotFoundError) {
    return withStatedSentence(error, REPORT_NOT_HELD_SENTENCE);
  }
  if (error instanceof InvalidAppealError) {
    return withStatedSentence(error, BLANK_GROUND_SENTENCE);
  }
  return toApiError(error);
}

/**
 * The refusal a ruling answers with, in this file's own words.
 *
 * `ruleAppeal` makes exactly two refusals, again one class each: an appeal no row carries and an
 * appeal that already carries a terminal status, answered with {@link APPEAL_NOT_HELD_SENTENCE} and
 * {@link APPEAL_ALREADY_RULED_SENTENCE}. A refusal this file does not know is left to
 * `toApiError`, as in {@link openingRefusal}.
 */
function rulingRefusal(error: unknown): ApiError {
  if (error instanceof AppealNotFoundError) {
    return withStatedSentence(error, APPEAL_NOT_HELD_SENTENCE);
  }
  if (error instanceof AppealAlreadyRuledError) {
    return withStatedSentence(error, APPEAL_ALREADY_RULED_SENTENCE);
  }
  return toApiError(error);
}

/**
 * What {@link recordAppealRuling} answers with: the appeal in its new state and the event the ruling
 * appended, both in the domain package's camelCase.
 *
 * The event is read back inside the transaction that wrote it rather than composed here: the ruling
 * history lives in the append-only log, so the row is the authority for it and an event this file
 * built from the request would be a second, uncorroborated account of the same decision.
 */
interface RuledAppeal {
  /** The appeal, carrying the ruling as its `status`. */
  readonly appeal: AppealRecord;
  /** The appended governance event, as the reader returned it. */
  readonly event: AppendedGovernanceEvent;
}

/**
 * Rules one open appeal and records the write, in one transaction, and answers the domain package's
 * refusals with the envelope's own errors.
 *
 * `ruleAppeal` moves the appeal's `status` and appends the `appeal_ruled` governance event inside a
 * transaction of its own, which better-sqlite3 nests inside this one as a savepoint: a failure in
 * either — the status move, the event, or the audit row below — rolls back all of them, so the row's
 * state and the ruling's history never diverge, and the appealed report is not reached by any of it.
 *
 * The operator's stated ground travels into the appended event and, where the caller stated one, into
 * the audit row, which is what makes the decision's reason readable in both logs. `AppealRulingBody.reason`
 * is optional, and the domain parameter is required, so an absent reason arrives as the empty string
 * rather than being fabricated into one; an event whose ground is the empty string is a terse decision
 * recorded as stated, and the answer's `event.reason` states it as the empty string rather than as
 * `null`. The audit row holds that same absence the way its own column documents it — as SQL `NULL` —
 * because the operator's feed renders its own sentence for a row that states no ground and would
 * render a blank cell for one carrying `""`, which is a ground the write never stated.
 *
 * The appended event is read back with `listEvents`, filtered to this appeal and to the vocabulary
 * member the ruling wrote, **inside the same transaction**: the ruling and its record are therefore
 * read as one state, and a reader outside the transaction could not see a ruling whose event was not
 * yet visible. Exactly one row answers that read, because a second ruling is refused `409` before
 * anything is written; a read that answered any other number would mean the append did not happen,
 * which is a defect on this path rather than a client condition, and it is raised as an internal
 * failure — rolling the transaction back — rather than answered with an empty event.
 *
 * The refusals are mapped, not decided here: `AppealNotFoundError` (`code` `not_found`) is the
 * contract's `404` for an appeal no row carries, and `AppealAlreadyRuledError` (`code`
 * `already_ruled`) is its `409`, raised before anything is written when the stored status is no
 * longer `open` — a ruling being final, the same outcome a second time is as much a second ruling as
 * the opposite outcome, and neither reopens an appeal. Both are answered in this file's own words by
 * {@link rulingRefusal}, which keeps their codes and statuses.
 *
 * @param database - The caller's database handle.
 * @param input - The appeal to rule, the operator ruling it, the outcome, and the operator's ground.
 * @returns The appeal, carrying the ruling as its `status`, and the appended event.
 * @throws {ApiError} `404 not_found` for an appeal no row carries, and `409 already_ruled` for one
 *   that already carries a terminal status.
 */
function recordAppealRuling(
  database: Database,
  input: {
    readonly appealId: string;
    readonly operatorAccountId: string;
    readonly ruling: AppealRuling;
    readonly reason: string;
  },
): RuledAppeal {
  try {
    return database.transaction((): RuledAppeal => {
      const appeal = ruleAppeal(database, input);

      appendAuditEvent(database, {
        actorAccountId: input.operatorAccountId,
        action: "appeal.ruled",
        resourceType: "appeal",
        resourceId: input.appealId,
        statusCode: 200,
        // The member is passed only where the operator stated a ground: an absent `reason` is the
        // absence, which `audit_events.reason` holds as SQL `NULL` and the operator's feed renders
        // with its own sentence, where a stored `""` would render a blank cell for it.
        ...(input.reason.trim() === "" ? {} : { reason: input.reason }),
      });

      const events = listEvents(database, {
        subjectType: APPEAL_SUBJECT_TYPE,
        subjectId: input.appealId,
        eventType: APPEAL_RULED_EVENT_TYPE,
      });
      const [event] = events;

      if (event === undefined || events.length !== 1) {
        throw new Error(
          `apps/api: the ruling appended ${events.length} ${APPEAL_RULED_EVENT_TYPE} governance events for one appeal, where exactly one records it`,
        );
      }

      return { appeal, event };
    })();
  } catch (error) {
    throw rulingRefusal(error);
  }
}

/**
 * The `200` body of a ruling: the appeal in its new state and the record of the decision that put it
 * there.
 *
 * Two keys, because the operator needs both and neither answers the other's question. `appeal` is the
 * row a ruling moves and states where the appeal stands now; `event` is the append-only row the
 * ruling appended and names the decision — the ground the operator stated, and the reference an
 * operator can cite afterwards, since no ruling can be repeated and an appended event never changes.
 * The shape is the one the sibling `./moderation` answer already gives its own decision, and the one
 * `apps/web/src/api-client.ts`'s `ruleAppeal` reads: the status to show and the event whose ground is
 * rendered beside it.
 *
 * `event` is never absent. A ruling that reached this answer appended exactly one event in the same
 * transaction — see {@link recordAppealRuling} for why the read cannot answer anything else — and an
 * answer stating no event would be an answer a client could not render as a recorded decision.
 */
interface AppealRulingResult {
  /** The appeal as the ruling left it, in the wire spelling `@adem/shared` declares. */
  readonly appeal: Appeal;
  /** The governance event the ruling appended, as `governance_events` stores it. */
  readonly event: GovernanceEvent;
}

/**
 * Registers the group's two routes — `POST /evaluations/:id/appeals` and `POST /appeals/:id/ruling`
 * — on the instance it is handed, in the order the contract table lists them.
 *
 * Both rows are writes, so both attach the three schemas the contract makes executable: the
 * demo-account header every non-public row requires, the path-parameter schema that fixes the id
 * the row acts on, and the body schema that fixes what a client may send. An absent or empty header
 * is a schema failure at the edge, which the error handler answers `401` because the failure concerns
 * that header; a header that names no seeded account is `401` from `resolveDemoAccount`; and a
 * resolvable account whose role the row does not accept is `403` from `requireRole`.
 *
 * The rate limit is attached per route from the resolved configuration: at most
 * `writeRateLimit.max` write requests per `writeRateLimit.timeWindow` per client, beyond which the
 * registered plugin answers `429` with a `Retry-After` header. The numbers live in `@adem/shared`
 * and are resolved once, in `apps/api/src/config.ts`, so nothing here states one.
 *
 * The handler boundary catches nothing and no error body is written here: a refusal the domain
 * packages raise is mapped to an `ApiError` by the two helpers above and thrown, and the composition
 * root's single error handler renders `{ error: { code, message } }` from it, which is what keeps one
 * shape across validation, auth, role, not-found and throttled refusals.
 *
 * @param app - The Fastify instance the composition root registers the group on, already scoped to
 *   the versioned prefix.
 * @param context - The open database handle and the resolved configuration.
 */
export function registerAppealRoutes(app: FastifyInstance, context: AppealRouteContext): void {
  const rateLimit: RateLimitOptions = Object.freeze({
    max: context.config.writeRateLimit.max,
    timeWindow: context.config.writeRateLimit.timeWindow,
  });

  app.post<{ Params: { id: string }; Body: AppealCreateBody }>(
    "/evaluations/:id/appeals",
    {
      schema: { ...demoAccountHeaderSchema, ...evaluationIdParamsSchema, ...appealCreateBodySchema },
      config: { rateLimit },
    },
    (request, reply) => {
      // Called for the pair of refusals it owns: `401` when the header names no seeded account, and
      // `403` when the account it names is not a developer. No ownership check follows — see this
      // module's comment.
      const account = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "developer",
      );

      const appeal = recordAppealOpening(context.database, {
        reportId: request.params.id,
        developerAccountId: account.id,
        reason: request.body.reason,
      });

      return reply.code(201).send(toWireAppeal(appeal));
    },
  );

  app.post<{ Params: { id: string }; Body: AppealRulingBody }>(
    "/appeals/:id/ruling",
    {
      schema: { ...demoAccountHeaderSchema, ...appealIdParamsSchema, ...appealRulingBodySchema },
      config: { rateLimit },
    },
    (request, reply) => {
      // The operator's power is additive: this row rules a challenge, and no request it accepts can
      // reach a measurement. `403` for every other role, `401` for an unresolvable account.
      const account = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "operator",
      );

      const ruled = recordAppealRuling(context.database, {
        appealId: request.params.id,
        operatorAccountId: account.id,
        // The wire field is the column the ruling sets; the domain parameter for the same value is
        // named `ruling`. This is the one place the two spellings are paired.
        ruling: request.body.status,
        reason: request.body.reason ?? "",
      });

      const result: AppealRulingResult = {
        appeal: toWireAppeal(ruled.appeal),
        event: toStoredEvent(ruled.event),
      };

      return reply.code(200).send(result);
    },
  );
}

