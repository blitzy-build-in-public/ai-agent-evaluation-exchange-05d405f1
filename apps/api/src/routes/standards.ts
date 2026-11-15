/**
 * The standards route group: the Standard Gate Index's catalogue, one published version of one
 * standard, a contributor's proposal, and the operator's review that decides it.
 *
 * It owns the four standards rows of the API contract table — `GET /standards` and
 * `GET /standards/{id}/versions/{v}` (public, `200`, `404`), `POST /standards/proposals`
 * (contributor, `201` with status `submitted`, `400`, `401`, `403`) and
 * `POST /standards/proposals/{id}/review` (operator, `200` with the status moved and a governance
 * event appended, `409`, `403`) — and it maps HTTP onto the domain calls that own those rows. No
 * scoring, ledger or policy arithmetic appears here, and neither does a statement about a threshold.
 *
 * **Every write on this path belongs to `@adem/sgi-core`.** `submitProposal` inserts the proposal
 * and `reviewProposal` moves its `status` and appends the governance event, each inside its own
 * transaction, so this file writes `standard_proposals` nowhere and `governance_events` nowhere.
 * Its only insert of its own is the audit event, through
 * `apps/api/src/audit/append-audit-event.ts`, appended inside the same transaction as the domain
 * write so that a write and the record of it are indivisible: better-sqlite3 nests the domain
 * package's transaction inside this one as a savepoint, so a refusal rolls both back. Writing the
 * status by hand, or inserting the event here, would duplicate a responsibility with one owner and
 * would put a second answer beside the domain's. A submission deliberately appends **no** governance
 * event — the inserted row is itself the record of the submission, and the append sites are a
 * proposal's review, a moderation action, an appeal's opening and ruling, a standard version's
 * publication and a retest — so nothing here balances that by adding one.
 *
 * **A standard version is data, and it is read as it is stored.** The version read answers the row's
 * own columns — `total_cases`, `critical_cases`, `pass_threshold_matches`, `critical_failures_allowed`,
 * `status` and `rubric_reference` — beside the row's `definition_json` text and the parsed,
 * verified `definition` the registry assembles from those same columns. Nothing here recomputes,
 * rounds or "normalises" a threshold: the pass rule is the standard's own data, versioned with it,
 * and a route that derived one would break the reproducibility a report rests on. `standard_versions`
 * is append-only, so a criteria change is a new version; no route in this table publishes one, and
 * approving a proposal does not publish a version.
 *
 * **The catalogue's proposals are read, never written, and the read is stated here because the
 * package exports no proposals reader.** `GET /standards` answers each standard with its versions
 * (from `listStandards`), the page of the proposals made against it and how many proposals it holds
 * in all, and the contract table names no proposals route of its own while the standards page renders
 * each proposal's review status. The two `SELECT`s below therefore read `standard_proposals`
 * directly: the page read ranks every standard's own proposals by recency and answers the requested
 * page of them in insertion order (`created_at ASC, rowid ASC`), and the count reads the size of each
 * standard's whole proposal history. Both are reads and nothing else: the status a proposal carries
 * is moved only by `reviewProposal`, which is why no statement in this file updates one.
 *
 * **The proposals are windowed and the catalogue is not, because only the proposals grow.**
 * `standards` holds the one standard this release publishes and `standard_versions` is a versioned
 * history nothing in the product appends to, so the catalogue and its versions are answered whole;
 * every submission appends a row to `standard_proposals`, so that read answers
 * `COLLECTION_PAGE_SIZE` proposals per standard, newest first, and `?page=2` reaches the proposals
 * older than the newest page.
 *
 * **Two naming worlds meet here, and this file is the mapping.** `@adem/sgi-core` speaks camelCase
 * (`proposalId`, `standardId`, `proposerAccountId`, `createdAt`) and `@adem/shared` speaks the stored
 * snake_case (`id`, `standard_id`, `proposer_account_id`, `created_at`). The two `StandardProposal`
 * types collide by name, so the domain one is imported as `DomainProposal` and the wire one keeps its
 * name. One mapping in each direction — `toWireProposal` on the way out, the stored row mapped member
 * by member on the way in — is the whole of it, and the appended event is mapped the same way by
 * `toStoredEvent`. The review request body's field is `status` because that is the column the review
 * moves, while the domain parameter is `decision`: `body.status` is passed into `decision` and
 * nowhere else could that pair be conflated without silently deciding a proposal the wrong way.
 *
 * **The failure order and the statuses.** On each write: rate limit, then JSON-schema validation,
 * then `401` for an absent or unresolvable `X-Demo-Account` header, then `403` for a resolvable
 * account whose role is not the row's, then the domain call with the audit append inside one
 * transaction. A refusal the domain package raises is mapped by its stable `code` through
 * `toApiError` and never by a class name: `unknown_standard` → `404`, `not_found` → `404`,
 * `already_decided` → `409`, `invalid_proposal` → `400`. No handler re-derives domain state to pick a
 * status and no handler writes an error body — the one error envelope
 * `{ error: { code, message } }` is the server's single error handler's.
 *
 * Two of those mappings are worth stating where they are taken, because both are easy to get wrong.
 * A proposal naming a standard that does not exist is answered `404` `unknown_standard`, because that
 * is what the domain refuses with and because the standards page and its proposal form both have a
 * distinct reading for it — "that standard is not in the catalogue" — which a `400` about the
 * request's shape would misdirect. And the version read answers `404` `not_found` when
 * `getStandardVersion` returns no row, whether it is the standard reference or the version reference
 * that resolved to nothing: both are the contract's `404`, and telling them apart would cost a second
 * domain read for a distinction no consumer of this row branches on.
 *
 * **What each success answers.** The catalogue answers `{ items: [ ... ], page }`, each item the
 * standard with its `versions` nested, one page of its `proposals` and the standard's whole
 * `proposal_total`, which is the shape the standards page reads and the reason the proposals travel
 * beside their standard rather than at the top level: `page` states which page of every standard's
 * proposals the answer carries, and `proposal_total` states how many that standard holds in all, so a
 * reader can tell a complete proposal list from a page of a longer one. The version read
 * answers `{ standard_version: ... }`. The submission answers `{ standard_proposal: ... }` — the
 * created proposal, in the wire spelling — and the review answers `{ standard_proposal: ... }`
 * beside `{ event: ... }`, the governance event it appended, read back from the append-only log by
 * the subject the decision concerns: a review is a decision, and the ground the operator stated lives
 * in that event rather than in a column of the proposal, so the answer a client reads where the
 * decision is shown is the same shape the moderation row already gives its own decision. The two
 * write answers are therefore two result interfaces rather than one, because a submission appends no
 * event and an answer that stated an absent one would be a second authority for a row that does not
 * exist. No payload of this file carries a listing, a sponsored slot, a fee or a ledger field: a
 * commercial or sponsored value reaches no measurement, and the route that could carry one is not
 * this one.
 *
 * **The reads resolve no identity.** Both `GET` rows are public, so neither attaches the header
 * schema and neither resolves an account: a garbage header, a wrong-role header and an absent header
 * are answered alike, and an absent catalogue is `200` with `items: []` — the empty proposals list is
 * the ordinary state the standards page renders, while an unknown standard or version is the `404`.
 * The header on the two writes is a synthetic role selector and never authentication: it names one of
 * the seeded demo accounts, separates the contributor's role from the operator's for this
 * demonstration, and asserts nothing about who the caller is.
 *
 * **It opens no connection, reads no environment variable and holds no module-level state.** The
 * database handle and the resolved configuration arrive from the composition root through
 * {@link StandardsRouteContext}, as ports and adapters require, and the write rate limit's two numbers
 * are read from that configuration rather than written here. The paths below are prefix-relative:
 * the versioned prefix is applied exactly once, by `./register-routes`, and the literal appears
 * nowhere in this file. Both reads are pure SQL plus mapping — no clock, no cache, no memoisation —
 * so two calls answer byte-identical bodies.
 *
 * What is deliberately absent: no `UPDATE` and no `DELETE` anywhere, no replace-style conflict
 * resolution (SQLite documents that resolution as bypassing a delete trigger), no `PUT`, `PATCH` or
 * `DELETE` handler, no transaction opened outside a write, no error body of this file's own, and no
 * test file beside it — this group's behaviour is proven by the integration suite that drives the
 * routes.
 */

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type {
  CollectionPageQuery,
  GovernanceEvent,
  ProposalStatus,
  Standard,
  StandardProposal,
  StandardProposalCreateBody,
  StandardProposalReviewBody,
  StandardVersion,
} from "@adem/shared";
import {
  COLLECTION_PAGE_SIZE,
  DEMO_ACCOUNT_HEADER,
  collectionPageQuerySchema,
  demoAccountHeaderSchema,
  standardProposalCreateBodySchema,
  standardProposalIdParamsSchema,
  standardProposalReviewBodySchema,
} from "@adem/shared";

