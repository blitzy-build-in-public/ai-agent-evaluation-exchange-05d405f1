/**
 * The route walk: every public page reached by clicking, and the rendered sponsorship label.
 *
 * Two acceptance criteria are proved here and nothing else is. The first is the page half of the
 * route walk: all thirteen public pages are reachable from the homepage alone, by following what the
 * pages render — never by typing an address — and an unknown listing renders the absent-state page
 * whose link returns a reader to browse. The API half of that criterion walks the contract table in
 * `apps/api/test/integration/route-walk.test.ts` and is deliberately not repeated here. The second is
 * the rendered half of the trust-separation criterion: every sponsored item carries its own visible
 * `Sponsored` label, in a collection of its own below the organic results and never interleaved with
 * them. The static import-boundary check and the sponsorship-variance comparison belong to
 * `apps/api/test/integration/trust-separation.test.ts`.
 *
 * **Navigation, not addresses.** Two `page.goto` calls appear in this file. The first is the walk's
 * shared entry point — the homepage, which every test starts from and then leaves by clicking, so a
 * page that only renders when its address is typed fails its own test. The second is the single
 * unknown-listing path in the absent-state test: no affordance can lead to a path that names nothing,
 * so that state cannot be reached by clicking, and the criterion's own wording pairs "reached by
 * navigation" with "an unknown listing renders the not-found page".
 *
 * **The runtime belongs to `playwright.config.ts`.** The `webServer` there runs the seed and then the
 * built application against a database file unique to the run, and sets `baseURL`; this file starts
 * nothing, sets no environment value, seeds nothing by hand and calls no service outside it. Every
 * address below is a path relative to that `baseURL`.
 *
 * **Reads, never writes.** No request here is a `POST`: the walk cannot consume the write rate limit
 * and cannot depend on a role. The one selection it makes — the demo developer account in the
 * switcher — changes only which account the developer page renders its own listings for.
 *
 * **The ids and the labels are discovered, never assumed.** Report identifiers are generated when a
 * report is written, and the sibling `developer-to-buyer.spec.ts` runs first against the same seeded
 * database and publishes more listings, so this file finds what it needs from the public reads and
 * from the rendered page, asserts "at least one" rather than an exact count wherever the seed only
 * fixes a lower bound, and takes every label it compares from the payload the application itself
 * returned.
 */

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/* ------------------------------------------------------------------------------------------------
 * The routes the walk visits
 * ---------------------------------------------------------------------------------------------- */

/** The walk's shared entry point, and the only address any test starts from. */
const HOME_PATH = "/";

/** The other top-level routes the main navigation links to, in the order it renders them. */
const MISSION_PATH = "/mission";
const LISTINGS_PATH = "/listings";
const COMPARE_PATH = "/compare";
const DEVELOPER_PATH = "/developer";
const CHALLENGES_PATH = "/challenges";
const THREADS_PATH = "/threads";
const STANDARDS_PATH = "/standards";
const ACADEMY_PATH = "/academy";
const OPPORTUNITY_INDEX_PATH = "/opportunity-index";

/** The report route's prefix: `/reports/{id}`, plural, as the shell's route table spells it. */
const REPORTS_PATH_PREFIX = "/reports/";

/**
 * An address that names no listing, so the listing route answers with the absent-state page.
 *
 * The shape is the seeded version identifiers' own — the same four-group form the fixture candidates
 * carry — so it passes every parameter check the route applies and reaches the lookup, where it
 * matches no row. It is deliberately the only literal identifier in this file: no seeded listing is
 * named here, because a hardcoded identifier would turn a reordering of the seed into a failure of
 * the walk rather than of the seed.
 */
const UNKNOWN_LISTING_PATH = "/listings/00000000-0000-4000-8000-0000000000ff";

/* ------------------------------------------------------------------------------------------------
 * The closed vocabulary this walk asserts, one definition each
 * ---------------------------------------------------------------------------------------------- */

/**
 * The demonstration disclosure, rendered in the shell's header on every route. It is stated here as a
 * literal because what is asserted is the rendered sentence, and the assertion must fail if the
 * shared constant's value ever changes.
 */
const DEMO_AUTHENTICATION_LABEL = "demo only, no production authentication";

/** The one label a sponsored item carries, and the name of the collection that holds them. */
const SPONSORED_LABEL = "Sponsored";

/** The scope every badge names, which is the whole of what a badge measures. */
const BADGE_SCOPE = "structured output on fixture set only";

/** The badge's accessible name, which is how the report and listing pages expose it. */
const BADGE_GROUP_NAME = "SGI report badge";

/** The one standard version this release publishes, and the title it carries. */
const STANDARD_CODE = "SGI-SO-1.0.0";
const STANDARD_TITLE = "Structured Output Conformance";

/** The rubric reference a report cites, rendered as text and never as a link. */
const RUBRIC_REFERENCE = "SGI-SO-1.0.0#rubric";

/** The two report labels, which are the whole of that vocabulary; no third label may be introduced. */
const REPORT_LABEL_SAMPLE = "SAMPLE";
const REPORT_LABEL_VERIFIED_IN_DEMO = "VERIFIED-IN-DEMO";
const REPORT_LABELS: readonly string[] = [REPORT_LABEL_SAMPLE, REPORT_LABEL_VERIFIED_IN_DEMO];

/** What a listing with no evaluation renders in place of an outcome, a standard version and a label. */
const NO_REPORT_LABEL = "No SGI report yet";

/** The switcher's control label, and the visible text of the developer account's option. */
const DEMO_ACCOUNT_CONTROL_LABEL = "Demo account";
const DEMO_DEVELOPER_OPTION_LABEL = "Demo developer account";

/**
 * The controls the listings page's search and filter form offers, by their visible labels: the query
 * box, the four filters and the ordering.
 */
const FILTER_LABELS: readonly string[] = [
  "Search listings",
  "Category",
  "License",
  "Pricing model",
  "Standard",
  "Sort by",
];

