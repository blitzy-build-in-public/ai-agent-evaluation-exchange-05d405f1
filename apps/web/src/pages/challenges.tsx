/**
 * The `/challenges` route: the public challenges board, and the responses a challenge collects.
 *
 * A challenge is a buyer's public question about a listing's claims. The board lists the page of
 * challenges the service answered with, in the order the service returned it, a reader opens one
 * through the query parameter it is addressed by, and either the buyer who asked or the listing's
 * developer answers it here. A challenge is a question and never a measurement: nothing on this
 * page describes a question or an answer as evidence for a listing's claims, as a pass, or as
 * anything about safety.
 *
 * Five decisions shape this file, each of which a later reader could otherwise "improve" into a
 * bug.
 *
 *   - **The selection lives in the address and nowhere else.** `?id=<challenge id>` is the whole
 *     of this page's state: every challenge on the page of the board is a `<Link>` that rewrites
 *     that one parameter, `useSearchParams` reads it back, and clearing it returns to the board.
 *     There is no context provider, no shared state module and no stored preference, so a challenge
 *     is linkable and a reload of a link opens the same challenge.
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
 *   - **The create form reports its post through its own callback.** The form owns the write and
 *     hands this page the challenge it created through `onCreated`, so the board is re-read when a
 *     challenge was posted and left alone when a post was refused or was still in flight. Watching
 *     the form's rendering for an outcome would fire on its refusal and in-flight notices as well,
 *     and would reach into a child's rendering for an event the child can report itself.
 *
 *   - **Every outcome a reader can meet is rendered in words.** A blank board, a challenge no one
 *     has answered, a selection naming no challenge on the page of the board, a refused write, a
 *     spent write rate limit and a read that failed each get their own explanation and their own
 *     next step. No failure renders a stack trace, a raw response body or a URL: the two reads
 *     render `ErrorNotice`, and the response form renders the sentences declared below.
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
import { getSelectedDemoAccountId, listChallenges, listListings, respondToChallenge } from "../api-client";
import type { ChallengeListItem } from "../api-client";
import { ChallengeForm } from "../components/challenge-form";
import { EmptyState } from "../components/empty-state";
import { ErrorNotice } from "../components/error-notice";
import { findDemoAccount } from "../data/demo-accounts";
import type { DemoAccount } from "../data/demo-accounts";
import { Timestamp, describeRetryWait, readString, readWriteFailure, withFullStop } from "../payload-reading";
import type { WriteFailureFacts } from "../payload-reading";

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

/** The sentence the board's status region carries while a read of the board is in flight. */
const LOADING_BOARD_MESSAGE = "Loading the challenges board…";

/**
 * What a response says about who answered when the board names an account the switcher does not
 * list. The identifier itself is deliberately not rendered: it names nothing a reader can
 * recognise, and the handle is the whole of the attribution this board shows.
 */
const RESPONDER_UNLISTED_LABEL = "an account the demo-account switcher does not list";

/**
 * The empty board, and the same state for an account the create form is withheld from.
 *
 * The two differ in one sentence: the form above the board is offered to a buyer and to a visitor
 * who has selected no account, so pointing the first reader at it is a direction and pointing the
 * second at it would be a direction to nothing.
 */
const EMPTY_BOARD_EXPLANATION =
  "No one has asked a challenge yet. A challenge is a public question about a listing's claims, and the first one can be asked from the form above.";
const EMPTY_BOARD_EXPLANATION_WITHOUT_FORM =
  "No one has asked a challenge yet. A challenge is a public question about a listing's claims, and one can be asked by a buyer account.";

/**
 * A challenge nobody has answered yet, and the same state for an account the answer form is withheld
 * from: the sentence that points at the form below is dropped where that form is not rendered.
 */
const NO_RESPONSES_HEADING = "No responses yet";
const NO_RESPONSES_EXPLANATION =
  "No one has answered this challenge yet. Either the developer whose listing it is or another buyer can answer it, in the form below.";
const NO_RESPONSES_EXPLANATION_WITHOUT_FORM =
  "No one has answered this challenge yet. Either the developer whose listing it is or another buyer can answer it.";

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
 * offers the way back to the board.
 */
