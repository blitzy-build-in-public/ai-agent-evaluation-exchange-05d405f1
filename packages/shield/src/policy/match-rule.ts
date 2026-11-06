/**
 * Matching a rule set against a tool call.
 *
 * A rule set is plain declarative data: this module compares strings and values
 * and decides whether a rule is the one applying to a call. It runs nothing out
 * of the rule set, reads no clock or random source and keeps no state, so one
 * rule set and one call always produce the same answer. {@link ruleMatches}
 * answers for a single rule; {@link matchRule} walks a policy's rules in the
 * author's order and answers with the first rule applying, or with nothing —
 * which is how an unmatched call reaches the caller's own refusal, no default
 * rule and no decision being produced here.
 *
 * The literal `"*"` appears in two positions with two meanings: in a rule's
 * `tool` it matches any tool, and in the value of one of the rule's `arguments`
 * it matches any value the call carries at that key.
 */

import type { Policy, PolicyRule } from "./policy-schema";

/**
 * What a rule is matched against: the tool being called and the arguments that
 * call carries. The engine's own call type extends this shape with the call's
 * identifier, so exactly the two members compared against appear here. Both are
 * required: a call carrying no arguments passes an empty record.
 */
export interface RuleMatchTarget {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * The one wildcard spelling, in a rule's two positions for it — its `tool` and
 * the value of one of its `arguments` — so each use site says which it means.
 */
const TOOL_WILDCARD = "*";
const ANY_VALUE = "*";

/**
 * True for a non-null, non-array object whose own enumerable string keys carry
 * the whole of it — the only container shape a rule, a rule's arguments or a
 * call's arguments may take. An array, and a container whose members live outside
 * its string keys — a Map, a Set, a Date — is refused, because a string-key read
 * of it finds nothing and taking that empty answer at face value would drop the
 * rule's argument constraints and apply it to calls its author never wrote it for.
 */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    Object.prototype.toString.call(candidate) === "[object Object]"
  );
}

/**
 * True when this rule is the one applying to this call.
 *
 * The rule applies when its tool is the call's tool or the literal `"*"`, and
 * then — when the rule lists argument constraints — when every key it lists is
 * present on the call's own arguments and holds what the rule declares for it.
 * An argument value of `"*"` accepts any value the call carries at that key,
 * `null`, `undefined` and a nested object included. Every other value must equal
 * the call's value strictly, so `1` never matches `"1"`, and a declared string,
 * number or boolean never equals a call value of `null`, `undefined`, an object
 * or an array. Presence is own-key presence, so a rule key naming `toString` or
 * `constructor` counts only when the call itself carries it. Arguments the rule
 * does not list are ignored, and a rule listing no constraints is decided by its
 * tool alone.
 *
 * It refuses instead of raising: `false` for a rule, a tool, a call or an
 * `arguments` member it cannot read — a rule that is not a usable object, a tool
 * that is not a string, and an `arguments` member present but not a usable record
 * or not readable while the rule lists constrained keys. A member that cannot be
 * read is a refusal, never a match.
 */
export function ruleMatches(rule: PolicyRule, call: RuleMatchTarget): boolean {
  try {
    // Read every member through an `unknown` view. The parameter types say what
    // a validated rule and a well-shaped call look like; these reads are what
    // keep the function safe for a caller handing it something else.
    const candidate: unknown = rule;
    const target: unknown = call;
    if (!isRecord(candidate) || !isRecord(target)) {
      return false;
    }

    const ruleTool: unknown = candidate.tool;
    const callTool: unknown = target.tool;
    if (typeof ruleTool !== "string" || typeof callTool !== "string") {
      return false;
    }

    if (ruleTool !== TOOL_WILDCARD && ruleTool !== callTool) {
      return false;
    }

    if (!Object.prototype.hasOwnProperty.call(candidate, "arguments")) {
      return true;
    }

    const declared: unknown = candidate.arguments;
    if (!isRecord(declared)) {
      return false;
    }

    const constrainedKeys = Object.keys(declared);
    if (constrainedKeys.length === 0) {
      return true;
    }

    // The rule constrains arguments the call cannot supply, so nothing satisfies it.
    const rawCallArguments: unknown = target.arguments;
    if (!isRecord(rawCallArguments)) {
      return false;
    }

    for (const key of constrainedKeys) {
      if (!Object.prototype.hasOwnProperty.call(rawCallArguments, key)) {
        return false;
      }

      const declaredValue: unknown = declared[key];
      if (declaredValue === ANY_VALUE) {
        continue;
      }

      if (declaredValue !== rawCallArguments[key]) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * The first rule of `policy`, in the policy's own order, that applies to `call`,
 * or `null` when none does.
 *
 * Order is the whole of the precedence: the rules are walked from the first, the
 * first match comes back, and no later rule is consulted for a better or more
 * specific one. The matching rule comes back unchanged, and a caller reads it and
 * leaves it alone.
 *
 * It refuses instead of raising: `null` for a policy that is not a usable object
 * or whose `rules` is not an array, and for an entry that is not a usable rule,
 * which the walk skips before carrying on. `null` also means the caller must
 * settle what an unmatched call becomes.
 */
export function matchRule(policy: Policy, call: RuleMatchTarget): PolicyRule | null {
  try {
    const container: unknown = policy;
    // A policy that is not a container this module can walk is refused whole.
    if (!isRecord(container) || !Array.isArray(container.rules)) {
      return null;
    }

    const rules = policy.rules;
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];
      if (rule !== undefined && ruleMatches(rule, call)) {
        return rule;
      }
    }

    return null;
  } catch {
    return null;
  }
}
