/**
 * The comparison: two to four listings side by side, each showing what its developer claims
 * beside the evidence that was actually measured.
 *
 * Three decisions a later reader could invert, and why they hold:
 *
 *   - Per-listing `<section>` blocks rather than one wide `<table>`. A comparison has to be
 *     readable at 360 px, where criterion 9 asserts no page-level horizontal scroll, and the
 *     stylesheet's `.compare-table` grid stacks these blocks into one reading column each below
 *     its `min-width: 48rem` breakpoint. A table wide enough for four listings at 360 px would have
 *     to be scrolled sideways to be read at all.
 *
 *   - Claims and measured evidence are two separately headed groups inside every block. Comparing
 *     a developer's assertions against what was measured is what this view is for, so the two are
 *     never merged into one undifferentiated list, and a claim is never rendered without the
 *     evidence summary stored beside it.
 *
 *   - The measured evidence is rendered as text, deliberately without the sample badge: a badge is
 *     a PASS-only artefact of the listing and report pages, and repeating it in a comparison
 *     column would overstate what the column shows.
 *
 * A comparison is all-or-nothing. `GET /compare?ids=...` answers `404` for an identifier that
 * names no listing and never answers `200` with a null column, so this component renders exactly
 * one block per entry it is given, in the order it is given, and never invents a placeholder
 * column for a listing it was not handed. An absent comparison is the page's state; this
 * component returns `null` for an empty entry list rather than explaining an absence a second
 * time.
 *
 * Presentation only. This module renders what it is given: it fetches nothing, holds no state,
 * reads no URL parameter, and derives nothing from the data beyond the labels it prints.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { NO_REPORT_LABEL } from "@adem/shared";
import type { CompareEntry, ListingClaim } from "@adem/shared";

/**
 * Props for {@link CompareTable}. Both members are readonly: the comparison is a rendering of the
 * payload it was given and never edits it.
 */
export interface CompareTableProps {
  /** One entry per requested listing, in request order, from `GET /compare`. */
  readonly entries: readonly CompareEntry[];
  /**
   * Optional per-listing footer, used by the compare page to render the inquiry form inside each
   * listing's own block. A caller that has nothing to add there must OMIT the property rather than
   * pass `undefined`, because `exactOptionalPropertyTypes` is enabled in this workspace.
   */
  readonly renderColumnFooter?: (entry: CompareEntry) => ReactNode;
}

/** The heading over a listing's claims — what its developer asserts about it. */
const CLAIMS_HEADING = "Claims";
/** The heading over a listing's measured evidence — what the standard actually recorded. */
const MEASURED_EVIDENCE_HEADING = "Measured evidence";
/** The heading over the limitations the listing's claims state, collected for scanning. */
const STATED_LIMITATIONS_HEADING = "Stated limitations";
/** The heading over how a listing is offered: its license and its pricing model. */
const OFFERING_HEADING = "Offering";

/** Row label for the license a listing is offered under. */
const LICENSE_ROW_LABEL = "License";
/** Row label for the pricing model a listing declares. */
const PRICING_MODEL_ROW_LABEL = "Pricing model";
/** Row label for the report the measured evidence is read from. */
const REPORT_ROW_LABEL = "Report";
/** Row label for a report's outcome, `PASS` or `FAIL`. */
const OUTCOME_ROW_LABEL = "Outcome";
/** Row label for the standard version a report was scored against. */
const STANDARD_VERSION_ROW_LABEL = "Standard version";
/** Row label for the report's label, `SAMPLE` or `VERIFIED-IN-DEMO`. */
const REPORT_LABEL_ROW_LABEL = "Report label";
/** Row label for the evidence a claim cites. */
const CLAIM_EVIDENCE_ROW_LABEL = "Evidence cited";
/** Row label for the limitation a claim states about itself. */
const CLAIM_LIMITATION_ROW_LABEL = "Stated limitation of this claim";

/** Rendered in place of a claim's evidence row when the claim cites no evidence. */
const NO_EVIDENCE_CITED_NOTE = "no evidence cited for this claim";
/** Rendered in place of a claim's limitation row when the claim states none. */
const NO_CLAIM_LIMITATION_NOTE = "none stated for this claim";
/** Rendered when a listing's claims state no limitations at all. */
const NO_LIMITATIONS_NOTE = "No limitations are stated for this listing's claims.";
/** Rendered when a listing's latest version has never been evaluated. */
const NO_MEASURED_EVIDENCE_NOTE = `${NO_REPORT_LABEL} — no report exists for this listing's latest version, so no outcome, standard version or label is recorded here.`;
/** Rendered when a listing carries no claims yet. */
const NO_CLAIMS_NOTE = "This listing states no claims yet, so there is nothing to compare.";

/**
 * One label/value pair of a listing's block. The label sits in the row with its value rather than
 * in a column header, so a block stacked at 360 px still says what each value is.
 */
