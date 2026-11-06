/**
 * The one failure body of the API, the error a route throws, and the mapper that turns
 * a thrown value — a domain package's refusal included — into that error by its stable
 * `code`.
 *
 * A leaf module: it imports its sibling {@link ApiErrorCode} vocabulary and nothing
 * else, so no framework, no domain package and no runtime facility takes part in shaping
 * a response body. That is what lets the error handler in `apps/api/src/server.ts`, the
 * write rate-limit response builder and a test all build the same shape from here.
 */

import { ERROR_STATUS } from './error-codes';
import type { ApiErrorCode } from './error-codes';

/**
 * The single failure body: `error`, and inside it exactly `code` and `message`.
 *
 * The shape is total. Validation, auth, role, not-found, unprocessable, throttling and
 * internal failures all send it, so a client parses one shape and no endpoint invents
 * a second.
 */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Builds the one response body every failure uses.
 *
 * Returns a fresh plain object literal on every call — never a shared instance and
 * never a class — so two bodies cannot alias each other and a `JSON.stringify` /
 * `JSON.parse` round-trip returns an equal object. Nothing else is ever added: no
 * `statusCode`, no validation detail, no `stack`, no identifier. `code` is a plain
 * `string` rather than {@link ApiErrorCode} because the error handler also answers a
 * failure that no code of the closed vocabulary owns.
 */
export function envelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

/**
 * The error a route throws: the status it is answered with, the closed code the contract
 * gives it, and the message the client receives.
 *
 * It is a data carrier. The constructor stores the pair exactly as given and never
 * consults {@link ERROR_STATUS}, because deriving a status from the code would make the
 * first argument meaningless; {@link toApiError} is the one place the two are derived
 * together. Every message is sent as written, so a caller passes a short client-facing
 * sentence and never a driver message, a stack line or a path.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /**
   * The refusal of a request whose `X-Demo-Account` header is absent or names no seeded
   * demo account — the only `401` the API produces.
   *
   * The default sentence states the requirement the request did not meet without echoing
   * the header's value, and says nothing about credentials, sessions, tokens or login:
   * that header selects a synthetic role and is never authentication. An override is
   * sent as written, so it must be a short client-facing sentence like the default.
   */
  static unauthorized(message?: string): ApiError {
    return new ApiError(
      401,
      'unauthorized',
      message ?? 'This request requires a demo account that resolves to a seeded one.',
    );
  }

  /**
   * The refusal of a request whose resolved demo account does not carry the role the
   * endpoint requires. The default sentence names the role mismatch and nothing about
   * the account itself; an override is sent as written.
   */
  static forbidden(message?: string): ApiError {
    return new ApiError(
      403,
      'forbidden',
      message ?? 'This demo account does not have the role this request requires.',
    );
  }

  /**
   * The refusal of a request for a resource that does not exist — an unknown listing, a
   * withdrawn version, an unknown report. An override is sent as written.
   */
  static notFound(message?: string): ApiError {
    return new ApiError(404, 'not_found', message ?? 'The requested resource does not exist.');
  }

  /**
   * The refusal of a request that fails the shape its endpoint validates, including the
   * `422` cases an endpoint raises after validation. An override is sent as written.
   */
  static validation(message?: string): ApiError {
    return new ApiError(400, 'validation_error', message ?? 'The request is not valid.');
  }
}

/**
 * Whether a value is one of this module's errors.
 *
 * `instanceof` and nothing else: a domain refusal carries a `code` but no `status`, so a
 * structural check would mistake one for an `ApiError` and pass a value to a caller that
 * then reads a status which is not there. The walk of the value's prototype chain itself is
 * guarded, because the value is arbitrary: `instanceof` reads that chain, and a proxy whose
 * `getPrototypeOf` trap raises — a revoked proxy does — would otherwise throw here and cost
 * a client the envelope. A chain that cannot be read answers `false`: nothing is repaired
 * and nothing permissive is substituted, so the value falls through to the `500
 * internal_error` answer {@link toApiError} gives what it cannot map.
 */
export function isApiError(value: unknown): value is ApiError {
  try {
    return value instanceof ApiError;
  } catch {
    return false;
  }
}

