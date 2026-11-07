/**
 * The operator's moderation panel for one listing: flag, hide and restore, each with a reason
 * the contract requires.
 *
 * Six decisions are deliberate.
 *
 * **The reason is enforced twice, and only the second enforcement is the contract.** The
 * submit control is disabled while the reason is blank, so an obviously invalid write costs no
 * round trip, and the handler refuses a blank reason without sending anything. The API's schema
 * requires `reason` with `minLength: 1` all the same, so this panel keeps the server able to
 * refuse: a `400` renders as a sentence tied to the reason field, with the typed reason left in
 * place so it can be corrected rather than retyped. A component that prevented the blank case
 * on the client alone would hide the rule the server enforces.
 *
 * **The actions come from `MODERATION_ACTIONS`, never from a list written here.** One control
 * is rendered per entry, the value sent is the entry's own value, and the closed vocabulary
 * keeps its single definition — the one the API's request schema validates against.
 *
 * **Each action states what it does, in the layout and not on hover.** The operator's power
 * here is asymmetric: `hide` takes a listing out of search and compare, `restore` returns it,
 * and `flag` records a concern without changing whether it is visible. Each action therefore
 * carries a visible sentence, and none of them is described as deleting, erasing or removing
 * anything permanently — nothing here deletes. A hidden listing keeps its version history and
 * comes back with `restore`.
 *
 * **Every write goes through `../api-client`.** This component builds no URL, sends no header
 * and reads no response body: `moderateListing` owns the demo account header, the body of
 * exactly `{ action, reason }` and the typed failure, and the sentences below are this
 * component's own rendering of the statuses that failure carries. A write attempted with no
 * demo account selected is refused by that module before anything is sent, and reads here as
 * the explanation for `401` rather than as a failure from the service.
 *
 * **Nothing here can touch a measurement.** The operator's power is additive: this panel moves a
 * listing's status and the API appends a governance event and an audit event beside it. No
 * control here reads or writes an evaluation report, a case result, a standard version or a
 * ledger entry, and none is offered — an operator may take a listing out of view and must never
 * be able to change what a measurement says.
 *
 * **The caller renders this for the operator only.** Who is an operator is the page's decision,
 * taken from the selected demo account's role; this component renders no disabled controls for
 * anyone else, because a row of dead buttons reads as available and then refuses.
 *
 * Appearance belongs to the `.moderation-actions`, `.field*`, `.item-list` and `.button*` rules
 * in the web stylesheet. The outcome and every failure are announced through a
 * polite status region (WCAG 4.1.3), which matters because the listing page is one of the four
 * pages checked at 1280px and 360px.
 */

