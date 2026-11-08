/**
 * Accessibility and responsive reflow on the four pages the criteria name: the homepage, a listing
 * page, a comparison and a report.
 *
 * **One file, two projects.** `playwright.config.ts` collects this spec under `a11y-desktop` at a
 * desktop width and under `a11y-mobile` at a phone width, so each of the four tests below reports
 * twice and the pair of runs is the whole proof: zero serious or critical axe-core violations at
 * both widths, and no horizontal scroll on any of the four pages. Nothing here sets a viewport and
 * nothing here branches on the project name — the configured viewport is the mechanism, and this
 * file reads the width it is running at from `page.viewportSize()` when it compares. Resizing the
 * page from in here would make the two projects identical and destroy the proof.
 *
 * **The rule set is not narrowed.** Each audit runs axe's default: every rule, the whole document,
 * no tag filter, no disabled rule and no include or exclude scoping. The criterion is "zero serious
 * or critical axe-core violations on the page", and a filter here would quietly change what is being
 * asserted. A rule that genuinely has to be excluded is a plan revision for a maintainer, never an
 * edit to this file. The one filter that is applied is axe's own documented `impact` value, where
 * `critical` means content that is totally inaccessible and `serious` means barriers that make
 * content difficult or impossible to access.
 *
 * **A page is proven before it is audited.** Every test asserts that the page it reached rendered
 * the intended content — one `<h1>`, one `<main>` landmark, the sections that page exists for, and
 * the persistent demonstration disclosure — before any rule runs. An audit that passed on a loading
 * shell, an error notice or an absent-state page would be a false pass, which is the most likely way
 * a suite like this one could lie.
 *
 * **The runtime belongs to the configuration.** The `webServer` starts the built application on
 * this clone's own port against a database it names and seeds itself, and `baseURL` points at it.
 * This file starts no server, sets no environment value, writes no fixture and calls no external
 * service: its discovery steps are the public API reads a reader's own browser makes.
 *
 * **Nothing the seed decides is written down here.** Identifiers are discovered inside each test
 * body from the search's own order, and a discovery that finds nothing fails with a sentence naming
 * what is missing rather than skipping the page it was meant to prove.
 */

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/** The exchange's discovery read and one listing's detail read, both public. */
const LISTINGS_PATH = "/api/v1/listings";
const LISTINGS_FIRST_PAGE = `${LISTINGS_PATH}?page=1`;

/** The read of a recorded report, which is what a listing's linked evidence points at. */
const EVALUATIONS_PATH = "/api/v1/evaluations";

/**
 * The closed vocabulary the audited pages must carry, written once here rather than imported: the
 * root manifest declares no workspace package as a dependency, so an end-to-end spec reaches the
 * application over HTTP and keeps its own copy of the words the request fixes. A page whose wording
 * drifted would fail here.
 */
const DEMO_AUTHENTICATION_LABEL = "demo only, no production authentication";
const SAMPLE_LABEL = "SAMPLE";
const BADGE_SCOPE = "structured output on fixture set only";
const STANDARD_VERSION_LABEL = "SGI-SO-1.0.0";
const PASS_OUTCOME = "PASS";

/**
 * The demonstration disclosure is located by its own class rather than by its text, because the same
 * sentence also sits beside the demo-account switcher: the banner is the element that has to survive
 * at both widths, and a text locator would match either of them.
 */
const DEMO_BANNER_SELECTOR = ".demo-banner";
const BADGE_GROUP_NAME = "SGI report badge";

/** Markers of the homepage: its heading and the four entry points into the exchange. */
const HOME_HEADING_FRAGMENT = "Agent Development Exchange and Marketplace";
const HOME_BROWSE_LINK = "Browse listings and search the exchange";
const HOME_COMPARE_LINK = "Compare two to four listings side by side";
const HOME_STANDARDS_LINK = "Read the standard and how it is governed";
const HOME_DEVELOPER_LINK = "Publish a listing and run an evaluation";
const HOME_LISTINGS_HEADING = "Listings on the exchange";

/** Markers of a listing page: its sections, and the labels of the facts they render. */
const LISTING_CLAIMS_HEADING = "Claims versus measured evidence";
const LISTING_HISTORY_HEADING = "Version history";
const LISTING_OFFERING_HEADING = "Limitations, license and pricing";
const LICENSE_FACT_LABEL = "License:";
const PRICING_MODEL_FACT_LABEL = "Pricing model:";
const STANDARD_VERSION_FACT_LABEL = "Standard version:";

