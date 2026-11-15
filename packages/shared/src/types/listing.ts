/**
 * The listing vocabulary: a category, the listing row with its append-only version
 * history and its claims, and the search, detail and compare payloads the exchange's
 * public reads return.
 *
 * Property names are snake_case throughout, so the database column, the JSON payload and
 * this type share one spelling and no route needs a renaming layer: the columns come from
 * `packages/shared/migrations/0002_listings_and_versions.sql` and the wire names from the
 * `/api/v1` contract.
 *
 * Three shapes here are deliberately narrower than a first sketch would make them.
 * `ListingSearchQuery` declares no field for the page size and `ListingSearchResult`
 * declares none either, because the size is fixed at 20 by `LISTING_PAGE_SIZE` in
 * `../constants` and is not a client input. The report fields of `ListingSummary`,
 * `ListingDetail` and `CompareEntry` are nullable rather than optional, because the
 * payload states an explicit `null` for a version with no report and
 * `exactOptionalPropertyTypes` would admit an explicit `undefined` that a client could not
 * tell from an absent key. And no shape here carries a commercial record of any kind: an
 * advertisement placement is its own labelled collection with its own type in a sibling
 * module, and a listing payload never carries or interleaves one.
 *
 * A report's `outcome`, `standard_version_id` and `label` are provenance and nothing more.
 * They state which criteria measured which version and where the run came from; they are
 * not a claim about safety, about certification, or about a pass that any purchase could
 * obtain, and a version with no report is the `No SGI report yet` state of
 * `../constants` rather than an error.
 *
 * Declarations only: no slug generation, no search predicate, no ordering, no label
 * derivation and no validation of any kind. The routes in `apps/api` own those, and
 * request validation lives in `../schemas/listings-schema.ts`.
 */

import type { OfferModel } from "./commerce";
import type { ReportLabel, ReportOutcome } from "./report";

/**
 * The three states a listing may be in: `active`, `flagged` and `hidden`.
 *
 * It is the `CHECK` constraint on `listings.status` in
 * `packages/shared/migrations/0002_listings_and_versions.sql` and the JSON Schema `enum`
 * the search and moderation contracts validate against, so the stored state, the wire
 * value and this union cannot drift apart. `hidden` is what makes a moderated listing
 * leave search and compare while staying visible to the operator with its history: the
 * listing is not deleted, and no route removes its versions, claims or reports.
 *
 * The set is closed. A fourth state would widen the column's `CHECK`, the schema's `enum`
 * and every state the listings page renders, which is a plan revision rather than an
 * implementation choice.
 */
export const LISTING_STATUSES = ["active", "flagged", "hidden"] as const;

/** One listing state, derived from {@link LISTING_STATUSES} rather than restated. */
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/**
 * The four pricing models a listing may declare: rent, purchase, license and
 * subscription.
 *
 * `OFFER_MODELS` in the sibling `commerce.ts` is a second, identically-shaped tuple with
 * the same members, and the two are deliberately kept separate rather than one
 * re-exported from the other. The plan names both vocabularies — a listing declares the
 * model it prices at, and a checkout selects the offer model a listing makes — and
 * `src/index.ts` re-exports this folder with `export *`, under which one shared identifier
 * would be a duplicate declaration and therefore a compile error rather than a
 * convenience.
 *
 * This tuple is the `CHECK` constraint on `listings.pricing_model` and the `enum` the
 * listing write and search contracts validate against. The set is closed: a fifth model
 * would widen the column, the schema and every price the UI renders.
 */
export const PRICING_MODELS = ["rent", "purchase", "license", "subscription"] as const;

/** One pricing model a listing declares, derived from {@link PRICING_MODELS}. */
export type PricingModel = (typeof PRICING_MODELS)[number];

/**
 * The three orderings a listing search may ask for: `relevance`, `newest` and `outcome`.
 *
 * It is the `enum` of the `sort` query parameter and the vocabulary the ordering behind
 * the listings page implements, so the client and the route cannot disagree about which
 * orderings exist. The set is closed: a fourth ordering is a contract change, not an
 * implementation choice.
 */
export const LISTING_SORTS = ["relevance", "newest", "outcome"] as const;

/** One listing search ordering, derived from {@link LISTING_SORTS}. */
export type ListingSort = (typeof LISTING_SORTS)[number];

/**
 * The ordering a listing search uses when the client sends no `sort`.
 *
 * The plan does not state a default and the contract needs one: the query schema in
 * `../schemas/listings-schema.ts` declares `default: DEFAULT_LISTING_SORT`, and a response
 * whose ordering were undefined when `sort` is absent could neither be reproduced nor
 * asserted. `relevance` is this folder's plan-silent choice for that gap — it is the first
 * member of {@link LISTING_SORTS} and the ordering a search surface is expected to open
 * with — and it is declared here rather than inline in the schema so the default and the
 * union have one definition.
 */
