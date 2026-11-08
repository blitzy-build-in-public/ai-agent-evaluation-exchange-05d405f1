/**
 * The Shield policy decision: one call, one policy, one recorded outcome.
 *
 * {@link evaluate} answers one question — what does this policy say about this tool call — and
 * answers it the same way every time. The answer is always the same three-field record,
 * {@link DecisionRecord}: the decision, the reason for it, and the id of the rule that decided or
 * `null` when none did.
 *
 * Two promises hold for every input, a malformed one included. The engine denies by default: a
 * call no rule matches is refused, and no value the engine could not read is ever turned into an
 * allow. And the engine never throws: a call or a policy it cannot read comes back as a refusal
 * rather than an exception, so a caller that inspects the decision it received has seen everything
 * this function can do.
 *
 * Shield decides about the call it is given and enforces nothing itself: an `allow` is a statement
 * about that call under that policy, not a guarantee about the system that runs it.
 */

import type { AuditEvent, AuditSink } from "./audit";
import type { ApprovalStore } from "./approvals";
import type { RuleMatchTarget } from "./policy/match-rule";
import { matchRule } from "./policy/match-rule";
import { readPolicyVersion, validatePolicy } from "./policy/policy-schema";

/**
 * A tool call the engine can decide: the call's identifier, the tool being called and the
 * arguments that call carries.
 *
 * It extends {@link RuleMatchTarget} — the shape a rule is matched against — by the identifier
 * alone, so the two members compared against a rule appear exactly once, in the matching module,
 * and this file adds only the member the decision and its audit trail need.
 */
export interface ToolCall extends RuleMatchTarget {
  /**
   * The call's own identifier, unique per call. It is what an approval is recorded against, so a
   * caller that reuses an id for a different call lets one approval cover both.
   */
  id: string;
}

/**
 * The record every Shield decision comes back as.
 *
 * These three members are the whole record, fixed by the product's interface contract: what the
 * engine decided, why, and which rule decided. `ruleId` is `null` rather than an absent member
 * when no rule decided, so a reader never has to tell a missing field from an empty one.
 */
export interface DecisionRecord {
  /** What the engine decided about the call. */
  decision: "allow" | "deny" | "needs_approval";
  /** Why: a matched rule's own reason text, or one of the engine's own reasons. */
  reason: string;
  /** The id of the rule that decided the call, or `null` when the engine decided without one. */
  ruleId: string | null;
}

/**
 * What a caller may supply alongside the call and the policy. Every member is optional: a call
 * decided without a context is decided exactly the same way, and only the audit trail differs.
 */
export interface EvaluateContext {
  /**
   * Supplies the timestamp recorded with the decision. It defaults to the clock
   * (`new Date().toISOString()`), which never influences a decision; a caller that supplies a
   * fixed value keeps its decisions and their audit trail reproducible.
   */
  now?: () => string;
  /** Where the audit event of this decision is appended. Omitted, nothing is recorded. */
  audit?: AuditSink;
  /** The approval checkpoint consulted for a call a matched rule blocks with `needs_approval`. */
  approvals?: ApprovalStore;
}

/**
 * The reason strings this module authors itself, and the closed set of them.
 *
 * `"no_matching_rule"` is the default-deny refusal of a call no rule matches, `"malformed"` is the
 * refusal of a call or a policy the engine could not read, and `"approved"` is a blocked call
 * released by a recorded approval. Every other reason text in a decision record comes from the
 * matching rule, so a reader can tell the engine's own reasons from a policy author's.
 */
const REASON_MALFORMED = "malformed";
const REASON_NO_MATCHING_RULE = "no_matching_rule";
const REASON_APPROVED = "approved";

/**
 * True for a non-null, non-array object whose own enumerable string keys carry the whole of it —
 * the only container shape a call or a call's arguments may take.
 *
 * An array is refused because it would satisfy every object check while behaving unlike one, and a
 * container whose members live outside its string keys — a `Map`, a `Set`, a `Date` — is refused
 * because a string-key read of it finds nothing: taken at face value, that empty answer would look
 * like an argument record the call never carried.
 */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    Object.prototype.toString.call(candidate) === "[object Object]"
  );
}

/** What reading a candidate call yields: the call to decide, or nothing, and the id it carried. */
interface ReadCallResult {
  /** The call the engine can decide, or `null` when the candidate is not one. */
  readonly call: ToolCall | null;
  /** The candidate's own id when it was a non-empty string, and `""` otherwise. */
  readonly id: string;
}

/**
 * Reads a candidate as the call the engine can decide, along with the call id that candidate
 * carried.
 *
 * The accepted shape is exactly {@link ToolCall}: a non-null, non-array object whose own
 * enumerable string keys carry the whole of it, holding a non-empty string `id`, a non-empty
 * string `tool` and an `arguments` record. Everything else is refused — `null`, a primitive, a
 * function and an array, a container whose members live outside its string keys, a missing or empty
 * `id` or `tool`, and arguments that are absent, `null` or an array.
 *
 * The id is read on its own account, before the rest of the candidate is judged, so a refused call
 * that names itself is still named in the audit trail rather than lost with the refusal. The
 * accepted members are copied into the returned call rather than handed on as they were read, so
 * the matching module receives exactly the three members the engine decides on. A candidate whose
 * members cannot be read at all is refused rather than raised on.
 */
