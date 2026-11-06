/**
 * The append-only audit log of every Shield decision.
 *
 * Shield records one event per decision, carrying exactly the five facts a decision fixed —
 * its timestamp, the id of the call it was made for, the decision itself, the id of the rule
 * that decided and the version label of the policy it was made under. Nothing else is kept:
 * no arguments, no tool output, no reason text and no data about a person, because the five
 * fields are the whole record.
 *
 * Two sinks implement the same one-method contract, {@link AuditSink}: {@link createInMemoryAuditLog}
 * for a caller that reads its own history back in process, and {@link createFileAuditSink} for a
 * caller that wants one newline-delimited JSON line per event on disk. Both read the event they are
 * given through one guard, so both hold the five facts and nothing else, and refuse the same values.
 * The log only ever appends: neither sink offers a way to change or remove a recorded event, a
 * stored event is frozen as it is recorded so a later assignment to one of its fields cannot edit
 * what the log holds, and the file sink opens in append mode and rewrites no line it has written.
 */

import { appendFileSync, mkdirSync } from "node:fs";

import type { Decision } from "./policy/policy-schema";

/**
 * One recorded Shield decision, carrying exactly the five facts the decision fixed and nothing else.
 *
 * Every field is always present, so a reader never has to tell a missing field from an empty one:
 * an absent call id and an unreadable policy are stated as `""`, and "no rule decided this call" is
 * stated as `null` rather than left out.
 */
export interface AuditEvent {
  /**
   * When the decision was made, as an ISO-8601 UTC string — `new Date().toISOString()` or any
   * equivalent the caller supplies. Shield reads no clock of its own, so a caller that passes a
   * fixed timestamp keeps its decisions and their audit trail reproducible.
   */
  timestamp: string;
  /** The id of the call the decision was made for, or `""` when the call could not be read. */
  callId: string;
  /** The outcome the engine reached for that call. */
  decision: Decision;
  /** The id of the rule that decided the call, or `null` when no rule matched it. */
  ruleId: string | null;
  /** The version label of the policy the decision was made under, or `""` when it could not be read. */
  policyVersion: string;
}

/**
 * Where the audit event of every decision is appended.
 *
 * The contract is one method, and deliberately no `close`, no `flush`, no `update` and no `clear`:
 * a sink only ever appends, so no caller can edit or lose an event by forgetting a step.
 */
export interface AuditSink {
  /**
   * Appends one event to this sink.
   *
   * The sink throws rather than accepting what it cannot record: a value that is not a complete
   * record of the five facts is refused, and the file sink also throws when the write itself fails,
   * so that an event lost this way surfaces as a visible failure to a caller appending here rather
   * than as a silently short history. The in-memory sink cannot fail once its event has been read.
   *
   * A caller that appends through `evaluate` does not see that throw: `evaluate` guards its own
   * append so that the engine's promise never to throw survives a sink that fails, and a failed
   * append therefore loses only the record of a decision that has already been reached. The cost of
   * that promise to an adopter is stated in `docs/shield/EXCLUSIONS.md` item 4, and a caller that
   * requires the trail has to monitor the sink it supplied.
   */
  append(event: AuditEvent): void;
}

/**
 * An {@link AuditSink} that keeps its events in memory for the caller to read back.
 */
export interface InMemoryAuditLog extends AuditSink {
  /**
   * Returns the stored events in insertion order, as a new array. The returned array is the
   * caller's own, and no stored event is removed or rewritten by reading it.
   */
  list(): AuditEvent[];
  /** Returns how many events have been recorded. */
  size(): number;
}

/**
 * True for a candidate an event can be read out of: a non-null, non-array object whose own
 * enumerable string keys carry the whole of it — the same container rule the policy validator and
 * the engine apply.
 *
 * A `Map`, a `Set` or a `Date` is refused alongside an array because its members live outside its
 * string keys: read as a record such a candidate looks empty, and an empty record is exactly what
 * must not reach an append-only history.
 *
 * A candidate whose own accessors raise — a revoked `Proxy` raises inside `Array.isArray` and in
 * reading `Symbol.toStringTag` — answers `false` here rather than raising: it is not a record this
 * module can read, which is the same refusal as not being one at all, stated in this module's own
 * words rather than the engine's.
 */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  try {
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      Object.prototype.toString.call(candidate) === "[object Object]"
    );
  } catch {
    return false;
  }
}

/**
 * True for one of the three outcomes a recorded decision may carry: `allow`, `deny` and
 * `needs_approval`.
 *
 * This restates the closed vocabulary {@link Decision} declares rather than trusting the declared
 * parameter type, because a sink is a boundary an untyped caller can cross: a JavaScript caller can
 * hand `append` any string at all, and only the three the vocabulary names are outcomes the engine
 * records.
 */
function isRecordedDecision(candidate: unknown): candidate is Decision {
  return candidate === "allow" || candidate === "deny" || candidate === "needs_approval";
}

/**
 * Reads one member of a candidate event without letting the candidate's own accessor raise.
 *
 * A member that cannot be read — a getter that throws — answers `undefined`, so the checks in
 * {@link readEvent} refuse it with this module's own message rather than letting the accessor's
 * error escape to an untyped caller. Nothing distinguishes an unreadable member from an absent one
 * here, because both are the same refusal: the candidate is not a record of the five facts.
 */
function readMember(candidate: Record<string, unknown>, member: string): unknown {
  try {
    return candidate[member];
  } catch {
    return undefined;
  }
}