import { useId, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { moderateListing, TRANSPORT_ERROR_CODE } from "../api-client";
import { MODERATION_ACTIONS, WRITE_RATE_LIMIT_MAX } from "@adem/shared";
import type { ListingStatus, ModerationAction } from "@adem/shared";

/**
 * Props for {@link ModerationActions}.
 *
 * `currentStatus` is the listing's status as the page holds it, so the operator reads what the
 * action changes from, and `onStatusChanged` lets the page adopt the status the action returned
 * without re-reading the listing. The callback is optional, and a caller that has no use for it
 * omits it rather than passing `undefined` — `exactOptionalPropertyTypes` is on and passing an
 * explicit `undefined` is refused.
 */
export interface ModerationActionsProps {
  /** The identifier of the listing being moderated. */
  readonly listingId: string;
  /** The listing's current status, so the operator sees what the action changes from. */
  readonly currentStatus: ListingStatus;
  /** Run with the listing's new status after an action the service applied. */
  readonly onStatusChanged?: (status: ListingStatus) => void;
}

/** What the panel shows for one action: the control's text and what the action does. */
interface ModerationActionInfo {
  /** The action's name, as the radio states it. */
  readonly label: string;
  /** What the action does to the listing, in one sentence a reader needs no glossary for. */
  readonly summary: string;
}

/**
 * The panel's copy for each action, keyed by the action the API accepts. The keys are typed as
 * {@link ModerationAction}, so the vocabulary has one definition and a renamed action fails the
 * build here rather than failing the route's enum validation at run time.
 *
 * `hide` is described as taking the listing out of search and compare because that is all it
 * does: the row stays, the operator still reads it, and `restore` brings it back. Copy that
 * called it removal or deletion would misstate an action that is reversible.
 */
const MODERATION_ACTION_INFO: Readonly<Record<ModerationAction, ModerationActionInfo>> = Object.freeze({
  flag: Object.freeze({
    label: "Flag",
    summary: "Records a concern about the listing and leaves it visible in search and compare.",
  }),
  hide: Object.freeze({
    label: "Hide",
    summary:
      "Takes the listing out of search and compare. Nothing is deleted: it stays readable here for the operator, with its version history, and Restore brings it back.",
  }),
  restore: Object.freeze({
    label: "Restore",
    summary: "Returns a flagged or hidden listing to active, so it appears in search and compare again.",
  }),
});

/** The status a listing is in, in words, for the line that states what the operator is changing from. */
const LISTING_STATUS_LABELS: Readonly<Record<ListingStatus, string>> = Object.freeze({
  active: "Active",
  flagged: "Flagged",
  hidden: "Hidden",
});

/** The sentence beside the reason field when no reason has been entered. */
const REASON_REQUIRED_MESSAGE = "A reason is required for every moderation action.";

/**
 * The sentence beside the reason field when the service refuses the action with `400`. The one
 * `400` this row produces is a missing or blank reason — the action cannot leave the closed
 * vocabulary from this panel, which renders one control per entry — so it belongs beside the
 * reason field, and the reason it was sent with is still in the field.
 */
const REASON_REFUSED_MESSAGE =
  "The service refused this action: a moderation action needs a reason that is not blank. Your reason has been kept, so change it and try again.";

/** The notice for an action that was never sent because the reason was blank. */
const BLANK_REASON_NOTICE = "The action was not sent. Enter a reason, then apply it.";

/** The notice for an action the service refused with `400`. */
const REASON_REFUSED_NOTICE = "The action was refused. The reason field says what to change.";

/** The notice for a write with no demo account selected — `401`. */
const NO_ACCOUNT_NOTICE =
  "No demo account is selected, so the action was not sent. Choose one in the demo account switcher; the demo accounts separate roles for this demonstration.";

/** The notice for a demo account whose role is not the operator — `403`. */
const NOT_OPERATOR_NOTICE =
  "This action needs the operator role, and the selected demo account does not have it. Switch to the operator account in the demo account switcher, then apply the action again.";

/** The notice for a listing identifier no listing carries — `404`. */
const MISSING_LISTING_NOTICE =
  "No listing carries that identifier, so nothing was moderated. The listing may have left the catalogue.";

/** The notice for a request that never reached the service. */
const TRANSPORT_FAILURE_NOTICE = "The service could not be reached, so the action was not sent.";

/** The notice for a refusal this panel has no explanation for, a server fault included. */
const UNEXPECTED_FAILURE_NOTICE =
  "The action could not be applied. Try again, and report it if the failure keeps happening.";

/**
 * The facts of a refused call, as `../api-client` raises them. Read structurally rather than by
 * class: the failure crosses one module boundary and this panel needs three of its members, not
 * an identity check.
 */
interface ModerationFailure {
  /** The HTTP status of the response, or `0` when no response arrived at all. */
  readonly status: number;
  /** The stable code the failure carries. */
  readonly code: string;
  /** Whole seconds the response said to wait, or `null` when it said none. */
  readonly retryAfterSeconds: number | null;
}

/**
 * What the panel renders after a refusal: the sentence tied to the reason field where the
 * refusal is about the reason, the notice the status region announces, and whether the listing
 * the request named could not be found.
 */
interface ModerationRefusal {
  /** The sentence beside the reason field, or `null` when the refusal is not about the reason. */
  readonly reasonError: string | null;
  /** The sentence the status region announces. */
  readonly notice: string;
  /** Whether the refusal was an unknown listing, which the panel answers with a way back to browse. */
  readonly backToBrowse: boolean;
}

/** What the panel announces after an action the service applied. */
interface ModerationOutcome {
  /** The listing's status after the action. */
  readonly status: ListingStatus;
  /** The appended governance event's identifier, or `null` when the response carried none. */
  readonly eventId: string | null;
}

/** A thrown value as the failure this panel renders, or `null` when it carries no status. */
function readFailure(error: unknown): ModerationFailure | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const candidate = error as {
    readonly status?: unknown;
    readonly code?: unknown;
    readonly retryAfterSeconds?: unknown;
  };
  if (typeof candidate.status !== "number" || !Number.isFinite(candidate.status)) {
    return null;
  }
  return {
    status: candidate.status,
    code: typeof candidate.code === "string" ? candidate.code : "",
    retryAfterSeconds:
      typeof candidate.retryAfterSeconds === "number" && Number.isFinite(candidate.retryAfterSeconds)
        ? Math.max(0, Math.floor(candidate.retryAfterSeconds))
        : null,
  };
}

