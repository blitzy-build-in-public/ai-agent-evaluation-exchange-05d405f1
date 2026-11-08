/**
 * JSON Schema request contracts for the operator's moderation route and for the
 * standards proposal lifecycle: `POST /moderation/listings/{id}/actions`,
 * `POST /standards/proposals` and `POST /standards/proposals/{id}/review`.
 *
 * Two placements are deliberate, and both follow the plan's file map rather than
 * a local choice. The proposal and review bodies live in *this* module instead
 * of a seventh schema module, because `packages/shared/src/schemas` holds exactly
 * six schema modules and that count is part of the plan's contract.
 * `MODERATION_ACTIONS` is declared here rather than under `../types`, because the
 * map carries no `types/moderation.ts`; the module therefore exports a runtime
 * value, which `packages/shared/src/index.ts` re-exports with `export *`, so the
 * `ModerationAction` type derived from it reaches consumers through that same
 * statement.
 *
 * Every schema below is a plain JSON Schema object carrying exactly one Fastify
 * section key, so it attaches directly to a route's `schema` option. No schema
 * library types it: the dependency inventory is closed and names none, and
 * Fastify 4 validates these objects as they are. No object here combines a body
 * with its parameters — a route spreads the pair it needs itself,
 * `{ ...moderationListingIdParamsSchema, ...moderationActionBodySchema }` and
 * `{ ...standardProposalIdParamsSchema, ...standardProposalReviewBodySchema }`.
 *
 * All three rows are non-public, so each route also attaches the demo-session
 * header contract from `./auth-header-schema.ts`. A request that reaches one
 * without a resolvable `X-Demo-Account` header is answered `401`; a resolvable
 * account whose role does not match the row is answered `403`. Fastify validates
 * headers and bodies before the handler runs, so an absent header arrives as a
 * validation failure that `apps/api/src/errors/error-envelope.ts` maps to the
 * contract's `401`.
 *
 * Request side only: no response schema appears here. The plan fixes JSON-schema
 * *request* validation, and a successful response shape is prose in the contract
 * table rather than a route option.
 *
 * Data, plus the one closed vocabulary. Nothing here appends a governance event,
 * moves a status or hides a listing — the route files and `@adem/sgi-core` do
 * that. No field below addresses an append-only row either: moderation and review
 * each append an event and move a *mutable* status, so no schema here can reach an
 * `evaluation_reports`, `standard_versions`, `ledger_entries` or `audit_events`
 * row. The operator's power is additive only — it moderates, reviews and rules,
 * and it can never rewrite a measurement.
 */

import { PROPOSAL_REVIEW_STATUSES } from '../types/standard';

/**
 * The closed action vocabulary of `POST /moderation/listings/{id}/actions`, and
 * the single definition both of its readers use: `apps/api/src/routes/moderation.ts`
 * validates the request against it, and
 * `apps/web/src/components/moderation-actions.tsx` renders one control per
 * action. It lives here rather than under `../types` because the plan's file map
 * has no `types/moderation.ts`, so this module's own closed vocabulary is its
 * only home.
 *
 * The three actions differ in what they do to a listing's visibility and agree in
 * what they leave untouched:
 *
 * - `hide` sets the listing's status to `hidden`, which removes it from
 *   `GET /listings` and `GET /compare` while the operator still reads it, with its
 *   version history, through `GET /listings/{id}`. The hidden state is exactly
 *   that: gone from browse, present for the operator.
 * - `restore` returns a flagged or hidden listing to `active`, so it appears in
 *   search and compare again.
 * - `flag` records a concern about a listing without changing whether it is
 *   visible, which is what lets one operator's doubt be reviewed by another
 *   before anything is removed.
 *
 * Every action appends a governance event whose `event_type` is
 * `listing_moderated`, whose `subject_type` is `listing` and whose `reason` is the
 * operator's stated reason — so the moderation trail is append-only history and a
 * listing's current status is just what the last appended action left. The current
 * status is a mutable column on the listing; the reasons behind it are not, and
 * neither log is rewritten.
 *
 * No action rewrites, deletes or edits anything: not an evaluation report, not a
 * standard version, not a ledger entry, and not the listing's own past events. An
 * operator's power over the record is additive only, which is the invariant
 * `apps/api/test/integration/immutability.test.ts` proves and the reason no
 * moderation request field below can address an append-only row. That limit is
 * the point of the role: an operator may remove a listing from view and must never
 * be able to change what a measurement says.
 *
 * The vocabulary is closed, so a fourth spelling is a revision of the plan rather
 * than an implementation choice; `apps/api/test/integration/route-walk.test.ts`
 * asserts the contract's `400` for an action outside it.
 */
