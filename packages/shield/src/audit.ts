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
 * caller that wants one newline-delimited JSON line per event on disk. The log only ever appends:
 * neither sink offers a way to change or remove a recorded event, a stored event is frozen as it is
 * recorded so a later assignment to one of its fields cannot edit what the log holds, and the file
 * sink opens in append mode and rewrites no line it has written.
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
   * An in-memory sink cannot fail; a file sink may throw when the write fails, so that a lost
   * event surfaces as a visible failure rather than as a silently empty history.
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
 * Creates an independent, in-memory audit log with an empty history.
 *
 * @returns A log whose state is private to it; two logs share nothing.
 */
export function createInMemoryAuditLog(): InMemoryAuditLog {
  const events: AuditEvent[] = [];

  function append(event: AuditEvent): void {
    // The log stores a frozen copy of the five fields rather than the caller's own object, so a
    // caller that keeps its reference and later assigns to it cannot change what the log recorded.
    events.push(
      Object.freeze<AuditEvent>({
        timestamp: event.timestamp,
        callId: event.callId,
        decision: event.decision,
        ruleId: event.ruleId,
        policyVersion: event.policyVersion,
      }),
    );
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
 * Appending an event writes `JSON.stringify(event)` followed by a newline, opening the file in
 * append mode, so each event is one line a reader can split on newlines and parse back. Nothing is
 * buffered and there is nothing to flush: the line reaches the file during the call, so no event is
 * held in memory waiting for a `close` that never comes.
 *
 * The parent directory is created on the first append when the path has a non-empty directory part,
 * so a path naming a directory that does not exist yet is written rather than refused; a path whose
 * directory part is empty names a file in the current directory, and nothing is created for it.
 *
 * @param filePath The file to append the log lines to. It is written where it is given: this sink
 *   checks nothing about the path and can be no more durable than the filesystem it writes to.
 * @returns A sink whose events survive the sink itself, one line each, in the order they were
 *   appended.
 * @throws Whatever `node:fs` raises — a write to an unwritable path, a path that names a
 *   directory, a full disk — rather than a swallowed failure. No line already written is rewritten
 *   or removed when an append throws.
 */
export function createFileAuditSink(filePath: string): AuditSink {
  // This package imports nothing beyond `node:fs`, so the directory part is taken from the path
  // itself: the last "/" separates it, and an empty part means the file sits in the current
  // directory. The directory is made at most once per sink, and only after it exists, so a failed
  // creation is retried by the next append rather than remembered as done.
  const lastSeparator = filePath.lastIndexOf("/");
  const directory = lastSeparator > 0 ? filePath.slice(0, lastSeparator) : "";
  let directoryCreated = false;

  function append(event: AuditEvent): void {
    if (directory !== "" && !directoryCreated) {
      mkdirSync(directory, { recursive: true });
      directoryCreated = true;
    }

    appendFileSync(filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  }

  return { append };
}
