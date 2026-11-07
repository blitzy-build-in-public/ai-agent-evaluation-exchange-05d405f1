/**
 * The beside-source unit test of `compareRecordedOutput` from `./compare-recorded-output`,
 * the primitive that decides whether the output a candidate recorded for one fixture case
 * matches that case's expected output.
 *
 * It proves the three outcomes — `match`, `mismatch` and `absent` — and, above all, the one
 * canonicalisation distinction the `SGI-SO-1.0.0` fixture set exists to demonstrate:
 * whitespace **between** tokens in the serialised form is insignificant, whitespace
 * **inside** a string value is significant, and array order is significant. The three
 * fixture deltas that exist as the machine-checked probes of those properties are `so-017`,
 * which states its keys in a different order from its expected output and must match;
 * `so-014`, which records the same scan codes in a different order and must not; and
 * `so-018`, which records a note carrying a trailing space its expected output does not and
 * must not. Each probe is read from the real pack through `@adem/sgi-fixtures` rather than
 * restated as an inline literal, so a fixture whose delta is tidied away fails this file —
 * which is exactly what those deltas are for.
 *
 * The comparison is also proven pure and repeatable: two calls over equal inputs return
 * deeply equal verdicts and leave both arguments byte for byte as they were. Nothing here
 * reads a clock, a locale, a timezone, a random source, an environment variable or a
 * database, and nothing is written: the fixture pack is read through the loader that owns
 * those reads, and every other input is written inline.
 */

import { describe, expect, it } from "vitest";

import { loadCandidate, loadCaseSet } from "@adem/sgi-fixtures";
import type {
  CandidateSubmission,
  CaseSet,
  FixtureCase,
  JsonValue,
  RecordedOutput,
} from "@adem/sgi-fixtures";

import { compareRecordedOutput } from "./compare-recorded-output";
import type { CaseComparison } from "./compare-recorded-output";

/** The standard version whose case set the probes below are read from. */
const STANDARD_VERSION_ID = "SGI-SO-1.0.0";

/**
 * The four members every verdict carries, in the order this test compares them.
 *
 * Typed as `keyof CaseComparison`, so a member renamed or dropped in the interface fails
 * the build here instead of leaving an assertion that pins a shape nothing produces.
 */
const COMPARISON_MEMBERS: ReadonlyArray<keyof CaseComparison> = [
  "actualCanonical",
  "expectedCanonical",
  "match",
  "reason",
];

/**
 * Resolves one case of a loaded case set.
 *
 * `noUncheckedIndexedAccess` makes `.find` return `FixtureCase | undefined`, so the absence
 * is handled where it can actually happen rather than silenced with a non-null assertion
 * that would defeat the check. A case the set does not define is a defect in this test's own
 * data, which is why the message names both the case id and the set.
 */
function requireCase(caseSet: CaseSet, caseId: string): FixtureCase {
  const fixtureCase = caseSet.cases.find((candidateCase) => candidateCase.id === caseId);
  if (fixtureCase === undefined) {
    throw new Error(`${caseId} is not a case of the ${caseSet.standard_version_id} case set`);
  }
  return fixtureCase;
}

/** Resolves the output one candidate recorded for one case, narrowing the same absence. */
function requireRecordedOutput(candidate: CandidateSubmission, caseId: string): RecordedOutput {
  const recordedOutput = candidate.recorded_outputs.find((recorded) => recorded.case_id === caseId);
  if (recordedOutput === undefined) {
    throw new Error(`${candidate.candidate_id} recorded no output for case ${caseId}`);
  }
  return recordedOutput;
}

