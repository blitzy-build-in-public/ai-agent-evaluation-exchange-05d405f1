/**
 * One search result, rendered as a card: the listing's identity, the provenance of its latest
 * evaluation, the terms it is offered under and the control that adds it to a comparison.
 *
 * Three properties of this component are deliberate.
 *
 * It presents one `ListingSummary` and derives nothing. Nothing is fetched — `api-client.ts` is
 * the only module that calls the API — and nothing is synthesised: a limitation that is absent,
 * or present and empty, is omitted rather than invented or left as a label over nothing; an
 * absent report is the `No SGI report yet` state of `@adem/shared` rather than an error; and a
 * `FAIL` outcome is shown with the same shape as a `PASS`. No badge is rendered here on purpose:
 * a badge is issued on `PASS` alone and belongs to the listing page, beside the per-case evidence
 * it summarises, so rendering it in a card would produce a silent, unexplained absence on every
 * `FAIL`.
 *
 * The comparison selection lives in the address bar, in the `ids` parameter the compare route
 * reads, rather than in a store of its own: this card reads that parameter and writes it back, so
 * two cards and the compare page agree without a shared module, and a copied address reproduces
 * the selection in a fresh tab.
 *
 * At `COMPARE_MAX_IDS` the control is disabled and states why. Replacing an identifier to make
 * room for a fifth would silently change the comparison the reader is already looking at, and a
 * disabled control with no explanation is a dead end; removing an identifier is never blocked, so
 * a selection below `COMPARE_MIN_IDS` is the compare page's own prompt to add another.
 */
import { Link, useSearchParams } from "react-router-dom";
import {
  COMPARE_ID_SEPARATOR,
  COMPARE_MAX_IDS,
  COMPARE_MIN_IDS,
  NO_REPORT_LABEL,
} from "@adem/shared";
import type { ListingSummary, ReportLabel, ReportOutcome } from "@adem/shared";

import { describePricingModel } from "../labels";

/**
 * Props for {@link ListingCard}. One card is one search result, so the component takes the
 * summary and nothing else: the page owns the list, the ordering and the paging.
 */
export interface ListingCardProps {
  /** One search result, as returned by `GET /listings`. */
  readonly listing: ListingSummary;
}

/**
 * The compare query's identifier parameter, spelled exactly as `GET /compare?ids=a,b,c` and the
 * compare route's query schema spell it. The separator and the two bounds are `@adem/shared`
 * constants; the parameter's own name has no constant there, so it is named once, here, because
 * this card is a writer of it.
 */
const COMPARE_IDS_PARAMETER = "ids";

/**
 * The value the version row carries when the listing has published no version, in the compact form
 * this card's meta list uses.
 *
 * The API states `version_string: ""` for that state — `toListingSummary` in the listings route
 * returns an empty string where the row holds SQL `NULL` — so rendering the value as received would
 * leave the row's own label sitting over nothing. The row is kept and its value stated in words,
 * which is the treatment `../pages/developer` gives the same value in its summary row; only the
 * spelling differs, because this row is one item of a compact list rather than a sentence of its
 * own.
 */
const NO_VERSION_NOTE = "none published yet";

/** Whether a published value carries text, so a whitespace-only one counts as absent too. */
function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * The outcome and the provenance of the latest report, as text in one row. Both values of the one
 * report render in the same chip — its outcome in the tint of the direction it recorded, its label
 * in the neutral tint a disclosure uses — so the two are read as values of one kind and the label
 * never reads as an outcome.
 */
function renderReportEvidence(
  outcome: ReportOutcome,
  standardVersionId: string,
  label: ReportLabel,
): JSX.Element {
  const outcomeModifier = outcome === "PASS" ? "chip--pass" : "chip--fail";

  return (
    <p className="listing-card__meta">
      <span className={`chip ${outcomeModifier}`}>{`Outcome: ${outcome}`}</span>
      <span>
        Standard version: <span className="listing-card__standard">{standardVersionId}</span>
      </span>
      <span className="chip chip--label">{`Label: ${label}`}</span>
    </p>
  );
}

/** The state of a version that has never been evaluated, in the same slot as the evidence. */
function renderNoReport(): JSX.Element {
  return <p className="listing-card__no-report">{NO_REPORT_LABEL}</p>;
}

