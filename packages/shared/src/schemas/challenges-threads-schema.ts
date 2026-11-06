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
 * The two board reads (`GET /challenges`, `GET /threads`) are public and the
 * contract fixes no query parameter for them, so they have no request input to
 * validate and deliberately have no schema here.
 *
 * Nothing in this module holds a closed vocabulary: a challenge's status, a
 * row's author and every timestamp are server-owned columns, so no enum and no
 * client-settable identity field appears below. Types `ChallengeCreateBody`,
 * `ChallengeResponseBody`, `ThreadCreateBody` and `ThreadPostBody` from
 * `../types/challenge.ts` and `../types/thread.ts` describe the accepted bodies;
 * they are named here rather than imported because this module is data only.
 */

/**
 * Body contract for `POST /challenges` (buyer).
 *
 * A challenge is created `open`. The buyer's identity is resolved server-side
 * from the `X-Demo-Account` header — attached as this route's header contract
 * from `./auth-header-schema.ts` — and is never a body field. Because Fastify 4
 * validates with `removeAdditional: true`, a client-supplied `account_id`,
 * `status` or `created_at` is stripped before the handler runs instead of
 * producing a `400`, so no handler may rely on seeing a client-supplied
 * identity, status or timestamp.
 *
 * Validation produces `400` for a missing or empty `listing_id` or `question`;
 * the route's own checks produce `404` for an unknown listing, `401` for a
 * missing or unresolvable demo header, and `403` for a resolvable account whose
 * role is not `buyer`.
 */
export const challengeCreateBodySchema = {
  body: {
    type: 'object',
    required: ['listing_id', 'question'],
    properties: {
      listing_id: { type: 'string', minLength: 1 },
      question: { type: 'string', minLength: 1 },
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
 * field, and a client-supplied value would be stripped before the handler runs.
 *
 * A route attaches this schema beside `challengeIdParamsSchema`
 * (`{ ...challengeIdParamsSchema, ...challengeResponseBodySchema }`).
 * Validation produces `400` for a missing or empty `body`; the route's own
 * checks produce `404` for an unknown challenge id, `401` for a missing or
 * unresolvable demo header, and `403` for a role the row does not accept.
 */
export const challengeResponseBodySchema = {
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1 },
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
 * is stripped before the handler runs.
 *
 * Validation produces `400` for a missing or empty `title`; the route's own
 * checks produce `401` for a missing or unresolvable demo header.
 */
export const threadCreateBodySchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1 },
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
 * stripped before the handler runs.
 *
 * A route attaches this schema beside `threadIdParamsSchema`
 * (`{ ...threadIdParamsSchema, ...threadPostBodySchema }`). Validation produces
 * `400` for a missing or empty `body`; the route's own checks produce `404` for
 * an unknown thread id and `401` for a missing or unresolvable demo header.
 */
export const threadPostBodySchema = {
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;
