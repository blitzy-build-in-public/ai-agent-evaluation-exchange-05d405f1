/**
 * The public `GET /sponsored-slots` read: the whole of ADEM's advertising surface, and the
 * only place a sponsorship is ever read back.
 *
 * It owns one row of the API contract — `GET /sponsored-slots`, role `public`, success `200`
 * with every item carrying `sponsored: true`, and no error case of its own — and it answers
 * the separate, labelled collection `SponsoredSlotListResult` rather than any part of a
 * listings payload. The collection is whole and stands alone, which is what lets the home
 * page and the listings page render it in a block of its own below their organic results and
 * never interleaved with them. `apps/web/src/api-client.ts` is the only caller.
 *
 * **A sponsorship reaches no measurement, and it cannot, because no path exists.** This file
 * reads one table, `sponsored_slots`, and joins nothing: not `listings`, not
 * `listing_versions`, not `evaluation_reports` or `report_case_results`, not
 * `standard_versions` and not a ledger. It imports no domain package — the SGI core and the
 * commerce simulation are absent by design — so no field of an SGI report, a badge, a
 * gate fee or a ledger entry is even in scope here, and the payload carries no reference an
 * SGI type could read. Sponsorship therefore influences neither an evaluation nor a badge nor
 * the organic order a buyer sees, and `apps/api/test/integration/trust-separation.test.ts`
 * holds both halves of that: a static walk of every import specifier in `packages/sgi-core`,
 * and a comparison of report, badge and ordering payloads before and after sponsorship and
 * fee data are varied.
 *
 * **It reads no identity.** The row's role is `public` and the contract lists no error case
 * for it, so this route resolves no demo account, calls neither `resolveDemoAccount` nor
 * `requireRole`, and returns no `401` and no `403` under any circumstance — a garbage header,
 * a wrong-role header and an absent header are answered alike. An empty table is a complete
 * answer: `200` with `items: []`, never an error and never a `404`, because the pages that
 * render this block render nothing when it is empty rather than an empty frame.
 *
 * **It measures nobody.** Nothing is stored on the reader's device, no reader identifier is
 * recorded, no count of times an item was seen or opened is kept and no aggregate counter is
 * incremented: there is no column behind one and none is written here. A sponsored item is
 * labelled, not measured — the demonstration this route serves is disclosed advertising with
 * no personalized profiling behind it.
 *
 * **It is deterministic.** One parameterless `SELECT` over `sponsored_slots` ordered by
 * `placement_key` then `id`, both of which are fixed by the row, so two calls answer
 * byte-identical bodies including item order, and no locale, clock or fee value can reorder
 * the collection. Ordering by the fee is deliberately not done: a fee is not a ranking.
 *
 * **It computes nothing.** `fee_minor_units` is returned exactly as the row holds it: an
 * integer count of whole minor units of the product's one synthetic currency, never a
 * fraction, never rendered as a currency amount and never summed or converted. It is not
 * eligible for the founder-participation allocation, which applies only to the net amount of
 * an eligible completed simulated marketplace transaction, so no arithmetic belongs here.
 *
 * **`sponsored: true` is emitted, not derived.** `SponsoredSlotListItem` declares the literal,
 * so an item that is not marked cannot be typed at all and no renderer can take this
 * collection for organic content.
 *
 * What is deliberately absent: no `schema` (the row takes no parameter and has no error case),
 * no rate-limit option (reads are unlimited; the 60-per-minute limit is on writes), no audit
 * event (this route writes nothing at all), no transaction, and no error body of its own — a
 * failure would be shaped by the server's single error handler, which owns
 * `{ error: { code, message } }`. No `INSERT`, `UPDATE` or `DELETE` appears in this file, and
 * no `PUT`, `PATCH` or `DELETE` handler is registered.
 */

import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type {
  MinorUnits,
  SponsoredPlacementKey,
  SponsoredSlotListItem,
  SponsoredSlotListResult,
} from "@adem/shared";

/**
 * The slice of the folder's single `RouteContext` this public read needs: the open database
 * handle, which arrives by closure from the server factory rather than through Fastify plugin
 * options.
 *
 * `RouteContext` itself is declared once, in the sibling `./register-routes`, which registers
 * this group's routes and is written last in this folder because it imports all fourteen
 * groups' values. This file spells the member structurally instead of importing that type, so
 * that this file and the `apps/api` project compile on their own, before `./register-routes`
 * exists; a `RouteContext` carrying a `Database` is assignable to this shape, so the
 * registrar's call site is unaffected. Only the member this route reads is declared — the
 * config is not bound to a name, an unused binding being padding. `apps/api/src/server.ts`
 * passes the handle in, so this module opens no connection, reads no environment variable and
 * resolves no path.
 */
interface SponsoredRouteContext {
  readonly database: Database;
}

