/**
 * The beside-source unit test of `buildReport` and `deriveReportLabel` from `./build-report`: the
 * constructor of an SGI evaluation report, and the one statement of the closed report-label rule.
 *
 * What it proves:
 *
 * - **Every field is stated.** The twelve report fields are asserted with their values and as a key
 *   set, and so are the five fields of one case's evidence, so a field cannot be added to a report,
 *   dropped from one or appear on a case without this suite failing beside the change.
 * - **Nothing comparable is recomputed.** Each per-case value and the four totals come back exactly
 *   as the scored submission stated them, in the order the scorer returned them, and the rubric
 *   reference, the label and the retest link are the values that went in. One variant states counts
 *   and an outcome a recount of its own evidence would not produce, which is what tells copying from
 *   recounting.
 * - **The identity boundary.** Two builds of one scored submission differ in the report identifier
 *   and the creation instant and in nothing else, and with both supplied the whole records compare
 *   equal — the reproducibility a repeated evaluation promises and an exact replay relies on.
 * - **The label rule is total.** All four combinations of origin and outcome return one of the two
 *   vocabulary words, and the outcome changes nothing.
 * - **An unpublished standard version is refused** through the registry's own error class, carrying
 *   the code a route maps to its status, building nothing and leaving the next valid build alone.
 * - **No input yields a partial record.** A submission that matched no case still produces a complete
 *   record carrying the failing outcome, the rubric reference and a label.
 *
 * The scored submissions are hand-built from the shapes `../scoring/score-submission` declares rather
 * than read from the fixture pack: this module copies the canonical strings a comparison already
 * produced, so the values it must be tested with are the values a scorer hands over, and the two that
 * prove the copy most sharply — a canonical text carrying a trailing space inside a string value, and
 * one whose keys are deliberately not in sorted order — are values a real case set has no reason to
 * offer. Nothing here opens a database, loads a fixture pack, reads a file of its own, reads an
 * environment variable, reaches the network or records a snapshot of a generated value.
 */

import { describe, expect, it } from "vitest";

import type { ReportLabel, ReportOutcome } from "@adem/shared";

import type { CaseResult, ScoredSubmission } from "../scoring/score-submission";
import { UnknownStandardError } from "../standards/standard-registry";
import { buildReport, deriveReportLabel } from "./build-report";
import type { BuildReportOptions, ReportRecord } from "./build-report";

/** The standard version label a report cites: the one provisional standard of this release. */
const STANDARD_VERSION_ID = "SGI-SO-1.0.0";

/**
 * The evaluated version's identifier: the `seed-alpha` fixture version id, so the values this file
 * states agree with the seed data and the fixture pack that carry the same version.
 */
const CANDIDATE_VERSION_ID = "00000000-0000-4000-8000-0000000000a1";

/** The rubric reference a report of this standard version states. */
const RUBRIC_REFERENCE = "SGI-SO-1.0.0#rubric";

/** A standard version label this release publishes no version of. */
const UNPUBLISHED_STANDARD_VERSION_ID = "SGI-SO-9.9.9";

/** The report identifier a replay supplies, so no identifier is generated for it. */
const FIXED_REPORT_ID = "report-seed-alpha-replayed-east";

/** The creation instant a replay supplies, in the ISO-8601 UTC form a report stores. */
const FIXED_CREATED_AT = "2024-07-01T09:30:00.000Z";

/** The earlier report a retest links to, as `apps/api` derives it from the reports it stores. */
const PRIOR_REPORT_ID = "report-seed-alpha-first-run";

/** The case whose expected canonical text carries a trailing space inside a string value. */
const PADDED_NOTE_CASE_ID = "so-002";

/** The one case the fixture marks `critical`: the severity a failure of fails the candidate outright. */
const CRITICAL_CASE_ID = "so-004";

/** The case whose canonical text is deliberately not in sorted key order. */
const UNSORTED_KEYS_CASE_ID = "so-001";

