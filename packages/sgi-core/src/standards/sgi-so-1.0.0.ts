import type { StandardStatus } from "@adem/shared";

/**
 * The versioned criteria of one SGI standard version: the pass rule an evaluation is scored
 * against, held as data rather than as a branch in scoring code.
 *
 * Every member is `readonly` and the value handed to the registry is deeply frozen, because a
 * published version is append-only. A change to a threshold, a title or the fixture set
 * reference creates a new version through `registerStandardVersion`; nothing ever edits an
 * existing one, and a threshold that has become inconvenient is published as a new version
 * rather than widened here.
 *
 * The runtime pass rule is read from {@link passThresholdMatches} and
 * {@link criticalFailuresAllowed} and is never re-derived anywhere else: PASS iff
 * `matchedCount >= passThresholdMatches && criticalFailures <= criticalFailuresAllowed`,
 * anything else FAIL.
 */
export interface StandardVersionDefinition {
  /** Stable standard code this version belongs to, the string people quote: `SGI-SO-1.0.0`. */
  readonly code: string;

  /** The contract-facing version label a report cites alongside the standard code. */
  readonly versionLabel: string;

  /** Human-readable standard title, e.g. `Structured Output Conformance`. */
  readonly title: string;

  /** One paragraph stating what the standard measures and what it does not claim. */
  readonly summary: string;

  /** `provisional` until a reviewed version supersedes this one and is published `active`. */
  readonly status: StandardStatus;

  /** Number of fixture cases this version defines: 20 for `SGI-SO-1.0.0`. */
  readonly totalCases: number;

  /** How many of those cases are severe enough that a failure fails the candidate outright. */
  readonly criticalCases: number;

  /** Cases that must match for a PASS: at least this many out of {@link totalCases}. */
  readonly passThresholdMatches: number;

  /** Critical-case failures this version tolerates: 0 for this release's strict rule. */
  readonly criticalFailuresAllowed: number;

  /**
   * Reference to the rubric document section, resolving to
   * `docs/STANDARD-SGI-SO-1.0.0.md#rubric`, where the rubric, the evidence semantics and the
   * retest and appeal semantics are stated.
   */
  readonly rubricReference: string;

  /**
   * Identifier the fixture loader resolves to the case set this version is scored against —
   * the reference, never the cases themselves, which belong to `@adem/sgi-fixtures`.
   */
  readonly fixtureSetId: string;

  /**
   * Fixed ISO-8601 UTC literal, never a clock reading: the same fixture must produce the same
   * per-case results and the same outcome on every run, so nothing in the scoring path may
   * read a clock, a locale or a timezone.
   */
  readonly publishedAt: string;
}

/**
 * Recursively freezes every own object or array member of `value`, then `value` itself, and
 * returns the same reference — nothing is copied, no member is rewritten and no extra property
 * is added.
 *
 * The walk covers every level rather than the top one only, so a nested value cannot be mutated
 * into changing a threshold or a published identifier after the standard has been registered.
 * `Object.freeze` on the returned reference is not needed and would freeze nothing further.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * `SGI-SO-1.0.0` — Structured Output Conformance, the one provisional standard of this release.
 *
 * It states only what the fixture set can evidence: the recorded structured outputs of a
 * declarative candidate submission are compared against twenty fixed cases, five of them
 * critical, and a candidate passes on at least 18 matches with no critical failure. Nothing
 * submitted is executed, and no outcome claims safety, security, certification or general
 * capability.
 *
 * This object is the runtime authority for the numbers that
 * `packages/shared/migrations/0005_standards_and_proposals.sql` stores in its
 * `standard_versions` columns, for the case set in `@adem/sgi-fixtures`, and for
 * `docs/STANDARD-SGI-SO-1.0.0.md`. Where those three and this object disagree, this object is
 * what the evaluator reads.
 *
 * Deeply frozen at module load, so a mutation attempt fails loudly in strict mode instead of
 * quietly changing a published criterion. That refusal is the intended behaviour, not a bug to
 * fix by removing the freeze: a new set of criteria means a new version.
 */
export const SGI_SO_1_0_0: StandardVersionDefinition = deepFreeze({
  code: "SGI-SO-1.0.0",
  versionLabel: "SGI-SO-1.0.0",
  title: "Structured Output Conformance",
  summary:
    "Compares the recorded structured outputs of a declarative candidate submission against twenty fixed fixture cases and reports a reproducible PASS or FAIL. The evidence is limited to structured output on the fixture set only: nothing submitted is executed, and no outcome asserts safety, security, certification or general capability.",
  status: "provisional",
  totalCases: 20,
  criticalCases: 5,
  passThresholdMatches: 18,
  criticalFailuresAllowed: 0,
  rubricReference: "SGI-SO-1.0.0#rubric",
  fixtureSetId: "SGI-SO-1.0.0",
  publishedAt: "2024-06-01T00:00:00.000Z",
});