import {
  canonicalize,
  getStandardVersion,
  listEvents,
  listStandards,
  reviewProposal,
  submitProposal,
} from "@adem/sgi-core";
import type {
  GovernanceEvent as AppendedGovernanceEvent,
  GovernanceEventType,
  StandardProposal as DomainProposal,
  StandardRecord,
  StandardVersionRecord,
} from "@adem/sgi-core";

import { appendAuditEvent } from "../audit/append-audit-event";
import { requireRole } from "../auth/require-role";
import { resolveDemoAccount } from "../auth/resolve-demo-account";
import type { ApiConfig } from "../config";
import { ApiError, toApiError } from "../errors/error-envelope";

/**
 * The slice of the folder's single `RouteContext` this group needs: the open database handle and the
 * resolved configuration, which arrive by closure from the server factory rather than through Fastify
 * plugin options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers this
 * group's routes and is written last in this folder because it imports all fourteen groups' values.
 * This file spells the two members structurally instead of importing that type, so that this file and
 * the `apps/api` project compile on their own, before `./register-routes` exists; a `RouteContext`
 * carrying exactly these two members is assignable to this shape, so the registrar's call site is
 * unaffected. The handle and the configuration are both bound to names here because both are read:
 * every statement runs on the handle, and the write rate limit's two numbers come from the
 * configuration's `writeRateLimit`. `apps/api/src/server.ts` passes both in, so this module opens no
 * connection, reads no environment variable and resolves no path.
 */
