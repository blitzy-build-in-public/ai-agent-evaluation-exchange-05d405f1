/**
 * The operator's refund write: `POST /transactions/{id}/refunds`, the row that reverses part or all
 * of a simulated transaction by **appending** to the ledgers the transaction was journalled in.
 *
 * **Nothing on this path edits anything.** A refund is one `refunds` row plus the pair of
 * `ledger_entries` rows `@adem/commerce-sim` builds for it — the marketplace reversal of the charge
 * the simulated checkout took in and the founder-allocation reversal of the allocation that charge
 * produced. No statement reachable from this file changes or removes an existing row, and no
 * replace-style upsert appears in it: `transactions`, `refunds` and `ledger_entries` are three of
 * the nine
 * append-only tables `packages/shared/migrations/0010_append_only_triggers.sql` guards with an
 * aborting trigger, and the guarantee those triggers back up is held here — the correction a refund
 * records is a new row proportional to what it corrects. A reader may confirm by construction: the
 * only writes this file can cause are the domain package's two inserts and the audit append.
 *
 * **The eligibility rule and the reversal arithmetic live in the domain package, and this file asks
 * neither question.** How much a transaction has left to refund is derived on every call from the
 * `refunds` rows that reference it and is stored nowhere, so no balance exists here to read, to
 * cache or to pre-check; a route-side check would be a second source of truth for a value the refund
 * rows already state, and it would drift from the domain's the moment a refund landed between the
 * two reads. This file passes the amount through and maps what comes back.
 *
 * **The statuses come from the refusal, not from a branch here.** `createRefund` answers a
 * discriminated result whose failing arm names one of four reasons, and `ERROR_STATUS` in
 * `apps/api/src/errors/error-codes.ts` — the product's one code-to-status map — supplies the
 * contract's status for that reason: `transaction_not_found` `404`, `already_fully_refunded` `409`,
 * `exceeds_net_remaining` `422` and `invalid_amount` `400`. The refusal keeps the domain's own
 * stable string as the envelope's `code`, which is what that module documents the vocabulary for.
 * A refusal writes nothing at all: the domain returns before its transaction opens, and this file's
 * own throw rolls back the enclosing transaction in which nothing was written.
 *
 * **One transaction for the refund, its reversals and the record of it.** The domain's write and the
 * audit append run inside a single `db.transaction(...)`, so a refund that failed to append its
 * reversals, or a write whose audit row failed to land, leaves neither behind. `createRefund` opens
 * its own transaction for the refund row and the reversal pair; better-sqlite3 nests that as a
 * savepoint inside this one.
 *
 * **A zero amount reaches the domain, and is refused there.** The shared body schema
 * `packages/shared/src/schemas/commerce-schema.ts` declares `minimum: 0` deliberately, so `0` is
 * admitted at the edge and refused by the domain as `invalid_amount` — the `400` below. A refund of
 * nothing would record an act that did not happen. A negative or fractional amount never reaches the
 * domain: the schema's `type: 'integer'` and `minimum: 0` refuse it first, and that failure is the
 * server's `400 validation_error`.
 *
 * **The failure order is the contract's.** Rate limit, then JSON-schema validation of the params,
 * the body and the demo header, then `401` for a header that names no seeded account, then `403` for
 * a resolved account that is not the operator, then the domain call inside one transaction, then
 * `201`. The header is a synthetic role selector and never authentication: it separates roles for a
 * demonstration and asserts nothing about who the caller is, so this row — like every non-public row
 * — attaches the shared header schema and requires the operator role of the account it resolves.
 *
 * **Every amount stays an integer of minor units of the one synthetic label, and every entry says
 * so.** The response carries the appended reversal entries as the stored rows they are, each with
 * its own `currency_label` and its `disclosure_label`, and the refund row the domain appended. The
 * `refunds` table holds no currency column by design — the amount it records is a count of minor
 * units of the same synthetic currency as the transaction it reverses — so the label an amount is
 * read in arrives on the entries beside it. No currency symbol, no real currency code and no
 * payment-provider vocabulary appears in this file or in anything it answers with.
 */

