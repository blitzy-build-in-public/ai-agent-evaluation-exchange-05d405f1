import type { ReactNode } from "react";

/**
 * Props for {@link EmptyState}. The caller owns the wording: this component explains a
 * successful-but-empty result in the page's own terms and never guesses the reason itself.
 */
export interface EmptyStateProps {
  /** The state, stated plainly — for example "No listings match these filters". */
  readonly heading: string;
  /** Why there is nothing, in a sentence a reader can act on. */
  readonly explanation: string;
  /** Optional next step: a link or a button the caller owns. Rendered only when present. */
  readonly action?: ReactNode;
  /** Optional heading level, defaulting to 2, so the caller can fit the page's outline. */
  readonly headingLevel?: 2 | 3 | 4;
}

/** Renders the heading at the level the caller asked for; never a level a page already uses for its title. */
function renderHeading(level: 2 | 3 | 4, heading: string): JSX.Element {
  switch (level) {
    case 2:
      return <h2>{heading}</h2>;
    case 3:
      return <h3>{heading}</h3>;
    case 4:
      return <h4>{heading}</h4>;
  }
}

/**
 * The explanatory state for a request that succeeded with nothing to show: a heading that names
 * the state, an explanation of why, and the caller's optional next step.
 *
 * Deliberately not a live region and deliberately free of error semantics: this content is present
 * at first render, and a failure belongs to the error notice, with its code and its retry notice.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element {
  const level = props.headingLevel ?? 2;

  return (
    <div className="empty-state">
      {renderHeading(level, props.heading)}
      <p>{props.explanation}</p>
      {props.action === undefined || props.action === null ? null : <div>{props.action}</div>}
    </div>
  );
}