/** The fourth, ordinary case. */
const PLAIN_CASE_ID = "so-019";

/**
 * The four cases of the hand-built scored submission, in the order the scorer returns them.
 *
 * Case-set order, deliberately not ascending by case id, so the evidence a record carries is the
 * order the scored submission stated rather than one sorted into it.
 */
const CASE_IDS_IN_SET_ORDER = [
  PADDED_NOTE_CASE_ID,
  PLAIN_CASE_ID,
  CRITICAL_CASE_ID,
  UNSORTED_KEYS_CASE_ID,
] as const;

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

/**
 * The expected output of {@link PADDED_NOTE_CASE_ID}, as canonical JSON text.
 *
 * Its keys are in canonical order, it carries no insignificant whitespace, and its one string value
 * ends with a space **inside the quotes** — the whitespace a canonical form keeps, because it is part
 * of the value rather than between tokens. A builder that stripped or collapsed whitespace, or that
 * trimmed what it carried, would move the payload two runs of one submission compare, which is why
 * this value, and not an ordinary one, is the one that guard is asserted through.
 */
const PADDED_NOTE_JSON = '{"note":"padded ","status":"ok"}';

/** The expected output of {@link PLAIN_CASE_ID}: an ordinary canonical text, matched by its recording. */
const PLAIN_JSON = '{"items":["alpha","beta"],"ok":true}';

/** The expected output of {@link CRITICAL_CASE_ID}, matched in the passing fixture. */
const ALLOW_RULE_JSON = '{"decision":"allow","rule":"rules/allow-read"}';

/**
 * The output every variant that fails the critical case records for it: a value that case's expected
 * output cannot equal, so the case is a mismatch while the recording stays well-formed data.
 */
const DENY_RULE_JSON = '{"decision":"deny","rule":"rules/deny-everything"}';

/** The output a variant matching no case records: no case's expected output can equal it. */
const NO_MATCH_JSON = '{"recorded":"no-match"}';

/**
 * The expected output of {@link UNSORTED_KEYS_CASE_ID}: canonical JSON text in every respect except
 * its key order, which is deliberately the reverse of canonical.
 *
 * It is the canary for re-serialisation: a builder that parsed and re-rendered this string, or that
 * canonicalised it a second time, would swap its two keys into canonical order and hand back a
 * different payload than the one the comparison compared.
 */
const UNSORTED_KEYS_JSON = '{"status":"aligned","attempt":1}';

/** The version-4 UUID form `randomUUID` produces, which a generated report identifier must match. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The ISO-8601 UTC instant form `new Date().toISOString()` produces: date, time to the millisecond
 * and a trailing `Z`, which is the form `evaluation_reports.created_at` stores and what SQLite's own
 * `CURRENT_TIMESTAMP` does not produce — no `T`, no milliseconds, no zone marker.
 */
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The shape of an identifier span: the hyphen-separated form the scan exempts as machine-written. */
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A run of five or more consecutive digits, the shape the scan's data classes watch for. */
const DIGIT_RUN_5_OR_MORE = /\d{5,}/;

/** How long a case waits for the host clock to move past one generated instant, in milliseconds. */
const CLOCK_ADVANCE_BUDGET_MS = 200;

/**
 * The scored submission every case below starts from: four cases, three `standard` and one
 * `critical`, with the totals a fully matched run produces.
 *
 * The canonical strings are hand-written, because the comparison's output is exactly what this module
 * copies, and two of them are the canaries described at their declarations. Every call builds fresh
 * arrays and fresh entries, so a case may hand one call's value to the builder and compare the record
 * against that same value afterwards.
 *
 * `overrides` exists for the variants: a scored submission whose recordings, counts or outcome say
 * something else is one field away, so no case reassembles the shape by hand and the variants stay
 * recognisably the same submission.
 */
