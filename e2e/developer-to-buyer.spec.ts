/**
 * The developer-to-buyer loop, driven through the real HTTP API and the real UI routes: on seeded
 * data a developer publishes a listing and a version of it, runs an SGI evaluation and receives a
 * reproducible report, a buyer finds that listing through search, compares it with one other listing
 * and posts an inquiry, and the buyer completes a simulated checkout. Nothing is set up by hand, and
 * the sequence runs against the application `playwright.config.ts` starts itself.
 *
 * **One test, five named steps.** Each `test.step` below carries the name of the step it proves, so a
 * failure is attributable to one stage of the loop and the HTML report and trace read as the loop
 * rather than as one undifferentiated assertion. The steps share the identifiers they create — a
 * listing, a version, a report — through variables in the test body, so no step has to re-find what an
 * earlier one was answered with, and no state crosses tests.
 *
 * **Everything is discovered, nothing is hardcoded.** The demo account's identifier is read from the
 * switcher's own value, the listing and version identifiers come from the `201` bodies of the writes,
 * the fixture case set is discovered from the seeded report the application already serves, and the
 * comparison partner is the first listing the catalogue returns besides the one this loop creates. A
 * seeded identifier written down here would silently stop describing the loop the moment the seed
 * changed; discovery keeps this file a description of the product rather than of one database.
 *
 * **The evaluation is submitted over HTTP and then driven through the form.** The contract fixes the
 * submission body — the candidate version, the standard version and one recorded output per fixture
 * case — and the developer page renders exactly that body, so the loop proves both halves: the
 * contract in isolation, and the same submission sent from the form a developer would use. The second
 * run is a retest, and the server records it pointing at the first, which is the append-only rule the
 * report page reads back.
 *
 * **Two navigations are direct and the rest are clicks.** The homepage is the loop's entry point, and
 * `/reports/{id}` is opened directly because the plan exposes no list-of-reports route to click from;
 * every other page is reached by the navigation link or the card a reader would use, so the walk is
 * also the proof that the loop is reachable without typing an address.
 *
 * **Copy is asserted, never paraphrased.** The demonstration label, the report labels, the badge's
 * scope, the synthetic currency label and the simulated-checkout disclosure are read from the
 * application's own closed vocabulary, and no assertion here claims a certification, a guaranteed
 * pass or a real transaction: buying an evaluation never guarantees a pass.
 *
 * Nothing in this file starts a server, sets an environment value, seeds a row, writes a snapshot or
 * reads a clock: the configuration owns the runtime, the seed is applied by `npm run seed` inside the
 * `webServer` command, and every expectation is derived from a response the application just sent.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** The versioned prefix every route of the API hangs from. */
const API_PREFIX = "/api/v1";

/******* The one listing this loop creates: fixed, fictional and independent of the seed's rows */

/** The title the developer publishes. Fictional, and no seeded listing carries it. */
const LISTING_TITLE = "Loop Demo Handling Agent";

/** The one-paragraph summary the create form is filled with. */
const LISTING_SUMMARY =
  "A synthetic handling agent that this end-to-end check publishes, evaluates and offers, so the whole developer-to-buyer path runs on seed data alone.";

/** The license code the listing is offered under. */
const LICENSE_CODE = "MIT";

/** The pricing model the listing declares, and therefore the offer model the checkout selects. */
const PRICING_MODEL = "purchase";

/** The category the listing is placed in: one of the four the seeded catalogue publishes. */
const CATEGORY_LABEL = "Order intake";

/** The version string the developer publishes, the only version this listing carries. */
const VERSION_STRING = "1.0.0";

/** The release notes recorded against that version. */
const VERSION_NOTES = "The first version this end-to-end check publishes for the loop to evaluate.";

/** The buyer's inquiry: about the evidence a listing states, and nothing about a person. */
const INQUIRY_MESSAGE = "Please describe the fixture coverage this version records.";

/** A search no listing can match, for the empty-result state. */
const NO_MATCH_QUERY = "zzz-no-such-listing";

/******* The closed vocabulary this spec asserts as written */

/** The visible demonstration label, present wherever the demo-account switcher appears. */
const DEMO_AUTHENTICATION_LABEL = "demo only, no production authentication";

/** The report label a version published through the API produces. */
const REPORT_LABEL_VERIFIED_IN_DEMO = "VERIFIED-IN-DEMO";

