/**
 * The beside-source unit test of `reviewProposal` from `./review-proposal`: the one write path that
 * moves a standards proposal out of `submitted`, with the two refusals it raises,
 * `ProposalNotFoundError` and `ProposalAlreadyDecidedError`.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because what this module promises is a statement executed against a
 * real schema: the one column it moves, the row it leaves alone, the event it appends, the refusal a
 * second review meets and the trigger behind the appended row are all properties of the tables rather
 * than of the function alone. Nothing is stood in for — no table, column or trigger is declared in
 * this file — so a migration this suite cannot read, or a column the module spells differently, fails
 * loudly here instead of passing against duplicated DDL.
 *
 * The proposal under test is submitted through the real `submitProposal`, so the row a review starts
 * from is the product's own rather than a hand-written approximation of it. The log holds no event
 * before the review, which is what lets a case show that a submission appends none and that the
 * review's row is the only one the log gains.
 *
 * What it evidences: the `standard_proposals` contract of the plan's data model — a review sets
 * `status` and nothing else, while the contributor's title and rationale and the submission's own
 * instant come back unchanged — together with the decision's record as exactly one appended
 * `governance_events` row naming the reviewer, the proposal and the transition; the contract's `404`
 * and `409` orderings, an unknown id answering `not_found` and a decided proposal answering
 * `already_decided` before any write; the rollback that keeps a status change and its record from
 * diverging; the append-only trigger behind the event row and the deliberate absence of one behind
 * `standard_proposals`. The last three are asserted through the SQL the module prepares and through
 * the tables' own triggers, because the absence of a write and the absence of a guard are not things
 * a behavioural case can show.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOVERNANCE_EVENT_TYPES as SHARED_GOVERNANCE_EVENT_TYPES,
  PROPOSAL_REVIEW_STATUSES,
  type ProposalReviewStatus,
} from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GOVERNANCE_EVENT_TYPES } from "../events/append-event";
import { ProposalAlreadyDecidedError, ProposalNotFoundError, reviewProposal } from "./review-proposal";
import { submitProposal, type StandardProposal } from "./submit-proposal";

/** The ordered migration files, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

/** The contributing account that submits the proposals below, as the submission path is given it. */
const PROPOSER_ACCOUNT_ID = "demo-contributor-proposer";

/** The operator that reviews them: the only role the review route admits. */
const REVIEWER_ACCOUNT_ID = "demo-operator-reviewer";

/** An account id no `accounts` row carries, which the appended event's foreign key therefore refuses. */
const UNSEEDED_REVIEWER_ID = "operator-that-was-never-seeded";

/** The `standards` row id the proposals reference. */
const STANDARD_ID = "standard-sgi-so";

/** The code the standard is quoted by. */
const STANDARD_CODE = "SGI-SO-1.0.0";

/** An id no `standard_proposals` row carries. */
const UNKNOWN_PROPOSAL_ID = "proposal-that-was-never-submitted";

/**
 * The contributor's title and rationale, carrying surrounding whitespace and an internal newline: they
 * are the contributor's own argument, so a review must leave them byte for byte, and a case that
 * asserted against trimmed values would pass over a review that had normalised them.
 */
const TITLE = "  Say which run the eighteen-of-twenty threshold counts  ";
const RATIONALE =
  "  The threshold reads the same fixture twice;\n  the rule should say which run counts.  ";

/** The operator's stated ground, which travels into the appended event and nowhere else. */
const REVIEW_REASON = "The rationale names a case the fixture set does not carry.";

/**
 * The two outcomes a review may set, in the order `@adem/shared` declares them. A case reads a member
 * of this list, and the list is asserted against the shared vocabulary below, so an outcome added to or
 * removed from the closed tuple fails here rather than passing a suite that tests neither.
 */
const DECISIONS: ProposalReviewStatus[] = ["accepted", "rejected"];

/**
 * The outcome a proposal is first reviewed with and the outcome a second review attempts: both
 * directions of "the same outcome again" and "the opposite outcome", because a decision is final and
 * neither is a second review the contract admits.
 */
const REVIEW_ATTEMPTS: [ProposalReviewStatus, ProposalReviewStatus][] = [
  ["accepted", "accepted"],
  ["accepted", "rejected"],
  ["rejected", "rejected"],
  ["rejected", "accepted"],
];

