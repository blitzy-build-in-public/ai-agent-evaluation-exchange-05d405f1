/**
 * The illustrative opportunity index's pure derivation, pinned to the rules its module documents.
 *
 * `apps/web` has no DOM test environment — no such package is in the dependency inventory — so
 * a unit test in this workspace asserts values rather than rendered output. Every assertion below
 * is therefore about values: the supply a caller's listings represent, the fictional demand the
 * table contributes, and the integer ratio between the two.
 *
 * Three properties the module's contract turns on are pinned here rather than left to a reader.
 * The derivation is deterministic and independent of the order its arguments arrive in. The ratio
 * rounds down, because the commerce simulation's founder allocation is the half-up rounding point
 * this product documents for a monetary amount and a second one over money would be a second place
 * for a half of a minor unit to be resolved. The Academy's readiness questionnaire at
 * `../components/self-assessment` resolves a half by its own documented half-up rule too, over a
 * percentage rather than an amount, which is why this ratio floors and must keep flooring. And
 * an empty supply is the ordinary `[]` the page explains, not an error.
 *
 * This suite writes no snapshot and no golden file: the unit configuration's snapshot update mode is
 * `none` only under CI, where a baseline missing from the repository fails the run instead of being
 * recorded, and `"new"` otherwise, where a local run would record one.
 *
 * The fixtures are synthetic and inline, and the demand tables the arithmetic is asserted against
 * are written here rather than read from `OPPORTUNITY_DEMAND_TABLE`, so every expected integer
 * follows from a figure the test states and never from data the test cannot reason about. The
 * shipped table is checked separately: for its own shape, and against the seeded category slugs it
 * has to name for the derivation to put any demand in a row at all.
 */

import { describe, expect, it } from "vitest";

import type { ListingSummary } from "@adem/shared";

import { deriveOpportunityIndex, OPPORTUNITY_DEMAND_TABLE } from "./opportunity-index";
import type { DemandEntry, OpportunityRow } from "./opportunity-index";

/**
 * The seeded category slug rule, as the `ListingCategory` extension seam documents it: lowercase
 * letters, digits and single hyphens (`^[a-z][a-z0-9-]{1,31}$`), so a table key is always a slug a
 * listing can actually be grouped by.
 */
const SEEDED_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * The four category slugs the seed publishes, as `SEED_CATEGORIES` in
 * `apps/api/src/seed/seed-data.ts` declares them and as `/api/v1` returns them in
 * `ListingSummary.category.slug`. That file owns the seeded set and is the source of truth for it.
 *
 * The copy is frozen deliberately rather than imported: `apps/web` may not import `@adem/api`, so
 * `@adem/shared`'s types are the whole of this workspace's dependency set and the seeded vocabulary
 * reaches this suite as the constant below, which the seed's own review keeps in step. The shipped
 * demand table is then held to these four slugs, so a seeded category it stops naming — or one the
 * seed gains and neither follows — fails the case below rather than quietly rendering a zero.
 */
const SEEDED_CATEGORY_SLUGS: readonly string[] = Object.freeze([
  "order-intake",
  "depot-routing",
  "record-keeping",
  "notification-drafting",
]);

/**
 * Sorts slugs by code unit, so a slug set compares as a set: the demand table is declared in the
 * seed's own declaration order and no case here asserts anything about that order.
 */
function sortedSlugs(slugs: readonly string[]): string[] {
  return [...slugs].sort();
}

/**
 * One synthetic listing in `categorySlug`, complete against `ListingSummary` so a field this
 * fixture omits or mistypes is a compile error rather than something a cast would hide.
 */
function makeListing(categorySlug: string, listingNumber: number): ListingSummary {
  return {
    id: `listing-${listingNumber}`,
    slug: `synthetic-listing-${listingNumber}`,
    title: `Synthetic listing ${listingNumber}`,
    summary: `A synthetic listing in the ${categorySlug} category.`,
    developer_handle: `demo-developer-${listingNumber}`,
    category: {
      id: `category-${categorySlug}`,
      slug: categorySlug,
      name: `${categorySlug} (synthetic)`,
    },
    pricing_model: "license",
    license_code: "MIT",
    version_string: "1.0.0",
    outcome: null,
    standard_version_id: null,
    label: null,
    limitation: null,
  };
}