/** The scope string every badge carries: the whole of what a badge measures. */
const BADGE_SCOPE = "structured output on fixture set only";

/** The synthetic currency label every simulated amount carries. */
const SYNTHETIC_CURRENCY_LABEL = "DEMO";

/** The standard's rubric reference, which a report states and the report page renders as text. */
const RUBRIC_REFERENCE = "SGI-SO-1.0.0#rubric";

/******* The accessible names this spec locates controls by */

/** The switcher's own label, naming what the selection decides. */
const DEMO_ACCOUNT_FIELD = "Demo account";

/** The option that selects the first synthetic developer account. */
const DEVELOPER_ACCOUNT_OPTION = "Demo developer account";

/** The option that selects the first synthetic buyer account. */
const BUYER_ACCOUNT_OPTION = "Demo buyer account";

/** The one header a non-public route requires; it names a synthetic account and is not a credential. */
const DEMO_ACCOUNT_HEADER = "X-Demo-Account";

/** Passing this where a label is matched forbids the substring matches that would hit a sibling field. */
const EXACT = { exact: true } as const;

/******* The five step names, which are this criterion's evidence in the report and the trace */

const STEP_CREATE = "1 — developer creates a listing and a version";
const STEP_EVALUATE = "2 — developer runs an evaluation and receives a report";
const STEP_SEARCH = "3 — buyer finds the listing through search";
const STEP_COMPARE = "4 — buyer compares it with another listing and posts an inquiry";
const STEP_CHECKOUT = "5 — buyer completes a simulated checkout";

/******* The response shapes this spec reads, declared here because it imports no workspace package */

/** The category a listing payload states. */
interface CategoryPayload {
  readonly id: string;
  readonly name: string;
}

/**
 * One search result, as `GET /listings` returns it. Only the members this spec reads are declared, so
 * the type states what the loop depends on rather than restating the whole payload.
 */
interface ListingSummaryPayload {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: CategoryPayload;
  readonly pricing_model: string;
  readonly license_code: string;
  readonly version_string: string;
  readonly outcome: string | null;
  readonly standard_version_id: string | null;
  readonly label: string | null;
}

/** One page of search, with the fixed page size the contract states. */
interface ListingSearchPayload {
  readonly items: readonly ListingSummaryPayload[];
  readonly total: number;
  readonly page: number;
}

/** One published version, whose identifier an evaluation names as its candidate. */
interface ListingVersionPayload {
  readonly id: string;
  readonly listing_id: string;
  readonly version_string: string;
  readonly is_fixture_candidate: boolean;
}

