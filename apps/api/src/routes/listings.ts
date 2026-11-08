/**
 * The exchange's discovery surface: the four rows of the API contract table that belong to a
 * listing, and the whole of the group's registration.
 *
 * | Method and path                        | Role              | Success | Error cases                        |
 * | -------------------------------------- | ----------------- | ------- | ---------------------------------- |
 * | `GET /listings`                        | public            | `200`   | `400`                              |
 * | `GET /listings/{id}`                   | public            | `200`   | `404`                              |
 * | `POST /listings`                       | developer         | `201`   | `400`, `401`, `403`                |
 * | `POST /listings/{id}/versions`         | owning developer  | `201`   | `400`, `401`, `403`, `404`, `409`  |
 *
 * The two reads are public and resolve no identity, with one exception the detail read carries and
 * the search read does not: a **hidden** listing is returned by `GET /listings/{id}` to an operator
 * and to nobody else, and is excluded from `GET /listings` for every caller including an operator.
 * Moderation removes a listing from browse, so the operator's own read and a later `restore` have to
 * find it, while search is what a buyer browses. Every other status — `active` and `flagged` alike —
 * is readable by anyone.
 *
 * The two writes resolve the demo account `X-Demo-Account` names and require a developer: an absent
 * or unresolvable header is `401`, a resolvable account of another role is `403`, and the version
 * write adds the resource question `requireRole` deliberately does not answer — a developer that
 * does not own the listing is `403` and an unknown listing is `404`. The header is a synthetic role
 * selector and never authentication; the load it carries falls on these checks, on the write rate
 * limit declared from the resolved configuration, and on the visible label the UI renders.
 *
 * **This file is a route module and holds no domain logic** (AAP §0.12.1). It validates against the
 * schemas of `@adem/shared`, reads the tables `apps/api` owns, appends an audit event inside the
 * write's own transaction, and maps results to statuses. It contains no scoring, ledger or policy
 * arithmetic: every outcome, label, count and amount it answers with is read back from a stored row.
 *
 * **Append-only, respected.** No statement here is an `UPDATE`, a `DELETE` or a replace-style upsert,
 * and none names one of the nine append-only tables other than to insert into
 * it. `listing_versions` is the one of those tables this file writes at all, and it is the reason a
 * repeated version string is answered `409` rather than repaired: the unique
 * `(listing_id, version_string)` pair of migration `0002` makes a second row under one listing
 * impossible, and a correction is a new version. No `PUT`, `PATCH` or `DELETE` handler is registered
 * here — Fastify answers an unregistered method and an unregistered path with the one JSON `404`
 * envelope, which is what `apps/api/test/integration/immutability.test.ts` asserts.
 *
 * **Trust separation, by construction.** No query here reads `sponsored_slots`, a ledger entry, a
 * transaction or a fee, no ordering key depends on one, and the payload carries no sponsored item:
 * sponsorship reaches neither the organic order a buyer sees nor a listing's evidence. The orderings
 * are deterministic total orders, each ending in `listings.id`, so two calls answer byte-identical
 * bodies and `apps/api/test/integration/trust-separation.test.ts` — which compares the search payload
 * before and after sponsorship and fee data are varied — holds for a reason rather than by luck.
 *
 * **Determinism, and where the compared payload boundaries are.** Nothing in the two reads reads a
 * clock, a locale or a random source, and no value is normalised, rounded or reformatted on the way
 * out: a summary states the stored report's outcome, standard version label and label exactly as the
 * columns hold them, and a version with no report states `null` in all three rather than an empty
 * string or a substituted word. The `No SGI report yet` copy the listings page renders that state
 * with belongs to `apps/web`, and this file does not invent it.
 *
 * **The evidence read, and the path chosen.** A listing's linked evidence is the newest report for
 * its newest version, and one page of search needs that for up to twenty rows at once. The read is
 * therefore one batched statement — the row source below joins each listing to its newest version and
 * to that version's newest report, and to the standard version the report cites for its label —
 * rather than a per-row loop, which matters because `better-sqlite3`'s API is synchronous on the
 * calling thread. `@adem/sgi-core` exports no reader that lists reports by candidate version (its
 * `getReport` takes a report identifier and `findLatestReportId` takes a candidate version **and** a
 * standard version), so the batched join is the read-only `SELECT` over `evaluation_reports` the plan
 * permits for exactly this case. This file never writes that table: it is one of the nine append-only
 * ones, and the only writer of a report is `@adem/sgi-core`.
 *
 * **Prefix-relative paths.** The two paths below are registered as `/listings` and `/listings/:id`.
 * The versioned prefix is applied once, by `./register-routes`, which calls this function inside its
 * encapsulated scope; the string that names it appears nowhere in this file, because a group that
 * spelled it would be the second place the prefix is decided.
 *
 * **The context type is declared here, structurally.** `RouteContext` is declared once, in the
 * sibling `./register-routes`, which is written last in this folder because it imports all fourteen
 * groups' values. This file spells the two members it reads instead of importing that type, so that
 * this file and the `apps/api` project compile on their own, before `./register-routes` exists — the
 * arrangement the sibling `./ledgers`, `./audit` and `./sponsored` groups already state. A
 * `RouteContext` carrying a `Database` and an `ApiConfig` is assignable to this shape, so the
 * registrar's call site is unaffected, and neither a second types module nor a Fastify decorator is
 * introduced: the database handle arrives by closure from the composition root, as ports and adapters
 * require, and this module opens no connection, reads no environment variable and resolves no path.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type {
  Category,
  Listing,
  ListingClaim,
  ListingCreateBody,
  ListingDetail,
  ListingSearchQuery,
  ListingSearchResult,
  ListingSort,
  ListingStatus,
  ListingSummary,
  ListingVersion,
  ListingVersionCreateBody,
  OfferModel,
  PricingModel,
  ReportLabel,
  ReportOutcome,
} from "@adem/shared";
import {
  DEMO_ACCOUNT_HEADER,
  OFFER_MODELS,
  demoAccountHeaderSchema,
  listingCreateBodySchema,
  listingIdParamsSchema,
  listingSearchQuerySchema,
  listingVersionCreateBodySchema,
} from "@adem/shared";

import { UnknownStandardError, getStandardVersion } from "@adem/sgi-core";

import { appendAuditEvent } from "../audit/append-audit-event";
import { resolveDemoAccount, resolveOptionalDemoAccount } from "../auth/resolve-demo-account";
import { requireRole } from "../auth/require-role";
import type { ApiConfig } from "../config";
import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` these four routes need: the open database handle
 * and the resolved configuration.
 *
 * Both members are read: the handle for every statement below, and the configuration for the fixed
 * page size the search answers with and for the two write rate-limit numbers the write routes
 * declare. Neither is defaulted or restated here — the resolved page size is `LISTING_PAGE_SIZE`'s
 * and the rate-limit pair is `WRITE_RATE_LIMIT_MAX` and `WRITE_RATE_LIMIT_WINDOW`'s, reached through
 * `apps/api/src/config.ts`, which is why raising the limit for a test is a configuration override
 * rather than a change to this file.
 */
