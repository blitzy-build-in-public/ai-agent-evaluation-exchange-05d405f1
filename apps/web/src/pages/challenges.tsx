/**
 * The `/challenges` route: the public challenges board, and the responses a challenge collects.
 *
 * A challenge is a buyer's public question about a listing's claims. The board lists every
 * challenge in the order the service returned it, a reader opens one through the query parameter
 * it is addressed by, and either the buyer who asked or the listing's developer answers it here.
 * A challenge is a question and never a measurement: nothing on this page describes a question or
 * an answer as evidence for a listing's claims, as a pass, or as anything about safety.
 *
 * Five decisions shape this file, each of which a later reader could otherwise "improve" into a
 * bug.
 *
 *   - **The selection lives in the address and nowhere else.** `?id=<challenge id>` is the whole
 *     of this page's state: every challenge on the board is a `<Link>` that rewrites that one
 *     parameter, `useSearchParams` reads it back, and clearing it returns to the whole board. There
 *     is no context provider, no shared state module and no stored preference, so a challenge is
 *     linkable and a reload of a link opens the same challenge.
 *
 *   - **The listing picker reads the public search, and for one reason.** A challenge cannot be
 *     written without a `listing_id` — `POST /challenges` requires one — and the contract exposes
 *     no listing-options read, so the first page of `listListings` supplies the picker above the
 *     create form. That read is this page's only listing read, and it is a public one.
 *
 *   - **The board is re-read, never patched.** A posted challenge, a posted response and a failed
 *     read all lead to the same thing: `GET /challenges` is read again and whatever came back is
 *     rendered. The order, the statuses and the response counts are therefore always the
 *     service's, and this page holds no copy of a row it edited itself.
 *
 *   - **The create form reports nothing to its parent, so its announced outcome is observed.** The
 *     form is a sibling component whose props are fixed to the listing it writes against; it
 *     cannot tell this page that a challenge was posted. It does announce every outcome in its own
 *     polite status region, and that announcement is observed on a ref, because the read it
 *     triggers is public and idempotent: a refused post costs one redundant read and can never
 *     produce a wrong state.
 *
 *   - **Every outcome a reader can meet is rendered in words.** A blank board, a challenge no one
 *     has answered, a selection naming no challenge on the board, a refused write, a spent write
 *     rate limit and a read that failed each get their own explanation and their own next step. No
 *     failure renders a stack trace, a raw response body or a URL: the two reads render
 *     `ErrorNotice`, and the response form renders the sentences declared below.
 *
 * Presentation only. Every read and write goes through `../api-client`, which owns the service's
 * address, the header naming the selected demo account and the one failure envelope; this file
 * holds no URL of the service, no header, no `fetch`, no storage and no cookie. Appearance belongs
 * to the classes `styles/app.css` defines, so nothing here imports a stylesheet or carries a style
 * of its own.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_LISTING_SORT, DEMO_AUTHENTICATION_LABEL, WRITE_RATE_LIMIT_MAX } from "@adem/shared";
import type { ChallengeStatus, ListingSearchResult, ListingSummary } from "@adem/shared";
import { listChallenges, listListings, respondToChallenge } from "../api-client";
import type { ChallengeListItem } from "../api-client";
import { ChallengeForm } from "../components/challenge-form";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";

/** The route this page is served at: the target of every link that selects or clears a challenge. */
const CHALLENGES_PATH = "/challenges";

/** The route prefix of a listing's own page, which each board entry links to. */
const LISTING_PATH_PREFIX = "/listings";

/**
 * The one query parameter this page reads and writes: the challenge a reader selected. It is the
 * page's only parameter, so a link carrying it rewrites exactly that parameter and nothing else.
 */
const SELECTED_CHALLENGE_PARAM = "id";

/** The page of the listing search the challenge picker reads: the first one, and only that one. */
const FIRST_PAGE = 1;

/** The word the open state is stated with, so a status is never conveyed by colour alone. */
const STATUS_WORD_OPEN = "Open";

/** The word the responded state is stated with, for the same reason as {@link STATUS_WORD_OPEN}. */
const STATUS_WORD_RESPONDED = "Responded";