/** Markers of a comparison: its heading, its two groups per column and the row carrying evidence. */
const COMPARE_HEADING = "Compare listings";
const COMPARE_READY_HEADING = "Side by side";
const COMPARE_CLAIMS_HEADING = "Claims";
const COMPARE_EVIDENCE_HEADING = "Measured evidence";
const COMPARE_STANDARD_VERSION_ROW = "Standard version";
const COMPARE_COLUMN_SELECTOR = ".compare-table__listing";
const COMPARE_ROW_SELECTOR = ".compare-table__row";
/** Two listings: the smallest comparison the contract accepts, and the pair this suite audits. */
const COMPARE_COLUMNS = 2;

/** Markers of a report page: its heading, the provenance list and the evidence table. */
const REPORT_HEADING = "SGI report";
const REPORT_EVIDENCE_HEADING = "Per-case evidence";
const OUTCOME_ROW_LABEL = "Outcome";

/**
 * One listing as the discovery reads it, summarised by the search or returned in full by the detail
 * read. The detail read adds fields this suite does not assert through; the three below are what it
 * consumes to reach a listing that carries measured evidence.
 */
interface ListingPayload {
  /** The listing's identifier, which is the route segment of its page. */
  readonly id: string;
  /** The listing's title, which is the page's `<h1>` and the heading of its column in a comparison. */
  readonly title: string;
  /** The newest report recorded for the listing's newest version, or `null` when there is none. */
  readonly report_id: string | null;
  /** That report's outcome, `PASS` or `FAIL`, or `null` when there is none. */
  readonly outcome: string | null;
}

/** The search's answer, as far as this suite reads it: the page of listings the exchange served. */
interface ListingSearchPayload {
  readonly items: readonly ListingPayload[];
}

/** The numbers a report states about itself, as the report's own read returns them. */
interface EvaluationReportPayload {
  readonly outcome: string;
  readonly matched_count: number;
  readonly total_count: number;
}

/**
 * What axe answers with, taken from the builder's own signature rather than re-declared: `axe-core`
 * is a transitive dependency and not one of this repository's declared dependencies, so the result
 * type travels with the builder instead of being imported from a package the manifest does not hold.
 */
type AxeAnalysis = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeViolation = AxeAnalysis["violations"][number];
type AxeViolationNode = AxeViolation["nodes"][number];

/**
 * Reads the first page of listings, refusing to continue on anything but a page of them.
 *
 * @param request The suite's API context, resolved against the configured `baseURL`.
 * @returns The listings the exchange served, in the order it served them.
 */
async function readListingsPage(request: APIRequestContext): Promise<readonly ListingPayload[]> {
  const response = await request.get(LISTINGS_FIRST_PAGE);
  expect(
    response.status(),
    `GET ${LISTINGS_FIRST_PAGE} must answer 200: the exchange's discovery read is public and needs no demo account`,
  ).toBe(200);

  const payload = (await response.json()) as ListingSearchPayload;
  expect(
    Array.isArray(payload.items),
    `GET ${LISTINGS_FIRST_PAGE} must answer an items array: the contract fixes the shape as { items, total, page }`,
  ).toBe(true);
  expect(
    payload.items.length,
    `GET ${LISTINGS_FIRST_PAGE} must answer at least one listing: the seed publishes twelve across four categories, and three of the four audited pages need one to reach`,
  ).toBeGreaterThan(0);

  return payload.items;
}

/**
 * Reads one listing in full, which is what carries the listing's linked evidence.
 *
 * @param request The suite's API context.
 * @param listingId An identifier the search returned, so the listing exists and is not hidden.
 * @returns The listing's detail payload.
 */
async function readListingDetail(
  request: APIRequestContext,
  listingId: string,
): Promise<ListingPayload> {
  const path = `${LISTINGS_PATH}/${encodeURIComponent(listingId)}`;
  const response = await request.get(path);
  expect(
    response.status(),
    `GET ${path} must answer 200: the search returned this listing, so its detail read is public and the listing is not hidden`,
  ).toBe(200);

  return (await response.json()) as ListingPayload;
}

/**
 * The first `wanted` listings on the page whose detail read satisfies `matches`, in the search's own
 * order.
 *
 * The search's order is what makes the result deterministic without any identifier being written
 * down here: the default sort puts a listing that carries a report ahead of one that does not and
 * then orders by title. The walk stops as soon as it holds what it was asked for, so a page of
 * twenty costs one detail read per listing it actually needed.
 *
 * @param request The suite's API context.
 * @param listings The page of listings to walk, in the order it arrived.
 * @param matches The predicate a listing's detail must satisfy to be taken.
 * @param wanted How many matching listings the caller needs.
 * @returns The matching listings found, in the order they were found.
 */
