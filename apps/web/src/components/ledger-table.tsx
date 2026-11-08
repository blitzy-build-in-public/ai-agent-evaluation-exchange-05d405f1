/**
 * The operator's ledger view: one of the three append-only ledgers, read in the order its entries were
 * appended, with the refund action that appends a reversal entry rather than editing anything.
 *
 * Rendering only, with one write. The component fetches nothing — the caller owns the read and hands
 * the result in — derives nothing from the data beyond the labels it prints, and holds no state
 * outside the refund field: the order the read returned is the ledger's history, and an amount is the
 * whole minor-unit count of the synthetic currency the entry itself names, beside the disclosure
 * label stored with it.
 *
 * The founder-allocation view states that its contract structure is undecided and shows the rate its
 * recorded entries were computed from. No view here names a person, an account, a beneficiary or an
 * entitlement.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, RefObject } from "react";
import { refundTransaction } from "../api-client";
import { FOUNDER_ALLOCATION_CONTRACT_LABEL, SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";
import type {
  FounderAllocationLedgerReadResult,
  LedgerEntry,
  LedgerName,
  LedgerReadResult,
} from "@adem/shared";

/** The ledger named in words, as the heading of its view. */
const LEDGER_HEADINGS: Readonly<Record<LedgerName, string>> = Object.freeze({
  marketplace: "Marketplace ledger",
  gate_fees: "Gate-fee ledger",
  founder_allocation: "Founder-allocation ledger",
});

/** The labels of an entry's label/value pairs: every value stands beside the label naming it. */
const ENTRY_TYPE_LABEL = "Entry type";
const DIRECTION_LABEL = "Direction";
const AMOUNT_LABEL = "Amount";
const DISCLOSURE_LABEL = "Disclosure";
const DESCRIPTION_LABEL = "What it records";
const TRANSACTION_LABEL = "Transaction";
const REPORT_LABEL = "Report";
const RECORDED_LABEL = "Recorded";
const RATE_ROW_LABEL = "Rate applied to these recorded entries, in basis points";

/**
 * The founder-allocation view's statement of the undecided contract structure, and of the one thing
 * this ledger does not carry: an identity, an account or an entitlement.
 */
const FOUNDER_ALLOCATION_NOTE =
  "The founder-participation contract structure is " +
  FOUNDER_ALLOCATION_CONTRACT_LABEL +
  ". This ledger records a share computed from eligible completed simulated marketplace transactions, and it carries no personal identity, a beneficiary account or an entitlement.";

/** What a ledger with nothing recorded says, in place of a list with no rows. */
const EMPTY_LEDGER_NOTE =
  "No entries have been recorded in this ledger yet. An entry is appended as it happens, and an existing entry is never edited.";

/** Rendered in place of a stored field that carries no text, so no value is rendered blank. */
const NO_DESCRIPTION_NOTE = "no description was recorded for this entry";
const NO_DISCLOSURE_LABEL_NOTE = "no disclosure label was recorded beside this amount";

/** The refund block: its heading, the appending rule it explains, and the field it owns. */
const REFUND_HEADING = "Refund a simulated transaction";
const REFUND_NOTE =
  "A refund appends reversal entries and edits nothing: the transaction, its allocation and every earlier entry stay exactly as they were, and what remains refundable is read from the entries.";
const REFUND_SUMMARY_PREFIX = "Refund transaction";
const REFUND_BUTTON_LABEL = "Refund this transaction";
const AMOUNT_FIELD_LABEL = "Refund amount, in minor units of " + SYNTHETIC_CURRENCY_LABEL;
const AMOUNT_FIELD_HINT =
  "A positive whole number of minor units of the synthetic currency " +
  SYNTHETIC_CURRENCY_LABEL +
  " — the transaction's own amount, for example. No currency symbol and no real currency code appears anywhere in this simulation.";

/** The sentences a refused refund is explained with, one per way the refund route can answer. */
const REFUND_AMOUNT_GUARD_MESSAGE =
  "Enter a positive whole number of minor units of " +
  SYNTHETIC_CURRENCY_LABEL +
  ". A refund of zero leaves nothing to reverse, and a fractional amount cannot be expressed in minor units.";
const REFUND_INVALID_AMOUNT_MESSAGE =
  "The refund was refused as not a valid positive whole number of minor units of " +
  SYNTHETIC_CURRENCY_LABEL +
  ". Enter a positive whole number, for example the transaction's own amount.";
