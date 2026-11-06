/**
 * The append-only governance event and its two closed vocabularies.
 *
 * `governance_events` is the domain-decision log, and it answers one question:
 * *what was decided*. Its sibling `audit_events`, typed in `./audit-event.ts`,
 * is the operator-facing write log, and it answers *what was written*. Both are
 * append-only; a reader should reach for exactly one of them per question.
 *
 * An append-only row accepts exactly one kind of write — a newly inserted row.
 * No function updates or removes one, which is why the row type below carries
 * no member for a last-modified instant and no removal marker.
 * `packages/shared/migrations/0010_append_only_triggers.sql` raises `ABORT` from
 * a `BEFORE UPDATE` or `BEFORE DELETE` attempt against the table, but that
 * trigger is defence in depth and never a security boundary: a connection with
 * write access can drop it. The guarantee is that no route offers the mutation,
 * and `apps/api/test/integration/immutability.test.ts` is what proves it.
 *
 * Governance here is a human decision that gets recorded, never an automatic or
 * externally audited process, and an operator's power is additive only: a
 * listing moderation action, a proposal review and an appeal ruling are all
 * appended here, and none of them can alter a measurement — not a report's
 * outcome, not its per-case evidence, and not a standard version's thresholds.
 */

/**
 * The five subject kinds a governance decision can be recorded against.
 *
 * `subject_type` is paired with `GovernanceEvent.subject_id`, and the id is the
 * id of the row named by the kind: a `listing`, a `standard_proposal`, a
 * `standard_version`, an `evaluation_report` or an `appeal`.
 *
 * The pair is a display and query discriminator, not a foreign key. SQLite
 * cannot enforce a polymorphic reference, so no migration declares a
 * `REFERENCES` clause on `subject_id`, and this type is the only place the
 * pairing is stated. The two vocabularies are orthogonal — `listing_moderated`
 * acts on a `listing` while `appeal_ruled` acts on an `appeal` — which is why
 * they are two tuples rather than one.
 */
export const GOVERNANCE_SUBJECT_TYPES = [
  "listing",
  "standard_proposal",
  "standard_version",
  "evaluation_report",
  "appeal",
] as const;

/** The subject kind a governance event's `subject_type` names. */
export type GovernanceSubjectType = (typeof GOVERNANCE_SUBJECT_TYPES)[number];

/**
 * The six append sites that write a governance event, and the only event types
 * the log holds.
 *
 * The vocabulary is closed so no caller invents a seventh spelling: every
 * consumer of the trail switches on this set, so a new value is a revision of
 * the plan rather than a local choice. The mapping is fixed, one event type per
 * append site:
 *
 * - `standard_version_published` — a newly published standard version is
 *   announced against the `standard_version` it creates. It never amends an
 *   existing version, because a standard version is immutable: a change
 *   publishes a new one, and no event type means "standard updated".
 * - `proposal_reviewed` — an operator moves a standard proposal to `accepted`
 *   or `rejected`.
 * - `listing_moderated` — an operator applies a `flag`, `hide` or `restore`
 *   action to a listing.
 * - `appeal_opened` — a developer opens an appeal against a report.
 * - `appeal_ruled` — an operator rules an appeal `upheld` or `denied`; the
 *   ruling is this event, and the report it concerns is left untouched.
 * - `retest_created` — a new report is created that links to a prior report for
 *   the same candidate version and standard version.
 */
export const GOVERNANCE_EVENT_TYPES = [
  "standard_version_published",
  "proposal_reviewed",
  "listing_moderated",
  "appeal_opened",
  "appeal_ruled",
  "retest_created",
] as const;

/** The kind of governance decision a governance event records. */
export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number];

/**
 * One `governance_events` row: a single appended domain decision, read back in
 * insertion order as the trail behind a listing, a proposal, a standard
 * version, a report or an appeal.
 *
 * `reason` and `payload_json` are nullable rather than optional because the
 * stored value carries an explicit `null`; under
 * `exactOptionalPropertyTypes` an optional member would also admit an explicit
 * `undefined`, which a reader of the payload could not tell from an absent key.
 */
export interface GovernanceEvent {
  /** Identifier of the appended row. */
  id: string;
  /** Which kind of row `subject_id` names. */
  subject_type: GovernanceSubjectType;
  /** Identifier of the row the decision concerns, of the kind above. */
  subject_id: string;
  /** Which decision was recorded. */
  event_type: GovernanceEventType;
  /**
   * The account that caused the decision, referencing `accounts.id` — one of
   * the synthetic demo accounts, never a real identity.
   */
  actor_account_id: string;
  /**
   * The stated reason where a human decision carries one — a moderation
   * action's reason is required by the API contract — and `null` where the
   * event kind needs none, such as a `retest_created`.
   */
  reason: string | null;
  /**
   * Serialized JSON text holding any extra detail the event carries, or `null`
   * when it carries none. It is typed as the stored string rather than as a
   * parsed object, because that is what the column holds; a consumer parses it
   * and treats it as context, never as the criteria a report was scored against.
   */
  payload_json: string | null;
  /** ISO-8601 UTC instant written at insert time. */
  created_at: string;
}
