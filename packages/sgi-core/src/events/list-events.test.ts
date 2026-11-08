/**
 * Unit tests for the governance event read path.
 *
 * Every case below runs against a real SQLite database built from the ordered migrations in
 * `packages/shared/migrations/`, because the reader's contract is a statement executed against a
 * real schema: the eight columns it maps, the insertion order its `rowid` tie-break produces and
 * the payload it parses are properties of the table and the query rather than of the function
 * alone. No table is created by hand here, so a column name the migrations do not declare fails
 * this suite loudly instead of being papered over by a fixture that agrees with the code.
 *
 * The assertions answer the four questions a caller puts to a trail: in what order do the decisions
 * read, which slice does each filter dimension select and what do combinations of them select, is a
 * match of no rows an answer rather than a failure, and does a payload come back as the value that
 * was stored. AAP §0.7 criterion 4's read half is the ruling-trail case — an appeal's ruling is
 * readable by the appeal it concerns, while the report that ruling leaves alone stays untouched.
 *
 * The ruling-shaped event is appended through {@link appendEvent} rather than through
 * `../appeals/rule-appeal.ts`, deliberately: importing that module would couple this folder's
 * reader tests to another folder's writer, to its own single transaction and to its own
 * beside-source suite, which is where the write half of that guarantee belongs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalize } from "../scoring/canonical-json";
import { appendEvent, type NewGovernanceEvent } from "./append-event";
import { listEvents, type EventFilter } from "./list-events";

/**
 * The ordered migration files, resolved from this module's own location rather than from the
 * working directory, so the harness applies the delivered schema wherever the run was started.
 */
const migrationsDir = fileURLToPath(new URL("../../../shared/migrations/", import.meta.url));

/** The synthetic operator account every appended decision names, referencing `accounts.id`. */
const ACTOR_ACCOUNT_ID = "demo-operator-account";

/**
 * The payload whose round trip the reader is asserted to preserve: a nested object, an array, an
 * integer, a boolean and JSON's own null, so every branch of a JSON value is exercised at once.
 */
const probePayload = {
  probe: { count: 7, flag: true, nothing: null },
  tags: ["alpha-yard", "beta-yard"],
};

/**
 * A moderation action on one listing: a decision that states a reason and carries a payload, which
 * is the shape most events have. The listing id is a caller's, because a moderation trail is read by
 * the listing it concerns.
 */
function moderationEvent(subjectId: string): NewGovernanceEvent {
  return {
    subjectType: "listing",
    subjectId,
    eventType: "listing_moderated",
    actorAccountId: ACTOR_ACCOUNT_ID,
    reason: "Flagged for a limitation the listing does not disclose.",
    payload: { action: "flag" },
  };
}

/** An operator's review of one standards proposal, recorded against the proposal it decides. */
function proposalReviewEvent(subjectId: string): NewGovernanceEvent {
  return {
    subjectType: "standard_proposal",
    subjectId,
    eventType: "proposal_reviewed",
    actorAccountId: ACTOR_ACCOUNT_ID,
    reason: "Accepted: the proposal states a rubric and a pass rule.",
    payload: { decision: "accepted" },
  };
}

/**
 * A retest recorded against the report it answers: the kind that decides by what it points at and
 * therefore carries neither a reason nor a payload, which is why it is the fixture for the reader's
 * absent-member mapping as well as for the subject filters.
 */
function retestEvent(subjectId: string): NewGovernanceEvent {
  return {
    subjectType: "evaluation_report",
    subjectId,
    eventType: "retest_created",
    actorAccountId: ACTOR_ACCOUNT_ID,
  };
}

/**
 * An appeal's ruling as `../appeals/rule-appeal.ts` appends it: recorded against the appeal it
 * decides, naming the operator that ruled it, stating the operator's ground and carrying the
 * ruling in its payload together with the status the appeal held before it was ruled. The contested
 * report travels in that payload as context only — the event's subject is the appeal, so the
 * report's own trail stays what the measurement wrote.
 */
function rulingEvent(appealId: string, reportId: string): NewGovernanceEvent {
  return {
    subjectType: "appeal",
    subjectId: appealId,
    eventType: "appeal_ruled",
    actorAccountId: ACTOR_ACCOUNT_ID,
    reason: "The ruling rests on the per-case evidence the report records.",
    payload: { appealId, reportId, previousStatus: "open", status: "upheld" },
  };
}

