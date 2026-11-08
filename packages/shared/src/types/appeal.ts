/**
 * The report appeal, its rulings, and the report that a ruling leaves untouched.
 *
 * An appeal is the developer's way to contest a report: it is opened against one
 * `evaluation_reports` row with a stated reason, and it is resolved by an operator's
 * ruling. A ruling appends a governance event; it never changes the appealed report.
 */

/**
 * The closed status vocabulary of an `appeals` row, matching the `status` `CHECK`
 * constraint in migration `0007_governance_events_and_appeals.sql`.
 *
 * `open` is the initial state an appeal is created in; `upheld` and `denied` are the
 * two terminal outcomes a ruling may set. Nothing else is a status, so a row is either
 * awaiting a ruling or finished with one.
 */
export const APPEAL_STATUSES = ['open', 'upheld', 'denied'] as const;

/** The status of an appeal: `open` while awaiting a ruling, then `upheld` or `denied`. */
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

/**
 * The outcomes an operator's ruling may set, and deliberately not the same set as
 * {@link APPEAL_STATUSES}: `open` is absent because it is not an outcome a client may
 * submit. `packages/shared/src/schemas/evaluations-schema.ts` uses this tuple as the
 * `enum` of the ruling body, so a request cannot "rule" an appeal back to `open` and
 * an appeal that already carries a terminal status stays the contract's `409`.
 */
export const APPEAL_RULINGS = ['upheld', 'denied'] as const;

/** The outcome of an appeal ruling: `upheld` or `denied`, never `open`. */
export type AppealRuling = (typeof APPEAL_RULINGS)[number];

/**
 * One `appeals` row: a developer's challenge to a single evaluation report.
 *
 * A ruling appends a `governance_event` and leaves the evaluation report
 * **byte-identical** — after a ruling, `GET /evaluations/{id}` returns the same report,
 * with the same per-case evidence and the same outcome, which is the immutability
 * guarantee an appeal demonstrates. `report_id` references `evaluation_reports.id`,
 * which is one of the nine append-only tables, so nothing in this flow may write to it.
 *
 * Because the ruling history lives in `governance_events` and not in this row, `status`
 * is the row's only mutable column: the row records neither who ruled the appeal nor
 * when, and it carries no ruling reason — the reason a ruling carries is appended as an
 * event's payload, typed in the sibling `governance-event.ts`. By the same rule the row
 * carries no field through which a caller could express a change to a report: no
 * replacement outcome, no amended case count, no link that displaces the report being
 * appealed. Any such field would imply an update route that must not exist.
 *
 * An upheld appeal certifies nothing and changes no badge: the report's label stays
 * `SAMPLE` or `VERIFIED-IN-DEMO`.
 */
export interface Appeal {
  /** Appeal identifier. */
  id: string;
  /** The appealed report, referencing `evaluation_reports.id`. */
  report_id: string;
  /** The developer that opened the appeal, referencing `accounts.id`. */
  developer_account_id: string;
  /** The developer's stated ground for contesting the report. */
  reason: string;
  /** `open` until ruled, then `upheld` or `denied` — the row's only mutable column. */
  status: AppealStatus;
  /** ISO-8601 UTC timestamp written when the appeal was opened. */
  created_at: string;
}

/**
 * The `POST /evaluations/{id}/appeals` body, written by a **developer**.
 *
 * The report comes from the **path**, never from the body, so this body cannot be used
 * to appeal a report the caller did not target. The appellant's identity comes from the
 * resolved demo session rather than from any field here: a missing or unresolvable
 * `X-Demo-Account` header is `401`, a resolved account whose role is not `developer` is
 * `403`, and an unknown report is `404`. The role is the whole of the check that route
 * makes — it performs no ownership lookup, deliberately, so any developer may appeal any
 * report. The reason is required because an appeal is opened against a report *with a
 * stated reason*.
 */
export interface AppealCreateBody {
  /** The developer's stated ground for contesting the report; required. */
  reason: string;
}

/**
 * The `POST /appeals/{id}/ruling` body, written by the **operator**.
 *
 * The field is named `status` because it is the column the ruling sets on the appeal.
 * An appeal that already carries a terminal status is the contract's `409`, which is
 * why `open` does not appear in {@link APPEAL_RULINGS}. The ruling is a human decision
 * recorded as an appended governance event, never an automated recomputation, and this
 * body touches no report: the operator's power is additive only and cannot alter a
 * measurement.
 *
 * `reason` is optional and, under `exactOptionalPropertyTypes`, is either absent or a
 * string — never explicitly `undefined`. When present it travels into the appended
 * event's payload.
 */
export interface AppealRulingBody {
  /** The outcome the operator rules: `upheld` or `denied`. */
  status: AppealRuling;
  /** The operator's ground for the ruling, carried into the appended event. */
  reason?: string;
}