/** The word used for a status the closed vocabulary does not hold, rather than an empty space. */
const STATUS_WORD_UNKNOWN = "Status not stated";

/** The sentence beside the response field when nothing was entered. */
const BLANK_RESPONSE_SENTENCE = "Enter your response to this challenge.";

/** The sentence beside the response field when the service refused it as written. */
const REFUSED_RESPONSE_SENTENCE =
  "The service did not accept this response as written. Edit it and post it again; the text you typed has been kept.";

/** The sentence the response form announces when the response itself was what failed. */
const REFUSED_RESPONSE_STATUS = "The response was not posted: see the message beside the field.";

/**
 * The sentence a raised value that carries none of the facts a sentence needs is announced with. It
 * states what did not happen and what is still available, which is all that can be said of it.
 */
const UNREADABLE_FAILURE_STATUS =
  "The response was not posted. Try again; the text you typed has been kept.";

/** The sentence announced when the response was written. */
const POSTED_RESPONSE_STATUS =
  "Response posted. It is now on this challenge, and the challenge reads as responded on the board.";

/** This form's own marker for a response that was never sent, kept apart from the service's codes. */
const LOCAL_BLANK_RESPONSE_CODE = "local_blank_response";

/**
 * One challenge as the picker offers it: the identifier a write sends, and the label a reader
 * chooses by. Built from the search payload once, so the picker never reads a raw listing row.
 */
interface ListingChoice {
  /** The listing identifier, sent as `listing_id` by the create form. */
  readonly id: string;
  /** The listing's title, with its developer's handle, in one line. */
  readonly label: string;
}

/**
 * What a failed response renders as: the sentence beside the field when the response itself is what
 * failed (`null` when it is not), the sentence the status region announces, and whether the state
 * offers the way back to the whole board.
 */
interface ResponseFailureReading {
  /** The sentence tied to the response field by `aria-describedby`, or `null`. */
  readonly fieldMessage: string | null;
  /** The sentence the form's polite status region announces. */
  readonly statusMessage: string;
  /** Whether the selected challenge is gone, so the explanation also offers the whole board. */
  readonly offersBoard: boolean;
}

/** A property that is a string, and the empty string for any other value. */
function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A sentence that ends with its own full stop, so two sentences joined always read as two. */
function withFullStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * A challenge's question as text, and a sentence in its place when the board states none.
 *
 * A recorded question is developer- and buyer-written text this page renders as it stands; it is
 * deliberately not trimmed for display beyond testing for emptiness, because the blank case is the
 * only case that needs a substitute.
 */
function readQuestion(value: unknown): string {
  const question = readText(value);
  return question.trim() === "" ? "A challenge whose question the board does not record" : question;
}

/** A response's text, with the same substitute for a response the board states without one. */
function readResponseBody(value: unknown): string {
  const body = readText(value);
  return body.trim() === "" ? "A response whose text the board does not record" : body;
}

/**
 * A challenge's status as a word. The vocabulary is closed to `open` and `responded`, and a value
 * outside it is stated rather than rendered as an empty space, so a payload this client did not
 * expect cannot produce a blank where a status belongs.
 */
function describeStatus(status: ChallengeStatus): string {
  if (status === "responded") {
    return STATUS_WORD_RESPONDED;
  }
  if (status === "open") {
    return STATUS_WORD_OPEN;
  }
  return STATUS_WORD_UNKNOWN;
}

/** How many responses a challenge has collected, as a reader counts them. */
function describeResponseCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "No responses yet";
  }
  if (count === 1) {
    return "1 response";
  }
  return `${count} responses`;
}

/** The one line a picker option shows: the listing's title and the handle of its developer. */
function describeListingChoice(listing: ListingSummary): string {
  const title = readText(listing.title).trim();
  const handle = readText(listing.developer_handle).trim();
  const named = title === "" ? "a listing with no title recorded" : title;
  return handle === "" ? named : `${named} — by ${handle}`;
}

/**
 * The picker's options, built from one page of the search read.
 *
 * A row without a usable identifier is left out rather than offered as a choice that could not be
 * sent, so the picker holds only listings a challenge can actually be attached to.
 */
