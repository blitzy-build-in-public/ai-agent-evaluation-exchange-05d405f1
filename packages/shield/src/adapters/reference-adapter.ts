/**
 * A worked mapping from an adopting application's own shapes into Shield's.
 *
 * An adopter already holds a tool call and a rule set in a shape of its own, while Shield decides
 * about a {@link ToolCall} under a `Policy`. This module is the seam between the two:
 * {@link toToolCall} copies a generic call into the shape the engine decides on, and
 * {@link toPolicy} copies a generic rule set into Shield's target format, which
 * `docs/shield/POLICY-FORMAT.md` describes. It is a worked example rather than a convenience,
 * because this package has no dependency at all and ships to callers outside this repository: an
 * adopter reads this file and writes the same few lines for its own shape.
 *
 * Every branch copies; nothing here executes. No part of a call or a policy is run, no clock, file,
 * environment variable or random source is read, and no state is kept, so the same input always maps
 * to the same output and a caller's own objects are neither handed on nor changed.
 *
 * Neither function validates, and neither throws. `evaluate` is the single fail-closed checkpoint and
 * the policy validator is what refuses an unreadable policy, so a value contradicting the declared
 * shape is mapped here into a form that validation fails rather than into one that permits: an empty
 * required member, a rule whose stated constraints could not be read and a rule whose effect is not
 * one of the host's three are each refused with the reason `"malformed"`, never repaired into a rule
 * its author did not write, and an unrecognised effect never becomes an `allow`. An empty rule list
 * is the one readable shape that stays valid, and it can only deny more, because a policy naming no
 * rule matches no call.
 *
 * Shield decides about the call it is handed and enforces nothing by itself: an `allow` is a
 * statement about that call under that policy, not a property of the application that runs it.
 */

import type { ToolCall } from "../evaluate";
import type { Decision, Policy, PolicyRule } from "../policy/policy-schema";

/**
 * A tool call in the adopting application's own vocabulary — the shape this example maps *from*.
 *
 * It is deliberately not Shield's type: an adopter's call is named the way its own host names one,
 * and the mapping in {@link toToolCall} is the whole of the translation.
 */
export interface GenericToolCall {
  /** The host's identifier for this call, unique per call. */
  callId: string;
  /** The name of the tool being called, as the host spells it. */
  name: string;
  /** The arguments the host recorded for the call. */
  input: Record<string, unknown>;
}

/**
 * One rule of a policy in the adopting application's own vocabulary — the shape this example maps
 * *from*.
 *
 * The three effects are the host's words for what a matched rule does, and they are not Shield's
 * three decisions: {@link toPolicy} is what turns an `"ask"` into a `"needs_approval"`.
 */
export interface GenericPolicyRule {
  /** The host's identifier for this rule, unique within its policy. */
  id: string;
  /** The name of the tool this rule applies to, as the host spells it. */
  name: string;
  /** What the host wants done when this rule applies. */
  effect: "allow" | "deny" | "ask";
  /** The host's own explanation for the rule, which becomes the decision's reason. */
  message: string;
  /** The host's constraints on the call's arguments, when it states any. */
  arguments?: Record<string, string | number | boolean | "*">;
}

/**
 * A policy in the adopting application's own vocabulary — the shape this example maps *from*.
 *
 * Rules are mapped in the order the host wrote them, because the first matching rule is the one that
 * decides and therefore the order carries meaning.
 */
export interface GenericPolicy {
  /** The host's version label for this policy. */
  version: string;
  /** The host's rules, in the host's own order. */
  rules: GenericPolicyRule[];
}

/**
 * The host's three effects and the decision each one stands for, in Shield's own vocabulary.
 *
 * The host's vocabulary is closed to these three, so this table is the whole of the effect mapping:
 * no other spelling of an effect reaches a decision, in either direction.
 */
const DECISIONS_BY_EFFECT: Readonly<Record<string, Decision>> = {
  allow: "allow",
  deny: "deny",
  ask: "needs_approval",
};

/**
 * True for a non-null, non-array object whose own enumerable string keys carry the whole of it — the
 * only container shape an argument record may take.
 *
 * An array is refused because it would satisfy every object check while behaving unlike one, and a
 * container whose members live outside its string keys — a `Map`, a `Set`, a `Date` — is refused
 * because a string-key read of it finds nothing: taken at face value, that empty answer would look
 * like an argument record the call never carried. A refused container becomes an empty record, which
 * can only make an argument-constrained rule fail to match.
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
 * Copies a container's own enumerable string-keyed members into a fresh record.
 *
 * Nothing of the caller's container travels on: the copy is a new object, so a caller that reuses or
 * mutates its own call or policy afterwards cannot change what Shield read. Each member is added as a
 * defined property rather than by assignment, because only JSON text produces an own `__proto__` key
 * and assigning that key would reach the inherited setter and set this copy's prototype instead of
 * adding the member — losing the very entry being copied.
 */
