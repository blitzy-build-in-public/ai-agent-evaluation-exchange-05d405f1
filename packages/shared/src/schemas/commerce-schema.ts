/**
 * JSON Schema request contracts for the buyer and operator write routes: the
 * buyer's inquiry (`POST /inquiries`), the buyer's checkout simulation
 * (`POST /checkout-simulations`) and the operator's refund
 * (`POST /transactions/{id}/refunds`).
 *
 * Every export below is a plain JSON Schema object carrying exactly one Fastify
 * section key, so it attaches directly to a route's `schema` option. No schema
 * library types these objects: the dependency inventory is closed and names
 * none, and Fastify 4 validates them as they are. No object here combines a body
 * with its parameters — a route spreads the pair it needs itself,
 * `{ ...transactionIdParamsSchema, ...refundCreateBodySchema }`.
 *
 * The two money bodies carry no amount the client may choose on the checkout
 * side and no currency anywhere: every monetary field in this product is an
 * integer count of minor units of the synthetic currency `DEMO`, there is no
 * real currency code and no currency symbol, and the amount of a simulated
 * purchase is computed from the selected offer model and the listing version
 * rather than submitted. `currency_label` is a column these schemas never
 * address — it is fixed to the one synthetic label by the `CHECK` constraint in
 * `packages/shared/migrations/0008_commerce_ledgers_and_refunds.sql`.
 *
 * Request side only: no response schema appears here. The plan fixes JSON-schema
 * *request* validation, and a successful response shape is prose in the contract
 * table rather than a route option — so `InquiryCreateBody` in
 * `../types/inquiry.ts` and `CheckoutSimulationBody` and `RefundCreateBody` in
 * `../types/commerce.ts` describe the accepted bodies, and this module validates
 * them.
 *
 * Data only. Nothing here decides whether a listing offers an offer model,
 * whether an amount fits a transaction's net remaining, or how an allocation
 * rounds: those are `packages/commerce-sim`'s, and a shared schema that reached
 * into a listing's offer set would put domain logic in the one package that must
 * stay data-only. All three rows are non-public, so each route also attaches the
 * demo-session header contract from `./auth-header-schema.ts`: a request with no
 * resolvable `X-Demo-Account` header is answered `401`, and a resolvable account
 * whose role does not match the row is answered `403`.
 */

import { OFFER_MODELS } from '../types/commerce';

/**
 * Body contract for `POST /inquiries` (buyer).
 *
 * The buyer's message on one listing, and nothing else: the two required
 * non-empty strings are the whole request.
 *
 * The buyer's identity is resolved server-side from the `X-Demo-Account` demo
 * session and is deliberately not a field here, so a caller cannot write an
 * inquiry as another account. The API holds a request body to this closed object
 * before its validator runs — the check in
 * `apps/api/src/routes/request-body-policy.ts` — so a client that sends its own
 * `buyer_account_id`, `id`, `created_at` or `status` alongside an otherwise valid
 * body is answered **`400 validation_error`** rather than having the field removed
 * before the handler runs. The buyer is the resolved demo account and the row's
 * other columns belong to the server, and a client that tried to set one is told
 * so rather than answered as if it had succeeded.
 *
 * The body holds nothing else, and the row it produces holds nothing else: an
 * inquiry is not a channel, so no contact detail, no payment detail and no
 * financial information of any kind is collected, no field below can hold one,
 * and none may be added. The row is the single insert into `inquiries` in
 * `packages/shared/migrations/0003_inquiries.sql`, written once by this route and
 * read back unchanged.
 *
 * `message` carries a stated `maxLength` of 2000. The message is stored and read
 * back verbatim by the listing's own inquiry surface, so a field with no ceiling
 * lets one client inflate every payload that carries the inquiry. The number is
 * this module's own choice, large enough to state a buyer's question in full and
 * no larger.
 *
 * Statuses this row produces or hands on: `400` for a missing or empty
 * `listing_id` or `message`, or a `message` over its stated maximum; `404` from
 * the route for a `listing_id` that names no listing; `401` for a missing or
 * unresolvable demo header; `403` for a resolvable account whose role is not
 * `buyer`; and success is `201`, the write appending an `audit_events` row of
 * resource type `inquiry`.
 */
