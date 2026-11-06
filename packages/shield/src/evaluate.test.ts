import { describe, expect, it } from "vitest";

import { createApprovalStore } from "./approvals";
import { createInMemoryAuditLog } from "./audit";
import type { AuditEvent, AuditSink, InMemoryAuditLog } from "./audit";
import { evaluate } from "./evaluate";
import type { DecisionRecord, EvaluateContext, ToolCall } from "./evaluate";
import { examplePolicy } from "./policy/example-policy";
import type { Policy, PolicyRule } from "./policy/policy-schema";

/**
 * The decision `evaluate` reaches for one call under one policy, and what that decision leaves behind.
 *
 * This suite fixes what the engine owes a caller, decision by decision. A call a rule matches is
 * decided by that rule's own text, and the record names the rule that decided it. A call no rule
 * matches is refused by default, and a call or a policy the engine cannot read is refused as
 * `malformed` — as a record and never as an exception, because a caller that has inspected the
 * decision it was handed has then seen everything the function can do. A call a rule holds for
 * approval is released only once an approval for that exact call id has been recorded, and the
 * absence of an approval store is not an approval. Every decision appends exactly one audit event,
 * the refusals included, and a sink that fails changes no decision.
 *
 * The example policy is the fixture and is never modified here. Its rule ids, tool names and reason
 * texts are read back out of it rather than repeated in this file, so a case that stops naming a
 * rule fails loudly instead of quietly passing against a fixture that moved. The only literals
 * written out below are the three reason strings the engine authors itself, the tool names the
 * example policy's rules work with, and the timestamps a caller supplies.
 *
 * Reproducibility is the point rather than a side effect: a fixed clock is supplied wherever a
 * timestamp is recorded, so every run observes the same trail, and a decision record is asserted
 * field by field.
 */

/** The engine's own reason for a call, or a policy, it could not read. */
const MALFORMED_REASON = "malformed";
/** The engine's own reason for a call no rule in the policy matches. */
const NO_MATCHING_RULE_REASON = "no_matching_rule";
/** The engine's own reason for a call a rule held and a recorded approval released. */
const APPROVED_REASON = "approved";

/** The literal the example policy uses for its tool wildcard and for an argument accepting any value. */
const WILDCARD = "*";
/** The fictional tools the example policy's rules work with, by the names those rules use. */
const READ_TOOL = "read_file";
const WRITE_TOOL = "write_file";
const SEND_TOOL = "send_message";
const DELETE_TOOL = "delete_record";
/**
 * A fictional tool no rule of the example policy names, which is what makes the default deny
 * reachable rather than assumed.
 */
const UNMATCHED_TOOL = "list_repository";

/** The timestamp every recorded decision in this suite carries. */
const FIXED_TIMESTAMP = "1970-01-01T00:00:00.000Z";
/** The timestamp of the approvals this suite records, supplied by the caller because Shield reads no clock. */
const APPROVAL_AT = "2024-01-01T00:00:00.000Z";
/** A version label for a policy that carries one and still fails validation, so the trail can name it. */
const BROKEN_POLICY_VERSION = "example-broken-9.9.9";

/** Returns the fixed timestamp, in place of a clock. */
function fixedNow(): string {
  return FIXED_TIMESTAMP;
}

/**
 * Returns the one rule of the example policy this case reads, failing readably when it is gone.
 *
 * Cases look their rule up rather than writing its id, tool or reason text again, so a case can only
 * pass against the rule it means.
 */
function findRule(describedAs: string, matches: (rule: PolicyRule) => boolean): PolicyRule {
  const rule = examplePolicy.rules.find(matches);
  if (rule === undefined) {
    throw new Error(`the example policy no longer carries the rule this case reads: ${describedAs}`);
  }
  return rule;
}

