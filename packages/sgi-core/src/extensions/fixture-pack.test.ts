import { describe, expect, it } from "vitest";

import { loadCaseSet } from "@adem/sgi-fixtures";
import type { CaseSet } from "@adem/sgi-fixtures";

import { FixturePackValidationError, validateFixturePack } from "./fixture-pack";
import type { FixturePack } from "./fixture-pack";

/**
 * A case set of the shape `@adem/sgi-fixtures` publishes — snake_case fields, one `critical` case
 * and one `standard` case. Held in memory so that what the guard accepts does not depend on fixture
 * files, and typed as `CaseSet` so a pack returning it satisfies the seam exactly as a contributed
 * pack would.
 */
const caseSet: CaseSet = {
  standard_version_id: "SGI-SO-1.0.0",
  total_cases: 2,
  critical_cases: 1,
  cases: [
    {
      id: "case-critical-1",
      severity: "critical",
      input: { instruction: "Summarise the source in one sentence.", source: "A short source." },
      expected_output: { summary: "A short source." },
    },
    {
      id: "case-standard-1",
      severity: "standard",
      input: { instruction: "List the headings.", source: "Heading one. Body." },
      expected_output: ["Heading one"],
    },
  ],
};

/**
 * A pack that satisfies every rule, used as the base for each refusal case so that only the member
 * under test differs. Its `loadCaseSet` is a property holding a function, which is one of the two
 * shapes the seam's method declaration admits.
 */
const validPack: FixturePack = {
  id: "example-fixture-pack",
  standardVersionId: "SGI-SO-1.0.0",
  title: "Example fixture pack",
  loadCaseSet: () => caseSet,
};

