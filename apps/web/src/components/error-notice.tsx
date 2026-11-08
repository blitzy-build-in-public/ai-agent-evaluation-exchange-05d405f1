/**
 * The one visible rendering of a failed request: the explanation a reader gets where the product
 * shows no error trace.
 *
 * Every failure in the UI arrives as the value a call in `api-client.ts` threw, and this component
 * is the only place that turns such a value into words. Three decisions shape what it does with one.
 *
 * **It narrows the value, then maps by status.** The value is `unknown` — the client's own error, or
 * whatever a caller passed — so the facts it may carry are read defensively, and a value that is not
 * an error at all still renders an explanation rather than nothing, because a failure that renders
 * silence is worse than one that renders a generic sentence. The sentence is chosen from the HTTP
 * status, the field the contract fixes once per status; the `code` never chooses it, because the code
 * vocabulary carries the domain refusals too and grows as the domains do while the statuses stay
 * eight. The server's own sentence is added as a detail line only for the statuses where the server
 * knows more than this component can: which parameter, which record, which state, which case.
 *
 * **It renders no trace.** No trace frame, no raw response body, no serialized structure, no driver
 * message and no path: the sentences are this component's own, and the server's sentence is admitted
 * only when it is one short line free of the markers that spell a trace. It is never admitted for an
 * internal failure, because the generic sentence on the server side exists so that nothing internal
 * reaches a client and echoing whatever arrived would defeat it.
 *
 * **It announces politely, once.** The message is a status change, so it sits in one polite live
 * region; a retry control the caller supplies sits outside that region, so the announcement carries
 * the explanation rather than a control. A retryable failure never interrupts a screen-reader user,
 * and a caller that has no failure renders no notice at all rather than an empty region.
 *
 * A successful-but-empty result is not this component's state: that belongs to `empty-state.tsx`.
 *
 * Appearance belongs to the `.error-notice` and `.notice*` rules in the workspace stylesheet and to
 * the custom properties the token file defines. This file imports no stylesheet, carries no inline
 * style, no icon and no component-library class.
 */

import type { ReactNode } from "react";
import type { ApiClientError } from "../api-client";

/**
 * Props for {@link ErrorNotice}.
 */
export interface ErrorNoticeProps {
  /**
   * The value a failed `api-client` call threw, narrowed structurally here: an object carrying a
   * numeric `status`, an optional string `code`, an optional string `message` and an optional numeric
   * `retryAfterSeconds`. Any other value renders the generic explanation rather than nothing.
   */
  readonly error: unknown;
  /** Optional retry control. Rendered only when supplied — never as a disabled or inert control. */
  readonly onRetry?: () => void;
  /** Optional extra content explained alongside, such as the case ids a `422` named. */
  readonly detail?: ReactNode;
}

/**
 * The four facts this component reads from a failed call, spelled from the client's own error type so
 * that a property it renames fails the build here rather than rendering as a fact that went missing.
 */
type FailureField = keyof Pick<ApiClientError, "status" | "code" | "message" | "retryAfterSeconds">;

/**
 * One fact from a thrown value of any type, or `undefined`.
 *
 * Only an object that is neither `null` nor a function can carry one, so every other value — a bare
 * string, a number, `null` — yields `undefined` instead of a TypeError. The read itself is guarded
 * because the value is arbitrary: an accessor or a proxy trap that raises must cost a reader the
 * detail, never the page. Nothing is repaired and nothing permissive is substituted, so a fact that
 * cannot be read counts as a fact that is not there and the generic sentence is rendered instead.
 */
function readFailureField(error: unknown, field: FailureField): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  try {
    return Reflect.get(error, field);
  } catch {
    return undefined;
  }
}

/** Whether a value is a status this component can choose a sentence from: a whole, non-negative number. */
function isStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Whether a value is a usable wait: a finite, non-negative number of seconds. */
function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The longest server sentence this component will render. A longer one is a report or a trace rather
 * than a sentence, so the explanation is rendered without it.
 */
const RENDERABLE_MESSAGE_MAX_LENGTH = 200;

/**
 * The characters a sentence the server wrote may consist of: letters, digits, spaces and ordinary
 * sentence punctuation.
 *
 * Stated as what may appear rather than as what may not, because the machine output that must never
 * reach a page has no closed vocabulary: a failed constraint, a serialized value, a query and a frame
 * all spell themselves with characters — an underscore, an equals sign, a bracket, a brace, a slash —
 * that no sentence in this product leaves unexamined.
 */
