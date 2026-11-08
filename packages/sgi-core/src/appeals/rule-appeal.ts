/**
 * Ruling an appeal: the operator's decision on a developer's challenge to one report.
 *
 * An appeal is opened by `./open-appeal` with the developer's stated reason, and it
 * records a decision here: the operator rules it `upheld` or `denied`. The two halves
 * exist to demonstrate the product's immutability guarantee from the outside — a ruling
 * moves the appeal's own `status` and appends one governance event, while the appealed
 * `evaluation_reports` row stays byte-identical, which is what `GET /evaluations/{id}`
 * proves by returning the same report after a ruling.
 *
 * Four decisions are stated here, because the code alone would read as an omission or an
 * accident:
 *
 * 1. **This module holds the package's only other `UPDATE`, and it sets one column.**
 *    The package has exactly two `UPDATE` statements: this one, and
 *    `standard_proposals.status` in `proposals/review-proposal.ts`. The statement below
 *    sets `appeals.status` and nothing else — never `reason`, never `report_id`, never
 *    `developer_account_id`, never `created_at`, never `id`. A ruling records a *new*
 *    decision; it never rewrites the developer's stated ground, which is evidence and is
 *    stored exactly as submitted. The `appeals` table is deliberately not one of the nine
 *    append-only tables and carries no `RAISE(ABORT)` trigger, which is what makes this
 *    `UPDATE` legal: `status` is the row's only mutable column.
 * 2. **One transaction holds the read, both refusals and the two writes.** The appeal's
 *    row is read, the checks against its stored status are made, and the status change and
 *    the event that records it are written, all inside one transaction — so the decision
 *    and the write that records it cannot be separated, and the row's state and the ruling's
 *    history cannot diverge.
 * 3. **The event's type is `appeal_ruled`, and the outcome travels in its payload.** The
 *    vocabulary that governs the column is the closed tuple `GOVERNANCE_EVENT_TYPES`,
 *    declared once in `@adem/shared` and enforced by `appendEvent` before it writes; its
 *    member for this decision is the single `appeal_ruled`, which covers both outcomes,
 *    and `upheld` versus `denied` is carried in the payload. Two event types, one per
 *    outcome, would widen a closed vocabulary every consumer switches on.
 * 4. **`appendEvent` owns the serialisation.** The payload is passed as a plain object and
 *    canonicalised by the appender — the single canonicalisation point — so this module
 *    imports no JSON renderer. Handing it a pre-rendered string would compile and quietly
 *    store the JSON of a string instead of the JSON of the object.
 *
 * Nothing here touches `evaluation_reports` or `report_case_results` — not in a statement,
 * not in a join, not in a helper — and this module issues no `DELETE` and no upsert clause.
 * `INSERT OR REPLACE`, which SQLite documents as bypassing an append-only `DELETE`
 * trigger, appears nowhere in this package. The statements this module executes, in order,
 * are exactly, all of them inside the one transaction: one `SELECT` on `appeals`, one
 * `UPDATE` on `appeals` and one `INSERT` into `governance_events`.
 *
 * What holds the append-only rule is that no route offers the mutation; the trigger on
 * `governance_events` is defence in depth behind it and is never a security boundary, since
 * a connection with write access can drop one.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no
 * connection, reads no environment variable and resolves no filesystem path. It sees no
 * HTTP concept: the operator's role check is the route's `403`, an unknown appeal is this
 * module's `not_found` and the API's `404`, and an appeal already decided is this module's
 * `already_ruled` and the API's `409`.
 */

import type { AppealRuling } from "@adem/shared";
import type { Database } from "better-sqlite3";
import { appendEvent } from "../events/append-event";
import type { Appeal } from "./open-appeal";

