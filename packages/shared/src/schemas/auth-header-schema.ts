/**
 * The demo-session header contract of the API: the name of the request header
 * every non-public route requires, and the JSON Schema those routes attach to
 * it.
 *
 * This module is the header name's single declaration site. It sits here rather
 * than in `../constants` — whose list is the synthetic currency label, the
 * report labels, the badge scope, the page size, the rate-limit numbers, the
 * visible demo label, the empty-evaluation copy and the founder-ledger "to be
 * determined" note — and rather than in `../types/demo-label`, which declares
 * only the visible label. Two modules exporting one identifier would break
 * `../index`'s `export *`, so this module owns both names below and imports
 * nothing.
 */

/**
 * The request header every non-public route requires: it names a synthetic demo
 * account — one of the six seed rows in `apps/api/src/seed/seed-data.ts` — and
 * never a credential.
 *
 * `apps/api/src/auth/resolve-demo-account.ts` resolves it to an account row
 * carrying a role (`resolveDemoAccount(database, header)`), and
 * `apps/api/src/auth/require-role.ts` asserts that row's role
 * (`requireRole(account, role)`). `apps/web/src/api-client.ts` sets it on every
 * write, and is the only module in the web workspace that calls `/api/v1`.
 *
 * It is a role selector and never authentication. It is trivially impersonable
 * by design: it separates roles for a demonstration and asserts nothing about
 * who the caller is. A missing or unresolvable account yields `401`, a
 * resolvable account whose role does not match the route yields `403`, and the
 * visible label is `DEMO_AUTHENTICATION_LABEL` from `../constants` ("demo only,
 * no production authentication"). No route may treat this header as
 * authentication, and no code, comment or UI string may describe it as a login,
 * a session, a token, a password or a key — it is not any of those things, it
 * carries no secret, and it names a header rather than a value.
 */
export const DEMO_ACCOUNT_HEADER = 'X-Demo-Account';

/**
 * The request-side header schema for the demo-session header above.
 *
 * Attach it to every non-public row of the API contract table: `POST /listings`,
 * `POST /listings/{id}/versions`, `POST /inquiries`, `POST /challenges`,
 * `POST /challenges/{id}/responses`, `POST /threads`, `POST /threads/{id}/posts`,
 * `POST /standards/proposals`, `POST /standards/proposals/{id}/review`,
 * `POST /evaluations`, `POST /evaluations/{id}/appeals`, `POST /appeals/{id}/ruling`,
 * `POST /checkout-simulations`, `POST /transactions/{id}/refunds`,
 * `POST /moderation/listings/{id}/actions`, and the four operator-only reads
 * `GET /ledger/marketplace`, `GET /ledger/gate-fees`,
 * `GET /ledger/founder-allocation` and `GET /audit-events`.
 *
 * No public read attaches it: `GET /listings`, `GET /listings/{id}`,
 * `GET /compare`, `GET /standards`, `GET /standards/{id}/versions/{v}`,
 * `GET /evaluations/{id}`, `GET /challenges`, `GET /threads` and
 * `GET /sponsored-slots`.
 *
 * A request that reaches a non-public row without a resolvable account is
 * answered `401`; a resolvable account whose role does not match the row is
 * answered `403`. Fastify validates a route's header schema at registration,
 * before the handler runs, so an absent or empty header arrives as an
 * `FST_ERR_VALIDATION` with status `400` rather than as `401`. The API's single
 * error handler in `apps/api/src/errors/error-envelope.ts` therefore maps a
 * failed validation of this header to the envelope's `401` code, which is what
 * makes an absent-header request and an unknown-account request both `401`
 * while a resolvable wrong-role account still yields `403` from `requireRole`.
 * The schema stays attached — it is what keeps the contract executable and
 * self-documenting — and `apps/api/test/integration/route-walk.test.ts` asserts
 * both statuses for every non-public row.
 *
 * Fastify matches header names case-insensitively, lowercasing the incoming
 * names and the schema's names alike, so the exact-cased header name used as
 * this schema's key still matches a real request.
 *
 * `additionalProperties: true` is deliberate and must stay `true`: a real
 * request carries `content-type`, `accept`, `host`, `user-agent` and other
 * headers, and constraining them would fail every write. Only the demo header
 * is constrained — its presence (`required`) and its non-emptiness
 * (`minLength: 1`).
 *
 * Request side only: this module declares no response schema. The header it
 * describes is a synthetic role selector and never authentication, and
 * `packages/shield` must never import this module or the package that holds it.
 */
export const demoAccountHeaderSchema = {
  headers: {
    type: 'object',
    required: [DEMO_ACCOUNT_HEADER],
    properties: {
      [DEMO_ACCOUNT_HEADER]: { type: 'string', minLength: 1 },
    },
    // Left open on purpose: only the demo header is constrained. See above.
    additionalProperties: true,
  },
} as const;