/**
 * One stored row, in the shape the table holds it: the five snake_case columns
 * `packages/shared/migrations/0009_sponsored_slots_and_audit_events.sql` declares, in its
 * order, so the select list below can be compared against the schema by reading one line of
 * each.
 *
 * It is the declared result of the prepared statement, which is what removes the need for a
 * cast when the row is mapped.
 *
 * `placement_key` is typed as the closed {@link SponsoredPlacementKey} although the column is
 * unconstrained `TEXT`, and that is a true statement about what the column holds: the seed is
 * the single insert path into this table and draws its value from `SPONSORED_PLACEMENT_KEYS`,
 * so a slot naming a surface the product does not render cannot be written. No route creates,
 * changes or removes a slot, so this reader is the whole of the table's public life.
 *
 * `fee_minor_units` is {@link MinorUnits} rather than a bare `number`: it is an integer count
 * of whole minor units, which is what the column's `CHECK (fee_minor_units >= 0)` and every
 * monetary field in this product state.
 */
interface SponsoredSlotRow {
  readonly id: string;
  readonly sponsor_label: string;
  readonly placement_key: SponsoredPlacementKey;
  readonly fee_minor_units: MinorUnits;
  readonly created_at: string;
}

/**
 * The five columns this reader selects, named explicitly rather than through `SELECT *`.
 *
 * A row is mapped member by member below, so a column a later migration adds is dropped from
 * the result until this line and the interface above are updated, while `SELECT *` would
 * quietly change the shape of every returned item.
 */
const SELECTED_COLUMNS = "id, sponsor_label, placement_key, fee_minor_units, created_at";

/**
 * The one query this file runs: every slot, in a total order, with no parameter and no filter.
 *
 * The contract row takes no query parameter — there is no placement filter, no paging and no
 * search — so the read is unbounded by design and the collection is small: a limited sponsor
 * demonstration rather than a result page. `placement_key ASC, id ASC` is deterministic and
 * locale-independent (SQLite's default `BINARY` collation compares these strings by code
 * point), and `id` is the table's primary key, so the order is total and two calls answer the
 * same bytes. `0011_indexes.sql` declares no index here on purpose: there is no filter for one
 * to serve, and an index would only be a second thing to keep true.
 */
const SELECT_ALL_SLOTS = `SELECT ${SELECTED_COLUMNS} FROM sponsored_slots ORDER BY placement_key ASC, id ASC`;

/**
 * One stored row as the item the public read answers with: the slot's own fields, mapped
 * member by member, plus the literal marker every item of this collection carries.
 *
 * The marker is written as the literal `true` and never derived from a stored value, so an
 * unmarked sponsored item cannot be produced or typed, and a reader — or a test asserting
 * strict equality — can rely on it being the boolean `true`.
 */
function toSponsoredSlotListItem(row: SponsoredSlotRow): SponsoredSlotListItem {
  return {
    id: row.id,
    sponsor_label: row.sponsor_label,
    placement_key: row.placement_key,
    fee_minor_units: row.fee_minor_units,
    created_at: row.created_at,
    sponsored: true,
  };
}

/**
 * Reads the sponsored slots, in the order {@link SELECT_ALL_SLOTS} fixes.
 *
 * The rows come back whole and unfiltered, and each is returned as the slot it is plus the
 * `sponsored: true` marker: no paging, no total, no cursor and no field this file invents. An
 * empty table yields `[]` — an ordinary answer rather than a refusal, which is what makes the
 * contract row's "no error case" hold.
 *
 * The statement is prepared per call because a prepared statement belongs to the connection
 * that made it, and this module owns no connection: the handle is the caller's, as ports and
 * adapters require. SQLite caches the compiled statement itself, so the per-call
 * `prepare` allocates no plan of its own.
 *
 * Nothing is written, counted or amended here: a read of this table changes no row, appends no
 * audit event and increments no figure.
 */
function listSponsoredSlots(database: Database): SponsoredSlotListItem[] {
  return database.prepare<[], SponsoredSlotRow>(SELECT_ALL_SLOTS).all().map(toSponsoredSlotListItem);
}

/**
 * Registers this group's one route — `GET /sponsored-slots` — on the instance it is handed.
 *
 * The path is prefix-relative: the versioned prefix — `API_PREFIX`, from
 * `apps/api/src/server.ts` — is applied exactly once, by `./register-routes`, which calls this
 * function with its encapsulated scope. That literal appears nowhere in this file and must not:
 * a group that spelled it would be the second place the prefix is decided.
 *
 * The registered route is a public read and carries no route options at all: no `schema` (no
 * parameter and no error case to validate), no rate-limit configuration (the write limit does
 * not apply to a read) and no handler-local error handling, because a public read that can
 * fail its documented contract would be the defect. The response is built as
 * {@link SponsoredSlotListResult} before it is sent, so the collection's shape is fixed here
 * rather than at the serializer.
 */
export function registerSponsoredRoutes(app: FastifyInstance, context: SponsoredRouteContext): void {
  app.get("/sponsored-slots", (_request, reply) => {
    const result: SponsoredSlotListResult = { items: listSponsoredSlots(context.database) };
    return reply.code(200).send(result);
  });
}