/**
 * One stored `appeals` row, in the shape `0007_governance_events_and_appeals.sql` holds
 * it: the six snake_case columns, with the nullability that migration declares.
 *
 * It is what the prepared read is parameterised with, so the columns the module maps are
 * named in one place and the statement returns the shape this interface describes rather
 * than an `any` awaiting a cast at the point of use. `status` is typed as an open `string`
 * rather than as the closed `AppealStatus` union, because this is what the table holds: the
 * `CHECK` constraint constrains a written value, not what a read reports, and the guard in
 * {@link ruleAppeal} is what narrows it.
 */
interface AppealRow {
  /** Identifier of the appeal. */
  readonly id: string;
  /** The appealed report, referencing `evaluation_reports.id`. */
  readonly report_id: string;
  /** The developer that opened the appeal, referencing `accounts.id`. */
  readonly developer_account_id: string;
  /** The developer's stated ground for contesting the report, stored verbatim. */
  readonly reason: string;
  /** `open` until ruled, then `upheld` or `denied`; the row's only mutable column. */
  readonly status: string;
  /** ISO-8601 UTC instant written when the appeal was opened. */
  readonly created_at: string;
}

/**
 * The refusal of a ruling against an appeal that does not exist.
 *
 * It is declared here because a refusal belongs to the module that owns its rule, and
 * because this package deliberately has no shared errors module. It is a separate class
 * from the sibling opener's `ReportNotFoundError` although both carry the code string
 * `not_found`: each names a different missing row — an appeal to rule, a report to appeal —
 * and `apps/api` maps by `code`, so the two are the same HTTP status and two different
 * domain facts. The message begins `sgi-core:` so a scan of a log finds the package that
 * refused rather than a bare "not found".
 */
export class AppealNotFoundError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  readonly code = "not_found";

  /**
   * Builds the refusal for one unknown appeal id.
   *
   * @param appealId - The id no `appeals` row carries.
   */
  constructor(appealId: string) {
    super(`sgi-core: no appeal has id ${appealId}`);
    this.name = "AppealNotFoundError";
  }
}

/**
 * The refusal of a second ruling on an appeal that already carries a terminal status.
 *
 * `apps/api` maps `code` to the contract's **409**. A ruling is final: the same outcome a
 * second time is as much a second ruling as the opposite outcome, so both are refused here
 * and nothing is written. The refusal is raised inside the transaction, before either write
 * is reached, which is why a refused call leaves the row and the log exactly as they were.
 * The stored status is named in the message because it is what makes the refusal actionable,
 * and this module adds no member to this class beyond the error machinery: a caller decides
 * what to do from `code`.
 */
export class AppealAlreadyRuledError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  readonly code = "already_ruled";

  /**
   * Builds the refusal for one appeal that is no longer `open`.
   *
   * @param appealId - The appeal that was already decided.
   * @param status - The terminal status the row already carries.
   */
  constructor(appealId: string, status: string) {
    super(
      `sgi-core: appeal ${appealId} is already ruled (status ${status}); a ruling is final and only an open appeal can be ruled`,
    );
    this.name = "AppealAlreadyRuledError";
  }
}