export const MODERATION_ACTIONS = ['flag', 'hide', 'restore'] as const;

/** A moderation action an operator may apply — see {@link MODERATION_ACTIONS}. */
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/**
 * Body contract for `POST /moderation/listings/{id}/actions` (operator).
 *
 * `reason` is **required**, and that requirement *is* the contract's `400` case
 * for this row: the only malformed body the contract names here is one without a
 * reason, so `reason` sits in `required` and carries `minLength: 1`, an empty
 * string stating no reason either. Dropping it from `required` would delete
 * contract behaviour rather than relax a constraint. `action` is constrained to
 * {@link MODERATION_ACTIONS}, so an unrecognised action is a `400` as well.
 *
 * `reason` also carries a stated `maxLength` of 1000. The reason it states is
 * what the appended governance event, the operator's audit feed and the
 * listing's moderation history all carry, so a field with no ceiling lets one
 * client inflate every payload that reads the trail. The number is this module's
 * own choice, large enough to state a reason in full and no larger.
 *
 * The listing acted on comes from the path, through
 * {@link moderationListingIdParamsSchema}, and never from the body; a route
 * spreads the two together:
 * `{ ...moderationListingIdParamsSchema, ...moderationActionBodySchema }`.
 *
 * The API holds a request body to this closed object before its validator runs —
 * the check in `apps/api/src/routes/request-body-policy.ts` — so an unexpected
 * field, a client-supplied `status` say, is answered `400 validation_error`
 * instead of being removed before the handler runs, and no handler may rely on
 * reading one. The operator's identity is resolved server-side from the
 * `X-Demo-Account` header and is not a body field, and a client-supplied
 * `created_at` or `actor_account_id` is refused the same way.
 *
 * Statuses this row produces: `400` for a missing or empty `action` or `reason`,
 * or a `reason` over its stated maximum, `404` for a listing id no listing
 * carries, `401` for a missing or unresolvable demo header, and `403` for a
 * resolvable account whose role is not `operator`.
 * Success is `200`, carrying the listing's new status beside the governance event
 * the route appended — the event type `listing_moderated` against subject type
 * `listing`, both drawn from the closed vocabularies in
 * `../types/governance-event.ts` and written through `@adem/sgi-core`'s
 * `src/events/append-event.ts`. Nothing about the listing's reports, version
 * history or measurements is written.
 */
