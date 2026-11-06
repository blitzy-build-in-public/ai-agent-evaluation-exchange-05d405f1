/**
 * Unit suite for the rule matcher.
 *
 * Three choices are what make the matcher fail closed, and each has its own group
 * here: a rule's tool matches by exact name or by the literal `"*"` and never by a
 * pattern; a key listed in a rule's `arguments` matches only when the call carries
 * that key as its own and holds the declared value strictly, `"*"` accepting any
 * value present there; and a policy is walked in declaration order, so the first
 * rule that matches decides. `null` from `matchRule` is the whole answer for a call
 * no rule applies to, and it is what makes the caller's own refusal reachable — so
 * the last group pins the promise that a rule, a policy or a call the matcher
 * cannot read is refused rather than raised on.
 */

import { describe, expect, it } from "vitest";
import { matchRule, ruleMatches } from "./match-rule";
import type { RuleMatchTarget } from "./match-rule";
import type { Policy, PolicyRule } from "./policy-schema";

/** A policy holding exactly these rules, in this order. */
function buildPolicy(...rules: PolicyRule[]): Policy {
  return { version: "1.0.0", rules };
}

/** A call to `tool`, carrying `args` or, by default, no arguments at all. */
function buildCall(tool: string, args: Record<string, unknown> = {}): RuleMatchTarget {
  return { tool, arguments: args };
}

/** A deliberately malformed value in a rule's, a policy's or a call's position. */
const asRule = (candidate: unknown): PolicyRule => candidate as PolicyRule;
const asPolicy = (candidate: unknown): Policy => candidate as Policy;
const asCall = (candidate: unknown): RuleMatchTarget => candidate as RuleMatchTarget;

/** A proxy whose every read raises, the one container shape the matcher's catch answers for. */
function revokedProxy(): unknown {
  const { proxy, revoke } = Proxy.revocable({ tool: "read_file" }, {});
  revoke();
  return proxy;
}

const readRule: PolicyRule = { id: "read", tool: "read_file", decision: "allow", reason: "reading a report is allowed" };
const sendRule: PolicyRule = { id: "send", tool: "send_message", decision: "needs_approval", reason: "sending needs approval" };
const anyToolRule: PolicyRule = { id: "any-tool", tool: "*", decision: "allow", reason: "the rule names every tool" };
const scopedRule: PolicyRule = {
  id: "scoped-read", tool: "read_file", decision: "allow", reason: "reading inside the workspace is allowed",
  arguments: { scope: "workspace" },
};
const anyScopeRule: PolicyRule = {
  id: "any-scope", tool: "read_file", decision: "allow", reason: "any scope the call carries satisfies the rule",
  arguments: { scope: "*" },
};

describe("ruleMatches: matching the rule's tool", () => {
  // Equality is exact and case-sensitive, an argument the rule never lists is
  // ignored rather than required, and a rule's tool is a name and not a pattern,
  // so an implementation that trimmed, lower-cased, pattern-matched or compared
  // whole key sets fails at least one of these cases.
  const toolCases: Array<[string, PolicyRule, RuleMatchTarget, boolean]> = [
    ["matches the rule's own tool with no arguments at all", readRule, buildCall("read_file"), true],
    ["matches the rule's own tool with arguments the rule never lists", readRule, buildCall("read_file", { path: "report.txt", retries: 2 }), true],
    ["matches any tool when the rule's tool is '*'", anyToolRule, buildCall("send_message"), true],
    ["matches an empty tool name when the rule's tool is '*'", anyToolRule, buildCall(""), true],
    ["matches a punctuated tool name when the rule's tool is '*'", anyToolRule, buildCall("tool.with.punctuation"), true],
    ["does not match read against a rule for read_file", readRule, buildCall("read"), false],
    ["does not match file against a rule for read_file", readRule, buildCall("file"), false],
    ["does not match read_files against a rule for read_file", readRule, buildCall("read_files"), false],
    ["does not match a tool name with a trailing space", readRule, buildCall("read_file "), false],
    ["does not match a differently cased tool name", readRule, buildCall("Read_file"), false],
    ["does not match an empty tool name against a named rule", readRule, buildCall(""), false],
  ];

  it.each(toolCases)("%s", (_label, rule, call, expected) => {
    expect(ruleMatches(rule, call)).toBe(expected);
  });

  it.each(["read_*", "*_file", "^read"])("treats the pattern-shaped rule tool %s as an ordinary name", (tool) => {
    const literalRule: PolicyRule = {
      id: "literal-tool", tool, decision: "allow", reason: "the rule names one literal tool",
    };
    expect(ruleMatches(literalRule, buildCall(tool))).toBe(true);
    expect(ruleMatches(literalRule, buildCall("read_file"))).toBe(false);
  });
});

