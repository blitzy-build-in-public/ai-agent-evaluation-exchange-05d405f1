/**
 * Unit tests for the append-only governance event writer.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because the writer's contract is a statement executed
 * against a real schema: the stored shape, the canonical payload text, the generated id
 * and timestamp, and the append-only guard are all properties of the table rather than
 * of the function alone.
 *
 * Migration `0010_append_only_triggers.sql` is still being written, so the fixture
 * creates a stand-in guard when no trigger yet protects the table. The stand-in is
 * skipped as soon as that migration lands, and every other assertion reads the real
 * `governance_events` table `0007_governance_events_and_appeals.sql` declares.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOVERNANCE_EVENT_TYPES as SHARED_GOVERNANCE_EVENT_TYPES } from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GOVERNANCE_EVENT_TYPES,
  UnknownEventTypeError,
  appendEvent,
  type GovernanceEvent,
  type GovernanceEventType,
  type NewGovernanceEvent,
} from "./append-event";

/** The ordered migration files, resolved from this module's location rather than the working directory. */
const migrationsDir = fileURLToPath(new URL("../../../../packages/shared/migrations/", import.meta.url));

/** The synthetic operator account the appended events name, referencing `accounts.id`. */
const ACTOR_ACCOUNT_ID = "demo-operator-account";

/** The stored shape of one row, as the columns are named and as the schema declares their nullability. */
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

/** A value the writer accepts, with the payload of a moderation decision. */
const validEvent: NewGovernanceEvent = {
  subjectType: "listing",
  subjectId: "listing-not-in-the-database",
  eventType: "listing_moderated",
  actorAccountId: ACTOR_ACCOUNT_ID,
  reason: "Flagged for a limitation the listing does not disclose.",
  payload: { action: "flag" },
};

/**
 * A decision that carries neither a reason nor a payload, as a retest and a standard
 * version's publication do: the two kinds name what they point at and state no ground.
 */
const eventWithoutReasonOrPayload: NewGovernanceEvent = {
  subjectType: "standard_version",
  subjectId: "standard-version-the-retest-answers",
  eventType: "retest_created",
  actorAccountId: ACTOR_ACCOUNT_ID,
};

/** The stand-in append-only guard, used only until migration 0010 is applied. */
const APPEND_ONLY_STAND_IN = `CREATE TRIGGER governance_events_no_update BEFORE UPDATE ON governance_events
BEGIN
  SELECT RAISE(ABORT, 'governance_events is append-only');
END;
CREATE TRIGGER governance_events_no_delete BEFORE DELETE ON governance_events
BEGIN
  SELECT RAISE(ABORT, 'governance_events is append-only');
END;`;

let db: Database.Database;

/** How many triggers guard this table, by whatever names a migration gave them. */
function triggerCount(database: Database.Database, table: string): number {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
    .all(table);
  return rows.length;
}

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** Every stored row, in the order the log was written. */
function readRows(): StoredEventRow[] {
  return db
    .prepare(
      `SELECT id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at
       FROM governance_events
       ORDER BY created_at, id`,
    )
    .all() as StoredEventRow[];
}

/** How many events the log holds. */
function countEvents(): number {
  return readRows().length;
}

/** The only stored row, failing the case rather than the assertion when the log is empty. */
function firstRow(): StoredEventRow {
  const row = readRows()[0];
  if (row === undefined) {
    throw new Error("expected the log to hold a row");
  }
  return row;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  if (triggerCount(db, "governance_events") === 0) {
    db.exec(APPEND_ONLY_STAND_IN);
  }
  db.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)").run(
    ACTOR_ACCOUNT_ID,
    "demo-operator",
    "operator",
    "Demo operator",
  );
});

afterEach(() => {
  db.close();
});

describe("GOVERNANCE_EVENT_TYPES", () => {
  it("is the frozen, closed vocabulary @adem/shared declares, in its order", () => {
    expect(Object.isFrozen(GOVERNANCE_EVENT_TYPES)).toBe(true);
    expect([...GOVERNANCE_EVENT_TYPES]).toEqual([...SHARED_GOVERNANCE_EVENT_TYPES]);
  });

  it("derives its union from the array, so a spelling outside it is a compile error", () => {
    // @ts-expect-error a value outside the derived union is refused before it can be stored
    const outsideTheVocabulary: GovernanceEventType = "listing.archived";
    expect(GOVERNANCE_EVENT_TYPES).not.toContain(outsideTheVocabulary);
  });
});

