/**
 * JSON Schema request contracts for the two public collaboration boards: the
 * buyer challenges board (`POST /challenges`, `POST /challenges/{id}/responses`)
 * and the discussion board (`POST /threads`, `POST /threads/{id}/posts`).
 *
 * Every export below is a plain JSON Schema object carrying exactly one Fastify
 * section key, so it attaches directly to a route's `schema` option. The two
 * parameter schemas are distinct names on purpose: each names the row it serves,
 * and a single shared `idParamsSchema` would also collide with the other schema
 * modules that `packages/shared/src/index.ts` re-exports wholesale.
 *
 * The two board reads (`GET /challenges`, `GET /threads`) are public, and the one
 * request input each takes is the shared `collectionPageQuerySchema` from
 * `./pagination-schema` — the `?page` parameter, an integer of at least 1,
 * defaulting to 1 and bounded by `PAGE_NUMBER_MAX` — which the routes attach
 * themselves. This module still declares no query schema for them, and that is
 * deliberate: its six exports are the boards' write contracts, so a second
 * schema for those two reads would be a second statement of one paging contract.
 * The four write bodies below carry the one character rule the product's stored
 * free text obeys, declared in `../constants` and imported here rather than
 * respelled, so no board can drift into a rule of its own.
 *
 * Nothing in this module holds a closed vocabulary: a challenge's status, a
 * row's author and every timestamp are server-owned columns, so no enum and no
 * client-settable identity field appears below. Types `ChallengeCreateBody`,
 * `ChallengeResponseBody`, `ThreadCreateBody` and `ThreadPostBody` from
 * `../types/challenge.ts` and `../types/thread.ts` describe the accepted bodies;
 * they are named here rather than imported because this module is data only.
 */

import { SUBSTANTIVE_FREE_TEXT_PATTERN } from '../constants';

/**
 * Body contract for `POST /challenges` (buyer).
 *
 * A challenge is created `open`. The buyer's identity is resolved server-side
 * from the `X-Demo-Account` header — attached as this route's header contract
 * from `./auth-header-schema.ts` — and is never a body field. The API holds a
 * request body to this closed object before its validator runs — the check in
 * `apps/api/src/routes/request-body-policy.ts` — so a client-supplied
 * `account_id`, `status` or `created_at` is answered `400 validation_error`
 * rather than stripped, and a value of the wrong JSON type for a declared field
 * is answered the same way rather than converted. No handler may rely on seeing
 * a client-supplied identity, status or timestamp, and a client is no longer
 * left believing one was accepted.
 *
 * Validation produces `400` for a missing or empty `listing_id` or `question`,
 * or a `question` over its stated maximum, or a `question` that carries no
 * non-whitespace character or a control character other than a line feed; the
 * route's own checks produce `404` for an unknown listing, `401` for a missing or
 * unresolvable demo header, and `403` for a resolvable account whose role is not
 * `buyer`.
 *
 * `question` carries a stated `maxLength` of 1000. A challenge is read by every
 * visitor who opens the board it belongs to, so a field with no ceiling lets one
 * client inflate every payload that carries the question. The number is this
 * module's own choice, large enough to state a question in full and no larger.
 */
export const challengeCreateBodySchema = {
  body: {
    type: 'object',
    required: ['listing_id', 'question'],
    properties: {
      listing_id: { type: 'string', minLength: 1 },
      question: {
        type: 'string',
        minLength: 1,
        maxLength: 1000,
        pattern: SUBSTANTIVE_FREE_TEXT_PATTERN,
      },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `POST /challenges/{id}/responses`.
 *
 * The challenge being answered comes from the path, not the body. The route
 * resolves the id and produces `404` when no challenge carries it; validation
 * itself produces `400` for a missing or empty `id`.
 */
export const challengeIdParamsSchema = {
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
 * Body contract for `POST /challenges/{id}/responses` (buyer or developer).
 *
 * The response is append-only by route design: the row records `account_id`
 * from the resolved demo session and no route updates or deletes it. Writing a
 * response is what moves the challenge's status from `open` to `responded`, and
 * that transition happens in the domain layer — `status` is never a client
 * field, and a client-supplied value is refused with `400 validation_error`
 * before the handler runs.
 *
 * A route attaches this schema beside `challengeIdParamsSchema`
 * (`{ ...challengeIdParamsSchema, ...challengeResponseBodySchema }`).
 * Validation produces `400` for a missing or empty `body`, or a `body` over its
 * stated maximum, or a `body` that carries no non-whitespace character or a
 * control character other than a line feed; the route's own checks produce
 * `404` for an unknown challenge id, `401` for a missing or unresolvable demo
 * header, and `403` for a role the row does not accept.
 *
 * `body` carries a stated `maxLength` of 4000. A response is served beside its
 * challenge by the board read, which is public, so a field with no ceiling lets
 * one client inflate every payload that carries the answer. The number is this
 * module's own choice, large enough for a developer's full answer and no larger.
 */
export const challengeResponseBodySchema = {
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        pattern: SUBSTANTIVE_FREE_TEXT_PATTERN,
      },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /threads` (any demo account).
 *
 * All four demo roles may start a thread, so the only role rule is that the
 * `X-Demo-Account` header resolves. The author is resolved from that header —
 * attached as this route's header contract from `./auth-header-schema.ts` — and
 * is never a body field; a client-supplied `author_account_id` or `created_at`
 * is refused with `400 validation_error` before the handler runs.
 *
 * Validation produces `400` for a missing or empty `title`, or a `title` over
 * its stated maximum, or a `title` that carries no non-whitespace character or a
 * control character other than a line feed; the route's own checks produce `401`
 * for a missing or unresolvable demo header.
 *
 * `title` carries a stated `maxLength` of 200. Every read of the board serves
 * the title of each thread it lists, so a field with no ceiling lets one client
 * inflate every payload that carries the thread. The number is this module's own
 * choice, large enough for a thread's subject line and no larger.
 */
export const threadCreateBodySchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        pattern: SUBSTANTIVE_FREE_TEXT_PATTERN,
      },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `POST /threads/{id}/posts`.
 *
 * The thread being replied to comes from the path, not the body. The route
 * resolves the id and produces `404` when no thread carries it; validation
 * itself produces `400` for a missing or empty `id`.
 */
export const threadIdParamsSchema = {
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
 * Body contract for `POST /threads/{id}/posts` (any demo account).
 *
 * The post is append-only by route design: the row records `author_account_id`
 * from the resolved demo session and no route updates or deletes it. As with a
 * thread, every demo role may post, so the only role rule is that the header
 * resolves, and a client-supplied `author_account_id` or `created_at` is
 * refused with `400 validation_error` before the handler runs.
 *
 * A route attaches this schema beside `threadIdParamsSchema`
 * (`{ ...threadIdParamsSchema, ...threadPostBodySchema }`). Validation produces
 * `400` for a missing or empty `body`, or a `body` over its stated maximum, or a
 * `body` that carries no non-whitespace character or a control character other
 * than a line feed; the route's own checks produce `404` for an unknown thread id
 * and `401` for a missing or unresolvable demo header.
 *
 * `body` carries a stated `maxLength` of 4000. A post is served beside its
 * thread by the board read, which is public, so a field with no ceiling lets one
 * client inflate every payload that carries the reply. The number is this
 * module's own choice, large enough for a full reply and no larger.
 */
export const threadPostBodySchema = {
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        pattern: SUBSTANTIVE_FREE_TEXT_PATTERN,
      },
    },
    additionalProperties: false,
  },
} as const;
