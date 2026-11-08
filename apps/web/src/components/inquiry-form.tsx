/**
 * The buyer's inquiry against one listing: the message field, what happens to it, and the
 * failure a submission met — each rendered as an explanation with a next step, never a trace.
 *
 * Five decisions hold this component together, and each is one a later reader could invert.
 *
 * **A write goes through `../api-client` and nowhere else.** `createInquiry` is the only call
 * this module makes: that module owns the versioned base path, the demo-session header every
 * write carries, the one error envelope and the typed failure, and a second calling site would be
 * a second place for those to drift. Nothing here builds a URL, sets a header or reads a
 * response.
 *
 * **Every failure a reader can act on differently gets its own sentence.** No demo account
 * selected (`401`), the selected account is not a buyer (`403`), the listing is gone (`404`),
 * the message was refused (`400`), the write rate limit was reached (`429`) and no response
 * arrived at all are six different next steps; one shared "the inquiry failed" would leave the
 * reader with nothing to do about any of them.
 *
 * **The explanation goes where the failure belongs, not into one undifferentiated slot.** A
 * message the service refused is the message field's own problem: it is rendered beside the field,
 * the field is marked invalid, and the sentence is part of what describes that control. Every
 * other failure — no demo account, the wrong role, a listing that is gone, the write rate limit, a
 * service that cannot be reached — says nothing about what the reader typed, so it is announced by
 * the form's polite status region: describing a control with a role mismatch would tell a
 * screen-reader user to look for a mistake in a field that has none.
 *
 * **`aria-invalid` follows the field's own validity, not the request's fate.** Only an empty
 * message and the service's own `400` mark the field invalid, and only those two sentences are
 * cleared when the reader edits the message, because typing cannot fix a role; every other failure
 * stands until it is resolved or retried.
 *
 * **The body carries `listing_id` and `message`, and nothing else.** The buyer is the demo
 * account the header names, resolved by the server from the request itself, so this form sends
 * no account field and holds no name, email or contact detail: the contract accepts none, and
 * the repository collects no real personal information. A message left empty is refused here
 * before any request is sent, so a blank submit costs no round trip and no write against the
 * rate limit — while the service's `400` stays renderable all the same, because the shared
 * schema, not this form, is the contract. The message itself leaves this form as the reader wrote
 * it: it is trimmed only to tell an empty one from a filled one, and never edited on its way out.
 *
 * One state is this component's own: whether the last submission is still in flight. Nothing is
 * persisted — the selected demo account is `../api-client`'s to remember — and this module reads
 * and writes no storage, no cookie and no configuration of its own.
 */

import { useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Inquiry } from "@adem/shared";
import { createInquiry } from "../api-client";
import { describeRetryWait, readWriteFailure } from "../payload-reading";

/**
 * Props for {@link InquiryForm}: the one listing the inquiry is about.
 */
export interface InquiryFormProps {
  /** The listing the inquiry is about; sent as `listing_id` in the `POST /inquiries` body. */
  readonly listingId: string;
}

const MESSAGE_LABEL = "Your inquiry";

/**
 * The help sentence the field is described by. It says what happens to the inquiry and states the
 * demo boundary in plain words: the write goes out as the demo account the switcher has selected,
 * which separates roles for this demonstration and is not authentication of any identity.
 */
const MESSAGE_HINT =
  "Sent as the demo account selected in the account switcher above. There is no production " +
  "authentication: the demo accounts are synthetic.";

const SUBMIT_LABEL = "Send inquiry";
const SUBMITTING_LABEL = "Sending inquiry";
const SENDING_STATUS = "Sending your inquiry.";
const EMPTY_MESSAGE_ERROR = "Enter an inquiry message";

/**
 * One sentence per failure a reader can act on differently, with a fallback behind them. Each ends
 * in the next step its own failure needs, and each says whether anything was recorded, which is the
 * one thing a writer wants to know after a failed write. The wording is `error-notice.tsx`'s own —
 * the component that renders a failed request everywhere else in this UI — because two phrasings of
 * one failure would read as two different products.
 */
const GENERIC_FAILURE_TEXT =
  "This inquiry could not be sent because of a problem on our side. Nothing you sent caused it, " +
  "and nothing was recorded, so sending it again is safe.";
const TRANSPORT_FAILURE_TEXT =
  "The service could not be reached, so this inquiry was not sent. Check that it is running, then " +
  "send it again. Nothing was recorded.";

/**
 * The sentence a write with no demo account is refused with. It says the selection is what supplies
 * the role, points at the switcher, and states that no credential exists to supply: the demo header
 * is a synthetic role selector, and a message hinting at a login would misstate what this product's
 * demo session is.
 */
const NO_DEMO_ACCOUNT_TEXT =
  "No demo account is selected, so this inquiry was not sent with a role to act as. Choose one in " +
  "the demo-account switcher above and send it again. Selecting an account only assigns a role for " +
  "the demonstration; there is nothing to log in with.";

