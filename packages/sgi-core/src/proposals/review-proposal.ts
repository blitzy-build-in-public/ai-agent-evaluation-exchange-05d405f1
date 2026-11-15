/**
 * Reviewing a standards proposal: the operator's decision on a contributor's request to change the
 * Standard Gate Index, and the one write path that moves a proposal out of `submitted`.
 *
 * A proposal is submitted in status `submitted` by `./submit-proposal`, which appends no governance
 * event because the row it writes is itself the record of the submission. The decision is taken here,
 * and only here: an operator moves the status to `accepted` or `rejected`, nothing moves it back, and
 * no automated path moves it at all. A review is a human judgement recorded as such, which is why
 * this module holds no scoring, no threshold and no rule about what makes a proposal good.
 *
 * Four decisions are stated here, because the code alone would read as an omission or an accident:
 *
 * 1. **The proposal's text is never rewritten.** The statement below sets `status` and nothing else —
 *    never `title`, never `rationale`, never `standard_id`, never `proposer_account_id`, never
 *    `created_at`, never `id`. `title` and `rationale` are the contributor's own argument and are
 *    returned exactly as submitted, because a later reader of a decided proposal must see the
 *    reasoning the decision answered rather than a normalised rendering of it.
 * 2. **The decision's only record is the appended governance event.** `standard_proposals` carries no
 *    ruled-at, ruled-by or ruling-reason column, and this module adds none: it appends one event
 *    naming the reviewer, the stated ground and the transition, and the trail is read back from
 *    `governance_events` in insertion order. That is also what makes the two halves indivisible.
 * 3. **One event type covers both outcomes, and the outcome travels in its payload.** The vocabulary
 *    that governs the column is the closed tuple `GOVERNANCE_EVENT_TYPES`, declared once in
 *    `@adem/shared` and enforced by `appendEvent` before it writes; its member for this decision is
 *    the single `proposal_reviewed`, covering `accepted` and `rejected` alike. Two event types, one
 *    per outcome, would widen a closed vocabulary every reader of the trail switches on — the same
 *    reasoning that gives `appeal_ruled` both of its rulings.
 * 4. **`appendEvent` owns the serialisation.** The payload is passed as a plain object and
 *    canonicalised by the appender — the package's single canonicalisation point — so this module
 *    imports no JSON renderer. Handing it a pre-rendered string would compile and quietly store the
 *    JSON of a string instead of the JSON of the object.
 *
 * One transaction holds the read, both refusals and both writes, so a status change and the event
 * recording it cannot diverge: a refusal rolls back before either write is reached, and a failure
 * between them undoes both. `appendEvent` joins the open transaction rather than opening one of its
 * own, and neither this module nor that one issues a manual commit or rollback.
 *
 * `standard_proposals` is deliberately not one of the nine append-only tables that
 * `packages/shared/migrations/0010_append_only_triggers.sql` guards, which is what makes the
 * single-column status write legal; `governance_events` is one of them and is written only through
 * `appendEvent`. No statement here removes a row and no upsert clause appears anywhere: a
 * replace-style conflict resolution is documented to bypass an append-only guard, so the
 * append-only path only ever adds a row.
 *
 * Determinism: nothing here reads a clock, a locale, a timezone or a random source. The only
 * timestamp in play is the appended event's, generated inside `appendEvent`, and the returned
 * `createdAt` is the instant the submitter already stored.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable and resolves no filesystem path. It sees no HTTP concept either: the
 * reviewer's role check is the write route's `403`, an unknown proposal is this module's `not_found`
 * and the API's `404`, and a proposal that already carries a review outcome is this module's
 * `already_decided` and the API's `409`.
 */

import type { GovernanceSubjectType, ProposalReviewStatus, ProposalStatus } from "@adem/shared";
import type { Database } from "better-sqlite3";
import { appendEvent, type GovernanceEventType } from "../events/append-event";
import type { StandardProposal } from "./submit-proposal";

/**
 * The one governance subject kind a review is recorded against: the `standard_proposals` row the
 * decision concerns.
 *
 * Typed as the shared vocabulary's member rather than left as a bare string, so a spelling the
 * shared tuple does not carry fails the build here instead of being written into a row that can
 * never be corrected. `appendEvent` accepts an open string for this member — its subject set is
 * deliberately not closed — which is exactly why the spelling is pinned at the call site that knows
 * which kind of row it decided.
 */
