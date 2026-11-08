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
 * **The detail read takes the shared page parameter, and only that.** Its version history is
 * append-only and grows with every published version, so it is one of the bounded collection reads:
 * the route declares {@link collectionPageQuerySchema} beside its parameter schema, its statements
 * answer `COLLECTION_PAGE_SIZE` versions of the page it asked for, and the payload states the
 * history's whole size in `version_total` so a client can read the rest by asking for the next page
 * rather than by receiving the table. A page outside the schema — `?page=0`, `?page=-1`, `?page=abc`
 * — is the `400` the schema validates and the server's single error handler answers, the same
 * invalid-parameter refusal the search row documents; an unexpected key such as `?limit=100` is
 * removed by the validator before this handler runs (Fastify's default `removeAdditional`), so a
 * request cannot raise the bound the page size fixes. There is no page-size input anywhere in the
 * product.
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
  CollectionPageQuery,
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
  COLLECTION_PAGE_SIZE,
  DEMO_ACCOUNT_HEADER,
  OFFER_MODELS,
  collectionPageQuerySchema,
  demoAccountHeaderSchema,
  listingCreateBodySchema,
  listingIdParamsSchema,
  listingSearchQuerySchema,
  listingVersionCreateBodySchema,
} from "@adem/shared";

import { UnknownStandardError, getStandardVersion } from "@adem/sgi-core";

import { appendAuditEvent } from "../audit/append-audit-event";
import { resolveDemoAccount, resolveOptionalDemoAccount } from "../auth/resolve-demo-account";
import { isOperator, requireRole } from "../auth/require-role";
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
  /** How many listings the filters matched, over the same match set the page is read from. */
  readonly total: number;
}

/**
 * The one row the version count answers with: how many versions one listing has published in all,
 * which the detail payload states as `version_total`.
 *
 * The version list cannot answer this for itself: a page holds `COLLECTION_PAGE_SIZE` versions
 * whether the listing holds that many or thousands, so the count beside the page is the only thing
 * that tells a client which page of what it is reading.
 */
