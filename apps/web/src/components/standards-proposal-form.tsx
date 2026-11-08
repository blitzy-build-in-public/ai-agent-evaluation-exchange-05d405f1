/**
 * The contributor's proposal form for the standard the standards page is showing: a proposal title
 * and its rationale, submitted through `POST /standards/proposals`.
 *
 * **`status` is deliberately not a client field.** The route creates the row `submitted`, and the
 * only route that may move it is the operator's review, which appends a governance event and never
 * rewrites the proposal's text. So this form renders no status control at all — a disabled one
 * included — and sends nothing but `standard_id`, `title` and `rationale`: a control here would say
 * a proposer can decide its own proposal, which is the human-review path the Standard Gate Index
 * rests on.
 *
 * **This form submits; it does not review.** The standards page owns the catalogue, the selected
 * version and the proposal list, and it places the operator's review control: no review call is
 * imported here and no decision, accept or reject control is rendered.
 *
 * **Every write goes through the API client.** `submitProposal` is the only call, it attaches the
 * demo-account header itself, and this file holds no URL, no header and no `fetch`. Each failure the
 * contract names is explained in the reader's own terms: `401` no demo account selected, pointing at
 * the switcher and stating plainly that a demo session is not a sign-in; `403` the selected account
 * is not a contributor, naming the role the action needs; `400` the refusal's own sentence beside
 * the field it concerns; `429` the write limit with the whole seconds to wait. The typed text
 * survives every failure, and no failure renders a stack trace, a raw body or a bare status code.
 *
 * **The copy claims no more than the product does.** The help line states that a maintainer reviews
 * the proposal and that a standard's thresholds change only by publishing a new version through that
 * review. Nothing here promises automatic acceptance, and nothing describes a standard, a report or
 * Shield as certified or independently verified.
 *
 * Presentation only, and self-contained: the two field values, an in-flight flag, the caught failure
 * and the created proposal are the whole of its state. No storage, no cookie, no URL parameter.
 */

import { useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { DEMO_AUTHENTICATION_LABEL } from "@adem/shared";
import type { StandardProposal } from "@adem/shared";
import { submitProposal } from "../api-client";
import { isRecord, readNumber, readText } from "../payload-reading";

/** Props for {@link StandardsProposalForm}. */
export interface StandardsProposalFormProps {
  /** The standard the proposal concerns; sent as `standard_id` in the POST /standards/proposals body. */
  readonly standardId: string;
}

/** The two fields this form owns, and the only two a refusal can be attached to. */
type ProposalField = "title" | "rationale";

/** The title field's label, used for its `<label>` and for the announcement that names it. */
const TITLE_FIELD_LABEL = "Proposal title";

/** The rationale field's label, used for its `<label>` and for the announcement that names it. */
const RATIONALE_FIELD_LABEL = "Rationale";

/**
 * What a proposal is and what submitting one does, stated beside the fields. Without it the form
 * would read as if a submission changed the standard, which the governance path denies.
 */
const HELP_LINE =
  "A maintainer reviews every proposal. A standard's thresholds change only by publishing a new version through that review — an existing version is never edited — so submitting a proposal decides nothing by itself.";

/** The submit control's label. */
const SUBMIT_LABEL = "Submit proposal";

/** Shown beside the control while a field is blank: what a submission needs, said rather than implied. */
const SUBMIT_HINT =
  "A proposal needs both a title and a rationale. A blank field is reported beside it, and nothing is sent until both are filled in.";

/** Shown beside the control while a submission is in flight — the reason the control cannot act. */
const SUBMITTING_HINT =
  "Submitting the proposal; the control becomes available as soon as the service answers.";

/** The title field's own refusal when it is blank. */
const TITLE_REQUIRED_MESSAGE = "Enter a proposal title. Nothing was sent.";

/** The rationale field's own refusal when it is blank. */
const RATIONALE_REQUIRED_MESSAGE = "Enter a rationale. Nothing was sent.";

/** `401`: no demo account is selected, so no request leaves the browser. */
const NO_DEMO_ACCOUNT_EXPLANATION = `No demo account is selected, so the proposal was not sent. Choose an account in the demo-account switcher above, then submit again — the switcher sets the role a write acts as for this demonstration (${DEMO_AUTHENTICATION_LABEL}), and it is not a sign-in.`;

/** `403`: the selected account's role is not the one this route requires. */
const NOT_A_CONTRIBUTOR_EXPLANATION =
  "The selected demo account is not a contributor, so the proposal was not sent. Proposing a change to a standard needs the contributor role: switch to a contributor demo account above, then submit again.";

/** `404`: the standard the form was opened for is not in the catalogue. */
const UNKNOWN_STANDARD_EXPLANATION =
  "That standard is not in the catalogue, so nothing was created. Reload the standards page, choose a standard it lists, and propose again.";

/** The opening sentence of a throttled write's explanation; the wait is appended from `Retry-After`. */
const RATE_LIMIT_EXPLANATION =
  "This client has sent the maximum number of writes allowed in a minute, so the proposal was not sent.";

/** No response was received at all. */
const SERVICE_UNREACHABLE_EXPLANATION =
  "The service could not be reached, so no request was sent and nothing was created. Check that the app is running, then submit again.";

/** A server fault: the submission was not completed. */
const SERVICE_FAULT_EXPLANATION =
  "The service could not complete the submission, so nothing was created. Try again in a moment.";

/** A refusal at the edge of the API, whose sentence names a schema rather than a field. */
const REFUSED_PROPOSAL_EXPLANATION =
  "The proposal was refused, so nothing was created. Check the title and the rationale, then submit again.";

/** Any other refusal: general, rather than exposing a status or a code the reader cannot act on. */
const UNMAPPED_FAILURE_EXPLANATION =
  "The proposal could not be submitted, so nothing was created. Check both fields, then try again.";

/**
 * The three API codes this form branches on beside the status, restated because the API workspace
 * cannot be reached from this one — the same reason `../api-client` restates the statuses it maps.
 * `rate_limited` is `429`; `invalid_proposal` and `validation_error` are both `400`.
 */
const RATE_LIMITED_CODE = "rate_limited";
const INVALID_PROPOSAL_CODE = "invalid_proposal";
const VALIDATION_ERROR_CODE = "validation_error";

/**
 * What the form shows for one caught failure: a sentence for each field the refusal concerns, or one
 * sentence for the form as a whole, plus the sentence the polite region announces.
 */
interface FailureExplanation {
  readonly titleMessage: string | null;
  readonly rationaleMessage: string | null;
  readonly formMessage: string | null;
  readonly announcement: string;
}

/**
 * The refusal this form raises itself when a field is blank. It is kept apart from the client's own
 * failure type on purpose: which field carries which sentence is this form's decision, so it states
 * those sentences by name, and the narrowing below reads both shapes by their properties.
 */
interface FieldRefusal {
  readonly titleMessage: string | null;
  readonly rationaleMessage: string | null;
}

/** A property of a caught value, or `undefined` when the value is not an object. */
function readProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** A refusal that concerns fields: the region points the reader at the field to correct. */
function explanationForFields(
  titleMessage: string | null,
  rationaleMessage: string | null,
): FailureExplanation {
  const bothFields = titleMessage !== null && rationaleMessage !== null;
  const named = bothFields
    ? `the ${TITLE_FIELD_LABEL} and ${RATIONALE_FIELD_LABEL} fields each need attention`
    : `the ${titleMessage === null ? RATIONALE_FIELD_LABEL : TITLE_FIELD_LABEL} field needs attention`;
  return {
    titleMessage,
    rationaleMessage,
    formMessage: null,
    announcement: `The proposal was not sent: ${named}.`,
  };
}

/** A form-level explanation: the one sentence is both shown and announced. */
function formExplanation(formMessage: string): FailureExplanation {
  return { titleMessage: null, rationaleMessage: null, formMessage, announcement: formMessage };
}

/** A throttled write's explanation, carrying the whole seconds the response asked the client to wait. */
function throttledExplanation(retryAfterSeconds: number | null): FailureExplanation {
  if (retryAfterSeconds === null) {
    return formExplanation(`${RATE_LIMIT_EXPLANATION} Wait a moment, then try again.`);
  }
  // The header holds whole seconds; a fraction is rounded up so the reader never retries too early.
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return formExplanation(
    `${RATE_LIMIT_EXPLANATION} Wait ${seconds} second${seconds === 1 ? "" : "s"}, then try again.`,
  );
}

/**
 * The field a sentence concerns, or `null` when it names both fields or neither. The domain's `400`
 * sentence for an empty value names the field it refused; a sentence naming no single field belongs
 * to the form, because marking an unrelated field invalid would misdirect the reader.
 */
function fieldNamedBy(message: string | null): ProposalField | null {
  if (message === null) {
    return null;
  }
  const lowercase = message.toLowerCase();
  const namesTitle = lowercase.includes("title");
  const namesRationale = lowercase.includes("rationale");
  if (namesTitle === namesRationale) {
    return null;
  }
  return namesTitle ? "title" : "rationale";
}

/**
 * What the form shows for a caught value, whatever was thrown: the refusal this form raised itself,
 * the client's typed failure, or a value that is neither — never a rethrow, a raw object or a status.
 */
function explainFailure(failure: unknown): FailureExplanation | null {
  if (failure === null) {
    return null;
  }

  const titleMessage = readText(readProperty(failure, "titleMessage"));
  const rationaleMessage = readText(readProperty(failure, "rationaleMessage"));
  if (titleMessage !== null || rationaleMessage !== null) {
    return explanationForFields(titleMessage, rationaleMessage);
  }

  const status = readNumber(readProperty(failure, "status"));
  const code = readText(readProperty(failure, "code"));
  const message = readText(readProperty(failure, "message"));

  if (status === 401) {
    return formExplanation(NO_DEMO_ACCOUNT_EXPLANATION);
  }
  if (status === 403) {
    return formExplanation(NOT_A_CONTRIBUTOR_EXPLANATION);
  }
  if (status === 429 || code === RATE_LIMITED_CODE) {
    return throttledExplanation(readNumber(readProperty(failure, "retryAfterSeconds")));
  }
  if (status === 404) {
    return formExplanation(UNKNOWN_STANDARD_EXPLANATION);
  }
  if (status === 400 || code === INVALID_PROPOSAL_CODE || code === VALIDATION_ERROR_CODE) {
    // The domain's own sentence says what it refused; a body refused at the edge carries a sentence
    // about a schema instead, so that one is answered in this form's terms.
    const refusal =
      code === INVALID_PROPOSAL_CODE && message !== null ? message : REFUSED_PROPOSAL_EXPLANATION;
    const field = fieldNamedBy(refusal);
    if (field === "title") {
      return explanationForFields(refusal, null);
    }
    if (field === "rationale") {
      return explanationForFields(null, refusal);
    }
    return formExplanation(refusal);
  }
  if (status === 0) {
    return formExplanation(SERVICE_UNREACHABLE_EXPLANATION);
  }
  if (status !== null && status >= 500) {
    return formExplanation(SERVICE_FAULT_EXPLANATION);
  }
  return formExplanation(UNMAPPED_FAILURE_EXPLANATION);
}

/** The confirmation the polite region announces once the proposal exists. */
function confirmationSentence(proposal: StandardProposal): string {
  return `Proposal ${proposal.id} was submitted with status "${proposal.status}" and is waiting for a maintainer's review.`;
}

/**
 * The contributor's proposal form: the two fields, the submission, and the explanation of whatever
 * comes back. The typed text is kept through every failure, and the outcome is announced in its own
 * polite region as well as shown beside the field it concerns.
 */
export function StandardsProposalForm(props: StandardsProposalFormProps): JSX.Element {
  const idPrefix = useId();
  const titleFieldId = `${idPrefix}-title`;
  const titleErrorId = `${idPrefix}-title-error`;
  const rationaleFieldId = `${idPrefix}-rationale`;
  const rationaleErrorId = `${idPrefix}-rationale-error`;
  const helpLineId = `${idPrefix}-help`;
  const submitHintId = `${idPrefix}-submit-hint`;

  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [proposal, setProposal] = useState<StandardProposal | null>(null);

  const explanation = explainFailure(failure);
  const titleMessage = explanation === null ? null : explanation.titleMessage;
  const rationaleMessage = explanation === null ? null : explanation.rationaleMessage;
  const formMessage = explanation === null ? null : explanation.formMessage;

  const submitHint = submitting
    ? SUBMITTING_HINT
    : title.trim() === "" || rationale.trim() === ""
      ? SUBMIT_HINT
      : null;

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value);
  };

  const handleRationaleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setRationale(event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const blankTitle = title.trim() === "";
    const blankRationale = rationale.trim() === "";
    if (blankTitle || blankRationale) {
      // A blank field is refused here, before a request is sent: both fields keep what was typed, and
      // the service's own refusal stays reachable for a body this check cannot see.
      setProposal(null);
      setFailure({
        titleMessage: blankTitle ? TITLE_REQUIRED_MESSAGE : null,
        rationaleMessage: blankRationale ? RATIONALE_REQUIRED_MESSAGE : null,
      } satisfies FieldRefusal);
      return;
    }

    setProposal(null);
    setFailure(null);
    setSubmitting(true);
    try {
      const created = await submitProposal({
        standard_id: props.standardId,
        title,
        rationale,
      });
      setTitle("");
      setRationale("");
      setProposal(created);
    } catch (error: unknown) {
      setFailure(error);
    } finally {
      setSubmitting(false);
    }
  };

  // Both controls carry `autoComplete="off"`: the form collects what the proposer writes about a
  // standard, not information about the proposer, so no autocomplete token describes these fields and
  // `off` is the honest value rather than an invented one.
  return (
    <form
      className="standards-proposal-form"
      aria-label="Submit a standards proposal"
      onSubmit={handleSubmit}
      noValidate
    >
      <p className="field__hint" id={helpLineId}>
        {HELP_LINE}
      </p>

      <div className={titleMessage === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={titleFieldId}>
          {TITLE_FIELD_LABEL}
        </label>
        <input
          id={titleFieldId}
          name="title"
          type="text"
          value={title}
          onChange={handleTitleChange}
          aria-invalid={titleMessage !== null}
          aria-describedby={titleMessage === null ? helpLineId : `${helpLineId} ${titleErrorId}`}
          autoComplete="off"
        />
        {titleMessage === null ? null : (
          <p className="field__error" id={titleErrorId}>
            {titleMessage}
          </p>
        )}
      </div>

      <div className={rationaleMessage === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={rationaleFieldId}>
          {RATIONALE_FIELD_LABEL}
        </label>
        <textarea
          id={rationaleFieldId}
          name="rationale"
          rows={6}
          value={rationale}
          onChange={handleRationaleChange}
          aria-invalid={rationaleMessage !== null}
          aria-describedby={
            rationaleMessage === null ? helpLineId : `${helpLineId} ${rationaleErrorId}`
          }
          autoComplete="off"
        />
        {rationaleMessage === null ? null : (
          <p className="field__error" id={rationaleErrorId}>
            {rationaleMessage}
          </p>
        )}
      </div>

      {/* The control is disabled only while a submission is in flight: a blank field is reported
          beside it when the form is submitted, which is what keeps that explanation reachable. */}
      <button
        type="submit"
        className="button button--primary"
        disabled={submitting}
        aria-busy={submitting}
        aria-describedby={submitHint === null ? undefined : submitHintId}
      >
        {SUBMIT_LABEL}
      </button>

      {submitHint === null ? null : (
        <p className="field__hint" id={submitHintId}>
          {submitHint}
        </p>
      )}

      {/* The region is rendered with the component and only its content changes, so the node exists
          before the status it announces arrives. `role="status"` is already a polite live region;
          `aria-live` is stated beside it because that attribute is named for this surface. */}
      <div className="status-region" role="status" aria-live="polite">
        {proposal !== null ? (
          <p className="notice notice--success">{confirmationSentence(proposal)}</p>
        ) : formMessage !== null ? (
          <p className="error-notice">{formMessage}</p>
        ) : explanation === null ? null : (
          <p>{explanation.announcement}</p>
        )}
      </div>
    </form>
  );
}