/** The listing a `POST /listings` answers with, and the detail read's own fields this spec uses. */
interface ListingPayload {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

/** One listing's detail: the listing, its version history and the report linked to its newest version. */
interface ListingDetailPayload extends ListingPayload {
  readonly versions: readonly ListingVersionPayload[];
  readonly report_id: string | null;
  readonly offer_models: readonly string[];
}

/** One recorded output of a submission: a case of the fixture set and the output recorded for it. */
interface RecordedOutputPayload {
  readonly case_id: string;
  readonly output: unknown;
}

/**
 * One row of the per-case evidence. `expected` and `actual` are canonical JSON *text* — property order
 * fixed and insignificant whitespace removed — which is the artefact the comparison reads.
 */
interface ReportCasePayload {
  readonly case_id: string;
  readonly severity: string;
  readonly expected: string;
  readonly actual: string;
  readonly match: boolean;
}

/** One report: its provenance, its totals, its outcome, its label and its per-case evidence. */
interface EvaluationReportPayload {
  readonly id: string;
  readonly candidate_version_id: string;
  readonly standard_version_id: string;
  readonly outcome: string;
  readonly matched_count: number;
  readonly total_count: number;
  readonly critical_failures: number;
  readonly label: string;
  readonly rubric_reference: string;
  readonly prior_report_id: string | null;
  readonly created_at: string;
  readonly case_results: readonly ReportCasePayload[];
}

/** The `POST /inquiries` answer, which carries the recorded inquiry rather than the listing. */
interface InquiryEnvelopePayload {
  readonly inquiry: {
    readonly id: string;
    readonly listing_id: string;
    readonly buyer_account_id: string;
    readonly message: string;
  };
}

/** The simulated transaction a `POST /checkout-simulations` records, as the contract returns it. */
interface TransactionPayload {
  readonly id: string;
  readonly buyer_account_id: string;
  readonly listing_id: string;
  readonly listing_version_id: string;
  readonly offer_model: string;
  readonly amount_minor_units: number;
  readonly currency_label: string;
  readonly simulated: boolean;
  readonly disclosure_label: string;
}

/**
 * What `Promise.all` needs of a response in order to tell one endpoint from another, spelled
 * structurally so this spec imports no type beyond the two it already imports.
 */
interface ResponseLike {
  readonly url: () => string;
  readonly request: () => { readonly method: () => string };
}

/**
 * Whether a captured response is the call this spec is waiting for.
 *
 * The path is compared exactly and the method with it, so a sibling route — a `GET` on the resource a
 * `POST` writes, or a nested path a looser pattern would also accept — can never satisfy the wait and
 * the assertion that follows is always about the call that was just made.
 */
function isCallTo(response: ResponseLike, path: string, method: string): boolean {
  return new URL(response.url()).pathname === path && response.request().method() === method;
}

/**
 * The absolute address of one API path, derived from the page the browser is on.
 *
 * `page.request` shares the browser context's cookie store but does not resolve a relative address
 * against the configured `baseURL`, so the origin is taken from the live page — which is also why this
 * file holds no absolute address of its own to drift from the port the configuration assigns.
 */
function apiPath(page: Page, path: string): string {
  return `${new URL(API_PREFIX, page.url()).toString()}${path}`;
}

/**
 * A non-empty string the service was expected to return, or a failure naming what was missing.
 *
 * An identifier a later step depends on is asserted here rather than used optimistically: a `201`
 * whose body carried no identifier would otherwise surface as an unrelated locator failure several
 * steps later.
 */
function requireText(value: unknown, description: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`The service did not return ${description}.`);
  }
  return value;
}

/**
 * The demo demonstration label as the shell renders it: the disclosure paragraph in the header.
 *
 * The switcher names the same sentence beside its own control, so the paragraph is located by role
 * rather than by text alone — an assertion that the persistent banner carries the label, and one that
 * stays unambiguous while the second copy sits in the header.
 */
function disclosureBanner(page: Page): Locator {
  return page.getByRole("banner").getByRole("paragraph").getByText(DEMO_AUTHENTICATION_LABEL, EXACT);
}

/** One listing's block on the developer workspace, or one result card on the listings page. */
function listingBlock(page: Page, title: string): Locator {
  return page.getByRole("article").filter({ hasText: title });
}

/**
 * The submission's recorded outputs, built from a report's own per-case evidence.
 *
 * **The observed encoding.** A report states `expected` and `actual` as canonical JSON *text*, while a
 * submission carries `output` as a JSON *value*: the canonical text is therefore parsed back into the
 * value it renders, and canonicalising that value again reproduces the same text byte for byte, which
 * is what makes every case match. The single normalisation in this file is that parse, and it is here
 * rather than beside the request so that a submission whose encoding is wrong fails where it is built.
 *
 * The helper refuses to produce a short submission: a case with no expected output would submit an
 * incomplete body, and the contract answers that with `422` rather than with the comparison this step
 * exists to prove.
 */
function toSubmissionOutputs(report: EvaluationReportPayload): readonly RecordedOutputPayload[] {
  const outputs: RecordedOutputPayload[] = report.case_results.map(
    (result: ReportCasePayload): RecordedOutputPayload => ({
      case_id: result.case_id,
      output: JSON.parse(result.expected) as unknown,
    }),
  );

  if (outputs.length !== report.case_results.length || outputs.length === 0) {
    throw new Error(
      `The report ${report.id} recorded ${String(report.case_results.length)} cases, so no complete submission can be built from it.`,
    );
  }

  for (const entry of outputs) {
    if (entry.output === undefined) {
      throw new Error(
        `The fixture case ${entry.case_id} carries no expected output, so no submission can be built from it.`,
      );
    }
  }

  return outputs;
}

/**
 * The loop itself. One test, five steps, and no state shared with any other test.
 */
