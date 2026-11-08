/**
 * The beside-source unit test of `scoreSubmission` from `./score-submission`, the judge of the
 * Standard Gate Index.
 *
 * It proves, in one place, the four things the shipped evaluator must be able to state:
 *
 * - **The acceptance values of the delivered pack.** Every seed candidate is scored here, from
 *   the real case set and the real recordings read through `@adem/sgi-fixtures`, and the outcome,
 *   the matched and total counts, the critical failures and the failing case ids are asserted
 *   against `expected-outcomes.json` — the document the pack itself publishes as the expectation —
 *   and pinned beside it as literals, so a change that moved the fixture data and its published
 *   expectation together fails here as well. No threshold is restated: a rule that changed in the
 *   standard version while the pack stayed as it is fails here instead of passing silently.
 * - **Reproducibility.** Two independent runs over the same submission return deeply equal
 *   results, and every per-case evidence string is canonical JSON text, which is what makes the
 *   comparison byte-stable rather than merely equal in shape.
 * - **Each refusal family, and the precedence between them.** The six drift conditions, an unknown
 *   case id, a repeated one and an incomplete submission are each provoked and read back for their
 *   class, their `name`, their stable `code` and the field a route uses to answer.
 * - **The extension seam.** A supplied `EvaluatorCheck` replaces the verdict for exactly the cases
 *   it declares, the first check that declares a case is the one consulted, and a check that throws
 *   refuses the call rather than scoring the case as a match.
 *
 * The fixture pack is read through the loader that owns those reads — nothing here opens a file,
 * opens a database or reads an environment variable — and no rule of the standard is restated as a
 * literal: the thresholds under test are read from the standard version and the expectations from
 * the pack, so this file cannot drift from either.
 */

import { describe, expect, it } from "vitest";

import { loadCandidate, loadCaseSet, loadExpectedOutcomes } from "@adem/sgi-fixtures";
import type {
  CandidateSubmission,
  CaseSet,
  FixtureCase,
  JsonValue,
  RecordedOutput,
  ReportOutcome,
} from "@adem/sgi-fixtures";

import { canonicalize } from "./canonical-json";
import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";
import type { StandardVersionDefinition } from "../standards/sgi-so-1.0.0";
import { StandardDriftError } from "../standards/standard-registry";
import type { EvaluatorCheck } from "../extensions/evaluator-check";
import {
  DuplicateCaseError,
  IncompleteSubmissionError,
  UnknownCaseError,
  scoreSubmission,
} from "./score-submission";
import type { CaseResult, ScoredSubmission } from "./score-submission";

/** The standard version under test: the one provisional standard of this release. */
const STANDARD: StandardVersionDefinition = SGI_SO_1_0_0;

/**
 * The three seed candidates, in the order the pack records their expectations.
 *
 * Named here as data rather than described: every assertion below reads the outcome the pack
 * expects of them, so a candidate whose recording changes changes this suite's result through the
 * data and never through a literal written here.
 */
const SEED_CANDIDATE_IDS = ["seed-alpha", "seed-beta", "seed-gamma"] as const;

/**
 * Criterion 3's acceptance values, pinned as literals.
 *
 * The assertions below cross-check these numbers against the record the fixture pack publishes;
 * pinning them here as well is what makes the pack's own numbers the contractual ones, so a change
 * that moved the fixture data and its published expectation together would fail this suite instead
 * of passing as a self-consistent pair.
 */
interface PinnedAcceptance {
  /** The seed candidate these values belong to. */
  readonly candidateId: string;
  /** The outcome criterion 3 fixes for the candidate. */
  readonly outcome: ReportOutcome;
  /** How many of the twenty fixture cases the candidate matches. */
  readonly matchedCount: number;
  /** How many `critical` cases the candidate fails. */
  readonly criticalFailures: number;
  /** The cases the candidate does not match. */
  readonly failingCaseIds: readonly string[];
}

/** One pinned expectation per seed candidate, in the order the pack records them. */
const PINNED_ACCEPTANCE: readonly PinnedAcceptance[] = [
  {
    candidateId: "seed-alpha",
    outcome: "PASS",
    matchedCount: 20,
    criticalFailures: 0,
    failingCaseIds: [],
  },
  {
    candidateId: "seed-beta",
    outcome: "FAIL",
    matchedCount: 19,
    criticalFailures: 1,
    failingCaseIds: ["so-003"],
  },
  {
    candidateId: "seed-gamma",
    outcome: "FAIL",
    matchedCount: 17,
    criticalFailures: 0,
    failingCaseIds: ["so-014", "so-016", "so-018"],
  },
];

/** The case set the standard version publishes, read fresh so no run shares loaded state with another. */
function caseSetOf(): CaseSet {
  return loadCaseSet(STANDARD.fixtureSetId);
}

/** One seed candidate submission as recorded in the pack, read fresh. */
function candidateOf(candidateId: string): CandidateSubmission {
  return loadCandidate(candidateId);
}

