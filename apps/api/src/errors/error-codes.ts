/**
 * The closed error vocabulary of the ADEM API, and the one map from a code to the
 * HTTP status it is answered with.
 *
 * This module is a leaf: it imports nothing, reads nothing and computes nothing.
 * Every status below is the API contract, fixed in this one place so that the two
 * callers agree without either of them choosing a status — `apps/api/src/server.ts`,
 * which needs a status for a code *and* a code for a status that arrived without
 * one, and `apps/api/src/errors/error-envelope.ts`, which needs a status for a
 * domain package's refusal code.
 *
 * A domain refusal string is not an alias for a status. When `@adem/sgi-core` or
 * `@adem/commerce-sim` refuses a call, its own stable string is the envelope's
 * `code` and this map supplies the status, which is why those strings are members
 * of the union rather than being rewritten to a generic name on the way out.
 */

/**
 * Every code the API may return in `{ error: { code, message } }`.
 *
 * The union is closed. A handler or domain package that needs a code which is not
 * here adds it deliberately, which is a contract change, never an inline string at
 * a call site; and no route derives or overrides a status.
 *
 * The API's own eight codes, one per status the HTTP surface itself produces:
 * `validation_error` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404,
 * `conflict` 409, `unprocessable` 422, `rate_limited` 429, `internal_error` 500.
 *
 * The domain refusal codes, each named exactly as the package that produces it
 * names it, because a route maps a refusal by that string and never by its class
 * name — `@adem/sgi-core`: 404 `unknown_standard`, 409 `already_decided`,
 * 409 `already_ruled`, 422 `incomplete_submission`, 400 `unknown_case`,
 * 400 `duplicate_case`, 400 `invalid_proposal`, 400 `invalid_appeal`,
 * 400 `standard_drift`; `@adem/commerce-sim`: 404 `transaction_not_found`,
 * 409 `already_fully_refunded`, 422 `not_offered`, 422 `exceeds_net_remaining`,
 * 400 `invalid_amount`. `not_found` is a single member carrying a single status,
 * because both an API route and `@adem/sgi-core`'s proposal, appeal and report
 * lookups produce it.
 *
 * `invalid_amount` is normally caught first by the shared JSON schema at the edge,
 * so its entry here is the second line rather than the first.
 */
export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal_error'
  | 'unknown_standard'
  | 'transaction_not_found'
  | 'already_decided'
  | 'already_ruled'
  | 'already_fully_refunded'
  | 'incomplete_submission'
  | 'not_offered'
  | 'exceeds_net_remaining'
  | 'unknown_case'
  | 'duplicate_case'
  | 'invalid_proposal'
  | 'invalid_appeal'
  | 'standard_drift'
  | 'invalid_amount';

/**
 * The status for every code in {@link ApiErrorCode}.
 *
 * Typed as a total `Record` over the closed union deliberately: a code with no
 * status fails the build, and so does a status for something that is not a code,
 * which is what keeps an invented code or a route-chosen status out of a response.
 * Its two readers are the error handler in `apps/api/src/server.ts` and
 * `apps/api/src/errors/error-envelope.ts`.
 */
export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = Object.freeze({
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal_error: 500,
  unknown_standard: 404,
  transaction_not_found: 404,
  already_decided: 409,
  already_ruled: 409,
  already_fully_refunded: 409,
  incomplete_submission: 422,
  not_offered: 422,
  exceeds_net_remaining: 422,
  unknown_case: 400,
  duplicate_case: 400,
  invalid_proposal: 400,
  invalid_appeal: 400,
  standard_drift: 400,
  invalid_amount: 400,
});

/**
 * The inverse map, for a failure that arrives with only a numeric status: a Fastify
 * schema-validation failure (400), any other Fastify transport error (its own
 * status), the write rate-limit path (429) and everything else (500). Every call
 * site is in `apps/api/src/server.ts`.
 *
 * Partial on purpose: `noUncheckedIndexedAccess` turns every lookup into
 * `ApiErrorCode | undefined`, so a caller writes
 * `STATUS_DEFAULT_CODE[status] ?? 'internal_error'` and a status outside these
 * eight answers 500 `internal_error` instead of passing a status through with no
 * code. A failure known only by its status still needs a code, and no module but
 * this one chooses it.
 */
export const STATUS_DEFAULT_CODE: Readonly<Partial<Record<number, ApiErrorCode>>> = Object.freeze({
  400: 'validation_error',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal_error',
});

/**
 * A programming error met while composing the application — a seam implementation
 * that does not validate, an extension registered twice, an event type nothing
 * handles. Each fails start-up loudly. These are NEVER a route case and never a
 * status, so they are deliberately absent from {@link ApiErrorCode} and from both
 * maps above.
 *
 * If one of them ever does reach the error handler, the handler's fallback answers
 * 500 `internal_error` with a generic message, which is the right answer for a
 * defect rather than a client error — and the union's typing is what guarantees it.
 */
export type CompositionOnlyErrorCode =
  | 'seam_validation'
  | 'duplicate_extension'
  | 'unknown_event_type';

/**
 * {@link CompositionOnlyErrorCode} in the order the failures are met: a seam
 * implementation fails validation, then a duplicate extension registration, then an
 * event whose type nothing handles. Exported so a composition-time check can name
 * the family it raised without redeclaring the strings.
 */
export const COMPOSITION_ONLY_ERROR_CODES: readonly CompositionOnlyErrorCode[] = Object.freeze([
  'seam_validation',
  'duplicate_extension',
  'unknown_event_type',
]) as readonly CompositionOnlyErrorCode[];
