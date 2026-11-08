/**
 * The offer selector and the simulated checkout: the surface a buyer uses to name one of the
 * offer models a listing makes and to record a simulated transaction against it.
 *
 * Four decisions here are deliberate, and each is easy to undo by accident.
 *
 * **The amount belongs to the service, never to this component.** The request carries the
 * listing, the version and the selected offer model and nothing else: no price field, no
 * quantity, no token. This file therefore holds no price constant and computes no arithmetic,
 * and an amount is rendered only from the `Transaction` the service returned — so the figure a
 * buyer reads and the figure the ledger records cannot drift apart. What the simulation will
 * charge is deliberately not shown before the request: no price source exists on this side of
 * the wire, and inventing one would create a second definition of the amount.
 *
 * **Every amount renders three things together**: the count of whole minor units, the currency
 * label the transaction carries, and the disclosure label it carries beside it. Both labels are
 * read from the response rather than from a constant held here, because the service is the one
 * place they are decided. A currency symbol and a real currency code appear nowhere in this
 * file, not even in a comment, and no locale formatter renders a number: the integer is rendered
 * as it stands.
 *
 * **Nothing here can buy or charge anything, and no surface of this component may read as if it
 * could.** The only inputs are the offer radios: no field a real checkout would ask for exists,
 * and no provider is named. The panel states in its own copy, before the click and in the
 * confirmation after it, that the transaction is simulated and nonfunctional and that no money
 * moves.
 *
 * **Only the models the listing makes are offered.** The radios are built by taking the offer
 * vocabulary's own order and keeping the models the listing makes, so an offer model the listing
 * does not make cannot be selected through the interface at all and the contract's `422` stays
 * what it is meant to be — the guard for a page held open while a listing changed underneath it.
 * A listing that makes no offer renders an explanation in place of the radio group, never an
 * empty control.
 *
 * The panel is presentation and one request. It calls `createCheckoutSimulation` and nothing
 * else, writes nothing to storage, holds no state beyond the four it declares, and renders no
 * commercial internal — a gate fee, a ledger entry or an allocation rate belongs to the operator
 * surfaces, and a buyer reading them would couple this view to them.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { createCheckoutSimulation } from "../api-client";
import { readWriteFailure } from "../payload-reading";
import type { WriteFailureFacts } from "../payload-reading";
import { OFFER_MODELS, SYNTHETIC_CURRENCY_LABEL } from "@adem/shared";
import type { OfferModel, Transaction } from "@adem/shared";

/**
 * Props for {@link CheckoutPanel}. The panel takes the identity it is buying against and the
 * offers the listing makes, and nothing else: it reads no price, because no price reaches the
 * client, and it owns no part of the page's state.
 */
export interface CheckoutPanelProps {
  /** The listing being bought from. */
  readonly listingId: string;
  /** The listing version the simulated transaction is against. */
  readonly listingVersionId: string;
  /** Exactly the offer models this listing makes — from ListingDetail.offer_models. */
  readonly offerModels: readonly OfferModel[];
}

/** The prefix of the radio group's `name`, which each panel instance completes for itself. */
const OFFER_GROUP_NAME_PREFIX = "checkout-offer";

/**
 * The readable name of each offer model. Typed as a total `Record` over the vocabulary, so a
 * fifth model would fail the build here rather than render as a bare identifier in the radio
 * group.
 */
const OFFER_MODEL_LABELS: Readonly<Record<OfferModel, string>> = Object.freeze({
  rent: "Rent",
  purchase: "Purchase",
  license: "License",
  subscription: "Subscription",
});

/** The readable name of one offer model. */
function describeOfferModel(model: OfferModel): string {
  return OFFER_MODEL_LABELS[model];
}

/**
 * The refusal the panel raises for itself when a submit arrives with no offer selected. It is
 * stated in the service's own terms — a `400` carrying `validation_error` — so that the
 * explanation a reader sees is the same shape whichever side refused the attempt, while the
 * request is never sent.
 */
const NO_OFFER_SELECTED_FAILURE: WriteFailureFacts = Object.freeze({
  status: 400,
  code: "validation_error",
  message: "No offer model was selected, so no simulated transaction was created.",
  retryAfterSeconds: null,
});

/**
 * The next step offered for a failure, chosen by the status the service answered with. Every
 * branch says what happened and what to do about it, in plain words, and no branch shows a
 * status code, a stack trace or a response body.
 */
function describeNextStep(facts: WriteFailureFacts): string {
  switch (facts.status) {
    case 400:
      return "Choose one of the offer models this listing makes, then run the simulated checkout again.";
    case 401:
      return "Choose a demo account in the demo account switcher, then run the simulated checkout again. A demo account separates roles for this demonstration; it is not a login, and clearing the selection is not a sign-out.";
    case 403:
      return "Only a demo account with the buyer role can run a simulated checkout. Switch to a buyer account, then try again.";
    case 404:
      return "This listing, or the version shown, is no longer available. Reload the listing page to read what the developer publishes now.";
    case 422:
      return "No simulated transaction was created. Choose one of the offer models shown above, then try again.";
    case 429:
      return facts.retryAfterSeconds === null
        ? "This client has sent the maximum number of writes allowed in a minute. Wait for the window to pass, then try again; reading is unaffected."
        : `This client has sent the maximum number of writes allowed in a minute. Wait ${facts.retryAfterSeconds} seconds, then try again; reading is unaffected.`;
    case 0:
      return "Nothing was recorded by this attempt. Check that the service is running, then try again.";
    default:
      return "Nothing was recorded by this attempt. Review the selection, then try again.";
  }
}

/**
 * The explanation a reader sees for a failed checkout: the sentence the service sent, followed
 * by the next step for its status. A thrown value that carries no status — or none at all — is
 * still explained rather than rendered as it stands.
 */