interface ResponseFailureReading {
  /** The sentence tied to the response field by `aria-describedby`, or `null`. */
  readonly fieldMessage: string | null;
  /** The sentence the form's polite status region announces. */
  readonly statusMessage: string;
  /**
   * The notice variant the status region renders: the error triple for a refusal of what was sent,
   * and the warning triple for the write rate limit, which is a wait-and-send-again state rather
   * than a failure of anything the reader can correct.
   */
  readonly variant: "notice--error" | "notice--warning";
  /**
   * Whether the selected challenge was not on the page of the board that was read, so the
   * explanation also offers the board.
   */
  readonly offersBoard: boolean;
}

/**
 * A challenge's question as text, and a sentence in its place when the board states none.
 *
 * A recorded question is developer- and buyer-written text this page renders as it stands; it is
 * deliberately not trimmed for display beyond testing for emptiness, because the blank case is the
 * only case that needs a substitute.
 */
function readQuestion(value: unknown): string {
  const question = readString(value);
  return question.trim() === "" ? "A challenge whose question the board does not record" : question;
}

/** A response's text, with the same substitute for a response the board states without one. */
function readResponseBody(value: unknown): string {
  const body = readString(value);
  return body.trim() === "" ? "A response whose text the board does not record" : body;
}

/**
 * The account that answered a challenge, named by the handle the demo-account switcher lists its
 * identifier under.
 *
 * The handle is the whole of the attribution: it is one of the six synthetic demo accounts, so an
 * answer names which demonstration account wrote it and says nothing further about who that was.
 * Either the buyer who asked the question or the listing's developer may answer, so who answered is
 * read from the response rather than assumed from the challenge. An identifier the lookup does not
 * know — an account the switcher no longer lists, or a response written by hand — states that much
 * instead of putting an opaque identifier in front of a reader.
 */
