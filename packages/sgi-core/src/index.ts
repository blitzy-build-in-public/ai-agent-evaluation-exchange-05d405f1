/**
 * The single public entry of `@adem/sgi-core`: the workspace that owns ADEM's Standard Gate
 * Index — the standards and their immutable versions, the deterministic scorer, the append-only
 * evaluation reports, the standards proposals, the appeals, the governance event log and the typed
 * extension seams.
 *
 * Consumers reach the package by its name — `import { scoreSubmission } from "@adem/sgi-core"` —
 * and never by a subpath: `package.json` exposes exactly `"."`, so every module beneath
 * `standards/`, `scoring/`, `reports/`, `proposals/`, `appeals/`, `events/` and `extensions/` is an
 * implementation detail that is public only where a statement below makes it public. A name a
 * consumer needs and cannot find here is a missing re-export in this list, never a reason to import
 * a deep path: each workspace has exactly one public entry so that the package's surface can be
 * read in one file.
 *
 * **The extension seam is public on purpose.** `FixturePack`, `EvaluatorCheck` and `ListingCategory`,
 * the validator of each and the registry that resolves them are the community contribution
 * contract: `examples/extension-fixture-pack` implements `FixturePack` and registers it through
 * these exports alone, with no edit to `./scoring`, which is the property the seams exist to prove.
 * Their validation refusals are composition-time programming errors that must fail start-up loudly,
 * so the classes are exported rather than translated or suppressed here.
 *
 * This module re-exports and does nothing else: it declares no constant, type, function or default
 * export, writes no statement of its own and has no side effect. `verbatimModuleSyntax` and
 * `isolatedModules` are both on in `tsconfig.base.json`, so every statement below takes one of two
 * forms and never mixes them — the value form (`export { … }`) for a function, a constant or an
 * error class, and the type form (`export type { … }`) for an interface or a type alias. A class is
 * exported in the value form because a caller both constructs and catches it.
 *
 * **A name here may also be exported by `@adem/shared`, and that is not a defect to fix by
 * renaming.** The shared package's entry re-exports its type modules in full, so it too publishes
 * `Appeal`, `StandardProposal`, `GovernanceEvent` and `GovernanceEventType`. The shapes differ
 * deliberately: the shared declarations are the stored rows, snake_case and field for field what
 * SQLite holds, while the declarations below are the domain values this package reads and writes,
 * carrying the same facts in camelCase. `GovernanceEventType` and `GOVERNANCE_EVENT_TYPES` are the
 * exception to that pairing — the closed vocabulary is declared exactly once, in `@adem/shared`, and
 * re-exported from `./events/append-event` rather than restated, because a second local tuple would
 * be free to drift from the one the moderation contract's documents cite. A module importing both
 * packages therefore aliases one of each colliding pair, as `apps/api` does; do not rename either
 * side, because both names are fixed by the plan.
 *
 * Nothing below reaches `@adem/commerce-sim`, `apps/api` or any sponsorship data — not even a type
 * — and nothing here wraps, defaults or adapts what it re-exports. The trust separation between a
 * measurement and a commercial value therefore holds by construction, and every behaviour a
 * consumer sees is the behaviour of the module that owns it.
 *
 * Specifiers are extensionless and relative, matching the package's `moduleResolution: "bundler"`.
 */

// standards — the versioned criteria, and the registry that is the only reader and writer of them
export { SGI_SO_1_0_0 } from "./standards/sgi-so-1.0.0";
export type { StandardVersionDefinition } from "./standards/sgi-so-1.0.0";

export {
  getStandard,
  getStandardCaseSet,
  getStandardVersion,
  listStandards,
  registerStandardVersion,
  StandardDriftError,
  UnknownStandardError,
} from "./standards/standard-registry";
export type { StandardRecord, StandardVersionRecord } from "./standards/standard-registry";

// scoring — canonical JSON, the per-case comparison and the judge, all pure functions
export { canonicalize } from "./scoring/canonical-json";

export { compareRecordedOutput } from "./scoring/compare-recorded-output";
export type { CaseComparison } from "./scoring/compare-recorded-output";

export {
  DuplicateCaseError,
  IncompleteSubmissionError,
  scoreSubmission,
  UnknownCaseError,
} from "./scoring/score-submission";
export type {
  CaseResult,
  ScoredSubmission,
  ScoreSubmissionOptions,
} from "./scoring/score-submission";

// reports — report construction with full provenance, and its append-only persistence
export { buildReport, deriveReportLabel } from "./reports/build-report";
export type { BuildReportOptions, ReportRecord } from "./reports/build-report";

export { findLatestReportId, getReport, insertReport } from "./reports/report-repository";
export type { StoredReport } from "./reports/report-repository";

// proposals — a contributor's proposal, and the operator review that decides it
export { InvalidProposalError, submitProposal } from "./proposals/submit-proposal";
export type { StandardProposal } from "./proposals/submit-proposal";

export {
  ProposalAlreadyDecidedError,
  ProposalNotFoundError,
  reviewProposal,
} from "./proposals/review-proposal";

// appeals — opened against a report, ruled by appending an event, never touching the report
export { InvalidAppealError, openAppeal, ReportNotFoundError } from "./appeals/open-appeal";
export type { Appeal } from "./appeals/open-appeal";

export {
  AppealAlreadyRuledError,
  AppealNotFoundError,
  ruleAppeal,
} from "./appeals/rule-appeal";

// events — the append-only governance log: its closed vocabulary, its single writer and its reads
export {
  appendEvent,
  GOVERNANCE_EVENT_TYPES,
  UnknownEventTypeError,
} from "./events/append-event";
export type {
  GovernanceEvent,
  GovernanceEventType,
  NewGovernanceEvent,
} from "./events/append-event";

export { listEvents } from "./events/list-events";
export type { EventFilter } from "./events/list-events";

// extensions — the typed seams a community contribution implements, and the registry that resolves them
export { FixturePackValidationError, validateFixturePack } from "./extensions/fixture-pack";
export type { FixturePack } from "./extensions/fixture-pack";

export {
  EvaluatorCheckValidationError,
  validateEvaluatorCheck,
} from "./extensions/evaluator-check";
export type { EvaluatorCheck } from "./extensions/evaluator-check";

export {
  ListingCategoryValidationError,
  validateListingCategory,
} from "./extensions/listing-category";
export type { ListingCategory } from "./extensions/listing-category";

export {
  createExtensionRegistry,
  DuplicateExtensionError,
} from "./extensions/extension-registry";
export type { ExtensionRegistry } from "./extensions/extension-registry";