/**
 * The sentence a client receives for a server fault: the substitution at a status of `500`
 * or above, and the answer of the unmapped-code fallback. One fixed sentence that names no
 * path, no identifier, no stack and no hint of the cause. The cause itself is logged by
 * the error handler.
 */
const GENERIC_MESSAGE = 'The request could not be completed. The failure has been recorded.';

/**
 * The sentence a client receives for a client error: the substitution at a status below
 * `500`. It describes the request as it was sent and claims nothing about the failure
 * beyond that, because {@link GENERIC_MESSAGE} says the failure was recorded — a
 * server-side claim that misdescribes a `4xx`.
 */
const CLIENT_ERROR_MESSAGE = 'The request could not be completed as sent.';

/**
 * The longest message that may be sent to a client. A longer one is a report or a stack
 * rather than a sentence, so it is replaced by the sentence {@link safeMessageOf} selects
 * for the status the failure is answered with.
 */
const MAX_SAFE_MESSAGE_LENGTH = 200;

/**
 * Literal substrings that disqualify a thrown message from being sent to a client: a
 * newline or a stack frame, a module path or a filesystem separator, a SQLite file or
 * in-memory path, and a SQL statement keyword. They exist because an error state must
 * render an explanation and never an error trace, and a message that carries one of them
 * is a trace, a driver report or a query rather than a sentence.
 *
 * Matched case-sensitively: these spellings are distinctive enough in a sentence, while a
 * case-insensitive match on `UPDATE` or `DELETE` would reject ordinary prose about those
 * actions.
 */
const UNSAFE_MESSAGE_MARKERS: readonly string[] = Object.freeze([
  '\n',
  '\r',
  ' at ',
  'node_modules',
  '/',
  '\\',
  '.sqlite',
  ':memory:',
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
]);

/**
 * The markers whose spelling varies with the driver build, matched case-insensitively.
 * `better-sqlite3` names its failures above a `sqlite`/`SQLITE_` prefix — for example
 * `SQLITE_CONSTRAINT_UNIQUE` — so both spellings of the prefix are caught.
 */
const UNSAFE_MESSAGE_MARKERS_IGNORING_CASE: readonly string[] = Object.freeze([
  'sqlite',
  'sqlite_',
]);

/**
 * A C0 control character or DEL: a message carrying one is a stack line, a serialized
 * structure or an escape rather than a sentence. `\n` and `\r` are named individually in
 * {@link UNSAFE_MESSAGE_MARKERS} as well, and this general guard is what catches the
 * others — a tab-indented frame, a vertical tab or a form feed — whose exact spelling a
 * literal list would never be complete enough to hold. Applied without the `g` flag, so
 * the pattern carries no state between calls.
 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Reads a candidate string property from a thrown value of any type.
 *
 * Only an object that is neither `null` nor a function can carry one, so every other
 * value — a primitive, a function, `null` — yields `undefined` instead of a TypeError. The
 * read itself is guarded because the value is arbitrary: an accessor or a proxy trap that
 * raises must yield no property rather than propagate out of the mapper and cost a client
 * the envelope. Nothing is repaired and nothing permissive is substituted — a property that
 * cannot be read yields `undefined`, the same answer a value carrying no such property
 * yields.
 */