/**
 * Reads the five facts of an audit event out of a candidate, refusing anything that is not a
 * complete record of them.
 *
 * Both sinks read their event through here, so the one-method contract has one definition of what a
 * record is: an object carrying `timestamp`, `callId` and `policyVersion` as strings, a `decision`
 * from the closed vocabulary and a `ruleId` that is a string or `null`. Everything else is refused
 * with a `TypeError` naming the field — a candidate that is not an object, one missing a fact, a
 * fact of another kind, a candidate whose own accessors raise and a member whose own accessor raises
 * included.
 *
 * Each refusal names the field it concerns and never the value it carried: a value may be a
 * credential-shaped string, or an object whose `toString` throws, and neither belongs in a message.
 *
 * The returned record is built from the checked members rather than handed on as the caller's own
 * object, so a sixth member a caller added beside the five never reaches the history: the five
 * facts are the whole record, in either sink.
 */
function readEvent(candidate: unknown): AuditEvent {
  if (!isRecord(candidate)) {
    throw new TypeError("audit event: expected an object");
  }

  const timestamp: unknown = readMember(candidate, "timestamp");
  const callId: unknown = readMember(candidate, "callId");
  const decision: unknown = readMember(candidate, "decision");
  const ruleId: unknown = readMember(candidate, "ruleId");
  const policyVersion: unknown = readMember(candidate, "policyVersion");

  if (typeof timestamp !== "string") {
    throw new TypeError("audit event: timestamp is not a string");
  }

  if (typeof callId !== "string") {
    throw new TypeError("audit event: callId is not a string");
  }

  if (!isRecordedDecision(decision)) {
    throw new TypeError("audit event: decision is not a recorded outcome");
  }

  if (typeof ruleId !== "string" && ruleId !== null) {
    throw new TypeError("audit event: ruleId is neither a string nor null");
  }

  if (typeof policyVersion !== "string") {
    throw new TypeError("audit event: policyVersion is not a string");
  }

  return { timestamp, callId, decision, ruleId, policyVersion };
}

/**
 * Creates an independent, in-memory audit log with an empty history.
 *
 * @returns A log whose state is private to it; two logs share nothing.
 */
export function createInMemoryAuditLog(): InMemoryAuditLog {
  const events: AuditEvent[] = [];

  function append(event: AuditEvent): void {
    // The event is read through the guard the file sink reads its own through, so both sinks refuse
    // the same shapes. The log then stores a frozen copy of the five fields rather than the caller's
    // own object, so a caller that keeps its reference and later assigns to it cannot change what
    // the log recorded.
    events.push(Object.freeze<AuditEvent>(readEvent(event)));
  }

  function list(): AuditEvent[] {
    return [...events];
  }

  function size(): number {
    return events.length;
  }

  return { append, list, size };
}

/**
 * Creates a sink that appends one newline-delimited JSON line per event to `filePath`.
 *
 * Appending an event writes the five facts of the record — its timestamp, call id, decision, rule id
 * and policy version — as one JSON line, opening the file in append mode, so each event is one line
 * a reader can split on newlines and parse back. Nothing is buffered and there is nothing to flush:
 * the line reaches the file during the call, so no event is held in memory waiting for a `close`
 * that never comes.
 *
 * The parent directory is created on the first append when the path has a non-empty directory part,
 * so a path naming a directory that does not exist yet is written rather than refused; a path whose
 * directory part is empty names a file in the current directory, and nothing is created for it. An
 * append that is refused leaves the path untouched, so a sink that is handed a value which is not a
 * record of the five facts creates neither its file nor its directory.
 *
 * @param filePath The file to append the log lines to. It is written where it is given: beyond
 *   requiring a non-empty string, this sink checks nothing about the path and can be no more durable
 *   than the filesystem it writes to.
 * @returns A sink whose events survive the sink itself, one line each, in the order they were
 *   appended.
 * @throws A `TypeError` when `filePath` is not a non-empty string, or when an appended value is not
 *   a record of the five facts; and whatever `node:fs` raises — a write to an unwritable path, a
 *   path that names a directory, a full disk — rather than a swallowed failure. No line already
 *   written is rewritten or removed when an append throws.
 */
export function createFileAuditSink(filePath: string): AuditSink {
  // The declared parameter type is not a guarantee at run time for an untyped caller, so a path that
  // is not a non-empty string is refused here, before any String method reaches it: read straight
  // through, such a value raises the engine's own TypeError, whose message names an internal
  // expression and whose stack belongs to this module rather than to the caller.
  if (typeof filePath !== "string" || filePath === "") {
    throw new TypeError("audit: filePath must be a non-empty string");
  }

  // This package imports nothing beyond `node:fs`, so the directory part is taken from the path
  // itself: the last "/" separates it, and an empty part means the file sits in the current
  // directory. The directory is made at most once per sink, and only after it exists, so a failed
  // creation is retried by the next append rather than remembered as done.
  const lastSeparator = filePath.lastIndexOf("/");
  const directory = lastSeparator > 0 ? filePath.slice(0, lastSeparator) : "";
  let directoryCreated = false;

  function append(event: AuditEvent): void {
    // The event is checked before anything is written, so a value that is not a record of the five
    // facts leaves no line, no file and no directory behind it.
    const record = readEvent(event);

    if (directory !== "" && !directoryCreated) {
      mkdirSync(directory, { recursive: true });
      directoryCreated = true;
    }

    appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
  }

  return { append };
}