async function findListings(
  request: APIRequestContext,
  listings: readonly ListingPayload[],
  matches: (listing: ListingPayload) => boolean,
  wanted: number,
): Promise<readonly ListingPayload[]> {
  const found: ListingPayload[] = [];

  for (const listing of listings) {
    if (found.length >= wanted) {
      break;
    }
    const detail = await readListingDetail(request, listing.id);
    if (matches(detail)) {
      found.push(detail);
    }
  }

  return found;
}

/**
 * Reads a recorded report, so the report page's rendered totals and its evidence row count can be
 * compared against the report the service holds rather than against a number written down here.
 *
 * @param request The suite's API context.
 * @param reportId A report identifier a listing's linked evidence points at.
 * @returns The report's own record of its outcome and its counts.
 */
async function readEvaluationReport(
  request: APIRequestContext,
  reportId: string,
): Promise<EvaluationReportPayload> {
  const path = `${EVALUATIONS_PATH}/${encodeURIComponent(reportId)}`;
  const response = await request.get(path);
  expect(
    response.status(),
    `GET ${path} must answer 200 for a report a listing's linked evidence points at`,
  ).toBe(200);

  return (await response.json()) as EvaluationReportPayload;
}

/**
 * Whether an axe impact level is one the criterion fails on.
 *
 * `critical` is content axe documents as totally inaccessible and `serious` as barriers that make
 * content difficult or impossible to access. The two lesser levels, and a violation axe recorded
 * with no impact at all, do not fail this suite.
 *
 * @param impact The violation's own impact value, which axe may leave unstated.
 * @returns Whether the violation blocks the criterion.
 */
function isBlockingImpact(impact: AxeViolation["impact"]): boolean {
  return impact === "serious" || impact === "critical";
}

/**
 * Every blocking violation as a readable finding: the rule's identifier, impact and help, the
 * documentation address, and for each failing node the selector axe matched and axe's own summary.
 *
 * @param url The address the audit ran against.
 * @param violations The blocking violations found.
 * @returns A sentence for the assertion message, naming the page and every finding in full.
 */
function describeViolations(url: string, violations: readonly AxeViolation[]): string {
  if (violations.length === 0) {
    return `no serious or critical axe-core violation on ${url}`;
  }

  const findings = violations.map((violation: AxeViolation): string => {
    const nodes = violation.nodes
      .map(
        (node: AxeViolationNode): string =>
          `    ${JSON.stringify(node.target)} ${node.failureSummary ?? ""}`,
      )
      .join("\n");

    return `  ${violation.id} [${violation.impact ?? "unstated"}] ${violation.help}\n    ${violation.helpUrl}\n${nodes}`;
  });

  return `${String(violations.length)} serious or critical axe-core violation(s) on ${url}:\n${findings.join("\n")}`;
}

/**
 * Audits the page as it stands and fails on any serious or critical axe-core violation.
 *
 * One helper owns the rule set and the impact filter for all four pages, so the two cannot drift
 * apart between them: a page added later inherits exactly the audit the others get.
 *
 * @param page The page, already navigated and already proven to have rendered.
 */
async function analyseAndAssertNoSeriousViolations(page: Page): Promise<void> {
  const analysis: AxeAnalysis = await new AxeBuilder({ page }).analyze();

  // The vacuity guard. An analysis that examined nothing would satisfy every filter below, which is
  // the one way this helper could report a clean page that was never audited at all.
  expect(
    analysis.testEngine.name.length,
    "axe must name the engine that produced the analysis",
  ).toBeGreaterThan(0);
  const examined =
    analysis.passes.length + analysis.violations.length + analysis.incomplete.length;
  expect(
    examined,
    `axe must have run its rules against ${page.url()} before that page can pass`,
  ).toBeGreaterThan(0);

  const blocking = analysis.violations.filter((violation: AxeViolation): boolean =>
    isBlockingImpact(violation.impact),
  );

  expect(blocking.length, describeViolations(page.url(), blocking)).toBe(0);
}

/**
 * Asserts the page does not scroll horizontally at the width its project is running at.
 *
 * `documentElement.scrollWidth` is compared against the project's own viewport width. The document
 * element is the element used rather than the body, because a body's `clientWidth` shrinks at a
 * desktop width once a vertical scrollbar appears and would report a scroll on a page that has none.
 * The width compared against is read from the running project and never typed here, so the same
 * assertion is criterion 9's requirement at the phone width and a free check for a fixed-width
 * element at the desktop width.
 *
 * @param page The page, already navigated and already proven to have rendered.
 */