/** The stored shape of one `standard_proposals` row, whole, so a change to any column is visible. */
interface StoredProposalRow {
  readonly id: string;
  readonly standard_id: string;
  readonly proposer_account_id: string;
  readonly title: string;
  readonly rationale: string;
  readonly status: string;
  readonly created_at: string;
}

/** The stored shape of one `governance_events` row, as `0007` declares its columns. */
interface StoredEventRow {
  readonly id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly event_type: string;
  readonly actor_account_id: string;
  readonly reason: string | null;
  readonly payload_json: string | null;
  readonly created_at: string;
}

/** How many rows one `COUNT(*)` query reports. */
interface CountRow {
  readonly count: number;
}

/**
 * The tables no statement of the review path may name, each because it belongs to another owner or
 * answers another question: the catalogue and its versioned criteria are read-only reference data, an
 * account is the demo session's, a listing and its versions are the API layer's, a report and its case
 * results are the measurement a proposal is about rather than a row a review touches, an appeal is the
 * sibling path's, and the sponsored slots and the audit feed are commercial and write-log data no
 * governance path may consult. A prepared statement naming any of them would mean this module had
 * begun reaching past the proposal it was asked to decide.
 */
const TABLES_THE_REVIEW_PATH_MUST_NOT_TOUCH = [
  "standards",
  "standard_versions",
  "accounts",
  "categories",
  "listings",
  "listing_versions",
  "evaluation_reports",
  "report_case_results",
  "appeals",
  "sponsored_slots",
  "audit_events",
] as const;

/** The event type this module records both outcomes under, spelled out so a rename fails here. */
const PROPOSAL_REVIEWED = "proposal_reviewed";

/** The version-4 UUID shape `appendEvent` generates for an appended row's id. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The ISO-8601 UTC instant shape an appended event's `created_at` must carry: date, time to the
 * millisecond and a trailing `Z`. SQLite's own `CURRENT_TIMESTAMP` renders `YYYY-MM-DD HH:MM:SS`
 * instead — no `T`, no milliseconds, no zone marker — which is why no column here is left to default.
 */
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let db: Database.Database;

/**
 * Every SQL source string the module under test prepared, in the order it prepared them.
 *
 * Filled by {@link installPrepareRecorder}, and the only way to assert the absence of a write: a
 * behavioural case shows what a call wrote, never which tables it left alone on the way.
 */
let preparedStatements: string[] = [];

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** Writes the account that submits proposals, the operator that reviews them, and one catalogue row. */
function insertFixture(database: Database.Database): void {
  const account = database.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)");
  account.run(PROPOSER_ACCOUNT_ID, "demo-proposer", "contributor", "Demo contributor");
  account.run(REVIEWER_ACCOUNT_ID, "demo-reviewer", "operator", "Demo operator");
  database
    .prepare("INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)")
    .run(STANDARD_ID, STANDARD_CODE, "Structured Output Conformance", "The one provisional standard");
}

/** Submits one proposal through the real submission path, which is the row a review starts from. */
function submitFixtureProposal(): StandardProposal {
  return submitProposal(db, {
    standardId: STANDARD_ID,
    proposerAccountId: PROPOSER_ACCOUNT_ID,
    title: TITLE,
    rationale: RATIONALE,
  });
}

/**
 * Every stored proposal row, in the order the proposals were submitted.
 *
 * Ordered by `created_at` then `rowid`, which is insertion order even where two proposals share an
 * instant: `standard_proposals` is read back as a work queue, and ordering two same-millisecond
 * submissions by random id would order it by chance.
 */
function readProposalRows(): StoredProposalRow[] {
  return db
    .prepare<[], StoredProposalRow>(
      `SELECT id, standard_id, proposer_account_id, title, rationale, status, created_at
       FROM standard_proposals
       ORDER BY created_at, rowid`,
    )
    .all();
}

/** One stored proposal row by id, failing the case rather than the assertion when it is absent. */
function readProposalRow(proposalId: string): StoredProposalRow {
  const row = db
    .prepare<[string], StoredProposalRow>(
      `SELECT id, standard_id, proposer_account_id, title, rationale, status, created_at
       FROM standard_proposals
       WHERE id = ?`,
    )
    .get(proposalId);
  if (row === undefined) {
    throw new Error(`expected the standard_proposals table to hold ${proposalId}`);
  }
  return row;
}

/**
 * Every stored governance event, in the order the log was written.
 *
 * Ordered by `created_at` then `rowid`, which is insertion order even where two events share an
 * instant, because `governance_events` is read back as a trail rather than as a set. The statement is
 * parameterised with the row shape rather than its result cast to it, so the reader's own typing is
 * checked against the columns it selects.
 */