export const moderationActionBodySchema = {
  body: {
    type: 'object',
    required: ['action', 'reason'],
    properties: {
      action: { type: 'string', enum: MODERATION_ACTIONS },
      reason: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `POST /moderation/listings/{id}/actions`.
 *
 * `id` names a **listing** — the row `GET /listings/{id}` serves and the subject
 * of the appended `listing_moderated` event — not a listing version, not an
 * evaluation report and not a governance event. The route resolves it and
 * produces `404` when no listing carries it; validation itself produces `400` for
 * a missing or empty `id`.
 *
 * A hidden listing is still resolved here, and it must be: `hide` removes a
 * listing from browse, so the operator's own reads and a later `restore` both have
 * to find it. A moderation route that could not address a hidden listing could
 * never return one to visibility.
 */
export const moderationListingIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /standards/proposals` (contributor).
 *
 * `status` is not a client field and must not become one. The route creates the
 * row `submitted`, and the only route that may move it is the operator review
 * route that consumes {@link standardProposalReviewBodySchema}, which appends a
 * governance event. The request-body policy refuses an undeclared field with
 * `400 validation_error`, so a client that submits `status: "accepted"` alongside
 * an otherwise valid body is answered `400` rather than having the field silently
 * dropped before the row is created `submitted`. The vocabulary of a creation is
 * therefore not the vocabulary of a review, and a proposer cannot decide its own
 * proposal — with the refusal visible to the client that tried. The proposer is
 * resolved server-side from the `X-Demo-Account` header and is never a body field
 * either, so a client-supplied `proposer_account_id` or `created_at` is refused
 * the same way.
 *
 * The three required strings are the whole proposal: which standard it concerns,
 * what it would change, and why. All three are immutable once written — a review
 * appends a decision and never rewrites `title` or `rationale`, so the reasoning a
 * decision answered stays readable afterwards, and a withdrawn or superseded
 * proposal is a new proposal rather than an edit to this one.
 *
 * Statuses this row produces: `400` for a missing or empty `standard_id`, `title`
 * or `rationale`, or for a `title` or `rationale` over its stated maximum; `401`
 * for a missing or unresolvable demo header; `403` for a resolvable account whose
 * role is not `contributor`; and `404` when `standard_id` names no standard in the
 * catalogue. Success is `201` with the created proposal in status `submitted`.
 *
 * `title` and `rationale` carry stated maxima — 200 and 4000 — because a
 * proposal is read back by the governance trail that decides it and by the page
 * that lists it, so a field with no ceiling lets one client inflate every
 * payload that carries the proposal. The numbers are this module's own choice,
 * large enough for a proposal's heading and its full reasoning.
 */
export const standardProposalCreateBodySchema = {
  body: {
    type: 'object',
    required: ['standard_id', 'title', 'rationale'],
    properties: {
      standard_id: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      rationale: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `POST /standards/proposals/{id}/review`.
 *
 * `id` names a row of `standard_proposals` — the proposal being decided, not the
 * standard it concerns and not a standard version. The route resolves it and
 * produces `404` when no proposal carries it; validation itself produces `400` for
 * a missing or empty `id`.
 */
export const standardProposalIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /standards/proposals/{id}/review` (operator).
 *
 * The required field is named `status` because that is the column the review
 * moves — `standard_proposals.status` — not because a successful answer is a
 * status document.
 *
 * Its enum is `PROPOSAL_REVIEW_STATUSES` (`accepted` or `rejected`), imported from
 * `../types/standard` and used here as the tuple it is rather than re-spelled, and
 * it deliberately excludes `submitted`. That narrow vocabulary is what makes the
 * contract's `409` for an already-decided proposal coherent: `submitted` is the
 * initial state and not a review outcome, so no review can reopen or un-decide a
 * proposal. A decided proposal is answered `409` by the route, and an attempt to
 * set one back to `submitted` fails validation as a `400` before a handler runs.
 * The narrowed enum prevents the *reopening*; the route's status check produces the
 * `409` for a proposal that already holds one of these two values.
 *
 * `reason` is optional — a review is not obliged to justify itself — and it goes
 * into the appended event rather than into the proposal, so an omitted reason
 * leaves the proposal's own text untouched as well.
 *
 * `reason` carries a stated `maxLength` of 1000: it travels into that appended
 * event, which the governance trail and the audit feed read back, so a field with
 * no ceiling lets one client inflate every payload that carries the decision. The
 * number is this module's own choice, large enough to state a decision's
 * reasoning in full and no larger.
 *
 * The review appends a governance event with `event_type` `proposal_reviewed` and
 * `subject_type` `standard_proposal`, and it **never rewrites the proposal's
 * text**: `title` and `rationale` are immutable after creation. It follows that
 * this schema, like every other in this module, carries no field addressing a
 * standard version, a report or a ledger entry — accepting a proposal changes the
 * proposal's status and appends to the event log, while publishing a new standard
 * version is a separate governed act with its own immutable version row.
 *
 * A route attaches it beside {@link standardProposalIdParamsSchema}
 * (`{ ...standardProposalIdParamsSchema, ...standardProposalReviewBodySchema }`).
 * Statuses this row produces: `400` for a missing `status` or a `status` outside
 * the review vocabulary, or for a `reason` over its stated maximum, `404` for an
 * unknown proposal id, `401` for a missing or unresolvable demo header, `403` for
 * a resolvable account whose role is not `operator`, and `409` when the proposal
 * already holds `accepted` or `rejected`.
 * Success is `200`, carrying the proposal in its new status beside the appended
 * event.
 */
export const standardProposalReviewBodySchema = {
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: PROPOSAL_REVIEW_STATUSES },
      reason: { type: 'string', maxLength: 1000 },
    },
    additionalProperties: false,
  },
} as const;
