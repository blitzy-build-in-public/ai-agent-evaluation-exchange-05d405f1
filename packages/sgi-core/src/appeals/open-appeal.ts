/**
 * Opening an appeal: a developer's challenge to one evaluation report.
 *
 * An appeal is how a developer contests a report and how an operator answers that
 * challenge. This module creates the appeal; its sibling `rule-appeal.ts` rules it
 * `upheld` or `denied`. The pair exists to demonstrate the product's immutability
 * guarantee from the outside: a ruling moves the appeal's own `status` and appends a
 * governance event, while the appealed `evaluation_reports` row stays byte-identical —
 * which is what `GET /evaluations/{id}` proves by returning the same report after a
 * ruling.
 *
 * Two decisions are stated here, because the code alone would leave each open to
 * misreading:
 *
 * 1. **No ownership lookup, deliberately.** Resolving whether the named developer owns
 *    the appealed report would mean reading `listings` and `listing_versions`, which
 *    `apps/api` owns, and the API contract already supplies that answer as the write
 *    route's `403` from the resolved demo-account role. `developerAccountId` is
 *    therefore taken as given and never checked against the report: adding the check
 *    here would put a read of another owner's tables inside this package.
 * 2. **Opening an appeal appends one governance event.** An appeal's opening is itself a
 *    governance decision — a developer has contested a measurement — so it is recorded in
 *    the append-only log alongside the ruling that later answers it, through the package's
 *    single insert path into that log, `../events/append-event`. The vocabulary's member
 *    for this site is `appeal_opened`, and the event carries the developer's stated ground
 *    exactly as the row does, because an appeal opened states the ground it rests on, and
 *    names the report it contests. The `appeals` row is the appeal's current state; the
 *    event is the record of its opening, which a reader of the trail still finds after the
 *    row's `status` has moved on.
 *
 * The `appeals` table is deliberately not one of the nine append-only tables and carries
 * no `RAISE(ABORT)` trigger, which is what makes a ruling's later `UPDATE` legal: its
 * `status` is the row's only mutable column. `evaluation_reports` is append-only and
 * nothing here touches it — this module reads that table and writes one appeal with the
 * event that records its opening.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no
 * connection, reads no environment variable and resolves no filesystem path.
 */

import { randomUUID } from "node:crypto";
import type { AppealStatus } from "@adem/shared";
import type { Database } from "better-sqlite3";
import { appendEvent } from "../events/append-event";

/**
 * One `appeals` row as the domain reads it: the developer's challenge to a single
 * evaluation report.
 *
 * The members are camelCase where the stored columns are snake_case — `reportId` is
 * `report_id`, `developerAccountId` is `developer_account_id`, `createdAt` is
 * `created_at` — and `apps/api/src/routes/appeals.ts` maps this type onto the wire shape
 * `@adem/shared` declares for the same row.
 *
 * `status` is the row's **only mutable column**: a ruling moves it from `open` to
 * `upheld` or `denied`, and the ruling history lives in `governance_events` rather than
 * here, so the row records neither who ruled it nor when. `reason` is the developer's own
 * stated ground and is never rewritten by anyone — it is evidence, and it is stored
 * exactly as submitted.
 */
export interface Appeal {
  /** Identifier of the appeal, generated when it is opened. */
  readonly id: string;
  /** The appealed report, referencing `evaluation_reports.id`. */
  readonly reportId: string;
  /** The developer that opened the appeal, referencing `accounts.id`. */
  readonly developerAccountId: string;
  /** The developer's stated ground for contesting the report, stored verbatim. */
  readonly reason: string;
  /** `open` until ruled, then `upheld` or `denied`; the only mutable column. */
  readonly status: AppealStatus;
  /** ISO-8601 UTC instant written when the appeal was opened. */
  readonly createdAt: string;
}

/**
 * The refusal of an appeal against a report that does not exist.
 *
 * It is declared here because a refusal belongs to the module that owns its rule, and
 * because this package deliberately has no shared errors module. `apps/api` maps `code`
 * to the contract's **404**, and the message begins `sgi-core:` so a scan of a log finds
 * the package that refused rather than a bare "not found".
 */
export class ReportNotFoundError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  readonly code = "not_found";

  /**
   * Builds the refusal for one unknown report id.
   *
   * @param reportId - The id no `evaluation_reports` row carries.
   */
  constructor(reportId: string) {
    super(`sgi-core: no evaluation report has id ${reportId}`);
    this.name = "ReportNotFoundError";
  }
}

