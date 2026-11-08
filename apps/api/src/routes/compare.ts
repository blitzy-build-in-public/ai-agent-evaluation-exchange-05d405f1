/**
 * The public `GET /compare?ids=a,b,c` read: two to four listings side by side, each showing what
 * its developer claims beside the evidence that was measured against it.
 *
 * It owns one row of the API contract table — `GET /compare?ids=a,b,c`, role `public`, success `200`
 * with one entry per requested listing in the order the request named them, error cases `400` for a
 * list outside the two-to-four bound and `404` for an identifier that names no listing — and it
 * answers the column payload `apps/web`'s compare page lays out and its comparison table renders.
 *
 * **It reads no identity.** The row is public and the contract lists no `401` and no `403` for it,
 * so this route resolves no demo account and attaches no header schema: an absent `X-Demo-Account`
 * header, a wrong-role one and a garbage one are answered alike, and a client that sends one changes
 * nothing about the comparison it receives. The only failure bodies this file can produce are the
 * `400` and the `404` below, and both are thrown as an `ApiError`, so the server's single error
 * handler renders `{ error: { code, message } }` and no handler-local error body exists to disagree
 * with it.
 *
 * **The bound is the schema's, and it is a patterned string on purpose.** Fastify's query parser
 * hands `?ids=a,b,c` to the validator as the single string `"a,b,c"`, and `compareQuerySchema`
 * validates that string against `COMPARE_IDS_PATTERN`, which admits two to four comma-separated
 * tokens. Declaring `ids` as an array instead would let the validator's `coerceTypes: 'array'` make
 * a one-item array holding `"a,b,c"`, so the bound would never be enforced and this route would
 * receive every identifier the client asked for as one unresolvable token. A list outside the bound
 * is therefore refused by the schema, and the server's handler answers it `400 validation_error`.
 *
 * **The handler owns the one floor the pattern cannot state.** A request may name one listing twice
 * — `?ids=a,a` is two tokens and passes the pattern — and a comparison of one listing is a listing
 * read rather than a comparison. The identifiers are therefore split on the contract's separator,
 * trimmed, and de-duplicated in request order, an identifier repeated being the same listing rather
 * than an unknown one; when fewer than `COMPARE_MIN_IDS` distinct identifiers remain, this file
 * answers the row's own `400`. No other bound is restated here: after validation a list cannot hold
 * more than `COMPARE_MAX_IDS` tokens, so the floor is the only bound left to check.
 *
 * **A listing that is unknown or hidden fails the whole request.** Any requested identifier naming
 * no listing — or one an operator has hidden, because `hide` removes a listing from the public reads
 * while the operator still reads it with its history — answers the row's `404` for the whole
 * request. There is deliberately no partial answer and no null column, which is what lets a reader
 * trust that every column of a comparison was really compared. A `flagged` listing stays comparable:
 * `flag` records a concern about a listing without changing whether it is visible, and only `hidden`
 * leaves the public reads, so the visibility filter here is `status <> 'hidden'`.
 *
 * **The columns follow the request's own order.** One entry per requested identifier, assembled in
 * the order the request named them rather than in the order the database returned rows, so the
 * table's columns are the reader's ordering and two identical requests answer byte-identical bodies.
 *
 * **The measured evidence is the latest report for the listing's latest version, and the four fields
 * that state it are present together or absent together.** `report_id`, `outcome`,
 * `standard_version_id` and `label` are read back and never derived: no outcome, no count and no
 * label is computed anywhere in this file, and a listing whose latest version has never been
 * evaluated states `null` in all four — the ordinary `No SGI report yet` state of the exchange
 * rather than an error. The newest version is the greatest `created_at` with the table's `rowid` as
 * the tie-break, and the newest report for that version is the greatest `created_at` with its own
 * `rowid` as the tie-break, which is the same total order the report repository reads use.
 * `standard_version_id` is the version label a report cites, `SGI-SO-1.0.0`, exactly as the report
 * states it, because the shared wire field is named for the report's reference rather than for the
 * row identifier stored behind it.
 *
 * **The claims are the listing's whole claim set, and the limitations are collected from them.**
 * Every claim of every version the listing published is returned, each with its own stated limitation
 * and the evidence it cites, in the order the claims were written — the same claim set the public
 * listing read returns, so a column built from a listing read and a column built here describe one
 * listing the same way. `limitations` collects each claim's limitation in that order and drops the
 * empty ones, keeping the repeats, because two claims may state the same boundary and the comparison
 * renders each where it belongs.
 *
 * **Three batched reads, and nothing else.** better-sqlite3's API is synchronous on the calling
 * thread, so a query per listing inside a loop would block the process once per row: the listings,
 * their claims and the evidence of each listing's newest version are each read in one statement over
 * every requested identifier, which is the whole of what a comparison costs.
 *
 * **Why the evidence is read here rather than through the report module's reader.** A comparison
 * column shows four provenance values and no per-case evidence, and the four come from one row of
 * `evaluation_reports` joined to the `standard_versions` row it cites — the same join
 * `@adem/sgi-core`'s own report read performs for the version label. That reader answers a whole
 * report, which is the report row plus its twenty `report_case_results` rows carrying two canonical
 * JSON strings apiece: up to eighty rows this payload never shows, read once per column through a
 * function whose export list is fixed and which a batched variant would have to widen. The statement
 * below therefore selects the four values themselves, as the newest-version reads elsewhere in this
 * workspace do, and a column's evidence costs one row of one batched read rather than a read of its
 * own per column.
 *
 * **No badge scope field, deliberately.** `CompareEntry` — the fixed wire type this payload is built
 * as — carries no scope member, and the scope string a badge states belongs to the component that
 * renders a badge; a comparison renders its measured evidence as text and issues no badge in a
 * column at all. Adding one here would invent a wire field no reader asks for.
 *
 * **A sponsorship cannot reach this payload, and no path exists for one.** This file reads
 * `listings`, `listing_versions`, `listing_claims` and, for the evidence a column states,
 * `evaluation_reports` with the `standard_versions` row each report cites. It never names
 * `sponsored_slots`, `ledger_entries`, `transactions` or `refunds`, imports no commerce module, and
 * carries no amount, no fee, no placement and no offer record: varying sponsorship or fee data
 * leaves a comparison byte-identical, and no advertised placement is ever interleaved with a column
 * or ordered against one.
 *
 * **It writes nothing.** It issues a `SELECT` and nothing else: no `INSERT`, `UPDATE` or `DELETE`
 * statement appears in this file, no transaction is opened, no audit event is appended for a read,
 * and no `PUT`, `PATCH` or `DELETE` handler is registered. `evaluation_reports` is one of the nine
 * append-only tables migration 0010 guards with an aborting trigger, and this read is one of the
 * paths that never writes to it: a measurement is read back exactly as it was written, so comparing
 * two listings changes nothing about either of them.
 *
 * **It is deterministic.** No value is derived, rounded, reformatted or defaulted, no clock, locale,
 * timezone, file or random source is read, and every ordering is total because each tie is broken by
 * the table's own `rowid`. Two calls for one comparison therefore answer equal bodies, the order of
 * the claims and the limitations included.
 */

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { COMPARE_ID_SEPARATOR, COMPARE_MAX_IDS, COMPARE_MIN_IDS, compareQuerySchema } from "@adem/shared";
import type {
  CompareEntry,
  CompareResult,
  ListingClaim,
  PricingModel,
  ReportLabel,
  ReportOutcome,
} from "@adem/shared";

import { ApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this read needs: the open database handle, which
 * arrives by closure from the server factory rather than through Fastify plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the member structurally instead of importing that type, so that this file and the
 * `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying a `Database` is assignable to this shape, so the registrar's call site is unaffected.
 * Only the member this route reads is declared — the config is not bound to a name, an unused
 * binding being padding, and this read resolves no page size, no fee and no limit from it. The
 * server passes the handle in, so this module opens no connection, reads no environment variable and
 * resolves no path.
 */
interface CompareRouteContext {
  readonly database: Database;
}

/**
 * The parsed query of `GET /compare`: the one `ids` parameter `compareQuerySchema` requires and
 * validates, read as the joined string the query form carries.
 *
 * The type states what the schema has already proved — a string within the two-to-four token bound —
 * and no other parameter exists, because `additionalProperties: false` removes anything else the
 * client sends rather than rejecting it. The tokens are split here rather than by the validator, as
 * the pattern's own documentation states; see the module header.
 */
interface CompareQuery {
  readonly ids: string;
}

/**
 * One requested listing as the one statement below returns it: the identity and the offer a
 * comparison column shows for a listing, with the category and the owning developer left where they
 * belong, since a comparison labels its columns by the listing's own title.
 *
 * `pricing_model` is typed as the shared closed vocabulary while the column is `TEXT` guarded by a
 * `CHECK`, which is a true statement about what the column holds: the constraint admits only the
 * four models, so a row carrying anything else cannot exist.
 */
interface CompareListingRow {
  readonly id: string;
  readonly title: string;
  readonly license_code: string;
  readonly pricing_model: PricingModel;
}

/**
 * One stored claim as the batched claims read returns it: the seven columns
 * `packages/shared/migrations/0002_listings_and_versions.sql` declares, plus the listing the claim's
 * version belongs to, which the join supplies so the rows can be grouped without a second read.
 *
 * `listing_id` is not a column of `listing_claims` and is not part of the `ListingClaim` a column
 * carries; it is carried on the row so the grouping below needs no map of version to listing.
 */
interface CompareClaimRow {
  readonly id: string;
  readonly listing_id: string;
  readonly listing_version_id: string;
  readonly claim: string;
  readonly limitation: string;
  readonly evidence_summary: string;
  readonly license_code: string;
  readonly pricing_model: PricingModel;
}

/**
 * One row of the newest-report read: the listing, and the four values of the newest report written
 * for that listing's newest version, which are the four fields a comparison column states.
 *
 * The statement returns one row per stored report of the newest version, newest first, and the
 * caller takes the first row it sees for a listing — so this shape carries no timestamp, the order
 * alone deciding which of a listing's reports the row describes. The outcome and the label are read
 * back exactly as stored, and `standard_version_label` is the `standard_versions` label the report
 * cites rather than the row identifier the report's own column holds.
 */
interface LatestReportRow {
  readonly listing_id: string;
  readonly report_id: string;
  readonly outcome: ReportOutcome;
  readonly label: ReportLabel;
  readonly standard_version_label: string;
}

/**
 * The measured evidence of one column: the four report fields a comparison states, taken together.
 *
 * The members are non-nullable because the state they describe is all-or-nothing — a comparison
 * column carries either this record or nothing — and each is a value read back from a stored report:
 * the report's own identifier, the `PASS` or `FAIL` the criteria produced, the version label of the
 * standard it was scored against and the `SAMPLE` or `VERIFIED-IN-DEMO` label that states where the
 * run came from. Nothing here is computed, and no field of a report beyond these four is needed.
 */
interface CompareEvidence {
  readonly report_id: string;
  readonly outcome: ReportOutcome;
  readonly standard_version_id: string;
  readonly label: ReportLabel;
}

/**
 * The bound-parameter list of an `IN` clause: one placeholder per identifier, so the statement text
 * and the values bound to it are built from the same count and cannot drift apart.
 *
 * Written as `Array.from` rather than by filling a sparse array, so the result is a plain
 * `string[]`; `noUncheckedIndexedAccess` is on in `tsconfig.base.json`, and nothing here reads an
 * element by index.
 */
function placeholdersFor(identifierCount: number): string {
  return Array.from({ length: identifierCount }, (): string => "?").join(", ");
}

/**
 * The one statement that resolves the requested listings, as the statement text for a given number
 * of bound identifiers.
 *
 * It reads each identifier by primary key — the read path migration `0011_indexes.sql` documents for
 * this row — and excludes a `hidden` listing, which has left the public reads, while `flagged`
 * listings stay comparable and `active` ones are the ordinary case. Selecting the four columns a
 * column of the comparison shows keeps a row the shape {@link CompareListingRow} describes and
 * leaves the summary, the category and the owning developer where a listing read carries them.
 */
function listingsStatement(identifierCount: number): string {
  return `SELECT l.id, l.title, l.license_code, l.pricing_model
FROM listings AS l
WHERE l.id IN (${placeholdersFor(identifierCount)})
  AND l.status <> 'hidden'`;
}

/**
 * The one statement that reads the requested listings' claims, as the statement text for a given
 * number of bound identifiers.
 *
 * The join reaches each listing's versions and takes every claim those versions make, so one
 * statement answers the whole comparison instead of one per column. `listing_id` comes from the
 * version the claim belongs to, which is what lets the caller group the rows by listing, and the
 * order is the claims' own insertion order: `listing_claims` carries no timestamp, its `rowid` is
 * the order the claims were written in, and an order no clock can influence is the only one two
 * runs agree on.
 */
function claimsStatement(identifierCount: number): string {
  return `SELECT c.id, v.listing_id AS listing_id, c.listing_version_id, c.claim, c.limitation,
       c.evidence_summary, c.license_code, c.pricing_model
FROM listing_claims AS c
JOIN listing_versions AS v ON v.id = c.listing_version_id
WHERE v.listing_id IN (${placeholdersFor(identifierCount)})
ORDER BY c.rowid ASC`;
}

/**
 * The one statement that answers the measured evidence of each requested listing's newest version,
 * as the statement text for a given number of bound identifiers.
 *
 * Two scopes are applied, and both are the contract's. The version scope is the listing's **newest**
 * version: the subquery takes the greatest `created_at` for that listing with `rowid` as the
 * tie-break, so a version published in the same millisecond as another is still ordered, and a
 * listing whose newest version has no report contributes no row at all and states no evidence rather
 * than reporting an older version's. The report scope is the newest report written for that version,
 * ordered by `created_at` with `rowid` breaking the tie a fast retest produces.
 *
 * The five columns selected are the whole of what a comparison column shows: which listing the row
 * describes, the report's identifier, the `PASS` or `FAIL` the criteria produced, the `SAMPLE` or
 * `VERIFIED-IN-DEMO` label stating where the run came from, and the version label of the standard it
 * was scored against — joined from `standard_versions`, because the report stores that table's row
 * identifier while the wire field quotes the label. Nothing else of a report is read: the per-case
 * evidence a column does not show is never selected, so one row here answers a column rather than
 * one read per column; see the module header on why this file reads the four values itself.
 */
function latestReportStatement(identifierCount: number): string {
  return `SELECT v.listing_id AS listing_id, r.id AS report_id, r.outcome, r.label,
       sv.version_label AS standard_version_label
FROM listing_versions AS v
JOIN evaluation_reports AS r ON r.candidate_version_id = v.id
JOIN standard_versions AS sv ON sv.id = r.standard_version_id
WHERE v.listing_id IN (${placeholdersFor(identifierCount)})
  AND v.rowid = (
    SELECT newest.rowid
    FROM listing_versions AS newest
    WHERE newest.listing_id = v.listing_id
    ORDER BY newest.created_at DESC, newest.rowid DESC
    LIMIT 1
  )
ORDER BY r.created_at DESC, r.rowid DESC`;
}

/**
 * The distinct identifiers a comparison names, in the order the request named them: the validated
 * `ids` string split on `COMPARE_ID_SEPARATOR`, each token trimmed, blank tokens dropped and repeats
 * removed.
 *
 * Trimming is what makes an address that spaced its separators mean what it plainly means, and
 * dropping a blank token keeps a stray separator from reaching a lookup that could only fail. A
 * repeated identifier is the same listing, not a second one and never an unknown one, which is why
 * the repeats are removed before the floor below is applied rather than after.
 *
 * Refuses with the row's `400` when fewer than `COMPARE_MIN_IDS` distinct identifiers remain, which
 * is the one bound the query schema cannot state: it counts the tokens a client sent, and a
 * comparison of one listing — including `?ids=a,a` — is a listing read rather than a comparison. The
 * sentence names the bound and the number of listings the request resolved to, and echoes no
 * identifier.
 */
function comparableIdentifiers(ids: string): string[] {
  const identifiers: string[] = [];
  for (const token of ids.split(COMPARE_ID_SEPARATOR)) {
    const identifier = token.trim();
    if (identifier !== "" && !identifiers.includes(identifier)) {
      identifiers.push(identifier);
    }
  }

  if (identifiers.length < COMPARE_MIN_IDS) {
    throw ApiError.validation(
      `A comparison shows between ${COMPARE_MIN_IDS} and ${COMPARE_MAX_IDS} listings, and this request names ${identifiers.length}.`,
    );
  }

  return identifiers;
}

/**
 * One stored claim as the claim a comparison column carries: the fields of `ListingClaim`, mapped
 * member by member so the correspondence is readable in one place.
 *
 * The `listing_id` the join supplied stays on the row rather than on the claim, because it is not a
 * property of a claim. Nothing else is renamed, reformatted or defaulted: the claim's text, the
 * limitation its developer stated for it, the evidence it cites, the license and the pricing model
 * are returned as the columns hold them, and the version a claim belongs to travels with it.
 */
function toListingClaim(row: CompareClaimRow): ListingClaim {
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
 * The claims of the requested listings, grouped by the listing each belongs to and kept in the order
 * the batched read returned them — the order the claims were written in, which the statement fixes
 * and nothing here re-sorts.
 *
 * A listing whose versions state no claim is absent from the map rather than present with an empty
 * list; the assembly below reads an absent entry as the empty claim list a column carries, so an
 * unevaluated and an unclaimed listing are both explained by the comparison rather than refused.
 */
function claimsByListing(rows: readonly CompareClaimRow[]): Map<string, ListingClaim[]> {
  const claims = new Map<string, ListingClaim[]>();
  for (const row of rows) {
    const existing = claims.get(row.listing_id);
    if (existing === undefined) {
      claims.set(row.listing_id, [toListingClaim(row)]);
    } else {
      existing.push(toListingClaim(row));
    }
  }
  return claims;
}

/**
 * The measured evidence each listing states, keyed by the listing: the report its newest version
 * carries, as the four fields a comparison column shows.
 *
 * The rows arrive newest report first, so the first row seen for a listing is that listing's newest
 * report for its newest version and every later row for the same listing is an older report the
 * comparison does not show; one pass builds the whole map and no row is read twice. A listing whose
 * newest version has never been evaluated appears in no row, and therefore in no entry of the map,
 * which is how the assembly below knows that column states no evidence at all.
 */
function latestEvidenceByListing(rows: readonly LatestReportRow[]): Map<string, CompareEvidence> {
  const evidence = new Map<string, CompareEvidence>();
  for (const row of rows) {
    if (!evidence.has(row.listing_id)) {
      evidence.set(row.listing_id, {
        report_id: row.report_id,
        outcome: row.outcome,
        standard_version_id: row.standard_version_label,
        label: row.label,
      });
    }
  }
  return evidence;
}

/**
 * The limitations a listing's claims state, in the order the claims are read, with a claim that
 * states none contributing nothing.
 *
 * The repeats are kept rather than collapsed: two claims may state the same boundary, and the
 * comparison renders each limitation where its own claim is. This is the same collection a column
 * built from the public listing read performs, so both describe one listing identically.
 */
function statedLimitations(claims: readonly ListingClaim[]): string[] {
  return claims
    .map((claim: ListingClaim): string => claim.limitation)
    .filter((limitation: string): boolean => limitation.trim() !== "");
}

/**
 * One column per requested identifier, in the order the request named them.
 *
 * Three batched reads answer the whole comparison — the listings, their claims and the measured
 * evidence of each listing's newest version — and nothing else is read; see the module header on why
 * each read is shaped that way. The columns are then assembled by walking the request's own
 * identifiers, never the order the database returned rows in, so a comparison's columns follow the
 * reader's ordering.
 *
 * Refuses with the row's `404` when any requested identifier resolves to no listing the public reads
 * return, which covers an identifier that names no listing and one whose listing an operator has
 * hidden. The refusal is made while the columns are assembled and before any of them is returned, so
 * a comparison is all or nothing: there is no partial answer, no null column standing in for a
 * listing, and no statement of which identifier failed, because the whole request is what a client
 * asked for and the whole request is what the row refuses. The comparison page resolves an absent
 * column by asking for each identifier on its own instead, which is where that explanation belongs.
 */
function readCompareColumns(database: Database, identifiers: readonly string[]): CompareEntry[] {
  const listingRows = database
    .prepare<string[], CompareListingRow>(listingsStatement(identifiers.length))
    .all(...identifiers);

  const listingsById = new Map<string, CompareListingRow>();
  for (const listing of listingRows) {
    listingsById.set(listing.id, listing);
  }

  const claims = claimsByListing(
    database
      .prepare<string[], CompareClaimRow>(claimsStatement(identifiers.length))
      .all(...identifiers),
  );

  const evidence = latestEvidenceByListing(
    database
      .prepare<string[], LatestReportRow>(latestReportStatement(identifiers.length))
      .all(...identifiers),
  );

  const entries: CompareEntry[] = [];
  for (const identifier of identifiers) {
    const listing = listingsById.get(identifier);
    if (listing === undefined) {
      throw ApiError.notFound(
        'One or more of the requested listings does not exist or is not available to compare.',
      );
    }

    const listingClaims = claims.get(identifier) ?? [];
    const listingEvidence = evidence.get(identifier) ?? null;

    entries.push({
      listing_id: listing.id,
      title: listing.title,
      claims: listingClaims,
      report_id: listingEvidence === null ? null : listingEvidence.report_id,
      outcome: listingEvidence === null ? null : listingEvidence.outcome,
      standard_version_id: listingEvidence === null ? null : listingEvidence.standard_version_id,
      label: listingEvidence === null ? null : listingEvidence.label,
      limitations: statedLimitations(listingClaims),
      license_code: listing.license_code,
      pricing_model: listing.pricing_model,
    });
  }

  return entries;
}

/**
 * Registers this group's one route — `GET /compare` — on the instance it is handed.
 *
 * The path is prefix-relative: the versioned prefix — `API_PREFIX`, declared once in the sibling
 * `./register-routes` — is applied exactly once, by `./register-routes`, which calls this function with
 * its encapsulated scope. That literal appears nowhere in this file and must not: a group that spelled
 * it would be the second place the prefix is decided.
 *
 * The query schema is the whole of the request's contract here. It requires `ids` and holds it to
 * the two-to-four token pattern, so a missing parameter, a parameter that is not a string and a list
 * outside the bound are all answered `400 validation_error` by the server's single error handler
 * before this handler runs. No header schema is attached, because the row is public and reads no
 * identity. The route carries no rate-limit option either, the 60-per-minute limit being on writes
 * while reads are unlimited, and no failure is caught here, because the server's error handler owns
 * `{ error: { code, message } }` and a handler-local error body would be a second answer to one
 * failure.
 *
 * What it returns and what it refuses: `200` with one `CompareEntry` per requested listing, in the
 * order the request named them, each carrying the claims the listing's versions make, the
 * limitations those claims state, the license and pricing model the listing is offered under, and
 * the measured evidence of its latest version or `null` in all four of those fields when its latest
 * version has no report. It refuses with `400 validation_error` for a request that resolves to fewer
 * than `COMPARE_MIN_IDS` distinct listings, and with `404 not_found` for an identifier that names no
 * listing or whose listing has been hidden.
 */
export function registerCompareRoutes(app: FastifyInstance, context: CompareRouteContext): void {
  app.get<{ Querystring: CompareQuery }>(
    "/compare",
    { schema: compareQuerySchema },
    (request, reply) => {
      const identifiers = comparableIdentifiers(request.query.ids);
      const result: CompareResult = {
        entries: readCompareColumns(context.database, identifiers),
      };
      return reply.code(200).send(result);
    },
  );
}