function readListingChoices(items: readonly ListingSummary[]): readonly ListingChoice[] {
  const choices: ListingChoice[] = [];
  for (const item of items) {
    const id = readText(item.id).trim();
    if (id === "") {
      continue;
    }
    choices.push({ id, label: describeListingChoice(item) });
  }
  return choices;
}

/** The address that selects one challenge on the board, rewriting only the selection parameter. */
function selectionHref(challengeId: string): string {
  const params = new URLSearchParams();
  params.set(SELECTED_CHALLENGE_PARAM, challengeId);
  return `${CHALLENGES_PATH}?${params.toString()}`;
}

/** The address of one listing's own page, which a board entry links to. */
function listingHref(listingId: string): string {
  return `${LISTING_PATH_PREFIX}/${encodeURIComponent(listingId)}`;
}

/** The selected challenge's identifier from the address, or `null` when nothing is selected. */
function readSelectedChallengeId(searchParams: URLSearchParams): string | null {
  const selected = searchParams.get(SELECTED_CHALLENGE_PARAM);
  if (selected === null) {
    return null;
  }
  const trimmed = selected.trim();
  return trimmed === "" ? null : trimmed;
}

/** An ISO-8601 UTC instant as the API writes it, which is the only shape rendered as a `<time>`. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/;

/** One instant ready to render: the machine-readable value when it is one, and the text beside it. */
interface InstantReading {
  /** The value for `<time datetime>`, or `null` when the record states no parseable instant. */
  readonly dateTime: string | null;
  /** The text a reader sees: a date and a time in UTC, or what the record does state. */
  readonly text: string;
}

/**
 * An instant as text a reader can compare between rows.
 *
 * The stored value is an ISO-8601 UTC string and it is rendered as one — the date, the time and the
 * `UTC` the value is in — rather than through a locale- and timezone-dependent formatter, so two
 * readers in two places read the same instant, and nothing here depends on the machine's clock or
 * settings.
 */
function readInstant(value: unknown): InstantReading {
  const instant = readText(value).trim();
  if (!ISO_INSTANT_PATTERN.test(instant)) {
    return {
      dateTime: null,
      text: instant === "" ? "a time the record does not state" : instant,
    };
  }
  return { dateTime: instant, text: `${instant.slice(0, 10)} ${instant.slice(11, 16)} UTC` };
}

/**
 * One recorded instant: a `<time>` carrying the machine-readable value when the record holds one,
 * and its text either way. A record that states no parseable instant renders as words rather than
 * as an empty element or as `null`.
 */
function Timestamp(props: { readonly value: unknown }): JSX.Element {
  const reading = readInstant(props.value);
  if (reading.dateTime === null) {
    return <>{reading.text}</>;
  }
  return <time dateTime={reading.dateTime}>{reading.text}</time>;
}

/**
 * The facts a refused write is reduced to: the status it was answered with, the service's stable
 * code, its sentence, and — on a throttled write — the whole seconds a `Retry-After` stated.
 *
 * Structural on purpose, as the create form reads a refusal and for the same reason: a failure
 * crosses the client boundary, so it is read as data rather than as an instance of the class that
 * raised it.
 */
interface ResponseWriteFailure {
  /** The status the write was answered with, or `0` when no response was received at all. */
  readonly status: number;
  /** The stable code: the service's, or this form's own marker for a response never sent. */
  readonly code: string;
  /** A sentence this form can render as it stands. */
  readonly message: string;
  /** Whole seconds to wait, from a `Retry-After`; `null` when the response stated none. */
  readonly retryAfterSeconds: number | null;
}

/**
 * This form's own refusal of a blank response, in the shape a service refusal arrives in, so one
 * reading renders both. Its code is this form's marker rather than the service's, which is how a
 * response that was never sent and a response the service refused stay two different outcomes.
 */
const BLANK_RESPONSE_FAILURE: ResponseWriteFailure = Object.freeze({
  status: 400,
  code: LOCAL_BLANK_RESPONSE_CODE,
  message: BLANK_RESPONSE_SENTENCE,
  retryAfterSeconds: null,
});

/** The reading a blank response renders, kept frozen so two renders cannot diverge. */
const BLANK_RESPONSE_READING: ResponseFailureReading = Object.freeze({
  fieldMessage: BLANK_RESPONSE_SENTENCE,
  statusMessage: "The response was not posted, and no request was sent.",
  offersBoard: false,
});