function makeScored(overrides: Partial<ScoredSubmission> = {}): ScoredSubmission {
  return {
    standardVersionId: STANDARD_VERSION_ID,
    candidateVersionId: CANDIDATE_VERSION_ID,
    caseResults: [
      {
        caseId: PADDED_NOTE_CASE_ID,
        severity: "standard",
        expectedJson: PADDED_NOTE_JSON,
        actualJson: PADDED_NOTE_JSON,
        match: true,
      },
      {
        caseId: PLAIN_CASE_ID,
        severity: "standard",
        expectedJson: PLAIN_JSON,
        actualJson: PLAIN_JSON,
        match: true,
      },
      {
        caseId: CRITICAL_CASE_ID,
        severity: "critical",
        expectedJson: ALLOW_RULE_JSON,
        actualJson: ALLOW_RULE_JSON,
        match: true,
      },
      {
        caseId: UNSORTED_KEYS_CASE_ID,
        severity: "standard",
        expectedJson: UNSORTED_KEYS_JSON,
        actualJson: UNSORTED_KEYS_JSON,
        match: true,
      },
    ],
    matchedCount: CASE_IDS_IN_SET_ORDER.length,
    totalCount: CASE_IDS_IN_SET_ORDER.length,
    criticalFailures: 0,
    failingCaseIds: [],
    outcome: "PASS",
    ...overrides,
  };
}

/**
 * The same fixture with the named cases recorded a non-matching output, so a variant's evidence is one
 * edit away from the fixture's and the two canaries stay in place.
 */
function withMismatchingCases(
  scored: ScoredSubmission,
  caseIds: readonly string[],
  mismatchJson: string,
): ScoredSubmission {
  return {
    ...scored,
    caseResults: scored.caseResults.map((caseResult): CaseResult =>
      caseIds.includes(caseResult.caseId)
        ? { ...caseResult, actualJson: mismatchJson, match: false }
        : caseResult,
    ),
  };
}

/**
 * The fixture as the pass rule sees it when its one `critical` case records a different output: three
 * matches of four, one critical failure, and the failing outcome — the state a failing critical case
 * puts any candidate in, whatever the other cases did, and the one a report must carry the totals of.
 */
function makeFailedScored(): ScoredSubmission {
  return {
    ...withMismatchingCases(makeScored(), [CRITICAL_CASE_ID], DENY_RULE_JSON),
    matchedCount: 3,
    criticalFailures: 1,
    failingCaseIds: [CRITICAL_CASE_ID],
    outcome: "FAIL",
  };
}

/**
 * The fixture as it looks when no case matches: the zero-match edge, where a report must still be
 * complete rather than partial, carrying the failing outcome and a label.
 */
function makeNoMatchScored(): ScoredSubmission {
  return {
    ...withMismatchingCases(makeScored(), CASE_IDS_IN_SET_ORDER, NO_MATCH_JSON),
    matchedCount: 0,
    criticalFailures: 1,
    failingCaseIds: [...CASE_IDS_IN_SET_ORDER].sort(),
    outcome: "FAIL",
  };
}

/**
 * A scored submission whose counts and outcome are deliberately **not** a recount of its own evidence.
 *
 * All four of its case results match, so a builder that recounted the evidence, or that re-derived the
 * outcome from the pass rule, would answer four matches, no critical failure and `PASS`. This value
 * states three matches, one failing ordinary case and `FAIL`, and the case that uses it asserts
 * exactly those numbers: it is the only shape a copied total can be told apart from a recounted one
 * in, because for any coherent submission the two agree.
 */
function makeUnrecountedScored(): ScoredSubmission {
  return makeScored({
    matchedCount: 3,
    failingCaseIds: [PLAIN_CASE_ID],
    outcome: "FAIL",
  });
}

/**
 * The report options a scored submission is built with: the four provenance values the caller
 * resolved, with the label and the retest link overridable and the two identity values left for the
 * builder to generate unless a case supplies them.
 */
function optionsFor(
  scored: ScoredSubmission,
  overrides: Partial<BuildReportOptions> = {},
): BuildReportOptions {
  return {
    candidateVersionId: scored.candidateVersionId,
    standardVersionId: scored.standardVersionId,
    label: "SAMPLE",
    priorReportId: null,
    ...overrides,
  };
}

