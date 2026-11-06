/**
 * The `audit_events` row — the operator-facing feed of writes — and the closed list of resources
 * its `resource_type` column may name.
 *
 * This module declares one vocabulary and one row shape and nothing else: the append point is
 * `apps/api/src/audit/append-audit-event.ts`, the only read is the operator-only `GET /audit-events`
 * served by `apps/api/src/routes/audit.ts`, and no logic belongs between them.
 */

/**
 * The twelve resources the contract table's write rows act on, in the order the contract names
 * them.
 *
 * `challenge_response` and `thread_post` are separate from their parents because writes reach them
 * through their own routes; collapsing them would lose the difference between starting a challenge
 * and answering one. Operator decisions are recorded in `governance_events` as well, and their
 * audit row is written against the resource acted on — `standard_proposal` for a proposal review,
 * `listing` for a moderation action — because the two logs answer different questions and neither
 * substitutes for the other.
 */
export const AUDIT_RESOURCE_TYPES = [
  "listing", // POST /listings
  "listing_version", // POST /listings/{id}/versions
  "inquiry", // POST /inquiries
  "challenge", // POST /challenges
  "challenge_response", // POST /challenges/{id}/responses
  "thread", // POST /threads
  "thread_post", // POST /threads/{id}/posts
  "standard_proposal", // POST /standards/proposals
  "evaluation_report", // POST /evaluations
  "appeal", // POST /evaluations/{id}/appeals, POST /appeals/{id}/ruling
  "transaction", // POST /checkout-simulations
  "refund", // POST /transactions/{id}/refunds
] as const;

/**
 * One of {@link AUDIT_RESOURCE_TYPES}. The list is closed because the contract table enumerates its
 * write rows; a new audited resource arrives by adding a value here, never by widening the union
 * elsewhere.
 */
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

/**
 * One row of `audit_events`: written once, as the last step of a write request, and never amended.
 *
 * This is the feed of what was *written*; `governance_events` is the feed of what was *decided*.
 * Both are append-only — the only write either accepts is an inserted new row — which is why this
 * shape carries no amendment field. The `BEFORE UPDATE` and `BEFORE DELETE` triggers in
 * `packages/shared/migrations/0010_append_only_triggers.sql` back that rule up as defence in depth
 * and never as a security boundary, since a connection with write access can drop one; the
 * guarantee that no route updates or deletes a row is held by the routes themselves.
 *
 * The fields carry exactly the five facts an audited write fixes — actor, action, resource, status
 * and reason — and nothing more: no request body, no request metadata and no data about a person.
 * The product collects no personal information and counts no analytics, so this row is not the
 * place to add either.
 */
export interface AuditEvent {
  /** Primary key of the row, generated when it is inserted. */
  id: string;
  /**
   * `accounts.id` of the demo account whose role authorised the write — one of the six synthetic
   * accounts. It names a role for demonstration and asserts nothing about who the caller is.
   */
  actor_account_id: string;
  /**
   * The action performed, as free-form text.
   *
   * No enumerable action vocabulary exists in this codebase, so the field is a plain `string` and
   * MUST NOT be narrowed to a union or an enum: doing so would invent identifiers nothing defines.
   * The route's HTTP method and path are the natural value.
   */
  action: string;
  /** The resource the write acted on, from the closed list above. */
  resource_type: AuditResourceType;
  /** Primary key of the row the write created or acted on. */
  resource_id: string;
  /**
   * The HTTP status the write returned, so a refused write is as auditable as an accepted one
   * wherever the route records it. Every recorded write has a status, hence a required field.
   */
  status_code: number;
  /**
   * The stated reason where the write carries one — a moderation action's reason, an appeal
   * ruling's reason — and an explicit `null` where it does not. Nullable rather than optional, so
   * the row always states the absence instead of leaving it undefined.
   */
  reason: string | null;
  /** Write time, as an ISO-8601 UTC string. */
  created_at: string;
}