export const DEFAULT_LISTING_SORT: ListingSort = "relevance";

/**
 * The smallest number of identifiers `GET /compare?ids=...` may name.
 *
 * A comparison of one listing is a listing read, so the contract refuses fewer than two
 * with `400`. The two bounds are read together by `COMPARE_IDS_PATTERN` in
 * `../schemas/listings-schema.ts`, which builds the accepted token count from them instead
 * of restating the numbers.
 */
export const COMPARE_MIN_IDS = 2;

/**
 * The largest number of identifiers `GET /compare?ids=...` may name, so a comparison keeps
 * to the columns a side-by-side table can lay out; more than four is the contract's `400`.
 */
export const COMPARE_MAX_IDS = 4;

/**
 * The separator of the compare query's identifier list, as in
 * `GET /compare?ids=a,b,c`.
 *
 * `apps/api/src/routes/compare.ts` splits the parameter on it and the schema's pattern is
 * built from it, so the one spelling of the joined form lives here.
 */
export const COMPARE_ID_SEPARATOR = ",";

/**
 * One row of `categories`: a listing category, used by the listing filter.
 *
 * `slug` is the token a search filter carries and `name` is the value the UI renders; four
 * rows are seeded by `apps/api/src/seed/seed-data.ts`. The set is seed data rather than a
 * closed vocabulary here, because a contributor adds a listing category through the
 * `ListingCategory` extension seam of `@adem/sgi-core` rather than by widening a union in
 * this module.
 */
export interface Category {
  /** Category identifier, referenced by `listings.category_id`. */
  id: string;
  /** Stable URL-safe category token, the value a search filter carries. */
  slug: string;
  /** Display name the UI renders for the category. */
  name: string;
}

/**
 * One row of `listings`: developer-owned content plus the operator's moderation status.
 *
 * This is the one entity in this module that is **mutable**, which is why it carries
 * `updated_at` and why nothing else here does. A developer edits its title, summary,
 * license or pricing model, and an operator moderation action moves its `status`; neither
 * edit touches a version, a claim or a report, all of which are append-only and keep the
 * history they were written with.
 *
 * `slug` and `status` are server-owned rather than client input: a slug is derived when
 * the listing is created rather than chosen by a client, and a new listing is `active`.
 * {@link ListingCreateBody} therefore declares neither field.
 *
 * The slug is deliberately **not** unique across listings, as
 * `packages/shared/migrations/0002_listings_and_versions.sql` states at the column: no route
 * documents a conflict for a repeated slug and a listing is addressed by its id, so two listings
 * may carry the same token and nothing may read it as an identifier.
 *
 * A `hidden` listing leaves search and compare while staying visible to the operator with its
 * history, and a `flagged` listing stays readable with its status stated.
 */
export interface Listing {
  /** Listing identifier, unique across the exchange. */
  id: string;
  /** The developer account that owns the listing, referencing `accounts.id`. */
  developer_account_id: string;
  /** Stable URL-safe token derived server-side at creation; not unique across listings. */
  slug: string;
  /** Listing title, as the developer wrote it. */
  title: string;
  /** One-paragraph summary a search result and a listing page render. */
  summary: string;
  /** The category the listing sits in, referencing `categories.id`. */
  category_id: string;
  /** The license the listing is offered under, e.g. an SPDX-style license code. */
  license_code: string;
  /** The pricing model the listing declares, one of {@link PRICING_MODELS}. */
  pricing_model: PricingModel;
  /** Moderation status, one of {@link LISTING_STATUSES}; a new listing is `active`. */
  status: ListingStatus;
  /** Insert instant as an ISO-8601 UTC string. */
  created_at: string;
  /** Last edit instant as an ISO-8601 UTC string; only this row is mutable. */
  updated_at: string;
}

