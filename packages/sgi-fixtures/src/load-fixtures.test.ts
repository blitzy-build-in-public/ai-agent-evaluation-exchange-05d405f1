/**
 * The fixture pack's own consistency proof: the beside-source test of `./index`.
 *
 * It proves four things about the data the evaluator reads, each from the data
 * itself rather than from a restatement of it:
 *
 * - **The documented case set.** `SGI-SO-1.0.0` declares 20 cases, 5 of them
 *   `critical`; every case id is unique and shaped `so-NNN`, and every case
 *   carries an instruction, a source and an expected output that is a non-empty
 *   JSON object.
 * - **The three recorded outcomes, recomputed.** `seed-alpha` passes 20 of 20,
 *   `seed-beta` fails one critical case and `seed-gamma` falls below the 18-of-20
 *   threshold. Each is recomputed here from the case set and the candidate alone
 *   and then matched against both the documented values and the recorded
 *   `expected-outcomes.json`, so the pack is held to a record of what it holds.
 * - **The canonical-JSON probe.** `seed-alpha` records `so-017` with its keys in a
 *   different order from the case's expected output — different under
 *   `JSON.stringify`, equal under canonical comparison — which is the
 *   fixture-level evidence that matching is decided by canonical JSON and not by
 *   the order a recorder happened to emit.
 * - **Determinism.** Two consecutive loads of the case set, and of the expected
 *   outcomes, return deeply equal data, so one fixture file yields one result and
 *   the evaluation over these fixtures can be reproducible.
 *
 * A closing check keeps the pack's own text clean: no string it publishes carries
 * an at-sign or, once the mandated version identifiers are set aside, a run of
 * five or more digits — the cheap guard for the email and telephone classes the
 * repository's exclusion scan detects.
 *
 * Nothing here reads a clock, a locale, a timezone, a random source, the network,
 * an environment variable or a database, and nothing is written: the pack is
 * read-only data and every assertion is a pure comparison over it. The pack is
 * also the only thing this file reads, which is why it may not import the scorer
 * it feeds.
 */

import { describe, expect, it } from "vitest";

import {
  loadCandidate,
  loadCaseSet,
  loadExpectedOutcomes,
  type CandidateSubmission,
  type CaseSet,
  type JsonValue,
  type ReportOutcome,
} from "./index";

/** The standard version this pack publishes, which its case-set directory is named for. */
const STANDARD_VERSION_ID = "SGI-SO-1.0.0";

/** The three candidates the pack records, each named by its file under `candidates/`. */
const CANDIDATE_IDS = ["seed-alpha", "seed-beta", "seed-gamma"];

/**
 * The `SGI-SO-1.0.0` pass rule: at least 18 of the 20 cases match **and** no
 * `critical` case fails.
 *
 * Restated here rather than imported, for the same reason the canonical
 * comparison below is: this package is the data source the scorer reads, so it
 * must not depend on the SGI scorer package, and the outcomes the pack records
 * have to be checkable without it. A threshold change is a new standard version,
 * which arrives with its own case-set directory and is not this file's business.
 */
const PASS_THRESHOLD_MATCHES = 18;
const CRITICAL_FAILURES_ALLOWED = 0;

/**
 * The at-sign, built from its code point rather than written into this file: the
 * repository's exclusion scan reads this file too, and an at-sign inside a source
 * string is the start of the email shape that scan looks for.
 */
const AT_SIGN = String.fromCharCode(0x40);

/** The shape a version identifier takes, stripped before the digit-run check below. */
const VERSION_IDENTIFIER_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Renders `value` as canonical JSON: object keys sorted, no insignificant
 * whitespace between tokens.
 *
 * Deliberately a local copy of the rule and never an import from the scorer
 * package — the duplication is confined to this one test and is the price of
 * keeping the fixture package independent of the scorer it feeds. What is mirrored
 * is what scoring applies: keys ordered by UTF-16 code unit, array elements left in
 * order, and no byte a pretty-printer would add.
 */