function readEventRows(): StoredEventRow[] {
  return db
    .prepare<[], StoredEventRow>(
      `SELECT id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at
       FROM governance_events
       ORDER BY created_at, rowid`,
    )
    .all();
}

/**
 * The only review the log holds, failing the case rather than the assertion when it holds none: a case
 * that read the first row of the log instead would assert against a submission's event if one were
 * ever appended, and pass over a review that appended nothing at all.
 */
function firstReviewRow(): StoredEventRow {
  const row = readEventRows().find((event) => event.event_type === PROPOSAL_REVIEWED);
  if (row === undefined) {
    throw new Error(`expected the governance log to hold a ${PROPOSAL_REVIEWED} row`);
  }
  return row;
}

/** The payload text of the only review, failing the case when it stores none. */
function reviewPayloadText(): string {
  const { payload_json: payloadJson } = firstReviewRow();
  if (payloadJson === null) {
    throw new Error("expected the appended review to store a payload");
  }
  return payloadJson;
}

/** How many rows the governance log holds, including the one a refused review must not add. */
function countGovernanceEvents(): number {
  const row = db.prepare<[], CountRow>("SELECT COUNT(*) AS count FROM governance_events").get();
  if (row === undefined) {
    throw new Error("expected COUNT(*) to return one row");
  }
  return row.count;
}

/** How many triggers guard a table, by whatever names a migration gave them. */
function triggerCount(table: string): number {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table).length;
}

/**
 * Records the SQL source of every statement prepared through `db` from this point on.
 *
 * `prepare` is captured from the instance and replaced with an own property that delegates, rather
 * than spied on through the prototype: better-sqlite3 declares `prepare` on `Database.prototype`,
 * where a spy does not reliably attach. Install this after the migrations and the fixture — in a test
 * body, not in `beforeEach` — and copy {@link preparedStatements} immediately after the call under
 * test returns or throws, before a helper query of this suite prepares a statement of its own and
 * lands in the record.
 */
function installPrepareRecorder(): void {
  const original = db.prepare.bind(db) as unknown as (source: string) => unknown;

  preparedStatements = [];
  (db as unknown as { prepare: (source: string) => unknown }).prepare = (source: string) => {
    preparedStatements.push(source);
    return original(source);
  };
}

/**
 * One recorded statement, failing the case rather than the assertion when the record is short: an
 * index read is `string | undefined` under `noUncheckedIndexedAccess`, and a case that asserted
 * against an absent statement would assert nothing at all.
 */
function recordedStatement(record: readonly string[], index: number): string {
  const source = record[index];
  if (source === undefined) {
    throw new Error(`expected the recorder to hold a statement at index ${index}, and it holds ${record.length}`);
  }
  return source;
}

/** Reviews one proposal and returns nothing, so a case reads only the error it captures afterwards. */
function reviewOrThrow(proposalId: string, decision: ProposalReviewStatus, reviewerAccountId: string): unknown {
  try {
    reviewProposal(db, { proposalId, reviewerAccountId, decision, reason: REVIEW_REASON });
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  insertFixture(db);
});

afterEach(() => {
  db.close();
});