async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error(
      `No viewport is set for ${page.url()}: the two accessibility projects set one, and a run without one is a configuration fault rather than a page fault`,
    );
  }

  const scrollWidth: number = await page.evaluate((): number => document.documentElement.scrollWidth);

  expect(
    scrollWidth,
    `${page.url()} must not scroll horizontally: its document is ${String(scrollWidth)} px wide inside a ${String(viewport.width)} px viewport`,
  ).toBeLessThanOrEqual(viewport.width);
}

/**
 * Asserts the audited page rendered a page rather than an empty shell: one landmark, one `<h1>`, and
 * the persistent demonstration disclosure.
 *
 * The disclosure is asserted on all four pages at both widths on purpose. It is the label that tells
 * a reader the demo accounts are a synthetic role selector and not authentication, and a layout that
 * hides it at a narrow width has stopped disclosing anything.
 *
 * @param page The page, already navigated.
 */
async function assertPageFrame(page: Page): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(DEMO_BANNER_SELECTOR)).toBeVisible();
  await expect(page.locator(DEMO_BANNER_SELECTOR)).toHaveText(DEMO_AUTHENTICATION_LABEL);
}

test("homepage: no serious or critical axe violation and no horizontal scroll", async ({ page }) => {
  await page.goto("/");

  await assertPageFrame(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(HOME_HEADING_FRAGMENT);
  await expect(page.getByRole("link", { name: HOME_BROWSE_LINK, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: HOME_COMPARE_LINK, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: HOME_STANDARDS_LINK, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: HOME_DEVELOPER_LINK, exact: true })).toBeVisible();

  // The listings block reads the API when the page mounts, so the page is still changing while that
  // read is in flight. Waiting for the seeded cards is what makes the audit below an audit of the
  // page a reader reads rather than of a loading state, and it is the one block that arrives late.
  const listingsBlock = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: HOME_LISTINGS_HEADING, exact: true }) });
  await expect(listingsBlock.locator("li").first()).toBeVisible();

  await analyseAndAssertNoSeriousViolations(page);
  await assertNoHorizontalScroll(page);
});

test("listing page: no serious or critical axe violation and no horizontal scroll", async ({
  page,
  request,
}) => {
  const listings = await readListingsPage(request);
  const [listing] = await findListings(
    request,
    listings,
    (candidate: ListingPayload): boolean => candidate.report_id !== null,
    1,
  );

  if (listing === undefined) {
    throw new Error(
      `No listing on the first page of ${LISTINGS_FIRST_PAGE} carries a linked report, so the listing page cannot be audited with the section that shows measured evidence: the seed records a report for each of its three fixture candidates, and this discovery found none of them on the exchange's first page`,
    );
  }

  await page.goto(`/listings/${encodeURIComponent(listing.id)}`);

  await assertPageFrame(page);
  // The listing read resolves after the first render, so the title in the `<h1>` is also what proves
  // this page settled on the listing the test asked for rather than on a loading or absent state.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(listing.title);
  await expect(
    page.getByRole("heading", { level: 2, name: LISTING_CLAIMS_HEADING, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: LISTING_HISTORY_HEADING, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: LISTING_OFFERING_HEADING, exact: true }),
  ).toBeVisible();
  // Scoped to their own sections rather than searched page-wide: the listing page states the license
  // and the pricing model in its header facts as well as in the offering section, so a page-wide text
  // locator matches two elements and says nothing about which one it found. The evidence section and
  // the offering section are each the section whose `<h2>` names it.
  const evidenceSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: LISTING_CLAIMS_HEADING, exact: true }) });
  const offeringSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: LISTING_OFFERING_HEADING, exact: true }) });

  await expect(offeringSection.getByText(LICENSE_FACT_LABEL, { exact: true })).toBeVisible();
  await expect(offeringSection.getByText(PRICING_MODEL_FACT_LABEL, { exact: true })).toBeVisible();
  await expect(evidenceSection.getByText(STANDARD_VERSION_FACT_LABEL, { exact: true })).toBeVisible();
  await expect(evidenceSection.locator("li", { hasText: STANDARD_VERSION_FACT_LABEL })).toContainText(
    STANDARD_VERSION_LABEL,
  );

  await analyseAndAssertNoSeriousViolations(page);
  await assertNoHorizontalScroll(page);
});