const REFUND_UNAUTHORIZED_MESSAGE =
  "No demo account is selected, or the selected one could not be recognised, so the refund was not accepted. Choose the operator account in the demo-account switcher in the page header, then try again.";
const REFUND_FORBIDDEN_MESSAGE =
  "The selected demo account is not the operator, and only the operator role records a refund. Choose the operator account in the demo-account switcher in the page header, then try again.";
const REFUND_NOT_FOUND_MESSAGE =
  "No simulated transaction carries that identifier, so there is nothing to refund. Re-read the ledger and refund the transaction its entries name.";
const REFUND_ALREADY_REFUNDED_MESSAGE =
  "This transaction is already fully refunded, so nothing remains to refund and no further refund can be made for it. The reversal entries its earlier refunds appended are in the ledger above.";
const REFUND_EXCEEDS_REMAINING_MESSAGE =
  "The amount is more than this transaction's net remaining, which is its amount minus the refunds already recorded against it, so every refund shrinks it. Enter an amount within what remains.";
const REFUND_THROTTLED_MESSAGE =
  "This client has sent the maximum number of writes allowed in a minute, so the refund was not sent.";
const REFUND_UNREACHABLE_MESSAGE =
  "The service could not be reached, so no refund was sent. Check that the API is running, then try again.";
const REFUND_FAILED_MESSAGE = "The refund could not be completed. Wait a moment, then try again.";

/**
 * Props for {@link LedgerTable}.
 */
export interface LedgerTableProps {
  /** Which ledger this view shows; drives the founder-allocation extras. */
  readonly ledger: LedgerName;
  /** The read result from `listLedger` for this ledger, its entries in insertion order. */
  readonly result: LedgerReadResult | FounderAllocationLedgerReadResult;
  /**
   * Optional callback run after a refund succeeds, so the caller can re-read the ledger and show the
   * appended reversal entries. A caller with nothing to re-read must OMIT the property rather than
   * pass `undefined`, because `exactOptionalPropertyTypes` is enabled in this workspace.
   */
  readonly onRefunded?: () => void;
}

/**
 * One ledger's entries in the order they were appended, with the refund form for every transaction
 * those entries name.
 *
 * The entries are per-entry blocks of label/value pairs rather than one wide table: the column set —
 * an entry type, a direction, an amount with the synthetic currency label and a disclosure sentence,
 * a description, a transaction or report reference and a timestamp — is far too wide to reflow, and a
 * table carrying it would be unreadable at 360 px where every value has to stay beside the label that
 * names it and the page must not scroll sideways.
 */
export function LedgerTable(props: LedgerTableProps): JSX.Element {
  const instanceId = useId();
  const headingId = instanceId + "-heading";
  const entries = props.result.entries;
  const isFounderLedger = props.ledger === "founder_allocation";
  // The rate comes from the read result and never from the commerce configuration: the ledger reports
  // the rate each recorded entry was computed from, and today's configured rate shown against
  // entries computed with another would misreport what the ledger holds.
  const founderRate =
    isFounderLedger && "rate_basis_points" in props.result ? props.result.rate_basis_points : null;
  const transactionIds = refundableTransactionIds(entries);

  return (
    <section className="ledger-table" aria-labelledby={headingId}>
      <h3 id={headingId}>{LEDGER_HEADINGS[props.ledger]}</h3>

      {isFounderLedger ? <p className="ledger-table__note">{FOUNDER_ALLOCATION_NOTE}</p> : null}

      {founderRate === null || entries.length === 0 ? null : (
        <p className="ledger-table__note">
          {RATE_ROW_LABEL}: <strong>{founderRate}</strong>
        </p>
      )}

      {entries.length === 0 ? <p className="ledger-table__note">{EMPTY_LEDGER_NOTE}</p> : null}

      {/* Rendered exactly as received: the ledger's history is its meaning, so nothing here sorts,
          groups or paginates the entries, and an appended reversal stays after the entry it
          reverses. One refund form per distinct transaction follows, in first-appearance order. */}
      {renderEntries(entries)}

      {transactionIds.length === 0 ? null : (
        <>
          <h4>{REFUND_HEADING}</h4>
          <p className="ledger-table__note">{REFUND_NOTE}</p>
          {transactionIds.map(
            (transactionId: string): JSX.Element => (
              <details key={transactionId}>
                <summary>
                  {REFUND_SUMMARY_PREFIX}{" "}
                  <span className="ledger-table__identifier">{transactionId}</span>
                </summary>
                <RefundForm transactionId={transactionId} onRefunded={props.onRefunded} />
              </details>
            ),
          )}
        </>
      )}
    </section>
  );
}