const NOT_A_BUYER_TEXT =
  "The selected demo account does not have the buyer role this inquiry requires, and only a buyer " +
  "account can send one. Switch to a buyer demo account in the demo-account switcher above and " +
  "send it again. Nothing was recorded.";

const LISTING_GONE_TEXT =
  "This listing is no longer available for inquiries: it may have been removed, or hidden from " +
  "public view. Nothing was recorded, and every listing that remains is still browsable.";

/**
 * The sentence a message too large for the service is refused with, which is the message field's own
 * problem and is marked as one.
 *
 * It names the reader's own text as the cause and the one next step, and it states no byte count: the
 * size the service accepts is the service's, and a number here would have to be kept in step with it.
 * `error-notice.tsx` states the same cause for the same status, which is the one wording this UI
 * gives a failure, and it is the sentence a reader sees wherever that component renders the refusal.
 */
const MESSAGE_TOO_LARGE_TEXT =
  "The message was larger than the service accepts, so the inquiry was not sent. Nothing was " +
  "recorded — shorten it and send it again.";

/**
 * The refusal this form produces for itself: a message left empty, caught before any request is
 * sent so that a blank submit is neither a round trip nor a write against the rate limit.
 *
 * It is an `Error` so that it occupies the same state slot as a failure raised by
 * `createInquiry`, and a class rather than a bare object so that the render narrows on it
 * unambiguously — nothing else on this path throws one.
 */
class EmptyMessageError extends Error {
  constructor() {
    super(EMPTY_MESSAGE_ERROR);
    this.name = "EmptyMessageError";
  }
}

/**
 * What the form renders about a failure: the sentence itself, whether the message field is the
 * thing at fault, and whether a route back to browsing belongs beside the sentence.
 */
interface FailureExplanation {
  readonly text: string;
  readonly fieldIsInvalid: boolean;
  readonly offersBrowse: boolean;
}

/**
 * The sentence a throttled write is refused with: this form's own refusal, the wait the response
 * itself stated, and what the refusal cost the reader.
 *
 * The wait has no branch here at all: `../payload-reading` states it once for the write forms of
 * this share, and the seconds belong to the service, which sends them in a `Retry-After`. No delay
 * is invented here — not even a floor of a second — so the wait a reader is told is the one the
 * response asked for.
 */
function describeRetry(retryAfterSeconds: number | null): string {
  const refusal =
    "Too many requests: this client has sent the maximum number of writes allowed in a minute";
  const wait = describeRetryWait(retryAfterSeconds, "then send the inquiry again.");
  return `${refusal}. ${wait} Nothing was recorded, so sending it again is safe.`;
}

/**
 * The explanation a validation failure is rendered with: the sentence the service sent, and the
 * field to look at.
 *
 * The service's own sentence is kept because the schema, not this form, decides what a valid
 * message is — a rule added there later then needs no change here.
 */
function explainValidation(failureMessage: string): string {
  const sentence = failureMessage.trim();
  // A blank sentence is refused as a failure's message, so the empty arm below stands only for a
  // caller that states its own sentence by hand.
  const reason = sentence === "" ? "" : ` ${sentence}`;
  return `The inquiry was not accepted as it was sent, so nothing was recorded.${reason} Check the message and send it again.`;
}

/**
 * The explanation one failure is rendered with.
 *
 * Every case a reader can act on differently has its own sentence, and the next step belongs to
 * the sentence: a refused message is the field's own problem, a message the service is too small to
 * accept is shortened in the same field, the two demo-account failures are resolved in the switcher,
 * a removed listing is resolved by browsing, and a throttled write is resolved by waiting for the
 * seconds the response stated. A failure this form cannot place renders the generic sentence and
 * never the service's own: the service's sentence for an internal failure exists so that nothing
 * internal reaches a client, and echoing whatever arrived would defeat it.
 */
function explainFailure(failure: unknown): FailureExplanation {
  if (failure instanceof EmptyMessageError) {
    return { text: EMPTY_MESSAGE_ERROR, fieldIsInvalid: true, offersBrowse: false };
  }
  const clientFailure = readWriteFailure(failure);
  if (clientFailure === null) {
    return { text: GENERIC_FAILURE_TEXT, fieldIsInvalid: false, offersBrowse: false };
  }
  switch (clientFailure.status) {
    case 400:
      return {
        text: explainValidation(clientFailure.message),
        fieldIsInvalid: true,
        offersBrowse: false,
      };
    case 401:
      return { text: NO_DEMO_ACCOUNT_TEXT, fieldIsInvalid: false, offersBrowse: false };
    case 403:
      return { text: NOT_A_BUYER_TEXT, fieldIsInvalid: false, offersBrowse: false };
    case 404:
      return { text: LISTING_GONE_TEXT, fieldIsInvalid: false, offersBrowse: true };
    case 413:
      return { text: MESSAGE_TOO_LARGE_TEXT, fieldIsInvalid: true, offersBrowse: false };
    case 429:
      return {
        text: describeRetry(clientFailure.retryAfterSeconds),
        fieldIsInvalid: false,
        offersBrowse: false,
      };
    case 0:
      return { text: TRANSPORT_FAILURE_TEXT, fieldIsInvalid: false, offersBrowse: false };
    default:
      return { text: GENERIC_FAILURE_TEXT, fieldIsInvalid: false, offersBrowse: false };
  }
}