describe("reviewProposal", () => {
  it("takes its outcomes from the vocabulary @adem/shared declares", () => {
    // The review body's `enum` is this tuple, so a case list that had drifted from it would be
    // testing an outcome the contract cannot carry — or missing one it can.
    expect(DECISIONS).toStrictEqual([...PROPOSAL_REVIEW_STATUSES]);
  });

  it("records both outcomes under one member of the shared governance vocabulary", () => {
    // The vocabulary is closed and every consumer of the trail switches on it, so the member this
    // module writes is pinned here as well as in the module: a rename in `@adem/shared` fails this
    // case rather than leaving a stored value nothing reads.
    expect([...SHARED_GOVERNANCE_EVENT_TYPES]).toStrictEqual([...GOVERNANCE_EVENT_TYPES]);
    expect(SHARED_GOVERNANCE_EVENT_TYPES).toContain(PROPOSAL_REVIEWED);
    expect(SHARED_GOVERNANCE_EVENT_TYPES).not.toContain("proposal.accepted");
    expect(SHARED_GOVERNANCE_EVENT_TYPES).not.toContain("proposal.rejected");
  });

  it("appends nothing for the submission itself, so the review's row is the only one the log gains", () => {
    const proposal = submitFixtureProposal();

    // A submission writes the row that is its own record. The absence asserted here is what makes the
    // review cases below able to read the log as the review's doing rather than the submission's.
    expect(readProposalRow(proposal.proposalId).status).toBe("submitted");
    expect(readEventRows()).toEqual([]);
  });

  it.each(DECISIONS)("moves the stored status to %s, returns the proposal, and appends one event", (decision) => {
    const proposal = submitFixtureProposal();
    const rowBefore = readProposalRow(proposal.proposalId);

    const reviewed: StandardProposal = reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision,
      reason: REVIEW_REASON,
    });

    expect(readProposalRows()).toHaveLength(1);
    // Only the status column moved: the text beside it is the row exactly as the submitter left it.
    expect(readProposalRow(proposal.proposalId)).toStrictEqual({ ...rowBefore, status: decision });
    expect(reviewed).toStrictEqual({ ...proposal, status: decision });
    expect(reviewed.title).toBe(TITLE);
    expect(reviewed.rationale).toBe(RATIONALE);
    expect(reviewed.createdAt).toBe(proposal.createdAt);

    // One appended row, and it is a decision rather than a second submission: the log held nothing
    // before the review.
    const events = readEventRows();
    expect(events).toHaveLength(1);
    const event = firstReviewRow();
    expect(event.subject_type).toBe("standard_proposal");
    expect(event.subject_id).toBe(proposal.proposalId);
    expect(event.event_type).toBe(PROPOSAL_REVIEWED);
    expect(event.actor_account_id).toBe(REVIEWER_ACCOUNT_ID);
    expect(event.reason).toBe(REVIEW_REASON);
    expect(event.id).toMatch(UUID_V4_PATTERN);
    expect(event.created_at).toMatch(ISO_8601_UTC_PATTERN);
    expect(Number.isNaN(Date.parse(event.created_at))).toBe(false);
    // The status change and its record are one unit of work, so the call leaves no transaction open.
    expect(db.inTransaction).toBe(false);
  });

  it.each(DECISIONS)("carries %s in the event's payload as a canonical object naming the prior status", (decision) => {
    const proposal = submitFixtureProposal();

    reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision,
      reason: REVIEW_REASON,
    });

    // Two assertions, deliberately: the parsed members name the member that is wrong, and the exact
    // text pins the canonical rendering — sorted keys and no insignificant whitespace — which is what
    // makes the stored payload byte-stable across runs.
    expect(JSON.parse(reviewPayloadText())).toStrictEqual({
      proposalId: proposal.proposalId,
      standardId: STANDARD_ID,
      previousStatus: "submitted",
      status: decision,
    });
    expect(reviewPayloadText()).toBe(
      `{"previousStatus":"submitted","proposalId":"${proposal.proposalId}","standardId":"${STANDARD_ID}","status":"${decision}"}`,
    );
  });

  it("reviews only the proposal it names, leaving a second proposal on the same standard submitted", () => {
    const first = submitFixtureProposal();
    const second = submitFixtureProposal();
    const secondRowBefore = readProposalRow(second.proposalId);

    reviewProposal(db, {
      proposalId: first.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision: "accepted",
      reason: REVIEW_REASON,
    });

    // Two contributors may propose a change to one standard and a review decides one proposal: the
    // module's single-row statement is what leaves the second awaiting its own review.
    expect(readProposalRow(first.proposalId).status).toBe("accepted");
    expect(readProposalRow(second.proposalId)).toStrictEqual(secondRowBefore);
    expect(readEventRows().map((row) => row.event_type)).toStrictEqual([PROPOSAL_REVIEWED]);
    expect(readEventRows().map((row) => row.subject_id)).toStrictEqual([first.proposalId]);
  });

  it("stores an empty-string reason as stated, which is the absence of a stated ground", () => {
    const proposal = submitFixtureProposal();

    reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision: "rejected",
      reason: "",
    });

    // No emptiness rule is imposed on a review's reason: a proposal decided with no stated ground is
    // a terse decision recorded as such rather than a refusal, and the absence is stored as the empty
    // string rather than as the null the schema reserves for the kinds that decide by what they point
    // at. The submission's own rule on a blank title or rationale is untouched by this.
    const event = firstReviewRow();
    expect(event.reason).toBe("");
    expect(event.reason).not.toBeNull();
    expect(event.reason).not.toBe(REVIEW_REASON);
  });
});


