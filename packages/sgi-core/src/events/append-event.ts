/**
 * The single insert path into `governance_events`, ADEM's append-only log of the
 * domain decisions the Standard Gate Index records.
 *
 * One member of the vocabulary below belongs to each append site — a standard
 * version's publication, a standards-proposal review, a listing moderation action, an
 * appeal's opening, an appeal's ruling and a retest — and nothing else writes here. A
 * row accepts exactly one kind of write, a newly inserted one, so no statement in this
 * module carries an upsert clause and this module never updates and never deletes.
 *
 * `governance_events` is one of the nine append-only tables that
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards with a
 * `BEFORE UPDATE` and a `BEFORE DELETE` trigger raising `ABORT`. Those triggers are
 * defence in depth and never a security boundary, because a connection holding write
 * access can drop one; what holds is that no route offers the mutation.
 *
 * This log answers *what was decided*. `apps/api`'s `audit_events` answers *what was
 * written*, is appended by the API layer, and is deliberately a separate table: a
 * reader chooses one of the two per question, and neither is a view over the other.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no
 * connection, reads no environment variable, resolves no path and touches no file.
 */

import { randomUUID } from "node:crypto";
import { GOVERNANCE_EVENT_TYPES as SHARED_GOVERNANCE_EVENT_TYPES } from "@adem/shared";
import type { JsonValue } from "@adem/sgi-fixtures";
import type { Database } from "better-sqlite3";
import { canonicalize } from "../scoring/canonical-json";

/**
 * The closed vocabulary of governance event types: the only values this module writes
 * to `governance_events.event_type`, and the set a reader of the trail switches on.
 *
 * Migration `0007_governance_events_and_appeals.sql` leaves `event_type` unconstrained
 * `TEXT` and says why — a row here can never be corrected, so a `CHECK` enumerating
 * today's kinds could refuse a legitimate later one for good. The vocabulary is
 * therefore held by the writing code, by the guard in {@link appendEvent}, rather than
 * by the schema.
 *
 * It is declared once, in `@adem/shared`, and re-exported here rather than restated as a
 * second local tuple. One contract therefore has one declaration site — the moderation
 * contract's own documentation already cites these values and this module as their
 * writer — and a local copy would be free to drift from it. Freezing the array keeps
 * the runtime list closed, and {@link GovernanceEventType} is derived from it below, so
 * a member added to or removed from the shared tuple is a compile error at every call
 * site instead of a value the guard refuses at run time.
 *
 * The set is closed for the same reason the appender list is: every consumer of the
 * trail switches on these values, so a spelling the documents do not describe is a
 * revision of the plan rather than a local choice.
 */
export const GOVERNANCE_EVENT_TYPES = Object.freeze(SHARED_GOVERNANCE_EVENT_TYPES);

/** The kind of governance decision a `governance_events` row records. */
export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number];

/**
 * What a caller supplies to {@link appendEvent}: the decision, who took it, why, and
 * any detail the event carries.
 *
 * The members are camelCase where the stored columns are snake_case. The four that
 * identify the decision are required; `reason` and `payload` are optional because a row
 * can never be corrected, and a decision that carries neither must store the absence
 * rather than a fabricated one. A `reason` of `null` and a `payload_json` of `null` are
 * what the table holds for those two kinds — a retest and a standard version's
 * publication — while an event that states a reason stores it, and nothing here imposes
 * a non-emptiness rule on one.
 *
 * `subjectType` is deliberately an open string rather than a closed union: the plan
 * closes the vocabulary of event types only, and closing the subject set here would
 * refuse a legitimate appender and freeze spellings the documents do not describe. The
 * three spellings the appenders of this package and the API use are `standard_proposal`,
 * `appeal` and `listing`; they are named here as the ones in use, and are not enforced.
 *
 * `payload` is a JSON value and is stored as canonical JSON, so two runs that append
 * the same payload store byte-identical text.
 */
export interface NewGovernanceEvent {
  /** Which kind of row `subjectId` names, as the appender spells it. */
  readonly subjectType: string;
  /** Identifier of the row the decision concerns, of the kind above. */
  readonly subjectId: string;
  /** Which decision was recorded, from the closed vocabulary above. */
  readonly eventType: GovernanceEventType;
  /** The account that caused the decision, referencing `accounts.id`. */
  readonly actorAccountId: string;
  /**
   * The decision's stated reason, or absent where it carries none — a retest and a
   * standard version's publication decide by what they point at and store the absence
   * rather than a fabricated string. An **empty string is permitted** where a caller
   * has one to give: no non-emptiness rule is fixed for a governance event, so the
   * vocabulary above is this module's only refusal.
   */
  readonly reason?: string;
  /**
   * Any further detail the event carries, or absent where it carries none. A payload
   * that is present is stored as canonical JSON, and JSON's own null is a value a
   * caller may state, distinct from the absent payload stored as SQL `NULL`.
   */
  readonly payload?: JsonValue;
}

