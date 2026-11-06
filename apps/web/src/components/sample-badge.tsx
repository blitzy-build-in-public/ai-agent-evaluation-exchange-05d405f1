import type { ReportLabel, ReportOutcome } from "@adem/shared";
import { BADGE_SCOPE } from "@adem/shared";

/**
 * The four provenance values of one evaluation report, taken from the report the badge is for.
 *
 * A caller holding an `EvaluationReport` supplies `outcome`, `label`, `standard_version_id` and
 * `id` directly, and the linked evidence a listing and a comparison carry holds the same four
 * values, so this one component serves the report page, the listing page and the compare view
 * with a single definition of the artefact.
 */
export interface SampleBadgeProps {
  /** The report's outcome. A badge is rendered for `PASS`, and `FAIL` renders nothing. */
  readonly outcome: ReportOutcome;
  /** The report's label: `SAMPLE` or `VERIFIED-IN-DEMO`, the two words the vocabulary holds. */
  readonly label: ReportLabel;
  /** The standard version the report was scored against, for example `SGI-SO-1.0.0`. */
  readonly standardVersionId: string;
  /** The report's identifier, so the badge names the report a reader would open. */
  readonly reportId: string;
}

/**
 * The badge a `PASS` report is issued, naming the report's label, the standard version, the scope
 * of what was measured and the report ID — four values and nothing more.
 *
 * A `FAIL` report renders nothing at all: no dimmed badge, no placeholder and no empty element.
 * The decision is taken here, before any markup is built, rather than being left to a page,
 * because the badge is issued on `PASS` alone and a second consumer that forgot the rule would
 * publish a badge for a report that did not pass. A `FAIL` report carries its per-case evidence
 * and a plain-language summary in the badge's place.
 *
 * The scope string comes from the shared constant and the other three values come from props, so
 * the badge a reader sees beside a listing is the one the report page shows. The component holds
 * no state, offers no action, carries no icon and reads nothing from the network.
 */
export function SampleBadge(props: SampleBadgeProps): JSX.Element | null {
  if (props.outcome === "FAIL") {
    return null;
  }

  return (
    <div className="sample-badge" role="group" aria-label="SGI report badge">
      <span>{props.label}</span>
      <span>
        Standard version <span className="sample-badge__version">{props.standardVersionId}</span>
      </span>
      <span className="sample-badge__scope">{BADGE_SCOPE}</span>
      <span>
        Report ID <span className="sample-badge__report-id">{props.reportId}</span>
      </span>
    </div>
  );
}