function readCall(candidate: unknown): ReadCallResult {
  try {
    if (typeof candidate !== "object" || candidate === null) {
      return { call: null, id: "" };
    }

    const rawId: unknown = (candidate as { id?: unknown }).id;
    const id: string = typeof rawId === "string" && rawId !== "" ? rawId : "";

    if (!isRecord(candidate)) {
      return { call: null, id };
    }

    const tool: unknown = candidate.tool;
    const rawArguments: unknown = candidate.arguments;

    if (id === "" || typeof tool !== "string" || tool === "" || !isRecord(rawArguments)) {
      return { call: null, id };
    }

    return { call: { id, tool, arguments: rawArguments }, id };
  } catch {
    // A candidate whose members cannot be read — a revoked proxy, a member whose accessor throws —
    // is refused rather than raised on. The refusal is the one already in hand here, and nothing
    // permissive is substituted for it, so a call the engine cannot read can never become an allow.
    return { call: null, id: "" };
  }
}

/**
 * Answers whether the caller's approval store holds an approval for this call id.
 *
 * Only an explicit `true` from a usable store counts. An absent store, a store carrying no callable
 * `hasApproval`, a store that cannot answer and an answer that is not `true` all answer `false`,
 * which leaves the call blocked. The absence of an answer is not an approval: this can only ever
 * release a call that a rule blocked, never widen a refusal.
 *
 * The context and the store it carries are the caller's own objects, so the member read and the call
 * are both made inside one guard: a context whose `approvals` member cannot be read — a revoked
 * proxy, an accessor that throws — and a store whose `hasApproval` raises are answered as "no
 * approval" rather than raised on. A blocked call that stays blocked is the only outcome this
 * consult may produce, and it is the one it produces when it cannot get an answer.
 */
function hasRecordedApproval(context: unknown, callId: string): boolean {
  try {
    const approvals: unknown = (context as { approvals?: unknown } | null | undefined)?.approvals;

    if (typeof approvals !== "object" || approvals === null) {
      return false;
    }

    const hasApproval: unknown = (approvals as { hasApproval?: unknown }).hasApproval;
    if (typeof hasApproval !== "function") {
      return false;
    }

    return (hasApproval as (id: string) => unknown).call(approvals, callId) === true;
  } catch {
    // The promise that evaluate never throws outranks the store's answer, so the member read and the
    // call are made inside this one guard. Nothing permissive is substituted: `false` is the answer a
    // store that answers no gives, and only an explicit `true` could ever release a blocked call.
    return false;
  }
}

/**
 * Reads the timestamp recorded with a decision: the caller's own supplier when it is a function
 * answering with a string, and the clock (`new Date().toISOString()`) otherwise.
 *
 * This is the only place this package reads a clock, and what it returns never influences a
 * decision. A supplier that is not a function, or that answers with something other than a string,
 * falls back to the clock rather than raising, so the recorded timestamp is always the ISO-8601
 * string the audit record declares. The optional supplier exists for one reason: a caller that
 * passes a fixed value keeps its decisions and their audit trail reproducible.
 */
function readTimestamp(now: unknown): string {
  if (typeof now === "function") {
    const supplied: unknown = (now as () => unknown)();

    if (typeof supplied === "string") {
      return supplied;
    }
  }

  return new Date().toISOString();
}

/**
 * Appends the one audit event of a decision that has already been reached.
 *
 * Nothing is recorded without a sink: a caller that supplied no audit sink asked for no history.
 * The event carries the five facts of {@link AuditEvent} and nothing else — the timestamp, the call
 * id (the non-empty string the call named itself with, `""` otherwise, so a refused call that
 * carried an id is still findable in the trail by it), the recorded decision with the engine's own
 * refusals included, the rule id from the record, and the policy's version label from the caller's
 * document (`""` when it could not be read, so a policy that failed validation is still named in
 * the audit trail by the version it carried).
 */
function appendDecisionAuditEvent(
  context: EvaluateContext | undefined,
  callId: string,
  policyVersion: string,
  record: DecisionRecord,
): void {
  try {
    const sink: AuditSink | undefined = context?.audit;

    if (sink === undefined) {
      return;
    }

    const event: AuditEvent = {
      timestamp: readTimestamp(context?.now),
      callId,
      decision: record.decision,
      ruleId: record.ruleId,
      policyVersion,
    };

    sink.append(event);
  } catch {
    // The promise that evaluate never throws outranks the caller's audit trail, so the event is
    // built and appended inside this one guard. Nothing is returned from here and no permissive
    // default is substituted: a sink or a timestamp supplier that fails loses only its own record
    // of a decision that has already been reached, and can never change that decision.
  }
}

