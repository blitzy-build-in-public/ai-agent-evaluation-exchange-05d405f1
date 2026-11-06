/**
 * Unit suite for the worked mapping between an adopting application's shapes and Shield's.
 *
 * Three properties carry the weight. First, the mapping is exact: a call's id, tool and arguments and
 * a policy's version, rule ids, rule order and constraints all arrive unchanged, and everything
 * returned is fresh, so a later edit to the host's own objects cannot change what Shield read.
 * Second, the fail-closed direction holds at every defensive branch — a value contradicting the
 * declared shape becomes a refusal through the engine, never an allow, and a constraint that could
 * not be read is never dropped, because dropping it would widen the rule. Third, neither function
 * throws for any input, an untyped caller's garbage included.
 *
 * The last group drives a generic call and a generic policy through the mapping into `evaluate` and
 * asserts the decision records, which is how this example proves it maps a host's shapes onto the
 * engine's rather than describing an integration it does not have. The file closes with the policy
 * this package ships — `policy/example-policy.ts` — stated in the host's own vocabulary and driven
 * through that same mapping, so the shipped example is proven along the path an adopter's own policy
 * travels and its standing role in this package is demonstrable rather than assumed.
 */

import { describe, expect, it } from "vitest";

import { createApprovalStore } from "../approvals";
import { evaluate } from "../evaluate";
import type { DecisionRecord, ToolCall } from "../evaluate";
import { examplePolicy } from "../policy/example-policy";
import { validatePolicy } from "../policy/policy-schema";
import type { Policy, PolicyRule } from "../policy/policy-schema";
import { toPolicy, toToolCall } from "./reference-adapter";
import type { GenericPolicy, GenericToolCall } from "./reference-adapter";

const ALLOW_READ_REASON = "Reading a file inside the demo workspace is permitted by this suite.";
const APPROVE_WRITE_REASON = "Writing a file waits for an approval recorded for this call id.";
const DENY_DELETE_REASON = "Deleting a record is refused by this suite.";
const ALLOW_ANY_SCOPE_REASON = "Reading a file outside the demo workspace is permitted by this suite.";
const EXAMPLE_HIGH_RISK_REASON = "A call marked high risk is refused before any later rule can match it.";
const EXAMPLE_ALLOW_READ_REASON = "Reading a file inside the workspace is permitted by this example policy.";
const EXAMPLE_APPROVE_WRITE_REASON = "Writing a file inside the workspace waits for an approval event for the call.";
const EXAMPLE_SEND_MESSAGE_REASON = "Sending a message on the demo channel at normal priority is permitted here.";
const EXAMPLE_DELETE_RECORD_REASON = "Deleting a record is refused by this example policy.";

/** The policy the host states, in the host's own vocabulary. */
function hostPolicy(): GenericPolicy {
  return {
    version: "suite-1.0.0",
    rules: [
      {
        id: "allow-read",
        name: "read_file",
        effect: "allow",
        message: ALLOW_READ_REASON,
        arguments: { scope: "workspace" },
      },
      {
        id: "approve-write",
        name: "write_file",
        effect: "ask",
        message: APPROVE_WRITE_REASON,
        arguments: { scope: "workspace" },
      },
      {
        id: "deny-delete",
        name: "delete_record",
        effect: "deny",
        message: DENY_DELETE_REASON,
      },
    ],
  };
}

/**
 * The shipped example policy, re-stated in the host's own vocabulary.
 *
 * It is the worked policy this package ships — `policy/example-policy.ts` — written the way an
 * adopter would write it: the same rule ids, tool names, messages and constraints, in the same order,
 * with the host's three effects standing where the shipped example carries its three decisions.
 * Mapping it must reproduce the shipped example exactly, which is what holds the two together: an
 * edit to either one that the other does not follow fails this suite rather than letting the fixture
 * the package ships and the mapping it documents drift apart.
 */