/**
 * One listing as a card. The listing's title is a link to `/listings/{id}`, which is what makes
 * the detail route reachable by navigation from a results list, and the compare control is a real
 * `<button>` so it is operable by keyboard and reports its pressed state.
 */
export function ListingCard(props: ListingCardProps): JSX.Element {
  const listing = props.listing;
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedIds = (searchParams.get(COMPARE_IDS_PARAMETER) ?? "")
    .split(COMPARE_ID_SEPARATOR)
    .filter((id: string): boolean => id !== "");
  const isSelected = selectedIds.includes(listing.id);
  const atLimit = !isSelected && selectedIds.length >= COMPARE_MAX_IDS;
  const limitNoticeId = `listing-card-compare-limit-${listing.id}`;

  const outcome: ReportOutcome | null = listing.outcome;
  const standardVersionId: string | null = listing.standard_version_id;
  const reportLabel: ReportLabel | null = listing.label;
  const limitation: string = listing.limitation ?? "";
  const compareActionLabel = isSelected ? "Remove from compare" : "Add to compare";
  // The link opens the comparison the reader has made, so it carries the selection — but only
  // while that selection is one the compare contract accepts: a single identifier is refused
  // with 400 there, and the page's own prompt to add another is the better answer.
  const comparisonPath =
    selectedIds.length >= COMPARE_MIN_IDS && selectedIds.length <= COMPARE_MAX_IDS
      ? `/compare?${COMPARE_IDS_PARAMETER}=${selectedIds.join(COMPARE_ID_SEPARATOR)}`
      : "/compare";

  function handleCompareToggle(): void {
    const nextIds = isSelected
      ? selectedIds.filter((id: string): boolean => id !== listing.id)
      : [...selectedIds, listing.id];
    const next = new URLSearchParams(searchParams);

    // The absent parameter is the "nothing selected" state. An empty `ids=` would be a single
    // empty token, which the compare contract refuses as a malformed selection.
    if (nextIds.length === 0) {
      next.delete(COMPARE_IDS_PARAMETER);
    } else {
      next.set(COMPARE_IDS_PARAMETER, nextIds.join(COMPARE_ID_SEPARATOR));
    }

    setSearchParams(next);
  }

  return (
    <article className="listing-card">
      <h3 className="listing-card__title">
        <Link to={`/listings/${listing.id}`}>{listing.title}</Link>
      </h3>
      <p>{listing.summary}</p>
      <p className="listing-card__meta">
        <span>{`Category: ${listing.category.name}`}</span>
        <span>{`Developer: ${listing.developer_handle}`}</span>
        <span>{`Pricing model: ${describePricingModel(listing.pricing_model)}`}</span>
        <span>{`License: ${listing.license_code}`}</span>
        <span>
          Version:{" "}
          <span className="listing-card__version">
            {hasText(listing.version_string) ? listing.version_string : NO_VERSION_NOTE}
          </span>
        </span>
      </p>
      {outcome === null || standardVersionId === null || reportLabel === null
        ? renderNoReport()
        : renderReportEvidence(outcome, standardVersionId, reportLabel)}
      {limitation === "" ? null : (
        <p className="listing-card__limitations">{`Stated limitation: ${limitation}`}</p>
      )}
      <div className="listing-card__actions">
        <button
          type="button"
          className="button button--secondary listing-card__compare"
          aria-pressed={isSelected}
          aria-label={`${compareActionLabel}: ${listing.title}`}
          disabled={atLimit}
          aria-describedby={atLimit ? limitNoticeId : undefined}
          onClick={handleCompareToggle}
        >
          {compareActionLabel}
        </button>
        <Link to={comparisonPath}>Open the comparison</Link>
      </div>
      {atLimit ? (
        <p className="listing-card__meta" id={limitNoticeId}>
          {`Compare holds at most ${COMPARE_MAX_IDS} listings; remove one to add this one.`}
        </p>
      ) : null}
      {isSelected && selectedIds.length < COMPARE_MIN_IDS ? (
        <p className="listing-card__meta">
          {`A comparison needs at least ${COMPARE_MIN_IDS} listings; add one more to open it.`}
        </p>
      ) : null}
    </article>
  );
}

// Both forms are exported on purpose: the named export is the component's public name and the
// default export lets a page import the card either way.
export default ListingCard;
