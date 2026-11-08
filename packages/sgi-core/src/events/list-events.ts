/**
 * The read path over `governance_events`, ADEM's append-only log of the domain
 * decisions the Standard Gate Index records.
 *
 * The table answers one question — *what was decided*. It holds no state: a row is
 * written once by the sibling `./append-event` and read back as the trail behind a
 * listing, a standard proposal, a standard version, an evaluation report or an appeal.
 * A proposal's review trail, a moderation action's trail and an appeal's ruling trail
 * are therefore all readable from here, which is what lets a ruling be recorded, and
 * its history kept, while the report it concerns stays byte-identical.
 *
 * The log is append-only: no export in this folder updates or deletes a row, and
 * `packages/shared/migrations/0010_append_only_triggers.sql` raises `ABORT` from a
 * `BEFORE UPDATE` and a `BEFORE DELETE` trigger on the table. Those triggers are
 * defence in depth and never a security boundary — a connection holding write access
 * can drop one — so what holds is that no route offers the mutation.
 *
 * This module refuses nothing. A filter that matches no row is an ordinary empty
 * result: *no such subject* and *a subject with no history yet* both answer `[]`,
 * because the product renders an explanation for an empty trail rather than an error
 * trace. The asymmetry with the writer is deliberate — {@link appendEvent} guards the
 * closed event-type vocabulary and refuses a spelling outside it before it can enter a
 * record that can never be corrected, while a reader asks a question and is answered.
 *
 * Every row was written through `appendEvent`, which stores the payload as the canonical
 * JSON of a JSON value; this module parses that text back to the value and introduces no
 * ordering, formatting or validation rule of its own.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no
 * connection, reads no environment variable, resolves no path and touches no file. It
 * reads one table, `governance_events`, of the seven `@adem/sgi-core` owns — never
 * `apps/api`'s `audit_events`, which is the separate log of what was *written*.
 */

import type { JsonValue } from "@adem/sgi-fixtures";
import type { Database } from "better-sqlite3";
import type { GovernanceEvent, GovernanceEventType } from "./append-event";

/**
 * Which slice of the trail to read: any combination of the three dimensions a row
 * carries, and `{}` for the whole log.
 *
 * Every dimension is optional, and an absent dimension is *not a filter* rather than a
 * filter for an empty value. That is why the three are tested against a bare row in
 * {@link listEvents} with `!== undefined`: a member holding `""` is a stated filter for
 * the empty string, and only an absent member means "do not constrain this dimension".
 * One dimension at a time is the common case — an appeal's ruling trail is read by
 * `subjectId` — and all three together are permitted, because nothing in the plan
 * forbids them.
 *
 * `subjectType` is deliberately an open `string` rather than a closed union, for the
 * reason `NewGovernanceEvent` gives: the plan closes the vocabulary of event types only,
 * and closing the subject set here would refuse a legitimate appender's spelling. The
 * spellings in use are `standard_proposal`, `appeal` and `listing`.
 *
 * `eventType` is the closed union the writer enforces, so a value outside it is a
 * compile error rather than a lookup that silently finds nothing.
 */
export interface EventFilter {
  /** Which kind of row `subjectId` names, as the appender spelled it — e.g. `"appeal"`. */
  readonly subjectType?: string;
  /** Identifier of the row the decisions concern; without it, every row of every subject. */
  readonly subjectId?: string;
  /** Which decision to read — e.g. `"appeal_ruled"`; without it, every kind of decision. */
  readonly eventType?: GovernanceEventType;
}

/**
 * The eight columns this reader selects, named explicitly rather than through `SELECT *`.
 *
 * A row is mapped member by member below, so a column a later migration adds is dropped
 * from the result until this line and the interface beneath it are updated, while
 * `SELECT *` would quietly change the shape of every returned event. These are exactly the
 * columns `0007_governance_events_and_appeals.sql` declares, in its order, so the select
 * list can be compared against the schema by reading one line of each.
 */
const SELECTED_COLUMNS =
  "id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at";

/**
 * One stored row, in the shape the table holds it: the eight snake_case columns of
 * `governance_events`, with the nullability `0007` declares.
 *
 * It is what the prepared statement is parameterised with, which is what removes the need
 * for a cast when the row is mapped: the query names its columns, and this interface is the
 * statement's declared result.
 *
 * `event_type` is typed as the closed {@link GovernanceEventType} although the column is
 * unconstrained `TEXT`, and that is a true statement about what the column holds:
 * `appendEvent` is the single insert path into this table and refuses a value outside the
 * vocabulary before it writes. `subject_type` stays an open `string` for the mirror-image
 * reason — nothing enforces the subject spellings, so nothing here claims to.
 *
 * `reason` and `payload_json` are `string | null` rather than optional, because that is what
 * the columns hold: `appendEvent` stores SQL `NULL` for a reason or a payload a decision
 * does not carry, and {@link toGovernanceEvent} turns that `NULL` back into an absent member.
 */