describe("appendEvent", () => {
  it.each(GOVERNANCE_EVENT_TYPES)("appends a %s event as exactly one row", (eventType) => {
    appendEvent(db, { ...validEvent, eventType });

    expect(countEvents()).toBe(1);
    expect(firstRow().event_type).toBe(eventType);
  });

  it("generates a UUID identifier and an ISO-8601 UTC instant for the row", () => {
    const appended: GovernanceEvent = appendEvent(db, validEvent);
    const row = firstRow();

    expect(appended.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(appended.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(appended.createdAt))).toBe(false);
    expect(row.id).toBe(appended.id);
    expect(row.created_at).toBe(appended.createdAt);
  });

  it("returns the appended event from its input and the values it generated", () => {
    const appended = appendEvent(db, validEvent);

    expect(appended).toEqual({ ...validEvent, id: appended.id, createdAt: appended.createdAt });
  });

  it("stores the payload as canonical JSON: ordered keys, no insignificant whitespace", () => {
    appendEvent(db, {
      ...validEvent,
      payload: { note: "kept exactly ", probes: [2, { z: null, a: true }], action: "flag" },
    });

    expect(firstRow().payload_json).toBe('{"action":"flag","note":"kept exactly ","probes":[2,{"a":true,"z":null}]}');
  });

  it("stores a null payload as the string the canonical renderer produces", () => {
    appendEvent(db, { ...validEvent, payload: null });

    expect(firstRow().payload_json).toBe("null");
  });

  it("stores SQL NULL for a reason and a payload the decision does not carry", () => {
    const appended = appendEvent(db, eventWithoutReasonOrPayload);
    const row = firstRow();

    expect(row.reason).toBeNull();
    expect(row.payload_json).toBeNull();
    expect(appended).not.toHaveProperty("reason");
    expect(appended).not.toHaveProperty("payload");
    expect(appended).toEqual({
      ...eventWithoutReasonOrPayload,
      id: appended.id,
      createdAt: appended.createdAt,
    });
  });

  it("appends a second row rather than replacing the first", () => {
    const first = appendEvent(db, validEvent);
    const second = appendEvent(db, validEvent);
    const rows = readRows();

    expect(rows).toHaveLength(2);
    // The read's own row order is not asserted: `created_at` is a millisecond-resolution
    // instant the writer stamps, so two appends that straddle a millisecond come back in
    // the order they were written rather than in id order. Sorting both sides asserts
    // which two ids were stored, whichever of those two orders the clock produced.
    expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(rows[0]?.payload_json).toBe(rows[1]?.payload_json);
    expect(first.id).not.toBe(second.id);
  });

  it("reads no other table: a subject no table holds is still appended", () => {
    const appended = appendEvent(db, { ...validEvent, subjectId: "a-row-that-does-not-exist" });

    expect(firstRow().subject_id).toBe(appended.subjectId);
  });

  it("permits an empty reason, which is the only rule the writer does not impose", () => {
    appendEvent(db, { ...validEvent, reason: "" });

    expect(firstRow().reason).toBe("");
  });

  it("participates in the caller's transaction instead of opening its own", () => {
    const appendThenFail = db.transaction(() => {
      appendEvent(db, validEvent);
      throw new Error("the caller's transaction failed");
    });

    expect(() => appendThenFail()).toThrow("the caller's transaction failed");
    expect(countEvents()).toBe(0);
  });

  it.each([
    "listing.archived",
    "proposal.accepted",
    "appeal.upheld",
    "standard.published",
  ])("refuses %s as an event type before it writes anything", (eventType) => {
    let failure: unknown;
    try {
      appendEvent(db, { ...validEvent, eventType: eventType as GovernanceEventType });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(UnknownEventTypeError);
    const refusal = failure as UnknownEventTypeError;
    expect(refusal.name).toBe("UnknownEventTypeError");
    expect(refusal.code).toBe("unknown_event_type");
    expect(refusal.eventType).toBe(eventType);
    expect(refusal.message.startsWith("sgi-core:")).toBe(true);
    expect(refusal.message).toContain(eventType);
    expect(countEvents()).toBe(0);
  });

  it("is guarded against mutation, so an appended row stands", () => {
    const appended = appendEvent(db, validEvent);
    const before = firstRow();

    // The message is the trigger's; migration 0010 owns its wording, and the refusal itself is the contract.
    expect(() =>
      db.prepare("UPDATE governance_events SET reason = ? WHERE id = ?").run("Rewritten later.", appended.id),
    ).toThrow();
    expect(() => db.prepare("DELETE FROM governance_events WHERE id = ?").run(appended.id)).toThrow();
    expect(firstRow()).toEqual(before);
  });
});