/**
 * The notice a throttled write is refused with, stating the limit the contract fixes and the
 * wait the response asked for rather than a bare status.
 */
function throttledNotice(retryAfterSeconds: number | null): string {
  const limit = `Too many writes have been sent from this client: the limit is ${WRITE_RATE_LIMIT_MAX} writes a minute.`;
  if (retryAfterSeconds === null) {
    return `${limit} Wait, then try again.`;
  }
  const wait = retryAfterSeconds === 1 ? "1 second" : `${retryAfterSeconds} seconds`;
  return `${limit} Try again in ${wait}.`;
}

/**
 * What the panel shows for one refused call, by status. Every branch names what happened and
 * what the reader can do next, and none of them renders a status code, a response body or a
 * stack: an error state is an explanation here, not a trace.
 */
function describeRefusal(error: unknown): ModerationRefusal {
  const failure = readFailure(error);
  if (failure === null) {
    return { reasonError: null, notice: UNEXPECTED_FAILURE_NOTICE, backToBrowse: false };
  }
  if (failure.code === TRANSPORT_ERROR_CODE) {
    return { reasonError: null, notice: TRANSPORT_FAILURE_NOTICE, backToBrowse: false };
  }
  switch (failure.status) {
    case 400:
      return { reasonError: REASON_REFUSED_MESSAGE, notice: REASON_REFUSED_NOTICE, backToBrowse: false };
    case 401:
      return { reasonError: null, notice: NO_ACCOUNT_NOTICE, backToBrowse: false };
    case 403:
      return { reasonError: null, notice: NOT_OPERATOR_NOTICE, backToBrowse: false };
    case 404:
      return { reasonError: null, notice: MISSING_LISTING_NOTICE, backToBrowse: true };
    case 429:
      return { reasonError: null, notice: throttledNotice(failure.retryAfterSeconds), backToBrowse: false };
    default:
      return { reasonError: null, notice: UNEXPECTED_FAILURE_NOTICE, backToBrowse: false };
  }
}

/**
 * What the panel announces after an action the service applied: the listing's new status, and the
 * reference of the governance event the route appended beside it. The event is named because it is
 * the record of the decision — the status is a column that moves, the reason behind it is a row
 * that never changes — so an operator has something to cite afterwards.
 */
function describeOutcome(outcome: ModerationOutcome): string {
  const status = LISTING_STATUS_LABELS[outcome.status];
  if (outcome.eventId === null) {
    return `The action was applied: the listing's status is now ${status}. The response carried no governance event reference.`;
  }
  return `The action was applied: the listing's status is now ${status}, and governance event ${outcome.eventId} was appended.`;
}

/**
 * The operator's moderation panel: one control per action of the closed vocabulary, the reason
 * the contract requires, and the outcome of what the service applied.
 *
 * The panel holds five pieces of state and nothing else — the chosen action, the reason, whether
 * a request is in flight, the refusal it is showing, and the outcome it last received — and it
 * stores nowhere: no `sessionStorage`, no cookie, no URL parameter, no cache. The refusal is
 * described once, where the call fails, rather than being kept as a raw thrown value and
 * re-described on every render, which is also why no failure can reach the DOM as an object.
 */