function hostExamplePolicy(): GenericPolicy {
  return {
    version: "example-1.0.0",
    rules: [
      {
        id: "deny-high-risk-call",
        name: "*",
        effect: "deny",
        message: EXAMPLE_HIGH_RISK_REASON,
        arguments: { risk: "high" },
      },
      {
        id: "allow-read-file",
        name: "read_file",
        effect: "allow",
        message: EXAMPLE_ALLOW_READ_REASON,
        arguments: { scope: "workspace" },
      },
      {
        id: "approve-write-file",
        name: "write_file",
        effect: "ask",
        message: EXAMPLE_APPROVE_WRITE_REASON,
        arguments: { scope: "workspace", target: "*" },
      },
      {
        id: "allow-send-message",
        name: "send_message",
        effect: "allow",
        message: EXAMPLE_SEND_MESSAGE_REASON,
        arguments: { channel: "demo-channel", priority: 1, urgent: false },
      },
      {
        id: "deny-delete-record",
        name: "delete_record",
        effect: "deny",
        message: EXAMPLE_DELETE_RECORD_REASON,
      },
    ],
  };
}

/**
 * The policy whose first rule pins a constrained argument to one value and whose second accepts any
 * value at that same key.
 *
 * It is what makes argument matching reachable through the mapping: the first rule decides a call
 * carrying the pinned value, the second decides any other call carrying the key at all, and a call
 * that omits the key matches neither.
 */
function scopedPolicy(): GenericPolicy {
  return {
    version: "suite-scope-1.0.0",
    rules: [
      {
        id: "allow-read-workspace",
        name: "read_file",
        effect: "allow",
        message: ALLOW_READ_REASON,
        arguments: { scope: "workspace" },
      },
      {
        id: "allow-read-any-scope",
        name: "read_file",
        effect: "allow",
        message: ALLOW_ANY_SCOPE_REASON,
        arguments: { scope: "*" },
      },
    ],
  };
}

/** The policy that host policy maps onto, in Shield's target format. */
const EXPECTED_POLICY: Policy = {
  version: "suite-1.0.0",
  rules: [
    {
      id: "allow-read",
      tool: "read_file",
      decision: "allow",
      reason: ALLOW_READ_REASON,
      arguments: { scope: "workspace" },
    },
    {
      id: "approve-write",
      tool: "write_file",
      decision: "needs_approval",
      reason: APPROVE_WRITE_REASON,
      arguments: { scope: "workspace" },
    },
    {
      id: "deny-delete",
      tool: "delete_record",
      decision: "deny",
      reason: DENY_DELETE_REASON,
    },
  ],
};

/** The call the engine refuses: both required members empty, and no arguments read. */
const REFUSED_CALL: ToolCall = { id: "", tool: "", arguments: {} };

/** The policy the validator refuses: an empty version label. */
const REFUSED_POLICY: Policy = { version: "", rules: [] };

/** The record of a refusal the engine reaches without consulting a rule. */
const MALFORMED: DecisionRecord = { decision: "deny", reason: "malformed", ruleId: null };

/** The record of a call no rule in the policy matches. */
const NO_MATCHING_RULE: DecisionRecord = { decision: "deny", reason: "no_matching_rule", ruleId: null };

/** Hands a value of any shape to the call mapping, as an untyped JavaScript caller can. */
function asGenericCall(value: unknown): GenericToolCall {
  return value as GenericToolCall;
}

/** Hands a value of any shape to the policy mapping, as an untyped JavaScript caller can. */
function asGenericPolicy(value: unknown): GenericPolicy {
  return value as GenericPolicy;
}

/** Read a rule by index, narrowing a possibly-absent member without a `!`. */
function ruleAt(policy: Policy, index: number): PolicyRule {
  const rule = policy.rules[index];
  if (rule === undefined) {
    throw new Error(`expected a rule at index ${index}`);
  }
  return rule;
}

/** A proxy the caller has revoked, whose every read raises. */
function revokedProxy(): unknown {
  const { proxy, revoke } = Proxy.revocable({ tool: "read_file" }, {});
  revoke();
  return proxy;
}

/** An object one of whose members raises when it is read. */
function objectWithThrowingMember(member: string): unknown {
  const target: Record<string, unknown> = { callId: "call-1", name: "read_file", input: {}, version: "v", rules: [] };
  Object.defineProperty(target, member, {
    enumerable: true,
    get(): never {
      throw new Error(`${member} cannot be read`);
    },
  });
  return target;
}