/**
 * The readable name the exchange presents each pricing model under on every surface that names one:
 * a result card and a comparison column print this label rather than the value the payload carried,
 * so the listings-step assertion below compares what a reader sees against that vocabulary.
 */
const PRICING_MODEL_LABELS: Readonly<Record<string, string>> = {
  rent: "Rent",
  purchase: "Purchase",
  license: "License",
  subscription: "Subscription",
};

/** The sections a listing detail page carries, beside the page's own heading. */
const LISTING_DETAIL_SECTIONS: readonly string[] = [
  "Claims versus measured evidence",
  "Version history",
  "Limitations, license and pricing",
];

/**
 * The four groups every column of a comparison carries: the developer's claims, the measured
 * evidence, the limitations stated for those claims, and how the listing is offered.
 */
const COMPARE_GROUPS: readonly string[] = [
  "Claims",
  "Measured evidence",
  "Stated limitations",
  "Offering",
];

/** The Academy questionnaire's first prompt, and the three answers each question offers. */
const ACADEMY_FIRST_QUESTION =
  "Does the candidate run against a fixed set of test cases whose expected outputs were recorded before it ran?";
const ACADEMY_ANSWERS: readonly string[] = ["Yes", "Partly", "No"];

/** The compare control a result card renders, whose accessible name carries the listing's title. */
const ADD_TO_COMPARE_LABEL = "Add to compare";
const OPEN_COMPARISON_LABEL = "Open the comparison";

/**
 * The report link's accessible name, as the listing and developer pages render it. The failure
 * variant carries more words — it says the report failed and points at the per-case evidence — so the
 * expression matches both forms rather than asserting only the passing one.
 */
const REPORT_LINK_PATTERN = /^Read the (SGI )?report/;

/** The navigation landmark's accessible name, as the shell declares it. */
const MAIN_NAVIGATION_NAME = "Main";

/* ------------------------------------------------------------------------------------------------
 * The public reads this file asserts against
 * ---------------------------------------------------------------------------------------------- */

/**
 * The listing search, which is also the read behind the page's own results, so the payload and the
 * rendered cards are ordered alike: the query carries no filter and no ordering, and the contract's
 * default ordering is the server's.
 */
const LISTINGS_API_PATH = "/api/v1/listings?page=1";

/** The sponsored-slot read: public, parameterless, and the only place a sponsorship is served. */
const SPONSORED_SLOTS_API_PATH = "/api/v1/sponsored-slots";

/** The report read's prefix: the public `GET /evaluations/{id}` route the report page renders. */
const REPORTS_API_PATH_PREFIX = "/api/v1/evaluations/";

/**
 * The accessible name of the listings page's results region, which holds the organic cards, and of the
 * homepage's own results region. A sponsored collection is asserted to sit after the one that belongs
 * to the surface being checked, and to stay outside it.
 */
const RESULTS_REGION_NAME = "Results";
const HOME_RESULTS_REGION_NAME = "Listings on the exchange";

/** How long a path assertion waits for a click's navigation to settle. */
const NAVIGATION_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------------------------------------
 * Step labels: every failure names the page, the click path and the expected address
 * ---------------------------------------------------------------------------------------------- */

const HOME_STEP = "the homepage: the walk's shared entry point, entered at /";
const LISTINGS_STEP = "the listings page: after clicking the Listings link in the main navigation";
const LISTING_DETAIL_STEP =
  "the listing detail page: after clicking the first result card's title link on the listings page";
const REPORT_STEP =
  "the report page: after clicking the report link on a listing detail page reached from the listings results";
const COMPARE_STEP =
  "the compare page: after adding two listings with the cards' compare controls and clicking the card's Open the comparison link";
const DEVELOPER_STEP =
  "the developer workspace: after selecting the demo developer account and clicking the Developer link in the main navigation";
const CHALLENGES_STEP =
  "the challenges page: after clicking the Challenges link in the main navigation";
const THREADS_STEP = "the threads page: after clicking the Threads link in the main navigation";
const STANDARDS_STEP =
  "the standards page: after clicking the Standards link in the main navigation";
const ACADEMY_STEP = "the Academy page: after clicking the Academy link in the main navigation";
const OPPORTUNITY_INDEX_STEP =
  "the opportunity index page: after clicking the Opportunity index link in the main navigation";
const MISSION_STEP = "the mission page: after clicking the Mission link in the main navigation";
const NOT_FOUND_STEP =
  "the absent-state page: after entering a listing address that names no listing";
const SPONSORED_STEP =
  "the sponsored collection: on the homepage and on the listings page, each reached by clicking";

/* ------------------------------------------------------------------------------------------------
 * The payloads this file reads, declared locally
 * ---------------------------------------------------------------------------------------------- */

/**
 * One search result, as `GET /listings` returns it. Only the members this file asserts are declared:
 * the payload shapes are the API's contract, owned by the shared workspace package, and the root
 * manifest lets no spec under `e2e/` import a workspace at all — so the few fields read here are
 * spelled out locally rather than left to `any`.
 */
interface ListingSummaryPayload {
  readonly id: string;
  readonly title: string;
  readonly pricing_model: string;
  readonly license_code: string;
  readonly outcome: string | null;
  readonly standard_version_id: string | null;
  readonly label: string | null;
}

/** One page of the listing search. */
interface ListingSearchPayload {
  readonly items: readonly ListingSummaryPayload[];
  readonly total: number;
  readonly page: number;
}

/** One sponsored slot, which every item of the public read also marks as sponsored. */
interface SponsoredSlotPayload {
  readonly id: string;
  readonly sponsor_label: string;
  readonly placement_key: string;
  readonly sponsored: boolean;
}

/** The sponsored collection, which stands alone and is never part of a listings payload. */
interface SponsoredSlotListPayload {
  readonly items: readonly SponsoredSlotPayload[];
}