interface StandardsRouteContext {
  readonly database: Database;
  readonly config: ApiConfig;
}

/**
 * One stored row of `standard_proposals`, in the shape migration
 * `packages/shared/migrations/0005_standards_and_proposals.sql` declares it: the seven columns, in
 * its order, so the select list below can be compared against the schema by reading one line of each.
 *
 * It is the declared result of the prepared statement, which is what removes the need for a cast when
 * the row is mapped.
 *
 * `status` is typed as the closed `ProposalStatus` although the column is stored as text, and that is
 * a true statement about what the column holds: `0005` declares
 * `CHECK (status IN ('submitted', 'accepted', 'rejected'))`, `submitProposal` creates every row
 * `submitted`, and `reviewProposal` is the only writer of the two remaining values. The narrowing
 * therefore costs no runtime branch and invents no failure path for a row this product cannot store.
 */
interface StandardProposalRow {
  readonly id: string;
  readonly standard_id: string;
  readonly proposer_account_id: string;
  readonly title: string;
  readonly rationale: string;
  readonly status: ProposalStatus;
  readonly created_at: string;
}

/**
 * One row of {@link SELECT_PROPOSAL_TOTALS}: a standard, and the number of proposals it holds.
 */
interface StandardProposalTotalRow {
  readonly standard_id: string;
  readonly total: number;
}

/**
 * The seven columns {@link SELECT_PROPOSAL_PAGE} selects, named explicitly rather than through
 * `SELECT *`.
 *
 * A row is mapped member by member below, so a column a later migration adds is dropped from the
 * result until this line and {@link StandardProposalRow} are updated together, while `SELECT *` would
 * quietly change the shape of every proposal the catalogue answers with.
 */
const SELECTED_PROPOSAL_COLUMNS =
  "id, standard_id, proposer_account_id, title, rationale, status, created_at";

/**
 * Every proposal with its rank inside the standard it concerns, `1` being that standard's newest: the
 * subquery {@link SELECT_PROPOSAL_PAGE} windows, and the reason its bound is per standard rather than
 * over the table.
 *
 * `created_at DESC` puts the most recently submitted proposal first and `rowid DESC` breaks the tie
 * between two proposals submitted within the same millisecond, which in a synchronous single-writer
 * process is the ordinary case. `rowid` is selected under a name of its own because the read outside
 * this subquery orders by it and a derived table publishes no pseudo-column; the alias is not a member
 * of {@link StandardProposalRow}, so it never reaches an answer.
 */
const RANKED_PROPOSAL_COLUMNS = `SELECT ${SELECTED_PROPOSAL_COLUMNS}, rowid AS source_rowid, ROW_NUMBER() OVER (PARTITION BY standard_id ORDER BY created_at DESC, rowid DESC) AS recency_rank FROM standard_proposals`;

/**
 * The page of proposals this file answers with: for each standard, the `COLLECTION_PAGE_SIZE`
 * proposals whose recency rank falls inside the requested page, in insertion order.
 *
 * The two `?` are the page's own rank bounds — greater than the rank the page starts after, and at
 * most the rank it ends on — so the statement binds two numbers and its text never grows with the
 * table, and the read cannot reach SQLite's variable ceiling however many proposals a standard holds.
 * The outer `ORDER BY created_at ASC, source_rowid ASC` restores the insertion order the catalogue
 * documents and the order that makes two calls answer byte-identical bodies, which is what lets
 * {@link proposalsByStandard} group rows exactly as an unwindowed read did.
 *
 * A window function is the form this file uses, and the reason is the bound itself: a `LIMIT` over the
 * whole table would bound the response without bounding each standard's history — one busy standard
 * would fill the page and every other standard would answer nothing — while a correlated subquery or a
 * bound spelled into the statement text would put the table's size into the statement. This is one
 * statement over the table, so the catalogue still issues no query per standard. Page 1 is each
 * standard's newest `COLLECTION_PAGE_SIZE` proposals, page 2 the next ones back, and a page past the
 * end is the empty list rather than an error.
 */
