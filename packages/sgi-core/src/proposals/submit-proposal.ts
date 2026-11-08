/**
 * Submitting a standards proposal: the one write path that creates a `standard_proposals` row, and
 * how a contributor asks the community to change the Standard Gate Index.
 *
 * A proposal is created in status `submitted`, which is the whole of what submission decides. The
 * review half lives in `./review-proposal`, where an operator's decision moves that status and
 * appends the governance event for it; submission appends **no governance event**, by design rather
 * than by omission, because the inserted row is itself the record of the submission. A later reader
 * must not read that absence as a missing call to the event log.
 *
 * The proposal's text is stored exactly as submitted, untrimmed: the title and the rationale are
 * the contributor's own argument, and rewriting either would change what a review later answered.
 * The row is therefore only ever added — one plain insert statement, no statement that rewrites or
 * removes a row, and no replace-style conflict resolution, which SQLite documents as bypassing a
 * delete trigger — so a decided proposal keeps the reasoning it was decided on.
 *
 * The database handle belongs to the caller (ports and adapters): this module opens no connection,
 * reads no environment variable and resolves no filesystem path.
 */

import { randomUUID } from "node:crypto";
import type { ProposalStatus } from "@adem/shared";
import type { Database } from "better-sqlite3";
import { UnknownStandardError, getStandard } from "../standards/standard-registry";

/**
 * The refusal of a proposal whose `title` or `rationale` is empty or nothing but whitespace.
 *
 * A blank title states no change and a blank rationale states no argument for one, so neither is a
 * request the standard's review process could act on. It is declared here because a refusal belongs
 * to the module that owns its rule, and because this package deliberately has no shared errors
 * module. The API workspace maps `code` to the contract's **400**, and `field` names the offending
 * member so a caller can attach the failure to the form control that produced it.
 */
export class InvalidProposalError extends Error {
  /** A stable identifier for the failure, for a caller that switches on it. */
  override readonly name: string = "InvalidProposalError";

  /** A stable identifier for the failure, for a caller that switches on it. */
  readonly code: "invalid_proposal" = "invalid_proposal";

  /**
   * Builds the refusal for one offending member, which is the whole of it beyond the error
   * machinery: the rule is a single field's.
   *
   * @param field - The member no proposal may leave blank.
   */
  constructor(readonly field: "title" | "rationale") {
    super(`Invalid proposal: ${field} must not be empty`);
  }
}

/**
 * One `standard_proposals` row as the domain reads it: a contributor's request to change a standard.
 *
 * The members are camelCase where the stored columns are snake_case — `proposalId` is `id`,
 * `standardId` is `standard_id`, `proposerAccountId` is `proposer_account_id`, and `createdAt` is
 * `created_at` — and the standards route in the API workspace maps this type onto the wire shape
 * `@adem/shared` declares for the same row. That package exports a snake_case `StandardProposal` of
 * its own: that one is the **wire** type, this one is the domain type, and the mapping between them
 * belongs to the route rather than to either type.
 *
 * `status` is the row's only mutable column: a review moves it to `accepted` or `rejected`, and
 * nothing rewrites the text beside it. `standardId` is the `standards` row id the proposal
 * references, never the code `SGI-SO-1.0.0` a caller may have addressed it by.
 */
export type StandardProposal = {
  /** Identifier of the proposal, generated when it is submitted. */
  readonly proposalId: string;
  /** The `standards` row the proposal concerns, referencing `standards.id`. */
  readonly standardId: string;
  /** The contributing account that submitted the proposal, referencing `accounts.id`. */
  readonly proposerAccountId: string;
  /** Short statement of what the proposal would change, stored verbatim. */
  readonly title: string;
  /** The contributor's reasoning, stored verbatim. */
  readonly rationale: string;
  /** `submitted` until an operator review decides it. */
  readonly status: ProposalStatus;
  /** ISO-8601 UTC instant written when the proposal was submitted. */
  readonly createdAt: string;
};

/**
 * Submits one standards proposal and returns the row it wrote.
 *
 * Three steps, in this order, because the order is part of the contract:
 *
 * 1. **The text is validated first**, before the database is touched at all, so a malformed request
 *    costs no I/O: `title` is checked before `rationale`, and either being empty or nothing but
 *    whitespace raises {@link InvalidProposalError}. The wire body carries `minLength: 1`, so a
 *    blank member is a 400-shaped request this module refuses on its own rather than trusting the
 *    schema to have caught it.
 * 2. **The standard is resolved** with one read through `getStandard`, which accepts either the
 *    `standards` row id or the contract-facing code `SGI-SO-1.0.0`. A reference that resolves to no
 *    row raises {@link UnknownStandardError}, which the API workspace maps to the contract's `404`.
 * 3. **Exactly one row is inserted**, in status `submitted`, and returned.
 *
 * The stored `standard_id` is the **resolved row id**, never the reference the proposal was
 * addressed by, because the column is a foreign key to `standards.id` and a review's event trail
 * must point at the row rather than at a string a later catalogue could re-use. `title` and
 * `rationale` are stored exactly as given, untrimmed: they are the contributor's own argument, and
 * this path exists partly so that reading a decided proposal shows what was actually submitted.
 *
 * `proposalId` comes from `randomUUID()` and `createdAt` from `new Date().toISOString()` — an
 * ISO-8601 **UTC** instant with milliseconds and a trailing `Z`, never a timestamp SQLite assigns
 * itself, whose `YYYY-MM-DD HH:MM:SS` form this contract does not accept. The row is returned as
 * built rather than re-read, because every value it holds was just written.
 *
 * Submission appends no governance event, deliberately: the append sites are a proposal's review, a
 * moderation action, an appeal's opening, an appeal's ruling, a standard version's publication and a
 * retest, and the inserted row is itself the record of the submission. A single-row insert is already
 * atomic and needs no transaction, so a caller's open transaction is joined cleanly rather than nested.
 *
 * @param db - The caller's database handle.
 * @param input - The standard the proposal concerns, the contributing account submitting it, and
 * the proposal's own title and rationale. The account is trusted as given: the write route resolves
 * the demo session and refuses an absent header or a wrong role before this function is reached.
 * @returns The submitted proposal, in status `submitted`.
 * @throws {InvalidProposalError} When `input.title`, or else `input.rationale`, is empty or nothing
 * but whitespace.
 * @throws {UnknownStandardError} When no `standards` row matches `input.standardId`.
 */
export function submitProposal(
  db: Database,
  { standardId, proposerAccountId, title, rationale }: {
    standardId: string;
    proposerAccountId: string;
    title: string;
    rationale: string;
  },
): StandardProposal {
  if (title.trim() === "") {
    throw new InvalidProposalError("title");
  }
  if (rationale.trim() === "") {
    throw new InvalidProposalError("rationale");
  }

  const standard = getStandard(db, standardId);
  if (standard === null) {
    throw new UnknownStandardError(
      `standard reference "${standardId}" resolves to no catalogue row, so there is no standard for a proposal to concern`,
      standardId,
    );
  }

  const proposalId = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO standard_proposals (id, standard_id, proposer_account_id, title, rationale, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
  ).run(proposalId, standard.id, proposerAccountId, title, rationale, createdAt);

  return {
    proposalId,
    standardId: standard.id,
    proposerAccountId,
    title,
    rationale,
    status: "submitted",
    createdAt,
  };
}
