/**
 * The beside-source unit test of `appendEvent` from `./append-event`: the single insert path
 * into `governance_events`, ADEM's append-only log of the domain decisions the Standard Gate
 * Index records.
 *
 * Every case runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, applied here in filename order exactly as
 * `apps/api/src/db/migrate.ts` applies them, because the writer's contract is a statement
 * executed against a real schema: the stored column shape, the canonical payload text, the
 * generated id and instant, and the append-only guard are properties of the table rather
 * than of the function alone. Nothing is stood in for — no table, column or trigger is
 * declared in this file — so a migration the harness cannot read, or a column the module
 * spells differently, fails loudly here instead of passing against duplicated DDL.
 *
 * Nine behaviours are proven: the closed vocabulary and its fixed order; that every member
 * is accepted with the fields the writer generates; the refusal outside the vocabulary and
 * that it writes nothing; the canonical payload and its byte-stability; that the write
 * appends rather than upserts; the append-only guard-rail behind the row; that this module
 * writes no audit row; the exact shape of what it returns; and one row per call.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOVERNANCE_EVENT_TYPES as SHARED_GOVERNANCE_EVENT_TYPES } from "@adem/shared";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalize } from "../scoring/canonical-json";
import {
  GOVERNANCE_EVENT_TYPES,
  UnknownEventTypeError,
  appendEvent,
  type GovernanceEvent,
  type GovernanceEventType,
  type NewGovernanceEvent,
} from "./append-event";

/**
 * The ordered migrations, resolved from this module's own location rather than the working
 * directory, so the same files are read wherever the suite was started.
 */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

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

/** The version-4 UUID shape `randomUUID` produces, which every appended row's id must match. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The ISO-8601 UTC instant shape `new Date().toISOString()` produces: date, time to the
 * millisecond and a trailing `Z`. SQLite's `CURRENT_TIMESTAMP` renders `YYYY-MM-DD HH:MM:SS`
 * instead — no `T`, no milliseconds, no zone marker — which is why a timestamp is never left
 * to a column default.
 */
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The closed vocabulary this module enforces, spelled out here in its fixed order.
 *
 * Written as a literal rather than compared against the shared tuple alone, so that a member
 * added, dropped, renamed or reordered in `@adem/shared` fails this file rather than being
 * followed silently: every reader of the trail switches on these values, so the set and its
 * order are a contract rather than an implementation detail. None of the spellings the refusal
 * cases below pass is a member.
 */
const EXPECTED_EVENT_TYPES: ReadonlyArray<GovernanceEventType> = [
  "standard_version_published",
  "proposal_reviewed",
  "listing_moderated",
  "appeal_opened",
  "appeal_ruled",
  "retest_created",
];

/**
 * Spellings the guard refuses, typed as plain strings so this file may pass them.
 *
 * The first four are namespaced with a dot, the shape a caller who has not read the declared
 * tuple would invent; the last is a plausible snake_case neighbour of a real member, which is
 * what pins the guard to the declared list rather than to a prefix or a "close enough" rule.
 * A `governance_events` row can never be corrected, which is why a spelling outside the
 * vocabulary is refused before it is written rather than stored and regretted.
 */
const REFUSED_EVENT_TYPES: ReadonlyArray<string> = [
  "listing.archived",
  "listing.flagged",
  "appeal.upheld",
  "standard.published",
  "proposal_rejected",
];

/**
 * The members a returned event carries when the decision states both a reason and a payload,
 * and the six it carries when it states neither.
 *
 * Typed as `keyof GovernanceEvent`, so a member renamed or dropped in the interface fails the
 * build here instead of leaving an assertion that pins a shape nothing produces.
 */
const EVENT_MEMBERS_WITH_BOTH_OPTIONALS: ReadonlyArray<keyof GovernanceEvent> = [
  "actorAccountId",
  "createdAt",
  "eventType",
  "id",
  "payload",
  "reason",
  "subjectId",
  "subjectType",
];
const EVENT_MEMBERS_WITH_NEITHER_OPTIONAL: ReadonlyArray<keyof GovernanceEvent> = [
  "actorAccountId",
  "createdAt",
  "eventType",
  "id",
  "subjectId",
  "subjectType",
];