/** One row of a report's per-case evidence. */
interface ReportCaseResultPayload {
  readonly case_id: string;
  readonly severity: string;
  readonly expected: string;
  readonly actual: string;
  readonly match: boolean;
}

/** One evaluation report with its per-case evidence, as `GET /evaluations/{id}` returns it. */
interface ReportPayload {
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
  readonly case_results: readonly ReportCaseResultPayload[];
}


/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/**
 * The pathname of the page's current address, read from the browser rather than from a click, so an
 * assertion compares what the application navigated to with the route this file says it should be.
 *
 * @param page The page whose address is read.
 * @returns The pathname, without the origin and without the query string.
 */
function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/**
 * Assert that the page is at `expectedPath`, waiting until it is.
 *
 * The query string is deliberately excluded: a walk proves which route a click reached, and a route
 * that carries a selection — the compare page's `ids`, for one — is still that route. The message
 * names the page, the click path that was meant to reach it and the expected address, so a failure
 * says where the walk went wrong rather than only that two strings differ.
 *
 * @param page The page under walk.
 * @param expectedPath The pathname the route should serve.
 * @param step The page and the click path, named for the failure message.
 */
async function expectPath(page: Page, expectedPath: string, step: string): Promise<void> {
  await expect
    .poll((): string => pathOf(page), {
      message: `${step}: the browser should be at the URL path ${expectedPath}`,
      timeout: NAVIGATION_TIMEOUT_MS,
    })
    .toBe(expectedPath);
}

/**
 * Assert that the route renders exactly one level-1 heading, which is what every page in this shell
 * owes its reader. A second one hides the page's own subject, and none leaves the route unnamed.
 *
 * @param page The page under walk.
 * @param step The page and the click path, named for the failure message.
 */
async function expectSingleHeading(page: Page, step: string): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1 }),
    `${step}: the route should render exactly one level-1 heading`,
  ).toHaveCount(1);
}

/**
 * Assert that the persistent demonstration disclosure is rendered in the shell's header, which every
 * route keeps: a reader who navigates away from the page that explained the demo accounts must still
 * be told that the selection is not an authentication of anyone.
 *
 * The label is rendered twice in the header — the banner states it and the switcher repeats it beside
 * its control — so the assertion is that the header carries at least one element holding the exact
 * sentence, rather than that a single element matches.
 *
 * @param page The page under walk.
 * @param step The page and the click path, named for the failure message.
 */
async function expectDemoDisclosure(page: Page, step: string): Promise<void> {
  const header = page.getByRole("banner");
  await expect(header, `${step}: the shell should render its header landmark`).toHaveCount(1);
  await expect(
    header.getByText(DEMO_AUTHENTICATION_LABEL, { exact: true }),
    `${step}: the header should carry the demonstration disclosure ${JSON.stringify(DEMO_AUTHENTICATION_LABEL)}`,
  ).not.toHaveCount(0);
}

/**
 * Reach a top-level page the way a reader does: by clicking its link in the main navigation.
 *
 * @param page The page under walk.
 * @param name The link's accessible name, which is the destination's own word for itself.
 */
async function clickNavLink(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: MAIN_NAVIGATION_NAME })
    .getByRole("link", { name, exact: true })
    .click();
}

/**
 * Read the first page of the public listing search.
 *
 * @param request The spec's own API request context, which resolves a path against the configured
 * base address and therefore needs no absolute URL here.
 * @returns The page of results the application's own search returns.
 * @throws {Error} If the read answers with a body that holds no items array, which would leave every
 * assertion below with nothing to compare against.
 */
async function readListings(request: APIRequestContext): Promise<ListingSearchPayload> {
  const response = await request.get(LISTINGS_API_PATH);
  expect(response.status(), `the listing search ${LISTINGS_API_PATH} should answer 200`).toBe(200);

  const payload = (await response.json()) as ListingSearchPayload;
  if (!Array.isArray(payload.items)) {
    throw new Error(
      `the listing search ${LISTINGS_API_PATH} answered a body with no items array, so the walk has nothing to assert against`,
    );
  }
  return payload;
}

/**
 * The first listing of a search page, which is the card the walk follows.
 *
 * @param payload One page of the listing search.
 * @returns The first result.
 * @throws {Error} If the page holds no result, which the seed makes impossible: twelve listings are
 * published, so an empty first page means the seed, the migrations or the listing route is broken.
 */
function firstListing(payload: ListingSearchPayload): ListingSummaryPayload {
  const listing = payload.items[0];
  if (listing === undefined) {
    throw new Error(
      "the listing search returned no results, and the seed publishes twelve listings: the seed, the migrations or the listing route is broken rather than the route walk",
    );
  }
  return listing;
}

/**
 * The first listing whose latest report carries `label`, or `null` when no listing carries it.
 *
 * @param payload One page of the listing search.
 * @param label The report label to look for, one of the two the vocabulary closes over.
 * @returns The first matching listing, or `null`.
 */
function firstListingWithLabel(
  payload: ListingSearchPayload,
  label: string,
): ListingSummaryPayload | null {
  return (
    payload.items.find((listing: ListingSummaryPayload): boolean => listing.label === label) ?? null
  );
}

/**
 * Every listing on the page whose latest version has a report: the three fields such a payload states
 * together are all present, or none of them is.
 *
 * @param payload One page of the listing search.
 * @returns The listings carrying an outcome, a standard version and a label.
 */
function listingsWithReport(payload: ListingSearchPayload): readonly ListingSummaryPayload[] {
  return payload.items.filter(
    (listing: ListingSummaryPayload): boolean =>
      listing.outcome !== null && listing.standard_version_id !== null && listing.label !== null,
  );
}

/**
 * The first listing with a report, which is what the report walk follows.
 *
 * @param payload One page of the listing search.
 * @returns The first listing whose evidence can be read.
 * @throws {Error} If no listing carries a report. The seed records one for each of its three fixture
 * candidates, so this can only mean the seed or the evaluation route is broken.
 */
