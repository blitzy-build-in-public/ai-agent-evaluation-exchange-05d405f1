import { Link } from "react-router-dom";

/**
 * Text overrides for {@link NotFound}. Both fields are optional: the page always
 * renders the same structure and only the wording changes.
 */
export interface NotFoundProps {
  /** Replaces the default heading. */
  heading?: string;
  /** Replaces the default explanation. */
  message?: string;
}

/** Heading shown for an address that matches no page and for a removed resource. */
const DEFAULT_HEADING = "Page not found";

/**
 * Default explanation. It states what is true of the address and of the resource,
 * and gives the reader a way forward instead of describing a failure.
 */
const DEFAULT_MESSAGE =
  "This address does not match a page on ADEM. If it named a listing or a report, that resource is unknown or has been removed.";

/**
 * The absent-state page for an unknown address or a resource that is gone.
 *
 * The listing and report pages render this component *instead of* their own
 * content when the resource they were asked for is missing, so it is a complete
 * page rather than a fragment: it owns the single `<main>` landmark and the
 * single `<h1>`, and no caller may supply one around it. The shell wraps it in a
 * plain container rather than a landmark, so this page stays the route's only
 * `<main>`. Both text props only replace the wording — the structure is never
 * branched on.
 */
export function NotFound(props: NotFoundProps = {}): JSX.Element {
  const heading = props.heading ?? DEFAULT_HEADING;
  const message = props.message ?? DEFAULT_MESSAGE;

  // The id below is the target the shell's skip link points at, and tabIndex={-1} is
  // what lets that link move focus here without putting <main> in the tab order, so
  // the two stay in step with the shell's skip link rather than being renamed freely.
  return (
    <main id="main-content" tabIndex={-1} className="page page-not-found">
      <h1 className="not-found__heading">{heading}</h1>
      <p className="not-found__message">{message}</p>
      <ul className="not-found__links">
        <li>
          <Link to="/listings">Browse listings</Link>
        </li>
        <li>
          <Link to="/">Go to the homepage</Link>
        </li>
      </ul>
    </main>
  );
}

// The default export is what app.tsx's route table imports and the named export is what
// listing-detail.tsx and report.tsx import, so both exist on purpose.
export default NotFound;