/**
 * Rules one open appeal `upheld` or `denied` and returns it.
 *
 * Four steps, in this order, because the order is part of the contract:
 *
 * 1. **The appeal row is read**, naming its six columns rather than selecting `*`, so a
 *    column a later migration adds cannot change the shape of what is returned. No row
 *    raises {@link AppealNotFoundError}.
 * 2. **A second ruling is refused** before anything is written: a stored `status` that is
 *    not `open` raises {@link AppealAlreadyRuledError}. That read and this refusal happen
 *    inside the same transaction as the two writes below, so the status the refusal reads
 *    and the status the ruling writes are one act rather than two: a ruling another writer
 *    commits between them cannot be ruled over unnoticed — SQLite refuses this transaction's
 *    write against a snapshot a later commit has superseded — and the rule therefore rests
 *    on this transaction rather than on the deployment's concurrency model. The two
 *    statements below are the whole of what a ruling writes.
 * 3. **The status change and its governance event are written in one transaction**, so the
 *    row's new state and the ruling's history cannot diverge. The event's `reason` is the
 *    **operator's** stated ground, which travels into the appended event only: the appeal
 *    row keeps the developer's reason, and the ruling history lives in `governance_events`,
 *    read back in insertion order. That is why the row carries no ruled-at, ruled-by or
 *    ruling-reason column — see the payload's `previousStatus` and `status` for the same
 *    information, recorded where a row can never be corrected.
 * 4. **The updated appeal is returned**, assembled from the row read in step 1 with `status`
 *    replaced by the ruling, inside the transaction that made the write. Nothing is re-read:
 *    `status` is the only column written, and every other value is the row this transaction
 *    itself read.
 *
 * The read, both refusals and both writes run inside **one** transaction, so the check that
 * the appeal is still open and the write that rules it are one act: a refusal rolls back
 * before either write is reached, a failure between the two writes undoes both, and a refused
 * call leaves the row and the log exactly as it found them. Nothing is committed or rolled
 * back by hand, and `appendEvent` joins this transaction rather than opening one of its own.
 * Where the write route has already opened a transaction of its own — `apps/api`'s
 * `recordAppealRuling` does — better-sqlite3 nests this one inside it as a savepoint, so the
 * ruling and the route's audit row remain indivisible as well.
 *
 * No emptiness rule is imposed on `input.reason`. The wire body's reason is optional
 * (`AppealRulingBody` has `reason?: string`) while this parameter is required, so the route
 * layer passes the wire reason or an empty string; an empty-string reason is a decision
 * stored as stated rather than a fabricated one, and an appeal whose ruling records no
 * ground is a legitimate record of a terse decision. Adding a refusal here would be an
 * unplanned failure mode for a rule the plan does not state.
 *
 * Determinism: nothing in this module reads a clock, a locale, a timezone or a random
 * source. The only timestamp in play is the appended event's, generated inside
 * {@link appendEvent}, and the returned `createdAt` is the one the opener already stored.
 *
 * @param db - The caller's database handle.
 * @param input - The appeal to rule, the operator ruling it, the outcome, and the
 * operator's stated ground.
 * @returns The appeal, carrying the ruling as its `status`.
 * @throws {AppealNotFoundError} When no `appeals` row has `input.appealId`.
 * @throws {AppealAlreadyRuledError} When that row's status is `upheld` or `denied` already.
 */
export function ruleAppeal(
  db: Database,
  input: {
    readonly appealId: string;
    readonly operatorAccountId: string;
    readonly ruling: AppealRuling;
    readonly reason: string;
  },
): Appeal {
  const { appealId, operatorAccountId, ruling, reason } = input;

  return db.transaction((): Appeal => {
    const row = db
      .prepare<[string], AppealRow>(
        `SELECT id, report_id, developer_account_id, reason, status, created_at
         FROM appeals
         WHERE id = ?`,
      )
      .get(appealId);

    if (row === undefined) {
      throw new AppealNotFoundError(appealId);
    }

    if (row.status !== "open") {
      throw new AppealAlreadyRuledError(appealId, row.status);
    }

    // The status column only: a ruling is a new decision, so the developer's reason and
    // every other column of the row are left exactly as the opener wrote them.
    db.prepare("UPDATE appeals SET status = ? WHERE id = ?").run(ruling, appealId);

    // Inside the transaction opened above, which is what makes the decision and the row
    // that records it indivisible: the appender joins an open transaction rather than
    // opening one of its own.
    appendEvent(db, {
      subjectType: "appeal",
      subjectId: appealId,
      eventType: "appeal_ruled",
      actorAccountId: operatorAccountId,
      reason,
      payload: { appealId, reportId: row.report_id, previousStatus: "open", status: ruling },
    });

    // Assembled from the row read above with `status` replaced by the ruling, so the
    // developer's own ground is provably the stored one rather than anything re-read here.
    return {
      id: row.id,
      reportId: row.report_id,
      developerAccountId: row.developer_account_id,
      reason: row.reason,
      status: ruling,
      createdAt: row.created_at,
    };
  })();
}