describe("toToolCall: the call mapping", () => {
  it("maps callId to id, name to tool and input to arguments, and the engine decides the mapped call", () => {
    const call: GenericToolCall = { callId: "call-1", name: "read_file", input: { scope: "workspace" } };

    const mapped = toToolCall(call);

    expect(mapped).toEqual<ToolCall>({ id: "call-1", tool: "read_file", arguments: { scope: "workspace" } });
    expect(evaluate(mapped, toPolicy(hostPolicy()))).toEqual<DecisionRecord>({
      decision: "allow",
      reason: ALLOW_READ_REASON,
      ruleId: "allow-read",
    });
  });

  it("returns a fresh call and a fresh argument record, so the host's own objects are not what Shield read", () => {
    const input: Record<string, unknown> = { scope: "workspace", depth: 2 };
    const call: GenericToolCall = { callId: "call-1", name: "read_file", input };

    const mapped = toToolCall(call);

    expect(mapped).not.toBe(call);
    expect(mapped.arguments).not.toBe(input);

    input.scope = "elsewhere";
    call.name = "write_file";
    call.callId = "call-2";

    expect(mapped).toEqual<ToolCall>({ id: "call-1", tool: "read_file", arguments: { scope: "workspace", depth: 2 } });
  });

  it("does not change the call it was given", () => {
    const call: GenericToolCall = { callId: "call-1", name: "read_file", input: { scope: "workspace" } };
    const before = JSON.parse(JSON.stringify(call)) as unknown;

    toToolCall(call);

    expect(JSON.parse(JSON.stringify(call)) as unknown).toEqual(before);
  });

  it.each<[string, unknown]>([
    ["an absent input", undefined],
    ["a null input", null],
    ["a string input", "scope=workspace"],
    ["a number input", 7],
    ["an array input", ["workspace"]],
    ["a Map input", new Map([["scope", "workspace"]])],
    ["a Date input", new Date(0)],
    ["a function input", (): string => "workspace"],
  ])("maps %s to an empty argument record, which cannot satisfy an argument-constrained rule", (_label, input) => {
    const mapped = toToolCall(asGenericCall({ callId: "call-1", name: "read_file", input }));

    expect(mapped.arguments).toEqual({});
    expect(evaluate(mapped, toPolicy(hostPolicy()))).toEqual<DecisionRecord>(NO_MATCHING_RULE);
  });

  it("keeps every own member of the host's arguments, including one only JSON text produces", () => {
    const input = JSON.parse('{"__proto__":"value","scope":"workspace"}') as Record<string, unknown>;

    const mapped = toToolCall({ callId: "call-1", name: "read_file", input });

    expect(Object.keys(mapped.arguments)).toEqual(["__proto__", "scope"]);
    expect(Object.prototype.hasOwnProperty.call(mapped.arguments, "__proto__")).toBe(true);
    expect(mapped.arguments["__proto__"]).toBe("value");
    expect(Object.getPrototypeOf(mapped.arguments)).toBe(Object.prototype);
  });

  it("passes a malformed id and tool on unchanged, leaving the refusal to the engine", () => {
    const mapped = toToolCall(asGenericCall({ callId: 7, name: null, input: { scope: "workspace" } }));

    expect(mapped.id as unknown).toBe(7);
    expect(mapped.tool as unknown).toBeNull();
    expect(evaluate(mapped, toPolicy(hostPolicy()))).toEqual<DecisionRecord>(MALFORMED);
  });
});

describe("toToolCall: a call it cannot read", () => {
  it.each<[string, () => unknown]>([
    ["null", () => null],
    ["undefined", () => undefined],
    ["a number", () => 7],
    ["a string", () => "read_file"],
    ["an array", () => []],
    ["a Map", () => new Map()],
    ["a Date", () => new Date(0)],
    ["a function", () => (): string => "read_file"],
    ["a revoked proxy", revokedProxy],
    ["an id that raises when it is read", () => objectWithThrowingMember("callId")],
    ["a tool that raises when it is read", () => objectWithThrowingMember("name")],
    ["arguments that raise when they are read", () => objectWithThrowingMember("input")],
  ])("maps %s to the call the engine refuses, and never throws", (_label, build) => {
    const value = build();

    expect(() => toToolCall(asGenericCall(value))).not.toThrow();

    const mapped = toToolCall(asGenericCall(value));

    expect(mapped).toEqual<ToolCall>(REFUSED_CALL);
    expect(evaluate(mapped, toPolicy(hostPolicy()))).toEqual<DecisionRecord>(MALFORMED);
  });
});

