/**
 * The beside-source unit test of `buildReport` and `deriveReportLabel` from `./build-report`, the
 * constructor of an SGI evaluation report.
 *
 * It proves the things a report must be able to state, and nothing about how one is stored:
 *
 * - **The field list is closed.** The twelve report fields and the five evidence fields are asserted
 *   as key sets, so a field cannot be added to a report or dropped from one, and an evidence field
 *   cannot appear on a case, without this suite failing beside the change.
 * - **Nothing comparable is recomputed.** Every per-case value and the four totals come back exactly
 *   as the scorer produced them, in case-set order, and the rubric reference, the label and the
 *   retest link are the values that went in.
 * - **Two runs over one submission produce the same payload.** The two records differ only in the
 *   two write-time identity values, and with both supplied the whole records are equal — which is
 *   what makes a repeated evaluation reproducible and a replayed one exact.
 * - **The label rule is total.** All four combinations of origin and outcome return one of the two
 *   vocabulary words, and changing the outcome changes nothing.
 * - **An unpublished standard version is refused** through the registry's own error class, with the
 *   code a route maps to its status.
 * - **No input yields a partial record.** A submission that matched no case still produces a
 *   complete record carrying the failing outcome.
 *
 * The scored submissions are built from the real fixture pack through the loader and the scorer that
 * own those reads, so nothing here restates a threshold, a case count or an expected output: a
 * change to the pack or to the standard version reaches this suite as data. Nothing here opens a
 * database, reads a file of its own, reads an environment variable or reads a clock.
 */

import { describe, expect, it } from "vitest";

import { loadCandidate, loadCaseSet } from "@adem/sgi-fixtures";
import type { CandidateSubmission, CaseSet } from "@adem/sgi-fixtures";
import type { ReportLabel, ReportOutcome } from "@adem/shared";

import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";
import { UnknownStandardError } from "../standards/standard-registry";
import { scoreSubmission } from "../scoring/score-submission";
import type { ScoredSubmission } from "../scoring/score-submission";
import { buildReport, deriveReportLabel } from "./build-report";
import type { ReportRecord } from "./build-report";

/** The standard version the submissions below are scored against: the one provisional standard. */
const STANDARD = SGI_SO_1_0_0;

/** The three seed candidates the fixture pack records, in the order it records them. */
const SEED_CANDIDATE_IDS = ["seed-alpha", "seed-beta", "seed-gamma"] as const;

/** The twelve fields a report states, sorted, as the closed field-list assertion compares them. */
const REPORT_FIELD_NAMES = [
  "candidateVersionId",
  "caseResults",
  "createdAt",
  "criticalFailures",
  "label",
  "matchedCount",
  "outcome",
  "priorReportId",
  "reportId",
  "rubricReference",
  "standardVersionId",
  "totalCount",
] as const;

/** The five fields one case's evidence states, sorted, as the same assertion compares them. */
const EVIDENCE_FIELD_NAMES = ["actualJson", "caseId", "expectedJson", "match", "severity"] as const;

/** The case set of the standard version, read fresh so no test shares loaded state with another. */
function caseSetOf(): CaseSet {
  return loadCaseSet(STANDARD.fixtureSetId);
}

/** The submission the pack records for one candidate, read fresh. */
function candidateOf(candidateId: string): CandidateSubmission {
  return loadCandidate(candidateId);
}

/** One seed candidate scored against the shipped case set, through the shipped scorer. */
function scoredOf(candidateId: string): ScoredSubmission {
  return scoreSubmission(STANDARD, caseSetOf(), candidateOf(candidateId));
}

/**
 * The same submission with every recording replaced by a value no case's expected output can equal,
 * so the scorer matches no case while the submission stays complete: each case the set defines still
 * carries exactly one recording.
 *
 * The replacement is derived from the case id — an object stating the case it was recorded for, under
 * a key no case's expected output uses — and the test that uses it asserts the matched count is zero,
 * so a coincidence would fail the suite rather than pass unnoticed.
 */
function unmatchableCandidateOf(candidateId: string): CandidateSubmission {
  const recorded = candidateOf(candidateId);
  return {
    ...recorded,
    recorded_outputs: recorded.recorded_outputs.map((output) => ({
      case_id: output.case_id,
      output: { recorded_for: output.case_id },
    })),
  };
}

/**
 * The report a caller would build for one scored submission whose version was seeded as a fixture
 * candidate and which has no earlier report: the two provenance values the scorer resolved, the
 * label such a version earns, and no retest link.
 */