interface ListingsRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * One row of the search's row source, as the batched statement below reads it.
 *
 * The report fields are nullable **together**: a listing whose newest version carries no report
 * states `null` in `outcome`, `standard_version_id` and `label` at once, which is the state the
 * listings page renders with the `No SGI report yet` copy of `@adem/shared`. `version_string` is
 * nullable for a listing that has published nothing yet, and `limitation` for a version whose claims
 * state none.
 *
 * `pricing_model`, `outcome` and `label` are typed as the shared closed vocabularies because the
 * migrations declare each of them as a `CHECK`, so the column can hold nothing else. `version_string`
 * is typed as `string | null` rather than as an optional member because the outer join really does
 * produce SQL `NULL` for a listing with no version, which is not the same thing as a column a row
 * chose to omit.
 */
interface ListingPageRow {
  /** `listings.id`. */
  readonly id: string;
  /** The listing's server-derived URL token. */
  readonly slug: string;
  /** Listing title. */
  readonly title: string;
  /** One-paragraph summary. */
  readonly summary: string;
  /** The owning developer's synthetic account handle, joined from `accounts`. */
  readonly developer_handle: string;
  /** `categories.id` of the listing's category. */
  readonly category_id: string;
  /** The category's slug, the value the search's `category` filter carries. */
  readonly category_slug: string;
  /** The category's display name. */
  readonly category_name: string;
  /** The pricing model the listing declares, one of `PRICING_MODELS`. */
  readonly pricing_model: PricingModel;
  /** The license the listing is offered under. */
  readonly license_code: string;
  /** The newest version's string, or `null` when the listing has published no version. */
  readonly version_string: string | null;
  /** The newest report's outcome for that version, or `null` when it carries none. */
  readonly outcome: ReportOutcome | null;
  /** The version label of the standard version that report cites, or `null`. */
  readonly standard_version_id: string | null;
  /** `SAMPLE` or `VERIFIED-IN-DEMO` for that report, or `null`. */
  readonly label: ReportLabel | null;
  /** The headline limitation of the newest version's first claim, or `null`. */
  readonly limitation: string | null;
}

/**
 * The one row the search's `COUNT(*)` answers with: how many listings the filters matched across
 * every page, which is what lets the listings page state how many pages remain.
 */
interface ListingTotalRow {
  /** How many listings the filters matched, counted over the same row source the page is read from. */
  readonly total: number;
}

/**
 * One row of `listings` as the detail read and the version write read it: every column the entity
 * declares, plus the two resolved values a detail payload carries.
 *
 * `status` is read for the moderation check the detail read applies and is otherwise not part of the
 * payload's own spelling of the listing — it is a column of the row, so it travels with the entity.
 */
interface ListingRow {
  /** `listings.id`. */
  readonly id: string;
  /** The developer account that owns the listing. */
  readonly developer_account_id: string;
  /** The listing's server-derived URL token. */
  readonly slug: string;
  /** Listing title, as the developer wrote it. */
  readonly title: string;
  /** One-paragraph summary. */
  readonly summary: string;
  /** The category the listing sits in. */
  readonly category_id: string;
  /** The license the listing is offered under. */
  readonly license_code: string;
  /** The pricing model the listing declares. */
  readonly pricing_model: PricingModel;
  /** The moderation state: `active`, `flagged` or `hidden`. */
  readonly status: ListingStatus;
  /** Insert instant as an ISO-8601 UTC string. */
  readonly created_at: string;
  /** Last edit instant as an ISO-8601 UTC string. */
  readonly updated_at: string;
  /** The owning developer's synthetic account handle. */
  readonly developer_handle: string;
  /** The category's slug. */
  readonly category_slug: string;
  /** The category's display name. */
  readonly category_name: string;
}

/**
 * One row of `listing_versions` as this file reads it. `is_fixture_candidate` is the column's
 * `INTEGER` 0 or 1, which the entity's `boolean` is mapped from at the edge of this file rather than
 * narrowed into the row type: the column holds what the table holds.
 */
interface ListingVersionRow {
  /** Version identifier. */
  readonly id: string;
  /** The listing this version belongs to. */
  readonly listing_id: string;
  /** Developer-chosen version string, unique within its listing. */
  readonly version_string: string;
  /** The release notes the developer recorded. */
  readonly notes: string;
  /** 1 when this version is one of the seeded fixture candidates, 0 otherwise. */
  readonly is_fixture_candidate: number;
  /** Insert instant as an ISO-8601 UTC string. */
  readonly created_at: string;
}

/** One row of `listing_claims`, in the table's own columns. */
interface ListingClaimRow {
  /** Claim identifier. */
  readonly id: string;
  /** The version the claim is made for. */
  readonly listing_version_id: string;
  /** What the developer asserts about the version. */
  readonly claim: string;
  /** What the developer states the claim does not cover. */
  readonly limitation: string;
  /** A short pointer to the evidence the claim rests on. */
  readonly evidence_summary: string;
  /** The license the version is offered under, as claimed for that version. */
  readonly license_code: string;
  /** The pricing model the version is offered at, as claimed for that version. */
  readonly pricing_model: PricingModel;
}

/**
 * The newest report for one candidate version, as the evidence link reads it: the four values a
 * badge and a listing page render, and nothing else.
 *
 * `standard_version_id` is the joined `standard_versions.version_label` rather than the row
 * identifier `evaluation_reports` stores, because the label is the value the contract quotes and the
 * badge names. `case_results` are deliberately not read: they belong to `GET /evaluations/{id}`, and
 * a listing page links to that report rather than reprinting its evidence.
 */
interface LatestReportRow {
  /** Report identifier, so a reader can open the report the listing points at. */
  readonly id: string;
  /** The evaluated version, which is the version the listing's evidence is linked to. */
  readonly candidate_version_id: string;
  /** `PASS` or `FAIL`, as the evaluator derived it. */
  readonly outcome: ReportOutcome;
  /** `SAMPLE` or `VERIFIED-IN-DEMO`. */
  readonly label: ReportLabel;
  /** The contract-facing version label of the standard version the report cites. */
  readonly standard_version_id: string;
}