/**
 * One appended `governance_events` row: the caller's decision plus the two values this
 * module generates.
 *
 * A caller reads a row of the append-only log as this type rather than as the stored
 * snake_case shape, and the two members below are what makes one row distinguishable
 * from another: `id` addresses it, and `createdAt` orders the trail.
 */
export interface GovernanceEvent extends NewGovernanceEvent {
  /** Identifier of the appended row, generated on insert. */
  readonly id: string;
  /** The instant the row was written, as an ISO-8601 UTC string. */
  readonly createdAt: string;
}

/**
 * The refusal of an event type outside {@link GOVERNANCE_EVENT_TYPES}.
 *
 * It is declared here because a refusal belongs to the module that owns its rule, and
 * because there is deliberately no shared errors module: the guard below is the rule,
 * and this is the only failure this module raises.
 *
 * `eventType` carries the rejected value so a caller can log it. The message names the
 * value and begins `sgi-core:` so a scan of a log finds the package that refused,
 * never a stack trace or a bare "invalid input".
 */
export class UnknownEventTypeError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  readonly code = "unknown_event_type";

  /** The event type that was refused. */
  readonly eventType: string;

  /**
   * Builds the refusal for one offending value.
   *
   * @param eventType - The value that was not a member of the vocabulary.
   */
  constructor(eventType: string) {
    super(
      `sgi-core: ${eventType} is not a governance event type; the vocabulary is ${GOVERNANCE_EVENT_TYPES.join(", ")}`,
    );
    this.name = "UnknownEventTypeError";
    this.eventType = eventType;
  }
}

/**
 * Appends one governance event to the append-only log and returns it.
 *
 * The function refuses an event type outside the closed vocabulary before it writes
 * anything, raising {@link UnknownEventTypeError}; that is this module's **only**
 * refusal, so a caller may append an event with an empty `reason`, and is never made to
 * police a rule the plan does not state.
 *
 * For an accepted event it generates `id` from `randomUUID()`, takes `createdAt` from
 * `new Date().toISOString()` — an ISO-8601 **UTC** instant with milliseconds and a
 * trailing `Z`, never SQLite's `CURRENT_TIMESTAMP`, whose `YYYY-MM-DD HH:MM:SS` form
 * carries neither — canonicalises a supplied `payload` through `canonicalize` rather
 * than `JSON.stringify`, so a stored payload is byte-stable across runs, stores SQL
 * `NULL` for a reason or a payload the event does not carry, and inserts exactly one
 * row with a plain `INSERT` and **named** parameters, so a column and a value cannot be
 * swapped. Neither upsert clause is used: `INSERT OR REPLACE` would bypass the
 * append-only `DELETE` trigger and `INSERT OR IGNORE` would silently drop an event.
 *
 * The statement is deliberately **not** wrapped in `db.transaction(...)`. A single
 * statement is already atomic, and this function has to participate cleanly in a
 * caller's open transaction: a proposal review and an appeal ruling each change a row's
 * status and append the event inside one transaction of their own, which is what makes
 * the change and its audit record indivisible.
 *
 * No other table is read. `accounts`, `listings` and `listing_versions` belong to
 * `apps/api`, and `governance_events` carries the polymorphic `subject_type` /
 * `subject_id` pair precisely so no foreign key to another module's table is needed;
 * the only foreign key on the row is `actor_account_id`, which the database enforces
 * and this module never queries.
 *
 * @param db - The caller's database handle.
 * @param event - The decision to append.
 * @returns The appended event, built from the input and the generated id and timestamp
 * rather than re-read: the row is immutable, so a re-read would prove nothing and cost
 * an extra read.
 * @throws {UnknownEventTypeError} When `event.eventType` is not a member of
 * {@link GOVERNANCE_EVENT_TYPES}.
 */
export function appendEvent(db: Database, event: NewGovernanceEvent): GovernanceEvent {
  if (!GOVERNANCE_EVENT_TYPES.some((type) => type === event.eventType)) {
    throw new UnknownEventTypeError(event.eventType);
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const { reason, payload } = event;
  const payloadJson = payload === undefined ? null : canonicalize(payload);

  db.prepare(
    `INSERT INTO governance_events
       (id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at)
     VALUES
       (@id, @subjectType, @subjectId, @eventType, @actorAccountId, @reason, @payloadJson, @createdAt)`,
  ).run({
    id,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    eventType: event.eventType,
    actorAccountId: event.actorAccountId,
    reason: reason ?? null,
    payloadJson,
    createdAt,
  });

  return {
    id,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    eventType: event.eventType,
    actorAccountId: event.actorAccountId,
    createdAt,
    ...(reason === undefined ? {} : { reason }),
    ...(payload === undefined ? {} : { payload }),
  };
}
