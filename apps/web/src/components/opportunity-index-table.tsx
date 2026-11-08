/**
 * The illustrative opportunity index as a table: one row per listing category, each row keeping
 * the supply the synthetic listings represent, the demand table's fictional figure and the ratio
 * the derivation computed between them.
 *
 * Five decisions, each of which a later reader could otherwise invert:
 *
 *   - **The illustrative statement is rendered here, unconditionally.** It is not a prop, it is
 *     not conditional on the row count, and there is no way for a caller to suppress it: the
 *     reason this component exists rather than the page rendering the rows directly is that the
 *     label has to survive wherever the table appears. It has its own element and is named by the
 *     table's `aria-describedby`, so a screen-reader user hears the disclosure and not only a
 *     sighted one seeing it.
 *
 *   - **Two columns, not five.** A column per figure reads well at a desk and badly at 360px: with
 *     four numeric columns each takes an equal share of the viewport and the category identifiers
 *     break mid-word. So the row header carries the grouping key and the second cell carries the
 *     three figures as a `<dl>` of label/value pairs. Every value then sits beside its own label
 *     inside the row at every width, and the two cells keep a share of the viewport wide enough
 *     for a hyphenated category slug to break where it is written to break.
 *
 *   - **Nothing is derived here.** `deriveOpportunityIndex` is the workspace's single definition of
 *     the index; calling it, importing its demand table or recomputing a ratio in this file would
 *     be a second definition. This component renders the rows it is given, in the order it is given
 *     them, prints each number exactly as the derivation produced it, and adds no row, total or
 *     average of its own.
 *
 *   - **Every row keeps the derivation's own marker.** Each row is rendered with the literal word
 *     `illustrative` inside its header cell, so the marker is visible and part of the row's
 *     accessible name; a marker that stayed in the data would be wasted.
 *
 *   - **The statement's element id is a fixed constant**, because the props are exactly the rows
 *     and the component takes no hook, so it cannot mint a unique id per instance. The page renders
 *     this table once, which is what makes one constant id the one id on that page; a second
 *     instance would make the id a prop, and that is a change to this file's contract rather than a
 *     local edit.
 *
 * The numbers are read from the row and rendered as they are: no locale-sensitive format, no
 * rounding, no separator and no unit the derivation did not carry. The ratio's scale is stated in
 * the statement below, in text, because a bare integer would carry no scale at all: the derivation
 * expresses the ratio in basis points, where `10_000` is demand equal to supply.
 *
 * Appearance belongs to the `.opportunity-index-table`, `.table` and `.table__wrapper` rules in the
 * stylesheet, which cap the table at the width of the column it sits in and wrap every cell, so the
 * page reflows at 360px rather than scrolling sideways.
 */
import { RATIO_BASIS_POINT_SCALE } from "../illustrative/opportunity-index";
import type { OpportunityRow } from "../illustrative/opportunity-index";

/**
 * Props for {@link OpportunityIndexTable}: the derived rows and nothing else.
 *
 * The component takes no other member on purpose. There is no prop that can suppress the
 * illustrative statement and no prop carrying a demand table, a listing, a derived value or a
 * callback, because every one of those would move a decision out of this component and into a
 * caller.
 */
export interface OpportunityIndexTableProps {
  /** The rows produced by deriveOpportunityIndex, in the order the derivation returned them. */
  readonly rows: readonly OpportunityRow[];
}

/** Names the table itself, so the entries are never read as an unlabelled grid of numbers. */
const TABLE_CAPTION = "Illustrative opportunity index, by listing category";

/** The id the statement element carries and the table's `aria-describedby` names. */
const STATEMENT_ID = "opportunity-index-statement";

/**
 * What makes the figures illustrative rather than measured, in the order a reader needs it: supply
 * is counted from the synthetic listings the page loaded, and demand comes from a fictional table
 * fixed in the code. Neither figure was observed anywhere, and the sentence says so rather than
 * leaving the word "illustrative" to be interpreted.
 */
const STATEMENT =
  "Illustrative only: supply is counted from the synthetic listings this page loaded, and each demand figure comes from a fixed fictional table written into the site's code rather than from anything observed.";

