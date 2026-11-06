/**
 * Unit suite for the worked example policy — the fictional policy document in
 * `./example-policy.ts` that the Shield suites and a reader of the policy format
 * both work from. What it guards is the example's own usefulness: the policy
 * validates as a whole, its rules cover all three decisions, it leaves one
 * fictional tool named by no rule so the engine's default deny is demonstrated
 * rather than assumed, no rule allows the whole tool wildcard, each rule is
 * reachable from a call built out of its own declared fields, and its wording
 * stays clean for the exclusion scan that reads every tracked file.
 *
 * Five edits are worth naming with the assertion that reports each of them:
 * deleting the tool wildcard rule fails the wildcard assertion, and the deny the
 * ordering test reads along with it; turning that rule into an `allow` fails the
 * catch-all assertion, and that same deny; naming the unmatched tool in any rule
 * fails the unmatched-tool assertion, and the null the engine refuses on; dropping
 * the `"*"`-valued argument key from a rule fails the argument-value-wildcard
 * assertion, since that key is the example's only wildcard argument; and an
 * address- or telephone-shaped `reason` fails the scan-cleanliness assertion.
 * Nothing here presents the example, Shield or a written policy as a gate pass, a
 * certification or a guarantee about a call.
 */

import { describe, it, expect } from "vitest";
import { examplePolicy } from "./example-policy";
import { validatePolicy } from "./policy-schema";
import { matchRule } from "./match-rule";
import type { PolicyRule } from "./policy-schema";
import type { RuleMatchTarget } from "./match-rule";

/** The one wildcard spelling, in a rule's `tool` and in the value of its `arguments`. */
const WILDCARD = "*";

/** The three decisions a rule may carry, in the validator's own spelling. */
const DECISIONS: Array<PolicyRule["decision"]> = ["allow", "deny", "needs_approval"];

/** A fictional tool no rule of the example names, so a call against it matches nothing. */
const UNMATCHED_TOOL = "http_request";

/** A fictional value standing in for a wildcard argument, which accepts any value. */
const ANY_TARGET = "example-target";

/** Read a rule by index, narrowing a possibly-absent member without a `!`. */
function ruleAt(rules: readonly PolicyRule[], index: number): PolicyRule {
  const rule = rules[index];
  if (rule === undefined) {
    throw new Error(`the worked example must declare a rule at index ${index}`);
  }
  return rule;
}

/**
 * A call carrying exactly the arguments its rule declares, so that rule applies.
 * The rule's own `tool` names the call's tool; the tool wildcard needs a concrete
 * one instead, and a declared `"*"` argument accepts any value, so a fictional
 * stand-in is supplied for each.
 */
function callForRule(rule: PolicyRule): RuleMatchTarget {
  const args: Record<string, unknown> = {};
  const declared = rule.arguments;

  if (declared !== undefined) {
    for (const key of Object.keys(declared)) {
      const declaredValue = declared[key];
      // The validator refuses a rule whose argument value is absent, so a valid
      // policy never reaches this branch.
      if (declaredValue === undefined) {
        continue;
      }
      args[key] = declaredValue === WILDCARD ? ANY_TARGET : declaredValue;
    }
  }

  return { tool: rule.tool === WILDCARD ? UNMATCHED_TOOL : rule.tool, arguments: args };
}

describe("example-policy: the worked policy validates", () => {
  it("passes the policy validator, keeping its own version label and the author's rule order", () => {
    const result = validatePolicy(examplePolicy);

    // The union is narrowed here rather than read past, so the reads below are of
    // the validator's own accepted policy.
    if (!result.ok) {
      throw new Error(`the worked example policy must validate: ${result.error}`);
    }

    // The version is read from the policy, never compared against a literal.
    expect(examplePolicy.version.length).toBeGreaterThan(0);
    expect(result.policy.version).toBe(examplePolicy.version);
    expect(result.policy.rules.map((rule) => rule.id)).toEqual(examplePolicy.rules.map((rule) => rule.id));
  });

  it("gives every rule a non-empty id, tool and reason, a decision the validator accepts, and an id of its own", () => {
    const acceptedIds = new Set<string>();
    for (let index = 0; index < examplePolicy.rules.length; index += 1) {
      const rule = ruleAt(examplePolicy.rules, index);

      expect(rule.id.length, `rules[${index}] has an empty id`).toBeGreaterThan(0);
      expect(rule.tool.length, `rule ${rule.id} has an empty tool`).toBeGreaterThan(0);
      expect(rule.reason.length, `rule ${rule.id} has an empty reason`).toBeGreaterThan(0);
      expect(DECISIONS, `rule ${rule.id} carries a decision outside the three outcomes`).toContain(rule.decision);
      expect(acceptedIds.has(rule.id), `rule id "${rule.id}" is declared more than once`).toBe(false);

      acceptedIds.add(rule.id);
    }
  });
});