/**
 * The two columns the version write reads from `listings`: which listing, and who owns it.
 *
 * Deliberately not the whole row: the write's ownership question is answered by the pair, and a
 * hidden listing is not withheld from its own developer here — moderation hides a listing from
 * browse, and it is the operator's record of a visibility decision rather than a withdrawal of the
 * owner's ability to publish a version to it.
 */
interface ListingOwnerRow {
  /** `listings.id`. */
  readonly id: string;
  /** The developer account that owns the listing. */
  readonly developer_account_id: string;
}

/**
 * The row source both search statements are built on: one listing per row, joined to its developer,
 * its category, its newest version, that version's newest report and the standard version that
 * report cites, with the newest claim's limitation read as a scalar subquery.
 *
 * Three things about it are load-bearing rather than stylistic:
 *
 * - **Hidden listings are excluded here, for every caller.** The predicate is part of the row source
 *   so that both the page and the count exclude them, and the detail read — the one route that may
 *   return a hidden listing to an operator — is a separate statement below rather than a variant of
 *   this one.
 * - **Each `LEFT JOIN` names one row.** "The newest version" and "that version's newest report" are
 *   correlated scalar subqueries keyed on the row above them, ordered `created_at DESC, rowid DESC`,
 *   so a tie between two rows written in one millisecond is broken the same way every time and the
 *   join cannot multiply a listing into several rows. `listing_versions` and `evaluation_reports`
 *   are both append-only, so the newest row is the latest published version and the latest report.
 * - **The limitation is the newest version's first claim.** A claim is compared as claimed for its
 *   version, and the headline a result card renders is the first claim written for the version the
 *   listing's evidence is linked to; `rowid ASC` fixes which one that is when a version carries more
 *   than one, because two claims written together carry the same instant.
 *
 * The three columns whose names carry no prefix — `outcome`, `label` and `standard_version_id` — are
 * named as the payload states them, which is what lets the page's projection read straight off this
 * source. The two that would otherwise be ambiguous are suffixed: `listing_created_at` for the
 * listing's own instant, which `newest` orders by, and `report_standard_version_row_id` for the row
 * identifier the `standard` filter resolves a label to.
 */
const LISTING_ROW_SOURCE = `SELECT
    l.id AS id,
    l.slug AS slug,
    l.title AS title,
    l.summary AS summary,
    l.pricing_model AS pricing_model,
    l.license_code AS license_code,
    l.created_at AS listing_created_at,
    a.handle AS developer_handle,
    c.id AS category_id,
    c.slug AS category_slug,
    c.name AS category_name,
    v.version_string AS version_string,
    r.id AS report_id,
    r.outcome AS outcome,
    r.label AS label,
    r.standard_version_id AS report_standard_version_row_id,
    sv.version_label AS standard_version_id,
    (
      SELECT cl.limitation
      FROM listing_claims AS cl
      WHERE cl.listing_version_id = v.id
      ORDER BY cl.rowid ASC
      LIMIT 1
    ) AS limitation
  FROM listings AS l
  JOIN accounts AS a ON a.id = l.developer_account_id
  JOIN categories AS c ON c.id = l.category_id
  LEFT JOIN listing_versions AS v ON v.id = (
    SELECT v2.id
    FROM listing_versions AS v2
    WHERE v2.listing_id = l.id
    ORDER BY v2.created_at DESC, v2.rowid DESC
    LIMIT 1
  )
  LEFT JOIN evaluation_reports AS r ON r.id = (
    SELECT r2.id
    FROM evaluation_reports AS r2
    WHERE r2.candidate_version_id = v.id
    ORDER BY r2.created_at DESC, r2.rowid DESC
    LIMIT 1
  )
  LEFT JOIN standard_versions AS sv ON sv.id = r.standard_version_id
  WHERE l.status <> 'hidden'`;

/**
 * One page of search: the fifteen fields of `ListingSummary`, projected from
 * {@link LISTING_ROW_SOURCE}, filtered and ordered by the clauses composed below.
 *
 * The projection names its columns rather than selecting `*`, so the row type this file maps is the
 * whole of what a page can carry: `listing_created_at`, `report_id` and
 * `report_standard_version_row_id` exist in the source to be ordered and filtered by, and none of
 * them reaches a client.
 */
const SELECT_LISTING_PAGE = `SELECT
    matches.id, matches.slug, matches.title, matches.summary, matches.developer_handle,
    matches.category_id, matches.category_slug, matches.category_name, matches.pricing_model,
    matches.license_code, matches.version_string, matches.outcome, matches.standard_version_id,
    matches.label, matches.limitation
  FROM (${LISTING_ROW_SOURCE}) AS matches`;

/**
 * How many listings the filters matched, counted over the **same** row source the page is read from.
 *
 * One source for both statements is what makes `total` and the page agree: a count taken over a
 * cheaper source would state a number the page could contradict, and the standard filter in
 * particular is a predicate on the joined report rather than on the listing row.
 */
const SELECT_LISTING_TOTAL = `SELECT COUNT(*) AS total FROM (${LISTING_ROW_SOURCE}) AS matches`;

/**
 * One listing by identifier, without the hidden-listing predicate {@link LISTING_ROW_SOURCE}
 * carries: this is the read an operator uses, so the row has to come back for the status check that
 * decides whether anyone else may see it.
 *
 * The developer's handle and the category are joined here rather than resolved per read, and the
 * selected columns are named so a column a later migration adds cannot arrive in a row this file's
 * types do not describe.
 */
const SELECT_LISTING_BY_ID = `SELECT
    l.id, l.developer_account_id, l.slug, l.title, l.summary, l.category_id, l.license_code,
    l.pricing_model, l.status, l.created_at, l.updated_at,
    a.handle AS developer_handle,
    c.slug AS category_slug,
    c.name AS category_name
  FROM listings AS l
  JOIN accounts AS a ON a.id = l.developer_account_id
  JOIN categories AS c ON c.id = l.category_id
  WHERE l.id = ?`;

/**
 * A listing's version history, **newest first**.
 *
 * The order is the one the payload's shape states — `ListingDetail.versions` is "the version history,
 * newest first" — and the one its readers depend on: the listing page and the developer page both
 * take `versions[0]` as the listing's current version, and the detail read's evidence is the report
 * for exactly that version. `created_at DESC, rowid DESC` makes it a total order, so two versions
 * published in one millisecond keep the order they were written in. Nothing is edited: a version is
 * append-only, and the history is what the developer published.
 */