function row(label: string, value: string): JSX.Element {
  return (
    <div className="compare-table__row">
      <span className="compare-table__label">{label}</span>
      <span className="compare-table__value">{value}</span>
    </div>
  );
}

/** Whether a developer-written field carries text, so an empty one is explained rather than blank. */
function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * The measured evidence of one listing: the report its latest version was scored in, the outcome,
 * the standard version and the label. A listing whose latest version has no report says so in
 * plain language instead, because a listing with no evaluation is an ordinary state of the
 * exchange and not an error.
 */
function renderMeasuredEvidence(entry: CompareEntry): JSX.Element {
  if (
    entry.report_id === null &&
    entry.outcome === null &&
    entry.standard_version_id === null &&
    entry.label === null
  ) {
    return <p className="compare-table__absent">{NO_MEASURED_EVIDENCE_NOTE}</p>;
  }

  return (
    <>
      {entry.report_id === null ? null : row(REPORT_ROW_LABEL, entry.report_id)}
      {entry.outcome === null ? null : row(OUTCOME_ROW_LABEL, entry.outcome)}
      {entry.standard_version_id === null
        ? null
        : row(STANDARD_VERSION_ROW_LABEL, entry.standard_version_id)}
      {entry.label === null ? null : row(REPORT_LABEL_ROW_LABEL, entry.label)}
    </>
  );
}

/**
 * The claims of one listing, each kept beside the evidence it cites and the limitation its
 * developer states for it: a claim detached from those two is exactly what this view exists to
 * prevent.
 */
function renderClaims(entry: CompareEntry): JSX.Element {
  if (entry.claims.length === 0) {
    return <p className="compare-table__absent">{NO_CLAIMS_NOTE}</p>;
  }

  return (
    <ul>
      {entry.claims.map((claim: ListingClaim): JSX.Element => (
        <li key={claim.id}>
          <p>{claim.claim}</p>
          {row(
            CLAIM_EVIDENCE_ROW_LABEL,
            hasText(claim.evidence_summary) ? claim.evidence_summary : NO_EVIDENCE_CITED_NOTE,
          )}
          {row(
            CLAIM_LIMITATION_ROW_LABEL,
            hasText(claim.limitation) ? claim.limitation : NO_CLAIM_LIMITATION_NOTE,
          )}
        </li>
      ))}
    </ul>
  );
}

/** The limitations the listing's claims state, rendered verbatim and in the order received. */
function renderLimitations(entry: CompareEntry): JSX.Element {
  if (entry.limitations.length === 0) {
    return <p className="compare-table__absent">{NO_LIMITATIONS_NOTE}</p>;
  }

  return (
    <ul>
      {entry.limitations.map(
        (limitation: string, index: number): JSX.Element => (
          // Two claims may state the identical limitation, so the received position is the only
          // stable key for this list; the order is the order the payload states.
          <li key={`${entry.listing_id}-limitation-${index}`}>{limitation}</li>
        ),
      )}
    </ul>
  );
}

/**
 * The side-by-side comparison of two to four listings: one block per entry, in the order the
 * request named them, each carrying the listing's claims, its measured evidence, its stated
 * limitations, its license and its pricing model.
 *
 * The only route a reader has from a block to the listing it describes is the title link, so the
 * heading of every block links to `/listings/{id}`.
 */
export function CompareTable(props: CompareTableProps): JSX.Element | null {
  // An empty comparison is the page's state to explain — it owns the prompt that says how to add a
  // second listing — and a second explanation here would read as a failure of the comparison.
  if (props.entries.length === 0) {
    return null;
  }

  return (
    <div className="compare-table">
      {props.entries.map((entry: CompareEntry, index: number): JSX.Element => {
        // The block's position is part of the id, so a comparison that names the same listing
        // twice — which still renders two blocks, one per entry received — does not emit the same
        // id twice and leave its `aria-labelledby` resolving ambiguously. The compare page renders
        // this table once, so uniqueness inside the table is uniqueness on the page.
        const headingId = `compare-listing-${index}-${entry.listing_id}`;

        return (
          <section
            key={entry.listing_id}
            className="compare-table__listing"
            aria-labelledby={headingId}
          >
            <h3 id={headingId}>
              <Link to={`/listings/${entry.listing_id}`}>{entry.title}</Link>
            </h3>

            <h4>{CLAIMS_HEADING}</h4>
            {renderClaims(entry)}

            <h4>{MEASURED_EVIDENCE_HEADING}</h4>
            {renderMeasuredEvidence(entry)}

            <h4>{STATED_LIMITATIONS_HEADING}</h4>
            {renderLimitations(entry)}

            <h4>{OFFERING_HEADING}</h4>
            {row(LICENSE_ROW_LABEL, entry.license_code)}
            {row(PRICING_MODEL_ROW_LABEL, entry.pricing_model)}

            {props.renderColumnFooter === undefined ? null : props.renderColumnFooter(entry)}
          </section>
        );
      })}
    </div>
  );
}
