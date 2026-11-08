/**
 * Unit tests for the proposal-submission writer: `submitProposal`, with the two refusals it
 * raises, `InvalidProposalError` and the imported `UnknownStandardError`, both from
 * `./submit-proposal` and `../standards/standard-registry`.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because what this module promises is a statement executed against
 * a real schema: the shape of the row it writes, the status a fresh proposal carries, the verbatim
 * text, and the row the call leaves untouched are properties of the tables rather than of the
 * function alone.
 *
 * The fixture is what a proposal needs and no more — one synthetic `contributor` account and one
 * `standards` catalogue row — so a proposal is submitted here exactly as the write route submits
 * one, and no `standard_versions` row is required because a proposal concerns the catalogue row
 * rather than any version of it.
 *
 * What it evidences: the `standard_proposals` contract of the plan's data model (a proposal is
 * inserted `submitted`, its `id` is a generated UUID and its `created_at` an application-written
 * ISO-8601 UTC instant), the standard's resolution by the contract-facing code or by the row id,
 * the two text refusals and the unknown-standard refusal with nothing written, the deliberate
 * absence of a governance-event append, and the append-only shape of the path — one insert
 * statement, no other table of another owner read, asserted from the SQL the module prepares
 * because a behavioural case shows what a call wrote and never which tables it touched on the way.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnknownStandardError } from "../standards/standard-registry";
import { InvalidProposalError, submitProposal, type StandardProposal } from "./submit-proposal";

/** The ordered migration files, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL("../../../../packages/shared/migrations/", import.meta.url));

/** The contributing account that submits the proposals below. */
const PROPOSER_ACCOUNT_ID = "demo-contributor-proposer";

/** The `standards` row id the proposals reference. */
const STANDARD_ID = "standard-sgi-so";

/** The code the standard is quoted by, which `getStandard` also accepts as a reference. */
const STANDARD_CODE = "SGI-SO-1.0.0";

/** An id no catalogue row carries and no code spells. */
const UNKNOWN_STANDARD_REFERENCE = "SGI-SO-9.9.9";

/**
 * A rationale carrying surrounding whitespace and an internal newline, stored exactly as submitted:
 * the padding and the line break are part of the contributor's own argument, so a reader of a
 * decided proposal sees what was written rather than a normalised rendering of it.
 */
const RATIONALE =
  "  The eighteen-of-twenty threshold reads the same fixture twice;\n  the rule should say which run counts.  ";

/** The stored shape of one `standard_proposals` row. */
interface StoredProposalRow {
  readonly id: string;
  readonly standard_id: string;
  readonly proposer_account_id: string;
  readonly title: string;
  readonly rationale: string;
  readonly status: string;
  readonly created_at: string;
}

/**
 * The tables the submission path must not read, each because it belongs to another owner or answers
 * another question: a listing and its versions are the API layer's, an account is the demo
 * session's, a category is browse metadata, and the sponsored slots and the audit feed are
 * commercial and write-log data no governance path may consult. A prepared statement naming any of
 * them would mean this module had begun resolving the submitting session itself.
 */
const TABLES_THE_SUBMISSION_PATH_MUST_NOT_READ = [
  "accounts",
  "listings",
  "listing_versions",
  "categories",
  "sponsored_slots",
  "audit_events",
] as const;

let db: Database.Database;

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** Writes the account a proposal is attributed to and the catalogue row it concerns. */
function insertFixture(database: Database.Database): void {
  database
    .prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)")
    .run(PROPOSER_ACCOUNT_ID, "demo-proposer", "contributor", "Demo contributor");
  database
    .prepare("INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)")
    .run(STANDARD_ID, STANDARD_CODE, "Structured Output Conformance", "The one provisional standard");
}

/** Every stored proposal, in the order the proposals were submitted. */
function readProposalRows(): StoredProposalRow[] {
  return db
    .prepare(
      `SELECT id, standard_id, proposer_account_id, title, rationale, status, created_at
       FROM standard_proposals
       ORDER BY created_at, id`,
    )
    .all() as StoredProposalRow[];
}

/** The only stored proposal, failing the case rather than the assertion when there is none. */
function firstProposalRow(): StoredProposalRow {
  const row = readProposalRows()[0];
  if (row === undefined) {
    throw new Error("expected the standard_proposals table to hold a row");
  }
  return row;
}

/** How many governance events the log holds. */
function countGovernanceEvents(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM governance_events").get() as { readonly n: number };
  return row.n;
}

/** How many triggers guard a table, by whatever names a migration gave them. */
function triggerCount(table: string): number {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table);
  return rows.length;
}

/**
 * Every SQL source string `submitProposal` prepared, in the order it prepared them.
 *
 * Filled by {@link installPrepareRecorder}, and the only way to assert the absence of a read: a
 * behavioural case shows what a call wrote, never which tables it touched on the way.
 */
let preparedStatements: string[] = [];