const SELECT_LISTING_VERSIONS = `SELECT
    id, listing_id, version_string, notes, is_fixture_candidate, created_at
  FROM listing_versions
  WHERE listing_id = ?
  ORDER BY created_at DESC, rowid DESC`;

/**
 * The claims of every version of one listing, in the order the claims were written.
 *
 * A claim belongs to a version, so the read reaches the listing through `listing_versions`; `rowid
 * ASC` is publication order and is the only order that can supply it, since two claims written for
 * one version in one transaction carry the same instant.
 */
const SELECT_LISTING_CLAIMS = `SELECT
    cl.id, cl.listing_version_id, cl.claim, cl.limitation, cl.evidence_summary, cl.license_code,
    cl.pricing_model
  FROM listing_claims AS cl
  JOIN listing_versions AS v ON v.id = cl.listing_version_id
  WHERE v.listing_id = ?
  ORDER BY cl.rowid ASC`;

/**
 * The newest report for one candidate version: the four values the evidence link carries.
 *
 * The report's standard version is joined for its label, because the column stores the row
 * identifier while the contract quotes the label — the same join `@adem/sgi-core`'s own report read
 * performs. The order is `created_at DESC, rowid DESC`, so the newest report is the one a retest
 * followed rather than whichever row the engine returned first.
 */
const SELECT_LATEST_REPORT_FOR_VERSION = `SELECT
    r.id, r.candidate_version_id, r.outcome, r.label,
    sv.version_label AS standard_version_id
  FROM evaluation_reports AS r
  JOIN standard_versions AS sv ON sv.id = r.standard_version_id
  WHERE r.candidate_version_id = ?
  ORDER BY r.created_at DESC, r.rowid DESC
  LIMIT 1`;

/** Whether a category exists, by the identifier a listing body names. */
const SELECT_CATEGORY_BY_ID = `SELECT id FROM categories WHERE id = ?`;

/** Whether a category exists, by the slug a search filter names. */
const SELECT_CATEGORY_BY_SLUG = `SELECT id FROM categories WHERE slug = ?`;

/**
 * Whether a listing already carries a slug. A slug is deliberately not unique in the schema and is
 * read as a token rather than as an identifier, so this is a preference for a free token rather than
 * a conflict rule: nothing documents an error for a repeated slug, and nothing here invents one.
 */
const SELECT_LISTING_SLUG = `SELECT 1 AS taken FROM listings WHERE slug = ? LIMIT 1`;

/**
 * Which listing a version path names, and who owns it.
 *
 * The whole of the version write's resource question, and no status predicate: a hidden listing is
 * still its developer's to publish a version to, because moderation decides what browse shows and
 * not who may write. An identifier this answers nothing for is the contract's `404`.
 */
const SELECT_LISTING_OWNER = `SELECT id, developer_account_id FROM listings WHERE id = ?`;

/**
 * The one statement that appends a listing, with every column named in the migration's own order and
 * one bound value each. `status` is a literal `'active'` rather than a parameter — a new listing is
 * active, and moderation is the operator's act through the moderation route, never a body field of
 * this one. `slug` and both instants are written by the route: the slug is derived from the title
 * here, and `created_at` and `updated_at` are ISO-8601 UTC strings the application states, never
 * SQLite's `CURRENT_TIMESTAMP`, whose form this contract does not accept.
 */
const INSERT_LISTING_SQL = `INSERT INTO listings
    (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model,
     status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`;

/**
 * The one statement that appends a version.
 *
 * `is_fixture_candidate` is deliberately **not** among the columns: the seed writes `1` for the three
 * candidate fixture references and every version published through this route takes the column's
 * `DEFAULT 0`. That flag is the single stored input a report's label is derived from — `SAMPLE` when
 * it is set, `VERIFIED-IN-DEMO` when it is not — so binding it here, however obviously, would put the
 * label rule within reach of a request. A version row is append-only, which is why a repeated version
 * string is refused rather than replaced.
 */
const INSERT_LISTING_VERSION_SQL = `INSERT INTO listing_versions
    (id, listing_id, version_string, notes, created_at)
  VALUES (?, ?, ?, ?, ?)`;

/**
 * The three orderings `GET /listings` may answer in, one clause per member of the closed
 * `LISTING_SORTS` vocabulary.
 *
 * Typed as a total `Record` over the union on purpose: a fourth sort would fail the build here until
 * an ordering is stated for it, which is what keeps a `sort` value from reaching the statement with
 * no clause behind it. Every clause ends in `matches.id`, so each is a deterministic total order and
 * two calls answer byte-identical bodies including item order; no clause reads a sponsored slot, a
 * ledger entry or a fee, and none uses a collation other than SQLite's deterministic default.
 *
 * - `relevance` — a listing whose newest version carries a report ranks above one that carries none,
 *   because the exchange's whole claim is that a listing is compared on measured evidence. Within
 *   each group the title and then the identifier decide. It is not a text-similarity score: nothing
 *   in this product computes one, and an ordering that depended on a query's spelling could not be
 *   reproduced by a reader who has only the payload.
 * - `outcome` — a `PASS` before a `FAIL` before no report, then the title and the identifier.
 * - `newest` — the most recently created listing first, the identifier breaking a tie.
 */
const ORDER_BY_LISTING_SORT: Readonly<Record<ListingSort, string>> = Object.freeze({
  relevance:
    "ORDER BY CASE WHEN matches.report_id IS NULL THEN 1 ELSE 0 END ASC, matches.title ASC, matches.id ASC",
  newest: "ORDER BY matches.listing_created_at DESC, matches.id ASC",
  outcome:
    "ORDER BY CASE WHEN matches.outcome = 'PASS' THEN 0 WHEN matches.outcome = 'FAIL' THEN 1 ELSE 2 END ASC, matches.title ASC, matches.id ASC",
});

/**
 * The three resolved columns every listing payload renders as its category.
 *
 * A summary and a detail both carry a whole `Category` rather than only its identifier, because a
 * result card and a listing page render the name and the filter carries the slug: resolving them per
 * card would send every client back to the catalogue it was already given.
 */
interface CategoryColumns {
  /** `categories.id`. */
  readonly category_id: string;
  /** The category's slug. */
  readonly category_slug: string;
  /** The category's display name. */
  readonly category_name: string;
}

/** The resolved developer handle a listing payload carries beside its category. */
interface DeveloperHandleColumn {
  /** The owning developer's synthetic account handle. */
  readonly developer_handle: string;
}

/** The category a payload states, mapped from the three columns of {@link CategoryColumns}. */
function toCategory(row: CategoryColumns): Category {
  return { id: row.category_id, slug: row.category_slug, name: row.category_name };
}