/**
 * One row of `listing_versions`: a published version of a listing.
 *
 * **The unique `(listing_id, version_string)` pair is what produces the contract's
 * `409`.** The pair is declared by the database constraint in
 * `packages/shared/migrations/0002_listings_and_versions.sql` and surfaced as `409` by
 * `apps/api/src/routes/listings.ts`; a `version_string` pattern in the schema only rejects
 * characters a version cannot hold, and it MUST NOT be grown into a uniqueness rule,
 * because only the stored pair can tell whether this listing has already published this
 * version. A version is never edited either: a developer publishes a new one.
 *
 * **`is_fixture_candidate` is the single input the report label rule reads.**
 * `apps/api/src/seed/seed-data.ts` sets it `true` for the three candidate fixture
 * references and `false` for every version a demo developer publishes through the API, and
 * a report's label follows from that flag and the outcome alone — `SAMPLE` for a fixture
 * candidate on `PASS` and on `FAIL`, `VERIFIED-IN-DEMO` otherwise on `PASS` and on `FAIL`.
 * A seeded result and a developer submission are therefore never conflated, and neither
 * value of the flag is a client input: it is written where the version is written.
 *
 * This member is a boolean while the column behind it is the INTEGER 1 or 0, because a boolean is
 * the type the flag is reasoned about in and the type the plan declares for it. The conversion
 * belongs at the write site and cannot be implicit: better-sqlite3 refuses a JavaScript boolean
 * with "SQLite3 can only bind numbers, strings, bigints, buffers, and null", so a writer binds
 * `is_fixture_candidate ? 1 : 0`, and the version-creation path omits the column so the row takes
 * the DEFAULT 0 that every API-published version carries.
 *
 * The row is append-only by route design — no route updates or deletes a version — so an
 * evaluation always names the version that was measured, and the version list a listing
 * renders is the history of what its developer published.
 */
export interface ListingVersion {
  /** Version identifier, referenced by claims, evaluations and simulated checkouts. */
  id: string;
  /** The listing this version belongs to, referencing `listings.id`. */
  listing_id: string;
  /** Developer-chosen version string, unique within its listing. */
  version_string: string;
  /** Release notes the developer recorded for this version. */
  notes: string;
  /**
   * Whether this seeded version is one of the three candidate fixture references. Read as a
   * boolean; stored and written as the INTEGER 1 or 0 (`flag ? 1 : 0`), because better-sqlite3
   * refuses a JavaScript boolean binding.
   */
  is_fixture_candidate: boolean;
  /** Insert instant as an ISO-8601 UTC string. */
  created_at: string;
}

/**
 * One row of `listing_claims`: what a version asserts about itself, and the limitation the
 * developer states alongside the assertion.
 *
 * This is the claims-versus-evidence content the compare view lays side by side, which is
 * why a claim carries its own `limitation` and `evidence_summary` rather than claim text
 * alone: a reader must be able to see what the developer asserts, what the developer says
 * the assertion does not cover, and what evidence it points at. `evidence_summary` points
 * at evidence and is not itself a measurement — the measurement is the report the
 * listing's latest version carries.
 *
 * A claim is developer-written content attached to a version and may be corrected, unlike
 * the version it is attached to. It holds no report identifier, no amount and no price, so
 * nothing commercial can travel with a claim into the comparison a buyer reads.
 */
export interface ListingClaim {
  /** Claim identifier, unique across the exchange. */
  id: string;
  /** The version the claim is made for, referencing `listing_versions.id`. */
  listing_version_id: string;
  /** What the developer asserts about the version. */
  claim: string;
  /** What the developer states the claim does not cover. */
  limitation: string;
  /** A short pointer to the evidence the claim rests on. */
  evidence_summary: string;
  /** The license the version is offered under, as at the claim's version. */
  license_code: string;
  /** The pricing model the version is offered at, one of {@link PRICING_MODELS}. */
  pricing_model: PricingModel;
}

/**
 * The `POST /listings` body, written by a **developer** holding the demo account header.
 *
 * `slug` and `status` are deliberately absent. A slug is derived server-side when the
 * listing is created, so a client cannot choose a URL token it does not own — and the token is
 * not unique across listings (`packages/shared/migrations/0002_listings_and_versions.sql`), so no
 * reader may treat it as one; a new listing is `active`, so a client cannot place itself in
 * a moderated or already-hidden state. The developer's identity comes from the resolved
 * demo session and never from a body field: a missing or unresolvable `X-Demo-Account`
 * header is `401`, and a resolvable account whose role is not `developer` is `403`.
 */
export interface ListingCreateBody {
  /** Listing title, as the developer writes it. */
  title: string;
  /** One-paragraph summary a search result and a listing page render. */
  summary: string;
  /** The category the listing sits in, referencing `categories.id`. */
  category_id: string;
  /** The license the listing is offered under. */
  license_code: string;
  /** The pricing model the listing declares, one of {@link PRICING_MODELS}. */
  pricing_model: PricingModel;
}

