/**
 * The buyer's inquiry: `POST /inquiries`, the write by which a buyer asks a listing's developer a
 * question.
 *
 * One row of the API contract table is this file's — `POST /inquiries`, role `buyer`, success
 * `201`, error cases `400`, `404` for the listing, `401` and `403` — and it is the smallest write
 * in the contract. It carries all four obligations of a write path, in the order the plan fixes
 * them:
 *
 * 1. **The write rate limit**, declared per route from the numbers `context.config` resolved and
 *    never from a literal here, so this write is answered `429` with a `Retry-After` header beyond
 *    60 requests per minute per client.
 * 2. **JSON-schema validation at the edge**, before the handler runs: `inquiryCreateBodySchema`
 *    for the body and `demoAccountHeaderSchema` for the demo-session header. A body that fails
 *    answers `400 validation_error`; a request that does not carry the header answers `401`, which
 *    is the contract row's outcome for it, and the server's single error handler is what maps that
 *    schema rejection to `401` because the header is the contract's rather than this file's.
 * 3. **The demo-account pair, in that order**: `resolveDemoAccount` answers `401` when the header
 *    names no seeded account, and `requireRole(account, "buyer")` answers `403` when the resolved
 *    account is not a buyer. That header is a synthetic role selector and never authentication: it
 *    separates roles for a demonstration and asserts nothing about who the caller is, so nothing
 *    below treats it as an identity and nothing implies a credential, a session or a login.
 * 4. **The insert and its audit append inside one transaction.** The `inquiries` row and the
 *    `audit_events` row recording it are written together or not at all, so an accepted write can
 *    never leave an inquiry without its audit event and a failure leaves neither behind.
 *
 * **The target listing is resolved here, and a hidden one is refused.** The inquiry names its
 * listing in the body, and a listing that is unknown or `hidden` answers `404`: a hidden listing
 * has left the public surface — it is in neither search nor compare — so an inquiry may not reach
 * it either, and the row's one `404` covers both. A `flagged` listing is still public, because
 * flagging marks a listing while hiding withdraws it, so the withdrawal is the only state refused
 * below.
 *
 * **Nothing is delegated and nothing is computed.** `inquiries` is this workspace's own table
 * (`packages/shared/migrations/0003_inquiries.sql`), written by this file and read back unchanged:
 * no domain package takes part, this file imports neither `@adem/sgi-core` nor
 * `@adem/commerce-sim`, and no amount, score or count is derived anywhere in it.
 *
 * **One method, and nothing that rewrites a row.** Only `POST /inquiries` is registered: no `PUT`,
 * `PATCH` or `DELETE` handler exists here, no statement in this file mutates a stored row, and the
 * insert below is a plain one, never the replace-style upsert SQLite documents as bypassing a
 * DELETE trigger. An inquiry is written once and no route edits or removes one; `inquiries` is
 * deliberately not one of the nine append-only tables migration `0010` guards, so the guarantee is
 * this route's rather than a trigger's.
 *
 * **No personal information beyond the buyer's own message, and no second copy of one.** A row
 * holds the listing, the synthetic account id, the message and the instant, and the table has no
 * email, telephone, payment or contact column for anything else to reach — and none may be added.
 * The audit event records the actor, the action, the new inquiry's identifier and the status, and
 * its optional reason is left unset here: a message the buyer wrote is never copied onto a second
 * row, and no sentence this file sends echoes an identifier or request text back.
 *
 * The path below is prefix-relative. The versioned prefix is applied exactly once, by the sibling
 * `./register-routes`, which is why no file in this folder spells it: a group that did would be
 * the second place the prefix is decided.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { Inquiry, InquiryCreateBody, ListingStatus } from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  demoAccountHeaderSchema,
  inquiryCreateBodySchema,
} from "@adem/shared";

import { appendAuditEvent } from "../audit/append-audit-event";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import { requireRole } from "../auth/require-role";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this write needs: the open database handle and
 * the resolved write rate-limit numbers, both arriving by closure from the server factory rather
 * than through Fastify plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups'
 * values. This file spells the members structurally instead of importing that type, so that this
 * file and the `apps/api` project compile on their own, before `./register-routes` exists; a
 * `RouteContext` carrying a `Database` and its resolved `ApiConfig` is assignable to this shape,
 * so the registrar's call site is unaffected. Only the members this route reads are declared:
 * `database`, and the rate limit, which is the one member of the configuration a write route
 * registers. `apps/api/src/server.ts` passes both in, so this module opens no connection, reads no
 * environment variable and resolves no path.
 */
interface InquiryRouteContext {
  readonly database: Database;
  readonly config: {
    readonly writeRateLimit: { readonly max: number; readonly timeWindow: string };
  };
}

/**
 * The one column this route reads from the inquiry's target listing.
 *
 * `status` is the closed {@link ListingStatus} although the column is stored as text, and that is
 * a true statement about what the column holds: `CHECK (status IN ('active', 'flagged', 'hidden'))`
 * in `packages/shared/migrations/0002_listings_and_versions.sql` is what makes a fourth state
 * unwritable. The listing's `id` is not selected because it is the value the query matched on.
 */
interface InquiryTargetRow {
  readonly status: ListingStatus;
}