/** The reading a response the service refused as written renders. */
const REFUSED_RESPONSE_READING: ResponseFailureReading = Object.freeze({
  fieldMessage: REFUSED_RESPONSE_SENTENCE,
  statusMessage: REFUSED_RESPONSE_STATUS,
  offersBoard: false,
});

/** Whether a raised value is an object facts can be read off. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A property that is a non-empty string, or `null`: an empty property is not a fact. */
function readNonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A property that is a finite number, or `null`.
 *
 * `0` is kept rather than treated as absent: it is the status the client reports when no response
 * was received at all, which is a state this form explains like any other.
 */
function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Narrows a raised value into the facts a sentence can be built from, or `null`. */
function readWriteFailure(error: unknown): ResponseWriteFailure | null {
  if (!isRecord(error)) {
    return null;
  }
  const status = readFiniteNumber(error["status"]);
  const code = readNonEmptyText(error["code"]);
  const message = readNonEmptyText(error["message"]);
  if (status === null || code === null || message === null) {
    return null;
  }
  return { status, code, message, retryAfterSeconds: readFiniteNumber(error["retryAfterSeconds"]) };
}

/**
 * The wait a throttled write states, from the whole seconds a `Retry-After` carried.
 *
 * A missing, zero or negative value states that the wait is a moment, so a reader is never told to
 * wait for no time or for a negative one.
 */
function describeRetryWait(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || retryAfterSeconds < 1) {
    return "Wait a moment, then post the response again.";
  }
  const wholeSeconds = Math.ceil(retryAfterSeconds);
  return wholeSeconds === 1
    ? "Wait 1 second, then post the response again."
    : `Wait ${wholeSeconds} seconds, then post the response again.`;
}

/**
 * Reads a failed response write into what the form renders, and `null` when nothing has failed.
 *
 * The sentences are this form's own rather than the service's, because the service answers a client
 * error with one generic sentence that does not tell a reader whether the response, the account or
 * the challenge was the problem.
 */
function describeRespondFailure(error: unknown): ResponseFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return { fieldMessage: null, statusMessage: UNREADABLE_FAILURE_STATUS, offersBoard: false };
  }
  if (failure.code === LOCAL_BLANK_RESPONSE_CODE) {
    return BLANK_RESPONSE_READING;
  }
  switch (failure.status) {
    case 400:
      return REFUSED_RESPONSE_READING;
    case 401:
      return {
        fieldMessage: null,
        statusMessage: `No demo account is selected, so the response was not posted. Choose one in the demo account switcher in the header: a selection is a synthetic role for this demonstration, not a credential, which is why the banner carries the label "${DEMO_AUTHENTICATION_LABEL}". The text you typed has been kept.`,
        offersBoard: false,
      };
    case 403:
      // The contract's one row two roles may write: `POST /challenges/{id}/responses` accepts the
      // buyer who asked the question and the listing's developer. It is the only refusal on this
      // page that a second role fixes, so the sentence names both roles it accepts rather than
      // telling a reader the selected account is "not allowed".
      return {
        fieldMessage: null,
        statusMessage:
          "Only a buyer or the listing's developer may answer a challenge, and the selected demo account is neither, so the response was not posted. Switch to a buyer or a developer in the demo account switcher and post it again. The text you typed has been kept.",
        offersBoard: false,
      };
    case 404:
      return {
        fieldMessage: null,
        statusMessage:
          "This challenge is no longer on the board, so the response was not posted. What you typed is still in the field, and it can be posted on a challenge that is still open.",
        offersBoard: true,
      };
    case 429:
      return {
        fieldMessage: null,
        statusMessage: `The write rate limit has been reached: ${WRITE_RATE_LIMIT_MAX} writes a minute is the whole allowance for a demo client. ${describeRetryWait(failure.retryAfterSeconds)} The text you typed has been kept.`,
        offersBoard: false,
      };
    default:
      return {
        fieldMessage: null,
        statusMessage: `The response was not posted. ${withFullStop(failure.message)} The text you typed has been kept.`,
        offersBoard: false,
      };
  }
}