/**
 * One search result, mapped from {@link ListingPageRow} member by member.
 *
 * Nothing is derived and nothing is substituted: the report's three provenance values are handed on
 * exactly as the columns hold them, and `null` means the listing's newest version carries no report —
 * the state a reader renders with the `No SGI report yet` copy rather than an outcome this file
 * invents.
 *
 * **`version_string` is the empty string for a listing that has published no version.** The declared
 * type requires a string, and the row genuinely holds SQL `NULL` in that case; the empty string is
 * the one spelling that keeps the key present for a client that reads it and states no version a
 * listing does not have. A listing with no version is an ordinary state — a developer publishes one,
 * then its first version — and it is a listing a buyer may find, so it is returned rather than
 * filtered out.
 */
function toListingSummary(row: ListingPageRow): ListingSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    developer_handle: row.developer_handle,
    category: toCategory(row),
    pricing_model: row.pricing_model,
    license_code: row.license_code,
    version_string: row.version_string ?? "",
    outcome: row.outcome,
    standard_version_id: row.standard_version_id,
    label: row.label,
    limitation: row.limitation,
  };
}

/** The listing row itself, mapped from {@link ListingRow} member by member and nothing else. */
function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    developer_account_id: row.developer_account_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category_id: row.category_id,
    license_code: row.license_code,
    pricing_model: row.pricing_model,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * One version, mapped from its row. The one conversion is the flag: the column holds the `INTEGER` 0
 * or 1 that `CHECK (is_fixture_candidate IN (0, 1))` confines it to, and the entity declares a
 * `boolean`. `is_fixture_candidate === 1` is the whole of it — the value is read, never derived, so a
 * version a developer published states `false` exactly as it was written.
 */
function toListingVersion(row: ListingVersionRow): ListingVersion {
  return {
    id: row.id,
    listing_id: row.listing_id,
    version_string: row.version_string,
    notes: row.notes,
    is_fixture_candidate: row.is_fixture_candidate === 1,
    created_at: row.created_at,
  };
}

/** One claim, mapped from its row member by member, including the limitation it states. */
function toListingClaim(row: ListingClaimRow): ListingClaim {
  return {
    id: row.id,
    listing_version_id: row.listing_version_id,
    claim: row.claim,
    limitation: row.limitation,
    evidence_summary: row.evidence_summary,
    license_code: row.license_code,
    pricing_model: row.pricing_model,
  };
}

/**
 * The offer models one listing makes, as the checkout panel reads them.
 *
 * This is a read rather than a computation: the four-model vocabulary is `OFFER_MODELS`'s, the order
 * is that vocabulary's order, and membership is decided by what the listing and its claims state
 * about themselves. A model qualifies when the listing row declares it or when any of its versions
 * claims it, because a claim is compared as claimed **for that version** while the listing row
 * declares how the listing as a whole is offered; the union is therefore the whole of what this
 * listing offers, and a model neither the row nor a claim names is absent — which is what makes the
 * checkout contract's `not_offered` refusal reachable rather than dead.
 *
 * Nothing is priced here: `@adem/commerce-sim` owns the offer vocabulary and the amounts, and the
 * checkout route builds the offers a selection narrows from the same claims this read collects.
 */
function offerModelsOf(listingModel: PricingModel, claims: readonly ListingClaimRow[]): OfferModel[] {
  const claimed: readonly PricingModel[] = claims.map((claim: ListingClaimRow): PricingModel => claim.pricing_model);

  return OFFER_MODELS.filter(
    (model: OfferModel): boolean => model === listingModel || claimed.includes(model),
  );
}

/**
 * The LIKE pattern one free-text term is matched with, with LIKE's two wildcards neutralised.
 *
 * A term with content is matched as a substring, which is the two `%` wildcards around it; a term
 * containing `%` or `_` is matched literally instead of widening the search, and the statement pairs
 * this value with `ESCAPE '\'` so the escape this function writes is the escape SQLite reads.
 *
 * A term that is empty or blank is matched **as the string it is** rather than widened to `%%`:
 * `?q=` is then a search for a blank term, and no listing carries a blank title or summary — the
 * write contract requires `minLength: 1` of both — so it answers the contract's empty state, `200`
 * with `items: []` and `total: 0`, rather than quietly returning every listing. The client never
 * produces one: `apps/web/src/api-client.ts` omits a blank filter instead of sending it.
 *
 * Nothing is case-folded here. SQLite's `LIKE` is case-insensitive over ASCII by itself, on every
 * machine and without a locale, and a second fold applied in JavaScript would be a second rule for
 * one comparison.
 */
function listingSearchPattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (character: string): string => `\\${character}`);
  return term.trim().length === 0 ? escaped : `%${escaped}%`;
}

/**
 * The slug a listing's title is published under: the title lower-cased, every run of characters that
 * is not an ASCII letter or digit collapsed to one `-`, and the leading and trailing separators
 * trimmed away.
 *
 * Derived on the server so a client cannot choose a URL token it does not own, and deterministic in
 * two senses: `toLowerCase` is the Unicode-default mapping rather than the locale-sensitive one, so
 * the same title yields the same token on every machine, and the pattern is written as ASCII so no
 * locale can decide whether a character survives it. A title that survives as nothing — one written
 * entirely in punctuation — still has to name a token, and `listing` is the fixed one it takes.
 *
 * The token is deliberately **not** an identifier: `listings.slug` is not unique in the schema, and
 * nothing reads the token back as a key.
 */
function listingSlugBase(title: string): string {
  const token = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return token.length === 0 ? "listing" : token;
}

/**
 * The first free slug in the deterministic series `base`, `base-2`, `base-3`, …
 *
 * Called inside the write's own transaction, so the token it answers with is the token the insert
 * uses: a slug two requests derived together cannot be resolved to the same token by both, because
 * neither sees the other's uncommitted row and the second reads what the first wrote.
 *
 * The suffix is a preference rather than a rule. `listings.slug` carries no `UNIQUE` constraint and
 * no route documents a conflict for a repeated token, so two listings **may** share one; this walk
 * simply prefers a token no listing holds yet, which keeps the exchange's addresses readable without
 * claiming a uniqueness the schema does not have. The loop terminates because the series is
 * unbounded and a database holds finitely many listings.
 */
function freeSlug(database: Database, base: string): string {
  const statement = database.prepare<[string], { readonly taken: number }>(SELECT_LISTING_SLUG);
  let suffix = 1;

  for (;;) {
    const candidate = suffix === 1 ? base : `${base}-${String(suffix)}`;

    if (statement.get(candidate) === undefined) {
      return candidate;
    }

    suffix += 1;
  }
}