// The handle's type is imported by name because `@types/better-sqlite3` declares the instance shape
// as a member of the namespace its `export =` also exports, so a default *type* import of that
// package resolves to the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { LedgerEntry, Refund, RefundCreateBody } from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  demoAccountHeaderSchema,
  refundCreateBodySchema,
  transactionIdParamsSchema,
} from "@adem/shared";

import type { RefundRefusalReason, RefundResult } from "@adem/commerce-sim";
import { createRefund } from "@adem/commerce-sim";

import { appendAuditEvent } from "../audit/append-audit-event";
import { requireRole } from "../auth/require-role";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import type { ApiConfig } from "../config";
import { ERROR_STATUS } from "../errors/error-codes";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this write needs: the open database handle and the
 * resolved configuration.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the members structurally instead of importing that type, so that this file and the
 * `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` and an `ApiConfig` is assignable to this shape, so the registrar's call site
 * is unaffected.
 *
 * Both members are bound to names because both are used: the handle for the domain call, the audit
 * append and the enclosing transaction, and the configuration for the resolved write rate limit and
 * for `commerce`, the resolved fictional assumptions `createRefund` computes from. The configuration
 * is resolved once by `apps/api/src/config.ts`, so this file calls no resolver of its own.
 */
interface RefundRouteContext {
  /** The open database handle, supplied by the composition root. */
  readonly database: Database;
  /** The resolved API configuration, supplying the write rate limit and the commerce assumptions. */
  readonly config: ApiConfig;
}

/**
 * The path this write is served at, prefix-relative.
 *
 * The versioned prefix is applied exactly once, by `./register-routes`, which calls this function
 * with its encapsulated scope. The prefix's literal appears nowhere in this file and must not: a
 * group that spelled it would be the second place the prefix is decided.
 */
const REFUNDS_PATH = "/transactions/:id/refunds";

/**
 * The sentence a client reads for each refusal, keyed by the reason the domain package states.
 *
 * Typed as a total `Record` over {@link RefundRefusalReason}, so a fifth refusal the domain adds
 * fails the build here rather than reaching a client as an unexplained status. Each sentence says
 * what the request did and names no identifier, path, statement or driver message: the envelope's
 * message gate in `apps/api/src/errors/error-envelope.ts` substitutes a generic sentence for
 * anything that reads like a trace, and these are written to pass it as they stand.
 */
const REFUND_REFUSAL_MESSAGES: Readonly<Record<RefundRefusalReason, string>> = Object.freeze({
  /** `404`: no simulated transaction carries the identifier in the path. */
  transaction_not_found: "No simulated transaction carries the requested identifier.",
  /** `409`: the refund rows already account for the transaction's whole amount. */
  already_fully_refunded:
    "This simulated transaction has already been refunded in full, so there is nothing left to reverse.",
  /** `422`: the amount is larger than the transaction's derived net remaining. */
  exceeds_net_remaining:
    "The requested amount is larger than this simulated transaction has left to refund.",
  /** `400`: the amount is not a whole count of at least one minor unit. */
  invalid_amount:
    "The requested amount must be a whole number of at least one minor unit of the synthetic currency.",
});

/**
 * The refusal of {@link createRefund} as the error this route throws: the contract's status, the
 * domain's own stable code and the sentence above.
 *
 * The status is looked up in `ERROR_STATUS` rather than written here, so the mapping from code to
 * status exists once in this workspace; the code is the reason exactly as the domain package spells
 * it, which is the form `apps/api/src/errors/error-codes.ts` documents for a domain refusal and the
 * form the web client's own documentation of this row cites (`transaction_not_found`,
 * `already_fully_refunded`, `exceeds_net_remaining`, `invalid_amount`). `RefundRefusalReason`'s four
 * members are all members of the closed `ApiErrorCode` union, so a reason is assignable as the code
 * without a cast, and a reason outside that union cannot be constructed.
 */
function refusalError(reason: RefundRefusalReason): ApiError {
  return new ApiError(ERROR_STATUS[reason], reason, REFUND_REFUSAL_MESSAGES[reason]);
}