function describeResponder(accountId: unknown): string {
  const account = findDemoAccount(readString(accountId));
  return account === null ? RESPONDER_UNLISTED_LABEL : account.handle;
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

/**
 * What the board's live region says once a read has settled, in the words the sibling boards use.
 *
 * The count is the one fact a reader cannot see from the list itself when it is long, and it is what
 * tells a reader who just asked a challenge that the board has taken it.
 */
function describeLoadedBoard(count: number): string {
  if (count === 0) {
    return "The board is loaded and holds no challenge yet.";
  }
  if (count === 1) {
    return "The board is loaded with one challenge on it.";
  }
  return `The board is loaded with ${count} challenges on it.`;
}

/** The one line a picker option shows: the listing's title and the handle of its developer. */
function describeListingChoice(listing: ListingSummary): string {
  const title = readString(listing.title).trim();
  const handle = readString(listing.developer_handle).trim();
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
    const id = readString(item.id).trim();
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

/**
 * This form's own refusal of a blank response, in the shape a service refusal arrives in, so one
 * reading renders both. Its code is this form's marker rather than the service's, which is how a
 * response that was never sent and a response the service refused stay two different outcomes.
 */
const BLANK_RESPONSE_FAILURE: WriteFailureFacts = Object.freeze({
  status: 400,
  code: LOCAL_BLANK_RESPONSE_CODE,
  message: BLANK_RESPONSE_SENTENCE,
  retryAfterSeconds: null,
});

/** The reading a blank response renders, kept frozen so two renders cannot diverge. */
const BLANK_RESPONSE_READING: ResponseFailureReading = Object.freeze({
  fieldMessage: BLANK_RESPONSE_SENTENCE,
  statusMessage: "The response was not posted, and no request was sent.",
  variant: "notice--error",
  offersBoard: false,
});

/** The reading a response the service refused as written renders. */
const REFUSED_RESPONSE_READING: ResponseFailureReading = Object.freeze({
  fieldMessage: REFUSED_RESPONSE_SENTENCE,
  statusMessage: REFUSED_RESPONSE_STATUS,
  variant: "notice--error",
  offersBoard: false,
});

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
    return {
      fieldMessage: null,
      statusMessage: UNREADABLE_FAILURE_STATUS,
      variant: "notice--error",
      offersBoard: false,
    };
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
        variant: "notice--error",
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
        variant: "notice--error",
        offersBoard: false,
      };
    case 404:
      return {
        fieldMessage: null,
        statusMessage:
          "This challenge is no longer on the board, so the response was not posted. What you typed is still in the field, and it can be posted on a challenge that is still open.",
        variant: "notice--error",
        offersBoard: true,
      };
    case 429:
      return {
        fieldMessage: null,
        statusMessage: `The write rate limit has been reached: ${WRITE_RATE_LIMIT_MAX} writes a minute is the whole allowance for a demo client. ${describeRetryWait(failure.retryAfterSeconds, "then post the response again.")} The text you typed has been kept.`,
        variant: "notice--warning",
        offersBoard: false,
      };
    default:
      return {
        fieldMessage: null,
        statusMessage: `The response was not posted. ${withFullStop(failure.message)} The text you typed has been kept.`,
        variant: "notice--error",
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
          <div className={`notice ${reading.variant}`}>
            <p>{reading.statusMessage}</p>
            {reading.offersBoard ? (
              <p>
                <Link to={CHALLENGES_PATH}>Read the board</Link>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </form>
  );
}

/** The heading of the state shown in place of the create form, for an account that cannot ask. */
const ASK_ROLE_HEADING = "Asking a challenge needs a buyer account";

/** The heading of the state shown in place of the answer form, for an account that cannot answer. */
const ANSWER_ROLE_HEADING = "Answering a challenge needs a buyer or developer account";

/**
 * Why the create form is not offered the selected account: which account is selected, which role the
 * write needs and where to choose one. A challenge is the buyer's to ask — the service refuses a
 * developer, a contributor and an operator with `403` — so the form is withheld from them rather than
 * offered and then refused, which is how `/developer` treats a half its account holds no role for.
 */
function askRoleExplanation(account: DemoAccount): string {
  return (
    `The selected demo account is ${account.display_label}, whose role is ${account.role}. Asking a ` +
    "challenge is the buyer's write, so the form is not shown for this account. Choose a buyer " +
    "account in the demo-account switcher in the page header to ask one."
  );
}

/**
 * Why the answer form is not offered the selected account. The write accepts two roles — the buyer
 * who asked the question and the listing's developer — so the sentence names both, and a contributor
 * or an operator holds neither.
 */
function answerRoleExplanation(account: DemoAccount): string {
  return (
    `The selected demo account is ${account.display_label}, whose role is ${account.role}. An answer ` +
    "is the buyer's or the listing's developer's write, so the form is not shown for this account. " +
    "Choose a buyer or a developer account in the demo-account switcher in the page header to answer."
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

  // The selected demo account, resolved on every render: the switcher in the page header writes the
  // selection and the shell re-renders this route from it, so a render-time read follows it. Each of
  // the two writes below belongs to a role or two alone, so an account holding neither is not offered
  // the surface rather than offered a form whose write the service refuses. No account selected keeps
  // both surfaces exactly as they were: the write's own explanation answers for the missing account.
  const selectedAccount = findDemoAccount(getSelectedDemoAccountId());
  const canAskChallenge = selectedAccount === null || selectedAccount.role === "buyer";
  const canAnswerChallenge =
    selectedAccount === null ||
    selectedAccount.role === "buyer" ||
    selectedAccount.role === "developer";

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

  const selectedChallenge =
    selectedChallengeId === null
      ? null
      : (challenges.find((row: ChallengeListItem): boolean => row.id === selectedChallengeId) ??
        null);
  const selectedRowId = selectedChallenge === null ? "" : readString(selectedChallenge.id);

  // A selection the page of the board does not hold is its own state, but only once the board has
  // answered: during a read, and after a read that failed, the board has said nothing about it.
  const isSelectionUnavailable =
    selectedChallengeId !== null &&
    !isBoardLoading &&
    boardError === null &&
    selectedChallenge === null;

  // The sentence the board's status region carries, or `null` when it should carry none.
  //
  // A read that failed carries none: the error notice beside the region is the explanation there,
  // and a count of a board the read did not produce would contradict it. While a read is in flight
  // the region says so, and once it has settled it states the count that tells a reader — who has
  // just asked a challenge, or who cannot count a long list at a glance — what the board now holds.
  const boardStatus =
    boardError !== null
      ? null
      : isBoardLoading
        ? LOADING_BOARD_MESSAGE
        : describeLoadedBoard(challenges.length);

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

  // The empty board offers the one action that changes it: the form above, or the listings to pick a
  // challenge from when nothing is published yet. An account that cannot ask is offered the form
  // nowhere on this page, so for it the action is the link to the listings rather than a button that
  // would move focus to a listing picker that is not rendered.
  const emptyBoardAction =
    chosenListingId === "" || !canAskChallenge ? (
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
        {selectedAccount !== null && !canAskChallenge ? (
          <EmptyState
            heading={ASK_ROLE_HEADING}
            headingLevel={3}
            explanation={askRoleExplanation(selectedAccount)}
          />
        ) : isChoicesLoading ? (
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
            <ChallengeForm listingId={chosenListingId} onCreated={reloadBoard} />
          </>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-board-heading`}>
        <h2 id={`${idPrefix}-board-heading`}>The challenges board</h2>

        {/* The page's board status region. It is rendered from the first render and only its content
            changes, which is what lets a later read — after a post, or after a failed read was
            retried — announce that it is loading rather than announce itself with its content. */}
        <div className="status-region" role="status" aria-live="polite">
          {boardStatus === null ? null : <p>{boardStatus}</p>}
        </div>

        {boardError === null ? null : <ErrorNotice error={boardError} onRetry={reloadBoard} />}

        {isBoardLoading || boardError !== null || challenges.length > 0 ? null : (
          <EmptyState
            heading="No challenges yet"
            headingLevel={2}
            explanation={
              canAskChallenge ? EMPTY_BOARD_EXPLANATION : EMPTY_BOARD_EXPLANATION_WITHOUT_FORM
            }
            action={emptyBoardAction}
          />
        )}

        {challenges.length === 0 ? null : (
          <ul className="item-list">
            {challenges.map((challenge: ChallengeListItem, index: number): JSX.Element => {
              const challengeId = readString(challenge.id);
              const listingId = readString(challenge.listing_id);
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
              {readString(selectedChallenge.listing_id) === "" ? (
                <>about the listing this challenge concerns.</>
              ) : (
                <>
                  about{" "}
                  <Link to={listingHref(readString(selectedChallenge.listing_id))}>
                    {describeListingReference(readString(selectedChallenge.listing_id))}
                  </Link>
                  .
                </>
              )}{" "}
              {describeResponseCount(selectedChallenge.responses.length)}.
            </p>

            {selectedChallenge.responses.length === 0 ? (
              <EmptyState
                heading={NO_RESPONSES_HEADING}
                headingLevel={3}
                explanation={
                  canAnswerChallenge
                    ? NO_RESPONSES_EXPLANATION
                    : NO_RESPONSES_EXPLANATION_WITHOUT_FORM
                }
              />
            ) : (
              <>
                <h3>Responses</h3>
                <ul className="item-list">
                  {selectedChallenge.responses.map((response, index: number): JSX.Element => {
                    const responseId = readString(response.id);
                    return (
                      <li
                        className="item-list__item"
                        key={responseId === "" ? `response-row-${index}` : responseId}
                      >
                        <p>{readResponseBody(response.body)}</p>
                        <p>
                          Answered by{" "}
                          <strong>{describeResponder(response.account_id)}</strong>,{" "}
                          <Timestamp value={response.created_at} />.
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {selectedAccount !== null && !canAnswerChallenge ? (
              <EmptyState
                heading={ANSWER_ROLE_HEADING}
                headingLevel={3}
                explanation={answerRoleExplanation(selectedAccount)}
              />
            ) : (
              <>
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
          </>
        )}

        {isSelectionUnavailable ? (
          <EmptyState
            heading="That challenge is not on this page of the board"
            headingLevel={3}
            explanation="The address names a challenge the page of the board read here does not carry, so there is nothing to open. The board is read one page at a time, most recent first: the challenge may be on an earlier page of the board, or it may have left the board since the link was copied."
            action={<Link to={CHALLENGES_PATH}>Read the board</Link>}
          />
        ) : null}
      </section>
    </main>
  );
}

// The default export is what app.tsx's route table imports; the named export is what a test or a
// sibling page imports. Both exist on purpose.
export default Challenges;

