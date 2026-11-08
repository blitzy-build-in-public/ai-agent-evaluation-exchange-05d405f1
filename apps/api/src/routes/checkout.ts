/**
 * The simulated checkout: `POST /checkout-simulations`, the one row of the API contract table a
 * buyer completes a purchase through, and the only fictional price in the product.
 *
 * One request does three things in order: it resolves the buyer from the demo session, it resolves
 * the listing and the version the request names together with the offers that listing makes, and it
 * hands those offers to `@adem/commerce-sim`'s `createCheckoutSimulation`, which inserts the
 * transaction, the marketplace charge taken in by it and the founder allocation computed from that
 * charge. This file adds the audit append to the same unit of work by calling the domain inside a
 * `db.transaction(...)` of its own — better-sqlite3 nests the domain's own transaction as a
 * savepoint — so the write and the record of it succeed or fail together, and a refusal leaves the
 * store exactly as it found it.
 *
 * **The amount is not a client input.** The body is `{ listing_id, listing_version_id, offer_model }`
 * — `checkoutSimulationBodySchema` declares no price column and no amount is read from the request
 * here. Each listing's offers are built in this file from the pricing models that listing's own
 * claims state, priced by the one fictional table below, so a buyer cannot name the price of its own
 * simulated purchase.
 *
 * **That table lives here and nowhere else.** {@link BASE_OFFER_AMOUNTS_MINOR_UNITS} maps each of the
 * four offer models to a base amount in whole minor units of the synthetic currency, and
 * `purchase: 10000` is fixed by the plan so that the ledger arithmetic of criterion 6 — ten thousand
 * minor units producing a founder allocation of twenty-five — is reachable end to end from the
 * seeded listings, which cover all four models. The table is module-local, unexported and frozen: a
 * second copy in the configuration, in the seed or in the domain package would be a second price for
 * one product.
 *
 * **No arithmetic happens here, and no float may appear in this file.** The allocation rate, the
 * gate-evaluation fee, the net amount and the half-up rounding all belong to `@adem/commerce-sim`,
 * whose `allocate` is the product's single rounding point; nothing here multiplies, divides, rounds
 * or formats an amount, and the figure that reaches the response is the figure the domain stored.
 *
 * **The status comes from the domain's refusal, not from a branch in this file.** A model the listing
 * does not make and an offer whose amount is not a whole number of minor units are decided by
 * `createCheckoutSimulation`, which answers `{ ok: false, reason }`; {@link REFUSALS} maps each reason
 * to the code the contract gives it and `ERROR_STATUS` supplies the status. Whether *this* listing
 * makes *this* model is deliberately not re-derived here: the domain owns that rule, the request
 * schema owns the four-model vocabulary, and the two cannot disagree with its answer.
 *
 * **The demo session is a role selector and never authentication.** `resolveDemoAccount` answers `401`
 * for an absent, blank or unresolvable `X-Demo-Account` header and `requireRole` answers `403` for a
 * resolvable account whose role is not this row's `buyer`, exactly as every other non-public row of
 * the contract works.
 *
 * **A simulated purchase must read as simulated.** The payload is the stored transaction: it states
 * `simulated: true`, carries the synthetic currency label `DEMO` and carries the nonfunctional
 * disclosure label, and it can carry nothing else — no column of the table behind it could hold a
 * real currency code, a payment instrument, a processing intermediary's reference or a financial
 * account number, and no payment-provider vocabulary appears in this file. No real payment exists,
 * so no refusal of one ever arises.
 *
 * **It writes nothing itself.** No statement in this file inserts, amends or removes a row, and no
 * `PUT`, `PATCH` or `DELETE` handler is registered: `transactions` and `ledger_entries` are both among
 * the nine append-only tables of `packages/shared/migrations/0010_append_only_triggers.sql`, the only
 * write either accepts is the inserted row the domain package performs, and a `404` or a `422` leaves
 * both tables untouched — which `apps/api/test/integration/immutability.test.ts` and the route walk
 * assert by counting rows across a refused checkout.
 *
 * **Nothing here measures anything and nothing here names anyone.** The row records a simulated
 * checkout by a synthetic demo account, and no amount written on this path is read by an evaluation:
 * the route imports no scoring code, and no commercial value can reach a measurement through it.
 */

