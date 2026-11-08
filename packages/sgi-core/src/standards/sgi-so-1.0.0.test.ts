import { describe, expect, it } from "vitest";

import { loadCaseSet } from "@adem/sgi-fixtures";

import { SGI_SO_1_0_0 } from "./sgi-so-1.0.0";

/**
 * Unit tests for `SGI_SO_1_0_0` from `./sgi-so-1.0.0`, the provisional standard version an
 * evaluation is scored against.
 *
 * The file does two jobs. It pins the published criteria as literals — the identifiers, the four
 * numbers the pass rule is decided by, the fixed publication instant and the deep freeze that keeps
 * a published version append-only — so that changing any one of them has to be a deliberate new
 * version rather than an edit in place. And it holds those same numbers against the case set
 * shipped in `@adem/sgi-fixtures`, which is the set they describe: where the two disagree, a
 * candidate is scored against criteria that do not match the cases it was scored on, and this is
 * the first place that drift can surface.
 *
 * How a recorded output is compared and how an outcome follows from these numbers belongs to
 * `../scoring`, which tests it against its own subject; nothing here calls into it. The file reads
 * no clock, no database, no file of its own and no environment, so it runs in a forked process with
 * no setup.
 */

/**
 * Asserts that `value` is frozen and that every container it holds is frozen too, walking the whole
 * graph so that a member nested later is covered by the same check rather than slipping past a
 * top-level-only assertion.
 *
 * Returns how many containers it examined, which the caller asserts is at least one: a walk that
 * quietly visited nothing would otherwise report success for having checked nothing.
 */
function expectDeepFrozen(value: unknown, path = "SGI_SO_1_0_0"): number {
  if (typeof value !== "object" || value === null) {
    return 0;
  }

  expect(Object.isFrozen(value), `${path} must be frozen`).toBe(true);

  const members = value as Record<string, unknown>;
  let containersExamined = 1;
  for (const key of Object.keys(members)) {
    containersExamined += expectDeepFrozen(members[key], `${path}.${key}`);
  }
  return containersExamined;
}

describe("SGI_SO_1_0_0", () => {
  describe("the identity a report cites", () => {
    it("carries the standard code and the version label as SGI-SO-1.0.0", () => {
      expect(SGI_SO_1_0_0.code).toBe("SGI-SO-1.0.0");
      expect(SGI_SO_1_0_0.versionLabel).toBe("SGI-SO-1.0.0");
    });

    it("is titled Structured Output Conformance", () => {
      expect(SGI_SO_1_0_0.title).toBe("Structured Output Conformance");
    });

    it("is provisional until a superseding version is published deliberately", () => {
      expect(SGI_SO_1_0_0.status).toBe("provisional");
    });

    it("references the rubric section of the standard document", () => {
      expect(SGI_SO_1_0_0.rubricReference).toBe("SGI-SO-1.0.0#rubric");
    });

    it("names the case set it is scored against by the identifier the loader resolves", () => {
      expect(SGI_SO_1_0_0.fixtureSetId).toBe("SGI-SO-1.0.0");
    });
  });

  describe("the pass rule the evaluator reads from this object", () => {
    it("defines twenty fixture cases", () => {
      expect(SGI_SO_1_0_0.totalCases).toBe(20);
    });

    it("marks five of those cases critical", () => {
      expect(SGI_SO_1_0_0.criticalCases).toBe(5);
    });

    it("requires at least eighteen matching cases for a PASS", () => {
      expect(SGI_SO_1_0_0.passThresholdMatches).toBe(18);
    });

    it("tolerates no critical failure at all", () => {
      expect(SGI_SO_1_0_0.criticalFailuresAllowed).toBe(0);
    });
  });

  describe("the published instant", () => {
    it("is the fixed ISO-8601 UTC literal, which no clock reading could equal", () => {
      expect(SGI_SO_1_0_0.publishedAt).toBe("2024-06-01T00:00:00.000Z");

      const reparsed = new Date(SGI_SO_1_0_0.publishedAt).toISOString();
      expect(reparsed).toBe(SGI_SO_1_0_0.publishedAt);
    });
  });

  describe("the published version is append-only", () => {
    it("is frozen at every level of the object graph", () => {
      expect(Object.isFrozen(SGI_SO_1_0_0)).toBe(true);

      const containersExamined = expectDeepFrozen(SGI_SO_1_0_0);
      expect(containersExamined).toBeGreaterThanOrEqual(1);
    });

    it("refuses a write to a published threshold and leaves the number unchanged", () => {
      expect(() => {
        (SGI_SO_1_0_0 as unknown as { totalCases: number }).totalCases = 21;
      }).toThrow(TypeError);

      expect(SGI_SO_1_0_0.totalCases).toBe(20);
    });
  });

  describe("alignment with the case set @adem/sgi-fixtures ships", () => {
    it("resolves its fixture set identifier to that case set, with the counts it declares", () => {
      const caseSet = loadCaseSet(SGI_SO_1_0_0.fixtureSetId);

      expect(caseSet.standard_version_id).toBe(SGI_SO_1_0_0.fixtureSetId);
      expect(caseSet.total_cases).toBe(SGI_SO_1_0_0.totalCases);
      expect(caseSet.critical_cases).toBe(SGI_SO_1_0_0.criticalCases);
      expect(caseSet.cases).toHaveLength(SGI_SO_1_0_0.totalCases);
    });

    it("holds no critical case beyond the five the fixture set marks so-001, so-003, so-005, so-008 and so-012", () => {
      const caseSet = loadCaseSet(SGI_SO_1_0_0.fixtureSetId);

      const criticalCaseIds = caseSet.cases
        .filter((fixtureCase) => fixtureCase.severity === "critical")
        .map((fixtureCase) => fixtureCase.id);

      expect(criticalCaseIds).toEqual(["so-001", "so-003", "so-005", "so-008", "so-012"]);
    });
  });
});