/** The derived figures of one row, in the shape an assertion states without indexing a result. */
interface RowFigures {
  readonly category_slug: string;
  readonly supply: number;
  readonly demand: number;
  readonly ratio_basis_points: number;
}

/** Projects rows to their derived figures, in order, so an assertion names every value. */
function figuresOf(rows: readonly OpportunityRow[]): RowFigures[] {
  return rows.map((row) => ({
    category_slug: row.category_slug,
    supply: row.supply,
    demand: row.demand,
    ratio_basis_points: row.ratio_basis_points,
  }));
}

describe("deriveOpportunityIndex", () => {
  it("derives each row's supply, demand and ratio from the arguments alone", () => {
    const listings: readonly ListingSummary[] = [
      makeListing("customer-support", 1),
      makeListing("customer-support", 2),
      makeListing("data-pipelines", 3),
    ];

    // The scale is 10_000 basis points: 9 * 10_000 / 2 = 45_000 and 6 * 10_000 / 1 = 60_000.
    const demandTable: readonly DemandEntry[] = [
      { category_slug: "customer-support", demand: 9 },
      { category_slug: "data-pipelines", demand: 6 },
    ];

    const rows = deriveOpportunityIndex(listings, demandTable);

    expect(figuresOf(rows)).toEqual([
      { category_slug: "data-pipelines", supply: 1, demand: 6, ratio_basis_points: 60_000 },
      { category_slug: "customer-support", supply: 2, demand: 9, ratio_basis_points: 45_000 },
    ]);
    expect(rows.map((row) => row.category_slug)).toEqual(["data-pipelines", "customer-support"]);
  });

  it("returns deeply equal rows for repeated calls with the same arguments", () => {
    const listings: readonly ListingSummary[] = [
      makeListing("customer-support", 1),
      makeListing("logistics-tools", 2),
    ];
    const demandTable: readonly DemandEntry[] = [
      { category_slug: "customer-support", demand: 4 },
      { category_slug: "logistics-tools", demand: 2 },
    ];

    const first = deriveOpportunityIndex(listings, demandTable);
    const second = deriveOpportunityIndex(listings, demandTable);
    const third = deriveOpportunityIndex(listings, demandTable);

    expect(second).toEqual(first);
    expect(third).toEqual(second);
  });

  it("orders categories with an equal ratio by slug, whatever order the arguments arrive in", () => {
    const listings: readonly ListingSummary[] = [
      makeListing("data-pipelines", 1),
      makeListing("customer-support", 2),
      makeListing("customer-support", 3),
    ];
    // 12 * 10_000 / 2 = 60_000 and 6 * 10_000 / 1 = 60_000: the two ratios tie.
    const demandTable: readonly DemandEntry[] = [
      { category_slug: "data-pipelines", demand: 6 },
      { category_slug: "customer-support", demand: 12 },
    ];

    const rows = deriveOpportunityIndex(listings, demandTable);

    expect(rows.map((row) => row.category_slug)).toEqual(["customer-support", "data-pipelines"]);

    const reversed = deriveOpportunityIndex([...listings].reverse(), [...demandTable].reverse());

    expect(reversed).toEqual(rows);
  });

  it("returns an empty row set for an empty supply without throwing", () => {
    const demandTable: readonly DemandEntry[] = [{ category_slug: "customer-support", demand: 9 }];

    expect(() => deriveOpportunityIndex([], demandTable)).not.toThrow();
    expect(deriveOpportunityIndex([], demandTable)).toEqual([]);
  });

  it("marks every derived row illustrative", () => {
    const listings: readonly ListingSummary[] = [
      makeListing("customer-support", 1),
      makeListing("data-pipelines", 2),
      makeListing("document-processing", 3),
    ];
    const demandTable: readonly DemandEntry[] = [
      { category_slug: "customer-support", demand: 9 },
      { category_slug: "data-pipelines", demand: 6 },
    ];

    const rows = deriveOpportunityIndex(listings, demandTable);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.hasOwn(row, "illustrative")).toBe(true);
      expect(row.illustrative).toBe(true);
    }
  });

  it("rounds the ratio down rather than to the nearest half", () => {
    const threeInOneCategory: readonly ListingSummary[] = [
      makeListing("document-processing", 1),
      makeListing("document-processing", 2),
      makeListing("document-processing", 3),
    ];

    // 1 * 10_000 / 3 = 3333.33… and 2 * 10_000 / 3 = 6666.66…; the second is the case a half-up
    // rule would report as 6667, which is why both quotients are asserted.
    const oneUnit: readonly DemandEntry[] = [{ category_slug: "document-processing", demand: 1 }];
    const twoUnits: readonly DemandEntry[] = [{ category_slug: "document-processing", demand: 2 }];

    expect(figuresOf(deriveOpportunityIndex(threeInOneCategory, oneUnit))).toEqual([
      { category_slug: "document-processing", supply: 3, demand: 1, ratio_basis_points: 3333 },
    ]);
    expect(figuresOf(deriveOpportunityIndex(threeInOneCategory, twoUnits))).toEqual([
      { category_slug: "document-processing", supply: 3, demand: 2, ratio_basis_points: 6666 },
    ]);
  });

  it("gives a category the demand table does not name a row with zero demand and zero ratio", () => {
    const listings: readonly ListingSummary[] = [
      makeListing("customer-support", 1),
      makeListing("logistics-tools", 2),
    ];
    const demandTable: readonly DemandEntry[] = [{ category_slug: "customer-support", demand: 9 }];

    const rows = deriveOpportunityIndex(listings, demandTable);

    expect(figuresOf(rows)).toEqual([
      { category_slug: "customer-support", supply: 1, demand: 9, ratio_basis_points: 90_000 },
      { category_slug: "logistics-tools", supply: 1, demand: 0, ratio_basis_points: 0 },
    ]);
  });

  it("leaves both arguments in the order and with the contents its caller passed", () => {
    const listings: ListingSummary[] = [
      makeListing("customer-support", 1),
      makeListing("data-pipelines", 2),
    ];
    const demandTable: DemandEntry[] = [
      { category_slug: "data-pipelines", demand: 6 },
      { category_slug: "customer-support", demand: 12 },
    ];
    const listingsBefore = [...listings];
    const demandBefore = [...demandTable];

    deriveOpportunityIndex(listings, demandTable);

    expect(listings).toEqual(listingsBefore);
    expect(demandTable).toEqual(demandBefore);
    expect(listings.map((listing) => listing.category.slug)).toEqual([
      "customer-support",
      "data-pipelines",
    ]);
    expect(demandTable.map((entry) => entry.category_slug)).toEqual([
      "data-pipelines",
      "customer-support",
    ]);
  });
});

