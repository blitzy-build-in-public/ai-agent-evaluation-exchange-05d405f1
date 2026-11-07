import { describe, expect, it } from "vitest";

import { loadCandidate, loadCaseSet } from "@adem/sgi-fixtures";
import type { CandidateSubmission, FixtureCase, JsonValue } from "@adem/sgi-fixtures";

import { canonicalize } from "../scoring/canonical-json";
import { compareRecordedOutput } from "../scoring/compare-recorded-output";
import type { CaseComparison } from "../scoring/compare-recorded-output";
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

describe("the evaluator-check seam", () => {
  const caseSet = loadCaseSet(SGI_SO_1_0_0.fixtureSetId);
  const alpha = loadCandidate("seed-alpha");

  /** The output a candidate recorded for one case, or `undefined` when it recorded none. */
  function recordedFor(candidate: CandidateSubmission, caseId: string): JsonValue | undefined {
    return candidate.recorded_outputs.find((recorded) => recorded.case_id === caseId)?.output;
  }

  /**
   * Decides one case the way the scoring path does when it is handed one check: the check answers the
   * cases it declares, and the canonical comparison answers the rest.
   */
  function decide(fixtureCase: FixtureCase, check?: EvaluatorCheck): CaseComparison {
    const recorded = recordedFor(alpha, fixtureCase.id);

    if (check !== undefined && check.appliesTo.includes(fixtureCase.id)) {
      return check.compare(fixtureCase.expected_output, recorded);
    }

    return compareRecordedOutput(fixtureCase.expected_output, recorded);
  }

  /** A check that refuses a recording which is not a JSON array, its own rule on top of canonical equality. */
  function arrayOnlyCheck(caseId: string): EvaluatorCheck {
    return validateEvaluatorCheck({
      id: "array-only-check",
      title: "Array-only recording check",
      appliesTo: [caseId],
      compare: (expected: JsonValue, actual: JsonValue | undefined): CaseComparison => {
        const expectedCanonical = canonicalize(expected);

        if (actual === undefined) {
          return { match: false, expectedCanonical, actualCanonical: "", reason: "absent" };
        }

        const actualCanonical = canonicalize(actual);
        const match = Array.isArray(actual) && actualCanonical === expectedCanonical;

        return { match, expectedCanonical, actualCanonical, reason: match ? "match" : "mismatch" };
      },
    });
  }

  it("accepts the shipped fixture values, so a delegating check reproduces the canonical verdicts", () => {
    const delegating = validateEvaluatorCheck({
      id: "delegating-check",
      title: "Delegating check",
      appliesTo: caseSet.cases.map((fixtureCase) => fixtureCase.id),
      compare: (expected: JsonValue, actual: JsonValue | undefined): CaseComparison =>
        compareRecordedOutput(expected, actual),
    });

    const delegated = caseSet.cases.map((fixtureCase) => decide(fixtureCase, delegating));

    expect(delegated).toEqual(caseSet.cases.map((fixtureCase) => decide(fixtureCase)));
  });

  it("passes an absent recording through as a defined input rather than a failure", () => {
    const delegating = validateEvaluatorCheck({
      id: "delegating-check",
      title: "Delegating check",
      appliesTo: ["so-001"],
      compare: (expected: JsonValue, actual: JsonValue | undefined): CaseComparison =>
        compareRecordedOutput(expected, actual),
    });

    expect(delegating.compare({ status: "received" }, undefined)).toEqual({
      match: false,
      expectedCanonical: canonicalize({ status: "received" }),
      actualCanonical: "",
      reason: "absent",
    });
  });

  it("changes the verdict of exactly the case a validated check declares, and nothing else", () => {
    const builtIn = caseSet.cases.map((fixtureCase) => decide(fixtureCase));
    expect(builtIn.every((comparison) => comparison.match)).toBe(true);

    const targetIndex = caseSet.cases.findIndex(
      (fixtureCase) => fixtureCase.severity === "standard" && decide(fixtureCase).match,
    );
    const target = caseSet.cases[targetIndex];

    if (target === undefined) {
      throw new Error("the shipped case set declares no matching standard-severity case to declare");
    }

    const check = arrayOnlyCheck(target.id);
    const withCheck = caseSet.cases.map((fixtureCase) => decide(fixtureCase, check));

    const changedCaseIds = caseSet.cases
      .filter((fixtureCase, index) => withCheck[index]?.match !== builtIn[index]?.match)
      .map((fixtureCase) => fixtureCase.id);

    expect(check.appliesTo).toEqual([target.id]);
    expect(changedCaseIds).toEqual([target.id]);

    const matchedBuiltIn = builtIn.filter((comparison) => comparison.match).length;
    const matchedWithCheck = withCheck.filter((comparison) => comparison.match).length;

    expect(matchedBuiltIn).toBe(SGI_SO_1_0_0.totalCases);
    expect(matchedWithCheck).toBe(matchedBuiltIn - 1);

    // The verdict is the whole record, so the report's per-case evidence survives a contributed check:
    // the two canonical strings are the ones the canonical comparison produced, and they agree because
    // the recording itself matches canonically — the check's stricter rule is what makes it a non-match.
    expect(withCheck[targetIndex]).toEqual({
      match: false,
      expectedCanonical: builtIn[targetIndex]?.expectedCanonical,
      actualCanonical: builtIn[targetIndex]?.actualCanonical,
      reason: "mismatch",
    });

    // The versioned criteria are untouched by the check and remain the only deciders: the case it
    // answers is not a `critical` one, so exactly one match is lost and no critical failure is added,
    // and the surviving count still clears the threshold the standard version publishes.
    expect(target.severity).toBe("standard");
    expect(matchedWithCheck).toBeGreaterThanOrEqual(SGI_SO_1_0_0.passThresholdMatches);
  });
});