// `@fastify/rate-limit` is imported for its declarations: it declares the `config.rateLimit` route
// option through a `declare module "fastify"` augmentation over an otherwise empty
// `FastifyContextConfig`, so a route that names that option without loading the declaration would be
// read as passing an unknown option.
import type { RateLimitOptions } from "@fastify/rate-limit";
// The handle's type is imported by name because `@types/better-sqlite3` exports a namespace whose
// `Database` member is the instance interface, so a default *type* import of that package resolves to
// the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import {
  DEMO_ACCOUNT_HEADER,
  OFFER_MODELS,
  checkoutSimulationBodySchema,
  demoAccountHeaderSchema,
} from "@adem/shared";
import type { CheckoutSimulationBody, OfferModel, Transaction } from "@adem/shared";

import { createCheckoutSimulation } from "@adem/commerce-sim";
import type { CheckoutSimulationRefusalReason, ListingOffer } from "@adem/commerce-sim";

import { appendAuditEvent } from "../audit/append-audit-event";
import { requireRole } from "../auth/require-role";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import type { ApiConfig } from "../config";
import { ERROR_STATUS } from "../errors/error-codes";
import type { ApiErrorCode } from "../errors/error-codes";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this group needs: the open database handle, which
 * arrives by closure from the server factory rather than through Fastify plugin options, and the
 * resolved configuration, from which the route takes the write rate limit it registers and the
 * fictional commerce assumptions it passes to the domain.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the two members structurally instead of importing that type, so that this file and
 * the `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` and an `ApiConfig` is assignable to this shape, so the registrar's call site
 * is unaffected.
 *
 * `config` is the API's own resolved configuration and not a second resolution: `apps/api/src/config.ts`
 * has already resolved the commerce section through `@adem/commerce-sim`, so this route never calls
 * `resolveCommerceConfig()` and never restates a fee, a rate or a label.
 */
interface CheckoutRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * One stored row of `listings`, in the shape this route reads it: the identifier, the pricing model
 * the listing declares and its moderation status.
 *
 * Three columns rather than the whole row, because three are all this route asks of a listing: it
 * names the listing to the domain, it derives the fallback offer set from the declared model, and it
 * refuses a listing the operator has hidden.
 *
 * `pricing_model` and `status` are plain strings here although both columns carry `CHECK` constraints
 * enumerating their values: the columns are stored as text, and narrowing them is the mapping step's
 * job — the same shape `apps/api/src/auth/resolve-demo-account.ts` uses for a stored role.
 */
interface StoredListingRow {
  readonly id: string;
  readonly pricing_model: string;
  readonly status: string;
}

/**
 * The one fact this route reads from `listing_versions`: the identifier of a version that belongs to
 * the listing named in the same request.
 *
 * The version row itself is not needed. The domain writes its reference from the identifier it is
 * given, and the pair's existence is what the select below establishes.
 */
interface StoredListingVersionRow {
  readonly id: string;
}

/**
 * The one fact this route reads from `listing_claims`: the pricing model a claim records for its
 * version, and therefore one of the offers that version makes.
 */
interface StoredListingClaimRow {
  readonly pricing_model: string;
}

/**
 * The one query this route runs against `listings`: the listing the body names, by its primary key.
 *
 * The three columns {@link StoredListingRow} declares are named explicitly rather than selected with
 * `*`, so a column a later migration adds stays out of this result until the interface above and this
 * line are updated together.
 */
const SELECT_LISTING_SQL = `SELECT id, pricing_model, status FROM listings WHERE id = ?`;