/** The rule the example policy writes for every tool, and which it therefore constrains by argument. */
const HIGH_RISK_RULE = findRule(
  "a deny rule written for every tool",
  (rule) => rule.tool === WILDCARD && rule.decision === "deny",
);
/** The rule that allows a read. */
const ALLOW_READ_RULE = findRule(
  "an allow rule for a read",
  (rule) => rule.tool === READ_TOOL && rule.decision === "allow",
);
/** The rule that holds a write for approval. */
const APPROVAL_RULE = findRule(
  "a needs_approval rule for a write",
  (rule) => rule.tool === WRITE_TOOL && rule.decision === "needs_approval",
);
/** The rule that allows a message, whose arguments this suite varies to exercise argument matching. */
const ALLOW_MESSAGE_RULE = findRule(
  "an allow rule for a message",
  (rule) => rule.tool === SEND_TOOL && rule.decision === "allow",
);
/** The rule that refuses a delete without constraining any argument. */
const DENY_DELETE_RULE = findRule(
  "a deny rule for a delete",
  (rule) => rule.tool === DELETE_TOOL && rule.decision === "deny",
);

/** Builds a tool call: the shape the engine decides, assembled here rather than repeated per case. */
function call(id: string, tool: string, args: Record<string, unknown>): ToolCall {
  return { id, tool, arguments: args };
}

/**
 * Returns the decision for a candidate call and policy, turning a raise into a failure that names it.
 *
 * Every case in this suite decides through here, so the promise that the engine never throws is
 * exercised by all of them: a raise reaches the test as a failure rather than escaping the file, and
 * no case can pass by catching one.
 */
function decide(candidate: unknown, policy: unknown, context?: EvaluateContext): DecisionRecord {
  try {
    return evaluate(candidate, policy, context);
  } catch (error) {
    throw new Error(`evaluate raised instead of returning a decision record: ${String(error)}`);
  }
}

/** Asserts the three fields of a decision record, which are the whole of it. */
function expectRecord(record: DecisionRecord, expected: DecisionRecord): void {
  expect(record.decision).toBe(expected.decision);
  expect(record.reason).toBe(expected.reason);
  expect(record.ruleId).toBe(expected.ruleId);
}

/** The arguments a call must carry to match this rule as the rule declares them. */
function declaredArguments(rule: PolicyRule): Record<string, unknown> {
  return rule.arguments === undefined ? {} : { ...rule.arguments };
}

/** Reads a value the example policy declares for one argument, failing readably when it declares none. */
function declaredArgument(rule: PolicyRule, key: string): string | number | boolean {
  const declared = rule.arguments?.[key];
  if (declared === undefined) {
    throw new Error(`the example policy no longer declares an argument for "${key}"`);
  }
  return declared;
}

/**
 * Reads the key of an argument this rule constrains to one exact value — not one declaring the
 * wildcard for any value — failing readably when the rule no longer constrains one.
 */
function constrainedKey(rule: PolicyRule): string {
  const declared = rule.arguments ?? {};
  const key = Object.keys(declared).find((candidate) => declared[candidate] !== WILDCARD);
  if (key === undefined) {
    throw new Error(`the rule "${rule.id}" no longer constrains an argument to one exact value`);
  }
  return key;
}

/** Returns a value of the same kind as the one a rule declares, and different from it. */
function differentValue(declared: string | number | boolean): string | number | boolean {
  if (typeof declared === "number") {
    return declared + 1;
  }
  if (typeof declared === "boolean") {
    return !declared;
  }
  return `${declared}-but-another-value`;
}

/** Returns a copy of the example policy carrying one more rule, in the policy's own order. */
function policyWithAppendedRule(rule: PolicyRule): Policy {
  return { version: examplePolicy.version, rules: [...examplePolicy.rules, rule] };
}

/** Returns the log's single event, failing readably rather than reading past an empty or crowded log. */
function onlyEvent(log: InMemoryAuditLog): AuditEvent {
  const events = log.list();
  expect(events).toHaveLength(1);
  const [first] = events;
  if (first === undefined) {
    throw new Error("expected the log to hold exactly one event");
  }
  return first;
}

/** The read call this suite decides under the example policy whenever a case needs one. */
function readableCall(id: string): ToolCall {
  return call(id, READ_TOOL, declaredArguments(ALLOW_READ_RULE));
}

/** The write call that rule holds for approval, carrying a target value the rule's wildcard accepts. */
function heldWriteCall(id: string): ToolCall {
  return call(id, WRITE_TOOL, { ...declaredArguments(APPROVAL_RULE), target: "notes.txt" });
}