/**
 * Decide one tool call under one policy.
 *
 * Returns the decision record for the call: `allow` when a matched rule allows it, `deny` when a
 * matched rule refuses it or when the engine refuses the input outright, and `needs_approval` when
 * a matched rule blocks it pending an approval. The reason is the matched rule's own text, except
 * for the three reasons this module authors — `"no_matching_rule"`, `"malformed"` and `"approved"`.
 * The rule id is the id of the rule that decided, or `null` when the engine decided without one.
 *
 * What it refuses, as a record rather than as an exception: a call that is not a non-null,
 * non-array object carrying a non-empty string `id`, a non-empty string `tool` and an `arguments`
 * record, and a policy that fails {@link validatePolicy} — both as `deny` with reason `"malformed"`.
 * The validator's own message is deliberately not surfaced, because the record has exactly three
 * fields; a caller that needs the detail calls `validatePolicy` itself. A call no rule matches is
 * `deny` with reason `"no_matching_rule"`, which is the default deny.
 *
 * A `needs_approval` rule blocks the call until the context's approval store holds an approval for
 * that exact call id: it is then released as `allow` with reason `"approved"` and that same rule
 * id, and it stays `needs_approval` while the store is absent, answers no or cannot answer, because
 * the absence of an approval store is not an approval. A conventional policy engine answers allow
 * or deny; this third outcome and the approval checkpoint behind it are this package's own
 * documented addition, not a standard result, and nothing here should be read as one.
 *
 * Every decision, the refusals included, appends exactly one event to the context's audit sink when
 * one is supplied, after the decision has been reached. `evaluate` never throws: a sink that fails
 * loses only its own record of a decision already reached and never changes the decision returned.
 * The recorded timestamp comes from `context.now` when that is a function and from the clock
 * otherwise — the narrowest way to keep a caller's audit trail reproducible, and never an influence
 * on a decision. Neither `call`, `policy` nor `context` is modified, and the same call under the
 * same policy always yields the same record.
 *
 * Shield decides about the call it is handed and enforces nothing by itself: an `allow` is a
 * statement about that call under that policy, not a guarantee about the system that runs it.
 *
 * @param call The call to decide: a {@link ToolCall}, or any other value, which is refused.
 * @param policy The policy to decide it under: a `Policy`, or any other value, which is refused.
 * @param context Optional clock, audit sink and approval checkpoint. Omitting it changes no
 *   decision.
 * @returns The decision record — the decision, its reason, and the deciding rule's id or `null`.
 */
export function evaluate(
  call: unknown,
  policy: unknown,
  context?: EvaluateContext,
): DecisionRecord {
  // The call is read once, into the shape the engine decides on or into nothing, together with the
  // id it named itself by. Everything below works from that reading, so a value read as decided
  // cannot differ from the value matched.
  const readable = readCall(call);
  const callId: string = readable.id;
  const matchingCall: ToolCall | null = readable.call;

  let record: DecisionRecord;

  if (matchingCall === null) {
    // A call the engine cannot read is refused, never guessed at: matching it, auditing it and
    // releasing it from an approval all need an id, a tool and an argument record that were
    // readable, and inventing any of the three would decide a call nobody described. No branch of
    // this function returns allow from a value it could not read.
    record = { decision: "deny", reason: REASON_MALFORMED, ruleId: null };
  } else {
    const validated = validatePolicy(policy);

    if (!validated.ok) {
      // A policy that fails validation is refused, and the validator's message is deliberately not
      // carried into the record, which has exactly three fields. Refusing here is what keeps an
      // unvalidated rule set from deciding anything at all.
      record = { decision: "deny", reason: REASON_MALFORMED, ruleId: null };
    } else {
      const matched = matchRule(validated.policy, matchingCall);

      if (matched === null) {
        // Default deny: nothing in the policy applies to this call, so the engine refuses it. The
        // rule id is null because no rule decided, and the reason says so.
        record = { decision: "deny", reason: REASON_NO_MATCHING_RULE, ruleId: null };
      } else if (matched.decision === "needs_approval") {
        // A blocked call is released only by an approval recorded for this exact call id; without
        // one, and without an approval store at all, it stays blocked. The rule id is the blocking
        // rule in both branches, because that rule produced the outcome, and releasing a call is
        // the only way the engine's reason "approved" ever appears.
        record = hasRecordedApproval(context, matchingCall.id)
          ? { decision: "allow", reason: REASON_APPROVED, ruleId: matched.id }
          : { decision: "needs_approval", reason: matched.reason, ruleId: matched.id };
      } else {
        // A matched rule that neither blocks the call nor is refused decides it, and it decides
        // with its own decision and its own reason text.
        record = { decision: matched.decision, reason: matched.reason, ruleId: matched.id };
      }
    }
  }

  appendDecisionAuditEvent(context, callId, readPolicyVersion(policy), record);

  return record;
}