/**
 * The one query this route runs against `listing_versions`: the version the body names, **and only
 * when it belongs to the listing the same body names**.
 *
 * Both identifiers arrive in the body, so the parent-and-child relationship between them is a claim
 * the request makes rather than a fact this route can assume: the `listing_id` predicate is what
 * verifies it in the same statement that resolves the version, so a version of another listing is
 * answered with the same `404` an unknown version is, and no second lookup exists for the two to
 * disagree across.
 */
const SELECT_LISTING_VERSION_SQL = `SELECT id FROM listing_versions WHERE id = ? AND listing_id = ?`;

/**
 * The one query this route runs against `listing_claims`: the pricing models one version's claims
 * record, in the order the rows were inserted.
 *
 * A claim is the unit in which a version states what it does and at what price, so these rows — not
 * the listing row alone — are the offers a version makes. The seeded database writes one claim per
 * version, each repeating the pricing model of its listing; the shape is a list rather than a single
 * value because the table holds many claims to a version and this query asks the question the table
 * can answer.
 */
const SELECT_VERSION_CLAIMS_SQL = `SELECT pricing_model FROM listing_claims WHERE listing_version_id = ?`;

/**
 * The request path this group owns, prefix-relative.
 *
 * The versioned prefix — `API_PREFIX`, from `apps/api/src/server.ts` — is applied exactly once, by
 * `./register-routes`, which calls the function below with its encapsulated scope. That literal
 * appears nowhere in this file and must not: a group that spelled it would be the second place the
 * prefix is decided.
 */
const CHECKOUT_SIMULATION_PATH = "/checkout-simulations";

/**
 * The status a completed simulated checkout answers with, and the status its audit event records.
 *
 * Named once because the two must state the same thing: the row an operator reads back from the audit
 * feed says how the write it records ended, so the number the handler sends and the number it appends
 * are one value rather than two literals that could drift apart.
 */
const CREATED_STATUS = 201;

/**
 * The one moderation status that makes a listing unavailable to a buyer.
 *
 * `hidden` removes a listing from search and compare while leaving it readable, with its history, to
 * the operator; `flagged` stays readable with its status stated. A checkout is a buyer's act on a
 * listing, so a hidden listing is answered with the same `404` an unknown one is, and a flagged
 * listing is priced as usual.
 */
const HIDDEN_LISTING_STATUS = "hidden";

/**
 * The sentence a request for a listing that does not exist, or that the operator has hidden, is
 * answered with.
 *
 * One sentence for both cases on purpose: a hidden listing is not concealed from the operator but it
 * is not offered to a buyer, and a message that distinguished the two would report a moderation
 * decision the buyer has no business reading. It names no identifier, no row count and no column.
 */
const LISTING_NOT_FOUND_MESSAGE = "The listing this request names is not available.";

/**
 * The sentence a request naming a version that does not exist, or that belongs to another listing, is
 * answered with.
 *
 * The second case is stated as the first because it is indistinguishable to a buyer and because
 * distinguishing them would confirm the existence of a version under a listing the request did not
 * name.
 */
const LISTING_VERSION_NOT_FOUND_MESSAGE = "The listing version this request names is not available.";

/**
 * The product's one fictional price table: the amount each offer model is made at, as a whole number
 * of minor units of the synthetic currency.
 *
 * **`purchase: 10000` is a contract value, not a preference.** Ten thousand minor units is the
 * simulated purchase criterion 6 is asserted with — an eligible completed transaction of that size
 * produces a founder allocation of twenty-five at the default rate of 25 basis points — so the seeded
 * listings that declare `purchase` must be checked out at that amount for the arithmetic to be
 * reachable end to end. The other three are this file's own documented fictional amounts: they are
 * plain non-negative integers, each distinct so that a checkout of one model is tellable from a
 * checkout of another in a ledger read, and none is a decimal, a currency code or a symbol.
 *
 * The table has exactly one consumer, this route, and it is deliberately neither exported nor
 * duplicated: `apps/api/src/config.ts` holds no price, `packages/commerce-sim` holds none (its
 * `selectOffer` resolves an amount from the offers it is given and invents no price), and the seed
 * writes no amount, so this is the single place a simulated purchase is priced.
 */