describe("ruleMatches: matching the rule's argument constraints", () => {
  // An absent key is not an equal one, an own key is the only presence there is,
  // and the comparison is strict: a matcher testing `key in arguments`, using a
  // loose `==`, trimming a string, or letting a wildcard match an absent key
  // fails one of these cases.
  const argumentCases: Array<[string, PolicyRule, RuleMatchTarget, boolean]> = [
    ["matches when every listed key is present and holds the declared value", scopedRule, buildCall("read_file", { scope: "workspace" }), true],
    ["matches while ignoring call arguments the rule does not list", scopedRule, buildCall("read_file", { extra: 1, scope: "workspace" }), true],
    ["does not match a different value at the key", scopedRule, buildCall("read_file", { scope: "elsewhere" }), false],
    ["does not match an absent key, because absence is not equality", scopedRule, buildCall("read_file"), false],
    ["does not match a null value at the key", scopedRule, buildCall("read_file", { scope: null }), false],
    ["does not match a value padded with a space", scopedRule, buildCall("read_file", { scope: "workspace " }), false],
    ["matches a string present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: "demo-channel" }), true],
    ["matches a number present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: 7 }), true],
    ["matches a boolean present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: false }), true],
    ["matches null present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: null }), true],
    ["matches undefined present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: undefined }), true],
    ["matches an object present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: { nested: true } }), true],
    ["matches an array present at the wildcard's key", anyScopeRule, buildCall("read_file", { scope: [1, 2] }), true],
    ["does not match the wildcard when the key is absent", anyScopeRule, buildCall("read_file"), false],
    ["does not match the wildcard on another key", anyScopeRule, buildCall("read_file", { other: "demo-channel" }), false],
  ];

  it.each(argumentCases)("%s", (_label, rule, call, expected) => {
    expect(ruleMatches(rule, call)).toBe(expected);
  });

  // Presence is own-key presence: `key in arguments` reads the prototype chain and
  // so applies each rule to the plain call below, while the call carrying the key
  // itself is the only one it may apply to.
  it.each(["toString", "hasOwnProperty", "constructor", "__proto__"])(
    "counts the inherited member %s only when the call carries it as its own",
    (key) => {
      const wildcard: PolicyRule = {
        id: "inherited-wildcard", tool: "read_file", decision: "allow", reason: "the call must carry the key",
        arguments: { [key]: "*" },
      };
      const literal: PolicyRule = {
        id: "inherited-literal", tool: "read_file", decision: "allow", reason: "the call must carry the key",
        arguments: { [key]: "demo-channel" },
      };
      expect(ruleMatches(wildcard, buildCall("read_file"))).toBe(false);
      expect(ruleMatches(literal, buildCall("read_file"))).toBe(false);
      expect(ruleMatches(wildcard, buildCall("read_file", { [key]: "demo-channel" }))).toBe(true);
      expect(ruleMatches(literal, buildCall("read_file", { [key]: "demo-channel" }))).toBe(true);
      expect(ruleMatches(literal, buildCall("read_file", { [key]: "elsewhere" }))).toBe(false);
    },
  );

  // A matcher comparing with `==` accepts the first, second and fourth pair.
  const coercionCases: Array<[string | number | boolean, unknown]> = [
    [1, "1"], ["1", 1], [true, "true"], [true, 1], ["false", false],
  ];

  it.each(coercionCases)("never coerces the declared value %s into the call's", (declared, carried) => {
    const valueRule: PolicyRule = {
      id: "value-check", tool: "read_file", decision: "allow", reason: "exactly one value is declared",
      arguments: { scope: declared },
    };
    expect(ruleMatches(valueRule, buildCall("read_file", { scope: carried }))).toBe(false);
  });

  it("requires every listed key, and constrains nothing when the record is empty", () => {
    const paired: PolicyRule = {
      id: "paired", tool: "send_message", decision: "allow", reason: "both arguments have to hold",
      arguments: { a: 1, b: "x" },
    };
    const empty: PolicyRule = {
      id: "empty-arguments", tool: "read_file", decision: "allow", reason: "an empty record constrains nothing",
      arguments: {},
    };
    expect(ruleMatches(paired, buildCall("send_message", { a: 1, b: "x", c: 9 }))).toBe(true);
    expect(ruleMatches(paired, buildCall("send_message", { a: 1 }))).toBe(false);
    expect(ruleMatches(paired, buildCall("send_message", { a: 1, b: "y" }))).toBe(false);
    expect(ruleMatches(empty, buildCall("read_file"))).toBe(true);
    expect(ruleMatches(empty, buildCall("read_file", { anything: "demo-channel" }))).toBe(true);
    expect(ruleMatches(empty, buildCall("send_message"))).toBe(false);
  });
});

describe("matchRule: declaration order, identity and null", () => {
  it("returns the first of two matching tool-only rules, as the object the policy holds", () => {
    const denyFirst: PolicyRule = {
      id: "deny-first", tool: "read_file", decision: "deny", reason: "the first rule refuses reading",
    };
    const policy = buildPolicy(denyFirst, readRule);
    const decided = matchRule(policy, buildCall("read_file"));
    // Identity, not equality: a walk returning the last match, or a copy of the
    // rule it settled on, fails here. A caller reads the rule and leaves it alone.
    expect(decided).toBe(policy.rules[0]);
    expect(decided?.id).toBe("deny-first");
    expect(decided?.decision).toBe("deny");
  });

  it("returns the first of two matching argument-constrained rules", () => {
    const anyScopeFirst: PolicyRule = {
      id: "any-scope-first", tool: "read_file", decision: "deny", reason: "the first rule refuses every scope",
      arguments: { scope: "*" },
    };
    const policy = buildPolicy(anyScopeFirst, scopedRule);
    // A walk preferring the more specific rule would answer with the allow rule.
    const decided = matchRule(policy, buildCall("read_file", { scope: "workspace" }));
    expect(decided).toBe(policy.rules[0]);
    expect(decided?.decision).toBe("deny");
  });

  it("skips a first rule that does not apply and returns the rule that does", () => {
    const byTool = buildPolicy(scopedRule, sendRule);
    const byArguments = buildPolicy(scopedRule, readRule);
    // Each first rule names another tool, or names the call's tool while holding a
    // value the call does not, so the second rule answers each walk.
    expect(matchRule(byTool, buildCall("send_message"))).toBe(byTool.rules[1]);
    expect(matchRule(byTool, buildCall("send_message"))?.decision).toBe("needs_approval");
    expect(matchRule(byArguments, buildCall("read_file", { scope: "outside" }))).toBe(byArguments.rules[1]);
    expect(matchRule(byArguments, buildCall("read_file", { scope: "outside" }))?.id).toBe("read");
  });

  it("returns null, never undefined, for a call no rule applies to", () => {
    const policy = buildPolicy(scopedRule, sendRule);
    // An unlisted tool, a listed tool whose declared key holds another value, a
    // listed tool whose declared key the call does not carry, and a policy that
    // names no rule at all.
    expect(matchRule(policy, buildCall("write_file"))).toBeNull();
    expect(matchRule(policy, buildCall("read_file", { scope: "outside" }))).toBeNull();
    expect(matchRule(policy, buildCall("read_file"))).toBeNull();
    expect(matchRule(buildPolicy(), buildCall("read_file"))).toBeNull();
  });
});

describe("refusals: input the matcher cannot read is refused, never raised on", () => {
  const unusablePolicies: Array<[string, unknown]> = [
    ["a string", "nope"],
    ["null", null],
    ["an array", []],
    ["an object with no rules member", { version: "1.0.0" }],
    ["an object whose rules member is a string", { version: "1.0.0", rules: "nope" }],
    ["an object whose rules member is null", { version: "1.0.0", rules: null }],
    ["an object whose rules member is an object", { version: "1.0.0", rules: {} }],
  ];

  it.each(unusablePolicies)("answers null without throwing when the policy is %s", (_label, candidate) => {
    const policy = asPolicy(candidate);
    expect(() => matchRule(policy, buildCall("read_file"))).not.toThrow();
    expect(matchRule(policy, buildCall("read_file"))).toBeNull();
  });

  it("skips entries that are not rules, and answers null when every entry is one", () => {
    // A walk reading rules[index] without narrowing its possibly-absent member
    // raises on these entries rather than skipping them.
    const mixed = asPolicy({ version: "1.0.0", rules: [null, undefined, "read_file", [], 7, readRule] });
    const garbageOnly = asPolicy({ version: "1.0.0", rules: [null, undefined, "read_file", []] });
    expect(matchRule(mixed, buildCall("read_file"))).toBe(readRule);
    expect(() => matchRule(garbageOnly, buildCall("read_file"))).not.toThrow();
    expect(matchRule(garbageOnly, buildCall("read_file"))).toBeNull();
  });

  const notRules: Array<[string, unknown]> = [
    ["null", null], ["undefined", undefined], ["a string", "read_file"], ["a number", 7], ["an array", []],
  ];

  it.each(notRules)("ruleMatches answers false for a rule that is %s", (_label, candidate) => {
    const rule = asRule(candidate);
    expect(() => ruleMatches(rule, buildCall("read_file"))).not.toThrow();
    expect(ruleMatches(rule, buildCall("read_file"))).toBe(false);
  });

  // A tool that is not a string is refused on either side, and the tool wildcard
  // widens nothing: the guard answers before a name is compared. Dropping it turns
  // every row below but the first into a match — the pairing row shares its own
  // garbage between rule and call, and the three after it apply a `"*"` rule to a
  // tool it cannot read — while a non-string tool against a readable name is refused
  // by the name comparison as well. `buildCall` types its tool as a string, so the
  // unreadable ones arrive through `asCall`, as an untyped caller hands them over.
  const unreadableTools: Array<[string, PolicyRule, RuleMatchTarget, boolean]> = [
    ["refuses a rule whose tool is a number", asRule({ ...readRule, tool: 7 }), buildCall("read_file"), false],
    ["refuses a rule and a call whose tools are the same non-string", asRule({ ...readRule, tool: 7 }), asCall({ tool: 7, arguments: {} }), false],
    ["refuses the tool wildcard against a call whose tool is a number", anyToolRule, asCall({ tool: 7, arguments: {} }), false],
    ["refuses the tool wildcard against a call whose tool is null", anyToolRule, asCall({ tool: null, arguments: {} }), false],
    ["refuses the tool wildcard against a call carrying no tool at all", anyToolRule, asCall({ arguments: {} }), false],
  ];

  it.each(unreadableTools)("%s", (_label, rule, call, expected) => {
    expect(() => ruleMatches(rule, call)).not.toThrow();
    expect(ruleMatches(rule, call)).toBe(expected);
  });

  const notRecords: Array<[string, unknown]> = [
    ["null", null], ["a string", "report.txt"], ["an array", ["path"]], ["a number", 42],
  ];

  // A rule whose constraints cannot be read is a refusal, so neither a call
  // carrying keys nor an empty one can satisfy it.
  it.each(notRecords)("refuses a rule whose arguments member is %s", (_label, argumentsMember) => {
    const rule = asRule({
      id: "declared", tool: "read_file", decision: "allow", reason: "the rule declares its arguments",
      arguments: argumentsMember,
    });
    expect(() => ruleMatches(rule, buildCall("read_file"))).not.toThrow();
    expect(ruleMatches(rule, buildCall("read_file"))).toBe(false);
    expect(ruleMatches(rule, buildCall("read_file", { path: "report.txt" }))).toBe(false);
  });

  const brokenCalls: Array<[string, unknown]> = [
    ["no arguments member at all", { tool: "read_file" }],
    ["a null arguments member", { tool: "read_file", arguments: null }],
    ["a string arguments member", { tool: "read_file", arguments: "report.txt" }],
    ["an array arguments member", { tool: "read_file", arguments: ["report.txt"] }],
  ];

  it.each(brokenCalls)("keeps the tool match but refuses the key match for a call with %s", (_label, candidate) => {
    const call = asCall(candidate);
    const policy = buildPolicy(readRule, scopedRule);
    expect(() => ruleMatches(readRule, call)).not.toThrow();
    expect(() => ruleMatches(scopedRule, call)).not.toThrow();
    expect(() => matchRule(policy, call)).not.toThrow();
    // A rule listing no constraint never reads the call's arguments member, so a
    // broken one cannot veto it, and the narrowing the walk does before matching
    // is what keeps an absent member from raising.
    expect(ruleMatches(readRule, call)).toBe(true);
    expect(matchRule(policy, call)).toBe(policy.rules[0]);
    // A rule that does list constraints cannot have them satisfied by a member it
    // cannot read, so it refuses.
    expect(ruleMatches(scopedRule, call)).toBe(false);
  });

  // A revoked proxy is a container whose every read raises, and the matcher's own
  // catch is what has to answer for it rather than the raise escaping: `false` for a
  // rule or a call, and the walk's `null` for a policy it cannot read. It is the one
  // shape that gets that far — `isRecord` refuses the containers the tables above
  // hand over, and `Array.isArray` raises for a revoked proxy, so this probe never
  // returns at all — which is why no other case reaches these lines.
  const unreadableContainers: Array<
    [string, () => boolean | PolicyRule | null, boolean | PolicyRule | null]
  > = [
    ["a rule whose every read raises", () => ruleMatches(asRule(revokedProxy()), buildCall("read_file")), false],
    ["a call whose every read raises", () => ruleMatches(readRule, asCall(revokedProxy())), false],
    ["a policy whose every read raises", () => matchRule(asPolicy(revokedProxy()), buildCall("read_file")), null],
    ["a call whose every read raises, walked by matchRule", () => matchRule(buildPolicy(readRule), asCall(revokedProxy())), null],
  ];

  it.each(unreadableContainers)("refuses %s rather than letting the read raise", (_label, run, expected) => {
    expect(run).not.toThrow();
    expect(run()).toBe(expected);
  });
});