let db: Database.Database;

/** Applies every migration in filename order, which is the order the runner applies them. */
function applyMigrations(database: Database.Database): void {
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/**
 * Every stored row, in the order the log was written. The statement is parameterised with the
 * row shape rather than its result cast to it, so the reader's own typing is checked against
 * the columns it selects.
 */
function readRows(): StoredEventRow[] {
  return db
    .prepare<[], StoredEventRow>(
      `SELECT id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at
       FROM governance_events
       ORDER BY created_at, id`,
    )
    .all();
}

/** How many events the log holds. */
function countEvents(): number {
  return readRows().length;
}

/**
 * How many rows the *other* log holds.
 *
 * `audit_events` belongs to `apps/api`, which appends one row per write request and answers the
 * question "what was written"; `governance_events` answers "what was decided". They are
 * deliberately separate feeds, so a count taken here proves this module leaves the API's log
 * alone.
 */
function countAuditEvents(): number {
  const counted = db.prepare<[], { total: number }>("SELECT count(*) AS total FROM audit_events").get();
  if (counted === undefined) {
    throw new Error("the audit log answered no row for its own count");
  }
  return counted.total;
}

/** The only stored row, failing the case rather than the assertion when the log is empty. */
function firstRow(): StoredEventRow {
  const row = readRows()[0];
  if (row === undefined) {
    throw new Error("expected the log to hold a row");
  }
  return row;
}

/** The canonical payload text of the only stored row, failing the case when it stores none. */
function firstPayloadJson(): string {
  const { payload_json: payloadJson } = firstRow();
  if (payloadJson === null) {
    throw new Error("expected the appended row to store a payload");
  }
  return payloadJson;
}

/**
 * The canonical text with every string value blanked out.
 *
 * It exists because the two halves of the whitespace rule are asserted on one string: whitespace
 * *inside* a string value is data and must survive, while whitespace *between* tokens must not
 * exist at all. Blanking the literals lets the second half be asserted without tripping over
 * the first.
 */
function outsideStringValues(canonicalText: string): string {
  return canonicalText.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
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
  it("is the closed vocabulary, in its fixed order, and is frozen", () => {
    expect(GOVERNANCE_EVENT_TYPES).toEqual(EXPECTED_EVENT_TYPES);
    expect([...GOVERNANCE_EVENT_TYPES]).toEqual([...SHARED_GOVERNANCE_EVENT_TYPES]);
    // Frozen, so no caller can widen the set at runtime: a member is added to the shared tuple
    // and read through every call site, never pushed on here.
    expect(Object.isFrozen(GOVERNANCE_EVENT_TYPES)).toBe(true);
  });

  it("derives its union from the array, so a spelling outside it is a compile error", () => {
    // @ts-expect-error a value outside the derived union is refused before it can be stored
    const outsideTheVocabulary: GovernanceEventType = "listing.archived";
    expect(GOVERNANCE_EVENT_TYPES).not.toContain(outsideTheVocabulary);
  });
});