/** How many decisions the log holds, read back so a test can assert a read wrote nothing. */
interface CountRow {
  readonly count: number;
}

/** One stored row's payload text, read back so a test can assert a read changed nothing. */
interface PayloadRow {
  readonly payload_json: string | null;
}

/** One schema object's name, read back so the harness case can assert which migrations ran. */
interface NameRow {
  readonly name: string;
}

let db: Database.Database;

/** The migration filenames the harness applies, in the order the runner applies them. */
function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Applies every migration in filename order. A directory it cannot read, or one holding no `.sql`
 * file, is an error rather than an empty schema: no table is created by hand anywhere in this suite,
 * so a migration set that went missing has to fail loudly here.
 */
function applyMigrations(database: Database.Database): void {
  const files = migrationFiles();
  if (files.length === 0) {
    throw new Error(
      `the migrations directory ${migrationsDir} holds no .sql file, so the read path would be tested against no schema`,
    );
  }
  for (const file of files) {
    database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
}

/** How many decisions the log holds, read without the reader under test. */
function eventCount(): number {
  const row = db
    .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM governance_events")
    .get();
  if (row === undefined) {
    throw new Error("expected the count query to return a row");
  }
  return row.count;
}

/** One stored row's payload text as the table holds it, failing the case rather than the assertion for an unknown id. */
function storedPayloadJson(id: string): string | null {
  const row = db
    .prepare<[string], PayloadRow>("SELECT payload_json FROM governance_events WHERE id = ?")
    .get(id);
  if (row === undefined) {
    throw new Error(`expected the log to hold a row with id ${id}`);
  }
  return row.payload_json;
}

/** The names of the schema objects of one kind, sorted, so a case can assert what the migrations created. */
function schemaObjectNames(type: "table" | "trigger", table?: string): string[] {
  const statement =
    table === undefined
      ? "SELECT name FROM sqlite_master WHERE type = ? ORDER BY name"
      : "SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = ? ORDER BY name";
  const rows =
    table === undefined
      ? db.prepare<[string], NameRow>(statement).all(type)
      : db.prepare<[string, string], NameRow>(statement).all(type, table);
  return rows.map((row) => row.name);
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

describe("the harness", () => {
  it("applies the delivered migrations, so the read path is proven against the real schema", () => {
    const files = migrationFiles();

    expect(files.length).toBeGreaterThan(0);
    // Named rather than counted: the read path reads a table this migration declares, and the
    // migration set is still growing, so asserting a count would pin the wrong fact.
    expect(files).toContain("0007_governance_events_and_appeals.sql");
    expect(schemaObjectNames("table")).toContain("governance_events");
    // The foreign key every appended event carries needs its target to exist for a row to be appended.
    expect(schemaObjectNames("table")).toContain("accounts");
    // Both append-only guards from 0010 stand on the table the direct INSERT below writes to.
    expect(schemaObjectNames("trigger", "governance_events")).toHaveLength(2);
  });
});

describe("listEvents", () => {
  describe("the order a trail reads in", () => {
    it("returns every appended decision in the order it was appended", () => {
      // `appendEvent` stamps an ISO-8601 instant with millisecond precision, so two decisions
      // appended inside the same millisecond carry the same `created_at` and the order asserted here
      // is guaranteed by the query's `rowid ASC` tie-break rather than by distinct timestamps.
      const moderation = appendEvent(db, moderationEvent("demo-listing-north-yard"));
      const review = appendEvent(db, proposalReviewEvent("demo-proposal-yard-notes"));
      const retest = appendEvent(db, retestEvent("demo-report-north-alpha"));

      const events = listEvents(db, {});

      expect(events).toHaveLength(3);
      expect(events.map((event) => event.id)).toEqual([moderation.id, review.id, retest.id]);
      // The read maps the stored snake_case columns back to the members the writer returned, so a
      // decision is the same value whichever half of the pair a caller reached for. The third event
      // carries no reason and no payload, which is the mapping that would otherwise drift.
      expect(events).toStrictEqual([moderation, review, retest]);
    });

    it("tie-breaks two rows written at the same instant by rowid rather than by id", () => {
      // The insert below is a plain INSERT, which is the appender's own statement: migration 0010
      // guards UPDATE and DELETE on this table and leaves INSERT alone. The pinned instant is what
      // reaches the tie deliberately: `appendEvent` stamps `new Date().toISOString()` at its
      // millisecond resolution, so two appends inside one millisecond reach it by accident; what
      // this case adds is a `created_at` the test states rather than one the clock chose.
      const sameInstant = "2024-03-14T00:00:00.000Z";
      const insert = db.prepare(
        `INSERT INTO governance_events
           (id, subject_type, subject_id, event_type, actor_account_id, reason, payload_json, created_at)
         VALUES
           (@id, @subjectType, @subjectId, @eventType, @actorAccountId, @reason, @payloadJson, @createdAt)`,
      );
      const written = [
        { id: "demo-event-yard-zulu", subjectId: "demo-listing-yard-zulu" },
        { id: "demo-event-yard-alpha", subjectId: "demo-listing-yard-alpha" },
      ];
      for (const row of written) {
        insert.run({
          ...row,
          subjectType: "listing",
          eventType: "listing_moderated",
          actorAccountId: ACTOR_ACCOUNT_ID,
          reason: "Flagged for a limitation the listing does not disclose.",
          payloadJson: '{"action":"flag"}',
          createdAt: sameInstant,
        });
      }

      const returned = listEvents(db, {}).map((event) => event.id);

      expect(returned).toEqual(["demo-event-yard-zulu", "demo-event-yard-alpha"]);
      // The two ids are written in the reverse of lexicographic order, so a read that ordered by id
      // rather than by rowid would return them the other way round: this pair pins the key, and the
      // filtered read below pins the tie-break clause itself.
      expect(returned).toEqual(written.map((row) => row.id).sort().reverse());

      // The indexed read is the one that parts company with a read missing the tie-break, and the
      // plan rather than the filter is why: `EXPLAIN QUERY PLAN` reports `SCAN governance_events ;
      // USE TEMP B-TREE FOR ORDER BY` for the unfiltered read above, whose sort sees the rows in
      // `rowid` order and so returns them the same way with or without the clause, while this one's
      // plan is `SEARCH governance_events USING INDEX idx_governance_events_subject
      // (subject_type=?)`, whose rows arrive in `subject_id` order — the reverse of the order in
      // which they were appended. This read, and not the pair above, therefore fails once `rowid ASC`
      // leaves `listEvents`' `ORDER BY`.
      const filtered = listEvents(db, { subjectType: "listing" }).map((event) => event.id);

      expect(filtered).toEqual(written.map((row) => row.id));
      expect(filtered).toEqual(returned);
    });

    it("takes its order from the query rather than from any comparison in TypeScript", () => {
      // The three subjects differ only in case, which is where a sort done in JavaScript would part
      // company with insertion order: the default comparator orders them by UTF-16 code unit and a
      // locale-aware one would ignore the case. Both orders are rejected below, so a refactor that
      // sorts the rows after reading them fails here instead of silently reordering a trail.
      const appended = [
        appendEvent(db, moderationEvent("Gamma-listing-yard")),
        appendEvent(db, moderationEvent("alpha-listing-yard")),
        appendEvent(db, moderationEvent("Beta-listing-yard")),
      ];

      const subjects = listEvents(db, {}).map((event) => event.subjectId);

      expect(subjects).toEqual(appended.map((event) => event.subjectId));
      expect(subjects).not.toEqual([...subjects].sort());
      expect(subjects).not.toEqual([
        "alpha-listing-yard",
        "Beta-listing-yard",
        "Gamma-listing-yard",
      ]);
    });
  });

  describe("each filter dimension", () => {
    it("selects the rows of the named subject type and leaves the others", () => {
      const firstModeration = appendEvent(db, moderationEvent("demo-listing-north-yard"));
      const review = appendEvent(db, proposalReviewEvent("demo-proposal-yard-notes"));
      const secondModeration = appendEvent(db, moderationEvent("demo-listing-east-yard"));

      expect(listEvents(db, { subjectType: "listing" })).toStrictEqual([
        firstModeration,
        secondModeration,
      ]);
      expect(listEvents(db, { subjectType: "standard_proposal" })).toStrictEqual([review]);
    });

    it("selects the rows carrying the named subject id, in the order they were appended", () => {
      const flagged = appendEvent(db, moderationEvent("demo-listing-north-yard"));
      const hidden = appendEvent(db, {
        subjectType: "listing",
        subjectId: "demo-listing-north-yard",
        eventType: "listing_moderated",
        actorAccountId: ACTOR_ACCOUNT_ID,
        reason: "Hidden after the buyer's challenge was upheld.",
        payload: { action: "hide" },
      });
      appendEvent(db, moderationEvent("demo-listing-east-yard"));

      const trail = listEvents(db, { subjectId: "demo-listing-north-yard" });

      // One listing's own history, oldest first: the two decisions that concern it and neither of
      // the decisions that concern another.
      expect(trail.map((event) => event.id)).toEqual([flagged.id, hidden.id]);
      expect(trail.map((event) => event.payload)).toStrictEqual([
        { action: "flag" },
        { action: "hide" },
      ]);
    });

    it("selects the rows of the named event type", () => {
      const firstRetest = appendEvent(db, retestEvent("demo-report-north-alpha"));
      const moderation = appendEvent(db, moderationEvent("demo-listing-north-yard"));
      const secondRetest = appendEvent(db, retestEvent("demo-report-east-beta"));

      expect(listEvents(db, { eventType: "retest_created" })).toStrictEqual([
        firstRetest,
        secondRetest,
      ]);
      expect(listEvents(db, { eventType: "listing_moderated" })).toStrictEqual([moderation]);
    });

    it.each<[string, EventFilter]>([
      ["a subject type", { subjectType: "" }],
      ["a subject id", { subjectId: "" }],
    ])(
      "treats an empty string as a stated filter for %s rather than as an absent dimension",
      (_described, filter) => {
        appendEvent(db, moderationEvent("demo-listing-north-yard"));

        // The filter's own distinction, and the reason its guards test `!== undefined`: an absent
        // member does not constrain a dimension, while a member holding "" is a filter for the empty
        // string. A guard testing truthiness would conflate the two and answer with the whole log.
        // The third dimension cannot be asked the same question at all — `eventType` is typed as the
        // closed vocabulary, so a value outside it is a compile error rather than a lookup that
        // silently matches nothing.
        expect(listEvents(db, filter)).toStrictEqual([]);
        expect(listEvents(db, {})).toHaveLength(1);
      },
    );
  });

  describe("combinations of dimensions", () => {
    it("narrows to the intersection of the dimensions given", () => {
      // Two retests and one appeal opening share a subject kind, which is what makes the
      // intersection of the two dimensions narrower than either dimension on its own.
      const firstRetest = appendEvent(db, retestEvent("demo-report-north-alpha"));
      const appealOpened = appendEvent(db, {
        subjectType: "evaluation_report",
        subjectId: "demo-report-north-alpha",
        eventType: "appeal_opened",
        actorAccountId: ACTOR_ACCOUNT_ID,
        reason: "Contested the matched count the report records.",
      });
      const secondRetest = appendEvent(db, retestEvent("demo-report-east-beta"));

      const retests = listEvents(db, {
        subjectType: "evaluation_report",
        eventType: "retest_created",
      });

      expect(retests).toStrictEqual([firstRetest, secondRetest]);
      expect(retests.map((event) => event.id)).not.toContain(appealOpened.id);
      // A third dimension names exactly one row of the whole log, because the two retests differ in
      // the report they answer.
      expect(
        listEvents(db, {
          subjectType: "evaluation_report",
          subjectId: "demo-report-east-beta",
          eventType: "retest_created",
        }),
      ).toStrictEqual([secondRetest]);
    });

    it("returns nothing for a combination of dimensions no row satisfies", () => {
      appendEvent(db, retestEvent("demo-report-north-alpha"));
      appendEvent(db, rulingEvent("demo-appeal-north", "demo-report-north-alpha"));
      appendEvent(db, moderationEvent("demo-listing-north-yard"));

      // Each of the two dimensions matches a row on its own, and the pair of them matches none.
      expect(listEvents(db, { subjectType: "appeal" })).toHaveLength(1);
      expect(listEvents(db, { eventType: "retest_created" })).toHaveLength(1);
      expect(
        listEvents(db, { subjectType: "appeal", eventType: "retest_created" }),
      ).toStrictEqual([]);
      expect(
        listEvents(db, {
          subjectType: "appeal",
          subjectId: "demo-appeal-north",
          eventType: "retest_created",
        }),
      ).toStrictEqual([]);
    });
  });

  describe("a result of no rows", () => {
    it.each<[string, EventFilter]>([
      ["a subject id no row carries", { subjectId: "00000000-0000-4000-8000-0000000000ff" }],
      ["a subject type no row carries", { subjectType: "no-such-subject-type" }],
      ["an event type no row carries", { eventType: "appeal_ruled" }],
    ])("answers %s with an empty array rather than an error", (_described, filter) => {
      // The log holds a decision, so the empty result below is the filter's answer and not the
      // table's emptiness: *no such subject* and *a subject with no history yet* are the same answer.
      appendEvent(db, moderationEvent("demo-listing-north-yard"));
      const before = eventCount();

      expect(() => listEvents(db, filter)).not.toThrow();

      const events = listEvents(db, filter);

      expect(Array.isArray(events)).toBe(true);
      expect(events).toHaveLength(0);
      // A read is a read: asking a question that matches nothing writes nothing.
      expect(eventCount()).toBe(before);
    });
  });

  describe("an appeal's ruling trail", () => {
    it("is readable by the appeal it concerns, by its subject type and by its event type", () => {
      const ruled = appendEvent(db, rulingEvent("demo-appeal-north", "demo-report-north-alpha"));
      appendEvent(db, moderationEvent("demo-listing-north-yard"));

      expect(listEvents(db, { subjectId: "demo-appeal-north" })).toStrictEqual([ruled]);
      expect(listEvents(db, { subjectType: "appeal" })).toStrictEqual([ruled]);
      expect(listEvents(db, { eventType: "appeal_ruled" })).toStrictEqual([ruled]);
      // The report the appeal contests carries no decision of its own here: the ruling's subject is
      // the appeal, and the report reaches the event only as payload context, so reading the report's
      // id asks a question the measurement never answered.
      expect(listEvents(db, { subjectId: "demo-report-north-alpha" })).toStrictEqual([]);
      // An appeal that was never opened has no trail, and that is an answer rather than a failure.
      expect(listEvents(db, { subjectId: "demo-appeal-east" })).toStrictEqual([]);
    });
  });

  describe("the stored payload", () => {
    it("comes back parsed as the value that was stored rather than as the text of it", () => {
      const appended = appendEvent(db, {
        ...moderationEvent("demo-listing-north-yard"),
        payload: probePayload,
      });

      const event = listEvents(db, { subjectId: "demo-listing-north-yard" })[0];
      if (event === undefined) {
        throw new Error("expected the submitted subject to have one decision");
      }
      const payload = event.payload;
      if (payload === undefined) {
        throw new Error("expected the decision to carry the payload it was appended with");
      }

      expect(typeof payload).toBe("object");
      expect(payload).not.toBeNull();
      expect(Array.isArray(payload)).toBe(false);
      expect(typeof payload).not.toBe("string");
      expect(payload).toStrictEqual(probePayload);
      // The canonical renderer is the oracle for the round trip: a nested object, an array, an
      // integer, a boolean and JSON's own null all render the same on the way back as on the way in.
      expect(canonicalize(payload)).toBe(canonicalize(probePayload));
      // And the text the read parsed is the canonical rendering of it, so the value that came back is
      // the value the row holds rather than a second rendering that happens to agree.
      expect(storedPayloadJson(appended.id)).toBe(canonicalize(probePayload));
    });
  });

  describe("repeatability", () => {
    it("returns deeply equal results for two identical reads and writes nothing", () => {
      const moderation = appendEvent(db, moderationEvent("demo-listing-north-yard"));
      appendEvent(db, retestEvent("demo-report-north-alpha"));
      const before = eventCount();
      const storedBefore = storedPayloadJson(moderation.id);

      const first = listEvents(db, {});
      const second = listEvents(db, {});

      expect(second).toStrictEqual(first);
      expect(second).toHaveLength(2);
      // Nothing about a read reaches the log: the row count and a stored payload text are what they
      // were before it, so a trail cannot be rewritten by being read, however many times.
      expect(eventCount()).toBe(before);
      expect(storedPayloadJson(moderation.id)).toBe(storedBefore);
    });
  });
});