interface ListingVersionTotalRow {
  /** How many versions the listing holds, counted over `listing_versions` for that listing. */
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
 * One row of the offer-model read: a pricing model some version's claim of one listing states.
 *
 * Deliberately one column wide. The question that read answers is which models the listing offers,
 * so a claim's identifier, its version and its text are beside the point — and a narrower row is
 * what lets the offers be read over every version of the listing while the payload's own claims stay
 * within its page.
 */
interface ListingClaimModelRow {
  /** A pricing model claimed for some version of the listing, one of `PRICING_MODELS`. */
  readonly pricing_model: PricingModel;
}

/**
 * The newest report for the newest version of one listing, as the evidence link reads it: the four
 * values a badge and a listing page render, and nothing else.
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
 * The row source the count reads in place of {@link LISTING_ROW_SOURCE}: the same match set, carrying
 * only the columns a filter compares.
 *
 * A count answers with a number and never with a row, so the evidence the page's source joins in —
 * the listing's newest version, that version's newest report, the standard version the report cites
 * and the limitation of the newest version's first claim — is read by no predicate here and is
 * therefore not carried. The two sources still match exactly the same listings, which is what keeps
 * `total` and the page in agreement: each of the three joins left out is a `LEFT JOIN` that matches
 * **at most one** row, because `listing_versions` and `evaluation_reports` are reached through a
 * `LIMIT 1` subquery ordered `created_at DESC, rowid DESC` and `standard_versions` is joined on its
 * primary key, so none of them can drop a listing or multiply one. The two `JOIN`s the page carries
 * — `accounts` and `categories` — and the hidden-listing predicate are kept, so the two sources
 * differ only in what they project and in the evidence they join.
 *
 * The columns are the ones the four filters that read the listing row compare: `title` and `summary`
 * for `q`, `category_slug` for `category`, `license_code` for `license` and `pricing_model` for
 * `model`. The fifth filter is the one thing this source cannot answer, which is why
 * {@link LISTING_EVIDENCE_MATCH_SOURCE} exists.
 */
const LISTING_MATCH_SOURCE = `SELECT
    l.title AS title,
    l.summary AS summary,
    c.slug AS category_slug,
    l.license_code AS license_code,
    l.pricing_model AS pricing_model
  FROM listings AS l
  JOIN accounts AS a ON a.id = l.developer_account_id
  JOIN categories AS c ON c.id = l.category_id
  WHERE l.status <> 'hidden'`;

/**
 * The count's row source for the one filter that reads joined evidence: {@link LISTING_MATCH_SOURCE}
 * with the two joins the `standard` predicate compares against.
 *
 * `standard` narrows on the report a listing's evidence is linked to, which the page's source exposes
 * as `report_standard_version_row_id` — the newest report's own `standard_version_id`, the row
 * identifier the filter resolves a version label to. The newest version and its newest report are
 * joined here by the same two `LIMIT 1` subqueries the page uses, so the value compared is the value
 * the page compares; the page's third evidence join, the `standard_versions` join that produces the
 * report's version **label**, is absent because no predicate reads a label. Everything else is
 * {@link LISTING_MATCH_SOURCE}'s, unchanged, so the two count sources match the same listings as the
 * page and as each other.
 */
const LISTING_EVIDENCE_MATCH_SOURCE = `SELECT
    l.title AS title,
    l.summary AS summary,
    c.slug AS category_slug,
    l.license_code AS license_code,
    l.pricing_model AS pricing_model,
    r.standard_version_id AS report_standard_version_row_id
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
  WHERE l.status <> 'hidden'`;

/**
 * The count statement one search composes: how many listings that search's filters matched, over the
 * same match set the page is read from.
 *
 * The source is the one the clause calls for — {@link LISTING_MATCH_SOURCE} for the four filters that
 * read the listing row, {@link LISTING_EVIDENCE_MATCH_SOURCE} once a `standard` filter has
 * contributed its predicate — and {@link ListingFilters.narrowsByStandard} is what decides, so the
 * statement carries the evidence joins exactly when the clause it is composed with reads them and the
 * count never evaluates a correlated lookup its filters do not call for.
 *
 * **Why the count and the page cannot disagree.** The clause is composed once by `listingFilters` and
 * run by both statements, so no filter narrows one of them and not the other; the clause names the
 * same columns of either source (`q` reads `title` and `summary`, `category` reads `category_slug`,
 * `license` reads `license_code`, `model` reads `pricing_model`, and `standard` reads
 * `report_standard_version_row_id`, which only the evidence source carries); and the two sources match
 * the same listings, for the reason {@link LISTING_MATCH_SOURCE} states — every join either source
 * keeps matches at most one row, and the two that are not `LEFT JOIN`s are carried by both statements
 * with the same condition, so a clause over either one selects exactly the listings the other one
 * holds. `total` therefore counts exactly the listings the page's source holds, which is the set
 * `items` is drawn from.
 */
function listingTotalStatement(filters: ListingFilters): string {
  const source = filters.narrowsByStandard ? LISTING_EVIDENCE_MATCH_SOURCE : LISTING_MATCH_SOURCE;

  return `SELECT COUNT(*) AS total FROM (${source}) AS matches ${filters.clause}`;
}

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
 * One page of a listing's version history, **newest first**.
 *
 * The order is the one the payload's shape states — `ListingDetail.versions` is "the most recent page
 * of it, newest first within the page" — and the one its readers depend on: on the first page
 * `versions[0]` is the listing's current version, which the listing page and the developer page both
 * take as the version to open. The evidence the payload links is the report for the listing's newest
 * version, whichever page was asked for, which the statement below resolves for itself.
 * `created_at DESC, rowid DESC` makes it a total order, so two versions published in one millisecond
 * keep the order they were written in — and so that every page is a slice of one order that does not
 * move between requests.
 *
 * **The window is the bound.** `listing_versions` is append-only and grows with every published
 * version, so the read answers the page the request asked for — `COLLECTION_PAGE_SIZE` rows at that
 * page's own offset — rather than the history, and the payload states how many versions exist in all
 * in `version_total` beside it so a client can tell the page from the history and ask for the next
 * one. Nothing is edited: a page is a window over what the developer published.
 */
const SELECT_LISTING_VERSIONS = `SELECT
    id, listing_id, version_string, notes, is_fixture_candidate, created_at
  FROM listing_versions
  WHERE listing_id = ?
  ORDER BY created_at DESC, rowid DESC
  LIMIT ? OFFSET ?`;

/**
 * The claims of **the versions the payload carries** — the same page {@link SELECT_LISTING_VERSIONS}
 * reads — in the order the claims were written.
 *
 * A claim belongs to a version, so the read reaches the listing through `listing_versions`, and the
 * versions are named by a subquery over that page rather than by a bind list of the identifiers the
 * page returned: the statement then carries three bound numbers whatever the listing's size, where a
 * list of version ids would carry one placeholder per row and grow into SQLite's parameter ceiling.
 * `rowid ASC` is publication order and is the only order that can supply it, since two claims written
 * for one version carry the same instant.
 *
 * Both windows must state the same page: the payload promises the claims *of the versions it
 * carries*, and two different windows would break that promise. That is why the offers a listing
 * makes are read separately by {@link SELECT_LISTING_CLAIM_MODELS} — a claim of a version outside
 * this page is outside the payload, and only the offers have to reach past it.
 */
const SELECT_LISTING_CLAIMS = `SELECT
    cl.id, cl.listing_version_id, cl.claim, cl.limitation, cl.evidence_summary, cl.license_code,
    cl.pricing_model
  FROM listing_claims AS cl
  WHERE cl.listing_version_id IN (
    SELECT v.id
    FROM listing_versions AS v
    WHERE v.listing_id = ?
    ORDER BY v.created_at DESC, v.rowid DESC
    LIMIT ? OFFSET ?
  )
  ORDER BY cl.rowid ASC`;

/**
 * How many versions one listing has published **in all**, which the detail payload states as
 * `version_total`.
 *
 * One page of the history cannot state this — a listing with exactly one page looks the same as one
 * with fifty — so the bound the read applies is only honest beside the size of what it bounds. The
 * count is over the same table the page is read from and by the same listing identifier, so the page
 * and the total cannot disagree about which listing they describe, and it always answers exactly one
 * row.
 */
const SELECT_LISTING_VERSION_TOTAL = `SELECT COUNT(*) AS total FROM listing_versions WHERE listing_id = ?`;

/**
 * The distinct pricing models the claims of **every** version of one listing state.
 *
 * Deliberately not windowed while {@link SELECT_LISTING_CLAIMS} is, and the difference is the point:
 * the payload shows the claims of the versions it carries, but the offers a listing makes are a
 * property of the listing rather than of a page of its history. Reading them through the page would
 * drop a selectable offer as soon as the version claiming it fell off the page — the listing page
 * would then show less than the checkout accepts, because the checkout reads the claims of the
 * version a buyer selects rather than this page's.
 *
 * Its result is bounded by the four-model vocabulary and not by the listing: `DISTINCT` over a column
 * the migration's `CHECK` confines to those four values, however many versions and claims the listing
 * holds. Every version's claims are read rather than only the newest version's, because an older
 * version is still selectable at checkout.
 */
const SELECT_LISTING_CLAIM_MODELS = `SELECT DISTINCT cl.pricing_model
  FROM listing_claims AS cl
  JOIN listing_versions AS v ON v.id = cl.listing_version_id
  WHERE v.listing_id = ?`;

/**
 * The newest report for the newest version of one listing: the four values the evidence link
 * carries.
 *
 * The version the evidence is linked to is resolved **inside the statement** rather than taken from
 * the page of the history the request asked for. A listing's evidence is the report for its newest
 * version, and under paging the page's own first row is that version only on the first page: with
 * `?page=2` the first row is an older version, and naming its report would point a reader at the
 * evidence of a superseded version. `created_at DESC, rowid DESC` fixes which version is the newest
 * one when two were published in one millisecond, and a listing with no version at all matches no
 * row.
 *
 * The report's standard version is joined for its label, because the column stores the row
 * identifier while the contract quotes the label — the same join `@adem/sgi-core`'s own report read
 * performs. The order is `created_at DESC, rowid DESC`, so the newest report is the one a retest
 * followed rather than whichever row the engine returned first; a newest version with no report
 * answers nothing, which is the `No SGI report yet` state and never an older version's report.
 */
const SELECT_LATEST_REPORT_FOR_LISTING = `SELECT
    r.id, r.candidate_version_id, r.outcome, r.label,
    sv.version_label AS standard_version_id
  FROM evaluation_reports AS r
  JOIN standard_versions AS sv ON sv.id = r.standard_version_id
  WHERE r.candidate_version_id = (
    SELECT v.id
    FROM listing_versions AS v
    WHERE v.listing_id = ?
    ORDER BY v.created_at DESC, v.rowid DESC
    LIMIT 1
  )
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
 * The offer models one listing makes, which the listing page renders as the listing's offering.
 *
 * This is a read rather than a computation: the four-model vocabulary is `OFFER_MODELS`'s, the order
 * is that vocabulary's order, and membership is decided by what the listing and its claims state
 * about themselves. A model qualifies when the listing row declares it or when any of its versions
 * claims it, because a claim is compared as claimed **for that version** while the listing row
 * declares how the listing as a whole is offered; the union is therefore the whole of what this
 * listing offers, and a model neither the row nor a claim names is absent — which is what makes the
 * checkout contract's `not_offered` refusal reachable rather than dead.
 *
 * The caller hands it {@link SELECT_LISTING_CLAIM_MODELS}'s rows — the models claimed for **every**
 * version of the listing — and not the windowed claim rows the payload carries, so paging the history
 * cannot narrow the offers the listing makes. Those rows carry the model and nothing else, which is
 * the whole of what this decision reads.
 *
 * Nothing is priced here: `@adem/commerce-sim` owns the offer vocabulary and the amounts, and the
 * checkout route builds the offers a selection narrows from the same claims this read collects.
 */
function offerModelsOf(
  listingModel: PricingModel,
  claimModels: readonly ListingClaimModelRow[],
): OfferModel[] {
  const claimed: readonly PricingModel[] = claimModels.map(
    (claim: ListingClaimModelRow): PricingModel => claim.pricing_model,
  );

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
 * each statement then reads its whole row source. The order of the predicates is fixed — query text,
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
  /**
   * Whether the clause reads joined evidence, which is to say whether a `standard` filter contributed
   * its predicate.
   *
   * `true` exactly when {@link ListingFilters.clause} carries
   * `matches.report_standard_version_row_id = ?`: the count reads the newest-version and newest-report
   * joins for that one predicate, and reads neither of them otherwise. It is set here rather than
   * re-derived from the clause text by its reader, so the clause and the source it needs stay one
   * decision made in one place.
   */
  readonly narrowsByStandard: boolean;
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

/** The clause, the bound values and the evidence flag one search's filters compose. */
function listingFilters(database: Database, query: ListingSearchQuery): ListingFilters {
  const predicates: string[] = [];
  const params: string[] = [];
  let narrowsByStandard = false;

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
    narrowsByStandard = true;
  }

  return {
    clause: predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`,
    params,
    narrowsByStandard,
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
 * The first offset SQLite cannot bind: `2 ** 63`, the exclusive upper bound of the offsets a search
 * may read from.
 *
 * A page's offset is the fixed page size times the zero-based page number, and the search binds it as
 * the `OFFSET` of the statement that reads the page. SQLite holds that value as a signed 64-bit
 * integer and better-sqlite3 hands it over as it stands, so an offset outside that range is not
 * clamped: it arrives as the float such a double is, the statement is refused with the driver's own
 * `SqliteError` — `datatype mismatch`, SQLite's `SQLITE_MISMATCH` — and nothing in this file catches
 * it, which is what would answer the client with the server fault of `500`. An offset from `0` below
 * this bound is bound and answers zero rows once it is past the end, which is the empty page the
 * contract documents, so this value is the upper end of the line between a page the store can address
 * and one it cannot.
 *
 * It is `2 ** 63` and not `2 ** 63 - 1`, and the guard below compares with `>=` and not with `>`:
 * JavaScript holds both expressions as the same double, so a bound written as one less would read the
 * same number and would admit the one offset SQLite refuses.
 */
const FIRST_UNBINDABLE_OFFSET = 2 ** 63;

/**
 * The offset one page of search reads from, or this row's `400` when the page asks for one the store
 * cannot address.
 *
 * The offset is the only arithmetic in this file, and it is paging rather than a domain value: the
 * fixed page size times the zero-based page number, from two values the contract and the resolved
 * configuration already hold. No count, outcome, label or amount is computed here — those are read
 * back from the columns that hold them.
 *
 * **Why the page is judged here rather than by the request schema.** `page` is declared an integer of
 * `1` or more with no ceiling, and that is deliberate: a page past the end of a result set is the
 * documented empty result of this row — `200` with `items: []` and the requested page number, which
 * this route must keep answering — so a ceiling in the schema would refuse the ordinary case the
 * contract documents. What the schema cannot express is the refusal this row also documents, the
 * `400` for an invalid parameter, whose sentence has to name the parameter the client sent: a schema
 * rejection is answered with the product's one generic sentence, whatever it refused. The judgement
 * therefore sits with the route's own refusals of a filter it cannot satisfy —
 * {@link requireKnownCategory} and {@link standardVersionRowId} are the other two — and it runs
 * before any statement is composed or run, so a page whose offset the search cannot bind never
 * reaches the driver.
 *
 * **Why the lower end of the bindable range is judged here too.** The schema's `minimum: 1` is applied
 * to the value the validator coerced the query string to, and that coercion admits a page written as a
 * negative power: `?page=-1e309`, and `?page=-Infinity` with it, reaches this function as a page
 * number of `-Infinity` rather than as a refusal. Its offset is the same value, which the driver
 * refuses with exactly the `datatype mismatch` an offset above the 64-bit range produces, so an
 * unaddressable offset can arrive from either end and the route checks the value it actually binds
 * instead of trusting the bound the schema states. The offsets a search binds are therefore the ones
 * from `0` up to and excluding {@link FIRST_UNBINDABLE_OFFSET}. The lower branch below is written as
 * `!(offset >= 0)` and not as a safe-integer test: it is false for `-Infinity` and for `NaN`, which
 * no comparison orders, and true for every offset a page number can reach, while a bound at
 * `Number.MAX_SAFE_INTEGER` would refuse the addressable pages between it and
 * {@link FIRST_UNBINDABLE_OFFSET} — pages whose only answer is the empty page the contract documents.
 *
 * The sentence is one short line, written from the characters the UI's error notice renders, so the
 * reader is told which parameter was the problem instead of the generic explanation.
 *
 * @param pageSize - The fixed page size the search answers with, from the resolved configuration.
 * @param page - The 1-based page number the query named, already coerced by the query schema.
 * @returns The offset the requested page reads from: a non-negative value below
 * {@link FIRST_UNBINDABLE_OFFSET}.
 * @throws ApiError of `400 validation_error` when the offset is not a non-negative number, or is at
 * or above {@link FIRST_UNBINDABLE_OFFSET}.
 */
function pageOffsetOf(pageSize: number, page: number): number {
  const offset = pageSize * (page - 1);

  // The lower end of the range first: this reads an offset that is not a non-negative number — the
  // `-Infinity` a page written as a negative power coerces to, which the schema's `minimum` does not
  // catch, and the `NaN` no comparison orders at all. The driver refuses such an `OFFSET` with the
  // same `datatype mismatch` as one at or above the bound below, so all that reaches the bind site is
  // a value from `0` up to that bound. The upper branch is the range's other end.
  if (!(offset >= 0)) {
    throw ApiError.validation("The page parameter is not a page number this search can read.");
  }

  if (offset >= FIRST_UNBINDABLE_OFFSET) {
    throw ApiError.validation("The page parameter is beyond the last page this search can address.");
  }

  return offset;
}

/**
 * Registers this group's four routes — the exchange's discovery surface — on the instance it is
 * handed, in the order the contract table names them.
 *
 * | Path                     | Method | Role             | Answer                                        |
 * | `/listings`              | `GET`  | public           | `200` with `items`, `total` and `page`         |
 * | `/listings/:id`          | `GET`  | public           | `200` with the listing and one page of its versions, or `404` |
 * | `/listings`              | `POST` | developer        | `201` with the created listing                 |
 * | `/listings/:id/versions` | `POST` | owning developer | `201` with the created version, or `404`/`409` |
 *
 * The paths are prefix-relative: the versioned prefix is applied exactly once, by
 * `./register-routes`, which calls this function with its encapsulated scope. That literal appears
 * nowhere in this file and must not: a group that spelled it would be the second place the prefix is
 * decided.
 *
 * **The detail read's query, and why it is the only one here.** It declares the shared collection page
 * schema beside its parameter schema, so its version history is read one page at a time and the
 * payload states the history's whole size in `version_total`; a `page` outside the schema's bounds is
 * a `400` from the same validation every other row uses, and an unexpected query key is removed by
 * the validator rather than widening the read (Fastify's default `removeAdditional`, and no check of
 * this file's own). There is no page-size input: `COLLECTION_PAGE_SIZE` is `@adem/shared`'s and is not
 * a client's to raise.
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

      // The page is judged before the filters are composed and before any statement is prepared or
      // run: a page whose offset is not a non-negative value the search can bind is this row's `400`,
      // so no catalogue lookup and no read stands behind it.
      const offset = pageOffsetOf(config.pageSize, query.page);

      const filters = listingFilters(database, query);

      // One count over the same match set the page is read from, so `total` and `items` cannot
      // disagree about what the filters matched. The row source carries the evidence joins only when
      // the `standard` filter reads them, which is what keeps the count off the correlated
      // newest-version and newest-report lookups, and off the sorts behind them, when no standard
      // narrows the search. The statement always answers exactly one row; a missing one would state
      // no total, which is the empty match set rather than a failure.
      const totalRow = database
        .prepare<unknown[], ListingTotalRow>(listingTotalStatement(filters))
        .get(...filters.params);
      const total = totalRow === undefined ? 0 : totalRow.total;

      // One statement per page and one row per listing: the evidence is joined in rather than read
      // per row, which matters because better-sqlite3's API is synchronous on the calling thread.
      // Every page the store can address is an ordinary answer to an ordinary request — a page past
      // the last one answers an empty list with the requested page number and the whole matching
      // total — and only a page whose offset is not a non-negative value the store can bind is
      // refused, above, with the `400` this row documents for an invalid parameter.
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

  app.get<{ readonly Params: { readonly id: string }; readonly Querystring: CollectionPageQuery }>(
    "/listings/:id",
    { schema: { ...listingIdParamsSchema, ...collectionPageQuerySchema } },
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
      // rather than raising `403`, so `requireRole` is deliberately not called and the decision is
      // asked through the shared predicate held beside it in `apps/api/src/auth/require-role.ts`: the
      // listing is concealed from a non-operator, and a concealment is not a role refusal.
      if (listingRow.status === "hidden") {
        const reader = resolveOptionalDemoAccount(database, demoAccountHeader(request));

        if (!isOperator(reader)) {
          throw ApiError.notFound();
        }
      }

      // The page's own offset: the fixed collection page size times the zero-based page number. The
      // page size is `@adem/shared`'s and never a client input, so no request can widen the read, and
      // the schema has already resolved `page` to a number at or above `1`.
      const offset = COLLECTION_PAGE_SIZE * (request.query.page - 1);

      // One page of the history, then the claims of exactly the versions that page carries: the two
      // statements are windowed by the same page, which is what the payload promises. Both take three
      // bound numbers however many versions the listing holds, so neither statement grows with it.
      const versionRows = database
        .prepare<[string, number, number], ListingVersionRow>(SELECT_LISTING_VERSIONS)
        .all(listingRow.id, COLLECTION_PAGE_SIZE, offset);
      const claimRows = database
        .prepare<[string, number, number], ListingClaimRow>(SELECT_LISTING_CLAIMS)
        .all(listingRow.id, COLLECTION_PAGE_SIZE, offset);

      // How many versions the listing holds in all: the page cannot state that for itself, so
      // `version_total` is what tells a client which page of what it is reading, and `?page=2` is how
      // it reaches the rest. One count over the same table the page is read from, and it always
      // answers exactly one row; a missing one would state no total, which is the empty history rather
      // than a failure.
      const versionTotalRow = database
        .prepare<[string], ListingVersionTotalRow>(SELECT_LISTING_VERSION_TOTAL)
        .get(listingRow.id);
      const versionTotal = versionTotalRow === undefined ? 0 : versionTotalRow.total;

      // The offers the listing makes are a property of the listing rather than of the page of its
      // history this request asked for, so they are read over every version's claims and not over the
      // window's: a model whose only claim sits on a version this page does not carry is still offered
      // by the checkout, and a page reporting less than the checkout accepts would make the UI refuse
      // a selection the route would have taken. See SELECT_LISTING_CLAIM_MODELS.
      const claimModelRows = database
        .prepare<[string], ListingClaimModelRow>(SELECT_LISTING_CLAIM_MODELS)
        .all(listingRow.id);

      // The evidence is the report for the listing's **newest** version, which the first page's
      // `versions[0]` states and a badge beside the listing names. The statement resolves that version
      // itself rather than taking the page's first row, so a request for an older page of the history
      // still points at the current version's report and never at a superseded version's. A newest
      // version with no report leaves the four provenance values `null` and does not make the page a
      // `404`.
      const report =
        database.prepare<[string], LatestReportRow>(SELECT_LATEST_REPORT_FOR_LISTING).get(listingRow.id) ??
        null;

      const detail: ListingDetail = {
        ...toListing(listingRow),
        developer_handle: listingRow.developer_handle,
        category: toCategory(listingRow),
        versions: versionRows.map(toListingVersion),
        version_total: versionTotal,
        claims: claimRows.map(toListingClaim),
        ...evidenceLinkOf(report),
        offer_models: offerModelsOf(listingRow.pricing_model, claimModelRows),
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
      // listing that exists but belongs to another developer is `403` — with a sentence of its own,
      // because the factory's default would tell a caller whose role is right that its role is wrong.
      // A hidden listing is not withheld from its own developer here — moderation hides a listing
      // from browse, and the owner's ability to publish a version to it is not the operator's to
      // withdraw through it.
      const listing = database
        .prepare<[string], ListingOwnerRow>(SELECT_LISTING_OWNER)
        .get(request.params.id);

      if (listing === undefined) {
        throw ApiError.notFound();
      }

      if (listing.developer_account_id !== actor.id) {
        throw ApiError.forbidden(
          "This listing was published by another developer, so this demo account may not publish a version to it.",
        );
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