const BASE_OFFER_AMOUNTS_MINOR_UNITS: Readonly<Record<OfferModel, number>> = Object.freeze({
  purchase: 10000,
  rent: 2500,
  license: 7500,
  subscription: 5000,
});

/**
 * How one of the domain's two refusals is answered: the code the closed vocabulary gives it and the
 * sentence a client reads.
 *
 * The status is not held here. {@link ERROR_STATUS} owns every code-to-status mapping, so a code's
 * status exists once in the workspace, and a refusal's status cannot be chosen at a route.
 */
interface RefusalResponse {
  /** The code the failure's envelope carries, from the workspace's closed vocabulary. */
  readonly code: ApiErrorCode;
  /** The short client-facing sentence the failure is answered with. */
  readonly message: string;
}

/**
 * The two refusals of the checkout path, each as the contract gives it.
 *
 * `not_offered` — the listing does not make the model the buyer selected, or makes no offer at all —
 * is the row's `422 not_offered`, and it is decided by the domain before anything is written.
 * `invalid_amount` is the `400 validation_error` the request schema answers with at the edge for
 * every case it can see; it is mapped here for the case it cannot, a server-assembled offer whose
 * amount is not a whole number of minor units, which the domain refuses rather than storing.
 *
 * The sentences are short, name the request rather than a row or a driver, and contain no newline, no
 * path, no SQL keyword and no echoed value, so they can be sent as written.
 */
const REFUSALS: Readonly<Record<CheckoutSimulationRefusalReason, RefusalResponse>> = Object.freeze({
  not_offered: Object.freeze({
    // The domain's own string, and not a generic name for the status: a route maps a refusal by the
    // code the package that produces it spells, which is what `./error-codes` documents as the rule
    // and what the envelope's mapper preserves, so a client reads what was refused rather than that
    // something was unprocessable.
    code: "not_offered",
    message: "This listing does not make the offer model the request selected.",
  }),
  invalid_amount: Object.freeze({
    code: "validation_error",
    message: "The amount of the selected offer is not a whole number of minor units.",
  }),
});

/**
 * The error one of the domain's refusals is answered with.
 *
 * The status comes from {@link ERROR_STATUS} for the code {@link REFUSALS} pairs with the reason, so
 * no status is written at this call site and a code's status has one definition in the workspace. The
 * result is an {@link ApiError}, which the server's single error handler returns unchanged, so no
 * handler-local error body exists to disagree with the envelope.
 */
function refusalError(reason: CheckoutSimulationRefusalReason): ApiError {
  const response = REFUSALS[reason];

  return new ApiError(ERROR_STATUS[response.code], response.code, response.message);
}

/**
 * The offer model a stored pricing model names, or `null` when the text names none of the four.
 *
 * The narrowing is a search of {@link OFFER_MODELS} rather than a cast, the same way
 * `apps/api/src/auth/resolve-demo-account.ts` narrows a stored role through `ACCOUNT_ROLES`: the
 * tuple, not this function, is what makes the vocabulary closed, and a value outside it yields `null`
 * instead of being asserted into the type.
 *
 * The listing columns and the offer vocabulary share their four members — `listings.pricing_model`,
 * `listing_claims.pricing_model` and `transactions.offer_model` all carry the same `CHECK` constraint
 * — so a listing's own declared model and the model of an offer a checkout selects are drawn from one
 * set, and this function is the step between the stored text and the type the domain's offer carries.
 */
function toOfferModel(storedPricingModel: string): OfferModel | null {
  const model: OfferModel | undefined = OFFER_MODELS.find(
    (candidate) => candidate === storedPricingModel,
  );

  return model ?? null;
}

/**
 * The stored listing the body names, or `null` when `listings` holds no row for that identifier.
 *
 * `null` rather than `undefined` so the caller's absence check reads as one comparison, and so the
 * return type states the absence rather than leaving it to the driver's own convention. A listing the
 * operator has hidden is returned like any other: hiding is a moderation state this route reads from
 * the row, not a row that stops existing.
 *
 * The statement is prepared per call because a prepared statement belongs to the connection that made
 * it and this module owns no connection: the handle is the caller's, as ports and adapters require.
 * SQLite caches the compiled statement itself, so the per-call `prepare` allocates no plan of its own.
 */