describe("a second review of a proposal that already carries an outcome", () => {
  it.each(REVIEW_ATTEMPTS)(
    "refuses %s on a proposal already reviewed %s, names the stored outcome, and writes nothing",
    (first, second) => {
      const proposal = submitFixtureProposal();
      reviewProposal(db, {
        proposalId: proposal.proposalId,
        reviewerAccountId: REVIEWER_ACCOUNT_ID,
        decision: first,
        reason: REVIEW_REASON,
      });
      const rowBefore = readProposalRow(proposal.proposalId);
      const logBefore = readEventRows();

      installPrepareRecorder();
      const failure = reviewOrThrow(proposal.proposalId, second, REVIEWER_ACCOUNT_ID);
      const prepared = [...preparedStatements];

      expect(failure).toBeInstanceOf(ProposalAlreadyDecidedError);
      expect((failure as ProposalAlreadyDecidedError).code).toBe("already_decided");
      expect((failure as ProposalAlreadyDecidedError).name).toBe("ProposalAlreadyDecidedError");
      expect((failure as ProposalAlreadyDecidedError).proposalId).toBe(proposal.proposalId);
      // The stored outcome is what makes the refusal actionable, and it is the outcome the *first*
      // review set: the refused call is not the one that decided anything.
      expect((failure as ProposalAlreadyDecidedError).status).toBe(first);
      expect((failure as ProposalAlreadyDecidedError).message).toContain(proposal.proposalId);
      expect((failure as ProposalAlreadyDecidedError).message).toContain(`is already ${first}`);

      // Nothing was written: the row and the log compare with what the first review left, and a case
      // that read only the status would pass over a second event appended beside it.
      expect(readProposalRow(proposal.proposalId)).toStrictEqual(rowBefore);
      expect(readEventRows()).toStrictEqual(logBefore);
      expect(countGovernanceEvents()).toBe(1);
      expect(db.inTransaction).toBe(false);

      // And nothing was written because nothing was prepared past the read: the status guard is
      // reached before the status write, so a refused review cannot leave a half-made decision behind.
      expect(prepared).toHaveLength(1);
      expect(recordedStatement(prepared, 0)).toMatch(/\bFROM standard_proposals\b/);
      expect(prepared.filter((source) => /\bUPDATE\b/i.test(source))).toEqual([]);
      expect(prepared.filter((source) => /\bINSERT\b/i.test(source))).toEqual([]);
    },
  );

  it("refuses an unknown proposal id as not_found, which is the check that answers it", () => {
    const logBefore = readEventRows();

    installPrepareRecorder();
    const failure = reviewOrThrow(UNKNOWN_PROPOSAL_ID, "accepted", REVIEWER_ACCOUNT_ID);
    const prepared = [...preparedStatements];

    // The two refusals are distinguishable, which is why the row is read before either is raised: an
    // id that resolves to nothing is `not_found` rather than `already_decided`, and it carries no
    // stored outcome to report.
    expect(failure).toBeInstanceOf(ProposalNotFoundError);
    expect((failure as ProposalNotFoundError).code).toBe("not_found");
    expect((failure as ProposalNotFoundError).name).toBe("ProposalNotFoundError");
    expect((failure as ProposalNotFoundError).proposalId).toBe(UNKNOWN_PROPOSAL_ID);
    expect((failure as ProposalNotFoundError).message).toContain(UNKNOWN_PROPOSAL_ID);

    expect(readProposalRows()).toEqual([]);
    expect(readEventRows()).toStrictEqual(logBefore);
    expect(countGovernanceEvents()).toBe(0);
    expect(db.inTransaction).toBe(false);

    // One statement — the read that found nothing — and no write was even prepared.
    expect(prepared).toHaveLength(1);
    expect(recordedStatement(prepared, 0)).toMatch(/\bFROM standard_proposals\b/);
  });
});