/**
 * The one read this file performs: the moderation state of the listing an inquiry names, by its
 * primary key, returning one row at most.
 *
 * It resolves the row rather than trusting the body's identifier, which is what turns an unknown
 * or withdrawn listing into the contract row's `404` before anything is written.
 */
const SELECT_LISTING_STATUS = "SELECT status FROM listings WHERE id = ?";

/**
 * The one insert this file performs: one row of `inquiries` through the five columns
 * `packages/shared/migrations/0003_inquiries.sql` declares, in its order, so this line can be read
 * against that schema line by line.
 *
 * Every value is a bound parameter and none is concatenated into the statement, so a message can
 * never alter the statement it is stored by. `created_at` is bound rather than defaulted because
 * the column carries no default and SQLite's `CURRENT_TIMESTAMP` yields `YYYY-MM-DD HH:MM:SS`,
 * which is not the ISO-8601 UTC form this contract requires.
 */
const INSERT_INQUIRY_SQL =
  "INSERT INTO inquiries (id, listing_id, buyer_account_id, message, created_at) VALUES (?, ?, ?, ?, ?)";

/**
 * The moderation state of a listing an inquiry names, or `undefined` when no listing carries that
 * identifier.
 *
 * The statement is prepared per call because a prepared statement belongs to the connection that
 * made it, and this module owns no connection: the handle is the caller's, as ports and adapters
 * require. SQLite caches the compiled statement itself, so the per-call `prepare` allocates no
 * plan of its own. Nothing is written by this lookup and no audit event is appended for a read.
 *
 * @param database - The caller's database handle.
 * @param listingId - The identifier the request body carries.
 * @returns The stored state of that listing, or `undefined` when the identifier names none.
 */
function readListingStatus(database: Database, listingId: string): ListingStatus | undefined {
  const row = database.prepare<[string], InquiryTargetRow>(SELECT_LISTING_STATUS).get(listingId);

  return row?.status;
}

/**
 * Registers this group's one route — `POST /inquiries` — on the instance it is handed.
 *
 * It returns nothing: the route is registered on `app` and the caller closes the instance. The
 * path is prefix-relative, the versioned prefix being applied exactly once by the sibling
 * `./register-routes` with its encapsulated scope.
 *
 * It answers `201` with the created inquiry, under the entity key `inquiry`, built from the values
 * the insert bound: identifier, listing, the resolved buyer account, the message and the instant,
 * which are the row's five columns and nothing else. No identifier, listing or account the caller
 * supplied is echoed as an error sentence.
 *
 * It refuses: `429` with a `Retry-After` header beyond the configured write rate limit; `400`
 * `validation_error` for a body failing `inquiryCreateBodySchema`; `401` `unauthorized` for a
 * request that carries no demo-session header or one naming no seeded account; `403` `forbidden`
 * for a resolved account that is not a buyer; and `404` `not_found` for a listing identifier that
 * names no listing, or one that has been hidden. Every refusal is an `ApiError` or a Fastify
 * schema rejection mapped by the server's single error handler, so all of them share the one
 * envelope `{ error: { code, message } }`.
 *
 * @param app - The Fastify instance this group registers on.
 * @param context - The database handle and the resolved configuration to register against.
 */
export function registerInquiryRoutes(app: FastifyInstance, context: InquiryRouteContext): void {
  app.post<{ Body: InquiryCreateBody }>(
    "/inquiries",
    {
      schema: { ...demoAccountHeaderSchema, ...inquiryCreateBodySchema },
      config: {
        rateLimit: {
          max: context.config.writeRateLimit.max,
          timeWindow: context.config.writeRateLimit.timeWindow,
        },
      },
    },
    (request, reply) => {
      const account = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "buyer",
      );

      const body: InquiryCreateBody = request.body;
      const listingStatus = readListingStatus(context.database, body.listing_id);

      // An unknown listing and a hidden one are one refusal: the row's `404` is what the contract
      // fixes, and a client has the same next step either way. 'flagged' is deliberately admitted,
      // because the moderation contract hides a listing to withdraw it and flags it to mark it.
      if (listingStatus === undefined || listingStatus === "hidden") {
        throw ApiError.notFound(
          "No listing that is available for inquiries carries this identifier.",
        );
      }

      // The row and the record of it are one unit of work: the transaction returns the inquiry it
      // wrote, and a throw from either statement leaves neither row behind. The identifier and the
      // instant are generated here, at insert time, and never read from a clock anywhere else.
      const writeInquiry = context.database.transaction((): Inquiry => {
        const inquiry: Inquiry = {
          id: randomUUID(),
          listing_id: body.listing_id,
          buyer_account_id: account.id,
          message: body.message,
          created_at: new Date().toISOString(),
        };

        context.database
          .prepare<[string, string, string, string, string]>(INSERT_INQUIRY_SQL)
          .run(
            inquiry.id,
            inquiry.listing_id,
            inquiry.buyer_account_id,
            inquiry.message,
            inquiry.created_at,
          );

        // Inside the transaction above, and with no reason: the five facts of the write are the
        // actor, the action, the new inquiry, the resource type and the status, and the buyer's
        // message is never repeated here.
        appendAuditEvent(context.database, {
          actorAccountId: account.id,
          action: "inquiry.created",
          resourceType: "inquiry",
          resourceId: inquiry.id,
          statusCode: 201,
        });

        return inquiry;
      });

      return reply.code(201).send({ inquiry: writeInquiry() });
    },
  );
}
