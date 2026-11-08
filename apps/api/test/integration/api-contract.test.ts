/**
 * The integration proof of the API's evaluation surface, and of the contract statuses no sibling
 * suite owns, driven over the real HTTP surface of `@adem/api` through `./test-server`.
 *
 * **What it proves, in the terms the plan states them.** Criterion 3 — running the `SGI-SO-1.0.0`
 * evaluation twice on the same candidate fixture yields identical per-case results and outcomes,
 * and the seeded candidates yield exactly one `PASS`, one critical-case `FAIL` and one threshold
 * `FAIL`: `seed-alpha` passes with 20 of 20 cases matched and no failing case, `seed-beta` fails
 * with 19 of 20 and one `critical` failure (`so-003`), and `seed-gamma` fails with 17 of 20 and no
 * critical failure (`so-014`, `so-016`, `so-018`). Those three numbers are deliberately **not**
 * retyped as expectations here: they are read from the fixture package's own record,
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/expected-outcomes.json`, which is the authoritative
 * statement of them, and the entry is looked up by candidate id rather than by array position so a
 * reordered document cannot be read as a pass.
 *
 * **The four things this file owns**, in the order they are read.
 *
 * 1. *The three seeded reports and the provenance every report carries*: each is read through the
 *    public `GET /evaluations/{id}` and checked for its candidate version, its standard version, its
 *    rubric reference, one per-case result for each of the fixture set's cases, the counts, the
 *    outcome and the label. The failing case ids are **derived from the per-case evidence**
 *    (`case_results.filter((result) => !result.match)`), which is what proves the summary was
 *    computed from the rows rather than stored beside them, and the `critical_failures` count is
 *    derived the same way from the severities.
 * 2. *The fixture cross-check*: the fixture pack's candidate files, the seeded `listing_versions`
 *    rows and `expected-outcomes.json` are three statements of one thing, and this file asserts the
 *    three agree — the recorded outputs cover the case set exactly once, the candidate version
 *    identifier is the same in all three, and the expected counts and failing case ids match the
 *    reports the API serves. A drift between the pack and the seed is caught here rather than
 *    discovered inside the evaluator.
 * 3. *Reproducibility*: one candidate's recorded submission is sent twice, as the developer that
 *    owns the version, and the two reports must be equal on every field they can be equal on.
 * 4. *The statuses no other suite owns*: `400` for a query value the search contract rejects, `404`
 *    for a listing, a standard version and a standard that no row carries, `409` for a version
 *    string a listing has already published, and `200` with an empty page where a search matches
 *    nothing and where the catalogue is genuinely empty.
 *
 * **The compared payload, and the three fields that lie outside it.** A report's `id` and
 * `created_at` are generated at write time and its `prior_report_id` is derived from the reports
 * already stored for the version being evaluated, so those three are the only fields that may differ
 * between two runs of one submission — and a retest is a **new** report pointing at its predecessor,
 * never a rewrite of it. Every other field is byte-stable, and the comparison is made through
 * `canonicalize` from `@adem/sgi-core`, the product's own canonical form, so property order can
 * never decide whether two payloads are equal. The same submission is submitted twice for all three
 * candidates, and for each the first submission's `prior_report_id` must be that candidate's seeded
 * report and the second's must be the first's, which is the observable proof that the link is derived
 * server-side: the request body carries no retest field, and `additionalProperties: false` removes
 * one a client sent.
 *
 * **Why this file may import `@adem/sgi-fixtures` without the API depending on it.** The fixture pack
 * is a workspace of its own and `apps/api/package.json` deliberately does not declare it: a route
 * reaches a case set through `@adem/sgi-core`'s `getStandardCaseSet` and never through the loader. A
 * suite is not a route. The workspace install links the package into the root `node_modules`, and the
 * import resolves and typechecks from this directory — the whole-solution build proves that rather
 * than assuming it — so this test-only import needs no manifest entry. A later reader who finds it
 * surprising should not "fix" it by adding the dependency to the workspace's manifest: that would put
 * the fixture pack on a route's import path, which is the one thing the architecture forbids.
 *
 * **One deviation from this folder's own description, settled by the route that serves the row.** The
 * plan describes the unknown-standard submission as asserting the domain's `unknown_standard` code.
 * The handler for `POST /evaluations` resolves both reference forms through the registry itself and
 * raises its own `404 not_found` when neither resolves, so that is the code this suite asserts for
 * that row. The domain's own `unknown_standard` refusal is proven where the domain raises it — a
 * proposal naming a standard the catalogue does not hold, which is also a `404` the contract table
 * does not list for that row and no sibling suite walks. Both refusals are `404`, both are asserted,
 * and neither assertion is weakened to match a description.
 *
 * **How it is driven, and what it never does.** Everything goes through `./test-server`, which starts
 * the real server on an ephemeral port over one migrated in-memory database with the seed loaded, and
 * whose request helpers take prefix-relative paths — the versioned prefix appears nowhere below. No
 * identifier of a seeded row is written literally: every one comes from a harness accessor or from the
 * fixture package, and the values that would probe a non-existent row are generated with
 * `randomUUID()`, whose only requirement is that it matches nothing. No snapshot is taken, no file is
 * written, nothing is executed from a submission, and nothing here reads a clock, a locale, an
 * environment variable or the working directory.
 *
 * **The folder's rules this file keeps.** It exports nothing and adds no module of its own: the two
 * helpers of `apps/api/test/integration/` are `./test-server` and `./boundary-check`, so every helper
 * below is local to this file. The single top-level `describe` carries the word `evaluations` because
 * the criterion's own command selects suites by title —
 * `npm run test:integration -- --testNamePattern=evaluations` — and no second top-level `describe`
 * could either widen or narrow that selection. The `401`/`403` pair for every non-public row belongs
 * to `./route-walk.test.ts`, the append-only mutation attempts to `./immutability.test.ts`, the ledger
 * arithmetic to `./ledger-routes.test.ts` and the sponsorship experiment to
 * `./trust-separation.test.ts`; none of them is repeated here.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CASE_SEVERITIES,
  REPORT_LABEL_SAMPLE,
  listingVersionCreateBodySchema,
} from "@adem/shared";
import type {
  CaseSeverity,
  EvaluationReportDetail,
  EvaluationSubmission,
  ReportOutcome,
} from "@adem/shared";

import { SGI_SO_1_0_0, canonicalize } from "@adem/sgi-core";

import { loadCandidate, loadCaseSet, loadExpectedOutcomes } from "@adem/sgi-fixtures";
import type { CandidateSubmission, CaseSet, ExpectedOutcome } from "@adem/sgi-fixtures";

import { startTestServer } from "./test-server";
import type { TestResponse, TestServer } from "./test-server";

/**
 * The three fixture candidates of the seeded standard's case set, in the fixed order alpha, beta,
 * gamma. The vocabulary is closed to these three: `apps/api/src/seed/seed-data.ts` seeds one version
 * and one report for each, the fixture pack publishes one candidate file for each, and no route
 * creates a fourth.
 *
 * The union is spelled here rather than imported because the harness does not export its own type for
 * these names; the values are asserted against the fixture package below, so a fourth candidate — or a
 * renamed one — fails the cross-check rather than silently narrowing this file's coverage.
 */