/**
 * The `POST /listings/{id}/versions` body, written by the developer that **owns** the
 * listing.
 *
 * A version string this listing has already published is the contract's `409`, decided by
 * the unique `(listing_id, version_string)` pair and never by a check in a caller; see
 * {@link ListingVersion}. A developer that does not own the listing is `403`, and an
 * unknown listing is `404`.
 *
 * `notes` is optional and typed as an optional property rather than as `string | null`:
 * under `exactOptionalPropertyTypes` an omitted key is the only way to say "nothing
 * recorded here", so a caller cannot pass an explicit `undefined` and cannot write a
 * `null` the row's non-null column would refuse.
 */
export interface ListingVersionCreateBody {
  /** Developer-chosen version string, unique within its listing. */
  version_string: string;
  /** Release notes, omitted when the developer records none. */
  notes?: string;
}

/**
 * One search result: the listing a `GET /listings` page returns.
 *
 * The three report fields — `outcome`, `standard_version_id` and `label` — are **all
 * `null` together** when the listing's latest version has no report, which is the state
 * the listings page renders with the `No SGI report yet` copy of `../constants`; a listing
 * without an evaluation is an ordinary state and never an error. Together they are
 * provenance: the outcome the criteria produced, the standard version that produced it and
 * the label stating where the run came from.
 *
 * `developer_handle` and `category` are resolved values rather than identifiers, which is
 * why a summary carries a whole {@link Category} instead of only `category_id`: a result
 * card renders them directly, and resolving them per card would send every client to the
 * categories and accounts it was already given. `limitation` is the headline limitation of
 * the listing's latest claim, so a buyer sees a caveat in the result list rather than only
 * after opening the listing.
 */
export interface ListingSummary {
  /** Listing identifier. */
  id: string;
  /** The listing's stable URL-safe token derived server-side at creation; not unique across listings. */
  slug: string;
  /** Listing title. */
  title: string;
  /** One-paragraph summary. */
  summary: string;
  /** The owning developer's synthetic account handle. */
  developer_handle: string;
  /** The resolved category the listing sits in. */
  category: Category;
  /** The pricing model the listing declares, one of {@link PRICING_MODELS}. */
  pricing_model: PricingModel;
  /** The license the listing is offered under. */
  license_code: string;
  /** The listing's latest published version string. */
  version_string: string;
  /** The outcome of the latest report for that version, or null when there is none. */
  outcome: ReportOutcome | null;
  /** The standard version that latest report was scored against, or null. */
  standard_version_id: string | null;
  /** `SAMPLE` or `VERIFIED-IN-DEMO` for that latest report, or null when there is none. */
  label: ReportLabel | null;
  /** The headline limitation of the latest claim, or null when none is stated. */
  limitation: string | null;
}

/**
 * The `GET /listings/{id}` response: one listing with everything a buyer reads before
 * comparing or making contact.
 *
 * It carries the listing's version history, its claims with their limitations, the linked
 * evidence — the report identifier, the outcome, the standard version and the label — and
 * the offer models the listing makes. `offer_models` is the listing-level statement of how
 * the listing is offered — the model the listing row declares plus every model its
 * versions claim — and it is what the listing page renders as the listing's offering. A
 * checkout names one version and is priced from that version's own claims, falling back
 * to the listing row's declared model when the version states none.
 *
 * The shape is **flat** rather than nesting the listing under a `listing` member: it
 * extends {@link Listing} and adds the resolved fields, so the detail payload and the
 * search payload of {@link ListingSummary} present their common fields the same way and a
 * page renders either without an unwrapping step.
 *
 * `report_id` names the latest report for the latest version, and is `null` exactly when
 * `outcome`, `standard_version_id` and `label` are, so a reader follows one identifier to
 * the public report rather than inferring which report a summary meant.
 */
export interface ListingDetail extends Listing {
  /** The owning developer's synthetic account handle. */
  developer_handle: string;
  /** The resolved category the listing sits in. */
  category: Category;
  /** The version history, newest first: the most recent page of it, newest first within the page. */
  versions: ListingVersion[];
  /**
   * How many versions the listing has published in all, so a client can tell the page `versions`
   * carries from the whole history. A version is append-only and every publish adds one, so this
   * read is bounded at `COLLECTION_PAGE_SIZE` versions per request rather than growing with the
   * listing: `?page=2` carries the previous page of the history.
   */
  version_total: number;
  /** The claims the versions this payload carries make, each with its stated limitation. */
  claims: ListingClaim[];
  /** The latest report for the latest version, or null when there is none. */
  report_id: string | null;
  /** The outcome of that report, or null. */
  outcome: ReportOutcome | null;
  /** The standard version that report was scored against, or null. */
  standard_version_id: string | null;
  /** `SAMPLE` or `VERIFIED-IN-DEMO` for that report, or null when there is none. */
  label: ReportLabel | null;
  /** The offer models this listing makes, one or more of {@link OfferModel}. */
  offer_models: OfferModel[];
}