const SELECT_PROPOSAL_PAGE = `SELECT ${SELECTED_PROPOSAL_COLUMNS} FROM (${RANKED_PROPOSAL_COLUMNS}) WHERE recency_rank > ? AND recency_rank <= ? ORDER BY created_at ASC, source_rowid ASC`;

/**
 * How many proposals every standard holds, in all rather than on the page served beside it: the one
 * source of a catalogue item's `proposal_total`.
 *
 * The count is over the whole table because that is its job — it says how much of a standard's
 * proposal history the page beside it leaves out, which is what makes `?page=2` worth asking for. One
 * grouped statement answers every standard at once and binds nothing, so the count adds no query per
 * catalogue row.
 */
const SELECT_PROPOSAL_TOTALS = `SELECT standard_id, COUNT(*) AS total FROM standard_proposals GROUP BY standard_id`;

/**
 * One catalogue item as `GET /standards` answers it: the standard, with the versions published under
 * it, one page of the proposals made against it and the number of proposals it holds in all.
 *
 * The nested layout is the one the standards page reads — `apps/web/src/api-client.ts` accepts a
 * nested collection or a sibling array grouped by `standard_id`, and prefers the nested form — so the
 * proposals travel beside the standard they concern rather than in a second top-level collection.
 * Both arrays are present and empty when there is nothing to show, because a standard with no
 * proposal yet is an ordinary state rather than an absent key.
 *
 * `versions` is the registry's own records, handed on exactly as `listStandards` returned them: each
 * carries the row's stored columns — the versioned criteria the evaluator read — and nothing here
 * reorders, filters or recomputes one.
 */
interface StandardsCatalogueItem extends Standard {
  /** The versions published under this standard, in the order they were published. */
  readonly versions: readonly StandardVersion[];
  /**
   * One page of this standard's proposals, oldest first inside the page: the newest
   * `COLLECTION_PAGE_SIZE` proposals on page 1, the next page's on `?page=2`, and the empty list when
   * the requested page holds none.
   */
  readonly proposals: readonly StandardProposal[];
  /**
   * How many proposals this standard holds in all, so a reader can tell the page it carries from the
   * standard's whole proposal history: `proposals.length` is at most `COLLECTION_PAGE_SIZE` rows,
   * while this is the number of proposals a later page would answer with.
   */
  readonly proposal_total: number;
}

/**
 * The `200` body of `GET /standards`: the whole catalogue under `items`, with the page of proposals
 * each item carries stated beside it.
 *
 * The catalogue itself is complete rather than paged — the one standard this release publishes and
 * its versions do not grow with use — while the proposals nested in each item are windowed, because
 * every submission appends one to a table that grows with the product's use. Page 1 is the newest
 * `COLLECTION_PAGE_SIZE` proposals of each standard and `?page=` walks back through a standard's
 * proposals; the catalogue members do not change with the page. An empty catalogue is `items: []`,
 * which is a state the page renders rather than an error.
 */
interface StandardsCatalogueResult {
  /** Every standard in the catalogue, each with its versions and its page of proposals. */
  readonly items: readonly StandardsCatalogueItem[];
  /**
   * The page of each standard's proposals this answer carries, as `?page=` requested it, and `1` when
   * the request stated none.
   */
  readonly page: number;
}

/**
 * The `200` body of `GET /standards/{id}/versions/{v}`: the version, under the key a single-entity
 * response uses.
 *
 * The entity is the registry's record, which carries the row's own stored columns — including the
 * four thresholds, the status, the rubric reference and `published_at` — beside `definition`, the
 * parsed and verified view of `definition_json` the registry assembles from those same columns. The
 * columns are the criteria and the definition is a reading of them; neither is derived here, and a
 * consumer that took either for a recomputation would be reading a value this route never formed.
 */
interface StandardVersionResult {
  /** The published version, carrying the criteria the evaluator reads. */
  readonly standard_version: StandardVersionRecord;
}

/**
 * The `201` body of `POST /standards/proposals`: the proposal the submission created.
 *
 * The row is the wire spelling of the domain's record, mapped member by member by
 * {@link toWireProposal}, and it is the whole answer because a submission appends no governance
 * event: the inserted row is itself the record of the submission, and there is no event to echo.
 */
interface StandardProposalResult {
  /** The proposal as the submission created it: in status `submitted`. */
  readonly standard_proposal: StandardProposal;
}

