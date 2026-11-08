import { Link } from "react-router-dom";

import { collectionPagerControls } from "../collection-paging";

/** Props for {@link CollectionPager}. The caller owns the collection's name and its addresses. */
export interface CollectionPagerProps {
  /** The page the rows on screen are from, as the address asked for it. */
  readonly page: number;
  /** The last page the collection has, from the collection's own total. */
  readonly lastPage: number;
  /** The accessible name of the control row, for example "Board pages". */
  readonly label: string;
  /** The address of one page of this collection, built by the caller from its own address. */
  readonly hrefFor: (targetPage: number) => string;
  /** The collection as a reader's sentence names it, for example "board". */
  readonly collectionName: string;
}

/**
 * The paging control row of a collection the service answers one bounded page of.
 *
 * Every control is a real link, so it is operable by keyboard, announced as a link and openable in a
 * new tab like any other address in the product. A control that cannot move renders as text stating
 * why: a control that looked pressable and did nothing would be a dead end, and a state carried by
 * colour alone would not be perceivable at all. The row therefore holds the two states the contract
 * distinguishes — the collection's first page, where nothing precedes it, and its last, where nothing
 * follows — in words rather than in a disabled attribute.
 *
 * The row renders nothing at all when there is nothing to page through: a collection that fits on one
 * page, read at that page. A reader standing past the end of such a collection is told so by the
 * page's own past-the-end state, and the row is rendered there because there is a page of rows to
 * return to — which is also why the condition is the pair and not the last page alone.
 *
 * The addresses come from the caller rather than from this component, because a page's own address
 * carries that page's other state — the selected row, the filters — and only the caller knows which
 * parameters those are. Nothing here holds state, reads the address or calls the API: it renders the
 * controls its props imply, and the page renders it after the collection's list or its empty state.
 */
export function CollectionPager(props: CollectionPagerProps): JSX.Element | null {
  if (props.lastPage <= 1 && props.page <= 1) {
    return null;
  }

  return (
    <nav className="field__group" aria-label={props.label}>
      {collectionPagerControls(props.page, props.lastPage, props.collectionName).map(
        (control): JSX.Element =>
          control.blockedReason === null ? (
            <Link
              key={control.label}
              className="button button--secondary"
              to={props.hrefFor(control.targetPage)}
            >
              {control.label}
            </Link>
          ) : (
            <span key={control.label}>{`${control.label}: unavailable, ${control.blockedReason}`}</span>
          ),
      )}
    </nav>
  );
}