/**
 * One column of a comparison: a single listing's claims, its measured evidence, the SGI
 * version, its limitations, its license and its pricing model.
 *
 * `listing_id` and `title` are present so a side-by-side table can label the column it
 * renders; without them a comparison would be a set of anonymous blocks a reader could not
 * attribute. `claims` keeps each claim beside its own limitation, and `limitations`
 * collects the stated limitations so a reader can scan what the listing does not claim.
 *
 * The report fields repeat {@link ListingSummary}'s trio with the same meaning and the
 * same all-or-nothing nullability: they are provenance measured against the listing's
 * latest version, not a claim the listing makes about itself. Nothing here is commercial —
 * a comparison shows the license and the pricing model that describe how a listing is
 * offered, and no amount, offer record or advertisement placement.
 */
export interface CompareEntry {
  /** The listing this column is for. */
  listing_id: string;
  /** The listing's title, used as the column label. */
  title: string;
  /** The claims the listing's versions make, each with its stated limitation. */
  claims: ListingClaim[];
  /** The latest report for the listing's latest version, or null when there is none. */
  report_id: string | null;
  /** The outcome of that report, or null. */
  outcome: ReportOutcome | null;
  /** The standard version that report was scored against, or null. */
  standard_version_id: string | null;
  /** `SAMPLE` or `VERIFIED-IN-DEMO` for that report, or null when there is none. */
  label: ReportLabel | null;
  /** The limitations the listing's claims state, in the order the claims are read. */
  limitations: string[];
  /** The license the listing is offered under. */
  license_code: string;
  /** The pricing model the listing declares, one of {@link PRICING_MODELS}. */
  pricing_model: PricingModel;
}

/**
 * The `GET /compare?ids=a,b,c` response: **one entry per requested identifier, in the
 * order the request named them**, so a table's columns follow the reader's own ordering
 * rather than one the server chose.
 *
 * The list holds between {@link COMPARE_MIN_IDS} and {@link COMPARE_MAX_IDS} entries: the
 * contract refuses fewer than two or more than four identifiers with `400`, and an
 * identifier that names no listing with `404`, so an entry is always a listing that
 * exists.
 */
export interface CompareResult {
  /** One entry per requested identifier, in the requested order. */
  entries: CompareEntry[];
}

/**
 * The parsed `GET /listings` query.
 *
 * Every filter is optional, so an absent filter means "do not narrow on this", and `sort`
 * and `page` are required because the route resolves them: the query schema in
 * `../schemas/listings-schema.ts` applies {@link DEFAULT_LISTING_SORT} and page `1` when
 * the client sends neither, and the route reads the parsed result. The optional filters
 * are typed as optional rather than nullable for the same reason `notes` is — an absent
 * key is the only spelling of "not asked for" — while `sort` and `page` are always
 * resolved before an ordering or an offset is computed.
 *
 * **There is deliberately no page-size field.** The page size is fixed at 20 by
 * `LISTING_PAGE_SIZE` in `../constants` and is not a client input, so neither this query
 * nor {@link ListingSearchResult} may gain a field for it.
 */
export interface ListingSearchQuery {
  /** Free-text query matched against a listing's title and summary. */
  q?: string;
  /** Category slug to narrow to, one of the seeded categories. */
  category?: string;
  /** License code to narrow to. */
  license?: string;
  /** Pricing model to narrow to, one of {@link PRICING_MODELS}. */
  model?: PricingModel;
  /** Standard version identifier to narrow to, as a report states it. */
  standard?: string;
  /** The resolved ordering, defaulting to {@link DEFAULT_LISTING_SORT}. */
  sort: ListingSort;
  /** The resolved 1-based page number, defaulting to the first page. */
  page: number;
}

/**
 * The `GET /listings` response: one page of results, the total the filters matched and the
 * page number those results are.
 *
 * At most 20 items are returned, the fixed page size of `LISTING_PAGE_SIZE` in
 * `../constants`; `total` counts everything the filters matched rather than the page, which
 * is what lets a pager state how many pages remain. **An empty result is `200` with
 * `items: []` and never an error**: no listing matching a search is an ordinary state, and
 * the listings page renders it with the filters that produced it.
 */
export interface ListingSearchResult {
  /** The page's results, at most the fixed page size of 20. */
  items: ListingSummary[];
  /** How many listings the filters matched in total, across every page. */
  total: number;
  /** The 1-based page number these items are. */
  page: number;
}