function firstListingWithReport(payload: ListingSearchPayload): ListingSummaryPayload {
  const listing = listingsWithReport(payload)[0];
  if (listing === undefined) {
    throw new Error(
      "no listing carries an evaluation report, and the seed records one for each of its three fixture candidates: the seed or the evaluation route is broken rather than the route walk",
    );
  }
  return listing;
}

/**
 * Read one report and its per-case evidence from the public report route.
 *
 * @param request The spec's own API request context.
 * @param reportId The report's identifier, discovered from the link the listing page rendered.
 * @returns The report the application holds.
 * @throws {Error} If the read answers with a body that holds no per-case results array.
 */
async function readReport(request: APIRequestContext, reportId: string): Promise<ReportPayload> {
  const path = `${REPORTS_API_PATH_PREFIX}${encodeURIComponent(reportId)}`;
  const response = await request.get(path);
  expect(response.status(), `the report read ${path} should answer 200`).toBe(200);

  const payload = (await response.json()) as ReportPayload;
  if (!Array.isArray(payload.case_results)) {
    throw new Error(
      `the report read ${path} answered a body with no per-case evidence array, so the evidence the page renders cannot be checked against it`,
    );
  }
  return payload;
}

/**
 * Read the public sponsored collection, which is the whole of this product's advertising surface.
 *
 * @param request The spec's own API request context.
 * @returns Every sponsored slot the route serves, each marked as sponsored.
 * @throws {Error} If the read answers with a body that holds no items array.
 */
async function readSponsoredSlots(
  request: APIRequestContext,
): Promise<readonly SponsoredSlotPayload[]> {
  const response = await request.get(SPONSORED_SLOTS_API_PATH);
  expect(
    response.status(),
    `the sponsored read ${SPONSORED_SLOTS_API_PATH} should answer 200`,
  ).toBe(200);

  const payload = (await response.json()) as SponsoredSlotListPayload;
  if (!Array.isArray(payload.items)) {
    throw new Error(
      `the sponsored read ${SPONSORED_SLOTS_API_PATH} answered a body with no items array, so the collection cannot be compared with what is rendered`,
    );
  }
  for (const slot of payload.items) {
    expect(
      slot.sponsored,
      `every item of ${SPONSORED_SLOTS_API_PATH} should carry the sponsored marker, and the item ${JSON.stringify(slot.id)} does not`,
    ).toBe(true);
  }
  return payload.items;
}

/**
 * The result card for one listing, found by the title its card links on rather than by position, so
 * the walk cannot assert against the wrong card when the seed's order changes.
 *
 * @param page The page under walk, which must be showing the listing search.
 * @param title The listing's title, as the search returned it.
 * @returns The card whose title link is the listing's title.
 */