export function ModerationActions(props: ModerationActionsProps): JSX.Element {
  const idPrefix = useId();
  const actionGroupName = `${idPrefix}action`;
  const reasonId = `${idPrefix}reason`;
  const reasonHintId = `${idPrefix}reason-hint`;
  const reasonErrorId = `${idPrefix}reason-error`;
  const submitHintId = `${idPrefix}submit-hint`;

  const [action, setAction] = useState<ModerationAction>(MODERATION_ACTIONS[0]);
  const [reason, setReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [refusal, setRefusal] = useState<ModerationRefusal | null>(null);
  const [outcome, setOutcome] = useState<ModerationOutcome | null>(null);

  // The status the panel states: what the last applied action returned, and the page's own
  // value before any action has been applied.
  const displayedStatus = outcome === null ? props.currentStatus : outcome.status;
  const reasonError = refusal === null ? null : refusal.reasonError;
  const isReasonBlank = reason.trim() === "";

  const submitHint = isSubmitting
    ? "The action is being applied and cannot be sent twice."
    : isReasonBlank
      ? "Enter a reason, then apply the action."
      : "";

  // The meaning of each action is addressed by the control it explains, so a screen reader reads
  // what the chosen action does instead of hearing three unlabelled radios.
  const meaningId = (candidate: ModerationAction): string => `${idPrefix}meaning-${candidate}`;

  const handleActionChange = (candidate: ModerationAction): void => {
    setAction(candidate);
  };

  const handleReasonChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setReason(event.target.value);
    // Editing the reason clears the sentence that said the reason was the problem, while a
    // notice about the account or the listing — which typing cannot fix — stays readable.
    setRefusal((previous) =>
      previous === null || previous.reasonError === null ? previous : { ...previous, reasonError: null },
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (isReasonBlank) {
      setRefusal({ reasonError: REASON_REQUIRED_MESSAGE, notice: BLANK_REASON_NOTICE, backToBrowse: false });
      return;
    }

    setRefusal(null);
    setIsSubmitting(true);

    let applied: ModerationOutcome | null = null;
    try {
      const result = await moderateListing(props.listingId, { action, reason: reason.trim() });
      applied = {
        status: result.status,
        eventId: result.event === null || result.event.id === "" ? null : result.event.id,
      };
      setOutcome(applied);
      setReason("");
    } catch (error) {
      setRefusal(describeRefusal(error));
    } finally {
      setIsSubmitting(false);
    }

    // The page's own callback runs outside the block above: a defect in it belongs to the page
    // rather than being reported to the operator as a refused moderation action.
    if (applied !== null) {
      props.onStatusChanged?.(applied.status);
    }
  };

  return (
    <form className="moderation-actions" onSubmit={handleSubmit}>
      <p className="field__hint">
        Current status: <strong>{LISTING_STATUS_LABELS[displayedStatus]}</strong>
      </p>

      <fieldset className="field">
        <legend className="field__label">Moderation action</legend>
        <div className="field__group">
          {MODERATION_ACTIONS.map(
            (candidate: ModerationAction): JSX.Element => (
              <label key={candidate}>
                <input
                  type="radio"
                  name={actionGroupName}
                  value={candidate}
                  checked={candidate === action}
                  onChange={(): void => handleActionChange(candidate)}
                  aria-describedby={meaningId(candidate)}
                />
                <span>{MODERATION_ACTION_INFO[candidate].label}</span>
              </label>
            ),
          )}
        </div>
        <ul className="item-list">
          {MODERATION_ACTIONS.map(
            (candidate: ModerationAction): JSX.Element => (
              <li className="item-list__item" key={candidate}>
                <strong>{MODERATION_ACTION_INFO[candidate].label}</strong>{" "}
                <span id={meaningId(candidate)}>{MODERATION_ACTION_INFO[candidate].summary}</span>
              </li>
            ),
          )}
        </ul>
      </fieldset>

      <div className={reasonError === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={reasonId}>
          Reason (required)
        </label>
        <textarea
          id={reasonId}
          rows={3}
          value={reason}
          onChange={handleReasonChange}
          aria-required="true"
          aria-invalid={reasonError !== null}
          aria-describedby={reasonError === null ? reasonHintId : `${reasonHintId} ${reasonErrorId}`}
        />
        <p className="field__hint" id={reasonHintId}>
          Recorded with the governance event the action appends, which is never edited.
        </p>
        {reasonError === null ? null : (
          <p className="field__error" id={reasonErrorId}>
            {reasonError}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="button button--destructive"
        disabled={isSubmitting || isReasonBlank}
        aria-busy={isSubmitting}
        aria-describedby={submitHint === "" ? undefined : submitHintId}
      >
        {isSubmitting ? "Applying the action…" : "Apply the action"}
      </button>
      {submitHint === "" ? null : (
        <p className="field__hint" id={submitHintId}>
          {submitHint}
        </p>
      )}

      {/* The region is mounted with the panel and only its content changes, so the node exists
          before the status it announces does. role="status" is the polite live region, stated
          once here rather than declared twice by an aria-live attribute beside it. */}
      <div className="status-region" role="status">
        {refusal !== null ? (
          <div className="notice notice--error">
            <p>{refusal.notice}</p>
            {refusal.backToBrowse ? (
              <p>
                <Link to="/listings">Browse the listings</Link>
              </p>
            ) : null}
          </div>
        ) : outcome === null ? null : (
          <p className="notice notice--success">{describeOutcome(outcome)}</p>
        )}
      </div>
    </form>
  );
}