describe("appendEvent", () => {
  it("accepts every member of the vocabulary, appending exactly one row each", () => {
    const appendedEvents = GOVERNANCE_EVENT_TYPES.map((eventType) =>
      appendEvent(db, { ...validEvent, eventType, payload: { recorded_event_type: eventType } }),
    );

    // Every member round-trips through the closed set, in the order it declares...
    const returnedTypes = appendedEvents.map((appended) => appended.eventType);
    expect(returnedTypes).toEqual([...GOVERNANCE_EVENT_TYPES]);
    // ...each returns the decision it was given, with only the two generated members added...
    for (const appended of appendedEvents) {
      expect(appended).toEqual({
        ...validEvent,
        eventType: appended.eventType,
        payload: { recorded_event_type: appended.eventType },
        id: appended.id,
        createdAt: appended.createdAt,
      });
    }
    // ...and one row was appended per member, no id written twice. The stored types are compared
    // as sets because the read's order is the database's (`created_at`, then `id`) rather than
    // insertion order: appends in the same millisecond share an instant.
    const writtenIds = new Set(appendedEvents.map((appended) => appended.id));
    const storedTypes = readRows().map((row) => row.event_type).sort();
    expect(countEvents()).toBe(GOVERNANCE_EVENT_TYPES.length);
    expect(writtenIds.size).toBe(GOVERNANCE_EVENT_TYPES.length);
    expect(storedTypes).toEqual([...GOVERNANCE_EVENT_TYPES].sort());
  });

  it("generates a version-4 UUID and an ISO-8601 UTC instant for the row", () => {
    const appended: GovernanceEvent = appendEvent(db, validEvent);
    const row = firstRow();

    expect(appended.id).toMatch(UUID_V4_PATTERN);
    expect(appended.createdAt).toMatch(ISO_8601_UTC_PATTERN);
    // The instant round-trips unchanged, which a string in any other form or zone would not:
    // it is the shape a reader orders the trail by, and it is why no column default supplies it.
    expect(new Date(appended.createdAt).toISOString()).toBe(appended.createdAt);
    expect(row.id).toBe(appended.id);
    expect(row.created_at).toBe(appended.createdAt);
  });

  it("returns the caller's decision unchanged, alongside the two values it generated", () => {
    const appended = appendEvent(db, validEvent);

    expect(appended).toEqual({ ...validEvent, id: appended.id, createdAt: appended.createdAt });
    // Exactly the eight members a decision carrying both a reason and a payload fills, so
    // nothing locale- or clock-dependent leaked into the shape.
    expect(Object.keys(appended).sort()).toEqual([...EVENT_MEMBERS_WITH_BOTH_OPTIONALS].sort());
  });

  it("stores the payload as canonical JSON: code-unit key order, no insignificant whitespace", () => {
    const payload = { note: "kept exactly ", probes: [2, { z: null, a: true }], action: "flag" };

    appendEvent(db, { ...validEvent, payload });

    const stored = firstPayloadJson();
    expect(stored).toBe(canonicalize(payload));
    expect(stored).toBe('{"action":"flag","note":"kept exactly ","probes":[2,{"a":true,"z":null}]}');

    // Keys are ordered by UTF-16 code unit at every level rather than in the order they were
    // written: "action" < "note" < "probes", and "a" < "z" inside the nested object.
    const codeUnitOrderedPairs: ReadonlyArray<readonly [string, string]> = [
      ['"action"', '"note"'],
      ['"note"', '"probes"'],
      ['"a":true', '"z":null'],
    ];
    for (const [earlier, later] of codeUnitOrderedPairs) {
      expect(stored.indexOf(earlier)).toBeLessThan(stored.indexOf(later));
    }

    // Outside a string value no whitespace survives, while the trailing space *inside* the note
    // is data and is kept — the distinction case `so-018` of the fixture set turns on.
    const outsideStrings = outsideStringValues(stored);
    expect(outsideStrings).not.toContain(": ");
    expect(outsideStrings).not.toContain(", ");
    expect(outsideStrings).not.toMatch(/\s/);
    expect(stored).toContain('"note":"kept exactly "');
  });

  it("stores byte-identical text for two payloads that differ only in key order", () => {
    const canonical = canonicalize({ action: "flag", note: "kept exactly " });

    appendEvent(db, { ...validEvent, payload: { action: "flag", note: "kept exactly " } });
    appendEvent(db, { ...validEvent, payload: { note: "kept exactly ", action: "flag" } });

    // Two decisions, two rows — and one canonical text, because a reader that compared the
    // written order instead would see a difference no reader of the JSON can observe.
    expect(canonical).toBe('{"action":"flag","note":"kept exactly "}');
    expect(readRows().map((row) => row.payload_json)).toEqual([canonical, canonical]);
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
    // Six members, not eight: an optional the decision does not state is omitted rather than
    // carried as an explicit `undefined`, which a reader could not tell from an absent key.
    expect(Object.keys(appended).sort()).toEqual([...EVENT_MEMBERS_WITH_NEITHER_OPTIONAL].sort());
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
    expect(first.id).not.toBe(second.id);
    // Two appends carrying identical columns apart from the identifier each call generates
    // produce two rows, so the write adds rather than collapsing on a natural key: an
    // `INSERT OR REPLACE` or `INSERT OR IGNORE` keyed on any of the decision's own columns —
    // `subject_type`, `subject_id`, `event_type`, `actor_account_id` — would leave one row here.
    // A conflicting REPLACE removes the row it collides with *without* firing the DELETE trigger
    // the guard-rail case below demonstrates, so the writer's rule that neither upsert clause is
    // used is a code shape the table cannot enforce; this case therefore asserts two rows rather
    // than trusting the guard.
    const canonical = canonicalize({ action: "flag" });
    expect(canonical).toBe('{"action":"flag"}');
    expect(rows.map((row) => row.payload_json)).toEqual([canonical, canonical]);
    // The two instants are what they claim to be, round-tripping unchanged.
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);
    expect(new Date(second.createdAt).toISOString()).toBe(second.createdAt);
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

  it.each(REFUSED_EVENT_TYPES)("refuses %s before it writes anything", (eventType) => {
    appendEvent(db, validEvent);
    const before = countEvents();
    let failure: unknown;
    try {
      // The cast is deliberate and is the only one in this file: the guard exists for untyped
      // input — a value that reached the writer from a request body or a JSON file — so the test
      // has to smuggle a non-member past the compiler to exercise it. Without it the guard would
      // be unreachable from typed code and untested.
      appendEvent(db, { ...validEvent, eventType: eventType as unknown as GovernanceEventType });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toBeInstanceOf(UnknownEventTypeError);
    const refusal = failure as UnknownEventTypeError;
    expect(refusal.name).toBe("UnknownEventTypeError");
    expect(refusal.code).toBe("unknown_event_type");
    expect(refusal.eventType).toBe(eventType);
    expect(refusal.message.startsWith("sgi-core:")).toBe(true);
    expect(refusal.message).toContain(eventType);
    // The refusal happens before the statement runs, so it appends nothing: the row count is
    // exactly what it was when the refused call was made.
    expect(countEvents()).toBe(before);
  });

  it("writes no audit row, because the two logs answer different questions", () => {
    appendEvent(db, validEvent);
    appendEvent(db, eventWithoutReasonOrPayload);

    expect(countEvents()).toBe(2);
    expect(countAuditEvents()).toBe(0);
  });

  it("is guarded against mutation, so an appended row stands", () => {
    const appended = appendEvent(db, validEvent);
    const before = firstRow();

    // The guard is the pair of `BEFORE UPDATE` and `BEFORE DELETE` triggers
    // `0010_append_only_triggers.sql` raises `ABORT` from, and it is defence in depth rather
    // than a security boundary: a connection holding write access can drop one. What the
    // assertion proves is the guard-rail, not a security property. The message is the
    // trigger's — migration 0010 owns its wording — so only the refusal is asserted.
    expect(() =>
      db.prepare("UPDATE governance_events SET reason = ? WHERE id = ?").run("Rewritten later.", appended.id),
    ).toThrow();
    expect(() => db.prepare("DELETE FROM governance_events WHERE id = ?").run(appended.id)).toThrow();

    // The row stands byte for byte, down to the two columns an attempt would have changed.
    expect(firstRow()).toEqual(before);
    expect(firstRow().reason).toBe(validEvent.reason);
    expect(firstRow().payload_json).toBe(canonicalize({ action: "flag" }));
  });
});