function describeFailure(error: unknown): string {
  const facts = readWriteFailure(error);

  if (facts === null) {
    return "The simulated checkout could not be completed, and nothing was recorded. Try again.";
  }

  const nextStep = describeNextStep(facts);

  // A failure is read only when its sentence is non-blank, so the next step alone below stands for
  // facts a caller hands in by other means.
  return facts.message === "" ? nextStep : `${facts.message} ${nextStep}`;
}

/**
 * The offer selector and the simulated checkout.
 *
 * One outcome is shown and announced at a time: each submit clears the previous result, so the
 * live region never carries a confirmation and a refusal at once and a reader is never left
 * deciding which of the two describes the attempt they just made.
 */
export function CheckoutPanel(props: CheckoutPanelProps): JSX.Element {
  // The vocabulary's own order, filtered to the models this listing makes, so the same offers
  // always read in the same order, a repeated model renders one radio rather than two controls
  // sharing a name, and a value outside the vocabulary is dropped rather than rendered.
  const offeredModels: readonly OfferModel[] = OFFER_MODELS.filter((model: OfferModel): boolean =>
    props.offerModels.includes(model),
  );

  const [selectedModel, setSelectedModel] = useState<OfferModel | "">(offeredModels[0] ?? "");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);

  // A panel can outlive the listing it was mounted for when the router swaps one listing for
  // another, so a selection is honoured only while the listing on screen still makes it. Falling
  // back to the first offer the listing makes keeps the control and the submitted model in step
  // without an effect and without a selection the service would refuse.
  const effectiveModel: OfferModel | "" =
    selectedModel !== "" && offeredModels.includes(selectedModel)
      ? selectedModel
      : (offeredModels[0] ?? "");

  // One group name per listing version, so two panels rendered on one page — a listing column and
  // a comparison column — are two independent radio groups rather than one.
  const groupName = `${OFFER_GROUP_NAME_PREFIX}-${props.listingVersionId}`;
  const offerHintId = `${groupName}-hint`;
  const busyHintId = `${groupName}-busy`;
  const isDisabled = isSubmitting || effectiveModel === "";

  function handleModelChange(model: OfferModel): void {
    setSelectedModel(model);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setTransaction(null);

    if (effectiveModel === "") {
      setError(NO_OFFER_SELECTED_FAILURE);
      setIsSubmitting(false);
      return;
    }

    try {
      const created = await createCheckoutSimulation({
        listing_id: props.listingId,
        listing_version_id: props.listingVersionId,
        offer_model: effectiveModel,
      });
      setTransaction(created);
    } catch (failure: unknown) {
      setError(failure);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="checkout-panel" aria-label="Simulated checkout">
      <p className="notice notice--warning checkout-panel__disclosure">
        This is a simulated, nonfunctional checkout. No money moves, nothing is charged and no real
        currency is involved; the transaction is recorded in this local demonstration only, and its
        amount is set by the simulation from the offer model rather than entered by you.
      </p>

      {offeredModels.length === 0 ? (
        <p className="field__hint">
          This listing makes no offer, so there is nothing to check out. The offer models a
          developer makes are listed on the listing page.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset className="field" aria-describedby={offerHintId}>
            <legend className="field__label">Select an offer</legend>
            <p className="field__hint" id={offerHintId}>
              {`Only the offer models this listing makes are listed. Amounts are whole minor units of the synthetic currency ${SYNTHETIC_CURRENCY_LABEL}, and the amount of a transaction is set by the simulation rather than entered here.`}
            </p>
            <div className="field__group">
              {offeredModels.map((model: OfferModel) => (
                <label key={model}>
                  <input
                    type="radio"
                    name={groupName}
                    value={model}
                    checked={effectiveModel === model}
                    onChange={(): void => handleModelChange(model)}
                  />
                  <span>{describeOfferModel(model)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            className="button button--primary"
            disabled={isDisabled}
            aria-busy={isSubmitting}
            aria-describedby={isSubmitting ? busyHintId : offerHintId}
          >
            {isSubmitting ? "Running the simulated checkout" : "Run simulated checkout"}
          </button>

          {isSubmitting ? (
            <p className="field__hint" id={busyHintId}>
              The simulated checkout is running. Its result appears below as soon as the service
              answers.
            </p>
          ) : null}
        </form>
      )}

      {/* role="status" is the polite live region, and aria-live states it plainly so the region a
          reader is told about is the one the markup declares. The node exists from the first
          render and only its content changes, which is what makes the announcement reliable. */}
      <div className="status-region" role="status" aria-live="polite">
        {error === null ? null : <p className="notice notice--error">{describeFailure(error)}</p>}

        {transaction === null ? null : (
          <div className="notice notice--success">
            <p>
              <strong>Simulated transaction recorded.</strong> Nothing was bought and nothing was
              delivered: the simulation recorded a transaction, and no money moved.
            </p>
            <dl>
              <dt>Transaction</dt>
              <dd>
                <code>{transaction.id}</code>
              </dd>
              <dt>Offer model</dt>
              <dd>{describeOfferModel(transaction.offer_model)}</dd>
              <dt>Amount, in whole minor units</dt>
              <dd>
                <span className="checkout-panel__amount">
                  {`${transaction.amount_minor_units} ${transaction.currency_label}`}
                </span>
                {` ${transaction.disclosure_label}`}
              </dd>
              {/* The marker is rendered from the response rather than asserted in copy: the
                  transaction the service recorded says for itself that it is simulated. */}
              <dt>Recorded by the service as</dt>
              <dd>
                <code>{`simulated: ${String(transaction.simulated)}`}</code>
              </dd>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
