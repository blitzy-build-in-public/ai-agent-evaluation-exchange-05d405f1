/**
 * Reading a value that crossed the client boundary, and rendering one recorded instant.
 *
 * This module owns two jobs and nothing else: turning a value the workspace did not construct — a
 * payload `./api-client` normalised, or a failure it raised — into a typed value a component or a page
 * can render, and turning a stored ISO-8601 UTC instant into the text beside its machine-readable
 * value. It is the workspace's one place for both, so a rule about a payload's shape, a failure's facts
 * or an instant's rendering is stated once rather than in every copy of it.
 *
 * **It holds no business rule.** There is no status-to-sentence map here, no vocabulary of the
 * product's own, no derivation of an outcome, a label, a count or an amount, and no sentence the
 * product's copy discipline fixes: a caller passes its own words in and receives its own words back, so
 * deciding what a `409` means, or how a throttled write is described, stays with the surface that
 * renders it.
 *
 * **It imports nothing at all.** `./api-client` imports this module, so a single import here would be a
 * cycle; the JSX below is compiled by the workspace's `jsx: react-jsx` setting, which is why no React
 * import is needed either.
 */

/**
 * The four facts a failure that crossed the boundary is reduced to.
 *
 * None of them is a response, a body or a URL, so an explanation built from these can carry all four
 * without leaking any of those.
 */
export interface WriteFailureFacts {
  /** The status the request was answered with, or `0` when no response was received at all. */
  readonly status: number;
  /** The stable code the service answered with. */
  readonly code: string;
  /** A sentence a caller can render as it stands. */
  readonly message: string;
  /** Whole seconds to wait, from a `Retry-After`; `null` when the response stated none. */
  readonly retryAfterSeconds: number | null;
}

/** One stored instant as it renders: the machine-readable value, and the text a reader sees. */
export interface InstantReading {
  /** The value for a `<time datetime>`, or `null` when the record states no parseable instant. */
  readonly dateTime: string | null;
  /** The text a reader sees: a date and a time in UTC, or what the record does state. */
  readonly text: string;
}

/**
 * Whether a value is a JSON object rather than an array, `null` or a primitive.
 *
 * Every value read off a payload goes through it, so a shape of any other kind is handled rather than
 * assumed — including an array, which `typeof` alone would accept.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A value as a string, and the empty string when it is not one.
 *
 * For a field the caller may render blank: an absent or mistyped property renders as no text rather
 * than as an explanation.
 */
export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A value as a non-blank string, or `null`.
 *
 * An empty property is not a fact: a value that is absent, blank or of another type is refused, so the
 * caller states its own substitute instead of rendering a space where text belongs. A value that
 * carries text is returned as it stands.
 */
export function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() === "" ? null : value;
}

/**
 * A value as a finite number, or `null`.
 *
 * `0` is kept rather than treated as absent: it is the status the client reports when no response was
 * received at all, which is a state callers explain like any other.
 */
export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A value as a whole, non-negative number, or `null` — for a count a payload states.
 *
 * A fraction, a negative or a value that is not a number at all is refused rather than rendered as a
 * figure the record could not hold.
 */
export function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A value as a member of a closed vocabulary, or `null` when it names no member of it.
 *
 * Generic over the vocabulary's own union, so the caller receives the member type rather than a string.
 * The vocabulary is walked member by member rather than searched with `includes`, which takes the
 * member type and would therefore need a cast to be handed the value being tested for membership.
 */
export function readMember<T extends string>(value: unknown, vocabulary: readonly T[]): T | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const member of vocabulary) {
    if (member === value) {
      return member;
    }
  }
  return null;
}

/**
 * The HTTP status a raised value carries, or `null`.
 *
 * A record's `status` is read when it is a finite number, and any other value — a bare string, a
 * primitive, a record without a status — yields `null`: a caller branching on one status, such as the
 * read failure's `404` alone, never mistakes a value that carries none for the status it looks for.
 */