type FixtureCandidate = "seed-alpha" | "seed-beta" | "seed-gamma";

/** The three candidates, in the order the plan fixes and the fixture pack lists them. */
const FIXTURE_CANDIDATES: readonly FixtureCandidate[] = Object.freeze([
  "seed-alpha",
  "seed-beta",
  "seed-gamma",
]);

/**
 * A version label no published standard version carries.
 *
 * The version read attaches no parameter schema, so any non-empty final segment is a well-formed
 * request: the read refuses because no row matches the label, which is the contract's `404`, and not
 * because of the request's shape. `9.9.9` is what a client would try for a version a later release
 * might publish, which is exactly the state the row's `404` answers for.
 */
const ABSENT_VERSION_LABEL = "9.9.9";

/**
 * A search term no seeded listing carries.
 *
 * The seeded titles, summaries and category names are all about intake, depot and notice-drafting
 * work, so this token matches nothing and the search answers the contract's empty page. It is a fixed
 * string rather than a generated one because nothing about it needs to be unpredictable.
 */
const UNMATCHED_SEARCH_TERM = "zzz-no-listing-carries-this-term";

/** A `sort` value the search contract's enum does not carry, so the query fails validation. */
const REJECTED_SORT = "alphabetical";

/**
 * A `page` below the query contract's minimum of `1`.
 *
 * The bound is the schema's own (`listingSearchQuerySchema`): a page is 1-based, so `0` is refused
 * rather than treated as the first page.
 */
const REJECTED_PAGE = 0;