/**
 * The `200` body of `POST /standards/proposals/{id}/review`: the decided proposal beside the record
 * of the decision that decided it.
 *
 * Two keys, because the operator needs both and neither answers the other's question. The proposal is
 * the row a review moves and states where it now stands; `event` is the append-only row the review
 * appended and holds the ground the operator stated, which has no column of its own — the proposal
 * carries no reviewed-at, reviewed-by or review-reason field, and adding one would invite an edit of a
 * row a review has already decided. The shape is the one the sibling `./moderation` answer already
 * gives its own decision, the one this module's header states, and the one
 * `apps/web/src/api-client.ts`'s `reviewProposal` reads: the status to show and the event whose ground
 * is rendered beside it.
 *
 * `event` is never absent. The review that produced this answer appended exactly one event in the same
 * transaction — see the handler's own comment for why the read cannot answer anything else — and an
 * answer stating no event would be a decision a client could not render as recorded.
 *
 * A distinct interface from {@link StandardProposalResult} rather than one type with a nullable event,
 * because the two answers differ in kind: a submission appends nothing, and a payload whose `event`
 * were sometimes `null` would make every consumer of the submission row branch for a case that row
 * cannot produce.
 */
interface StandardProposalReviewResult {
  /** The proposal as the review left it: `accepted` or `rejected`, text unchanged. */
  readonly standard_proposal: StandardProposal;
  /** The governance event the review appended, as `governance_events` stores it. */
  readonly event: GovernanceEvent;
}

/**
 * The governance subject kind a review is recorded against, and the vocabulary member the review
 * appends and this file reads back.
 *
 * Both are named once, here, so the write and the read cannot name different rows: `reviewProposal`
 * appends the event under this pair and the handler below reads it back under the same pair. The
 * subject spelling is the one the domain package uses for a standards proposal — the appender's
 * subject set is deliberately open, so nothing but a constant closes it — and the event type is typed
 * as the closed vocabulary's own member, so a rename in `@adem/sgi-core` fails this declaration rather
 * than a stored value.
 */
const PROPOSAL_SUBJECT_TYPE = "standard_proposal";

/** The vocabulary member a review appends and this file reads back; see {@link PROPOSAL_SUBJECT_TYPE}. */
const PROPOSAL_REVIEW_EVENT_TYPE: GovernanceEventType = "proposal_reviewed";

/** The path parameters of `GET /standards/{id}/versions/{v}`. */
interface StandardVersionRouteParams {
  /** Identifier or code of the standard, e.g. `SGI-SO-1.0.0`. */
  readonly id: string;
  /** Label or row id of the version, e.g. `SGI-SO-1.0.0`. */
  readonly v: string;
}

/** The path parameter of `POST /standards/proposals/{id}/review`. */
interface StandardProposalRouteParams {
  /** Identifier of the `standard_proposals` row the review decides. */
  readonly id: string;
}

/**
 * One stored row as the proposal the catalogue answers with.
 *
 * The mapping is identity by design: the stored columns are already the wire shape, which is why no
 * member is renamed, defaulted or reformatted here and why the row's own `status` is handed on as the
 * narrowed `ProposalStatus` the column's `CHECK` makes it.
 */
function toStoredProposal(row: StandardProposalRow): StandardProposal {
  return {
    id: row.id,
    standard_id: row.standard_id,
    proposer_account_id: row.proposer_account_id,
    title: row.title,
    rationale: row.rationale,
    status: row.status,
    created_at: row.created_at,
  };
}

/**
 * The requested page of proposals, grouped by the standard each concerns, each group in insertion
 * order.
 *
 * The two arguments are the rank bounds of one page: `rankAbove` is the rank the page starts after
 * and `rankThrough` the rank it ends on, so `?page=1` is `(0, COLLECTION_PAGE_SIZE)` and `?page=2`
 * the next pair. They are the statement's only inputs and both are numbers, so neither the statement's
 * text nor its variable count grows with the table.
 *
 * The statement is prepared per call because a prepared statement belongs to the connection that made
 * it, and this module owns no connection: the handle is the caller's, as ports and adapters require.
 * SQLite caches the compiled statement itself, so the per-call `prepare` allocates no plan of its own.
 *
 * A `Map` keyed by `standard_id` is what turns the flat, ordered page into the nested layout without a
 * second query per standard, and because the read is ordered by `created_at` and then by the row's
 * own `rowid` — the statement's `source_rowid` — before a row reaches this function, appending each
 * row to its own array preserves that order within the group. A standard whose page holds nothing is
 * absent from the map, which the caller answers as the empty list. Nothing is written or amended by
 * this read.
 */
function proposalsByStandard(
  database: Database,
  rankAbove: number,
  rankThrough: number,
): Map<string, StandardProposal[]> {
  const grouped = new Map<string, StandardProposal[]>();

  for (const row of database
    .prepare<[number, number], StandardProposalRow>(SELECT_PROPOSAL_PAGE)
    .all(rankAbove, rankThrough)) {
    const proposal = toStoredProposal(row);
    const existing = grouped.get(proposal.standard_id);

    if (existing === undefined) {
      grouped.set(proposal.standard_id, [proposal]);
    } else {
      existing.push(proposal);
    }
  }

  return grouped;
}

