/**
 * The acceptance test of the fixture-pack extension seam: the worked proof that a community
 * contribution plugs into ADEM's evaluation path without an edit to `@adem/sgi-core`'s scoring code.
 *
 * Four properties are asserted, and each is why this file exists:
 *
 * 1. **Seam compliance.** The pack this example publishes satisfies `FixturePack`, the seam's own
 *    guard accepts it — returning the contributor's object by identity — and a candidate pack
 *    missing a required member is refused with the offending field named.
 * 2. **The case set and its determinism.** The pack states six cases of its own standard version,
 *    two of them critical, and every read returns a fresh, deeply equal case set, so mutating one
 *    result cannot reach the next read. That is what makes two evaluations over one unchanged file
 *    compare equal.
 * 3. **Registration.** The pack registers through the exported registry members alone: it resolves
 *    by its id, a second registration under the same id is refused, the registry the caller holds is
 *    the one mutated, and the shipped standard's case set is deliberately not an extension.
 * 4. **The acceptance assertion.** A candidate submission scores against the pack's case set through
 *    `scoreSubmission`, with an inline standard version's own thresholds deciding the outcome —
 *    PASS, a critical failure, a threshold failure, and a contributed `EvaluatorCheck` replacing the
 *    canonical comparison for one case — while every file under `packages/sgi-core/src/scoring/`
 *    stays exactly as it was.
 *
 * Everything is read from the package's single public entry, `./index`, so the entry is also proved
 * to export what the seam needs.
 *
 * Nothing here reads a clock, a locale, a timezone, a random source, an environment variable, a file
 * or a network, and nothing here executes a submitted value: submissions are declarative recordings
 * compared as canonical JSON. The criteria under test are the example's own — the published
 * standard's thresholds, case counts and case ids appear nowhere in this file, because the seam is
 * proved by a contribution that is independent of them.
 */

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  createExtensionRegistry,
  DuplicateExtensionError,
  FixturePackValidationError,
  scoreSubmission,
  validateFixturePack,
} from "@adem/sgi-core";
import type {
  EvaluatorCheck,
  ExtensionRegistry,
  FixturePack,
  StandardVersionDefinition,
} from "@adem/sgi-core";
import type { CandidateSubmission, JsonValue } from "@adem/sgi-fixtures";

import {
  createExampleExtensionRegistry,
  createExampleFixturePack,
  EXAMPLE_FIXTURE_PACK_ID,
  EXAMPLE_FIXTURE_PACK_TITLE,
  EXAMPLE_STANDARD_VERSION_ID,
  registerExampleFixturePack,
} from "./index";

/** The extension's pack, created from the package's public entry: what every proof below exercises. */
const pack = createExampleFixturePack();

/**
 * The pack's own case set, read once here so the assertions compare against one load of one file.
 *
 * Every submission below is built from it rather than from a re-typed expected output, so editing a
 * fixture cannot leave a stale copy of that value behind in this test.
 */
const caseSet = pack.loadCaseSet();

/**
 * The candidate version identifiers of the submissions scored below: UUID-shaped literals, the
 * identifier convention a report traces a versioned listing back by. One per scoring path under
 * test, so a report built from any of them states which submission produced it.
 */
const PASS_CANDIDATE_VERSION_ID = "3b7f1c9e-52a4-4d6b-8f17-c4a9e2d5b603";
const CRITICAL_FAILURE_CANDIDATE_VERSION_ID = "6d1a4f82-9c37-4b5e-a271-3f8d6c0e9b24";
const THRESHOLD_FAILURE_CANDIDATE_VERSION_ID = "c8e40b17-3a62-4f9d-b583-7e2a1c6f4d90";

/**
 * Runs the seam guard over a candidate and returns the typed refusal, failing the test if the guard
 * returned instead of refusing.
 */
