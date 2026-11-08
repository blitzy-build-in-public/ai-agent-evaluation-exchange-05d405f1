/**
 * The single insert path into `audit_events`, the operator-facing log of what the
 * API wrote.
 *
 * One member of the vocabulary below belongs to each write path of the contract
 * table, and the route files under `apps/api/src/routes/` call
 * {@link appendAuditEvent} as the last step inside the write's own transaction, so
 * every accepted write leaves a row an operator reads back through
 * `GET /api/v1/audit-events`. That read and this write are the whole of the
 * table's surface: no route updates a row and no route deletes one.
 *
 * This log answers *what was written* — who acted and how the request ended.
 * `@adem/sgi-core`'s `governance_events` answers *what was decided*, and why, and
 * is appended only through that package's `appendEvent`. The two are separate
 * tables written by separate modules, and neither is a view over the other: a
 * moderation action appends to both within one transaction — a governance event
 * through the domain package and an audit row through this function — because a
 * reader of the moderation trail and a reader of the write feed are asking
 * different questions, and one record cannot answer both. This module never
 * imports `@adem/sgi-core` and never writes `governance_events`.
 *
 * A row accepts exactly one kind of write: a newly inserted one. No statement here
 * updates or deletes, and none carries an upsert clause — `INSERT OR REPLACE` is
 * deliberately absent because SQLite documents it as bypassing a DELETE trigger,
 * and `INSERT OR IGNORE` would silently drop the record of a write that did
 * happen. `audit_events` is one of the nine append-only tables that
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards with a
 * `BEFORE UPDATE` and a `BEFORE DELETE` trigger raising `ABORT`. Those triggers are
 * defence in depth and never a security boundary, because a connection holding
 * write access can drop one; what holds is that no route offers the change, and
 * `apps/api/test/integration/immutability.test.ts` is what proves it.
 *
 * A row carries exactly the five facts an audited write fixes — actor, action,
 * resource, status and reason — and nothing more. The one value a caller passes on
 * from a request is `reason`: the single field the decision itself states, handed
 * over as the route's schema validated it, and never a string this layer assembled
 * from a body, a header value or a query string. No column here holds anything about
 * a person: this product holds no real personal information anywhere, and
 * `npm run scan:exclusions` fails the build on a finding.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens
 * no connection, reads no environment variable, resolves no path and touches no
 * file.
 */

import { randomUUID } from "node:crypto";
import type { AuditResourceType } from "@adem/shared";
// The handle's type is imported by name because `@types/better-sqlite3` declares
// the instance shape as a member of the namespace its `export =` also exports, so a
// default *type* import of that package resolves to the namespace rather than to a
// type and does not compile.
import type { Database } from "better-sqlite3";

/**
 * The closed action vocabulary: one value per write path of the contract table, in
 * the order the table names its rows, spelled `<resource>.<verb>`.
 *
 * The column it fills is deliberately unconstrained `TEXT` — migration `0009` gives
 * its two open vocabularies the reason `0007` gives for `governance_events`: a row
 * here can never be corrected, so a `CHECK` enumerating today's kinds could refuse
 * a legitimate later one for good. That makes this tuple, with {@link AuditAction}
 * derived from it, the one thing that closes the vocabulary: a route writes a
 * member of it or fails to compile, so the operator feed holds a vocabulary rather
 * than free text. Closing the write side here is deliberate and is where the
 * closing belongs — the stored row reports what the column holds, and the row type
 * in `@adem/shared` keeps `action` a plain `string` for that reason. Widening this
 * parameter back to `string` would leave the feed holding whatever a route passed;
 * narrowing the row type instead would claim a constraint the schema does not have.
 *
 * Each value's trailing comment names the `resourceType` the route passes with it
 * and the `statusCode` it returns, so the pairing lives beside the vocabulary
 * instead of in a second list that could drift from it.
 */
export const AUDIT_ACTIONS = Object.freeze([
  "listing.created", // listing, 201 — POST /listings
  "listing.version_created", // listing_version, 201 — POST /listings/{id}/versions
  "inquiry.created", // inquiry, 201 — POST /inquiries
  "challenge.created", // challenge, 201 — POST /challenges
  "challenge.responded", // challenge_response, 201 — POST /challenges/{id}/responses
  "thread.created", // thread, 201 — POST /threads
  "thread.post_created", // thread_post, 201 — POST /threads/{id}/posts
  "proposal.submitted", // standard_proposal, 201 — POST /standards/proposals
  "proposal.reviewed", // standard_proposal, 200 — POST /standards/proposals/{id}/review
  "evaluation.created", // evaluation_report, 201 — POST /evaluations
  "appeal.opened", // appeal, 201 — POST /evaluations/{id}/appeals
  "appeal.ruled", // appeal, 200 — POST /appeals/{id}/ruling
  "checkout.simulated", // transaction, 201 — POST /checkout-simulations
  "refund.created", // refund, 201 — POST /transactions/{id}/refunds
  "moderation.flagged", // listing, 200 — POST /moderation/listings/{id}/actions, action flag
  "moderation.hidden", // listing, 200 — POST /moderation/listings/{id}/actions, action hide
  "moderation.restored", // listing, 200 — POST /moderation/listings/{id}/actions, action restore
] as const);