/** The report a seeded fixture candidate's submission produces, with both identity values generated. */
function buildSampleReport(scored: ScoredSubmission): ReportRecord {
  return buildReport(scored, optionsFor(scored));
}

/** The evidence a report carries for each case, as the scored submission states it, field for field. */
function evidenceOf(scored: ScoredSubmission) {
  return scored.caseResults.map((caseResult) => ({
    caseId: caseResult.caseId,
    severity: caseResult.severity,
    expectedJson: caseResult.expectedJson,
    actualJson: caseResult.actualJson,
    match: caseResult.match,
  }));
}

/**
 * The evidence one case id carries, from a built record or from a scored submission.
 *
 * `noUncheckedIndexedAccess` makes an indexed read a possible absence, so the absence is handled where
 * it can happen — reported by case id — rather than silenced with a non-null assertion.
 */
function requireCaseById<T extends { readonly caseId: string }>(
  cases: readonly T[],
  caseId: string,
): T {
  const match = cases.find((candidate) => candidate.caseId === caseId);
  if (match === undefined) {
    throw new Error(`no case "${caseId}" is present in the evidence handed to this case`);
  }
  return match;
}

/**
 * Runs a call that must refuse, reporting both the thrown value and whether anything came back, so a
 * case can assert the refusal and that nothing was built in the same breath.
 */
function captureRefusal(build: () => unknown): {
  readonly thrown: unknown;
  readonly returned: unknown;
} {
  try {
    return { thrown: undefined, returned: build() };
  } catch (error) {
    return { thrown: error, returned: undefined };
  }
}

/**
 * Every string inside one fixture value.
 *
 * The hygiene guard below walks the values this file states rather than a list kept beside them, so a
 * string added to the fixture is covered by the guard the moment it is added.
 */