describe("toPolicy: the policy mapping", () => {
  it("maps version, each rule's id, name as the tool, message as the reason and the effect as the decision", () => {
    const mapped = toPolicy(hostPolicy());

    expect(mapped).toEqual<Policy>(EXPECTED_POLICY);
    expect(validatePolicy(mapped).ok).toBe(true);
    expect(mapped.rules.map((rule) => rule.id)).toEqual(["allow-read", "approve-write", "deny-delete"]);
  });

  it("copies the constraints, and omits the member entirely when the host's rule states none", () => {
    const mapped = toPolicy(hostPolicy());

    expect(ruleAt(mapped, 0).arguments).toEqual({ scope: "workspace" });
    expect(Object.prototype.hasOwnProperty.call(ruleAt(mapped, 2), "arguments")).toBe(false);
  });

  it("copies a string, a number, a boolean and the wildcard value of a constraint into a fresh record", () => {
    const constraints: Record<string, string | number | boolean | "*"> = {
      scope: "workspace",
      depth: 2,
      follow_links: false,
      format: "*",
    };

    const mapped = toPolicy({
      version: "suite-constraints-1.0.0",
      rules: [
        {
          id: "allow-read",
          name: "read_file",
          effect: "allow",
          message: ALLOW_READ_REASON,
          arguments: constraints,
        },
      ],
    });
    const rule = ruleAt(mapped, 0);

    expect(rule.arguments).toEqual({ scope: "workspace", depth: 2, follow_links: false, format: "*" });
    expect(rule.arguments).not.toBe(constraints);
    expect(validatePolicy(mapped).ok).toBe(true);
  });

  it("returns fresh rules and constraints, so a later change to the host's policy cannot change the mapped one", () => {
    const policy = hostPolicy();
    const mapped = toPolicy(policy);
    const hostRule = policy.rules[0];
    if (hostRule === undefined) {
      throw new Error("the suite fixture states no first rule");
    }

    expect(mapped).not.toBe(policy);
    expect(mapped.rules).not.toBe(policy.rules);
    expect(ruleAt(mapped, 0)).not.toBe(hostRule);
    expect(ruleAt(mapped, 0).arguments).not.toBe(hostRule.arguments);

    policy.version = "suite-2.0.0";
    hostRule.name = "delete_record";
    hostRule.effect = "deny";

    expect(mapped).toEqual<Policy>(EXPECTED_POLICY);
  });

  it("does not change the policy it was given", () => {
    const policy = hostPolicy();
    const before = JSON.parse(JSON.stringify(policy)) as unknown;

    toPolicy(policy);

    expect(JSON.parse(JSON.stringify(policy)) as unknown).toEqual(before);
  });

  it.each<[string, unknown]>([
    ["a string", "none"],
    ["null", null],
    ["an object", {}],
    ["a number", 3],
  ])("maps a rule list that is %s to an empty rule list, which can only deny more", (_label, rules) => {
    const mapped = toPolicy(asGenericPolicy({ version: "suite-1.0.0", rules }));

    expect(mapped.rules).toEqual([]);
    expect(validatePolicy(mapped).ok).toBe(true);
    expect(evaluate({ id: "call-1", tool: "read_file", arguments: {} }, mapped)).toEqual<DecisionRecord>(NO_MATCHING_RULE);
  });
});