function catchPackRefusal(candidate: unknown): FixturePackValidationError {
  try {
    validateFixturePack(candidate);
  } catch (error) {
    if (error instanceof FixturePackValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the fixture-pack seam guard to refuse the candidate");
}

/** Runs a registration and returns the duplicate refusal it raised. */
function catchDuplicateExtension(register: () => unknown): DuplicateExtensionError {
  try {
    register();
  } catch (error) {
    if (error instanceof DuplicateExtensionError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the registry to refuse a second registration under the same id");
}

/** The pack ids a registry holds, read through the registry's own accessor. */
function registeredPackIds(registry: ExtensionRegistry): string[] {
  return registry.listFixturePacks().map((registered) => registered.id);
}

/**
 * The versioned criteria the example's submissions are scored under: this example's own values,
 * built fresh on every call so no test can observe another test's mutation of it.
 *
 * The pass rule is read from these fields and is never restated as an expectation here: at least
 * five of the six cases matched with no critical failure is a PASS, so two changed standard-severity
 * cases fail a run. `publishedAt` is a fixed ISO-8601 UTC literal rather than a clock reading,
 * because nothing in the scoring path may read a clock.
 */
function createExampleStandard(): StandardVersionDefinition {
  return {
    code: EXAMPLE_STANDARD_VERSION_ID,
    versionLabel: EXAMPLE_STANDARD_VERSION_ID,
    title: EXAMPLE_FIXTURE_PACK_TITLE,
    summary:
      "Compares the recorded structured outputs of a declarative submission against this example " +
      "pack's own fixed cases and reports a reproducible PASS or FAIL from its own thresholds.",
    status: "provisional",
    totalCases: 6,
    criticalCases: 2,
    passThresholdMatches: 5,
    criticalFailuresAllowed: 0,
    rubricReference: `${EXAMPLE_STANDARD_VERSION_ID}#rubric`,
    fixtureSetId: EXAMPLE_STANDARD_VERSION_ID,
    publishedAt: "2024-06-02T00:00:00.000Z",
  };
}

/** The pack's expected output for one case, looked up in the loaded case set rather than re-typed. */
function expectedOutputFor(caseId: string): JsonValue {
  const fixtureCase = caseSet.cases.find((candidate) => candidate.id === caseId);
  if (fixtureCase === undefined) {
    throw new Error(`the example pack defines no case ${caseId}`);
  }
  return fixtureCase.expected_output;
}

/**
 * A candidate submission recording the pack's own expected output for every case, with the named
 * cases overridden. It answers the whole case set on every call, so a scoring refusal is never an
 * artefact of a missing recording.
 */
function submissionFor(
  candidateId: string,
  candidateVersionId: string,
  overrides: ReadonlyMap<string, JsonValue>,
): CandidateSubmission {
  return {
    candidate_id: candidateId,
    candidate_version_id: candidateVersionId,
    standard_version_id: EXAMPLE_STANDARD_VERSION_ID,
    recorded_outputs: caseSet.cases.map((fixtureCase) => {
      const overridden = overrides.get(fixtureCase.id);
      return {
        case_id: fixtureCase.id,
        output: overridden === undefined ? fixtureCase.expected_output : overridden,
      };
    }),
  };
}

/**
 * The submission that records the pack's expected output for every case, with the one key-order
 * probe: case `xp-003` carries the same keys and values as the pack's expected output, written in a
 * different order.
 */
function createPassingSubmission(): CandidateSubmission {
  const reorderedNotice: JsonValue = {
    state: "draft",
    notice_id: "demo-notice-13",
    tags: ["alpha", "beta"],
  };
  return submissionFor(
    "example-pass",
    PASS_CANDIDATE_VERSION_ID,
    new Map<string, JsonValue>([["xp-003", reorderedNotice]]),
  );
}

describe("the example pack's seam compliance", () => {
  it("returns the contributor's pack unchanged from the seam guard", () => {
    expect(validateFixturePack(pack)).toBe(pack);
    expect(pack.id).toBe(EXAMPLE_FIXTURE_PACK_ID);
    expect(pack.standardVersionId).toBe(EXAMPLE_STANDARD_VERSION_ID);
    expect(pack.title).toBe(EXAMPLE_FIXTURE_PACK_TITLE);
  });

  it("refuses a value that is not a pack, naming the field of the seam it failed", () => {
    expect(() => validateFixturePack(undefined)).toThrow(FixturePackValidationError);

    const error = catchPackRefusal(undefined);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FixturePackValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("id");
    expect(error.message).toContain("id");
  });

  it.each([
    {
      label: "a pack carrying no case-set loader",
      candidate: {
        id: EXAMPLE_FIXTURE_PACK_ID,
        standardVersionId: EXAMPLE_STANDARD_VERSION_ID,
        title: EXAMPLE_FIXTURE_PACK_TITLE,
      },
      field: "loadCaseSet",
    },
    {
      label: "a pack whose title is empty",
      candidate: {
        id: EXAMPLE_FIXTURE_PACK_ID,
        standardVersionId: EXAMPLE_STANDARD_VERSION_ID,
        title: "",
        loadCaseSet: () => caseSet,
      },
      field: "title",
    },
  ])("refuses $label and names the offending field", ({ candidate, field }) => {
    expect(() => validateFixturePack(candidate)).toThrow(FixturePackValidationError);

    const error = catchPackRefusal(candidate);

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe(field);
    expect(error.message).toContain(field);
  });
});

describe("the example pack's case set", () => {
  it("states six cases of its own standard version, two of them critical", () => {
    expect(caseSet.standard_version_id).toBe(EXAMPLE_STANDARD_VERSION_ID);
    expect(caseSet.total_cases).toBe(6);
    expect(caseSet.critical_cases).toBe(2);
    expect(caseSet.cases).toHaveLength(6);

    const caseIds = caseSet.cases.map((fixtureCase) => fixtureCase.id);
    expect(caseIds).toEqual(["xp-001", "xp-002", "xp-003", "xp-004", "xp-005", "xp-006"]);
    expect(new Set(caseIds).size).toBe(6);

    const criticalCaseIds = caseSet.cases
      .filter((fixtureCase) => fixtureCase.severity === "critical")
      .map((fixtureCase) => fixtureCase.id);
    expect(criticalCaseIds).toEqual(["xp-002", "xp-005"]);

    for (const fixtureCase of caseSet.cases) {
      expect(fixtureCase.expected_output).not.toBeUndefined();
      expect(fixtureCase.input.instruction.length).toBeGreaterThan(0);
      expect(fixtureCase.input.source.length).toBeGreaterThan(0);
    }
  });

  it("returns a fresh case set on every read, so a mutated result cannot reach the next", () => {
    const first = pack.loadCaseSet();
    const second = pack.loadCaseSet();

    expect(second).toStrictEqual(first);
    expect(second).not.toBe(first);

    const [firstCase] = first.cases;
    if (firstCase === undefined) {
      throw new Error("the example pack states no first case, so this proof cannot run");
    }
    firstCase.id = "xp-mutated";

    expect(first.cases.map((fixtureCase) => fixtureCase.id)).toContain("xp-mutated");
    expect(pack.loadCaseSet()).toStrictEqual(second);
  });
});

describe("the example pack's registration", () => {
  it("resolves the registered pack by its id and lists it as the registry's only pack", () => {
    const registry = createExampleExtensionRegistry();
    const packs = registry.listFixturePacks();

    expect(packs).toHaveLength(1);
    expect(registeredPackIds(registry)).toEqual([EXAMPLE_FIXTURE_PACK_ID]);
    expect(registry.getFixturePack(EXAMPLE_FIXTURE_PACK_ID)).toBeTruthy();
    expect(registry.getFixturePack(EXAMPLE_FIXTURE_PACK_ID)).toBe(packs[0]);
    expect(Object.isFrozen(packs)).toBe(true);
  });

  it("resolves no pack for an id it does not hold", () => {
    const registry = createExampleExtensionRegistry();

    expect(registry.getFixturePack("unknown")).toBeNull();
    // The shipped case set is reached through the standards registry and is deliberately not an
    // extension, so a contribution can never displace or shadow the published path. Registering it
    // here would be the wrong repair for this lookup returning null.
    expect(registry.getFixturePack("SGI-SO-1.0.0")).toBeNull();
  });

  it("refuses a second registration under the same pack id", () => {
    const registry = createExampleExtensionRegistry();

    expect(() => registerExampleFixturePack(registry)).toThrow(DuplicateExtensionError);

    const duplicate = catchDuplicateExtension(() => registerExampleFixturePack(registry));

    expect(duplicate.code).toBe("duplicate_extension");
    expect(duplicate.kind).toBe("fixture-pack");
    expect(duplicate.id).toBe(EXAMPLE_FIXTURE_PACK_ID);
    expect(registeredPackIds(registry)).toEqual([EXAMPLE_FIXTURE_PACK_ID]);
  });

  it("registers into the registry the caller holds, with no hidden singleton", () => {
    const bare = createExtensionRegistry();

    expect(bare.getFixturePack(EXAMPLE_FIXTURE_PACK_ID)).toBeNull();

    const registered = registerExampleFixturePack(bare);

    expect(bare.getFixturePack(EXAMPLE_FIXTURE_PACK_ID)).toBe(registered);
    expect(registeredPackIds(bare)).toEqual([EXAMPLE_FIXTURE_PACK_ID]);
  });

  it("returns two registries that share no state", () => {
    const firstRegistry = createExampleExtensionRegistry();
    const secondRegistry = createExampleExtensionRegistry();

    const secondContribution: FixturePack = {
      id: "second-example-pack",
      standardVersionId: EXAMPLE_STANDARD_VERSION_ID,
      title: "Second example pack",
      loadCaseSet: () => createExampleFixturePack().loadCaseSet(),
    };
    firstRegistry.registerFixturePack(secondContribution);

    expect(registeredPackIds(firstRegistry)).toEqual([
      EXAMPLE_FIXTURE_PACK_ID,
      secondContribution.id,
    ]);
    expect(registeredPackIds(secondRegistry)).toEqual([EXAMPLE_FIXTURE_PACK_ID]);
    expect(secondRegistry.getFixturePack(secondContribution.id)).toBeNull();
  });
});

describe("scoring a candidate against the example pack", () => {
  it("passes a submission that records the pack's expected output for every case, key order aside", () => {
    const submission = createPassingSubmission();

    const recorded = submission.recorded_outputs.find(
      (recordedOutput) => recordedOutput.case_id === "xp-003",
    );
    if (recorded === undefined) {
      throw new Error("the passing submission records no output for xp-003");
    }

    // The probe is the point: comparison is on canonical JSON, so key order is insignificant while
    // array order and string contents are not. Its serialised form must stay different from the
    // fixture's own text, or the key-order property would no longer be under test.
    expect(JSON.stringify(recorded.output)).not.toBe(JSON.stringify(expectedOutputFor("xp-003")));

    const scored = scoreSubmission(createExampleStandard(), pack.loadCaseSet(), submission);

    expect(scored.standardVersionId).toBe(EXAMPLE_STANDARD_VERSION_ID);
    expect(scored.candidateVersionId).toBe(PASS_CANDIDATE_VERSION_ID);
    expect(scored.outcome).toBe("PASS");
    expect(scored.matchedCount).toBe(6);
    expect(scored.totalCount).toBe(6);
    expect(scored.criticalFailures).toBe(0);
    expect(scored.failingCaseIds).toEqual([]);
    expect(scored.caseResults).toHaveLength(6);
    expect(scored.caseResults.every((caseResult) => caseResult.match)).toBe(true);

    // The reordered recording and the case's expected output are one canonical string, which is also
    // the evidence a report stores for the case.
    const reorderedResult = scored.caseResults.find((caseResult) => caseResult.caseId === "xp-003");
    expect(reorderedResult?.match).toBe(true);
    expect(reorderedResult?.actualJson).toBe(reorderedResult?.expectedJson);
  });

  it("fails a submission whose critical case records a string where the pack states a boolean", () => {
    const submission = submissionFor(
      "example-critical-failure",
      CRITICAL_FAILURE_CANDIDATE_VERSION_ID,
      new Map<string, JsonValue>([
        ["xp-002", { notice_id: "demo-notice-12", public: "false" }],
      ]),
    );

    const scored = scoreSubmission(createExampleStandard(), pack.loadCaseSet(), submission);

    // One critical failure fails the run however many other cases match.
    expect(scored.outcome).toBe("FAIL");
    expect(scored.matchedCount).toBe(5);
    expect(scored.totalCount).toBe(6);
    expect(scored.criticalFailures).toBe(1);
    expect(scored.failingCaseIds).toEqual(["xp-002"]);
  });

  it("fails a submission that misses the versioned match threshold with no critical failure", () => {
    const submission = submissionFor(
      "example-threshold-failure",
      THRESHOLD_FAILURE_CANDIDATE_VERSION_ID,
      new Map<string, JsonValue>([
        ["xp-003", { notice_id: "demo-notice-13", tags: ["alpha", "beta"], state: "published" }],
        ["xp-004", { notice_id: "demo-notice-14", change_count: "2" }],
      ]),
    );

    const scored = scoreSubmission(createExampleStandard(), pack.loadCaseSet(), submission);

    // Below the match threshold with no critical failure: the third path to FAIL, and the one that
    // proves the threshold is a real gate rather than a formality.
    expect(scored.outcome).toBe("FAIL");
    expect(scored.matchedCount).toBe(4);
    expect(scored.totalCount).toBe(6);
    expect(scored.criticalFailures).toBe(0);
    expect(scored.failingCaseIds).toEqual(["xp-003", "xp-004"]);
  });

  it("scores one submission identically twice and shares no mutable state between the runs", () => {
    const submission = createPassingSubmission();
    const standard = createExampleStandard();
    const recordedOutputCount = submission.recorded_outputs.length;

    const first = scoreSubmission(standard, pack.loadCaseSet(), submission);
    const second = scoreSubmission(standard, pack.loadCaseSet(), submission);

    expect(second).toStrictEqual(first);
    expect(second).not.toBe(first);
    expect(second.caseResults).not.toBe(first.caseResults);
    expect(second.failingCaseIds).not.toBe(first.failingCaseIds);

    // Scoring writes nothing back: the case set and the submission are as they were, which is what
    // lets one submission be scored again without first being reset.
    expect(pack.loadCaseSet()).toStrictEqual(caseSet);
    expect(submission.recorded_outputs).toHaveLength(recordedOutputCount);
  });

  it("takes a contributed evaluator check's verdict while the versioned thresholds decide the outcome", () => {
    // A check replaces the canonical comparison for the case ids it declares, and for no others. It
    // reaches the scoring path through the seam's own options, so the contribution needs no edit to
    // `packages/sgi-core/src/scoring/` — which is the acceptance property of this whole file.
    const check: EvaluatorCheck = {
      id: "example-key-set-check",
      title: "Example key-set check",
      appliesTo: ["xp-004"],
      compare(expected, actual) {
        return {
          match: false,
          expectedCanonical: canonicalize(expected),
          actualCanonical: canonicalize(actual ?? null),
          reason: "mismatch",
        };
      },
    };

    const scored = scoreSubmission(
      createExampleStandard(),
      pack.loadCaseSet(),
      createPassingSubmission(),
      { checks: [check] },
    );

    expect(scored.failingCaseIds).toEqual(["xp-004"]);
    expect(scored.matchedCount).toBe(5);
    expect(scored.criticalFailures).toBe(0);
    // Five matched is the versioned threshold and no critical case failed, so the outcome is
    // unchanged by the contribution: a check decides a case, never the pass rule.
    expect(scored.outcome).toBe("PASS");
  });
});