function collectStrings(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

/** Every string this file states as its own data, in every shape the guard reads them in. */
function fixtureDataStrings(): readonly string[] {
  return [
    ...collectStrings(makeScored()),
    ...collectStrings(makeFailedScored()),
    ...collectStrings(makeNoMatchScored()),
    ...collectStrings(makeUnrecountedScored()),
    ...collectStrings(
      optionsFor(makeScored(), {
        reportId: FIXED_REPORT_ID,
        createdAt: FIXED_CREATED_AT,
        priorReportId: PRIOR_REPORT_ID,
      }),
    ),
    UNPUBLISHED_STANDARD_VERSION_ID,
    RUBRIC_REFERENCE,
    "SAMPLE",
    "VERIFIED-IN-DEMO",
  ];
}

/**
 * Waits, boundedly, for the host clock to move past `instantMs`, so the next instant a build generates
 * is strictly later than it.
 *
 * This is the one place this file reads a clock, and it exists because the case below must state that
 * two builds generate their own creation instants: `createdAt` is written to the millisecond, so two
 * builds landing inside one millisecond legitimately carry the same instant, and without this wait the
 * difference that case pins would be a coincidence of how fast the two calls ran. The wait makes it an
 * observed fact instead — and the assertion it enables compares two generated values rather than a
 * clock reading, so nothing here depends on what the clock says or on the timezone it says it in.
 *
 * The wait is bounded so that a host whose clock did not advance fails this file with its reason
 * instead of hanging the suite.
 */
function waitForInstantToPass(instantMs: number): void {
  const deadlineMs = Date.now() + CLOCK_ADVANCE_BUDGET_MS;
  while (Date.now() <= instantMs) {
    if (Date.now() >= deadlineMs) {
      throw new Error(
        `the host clock did not move past ${new Date(instantMs).toISOString()} within ${CLOCK_ADVANCE_BUDGET_MS} ms, so the two builds' creation instants could not be told apart`,
      );
    }
  }
}

describe("buildReport", () => {
  describe("the record it states", () => {
    it("states all twelve report fields, with the values that were evaluated or resolved", () => {
      const scored = makeScored();
      const record = buildReport(
        scored,
        optionsFor(scored, {
          reportId: FIXED_REPORT_ID,
          createdAt: FIXED_CREATED_AT,
          priorReportId: PRIOR_REPORT_ID,
        }),
      );

      expect(record.reportId).toBe(FIXED_REPORT_ID);
      expect(record.candidateVersionId).toBe(CANDIDATE_VERSION_ID);
      expect(record.candidateVersionId).toBe(scored.candidateVersionId);
      expect(record.standardVersionId).toBe(STANDARD_VERSION_ID);
      expect(record.caseResults).toStrictEqual(evidenceOf(scored));
      expect(record.matchedCount).toBe(4);
      expect(record.totalCount).toBe(4);
      expect(record.criticalFailures).toBe(0);
      expect(record.outcome).toBe("PASS");
      expect(record.rubricReference).toBe("SGI-SO-1.0.0#rubric");
      expect(record.label).toBe("SAMPLE");
      expect(record.priorReportId).toBe(PRIOR_REPORT_ID);
      expect(record.createdAt).toBe(FIXED_CREATED_AT);
    });

    it("states exactly those twelve fields on the record, and exactly five on each case's evidence", () => {
      const scored = makeScored();
      const record = buildSampleReport(scored);

      expect(Object.keys(record).sort()).toEqual([...REPORT_FIELD_NAMES]);
      expect(record.caseResults).toHaveLength(CASE_IDS_IN_SET_ORDER.length);
      for (const evidence of record.caseResults) {
        expect(Object.keys(evidence).sort()).toEqual([...EVIDENCE_FIELD_NAMES]);
      }
    });
  });

  describe("what it copies from the scored submission", () => {
    it("carries each per-case string through untouched, in the order the scorer returned it", () => {
      const scored = makeScored();
      const record = buildSampleReport(scored);

      expect(record.caseResults.map((evidence) => evidence.caseId)).toEqual([
        ...CASE_IDS_IN_SET_ORDER,
      ]);
      expect(record.caseResults).toStrictEqual(evidenceOf(scored));

      // Character for character, against the strings the scored submission stated: a builder that
      // re-serialised either one, canonicalised it a second time, or collapsed whitespace that is part
      // of a value would hand back a different payload than the comparison compared.
      for (const evidence of record.caseResults) {
        const stated = requireCaseById(scored.caseResults, evidence.caseId);
        expect(evidence.expectedJson).toBe(stated.expectedJson);
        expect(evidence.actualJson).toBe(stated.actualJson);
      }

      // The two canaries, and the reason each was chosen: a value whose canonical text carries a
      // trailing space inside its string, and one whose keys are deliberately not in canonical order.
      const paddedNote = requireCaseById(record.caseResults, PADDED_NOTE_CASE_ID);
      expect(paddedNote.expectedJson).toBe(PADDED_NOTE_JSON);
      expect(paddedNote.actualJson).toBe(PADDED_NOTE_JSON);
      expect(PADDED_NOTE_JSON).toContain('"padded "');

      const unsortedKeys = requireCaseById(record.caseResults, UNSORTED_KEYS_CASE_ID);
      expect(unsortedKeys.expectedJson).toBe(UNSORTED_KEYS_JSON);
      expect(UNSORTED_KEYS_JSON).toBe('{"status":"aligned","attempt":1}');
    });

    it("copies a FAIL variant's totals and outcome rather than recounting its evidence", () => {
      const failed = makeFailedScored();
      const failedRecord = buildReport(failed, optionsFor(failed));

      expect(failedRecord.outcome).toBe("FAIL");
      expect(failedRecord.matchedCount).toBe(3);
      expect(failedRecord.totalCount).toBe(4);
      expect(failedRecord.criticalFailures).toBe(1);
      expect(failedRecord.outcome).toBe(failed.outcome);
      expect(failedRecord.matchedCount).toBe(failed.matchedCount);
      expect(failedRecord.totalCount).toBe(failed.totalCount);
      expect(failedRecord.criticalFailures).toBe(failed.criticalFailures);
      expect(requireCaseById(failedRecord.caseResults, CRITICAL_CASE_ID).match).toBe(false);

      // The decisive value: this submission's evidence matches every case, so a builder that recounted
      // it, or that re-derived the outcome from the pass rule, would answer four matches of four, no
      // critical failure and PASS.
      const unrecounted = makeUnrecountedScored();
      const unrecountedRecord = buildReport(unrecounted, optionsFor(unrecounted));

      expect(unrecountedRecord.matchedCount).toBe(3);
      expect(unrecountedRecord.totalCount).toBe(4);
      expect(unrecountedRecord.criticalFailures).toBe(0);
      expect(unrecountedRecord.outcome).toBe("FAIL");
      expect(unrecountedRecord.caseResults.every((evidence) => evidence.match)).toBe(true);
    });

    it("does not alias the scored submission: the evidence array and each of its entries are new", () => {
      const scored = makeScored();
      const record = buildSampleReport(scored);

      expect(record.caseResults).not.toBe(scored.caseResults);
      expect(record.caseResults).toHaveLength(scored.caseResults.length);
      for (const [index, evidence] of record.caseResults.entries()) {
        expect(evidence).not.toBe(scored.caseResults[index]);
      }
      expect(record.caseResults).toStrictEqual(evidenceOf(scored));
    });
  });

  describe("the identity values a report cannot derive", () => {
    it("differ between two builds of one submission, and are the only fields that do", () => {
      const scored = makeScored();

      const first = buildSampleReport(scored);
      waitForInstantToPass(Date.parse(first.createdAt));
      const second = buildSampleReport(scored);

      expect(first.reportId).not.toBe("");
      expect(second.reportId).not.toBe("");
      expect(first.createdAt).not.toBe("");
      expect(second.createdAt).not.toBe("");
      expect(first.reportId).not.toBe(second.reportId);
      expect(second.createdAt).not.toBe(first.createdAt);

      // The whole records, not a hand-listed subset: with the second build's identity values replaced
      // by the first build's, nothing distinguishes the two payloads.
      expect({ ...second, reportId: first.reportId, createdAt: first.createdAt }).toStrictEqual(
        first,
      );
    });

    it("are equal in full when the caller states both, as a replay does", () => {
      const scored = makeScored();
      const options = optionsFor(scored, {
        reportId: FIXED_REPORT_ID,
        createdAt: FIXED_CREATED_AT,
      });

      const first = buildReport(scored, options);
      const second = buildReport(scored, options);

      expect(first.reportId).toBe(FIXED_REPORT_ID);
      expect(first.createdAt).toBe(FIXED_CREATED_AT);
      expect(first).toStrictEqual(second);
    });

    it("are generated in the version-4 UUID form and the ISO-8601 UTC form the report stores", () => {
      const record = buildSampleReport(makeScored());

      // The shapes are asserted and never the values: the instant is read from the host clock, so a
      // case pinning a value would depend on the clock it happened to run against.
      expect(record.reportId).toMatch(UUID_V4_PATTERN);
      expect(record.createdAt).toMatch(ISO_8601_UTC_PATTERN);
    });
  });

  describe("the provenance it states", () => {
    it("cites the rubric reference the standard version of this release publishes", () => {
      const record = buildSampleReport(makeScored());

      // The literal is the contract: it resolves to the rubric document section `#rubric`, stating the
      // rubric, the evidence semantics and the badge scope this report was scored against.
      expect(record.rubricReference).toBe(RUBRIC_REFERENCE);
      expect(record.rubricReference).toBe("SGI-SO-1.0.0#rubric");
    });

    it.each(["SAMPLE", "VERIFIED-IN-DEMO"] as const)(
      "passes the %s label through unchanged, on a passing and on a failing record alike",
      (label) => {
        const passed = makeScored();
        const failed = makeFailedScored();

        const passedRecord = buildReport(passed, optionsFor(passed, { label }));
        const failedRecord = buildReport(failed, optionsFor(failed, { label }));

        expect(passedRecord.label).toBe(label);
        expect(passedRecord.outcome).toBe("PASS");
        expect(failedRecord.label).toBe(label);
        expect(failedRecord.outcome).toBe("FAIL");
      },
    );

    it.each<[string, string | null]>([
      ["a first report", null],
      ["a retest", PRIOR_REPORT_ID],
    ])("states %s's retest link as it was passed in", (_described, priorReportId) => {
      const scored = makeScored();
      const record = buildReport(scored, optionsFor(scored, { priorReportId }));

      expect(record.priorReportId).toBe(priorReportId);
    });

    it("refuses a standard version this release does not publish, builds nothing, and builds a valid record straight afterwards", () => {
      const scored = makeScored();

      const refusal = captureRefusal(() =>
        buildReport(
          scored,
          optionsFor(scored, { standardVersionId: UNPUBLISHED_STANDARD_VERSION_ID }),
        ),
      );

      expect(refusal.returned).toBeUndefined();
      expect(refusal.thrown).toBeInstanceOf(UnknownStandardError);
      if (!(refusal.thrown instanceof UnknownStandardError)) {
        throw new Error("the refusal was not the standards registry's unknown-standard error");
      }
      expect(refusal.thrown.name).toBe("UnknownStandardError");
      expect(refusal.thrown.code).toBe("unknown_standard");
      expect(refusal.thrown.reference).toBe(UNPUBLISHED_STANDARD_VERSION_ID);
      expect(refusal.thrown.message).toContain(UNPUBLISHED_STANDARD_VERSION_ID);

      // Not sticky module state: the refusal is a property of the label that was passed in, so the
      // next valid call still builds a complete record.
      const record = buildSampleReport(scored);
      expect(record.standardVersionId).toBe(STANDARD_VERSION_ID);
      expect(record.rubricReference).toBe(RUBRIC_REFERENCE);
      expect(Object.keys(record).sort()).toEqual([...REPORT_FIELD_NAMES]);
    });

    it("still yields a complete record for a submission that matched no case", () => {
      const scored = makeNoMatchScored();
      const record = buildReport(scored, optionsFor(scored));

      expect(scored.matchedCount).toBe(0);
      expect(record.outcome).toBe("FAIL");
      expect(record.matchedCount).toBe(0);
      expect(record.totalCount).toBe(scored.totalCount);
      expect(record.criticalFailures).toBe(1);
      expect(record.caseResults).toHaveLength(CASE_IDS_IN_SET_ORDER.length);
      expect(record.caseResults.every((evidence) => !evidence.match)).toBe(true);
      expect(record.label).toBe("SAMPLE");
      expect(record.rubricReference).toBe(RUBRIC_REFERENCE);
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

  it("states an origin and never a verdict: neither label depends on the outcome", () => {
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

describe("this file's own fixture data", () => {
  it("states nothing in the shape the exclusion scan reads as a mail address or a telephone number", () => {
    // The guard walks this file's own values, and its two conditions are the two data classes the
    // scan watches for in content: a mail address needs an "@" and a dotted domain, and a telephone
    // candidate is a run of digits. One kind of value is exempt, and the exemption is asserted here
    // rather than assumed: the hyphen-separated identifier, which the scan's own rules treat as a
    // machine-written identifier span rather than a number, and which is the only value in this file
    // carrying a longer run of digits.
    expect(CANDIDATE_VERSION_ID).toMatch(UUID_SHAPED);

    const offenders = fixtureDataStrings().filter(
      (value) =>
        value.includes("@") || (DIGIT_RUN_5_OR_MORE.test(value) && !UUID_SHAPED.test(value)),
    );

    expect(offenders).toEqual([]);
  });
});
