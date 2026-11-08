/**
 * The buyer's challenge against a listing: the question a buyer puts to the listing's
 * developer, written to the public challenges board.
 *
 * This is only the asking half of the board. The board page owns the challenges and the
 * responses they collect, and renders the control that answers one; no response field, no
 * response read and no status control appears here. That separation is deliberate — a
 * challenge is created `open` and only a response moves it, so a status control in this form
 * would let a client claim an answer that was never given.
 *
 * A challenge is a question, not a verdict. The field asks about a claim the listing makes
 * or the evidence behind it, and offers no rating, no score and no private remark, because
 * the product's trust model is that a buyer compares claims against measured evidence.
 *
 * Every write goes through the API client, which owns the service's address, the header
 * naming the selected demo account and the one failure shape. This component therefore holds
 * no URL, no header and no request of its own: it narrows the failure it is handed into the
 * status and the sentence it renders, and nothing else. The client refuses a write with no
 * demo account selected before sending it, so that refusal arrives here like any other.
 *
 * Each refusal gets its own next step. A question the service refuses is marked beside the
 * field, which keeps the text that was typed; a write with no demo account selected and a
 * write from an account that is not a buyer are two different fixes, and each is named; a
 * listing that is gone offers the way back to browsing; and the write rate limit states how
 * long to wait.
 *
 * Accessibility: the question carries a real label, the failure that concerns it is tied to
 * it by `aria-describedby` and `aria-invalid`, and the form's single status region is
 * rendered from the first render — a live region that appears together with its content is
 * not reliably announced — so the outcome of a post, posted or not, is announced politely.
 * The submit control is disabled only while a write is in flight, with the reason visible
 * beside it.
 *
 * No storage, no cookie, no configuration value and no stylesheet import: this component
 * emits the class names the stylesheet defines.
 */

import { useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { createChallenge } from "../api-client";
import type { Challenge } from "@adem/shared";
import { describeRetryWait, readWriteFailure, withFullStop } from "../payload-reading";
import type { WriteFailureFacts } from "../payload-reading";

/**
 * Props for {@link ChallengeForm}. The listing the challenge is about is required; the callback
 * is optional, and a caller that does not need the created challenge omits it rather than passing
 * `undefined`.
 */
export interface ChallengeFormProps {
  /** The listing the challenge is about; sent as `listing_id` in the POST /challenges body. */
  readonly listingId: string;
  /** Run with the created challenge, so the page can read the board again. */
  readonly onCreated?: (challenge: Challenge) => void;
}

/**
 * What a failure renders as: the sentence beside the question when the question itself is
 * what failed (`null` when it is not), the sentence the status region announces, the notice
 * variant that sentence renders in, and whether the state offers the way back to browsing.
 */
interface ChallengeFailureReading {
  readonly questionMessage: string | null;
  readonly statusMessage: string;
  /**
   * The notice variant the status region renders: the error triple for a refusal of what was
   * sent, and the warning triple for the write rate limit, which is a wait-and-send-again
   * state rather than a failure of anything the reader can correct.
   */
  readonly variant: "notice--error" | "notice--warning";
  readonly offersBrowse: boolean;
}

/**
 * The code the local blank check carries.
 *
 * It is this component's own marker rather than one of the service's codes, so that a
 * question which was never sent and a question the service refused are read as two different
 * outcomes from one shape.
 */
const LOCAL_MISSING_QUESTION_CODE = "local_missing_question";

/** The sentence beside the field when nothing was entered. */
const BLANK_QUESTION_SENTENCE = "Enter the question you want to put to the developer.";

/** The sentence beside the field when the service refused the question as written. */
const REFUSED_QUESTION_SENTENCE =
  "The service did not accept this question as written. Edit it and post it again; the text you typed has been kept.";

/** The sentence the status region announces when the question itself was refused. */
const REFUSED_QUESTION_STATUS = "The challenge was not posted: see the message beside the question.";

/** The sentence a raised value carrying none of those facts renders. */
const UNREADABLE_FAILURE_STATUS =
  "The question was not posted. Try again; the text you typed has been kept.";

/** The reading a blank question renders, kept frozen so two renders cannot diverge. */
const BLANK_QUESTION_READING: ChallengeFailureReading = Object.freeze({
  questionMessage: BLANK_QUESTION_SENTENCE,
  statusMessage: "The challenge was not posted, and no request was sent.",
  variant: "notice--error",
  offersBrowse: false,
});

/** The reading a refusal of the question itself renders. */
const REFUSED_QUESTION_READING: ChallengeFailureReading = Object.freeze({
  questionMessage: REFUSED_QUESTION_SENTENCE,
  statusMessage: REFUSED_QUESTION_STATUS,
  variant: "notice--error",
  offersBrowse: false,
});

/** The local blank check, in the shape a refusal arrives in, so one reading renders both. */
function missingQuestionFailure(): WriteFailureFacts {
  return {
    status: 400,
    code: LOCAL_MISSING_QUESTION_CODE,
    message: BLANK_QUESTION_SENTENCE,
    retryAfterSeconds: null,
  };
}

/**
 * Reads a failure into what the form renders, and `null` when nothing has failed.
 *
 * The sentences are this component's own rather than the service's: the service answers a
 * client error with one generic sentence, which does not tell a reader whether the question,
 * the account or the listing was the problem.
 */
function describeFailure(error: unknown): ChallengeFailureReading | null {
  if (error === null) {
    return null;
  }
  const failure = readWriteFailure(error);
  if (failure === null) {
    return {
      questionMessage: null,
      statusMessage: UNREADABLE_FAILURE_STATUS,
      variant: "notice--error",
      offersBrowse: false,
    };
  }
  if (failure.code === LOCAL_MISSING_QUESTION_CODE) {
    return BLANK_QUESTION_READING;
  }
  switch (failure.status) {
    case 400:
      return REFUSED_QUESTION_READING;
    case 401:
      return {
        questionMessage: null,
        statusMessage:
          "No demo account is selected, so the question was not posted. Choose a demo account in the demo account switcher and post it again — the selected account separates roles for the demonstration and is not a sign-in. The text you typed has been kept.",
        variant: "notice--error",
        offersBrowse: false,
      };
    case 403:
      return {
        questionMessage: null,
        statusMessage:
          "Posting a challenge needs a demo account whose role is buyer, and the selected demo account is not a buyer, so the question was not posted. Switch to a buyer in the demo account switcher and post it again. The text you typed has been kept.",
        variant: "notice--error",
        offersBrowse: false,
      };
    case 404:
      return {
        questionMessage: null,
        statusMessage:
          "This listing is no longer available, so the question was not posted. A hidden or removed listing leaves the public board.",
        variant: "notice--error",
        offersBrowse: true,
      };
    case 429:
      return {
        questionMessage: null,
        statusMessage: `This client has sent the maximum number of writes allowed in a minute. ${describeRetryWait(failure.retryAfterSeconds, "then post the question again.")} The text you typed has been kept.`,
        variant: "notice--warning",
        offersBrowse: false,
      };
    default:
      return {
        questionMessage: null,
        statusMessage: `The question was not posted. ${withFullStop(failure.message)} The text you typed has been kept.`,
        variant: "notice--error",
        offersBrowse: false,
      };
  }
}

/**
 * The buyer's challenge form: one question about one listing, posted to the public board.
 *
 * Rendering and one write. It holds the question being typed, whether a write is in flight,
 * the failure the client raised and the challenge the write created — and nothing else, no
 * field of which is stored, shared or carried across a reload. A post that succeeded is
 * reported to the page through `onCreated`, so the board the page reads is the service's.
 */
export function ChallengeForm(props: ChallengeFormProps): JSX.Element {
  const idPrefix = useId();
  const questionFieldId = `${idPrefix}-question`;
  const questionHelpId = `${idPrefix}-question-help`;
  const questionErrorId = `${idPrefix}-question-error`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [question, setQuestion] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);
  const [postedChallenge, setPostedChallenge] = useState<Challenge | null>(null);

  const reading = describeFailure(error);

  // A failure that concerns the question itself is tied to the field, so it is announced when
  // the field is reached and the field is marked invalid. A failure about the demo account, the
  // listing or the rate limit stays in the status region, because the question in the field is
  // valid and marking it invalid would tell a reader their text is wrong when it is not.
  const questionMessage = reading === null ? null : reading.questionMessage;

  const handleQuestionChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setQuestion(event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (question.trim() === "") {
      setPostedChallenge(null);
      setError(missingQuestionFailure());
      return;
    }
    setError(null);
    setPostedChallenge(null);
    setIsSubmitting(true);
    try {
      const created = await createChallenge({ listing_id: props.listingId, question });
      setQuestion("");
      setPostedChallenge(created);
      props.onCreated?.(created);
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="challenge-form" onSubmit={handleSubmit} noValidate>
      <div className={questionMessage === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={questionFieldId}>
          Your challenge question
        </label>
        {/* A free-text question has no autofill purpose, so this field declares none rather than
            claiming a purpose it does not have. */}
        <textarea
          id={questionFieldId}
          rows={4}
          value={question}
          onChange={handleQuestionChange}
          required
          autoComplete="off"
          aria-invalid={questionMessage !== null}
          aria-describedby={
            questionMessage === null ? questionHelpId : `${questionErrorId} ${questionHelpId}`
          }
        />
        <p className="field__hint" id={questionHelpId}>
          Ask the developer a question about a claim this listing makes or the evidence behind
          it. Challenges and their answers are public on the board.
        </p>
        {questionMessage === null ? null : (
          <p className="field__error" id={questionErrorId}>
            {questionMessage}
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
        Post challenge
      </button>

      {isSubmitting ? (
        <p className="field__hint" id={submitHintId}>
          Posting the question: this button is unavailable until the service answers.
        </p>
      ) : null}

      {/* The region is rendered with the form and only its content is written into it on submit,
          so the node exists before the status it announces changes. `role="status"` is already a
          polite live region; the assertion is stated beside it for a reader who maps the role
          differently. */}
      <div className="status-region" role="status" aria-live="polite">
        {postedChallenge === null ? null : (
          <div className="notice notice--success">
            <p>
              Challenge posted: <code>{postedChallenge.id}</code>. It is now on the public
              challenges board.
            </p>
            <p>
              <Link to="/challenges">Read the challenges board</Link>
            </p>
          </div>
        )}
        {reading === null ? null : (
          <div className={`notice ${reading.variant}`}>
            <p>{reading.statusMessage}</p>
            {reading.offersBrowse ? (
              <p>
                <Link to="/listings">Browse listings</Link>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </form>
  );
}