/** Props for {@link ResponseForm}. */
interface ResponseFormProps {
  /** The challenge being answered; the write's path names it and the body carries only the text. */
  readonly challengeId: string;
  /** Called after a response was written, so the page can read the board again. */
  readonly onResponded: () => void;
}

/**
 * The answer to one selected challenge: one public response, posted to the board.
 *
 * The challenge comes from the page's selection rather than from a field, so there is no control
 * that could name another challenge, and the responder's identity is resolved by the service from
 * the selected demo account. Either the buyer who asked the question or the listing's developer may
 * answer, which is the contract's one row two roles may write.
 *
 * Rendering and one write. It holds the text being typed, whether a write is in flight, the failure
 * a refusal was reduced to and whether the response was written — and nothing else, none of which
 * is stored, shared or carried across a reload. The page remounts it per challenge, so a typed
 * response or a refusal never carries over to another challenge.
 */
function ResponseForm(props: ResponseFormProps): JSX.Element {
  const idPrefix = useId();
  const responseFieldId = `${idPrefix}-response`;
  const responseHelpId = `${idPrefix}-response-help`;
  const responseErrorId = `${idPrefix}-response-error`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [response, setResponse] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [failure, setFailure] = useState<unknown | null>(null);
  const [isPosted, setIsPosted] = useState<boolean>(false);

  const reading = describeRespondFailure(failure);

  // A refusal of the response's own value is tied to the field, so it is announced when the field
  // is reached and the field is marked invalid. A refusal about the selected account, the challenge
  // or the rate limit stays in the status region: the text in the field is valid, and marking it
  // invalid would tell a reader their text is wrong when it is not.
  const fieldMessage = reading === null ? null : reading.fieldMessage;

  const handleResponseChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setResponse(event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    setIsPosted(false);
    if (response.trim() === "") {
      setFailure(BLANK_RESPONSE_FAILURE);
      return;
    }
    setFailure(null);
    setIsSubmitting(true);
    try {
      await respondToChallenge(props.challengeId, { body: response.trim() });
      setResponse("");
      setIsPosted(true);
      props.onResponded();
    } catch (caught: unknown) {
      setFailure(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="challenge-form" onSubmit={handleSubmit} noValidate>
      <div className={fieldMessage === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={responseFieldId}>
          Your response
        </label>
        {/* A free-text answer has no autofill purpose, so this field declares none rather than
            claiming one it does not have. */}
        <textarea
          id={responseFieldId}
          rows={4}
          value={response}
          onChange={handleResponseChange}
          required
          autoComplete="off"
          aria-invalid={fieldMessage !== null}
          aria-describedby={
            fieldMessage === null ? responseHelpId : `${responseErrorId} ${responseHelpId}`
          }
        />
        <p className="field__hint" id={responseHelpId}>
          Answer the question above in your own words. Your response is public on this board and
          stays exactly as written: answering moves the challenge from open to responded, and it
          changes no SGI report.
        </p>
        {fieldMessage === null ? null : (
          <p className="field__error" id={responseErrorId}>
            {fieldMessage}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="button button--primary"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        aria-describedby={isSubmitting ? submitHintId : undefined}
      >
        Post response
      </button>

      {isSubmitting ? (
        <p className="field__hint" id={submitHintId}>
          Posting the response: this button is unavailable until the service answers.
        </p>
      ) : null}

      {/* The region is rendered with the form and only its content changes, so the node exists
          before the status it announces does. `role="status"` is already a polite live region; the
          assertion is stated beside it for a reader who maps the role differently. */}
      <div className="status-region" role="status" aria-live="polite">
        {isPosted ? (
          <div className="notice notice--success">
            <p>{POSTED_RESPONSE_STATUS}</p>
          </div>
        ) : null}
        {reading === null ? null : (
          <div className="notice notice--error">
            <p>{reading.statusMessage}</p>
            {reading.offersBoard ? (
              <p>
                <Link to={CHALLENGES_PATH}>Read the whole board</Link>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </form>
  );
}


/**
 * The public challenges board, the challenge a reader selected, and the answers it has collected.
 *
 * This page owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which
 * renders the header, the navigation, the demonstration banner and the account switcher — must not
 * wrap it in another landmark. The outline it produces is an `h1`, an `h2` for the create form and
 * an `h2` for the board, with the selected challenge's question, its responses and its answer form
 * as `h3`s beneath the board's, so no level is skipped.
 */
export function Challenges(): JSX.Element {
  const idPrefix = useId();
  const [searchParams] = useSearchParams();
  const selectedChallengeId = readSelectedChallengeId(searchParams);

  const [challenges, setChallenges] = useState<readonly ChallengeListItem[]>([]);
  const [isBoardLoading, setIsBoardLoading] = useState<boolean>(true);
  const [boardError, setBoardError] = useState<unknown | null>(null);
  const [boardReadCount, setBoardReadCount] = useState<number>(0);

  const [listingChoices, setListingChoices] = useState<readonly ListingChoice[]>([]);
  const [isChoicesLoading, setIsChoicesLoading] = useState<boolean>(true);
  const [choicesError, setChoicesError] = useState<unknown | null>(null);
  const [choicesReadCount, setChoicesReadCount] = useState<number>(0);
  const [pendingListingId, setPendingListingId] = useState<string>("");

  const listingPickerRef = useRef<HTMLSelectElement | null>(null);
  const createFormRegionRef = useRef<HTMLDivElement | null>(null);

  const reloadBoard = useCallback((): void => {
    setBoardReadCount((count: number): number => count + 1);
  }, []);

  const reloadListingChoices = useCallback((): void => {
    setChoicesReadCount((count: number): number => count + 1);
  }, []);

  // The challenge a write is attached to: the reader's choice while it is still offered, and the
  // first offered listing otherwise, so the picker's value always names an option it holds.
  const chosenChoice =
    listingChoices.find((choice: ListingChoice): boolean => choice.id === pendingListingId) ??
    listingChoices[0];
  const chosenListingId = chosenChoice === undefined ? "" : chosenChoice.id;
  const isCreateFormRendered = !isChoicesLoading && choicesError === null && chosenListingId !== "";

  const selectedChallenge =
    selectedChallengeId === null
      ? null
      : (challenges.find((row: ChallengeListItem): boolean => row.id === selectedChallengeId) ??
        null);
  const selectedRowId = selectedChallenge === null ? "" : readText(selectedChallenge.id);

  // A selection the board does not hold is its own state, but only once the board has answered:
  // during a read, and after a read that failed, the board has said nothing about the selection.
  const isSelectionUnavailable =
    selectedChallengeId !== null &&
    !isBoardLoading &&
    boardError === null &&
    selectedChallenge === null;

  // The board read. The read counter is the only input that re-runs it, which is what makes a
  // re-read happen after a write instead of a row being patched in place. The cancelled flag
  // discards a result that arrives after its read was superseded, so two reads in flight can never
  // render the older one over the newer.
  useEffect(() => {
    let isCancelled = false;
    setIsBoardLoading(true);
    setBoardError(null);
    listChallenges()
      .then((rows: ChallengeListItem[]): void => {
        if (!isCancelled) {
          setChallenges(rows);
        }
      })
      .catch((caught: unknown): void => {
        if (!isCancelled) {
          setBoardError(caught);
        }
      })
      .finally((): void => {
        if (!isCancelled) {
          setIsBoardLoading(false);
        }
      });
    return (): void => {
      isCancelled = true;
    };
  }, [boardReadCount]);

  // The listing options, read once per trigger and for one purpose only: giving the create form a
  // listing to attach a challenge to. A listing row without a usable identifier is dropped here, so
  // the picker holds only listings a write can actually name.
  useEffect(() => {
    let isCancelled = false;
    setIsChoicesLoading(true);
    setChoicesError(null);
    listListings({ sort: DEFAULT_LISTING_SORT, page: FIRST_PAGE })
      .then((result: ListingSearchResult): void => {
        if (!isCancelled) {
          setListingChoices(readListingChoices(result.items));
        }
      })
      .catch((caught: unknown): void => {
        if (!isCancelled) {
          setChoicesError(caught);
        }
      })
      .finally((): void => {
        if (!isCancelled) {
          setIsChoicesLoading(false);
        }
      });
    return (): void => {
      isCancelled = true;
    };
  }, [choicesReadCount]);

  // The create form reports nothing to this page — its props are fixed to the listing it writes
  // against — so its announcement is observed instead: it renders every outcome, a posted challenge
  // or a refusal, into its own status region, and a change there re-reads the public board. The
  // read is idempotent, so a refusal costs one redundant read and no wrong state, and a read
  // already in flight is discarded by its own cancelled flag rather than queued behind this one.
  useEffect(() => {
    const region = createFormRegionRef.current;
    if (region === null) {
      return;
    }
    const observer = new MutationObserver((): void => {
      reloadBoard();
    });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    return (): void => {
      observer.disconnect();
    };
  }, [reloadBoard, isCreateFormRendered]);

  const handleListingChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setPendingListingId(event.target.value);
  };

  const focusListingPicker = (): void => {
    listingPickerRef.current?.focus();
  };

  // The listing a board entry is about, named by its title when the picker's page of results holds
  // it and described in words when it does not. The link's address is the listing's own either way.
  const describeListingReference = (listingId: string): string => {
    const choice = listingChoices.find(
      (candidate: ListingChoice): boolean => candidate.id === listingId,
    );
    return choice === undefined ? "the listing this challenge is about" : choice.label;
  };

  // The empty board offers the one action that changes it: the form above, or the listings to pick
  // a challenge from when nothing is published yet.
  const emptyBoardAction =
    chosenListingId === "" ? (
      <Link to={LISTING_PATH_PREFIX}>Browse the listings</Link>
    ) : (
      <button type="button" className="button button--secondary" onClick={focusListingPicker}>
        Ask the first challenge
      </button>
    );

  return (
    <main id="main-content" tabIndex={-1} className="page page-challenges">
      <section aria-labelledby={`${idPrefix}-purpose-heading`}>
        <h1 id={`${idPrefix}-purpose-heading`}>Challenges</h1>
        <p>
          A challenge is a public question a buyer puts to a listing's developer about a claim the
          listing makes or the evidence behind it, and either that developer or another buyer
          answers it on the board below.
        </p>
        <p>
          A challenge is a question and not a measurement: neither a question nor an answer is
          evidence for a listing's claims, neither changes an SGI report, and neither says anything
          about safety or certification.
        </p>
      </section>

      <section aria-labelledby={`${idPrefix}-ask-heading`}>
        <h2 id={`${idPrefix}-ask-heading`}>Ask a challenge</h2>
        {isChoicesLoading ? (
          <p className="field__hint">Loading the listings a challenge can be attached to…</p>
        ) : choicesError !== null ? (
          <ErrorNotice error={choicesError} onRetry={reloadListingChoices} />
        ) : chosenListingId === "" ? (
          <p>
            A challenge is attached to a listing, and no listing is published yet, so there is
            nothing to challenge. <Link to={LISTING_PATH_PREFIX}>Browse the listings</Link> — a
            listing appears here once its developer has published one, and a question can then be
            attached to it.
          </p>
        ) : (
          <>
            <div className="field">
              <label className="field__label" htmlFor={`${idPrefix}-listing`}>
                The listing the challenge is about
              </label>
              <select
                id={`${idPrefix}-listing`}
                ref={listingPickerRef}
                value={chosenListingId}
                onChange={handleListingChange}
                aria-describedby={`${idPrefix}-listing-help`}
              >
                {listingChoices.map(
                  (choice: ListingChoice): JSX.Element => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ),
                )}
              </select>
              <p className="field__hint" id={`${idPrefix}-listing-help`}>
                The question is written to the public board below and attached to this listing, so
                the developer whose listing it is can answer it.
              </p>
            </div>
            <div ref={createFormRegionRef}>
              <ChallengeForm listingId={chosenListingId} />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-board-heading`}>
        <h2 id={`${idPrefix}-board-heading`}>The challenges board</h2>

        {/* The page's board status region. It is rendered from the first render and only its content
            changes, which is what lets a later read — after a post, or after a failed read was
            retried — announce that it is loading rather than announce itself with its content. */}
        <div className="status-region" role="status" aria-live="polite">
          {isBoardLoading ? <p>Loading the challenges board…</p> : null}
        </div>

        {boardError === null ? null : <ErrorNotice error={boardError} onRetry={reloadBoard} />}

        {isBoardLoading || boardError !== null || challenges.length > 0 ? null : (
          <EmptyState
            heading="No challenges yet"
            headingLevel={2}
            explanation="No one has asked a challenge yet. A challenge is a public question about a listing's claims, and the first one can be asked from the form above."
            action={emptyBoardAction}
          />
        )}

        {challenges.length === 0 ? null : (
          <ul className="item-list">
            {challenges.map((challenge: ChallengeListItem, index: number): JSX.Element => {
              const challengeId = readText(challenge.id);
              const listingId = readText(challenge.listing_id);
              const isSelected = challengeId !== "" && challengeId === selectedChallengeId;
              return (
                <li
                  className="item-list__item"
                  key={challengeId === "" ? `challenge-row-${index}` : challengeId}
                >
                  <p>
                    {challengeId === "" ? (
                      readQuestion(challenge.question)
                    ) : (
                      <Link
                        to={selectionHref(challengeId)}
                        aria-current={isSelected ? "true" : undefined}
                      >
                        {readQuestion(challenge.question)}
                      </Link>
                    )}
                    {isSelected ? (
                      <span className="visually-hidden"> — this challenge is shown below</span>
                    ) : null}
                  </p>
                  <p>
                    Status: <strong>{describeStatus(challenge.status)}</strong>. Asked{" "}
                    <Timestamp value={challenge.created_at} />{" "}
                    {listingId === "" ? (
                      <>about the listing this challenge concerns.</>
                    ) : (
                      <>
                        about{" "}
                        <Link to={listingHref(listingId)}>
                          {describeListingReference(listingId)}
                        </Link>
                        .
                      </>
                    )}{" "}
                    {describeResponseCount(challenge.responses.length)}.
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {selectedChallenge === null ? null : (
          <>
            <h3>{readQuestion(selectedChallenge.question)}</h3>
            <p>
              Status: <strong>{describeStatus(selectedChallenge.status)}</strong>. Asked{" "}
              <Timestamp value={selectedChallenge.created_at} />{" "}
              {readText(selectedChallenge.listing_id) === "" ? (
                <>about the listing this challenge concerns.</>
              ) : (
                <>
                  about{" "}
                  <Link to={listingHref(readText(selectedChallenge.listing_id))}>
                    {describeListingReference(readText(selectedChallenge.listing_id))}
                  </Link>
                  .
                </>
              )}{" "}
              {describeResponseCount(selectedChallenge.responses.length)}.
            </p>

            {selectedChallenge.responses.length === 0 ? (
              <EmptyState
                heading="No responses yet"
                headingLevel={3}
                explanation="No one has answered this challenge yet. Either the developer whose listing it is or another buyer can answer it, in the form below."
              />
            ) : (
              <>
                <h3>Responses</h3>
                <ul className="item-list">
                  {selectedChallenge.responses.map((response, index: number): JSX.Element => {
                    const responseId = readText(response.id);
                    return (
                      <li
                        className="item-list__item"
                        key={responseId === "" ? `response-row-${index}` : responseId}
                      >
                        <p>{readResponseBody(response.body)}</p>
                        <p>
                          Answered <Timestamp value={response.created_at} />.
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <h3>Answer this challenge</h3>
            <p>
              Either the buyer who asked the question or the developer whose listing it is may
              answer it. An answer is public and stays exactly as written, and answering moves the
              challenge from open to responded.
            </p>
            <ResponseForm
              key={selectedRowId === "" ? "selected-challenge" : selectedRowId}
              challengeId={selectedRowId}
              onResponded={reloadBoard}
            />
          </>
        )}

        {isSelectionUnavailable ? (
          <EmptyState
            heading="That challenge is not on the board"
            headingLevel={3}
            explanation="The address names a challenge this board does not list, so there is nothing to open here. It may have left the board since the link was copied."
            action={<Link to={CHALLENGES_PATH}>Read the whole board</Link>}
          />
        ) : null}
      </section>
    </main>
  );
}

// The default export is what app.tsx's route table imports; the named export is what a test or a
// sibling page imports. Both exist on purpose.
export default Challenges;

