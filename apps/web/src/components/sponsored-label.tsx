import { SPONSORED_LABEL } from "@adem/shared";

/**
 * The disclosure every sponsored item carries: the one-word label `Sponsored`, taken from
 * the shared constant rather than retyped, so the rendered text cannot drift from the
 * vocabulary the request fixes.
 *
 * Deliberately a bare inline element — not a link, not a button, not focusable, and never
 * hidden or shrunk at a narrow width. The label is a disclosure, so making it actionable or
 * hiding it on mobile would defeat what it exists to state, and a caller that also names the
 * sponsor's fictional handle renders that beside this component so this element's text stays
 * exactly `Sponsored`. Appearance belongs to the `.sponsored-label` rule in the stylesheet.
 */
export function SponsoredLabel(): JSX.Element {
  return <span className="sponsored-label">{SPONSORED_LABEL}</span>;
}