/**
 * The expectation the pack records for one candidate.
 *
 * Read from `expected-outcomes.json` rather than restated, so the assertions in the acceptance
 * group compare this module's output against the artefact the fixture pack publishes.
 */
function expectedOutcomeOf(candidateId: string) {
  const outcome = loadExpectedOutcomes().candidates.find(
    (candidateOutcome) => candidateOutcome.candidate_id === candidateId,
  );
  if (outcome === undefined) {
    throw new Error(`the expected-outcomes document records no entry for candidate "${candidateId}"`);
  }
  return outcome;
}

/**
 * Resolves one case of a loaded case set.
 *
 * `noUncheckedIndexedAccess` makes `.find` return `FixtureCase | undefined`, so the absence is
 * handled where it can happen rather than silenced with a non-null assertion.
 */
function requireCase(caseSet: CaseSet, caseId: string): FixtureCase {
  const fixtureCase = caseSet.cases.find((candidateCase) => candidateCase.id === caseId);
  if (fixtureCase === undefined) {
    throw new Error(`${caseId} is not a case of the ${caseSet.standard_version_id} case set`);
  }
  return fixtureCase;
}

/** The set's first case, narrowed without an unchecked index read. */
function firstCase(caseSet: CaseSet): FixtureCase {
  const [first] = caseSet.cases;
  if (first === undefined) {
    throw new Error(`the ${caseSet.standard_version_id} case set carries no cases`);
  }
  return first;
}

/** The first case of the set whose severity is `critical`. */
function firstCriticalCase(caseSet: CaseSet): FixtureCase {
  const critical = caseSet.cases.find((candidateCase) => candidateCase.severity === "critical");
  if (critical === undefined) {
    throw new Error(`the ${caseSet.standard_version_id} case set marks no case critical`);
  }
  return critical;
}

/** The first case of the set whose severity is `standard`, which the pass rule never singles out. */
function firstStandardCase(caseSet: CaseSet): FixtureCase {
  const standardCase = caseSet.cases.find((candidateCase) => candidateCase.severity === "standard");
  if (standardCase === undefined) {
    throw new Error(`every case of the ${caseSet.standard_version_id} case set is critical`);
  }
  return standardCase;
}

/** Resolves the recorded output a candidate states for one case. */
function requireRecordedOutput(candidate: CandidateSubmission, caseId: string): RecordedOutput {
  const recordedOutput = candidate.recorded_outputs.find((recorded) => recorded.case_id === caseId);
  if (recordedOutput === undefined) {
    throw new Error(`${candidate.candidate_id} recorded no output for case ${caseId}`);
  }
  return recordedOutput;
}

/** Resolves the result of one case from a scored submission. */
function requireCaseResult(scored: ScoredSubmission, caseId: string): CaseResult {
  const caseResult = scored.caseResults.find((result) => result.caseId === caseId);
  if (caseResult === undefined) {
    throw new Error(`the scored submission carries no case result for ${caseId}`);
  }
  return caseResult;
}

/** A copy of one candidate with the given recordings in place of its own. */
function withRecordedOutputs(
  candidate: CandidateSubmission,
  recordedOutputs: RecordedOutput[],
): CandidateSubmission {
  return { ...candidate, recorded_outputs: recordedOutputs };
}

/** A copy of one candidate with the recordings for the given case ids removed. */
function withoutRecordingsFor(
  candidate: CandidateSubmission,
  caseIds: readonly string[],
): CandidateSubmission {
  return withRecordedOutputs(
    candidate,
    candidate.recorded_outputs.filter((recorded) => !caseIds.includes(recorded.case_id)),
  );
}

/** A copy of a case set with the given cases in place of its own. */
function withCases(caseSet: CaseSet, cases: FixtureCase[]): CaseSet {
  return { ...caseSet, cases };
}

/** The verdict a check returns for a case the built-in comparison would not have matched. */
function mismatchVerdict(expected: JsonValue, marker: string) {
  return {
    match: false as const,
    expectedCanonical: canonicalize(expected),
    actualCanonical: marker,
    reason: "mismatch" as const,
  };
}

/** A check that declares the given cases and answers each with `mismatchVerdict`. */
function mismatchCheck(id: string, caseIds: readonly string[], marker: string): EvaluatorCheck {
  return {
    id,
    title: id,
    appliesTo: caseIds,
    compare: (expected: JsonValue) => mismatchVerdict(expected, marker),
  };
}

/** Runs a call that must refuse, returning the error it threw. */
function caughtFrom(attempt: () => unknown): Error {
  try {
    attempt();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`the call refused with a non-Error value: ${String(error)}`);
  }
  throw new Error("the call returned instead of refusing");
}

/** Runs a call that must refuse with a standard-drift refusal, returning it narrowed. */
function driftFrom(attempt: () => unknown): StandardDriftError {
  const refusal = caughtFrom(attempt);
  if (!(refusal instanceof StandardDriftError)) {
    throw new Error(`expected a StandardDriftError, but ${refusal.name} was thrown`);
  }
  return refusal;
}

