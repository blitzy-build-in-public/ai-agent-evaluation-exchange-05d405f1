/**
 * The route registrar: the one place the fourteen route groups are mounted, and the one place the
 * versioned prefix is applied.
 *
 * This module declares no handler, holds no business rule, issues no query and declares no schema of
 * its own: the scope's one request-body policy is registered here, through
 * {@link registerRequestBodyPolicy}, and every JSON schema a route validates against stays in its
 * group. It imports the fourteen group registrars, calls each one with an encapsulated scope that
 * carries the prefix and with the resolved {@link RouteContext}, and stops there. Each group owns its
 * own paths, its own JSON schemas, its own role checks and its own rate-limit options; the composition
 * root owns the error handler, the rate-limit plugin and the static handler. Nothing in this file
 * repeats any of that work.
 *
 * **The prefix is applied exactly once, here.** Fastify's own encapsulation is what makes that true:
 * every group is handed the scoped instance created by `app.register(..., { prefix })`, so a group
 * cannot reach the root instance and cannot leak a path outside the prefix. {@link API_PREFIX} is the
 * single spelling of the prefix in this workspace; the composition root imports it from here rather
 * than restating it, which is why no other file under `apps/api/src` contains the literal.
 *
 * **Order.** The registration order below is the order of the API contract's resource groups —
 * listings, compare, inquiries, challenges, threads, standards, evaluations, appeals, checkout,
 * refunds, ledgers, moderation, sponsored, audit — so reading this function reads like the contract
 * table. Order carries no behaviour: each group registers distinct paths.
 *
 * **The rows this register makes reachable**, prefix-relative, one rule resolving every one of them:
 * reads are public except the three `GET /ledger/*` rows and `GET /audit-events`, and every
 * non-public row requires the `X-Demo-Account` header naming a seeded account — absent or
 * unresolvable yields `401`, a resolvable account whose role does not match the row yields `403`.
 * Every failure, whichever layer raised it, is answered with the one error envelope
 * `{ error: { code, message } }` by the composition root's single error handler. Write rows are
 * rate-limited per client and answer `429` with a `Retry-After` header beyond the bound, declared
 * per route by each group from the resolved configuration.
 *
 * | Group | Rows it registers |
 * | --- | --- |
 * | `listings.ts` | `GET /listings`, `GET /listings/:id`, `POST /listings`, `POST /listings/:id/versions` |
 * | `compare.ts` | `GET /compare` |
 * | `inquiries.ts` | `POST /inquiries` |
 * | `challenges.ts` | `GET /challenges`, `POST /challenges`, `POST /challenges/:id/responses` |
 * | `threads.ts` | `GET /threads`, `POST /threads`, `POST /threads/:id/posts` |
 * | `standards.ts` | `GET /standards`, `GET /standards/:id/versions/:v`, `POST /standards/proposals`, `POST /standards/proposals/:id/review` |
 * | `evaluations.ts` | `POST /evaluations`, `GET /evaluations/:id` |
 * | `appeals.ts` | `POST /evaluations/:id/appeals`, `POST /appeals/:id/ruling` |
 * | `checkout.ts` | `POST /checkout-simulations` |
 * | `refunds.ts` | `POST /transactions/:id/refunds` |
 * | `ledgers.ts` | `GET /ledger/marketplace`, `GET /ledger/gate-fees`, `GET /ledger/founder-allocation` |
 * | `moderation.ts` | `POST /moderation/listings/:id/actions` |
 * | `sponsored.ts` | `GET /sponsored-slots` |
 * | `audit.ts` | `GET /audit-events` |
 *
 * **No method but `GET` and `POST` exists in this register**, and none may be added: an update or a
 * delete of a measurement, a report, a governance event or a ledger entry is unreachable by design,
 * and Fastify answers an unregistered method on a registered path with the same `404` envelope it
 * answers an unregistered path, which is the behaviour the immutability proof depends on. A
 * method-not-allowed branch would break that and is deliberately absent.
 *
 * Every path here is prefix-relative because the prefix is applied once, above them all.
 */

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { ApiConfig } from "../config";

