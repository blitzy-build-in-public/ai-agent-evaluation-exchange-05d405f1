import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createFileAuditSink, createInMemoryAuditLog } from "./audit";
import type { AuditEvent, InMemoryAuditLog } from "./audit";

/**
 * The audit log's contract, and the append-only promise it makes.
 *
 * `evaluate` records one event per decision, and this suite fixes what those sinks owe a reader:
 * the five fields are the whole record and survive a round trip through either sink; the events come
 * back in insertion order; the log only ever appends, holding no way to change or remove an event and
 * storing each one frozen; reading it hands out a fresh array, so a caller that mutates what it was
 * given cannot change the history; the in-memory history is private to its log; and the file sink
 * writes one newline-delimited JSON line per event in append mode, rewriting no line it has written.
 *
 * Every event here is built from fixed timestamp literals, because Shield reads no clock and the
 * suite proves behaviour that repeats identically in every run.
 */

/** The timestamp of the first event in this suite. */
const FIRST_AT = "2024-01-01T00:00:00.000Z";
/** The timestamp of the second event in this suite. */
const SECOND_AT = "2024-01-01T00:00:01.000Z";
/** The timestamp of the third event in this suite. */
const THIRD_AT = "2024-01-01T00:00:02.000Z";

/** An allowed call, decided by a named rule under a readable policy. */
const ALLOWED_CALL: AuditEvent = {
  timestamp: FIRST_AT,
  callId: "call-read-1",
  decision: "allow",
  ruleId: "read-only-tools",
  policyVersion: "demo-policy-1",
};

/**
 * A refused call whose id could not be read and whose policy version could not be read either, with
 * no rule deciding it: the empty string and the `null` are the record of those absences.
 */
const UNREADABLE_CALL: AuditEvent = {
  timestamp: SECOND_AT,
  callId: "",
  decision: "deny",
  ruleId: null,
  policyVersion: "",
};

/** A call held for approval, decided by a named rule under a readable policy. */
const HELD_CALL: AuditEvent = {
  timestamp: THIRD_AT,
  callId: "call-write-3",
  decision: "needs_approval",
  ruleId: "ask-before-write",
  policyVersion: "demo-policy-1",
};

/**
 * The scratch directory this suite writes into, or `undefined` before it creates one. Kept at module
 * scope so the cleanup registered below removes it whatever a test did before failing.
 */
let scratch: string | undefined;

/**
 * Returns the suite's scratch directory, creating it inside the working tree on first use.
 *
 * The path is built from `process.cwd()` by string concatenation rather than through `node:os` or
 * `node:path`: this package's only non-relative import is `node:fs`, and this suite leaves that set
 * unchanged. `mkdtempSync` gives each run its own directory, so a second run of the suite cannot
 * read the first run's files.
 */
function scratchDirectory(): string {
  if (scratch === undefined) {
    scratch = mkdtempSync(process.cwd() + "/.tmp-shield-audit-");
  }
  return scratch;
}

/** Returns the path of `name` inside the scratch directory, creating the directory if needed. */
function scratchFile(name: string): string {
  return `${scratchDirectory()}/${name}`;
}

/**
 * Removes the scratch directory when this suite created one, and forgets it, so a later call creates
 * a fresh directory rather than writing into a removed path. Safe to call when nothing was created.
 */
function removeScratch(): void {
  if (scratch !== undefined) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
}

afterEach(() => {
  removeScratch();
});

/** Returns the first event a log recorded, failing readably rather than reading `undefined`. */
function firstRecorded(log: InMemoryAuditLog): AuditEvent {
  const [first] = log.list();
  if (first === undefined) {
    throw new Error("expected the log to hold at least one event");
  }
  return first;
}

/** Reads a sink's file back the way its reader would: one JSON value per non-empty line, in order. */
function eventsWrittenTo(filePath: string): unknown[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);
}

describe("the in-memory audit log", () => {
  describe("before any decision is recorded", () => {
    it("holds nothing at all", () => {
      const log = createInMemoryAuditLog();

      expect(log.size()).toBe(0);
      expect(log.list()).toEqual([]);
    });
  });

  describe("recording a decision", () => {
    it("returns the recorded event with all five fields intact and no sixth", () => {
      const log = createInMemoryAuditLog();

      log.append(ALLOWED_CALL);

      expect(log.size()).toBe(1);
      expect(log.list()).toHaveLength(1);

      const recorded = firstRecorded(log);
      expect(recorded.timestamp).toBe(FIRST_AT);
      expect(recorded.callId).toBe("call-read-1");
      expect(recorded.decision).toBe("allow");
      expect(recorded.ruleId).toBe("read-only-tools");
      expect(recorded.policyVersion).toBe("demo-policy-1");

      expect(Object.keys(recorded).sort()).toEqual([
        "callId",
        "decision",
        "policyVersion",
        "ruleId",
        "timestamp",
      ]);
    });

    it("keeps the events in insertion order, including a null rule id and an empty call id", () => {
      const log = createInMemoryAuditLog();

      log.append(ALLOWED_CALL);
      log.append(UNREADABLE_CALL);
      log.append(HELD_CALL);

      const storedEvents = log.list();
      expect(log.size()).toBe(3);
      expect(storedEvents.map((event) => event.callId)).toEqual(["call-read-1", "", "call-write-3"]);
      expect(storedEvents).toEqual([ALLOWED_CALL, UNREADABLE_CALL, HELD_CALL]);

      // The two absences are stored as the values that state them, not dropped and not defaulted.
      const middle = storedEvents[1];
      expect(middle?.ruleId).toBeNull();
      expect(middle?.callId).toBe("");
    });

    it("hands out a new array each time, so mutating it cannot change what the log holds", () => {
      const log = createInMemoryAuditLog();
      log.append(ALLOWED_CALL);

      const handedOut = log.list();
      handedOut.push(HELD_CALL);

      expect(log.size()).toBe(1);
      expect(log.list()).toEqual([ALLOWED_CALL]);
      expect(log.list()).not.toBe(handedOut);
    });

    it("stores each event frozen, so the recorded copy cannot be edited after the fact", () => {
      const log = createInMemoryAuditLog();
      log.append(ALLOWED_CALL);

      expect(Object.isFrozen(firstRecorded(log))).toBe(true);
    });

    it("offers no way to change or remove a recorded event", () => {
      const log = createInMemoryAuditLog();
      log.append(ALLOWED_CALL);

      expect("deleteEvent" in log).toBe(false);
      expect("updateEvent" in log).toBe(false);
    });

    it("keeps the history of one log private to it", () => {
      const first = createInMemoryAuditLog();
      const second = createInMemoryAuditLog();

      first.append(ALLOWED_CALL);
      second.append(HELD_CALL);

      expect(first.size()).toBe(1);
      expect(second.size()).toBe(1);
      expect(first.list()).toEqual([ALLOWED_CALL]);
      expect(second.list()).toEqual([HELD_CALL]);
    });
  });
});