describe("OPPORTUNITY_DEMAND_TABLE", () => {
  it("names each seeded category slug once, with a non-negative integer demand", () => {
    expect(OPPORTUNITY_DEMAND_TABLE.length).toBeGreaterThan(0);

    for (const entry of OPPORTUNITY_DEMAND_TABLE) {
      expect(typeof entry.category_slug).toBe("string");
      expect(entry.category_slug).toMatch(SEEDED_SLUG_PATTERN);
      expect(Number.isInteger(entry.demand)).toBe(true);
      expect(entry.demand).toBeGreaterThanOrEqual(0);
    }

    // A repeated slug would be silently ignored by the first-entry-wins lookup rather than
    // reported, so a duplicate key in the shipped table is a defect worth failing on here.
    const slugs = OPPORTUNITY_DEMAND_TABLE.map((entry) => entry.category_slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("names the four category slugs the seed publishes, and no others", () => {
    const slugs = OPPORTUNITY_DEMAND_TABLE.map((entry) => entry.category_slug);

    // The bound the shape assertions above cannot state: a key that is a well-formed slug of no
    // seeded category satisfies every one of them. Derivation groups each listing by its own
    // `category.slug`, so such a key contributes demand to no row and the index falls back to the
    // visible zero this table exists to keep off the page.
    expect(sortedSlugs(slugs)).toEqual(sortedSlugs(SEEDED_CATEGORY_SLUGS));
  });
});