interface GovernanceEventRow {
  readonly id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly event_type: GovernanceEventType;
  readonly actor_account_id: string;
  readonly reason: string | null;
  readonly payload_json: string | null;
  readonly created_at: string;
}

/**
 * One stored row as the event a caller reads, with the snake_case columns mapped to the
 * camelCase members of {@link GovernanceEvent}.
 *
 * A `NULL` reason or payload becomes an **absent member**, never the value `null`, so a row
 * read back is deeply equal to what `appendEvent` returned for it: the writer omits both
 * members when the decision carries neither, and a reader answering `reason: null` would make
 * a retest's event — which states no ground — differ from itself across the two calls. A
 * payload that is JSON `null` is a value a caller stated, is stored as the text `null`, and
 * comes back as `payload: null`; only SQL `NULL` means "not stated".
 */
function toGovernanceEvent(row: GovernanceEventRow): GovernanceEvent {
  const { reason, payload_json: payloadJson } = row;
  // The stored text is `canonicalize`'s rendering of a JSON value, so parsing it yields a
  // JSON value: annotating the local is where that boundary is stated, and it is why no cast
  // appears anywhere in this module.
  const payload: JsonValue | undefined =
    payloadJson === null ? undefined : JSON.parse(payloadJson);

  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    eventType: row.event_type,
    actorAccountId: row.actor_account_id,
    createdAt: row.created_at,
    ...(reason === null ? {} : { reason }),
    ...(payload === undefined ? {} : { payload }),
  };
}

/**
 * Reads the governance event trail, filtered by any combination of the three dimensions
 * {@link EventFilter} offers.
 *
 * The rows come back in **insertion order** — `ORDER BY created_at ASC, rowid ASC` — so the
 * oldest decision reads first and a trail reads as a history. The `rowid` tie-break is
 * required rather than decorative: `appendEvent` stamps an ISO-8601 instant with millisecond
 * precision, so two decisions appended within the same millisecond would otherwise come back
 * in an order SQLite does not promise. `rowid` appears only in the ordering and is not
 * selected, so it never reaches a returned event; it exists because `governance_events` is an
 * ordinary rowid table, declared without `WITHOUT ROWID`.
 *
 * The ordering is the database's and never this module's: nothing is sorted in TypeScript, so
 * no locale can reorder a trail and the same log reads the same way on any machine.
 *
 * **It returns `[]` when nothing matches and refuses nothing.** An unknown subject id, a
 * subject whose history is empty and an event type no row carries are all an empty result —
 * not `null`, and not a thrown error. The reader's contract is "never an error", which is the
 * one place it deliberately differs from the writer: `appendEvent` refuses an event type
 * outside the closed vocabulary, while a lookup that matches nothing is a correct answer to
 * the question asked.
 *
 * There is no `LIMIT`, no page size and no aggregation. The plan fixes no page size for this
 * read, so a review trail or a ruling trail is read whole; the `(subject_type, subject_id)`
 * index from `packages/shared/migrations/0011_indexes.sql` serves the subject filters. A
 * caller that needs a count takes it from the array it was returned.
 *
 * @param db - The caller's database handle.
 * @param filter - Which slice of the trail to read; `{}` for all of it. An absent dimension
 * does not constrain the query, and a dimension holding an empty string is a filter for the
 * empty string, as it is stated.
 * @returns The matching events, oldest first, or `[]` when none match.
 */
export function listEvents(db: Database, filter: EventFilter): GovernanceEvent[] {
  // Conditions and their parameters accumulate together, so the order of the placeholders
  // and the order of the values can never drift apart.
  const conditions: string[] = [];
  const parameters: string[] = [];

  if (filter.subjectType !== undefined) {
    conditions.push("subject_type = ?");
    parameters.push(filter.subjectType);
  }
  if (filter.subjectId !== undefined) {
    conditions.push("subject_id = ?");
    parameters.push(filter.subjectId);
  }
  if (filter.eventType !== undefined) {
    conditions.push("event_type = ?");
    parameters.push(filter.eventType);
  }

  // A filter with no dimension present carries no `WHERE` clause at all, rather than one that
  // is always true: the whole log is a stated question, not a degenerate case of a filtered one.
  const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
  const sql = `SELECT ${SELECTED_COLUMNS} FROM governance_events${where} ORDER BY created_at ASC, rowid ASC`;

  return db
    .prepare<string[], GovernanceEventRow>(sql)
    .all(...parameters)
    .map(toGovernanceEvent);
}