/**
 * Records the SQL source of every statement prepared through `db` from this point on.
 *
 * `prepare` is captured from the instance and replaced with an own property that delegates, rather
 * than spied on through the prototype: better-sqlite3 declares `prepare` on `Database.prototype`,
 * where a spy does not reliably attach. Install this after the migrations and the fixture — in a
 * test body, not in `beforeEach` — so the record holds what the module under test prepared and
 * nothing else.
 */
function installPrepareRecorder(): void {
  const original = db.prepare.bind(db) as unknown as (source: string) => unknown;

  preparedStatements = [];
  (db as unknown as { prepare: (source: string) => unknown }).prepare = (source: string) => {
    preparedStatements.push(source);
    return original(source);
  };
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

describe("submitProposal", () => {
  it("inserts exactly one proposal in status submitted and returns it", () => {
    const proposal: StandardProposal = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });
    const rows = readProposalRows();

    expect(rows).toHaveLength(1);
    expect(firstProposalRow()).toStrictEqual({
      id: proposal.proposalId,
      standard_id: STANDARD_ID,
      proposer_account_id: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
      status: "submitted",
      created_at: proposal.createdAt,
    });
  });

  it("generates a UUID identifier and an ISO-8601 UTC instant for the row", () => {
    const proposal = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });

    expect(proposal.proposalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(proposal.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(proposal.createdAt))).toBe(false);
    expect(firstProposalRow().created_at).toBe(proposal.createdAt);
  });

  it("returns the proposal from its input and the values it generated", () => {
    const proposal = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });

    expect(proposal).toStrictEqual({
      proposalId: proposal.proposalId,
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
      status: "submitted",
      createdAt: proposal.createdAt,
    });
  });

  it("stores the contributor's title and rationale verbatim, untrimmed", () => {
    const title = "  Add a seventh critical case  ";

    expect(RATIONALE).toContain("\n");

    const proposal = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title,
      rationale: RATIONALE,
    });

    expect(firstProposalRow().title).toBe(title);
    expect(firstProposalRow().rationale).toBe(RATIONALE);
    expect(firstProposalRow().title).not.toBe(title.trim());
    expect(firstProposalRow().rationale).not.toBe(RATIONALE.trim());
    expect(proposal.title).toBe(title);
    expect(proposal.rationale).toBe(RATIONALE);
  });

  it("stores the catalogue row id when the standard is addressed by its code", () => {
    const proposal = submitProposal(db, {
      standardId: STANDARD_CODE,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });

    expect(proposal.standardId).toBe(STANDARD_ID);
    expect(firstProposalRow().standard_id).toBe(STANDARD_ID);
  });

  it("resolves the code and the row id of one standard to the same stored row", () => {
    submitProposal(db, {
      standardId: STANDARD_CODE,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Addressed by code",
      rationale: RATIONALE,
    });
    submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Addressed by row id",
      rationale: RATIONALE,
    });

    expect(readProposalRows().map((row) => row.standard_id)).toStrictEqual([STANDARD_ID, STANDARD_ID]);
  });

  it("submits a second proposal for the same standard, leaving the first row unchanged", () => {
    const first = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });
    const firstRowBefore = firstProposalRow();

    const second = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });
    const rows = readProposalRows();

    expect(rows).toHaveLength(2);
    expect(first.proposalId).not.toBe(second.proposalId);
    // The read comes back in `created_at, id` order, and `created_at` is an instant the writer
    // stamps with millisecond resolution: two proposals submitted inside the same millisecond
    // arrive in id order, and two submitted a millisecond apart arrive in the order they were
    // submitted. Both sides are sorted so the case asserts which two ids were stored without
    // depending on which of those two orders the clock produced.
    expect(rows.map((row) => row.id).sort()).toEqual([first.proposalId, second.proposalId].sort());
    expect(rows).toContainEqual(firstRowBefore);
    expect(rows.every((row) => row.status === "submitted")).toBe(true);
  });

  it("appends no governance event", () => {
    submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });

    expect(countGovernanceEvents()).toBe(0);
  });

  it("joins a caller's open transaction rather than nesting one of its own", () => {
    const attempt = db.transaction((): void => {
      submitProposal(db, {
        standardId: STANDARD_ID,
        proposerAccountId: PROPOSER_ACCOUNT_ID,
        title: "Raise the pass threshold",
        rationale: RATIONALE,
      });
      throw new Error("caller rolled back");
    });

    expect(() => attempt()).toThrow("caller rolled back");
    expect(readProposalRows()).toHaveLength(0);
  });

  it.each(["", " ", "\n\t  "])("refuses %j as a title, writing nothing", (title) => {
    let failure: unknown;

    try {
      submitProposal(db, {
        standardId: STANDARD_ID,
        proposerAccountId: PROPOSER_ACCOUNT_ID,
        title,
        rationale: RATIONALE,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InvalidProposalError);
    expect((failure as InvalidProposalError).code).toBe("invalid_proposal");
    expect((failure as InvalidProposalError).name).toBe("InvalidProposalError");
    expect((failure as InvalidProposalError).field).toBe("title");
    expect((failure as InvalidProposalError).message).toContain("title");
    expect(readProposalRows()).toHaveLength(0);
  });

  it.each(["", " ", "\n\t  "])("refuses %j as a rationale, writing nothing", (rationale) => {
    let failure: unknown;

    try {
      submitProposal(db, {
        standardId: STANDARD_ID,
        proposerAccountId: PROPOSER_ACCOUNT_ID,
        title: "Raise the pass threshold",
        rationale,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InvalidProposalError);
    expect((failure as InvalidProposalError).code).toBe("invalid_proposal");
    expect((failure as InvalidProposalError).field).toBe("rationale");
    expect((failure as InvalidProposalError).message).toContain("rationale");
    expect(readProposalRows()).toHaveLength(0);
  });

  it("blames the title when both members are blank, because the title is checked first", () => {
    let failure: unknown;

    try {
      submitProposal(db, {
        standardId: STANDARD_ID,
        proposerAccountId: PROPOSER_ACCOUNT_ID,
        title: "   ",
        rationale: "   ",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InvalidProposalError);
    expect((failure as InvalidProposalError).field).toBe("title");
  });

  it("accepts the shortest padded text, which the blank set does not contain", () => {
    const PADDED = " x ";

    const proposal = submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: PADDED,
      rationale: PADDED,
    });

    expect(proposal.title).toBe(PADDED);
    expect(firstProposalRow().title).toBe(PADDED);
    expect(firstProposalRow().rationale).toBe(PADDED);
  });

  it("refuses an unknown standard reference and writes nothing", () => {
    let failure: unknown;

    try {
      submitProposal(db, {
        standardId: UNKNOWN_STANDARD_REFERENCE,
        proposerAccountId: PROPOSER_ACCOUNT_ID,
        title: "Raise the pass threshold",
        rationale: RATIONALE,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(UnknownStandardError);
    expect((failure as UnknownStandardError).code).toBe("unknown_standard");
    expect((failure as UnknownStandardError).name).toBe("UnknownStandardError");
    expect((failure as UnknownStandardError).reference).toBe(UNKNOWN_STANDARD_REFERENCE);
    expect((failure as UnknownStandardError).message).toContain(UNKNOWN_STANDARD_REFERENCE);
    expect(readProposalRows()).toHaveLength(0);
  });
});

describe("the standard_proposals row submitProposal writes", () => {
  it("closes the status vocabulary to the three outcomes a proposal can hold", () => {
    const insert = db.prepare(
      `INSERT INTO standard_proposals (id, standard_id, proposer_account_id, title, rationale, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    expect(() =>
      insert.run(
        "proposal-a",
        STANDARD_ID,
        PROPOSER_ACCOUNT_ID,
        "Raise the pass threshold",
        RATIONALE,
        "escalated",
        "2024-01-05T00:00:00.000Z",
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("carries no append-only trigger, which is what keeps a review's status change legal", () => {
    expect(triggerCount("standard_proposals")).toBe(0);
  });
});

describe("the statements submitProposal prepares", () => {
  it("inserts the proposal row and prepares no statement that rewrites or removes one", () => {
    installPrepareRecorder();

    submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });

    const proposalInserts = preparedStatements.filter((source) =>
      /\bINSERT\s+INTO\s+standard_proposals\b/i.test(source),
    );
    const mutations = preparedStatements.filter((source) => /\b(UPDATE|DELETE|REPLACE)\b|\bDROP\b/i.test(source));

    expect(proposalInserts).toHaveLength(1);
    expect(mutations).toEqual([]);
  });

  it("prepares no statement that reads a table belonging to another owner", () => {
    installPrepareRecorder();

    submitProposal(db, {
      standardId: STANDARD_ID,
      proposerAccountId: PROPOSER_ACCOUNT_ID,
      title: "Raise the pass threshold",
      rationale: RATIONALE,
    });

    // The executable form of the decision `submit-proposal.ts` states: resolving the submitting
    // session would mean reading the demo session's accounts here, and reading the listing layer's
    // tables would put another owner's data in this package. The write route supplies the account id
    // and the contract already answered both questions before this function was reached, so a
    // statement naming one of these tables fails this case.
    const forbiddenReads = TABLES_THE_SUBMISSION_PATH_MUST_NOT_READ.filter((table) =>
      preparedStatements.some((source) => new RegExp(`\\b${table}\\b`, "i").test(source)),
    );

    expect(forbiddenReads).toEqual([]);
  });

  it("prepares no statement at all for a blank member", () => {
    installPrepareRecorder();

    expect(() =>
      submitProposal(db, {
        standardId: STANDARD_ID,
        proposerAccountId: PROPOSER_ACCOUNT_ID,
        title: "   ",
        rationale: RATIONALE,
      }),
    ).toThrow(InvalidProposalError);

    // The text check runs before the standard is resolved, so a malformed request never reaches the
    // database — not even to find out whether the standard it names exists.
    expect(preparedStatements).toEqual([]);
  });
});
