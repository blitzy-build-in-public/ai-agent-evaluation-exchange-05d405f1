/**
 * The two discussion-board write forms: starting a thread, and posting a reply on one.
 *
 * `pages/threads.tsx` owns the board — the threads, the one a reader selected and its posts.
 * These two forms own only their own field, their own outcome and the sentence that explains
 * it, which is why neither renders a thread, a post or a post list.
 *
 * Both writes accept **any resolvable demo account**, so neither form gates on a role and a
 * reader can never meet a "wrong role" state here. What remains is a `400` (the value failed
 * the schema), a `401` (no demo account is selected, or the selected one is not a seeded
 * account), the reply's `404` (the thread is gone) and a `429` (the write rate limit). Each is
 * rendered for what it is: a problem with the field's own value beside the field, and every
 * other failure as its own explanation inside the form's polite status region, which is also
 * where a successful write is announced.
 *
 * A blank or whitespace-only value is refused here without a request, and the value that is
 * sent is trimmed — the schema requires at least one character, so a whitespace-only title
 * would be accepted by the service as a thread with nothing to read.
 *
 * Presentation only. Every write goes through `../api-client`, which owns the base URL, the
 * demo-account header and the wire envelope; this file holds no URL, no header, no `fetch`, no
 * storage, no cookie and no business rule.
 */

import { useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { DEMO_AUTHENTICATION_LABEL, WRITE_RATE_LIMIT_MAX } from "@adem/shared";
import type { Thread, ThreadPost } from "@adem/shared";
import { createPost, createThread } from "../api-client";
import { describeRetryWait, readWriteFailure } from "../payload-reading";

/** The sentence the create form shows for a blank title, in place of a request. */
const EMPTY_TITLE_MESSAGE = "Enter a title for the thread";

/** The sentence the reply form shows for a blank reply, in place of a request. */
const EMPTY_REPLY_MESSAGE = "Enter a reply";

/**
 * The sentence shown when the service refuses the title. The schema fixes this field to a
 * non-empty string, so a `400` here is always the missing or empty value and never a
 * rejection of what was typed.
 */
const REFUSED_TITLE_MESSAGE = "The service refused the title. A thread needs a title of at least one character.";

/** The sentence shown when the service refuses the reply, for the same reason as above. */
const REFUSED_REPLY_MESSAGE = "The service refused the reply. A reply needs at least one character.";

/**
 * The explanation for a `401`. It names what is missing, points at the switcher, and says
 * plainly that a selection is a synthetic role rather than a credential: this is the
 * demonstration's identity boundary, never a login prompt.
 */
const NO_DEMO_ACCOUNT_MESSAGE = `No demo account is selected that this demonstration recognises, so the write was refused. Choose one in the demo account switcher in the header: a selection is a synthetic role for this demonstration, not a credential, which is why the banner carries the label "${DEMO_AUTHENTICATION_LABEL}".`;

/**
 * The explanation for the reply form's `404`. The typed text stays in the field, so the
 * sentence says where to take it next rather than only what failed.
 */
const THREAD_GONE_MESSAGE =
  "This thread is no longer on the board, so the reply was not posted. What you typed is still in the field, ready to be posted on another thread.";

/**
 * The fallback for a raised value the readers below cannot read as a failure at all — a defect
 * rather than a refusal. Nothing is claimed about its cause beyond the fact that the write did
 * not complete.
 */
const UNEXPECTED_FAILURE_MESSAGE = "The write could not be completed. Try again.";

/**
 * One failed write, ready to render: the sentence, where it belongs, and whether the reply
 * form can also offer the way back to the board.
 *
 * Only a failure of the field's own value sets `inField`, because only that case makes the
 * control's own value the thing a reader has to change; marking a field invalid for a missing
 * demo account or a spent rate limit would point at the wrong control.
 */
interface WriteFailure {
  /** The sentence the form renders — beside the field when `inField`, else in its status region. */
  readonly message: string;
  /** Whether the field's own value caused the failure, the only case that marks the field invalid. */
  readonly inField: boolean;
  /** Whether the thread is gone, so the reply form offers the board in the same explanation. */
  readonly threadGone: boolean;
}

/** A failure that belongs in the form's status region rather than beside its field. */
function regionFailure(message: string): WriteFailure {
  return { message, inField: false, threadGone: false };
}

/**
 * The throttled-write explanation: this form's own "the allowance is spent" sentence, and the
 * wait the response itself stated.
 *
 * The count of writes comes from the one definition the API contract uses. The wait no longer
 * has a branch here at all: `../payload-reading` states it once for every form, and this file's
 * own rule — a moment for an absent or spent count, one second in the singular, the seconds as
 * given otherwise — is that module's rule. No delay is invented here, because the wait belongs to
 * the service and arrives in a `Retry-After`.
 *
 * The module rounds a fractional wait up to the whole second a reader would count; a `Retry-After`
 * carries whole seconds, so no sentence a service can reach is changed by that — every whole wait
 * renders exactly as this form worded it before, the singular one included.
 */
function describeRateLimit(retryAfterSeconds: number | null): string {
  const reached = `The write rate limit has been reached: ${WRITE_RATE_LIMIT_MAX} writes a minute is the whole allowance for a demo client.`;
  return `${reached} ${describeRetryWait(retryAfterSeconds, "then try again.")}`;
}

/**
 * The explanation and the destination of a failed thread creation.
 *
 * No role refusal is rendered: this row accepts any resolvable demo account, so gating on a
 * role would refuse a write the contract allows, and a "wrong role" sentence would describe a
 * failure this form can never meet.
 *
 * The failure is read as the data it carries — its status, its code, its sentence and the wait it
 * stated — rather than as an instance of the class that raised it, because it crossed a module
 * boundary on its way here: a failure raised from another realm, or by a future client path, is
 * explained exactly as the present one is. Only a value carrying none of those facts reaches the
 * fallback.
 */
function describeCreateFailure(error: unknown): WriteFailure {
  const failure = readWriteFailure(error);
  if (failure === null) {
    return regionFailure(UNEXPECTED_FAILURE_MESSAGE);
  }
  switch (failure.status) {
    case 400:
      return { message: REFUSED_TITLE_MESSAGE, inField: true, threadGone: false };
    case 401:
      return regionFailure(NO_DEMO_ACCOUNT_MESSAGE);
    case 429:
      return regionFailure(describeRateLimit(failure.retryAfterSeconds));
    default:
      // Every other failure the client raises already carries a sentence a page may render as it
      // stands — a transport failure, a server fault — and it carries no path, header or body.
      return regionFailure(failure.message);
  }
}

/**
 * The explanation and the destination of a failed reply: {@link describeCreateFailure}'s cases
 * plus the `404` of a thread that is gone. There is no role refusal here for the same reason.
 *
 * Its failure is read the way {@link describeCreateFailure} reads one — as data rather than as an
 * instance of the class that raised it — so a failure raised from another realm or by a future
 * client path is recognised for the status it carries instead of losing it.
 */
function describeReplyFailure(error: unknown): WriteFailure {
  const failure = readWriteFailure(error);
  if (failure === null) {
    return regionFailure(UNEXPECTED_FAILURE_MESSAGE);
  }
  switch (failure.status) {
    case 400:
      return { message: REFUSED_REPLY_MESSAGE, inField: true, threadGone: false };
    case 401:
      return regionFailure(NO_DEMO_ACCOUNT_MESSAGE);
    case 404:
      return { message: THREAD_GONE_MESSAGE, inField: false, threadGone: true };
    case 429:
      return regionFailure(describeRateLimit(failure.retryAfterSeconds));
    default:
      return regionFailure(failure.message);
  }
}

/**
 * Props for {@link ThreadCreateForm}. The callback is optional, and a caller that does not
 * need the created thread omits it rather than passing `undefined`.
 */
export interface ThreadCreateFormProps {
  /** Run with the created thread, so the page can select it immediately. */
  readonly onCreated?: (thread: Thread) => void;
}

/**
 * The form that starts a thread on the discussion board. Body: `{ title }`.
 *
 * The field clears once the thread exists, the confirmation is announced politely, and the
 * page is told about the thread through `onCreated` so it can show what was just created.
 */
export function ThreadCreateForm(props: ThreadCreateFormProps): JSX.Element {
  const baseId = useId();
  const titleFieldId = `${baseId}-title`;
  const titleHintId = `${baseId}-title-hint`;
  const titleErrorId = `${baseId}-title-error`;
  const submitHintId = `${baseId}-submit-hint`;

  const [title, setTitle] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [created, setCreated] = useState<Thread | null>(null);

  const fieldError = failure !== null && failure.inField ? failure.message : null;

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
    // A field-level sentence describes the value that was submitted; once the value changes it
    // describes something that is no longer in the field.
    setFailure((previous: WriteFailure | null): WriteFailure | null =>
      previous !== null && previous.inField ? null : previous,
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    setCreated(null);
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") {
      setFailure({ message: EMPTY_TITLE_MESSAGE, inField: true, threadGone: false });
      return;
    }

    setFailure(null);
    setIsSubmitting(true);
    try {
      const thread = await createThread({ title: trimmedTitle });
      setTitle("");
      setCreated(thread);
      props.onCreated?.(thread);
    } catch (error: unknown) {
      setFailure(describeCreateFailure(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="thread-reply-form" noValidate onSubmit={handleSubmit}>
      <div className={fieldError === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={titleFieldId}>
          Thread title
        </label>
        <input
          id={titleFieldId}
          className="field__input"
          type="text"
          value={title}
          onChange={handleTitleChange}
          // The schema requires this field and the form refuses a blank value before it sends one, so
          // the requirement is stated to assistive technology as well; `noValidate` above keeps the
          // browser's own constraint check out of the submit path.
          required
          aria-invalid={fieldError !== null}
          aria-describedby={fieldError === null ? titleHintId : `${titleHintId} ${titleErrorId}`}
          // Discussion content is free text that no browser or password manager has anything to
          // offer for, so autofill is switched off rather than left to a guessed field purpose.
          autoComplete="off"
        />
        <p className="field__hint" id={titleHintId}>
          A question, an observation, a piece of evidence or a suggestion about a standard, an
          evaluation or a listing. The board is public: keep to the subject, and leave out contact
          details and anything about another person.
        </p>
        {fieldError === null ? null : (
          <p className="field__error" id={titleErrorId}>
            {fieldError}
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
        {isSubmitting ? "Starting the thread…" : "Start thread"}
      </button>

      {/* The region is rendered with the form and only its content is written on submit, so the node
          exists before the status it announces changes; role="status" makes it the polite live
          region a started thread is announced in. */}
      <div className="status-region" role="status">
        {isSubmitting ? (
          <p className="field__hint" id={submitHintId}>
            Starting the thread; this form waits for the service before it can be submitted again.
          </p>
        ) : null}

        {failure === null || failure.inField ? null : (
          <div className="notice notice--error">
            <p>{failure.message}</p>
          </div>
        )}

        {created === null ? null : (
          <div className="notice notice--success">
            <p>{`Thread started: "${created.title}". It now appears on the discussion board.`}</p>
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * Props for {@link ThreadReplyForm}. The thread being replied to is required; the callback is
 * optional, and a caller that does not need the created post omits it rather than passing
 * `undefined`.
 */
export interface ThreadReplyFormProps {
  /** The thread being replied to. It goes into the path, not into the body. */
  readonly threadId: string;
  /** Run with the created post, so the page can append it or refetch the thread. */
  readonly onCreated?: (post: ThreadPost) => void;
}

/**
 * The form that posts a reply on an existing thread. Body: `{ body }`.
 *
 * The reply's field is named `body` because that is the field the contract names, and the
 * thread it belongs to travels in the path (`POST /threads/{id}/posts`) rather than in the
 * body, where the route would ignore it.
 *
 * The reply clears once it has been posted, the confirmation is announced politely, and the
 * page is told about the post through `onCreated` so it can show it at once.
 */
export function ThreadReplyForm(props: ThreadReplyFormProps): JSX.Element {
  const baseId = useId();
  const bodyFieldId = `${baseId}-body`;
  const bodyHintId = `${baseId}-body-hint`;
  const bodyErrorId = `${baseId}-body-error`;
  const submitHintId = `${baseId}-submit-hint`;

  const [body, setBody] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [created, setCreated] = useState<ThreadPost | null>(null);

  const fieldError = failure !== null && failure.inField ? failure.message : null;

  const handleBodyChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setBody(event.target.value);
    // As in the create form: a field-level sentence belongs to the value that was submitted, so a
    // change to that value retires it.
    setFailure((previous: WriteFailure | null): WriteFailure | null =>
      previous !== null && previous.inField ? null : previous,
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    setCreated(null);
    const trimmedBody = body.trim();
    if (trimmedBody === "") {
      setFailure({ message: EMPTY_REPLY_MESSAGE, inField: true, threadGone: false });
      return;
    }

    setFailure(null);
    setIsSubmitting(true);
    try {
      const post = await createPost(props.threadId, { body: trimmedBody });
      setBody("");
      setCreated(post);
      props.onCreated?.(post);
    } catch (error: unknown) {
      setFailure(describeReplyFailure(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="thread-reply-form" noValidate onSubmit={handleSubmit}>
      <div className={fieldError === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={bodyFieldId}>
          Your reply
        </label>
        <textarea
          id={bodyFieldId}
          className="field__input"
          rows={4}
          value={body}
          onChange={handleBodyChange}
          // As with the title above: the contract requires this field and the form refuses a blank
          // value before it sends one, so the requirement is stated here too, and `noValidate` keeps
          // the browser's constraint check out of the submit path.
          required
          aria-invalid={fieldError !== null}
          aria-describedby={fieldError === null ? bodyHintId : `${bodyHintId} ${bodyErrorId}`}
          // A reply is free text with no autofill purpose, so no browser or password manager is
          // invited to fill it.
          autoComplete="off"
        />
        <p className="field__hint" id={bodyHintId}>
          Add an answer, an observation, a piece of evidence or a suggestion to this thread. The
          board is public: keep to the subject, and leave out contact details and anything about
          another person.
        </p>
        {fieldError === null ? null : (
          <p className="field__error" id={bodyErrorId}>
            {fieldError}
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
        {isSubmitting ? "Posting the reply…" : "Post reply"}
      </button>

      {/* The region is rendered with the form and only its content is written on submit, so the node
          exists before the status it announces changes; role="status" makes it the polite live
          region a posted reply is announced in. */}
      <div className="status-region" role="status">
        {isSubmitting ? (
          <p className="field__hint" id={submitHintId}>
            Posting the reply; this form waits for the service before it can be submitted again.
          </p>
        ) : null}

        {failure === null || failure.inField ? null : (
          <div className="notice notice--error">
            <p>{failure.message}</p>
            {failure.threadGone ? (
              <p>
                <Link to="/threads">Back to the discussion board</Link>
              </p>
            ) : null}
          </div>
        )}

        {created === null ? null : (
          <div className="notice notice--success">
            <p>Your reply was posted on this thread.</p>
          </div>
        )}
      </div>
    </form>
  );
}