/**
 * The ratio's scale, stated in text because the row's ratio value is a bare integer.
 *
 * The numeral is interpolated from `RATIO_BASIS_POINT_SCALE`, the derivation's own constant, rather
 * than written out here: the page states the same scale in its definition of the ratio, and reading
 * it from one source is what stops the note above the table and that definition from being written
 * two ways. It is left ungrouped on purpose, so the threshold reads the way the rows' own ratio
 * values read: no thousand separator here, where the rows print none either.
 */
const RATIO_SCALE_NOTE = `Ratio is demand against supply in basis points, where ${String(RATIO_BASIS_POINT_SCALE)} means demand equals supply and a larger figure means demand exceeds supply.`;

/** Column header over the category each row covers. */
const COLUMN_CATEGORY = "Category";
/** Column header over the three figures a row carries, each with its label in the row itself. */
const COLUMN_FIGURES = "Illustrative figures";

/**
 * Row label over the number of the given listings that sit in the row's category: the unit is part
 * of the label, so a reader meets it where the value is and not only in the page's definition below
 * the table.
 *
 * The page's "How to read a row" list names this term through this constant rather than writing it
 * again, so one label set describes the row in both places.
 */
export const LABEL_SUPPLY = "Supply (listings)";
/**
 * Row label over the fictional demand table's figure for the row's category. It states the unit the
 * figure counts in, which is the unit the supply column counts in — a listing — because the two
 * figures are set beside each other and divided into the ratio below. It calls that unit
 * illustrative, because the figure comes from the fictional table rather than from anything
 * observed, exactly as the supply label's unit is a count of synthetic listings.
 *
 * Named by the page's "How to read a row" list through this constant, as its two siblings are.
 */
export const LABEL_DEMAND = "Demand (illustrative listings)";
/**
 * Row label over the derived demand-to-supply ratio, whose scale the statement above gives. Named
 * by the page's "How to read a row" list through this constant, as its two siblings are.
 */
export const LABEL_RATIO = "Ratio (basis points)";

/** The derivation's per-row marker, rendered as text so it reaches the row's accessible name. */
const ROW_MARKER = "illustrative";

/**
 * The illustrative opportunity index: a caption, two labelled columns and one row per derived row,
 * rendered in the order received, each row stating its three figures beside their labels.
 *
 * An empty row set renders nothing at all. A supply of no listings is an ordinary state — a
 * category nobody has listed in yet produces no row — and the page that calls this component
 * already explains it on every render, so a second explanation here would read as a failure of the
 * index rather than as a fact about the exchange.
 */
export function OpportunityIndexTable(props: OpportunityIndexTableProps): JSX.Element | null {
  // An empty index is the page's state to explain; this component renders no header-only table and
  // no error, and returning `null` keeps the two explanations from stacking.
  if (props.rows.length === 0) {
    return null;
  }

  return (
    <div className="opportunity-index-table">
      <p id={STATEMENT_ID} className="opportunity-index-table__note">
        {STATEMENT} {RATIO_SCALE_NOTE}
      </p>

      <div className="table__wrapper">
        <table className="table" aria-describedby={STATEMENT_ID}>
          <caption>{TABLE_CAPTION}</caption>

          <thead>
            <tr>
              <th scope="col">{COLUMN_CATEGORY}</th>
              <th scope="col">{COLUMN_FIGURES}</th>
            </tr>
          </thead>

          <tbody>
            {props.rows.map(
              (row: OpportunityRow): JSX.Element => (
                <tr key={row.category_slug}>
                  <th scope="row" className="opportunity-index-table__identifier">
                    {row.category_slug} <span>{ROW_MARKER}</span>
                  </th>
                  <td>
                    <dl>
                      <dt>{LABEL_SUPPLY}</dt>
                      <dd className="opportunity-index-table__amount">{row.supply}</dd>
                      <dt>{LABEL_DEMAND}</dt>
                      <dd className="opportunity-index-table__amount">{row.demand}</dd>
                      <dt>{LABEL_RATIO}</dt>
                      <dd className="opportunity-index-table__amount">{row.ratio_basis_points}</dd>
                    </dl>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