/**
 * The `201` body of this row: the reversal entries the refund appended, and the refund row itself.
 *
 * The entries sit under `entries`, which is the first key the web client's list reader looks for on
 * this response (`apps/web/src/api-client.ts`'s `refundTransaction` reads the array under `entries`
 * or `items`), and they are the two rows as they were stored — the marketplace reversal first and
 * the founder-allocation reversal second, in the order they were written, each carrying the
 * transaction it reverses, an explicit `null` report reference, its integer amount in minor units of
 * the synthetic currency, its `currency_label` and its `disclosure_label`, and the plain-language
 * description that says it is a simulated reversal.
 *
 * `refund` is the appended `refunds` row: its identifier, the transaction it reverses, the integer
 * amount and the instant it was recorded. The response carries no total, no balance and no count of
 * what a transaction has left — a net position is derived from the refund rows on each read and is
 * stored nowhere, so publishing one here would publish a figure with no owner.
 */
interface RefundReversalResult {
  /** The two reversal entries appended for this refund, in the order they were written. */
  readonly entries: LedgerEntry[];
  /** The refund row this call appended. */
  readonly refund: Refund;
}

/**
 * Registers this row — the operator's refund write — on the instance it is handed.
 *
 * The route carries three request contracts and one option. `demoAccountHeaderSchema` is what makes
 * an absent header a failure at the edge, which the server's single error handler answers `401`
 * rather than the framework's `400`; `transactionIdParamsSchema` requires the non-empty transaction
 * identifier in the path; `refundCreateBodySchema` requires `amount_minor_units` and nothing else,
 * so a client that sends a `transaction_id` or an amount field of its own alongside a valid body has
 * the field removed before this handler runs rather than acted on — the transaction comes from the
 * path and the amount from the one field, so neither can be stated twice in two places that could
 * disagree. The rate limit is the resolved write limit from the configuration, applied to this route
 * alone because `@fastify/rate-limit` is registered `global: false`: writes are capped and reads are
 * not, and exceeding the cap is answered `429` with a `Retry-After` header by the plugin.
 *
 * Nothing is caught in the handler. The server's single error handler owns
 * `{ error: { code, message } }`, so a refusal thrown here — this file's own, from the domain's
 * reason — reaches the client through the one place that builds a failure body, and no
 * handler-local error body exists to disagree with it.
 *
 * @param app The instance or the encapsulated scope the group is registered on; the versioned prefix
 *   is applied by the caller.
 * @param context The open database handle and the resolved configuration.
 */
export function registerRefundRoutes(app: FastifyInstance, context: RefundRouteContext): void {
  app.post<{ Params: { id: string }; Body: RefundCreateBody }>(
    REFUNDS_PATH,
    {
      schema: {
        ...demoAccountHeaderSchema,
        ...transactionIdParamsSchema,
        ...refundCreateBodySchema,
      },
      config: {
        rateLimit: {
          max: context.config.writeRateLimit.max,
          timeWindow: context.config.writeRateLimit.timeWindow,
        },
      },
    },
    (request, reply) => {
      // The operator and nobody else: `401` when the header names no seeded account, `403` when it
      // names one whose role is not the operator's. The resolved account is the actor of the audit
      // event below and the operator the refund row records.
      const operator = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "operator",
      );

      const appendRefund = context.database.transaction((): RefundResult => {
        const result = createRefund(context.database, {
          transactionId: request.params.id,
          amountMinorUnits: request.body.amount_minor_units,
          operatorAccountId: operator.id,
          config: context.config.commerce,
        });

        // A refusal is thrown rather than returned, so the enclosing transaction is rolled back
        // around the throw. Nothing was written on this path — the domain returns before its own
        // transaction opens — so the rollback has nothing to undo, and it keeps that true if the
        // domain's refusal paths ever change.
        if (!result.ok) {
          throw refusalError(result.reason);
        }

        // Inside the same transaction as the append, so the refund and the record of it are
        // indivisible: a request that failed after this line would leave neither behind.
        appendAuditEvent(context.database, {
          actorAccountId: operator.id,
          action: "refund.created",
          resourceType: "refund",
          resourceId: result.refund.id,
          statusCode: 201,
        });

        return result;
      });

      const { refund, reversalEntries } = appendRefund();
      const body: RefundReversalResult = { entries: reversalEntries, refund };

      return reply.code(201).send(body);
    },
  );
}