export const inquiryCreateBodySchema = {
  body: {
    type: 'object',
    required: ['listing_id', 'message'],
    properties: {
      listing_id: { type: 'string', minLength: 1 },
      message: { type: 'string', minLength: 1, maxLength: 2000 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /checkout-simulations` (buyer).
 *
 * The three required strings are the whole request: which listing, which of its
 * versions, and which offer model the buyer selected. `offer_model` is
 * constrained to {@link OFFER_MODELS} — the four-model vocabulary, imported from
 * `../types/commerce` and used here as the tuple it is rather than re-spelled,
 * so the offer type and the wire contract cannot drift apart.
 *
 * A model the listing does not offer is the contract's `422`, and that is
 * **domain logic, not schema logic**: this schema knows the four-model
 * vocabulary and nothing about any listing's offer set, which is data owned by
 * `packages/commerce-sim`. `packages/commerce-sim/src/offers/select-offer.ts`
 * decides whether *this* listing offers *this* model and the route answers
 * `422` when it does not. Tightening this schema into a listing lookup would
 * move that decision into a package with no listing data.
 *
 * Statuses this row produces or hands on: `400` for a missing or empty
 * `listing_id`, `listing_version_id` or `offer_model`, or an `offer_model`
 * outside the vocabulary; `404` from the route for a listing or version that no
 * longer exists; `401` for a missing or unresolvable demo header; `403` for a
 * resolvable account whose role is not `buyer`; and `422` for an offer model the
 * listing does not make.
 *
 * There is deliberately no field for an amount, a currency, a card, an account
 * or a payment provider, and none may be added. The amount is computed from the
 * selected offer and the listing version, and is an integer count of minor units
 * of the synthetic currency `DEMO` with no real currency code or symbol; the
 * stored transaction carries `simulated: true` and the nonfunctional demo
 * disclosure label, which the response surface asserts. A refusal of a real
 * payment never arises because no real payment exists — the checkout is a
 * labelled, nonfunctional simulation.
 *
 * The request-body policy refuses an undeclared field with `400 validation_error`
 * before the handler runs, so a client that sends its own `amount`, `currency` or
 * `buyer_account_id` alongside an otherwise valid body is answered `400` rather
 * than having the field removed. The amount is the server's and the buyer's
 * identity is resolved from the demo header, never read from the body.
 */
export const checkoutSimulationBodySchema = {
  body: {
    type: 'object',
    required: ['listing_id', 'listing_version_id', 'offer_model'],
    properties: {
      listing_id: { type: 'string', minLength: 1 },
      listing_version_id: { type: 'string', minLength: 1 },
      offer_model: { type: 'string', enum: OFFER_MODELS },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /transactions/{id}/refunds` (operator).
 *
 * `amount_minor_units` is a non-negative integer count of minor units of the
 * synthetic currency `DEMO`: never a fractional amount, never a real currency
 * code, never a currency symbol. `minimum: 0` permits `0` on purpose — the
 * plan's wording is a non-negative integer — so a zero refund is a domain
 * decision rather than a validation failure, and raising this bound to `1` would
 * silently turn a permitted input into a `400`.
 *
 * `type: 'integer'` is a money-safety guard rather than a formality: the request
 * body policy accepts a whole JSON number as it stands and refuses both a decimal
 * such as `12.5` and a numeric string such as `"4000"` before a handler runs —
 * neither a fraction nor a string is the integer this field declares. This schema
 * is therefore the first line of the "no floating-point money" rule whose
 * arithmetic half lives at the product's single rounding point,
 * `packages/commerce-sim/src/ledgers/allocate.ts`, and amounts stay whole minor
 * units from the request to the ledger entry.
 *
 * The two meaningful rejections are the domain's, and both are computed from the
 * refund rows rather than from a stored balance: `409` when the transaction is
 * already fully refunded, and `422` when the amount exceeds the net remaining.
 * That derivation is why this schema carries no balance field and the `refunds`
 * table no balance column, and why neither is a schema outcome.
 *
 * A refund **appends** a reversal entry proportional to the refunded amount;
 * nothing is edited and nothing is deleted, and the net allocation is derived by
 * reading the entries. The transaction being refunded comes from the path,
 * through {@link transactionIdParamsSchema}, and never from the body — a
 * client-supplied `transaction_id` is refused by this closed object with `400
 * validation_error` before the handler runs, as is any other undeclared field.
 *
 * Statuses this row produces or hands on: `400` for a missing, negative or
 * fractional `amount_minor_units`; `404` for a transaction id no transaction
 * carries; `401` for a missing or unresolvable demo header; `403` for a
 * resolvable account whose role is not `operator`; plus the domain's `409` and
 * `422` above. Success is `201`, carrying the appended reversal entries.
 */
export const refundCreateBodySchema = {
  body: {
    type: 'object',
    required: ['amount_minor_units'],
    properties: {
      amount_minor_units: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `POST /transactions/{id}/refunds`.
 *
 * `id` names a row of `transactions` — the simulated transaction being reversed,
 * not a refund, not a ledger entry and not a listing. The route resolves it and
 * produces `404` when no transaction carries it; validation itself produces `400`
 * for a missing or empty `id`.
 *
 * The transaction comes from the path rather than the body so that one refunded
 * transaction's identity cannot be stated twice, in two places that could
 * disagree. A refunded transaction is still resolved here, and it must be:
 * `409` for an already fully refunded transaction is a decision the route takes
 * after reading the transaction and its refund rows, so the route has to find the
 * row first.
 */
export const transactionIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;