/**
 * How many proposals every standard holds, keyed by `standard_id`.
 *
 * The statement is prepared per call for the reason {@link proposalsByStandard} states, and the count
 * is over the whole table rather than over a page: it is what lets a catalogue item state the size of
 * the proposal history its `proposals` array is one page of. A standard the count does not name — one
 * with no proposal at all — is absent from the map, which the caller answers as zero. Nothing is
 * written by this read.
 */
function proposalTotalsByStandard(database: Database): Map<string, number> {
  const totals = new Map<string, number>();

  for (const row of database.prepare<[], StandardProposalTotalRow>(SELECT_PROPOSAL_TOTALS).all()) {
    totals.set(row.standard_id, row.total);
  }

  return totals;
}

/**
 * The catalogue, read through the registry that owns the two tables behind it.
 *
 * The registry is the only path to the `standards` catalogue and to the append-only
 * `standard_versions` history, and its refusal is mapped rather than interpreted: a version whose
 * persisted definition contradicts the row it is stored beside is a `standard_drift` refusal, which
 * the closed status map answers `400` — a defect in the stored data rather than a client's error, and
 * the reason it is mapped from the code instead of being guessed at here.
 */
function readCatalogue(database: Database): StandardRecord[] {
  try {
    return listStandards(database);
  } catch (cause) {
    throw toApiError(cause);
  }
}

/**
 * One catalogue row as the item the read answers with: the standard's own fields, its versions as the
 * registry returned them, the page of its proposals or the empty list, and the number of proposals it
 * holds in all.
 */
function toCatalogueItem(
  standard: StandardRecord,
  proposals: ReadonlyMap<string, readonly StandardProposal[]>,
  proposalTotals: ReadonlyMap<string, number>,
): StandardsCatalogueItem {
  return {
    id: standard.id,
    code: standard.code,
    title: standard.title,
    summary: standard.summary,
    versions: standard.versions,
    proposals: proposals.get(standard.id) ?? [],
    proposal_total: proposalTotals.get(standard.id) ?? 0,
  };
}

/**
 * One domain proposal as the wire row `@adem/shared` declares for the same table.
 *
 * The only place the two spellings meet on the way out: the domain's `proposalId`, `standardId`,
 * `proposerAccountId` and `createdAt` are the stored row's `id`, `standard_id`, `proposer_account_id`
 * and `created_at`. Every value is handed on unchanged — the status is the decision the review just
 * made, and the title and the rationale are the stored ones, which no review rewrites.
 */
function toWireProposal(proposal: DomainProposal): StandardProposal {
  return {
    id: proposal.proposalId,
    standard_id: proposal.standardId,
    proposer_account_id: proposal.proposerAccountId,
    title: proposal.title,
    rationale: proposal.rationale,
    status: proposal.status,
    created_at: proposal.createdAt,
  };
}

/**
 * One appended governance event as the row `governance_events` stores it: the package's own values in
 * the table's snake_case spelling, with the payload the appender canonicalised.
 *
 * Every identifying member comes from the value `listEvents` returned, which *is* the row: the log is
 * append-only, so the reader's answer is what the table holds and a second statement could say nothing
 * more. `subject_type` is restated as the literal the read was filtered by rather than taken from the
 * event's own open `string`: the query named that subject kind, so every row answering it carries it,
 * and the wire type declares the closed vocabulary a row must be a member of. `payload_json` is
 * `canonicalize(payload)`, the same canonical JSON `appendEvent` stored for the same payload value —
 * canonicalisation is a pure function of its input, so the text is byte-identical and no stored string
 * is parsed and re-rendered to obtain it — and `null` where the event carries no payload, which is
 * what the column holds.
 */
function toStoredEvent(event: AppendedGovernanceEvent): GovernanceEvent {
  const { payload } = event;

  return {
    id: event.id,
    subject_type: PROPOSAL_SUBJECT_TYPE,
    subject_id: event.subjectId,
    event_type: event.eventType,
    actor_account_id: event.actorAccountId,
    reason: event.reason ?? null,
    payload_json: payload === undefined ? null : canonicalize(payload),
    created_at: event.createdAt,
  };
}

/**
 * What the review's transaction returns to the handler: the decided proposal and the event the review
 * appended, both in the domain package's camelCase.
 *
 * The event is read back inside the transaction that wrote it rather than composed here: the review's
 * record lives in the append-only log, so the row is the authority for it, and an event this file built
 * out of the request would be a second, uncorroborated account of the same decision.
 */
interface ReviewedProposal {
  /** The proposal, carrying the review's outcome as its `status`. */
  readonly proposal: DomainProposal;
  /** The appended governance event, as the reader returned it. */
  readonly event: AppendedGovernanceEvent;
}