describe("compareRecordedOutput", () => {
  describe("the three outcomes", () => {
    it("matches two objects that state the same keys in a different order", () => {
      const comparison = compareRecordedOutput({ a: 2, b: 1 }, { b: 1, a: 2 });

      // Key order is not significant: both sides render to one canonical form.
      expect(comparison.match).toBe(true);
      expect(comparison.reason).toBe("match");
      expect(comparison.expectedCanonical).toBe('{"a":2,"b":1}');
      expect(comparison.actualCanonical).toBe('{"a":2,"b":1}');
      expect(comparison.expectedCanonical).toBe(comparison.actualCanonical);
    });

    it("reports a mismatch when a value carries a byte the expected output does not", () => {
      const comparison = compareRecordedOutput({ n: "pending review" }, { n: "pending review " });

      expect(comparison.match).toBe(false);
      expect(comparison.reason).toBe("mismatch");
      expect(comparison.expectedCanonical).toBe('{"n":"pending review"}');
      expect(comparison.actualCanonical).toBe('{"n":"pending review "}');
      expect(comparison.actualCanonical).not.toBe(comparison.expectedCanonical);

      // The one trailing space is the whole difference, so the recorded form is exactly one
      // byte longer than the expected one.
      expect(comparison.actualCanonical.length).toBe(comparison.expectedCanonical.length + 1);
    });

    it("reports absent, without throwing, when the case has no recorded output", () => {
      // "No recorded output for this case". The empty string is deliberate and must never be
      // "null": "null" would read as a recorded JSON `null` — a value the fixture set
      // genuinely uses in `so-008`'s `bay` and `so-020`'s `assigned_team` — and the two
      // outcomes would be indistinguishable. Within a scored run `scoreSubmission` refuses an
      // incomplete submission before any comparison runs, so this outcome is reached only by
      // a caller inspecting one case on its own, and it is a value rather than an error.
      expect(() => compareRecordedOutput({ a: 1 }, undefined)).not.toThrow();

      const comparison = compareRecordedOutput({ a: 1 }, undefined);

      expect(comparison.match).toBe(false);
      expect(comparison.reason).toBe("absent");
      expect(comparison.expectedCanonical).toBe('{"a":1}');
      expect(comparison.actualCanonical).toBe("");

      // Every outcome carries all four members, so a caller reads any of them without
      // narrowing on `reason` first.
      expect(Object.keys(comparison).sort()).toStrictEqual([...COMPARISON_MEMBERS].sort());
    });

    it("treats a recorded null as a value rather than as an absence", () => {
      const scalar = compareRecordedOutput(null, null);

      expect(scalar.match).toBe(true);
      expect(scalar.reason).toBe("match");
      expect(scalar.expectedCanonical).toBe("null");
      expect(scalar.actualCanonical).toBe("null");

      const field = compareRecordedOutput({ bay: null }, { bay: null });

      expect(field.match).toBe(true);
      expect(field.reason).toBe("match");
      expect(field.expectedCanonical).toBe('{"bay":null}');
      expect(field.actualCanonical).toBe('{"bay":null}');

      // A recording of `null` is not the same input as no recording at all, and the two are
      // told apart by `reason`, not by `match` — which is `false` for both.
      const absent = compareRecordedOutput(null, undefined);

      expect(absent.reason).toBe("absent");
      expect(absent.actualCanonical).toBe("");
      expect(absent.match).toBe(false);
    });

    it("returns a verdict rather than throwing for every input shape", () => {
      // A scalar, an array, an object and `null` on each side, including pairs whose two
      // sides have entirely different JSON types: the comparison is total, and a difference
      // in type is a mismatch like any other difference rather than an error.
      const differingPairs: ReadonlyArray<readonly [JsonValue, JsonValue]> = [
        [{ a: 1 }, [1]],
        [[1], { a: 1 }],
        ["1", 1],
        [1, "1"],
        [true, "true"],
        [null, { a: 1 }],
        [{ a: 1 }, null],
        [{ note: "pending review" }, { note: "pending review " }],
      ];

      for (const [expected, actual] of differingPairs) {
        expect(() => compareRecordedOutput(expected, actual)).not.toThrow();

        const comparison = compareRecordedOutput(expected, actual);

        expect(comparison.match).toBe(false);
        expect(comparison.reason).toBe("mismatch");
        expect(comparison.expectedCanonical.length).toBeGreaterThan(0);
        expect(comparison.actualCanonical.length).toBeGreaterThan(0);
      }
    });
  });

  describe("the SGI-SO-1.0.0 fixture probes", () => {
    it("matches so-017, whose recording states its keys in a different order", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const recorded = requireRecordedOutput(loadCandidate("seed-alpha"), "so-017");
      const fixtureCase = requireCase(caseSet, "so-017");

      // Pins the fixture's deliberate key-order delta: the two raw serialisations differ, so
      // a match below can only come from canonicalising both sides. Do not "tidy" so-017.
      expect(JSON.stringify(recorded.output)).not.toBe(JSON.stringify(fixtureCase.expected_output));

      const comparison = compareRecordedOutput(fixtureCase.expected_output, recorded.output);

      expect(comparison.reason).toBe("match");
      expect(comparison.match).toBe(true);
      expect(comparison.actualCanonical).toBe(comparison.expectedCanonical);
      expect(comparison.expectedCanonical).toBe(
        '{"depot":"north-yard","item_count":4,"order_id":"demo-order-1017","status":"closed"}',
      );
    });

    it("fails so-014, whose recording reorders the same scan codes", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const recorded = requireRecordedOutput(loadCandidate("seed-gamma"), "so-014");
      const fixtureCase = requireCase(caseSet, "so-014");

      const comparison = compareRecordedOutput(fixtureCase.expected_output, recorded.output);

      expect(comparison.match).toBe(false);
      expect(comparison.reason).toBe("mismatch");

      // Both sides carry all three of the same scan codes, so the reordering alone is what
      // fails: array order is data, which is why so-014 is one of the three cases that hold
      // seed-gamma at 17 of 20, below the standard's 18-of-20 pass threshold.
      for (const scanCode of ["sc-1100", "sc-2200", "sc-3300"]) {
        expect(comparison.expectedCanonical).toContain(scanCode);
        expect(comparison.actualCanonical).toContain(scanCode);
      }

      expect(comparison.expectedCanonical).toBe('{"scan_codes":["sc-1100","sc-2200","sc-3300"]}');
      expect(comparison.actualCanonical).toBe('{"scan_codes":["sc-2200","sc-1100","sc-3300"]}');
      expect(comparison.actualCanonical).not.toBe(comparison.expectedCanonical);
    });

    it("fails so-018, whose recording carries a trailing space inside a value", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const recorded = requireRecordedOutput(loadCandidate("seed-gamma"), "so-018");
      const fixtureCase = requireCase(caseSet, "so-018");

      const comparison = compareRecordedOutput(fixtureCase.expected_output, recorded.output);

      expect(comparison.match).toBe(false);
      expect(comparison.reason).toBe("mismatch");

      // Whitespace between tokens is insignificant, but whitespace inside a string value is
      // significant: one trailing space in the note is the entire difference between these
      // two forms, and the expected form below is exactly one byte shorter.
      expect(comparison.expectedCanonical).toBe(
        '{"note":"pending review","order_id":"demo-order-1018"}',
      );
      expect(comparison.actualCanonical).toBe(
        '{"note":"pending review ","order_id":"demo-order-1018"}',
      );
      expect(comparison.actualCanonical.length).toBe(comparison.expectedCanonical.length + 1);
    });

    it("matches on key order while failing on a byte inside a string value", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);

      const onKeyOrder = compareRecordedOutput(
        requireCase(caseSet, "so-017").expected_output,
        requireRecordedOutput(loadCandidate("seed-alpha"), "so-017").output,
      );
      const insideAValue = compareRecordedOutput(
        requireCase(caseSet, "so-018").expected_output,
        requireRecordedOutput(loadCandidate("seed-gamma"), "so-018").output,
      );

      // The distinction is not one-sided: the same canonicalisation that forgives a reordered
      // key set preserves every byte of a value, and the two probes therefore land on
      // opposite outcomes.
      expect(onKeyOrder.reason).toBe("match");
      expect(onKeyOrder.actualCanonical).toBe(onKeyOrder.expectedCanonical);
      expect(insideAValue.reason).toBe("mismatch");
      expect(insideAValue.actualCanonical).not.toBe(insideAValue.expectedCanonical);
    });
  });

  describe("purity", () => {
    it("returns deeply equal verdicts for equal inputs and mutates neither argument", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const matchingCandidate = loadCandidate("seed-alpha");
      const differingCandidate = loadCandidate("seed-gamma");

      // One pair that matches and one that does not, so repeatability and non-mutation are
      // proven on both outcomes rather than on the matching path alone.
      const pairs: ReadonlyArray<readonly [string, JsonValue, JsonValue]> = [
        [
          "so-017",
          requireCase(caseSet, "so-017").expected_output,
          requireRecordedOutput(matchingCandidate, "so-017").output,
        ],
        [
          "so-018",
          requireCase(caseSet, "so-018").expected_output,
          requireRecordedOutput(differingCandidate, "so-018").output,
        ],
      ];

      for (const [caseId, expected, actual] of pairs) {
        const expectedBefore = structuredClone(expected);
        const actualBefore = structuredClone(actual);

        const first = compareRecordedOutput(expected, actual);
        const second = compareRecordedOutput(expected, actual);

        // Repeatability: equal inputs yield deeply equal verdicts, so nothing hidden decides
        // an outcome. Non-mutation: the arguments come back exactly as they went in, so the
        // verdict is derived from the values and never from state the call itself changed.
        expect(second, `${caseId} compared twice`).toStrictEqual(first);
        expect(expected, `${caseId} expected output`).toStrictEqual(expectedBefore);
        expect(actual, `${caseId} recorded output`).toStrictEqual(actualBefore);
      }
    });
  });
});
