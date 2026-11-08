/**
 * The two appeal rows of the API contract table: a developer's challenge to one evaluation report,
 * and the operator's ruling that answers it.
 *
 * The rows, exactly as the contract states them and as the routes below register them:
 * `POST /evaluations/:id/appeals` (developer, `201` with the appeal in status `open`) and
 * `POST /appeals/:id/ruling` (operator, `200` with the appeal in its new state). Both paths are
 * prefix-relative: the versioned prefix is applied exactly once, by the sibling `./register-routes`
 * that calls this function, and the literal for it appears nowhere in this file.
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
 * `GET /evaluations/{id}` returns before and after a ruling.
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
 * **One transaction, two writes.** The domain call and the audit row go in one
 * `db.transaction(...)`, so a write and the record of it are indivisible: a failure after the
 * domain call leaves neither behind. `appendAuditEvent` opens no transaction of its own for that
 * reason, and `ruleAppeal` opens one that better-sqlite3 nests inside this one as a savepoint, so a
 * failure anywhere in the ruling rolls back the status move and the governance event together.
 *
 * **Only one write is this file's own**: the audit row. The appeal's status move and the governance
 * event are `ruleAppeal`'s writes, reached through the package entry and never by a statement here.
 * No upsert or replace-style clause appears anywhere below — SQLite documents one as bypassing an
 * append-only delete trigger — and nothing below amends or removes a row. The audit row carries the
 * actor, the action, the resource and the status, and deliberately no `reason`: the developer's
 * stated ground and the operator's travel into the appeal row and the appended governance event,
 * and `appendAuditEvent` takes a short phrase the route states rather than text assembled from a
 * request body.
 *
 * **Domain records are camelCase; the wire shape is snake_case.** This file is the mapping layer
 * between them, which is why the ruling's body field is `status` — the column the ruling sets —
 * while `ruleAppeal`'s parameter for the same value is named `ruling`.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable, resolves no path and reads no clock. The write rate limit is the
 * one the composition root resolved, never a literal here.
 */

import type { RateLimitOptions } from "@fastify/rate-limit";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { Appeal, AppealCreateBody, AppealRuling, AppealRulingBody } from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  appealCreateBodySchema,
  appealIdParamsSchema,
  appealRulingBodySchema,
  demoAccountHeaderSchema,
  evaluationIdParamsSchema,
} from "@adem/shared";
import type { Appeal as AppealRecord } from "@adem/sgi-core";
import { openAppeal, ruleAppeal } from "@adem/sgi-core";

import { appendAuditEvent } from "../audit/append-audit-event";
import { requireRole } from "../auth/require-role";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import type { ApiConfig } from "../config";
import { toApiError } from "../errors/error-envelope";

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
 * @param database - The caller's database handle.
 * @param input - The appealed report, the developer opening the appeal, and the stated reason.
 * @returns The opened appeal, in status `open`.
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
      });

      return appeal;
    })();
  } catch (error) {
    throw toApiError(error);
  }
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
 * The operator's stated ground travels into the appended event only. `AppealRulingBody.reason` is
 * optional, and the domain parameter is required, so an absent reason arrives as the empty string
 * rather than being fabricated into one.
 *
 * The refusals are mapped, not decided here: `AppealNotFoundError` (`code` `not_found`) is the
 * contract's `404` for an appeal no row carries, and `AppealAlreadyRuledError` (`code`
 * `already_ruled`) is its `409`, raised before anything is written when the stored status is no
 * longer `open` — a ruling being final, the same outcome a second time is as much a second ruling as
 * the opposite outcome, and neither reopens an appeal.
 *
 * @param database - The caller's database handle.
 * @param input - The appeal to rule, the operator ruling it, the outcome, and the operator's ground.
 * @returns The appeal, carrying the ruling as its `status`.
 */
function recordAppealRuling(
  database: Database,
  input: {
    readonly appealId: string;
    readonly operatorAccountId: string;
    readonly ruling: AppealRuling;
    readonly reason: string;
  },
): AppealRecord {
  try {
    return database.transaction(() => {
      const appeal = ruleAppeal(database, input);

      appendAuditEvent(database, {
        actorAccountId: input.operatorAccountId,
        action: "appeal.ruled",
        resourceType: "appeal",
        resourceId: input.appealId,
        statusCode: 200,
      });

      return appeal;
    })();
  } catch (error) {
    throw toApiError(error);
  }
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

      const appeal = recordAppealRuling(context.database, {
        appealId: request.params.id,
        operatorAccountId: account.id,
        // The wire field is the column the ruling sets; the domain parameter for the same value is
        // named `ruling`. This is the one place the two spellings are paired.
        ruling: request.body.status,
        reason: request.body.reason ?? "",
      });

      return reply.code(200).send(toWireAppeal(appeal));
    },
  );
}