/** The action one `audit_events` row records — see {@link AUDIT_ACTIONS}. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What a caller supplies to {@link appendAuditEvent}: the five facts an audited
 * write fixes, minus the two this module generates.
 *
 * The members are camelCase where the stored columns are snake_case. The four
 * identifying facts are required — there is no default action, no default resource
 * type and no fallback actor — and `reason` is optional because most audited writes
 * state none.
 */
export interface AuditEventInput {
  /** `accounts.id` of the demo account whose role authorised the write. */
  readonly actorAccountId: string;
  /** Which action was performed, from the closed vocabulary above. */
  readonly action: AuditAction;
  /** Which resource the write acted on, from the shared closed list. */
  readonly resourceType: AuditResourceType;
  /** Identifier of the row the write created or acted on. */
  readonly resourceId: string;
  /** The HTTP status the write answers with, as the route is about to send it. */
  readonly statusCode: number;
  /**
   * The caller's own single stated ground for the write, where the write states one, and absent
   * where it states none. An absent reason is stored as SQL `NULL`, never as `""`: the column is
   * nullable and the row type declares `string | null`, so a row whose write stated no ground
   * reports the absence rather than an empty string, and a caller that has none passes no member at
   * all.
   *
   * The routes under `apps/api/src/routes/` that state one pass that decision's own field and nothing
   * else: `moderation.ts` the operator's schema-validated reason for the action it applies,
   * `standards.ts` the operator's ground for a proposal review, and `appeals.ts` the developer's
   * ground for an opening and the operator's for a ruling. Every other audited write states none.
   *
   * What may never reach this member is anything *beyond* that one stated field: no header value, no
   * query string, no text assembled or concatenated from several request members, and never a driver
   * message, a stack frame or a path. The feed records what was written, so a row carrying request
   * text of its own would be a second and weaker copy of the request rather than a reason for it.
   */
  readonly reason?: string;
}

/**
 * The bounds `audit_events.status_code`'s `CHECK` constraint holds a status inside,
 * in migration `0009`.
 *
 * Restated here so a caller's defect is refused as a {@link RangeError} naming the
 * argument, rather than as a `SQLITE_CONSTRAINT` abort raised in the middle of the
 * caller's transaction — after its domain write has already been made and before
 * the response the route was composing.
 */
const MIN_STATUS_CODE = 100;
const MAX_STATUS_CODE = 599;

/**
 * Refuses a required identifier that is absent or blank.
 *
 * A programming defect rather than a client condition: a route resolves every one of
 * these values before it calls, and nothing in this module validates a request.
 */
function requireIdentifier(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `apps/api: appendAuditEvent requires a non-empty ${name}, received ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Appends one audit event to the append-only feed and returns the created row's id.
 *
 * The id is generated here with `randomUUID()` and the timestamp from
 * `new Date().toISOString()` — an ISO-8601 **UTC** instant with milliseconds and a
 * trailing `Z`, never SQLite's `CURRENT_TIMESTAMP`, whose `YYYY-MM-DD HH:MM:SS` form
 * is neither. Both are generated at insert time because a row records the instant it
 * was written; the id is returned so the calling route can answer with it and a test
 * can read the row back.
 *
 * One row is inserted, through the eight columns of `audit_events` in the order
 * migration `0009` declares them. No rowid is chosen or set: the feed's read —
 * `GET /api/v1/audit-events`, ordered by `created_at` and then by rowid — needs the
 * implicit rowid to break a tie between two rows written in the same millisecond, so
 * every row must be an ordinary insert.
 *
 * The statement is deliberately **not** wrapped in `db.transaction(...)`. A single
 * statement is already atomic, and this function has to participate cleanly in a
 * caller's open transaction: a route performs its domain write and this append inside
 * one transaction, which is what makes a write and the record of it indivisible — a
 * route that throws after this call leaves neither the domain row nor the audit row
 * behind. Nothing is committed here either, for the same reason.
 *
 * @param database - The caller's database handle.
 * @param input - The five facts of the write. The id and the timestamp are not among
 * them because this function generates both.
 * @returns The id of the appended row.
 * @throws {TypeError} When `actorAccountId`, `action`, `resourceType` or
 * `resourceId` is absent or blank.
 * @throws {RangeError} When `statusCode` is not an integer within the 100-599 range
 * the column accepts.
 */
export function appendAuditEvent(database: Database, input: AuditEventInput): string {
  requireIdentifier(input.actorAccountId, "actorAccountId");
  requireIdentifier(input.action, "action");
  requireIdentifier(input.resourceType, "resourceType");
  requireIdentifier(input.resourceId, "resourceId");

  if (
    !Number.isInteger(input.statusCode) ||
    input.statusCode < MIN_STATUS_CODE ||
    input.statusCode > MAX_STATUS_CODE
  ) {
    throw new RangeError(
      `apps/api: appendAuditEvent requires an integer statusCode between ${MIN_STATUS_CODE} and ${MAX_STATUS_CODE}, received ${String(input.statusCode)}`,
    );
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO audit_events
         (id, actor_account_id, action, resource_type, resource_id, status_code, reason, created_at)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.actorAccountId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.statusCode,
      input.reason ?? null,
      createdAt,
    );

  return id;
}
