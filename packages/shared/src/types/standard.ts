/**
 * The SGI standard, its versioned thresholds and the proposal lifecycle.
 *
 * Three entities of the Standard Gate Index are typed here, and their store
 * kinds differ. `standards` is the seed-only catalogue row, read as mutable
 * reference data. `standard_versions` is append-only: a change to the criteria
 * creates a new row and nothing edits an existing one. `standard_proposals` is
 * mutable in its `status` column alone, every review decision being recorded as
 * an appended governance event rather than as an edit to the proposal's text.
 *
 * The thresholds are versioned data read from the stored `standard_versions`
 * row and never a constant declared in this module. That is what lets a later
 * version change the pass rule through review without an edit to scoring code.
 *
 * Declarations only: no comparison, no outcome derivation and no imports. The
 * evaluator's reading of the stored row lives in `@adem/sgi-core`.
 */

/**
 * The statuses a standard version may hold.
 *
 * The plan fixes the thresholds of `SGI-SO-1.0.0` as provisional for this
 * release, so a standard version begins `provisional` and reaches `active`
 * only by publication of a reviewed version that supersedes it.
 */
export const STANDARD_STATUSES = ['provisional', 'active'] as const;

/** The status of a standard version — see {@link STANDARD_STATUSES}. */
export type StandardStatus = (typeof STANDARD_STATUSES)[number];

/**
 * A row of the `standards` catalogue.
 *
 * One row exists in this release: `code` `SGI-SO-1.0.0` with `title`
 * "Structured Output Conformance". The catalogue row is seed-only and mutable,
 * unlike the versions beneath it, and it carries no threshold of its own — the
 * versioned criteria live in {@link StandardVersion}.
 *
 * The standard is a published rubric and nothing more: it certifies no
 * implementation and its outcome vocabulary is closed to PASS and FAIL.
 */
export interface Standard {
  /** Identifier of the standard, unique across the catalogue. */
  id: string;
  /** Stable standard code, the string a version identifier is built from. */
  code: string;
  /** Human-readable standard title, such as "Structured Output Conformance". */
  title: string;
  /** One-paragraph statement of what the standard measures. */
  summary: string;
}

/**
 * A row of `standard_versions`: the versioned criteria the evaluator reads.
 *
 * `total_cases`, `critical_cases`, `pass_threshold_matches` and
 * `critical_failures_allowed` are versioned data stored in columns, provisional
 * for this release. The row published for `SGI-SO-1.0.0` carries `total_cases`
 * 20, `critical_cases` 5, `pass_threshold_matches` 18 and
 * `critical_failures_allowed` 0, which encodes the pass rule "at least 18 of 20
 * cases match AND no `critical` case fails"; anything else is FAIL. Those
 * numbers belong to that row and to no other version.
 *
 * The authoritative runtime values come from the stored row, read through
 * `@adem/sgi-core`, and never from a constant in this package: a consumer types
 * a row here but asks the domain package what the row means.
 *
 * The row is append-only, so a criteria change creates a new version and
 * nothing edits an existing one — which is why it carries no updated-at or
 * revision field.
 *
 * `rubric_reference` holds the string `SGI-SO-1.0.0#rubric`, which resolves to
 * `docs/STANDARD-SGI-SO-1.0.0.md#rubric`, the document stating the rubric, the
 * evidence semantics, the retest and appeal semantics and the badge scope.
 */
export interface StandardVersion {
  /** Identifier of this version row, unique across every standard. */
  id: string;
  /** Identifier of the {@link Standard} this version belongs to. */
  standard_id: string;
  /** Published version label, such as `1.0.0`, paired with the standard code. */
  version_label: string;
  /** Whether the version is `provisional` or `active`. */
  status: StandardStatus;
  /** Number of fixture cases the version defines. */
  total_cases: number;
  /** Number of those cases whose failure fails the candidate outright. */
  critical_cases: number;
  /** Number of cases that must match for the version's pass threshold. */
  pass_threshold_matches: number;
  /** Critical-case failures the version tolerates, zero for a strict rule. */
  critical_failures_allowed: number;
  /** Reference to the rubric document section, e.g. `SGI-SO-1.0.0#rubric`. */
  rubric_reference: string;
  /** Serialized {@link StandardDefinition}: a string in the column, not an object. */
  definition_json: string;
  /** ISO-8601 UTC instant the version was published, written at insert time. */
  published_at: string;
}

