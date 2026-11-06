import { DEMO_AUTHENTICATION_LABEL } from "@adem/shared";

/**
 * The persistent demonstration disclosure, rendered on every route: it states that the selected
 * demo account is a synthetic role selector and not an identity.
 *
 * Persistent by design. It is deliberately not dismissible and deliberately not a live region:
 * a disclosure a reader can close stops being a disclosure, and a status role here would make
 * screen readers announce static text again on every route change.
 */
export function DemoBanner(): JSX.Element {
  return <p className="demo-banner">{DEMO_AUTHENTICATION_LABEL}</p>;
}