/** One seeded report as this file reads it: the candidate it belongs to, its id and its payload. */
interface SeededReportView {
  /** The fixture candidate the version and the report belong to. */
  readonly candidateId: FixtureCandidate;

  /** The report's identifier, which `GET /evaluations/{id}` answers for. */
  readonly reportId: string;

  /** The payload the read answered with, captured before any submission of this run is sent. */
  readonly report: EvaluationReportDetail;
}

/**
 * The failure body as the API's single error handler serialises it.
 *
 * Only the two members the envelope is closed to are declared: a shape that named a `statusCode`, a
 * `validation` detail or a `stack` would describe a body the handler never writes, and the assertions
 * below would then be checking this file's own spelling rather than the response's.
 */
interface ErrorEnvelopeBody {
  /** The one member of the body. */
  readonly error: {
    /** The stable code the contract fixes for the refusal. */
    readonly code: string;
    /** The client-facing sentence. */
    readonly message: string;
  };
}

/** The started harness: the running server, its one in-memory database and the seeded rows. */
let server: TestServer;

/**
 * The three seeded reports, read once in `beforeAll`.
 *
 * They are captured before any case of this file runs, which is what makes two later assertions
 * meaningful: the first submission of a candidate must cite its seeded report as its predecessor, and
 * the seeded report must still read back unchanged after those submissions. Reading them here also
 * means the three outcome assertions do not depend on a submission case having run first.
 */
let seededReports: readonly SeededReportView[] = [];

/**
 * Asserts the one failure shape the API produces, and nothing else about it.
 *
 * Every refusal in this file goes through here, so the shape is proven uniformly rather than once:
 * `error` with no sibling key, exactly `code` and `message` inside it, the code the contract fixes for
 * the row, and a message that is a sentence rather than a trace — non-empty and single-line, which is
 * what lets a client render an explanation instead of an error dump.
 *
 * @param response The response the harness received, whatever its status.
 * @param status The status the contract documents for this refusal.
 * @param code The stable code the contract fixes for it.
 */
function expectErrorEnvelope(response: TestResponse, status: number, code: string): void {
  expect(response.status).toBe(status);

  const body = response.json<ErrorEnvelopeBody>();

  expect(Object.keys(body)).toEqual(["error"]);
  expect(Object.keys(body.error)).toEqual(["code", "message"]);
  expect(body.error.code).toBe(code);
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.error.message).not.toMatch(/[\r\n]/);
}

/**
 * Reads one report through the public read, asserting the `200` it answers with.
 *
 * The read is public and resolves no identity, which is why it is sent without a demo account: a
 * report and its evidence are readable by anyone, and a case that sent a header would leave that
 * unproven.
 *
 * @param harness The started harness whose server answers.
 * @param reportId The report identifier, from a harness accessor or a write's own response.
 * @returns The report with its per-case evidence.
 */
async function readReport(harness: TestServer, reportId: string): Promise<EvaluationReportDetail> {
  const response = await harness.get(`/evaluations/${reportId}`);

  expect(response.status).toBe(200);

  return response.json<EvaluationReportDetail>();
}

/** The seeded report of one candidate, from the set captured before any case ran. */
function seededReportOf(candidateId: FixtureCandidate): SeededReportView {
  const found = seededReports.find((seeded) => seeded.candidateId === candidateId);

  if (found === undefined) {
    throw new Error(
      `this suite captures one seeded report for every fixture candidate, and none was captured for "${candidateId}"`,
    );
  }

  return found;
}

/**
 * The fixture package's own expectation for one candidate, named by candidate id and never by index.
 *
 * Reading by id is the point: an expectation list that gained, lost or reordered an entry answers
 * here with the candidate named, where an index read would quietly assert one candidate's numbers
 * against another's.
 */
function expectedOutcomeOf(candidateId: FixtureCandidate): ExpectedOutcome {
  const expected = loadExpectedOutcomes();
  const found = expected.candidates.find((entry) => entry.candidate_id === candidateId);

  if (found === undefined) {
    throw new Error(
      `expected-outcomes.json carries no candidate "${candidateId}", so this suite cannot say what that candidate is expected to score`,
    );
  }

  return found;
}

/** The case set of the one published standard version, loaded from the read-only fixture pack. */
function fixtureCaseSet(): CaseSet {
  return loadCaseSet(SGI_SO_1_0_0.versionLabel);
}