const PROPOSAL_SUBJECT_TYPE: GovernanceSubjectType = "standard_proposal";

/**
 * The one event type a proposal review appends, for both of its outcomes.
 *
 * `GOVERNANCE_EVENT_TYPES` carries a single member for this decision — `proposal_reviewed` — and the
 * outcome travels in the event's payload as `accepted` or `rejected`. Typed as the vocabulary's own
 * member so that a rename in `./append-event` fails this line rather than a stored value, and named
 * here rather than written at the call site so that the spelling a decision records has one home.
 */
const PROPOSAL_REVIEW_EVENT_TYPE: GovernanceEventType = "proposal_reviewed";

/**
 * One stored `standard_proposals` row, in the shape `0005_standards_and_proposals.sql` holds it.
 *
 * It is what the prepared read is parameterised with, so the seven columns this module maps are named
 * in one place and the statement returns the shape described here rather than an `unknown` that every
 * reading site would have to cast. `status` is read as the shared `ProposalStatus` union rather than
 * as an open string, because the column is `NOT NULL` under
 * `CHECK (status IN ('submitted', 'accepted', 'rejected'))`: every row that can exist holds one of
 * those three, so the closed union is what the schema says about the read rather than an assumption
 * laid over it.
 */
interface StandardProposalRow {
  /** Identifier of the proposal, the primary key. */
  readonly id: string;
  /** The `standards` row the proposal concerns, referencing `standards.id`. */
  readonly standard_id: string;
  /** The contributing account that submitted it, referencing `accounts.id`. */
  readonly proposer_account_id: string;
  /** Short statement of what the proposal would change, stored verbatim. */
  readonly title: string;
  /** The contributor's reasoning, stored verbatim. */
  readonly rationale: string;
  /** `submitted` until a review decides it; the row's only mutable column. */
  readonly status: ProposalStatus;
  /** ISO-8601 UTC instant the row was written, stored as submitted. */
  readonly created_at: string;
}

/**
 * The refusal of a review of a proposal that does not exist.
 *
 * It is declared here because a refusal belongs to the module that owns its rule, and because this
 * package deliberately has no shared errors module. `proposalId` carries the id no row matched, so a
 * caller can name it, and `code` is what the write route switches on: `not_found` is the contract's
 * **404**.
 */
export class ProposalNotFoundError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  override readonly name: string = "ProposalNotFoundError";

  /** The machine-readable code the write route maps to the contract's 404. */
  readonly code: "not_found" = "not_found";

  /**
   * Builds the refusal for one unknown proposal id.
   *
   * @param proposalId - The id no `standard_proposals` row carries.
   */
  constructor(readonly proposalId: string) {
    super(`No proposal: ${proposalId}`);
  }
}

/**
 * The refusal of a review of a proposal that already carries a review outcome.
 *
 * The standards write route in the API workspace maps `code` to the contract's **409**. A decision is
 * final: the outcome a review was already given is as much a second review as the opposite outcome
 * would be, so both are refused here. The refusal is raised inside the transaction, before the status
 * write is reached, which is why a refused call leaves the row and the log exactly as the first
 * decision left them. `status` carries that stored outcome, because it is what makes the refusal
 * actionable, and the row's own id is returned so a caller can name the proposal it was refused.
 */
export class ProposalAlreadyDecidedError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  override readonly name: string = "ProposalAlreadyDecidedError";

  /** The machine-readable code the write route maps to the contract's 409. */
  readonly code: "already_decided" = "already_decided";

  /**
   * Builds the refusal for one proposal that is no longer `submitted`.
   *
   * @param proposalId - The proposal that was already decided.
   * @param status - The review outcome the row already carries.
   */
  constructor(
    readonly proposalId: string,
    readonly status: ProposalStatus,
  ) {
    super(`Proposal ${proposalId} is already ${status}`);
  }
}