/**
 * The parsed shape of {@link StandardVersion.definition_json}.
 *
 * This is the serialized form of the versioned standard — the fixture case-set
 * reference, the case count, the critical-case count, the pass-rule values and
 * the rubric reference — and it carries no authority of its own. The row's
 * columns are what the evaluator reads, so a consumer must not treat a parsed
 * `definition_json` as the criteria, and must not present it as one.
 */
export interface StandardDefinition {
  /** Reference to the fixture case set the version is scored against. */
  fixture_set_reference: string;
  /** Number of fixture cases the version defines. */
  total_cases: number;
  /** Number of those cases whose failure fails the candidate outright. */
  critical_cases: number;
  /** Number of cases that must match for the version's pass threshold. */
  pass_threshold_matches: number;
  /** Critical-case failures the version tolerates, zero for a strict rule. */
  critical_failures_allowed: number;
  /** Reference to the rubric document section, e.g. `SGI-SO-1.0.0#rubric`. */
  rubric_reference: string;
}

/**
 * The statuses a standard proposal may hold.
 *
 * `submitted` is the state the row is created in; `accepted` and `rejected` are
 * reached only through the operator review route, which appends a governance
 * event. Automated movement between these states does not exist.
 */
export const PROPOSAL_STATUSES = ['submitted', 'accepted', 'rejected'] as const;

/** The status of a standard proposal — see {@link PROPOSAL_STATUSES}. */
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * The two outcomes a review may set on a standard proposal.
 *
 * `submitted` is deliberately absent: it is the initial state rather than a
 * review outcome, and a proposal that already holds one of these two is the
 * review contract's `409`.
 */
export const PROPOSAL_REVIEW_STATUSES = ['accepted', 'rejected'] as const;

/** The outcome a review may set — see {@link PROPOSAL_REVIEW_STATUSES}. */
export type ProposalReviewStatus = (typeof PROPOSAL_REVIEW_STATUSES)[number];

/**
 * A row of `standard_proposals`.
 *
 * `status` is the only mutable column. A review moves it and appends a
 * governance event; the proposal's title and rationale are never rewritten, so
 * the reasoning a decision answered stays readable afterwards.
 */
export interface StandardProposal {
  /** Identifier of the proposal, unique across every standard. */
  id: string;
  /** Identifier of the {@link Standard} the proposal concerns. */
  standard_id: string;
  /** Identifier of the contributing account that submitted the proposal. */
  proposer_account_id: string;
  /** Short statement of what the proposal would change. */
  title: string;
  /** Reasoning for the change, stored as submitted. */
  rationale: string;
  /** Current status: `submitted` until an operator review decides it. */
  status: ProposalStatus;
  /** ISO-8601 UTC instant of submission, written at insert time. */
  created_at: string;
}

/**
 * The body of `POST /standards/proposals`, submitted by a contributor account
 * with the demo account header.
 *
 * `status` is not a client field: the row is created `submitted` and only the
 * review route moves it.
 */
export interface StandardProposalCreateBody {
  /** Identifier of the {@link Standard} the proposal concerns. */
  standard_id: string;
  /** Short statement of what the proposal would change. */
  title: string;
  /** Reasoning for the change. */
  rationale: string;
}

/**
 * The body of `POST /standards/proposals/{id}/review`, submitted by an operator
 * account.
 *
 * The field is named `status` because it is the column the review moves.
 * `reason` is optional and, under `exactOptionalPropertyTypes`, is either absent
 * or a string — never `undefined` written explicitly. Validation against this
 * shape lives in `packages/shared/src/schemas/moderation-schema.ts`, which the
 * plan places the proposal and review bodies in alongside the moderation
 * bodies.
 */
export interface StandardProposalReviewBody {
  /** The outcome the review sets: `accepted` or `rejected`. */
  status: ProposalReviewStatus;
  /** Optional note recorded with the appended governance event. */
  reason?: string;
}