function buildSampleReport(scored: ScoredSubmission): ReportRecord {
  return buildReport(scored, {
    candidateVersionId: scored.candidateVersionId,
    standardVersionId: scored.standardVersionId,
    label: "SAMPLE",
    priorReportId: null,
  });
}

/** The evidence a report carries for each case, as the scorer states it, field for field. */
function evidenceOf(scored: ScoredSubmission) {
  return scored.caseResults.map((caseResult) => ({
    caseId: caseResult.caseId,
    severity: caseResult.severity,
    expectedJson: caseResult.expectedJson,
    actualJson: caseResult.actualJson,
    match: caseResult.match,
  }));
}

/** Reads a refusal out of a call that must fail, so its class and its fields can be asserted. */
function captureRefusal(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    return error;
  }
  throw new Error("the call was expected to refuse, and returned instead");
}

describe("buildReport", () => {
  describe("the record's field list", () => {
    it("carries exactly the twelve fields of a report, and no thirteenth", () => {
      const record = buildSampleReport(scoredOf("seed-alpha"));

      expect(Object.keys(record).sort()).toEqual([...REPORT_FIELD_NAMES]);
    });

    it("carries exactly the five evidence fields on every case, one case per fixture case", () => {
      const caseSet = caseSetOf();
      const record = buildSampleReport(scoredOf("seed-alpha"));

      expect(record.caseResults).toHaveLength(caseSet.total_cases);
      expect(record.caseResults.map((evidence) => evidence.caseId)).toEqual(
        caseSet.cases.map((fixtureCase) => fixtureCase.id),
      );

      for (const evidence of record.caseResults) {
        expect(Object.keys(evidence).sort()).toEqual([...EVIDENCE_FIELD_NAMES]);
      }
    });
  });

  describe("what the record copies from the scored submission", () => {
    it.each(SEED_CANDIDATE_IDS)(
      "carries the outcome, the totals and the critical failures %s was scored with",
      (candidateId) => {
        const scored = scoredOf(candidateId);
        const record = buildSampleReport(scored);

        expect(record.outcome).toBe(scored.outcome);
        expect(record.matchedCount).toBe(scored.matchedCount);
        expect(record.totalCount).toBe(scored.totalCount);
        expect(record.criticalFailures).toBe(scored.criticalFailures);
        expect(record.caseResults).toHaveLength(scored.totalCount);
        expect(record.candidateVersionId).toBe(scored.candidateVersionId);
        expect(record.standardVersionId).toBe(scored.standardVersionId);
      },
    );

    it("copies every per-case value verbatim, in the order the scorer returned it", () => {
      const scored = scoredOf("seed-beta");
      const record = buildSampleReport(scored);

      expect(record.caseResults).toStrictEqual(evidenceOf(scored));
    });
  });

  describe("two runs over one submission", () => {
    it("differ only in the two write-time identity values", () => {
      const scored = scoredOf("seed-gamma");

      const first = buildSampleReport(scored);
      const second = buildSampleReport(scored);

      const { reportId: firstId, createdAt: firstInstant, ...firstComparable } = first;
      const { reportId: secondId, createdAt: secondInstant, ...secondComparable } = second;

      expect(firstComparable).toStrictEqual(secondComparable);
      expect(firstComparable.caseResults).toStrictEqual(evidenceOf(scored));

      // The identity values are stateable claims rather than opaque strings: an identifier, and an
      // instant that round-trips through the ISO-8601 UTC form the report stores.
      expect(firstId).not.toBe(secondId);
      expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(new Date(firstInstant).toISOString()).toBe(firstInstant);
      expect(new Date(secondInstant).toISOString()).toBe(secondInstant);
    });

    it("are equal in full when the caller states both identity values, as a replay does", () => {
      const scored = scoredOf("seed-gamma");
      const options = {
        candidateVersionId: scored.candidateVersionId,
        standardVersionId: scored.standardVersionId,
        label: "SAMPLE",
        priorReportId: null,
        reportId: "demo-report-replayed-west",
        createdAt: "2024-07-01T09:30:00.000Z",
      } as const;

      const first = buildReport(scored, options);
      const second = buildReport(scored, options);

      expect(first.reportId).toBe("demo-report-replayed-west");
      expect(first.createdAt).toBe("2024-07-01T09:30:00.000Z");
      expect(first).toStrictEqual(second);
    });

    it("do not alias the scored submission: the evidence array and each entry are new", () => {
      const scored = scoredOf("seed-alpha");
      const record = buildSampleReport(scored);

      expect(record.caseResults).not.toBe(scored.caseResults);
      expect(record.caseResults).toHaveLength(scored.caseResults.length);
      for (const [index, evidence] of record.caseResults.entries()) {
        expect(evidence).not.toBe(scored.caseResults[index]);
      }
      expect(record.caseResults).toStrictEqual(evidenceOf(scored));
    });
  });

  describe("the provenance the record states", () => {
    it("cites the rubric reference the standard version publishes", () => {
      const record = buildSampleReport(scoredOf("seed-alpha"));

      expect(record.rubricReference).toBe(STANDARD.rubricReference);
      expect(record.rubricReference).toBe("SGI-SO-1.0.0#rubric");
    });

    it.each(["SAMPLE", "VERIFIED-IN-DEMO"] as const)(
      "passes the %s label through unchanged",
      (label) => {
        const scored = scoredOf("seed-alpha");
        const record = buildReport(scored, {
          candidateVersionId: scored.candidateVersionId,
          standardVersionId: scored.standardVersionId,
          label,
          priorReportId: null,
        });

        expect(record.label).toBe(label);
      },
    );

    it.each<[string, string | null]>([
      ["a first report", null],
      ["a retest", "demo-report-east-alpha"],
    ])("states %s's retest link as it was passed in", (_described, priorReportId) => {
      const scored = scoredOf("seed-alpha");
      const record = buildReport(scored, {
        candidateVersionId: scored.candidateVersionId,
        standardVersionId: scored.standardVersionId,
        label: "SAMPLE",
        priorReportId,
      });

      expect(record.priorReportId).toBe(priorReportId);
    });

    it("refuses a standard version this release does not publish, without building a record", () => {
      const scored = scoredOf("seed-alpha");

      const refusal = captureRefusal(() =>
        buildReport(scored, {
          candidateVersionId: scored.candidateVersionId,
          standardVersionId: "SGI-SO-9.9.9",
          label: "SAMPLE",
          priorReportId: null,
        }),
      );

      expect(refusal).toBeInstanceOf(UnknownStandardError);
      const unknownStandard = refusal as UnknownStandardError;
      expect(unknownStandard.name).toBe("UnknownStandardError");
      expect(unknownStandard.code).toBe("unknown_standard");
      expect(unknownStandard.reference).toBe("SGI-SO-9.9.9");
      expect(unknownStandard.message).toContain("SGI-SO-9.9.9");
    });
  });

  describe("a submission that matched no case", () => {
    it("still yields a complete record, with the failing outcome and a label", () => {
      const caseSet = caseSetOf();
      const scored = scoreSubmission(
        STANDARD,
        caseSet,
        unmatchableCandidateOf("seed-alpha"),
      );
      const record = buildSampleReport(scored);

      expect(scored.matchedCount).toBe(0);
      expect(record.outcome).toBe("FAIL");
      expect(record.matchedCount).toBe(0);
      expect(record.totalCount).toBe(caseSet.total_cases);
      expect(record.caseResults).toHaveLength(caseSet.total_cases);
      expect(record.criticalFailures).toBe(caseSet.critical_cases);
      expect(record.label).toBe("SAMPLE");
      expect(record.rubricReference).toBe(STANDARD.rubricReference);
      expect(Object.keys(record).sort()).toEqual([...REPORT_FIELD_NAMES]);
    });
  });
});

describe("deriveReportLabel", () => {
  it.each<[boolean, ReportOutcome, ReportLabel]>([
    [true, "PASS", "SAMPLE"],
    [true, "FAIL", "SAMPLE"],
    [false, "PASS", "VERIFIED-IN-DEMO"],
    [false, "FAIL", "VERIFIED-IN-DEMO"],
  ])(
    "labels a version whose fixture-candidate flag is %s and whose outcome is %s as %s",
    (isFixtureCandidate, outcome, expected) => {
      expect(deriveReportLabel(isFixtureCandidate, outcome)).toBe(expected);
    },
  );

  it("states an origin and never a verdict: both labels occur on a failed report as on a passed one", () => {
    const labelsForFailure = [true, false].map((isFixtureCandidate) =>
      deriveReportLabel(isFixtureCandidate, "FAIL"),
    );
    const labelsForPass = [true, false].map((isFixtureCandidate) =>
      deriveReportLabel(isFixtureCandidate, "PASS"),
    );

    expect(labelsForFailure).toEqual(labelsForPass);
    expect(labelsForFailure).toStrictEqual(["SAMPLE", "VERIFIED-IN-DEMO"]);
  });
});