function readListing(database: Database, listingId: string): StoredListingRow | null {
  const row = database.prepare<[string], StoredListingRow>(SELECT_LISTING_SQL).get(listingId);

  return row ?? null;
}

/**
 * The identifier of the version the body names, or `null` unless that version belongs to the listing
 * named in the same request.
 *
 * Returning the identifier rather than a row keeps this route's use of a version to the one fact it
 * needs: a reference to hand the domain. Both parameters bind to the query, so the relationship is
 * verified by the statement that resolves it rather than by a comparison made afterwards.
 */
function readListingVersionId(
  database: Database,
  listingId: string,
  listingVersionId: string,
): string | null {
  const row = database
    .prepare<[string, string], StoredListingVersionRow>(SELECT_LISTING_VERSION_SQL)
    .get(listingVersionId, listingId);

  return row?.id ?? null;
}

/**
 * Registers this group's one route — `POST /checkout-simulations` — on the instance it is handed.
 *
 * The failure order is the contract's and is visible in the handler's statements: the rate limit and
 * the two schemas run before the handler at all, then the demo session is resolved (`401` for an
 * absent, blank or unresolvable header) and the role asserted (`403` for a resolvable account that is
 * not this row's `buyer`), then the listing and the version are resolved (`404` for either), then the
 * domain is called inside one transaction and the write's audit event appended in the same unit, and
 * only then is the transaction sent as `201`.
 *
 * The two route options are the ones the contract fixes for a write. `schema` is the pair the request
 * must satisfy: the demo-account header contract, which is what makes an absent header a validation
 * failure that the server's error handler answers `401` for this header, and the checkout body
 * contract, which fixes the three required strings and the four-model vocabulary the `offer_model`
 * value is drawn from. `config.rateLimit` is the write limit — at most the resolved maximum of writes
 * per client per resolved window, answered `429` with a `Retry-After` header beyond it — and both
 * numbers come from the resolved configuration rather than from a literal here.
 *
 * The handler is synchronous, because everything it calls is: better-sqlite3 runs on the calling
 * thread, and a callback returning a promise would throw rather than commit. It writes no error body
 * and catches nothing — the server's single error handler owns `{ error: { code, message } }`, and an
 * `ApiError` thrown from inside the transaction is returned by that handler unchanged after the
 * transaction has rolled back.
 */