test("the developer-to-buyer loop runs end to end on seed data", async ({ page }) => {
  // The identifiers the loop creates or reads, held across the five steps so no step re-finds what an
  // earlier one was answered with.
  let developerAccountId = "";
  let buyerAccountId = "";
  let listingId = "";
  let versionId = "";
  let reportId = "";
  let standardVersionId = "";
  let report: EvaluationReportPayload | null = null;

  await test.step(STEP_CREATE, async () => {
    // The homepage is the loop's entry point: it is where the demonstration disclosure and the account
    // switcher live, and the walk starts by reading both before it acts.
    await page.goto("/");
    await expect(disclosureBanner(page)).toBeVisible();

    // The developer's identity comes from the switcher, and its identifier is read from the control's
    // own value rather than written down here: this is the value the write header will carry.
    const switcher = page.getByLabel(DEMO_ACCOUNT_FIELD);
    await switcher.selectOption({ label: DEVELOPER_ACCOUNT_OPTION });
    developerAccountId = requireText(
      await switcher.inputValue(),
      "the identifier of the developer account the switcher selected",
    );
    await expect(disclosureBanner(page)).toBeVisible();

    await page.getByRole("link", { name: "Developer", exact: true }).click();
    // The path is asserted rather than the whole address, because the search a page carries is not
    // part of what this step proves; the assertion retries, so the navigation it follows is awaited.
    await expect(page).toHaveURL(/\/developer$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // The form a developer publishes from. Its absence is this step's failure rather than a reason to
    // write the listing through the API: the loop exists to prove the UI path works.
    const publishListing = page.getByRole("button", { name: "Publish this listing" });
    await expect(
      publishListing,
      "the developer workspace must render a create-listing affordance, which this loop drives.",
    ).toBeVisible();

    await page.getByLabel("Title", EXACT).fill(LISTING_TITLE);
    await page.getByLabel("Summary", EXACT).fill(LISTING_SUMMARY);
    await page.getByLabel("Category", EXACT).selectOption({ label: CATEGORY_LABEL });
    await page.getByLabel("License code", EXACT).fill(LICENSE_CODE);
    await page.getByLabel("Pricing model", EXACT).selectOption(PRICING_MODEL);

    const [created] = await Promise.all([
      page.waitForResponse((response) => isCallTo(response, `${API_PREFIX}/listings`, "POST")),
      publishListing.click(),
    ]);
    expect(created.status(), "publishing a listing answers 201 for a developer account").toBe(201);
    const listing = (await created.json()) as ListingPayload;
    listingId = requireText(listing.id, "the identifier of the listing it created");
    expect(listing.title).toBe(LISTING_TITLE);

    // The page confirms the write in its own words, naming the record it produced.
    await expect(page.getByText(/Listing published:/)).toContainText(listingId);

    // …and the listing is now among this developer's own listings.
    const block = listingBlock(page, LISTING_TITLE);
    await expect(block, "the published listing must appear in the developer's own list").toHaveCount(1);
    await expect(block.getByRole("link", { name: LISTING_TITLE, ...EXACT })).toBeVisible();

    // A listing is measured by its versions, so the loop publishes the version it will evaluate.
    await block.getByLabel("Version string", EXACT).fill(VERSION_STRING);
    await block.getByLabel("Release notes", EXACT).fill(VERSION_NOTES);

    const [published] = await Promise.all([
      page.waitForResponse((response) =>
        isCallTo(response, `${API_PREFIX}/listings/${listingId}/versions`, "POST"),
      ),
      block.getByRole("button", { name: `Publish this version for ${LISTING_TITLE}` }).click(),
    ]);
    expect(published.status(), "publishing a version answers 201 for the owning developer").toBe(201);
    const version = (await published.json()) as ListingVersionPayload;
    versionId = requireText(version.id, "the identifier of the version it created");
    expect(version.version_string).toBe(VERSION_STRING);
    expect(
      version.is_fixture_candidate,
      "a version a developer publishes through the API is not one of the seeded fixture candidates.",
    ).toBe(false);

    await expect(page.getByText(/Published 1\.0\.0 as a new version of this listing/)).toContainText(
      versionId,
    );

    // The same artefact read back through the public contract: the search a buyer uses finds it.
    const search = await page.request.get(
      apiPath(page, `/listings?q=${encodeURIComponent(LISTING_TITLE)}`),
    );
    expect(search.status(), "the public listing search answers 200").toBe(200);
    const results = (await search.json()) as ListingSearchPayload;
    expect(results.items.map((item: ListingSummaryPayload): string => item.id)).toContain(listingId);
  });

  await test.step(STEP_EVALUATE, async () => {
    // The fixture case set is not exposed by any route, so it is discovered from the report the seed
    // already recorded for one of its candidate versions: the catalogue's own order, then each
    // listing's own detail, then the report that listing links. A listing this loop created is skipped
    // because it has no report yet.
    const catalogue = await page.request.get(apiPath(page, "/listings?page=1"));
    expect(catalogue.status(), "the public listing search answers 200").toBe(200);
    const cataloguePage = (await catalogue.json()) as ListingSearchPayload;

    let seededReport: EvaluationReportPayload | null = null;
    for (const item of cataloguePage.items) {
      if (item.id === listingId) {
        continue;
      }
      const detailResponse = await page.request.get(apiPath(page, `/listings/${item.id}`));
      if (detailResponse.status() !== 200) {
        continue;
      }
      const detail = (await detailResponse.json()) as ListingDetailPayload;
      if (detail.report_id === null) {
        continue;
      }
      const reportResponse = await page.request.get(
        apiPath(page, `/evaluations/${detail.report_id}`),
      );
      expect(reportResponse.status(), "a stored report is readable by anyone, with no account").toBe(
        200,
      );
      seededReport = (await reportResponse.json()) as EvaluationReportPayload;
      break;
    }

    if (seededReport === null) {
      throw new Error(
        "The seeded data records no fixture-candidate report, so the fixture case set this evaluation must submit against cannot be discovered. The seed is expected to score its three candidate versions.",
      );
    }
    const fixtures = seededReport;

    // The fixture set's own shape, which every assertion about a submission depends on.
    expect(fixtures.case_results.length, "the SGI-SO-1.0.0 fixture set holds 20 cases").toBe(20);
    expect(
      fixtures.case_results.filter((result: ReportCasePayload): boolean => result.severity === "critical")
        .length,
      "5 of those 20 cases are critical",
    ).toBe(5);
    for (const result of fixtures.case_results) {
      expect(typeof result.case_id, "every case carries an identifier").toBe("string");
      expect(typeof result.expected, "every case carries its expected output as canonical JSON text").toBe(
        "string",
      );
      expect(typeof result.actual, "every case carries the recorded output as canonical JSON text").toBe(
        "string",
      );
      expect(typeof result.match, "every case states whether the two matched").toBe("boolean");
    }
    standardVersionId = requireText(
      fixtures.standard_version_id,
      "the standard version the seeded report was scored against",
    );

    const outputs = toSubmissionOutputs(fixtures);

    // The submission, sent as the owning developer. The body carries the candidate version, the
    // standard version and one recorded output per case and nothing else: the retest link and the label
    // are the server's to derive.
    const submission = await page.request.post(apiPath(page, "/evaluations"), {
      headers: { [DEMO_ACCOUNT_HEADER]: developerAccountId },
      data: {
        candidate_version_id: versionId,
        standard_version_id: standardVersionId,
        recorded_outputs: outputs,
      },
    });
    expect(
      submission.status(),
      "a complete submission for a version the developer owns answers 201",
    ).toBe(201);
    report = (await submission.json()) as EvaluationReportPayload;
    reportId = requireText(report.id, "the identifier of the report it created");

    expect(report.candidate_version_id, "the report names the candidate version it measured").toBe(
      versionId,
    );
    expect(report.standard_version_id, "the report names the standard version it was scored against").toBe(
      standardVersionId,
    );
    expect(report.outcome, "every expected output was recorded, so the run passes").toBe("PASS");
    expect(report.matched_count).toBe(20);
    expect(report.total_count).toBe(20);
    expect(report.critical_failures).toBe(0);
    expect(
      report.label,
      "a version published through the API is labelled VERIFIED-IN-DEMO, not SAMPLE",
    ).toBe(REPORT_LABEL_VERIFIED_IN_DEMO);
    expect(report.prior_report_id, "this version had no report before, so nothing is linked").toBeNull();
    expect(report.rubric_reference).toBe(RUBRIC_REFERENCE);
    for (const result of report.case_results) {
      expect(result.match, `the case ${result.case_id} must match`).toBe(true);
    }

    // The read a buyer uses: the same report, at its own address, with no account of any kind.
    const readBack = await page.request.get(apiPath(page, `/evaluations/${reportId}`));
    expect(readBack.status(), "a report is a public read").toBe(200);
    expect(await readBack.json(), "the write and the read answer the same report").toEqual(report);

    // …and the same submission sent from the form a developer would use. The form's controls are the
    // ones the page renders, its candidate option values are version identifiers, and the run it starts
    // is a retest: the server appends a new report and links it to the one just stored.
    const candidateField = page.getByLabel("Candidate version", EXACT);
    const standardField = page.getByLabel("Standard version", EXACT);
    const outputsField = page.getByLabel("Recorded outputs, as JSON", EXACT);
    await expect(
      candidateField,
      "the developer workspace must render the evaluation form, whose submission this loop drives.",
    ).toBeVisible();

    await candidateField.selectOption(versionId);
    const standardOption = await standardField.inputValue();
    expect(standardOption, "the published standard version must be offered").not.toBe("");
    await standardField.selectOption(standardOption);
    await outputsField.fill(JSON.stringify(outputs));

    const [fromTheForm] = await Promise.all([
      page.waitForResponse((response) => isCallTo(response, `${API_PREFIX}/evaluations`, "POST")),
      page.getByRole("button", { name: "Run this evaluation" }).click(),
    ]);
    expect(fromTheForm.status(), "the evaluation form's submission answers 201").toBe(201);
    const formReport = (await fromTheForm.json()) as EvaluationReportPayload;
    expect(formReport.outcome).toBe("PASS");
    expect(formReport.matched_count).toBe(20);
    expect(formReport.candidate_version_id).toBe(versionId);
    expect(formReport.label).toBe(REPORT_LABEL_VERIFIED_IN_DEMO);
    expect(
      formReport.prior_report_id,
      "a second run of the same version is a retest, and the server links it to the report already stored",
    ).toBe(reportId);

    // The report as a reader sees it: a direct address, because the plan exposes no list of reports to
    // click from, and every value asserted from the response rather than from the page's own copy.
    await page.goto(`/reports/${reportId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("SGI report");

    const badge = page.getByRole("group", { name: "SGI report badge" });
    await expect(badge, "a passing report carries its badge").toBeVisible();
    await expect(badge).toContainText(REPORT_LABEL_VERIFIED_IN_DEMO);
    await expect(badge).toContainText(`Standard version ${standardVersionId}`);
    await expect(badge).toContainText(BADGE_SCOPE);
    await expect(badge).toContainText(reportId);

    const summary = page.getByText(/This run matched/);
    await expect(summary).toContainText(`${report.matched_count} of ${report.total_count}`);
    await expect(summary).toContainText(report.outcome);
    await expect(page.getByRole("rowheader")).toHaveCount(report.case_results.length);
    await expect(page.getByRole("button", { name: "Open appeal" })).toBeVisible();
    await expect(page.getByText("Buying an evaluation never guarantees a pass")).toBeVisible();
  });

  await test.step(STEP_SEARCH, async () => {
    // The buyer's identity, read from the switcher in the same way the developer's was.
    const switcher = page.getByLabel(DEMO_ACCOUNT_FIELD);
    await switcher.selectOption({ label: BUYER_ACCOUNT_OPTION });
    buyerAccountId = requireText(
      await switcher.inputValue(),
      "the identifier of the buyer account the switcher selected",
    );
    await expect(disclosureBanner(page)).toBeVisible();

    await page.getByRole("link", { name: "Listings", exact: true }).click();
    await expect(page).toHaveURL(/\/listings$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const searchField = page.getByLabel("Search listings");
    await expect(
      searchField,
      "the listings page must render the search box this step searches with.",
    ).toBeVisible();

    await searchField.fill(LISTING_TITLE);
    const [searched] = await Promise.all([
      page.waitForResponse((response) => isCallTo(response, `${API_PREFIX}/listings`, "GET")),
      searchField.press("Enter"),
    ]);
    expect(searched.status(), "a search answers 200").toBe(200);

    // The listing the developer published, found by a buyer who knows nothing but its title, carrying
    // the terms it is offered under and the label of the report that measured it.
    const found = listingBlock(page, LISTING_TITLE);
    await expect(found, "the buyer's search must return the developer's listing").toHaveCount(1);
    await expect(found.getByRole("link", { name: LISTING_TITLE, ...EXACT })).toBeVisible();
    await expect(found).toContainText(`Label: ${REPORT_LABEL_VERIFIED_IN_DEMO}`);
    await expect(found).toContainText(`Pricing model: ${PRICING_MODEL}`);
    await expect(found).toContainText(`License: ${LICENSE_CODE}`);

    // A search that matches nothing is an ordinary successful state, and the page explains it with the
    // filter that produced it rather than showing an error or a blank list.
    await searchField.fill(NO_MATCH_QUERY);
    await searchField.press("Enter");
    await expect(
      page.getByRole("heading", { name: "No listings match these filters" }),
      "an empty result is explained, not rendered as an error",
    ).toBeVisible();
    await expect(page.getByText(/Nothing matches search text/)).toContainText(NO_MATCH_QUERY);

    // Clearing the search restores the result the buyer found.
    await searchField.fill("");
    const [restored] = await Promise.all([
      page.waitForResponse((response) => isCallTo(response, `${API_PREFIX}/listings`, "GET")),
      searchField.press("Enter"),
    ]);
    expect(restored.status()).toBe(200);
    await expect(found).toHaveCount(1);
  });

  await test.step(STEP_COMPARE, async () => {
    // The listing this loop compares against: the first the catalogue returns besides the one it
    // created, chosen from the response rather than by position on the page.
    const catalogue = await page.request.get(apiPath(page, "/listings?page=1"));
    expect(catalogue.status()).toBe(200);
    const cataloguePage = (await catalogue.json()) as ListingSearchPayload;
    const partner = cataloguePage.items.find(
      (item: ListingSummaryPayload): boolean => item.id !== listingId,
    );
    if (partner === undefined) {
      throw new Error(
        "The seed must publish at least one listing besides the one this loop creates, so a comparison has a second column.",
      );
    }
    const partnerTitle = requireText(partner.title, "the compared listing's title");

    const found = listingBlock(page, LISTING_TITLE);
    const partnerBlock = listingBlock(page, partnerTitle);
    await expect(partnerBlock, "the listing this loop compares against must be in the results").toHaveCount(
      1,
    );

    // Two listings selected. The control's own label states what a second press would do, so the
    // assertion below is that the selection moved rather than that a button was pressed.
    await partnerBlock.getByRole("button", { name: `Add to compare: ${partnerTitle}` }).click();
    await found.getByRole("button", { name: `Add to compare: ${LISTING_TITLE}` }).click();
    await expect(
      found.getByRole("button", { name: `Remove from compare: ${LISTING_TITLE}` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      partnerBlock.getByRole("button", { name: `Remove from compare: ${partnerTitle}` }),
    ).toHaveAttribute("aria-pressed", "true");

    // The comparison carries the selection in its address, and the card's own link is what opens the
    // comparison the reader has built: the navigation's Compare link starts an empty one.
    const comparisonLink = found.getByRole("link", { name: "Open the comparison" });
    await expect(comparisonLink).toHaveAttribute("href", new RegExp(listingId));
    await expect(comparisonLink).toHaveAttribute("href", new RegExp(partner.id));
    await comparisonLink.click();
    await expect(page).toHaveURL(/\/compare\?ids=/);

    await expect(page.getByRole("heading", { name: "Side by side" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: partnerTitle })).toBeVisible();

    // The created listing's own column: what it claims beside what the standard measured, with the
    // standard version, the limitations, the license and the pricing model the comparison exists to
    // place side by side.
    const column = page.getByRole("region", { name: LISTING_TITLE });
    await expect(column).toHaveCount(1);
    await expect(column).toContainText("Claims");
    await expect(column).toContainText("Measured evidence");
    await expect(column).toContainText("Stated limitations");
    await expect(column).toContainText("Offering");
    // A row renders its label and its value in two adjacent elements, so the two are asserted as the
    // two facts the column states rather than as one string a differently marked-up row would break.
    await expect(column).toContainText("License");
    await expect(column).toContainText(LICENSE_CODE);
    await expect(column).toContainText("Pricing model");
    await expect(column).toContainText(PRICING_MODEL);
    await expect(column).toContainText("Standard version");
    await expect(column).toContainText(standardVersionId);
    await expect(column).toContainText("Report label");
    await expect(column).toContainText(REPORT_LABEL_VERIFIED_IN_DEMO);

    // The buyer's inquiry, posted from the column it is about. The contract exposes no read route for
    // inquiries, so the created record and the page's own announcement are the evidence.
    const messageField = column.getByLabel("Your inquiry");
    await expect(
      messageField,
      "each comparison column must render the buyer's inquiry form.",
    ).toBeVisible();
    await messageField.fill(INQUIRY_MESSAGE);

    const [inquired] = await Promise.all([
      page.waitForResponse((response) => isCallTo(response, `${API_PREFIX}/inquiries`, "POST")),
      column.getByRole("button", { name: "Send inquiry" }).click(),
    ]);
    expect(inquired.status(), "an inquiry from a buyer account answers 201").toBe(201);
    const inquiry = (await inquired.json()) as InquiryEnvelopePayload;
    expect(inquiry.inquiry.listing_id, "the inquiry names the listing whose column it was sent from").toBe(
      listingId,
    );
    expect(inquiry.inquiry.message).toBe(INQUIRY_MESSAGE);
    expect(
      inquiry.inquiry.buyer_account_id,
      "the inquiry was recorded as the account the switcher selected",
    ).toBe(buyerAccountId);
    const inquiryId = requireText(inquiry.inquiry.id, "the identifier of the inquiry it created");

    // The confirmation is announced through a live region rather than appearing silently.
    const confirmation = column.getByRole("status").filter({ hasText: "Your inquiry was sent" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(inquiryId);
  });

  await test.step(STEP_CHECKOUT, async () => {
    // Back to the results, then into the listing through its own card — the walk a buyer makes.
    await page.getByRole("link", { name: "Listings", exact: true }).click();
    await expect(page).toHaveURL(/\/listings$/);
    await listingBlock(page, LISTING_TITLE)
      .getByRole("link", { name: LISTING_TITLE, ...EXACT })
      .click();
    await expect(page).toHaveURL(new RegExp(`/listings/${listingId}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(LISTING_TITLE);

    // The simulated checkout: the offer model the listing makes, the disclosure that says no money
    // moves, and no field a real checkout would ask for.
    const panel = page.getByRole("region", { name: "Simulated checkout" });
    await expect(
      panel,
      "the listing page must render the simulated checkout panel this step completes.",
    ).toBeVisible();
    await expect(panel).toContainText("simulated, nonfunctional checkout");
    expect(
      await panel.getByRole("textbox").count(),
      "the simulated checkout asks for no card, bank, account or provider field",
    ).toBe(0);
    expect(
      await panel.innerText(),
      "no currency symbol appears on a simulated amount",
    ).not.toMatch(/[$€£¥]/u);

    const offer = panel.getByLabel("Purchase");
    await expect(offer, "the listing must offer the model its pricing declares").toBeVisible();
    await offer.check();

    const [checkedOut] = await Promise.all([
      page.waitForResponse((response) =>
        isCallTo(response, `${API_PREFIX}/checkout-simulations`, "POST"),
      ),
      panel.getByRole("button", { name: "Run simulated checkout" }).click(),
    ]);
    expect(checkedOut.status(), "a simulated checkout from a buyer account answers 201").toBe(201);
    const transaction = (await checkedOut.json()) as TransactionPayload;
    expect(transaction.simulated, "the recorded transaction says for itself that it is simulated").toBe(
      true,
    );
    expect(transaction.currency_label, "an amount is counted in the synthetic currency").toBe(
      SYNTHETIC_CURRENCY_LABEL,
    );
    expect(Number.isInteger(transaction.amount_minor_units)).toBe(true);
    expect(transaction.amount_minor_units).toBeGreaterThan(0);
    expect(transaction.listing_id).toBe(listingId);
    expect(transaction.listing_version_id).toBe(versionId);
    expect(transaction.buyer_account_id).toBe(buyerAccountId);
    const transactionId = requireText(transaction.id, "the identifier of the transaction it recorded");

    // The page presents the same record, with the amount as a whole number of minor units beside the
    // label and the disclosure, and with nothing that reads as a real purchase.
    const recorded = panel.getByRole("status");
    await expect(recorded).toContainText("Simulated transaction recorded.");
    await expect(recorded).toContainText(transactionId);
    await expect(recorded).toContainText(
      `${transaction.amount_minor_units} ${SYNTHETIC_CURRENCY_LABEL}`,
    );
    await expect(recorded).toContainText(
      requireText(transaction.disclosure_label, "the simulated amount's disclosure label"),
    );
  });
});