describe("the file audit sink", () => {
  describe("writing events", () => {
    it("writes one newline-delimited line per event and ends the file with a newline", () => {
      const filePath = scratchFile("audit.ndjson");
      const sink = createFileAuditSink(filePath);

      sink.append(ALLOWED_CALL);
      sink.append(UNREADABLE_CALL);
      sink.append(HELD_CALL);

      const contents = readFileSync(filePath, "utf8");
      const lines = contents.split("\n");

      // Three events plus the empty element that the trailing newline leaves behind.
      expect(lines).toHaveLength(4);
      expect(lines[3]).toBe("");
      expect(contents.endsWith("\n")).toBe(true);
    });

    it("writes each line so its reader reads the event that was appended back", () => {
      const filePath = scratchFile("audit.ndjson");
      const sink = createFileAuditSink(filePath);

      sink.append(ALLOWED_CALL);
      sink.append(UNREADABLE_CALL);
      sink.append(HELD_CALL);

      const written = eventsWrittenTo(filePath);
      expect(written).toHaveLength(3);
      expect(written).toEqual([ALLOWED_CALL, UNREADABLE_CALL, HELD_CALL]);
    });

    it("keeps the lines already written byte-identical when a further event is appended", () => {
      const filePath = scratchFile("audit.ndjson");
      const sink = createFileAuditSink(filePath);

      sink.append(ALLOWED_CALL);
      sink.append(UNREADABLE_CALL);

      const before = readFileSync(filePath, "utf8");
      sink.append(HELD_CALL);
      const after = readFileSync(filePath, "utf8");

      const beforeLines = before.split("\n");
      const afterLines = after.split("\n");

      // The earlier bytes are untouched: the file still begins with exactly what it held.
      expect(after.startsWith(before)).toBe(true);
      expect(afterLines.slice(0, 2)).toEqual(beforeLines.slice(0, 2));

      // And it grew by the new line alone — nothing was rewritten, reordered or padded.
      const appendedLine = afterLines[2] ?? "";
      expect(appendedLine).toBe(after.slice(before.length, after.length - 1));
      expect(after.length - before.length).toBe(appendedLine.length + 1);
    });
  });

  describe("the path a sink writes to", () => {
    it("creates the parent directory of a path whose directory does not exist yet", () => {
      const filePath = scratchFile("nested/deeper/audit.ndjson");
      const parent = `${scratchDirectory()}/nested/deeper`;

      expect(existsSync(parent)).toBe(false);

      const sink = createFileAuditSink(filePath);
      sink.append(ALLOWED_CALL);

      expect(existsSync(parent)).toBe(true);
      expect(eventsWrittenTo(filePath)).toEqual([ALLOWED_CALL]);
    });

    it("keeps two sinks writing to two paths independent", () => {
      const firstPath = scratchFile("first.ndjson");
      const secondPath = scratchFile("second.ndjson");
      const first = createFileAuditSink(firstPath);
      const second = createFileAuditSink(secondPath);

      first.append(ALLOWED_CALL);

      // Creating and holding the second sink writes nothing: only its own appends touch its path.
      expect(eventsWrittenTo(firstPath)).toEqual([ALLOWED_CALL]);
      expect(existsSync(secondPath)).toBe(false);

      second.append(UNREADABLE_CALL);

      expect(eventsWrittenTo(firstPath)).toEqual([ALLOWED_CALL]);
      expect(eventsWrittenTo(secondPath)).toEqual([UNREADABLE_CALL]);

      first.append(HELD_CALL);

      // Each sink appends to its own file only: the events are neither shared nor interleaved.
      expect(eventsWrittenTo(firstPath)).toEqual([ALLOWED_CALL, HELD_CALL]);
      expect(eventsWrittenTo(secondPath)).toEqual([UNREADABLE_CALL]);
    });
  });
});

describe("the scratch directory", () => {
  it("is removed on cleanup, so a run leaves the working tree as it found it", () => {
    const filePath = scratchFile("audit.ndjson");
    const directory = scratchDirectory();

    createFileAuditSink(filePath).append(ALLOWED_CALL);
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(directory)).toBe(true);

    removeScratch();

    expect(existsSync(directory)).toBe(false);
    // Removing what is already gone is tolerated, so the cleanup is safe on any path through a test.
    removeScratch();
    expect(existsSync(directory)).toBe(false);
  });
});