function canonicalize(value: JsonValue): string {
  return JSON.stringify(sortKeys(value));
}

/** A copy of `value` whose object keys are ordered by UTF-16 code unit, recursively. */
function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((element) => sortKeys(element));
  }
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: JsonValue } = {};
    // An explicit code-unit comparator rather than a locale's collation rules, so the
    // rendered text is the same on every machine, and written out rather than left to
    // `sort()`'s implicit default so the decision survives the next reader's edit.
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [key, nested] of entries) {
      sorted[key] = sortKeys(nested);
    }
    return sorted;
  }
  return value;
}

/** Collects every string `value` holds, at any depth, into `into`, in document order. */
function collectStrings(value: JsonValue, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const element of value) {
      collectStrings(element, into);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectStrings(nested, into);
    }
  }
}

/**
 * The message of the refusal `action` throws.
 *
 * A call that returns instead of refusing is itself a failure of the assertion
 * that asked for a message, so it is reported as one rather than folded into an
 * empty string that a pattern could then quietly accept.
 */
function refusalMessage(action: () => unknown): string {
  try {
    action();
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error("expected a refusal, but the call returned");
}

/**
 * The value `key` maps to, or a failure naming what the pack does not hold.
 *
 * `noUncheckedIndexedAccess` makes every lookup nullable, and a fixture the test
 * needs is a fact the test states rather than one it silently skips over.
 */
function requireLookup<K, V>(lookup: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = lookup.get(key);
  if (value === undefined) {
    throw new Error(`the fixture pack holds no ${what}`);
  }
  return value;
}

/** What the pass rule yields for one candidate, recomputed from the pack alone. */
interface RecomputedOutcome {
  /** How many of the standard version's cases the candidate's recorded outputs match. */
  matchedCount: number;
  /** How many cases the standard version defines. */
  totalCount: number;
  /** How many of the mismatched cases carry the `critical` severity. */
  criticalFailures: number;
  /** `PASS` when the threshold holds with no critical failure, otherwise `FAIL`. */
  outcome: ReportOutcome;
  /** The ids of the cases the candidate did not match, ascending. */
  failingCaseIds: string[];
}

/**
 * Recomputes what the `SGI-SO-1.0.0` pass rule yields for `candidate`.
 *
 * A case matches when the candidate's recorded output for it is canonical-equal to
 * the case's expected output; a critical failure is a mismatched case whose
 * severity is `critical`; and the outcome is `PASS` only when the matched count
 * reaches the threshold and no critical case failed. Case ids are compared in
 * ascending order, so the failing list does not depend on the order the case set
 * happens to state them in.
 *
 * A case the candidate recorded no output for counts as a mismatch. Full coverage
 * is not the loader's contract — the API refuses an incomplete submission with
 * `422` before any report is written — so it is this recomputation, and the
 * coverage assertion beside it, that keep the recorded candidates complete.
 */
function recomputeOutcome(caseSet: CaseSet, candidate: CandidateSubmission): RecomputedOutcome {
  const outputsByCaseId = new Map(
    candidate.recorded_outputs.map((recorded) => [recorded.case_id, recorded.output]),
  );

  const failingCaseIds: string[] = [];
  let matchedCount = 0;
  let criticalFailures = 0;
  for (const fixtureCase of caseSet.cases) {
    const recordedOutput = outputsByCaseId.get(fixtureCase.id);
    const matched =
      recordedOutput !== undefined &&
      canonicalize(recordedOutput) === canonicalize(fixtureCase.expected_output);
    if (matched) {
      matchedCount += 1;
      continue;
    }
    failingCaseIds.push(fixtureCase.id);
    if (fixtureCase.severity === "critical") {
      criticalFailures += 1;
    }
  }
  failingCaseIds.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const passes =
    matchedCount >= PASS_THRESHOLD_MATCHES && criticalFailures <= CRITICAL_FAILURES_ALLOWED;

  return {
    matchedCount,
    totalCount: caseSet.total_cases,
    criticalFailures,
    outcome: passes ? "PASS" : "FAIL",
    failingCaseIds,
  };
}

describe("the SGI-SO-1.0.0 fixture pack", () => {
  describe("the case set", () => {
    it("declares its standard version and the 20 cases of which 5 are critical", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);

      expect(caseSet.standard_version_id).toBe(STANDARD_VERSION_ID);
      expect(caseSet.total_cases).toBe(20);
      expect(caseSet.critical_cases).toBe(5);
      expect(caseSet.cases).toHaveLength(20);
      expect(caseSet.cases.filter((fixtureCase) => fixtureCase.severity === "critical")).toHaveLength(
        5,
      );
    });

    it("marks exactly the documented cases critical", () => {
      const criticalIds = loadCaseSet(STANDARD_VERSION_ID)
        .cases.filter((fixtureCase) => fixtureCase.severity === "critical")
        .map((fixtureCase) => fixtureCase.id);

      expect(criticalIds).toStrictEqual(["so-001", "so-003", "so-005", "so-008", "so-012"]);
    });

    it("gives every case a unique identifier of the documented shape", () => {
      const ids = loadCaseSet(STANDARD_VERSION_ID).cases.map((fixtureCase) => fixtureCase.id);

      expect(new Set(ids).size).toBe(20);
      for (const id of ids) {
        expect(id).toMatch(/^so-\d{3}$/);
      }
    });

    it("gives every case an instruction, a source and a comparable expected output", () => {
      for (const fixtureCase of loadCaseSet(STANDARD_VERSION_ID).cases) {
        expect(fixtureCase.input.instruction.length).toBeGreaterThan(0);
        expect(fixtureCase.input.source.length).toBeGreaterThan(0);

        // The shape, not definedness. The loader already refuses a case with no JSON
        // `expected_output`, while `null`, a scalar and an array are all defined JSON, so a
        // definedness assertion could not fail for a wrong expectation. What the evaluator's
        // comparison consumes is an object with at least one member: `{}` compares against
        // nothing, and a scalar or a `null` reaches the comparison with no member at all.
        const rendered = canonicalize(fixtureCase.expected_output);
        expect(rendered).toMatch(/^\{/);
        expect(rendered).not.toBe("{}");
      }
    });
  });

  describe("refusals", () => {
    it.each([
      {
        subject: "an unshipped standard version",
        id: "SGI-SO-1.1.0",
        act: () => loadCaseSet("SGI-SO-1.1.0"),
      },
      {
        subject: "an unshipped candidate",
        id: "seed-delta",
        act: () => loadCandidate("seed-delta"),
      },
      {
        subject: "a candidate identifier carrying a parent segment",
        id: "../seed-alpha",
        act: () => loadCandidate("../seed-alpha"),
      },
      {
        subject: "a candidate identifier carrying an inner parent segment",
        id: "x/../seed-alpha",
        act: () => loadCandidate("x/../seed-alpha"),
      },
      {
        subject: "an empty candidate identifier",
        id: "",
        act: () => loadCandidate(""),
      },
      {
        subject: "a candidate identifier that is a parent segment",
        id: "..",
        act: () => loadCandidate(".."),
      },
      {
        // A caller outside this module's types can reach the boundary with a value that is not a
        // string at all; the refusal it receives must stay the module's own rather than a TypeError.
        subject: "a candidate identifier that is not a string",
        id: "undefined",
        act: () => loadCandidate(undefined as unknown as string),
      },
      {
        subject: "a case-set identifier carrying a parent segment",
        id: "../SGI-SO-1.0.0",
        act: () => loadCaseSet("../SGI-SO-1.0.0"),
      },
      {
        subject: "an empty case-set identifier",
        id: "",
        act: () => loadCaseSet(""),
      },
    ])("refuses $subject and names $id", ({ id, act }) => {
      expect(act).toThrow(/^sgi-fixtures:/);

      const message = refusalMessage(act);
      expect(message).toMatch(/^sgi-fixtures:/);
      expect(message).toContain(id);
    });
  });

  describe("the recorded candidates", () => {
    it.each(CANDIDATE_IDS)("loads %s with one output for every case", (candidateId) => {
      const caseIds = loadCaseSet(STANDARD_VERSION_ID).cases.map((fixtureCase) => fixtureCase.id);
      const candidate = loadCandidate(candidateId);

      expect(candidate.candidate_id).toBe(candidateId);
      expect(candidate.standard_version_id).toBe(STANDARD_VERSION_ID);
      expect(candidate.recorded_outputs).toHaveLength(caseIds.length);

      const recordedCaseIds = candidate.recorded_outputs.map((recorded) => recorded.case_id);
      expect(new Set(recordedCaseIds).size).toBe(recordedCaseIds.length);
      for (const caseId of recordedCaseIds) {
        expect(caseIds).toContain(caseId);
      }
    });

    it.each(CANDIDATE_IDS)("carries the version id recorded for %s", (candidateId) => {
      const recordedByCandidateId = new Map(
        loadExpectedOutcomes().candidates.map((entry) => [entry.candidate_id, entry]),
      );
      const expected = requireLookup(
        recordedByCandidateId,
        candidateId,
        `recorded outcome for candidate "${candidateId}"`,
      );

      expect(loadCandidate(candidateId).candidate_version_id).toBe(expected.candidate_version_id);
    });
  });

  describe("the recomputed outcomes", () => {
    const documented: {
      candidateId: string;
      outcome: ReportOutcome;
      matchedCount: number;
      totalCount: number;
      criticalFailures: number;
      failingCaseIds: string[];
    }[] = [
      {
        candidateId: "seed-alpha",
        outcome: "PASS",
        matchedCount: 20,
        totalCount: 20,
        criticalFailures: 0,
        failingCaseIds: [],
      },
      {
        candidateId: "seed-beta",
        outcome: "FAIL",
        matchedCount: 19,
        totalCount: 20,
        criticalFailures: 1,
        failingCaseIds: ["so-003"],
      },
      {
        candidateId: "seed-gamma",
        outcome: "FAIL",
        matchedCount: 17,
        totalCount: 20,
        criticalFailures: 0,
        failingCaseIds: ["so-014", "so-016", "so-018"],
      },
    ];

    it.each(documented)("recomputes $candidateId as $outcome", (entry) => {
      const recomputed = recomputeOutcome(
        loadCaseSet(STANDARD_VERSION_ID),
        loadCandidate(entry.candidateId),
      );

      expect(recomputed.outcome).toBe(entry.outcome);
      expect(recomputed.matchedCount).toBe(entry.matchedCount);
      expect(recomputed.totalCount).toBe(entry.totalCount);
      expect(recomputed.criticalFailures).toBe(entry.criticalFailures);
      expect(recomputed.failingCaseIds).toStrictEqual(entry.failingCaseIds);
    });

    it("records the outcomes in the order the pack states them", () => {
      expect(loadExpectedOutcomes().candidates.map((entry) => entry.candidate_id)).toStrictEqual([
        "seed-alpha",
        "seed-beta",
        "seed-gamma",
      ]);
    });

    it("records for every candidate exactly what a recomputation from the case set yields", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const outcomes = loadExpectedOutcomes();

      expect(outcomes.standard_version_id).toBe(STANDARD_VERSION_ID);
      for (const expected of outcomes.candidates) {
        const recomputed = recomputeOutcome(caseSet, loadCandidate(expected.candidate_id));

        expect({
          outcome: recomputed.outcome,
          matched_count: recomputed.matchedCount,
          total_count: recomputed.totalCount,
          critical_failures: recomputed.criticalFailures,
          failing_case_ids: recomputed.failingCaseIds,
        }).toStrictEqual({
          outcome: expected.outcome,
          matched_count: expected.matched_count,
          total_count: expected.total_count,
          critical_failures: expected.critical_failures,
          failing_case_ids: expected.failing_case_ids,
        });
      }
    });
  });

  describe("the canonical-JSON probe", () => {
    it("matches so-017 although the recorded key order differs", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const candidate = loadCandidate("seed-alpha");
      const expectedOutput = requireLookup(
        new Map(caseSet.cases.map((fixtureCase) => [fixtureCase.id, fixtureCase.expected_output])),
        "so-017",
        'the expected output of case "so-017"',
      );
      const recordedOutput = requireLookup(
        new Map(candidate.recorded_outputs.map((recorded) => [recorded.case_id, recorded.output])),
        "so-017",
        'the output seed-alpha records for case "so-017"',
      );

      // The recorded keys really are in another order: pinning that here is what stops a
      // later reader from tidying the fixture and deleting the only evidence for the rule.
      expect(JSON.stringify(recordedOutput)).not.toBe(JSON.stringify(expectedOutput));
      // The difference is key order alone, so the comparison scoring performs sees equality.
      expect(canonicalize(recordedOutput)).toBe(canonicalize(expectedOutput));

      const recomputed = recomputeOutcome(caseSet, candidate);
      expect(recomputed.outcome).toBe("PASS");
      expect(recomputed.matchedCount).toBe(20);
    });
  });

  describe("determinism", () => {
    it("returns deeply equal case sets on two consecutive loads", () => {
      expect(loadCaseSet(STANDARD_VERSION_ID)).toStrictEqual(loadCaseSet(STANDARD_VERSION_ID));
    });

    it("returns deeply equal expected outcomes on two consecutive loads", () => {
      expect(loadExpectedOutcomes()).toStrictEqual(loadExpectedOutcomes());
    });
  });

  describe("content hygiene", () => {
    it("publishes no at-sign and no bare run of five or more digits", () => {
      const caseSet = loadCaseSet(STANDARD_VERSION_ID);
      const published: string[] = [];

      collectStrings(caseSet.standard_version_id, published);
      for (const fixtureCase of caseSet.cases) {
        collectStrings(fixtureCase.id, published);
        collectStrings(fixtureCase.input.instruction, published);
        collectStrings(fixtureCase.input.source, published);
        collectStrings(fixtureCase.expected_output, published);
      }
      for (const candidateId of CANDIDATE_IDS) {
        const candidate = loadCandidate(candidateId);
        collectStrings(candidate.candidate_id, published);
        collectStrings(candidate.candidate_version_id, published);
        collectStrings(candidate.standard_version_id, published);
        for (const recorded of candidate.recorded_outputs) {
          collectStrings(recorded.case_id, published);
          collectStrings(recorded.output, published);
        }
      }
      const outcomes = loadExpectedOutcomes();
      collectStrings(outcomes.standard_version_id, published);
      for (const expected of outcomes.candidates) {
        collectStrings(expected.candidate_id, published);
        collectStrings(expected.candidate_version_id, published);
        collectStrings(expected.outcome, published);
        collectStrings(expected.failing_case_ids, published);
      }

      expect(published.filter((value) => value.includes(AT_SIGN))).toStrictEqual([]);

      // The mandated version identifiers are UUIDs and carry an eight-digit run, so that
      // shape is stripped before the digit check: without the carve-out this assertion would
      // contradict ids the seed and the report label depend on, while a bare digit run
      // anywhere else is still reported.
      expect(
        published
          .map((value) => value.replace(VERSION_IDENTIFIER_SHAPE, ""))
          .filter((value) => /\d{5,}/.test(value)),
      ).toStrictEqual([]);
    });
  });
});