/**
 * One published version, read through the registry, or the `404` the contract fixes for a reference
 * that resolves to nothing.
 *
 * The registry accepts either spelling of both references — the standard's row id or its code
 * `SGI-SO-1.0.0`, and the version's row id or its label — which is what lets the page address the
 * version by the labels people quote and a report address it by the row id it stored.
 *
 * A `null` return is the contract's `404` and is raised as this API's own not-found refusal. A thrown
 * refusal is mapped by its stable `code`: an ambiguous reference is `unknown_standard`, also `404`,
 * and a version whose persisted definition contradicts its row is `standard_drift`, a `400` for
 * stored data that disagrees with itself. Neither is interpreted here and neither re-reads a row to
 * guess at a status.
 */
function readVersion(
  database: Database,
  reference: string,
  versionLabel: string,
): StandardVersionRecord {
  let version: StandardVersionRecord | null;

  try {
    version = getStandardVersion(database, reference, versionLabel);
  } catch (cause) {
    throw toApiError(cause);
  }

  if (version === null) {
    throw ApiError.notFound();
  }

  return version;
}

/**
 * Registers this group's four routes on the instance it is handed, in contract-table order.
 *
 * The paths are prefix-relative: the versioned prefix is applied exactly once, by `./register-routes`,
 * which calls this function with its encapsulated scope, so the literal appears nowhere in this file.
 * This function registers no prefix of its own and reads its rate-limit numbers from the resolved
 * configuration rather than from a literal, so the contract's 60-per-minute write bound and the
 * window it is measured over have one definition in the product.
 *
 * The catalogue read attaches the page query contract and the version read attaches no schema; neither
 * resolves identity, because both rows are public; the two writes attach the demo-session header
 * contract beside their own body and parameter schemas, so a request that reaches either without a
 * resolvable header is answered `401` by the error handler's mapping of the failed header schema. Every
 * refusal a handler raises is a refusal of these dependencies — this file defines no error of its own.
 */