/**
 * The refusal of an appeal whose stated reason is empty or nothing but whitespace.
 *
 * `apps/api` maps `code` to the contract's **400**. `field` names the offending member so
 * a caller can attach the failure to the form control that produced it; it is the whole
 * of this refusal beyond the error machinery, because the rule is a single field's.
 */
export class InvalidAppealError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  readonly code = "invalid_appeal";

  /** The member of the request body the rule applies to. */
  readonly field: "reason" = "reason";

  /** Builds the refusal; the reason's value is not repeated, to keep a log free of it. */
  constructor() {
    super("sgi-core: an appeal requires a stated reason, and a blank reason states none");
    this.name = "InvalidAppealError";
  }
}

/**
 * Opens one appeal against an evaluation report and returns it.
 *
 * Three steps, in this order, because the order is part of the contract:
 *
 * 1. **The stated reason is validated first**, before any read: a `reason` that is empty
 *    or nothing but whitespace raises {@link InvalidAppealError}. The wire body carries
 *    `minLength: 1`, so a blank reason is a 400-shaped request that this module refuses
 *    on its own rather than trusting the schema to have caught it.
 * 2. **The report is verified to exist** with one read-only existence check against
 *    `evaluation_reports` alone — no join and no other table, so the refusal is about the
 *    report and nothing else. No row raises {@link ReportNotFoundError}.
 * 3. **One `appeals` row is inserted and one `appeal_opened` governance event is
 *    appended**, in that order, inside one transaction, and the row is returned.
 *
 * The reason is stored exactly as given, untrimmed: it is the developer's own statement
 * of ground, and a reader of the appeal must see what was submitted. `id` comes from
 * `randomUUID()` and `createdAt` from `new Date().toISOString()` — an ISO-8601 **UTC**
 * instant with milliseconds and a trailing `Z`, never SQLite's `CURRENT_TIMESTAMP`, whose
 * `YYYY-MM-DD HH:MM:SS` form this contract does not accept. The row is returned as built
 * rather than re-read, because every value it holds was just written.
 *
 * The insert is a plain `INSERT`: no upsert clause appears, and this module issues no
 * `UPDATE` and no `DELETE`. The row and the event that records its opening are wrapped
 * together in one `db.transaction(...)`, so an appeal and the log entry for the moment it
 * was opened cannot diverge — a failure between the two writes would leave an appeal whose
 * opening nothing recorded, which is the gap the pair exists to close. Better-sqlite3 nests
 * that as a savepoint when a caller already holds a transaction open, so a write route that
 * wraps this call still works. The appended event is not part of the return shape: what
 * this function opens is an appeal, and the log is read back through `../events/list-events`.
 *
 * @param db - The caller's database handle.
 * @param input - The appealed report, the developer opening the appeal, and the stated
 * reason. The developer is trusted as given: see the no-ownership-lookup note above.
 * @returns The opened appeal, in status `open`.
 * @throws {InvalidAppealError} When `input.reason` is empty or nothing but whitespace.
 * @throws {ReportNotFoundError} When no `evaluation_reports` row has `input.reportId`.
 */
export function openAppeal(
  db: Database,
  input: { readonly reportId: string; readonly developerAccountId: string; readonly reason: string },
): Appeal {
  const { reportId, developerAccountId, reason } = input;

  if (reason.trim() === "") {
    throw new InvalidAppealError();
  }

  const existingReport = db.prepare("SELECT id FROM evaluation_reports WHERE id = ?").get(reportId);
  if (existingReport === undefined) {
    throw new ReportNotFoundError(reportId);
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  const writeOpening = db.transaction(() => {
    db.prepare(
      `INSERT INTO appeals (id, report_id, developer_account_id, reason, status, created_at)
       VALUES (@id, @reportId, @developerAccountId, @reason, 'open', @createdAt)`,
    ).run({ id, reportId, developerAccountId, reason, createdAt });

    // Inside the same transaction, which is what makes the appeal and the record of its
    // opening indivisible: the appender joins an open transaction rather than opening its
    // own. The developer's stated ground travels verbatim, as the row stores it.
    appendEvent(db, {
      subjectType: "appeal",
      subjectId: id,
      eventType: "appeal_opened",
      actorAccountId: developerAccountId,
      reason,
      payload: { appealId: id, reportId },
    });
  });
  writeOpening();

  return { id, reportId, developerAccountId, reason, status: "open", createdAt };
}