/** Runs a call that must refuse with an incomplete-submission refusal, returning it narrowed. */
function incompleteFrom(attempt: () => unknown): IncompleteSubmissionError {
  const refusal = caughtFrom(attempt);
  if (!(refusal instanceof IncompleteSubmissionError)) {
    throw new Error(`expected an IncompleteSubmissionError, but ${refusal.name} was thrown`);
  }
  return refusal;
}

/** Runs a call that must refuse with an unknown-case refusal, returning it narrowed. */
function unknownCaseFrom(attempt: () => unknown): UnknownCaseError {
  const refusal = caughtFrom(attempt);
  if (!(refusal instanceof UnknownCaseError)) {
    throw new Error(`expected an UnknownCaseError, but ${refusal.name} was thrown`);
  }
  return refusal;
}

/** Runs a call that must refuse with a duplicate-case refusal, returning it narrowed. */
function duplicateCaseFrom(attempt: () => unknown): DuplicateCaseError {
  const refusal = caughtFrom(attempt);
  if (!(refusal instanceof DuplicateCaseError)) {
    throw new Error(`expected a DuplicateCaseError, but ${refusal.name} was thrown`);
  }
  return refusal;
}

describe("scoreSubmission", () => {
  describe("the seed candidates, against the delivered fixture pack", () => {
    it.each(SEED_CANDIDATE_IDS)(
      "returns the expectation the pack records for %s",
      (candidateId) => {
        const caseSet = caseSetOf();
        const expected = expectedOutcomeOf(candidateId);

        const scored = scoreSubmission(STANDARD, caseSet, candidateOf(candidateId));

        expect(scored.outcome).toBe(expected.outcome);
        expect(scored.matchedCount).toBe(expected.matched_count);
        expect(scored.totalCount).toBe(expected.total_count);
        expect(scored.criticalFailures).toBe(expected.critical_failures);
        expect(scored.failingCaseIds).toEqual(expected.failing_case_ids);
      },
    );

    it("pins criterion 3's acceptance values for every seed candidate", () => {
      const caseSet = caseSetOf();

      for (const pinned of PINNED_ACCEPTANCE) {
        const scored = scoreSubmission(STANDARD, caseSet, candidateOf(pinned.candidateId));

        expect(scored.outcome).toBe(pinned.outcome);
        expect(scored.matchedCount).toBe(pinned.matchedCount);
        expect(scored.totalCount).toBe(20);
        expect(scored.criticalFailures).toBe(pinned.criticalFailures);
        expect(scored.failingCaseIds).toStrictEqual([...pinned.failingCaseIds]);
      }

      expect(PINNED_ACCEPTANCE.map((pinned) => pinned.candidateId)).toStrictEqual([
        ...SEED_CANDIDATE_IDS,
      ]);
    });

    it("reads the pack's expectations in the pack's own candidate order", () => {
      const expected = loadExpectedOutcomes();

      expect(expected.standard_version_id).toBe(STANDARD.fixtureSetId);
      expect(expected.candidates.map((entry) => entry.candidate_id)).toStrictEqual([
        "seed-alpha",
        "seed-beta",
        "seed-gamma",
      ]);
    });

    it("names the standard version it scored against and the candidate version the submission declares", () => {
      const caseSet = caseSetOf();

      for (const candidateId of SEED_CANDIDATE_IDS) {
        const candidate = candidateOf(candidateId);
        const scored = scoreSubmission(STANDARD, caseSet, candidate);

        expect(scored.standardVersionId).toBe(caseSet.standard_version_id);
        expect(scored.standardVersionId).toBe(STANDARD.versionLabel);
        expect(scored.candidateVersionId).toBe(candidate.candidate_version_id);
        expect(scored.candidateVersionId).toBe(expectedOutcomeOf(candidateId).candidate_version_id);
      }
    });

    it("scores every case of the set, in case-set order, carrying the case set's own severities", () => {
      const caseSet = caseSetOf();

      for (const candidateId of SEED_CANDIDATE_IDS) {
        const scored = scoreSubmission(STANDARD, caseSet, candidateOf(candidateId));

        expect(scored.caseResults).toHaveLength(20);
        expect(scored.totalCount).toBe(caseSet.cases.length);
        expect(scored.caseResults.map((caseResult) => caseResult.caseId)).toStrictEqual(
          caseSet.cases.map((fixtureCase) => fixtureCase.id),
        );
        expect(scored.caseResults.map((caseResult) => caseResult.severity)).toStrictEqual(
          caseSet.cases.map((fixtureCase) => fixtureCase.severity),
        );
        expect(
          scored.caseResults.filter((caseResult) => caseResult.severity === "critical"),
        ).toHaveLength(STANDARD.criticalCases);
      }
    });

    it("carries exactly the five evidence fields a report stores, and no comparison reason", () => {
      const scored = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"));

      for (const caseResult of scored.caseResults) {
        expect(Object.keys(caseResult).sort()).toEqual([
          "actualJson",
          "caseId",
          "expectedJson",
          "match",
          "severity",
        ]);
      }
    });

    it("carries exactly the eight scored fields", () => {
      const scored = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-alpha"));

      expect(Object.keys(scored).sort()).toEqual([
        "candidateVersionId",
        "caseResults",
        "criticalFailures",
        "failingCaseIds",
        "matchedCount",
        "outcome",
        "standardVersionId",
        "totalCount",
      ]);
    });

    it("stores canonical JSON text as the evidence, never the raw fixture value", () => {
      const caseSet = caseSetOf();

      const scored = scoreSubmission(STANDARD, caseSet, candidateOf("seed-beta"));

      for (const caseResult of scored.caseResults) {
        const fixtureCase = requireCase(caseSet, caseResult.caseId);
        const recorded = requireRecordedOutput(candidateOf("seed-beta"), caseResult.caseId);

        expect(caseResult.expectedJson).toBe(canonicalize(fixtureCase.expected_output));
        expect(caseResult.actualJson).toBe(canonicalize(recorded.output));
      }
    });

    it("stores the canonical text of both sides of the enum-case mismatch, differing only in the enum value", () => {
      const scored = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"));

      const failing = requireCaseResult(scored, "so-003");

      expect(failing.match).toBe(false);
      expect(failing.expectedJson).toBe('{"order_id":"demo-order-1003","status":"staged"}');
      expect(failing.actualJson).toBe('{"order_id":"demo-order-1003","status":"STAGED"}');
    });

    it("matches so-017 although the order its keys are recorded in differs from the expected output", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const fixtureCase = requireCase(caseSet, "so-017");
      const recorded = requireRecordedOutput(candidate, "so-017");

      const caseResult = requireCaseResult(
        scoreSubmission(STANDARD, caseSet, candidate),
        "so-017",
      );

      // Deliberate, and not to be "corrected": the raw JSON text of the two sides differs only in the
      // order the keys are written, so this case matches solely because the comparison is over
      // canonical JSON rather than over the text either side was authored in.
      expect(JSON.stringify(recorded.output)).not.toBe(JSON.stringify(fixtureCase.expected_output));
      expect(caseResult.match).toBe(true);
      expect(caseResult.actualJson).toBe(caseResult.expectedJson);
    });

    it("reports a matched case as equal canonical evidence and an unmatched case as differing evidence", () => {
      const scored = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"));
      const failingCaseId = scored.failingCaseIds[0];
      if (failingCaseId === undefined) {
        throw new Error("seed-beta is expected to fail at least one case");
      }
      const matching = scored.caseResults.find((caseResult) => caseResult.match);
      if (matching === undefined) {
        throw new Error("seed-beta is expected to match at least one case");
      }

      const failing = requireCaseResult(scored, failingCaseId);
      expect(failing.match).toBe(false);
      expect(failing.actualJson).not.toBe(failing.expectedJson);
      expect(matching.match).toBe(true);
      expect(matching.actualJson).toBe(matching.expectedJson);
      expect(scored.criticalFailures).toBe(1);
      expect(requireCase(caseSetOf(), failingCaseId).severity).toBe("critical");
    });

    it("returns the failing case ids ascending even when a submission records its outputs out of order", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-gamma");
      const reversed = withRecordedOutputs(candidate, [...candidate.recorded_outputs].reverse());

      const scored = scoreSubmission(STANDARD, caseSet, reversed);

      expect(scored.caseResults.map((caseResult) => caseResult.caseId)).toEqual(
        caseSet.cases.map((fixtureCase) => fixtureCase.id),
      );
      expect([...scored.failingCaseIds]).toEqual([...scored.failingCaseIds].sort());
    });
  });

  describe("reproducibility and purity", () => {
    it("returns deeply equal results for two independent runs over the same submission", () => {
      const first = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"));
      const second = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"));

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first.caseResults).not.toBe(second.caseResults);
      expect(first.failingCaseIds).not.toBe(second.failingCaseIds);
    });

    it("returns byte-identical per-case results and the same outcome for two runs of every seed candidate", () => {
      for (const candidateId of SEED_CANDIDATE_IDS) {
        const first = scoreSubmission(STANDARD, caseSetOf(), candidateOf(candidateId));
        const second = scoreSubmission(STANDARD, caseSetOf(), candidateOf(candidateId));

        expect(second.caseResults).toStrictEqual(first.caseResults);
        expect(second.outcome).toBe(first.outcome);
        expect(second).toStrictEqual(first);
      }
    });

    it("compares every per-case evidence string equally across two runs", () => {
      for (const candidateId of SEED_CANDIDATE_IDS) {
        const evidenceOf = () =>
          scoreSubmission(STANDARD, caseSetOf(), candidateOf(candidateId)).caseResults.map(
            (caseResult) => ({
              caseId: caseResult.caseId,
              expectedJson: caseResult.expectedJson,
              actualJson: caseResult.actualJson,
              match: caseResult.match,
            }),
          );

        expect(evidenceOf()).toStrictEqual(evidenceOf());
      }
    });

    it("leaves the standard version, the case set and the submission as they were", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-gamma");
      const checks: EvaluatorCheck[] = [mismatchCheck("unused-check", ["no-such-case"], "never")];
      const caseSetBefore = structuredClone(caseSet);
      const candidateBefore = structuredClone(candidate);
      const standardBefore = structuredClone(STANDARD);
      const checksBefore = [...checks];

      scoreSubmission(STANDARD, caseSet, candidate, { checks });

      expect(caseSet).toStrictEqual(caseSetBefore);
      expect(candidate).toStrictEqual(candidateBefore);
      expect(STANDARD).toStrictEqual(standardBefore);
      expect(checks).toStrictEqual(checksBefore);
    });

    it("reports the same results whether no options are passed or options without checks are", () => {
      const withoutOptions = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"));
      const withEmptyOptions = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"), {});
      const withEmptyChecks = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-beta"), {
        checks: [],
      });

      expect(withEmptyOptions).toEqual(withoutOptions);
      expect(withEmptyChecks).toEqual(withoutOptions);
    });
  });

  describe("the pass rule, read from the standard version", () => {
    it("passes a candidate the shipped threshold fails once the threshold is relaxed", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-gamma");
      const shipped = scoreSubmission(STANDARD, caseSet, candidate);
      expect(shipped.outcome).toBe("FAIL");
      expect(shipped.matchedCount).toBeLessThan(STANDARD.passThresholdMatches);

      const relaxed: StandardVersionDefinition = {
        ...STANDARD,
        passThresholdMatches: shipped.matchedCount,
      };

      // The boundary, stated without restating a number: the candidate matched exactly one case
      // fewer than the shipped threshold, and passes the moment the versioned threshold is lowered
      // to the count it reached. Only the standard version differs between the two runs.
      expect(shipped.matchedCount + 1).toBe(STANDARD.passThresholdMatches);
      expect(shipped.criticalFailures).toBe(0);
      expect(scoreSubmission(relaxed, caseSet, candidate).outcome).toBe("PASS");
      expect(shipped.outcome).toBe("FAIL");
    });

    it("passes a candidate whose only failures are critical once that allowance is relaxed", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-beta");
      const shipped = scoreSubmission(STANDARD, caseSet, candidate);
      expect(shipped.outcome).toBe("FAIL");
      expect(shipped.matchedCount).toBeGreaterThanOrEqual(STANDARD.passThresholdMatches);
      expect(shipped.criticalFailures).toBeGreaterThan(STANDARD.criticalFailuresAllowed);

      const tolerant: StandardVersionDefinition = {
        ...STANDARD,
        criticalFailuresAllowed: shipped.criticalFailures,
      };

      // Only the versioned tolerance for a critical failure differs between the two runs: the
      // matched count clears the threshold in both, so the critical clause alone decides the pair.
      expect(scoreSubmission(tolerant, caseSet, candidate).outcome).toBe("PASS");
      expect(shipped.matchedCount).toBe(19);
      expect(shipped.criticalFailures).toBe(1);
    });

    it("fails a candidate that misses the threshold although no critical case failed", () => {
      const scored = scoreSubmission(STANDARD, caseSetOf(), candidateOf("seed-gamma"));

      expect(scored.matchedCount).toBeLessThan(STANDARD.passThresholdMatches);
      expect(scored.criticalFailures).toBe(STANDARD.criticalFailuresAllowed);
      expect(scored.outcome).toBe("FAIL");
    });
  });

  // Every refusal below reads `code` from the `StandardDriftError` this package's standards registry
  // declares — imported above and never redefined in this folder — which is what lets
  // `apps/api/src/errors/error-codes.ts` map one code to one contract status.
  describe("drift refusals", () => {
    it("refuses a case set that belongs to another standard version", () => {
      const caseSet = caseSetOf();
      const foreign = { ...caseSet, standard_version_id: `${caseSet.standard_version_id}-next` };

      const refusal = driftFrom(() => scoreSubmission(STANDARD, foreign, candidateOf("seed-alpha")));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.standardVersionId).toBe(STANDARD.versionLabel);
      expect(refusal.message).toContain(foreign.standard_version_id);
    });

    it("refuses a submission declared against another standard version", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const foreign = { ...candidate, standard_version_id: `${caseSet.standard_version_id}-next` };

      const refusal = driftFrom(() => scoreSubmission(STANDARD, caseSet, foreign));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.message).toContain(foreign.standard_version_id);
    });

    it("refuses a case set whose published case count is not the version's", () => {
      const caseSet = caseSetOf();
      const resized = { ...caseSet, total_cases: caseSet.total_cases - 1 };

      const refusal = driftFrom(() => scoreSubmission(STANDARD, resized, candidateOf("seed-alpha")));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.message).toContain(String(STANDARD.totalCases));
    });

    it("refuses a case set whose published critical count is not the version's", () => {
      const caseSet = caseSetOf();
      const critical = firstCriticalCase(caseSet);
      const demoted = withCases(
        caseSet,
        caseSet.cases.map((candidateCase) =>
          candidateCase.id === critical.id
            ? { ...candidateCase, severity: "standard" as const }
            : candidateCase,
        ),
      );
      const resized = { ...demoted, critical_cases: caseSet.critical_cases - 1 };

      const refusal = driftFrom(() => scoreSubmission(STANDARD, resized, candidateOf("seed-alpha")));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.message).toContain(String(STANDARD.criticalCases));
    });

    it("refuses a case set whose cases array disagrees with its own case count", () => {
      const caseSet = caseSetOf();
      const dropped = firstStandardCase(caseSet);
      const truncated = withCases(
        caseSet,
        caseSet.cases.filter((candidateCase) => candidateCase.id !== dropped.id),
      );

      const refusal = driftFrom(() => scoreSubmission(STANDARD, truncated, candidateOf("seed-alpha")));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.message).toContain(caseSet.standard_version_id);
    });

    it("refuses a case set whose critical cases disagree with its own critical count", () => {
      const caseSet = caseSetOf();
      const critical = firstCriticalCase(caseSet);
      const demoted = withCases(
        caseSet,
        caseSet.cases.map((candidateCase) =>
          candidateCase.id === critical.id
            ? { ...candidateCase, severity: "standard" as const }
            : candidateCase,
        ),
      );

      const refusal = driftFrom(() => scoreSubmission(STANDARD, demoted, candidateOf("seed-alpha")));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.message).toContain(String(caseSet.critical_cases));
    });

    it("refuses a standard version whose declared case count is not the case set's", () => {
      const caseSet = caseSetOf();
      const resized: StandardVersionDefinition = {
        ...STANDARD,
        totalCases: STANDARD.totalCases - 1,
      };

      const refusal = driftFrom(() => scoreSubmission(resized, caseSet, candidateOf("seed-alpha")));

      expect(refusal.code).toBe("standard_drift");
      expect(refusal.standardVersionId).toBe(resized.versionLabel);
      expect(refusal.message).toContain(String(resized.totalCases));
    });
  });

  describe("structural refusals", () => {
    it("refuses a recorded output for a case the case set does not define", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const unknownCaseId = "so-999";
      const extended = withRecordedOutputs(candidate, [
        ...candidate.recorded_outputs,
        { case_id: unknownCaseId, output: null },
      ]);

      const refusal = unknownCaseFrom(() => scoreSubmission(STANDARD, caseSet, extended));

      expect(refusal).toBeInstanceOf(UnknownCaseError);
      expect(refusal.code).toBe("unknown_case");
      expect(refusal.caseId).toBe("so-999");
      expect(refusal.message).toContain(unknownCaseId);
    });

    it("refuses a repeated recorded output for one case", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const repeated = requireRecordedOutput(candidate, firstCase(caseSet).id);
      const extended = withRecordedOutputs(candidate, [...candidate.recorded_outputs, repeated]);

      const refusal = duplicateCaseFrom(() => scoreSubmission(STANDARD, caseSet, extended));

      expect(refusal.code).toBe("duplicate_case");
      expect(refusal.caseId).toBe(repeated.case_id);
      expect(refusal.message).toContain(repeated.case_id);
    });

    it("reports the first offending recording in submission order", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const [first, second] = candidate.recorded_outputs;
      if (first === undefined || second === undefined) {
        throw new Error("seed-alpha is expected to record at least two outputs");
      }
      const unknownCaseId = `${firstCase(caseSet).id}-absent`;

      const unknownFirst = withRecordedOutputs(candidate, [
        { case_id: unknownCaseId, output: null },
        first,
        first,
      ]);
      const duplicateFirst = withRecordedOutputs(candidate, [first, first, { case_id: unknownCaseId, output: null }]);

      expect(unknownCaseFrom(() => scoreSubmission(STANDARD, caseSet, unknownFirst)).caseId).toBe(
        unknownCaseId,
      );
      expect(duplicateCaseFrom(() => scoreSubmission(STANDARD, caseSet, duplicateFirst)).caseId).toBe(
        first.case_id,
      );
    });

    it("answers a malformed submission rather than an incomplete one", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const droppedCaseId = firstCase(caseSet).id;
      const unknownCaseId = `${droppedCaseId}-absent`;
      const bothDefects = withRecordedOutputs(
        withoutRecordingsFor(candidate, [droppedCaseId]),
        [...withoutRecordingsFor(candidate, [droppedCaseId]).recorded_outputs, { case_id: unknownCaseId, output: null }],
      );

      const refusal = unknownCaseFrom(() => scoreSubmission(STANDARD, caseSet, bothDefects));

      expect(refusal.caseId).toBe(unknownCaseId);
      expect(refusal).not.toBeInstanceOf(IncompleteSubmissionError);
    });
  });

  describe("the completeness refusal", () => {
    it("names the missing cases in case-set order and carries the code the route maps to 422", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const missing = [firstCriticalCase(caseSet), firstStandardCase(caseSet)];

      const refusal = incompleteFrom(() =>
        scoreSubmission(STANDARD, caseSet, withoutRecordingsFor(candidate, missing.map((c) => c.id))),
      );

      expect(refusal.code).toBe("incomplete_submission");
      expect(refusal.missingCaseIds).toEqual(
        caseSet.cases
          .filter((fixtureCase) => missing.some((held) => held.id === fixtureCase.id))
          .map((fixtureCase) => fixtureCase.id),
      );
      expect(refusal.message).toContain(refusal.missingCaseIds.join(", "));
    });

    it("names a case the submission left unrecorded and lists every missing id in case-set order", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");

      const single = incompleteFrom(() =>
        scoreSubmission(STANDARD, caseSet, withoutRecordingsFor(candidate, ["so-014"])),
      );

      expect(single).toBeInstanceOf(IncompleteSubmissionError);
      expect(single.code).toBe("incomplete_submission");
      expect(single.missingCaseIds).toStrictEqual(["so-014"]);

      // The missing ids are reported in case-set order rather than in the order the caller dropped
      // them, because the refusal is composed from the case set and never from the submission.
      expect(() =>
        scoreSubmission(STANDARD, caseSet, withoutRecordingsFor(candidate, ["so-018", "so-014"])),
      ).toThrow(IncompleteSubmissionError);
      expect(
        incompleteFrom(() =>
          scoreSubmission(STANDARD, caseSet, withoutRecordingsFor(candidate, ["so-018", "so-014"])),
        ).missingCaseIds,
      ).toStrictEqual(["so-014", "so-018"]);
    });

    it("refuses a submission whose only missing case is critical rather than failing it", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const critical = firstCriticalCase(caseSet);

      const refusal = incompleteFrom(() =>
        scoreSubmission(STANDARD, caseSet, withoutRecordingsFor(candidate, [critical.id])),
      );

      expect(refusal.missingCaseIds).toEqual([critical.id]);
      expect(critical.severity).toBe("critical");
    });

    it("refuses a submission that records nothing at all", () => {
      const caseSet = caseSetOf();
      const empty = withRecordedOutputs(candidateOf("seed-alpha"), []);

      const refusal = incompleteFrom(() => scoreSubmission(STANDARD, caseSet, empty));

      expect(refusal.missingCaseIds).toEqual(caseSet.cases.map((fixtureCase) => fixtureCase.id));
    });
  });

  describe("the refusal classes", () => {
    it("read back their name, their code and the case ids a route answers with", () => {
      const incomplete = new IncompleteSubmissionError(["so-001", "so-014"]);
      const unknown = new UnknownCaseError("so-999");
      const duplicate = new DuplicateCaseError("so-014");

      expect(incomplete).toBeInstanceOf(Error);
      expect(incomplete.name).toBe("IncompleteSubmissionError");
      expect(incomplete.code).toBe("incomplete_submission");
      expect(incomplete.missingCaseIds).toEqual(["so-001", "so-014"]);
      expect(unknown.name).toBe("UnknownCaseError");
      expect(unknown.code).toBe("unknown_case");
      expect(unknown.caseId).toBe("so-999");
      expect(duplicate.name).toBe("DuplicateCaseError");
      expect(duplicate.code).toBe("duplicate_case");
      expect(duplicate.caseId).toBe("so-014");
    });
  });

  describe("the EvaluatorCheck seam", () => {
    it("replaces the verdict for exactly the cases it declares", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-gamma");
      const declared = firstCase(caseSet);
      const baseline = scoreSubmission(STANDARD, caseSet, candidate);
      const marker = "check-declared-mismatch";
      let calls = 0;
      const check: EvaluatorCheck = {
        id: "strict-first-case",
        title: "Strict first case",
        appliesTo: [declared.id],
        compare: (expected) => {
          calls += 1;
          return mismatchVerdict(expected, marker);
        },
      };

      const scored = scoreSubmission(STANDARD, caseSet, candidate, { checks: [check] });

      expect(calls).toBe(1);
      expect(requireCaseResult(scored, declared.id).actualJson).toBe(marker);
      expect(requireCaseResult(scored, declared.id).expectedJson).toBe(
        canonicalize(declared.expected_output),
      );
      expect(scored.caseResults.filter((caseResult) => caseResult.caseId !== declared.id)).toEqual(
        baseline.caseResults.filter((caseResult) => caseResult.caseId !== declared.id),
      );
      expect(scored.matchedCount).toBe(baseline.matchedCount - 1);
      expect(scored.failingCaseIds).toEqual([...baseline.failingCaseIds, declared.id].sort());
    });

    it("lets a contributed verdict rescue the case the built-in comparison failed", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-beta");
      const builtIn = scoreSubmission(STANDARD, caseSet, candidate);
      expect(builtIn.outcome).toBe("FAIL");
      expect(builtIn.matchedCount).toBe(19);
      expect(builtIn.criticalFailures).toBe(1);
      expect(builtIn.failingCaseIds).toStrictEqual(["so-003"]);

      const alwaysMatch: EvaluatorCheck = {
        id: "check-always-match",
        title: "Always match",
        appliesTo: ["so-003"],
        compare: () => ({
          match: true,
          expectedCanonical: "x",
          actualCanonical: "x",
          reason: "match",
        }),
      };

      const scored = scoreSubmission(STANDARD, caseSet, candidate, { checks: [alwaysMatch] });

      expect(scored.outcome).toBe("PASS");
      expect(scored.matchedCount).toBe(20);
      expect(scored.criticalFailures).toBe(0);
      expect(scored.failingCaseIds).toStrictEqual([]);
    });

    it("leaves the cases a check does not declare on the built-in canonical path", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-gamma");
      const builtIn = scoreSubmission(STANDARD, caseSet, candidate);
      const declared = requireCaseResult(builtIn, "so-003");
      expect(declared.match).toBe(true);

      const check: EvaluatorCheck = {
        id: "declares-so-003",
        title: "Declares so-003",
        appliesTo: ["so-003"],
        compare: () => ({
          match: declared.match,
          expectedCanonical: declared.expectedJson,
          actualCanonical: declared.actualJson,
          reason: "match",
        }),
      };

      const scored = scoreSubmission(STANDARD, caseSet, candidate, { checks: [check] });

      // The declared case is answered by the check and the other nineteen stay canonical, so the
      // three failures the check says nothing about are still the ones the built-in run reports.
      expect(scored).toStrictEqual(builtIn);
      expect(scored.failingCaseIds).toStrictEqual(["so-014", "so-016", "so-018"]);
    });

    it("consults the first check in the list that declares a case, and lets its verdict decide the outcome", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const declared = firstCase(caseSet);
      const first: EvaluatorCheck = {
        id: "first-declaring",
        title: "First declaring",
        appliesTo: [declared.id],
        compare: () => ({
          match: true,
          expectedCanonical: "first-marker",
          actualCanonical: "first-marker",
          reason: "match",
        }),
      };
      const second = mismatchCheck("second-declaring", [declared.id], "second-marker");

      const scored = scoreSubmission(STANDARD, caseSet, candidate, { checks: [first, second] });

      // The second check would have failed this critical case and put the candidate at FAIL, so the
      // verdict the first check reports is what decides both the evidence and the outcome.
      expect(requireCaseResult(scored, declared.id).actualJson).toBe("first-marker");
      expect(scored.outcome).toBe("PASS");
      expect(scored.matchedCount).toBe(20);
      expect(declared.severity).toBe("critical");
    });

    it("lets a contributed verdict reach the outcome the report records", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      const declared = firstCase(caseSet);
      const baseline = scoreSubmission(STANDARD, caseSet, candidate);
      expect(baseline.outcome).toBe("PASS");

      const scored = scoreSubmission(STANDARD, caseSet, candidate, {
        checks: [mismatchCheck("strict-first-case", [declared.id], "first-marker")],
      });

      expect(declared.severity).toBe("critical");
      expect(scored.outcome).toBe("FAIL");
      expect(scored.criticalFailures).toBe(1);
      expect(scored.matchedCount).toBe(baseline.matchedCount - 1);
    });

    it("leaves every case on the canonical path for a check that declares no case", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-beta");
      const builtIn = scoreSubmission(STANDARD, caseSet, candidate);
      let calls = 0;
      const inert: EvaluatorCheck = {
        id: "declares-no-case",
        title: "Declares no case",
        appliesTo: [],
        compare: () => {
          calls += 1;
          return { match: true, expectedCanonical: "x", actualCanonical: "x", reason: "match" };
        },
      };

      const scored = scoreSubmission(STANDARD, caseSet, candidate, { checks: [inert] });

      // A check with no declared case is inert rather than global: it is never consulted, so the run
      // is the built-in one.
      expect(calls).toBe(0);
      expect(scored).toStrictEqual(builtIn);
    });

    it("lets an error a check throws propagate rather than scoring the case as a match", () => {
      const caseSet = caseSetOf();
      const candidate = candidateOf("seed-alpha");
      // The rule is refuse rather than pass: nothing here catches or swallows the defect, because a
      // contribution that fails loudly must never be scored as a match.
      const defect = new Error("contribution defect");
      const check: EvaluatorCheck = {
        id: "defective-check",
        title: "Defective check",
        appliesTo: [firstCase(caseSet).id],
        compare: () => {
          throw defect;
        },
      };

      let thrown: unknown = "the call returned instead of refusing";
      try {
        scoreSubmission(STANDARD, caseSet, candidate, { checks: [check] });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBe(defect);
    });
  });
});
