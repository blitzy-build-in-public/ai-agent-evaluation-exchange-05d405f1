import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createFileAuditSink, createInMemoryAuditLog } from "./audit";
import type { AuditEvent, InMemoryAuditLog } from "./audit";

/**
 * The audit log's contract, and the append-only promise it makes.
 *
 * `evaluate` records one event per decision, and this suite fixes what those sinks owe a reader:
 * the five fields are the whole record and survive a round trip through either sink; a value that is
 * not a complete record of them is refused by both sinks with this module's own message, leaving
 * neither a line nor a stored event behind; the events come back in insertion order; the log only
 * ever appends, holding no way to change or remove an event and storing each one frozen; reading it
 * hands out a fresh array, so a caller that mutates what it was given cannot change the history; the
 * in-memory history is private to its log; and the file sink writes one newline-delimited JSON line
 * per event in append mode, rewriting no line it has written.
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
 *
 * The `.tmp-shield-audit-*` name it is given is covered by the root `.gitignore`'s "Test output"
 * block, so a run that is interrupted before its cleanup leaves nothing for a later `git add -A` to
 * pick up. That rule and this name are one contract, and either one alone leaves the working tree
 * dirty.
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

/**
 * Hands a value of any shape to one of these sinks, as an untyped JavaScript caller can.
 *
 * `string` and {@link AuditEvent} are compile-time promises only, and the values below are the ones
 * a JavaScript caller reaches the sinks with; every such call in this suite goes through here, so
 * the cast is written once rather than at each call.
 */
function asUntyped<T>(value: unknown): T {
  return value as T;
}

/**
 * Values neither sink may record, in the ways a candidate fails to be a record of the five facts:
 * not a record at all, nothing of the five, one fact of the five absent, a fact of another kind, an
 * outcome outside the closed vocabulary, and a fact that cannot be read.
 *
 * Every row also states the refusal it expects, which names the field at issue and carries neither
 * the row's value nor anything internal to this module. Both sinks are driven with the whole table,
 * because the one-method contract has one definition of what a record is.
 */
const NOT_RECORDS: [string, unknown, string][] = [
  ["a value that is not an object", "an audit event", "audit event: expected an object"],
  ["a revoked proxy", revokedProxy(), "audit event: expected an object"],
  ["an event with no facts at all", {}, "audit event: timestamp is not a string"],
  [
    "an event missing its policy version",
    { timestamp: FIRST_AT, callId: "call-1", decision: "allow", ruleId: "read-only-tools" },
    "audit event: policyVersion is not a string",
  ],
  [
    "an event whose rule id is a number",
    { ...ALLOWED_CALL, ruleId: 7 },
    "audit event: ruleId is neither a string nor null",
  ],
  [
    "an event whose decision is outside the vocabulary",
    { ...ALLOWED_CALL, decision: "permit" },
    "audit event: decision is not a recorded outcome",
  ],
  [
    "an event whose timestamp cannot be read",
    eventWithThrowingMember("timestamp"),
    "audit event: timestamp is not a string",
  ],
];

/** An event the five facts are declared on, one of which raises when it is read. */
function eventWithThrowingMember(member: string): unknown {
  const event: Record<string, unknown> = { ...ALLOWED_CALL };
  Object.defineProperty(event, member, {
    enumerable: true,
    get(): never {
      throw new Error(`${member} cannot be read`);
    },
  });
  return event;
}

/** A proxy the caller has revoked, whose every read raises. */
function revokedProxy(): unknown {
  const { proxy, revoke } = Proxy.revocable({ ...ALLOWED_CALL }, {});
  revoke();
  return proxy;
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

    it.each(NOT_RECORDS)("refuses %s, and its history stays empty", (_label, value, message) => {
      const log = createInMemoryAuditLog();
      const refused = (): void => log.append(asUntyped<AuditEvent>(value));

      expect(refused).toThrowError(TypeError);
      expect(refused).toThrowError(new TypeError(message));

      expect(log.size()).toBe(0);
      expect(log.list()).toEqual([]);
    });

    it("records exactly the five facts of an event that carries a sixth member", () => {
      const log = createInMemoryAuditLog();

      log.append(asUntyped<AuditEvent>({ ...ALLOWED_CALL, approvedBy: "demo-operator-1" }));

      const recorded = firstRecorded(log);
      expect(recorded).toEqual(ALLOWED_CALL);
      expect(Object.keys(recorded).sort()).toEqual([
        "callId",
        "decision",
        "policyVersion",
        "ruleId",
        "timestamp",
      ]);
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

    it.each(NOT_RECORDS)(
      "refuses %s, creating neither the file nor its directory",
      (_label, value, message) => {
        const filePath = scratchFile("refused/audit.ndjson");
        const parent = `${scratchDirectory()}/refused`;
        const sink = createFileAuditSink(filePath);
        const refused = (): void => sink.append(asUntyped<AuditEvent>(value));

        expect(refused).toThrowError(TypeError);
        expect(refused).toThrowError(new TypeError(message));

        // The event is checked before the write path is entered, so nothing came into existence.
        expect(existsSync(filePath)).toBe(false);
        expect(existsSync(parent)).toBe(false);
      },
    );

    it("writes exactly the five facts of an event that carries a sixth member", () => {
      const filePath = scratchFile("sixth-member.ndjson");
      const sink = createFileAuditSink(filePath);

      sink.append(asUntyped<AuditEvent>({ ...ALLOWED_CALL, approvedBy: "demo-operator-1" }));

      const [written] = eventsWrittenTo(filePath);
      expect(written).toEqual(ALLOWED_CALL);
      expect(Object.keys(written as Record<string, unknown>).sort()).toEqual([
        "callId",
        "decision",
        "policyVersion",
        "ruleId",
        "timestamp",
      ]);
    });
  });

  describe("the path a sink writes to", () => {
    it.each<[string, unknown]>([
      ["null", null],
      ["a number", 7],
      ["an empty string", ""],
    ])("refuses %s as its path, naming the parameter and nothing internal", (_label, value) => {
      const refused = (): unknown => createFileAuditSink(asUntyped<string>(value));

      expect(refused).toThrowError(TypeError);
      expect(refused).toThrowError(new TypeError("audit: filePath must be a non-empty string"));

      // Nothing was created for the value it was handed, so the refusal precedes the write path.
      expect(existsSync(asUntyped<string>(value))).toBe(false);
    });

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