/** Runs the guard and returns the typed refusal, failing the test if it did not throw one. */
function catchSeamError(candidate: unknown): FixturePackValidationError {
  try {
    validateFixturePack(candidate);
  } catch (error) {
    if (error instanceof FixturePackValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected validateFixturePack to refuse the candidate");
}

describe("validateFixturePack", () => {
  it("accepts a well-formed pack and returns the very same object", () => {
    const validated = validateFixturePack(validPack);

    expect(validated).toBe(validPack);
    expect(Object.isFrozen(validated)).toBe(false);
    expect(validated.id).toBe("example-fixture-pack");
    expect(validated.standardVersionId).toBe("SGI-SO-1.0.0");
    expect(validated.loadCaseSet()).toBe(caseSet);
  });

  it("accepts a plain object whose loadCaseSet is a shorthand method", () => {
    const pack = {
      id: "method-pack",
      standardVersionId: "SGI-SO-1.0.0",
      title: "Method pack",
      loadCaseSet() {
        return caseSet;
      },
    };

    const validated = validateFixturePack(pack);

    expect(validated).toBe(pack);
    expect(validated.loadCaseSet().cases.map((fixtureCase) => fixtureCase.id)).toEqual([
      "case-critical-1",
      "case-standard-1",
    ]);
  });

  it.each([null, undefined, 42, "example-fixture-pack", true])(
    "refuses the non-object candidate %o on id",
    (candidate) => {
      const error = catchSeamError(candidate);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(FixturePackValidationError);
      expect(error.name).toBe("FixturePackValidationError");
      expect(error.code).toBe("seam_validation");
      expect(error.field).toBe("id");
      expect(error.message).toContain("id");
    },
  );

  it.each([
    { override: { id: "" }, label: "empty" },
    { override: { id: "   " }, label: "whitespace-only" },
    { override: { id: 42 }, label: "numeric" },
    { override: { id: null }, label: "null" },
  ])("refuses a $label id", ({ override }) => {
    const error = catchSeamError({ ...validPack, ...override });

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("id");
    expect(error.message).toContain("id");
    expect(error.message).toContain("FixturePack");
  });

  it("refuses a pack whose id is absent", () => {
    const error = catchSeamError({
      standardVersionId: validPack.standardVersionId,
      title: validPack.title,
      loadCaseSet: validPack.loadCaseSet,
    });

    expect(error.field).toBe("id");
  });

  it.each([
    { override: { standardVersionId: "" }, label: "empty" },
    { override: { standardVersionId: "  " }, label: "whitespace-only" },
    { override: { standardVersionId: 42 }, label: "numeric" },
    { override: { standardVersionId: undefined }, label: "absent" },
  ])("refuses a $label standardVersionId", ({ override }) => {
    const error = catchSeamError({ ...validPack, ...override });

    expect(error.name).toBe("FixturePackValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("standardVersionId");
    expect(error.message).toContain("standardVersionId");
    expect(error.message).toContain("FixturePack");
  });

  it.each([
    { override: { title: "" }, label: "empty" },
    { override: { title: " " }, label: "whitespace-only" },
    { override: { title: null }, label: "null" },
    { override: { title: ["Example fixture pack"] }, label: "array-valued" },
  ])("refuses a $label title", ({ override }) => {
    const error = catchSeamError({ ...validPack, ...override });

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("title");
    expect(error.message).toContain("title");
    expect(error.message).toContain("FixturePack");
  });

  it.each([
    { override: { loadCaseSet: undefined }, label: "absent" },
    { override: { loadCaseSet: 42 }, label: "numeric" },
    { override: { loadCaseSet: "loadCaseSet" }, label: "string-valued" },
    { override: { loadCaseSet: caseSet }, label: "object-valued" },
  ])("refuses a $label loadCaseSet", ({ override }) => {
    const error = catchSeamError({ ...validPack, ...override });

    expect(error.name).toBe("FixturePackValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("loadCaseSet");
    expect(error.message).toContain("loadCaseSet");
    expect(error.message).toContain("FixturePack");
  });

  it("reports id first when id and title both fail", () => {
    const error = catchSeamError({ ...validPack, id: "", title: "" });

    expect(error.field).toBe("id");
  });

  it("reports standardVersionId before title when both fail", () => {
    const error = catchSeamError({ ...validPack, standardVersionId: " ", title: "" });

    expect(error.field).toBe("standardVersionId");
  });

  it("reports title before loadCaseSet when both fail", () => {
    const error = catchSeamError({ ...validPack, title: " ", loadCaseSet: 42 });

    expect(error.field).toBe("title");
  });

  it("refuses an empty object on id rather than on a sentinel field", () => {
    const error = catchSeamError({});

    expect(error.field).toBe("id");
  });

  it("names the offending field in the message it composes", () => {
    const error = catchSeamError({ ...validPack, loadCaseSet: 42 });

    expect(error.message).toBe('FixturePack field "loadCaseSet" must be a function.');
  });

  it("returns the same object without rewriting padded text members", () => {
    const candidate = {
      id: "  padded-pack  ",
      standardVersionId: "  SGI-SO-1.0.0  ",
      title: "  Padded title  ",
      loadCaseSet: () => caseSet,
    };

    const validated = validateFixturePack(candidate);

    expect(validated).toBe(candidate);
    expect(validated.id).toBe("  padded-pack  ");
    expect(validated.standardVersionId).toBe("  SGI-SO-1.0.0  ");
    expect(validated.title).toBe("  Padded title  ");
  });

  it("leaves extra properties untouched", () => {
    const candidate = { ...validPack, registryNote: "contributed by a community extension" };

    const validated = validateFixturePack(candidate);

    expect(validated).toBe(candidate);
    expect(validated).toHaveProperty("registryNote", "contributed by a community extension");
  });

  it("does not validate the case set a pack returns", () => {
    // The guard checks the seam's four members only. A case set whose counts drift from its standard
    // version is refused while scoring, at the point the versioned criteria are applied, so the guard
    // must accept it here rather than duplicate that rule or force a pack's loader to run eagerly.
    const drifted: CaseSet = { ...caseSet, total_cases: 99 };
    const pack = { ...validPack, loadCaseSet: () => drifted };

    const validated = validateFixturePack(pack);

    expect(validated.loadCaseSet().total_cases).toBe(99);
  });

  it("accepts a pack that delegates to the shipped SGI-SO-1.0.0 case set", () => {
    const pack = {
      id: "shipped-pack",
      standardVersionId: "SGI-SO-1.0.0",
      title: "Shipped structured-output pack",
      loadCaseSet: () => loadCaseSet("SGI-SO-1.0.0"),
    };

    const validated = validateFixturePack(pack);
    const loaded = validated.loadCaseSet();

    expect(validated).toBe(pack);
    expect(loaded.standard_version_id).toBe(validated.standardVersionId);
    expect(loaded.total_cases).toBe(loaded.cases.length);
    expect(loaded.critical_cases).toBe(
      loaded.cases.filter((fixtureCase) => fixtureCase.severity === "critical").length,
    );
  });
});