/**
 * Moves one standards proposal from `submitted` to `accepted` or `rejected`, appends the governance
 * event that records the decision, and returns the proposal.
 *
 * Five steps, in this order, because the order is part of the contract:
 *
 * 1. **The row is read**, naming the seven columns rather than selecting `*`, so a column a later
 *    migration adds cannot change the shape of what is returned. No row raises
 *    {@link ProposalNotFoundError}.
 * 2. **A second review is refused** before anything is written: a stored `status` that is not
 *    `submitted` raises {@link ProposalAlreadyDecidedError}, carrying the outcome the row already
 *    holds. The read before it is what makes the two refusals distinguishable — an unknown id and a
 *    decided proposal are two different answers, and only the second can name a stored outcome.
 * 3. **Only the `status` column moves**, to the requested outcome. `title`, `rationale`, `standard_id`,
 *    `proposer_account_id`, `created_at` and `id` are untouched, which is how a decided proposal keeps
 *    the reasoning it was decided on.
 * 4. **Exactly one governance event is appended**, through {@link appendEvent}: the package's only
 *    writer of `governance_events`, which owns that row's generated id and ISO-8601 UTC instant. Its
 *    payload carries the proposal, the standard it concerns, the status it came from and the status it
 *    moved to. Because `appendEvent` is handed a plain object, the canonicalisation of the stored
 *    payload happens there and this module imports no renderer of its own.
 * 5. **The reviewed proposal is returned**, as the camelCase domain type the package entry re-exports.
 *    `title`, `rationale` and `createdAt` are the values read in step 1, returned unchanged, and
 *    `status` is the decision. Nothing is re-read, because the review touched no column of the row's
 *    stored text.
 *
 * The read, both refusals and both writes run inside **one** transaction, so a status change and the
 * event recording it cannot diverge: a refusal rolls back before either write, and a failure between
 * them undoes both. Nothing is committed or rolled back by hand, and `appendEvent` joins this
 * transaction rather than opening one of its own.
 *
 * No emptiness rule is imposed on `input.reason`. The review body's reason is optional while this
 * parameter is required, so the route layer passes the wire reason or an empty string; an
 * empty-string reason is a decision stored as stated rather than a fabricated one, and a review whose
 * ground is terse is a legitimate record of it. A refusal here would be an unplanned failure mode for
 * a rule the plan does not state.
 *
 * @param db - The caller's database handle.
 * @param input - The proposal to review, the operator reviewing it, the outcome to set and the
 * operator's stated ground. The reviewer is trusted as given: the write route resolves the demo
 * session and refuses an absent header or a wrong role before this function is reached.
 * @returns The proposal, carrying the review's outcome as its `status` and its text unchanged.
 * @throws {ProposalNotFoundError} When no `standard_proposals` row has `input.proposalId`.
 * @throws {ProposalAlreadyDecidedError} When that row's status is `accepted` or `rejected` already.
 */
export function reviewProposal(
  db: Database,
  { proposalId, reviewerAccountId, decision, reason }: {
    proposalId: string;
    reviewerAccountId: string;
    decision: ProposalReviewStatus;
    reason: string;
  },
): StandardProposal {
  return db.transaction(() => {
    const row = db
      .prepare<[string], StandardProposalRow>(
        `SELECT id, standard_id, proposer_account_id, title, rationale, status, created_at
         FROM standard_proposals
         WHERE id = ?`,
      )
      .get(proposalId);

    if (row === undefined) {
      throw new ProposalNotFoundError(proposalId);
    }

    if (row.status !== "submitted") {
      throw new ProposalAlreadyDecidedError(proposalId, row.status);
    }

    // The status column only: a review is a new decision, so the contributor's title and rationale
    // and the submission's own instant are left exactly as the submitter wrote them.
    db.prepare("UPDATE standard_proposals SET status = ? WHERE id = ?").run(decision, proposalId);

    // One appended row per decision, written inside the transaction opened above, which is what makes
    // the status change and its record indivisible.
    appendEvent(db, {
      subjectType: PROPOSAL_SUBJECT_TYPE,
      subjectId: proposalId,
      eventType: PROPOSAL_REVIEW_EVENT_TYPE,
      actorAccountId: reviewerAccountId,
      reason,
      payload: {
        proposalId,
        standardId: row.standard_id,
        previousStatus: "submitted",
        status: decision,
      },
    });

    // Assembled from the row read above with `status` replaced by the decision, so the text fields
    // are provably the stored ones rather than anything this path could have reformatted.
    return {
      proposalId: row.id,
      standardId: row.standard_id,
      proposerAccountId: row.proposer_account_id,
      title: row.title,
      rationale: row.rationale,
      status: decision,
      createdAt: row.created_at,
    };
  })();
}