/**
 * A report's per-case evidence reduced to the five fields an evaluation compares.
 *
 * The mapping is what makes the canonical comparison below honest: the stored records are rendered as
 * plain JSON values, so the compared artefact is the evidence itself and not a database row's other
 * columns.
 */
function comparedCaseResults(report: EvaluationReportDetail): {
  case_id: string;
  severity: CaseSeverity;
  expected: string;
  actual: string;
  match: boolean;
}[] {
  return report.case_results.map((caseResult) => ({
    case_id: caseResult.case_id,
    severity: caseResult.severity,
    expected: caseResult.expected,
    actual: caseResult.actual,
    match: caseResult.match,
  }));
}

/**
 * The canonical text of a stored report's **whole** payload, write-time fields included.
 *
 * It is used where byte-identity is the claim: a report that was written once and read twice must
 * render the same text, identifier and instant included, because nothing rewrites a report. For two
 * runs of one submission the compared payload is {@link canonicalComparedPayload} instead, which is
 * the same text with the three fields a write generates left out.
 */
function canonicalStoredReport(report: EvaluationReportDetail): string {
  return canonicalize({
    id: report.id,
    candidate_version_id: report.candidate_version_id,
    standard_version_id: report.standard_version_id,
    outcome: report.outcome,
    matched_count: report.matched_count,
    total_count: report.total_count,
    critical_failures: report.critical_failures,
    label: report.label,
    rubric_reference: report.rubric_reference,
    prior_report_id: report.prior_report_id,
    created_at: report.created_at,
    case_results: comparedCaseResults(report),
  });
}

/**
 * The canonical text of every field of a report that two runs of one submission must reproduce.
 *
 * Three members are deliberately absent, and they are the only three that may differ: `id` and
 * `created_at` are generated at write time, and `prior_report_id` names the predecessor a retest
 * appends beside it. Everything else — the candidate version, the standard version, the outcome, the
 * counts, the label, the rubric reference and the per-case evidence — is a function of the submitted
 * data and the versioned criteria alone, which is why a repeated run is byte-identical.
 */
function canonicalComparedPayload(report: EvaluationReportDetail): string {
  return canonicalize({
    candidate_version_id: report.candidate_version_id,
    standard_version_id: report.standard_version_id,
    outcome: report.outcome,
    matched_count: report.matched_count,
    total_count: report.total_count,
    critical_failures: report.critical_failures,
    label: report.label,
    rubric_reference: report.rubric_reference,
    case_results: comparedCaseResults(report),
  });
}

/**
 * The submission body for one candidate: the version identifier plus one recorded output per case.
 *
 * The shape is the plan's, and the recorded outputs are handed on untouched, in the order the fixture
 * document states them. There is no retest field to set: the body carries none, and the server derives
 * the link from the reports already stored for this candidate version and standard version.
 *
 * @param candidate The candidate's recording, loaded from the fixture pack.
 * @param standardVersionId The standard version to score against, which the fixture file also states
 *   and which a caller overrides only to probe a reference that resolves to nothing.
 */
function submissionFor(
  candidate: CandidateSubmission,
  standardVersionId: string,
): EvaluationSubmission {
  return {
    candidate_version_id: candidate.candidate_version_id,
    standard_version_id: standardVersionId,
    recorded_outputs: candidate.recorded_outputs,
  };
}

/**
 * How many rows one `COUNT(*)` statement answers, read straight from the harness's connection.
 *
 * It is the before-and-after measure three refusals of this file need: a report that no route could
 * have written, a version a rolled-back append did not leave behind, and a proposal that was never
 * inserted. Those counts are not exposed by any read — the contract publishes no total for reports,
 * versions or proposals — so they are read from the one connection the harness owns, which is also
 * the only connection that sees this suite's database.
 *
 * The statement must alias its count `AS total`, which every call site below does.
 *
 * @param harness The started harness whose connection is read.
 * @param sql One `SELECT COUNT(*) AS total ...` statement, with `?` placeholders.
 * @param params The values to bind, positionally.
 * @returns The count, which a `COUNT(*)` always answers, so a missing row is a defect and is thrown.
 */
function countRows(harness: TestServer, sql: string, ...params: readonly unknown[]): number {
  const rows = harness.query<{ readonly total: number }>(sql, ...params);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(
      "the count this suite asked for answered no row, which SQLite never does for a COUNT(*)",
    );
  }

  return row.total;
}