function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  let candidate: unknown;
  try {
    candidate = (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * The stable code a thrown value carries, read from `code` first and `reason` second.
 *
 * Two packages refuse in two shapes: `@adem/sgi-core` throws an error carrying a stable
 * `code`, while `@adem/commerce-sim` returns a discriminated result whose failing arm
 * spells the same string `reason`. Reading both here means one mapping table serves both
 * packages and no route writes a conversion of its own. A missing, empty or
 * whitespace-only string is not a code.
 */
function stableCodeOf(error: unknown): string | undefined {
  for (const key of ['code', 'reason']) {
    const value = readStringProperty(error, key);
    if (value !== undefined && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * The status {@link ERROR_STATUS} records for a code, or `undefined` when it records
 * none.
 *
 * An own-property test rather than a plain lookup, because the code read here came from
 * an arbitrary thrown value: a string naming an inherited member of any object —
 * `constructor`, `toString`, `hasOwnProperty`, `__proto__` — would otherwise return that
 * member from the map and be answered with it as a status. The second check keeps the
 * result a number whatever the map holds, and is what lets a caller treat `undefined` as
 * "no status for this code".
 */
function knownStatusOf(code: string): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(ERROR_STATUS, code)) {
    return undefined;
  }
  const status: number | undefined = ERROR_STATUS[code as ApiErrorCode];
  return typeof status === 'number' ? status : undefined;
}

/**
 * Whether a thrown message may be sent to a client: a message of at most
 * {@link MAX_SAFE_MESSAGE_LENGTH} characters that is not blank, carries no control
 * character, and contains none of the markers in {@link UNSAFE_MESSAGE_MARKERS} or
 * {@link UNSAFE_MESSAGE_MARKERS_IGNORING_CASE}.
 *
 * Every test reads the message exactly as it will be sent, never a trimmed copy of it, so
 * a value that passes the gate is the value a client receives — a trailing newline or a
 * path cannot ride along on the untested form. The length bound is applied first, so the
 * checks below run on a string a client could actually receive.
 */
function isSafeMessage(message: string): boolean {
  if (message.length > MAX_SAFE_MESSAGE_LENGTH || message.trim().length === 0) {
    return false;
  }
  if (CONTROL_CHARACTER_PATTERN.test(message)) {
    return false;
  }
  for (const marker of UNSAFE_MESSAGE_MARKERS) {
    if (message.includes(marker)) {
      return false;
    }
  }
  const lowered = message.toLowerCase();
  for (const marker of UNSAFE_MESSAGE_MARKERS_IGNORING_CASE) {
    if (lowered.includes(marker)) {
      return false;
    }
  }
  return true;
}

/**
 * The message a client receives for a thrown value at the status it is answered with: the
 * caller's own sentence when it passes the safety gate, and the sentence substituted for
 * that status when it is absent, blank, too long or carries a stack, a driver report, a
 * query or a path — {@link CLIENT_ERROR_MESSAGE} below `500` and {@link GENERIC_MESSAGE} at
 * `500` and above, so an answered client error is never described as a failure recorded
 * server-side. A message that passes the gate is sent unchanged.
 */
function safeMessageOf(error: unknown, status: number): string {
  const message = readStringProperty(error, 'message');
  if (message !== undefined && isSafeMessage(message)) {
    return message;
  }
  return status >= 500 ? GENERIC_MESSAGE : CLIENT_ERROR_MESSAGE;
}

/**
 * Maps a thrown value to an {@link ApiError}.
 *
 * Returns an `ApiError` for every input and never throws, so a mapping that cannot be
 * made cannot turn one failure into two. In order:
 *
 * 1. An `ApiError` is returned unchanged, never re-wrapped and never re-messaged.
 * 2. The value's stable code is read from a string `code`, or failing that a string
 *    `reason` (see {@link stableCodeOf} for why both spellings exist).
 * 3. A code {@link ERROR_STATUS} records — matched as an own entry of that map, so a
 *    string naming an inherited member of an object is not mistaken for one — yields that
 *    status with the code **preserved** as the domain spelled it:
 *    `incomplete_submission` and `not_offered` are answered as `422 incomplete_submission`
 *    and `422 not_offered`, not as a generic `unprocessable`, which is what
 *    `STATUS_DEFAULT_CODE` yields when only a numeric status is known. The message comes
 *    from the gate in {@link safeMessageOf}, which substitutes the sentence for this
 *    status when the thrown message cannot be sent, so the status a client is answered with
 *    and the sentence it reads always agree and a mapped client error never claims the
 *    failure was recorded.
 * 4. Anything else becomes `500 internal_error` with {@link GENERIC_MESSAGE} — a code
 *    that is absent, empty, unreadable, or simply not in the vocabulary. That last case
 *    is deliberate and is what makes a composition-time defect safe: `seam_validation`,
 *    `duplicate_extension` and `unknown_event_type` are absent from {@link ERROR_STATUS},
 *    so a programming error surfaces as a generic server failure rather than being
 *    answered as if a client had sent something invalid. A driver failure such as
 *    `SQLITE_CONSTRAINT_UNIQUE` is unmapped for the same reason.
 */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  const code = stableCodeOf(error);
  if (code !== undefined) {
    const status = knownStatusOf(code);
    if (status !== undefined) {
      return new ApiError(status, code as ApiErrorCode, safeMessageOf(error, status));
    }
  }

  return new ApiError(500, 'internal_error', GENERIC_MESSAGE);
}