import { registerAppealRoutes } from "./appeals";
import { registerAuditRoutes } from "./audit";
import { registerChallengeRoutes } from "./challenges";
import { registerCheckoutRoutes } from "./checkout";
import { registerCompareRoutes } from "./compare";
import { registerEvaluationRoutes } from "./evaluations";
import { registerInquiryRoutes } from "./inquiries";
import { registerLedgerRoutes } from "./ledgers";
import { registerListingsRoutes } from "./listings";
import { registerModerationRoutes } from "./moderation";
import { registerRefundRoutes } from "./refunds";
import { registerRequestBodyPolicy } from "./request-body-policy";
import { registerSponsoredRoutes } from "./sponsored";
import { registerStandardsRoutes } from "./standards";
import { registerThreadRoutes } from "./threads";

/**
 * The versioned prefix every route of this API is served under, applied once by
 * {@link registerRoutes} through Fastify's own encapsulation.
 *
 * It is declared here, in the module that applies it, so the prefix has one spelling in this
 * workspace: the composition root imports this constant rather than restating the literal, and no
 * group file contains it. A future contract change needs a new prefix — which is the whole point of
 * versioning the surface — and that change is an edit to this one value.
 */
export const API_PREFIX = "/api/v1";

/**
 * What every route group is handed: the open database handle and the process's resolved
 * configuration.
 *
 * The object arrives **by closure** from the composition root, as the second argument of
 * {@link registerRoutes}, which passes it on to each group unchanged. It is deliberately not put on
 * the Fastify instance: a group that read its database off the instance would depend on decoration
 * order, and an instance carries request-scoped state this data must not be confused with. The
 * context is read-only, so no group can substitute a handle or a configuration for another group's
 * benefit.
 *
 * A group that needs less than both members declares its own structural slice of this interface —
 * the arrangement the route groups in this folder already follow — and this object satisfies it.
 */
export interface RouteContext {
  /** The open database handle, whose pragmas and migrations the composition root already applied. */
  readonly database: Database;

  /** The resolved configuration: the page size, the write rate-limit bound and the commerce labels. */
  readonly config: ApiConfig;
}

/**
 * Registers every route group under the one versioned prefix.
 *
 * The fourteen registrars are called inside a single encapsulated scope, so each group's paths are
 * served under {@link API_PREFIX} and none can be reached without it. The scope receives the same
 * {@link RouteContext} by closure, so a group reads the handle and the configuration it was given
 * rather than reaching for them on the instance.
 *
 * Registration is what makes the route table exist: the caller must have awaited the instance's
 * readiness before it serves traffic, which is the composition root's responsibility, not this
 * function's.
 *
 * @param app The instance to register the groups on. It is the root instance in the running product;
 *   the groups are given the scoped instance created here, never this one.
 * @param context The open database handle and the resolved configuration, passed on to every group.
 */
export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  app.register(
    async (instance: FastifyInstance): Promise<void> => {
      // The scope's one hook, and the first thing registered in it: a write body is held to the JSON
      // types and the declared fields its own schema states before Fastify's validator is given it —
      // the validator's `coerceTypes` and `removeAdditional` defaults would otherwise convert a
      // wrongly-typed value and drop an undeclared field instead of refusing either. It reads each
      // route's own body schema, so no group declares or repeats anything for it.
      registerRequestBodyPolicy(instance);

      registerListingsRoutes(instance, context);
      registerCompareRoutes(instance, context);
      registerInquiryRoutes(instance, context);
      registerChallengeRoutes(instance, context);
      registerThreadRoutes(instance, context);
      registerStandardsRoutes(instance, context);
      registerEvaluationRoutes(instance, context);
      registerAppealRoutes(instance, context);
      registerCheckoutRoutes(instance, context);
      registerRefundRoutes(instance, context);

      // The three ledger reads are the operators' own: they are the first three of the four rows of
      // this register that are not public, and each refuses a resolvable non-operator with 403 and
      // an absent or unresolvable account with 401. They are grouped here, and the exception list is
      // completed by the audit feed below, so the whole list is readable from this one place.
      registerLedgerRoutes(instance, context);

      registerModerationRoutes(instance, context);
      registerSponsoredRoutes(instance, context);

      // The fourth and last non-public read: the operator-facing append-only audit feed. Every other
      // GET in this register — listings, a listing's detail, compare, the challenges and threads
      // boards, the standards catalogue and a version's detail, a report, and the sponsored slots —
      // answers without any request header at all.
      registerAuditRoutes(instance, context);
    },
    { prefix: API_PREFIX },
  );
}
