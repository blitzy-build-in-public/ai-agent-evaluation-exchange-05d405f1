import { describe, expect, it } from "vitest";

import { loadCandidate, loadCaseSet } from "@adem/sgi-fixtures";
import type { JsonValue } from "@adem/sgi-fixtures";

import { canonicalize } from "../scoring/canonical-json";
import { compareRecordedOutput } from "../scoring/compare-recorded-output";
import type { CaseComparison } from "../scoring/compare-recorded-output";
import { scoreSubmission } from "../scoring/score-submission";
import type { CaseResult, ScoredSubmission } from "../scoring/score-submission";
import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";
import { EvaluatorCheckValidationError, validateEvaluatorCheck } from "./evaluator-check";
import type { EvaluatorCheck } from "./evaluator-check";

/**
 * A check that satisfies every rule, used as the base for each refusal case so that only the member
 * under test differs. Its `compare` delegates to the canonical comparison, which is what a
 * contributed check that adds no rule of its own does.
 */
const validCheck: EvaluatorCheck = {
  id: "example-evaluator-check",
  title: "Example evaluator check",
  appliesTo: ["so-001"],
  compare: (expected, actual) => compareRecordedOutput(expected, actual),
};

/** Runs the guard and returns the typed refusal, failing the test if it did not throw one. */
function catchSeamError(candidate: unknown): EvaluatorCheckValidationError {
  try {
    validateEvaluatorCheck(candidate);
  } catch (error) {
    if (error instanceof EvaluatorCheckValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected validateEvaluatorCheck to refuse the candidate");
}

describe("validateEvaluatorCheck", () => {
  it("accepts a well-formed check and returns the very same object", () => {
    const validated = validateEvaluatorCheck(validCheck);

    expect(validated).toBe(validCheck);
    expect(Object.isFrozen(validated)).toBe(false);
    expect(validated.id).toBe("example-evaluator-check");
    expect(validated.title).toBe("Example evaluator check");
    expect(validated.appliesTo).toEqual(["so-001"]);
    expect(validated.compare("recorded", "recorded")).toEqual(
      compareRecordedOutput("recorded", "recorded"),
    );
  });

  it("accepts a plain object whose compare is a shorthand method", () => {
    const check = {
      id: "method-check",
      title: "Method check",
      appliesTo: ["so-001"],
      compare(expected: JsonValue, actual: JsonValue | undefined): CaseComparison {
        return compareRecordedOutput(expected, actual);
      },
    };

    const validated = validateEvaluatorCheck(check);
    const comparison = validated.compare({ status: "received" }, { status: "received" });

    expect(validated).toBe(check);
    expect(Object.keys(comparison).sort()).toEqual([
      "actualCanonical",
      "expectedCanonical",
      "match",
      "reason",
    ]);
    expect(comparison).toEqual(compareRecordedOutput({ status: "received" }, { status: "received" }));
  });

  it("returns the same object without rewriting padded text members", () => {
    const candidate = {
      id: "  padded-check  ",
      title: "  Padded title  ",
      appliesTo: ["  so-001  "],
      compare: (expected: JsonValue, actual: JsonValue | undefined): CaseComparison =>
        compareRecordedOutput(expected, actual),
    };

    const validated = validateEvaluatorCheck(candidate);

    expect(validated).toBe(candidate);
    expect(validated.id).toBe("  padded-check  ");
    expect(validated.title).toBe("  Padded title  ");
    expect(validated.appliesTo).toEqual(["  so-001  "]);
  });

  it("leaves extra properties untouched", () => {
    const candidate = { ...validCheck, registryNote: "contributed by a community extension" };

    const validated = validateEvaluatorCheck(candidate);

    expect(validated).toBe(candidate);
    expect(validated).toHaveProperty("registryNote", "contributed by a community extension");
  });

  it("accepts a repeated case id inside appliesTo", () => {
    // The seam's first-match rule makes a repeat inert, so a repeated id is a registration that works
    // rather than one the guard refuses.
    const candidate = { ...validCheck, appliesTo: ["so-001", "so-001"] };

    const validated = validateEvaluatorCheck(candidate);

    expect(validated).toBe(candidate);
    expect(validated.appliesTo).toEqual(["so-001", "so-001"]);
  });

  it.each([null, undefined, 42, "example-evaluator-check", true])(
    "refuses the non-object candidate %o on id",
    (candidate) => {
      const error = catchSeamError(candidate);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(EvaluatorCheckValidationError);
      expect(error.name).toBe("EvaluatorCheckValidationError");
      expect(error.code).toBe("seam_validation");
      expect(error.field).toBe("id");
      expect(error.message).toContain("id");
    },
  );

  it("refuses an array candidate on id rather than on a positional member", () => {
    // An empty array is not refused as a non-object: `typeof []` is "object" and it is not null, so the
    // guard reads its absent `id` and reports that member.
    const error = catchSeamError([]);

    expect(error).toBeInstanceOf(EvaluatorCheckValidationError);
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("id");
  });

  it("refuses an empty object on id rather than on a sentinel field", () => {
    const error = catchSeamError({});

    expect(error.field).toBe("id");
  });

  it("refuses a check whose id is absent", () => {
    const error = catchSeamError({
      title: validCheck.title,
      appliesTo: validCheck.appliesTo,
      compare: validCheck.compare,
    });

    expect(error.field).toBe("id");
  });

  it.each([
    { override: { id: "" }, label: "empty" },
    { override: { id: "   " }, label: "whitespace-only" },
    { override: { id: 42 }, label: "numeric" },
    { override: { id: null }, label: "null" },
    { override: { id: ["example-evaluator-check"] }, label: "array-valued" },
  ])("refuses a $label id", ({ override }) => {
    const error = catchSeamError({ ...validCheck, ...override });

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("id");
    expect(error.message).toContain("id");
    expect(error.message).toContain("EvaluatorCheck");
  });

  it.each([
    { override: { title: "" }, label: "empty" },
    { override: { title: " " }, label: "whitespace-only" },
    { override: { title: null }, label: "null" },
    { override: { title: ["Example evaluator check"] }, label: "array-valued" },
  ])("refuses a $label title", ({ override }) => {
    const error = catchSeamError({ ...validCheck, ...override });

    expect(error.name).toBe("EvaluatorCheckValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("title");
    expect(error.message).toContain("title");
    expect(error.message).toContain("EvaluatorCheck");
  });

  it.each([
    { override: { appliesTo: undefined }, label: "absent" },
    { override: { appliesTo: "so-001" }, label: "string-valued" },
    { override: { appliesTo: 42 }, label: "numeric" },
    { override: { appliesTo: null }, label: "null" },
    { override: { appliesTo: [] }, label: "empty" },
    { override: { appliesTo: [42] }, label: "holding a numeric id" },
    { override: { appliesTo: [""] }, label: "holding an empty id" },
    { override: { appliesTo: ["   "] }, label: "holding a whitespace-only id" },
    { override: { appliesTo: ["so-001", null] }, label: "holding a null id" },
    { override: { appliesTo: ["so-001", 7] }, label: "holding a numeric id alongside a valid one" },
  ])("refuses an appliesTo that is $label", ({ override }) => {
    const error = catchSeamError({ ...validCheck, ...override });

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("appliesTo");
    expect(error.message).toContain("appliesTo");
    expect(error.message).toContain("EvaluatorCheck");
  });

  it.each([
    { override: { compare: undefined }, label: "absent" },
    { override: { compare: 42 }, label: "numeric" },
    { override: { compare: "compare" }, label: "string-valued" },
    { override: { compare: { match: true } }, label: "object-valued" },
  ])("refuses a $label compare", ({ override }) => {
    const error = catchSeamError({ ...validCheck, ...override });

    expect(error.name).toBe("EvaluatorCheckValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("compare");
    expect(error.message).toContain("compare");
    expect(error.message).toContain("EvaluatorCheck");
  });

  it("reports id first when id and title both fail", () => {
    const error = catchSeamError({ ...validCheck, id: "", title: "" });

    expect(error.field).toBe("id");
  });

  it("reports title first when title and compare both fail", () => {
    const error = catchSeamError({ ...validCheck, title: " ", compare: 42 });

    expect(error.field).toBe("title");
  });

  it("reports appliesTo before compare when both fail", () => {
    const error = catchSeamError({ ...validCheck, appliesTo: [], compare: 42 });

    expect(error.field).toBe("appliesTo");
  });

  it("composes a message that names the member and the seam", () => {
    const error = catchSeamError({ ...validCheck, appliesTo: [] });

    expect(error.message).toBe(
      'EvaluatorCheck field "appliesTo" must be a non-empty array of non-empty strings.',
    );
  });

  it("does not call the check's compare while validating it", () => {
    // A registration is validated without running the contributor's function, so validation cannot
    // depend on the caller's state or surface a scoring failure at registration time.
    let calls = 0;
    const check = {
      id: "uncalled-check",
      title: "Uncalled check",
      appliesTo: ["so-001"],
      compare: (expected: JsonValue, actual: JsonValue | undefined): CaseComparison => {
        calls += 1;
        return compareRecordedOutput(expected, actual);
      },
    };

    const validated = validateEvaluatorCheck(check);

    expect(validated).toBe(check);
    expect(calls).toBe(0);
  });

  it("accepts a check whose compare returns something other than a comparison", () => {
    // What a verdict must look like for its case is a scoring concern, so the guard checks the shape of
    // a registration only and leaves the return value to the scoring path that consumes it.
    const check = {
      id: "loose-check",
      title: "Loose check",
      appliesTo: ["so-001"],
      compare: () => ({ match: true }),
    };

    const validated = validateEvaluatorCheck(check);

    expect(validated).toBe(check);
  });
});

describe("a validated check, scored through the seam", () => {
  const caseSet = loadCaseSet(SGI_SO_1_0_0.fixtureSetId);
  const submission = loadCandidate("seed-alpha");

  /**
   * The case the check below declares. It has to be a case the canonical comparison matches and one
   * whose failure is not `critical`, or the assertion on the outcome could not tell a check that
   * changes one verdict from a check that changes the pass rule.
   *
   * `seed-alpha` records `so-017`'s four keys in a different order from the expected output, a
   * difference no reader of the JSON can observe, so the canonical comparison matches it.
   */
  const DECLARED_CASE_ID = "so-017";

  /**
   * A check that refuses every recording for the case it declares, built through the guard rather than
   * written as a bare literal so that its verdict travels the seam's whole path: registration, then
   * `ScoreSubmissionOptions.checks`.
   *
   * Its verdict carries both canonical strings, which is what keeps a report's per-case evidence
   * intact when a contributed check answers a case.
   */
  const refusingCheck = validateEvaluatorCheck({
    id: "community-check",
    title: "Recording-shape check",
    appliesTo: [DECLARED_CASE_ID],
    compare: (expected: JsonValue, actual: JsonValue | undefined): CaseComparison => ({
      match: false,
      expectedCanonical: canonicalize(expected),
      actualCanonical: actual === undefined ? "" : canonicalize(actual),
      reason: "mismatch",
    }),
  });

  /** The run the product itself performs: no checks, so the canonical comparison decides every case. */
  const builtIn = scoreSubmission(SGI_SO_1_0_0, caseSet, submission);

  /** The same submission, with the one declared case answered by a contributed check. */
  const checked = scoreSubmission(SGI_SO_1_0_0, caseSet, submission, { checks: [refusingCheck] });

  /** The result for one case, failing the test rather than reading an absent result as `undefined`. */
  function resultFor(scored: ScoredSubmission, caseId: string): CaseResult {
    const found = scored.caseResults.find((caseResult) => caseResult.caseId === caseId);

    if (found === undefined) {
      throw new Error(`the scored run carries no result for case "${caseId}"`);
    }

    return found;
  }

  it("matches every case when no check is supplied, which is what the checked run is compared to", () => {
    expect(builtIn.matchedCount).toBe(caseSet.total_cases);
    expect(builtIn.totalCount).toBe(caseSet.total_cases);
    expect(builtIn.criticalFailures).toBe(0);
    expect(builtIn.failingCaseIds).toEqual([]);
    expect(builtIn.outcome).toBe("PASS");
  });

  it("fails the case the check declares and leaves that case's evidence as it was", () => {
    const declaredBuiltIn = resultFor(builtIn, DECLARED_CASE_ID);
    const declared = resultFor(checked, DECLARED_CASE_ID);

    // The built-in comparison matches this case although its keys are recorded in another order, so the
    // non-match below can only come from the contributed check.
    expect(declaredBuiltIn.match).toBe(true);
    expect(declared.match).toBe(false);

    // Field for field the same result, apart from the verdict: the check reported the canonical text of
    // both sides, so the evidence a report stores is unchanged by who decided the case.
    expect(declared).toEqual({ ...declaredBuiltIn, match: false });
  });

  it("loses exactly one match and leaves the outcome to the versioned thresholds", () => {
    // The pass rule is read from `SGI_SO_1_0_0`'s own fields rather than from a literal here: the check
    // changes one case's verdict, and the standard version's `passThresholdMatches` and
    // `criticalFailuresAllowed` still decide `PASS`/`FAIL`, which is what makes a contributed check an
    // addition to the scoring path rather than a change to it. The declared case is a `standard`
    // severity one, so the single lost match adds no critical failure and the surviving count still
    // clears the threshold the version publishes.
    expect(resultFor(checked, DECLARED_CASE_ID).severity).toBe("standard");

    expect(checked.matchedCount).toBe(builtIn.matchedCount - 1);
    expect(checked.criticalFailures).toBe(0);
    expect(checked.failingCaseIds).toEqual([DECLARED_CASE_ID]);
    expect(checked.matchedCount).toBeGreaterThanOrEqual(SGI_SO_1_0_0.passThresholdMatches);
    expect(checked.outcome).toBe("PASS");
  });

  it("leaves every case the check does not declare exactly as the built-in run scored it", () => {
    const others = checked.caseResults.filter(
      (caseResult) => caseResult.caseId !== DECLARED_CASE_ID,
    );
    const othersBuiltIn = builtIn.caseResults.filter(
      (caseResult) => caseResult.caseId !== DECLARED_CASE_ID,
    );

    // Every case but the declared one, in the same order and with the same verdict: a check is consulted
    // for exactly the cases it declares and for no others.
    expect(others).toHaveLength(caseSet.total_cases - 1);
    expect(others).toEqual(othersBuiltIn);
  });
});