test("compare page: no serious or critical axe violation and no horizontal scroll", async ({
  page,
  request,
}) => {
  const listings = await readListingsPage(request);
  const [left, right] = await findListings(
    request,
    listings,
    (candidate: ListingPayload): boolean => candidate.report_id !== null,
    COMPARE_COLUMNS,
  );

  if (left === undefined || right === undefined) {
    throw new Error(
      `A comparison needs two listings whose detail read carries a linked report, and the first page of ${LISTINGS_FIRST_PAGE} supplied fewer than two: the seed records one report for each of its three fixture candidates`,
    );
  }

  const ids = [left.id, right.id].map((id: string): string => encodeURIComponent(id)).join(",");
  await page.goto(`/compare?ids=${ids}`);

  await assertPageFrame(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COMPARE_HEADING);
  // One block per listing. The count is also what proves the comparison finished loading before any
  // rule ran against it, since the columns only exist once the columns read has resolved.
  await expect(page.locator(COMPARE_COLUMN_SELECTOR)).toHaveCount(COMPARE_COLUMNS);
  await expect(
    page.getByRole("heading", { level: 2, name: COMPARE_READY_HEADING, exact: true }),
  ).toBeVisible();

  // Both listings are asserted rather than the first alone: the second column is what proves the
  // comparison rendered every column it was asked for instead of one that happened to load, and it is
  // what the reflow assertion below is then measuring at both widths.
  for (const listing of [left, right]) {
    const column = page
      .locator(COMPARE_COLUMN_SELECTOR)
      .filter({ has: page.getByRole("heading", { level: 3, name: listing.title, exact: true }) });

    await expect(column).toHaveCount(1);
    await expect(
      column.getByRole("heading", { level: 4, name: COMPARE_CLAIMS_HEADING, exact: true }),
    ).toBeVisible();
    await expect(
      column.getByRole("heading", { level: 4, name: COMPARE_EVIDENCE_HEADING, exact: true }),
    ).toBeVisible();
    await expect(
      column.locator(COMPARE_ROW_SELECTOR).filter({ hasText: COMPARE_STANDARD_VERSION_ROW }).first(),
    ).toContainText(STANDARD_VERSION_LABEL);
  }

  await analyseAndAssertNoSeriousViolations(page);
  await assertNoHorizontalScroll(page);
});

test("report page: no serious or critical axe violation and no horizontal scroll", async ({
  page,
  request,
}) => {
  const listings = await readListingsPage(request);
  const [passing] = await findListings(
    request,
    listings,
    (candidate: ListingPayload): boolean =>
      candidate.report_id !== null && candidate.outcome === PASS_OUTCOME,
    1,
  );

  if (passing === undefined || passing.report_id === null) {
    throw new Error(
      `No listing on the first page of ${LISTINGS_FIRST_PAGE} carries a linked report whose outcome is ${PASS_OUTCOME}, so the report page cannot be audited with its badge: a badge is issued on a pass alone, and the seed records exactly one passing fixture candidate`,
    );
  }

  const reportId = passing.report_id;
  const report = await readEvaluationReport(request, reportId);

  await page.goto(`/reports/${encodeURIComponent(reportId)}`);

  await assertPageFrame(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(REPORT_HEADING);

  // The badge is the page's own artefact, so it is asserted whole: the label from the closed
  // vocabulary, the standard version it names, the scope string it is limited to, and the report it
  // identifies. Nothing here asserts a certification, and the scope string is the whole of what the
  // badge claims.
  const badge = page.getByRole("group", { name: BADGE_GROUP_NAME });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(SAMPLE_LABEL);
  await expect(badge).toContainText(STANDARD_VERSION_LABEL);
  await expect(badge).toContainText(BADGE_SCOPE);
  await expect(badge).toContainText(reportId);

  // The provenance list is the page's only definition list, and its values are the report's own: the
  // outcome and the counts asserted here are the record the service holds, not a figure typed here.
  const provenance = page.locator("dl");
  await expect(provenance).toHaveCount(1);
  await expect(provenance).toContainText(OUTCOME_ROW_LABEL);
  await expect(provenance).toContainText(report.outcome);
  await expect(provenance).toContainText(
    `${String(report.matched_count)} of ${String(report.total_count)}`,
  );

  // Per-case evidence. A report carrying no case results renders an explained empty state instead of
  // a table, so the row count is only meaningful once the report is known to hold evidence.
  expect(
    report.total_count,
    `report ${reportId} must carry per-case evidence, or the row assertion below would pass on an empty table`,
  ).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { level: 2, name: REPORT_EVIDENCE_HEADING, exact: true }),
  ).toBeVisible();
  await expect(page.locator("table caption")).toContainText(reportId);
  await expect(page.locator("table tbody tr")).toHaveCount(report.total_count);

  await analyseAndAssertNoSeriousViolations(page);
  await assertNoHorizontalScroll(page);
});