/**
 * Whether a failed version insert is the unique `(listing_id, version_string)` pair of migration
 * `0002` — the one conflict this contract answers `409` for.
 *
 * The driver reports a refused statement as a `SqliteError` carrying SQLite's own result-code name
 * in `code`. Both spellings are accepted: a build that reports extended result codes names the pair
 * `SQLITE_CONSTRAINT_UNIQUE`, and a build that reports only the base code names every constraint
 * failure `SQLITE_CONSTRAINT`. The second is safe to accept here because the statement above has
 * exactly one constraint that can fail — the unique pair. Every column it fills is `NOT NULL` and
 * the identifier is a fresh UUID; the version flag it omits takes a valid `DEFAULT`; and its foreign
 * key was already resolved by the route's own read of the listing. A value of another type or a
 * thrown non-object is not a driver failure, and answers `false`.
 *
 * The translation this predicate enables is the whole of the `409`: the driver's own message names
 * the table and the columns and never reaches a client.
 */
function isVersionPairCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code: unknown = (error as { readonly code?: unknown }).code;

  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT";
}


/**
 * The `WHERE` clause one search is narrowed by, with the values bound in the order the clause names
 * them.
 *
 * Every value is a bind parameter and none is ever concatenated into a statement: the clause below
 * carries bind markers only, which is what keeps a query string from being a statement.
 *
 * Two filters are resolved against a catalogue before the clause is built, and a value that names
 * nothing there is refused with `400` `validation_error` rather than answering an empty page. That is
 * the contract's reading of an invalid parameter for this row — a `category` naming no category and a
 * `standard` naming no published standard version are requests the API cannot satisfy, exactly as
 * `?sort=` outside the enum is, whereas a filter that names a real category and matches no listing is
 * the ordinary empty result the page renders. `license` and `model` need no such resolution: the
 * model is the schema's own enum, and a license code is free text — there is no licence catalogue,
 * only the codes listings and claims carry.
 *
 * An absent filter contributes nothing, so the clause is empty when the client narrows nothing and
 * the statement then reads the whole row source. The order of the predicates is fixed — query text,
 * category, license, model, standard — so the same request always composes the same statement.
 *
 * The four filters that match a stored value are compared with `=`, on the row source's own columns:
 * `category_slug` is what the client sends (the page derives its options from the slugs its results
 * carried) and `standard_version` is resolved to the **row identifier** the report's column stores,
 * because two standards may publish one label and the filter names the version, not the word.
 */
interface ListingFilters {
  /** The `WHERE` clause, or the empty string when no filter was given. */
  readonly clause: string;
  /** The values the clause's bind markers are bound to, in the order the clause names them. */
  readonly params: readonly string[];
}

/**
 * The `standard_versions` row a `standard` filter names, or the contract's `400`.
 *
 * The filter carries the contract-facing version label — the value a report's payload states and the
 * value the listings page offers — while `evaluation_reports.standard_version_id` stores the row
 * identifier. `@adem/sgi-core`'s registry is the module that owns the two spellings of a version and
 * the one that turns a label into a row, so the label is handed to it with both of its references,
 * which is how this release's standard is addressed: its `code` and its version `label` are both
 * `SGI-SO-1.0.0`. Reading `standard_versions` here instead would make this file a second owner of
 * that table.
 *
 * Both ways of naming nothing — the registry's own `UnknownStandardError` and its `null` answer —
 * become the same `400`: a filter value that resolves to no published version is a request the API
 * cannot satisfy, and a `404` for a search parameter would describe the wrong thing. Any other
 * refusal the registry raises is a defect in the stored criteria rather than a client error, so it
 * travels on untouched and is answered as the server fault it is.
 */
function standardVersionRowId(database: Database, reference: string): string {
  try {
    const version = getStandardVersion(database, reference, reference);

    if (version !== null) {
      return version.id;
    }
  } catch (error) {
    if (!(error instanceof UnknownStandardError)) {
      throw error;
    }
  }

  throw ApiError.validation("The standard filter names no published standard version.");
}

/**
 * Whether a `category` filter names a category this exchange publishes, or the contract's `400`.
 *
 * The parameter carries the category's **slug**, which is the value the listings page derives from
 * its own results and the value the search schema leaves as free text: a slug that names no category
 * is a filter the API cannot satisfy, and answering an empty page instead would tell a reader the
 * category exists and holds nothing.
 */
function requireKnownCategory(database: Database, slug: string): void {
  const row = database.prepare<[string], { readonly id: string }>(SELECT_CATEGORY_BY_SLUG).get(slug);

  if (row === undefined) {
    throw ApiError.validation("The category filter names no listing category.");
  }
}