/**
 * The confirmation a created inquiry is announced with: the record the write produced, named by
 * its identifier so it can be quoted, and never a copy of the message body — a confirmation is
 * about the write, not about its content, and echoing a buyer's message back into the layout
 * would put it somewhere the buyer did not type it.
 */
function describeConfirmation(inquiry: Inquiry): string {
  return `Your inquiry was sent, and is recorded against this listing under reference ${inquiry.id}.`;
}

/**
 * What the polite status region holds: the explanation of a failure that is not the message
 * field's own, the in-flight sentence while a request is out, the confirmation a created inquiry
 * produced, and nothing at all otherwise.
 *
 * The region is rendered from the first render and only its content changes, which is what lets an
 * assistive technology announce the failure, the in-flight state and the outcome that replaces it.
 * At most one of the three is ever rendered, because a submission clears the previous outcome
 * before it starts.
 */
function describeStatus(
  isSending: boolean,
  requestFailureText: string | null,
  sentInquiry: Inquiry | null,
): string {
  if (isSending) {
    return SENDING_STATUS;
  }
  if (requestFailureText !== null) {
    return requestFailureText;
  }
  return sentInquiry === null ? "" : describeConfirmation(sentInquiry);
}

/**
 * The buyer's inquiry: one labelled message field, what happens to it, the failure a submission
 * met and the confirmation a successful one produced.
 *
 * It holds no state beyond the message being typed, whether a submission is in flight, the
 * failure the last one returned and the inquiry it created. Every instance derives its
 * identifiers from `useId`, because more than one of these renders on one page: the listing page
 * renders one, and a comparison renders one in each listing's own column.
 */
export function InquiryForm(props: InquiryFormProps): JSX.Element {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [sentInquiry, setSentInquiry] = useState<Inquiry | null>(null);

  const idPrefix = useId();
  const messageFieldId = `${idPrefix}-message`;
  const messageHintId = `${idPrefix}-message-hint`;
  const messageErrorId = `${idPrefix}-message-error`;

  const explanation = failure === null ? null : explainFailure(failure);
  const fieldFailureText =
    explanation !== null && explanation.fieldIsInvalid ? explanation.text : null;
  const requestFailureText =
    explanation !== null && !explanation.fieldIsInvalid ? explanation.text : null;
  const offersBrowse = explanation !== null && explanation.offersBrowse;
  const statusText = describeStatus(isSending, requestFailureText, sentInquiry);

  // The field is described by its hint at all times, and by the failure sentence only when the
  // message itself is what the service refused, so the explanation stays attached to the control
  // it concerns and a failure that is not the field's own is never read out as if it were.
  const describedByIds =
    fieldFailureText === null ? messageHintId : `${messageHintId} ${messageErrorId}`;

  const handleMessageChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setMessage(event.target.value);
    if (fieldFailureText !== null) {
      setFailure(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (message.trim() === "") {
      setSentInquiry(null);
      setFailure(new EmptyMessageError());
      return;
    }
    setFailure(null);
    setSentInquiry(null);
    setIsSending(true);
    try {
      // The body carries the listing and the message and no account: the buyer is the demo
      // account `../api-client` has selected, so a client-supplied one here would let a caller
      // write an inquiry as another account.
      const inquiry = await createInquiry({ listing_id: props.listingId, message });
      setSentInquiry(inquiry);
      setMessage("");
    } catch (thrown: unknown) {
      setFailure(thrown);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form className="inquiry-form" onSubmit={handleSubmit} noValidate>
      <div className={fieldFailureText === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={messageFieldId}>
          {MESSAGE_LABEL}
        </label>
        {/* A free-text inquiry has no autofill purpose, so the control names none rather than
            claiming one it does not have. */}
        <textarea
          id={messageFieldId}
          value={message}
          onChange={handleMessageChange}
          autoComplete="off"
          aria-invalid={fieldFailureText !== null}
          aria-describedby={describedByIds}
        />
        <p className="field__hint" id={messageHintId}>
          {MESSAGE_HINT}
        </p>
        {fieldFailureText === null ? null : (
          <p className="field__error" id={messageErrorId} role="status">
            {fieldFailureText}
          </p>
        )}
      </div>
      <button
        type="submit"
        className="button button--primary"
        disabled={isSending}
        aria-busy={isSending}
      >
        {isSending ? SUBMITTING_LABEL : SUBMIT_LABEL}
      </button>
      <p className="status-region" role="status">
        {statusText}
      </p>
      {offersBrowse ? (
        <p className="field__hint">
          <Link to="/listings">Browse listings</Link>
        </p>
      ) : null}
    </form>
  );
}