describe("toPolicy: the refusal direction", () => {
  const unreadablePolicies: Array<[string, unknown]> = [
    ["an effect outside the three", { version: "v", rules: [{ id: "r", name: "read_file", effect: "permit", message: "m" }] }],
    ["an upper-case effect", { version: "v", rules: [{ id: "r", name: "read_file", effect: "ALLOW", message: "m" }] }],
    ["the target vocabulary in place of the host's", { version: "v", rules: [{ id: "r", name: "read_file", effect: "needs_approval", message: "m" }] }],
    ["a rule entry that is null", { version: "v", rules: [null] }],
    ["a rule entry that is a string", { version: "v", rules: ["read_file"] }],
    ["a rule entry that is an array", { version: "v", rules: [[]] }],
    ["a non-string version", { version: 7, rules: [] }],
    ["a non-string rule id", { version: "v", rules: [{ id: 7, name: "read_file", effect: "allow", message: "m" }] }],
    ["a non-string rule name", { version: "v", rules: [{ id: "r", name: null, effect: "allow", message: "m" }] }],
    ["a non-string rule message", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: 7 }] }],
    ["constraints that are not a record", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: "scope=workspace" }] }],
    ["constraints that are an array", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: [] }] }],
    ["an object-valued constraint", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: { path: {} } }] }],
    ["an array-valued constraint", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: { path: [] } }] }],
    ["a null-valued constraint", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: { path: null } }] }],
    ["a function-valued constraint", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: { path: (): string => "*" } }] }],
    ["a bigint-valued constraint", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: { path: BigInt(3) } }] }],
    // The constraint is stated, and the record the policy validator builds cannot hold this key as
    // its own: it is refused here rather than applied with the constraint silently dropped.
    ["a constraint key the validated record cannot hold", { version: "v", rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: JSON.parse('{"__proto__":"*"}') }] }],
  ];

  it.each(unreadablePolicies)("renders the policy invalid for %s, and the engine refuses it", (_label, policy) => {
    const mapped = toPolicy(asGenericPolicy(policy));

    expect(validatePolicy(mapped).ok).toBe(false);
    expect(evaluate({ id: "call-1", tool: "read_file", arguments: {} }, mapped)).toEqual<DecisionRecord>(MALFORMED);
  });

  it("keeps a rule's stated restrictions out of a policy the validator accepts when a constraint is unreadable", () => {
    // The generic rule would allow read_file whatever its arguments if the constraint were dropped,
    // so the only two acceptable answers are refusal or a rule that still restricts the call. The
    // engine's answer is the first of them.
    const mapped = toPolicy(
      asGenericPolicy({
        version: "v",
        rules: [{ id: "r", name: "read_file", effect: "allow", message: "m", arguments: { path: {} } }],
      }),
    );

    const record = evaluate({ id: "call-1", tool: "read_file", arguments: { path: "anywhere.txt" } }, mapped);

    expect(record.decision).toBe("deny");
    expect(record).toEqual<DecisionRecord>(MALFORMED);
  });

  // Five names every object inherits from its prototype chain. They reach the mapping as the string
  // an untyped host stated, so the member a plain lookup would find is not a decision this module may
  // hand on: each is outside the host's three and must be read as an own key of the table.
  const inheritedEffectNames: string[] = ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__"];

  it.each(inheritedEffectNames)(
    "renders the rule invalid for the effect %s, which only the prototype chain carries, and the engine refuses the policy",
    (effect) => {
      const mapped = toPolicy(
        asGenericPolicy({ version: "v", rules: [{ id: "r", name: "read_file", effect, message: "m" }] }),
      );
      const rule = ruleAt(mapped, 0);
      const record = evaluate(toToolCall({ callId: "call-1", name: "read_file", input: {} }), mapped);

      expect(["allow", "deny", "needs_approval"]).toContain<string>(rule.decision);
      expect(rule.decision).toBe("deny");
      expect(rule.id).toBe("");
      expect(validatePolicy(mapped).ok).toBe(false);
      expect(record).toEqual<DecisionRecord>(MALFORMED);
    },
  );
});

describe("toPolicy: a policy it cannot read", () => {
  it.each<[string, () => unknown]>([
    ["null", () => null],
    ["undefined", () => undefined],
    ["a number", () => 7],
    ["a string", () => "version: v"],
    ["an array", () => []],
    ["a Map", () => new Map<string, unknown>([["version", "v"]])],
    ["a Date", () => new Date(0)],
    ["a function", () => (): string => "v"],
    ["a revoked proxy", revokedProxy],
    ["a version that raises when it is read", () => objectWithThrowingMember("version")],
    ["rules that raise when they are read", () => objectWithThrowingMember("rules")],
    ["a rule member that raises when it is read", () => ({ version: "v", rules: [objectWithThrowingMember("id")] })],
  ])("maps %s to the policy the validator refuses, and never throws", (_label, build) => {
    const value = build();

    expect(() => toPolicy(asGenericPolicy(value))).not.toThrow();

    const mapped = toPolicy(asGenericPolicy(value));

    expect(mapped).toEqual<Policy>(REFUSED_POLICY);
    expect(validatePolicy(mapped).ok).toBe(false);
    expect(evaluate({ id: "call-1", tool: "read_file", arguments: {} }, mapped)).toEqual<DecisionRecord>(MALFORMED);
  });
});