describe("example-policy: the vocabulary a fixture policy needs", () => {
  it("reaches all three decisions, so each of them can be exercised from this policy", () => {
    const decisions = new Set(examplePolicy.rules.map((rule) => rule.decision));

    expect(decisions).toEqual(new Set(DECISIONS));
  });

  it("uses the tool wildcard in at least one rule, so the wildcard path is exercised", () => {
    const usesToolWildcard = examplePolicy.rules.some((rule) => rule.tool === WILDCARD);

    // This assertion is dedicated to the wildcard: with the rule gone the
    // catch-all check below passes for want of a wildcard rule to inspect, and the
    // reachability loop still passes for the rules that remain.
    expect(usesToolWildcard, "no rule uses the tool wildcard").toBe(true);
  });

  it("never allows the whole tool wildcard, so no catch-all allow hides the default deny", () => {
    const catchAllAllows = examplePolicy.rules.filter((rule) => rule.tool === WILDCARD && rule.decision === "allow");

    expect(catchAllAllows).toEqual([]);
  });

  it("uses an argument-value wildcard in at least one rule, so argument matching is exercised both ways", () => {
    const usesArgumentWildcard = examplePolicy.rules.some((rule) => {
      const declared = rule.arguments;
      if (declared === undefined) {
        return false;
      }
      return Object.keys(declared).some((key) => declared[key] === WILDCARD);
    });

    expect(usesArgumentWildcard, "no rule uses the argument-value wildcard").toBe(true);
  });
});

describe("example-policy: the unmatched tool that shows the default deny", () => {
  it("names the unmatched tool in no rule, and matches no rule for it, which is the null the engine refuses on", () => {
    // Naming it in any rule fails the first assertion: the call would then reach a
    // rule and the engine would have something of its own to decide.
    expect(examplePolicy.rules.some((rule) => rule.tool === UNMATCHED_TOOL)).toBe(false);
    expect(matchRule(examplePolicy, { tool: UNMATCHED_TOOL, arguments: {} })).toBeNull();
  });
});

describe("example-policy: every rule is reachable and every declared key is exercised", () => {
  it("matches each rule for a call built from that rule's own fields, and exercises every key it declares", () => {
    const exercisedKeys = new Set<string>();

    for (let index = 0; index < examplePolicy.rules.length; index += 1) {
      const rule = ruleAt(examplePolicy.rules, index);
      const call = callForRule(rule);

      for (const key of Object.keys(call.arguments)) {
        exercisedKeys.add(key);
      }

      // Identity, not equality: the rule that comes back is the very rule of the
      // example, so a shadowed rule, a rule no call reaches or a copied rule
      // fails here rather than passing quietly.
      expect(matchRule(examplePolicy, call), `rule ${rule.id} is not reachable`).toBe(rule);
    }

    const declaredKeys = new Set<string>();
    for (const rule of examplePolicy.rules) {
      for (const key of Object.keys(rule.arguments ?? {})) {
        declaredKeys.add(key);
      }
    }

    // Every key the example declares is carried into a call above, which is what
    // this equality states: a declared key the loop cannot pass — an argument value
    // absent, or a rule the loop skips — leaves the exercised-key set short.
    expect([...exercisedKeys].sort()).toEqual([...declaredKeys].sort());
  });

  it("matches the rule declared first when a high-risk marker is present, ahead of the allow rule for that tool", () => {
    const first = ruleAt(examplePolicy.rules, 0);
    const readFile = examplePolicy.rules.find((rule) => rule.tool === "read_file");

    const highRisk = matchRule(examplePolicy, { tool: "read_file", arguments: { scope: "workspace", risk: "high" } });
    const plainRead = matchRule(examplePolicy, { tool: "read_file", arguments: { scope: "workspace" } });

    // Order is the whole of the precedence: the marked call is answered by the
    // rule declared first, and the same call without the marker reaches the allow
    // rule for that tool further down the list.
    expect(readFile, "the example must declare a rule for read_file").toBeDefined();
    expect(highRisk).toBe(first);
    expect(highRisk?.decision).toBe("deny");
    expect(plainRead).toBe(readFile);
  });

  it("does not match a rule whose declared arguments the call leaves out", () => {
    // The rules constrain arguments, not the tool alone: the same tool carrying
    // none of the declared arguments matches nothing.
    expect(matchRule(examplePolicy, { tool: "read_file", arguments: {} })).toBeNull();
  });
});

describe("example-policy: the example stays clean for the exclusion scan", () => {
  it("keeps every reason free of an address or a telephone shape, so the scan reads this tracked file clean", () => {
    for (let index = 0; index < examplePolicy.rules.length; index += 1) {
      const rule = ruleAt(examplePolicy.rules, index);

      expect(rule.reason, `rule ${rule.id} carries an "@"`).not.toContain("@");
      expect(rule.reason, `rule ${rule.id} carries a run of seven or more digits`).not.toMatch(/\d{7,}/);
    }
  });

  it("borrows none of the engine's own reason strings, which belong to the decision record", () => {
    const engineReasons = new Set(["no_matching_rule", "malformed", "approved"]);
    const borrowed = examplePolicy.rules.filter((rule) => engineReasons.has(rule.reason));

    expect(borrowed).toEqual([]);
  });
});