export function registerCheckoutRoutes(app: FastifyInstance, context: CheckoutRouteContext): void {
  const rateLimit: RateLimitOptions = Object.freeze({
    max: context.config.writeRateLimit.max,
    timeWindow: context.config.writeRateLimit.timeWindow,
  });

  app.post<{ Body: CheckoutSimulationBody }>(
    CHECKOUT_SIMULATION_PATH,
    {
      schema: { ...demoAccountHeaderSchema, ...checkoutSimulationBodySchema },
      config: { rateLimit },
    },
    (request, reply) => {
      // `resolveDemoAccount` precedes `requireRole` and the order is fixed: `401` when the header
      // names no seeded account, `403` when the account it names is not the buyer this row requires.
      // The account is bound because its identifier is the actor of the audit event below.
      const account = requireRole(
        resolveDemoAccount(context.database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "buyer",
      );

      const listing = readListing(context.database, request.body.listing_id);

      if (listing === null || listing.status === HIDDEN_LISTING_STATUS) {
        throw ApiError.notFound(LISTING_NOT_FOUND_MESSAGE);
      }

      const listingVersionId = readListingVersionId(
        context.database,
        listing.id,
        request.body.listing_version_id,
      );

      if (listingVersionId === null) {
        throw ApiError.notFound(LISTING_VERSION_NOT_FOUND_MESSAGE);
      }

      // The offers are assembled once, from this listing version's own claims, and handed to the
      // domain below. The domain decides whether they include the requested model; this file never
      // answers that question itself, so the contract's `422` and the offer rule have one owner.
      const offers = offersForListing(context.database, listing, listingVersionId);

      // `createCheckoutSimulation` opens its own transaction over the transaction row and both ledger
      // entries. This enclosing transaction adds the audit append to that unit — better-sqlite3 nests
      // the inner one as a savepoint — so a failure in the append rolls the domain's three rows back
      // with it and a write is never recorded without the feed event that records it.
      //
      // The callback is synchronous on purpose: better-sqlite3 runs on the calling thread, and a
      // callback returning a promise throws rather than committing. Returning the transaction's own
      // value is what makes the two writes one act.
      const transaction = context.database.transaction((): Transaction => {
        const checkout = createCheckoutSimulation(context.database, {
          listingId: listing.id,
          listingVersionId,
          offerModel: request.body.offer_model,
          offers,
          buyerAccountId: account.id,
          config: context.config.commerce,
        });

        if (!checkout.ok) {
          // A refusal is thrown inside the transaction rather than answered outside it: the domain
          // has written nothing at this point, and rolling back the enclosing transaction is what
          // guarantees the refusal stays a refusal even if an earlier statement of the domain's own
          // transaction had already run.
          throw refusalError(checkout.reason);
        }

        appendAuditEvent(context.database, {
          actorAccountId: account.id,
          action: "checkout.simulated",
          resourceType: "transaction",
          resourceId: checkout.transaction.id,
          statusCode: CREATED_STATUS,
        });

        return checkout.transaction;
      })();

      // The payload is the stored row and nothing else: it carries the identifier, the buyer, the
      // listing and the version, the offer model, the amount as a whole number of minor units, the
      // synthetic currency label, the literal `simulated: true` and the disclosure label. No field
      // of it names a payment instrument, an account or a provider, and none may be added.
      return reply.code(CREATED_STATUS).send(transaction);
    },
  );
}

/**
 * The offers one listing version makes: one entry per pricing model its claims record, each priced by
 * {@link BASE_OFFER_AMOUNTS_MINOR_UNITS}.
 *
 * The claims are the source because a claim is what a version states about itself, and a checkout
 * selects among what the version states rather than among a vocabulary. A model claimed twice yields
 * one entry — the first occurrence, which is the entry `selectOffer` would select anyway, so summing
 * or preferring a later duplicate would invent pricing behaviour nothing asks for. A claimed model
 * outside the four-member vocabulary is skipped rather than asserted into the type: the seed and the
 * schema are what make such a row unwritable, and a value that arrived anyway is no offer a buyer can
 * act on.
 *
 * A version that carries no claim at all — a version a developer has just published, before any claim
 * is recorded for it — falls back to the pricing model the listing row itself declares. That keeps
 * the checkout usable against a freshly published version while still pricing it from the listing's
 * own data: the fallback is the listing's declared model and never a default invented here, and a
 * listing whose model is also outside the vocabulary yields no offer, which the domain answers
 * `not_offered` and the route answers `422`.
 */
function offersForListing(
  database: Database,
  listing: StoredListingRow,
  listingVersionId: string,
): ListingOffer[] {
  const offers: ListingOffer[] = [];

  const claimRows = database
    .prepare<[string], StoredListingClaimRow>(SELECT_VERSION_CLAIMS_SQL)
    .all(listingVersionId);

  for (const row of claimRows) {
    const model = toOfferModel(row.pricing_model);

    if (model !== null && !offers.some((offer) => offer.model === model)) {
      offers.push({ model, amountMinorUnits: BASE_OFFER_AMOUNTS_MINOR_UNITS[model] });
    }
  }

  if (offers.length === 0) {
    const model = toOfferModel(listing.pricing_model);

    if (model !== null) {
      offers.push({ model, amountMinorUnits: BASE_OFFER_AMOUNTS_MINOR_UNITS[model] });
    }
  }

  return offers;
}