describe("the mapping and the engine together", () => {
  it.each<[string, GenericToolCall, DecisionRecord]>([
    [
      "an allow rule",
      { callId: "call-allow", name: "read_file", input: { scope: "workspace" } },
      { decision: "allow", reason: ALLOW_READ_REASON, ruleId: "allow-read" },
    ],
    [
      "a deny rule",
      { callId: "call-deny", name: "delete_record", input: {} },
      { decision: "deny", reason: DENY_DELETE_REASON, ruleId: "deny-delete" },
    ],
    [
      "a rule that blocks the call",
      { callId: "call-ask", name: "write_file", input: { scope: "workspace" } },
      { decision: "needs_approval", reason: APPROVE_WRITE_REASON, ruleId: "approve-write" },
    ],
    [
      "a tool no rule names",
      { callId: "call-unlisted", name: "send_message", input: { channel: "demo-channel" } },
      { decision: "deny", reason: "no_matching_rule", ruleId: null },
    ],
  ])("decides a generic call under a generic policy, taking a matched rule's own message as the reason: %s", (_label, call, expected) => {
    expect(evaluate(toToolCall(call), toPolicy(hostPolicy()))).toEqual<DecisionRecord>(expected);
  });

  it("decides by the rule accepting any value at the constrained key when the pinned rule falls through", () => {
    const mapped = toPolicy(scopedPolicy());
    const call = toToolCall({ callId: "call-elsewhere", name: "read_file", input: { scope: "elsewhere" } });

    expect(validatePolicy(mapped).ok).toBe(true);
    expect(evaluate(call, mapped)).toEqual<DecisionRecord>({
      decision: "allow",
      reason: ALLOW_ANY_SCOPE_REASON,
      ruleId: "allow-read-any-scope",
    });
  });

  it("refuses a call that omits the key both matching rules constrain, because a missing argument matches nothing", () => {
    const mapped = toPolicy(scopedPolicy());
    const call = toToolCall({ callId: "call-scopeless", name: "read_file", input: { depth: 2 } });

    expect(evaluate(call, mapped)).toEqual<DecisionRecord>(NO_MATCHING_RULE);
  });

  it.each<[string, Record<string, string | number | boolean | "*">, Record<string, unknown>, DecisionRecord]>([
    [
      "a number the call carries as that number",
      { attempt: 2 },
      { attempt: 2 },
      { decision: "allow", reason: ALLOW_READ_REASON, ruleId: "allow-read-attempt" },
    ],
    ["a number the call carries as a string", { attempt: 2 }, { attempt: "2" }, NO_MATCHING_RULE],
    [
      "a boolean the call carries as that boolean",
      { mode: true },
      { mode: true },
      { decision: "allow", reason: ALLOW_READ_REASON, ruleId: "allow-read-attempt" },
    ],
    ["a boolean the call carries as a string", { mode: true }, { mode: "true" }, NO_MATCHING_RULE],
  ])("compares a constrained value strictly, without coercion, for %s", (_label, constraints, callArguments, expected) => {
    const mapped = toPolicy({
      version: "suite-strict-1.0.0",
      rules: [
        {
          id: "allow-read-attempt",
          name: "read_file",
          effect: "allow",
          message: ALLOW_READ_REASON,
          arguments: constraints,
        },
      ],
    });
    const call = toToolCall({ callId: "call-attempt", name: "read_file", input: callArguments });

    expect(validatePolicy(mapped).ok).toBe(true);
    expect(evaluate(call, mapped)).toEqual<DecisionRecord>(expected);
  });

  it("releases a blocked call only for the call id its approval names", () => {
    const policy = toPolicy(hostPolicy());
    const store = createApprovalStore();
    const blocked = toToolCall({ callId: "call-approve", name: "write_file", input: { scope: "workspace" } });

    expect(evaluate(blocked, policy)).toEqual<DecisionRecord>({
      decision: "needs_approval",
      reason: APPROVE_WRITE_REASON,
      ruleId: "approve-write",
    });

    store.recordApproval({
      callId: "call-another-call",
      approvedBy: "demo-operator",
      reason: "looked at a different call",
      at: "2024-01-01T00:00:00.000Z",
    });

    expect(evaluate(blocked, policy, { approvals: store })).toEqual<DecisionRecord>({
      decision: "needs_approval",
      reason: APPROVE_WRITE_REASON,
      ruleId: "approve-write",
    });

    store.recordApproval({
      callId: "call-approve",
      approvedBy: "demo-operator",
      reason: "looked at this call",
      at: "2024-01-01T00:00:00.000Z",
    });

    expect(evaluate(blocked, policy, { approvals: store })).toEqual<DecisionRecord>({
      decision: "allow",
      reason: "approved",
      ruleId: "approve-write",
    });
  });

  it("maps deterministically: the same host call and policy give equal mappings on every run", () => {
    const call: GenericToolCall = { callId: "call-1", name: "read_file", input: { scope: "workspace" } };
    const policy = hostPolicy();

    const firstCall = toToolCall(call);
    const secondCall = toToolCall(call);
    const firstPolicy = toPolicy(policy);
    const secondPolicy = toPolicy(policy);

    expect(firstCall).toEqual(secondCall);
    expect(firstCall).not.toBe(secondCall);
    expect(firstPolicy).toEqual(secondPolicy);
    expect(firstPolicy).not.toBe(secondPolicy);
    expect(evaluate(firstCall, firstPolicy)).toEqual(evaluate(secondCall, secondPolicy));
  });
});