export function registerStandardsRoutes(app: FastifyInstance, context: StandardsRouteContext): void {
  const { database } = context;

  // The rate-limit option both write routes carry, built once from the resolved configuration: the
  // `max` and the `timeWindow` a route registers are the product's own numbers, and writing either
  // here would be the second place the contract's write bound is decided.
  const writeRateLimit = {
    rateLimit: {
      max: context.config.writeRateLimit.max,
      timeWindow: context.config.writeRateLimit.timeWindow,
    },
  };

  // `GET /standards` — the catalogue: every standard with its versions, its page of proposals and how
  // many proposals it holds in all. The standards and their versions are answered whole because they
  // do not grow with use; the proposals do, so they are read one page at a time from the newest back
  // and each item states the size of the history its page came from.
  //
  // The page query contract is the only schema this row attaches, and it declares `page` alone. An
  // unexpected query key is therefore not a refusal: Fastify's validator removes an unknown key before
  // this handler runs, so `?limit=100` is absent from `request.query` rather than refused, and the page
  // size stays at `COLLECTION_PAGE_SIZE` however the request spells an attempt to raise it. A value
  // that fails the schema's own constraint — `?page=0`, `?page=-1`, `?page=abc` — is the `400`
  // validation error the one error handler answers every route with.
  app.get<{ Querystring: CollectionPageQuery }>(
    "/standards",
    { schema: collectionPageQuerySchema },
    (request, reply) => {
      const rankThrough = request.query.page * COLLECTION_PAGE_SIZE;
      const proposals = proposalsByStandard(database, rankThrough - COLLECTION_PAGE_SIZE, rankThrough);
      const proposalTotals = proposalTotalsByStandard(database);
      const result: StandardsCatalogueResult = {
        items: readCatalogue(database).map((standard) =>
          toCatalogueItem(standard, proposals, proposalTotals),
        ),
        page: request.query.page,
      };

      return reply.code(200).send(result);
    },
  );

  app.get<{ Params: StandardVersionRouteParams }>("/standards/:id/versions/:v", (request, reply) => {
    const result: StandardVersionResult = {
      standard_version: readVersion(database, request.params.id, request.params.v),
    };

    return reply.code(200).send(result);
  });

  // `POST /standards/proposals` — a contributor proposes a change to a standard. The body carries the
  // standard it concerns, the change and the reasoning; the proposer is resolved from the header and
  // is deliberately not a body field, and `status` is not one either, so a client that submitted one
  // could not create a decided proposal. The row is created `submitted` and this route appends **no**
  // governance event: the inserted row is the record of the submission, and the append sites are a
  // review, a moderation action, an appeal's opening and ruling, a standard version's publication and
  // a retest. A blank title or rationale, or a standard the catalogue does not hold, is the domain
  // package's own refusal, mapped by its code: `400` `invalid_proposal` for the first, `404`
  // `unknown_standard` for the second.
  app.post<{ Body: StandardProposalCreateBody }>(
    "/standards/proposals",
    {
      schema: { ...demoAccountHeaderSchema, ...standardProposalCreateBodySchema },
      config: writeRateLimit,
    },
    (request, reply) => {
      const actor = requireRole(
        resolveDemoAccount(database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "contributor",
      );
      const body = request.body;

      // One transaction covers the insert and the audit append, so the proposal and the record of who
      // wrote it are indivisible: a failure between them leaves neither. The domain package's own
      // transaction nests inside this one as a savepoint rather than opening a second one.
      const submit = database.transaction((): DomainProposal => {
        const proposal = submitProposal(database, {
          standardId: body.standard_id,
          proposerAccountId: actor.id,
          title: body.title,
          rationale: body.rationale,
        });

        appendAuditEvent(database, {
          actorAccountId: actor.id,
          action: "proposal.submitted",
          resourceType: "standard_proposal",
          resourceId: proposal.proposalId,
          statusCode: 201,
        });

        return proposal;
      });

      let proposal: DomainProposal;

      try {
        proposal = submit();
      } catch (cause) {
        throw toApiError(cause);
      }

      const result: StandardProposalResult = { standard_proposal: toWireProposal(proposal) };

      return reply.code(201).send(result);
    },
  );

  // `POST /standards/proposals/{id}/review` — an operator decides a proposal. Governance here is a
  // human decision that gets recorded, never an automatic one, which is why this row requires the
  // operator role rather than admitting any account.
  //
  // The domain package owns both writes of this request: it moves `standard_proposals.status`, the
  // row's only mutable column, and appends the one governance event that records the decision, both
  // inside its own transaction. This route writes neither. Its own insert is the audit event, in the
  // same enclosing transaction, so a decided proposal and the record of the request that decided it
  // stand or fall together. The body's field is `status` — the column the review moves — and the
  // domain's parameter is `decision`, so the pair is mapped here and in no other direction. A review
  // that states no reason passes the empty string, which the domain records as a decision taken
  // without a stated ground rather than refusing; the audit row states the ground only when the
  // operator stated one, because `audit_events.reason` holds the absence as SQL `NULL` rather than as
  // an empty string.
  //
  // The appended event is read back with `listEvents`, filtered to this proposal and to the vocabulary
  // member the review wrote, **inside the same transaction**: the decided proposal and the record of
  // the decision are therefore read as one state, and a reader outside the transaction could not see a
  // review whose event was not yet visible. Exactly one row answers that read, because a second review
  // is refused `409` `already_decided` before anything is written; a read that answered any other
  // number would mean the append did not happen, which is a defect on this path rather than a client
  // condition, and it is raised as an internal failure — rolling the transaction back — rather than
  // answered with an absent event. The event answers beside the proposal because the ground the
  // operator stated has no column of its own: the proposal carries no review reason, and the appended
  // row is where the decision's *why* is recorded for good.
  //
  // An unknown proposal is `404` `not_found` and a proposal that already carries a review outcome is
  // `409` `already_decided`, both from the domain's own refusals. This route never touches
  // `standard_versions`: approving a proposal publishes no version, and a change to a pass rule
  // becomes real by proposing, reviewing and publishing a new version in its own right.
  app.post<{ Params: StandardProposalRouteParams; Body: StandardProposalReviewBody }>(
    "/standards/proposals/:id/review",
    {
      schema: {
        ...demoAccountHeaderSchema,
        ...standardProposalIdParamsSchema,
        ...standardProposalReviewBodySchema,
      },
      config: writeRateLimit,
    },
    (request, reply) => {
      const actor = requireRole(
        resolveDemoAccount(database, request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]),
        "operator",
      );
      const proposalId = request.params.id;
      const body = request.body;
      const reason = body.reason ?? "";

      const review = database.transaction((): ReviewedProposal => {
        const proposal = reviewProposal(database, {
          proposalId,
          reviewerAccountId: actor.id,
          decision: body.status,
          reason,
        });

        appendAuditEvent(database, {
          actorAccountId: actor.id,
          action: "proposal.reviewed",
          resourceType: "standard_proposal",
          resourceId: proposalId,
          statusCode: 200,
          ...(reason.trim() === "" ? {} : { reason }),
        });

        const events = listEvents(database, {
          subjectType: PROPOSAL_SUBJECT_TYPE,
          subjectId: proposalId,
          eventType: PROPOSAL_REVIEW_EVENT_TYPE,
        });
        const [event] = events;

        if (event === undefined || events.length !== 1) {
          throw new Error(
            `apps/api: the review appended ${events.length} ${PROPOSAL_REVIEW_EVENT_TYPE} governance events for one proposal, where exactly one records it`,
          );
        }

        return { proposal, event };
      });

      let reviewed: ReviewedProposal;

      try {
        reviewed = review();
      } catch (cause) {
        throw toApiError(cause);
      }

      const result: StandardProposalReviewResult = {
        standard_proposal: toWireProposal(reviewed.proposal),
        event: toStoredEvent(reviewed.event),
      };

      return reply.code(200).send(result);
    },
  );
}