describe("the Shield decision for one call under one policy", () => {
  describe("the decision a matched rule produces", () => {
    it("allows a call the policy allows, with that rule's own reason and id", () => {
      const record = decide(readableCall("call-read-1"), examplePolicy);
      expectRecord(record, {
        decision: "allow",
        reason: ALLOW_READ_RULE.reason,
        ruleId: ALLOW_READ_RULE.id,
      });
    });

    it("refuses a call the policy refuses, with that rule's own reason and id", () => {
      const record = decide(call("call-delete-1", DELETE_TOOL, {}), examplePolicy);
      expectRecord(record, {
        decision: "deny",
        reason: DENY_DELETE_RULE.reason,
        ruleId: DENY_DELETE_RULE.id,
      });
    });

    it("applies a rule written for every tool to a tool no rule names", () => {
      // The tool here is one no rule mentions by name, and the rule applies all the same: its tool is
      // the wildcard, and the argument it constrains is present with the value it declares.
      const record = decide(
        call("call-any-tool-1", UNMATCHED_TOOL, declaredArguments(HIGH_RISK_RULE)),
        examplePolicy,
      );
      expectRecord(record, {
        decision: "deny",
        reason: HIGH_RISK_RULE.reason,
        ruleId: HIGH_RISK_RULE.id,
      });
    });

    it("answers with the first rule that applies, not the most specific one", () => {
      // The call satisfies both the rule written for every tool, which comes first, and the read rule,
      // which comes later. The policy's order decides, so the earlier rule answers.
      const record = decide(
        call("call-read-2", READ_TOOL, {
          ...declaredArguments(HIGH_RISK_RULE),
          ...declaredArguments(ALLOW_READ_RULE),
        }),
        examplePolicy,
      );
      expectRecord(record, {
        decision: "deny",
        reason: HIGH_RISK_RULE.reason,
        ruleId: HIGH_RISK_RULE.id,
      });
    });

    it("accepts any value at an argument a rule declares its wildcard for", () => {
      const record = decide(heldWriteCall("call-write-1"), examplePolicy);
      expectRecord(record, {
        decision: "needs_approval",
        reason: APPROVAL_RULE.reason,
        ruleId: APPROVAL_RULE.id,
      });
    });

    it("decides two calls differing only in a constrained argument differently", () => {
      const key = constrainedKey(ALLOW_MESSAGE_RULE);
      const declared = declaredArgument(ALLOW_MESSAGE_RULE, key);
      const matching = call("call-message-1", SEND_TOOL, declaredArguments(ALLOW_MESSAGE_RULE));
      const differing = call("call-message-2", SEND_TOOL, {
        ...declaredArguments(ALLOW_MESSAGE_RULE),
        [key]: differentValue(declared),
      });

      expect(Object.keys(differing.arguments)).toEqual(Object.keys(matching.arguments));

      expectRecord(decide(matching, examplePolicy), {
        decision: "allow",
        reason: ALLOW_MESSAGE_RULE.reason,
        ruleId: ALLOW_MESSAGE_RULE.id,
      });
      // The value the second call carries at that key satisfies no rule, including the wildcard rule,
      // whose own argument the call does not carry: the engine's own refusal is the outcome.
      expectRecord(decide(differing, examplePolicy), {
        decision: "deny",
        reason: NO_MATCHING_RULE_REASON,
        ruleId: null,
      });
    });
  });

  describe("default deny", () => {
    it("refuses a call naming a tool no rule mentions, with no rule id", () => {
      const record = decide(call("call-unlisted-1", UNMATCHED_TOOL, {}), examplePolicy);
      expectRecord(record, {
        decision: "deny",
        reason: NO_MATCHING_RULE_REASON,
        ruleId: null,
      });
    });

    it("keeps the tool it leaves out by name out of every rule", () => {
      // The refusal above rests on this: no rule of the example policy names that tool, and the rule
      // written for every tool constrains an argument the call there does not carry.
      expect(examplePolicy.rules.some((rule) => rule.tool === UNMATCHED_TOOL)).toBe(false);
      expect(declaredArguments(HIGH_RISK_RULE)).not.toEqual({});
    });

    it("refuses a call whose argument satisfies none of the rules either", () => {
      const key = constrainedKey(HIGH_RISK_RULE);
      const record = decide(
        call("call-unlisted-2", UNMATCHED_TOOL, {
          [key]: differentValue(declaredArgument(HIGH_RISK_RULE, key)),
        }),
        examplePolicy,
      );
      expectRecord(record, {
        decision: "deny",
        reason: NO_MATCHING_RULE_REASON,
        ruleId: null,
      });
    });
  });

  describe("the approval checkpoint", () => {
    it("holds a call its rule blocks, with that rule's own reason and id", () => {
      const record = decide(heldWriteCall("call-write-2"), examplePolicy);
      expectRecord(record, {
        decision: "needs_approval",
        reason: APPROVAL_RULE.reason,
        ruleId: APPROVAL_RULE.id,
      });
    });

    it("holds the call when the caller supplied no context at all", () => {
      const record = decide(heldWriteCall("call-write-3"), examplePolicy, {});
      expectRecord(record, {
        decision: "needs_approval",
        reason: APPROVAL_RULE.reason,
        ruleId: APPROVAL_RULE.id,
      });
    });

    it("holds the call while no approval store is supplied", () => {
      // The absence of a store is not an approval: the release below is the only thing that ends the hold.
      const record = decide(heldWriteCall("call-write-4"), examplePolicy, { now: fixedNow });
      expectRecord(record, {
        decision: "needs_approval",
        reason: APPROVAL_RULE.reason,
        ruleId: APPROVAL_RULE.id,
      });
    });

    it("holds the call while the supplied store holds no approval for it", () => {
      const store = createApprovalStore();
      const record = decide(heldWriteCall("call-write-5"), examplePolicy, { approvals: store });
      expectRecord(record, {
        decision: "needs_approval",
        reason: APPROVAL_RULE.reason,
        ruleId: APPROVAL_RULE.id,
      });
      expect(store.hasApproval("call-write-5")).toBe(false);
    });

    it("holds the call while the store's approval names another call id", () => {
      const store = createApprovalStore();
      store.recordApproval({
        callId: "call-write-other",
        approvedBy: "demo-operator",
        reason: "Recorded against a different call.",
        at: APPROVAL_AT,
      });
      const record = decide(heldWriteCall("call-write-6"), examplePolicy, { approvals: store });
      expectRecord(record, {
        decision: "needs_approval",
        reason: APPROVAL_RULE.reason,
        ruleId: APPROVAL_RULE.id,
      });
    });

    it("releases the call once an approval for its own id is recorded, still naming the blocking rule", () => {
      const store = createApprovalStore();
      const held = heldWriteCall("call-write-7");
      store.recordApproval({
        callId: held.id,
        approvedBy: "demo-operator",
        reason: "Recorded for the call this approval names.",
        at: APPROVAL_AT,
      });

      const record = decide(held, examplePolicy, { approvals: store });
      expectRecord(record, {
        decision: "allow",
        reason: APPROVED_REASON,
        ruleId: APPROVAL_RULE.id,
      });
    });

    it("releases nothing a rule refuses, even with an approval recorded for that call id", () => {
      const refused = call("call-delete-2", DELETE_TOOL, {});
      const store = createApprovalStore();
      store.recordApproval({
        callId: refused.id,
        approvedBy: "demo-operator",
        reason: "Recorded against a refused call.",
        at: APPROVAL_AT,
      });

      const record = decide(refused, examplePolicy, { approvals: store });
      expectRecord(record, {
        decision: "deny",
        reason: DENY_DELETE_RULE.reason,
        ruleId: DENY_DELETE_RULE.id,
      });
    });
  });

  describe("malformed input", () => {
    /** Every value a caller could hand the engine as a call that is not one. */
    const malformedCalls: ReadonlyArray<{ readonly described: string; readonly candidate: unknown }> = [
      { described: "null", candidate: null },
      { described: "undefined", candidate: undefined },
      { described: "a string", candidate: READ_TOOL },
      { described: "a number", candidate: 7 },
      { described: "an array", candidate: [READ_TOOL, {}] },
      { described: "an empty object", candidate: {} },
      { described: "an object carrying no id", candidate: { tool: READ_TOOL, arguments: {} } },
      { described: "an object carrying no arguments", candidate: { id: "call-1", tool: READ_TOOL } },
      {
        described: "an object whose arguments are null",
        candidate: { id: "call-1", tool: READ_TOOL, arguments: null },
      },
      { described: "an object whose id is empty", candidate: { id: "", tool: READ_TOOL, arguments: {} } },
      { described: "an object whose tool is empty", candidate: { id: "call-1", tool: "", arguments: {} } },
    ];

    describe("a call the engine cannot read", () => {
      for (const entry of malformedCalls) {
        it(`refuses ${entry.described}, without raising`, () => {
          const record = decide(entry.candidate, examplePolicy);
          expectRecord(record, { decision: "deny", reason: MALFORMED_REASON, ruleId: null });
        });
      }
    });

    /**
     * A rule whose only key is a symbol: `Object.keys` finds no key at all, so the rule carries no
     * readable id and the policy is refused as data rather than read from.
     */
    const SYMBOL_KEY = Symbol("id");
    const symbolKeyedRule: Record<symbol, string> = { [SYMBOL_KEY]: "symbol-keyed-rule" };

    /**
     * A rule carrying itself as its own arguments: a structure a reader recursing through argument
     * values never finishes, which the engine has to refuse as data rather than walk.
     */
    const cyclicRule: Record<string, unknown> = {
      id: "cyclic-arguments-rule",
      tool: READ_TOOL,
      decision: "allow",
      reason: "A rule whose arguments are the rule itself.",
    };
    cyclicRule.arguments = cyclicRule;
    const cyclicPolicy: unknown = { version: examplePolicy.version, rules: [cyclicRule] };

    /** Every value a caller could hand the engine as a policy that is not one. */
    const malformedPolicies: ReadonlyArray<{ readonly described: string; readonly candidate: unknown }> = [
      { described: "a JSON string instead of a policy", candidate: JSON.stringify(examplePolicy) },
      { described: "null", candidate: null },
      { described: "an array", candidate: [examplePolicy] },
      {
        described: "an object whose rules are not an array",
        candidate: { version: BROKEN_POLICY_VERSION, rules: "not-an-array" },
      },
      {
        described: "a rule whose decision is outside the three",
        candidate: {
          version: examplePolicy.version,
          rules: [
            ...examplePolicy.rules,
            {
              id: "unrecognised-decision",
              tool: READ_TOOL,
              decision: "permit",
              reason: "A decision the policy format does not define.",
            },
          ],
        },
      },
      {
        described: "two rules sharing an id",
        candidate: policyWithAppendedRule({
          id: ALLOW_READ_RULE.id,
          tool: ALLOW_READ_RULE.tool,
          decision: ALLOW_READ_RULE.decision,
          reason: ALLOW_READ_RULE.reason,
        }),
      },
      { described: "a policy carrying no version", candidate: { rules: examplePolicy.rules } },
      {
        described: "a rule whose only key is a symbol",
        candidate: { version: examplePolicy.version, rules: [symbolKeyedRule] },
      },
    ];

    describe("a policy the engine cannot read", () => {
      for (const entry of malformedPolicies) {
        it(`refuses ${entry.described}, without raising`, () => {
          // The call is one the example policy itself allows, so the refusal can only come from the policy.
          const record = decide(readableCall("call-read-3"), entry.candidate);
          expectRecord(record, { decision: "deny", reason: MALFORMED_REASON, ruleId: null });
        });
      }
    });

    describe("a policy that cannot be read as data at all", () => {
      it("refuses a policy whose rule carries itself as its own arguments", () => {
        const record = decide(readableCall("call-read-4"), cyclicPolicy);
        expectRecord(record, { decision: "deny", reason: MALFORMED_REASON, ruleId: null });
      });
    });
  });

  describe("the audit trail of a decision", () => {
    it("appends exactly one event for an allowed call, carrying the five facts of the decision", () => {
      const log = createInMemoryAuditLog();
      const allowed = readableCall("call-read-5");
      const record = decide(allowed, examplePolicy, { audit: log, now: fixedNow });

      const event = onlyEvent(log);
      expect(event.timestamp).toBe(FIXED_TIMESTAMP);
      expect(event.callId).toBe(allowed.id);
      expect(event.decision).toBe(record.decision);
      expect(event.ruleId).toBe(record.ruleId);
      expect(event.policyVersion).toBe(examplePolicy.version);
    });

    it("appends exactly one event for a default-deny refusal, with no rule id", () => {
      const log = createInMemoryAuditLog();
      const unlisted = call("call-unlisted-3", UNMATCHED_TOOL, {});

      expectRecord(decide(unlisted, examplePolicy, { audit: log, now: fixedNow }), {
        decision: "deny",
        reason: NO_MATCHING_RULE_REASON,
        ruleId: null,
      });

      const event = onlyEvent(log);
      expect(event.timestamp).toBe(FIXED_TIMESTAMP);
      expect(event.callId).toBe(unlisted.id);
      expect(event.decision).toBe("deny");
      expect(event.ruleId).toBeNull();
      expect(event.policyVersion).toBe(examplePolicy.version);
    });

    it("appends one event for a malformed call, whose call id could not be read", () => {
      const log = createInMemoryAuditLog();
      decide(null, examplePolicy, { audit: log, now: fixedNow });

      const event = onlyEvent(log);
      expect(event.callId).toBe("");
      expect(event.decision).toBe("deny");
      expect(event.ruleId).toBeNull();
      expect(event.policyVersion).toBe(examplePolicy.version);
    });

    it("names a refused call in the trail by the id it carried", () => {
      const log = createInMemoryAuditLog();
      decide({ id: "call-incomplete-1", tool: READ_TOOL }, examplePolicy, { audit: log, now: fixedNow });

      const event = onlyEvent(log);
      expect(event.callId).toBe("call-incomplete-1");
      expect(event.decision).toBe("deny");
      expect(event.ruleId).toBeNull();
    });

    it("names the policy that failed validation by the version it carried", () => {
      const log = createInMemoryAuditLog();
      const namedButBroken: unknown = { version: BROKEN_POLICY_VERSION, rules: "not-an-array" };
      decide(readableCall("call-read-6"), namedButBroken, { audit: log, now: fixedNow });

      const event = onlyEvent(log);
      expect(event.policyVersion).toBe(BROKEN_POLICY_VERSION);
      expect(event.decision).toBe("deny");
      expect(event.ruleId).toBeNull();
    });

    it("records an unreadable policy as no version at all", () => {
      const log = createInMemoryAuditLog();
      decide(readableCall("call-read-7"), null, { audit: log, now: fixedNow });

      const event = onlyEvent(log);
      expect(event.policyVersion).toBe("");
      expect(event.decision).toBe("deny");
      expect(event.ruleId).toBeNull();
    });

    it("decides identically whether or not a sink was supplied, recording only when one was", () => {
      const allowed = readableCall("call-read-8");
      const log = createInMemoryAuditLog();

      const withoutSink = decide(allowed, examplePolicy, { now: fixedNow });
      const withSink = decide(allowed, examplePolicy, { audit: log, now: fixedNow });

      expect(withSink).toEqual(withoutSink);
      expect(log.size()).toBe(1);
    });

    it("grows the log by exactly one event per decision, the refusals included", () => {
      const log = createInMemoryAuditLog();
      const decisions: ReadonlyArray<{ readonly candidate: unknown; readonly policy: unknown }> = [
        { candidate: readableCall("call-mix-1"), policy: examplePolicy },
        { candidate: call("call-mix-2", DELETE_TOOL, {}), policy: examplePolicy },
        { candidate: heldWriteCall("call-mix-3"), policy: examplePolicy },
        { candidate: call("call-mix-4", UNMATCHED_TOOL, {}), policy: examplePolicy },
        { candidate: null, policy: examplePolicy },
        { candidate: readableCall("call-mix-5"), policy: null },
      ];

      const before = log.size();
      const records = decisions.map((entry) =>
        decide(entry.candidate, entry.policy, { audit: log, now: fixedNow }),
      );

      expect(before).toBe(0);
      expect(log.size()).toBe(before + decisions.length);

      const events = log.list();
      expect(events).toHaveLength(decisions.length);
      expect(events.map((event) => event.callId)).toEqual([
        "call-mix-1",
        "call-mix-2",
        "call-mix-3",
        "call-mix-4",
        "",
        "call-mix-5",
      ]);
      expect(events.map((event) => event.decision)).toEqual(records.map((record) => record.decision));
      expect(events.map((event) => event.ruleId)).toEqual(records.map((record) => record.ruleId));
      expect(events.every((event) => event.timestamp === FIXED_TIMESTAMP)).toBe(true);
    });
  });

  describe("a context whose own members fail", () => {
    /** A sink that cannot record anything, so every decision reaching it passes through the same guard. */
    const failingSink: AuditSink = {
      append(): void {
        throw new Error("sink down");
      },
    };

    /** A clock whose supplier cannot answer, standing in for a caller's broken one. */
    const failingNow = (): string => {
      throw new Error("clock down");
    };

    /** The decisions a failing sink must leave untouched, one per branch the engine can take. */
    const decisionsUnderAFailingSink: ReadonlyArray<{
      readonly described: string;
      readonly candidate: unknown;
      readonly expected: DecisionRecord;
    }> = [
      {
        described: "an allowed call",
        candidate: readableCall("call-read-9"),
        expected: { decision: "allow", reason: ALLOW_READ_RULE.reason, ruleId: ALLOW_READ_RULE.id },
      },
      {
        described: "a call the policy refuses",
        candidate: call("call-delete-3", DELETE_TOOL, {}),
        expected: { decision: "deny", reason: DENY_DELETE_RULE.reason, ruleId: DENY_DELETE_RULE.id },
      },
      {
        described: "a call held for approval",
        candidate: heldWriteCall("call-write-8"),
        expected: {
          decision: "needs_approval",
          reason: APPROVAL_RULE.reason,
          ruleId: APPROVAL_RULE.id,
        },
      },
      {
        described: "a call no rule matches",
        candidate: call("call-unlisted-4", UNMATCHED_TOOL, {}),
        expected: { decision: "deny", reason: NO_MATCHING_RULE_REASON, ruleId: null },
      },
      {
        described: "a call the engine cannot read",
        candidate: null,
        expected: { decision: "deny", reason: MALFORMED_REASON, ruleId: null },
      },
    ];

    for (const entry of decisionsUnderAFailingSink) {
      it(`returns the rules' own decision for ${entry.described}, with the sink down`, () => {
        const record = decide(entry.candidate, examplePolicy, { audit: failingSink, now: fixedNow });
        expectRecord(record, entry.expected);
      });
    }

    it("loses only its own event, never the decision, when the caller's clock fails", () => {
      const log = createInMemoryAuditLog();
      const record = decide(readableCall("call-read-10"), examplePolicy, { audit: log, now: failingNow });

      expectRecord(record, {
        decision: "allow",
        reason: ALLOW_READ_RULE.reason,
        ruleId: ALLOW_READ_RULE.id,
      });
      expect(log.size()).toBe(0);
    });
  });

  describe("the record it returns", () => {
    it("is the same for the same call under the same policy, changing neither the call nor the policy", () => {
      const message = call("call-message-3", SEND_TOOL, declaredArguments(ALLOW_MESSAGE_RULE));
      const callBefore = { id: message.id, tool: message.tool, arguments: { ...message.arguments } };
      const rulesBefore = [...examplePolicy.rules];

      const first = decide(message, examplePolicy);
      const second = decide(message, examplePolicy);

      expect(first).toEqual(second);
      expect(message).toEqual(callBefore);
      expect(examplePolicy.rules).toEqual(rulesBefore);
    });

    it("refuses a malformed call identically on every decision", () => {
      expect(decide(null, examplePolicy)).toEqual(decide(null, examplePolicy));
    });

    it("refuses an unreadable policy identically on every decision", () => {
      const broken: unknown = { version: BROKEN_POLICY_VERSION, rules: "not-an-array" };

      const first = decide(readableCall("call-read-11"), broken);
      expectRecord(first, { decision: "deny", reason: MALFORMED_REASON, ruleId: null });
      expect(decide(readableCall("call-read-12"), broken)).toEqual(first);
    });
  });
});