const RENDERABLE_SENTENCE_PATTERN = /^[A-Za-z0-9 .,;:!?'"()%\-\u2013\u2014]+$/;

/**
 * The substrings of the product's own machine vocabulary that a sentence made only of the characters
 * above could still carry: a line break or a trace frame, a module path, a filesystem or in-memory
 * database path, and a SQL statement keyword.
 *
 * They are here because an error state renders an explanation and never a trace. The API applies this
 * class of rule before it sends a message, so this is a second line of defence and not the only one:
 * a body that never came from the API's own encoder — or that a proxy or a defect produced — would
 * otherwise reach the page unexamined, and a message is echoed for its content and not for its
 * origin.
 */
const UNRENDERABLE_MESSAGE_MARKERS: readonly string[] = Object.freeze([
  "\n",
  "\r",
  " at ",
  "node_modules",
  "/",
  "\\",
  ":memory:",
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
]);

/**
 * A C0 control character or DEL: a serialized structure or an escape rather than a sentence. Named
 * separately from the markers above because a literal list of them would never be complete. Carried
 * without the `g` flag, so the pattern holds no state between calls.
 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Whether a server sentence may be rendered as a detail line: one short, single-line string written
 * in ordinary prose, carrying none of the markers that spell a trace.
 */
function isRenderableMessage(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const sentence = value.trim();
  if (sentence === "" || sentence.length > RENDERABLE_MESSAGE_MAX_LENGTH) {
    return false;
  }
  if (!RENDERABLE_SENTENCE_PATTERN.test(sentence)) {
    return false;
  }
  if (CONTROL_CHARACTER_PATTERN.test(sentence)) {
    return false;
  }
  return !UNRENDERABLE_MESSAGE_MARKERS.some((marker: string): boolean => sentence.includes(marker));
}

/**
 * What one failure renders: the variant that carries it, the sentence that says what happened, the
 * sentence that says what the reader can do next, and whether the server's own sentence may be added
 * as a detail line.
 */
interface FailureText {
  /** The stylesheet's own variant class for the notice surface. */
  readonly variant: "notice--error" | "notice--warning";
  /** The sentence that says what happened, in plain words rather than as a status code. */
  readonly explanation: string;
  /** The sentence that says what to do next; every failure has one. */
  readonly guidance: string;
  /** Whether the server's sentence may be rendered as a detail line for this failure. */
  readonly echoServerMessage: boolean;
}

/**
 * The sentence each status the contract fixes renders, chosen by status and never by code.
 *
 * Six rows: a `429` is built from the wait its response stated and a `500` is the generic sentence
 * below, so neither is a row here. The map is a partial record, read exactly as the API reads its own
 * status-to-code map, so a status it does not hold renders the generic sentence rather than nothing.
 *
 * The four that echo the server's sentence are the ones where the server knows what this component
 * cannot: which parameter failed validation, which record does not exist, which state a record is
 * already in, which part of a request is missing. The two that do not are one role mismatch each,
 * which the sentence here already states in full.
 */
const STATUS_TEXT: Readonly<Partial<Record<number, FailureText>>> = Object.freeze({
  400: {
    variant: "notice--error",
    explanation: "This request was not accepted as it was sent.",
    guidance: "Correct the field or filter value, then send the request again. Nothing was saved.",
    echoServerMessage: true,
  },
  401: {
    variant: "notice--error",
    explanation: "No demo account is selected, so this request was not sent with a role to act as.",
    guidance: "Choose a demo account in the demo-account switcher, then send the request again.",
    echoServerMessage: false,
  },
  403: {
    variant: "notice--error",
    explanation: "The selected demo account does not have the role this action requires.",
    guidance:
      "Switch to a demo account whose role allows it in the demo-account switcher, then send the request again.",
    echoServerMessage: false,
  },
  404: {
    variant: "notice--error",
    explanation:
      "The record this request asks for does not exist, or a listing it names has been hidden from public view.",
    guidance: "Return to browsing to see what is published. Nothing was changed.",
    echoServerMessage: true,
  },
  409: {
    variant: "notice--error",
    explanation: "The record is already in the state this request asked for, so nothing was changed.",
    guidance: "Reload the page to see the state the record is in, then choose a different change.",
    echoServerMessage: true,
  },
  422: {
    variant: "notice--error",
    explanation: "This request was well formed, but it is incomplete and was not accepted as it stands.",
    guidance: "Adjust the request as described, then send it again. Nothing was saved.",
    echoServerMessage: true,
  },
});

/**
 * The sentence for a `500` and for every status the contract does not fix — a failure produced by a
 * proxy, by a defect, or by a body the client could not read. It says the failure is not the reader's
 * and names nothing internal, because nothing internal is known here.
 */
const GENERIC_TEXT: FailureText = Object.freeze({
  variant: "notice--error",
  explanation:
    "The request could not be completed because of a problem on our side. Nothing you sent caused it.",
  guidance: "Nothing was saved, so sending the request again is safe.",
  echoServerMessage: false,
});

/**
 * The sentence for a request that received no response at all. The client reports this as status `0`,
 * which is the only thing that status means, so a reader is told the service was not reached rather
 * than that a request failed somewhere on the server.
 */
const TRANSPORT_TEXT: FailureText = Object.freeze({
  variant: "notice--error",
  explanation: "The service could not be reached, so this request was not sent.",
  guidance: "Check the connection, then send the request again. Nothing was saved.",
  echoServerMessage: false,
});

/** The status a transport failure carries: no response was received, so there is no HTTP status. */
const TRANSPORT_STATUS = 0;

/** The status of the write rate limit, whose sentence is built from the wait the response stated. */
const RATE_LIMITED_STATUS = 429;

/**
 * The code an internal failure carries, spelled here because the API workspace cannot be imported
 * from this one — the same reason `api-client.ts` restates the status-to-code map. It is read for one
 * decision only: whether the server's own sentence may be echoed.
 */
const INTERNAL_ERROR_CODE = "internal_error";

/** Whole seconds as a reader says them, so a retry sentence never reads "1 seconds". */
function describeSeconds(seconds: number): string {
  const whole = Math.ceil(seconds);
  return whole === 1 ? "1 second" : `${whole} seconds`;
}

/**
 * The sentence for a throttled write, built from the wait the response stated in `Retry-After` and
 * never from a delay of this component's own: the limit belongs to the service, and only the response
 * knows when the window resets. A response that stated no usable wait says the request can be sent
 * again shortly without inventing a number, and one whose wait has already passed says so.
 *
 * The variant is the warning one rather than the error one, because the request was refused and can
 * simply be sent again — which is what the stylesheet's warning surface is for.
 */
function rateLimitedText(retryAfterSeconds: number | undefined): FailureText {
  const refusal =
    "Too many requests: this client has sent the maximum number of writes allowed in a minute";
  let explanation: string;
  if (retryAfterSeconds === undefined) {
    explanation = `${refusal}, so this request was not sent. It can be retried shortly.`;
  } else if (retryAfterSeconds < 1) {
    explanation = `${refusal}, and the wait has passed, so send it again now.`;
  } else {
    explanation = `${refusal}. Try again in ${describeSeconds(retryAfterSeconds)}.`;
  }
  return {
    variant: "notice--warning",
    explanation,
    guidance: "Nothing from this request was applied, so sending it again is safe.",
    echoServerMessage: false,
  };
}

/**
 * The text one failure renders, from the status it carries and the one thing its code decides.
 *
 * An internal failure never echoes the server's sentence, whatever else the value holds: the generic
 * sentence on the server side exists so that nothing internal reaches a client, and a failure the
 * client itself raised when a body was not the shape its contract fixes carries this same code.
 */
function textFor(
  status: number | undefined,
  raisedInternally: boolean,
  retryAfterSeconds: number | undefined,
): FailureText {
  if (status === TRANSPORT_STATUS) {
    return TRANSPORT_TEXT;
  }
  if (status === RATE_LIMITED_STATUS) {
    return rateLimitedText(retryAfterSeconds);
  }
  const mapped = status === undefined ? undefined : STATUS_TEXT[status];
  if (mapped === undefined) {
    return GENERIC_TEXT;
  }
  return raisedInternally ? { ...mapped, echoServerMessage: false } : mapped;
}

/**
 * The visible rendering of a failed request: what happened, what it means for the reader, and how to
 * send it again.
 *
 * A pure render of its props — no state, no effect, no request and no storage of its own — so a page
 * can place it wherever it holds the value a call threw, and a rerender of an unchanged failure
 * changes no text and therefore announces nothing again.
 */
export function ErrorNotice(props: ErrorNoticeProps): JSX.Element {
  const status = readFailureField(props.error, "status");
  const code = readFailureField(props.error, "code");
  const message = readFailureField(props.error, "message");
  const retryAfterSeconds = readFailureField(props.error, "retryAfterSeconds");

  const text = textFor(
    isStatus(status) ? status : undefined,
    code === INTERNAL_ERROR_CODE,
    isSeconds(retryAfterSeconds) ? retryAfterSeconds : undefined,
  );
  const serverSentence = text.echoServerMessage && isRenderableMessage(message) ? message : null;

  return (
    <div className={`error-notice notice ${text.variant}`}>
      {/* One polite live region, holding the whole message. `role="status"` is the pattern the app
          announces status changes with and makes the region atomic; `aria-live` states the same
          politeness explicitly — polite either way, and never an alert, which would interrupt a
          screen-reader user for a failure that can simply be sent again. The retry control is
          deliberately outside the region, so the announcement carries the message and not a control. */}
      <div className="status-region" role="status" aria-live="polite">
        <p>{text.explanation}</p>
        {serverSentence === null ? null : <p>{serverSentence}</p>}
        <p>{text.guidance}</p>
        {props.detail === undefined || props.detail === null ? null : (
          <div>{props.detail}</div>
        )}
      </div>
      {props.onRetry === undefined ? null : (
        <div>
          <button type="button" className="button button--secondary" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