describe("the shipped example policy through the adapter", () => {
  it("maps the host's own words for the shipped example onto exactly the policy the package ships", () => {
    const mapped = toPolicy(hostExamplePolicy());

    expect(mapped).toEqual<Policy>(examplePolicy);
    expect(validatePolicy(examplePolicy).ok).toBe(true);
  });

  it.each<[string, GenericToolCall, DecisionRecord]>([
    [
      "a call the read rule permits",
      { callId: "example-call-read", name: "read_file", input: { scope: "workspace" } },
      { decision: "allow", reason: EXAMPLE_ALLOW_READ_REASON, ruleId: "allow-read-file" },
    ],
    [
      "a call the shipped example's first rule refuses",
      { callId: "example-call-risk", name: "read_file", input: { risk: "high", scope: "workspace" } },
      { decision: "deny", reason: EXAMPLE_HIGH_RISK_REASON, ruleId: "deny-high-risk-call" },
    ],
    [
      "a call the write rule blocks",
      { callId: "example-call-write", name: "write_file", input: { scope: "workspace", target: "notes.txt" } },
      { decision: "needs_approval", reason: EXAMPLE_APPROVE_WRITE_REASON, ruleId: "approve-write-file" },
    ],
    [
      "a call the message rule permits",
      { callId: "example-call-send", name: "send_message", input: { channel: "demo-channel", priority: 1, urgent: false } },
      { decision: "allow", reason: EXAMPLE_SEND_MESSAGE_REASON, ruleId: "allow-send-message" },
    ],
    [
      "a call the delete rule refuses",
      { callId: "example-call-delete", name: "delete_record", input: {} },
      { decision: "deny", reason: EXAMPLE_DELETE_RECORD_REASON, ruleId: "deny-delete-record" },
    ],
    [
      "a call naming a tool the shipped example leaves out of every rule",
      { callId: "example-call-unlisted", name: "http_request", input: {} },
      { decision: "deny", reason: "no_matching_rule", ruleId: null },
    ],
  ])("decides by the shipped example's own rules, taking each matched rule's own message as the reason: %s", (_label, call, expected) => {
    const mapped = toPolicy(hostExamplePolicy());

    expect(validatePolicy(mapped).ok).toBe(true);
    expect(evaluate(toToolCall(call), mapped)).toEqual<DecisionRecord>(expected);
  });

  it("releases the shipped example's blocked write only for the call id its approval names", () => {
    const policy = toPolicy(hostExamplePolicy());
    const store = createApprovalStore();
    const blocked = toToolCall({ callId: "example-call-approve", name: "write_file", input: { scope: "workspace", target: "notes.txt" } });

    expect(evaluate(blocked, policy)).toEqual<DecisionRecord>({
      decision: "needs_approval",
      reason: EXAMPLE_APPROVE_WRITE_REASON,
      ruleId: "approve-write-file",
    });

    store.recordApproval({
      callId: "example-call-another",
      approvedBy: "demo-operator",
      reason: "looked at a different call",
      at: "2024-01-01T00:00:00.000Z",
    });

    expect(evaluate(blocked, policy, { approvals: store })).toEqual<DecisionRecord>({
      decision: "needs_approval",
      reason: EXAMPLE_APPROVE_WRITE_REASON,
      ruleId: "approve-write-file",
    });

    store.recordApproval({
      callId: "example-call-approve",
      approvedBy: "demo-operator",
      reason: "looked at this call",
      at: "2024-01-01T00:00:00.000Z",
    });

    expect(evaluate(blocked, policy, { approvals: store })).toEqual<DecisionRecord>({
      decision: "allow",
      reason: "approved",
      ruleId: "approve-write-file",
    });
  });
});