describe("the statements reviewProposal prepares", () => {
  it("reads the proposal, moves its status and appends the review, and prepares nothing else", () => {
    const proposal = submitFixtureProposal();

    installPrepareRecorder();
    reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision: "accepted",
      reason: REVIEW_REASON,
    });
    const prepared = [...preparedStatements];

    // The executable form of the module's own list: one `SELECT` on `standard_proposals`; then, inside
    // the transaction, one `UPDATE` on `standard_proposals` and one append to `governance_events`
    // through the appender. Anything else — a second read, a helper's lookup, a statement against
    // another table — fails here.
    expect(prepared).toHaveLength(3);
    expect(recordedStatement(prepared, 0)).toMatch(/\bFROM standard_proposals\b/);
    expect(recordedStatement(prepared, 1)).toBe("UPDATE standard_proposals SET status = ? WHERE id = ?");
    expect(recordedStatement(prepared, 2)).toMatch(/\bINSERT INTO governance_events\b/i);
  });

  it("sets the status column and no other column of the proposal row", () => {
    const proposal = submitFixtureProposal();

    installPrepareRecorder();
    reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision: "rejected",
      reason: REVIEW_REASON,
    });
    const prepared = [...preparedStatements];

    // The UPDATE names one assignment, which is what keeps `title` and `rationale` — the contributor's
    // argument — out of a review's reach even if the module's behaviour changed later. The comparison
    // is against the whole statement, so any second assignment, any added predicate and any other
    // table fails here rather than passing a looser match.
    const updates = prepared.filter((source) => /UPDATE standard_proposals/i.test(source));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe("UPDATE standard_proposals SET status = ? WHERE id = ?");
  });

  it("prepares no statement naming another owner's table", () => {
    const proposal = submitFixtureProposal();

    installPrepareRecorder();
    reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision: "accepted",
      reason: REVIEW_REASON,
    });
    const prepared = [...preparedStatements];

    const forbiddenStatements = TABLES_THE_REVIEW_PATH_MUST_NOT_TOUCH.filter((table) =>
      prepared.some((source) => new RegExp(`\\b${table}\\b`).test(source)),
    );

    expect(forbiddenStatements).toEqual([]);
  });
});

describe("the transaction a review writes", () => {
  it("rolls the status change back when the appended event is refused, leaving the proposal submitted", () => {
    const proposal = submitFixtureProposal();
    const rowBefore = readProposalRow(proposal.proposalId);

    installPrepareRecorder();
    // The refusal comes from the database, on the appended event's `actor_account_id` foreign key
    // rather than from a check in the module, so the failure lands between the two writes.
    const failure = reviewOrThrow(proposal.proposalId, "accepted", UNSEEDED_REVIEWER_ID);
    const prepared = [...preparedStatements];

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/FOREIGN KEY constraint failed/);
    // Both writes were reached — the record shows their statements were prepared — so the rollback
    // asserted below is the transaction's doing rather than an early return's.
    expect(prepared).toHaveLength(3);
    expect(recordedStatement(prepared, 1)).toBe("UPDATE standard_proposals SET status = ? WHERE id = ?");
    expect(recordedStatement(prepared, 2)).toMatch(/\bINSERT INTO governance_events\b/i);

    // One transaction, two writes: the status change is undone together with the event that would have
    // recorded it, and the proposal is left exactly as the submitter wrote it.
    expect(db.inTransaction).toBe(false);
    expect(readProposalRow(proposal.proposalId)).toStrictEqual(rowBefore);
    expect(rowBefore.status).toBe("submitted");
    expect(readEventRows()).toEqual([]);
    expect(countGovernanceEvents()).toBe(0);
  });
});

describe("the append-only rule behind a review's event", () => {
  it("refuses an update and a delete of the review's row", () => {
    const proposal = submitFixtureProposal();
    reviewProposal(db, {
      proposalId: proposal.proposalId,
      reviewerAccountId: REVIEWER_ACCOUNT_ID,
      decision: "accepted",
      reason: REVIEW_REASON,
    });
    const event = firstReviewRow();

    // Defence in depth, not a security boundary: the guarantee is that no route offers the mutation,
    // and this is the guard-rail under it. Both attempts must be refused, and the row must survive them
    // byte for byte.
    expect(() => db.prepare("UPDATE governance_events SET reason = ? WHERE id = ?").run("rewritten", event.id)).toThrow(
      /governance_events is append-only: rows may not be updated/,
    );
    expect(() => db.prepare("DELETE FROM governance_events WHERE id = ?").run(event.id)).toThrow(
      /governance_events is append-only: rows may not be deleted/,
    );
    expect(firstReviewRow()).toStrictEqual(event);
  });

  it("leaves the proposal row unguarded, which is what keeps a review's status write legal", () => {
    // The difference between the two tables is the point: `governance_events` carries both triggers,
    // and `standard_proposals` carries none, because its `status` is the one column a review writes.
    expect(triggerCount("governance_events")).toBe(2);
    expect(triggerCount("standard_proposals")).toBe(0);
  });
});