/** Props for {@link RefundForm}: the transaction being refunded, and the caller's re-read hook. */
interface RefundFormProps {
  readonly transactionId: string;
  /**
   * Run after a refund succeeds. Typed with an explicit `| undefined` rather than as optional, so the
   * caller's own omitted optional prop passes through as it stands.
   */
  readonly onRefunded: (() => void) | undefined;
}

/**
 * The refund form for one simulated transaction: the amount in minor units, the explanation of
 * whatever refused it, and a polite announcement of the outcome.
 *
 * Nothing here edits anything. The route appends reversal entries, and its refusals are rendered as
 * reasons a reader can act on rather than as a status code.
 */
function RefundForm(props: RefundFormProps): JSX.Element {
  const fieldId = useId();
  const amountFieldId = fieldId + "-amount";
  const hintId = fieldId + "-hint";
  const errorId = fieldId + "-error";
  const inputRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState<string>("");
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<unknown | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const errorText = amountError ?? (refusal === null ? null : describeRefundFailure(refusal));
  useReturnFocusOnError(inputRef, errorText);

  const handleAmountChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setAmount(event.target.value);
    setAmountError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const minorUnits = parseRefundAmount(amount);
    if (minorUnits === null) {
      setRefusal(null);
      setOutcome(null);
      setAmountError(REFUND_AMOUNT_GUARD_MESSAGE);
      return;
    }

    setAmountError(null);
    setRefusal(null);
    setOutcome(null);
    setInFlight(true);
    try {
      const reversals = await refundTransaction(props.transactionId, {
        amount_minor_units: minorUnits,
      });
      setAmount("");
      setOutcome(describeRefundOutcome(reversals));
      props.onRefunded?.();
    } catch (thrown: unknown) {
      setRefusal(thrown);
    } finally {
      setInFlight(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className={errorText === null ? "field" : "field field--error"}>
        <label className="field__label" htmlFor={amountFieldId}>
          {AMOUNT_FIELD_LABEL}
        </label>
        <p className="field__hint" id={hintId}>
          {AMOUNT_FIELD_HINT}
        </p>
        {/* The amount is held to a positive whole number before anything is sent: the shared refund
            body schema permits 0, so zero is refused in the field rather than sent for the domain to
            reject, and a fractional amount cannot be expressed in minor units at all. The form turns
            off native validation so this sentence, tied to the field, is the explanation a reader
            gets rather than a browser bubble the rest of the UI never shows. */}
        <input
          ref={inputRef}
          className="field__input"
          id={amountFieldId}
          name="amount_minor_units"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={amount}
          onChange={handleAmountChange}
          aria-invalid={errorText === null ? undefined : true}
          aria-describedby={errorText === null ? hintId : hintId + " " + errorId}
        />
        {errorText === null ? null : (
          <p className="field__error" id={errorId}>
            {errorText}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="button button--destructive"
        disabled={inFlight || amount.trim() === ""}
        aria-busy={inFlight}
      >
        {REFUND_BUTTON_LABEL}
      </button>

      <div className="status-region" role="status">
        {outcome === null ? null : <p className="notice notice--success">{outcome}</p>}
      </div>
    </form>
  );
}

/** One label/value block per entry, in the order the read returned and never re-ordered. */
function renderEntries(entries: readonly LedgerEntry[]): JSX.Element[] {
  return entries.map(
    (entry: LedgerEntry): JSX.Element => (
      <article key={entry.id}>
        <dl>
          <dt>{ENTRY_TYPE_LABEL}</dt>
          <dd>{entry.entry_type}</dd>
          <dt>{DIRECTION_LABEL}</dt>
          <dd>{entry.direction}</dd>
          <dt>{AMOUNT_LABEL}</dt>
          <dd className="ledger-table__amount">
            {entry.amount_minor_units} {entry.currency_label}
          </dd>
          <dt>{DISCLOSURE_LABEL}</dt>
          <dd className="ledger-table__note">
            {hasText(entry.disclosure_label) ? entry.disclosure_label : NO_DISCLOSURE_LABEL_NOTE}
          </dd>
          <dt>{DESCRIPTION_LABEL}</dt>
          <dd>{hasText(entry.description) ? entry.description : NO_DESCRIPTION_NOTE}</dd>
          {entry.transaction_id === null ? null : (
            <>
              <dt>{TRANSACTION_LABEL}</dt>
              <dd className="ledger-table__identifier">{entry.transaction_id}</dd>
            </>
          )}
          {entry.report_id === null ? null : (
            <>
              <dt>{REPORT_LABEL}</dt>
              <dd className="ledger-table__identifier">{entry.report_id}</dd>
            </>
          )}
          <dt>{RECORDED_LABEL}</dt>
          <dd>{entry.created_at}</dd>
        </dl>
      </article>
    ),
  );
}

/**
 * The distinct transactions the entries reference, in the order they first appear.
 *
 * A charge, the allocation computed from it and the reversals of either all name the same
 * transaction, so one refund form per transaction is the honest grouping; the order is the entries'
 * own.
 */
function refundableTransactionIds(entries: readonly LedgerEntry[]): string[] {
  const seen = new Set<string>();
  const transactionIds: string[] = [];
  for (const entry of entries) {
    const transactionId = entry.transaction_id;
    if (transactionId !== null && !seen.has(transactionId)) {
      seen.add(transactionId);
      transactionIds.push(transactionId);
    }
  }
  return transactionIds;
}

/** Whether a stored field carries text, so an empty one is explained rather than rendered blank. */
function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * The amount a refund field holds, as whole minor units of the synthetic currency, or `null` when it
 * is not a positive integer: the entry has to be nothing but digits, so a fractional amount, a sign
 * and an exponent are all refused, and a value beyond the safe integer range cannot be reversed
 * exactly.
 */
function parseRefundAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.replace(/[0-9]/g, "") !== "") {
    return null;
  }
  const minorUnits = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(minorUnits) && minorUnits > 0 ? minorUnits : null;
}

/** The status a failure carries, or `0` when it carries none — the client's code for no response. */
function statusOf(failure: unknown): number {
  if (typeof failure !== "object" || failure === null) {
    return 0;
  }
  const status = (failure as { readonly status?: unknown }).status;
  return typeof status === "number" ? status : 0;
}

/** The `Retry-After` whole seconds a throttled failure carries, or `null` when it states none. */
function retryAfterSecondsOf(failure: unknown): number | null {
  if (typeof failure !== "object" || failure === null) {
    return null;
  }
  const seconds = (failure as { readonly retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof seconds === "number" && Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

/**
 * The sentence a refused refund is explained with: the reason in plain language and the next step,
 * never a status code, a response body, a URL or a stack trace.
 */
function describeRefundFailure(failure: unknown): string {
  switch (statusOf(failure)) {
    case 400:
      return REFUND_INVALID_AMOUNT_MESSAGE;
    case 401:
      return REFUND_UNAUTHORIZED_MESSAGE;
    case 403:
      return REFUND_FORBIDDEN_MESSAGE;
    case 404:
      return REFUND_NOT_FOUND_MESSAGE;
    case 409:
      return REFUND_ALREADY_REFUNDED_MESSAGE;
    case 422:
      return REFUND_EXCEEDS_REMAINING_MESSAGE;
    case 429: {
      const seconds = retryAfterSecondsOf(failure);
      if (seconds === null) {
        return REFUND_THROTTLED_MESSAGE + " Wait, then try again.";
      }
      const unit = seconds === 1 ? "second" : "seconds";
      return REFUND_THROTTLED_MESSAGE + " Wait " + String(seconds) + " " + unit + ", then try again.";
    }
    case 0:
      return REFUND_UNREACHABLE_MESSAGE;
    default:
      return REFUND_FAILED_MESSAGE;
  }
}

/** The announcement of an accepted refund: how many reversal entries the route appended. */
function describeRefundOutcome(reversals: readonly LedgerEntry[]): string {
  const appended = reversals.length;
  if (appended === 0) {
    return "The refund was recorded, though the response carried no reversal entry to read. Re-read the ledger to see what it appended.";
  }
  if (appended === 1) {
    return "Refund recorded: 1 reversal entry was appended to the ledger. Nothing already recorded was edited or removed.";
  }
  return (
    "Refund recorded: " +
    String(appended) +
    " reversal entries were appended to the ledger. Nothing already recorded was edited or removed."
  );
}

/**
 * Returns focus to the amount field whenever its error text appears, so the explanation tied to the
 * field by `aria-describedby` is announced rather than only shown.
 */
function useReturnFocusOnError(input: RefObject<HTMLInputElement>, errorText: string | null): void {
  useEffect((): void => {
    if (errorText !== null) {
      input.current?.focus();
    }
  }, [input, errorText]);
}