function copyOwnMembers(source: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    Object.defineProperty(copy, key, {
      value: source[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return copy;
}

/**
 * The call a value that could not be read maps to.
 *
 * Both members the engine requires are empty, which makes the call one the engine refuses as
 * `"malformed"` before any rule is matched and before any approval is consulted. An empty id can
 * therefore never reach the approval checkpoint, so it cannot collect an approval recorded for
 * another call — which is the whole reason no readable member is ever replaced by a placeholder.
 */
function refusedCall(): ToolCall {
  return { id: "", tool: "", arguments: {} };
}

/**
 * The policy a value that could not be read maps to.
 *
 * The empty version label is a validation failure in the policy schema, so this policy is refused as
 * `"malformed"` rather than read as a rule set that permits nothing in particular.
 */
function refusedPolicy(): Policy {
  return { version: "", rules: [] };
}

/**
 * Reads a required string member of the generic policy shape.
 *
 * Returns the member when it is a string and `""` otherwise. An empty required member is a validation
 * failure, so a value contradicting its declared type is refused as `"malformed"` rather than
 * silently repaired into something readable. A call's own identity is deliberately not put through
 * this: {@link toToolCall} passes what the host stated on unchanged, because `evaluate` reads the call
 * itself and is the one place that refuses a call it cannot read.
 */
function readRequiredString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads a rule's effect as a decision, or answers `undefined` for an effect that is not one of the
 * host's three.
 *
 * Nothing is guessed at. The host's vocabulary is closed to `"allow"`, `"deny"` and `"ask"`, so an
 * effect outside it — a misspelling, a value of some other type, or the target decision vocabulary
 * written where the host's own word belongs — answers `undefined` rather than being mapped to a
 * decision of this module's choosing. The caller renders such a rule invalid, which is the refusal
 * direction: the policy is refused as a whole instead of a rule being repaired into one the host
 * never wrote, and no unrecognised effect can become an `allow` on the way.
 */
function readDecision(effect: unknown): Decision | undefined {
  return typeof effect === "string" ? DECISIONS_BY_EFFECT[effect] : undefined;
}

/**
 * Reads a generic rule's argument constraints.
 *
 * Three answers, and they differ on purpose. A fresh record of the constraints when the rule states
 * them; `undefined` when the rule carries no `arguments` own key at all, so the mapped rule omits the
 * member exactly as a policy parsed from JSON holds it; and `null` when the member is there but could
 * not be read — not a plain object, holding a member that is none of a string, a number and a
 * boolean, or naming a member the validated record cannot hold as its own key.
 *
 * `null` is deliberately not the same answer as `undefined`, because a constraint that could not be
 * read must not be dropped: dropping it would widen the rule, turning a rule constrained to one
 * argument value into a rule for the whole tool. The caller renders such a rule invalid instead.
 */
function readArgumentConstraints(
  rule: Record<string, unknown>,
): Record<string, string | number | boolean | "*"> | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(rule, "arguments")) {
    return undefined;
  }

  const declared: unknown = rule.arguments;
  if (!isRecord(declared)) {
    return null;
  }

  const constraints: Record<string, string | number | boolean | "*"> = {};

  for (const key of Object.keys(declared)) {
    // A constraint list is normalised again when the policy is validated, by assigning each member
    // onto a fresh record, and that assignment of this one key would reach the inherited setter and
    // set a prototype instead of a member: the constraint would be dropped in silence and the rule
    // would then apply to more calls than its author wrote it for. The rule is rendered invalid.
    if (key === "__proto__") {
      return null;
    }

    const value: unknown = declared[key];

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      Object.defineProperty(constraints, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      return null;
    }
  }

  return constraints;
}

/**
 * Maps one generic rule into Shield's rule shape.
 *
 * A rule entry that is not a plain object maps to a rule invalid on three required members whose
 * decision is a refusal — never an allow — so the policy as a whole is refused. A rule whose effect
 * is not one of the host's three, and a rule whose constraints could not be read, are both rendered
 * invalid through an empty required member rather than applied: the effect is never turned into a
 * decision this mapping picked, and the constraints are never dropped, because dropping them would
 * widen the rule. The decision such a rule carries is left as it stands rather than rewritten,
 * because an invalid rule decides nothing — the whole policy is refused before any rule applies.
 */
function toPolicyRule(rawRule: unknown): PolicyRule {
  if (!isRecord(rawRule)) {
    return { id: "", tool: "", decision: "deny", reason: "" };
  }

  const id = readRequiredString(rawRule.id);
  const tool = readRequiredString(rawRule.name);
  const reason = readRequiredString(rawRule.message);
  const decision = readDecision(rawRule.effect);
  const constraints = readArgumentConstraints(rawRule);

  if (decision === undefined) {
    return { id: "", tool, decision: "deny", reason };
  }

  if (constraints === null) {
    return { id: "", tool, decision, reason };
  }

  if (constraints === undefined) {
    return { id, tool, decision, reason };
  }

  return { id, tool, decision, reason, arguments: constraints };
}

/**
 * Maps a generic tool call into the shape Shield decides on.
 *
 * Returns a fresh {@link ToolCall} carrying the call's own identity: `callId` becomes the call's `id`,
 * `name` becomes its tool and `input` is copied into its arguments. The caller's object is never
 * returned and never changed, and no member is defaulted or coerced — the id and the tool the host
 * stated travel on exactly as they were, however malformed, because `evaluate` is the one place that
 * refuses a call it cannot read, answering `deny` with reason `"malformed"`.
 *
 * What it refuses: nothing — it validates nothing. An `input` that is absent, `null`, an array or any
 * other value that is not a plain object becomes an empty argument record, so a call whose arguments
 * could not be read cannot gain arguments it never carried; that can only make an
 * argument-constrained rule fail to match, and the engine then refuses the call as unmatched. A call
 * whose own members cannot be read at all becomes the call the engine refuses outright.
 *
 * The id must be unique per call, because an approval is recorded against that id alone: a host that
 * reuses one id for a second call lets the first call's approval cover both.
 *
 * @param call The host's own call shape, or any other value, which becomes a refused call.
 * @returns A fresh call in Shield's shape.
 */
export function toToolCall(call: GenericToolCall): ToolCall {
  try {
    const candidate: unknown = call;

    if (!isRecord(candidate)) {
      return refusedCall();
    }

    return {
      id: call.callId,
      tool: call.name,
      arguments: isRecord(call.input) ? copyOwnMembers(call.input) : {},
    };
  } catch {
    // A call whose members cannot be read — a revoked proxy, a member whose accessor throws — becomes
    // the call the engine refuses rather than an exception, because this mapping must answer for
    // every input. No permissive value is substituted for the member that could not be read.
    return refusedCall();
  }
}

/**
 * Maps a generic policy into Shield's target format.
 *
 * Returns a fresh `Policy`: `version` travels on, and each rule's `id` travels on while `name`
 * becomes the rule's `tool`, `message` becomes its `reason`, `effect` becomes its `decision`
 * (`"ask"` becoming `"needs_approval"`) and `arguments` is copied as the rule's own constraints,
 * present only when the generic rule stated them. The host's own policy, its rule array and its rules
 * are never returned or changed, so a later edit to any of them cannot alter the policy Shield
 * validated, and the host's rule order is the mapped order, because the first matching rule decides.
 *
 * What it refuses: nothing directly — and it validates nothing. A value contradicting the declared
 * shape is mapped into a form the policy validator fails, so the engine refuses the policy with
 * reason `"malformed"` rather than finding in it a rule this mapping invented; the one readable
 * shape that stays valid is a `rules` member that is not an array, which maps to an empty rule list
 * and can only deny more, since a policy naming no rule matches no call.
 *
 * @param policy The host's own policy shape, or any other value, which becomes a refused policy.
 * @returns A fresh policy in Shield's format, as `docs/shield/POLICY-FORMAT.md` describes it.
 */
export function toPolicy(policy: GenericPolicy): Policy {
  try {
    const candidate: unknown = policy;

    if (!isRecord(candidate)) {
      return refusedPolicy();
    }

    const version = readRequiredString(policy.version);
    const rawRules: unknown = policy.rules;
    const rules: PolicyRule[] = [];

    if (Array.isArray(rawRules)) {
      const entries: unknown[] = rawRules;

      for (const rawRule of entries) {
        rules.push(toPolicyRule(rawRule));
      }
    }

    return { version, rules };
  } catch {
    // A policy whose members cannot be read — a revoked proxy, a `version` or `rules` accessor that
    // throws — becomes the policy the validator refuses rather than an exception, for the same reason
    // as above: nothing permissive is substituted for what could not be read.
    return refusedPolicy();
  }
}