/**
 * A report's verdict: its outcome, its three counts and the case ids its evidence shows failing.
 *
 * The failing ids are derived from the per-case results rather than read from a stored list, so two
 * verdicts compare the evidence both reports carry. That is what lets a repeated submission be
 * compared with the seeded report of the same candidate: the comparison is of what was measured, not
 * of a summary that could agree while the evidence beneath it disagreed.
 */
function verdictOf(report: EvaluationReportDetail): {
  outcome: ReportOutcome;
  matched_count: number;
  total_count: number;
  critical_failures: number;
  failing_case_ids: string[];
} {
  return {
    outcome: report.outcome,
    matched_count: report.matched_count,
    total_count: report.total_count,
    critical_failures: report.critical_failures,
    failing_case_ids: report.case_results
      .filter((caseResult) => !caseResult.match)
      .map((caseResult) => caseResult.case_id)
      .sort(),
  };
}

/**
 * Starts the harness and captures the three seeded reports through the public read.
 *
 * The reads happen here, before any case of this file runs, so that two later assertions mean what
 * they say: the first submission of a candidate must cite that candidate's seeded report as its
 * predecessor, and the seeded report must still read back byte-identical after those submissions.
 * Each read asserts its own `200` through {@link readReport}, so a start-up that could not serve a
 * seeded report fails the hook rather than producing a confusing case failure.
 */
beforeAll(async () => {
  server = await startTestServer();

  seededReports = await Promise.all(
    FIXTURE_CANDIDATES.map(async (candidateId): Promise<SeededReportView> => {
      const reportId = server.seededReportId(candidateId);

      return { candidateId, reportId, report: await readReport(server, reportId) };
    }),
  );
});

/** Closes the listening instance and then the one connection behind it. */
afterAll(async () => {
  await server.close();
});