function resultCard(page: Page, title: string): Locator {
  return page
    .getByRole("region", { name: RESULTS_REGION_NAME })
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

/**
 * Assert the whole of what a rendered sponsored collection owes a reader on one surface.
 *
 * Five things are checked, and each is a failure of its own: the seed really places a slot on this
 * surface; the items render as their own collection whose heading is the one-word label; there is one
 * item per slot placed here and no more; every item carries the label itself, per item rather than
 * once for the collection; and nothing inside the organic results carries the label, with the
 * collection sitting after them in document order.
 *
 * @param page The page under walk.
 * @param slots Every sponsored slot the public read returned.
 * @param placementKey The surface being checked, one of the placement vocabulary's two keys.
 * @param step The page and the click path, named for the failure message.
 * @param organicRegionName The accessible name of this page's organic results region.
 */
async function expectSponsoredCollection(
  page: Page,
  slots: readonly SponsoredSlotPayload[],
  placementKey: string,
  step: string,
  organicRegionName: string,
): Promise<void> {
  const placed = slots.filter(
    (slot: SponsoredSlotPayload): boolean => slot.placement_key === placementKey,
  );
  expect(
    placed.length,
    `${step}: the seeded sponsored slots should name the ${placementKey} placement, and none of the ${slots.length} the public read returned does: the seed or the sponsored route is broken`,
  ).toBeGreaterThan(0);

  const collection = page.getByRole("region", { name: SPONSORED_LABEL });
  await expect(
    collection,
    `${step}: the sponsored items should render as their own collection labelled ${JSON.stringify(SPONSORED_LABEL)}`,
  ).toBeVisible();

  const items = collection.getByRole("listitem");
  await expect(
    items,
    `${step}: the collection should render one item for each of the ${placed.length} slots placed on this surface, and only those`,
  ).toHaveCount(placed.length);

  const renderedItems = await items.count();
  for (let index = 0; index < renderedItems; index += 1) {
    await expect(
      items.nth(index),
      `${step}: every sponsored item should carry the literal ${JSON.stringify(SPONSORED_LABEL)} label of its own`,
    ).toContainText(SPONSORED_LABEL);
  }

  const organic = page.getByRole("region", { name: organicRegionName });
  await expect(
    organic,
    `${step}: the organic results should render in their own region, ${JSON.stringify(organicRegionName)}`,
  ).toBeVisible();
  await expect(
    organic.getByText(SPONSORED_LABEL, { exact: true }),
    `${step}: no organic result may carry the ${JSON.stringify(SPONSORED_LABEL)} label`,
  ).toHaveCount(0);

  // The two collections are compared in document order rather than by their boxes or a scroll
  // position: `getByRole("region")` yields a page's labelled sections in the order it renders them,
  // so "after the organic results" is asserted without depending on layout.
  const regionNames = await page
    .getByRole("region")
    .evaluateAll((regions: Element[]): string[] =>
      regions.map((region: Element): string => {
        const labelledBy = region.getAttribute("aria-labelledby");
        const heading = labelledBy === null ? null : document.getElementById(labelledBy);
        return heading === null ? "" : (heading.textContent ?? "").trim();
      }),
    );
  const organicIndex = regionNames.indexOf(organicRegionName);
  const sponsoredIndex = regionNames.indexOf(SPONSORED_LABEL);
  expect(
    organicIndex,
    `${step}: the organic results region ${JSON.stringify(organicRegionName)} should be one of the page's labelled sections, and the page rendered ${JSON.stringify(regionNames)}`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    sponsoredIndex,
    `${step}: the sponsored collection should render after the organic results, and it sits at position ${sponsoredIndex} of ${JSON.stringify(regionNames)}`,
  ).toBeGreaterThan(organicIndex);
}

/* ------------------------------------------------------------------------------------------------
 * The walk
 * ---------------------------------------------------------------------------------------------- */

/**
 * The route walk: thirteen pages, one test each, and the sponsored collection.
 *
 * A test per page rather than one long walk, so each page passes or fails on its own and one broken
 * page cannot hide the other twelve. Every test enters at the homepage and reaches its page by
 * clicking, so no test depends on another's navigation and the file proves the pages are reachable
 * rather than that their addresses happen to resolve.
 */
test.describe("route walk", () => {
  test("the homepage is the walk's entry point and offers the way into browse", async ({ page }) => {
    await page.goto(HOME_PATH);
    await expectPath(page, HOME_PATH, HOME_STEP);
    await expectSingleHeading(page, HOME_STEP);
    await expectDemoDisclosure(page, HOME_STEP);

    // The page's own marker: it states what the product exists to do, from the heading the route
    // owns, so a shell that rendered nothing of its own could not pass.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Agent Development Exchange and Marketplace",
    );

    const browseEntries = await page
      .getByRole("main")
      .getByRole("link")
      .evaluateAll((links: Element[], path: string): number => {
        return links.filter((link: Element): boolean => link.getAttribute("href") === path).length;
      }, LISTINGS_PATH);
    expect(
      browseEntries,
      `${HOME_STEP}: the homepage should offer at least one entry point into browse, at ${LISTINGS_PATH}`,
    ).toBeGreaterThan(0);
  });

  test("the listings page is reached from the navigation and renders results with the filters", async ({
    page,
    request,
  }) => {
    const payload = await readListings(request);
    const listing = firstListing(payload);

    await page.goto(HOME_PATH);
    await clickNavLink(page, "Listings");
    await expectPath(page, LISTINGS_PATH, LISTINGS_STEP);
    await expectSingleHeading(page, LISTINGS_STEP);
    await expectDemoDisclosure(page, LISTINGS_STEP);

    for (const label of FILTER_LABELS) {
      await expect(
        page.getByLabel(label, { exact: true }),
        `${LISTINGS_STEP}: the search and filter controls should offer the control labelled ${JSON.stringify(label)}`,
      ).toBeVisible();
    }

    const card = resultCard(page, listing.title);
    await expect(
      card,
      `${LISTINGS_STEP}: the search should render a result card for ${JSON.stringify(listing.title)}, the first listing it returned`,
    ).toHaveCount(1);
    // The card names the pricing model through the exchange's own vocabulary, so what it shows is the
    // readable label for the value the payload carried rather than the stored value itself.
    const pricingModelLabel = PRICING_MODEL_LABELS[listing.pricing_model];
    await expect(card).toContainText(`Pricing model: ${pricingModelLabel}`);
    await expect(card).toContainText(`License: ${listing.license_code}`);

    if (listing.outcome === null || listing.standard_version_id === null || listing.label === null) {
      await expect(
        card,
        `${LISTINGS_STEP}: a listing with no report should state ${JSON.stringify(NO_REPORT_LABEL)} in place of an outcome, a standard version and a label`,
      ).toContainText(NO_REPORT_LABEL);
    } else {
      await expect(card).toContainText(`Outcome: ${listing.outcome}`);
      await expect(card).toContainText(`Standard version: ${listing.standard_version_id}`);
      await expect(card).toContainText(`Label: ${listing.label}`);
    }
  });

  test("a listing detail page is reached from a result card and sets claims beside measured evidence", async ({
    page,
    request,
  }) => {
    const payload = await readListings(request);
    const listing = firstListing(payload);

    await page.goto(HOME_PATH);
    await clickNavLink(page, "Listings");

    const titleLink = resultCard(page, listing.title).getByRole("link", {
      name: listing.title,
      exact: true,
    });
    await expect(
      titleLink,
      `${LISTING_DETAIL_STEP}: the card for ${JSON.stringify(listing.title)} should link to the listing's own page`,
    ).toBeVisible();
    await expect(
      titleLink,
      `${LISTING_DETAIL_STEP}: the card's title should link to the listing's own route rather than anywhere else`,
    ).toHaveAttribute("href", `${LISTINGS_PATH}/${listing.id}`);
    await titleLink.click();

    await expectPath(page, `${LISTINGS_PATH}/${listing.id}`, LISTING_DETAIL_STEP);
    await expectSingleHeading(page, LISTING_DETAIL_STEP);
    await expectDemoDisclosure(page, LISTING_DETAIL_STEP);
    await expect(
      page.getByRole("heading", { level: 1 }),
      `${LISTING_DETAIL_STEP}: the listing's own title should be the page's one heading`,
    ).toHaveText(listing.title);

    for (const heading of LISTING_DETAIL_SECTIONS) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
        `${LISTING_DETAIL_STEP}: the page should carry the ${JSON.stringify(heading)} section`,
      ).toBeVisible();
    }

    const main = page.getByRole("main");
    await expect(main).toContainText("Claimed");
    await expect(main).toContainText("Measured in the SGI demo");
    await expect(main).toContainText(`License: ${listing.license_code}`);
    await expect(main).toContainText("Pricing model: ");

    const reportLink = main.getByRole("link", { name: REPORT_LINK_PATTERN });
    if (listing.outcome === null) {
      await expect(
        main,
        `${LISTING_DETAIL_STEP}: a listing whose version has no report should say so rather than show an outcome`,
      ).toContainText(NO_REPORT_LABEL);
      await expect(
        reportLink,
        `${LISTING_DETAIL_STEP}: a listing with no report should offer no link to one`,
      ).toHaveCount(0);
    } else {
      await expect(
        reportLink.first(),
        `${LISTING_DETAIL_STEP}: the listing page should link to the report recorded for ${JSON.stringify(listing.title)}`,
      ).toBeVisible();
      const href = await reportLink.first().getAttribute("href");
      expect(
        href,
        `${LISTING_DETAIL_STEP}: the report link should point at the report route, and it points at ${JSON.stringify(href)}`,
      ).toMatch(/^\/reports\/[^/]+$/);
    }
  });

  test("a comparison of two listings is reached from the results and renders them side by side", async ({
    page,
    request,
  }) => {
    const payload = await readListings(request);
    const withReports = listingsWithReport(payload);
    const left = withReports[0];
    const right = withReports[1];
    if (left === undefined || right === undefined) {
      throw new Error(
        "the seed records a report for each of its three fixture candidates, so a comparison of two listings with evidence cannot be assembled: the seed or the evaluation route is broken rather than the route walk",
      );
    }

    await page.goto(HOME_PATH);
    await clickNavLink(page, "Listings");

    for (const listing of [left, right]) {
      const control = page.getByRole("button", {
        name: `${ADD_TO_COMPARE_LABEL}: ${listing.title}`,
      });
      await expect(
        control.first(),
        `${COMPARE_STEP}: the card for ${JSON.stringify(listing.title)} should offer the compare control`,
      ).toBeVisible();
      await control.first().click();
    }

    const openComparison = page.getByRole("link", { name: OPEN_COMPARISON_LABEL });
    await expect(
      openComparison.first(),
      `${COMPARE_STEP}: the cards should offer the link that opens the comparison the reader has selected`,
    ).toBeVisible();
    await openComparison.first().click();

    await expectPath(page, COMPARE_PATH, COMPARE_STEP);
    await expectSingleHeading(page, COMPARE_STEP);
    await expectDemoDisclosure(page, COMPARE_STEP);
    await expect(
      page.getByRole("heading", { name: "Side by side", exact: true }),
      `${COMPARE_STEP}: the comparison should render its own section`,
    ).toBeVisible();

    for (const listing of [left, right]) {
      const column = page.getByRole("region", { name: listing.title });
      await expect(
        column,
        `${COMPARE_STEP}: the comparison should render one column for ${JSON.stringify(listing.title)}, one of the two listings the reader selected`,
      ).toHaveCount(1);
      for (const group of COMPARE_GROUPS) {
        await expect(
          column.getByRole("heading", { name: group, exact: true }),
          `${COMPARE_STEP}: the column for ${JSON.stringify(listing.title)} should carry the ${JSON.stringify(group)} group`,
        ).toBeVisible();
      }
      await expect(column).toContainText("Outcome");
      await expect(column).toContainText(STANDARD_CODE);
      await expect(column).toContainText(listing.license_code);
    }
  });

  test("a report page is reached from its listing and shows the label, the badge and the per-case evidence", async ({
    page,
    request,
  }) => {
    const payload = await readListings(request);
    const fixtureCandidate = firstListingWithLabel(payload, REPORT_LABEL_SAMPLE);
    const listing = fixtureCandidate ?? firstListingWithReport(payload);

    await page.goto(HOME_PATH);
    await clickNavLink(page, "Listings");
    await resultCard(page, listing.title)
      .getByRole("link", { name: listing.title, exact: true })
      .click();
    await expectPath(page, `${LISTINGS_PATH}/${listing.id}`, REPORT_STEP);

    const reportLink = page.getByRole("main").getByRole("link", { name: REPORT_LINK_PATTERN });
    await expect(
      reportLink.first(),
      `${REPORT_STEP}: the listing page for ${JSON.stringify(listing.title)} should link to the report its newest version carries; if it does not, the listing search and the seeded report disagree`,
    ).toBeVisible();

    const href = await reportLink.first().getAttribute("href");
    expect(
      href,
      `${REPORT_STEP}: the report link should point at the report route, and it points at ${JSON.stringify(href)}`,
    ).toMatch(/^\/reports\/[^/]+$/);
    const reportId = decodeURIComponent((href ?? "").slice(REPORTS_PATH_PREFIX.length));
    expect(reportId, `${REPORT_STEP}: the report link should name the report it opens`).not.toBe("");

    await reportLink.first().click();
    await expectPath(page, `${REPORTS_PATH_PREFIX}${reportId}`, REPORT_STEP);
    await expectSingleHeading(page, REPORT_STEP);
    await expectDemoDisclosure(page, REPORT_STEP);

    const report = await readReport(request, reportId);
    expect(
      REPORT_LABELS,
      `the report's label should be one of the two words the vocabulary closes over, and the report states ${JSON.stringify(report.label)}`,
    ).toContain(report.label);
    if (fixtureCandidate !== null) {
      expect(
        report.label,
        `a seeded fixture candidate's report should carry the literal ${REPORT_LABEL_SAMPLE} label, and it states ${JSON.stringify(report.label)}`,
      ).toBe(REPORT_LABEL_SAMPLE);
    }

    const main = page.getByRole("main");
    await expect(main).toContainText(report.label);
    await expect(main).toContainText(report.outcome);
    await expect(main).toContainText(`${report.matched_count} of ${report.total_count}`);
    await expect(main).toContainText(report.standard_version_id);
    await expect(main).toContainText(report.rubric_reference);
    await expect(main).toContainText("Critical cases that failed");

    const badge = page.getByRole("group", { name: BADGE_GROUP_NAME });
    if (report.outcome === "PASS") {
      await expect(badge, `${REPORT_STEP}: a passing report should be issued its badge`).toBeVisible();
      await expect(badge).toContainText(report.label);
      await expect(badge).toContainText(report.standard_version_id);
      await expect(badge).toContainText(BADGE_SCOPE);
      await expect(badge).toContainText(report.id);
    } else {
      await expect(
        badge,
        `${REPORT_STEP}: a report that did not pass carries no badge at all, not a dimmed one`,
      ).toHaveCount(0);
    }

    await expect(
      page.getByRole("heading", { name: "Per-case evidence", exact: true }),
      `${REPORT_STEP}: the report should render its per-case evidence`,
    ).toBeVisible();
    await expect(
      page.getByRole("row"),
      `${REPORT_STEP}: the evidence table should carry a row per fixture case beside its header row`,
    ).toHaveCount(report.case_results.length + 1);
  });

  test("the developer workspace is reached from the navigation for the developer demo account", async ({
    page,
  }) => {
    await page.goto(HOME_PATH);
    await page
      .getByLabel(DEMO_ACCOUNT_CONTROL_LABEL, { exact: true })
      .selectOption({ label: DEMO_DEVELOPER_OPTION_LABEL });
    await clickNavLink(page, "Developer");

    await expectPath(page, DEVELOPER_PATH, DEVELOPER_STEP);
    await expectSingleHeading(page, DEVELOPER_STEP);
    await expectDemoDisclosure(page, DEVELOPER_STEP);
    await expect(
      page.getByRole("heading", { name: "Your listings", exact: true }),
      `${DEVELOPER_STEP}: the workspace should name the listings it shows`,
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Publish a listing", exact: true }),
      `${DEVELOPER_STEP}: the workspace should offer the create-listing affordance`,
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish this listing" }),
      `${DEVELOPER_STEP}: the create form should offer the control that publishes the listing`,
    ).toBeVisible();

    await expect(
      page.getByRole("article").first(),
      `${DEVELOPER_STEP}: the demo developer account owns the seeded listings, so at least one listing row should render for it; if none does, reconcile the selected account against the seed's listings in apps/api/src/seed/seed-data.ts`,
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Version history", exact: true }).first(),
      `${DEVELOPER_STEP}: every listing row should carry its version history`,
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: REPORT_LINK_PATTERN }).first(),
      `${DEVELOPER_STEP}: the seeded listings carry three reports, so at least one report link should render; if none does, the seed's reports and the workspace disagree`,
    ).toBeVisible();
  });

  test("the challenges board is reached from the navigation and shows the seeded board", async ({
    page,
  }) => {
    await page.goto(HOME_PATH);
    await clickNavLink(page, "Challenges");

    await expectPath(page, CHALLENGES_PATH, CHALLENGES_STEP);
    await expectSingleHeading(page, CHALLENGES_STEP);
    await expectDemoDisclosure(page, CHALLENGES_STEP);
    await expect(
      page.getByRole("heading", { name: "Ask a challenge", exact: true }),
      `${CHALLENGES_STEP}: the board should offer the challenge-creation affordance`,
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Post challenge" }),
      `${CHALLENGES_STEP}: the challenge form should offer the control that posts a challenge`,
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "The challenges board" })
        .getByRole("listitem")
        .first(),
      `${CHALLENGES_STEP}: the seed publishes challenges, so at least one row should render on the board`,
    ).toBeVisible();
  });

  test("the discussions board is reached from the navigation and shows the seeded threads", async ({
    page,
  }) => {
    await page.goto(HOME_PATH);
    await clickNavLink(page, "Threads");

    await expectPath(page, THREADS_PATH, THREADS_STEP);
    await expectSingleHeading(page, THREADS_STEP);
    await expectDemoDisclosure(page, THREADS_STEP);
    await expect(
      page.getByRole("heading", { name: "Start a thread", exact: true }),
      `${THREADS_STEP}: the board should offer the thread-creation affordance`,
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start thread" }),
      `${THREADS_STEP}: the thread form should offer the control that starts a thread`,
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "The board" }).getByRole("link").first(),
      `${THREADS_STEP}: the seed publishes threads, so at least one thread should be linked from the board`,
    ).toBeVisible();
  });

  test("the standards page is reached from the navigation and shows the standard with its rubric", async ({
    page,
  }) => {
    await page.goto(HOME_PATH);
    await clickNavLink(page, "Standards");

    await expectPath(page, STANDARDS_PATH, STANDARDS_STEP);
    await expectSingleHeading(page, STANDARDS_STEP);
    await expectDemoDisclosure(page, STANDARDS_STEP);

    const main = page.getByRole("main");
    await expect(
      page.getByRole("heading", { name: `${STANDARD_CODE} — ${STANDARD_TITLE}` }),
      `${STANDARDS_STEP}: the catalogue should list the one standard this release publishes, with its code and its title`,
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "The selected version", exact: true }),
      `${STANDARDS_STEP}: the page should render the version an evaluation is scored against`,
    ).toBeVisible();

    // The versioned criteria: the counts and the pass rule are stated as text, and the thresholds this
    // release publishes are provisional rather than final.
    await expect(main).toContainText("Fixture cases");
    await expect(main).toContainText("Critical cases");
    await expect(main).toContainText("18 of 20");
    await expect(main).toContainText("Provisional");

    // The rubric reference is text and never a link: the service answers with the built application
    // and not with a documentation directory, so a link to it would open the application itself.
    await expect(main).toContainText(RUBRIC_REFERENCE);
    await expect(
      page.getByRole("link", { name: RUBRIC_REFERENCE }),
      `${STANDARDS_STEP}: the rubric reference should be rendered as text, never as a link`,
    ).toHaveCount(0);

    await expect(
      page.getByRole("heading", { name: "Proposals and their review status", exact: true }),
      `${STANDARDS_STEP}: the page should list the proposals made against the standard`,
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Propose a change to ${STANDARD_CODE}`, exact: true }),
      `${STANDARDS_STEP}: the page should offer the proposal affordance`,
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No proposals yet", exact: true }),
      `${STANDARDS_STEP}: the seed publishes no proposal, so the review status this page shows is the empty one; a proposal appearing here means the seed or the loop's run changed`,
    ).toBeVisible();
  });

  test("the Academy is reached from the navigation with its self-assessment", async ({ page }) => {
    await page.goto(HOME_PATH);
    await clickNavLink(page, "Academy");

    await expectPath(page, ACADEMY_PATH, ACADEMY_STEP);
    await expectSingleHeading(page, ACADEMY_STEP);
    await expectDemoDisclosure(page, ACADEMY_STEP);
    await expect(
      page.getByRole("heading", { name: "Check your own readiness", exact: true }),
      `${ACADEMY_STEP}: the page should offer the self-assessment`,
    ).toBeVisible();

    // "Real labels" is asserted as three controls each named by the answer they record, inside a group
    // named by the question it asks.
    const question = page.getByRole("group", { name: ACADEMY_FIRST_QUESTION });
    await expect(
      question,
      `${ACADEMY_STEP}: the assessment should group each question under its own prompt`,
    ).toBeVisible();
    for (const answer of ACADEMY_ANSWERS) {
      await expect(
        question.getByRole("radio", { name: answer, exact: true }),
        `${ACADEMY_STEP}: every question should offer the ${JSON.stringify(answer)} answer`,
      ).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "See my result" }),
      `${ACADEMY_STEP}: the assessment should offer the control that scores the answers locally`,
    ).toBeVisible();
  });

  test("the opportunity index is reached from the navigation and states that it is illustrative", async ({
    page,
  }) => {
    await page.goto(HOME_PATH);
    await clickNavLink(page, "Opportunity index");

    await expectPath(page, OPPORTUNITY_INDEX_PATH, OPPORTUNITY_INDEX_STEP);
    await expectSingleHeading(page, OPPORTUNITY_INDEX_STEP);
    await expectDemoDisclosure(page, OPPORTUNITY_INDEX_STEP);

    const main = page.getByRole("main");
    await expect(
      page.getByRole("table"),
      `${OPPORTUNITY_INDEX_STEP}: the index should render its table of categories`,
    ).toBeVisible();
    await expect(
      page.getByRole("row").first(),
      `${OPPORTUNITY_INDEX_STEP}: the table should carry its rows`,
    ).toBeVisible();

    // The illustrative statement is the page's own labelling requirement, and it is asserted on this
    // render rather than against one fixed sentence.
    await expect(
      main,
      `${OPPORTUNITY_INDEX_STEP}: the page should state on this render that the index is illustrative`,
    ).toContainText(/illustrat/i);
  });

  test("the mission page is reached from the navigation and renders its content", async ({ page }) => {
    await page.goto(HOME_PATH);
    await clickNavLink(page, "Mission");

    await expectPath(page, MISSION_PATH, MISSION_STEP);
    await expectSingleHeading(page, MISSION_STEP);
    await expectDemoDisclosure(page, MISSION_STEP);
    await expect(
      page.getByRole("heading", { name: "What ADEM is", exact: true }),
      `${MISSION_STEP}: the page should render its mission sections`,
    ).toBeVisible();

    const main = page.getByRole("main");
    const rendered = await main.innerText();
    expect(
      rendered.length,
      `${MISSION_STEP}: the mission page's main landmark should hold its content rather than render empty`,
    ).toBeGreaterThan(0);
  });

  test("an unknown listing renders the absent-state page whose link returns to browse", async ({
    page,
  }) => {
    // The one address this file types rather than clicks: no affordance can lead to a path that names
    // nothing, so the absent state cannot be reached by navigation, and the criterion pairs "reached
    // by navigation" with "an unknown listing renders the not-found page" for exactly that reason.
    await page.goto(UNKNOWN_LISTING_PATH);

    await expectPath(page, UNKNOWN_LISTING_PATH, NOT_FOUND_STEP);
    await expectSingleHeading(page, NOT_FOUND_STEP);
    await expectDemoDisclosure(page, NOT_FOUND_STEP);
    await expect(
      page.getByRole("heading", { level: 1 }),
      `${NOT_FOUND_STEP}: the absent state should name what is absent rather than show the listing page's own heading`,
    ).toHaveText("Listing not found");
    await expect(
      page.getByRole("main"),
      `${NOT_FOUND_STEP}: the absent state should explain the address rather than render a failure`,
    ).toContainText("unknown to the exchange, or it has been taken out of public view");

    // The recovery path is a link, so the walk returns to click-only navigation from here.
    await page.getByRole("link", { name: "Browse listings", exact: true }).click();
    await expectPath(page, LISTINGS_PATH, `${NOT_FOUND_STEP}, after clicking its link back to browse`);
  });

  test("every sponsored item renders with its own Sponsored label, after the organic results", async ({
    page,
    request,
  }) => {
    const slots = await readSponsoredSlots(request);
    expect(
      slots.length,
      `${SPONSORED_STEP}: the seed places one sponsored slot per surface, so the public read should return at least one slot; it returned none, which means the seed or the sponsored route is broken`,
    ).toBeGreaterThan(0);

    await page.goto(HOME_PATH);
    await expectDemoDisclosure(page, SPONSORED_STEP);
    await expectSponsoredCollection(
      page,
      slots,
      "home",
      `${SPONSORED_STEP} on the homepage`,
      HOME_RESULTS_REGION_NAME,
    );

    await clickNavLink(page, "Listings");
    await expectPath(page, LISTINGS_PATH, SPONSORED_STEP);
    await expectSponsoredCollection(
      page,
      slots,
      "listings",
      `${SPONSORED_STEP} on the listings page`,
      RESULTS_REGION_NAME,
    );
  });
});