/** The clause and the bound values one search's filters compose. */
function listingFilters(database: Database, query: ListingSearchQuery): ListingFilters {
  const predicates: string[] = [];
  const params: string[] = [];

  if (query.q !== undefined) {
    const pattern = listingSearchPattern(query.q);
    predicates.push("(matches.title LIKE ? ESCAPE '\\' OR matches.summary LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  if (query.category !== undefined) {
    requireKnownCategory(database, query.category);
    predicates.push("matches.category_slug = ?");
    params.push(query.category);
  }

  if (query.license !== undefined) {
    predicates.push("matches.license_code = ?");
    params.push(query.license);
  }

  if (query.model !== undefined) {
    predicates.push("matches.pricing_model = ?");
    params.push(query.model);
  }

  if (query.standard !== undefined) {
    predicates.push("matches.report_standard_version_row_id = ?");
    params.push(standardVersionRowId(database, query.standard));
  }

  return {
    clause: predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`,
    params,
  };
}

/**
 * The write rate-limit option both write routes declare, read from the resolved configuration rather
 * than from a literal.
 *
 * The two numbers are `@adem/shared`'s, resolved once by `apps/api/src/config.ts`, and a route that
 * restated them would be a second place the contract's limit is decided — which is also what makes
 * the limit adjustable for a test: a caller that resolves a configuration with a lower bound and
 * raises it for its own suite changes the route's behaviour without editing this file.
 *
 * Only writes carry it. Reads are unlimited, so neither `GET` below declares a rate limit, and the
 * plugin is registered with `global: false` by the composition root precisely so that this option is
 * the whole of the policy.
 */
function writeRateLimitConfig(
  context: ListingsRouteContext,
): { readonly rateLimit: { readonly max: number; readonly timeWindow: string } } {
  return {
    rateLimit: {
      max: context.config.writeRateLimit.max,
      timeWindow: context.config.writeRateLimit.timeWindow,
    },
  };
}

/**
 * The value of the demo-session header as Fastify delivers it: `string | string[] | undefined`, the
 * three shapes `resolveDemoAccount` and `resolveOptionalDemoAccount` both accept.
 *
 * Read through {@link DEMO_ACCOUNT_HEADER}'s lowercased declaration rather than through the mixed-case
 * key, because Fastify lowercases the names it collects: a lookup with the mixed-case spelling
 * returns `undefined` for a header that is present, and the mistake is silent both at compile time
 * and at run time. The header's name has one declaration site in `@adem/shared`, so this expression
 * names it through that site rather than retyping it.
 *
 * The supplied value is never echoed: it reaches the resolver's parameterised lookups and no message,
 * no log and no response.
 */
function demoAccountHeader(request: FastifyRequest): string | string[] | undefined {
  return request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()];
}



/**
 * The four provenance values a listing's evidence link carries, or four `null`s when the version the
 * evidence is linked to carries no report.
 *
 * The four travel together and are `null` together: a listing whose newest version has no report
 * states no outcome, no standard version and no label at once, which is the state the listing page
 * renders with the `No SGI report yet` copy rather than with an outcome substituted for a missing
 * one. They are provenance and nothing more — which criteria measured which version, and where the
 * run came from — and no field here asserts safety, certification or a pass.
 *
 * The badge's scope string is deliberately absent: it is the constant `BADGE_SCOPE` in
 * `@adem/shared`, which the badge component reads for itself, so a payload that carried it would be a
 * second copy of one sentence and a second thing to keep in step.
 */
function evidenceLinkOf(report: LatestReportRow | null): {
  readonly report_id: string | null;
  readonly outcome: ReportOutcome | null;
  readonly standard_version_id: string | null;
  readonly label: ReportLabel | null;
} {
  if (report === null) {
    return { report_id: null, outcome: null, standard_version_id: null, label: null };
  }

  return {
    report_id: report.id,
    outcome: report.outcome,
    standard_version_id: report.standard_version_id,
    label: report.label,
  };
}

/**
 * Registers this group's four routes — the exchange's discovery surface — on the instance it is
 * handed, in the order the contract table names them.
 *
 * | Path                     | Method | Role             | Answer                                        |
 * | `/listings`              | `GET`  | public           | `200` with `items`, `total` and `page`         |
 * | `/listings/:id`          | `GET`  | public           | `200` with the listing, or `404`               |
 * | `/listings`              | `POST` | developer        | `201` with the created listing                 |
 * | `/listings/:id/versions` | `POST` | owning developer | `201` with the created version, or `404`/`409` |
 *
 * The paths are prefix-relative: the versioned prefix is applied exactly once, by
 * `./register-routes`, which calls this function with its encapsulated scope. That literal appears
 * nowhere in this file and must not: a group that spelled it would be the second place the prefix is
 * decided.
 *
 * **What each route refuses, and in which order.** The two reads resolve no identity; the detail read
 * refuses `404` for an unknown listing and, for a hidden one, for every caller but an operator. Each
 * write declares the demo-session header schema, so an absent header is a validation failure at the
 * edge that the server's single error handler answers `401` for this header, and `resolveDemoAccount`
 * answers `401` for a header that names no seeded account. `requireRole` then answers `403` for a
 * resolvable account of another role, and the version write adds the resource questions it
 * deliberately does not answer: `404` for a listing no row carries and `403` for a developer that
 * does not own the one it does. The write rate limit is declared on both, from the resolved
 * configuration, and it runs before any of this. No route registers a `PUT`, a `PATCH` or a
 * `DELETE`: a listing's visibility is the moderation route's and a version is append-only, so a
 * correction to one is a new version.
 *
 * **No failure is caught and re-shaped here, with one exception.** `{ error: { code, message } }`
 * belongs to the server's single error handler, so no handler writes an error body of its own. The
 * exception is the version write's duplicate-version `409`, which is not a refusal any module above
 * raises: it is SQLite's own constraint failure, and {@link isVersionPairCollision} is what turns
 * that one driver failure into the contract's answer while everything else travels on untouched.
 */
export function registerListingsRoutes(app: FastifyInstance, context: ListingsRouteContext): void {
  app.get<{ readonly Querystring: ListingSearchQuery }>(
    "/listings",
    { schema: listingSearchQuerySchema },
    (request, reply) => {
      const { database, config } = context;
      const query: ListingSearchQuery = request.query;
      const filters = listingFilters(database, query);

      // One count over the same row source the page is read from, so `total` and `items` cannot
      // disagree about what the filters matched. The statement always answers exactly one row; a
      // missing one would state no total, which is the empty match set rather than a failure.
      const totalRow = database
        .prepare<unknown[], ListingTotalRow>(`${SELECT_LISTING_TOTAL} ${filters.clause}`)
        .get(...filters.params);
      const total = totalRow === undefined ? 0 : totalRow.total;

      // The only arithmetic in this file, and it is paging rather than a domain value: the offset of
      // the requested page is the fixed page size times the zero-based page number, and the page size
      // is the contract's, resolved once. No count, outcome, label or amount is computed here — those
      // are read back from the columns that hold them.
      const offset = config.pageSize * (query.page - 1);

      // One statement per page and one row per listing: the evidence is joined in rather than read
      // per row, which matters because better-sqlite3's API is synchronous on the calling thread. A
      // page past the last one answers an empty list with the requested page number and the whole
      // matching total, which is an ordinary answer to an ordinary request.
      const rows = database
        .prepare<unknown[], ListingPageRow>(
          `${SELECT_LISTING_PAGE} ${filters.clause} ${ORDER_BY_LISTING_SORT[query.sort]} LIMIT ? OFFSET ?`,
        )
        .all(...filters.params, config.pageSize, offset);

      const result: ListingSearchResult = {
        items: rows.map(toListingSummary),
        total,
        page: query.page,
      };

      return reply.code(200).send(result);
    },
  );

  app.get<{ readonly Params: { readonly id: string } }>(
    "/listings/:id",
    { schema: listingIdParamsSchema },
    (request, reply) => {
      const { database } = context;
      const listingRow = database.prepare<[string], ListingRow>(SELECT_LISTING_BY_ID).get(request.params.id);

      if (listingRow === undefined) {
        throw ApiError.notFound();
      }

      // A hidden listing is removed as far as everyone but the operator is concerned: moderation
      // takes it out of browse, so a public reader is answered the "unknown or removed" `404` while
      // the operator still reads it with the history it keeps, which is what a later `restore` needs.
      // The header is resolved tolerantly here and for no other reason, because a public read may not
      // turn an absent or unresolvable header into a `401`. The role decides between `200` and `404`
      // rather than raising `403`, so `requireRole` is deliberately not called: the listing is
      // concealed from a non-operator, and a concealment is not a role refusal.
      if (listingRow.status === "hidden") {
        const reader = resolveOptionalDemoAccount(database, demoAccountHeader(request));

        if (reader === null || reader.role !== "operator") {
          throw ApiError.notFound();
        }
      }

      const versionRows = database
        .prepare<[string], ListingVersionRow>(SELECT_LISTING_VERSIONS)
        .all(listingRow.id);
      const claimRows = database
        .prepare<[string], ListingClaimRow>(SELECT_LISTING_CLAIMS)
        .all(listingRow.id);

      // The evidence is the report for the listing's **newest** version, which is the version the
      // detail payload's `versions[0]` states and the one a badge beside the listing names. A version
      // with no report leaves the four provenance values `null` and does not make the page a `404`.
      const newestVersion = versionRows[0] ?? null;
      const report =
        newestVersion === null
          ? null
          : (database
              .prepare<[string], LatestReportRow>(SELECT_LATEST_REPORT_FOR_VERSION)
              .get(newestVersion.id) ?? null);

      const detail: ListingDetail = {
        ...toListing(listingRow),
        developer_handle: listingRow.developer_handle,
        category: toCategory(listingRow),
        versions: versionRows.map(toListingVersion),
        claims: claimRows.map(toListingClaim),
        ...evidenceLinkOf(report),
        offer_models: offerModelsOf(listingRow.pricing_model, claimRows),
      };

      return reply.code(200).send(detail);
    },
  );

  app.post<{ readonly Body: ListingCreateBody }>(
    "/listings",
    {
      schema: { ...demoAccountHeaderSchema, ...listingCreateBodySchema },
      config: writeRateLimitConfig(context),
    },
    (request, reply) => {
      const { database } = context;
      const body: ListingCreateBody = request.body;

      // `401` for an absent or unresolvable demo header, `403` for a resolvable account of another
      // role. The developer is the resolved account and never a body field, which is why the write
      // contract's body carries no owner.
      const actor = requireRole(resolveDemoAccount(database, demoAccountHeader(request)), "developer");

      // A category that exists is the one reference this body carries that can be checked: the
      // foreign key would refuse an unknown one a moment later inside the transaction, but this row's
      // answer for it is `400`, and a constraint failure is a server fault. A licence code is free
      // text — the exchange publishes no licence catalogue, only the codes listings and claims carry
      // — and the pricing model is already the schema's enum.
      const category = database
        .prepare<[string], { readonly id: string }>(SELECT_CATEGORY_BY_ID)
        .get(body.category_id);

      if (category === undefined) {
        throw ApiError.validation("The category_id in the request body names no listing category.");
      }

      // The row and the record of it are one act: the insert, the slug walk and the audit append run
      // inside one transaction, so a failure after the insert leaves neither the listing nor its
      // audit row behind. Both instants are ISO-8601 UTC strings the application states and both
      // carry the same value, because a listing has just been written and has not been edited.
      const append = database.transaction((): Listing => {
        const id = randomUUID();
        const now = new Date().toISOString();
        const slug = freeSlug(database, listingSlugBase(body.title));

        database
          .prepare(INSERT_LISTING_SQL)
          .run(
            id,
            actor.id,
            slug,
            body.title,
            body.summary,
            body.category_id,
            body.license_code,
            body.pricing_model,
            now,
            now,
          );

        appendAuditEvent(database, {
          actorAccountId: actor.id,
          action: "listing.created",
          resourceType: "listing",
          resourceId: id,
          statusCode: 201,
        });

        return {
          id,
          developer_account_id: actor.id,
          slug,
          title: body.title,
          summary: body.summary,
          category_id: body.category_id,
          license_code: body.license_code,
          pricing_model: body.pricing_model,
          status: "active",
          created_at: now,
          updated_at: now,
        };
      });

      return reply.code(201).send(append());
    },
  );

  app.post<{ readonly Params: { readonly id: string }; readonly Body: ListingVersionCreateBody }>(
    "/listings/:id/versions",
    {
      schema: { ...demoAccountHeaderSchema, ...listingIdParamsSchema, ...listingVersionCreateBodySchema },
      config: writeRateLimitConfig(context),
    },
    (request, reply) => {
      const { database } = context;
      const body: ListingVersionCreateBody = request.body;

      const actor = requireRole(resolveDemoAccount(database, demoAccountHeader(request)), "developer");

      // The listing question `requireRole` leaves open: an identifier no row carries is `404`, and a
      // listing that exists but belongs to another developer is `403`. A hidden listing is not
      // withheld from its own developer here — moderation hides a listing from browse, and the
      // owner's ability to publish a version to it is not the operator's to withdraw through it.
      const listing = database
        .prepare<[string], ListingOwnerRow>(SELECT_LISTING_OWNER)
        .get(request.params.id);

      if (listing === undefined) {
        throw ApiError.notFound();
      }

      if (listing.developer_account_id !== actor.id) {
        throw ApiError.forbidden();
      }

      const append = database.transaction((): ListingVersion => {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const notes = body.notes ?? "";

        // The version flag is omitted rather than bound, so every version published here takes the
        // column's DEFAULT 0 and no request can put a `1` in the one stored field a report's label
        // reads. See INSERT_LISTING_VERSION_SQL. The notes are the empty string when the body omits
        // them, because the column is NOT NULL and an absent key is how a developer states that
        // nothing was recorded.
        database.prepare(INSERT_LISTING_VERSION_SQL).run(id, listing.id, body.version_string, notes, createdAt);

        appendAuditEvent(database, {
          actorAccountId: actor.id,
          action: "listing.version_created",
          resourceType: "listing_version",
          resourceId: id,
          statusCode: 201,
        });

        return {
          id,
          listing_id: listing.id,
          version_string: body.version_string,
          notes,
          is_fixture_candidate: false,
          created_at: createdAt,
        };
      });

      try {
        return reply.code(201).send(append());
      } catch (error) {
        // The unique `(listing_id, version_string)` pair is this contract's `409`, and the driver's
        // own sentence names the table, the columns and the statement. Both are translated: the
        // client reads a sentence about its request and nothing of the statement reaches it. The
        // failed append was rolled back whole, so the version that already exists is untouched and
        // no audit row records a write that did not happen.
        if (!isVersionPairCollision(error)) {
          throw error;
        }

        throw new ApiError(409, "conflict", "This listing has already published that version string.");
      }
    },
  );
}