export function statusOf(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  return readNumber(error["status"]);
}

/**
 * Narrows a raised value into the four facts a sentence can be built from, or `null`.
 *
 * The value must be a record whose `status` is a finite number and whose `code` and `message` are
 * non-blank strings; `retryAfterSeconds` is a finite number when the value states one and `null`
 * otherwise.
 *
 * The reading is structural and never by class, because a failure crosses a module boundary: it is read
 * as the data it carries rather than as an instance of the class that raised it, so a failure raised
 * from another realm or by a future client path is explained exactly as the present one is. A value of
 * any other shape — a bare string, a primitive, an object with no status — yields `null`, so the caller
 * renders its own generic explanation rather than mistaking it for a client failure.
 */
export function readWriteFailure(error: unknown): WriteFailureFacts | null {
  if (!isRecord(error)) {
    return null;
  }
  const status = readNumber(error["status"]);
  const code = readText(error["code"]);
  const message = readText(error["message"]);
  if (status === null || code === null || message === null) {
    return null;
  }
  return { status, code, message, retryAfterSeconds: readNumber(error["retryAfterSeconds"]) };
}

/**
 * The sentence with a full stop of its own when it has none, so two sentences joined always read as
 * two. A sentence that already ends in `.`, `!` or `?` is returned as it stands.
 */
export function withFullStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * The wait a throttled response stated, in whole seconds as a reader says them, followed by the
 * caller's own tail clause.
 *
 * The caller supplies the action — `"then send it again."`, `"then post the question again."` — which
 * is what makes one function serve every form's own wording while the wait itself is stated once. A
 * missing, zero or negative wait renders as a moment rather than as no time, one second is written in
 * the singular, and any longer wait is rounded up to the whole second a reader would count, so nobody
 * is told to wait for `0 seconds`, for a negative time or for `1 seconds`.
 */
export function describeRetryWait(retryAfterSeconds: number | null, retryAction: string): string {
  if (retryAfterSeconds === null || retryAfterSeconds < 1) {
    return `Wait a moment, ${retryAction}`;
  }
  const wholeSeconds = Math.ceil(retryAfterSeconds);
  return wholeSeconds === 1
    ? `Wait 1 second, ${retryAction}`
    : `Wait ${wholeSeconds} seconds, ${retryAction}`;
}

/** An ISO-8601 UTC instant as the API writes it, which is the only shape rendered as a `<time>`. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/;

/**
 * A stored ISO-8601 UTC instant as text a reader can compare between rows.
 *
 * A string is trimmed and read as it stands; any other value is never coerced, so a record that states
 * no instant renders words rather than `Invalid Date`. The stored value is rendered as the UTC it is —
 * the date, the time and the `UTC` the value is in — rather than through a locale- and
 * timezone-dependent formatter, so two readers in two places read the same instant and nothing depends
 * on the machine's clock or settings. That is the same rule the evaluator's own determinism rests on,
 * applied to the UI's display of stored data.
 *
 * A value that does not match the pattern is never rendered as an empty element: it renders as the text
 * the record states, or as words saying no time is stated when it is blank.
 */
export function readInstant(value: unknown): InstantReading {
  const instant = typeof value === "string" ? value.trim() : "";
  if (!ISO_INSTANT_PATTERN.test(instant)) {
    return {
      dateTime: null,
      text: instant === "" ? "a time the record does not state" : instant,
    };
  }
  return { dateTime: instant, text: `${instant.slice(0, 10)} ${instant.slice(11, 16)} UTC` };
}

/**
 * One recorded instant: a `<time>` element carrying the machine-readable value when the record holds
 * one, and the words either way — never an empty element and never `null`, so a row of a table always
 * states something where an instant belongs.
 */
export function Timestamp(props: { readonly value: unknown }): JSX.Element {
  const reading = readInstant(props.value);
  if (reading.dateTime === null) {
    return <>{reading.text}</>;
  }
  return <time dateTime={reading.dateTime}>{reading.text}</time>;
}