describe("evaluations contract", () => {
  describe("the three seeded reports, and the provenance every report carries", () => {
    it.each(FIXTURE_CANDIDATES)(
      "reads the seeded %s report with the verdict, the counts and the evidence criterion 3 fixes",
      async (candidateId) => {
        const seeded = seededReportOf(candidateId);
        const expected = expectedOutcomeOf(candidateId);
        const caseSet = fixtureCaseSet();
        const report = seeded.report;

        // The provenance the plan requires of every report: the version that was measured, the
        // criteria it was measured against, and the rubric the report resolves to. The standard's own
        // declaration supplies both values, so neither label is retyped here.
        expect(report.candidate_version_id).toBe(server.candidateVersion(candidateId).id);
        expect(report.standard_version_id).toBe(SGI_SO_1_0_0.versionLabel);
        expect(report.rubric_reference).toBe(SGI_SO_1_0_0.rubricReference);

        // One per-case result for each case of the loaded fixture set, in the case set's own order —
        // the order the scorer records them in, so a report's evidence is the set it was scored
        // against rather than a database order.
        expect(report.case_results.map((result) => result.case_id)).toEqual(
          caseSet.cases.map((fixtureCase) => fixtureCase.id),
        );
        expect(report.total_count).toBe(caseSet.cases.length);

        // The verdict is derived from the evidence rather than taken on trust from the summary: the
        // failing ids are the unmatched cases, the matched count is what is left of the case set, and
        // the critical failures are the unmatched cases the set marked `critical`. Criterion 3's three
        // acceptance values are then asserted against the fixture package's own record: `seed-alpha`
        // passes 20 of 20 with nothing failing, `seed-beta` fails 19 of 20 with the critical case
        // `so-003` failing, and `seed-gamma` fails 17 of 20 with `so-014`, `so-016` and `so-018`
        // failing while no critical case does.
        const failingCaseIds = report.case_results
          .filter((result) => !result.match)
          .map((result) => result.case_id)
          .sort();

        expect(report.matched_count).toBe(caseSet.cases.length - failingCaseIds.length);
        expect(report.critical_failures).toBe(
          report.case_results.filter((result) => !result.match && result.severity === "critical")
            .length,
        );
        expect(failingCaseIds).toEqual([...expected.failing_case_ids].sort());
        expect(report.outcome).toBe(expected.outcome);
        expect(report.matched_count).toBe(expected.matched_count);
        expect(report.total_count).toBe(expected.total_count);
        expect(report.critical_failures).toBe(expected.critical_failures);

        // The label comes from the shared constant rather than from the word retyped, and a version
        // seeded as a fixture candidate carries it on a `FAIL` exactly as on a `PASS`. Only a `PASS`
        // earns a badge, which is the report page's rule and not a difference in the label.
        expect(report.label).toBe(REPORT_LABEL_SAMPLE);

        // Each case result states the five fields an evaluation is read for: the case, its severity,
        // the two canonical JSON strings that were compared for it, and whether they matched. The two
        // stored strings must each be canonical text — their own canonical form — which is what makes
        // two runs of one submission compare byte for byte rather than merely equal as values.
        const severitiesByCaseId = new Map(
          caseSet.cases.map((fixtureCase) => [fixtureCase.id, fixtureCase.severity]),
        );

        for (const caseResult of report.case_results) {
          expect(CASE_SEVERITIES).toContain(caseResult.severity);
          expect(caseResult.severity).toBe(severitiesByCaseId.get(caseResult.case_id));
          expect(canonicalize(JSON.parse(caseResult.expected))).toBe(caseResult.expected);
          expect(canonicalize(JSON.parse(caseResult.actual))).toBe(caseResult.actual);
          expect(typeof caseResult.match).toBe("boolean");
        }
      },
    );

    it("labels a failing report exactly as it labels a passing one", () => {
      const outcomes = seededReports.map((seeded) => seeded.report.outcome);
      const labels = seededReports.map((seeded) => seeded.report.label);

      // Criterion 3's three seeded verdicts, in the order the candidates are fixed: one `PASS`, one
      // critical-case `FAIL` and one threshold `FAIL`. The label is one value across all three,
      // because the label states where a run came from and never that it passed.
      expect(outcomes).toEqual(["PASS", "FAIL", "FAIL"]);
      expect(new Set(labels).size).toBe(1);
      expect(labels.every((label) => label === REPORT_LABEL_SAMPLE)).toBe(true);
    });
  });

  describe("the fixture pack, the seeded rows and the recorded expectations cannot drift", () => {
    it.each(FIXTURE_CANDIDATES)(
      "binds the %s candidate file to its seeded version row and to its recorded expectation",
      (candidateId) => {
        const candidate = loadCandidate(candidateId);
        const seededVersion = server.candidateVersion(candidateId);
        const expected = expectedOutcomeOf(candidateId);
        const caseSet = fixtureCaseSet();

        // Three statements of one identifier, and they must be one: the fixture file's candidate
        // version, the seeded `listing_versions` row the harness resolves with the
        // `is_fixture_candidate` flag set — which is the only stored input the report's label rule
        // reads — and the report the API serves for that version.
        expect(candidate.candidate_version_id).toBe(seededVersion.id);
        expect(candidate.candidate_version_id).toBe(expected.candidate_version_id);
        expect(candidate.candidate_version_id).toBe(
          seededReportOf(candidateId).report.candidate_version_id,
        );

        // And the standard version the recording answers is the case set's own identity, which is
        // also the contract-facing label the seeded standard version publishes.
        expect(candidate.standard_version_id).toBe(caseSet.standard_version_id);
        expect(candidate.standard_version_id).toBe(SGI_SO_1_0_0.versionLabel);

        // The recording answers every case of the set exactly once: the same ids in the same count.
        // That is also what the route's completeness check reads before it scores anything, so a
        // candidate file and the case set disagreeing here is the drift a submission would meet as a
        // `422` instead of a report.
        expect(candidate.recorded_outputs.map((output) => output.case_id).sort()).toEqual(
          caseSet.cases.map((fixtureCase) => fixtureCase.id).sort(),
        );
      },
    );

    it("records one expectation per candidate, in the fixed order, for the loaded case set", () => {
      const expected = loadExpectedOutcomes();

      expect(expected.standard_version_id).toBe(fixtureCaseSet().standard_version_id);
      expect(expected.candidates.map((entry) => entry.candidate_id)).toEqual([
        ...FIXTURE_CANDIDATES,
      ]);
    });
  });

  describe("reproducibility: one submission, submitted twice", () => {
    it.each(FIXTURE_CANDIDATES)(
      "reproduces the %s report byte for byte and links the retest to its predecessor",
      async (candidateId) => {
        const candidate = loadCandidate(candidateId);
        const seeded = seededReportOf(candidateId);

        // The developer that owns the version is the only account that may have it measured: the
        // owning account comes from the listing's own row rather than from an assumption about which
        // developer the seed gave which listing.
        const owner = server.owningDeveloper(server.candidateVersion(candidateId).listingId);
        const body = submissionFor(candidate, candidate.standard_version_id);

        const firstResponse = await server.post("/evaluations", body, { account: owner });
        expect(firstResponse.status).toBe(201);
        const first = firstResponse.json<EvaluationReportDetail>();

        const secondResponse = await server.post("/evaluations", body, { account: owner });
        expect(secondResponse.status).toBe(201);
        const second = secondResponse.json<EvaluationReportDetail>();

        // The per-case evidence is deeply equal on all five of its fields, and the outcome is equal:
        // the same recorded data scored against the same versioned criteria.
        expect(second.case_results).toEqual(first.case_results);
        expect(second.outcome).toBe(first.outcome);

        // And the whole payload is equal once the three write-time members are left out — which is
        // the claim criterion 3 makes, and the reason those three are named: `id` and `created_at`
        // are generated at write time and `prior_report_id` names the predecessor, which the next
        // assertion pairs with the stored history. The comparison runs through `canonicalize`, the
        // product's own canonical form, so property order cannot decide the result.
        expect(canonicalComparedPayload(second)).toBe(canonicalComparedPayload(first));

        // A retest appends a report rather than rewriting one, and the link is the server's: the first
        // submission cites the candidate's seeded report, and the second cites the first. Nothing in
        // the body asked for either link, and the body has no field through which one could be asked
        // for.
        expect(first.prior_report_id).toBe(seeded.reportId);
        expect(second.prior_report_id).toBe(first.id);
        expect(first.id).not.toBe(second.id);

        // The verdict a repeated submission reaches is the seeded report's verdict, field for field:
        // the fixture file's recording and the seed's own scoring of that candidate agree, which is
        // what binds the submitted path to the three acceptance values rather than leaving the two
        // stated separately.
        expect(verdictOf(first)).toEqual(verdictOf(seeded.report));
        expect(verdictOf(second)).toEqual(verdictOf(seeded.report));

        // The candidate is a fixture candidate, so both new reports carry the sample label.
        expect(first.label).toBe(REPORT_LABEL_SAMPLE);
        expect(second.label).toBe(REPORT_LABEL_SAMPLE);

        // The predecessor is untouched: the seeded report still reads back byte-identical, its
        // identifier, instant and prior link included, which is what an append-only report means.
        expect(canonicalStoredReport(await readReport(server, seeded.reportId))).toBe(
          canonicalStoredReport(seeded.report),
        );
      },
    );
  });

  describe("the statuses no other suite owns", () => {
    it("answers 400 for a query value the search contract does not accept", async () => {
      // Two probes of the one row, refused by the query schema at the edge: a `sort` outside the
      // contract's enum, and a `page` below the contract's minimum of 1.
      expectErrorEnvelope(
        await server.get("/listings", { query: { sort: REJECTED_SORT } }),
        400,
        "validation_error",
      );
      expectErrorEnvelope(
        await server.get("/listings", { query: { page: REJECTED_PAGE } }),
        400,
        "validation_error",
      );
    });

    it("answers 404 for a listing and a standard version that no row carries", async () => {
      // A public read of a listing that does not exist. The identifier is generated, so its only
      // property is that it matches nothing: the refusal is the row's absence and not a shape the
      // parameters reject.
      expectErrorEnvelope(await server.get(`/listings/${randomUUID()}`), 404, "not_found");

      // A version addressed the way a client addresses one — by the standard's own code and the
      // version's label — where no version carries that label.
      expectErrorEnvelope(
        await server.get(`/standards/${SGI_SO_1_0_0.code}/versions/${ABSENT_VERSION_LABEL}`),
        404,
        "not_found",
      );
    });

    it("answers 404 for a submission naming a standard version no row carries, and writes no report", async () => {
      const candidateId: FixtureCandidate = "seed-alpha";
      const candidate = loadCandidate(candidateId);
      const owner = server.owningDeveloper(server.candidateVersion(candidateId).listingId);
      const reportsBefore = countRows(
        server,
        "SELECT COUNT(*) AS total FROM evaluation_reports WHERE candidate_version_id = ?",
        candidate.candidate_version_id,
      );

      // The plan's own submission shape with the standard reference replaced by one that matches no
      // row. The route resolves both reference forms through the registry and answers its own
      // `not_found` when neither resolves; the domain's `unknown_standard` is raised further in, and
      // is proven on the proposals row below.
      const response = await server.post("/evaluations", submissionFor(candidate, randomUUID()), {
        account: owner,
      });

      expectErrorEnvelope(response, 404, "not_found");

      // The refusal happens before the transaction that appends the report, its per-case evidence and
      // the gate fee, so a refused submission leaves the append-only tables exactly as they were.
      expect(
        countRows(
          server,
          "SELECT COUNT(*) AS total FROM evaluation_reports WHERE candidate_version_id = ?",
          candidate.candidate_version_id,
        ),
      ).toBe(reportsBefore);
    });

    it("answers 404 unknown_standard when a proposal names a standard the catalogue does not hold", async () => {
      const proposalsBefore = countRows(server, "SELECT COUNT(*) AS total FROM standard_proposals");

      const response = await server.post(
        "/standards/proposals",
        {
          standard_id: randomUUID(),
          title: "Tighten the critical-case rule",
          rationale: "The rule should name the criteria a critical case is measured against.",
        },
        { account: server.accountForRole("contributor") },
      );

      // The domain refuses the reference itself and the route maps the refusal by its own stable
      // code, so the client reads `unknown_standard` rather than a generic not-found: the `404` names
      // what could not be resolved. This is the row the plan's unknown-standard case is stated
      // against, and the contract table lists no `404` for it, so no sibling suite walks it.
      expectErrorEnvelope(response, 404, "unknown_standard");
      expect(countRows(server, "SELECT COUNT(*) AS total FROM standard_proposals")).toBe(
        proposalsBefore,
      );
    });

    it("answers 409 for a version string the listing has already published, and writes nothing", async () => {
      const candidateId: FixtureCandidate = "seed-alpha";
      const published = server.candidateVersion(candidateId);
      const owner = server.owningDeveloper(published.listingId);
      const versionsBefore = countRows(
        server,
        "SELECT COUNT(*) AS total FROM listing_versions WHERE listing_id = ?",
        published.listingId,
      );

      // The string is the listing's own published version, read from the harness rather than retyped,
      // and it is checked against the schema's own pattern rather than against a copy of the pattern:
      // the request must be refused for the duplicate and not for its shape.
      expect(
        new RegExp(listingVersionCreateBodySchema.body.properties.version_string.pattern).test(
          published.versionString,
        ),
      ).toBe(true);

      const response = await server.post(
        `/listings/${published.listingId}/versions`,
        { version_string: published.versionString },
        { account: owner },
      );

      expectErrorEnvelope(response, 409, "conflict");

      // The unique `(listing_id, version_string)` pair is the conflict, and the failed append was
      // rolled back whole: the version that already exists is untouched and no second row was written.
      expect(
        countRows(
          server,
          "SELECT COUNT(*) AS total FROM listing_versions WHERE listing_id = ?",
          published.listingId,
        ),
      ).toBe(versionsBefore);
    });

    it("answers 200 with an empty page when a search matches no listing", async () => {
      const response = await server.get("/listings", { query: { q: UNMATCHED_SEARCH_TERM } });

      // A match set of nothing is an ordinary answer and never an error: the listings page renders it
      // with the filters that produced it, which is why the body states the whole page shape.
      expect(response.status).toBe(200);

      const body = response.json<{
        readonly items: readonly unknown[];
        readonly total: number;
        readonly page: number;
      }>();

      expect(Object.keys(body).sort()).toEqual(["items", "page", "total"]);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.page).toBe(1);
    });
  });

  /**
   * The second empty state, and a different one: a database whose catalogue is genuinely empty, which
   * is the state the harness's `seed: false` exists for. The search above matched nothing because its
   * term matched nothing; this server has no listing at all, and the contract answers the same shape
   * for both. It runs its own server so that emptying the catalogue cannot be observed by any other
   * case of this file, and the block closes it in its own teardown.
   */
  describe("an empty catalogue", () => {
    let emptyCatalogue: TestServer;

    beforeAll(async () => {
      emptyCatalogue = await startTestServer({ seed: false });
    });

    afterAll(async () => {
      await emptyCatalogue.close();
    });

    it("answers 200 with an empty page on its default page rather than an error", async () => {
      const response = await emptyCatalogue.get("/listings");

      expect(response.status).toBe(200);

      const body = response.json<{
        readonly items: readonly unknown[];
        readonly total: number;
        readonly page: number;
      }>();

      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.page).toBe(1);
    });
  });
});

