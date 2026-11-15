/**
 * Validation of a Shield policy document.
 *
 * A policy is read and checked as plain data: nothing here executes or evaluates
 * any part of it, and the module has no imports at all. Every failure is
 * reported as a value — the validator never throws — and an input it cannot read
 * is refused rather than accepted, so a policy that cannot be checked never
 * reaches the engine.
 */

/** The three outcomes a Shield decision can carry. */
export type Decision = "allow" | "deny" | "needs_approval";

/** A single rule of a policy. */
export interface PolicyRule {
  /** Identifies the rule within its policy; unique across the policy. */
  id: string;
  /** A tool name, or "*" to match any tool. */
  tool: string;
  /** What the engine answers when this rule matches. */
  decision: Decision;
  /** The policy author's own explanation, carried into the decision record. */
  reason: string;
  /** Argument constraints: each name maps to one accepted value, or "*" for any. */
  arguments?: Record<string, string | number | boolean | "*">;
}

/** A policy document that has passed validation. */
export interface Policy {
  /** The policy author's version label. */
  version: string;
  /** The policy's rules, in the author's order. */
  rules: PolicyRule[];
}

/** The outcome of {@link validatePolicy}. */
export type PolicyValidationResult =
  | { ok: true; policy: Policy }
  | { ok: false; error: string };

/** The only keys a policy document may carry. */
const POLICY_KEYS = new Set(["version", "rules"]);

/** The only keys a rule may carry. */
const RULE_KEYS = new Set(["id", "tool", "decision", "reason", "arguments"]);

/**
 * The one argument key a validated record can never hold.
 *
 * `Object.keys` on a record parsed from JSON does yield an own `"__proto__"` key, so it passes the
 * empty-key check — but assigning that key onto an ordinary record reaches `Object.prototype`'s
 * inherited accessor instead of adding a member, so the constraint would be gone while the rule was
 * still accepted, and the rule would then match every call naming its tool. JSON text is the only
 * input that can produce the key and a JSON policy is the primary input path, so the key is refused
 * rather than kept: an author's constraint is never dropped in silence.
 */
const RESERVED_ARGUMENT_KEY = "__proto__";

/**
 * True for a non-null, non-array object whose own enumerable string keys carry
 * the whole of it — the only container shape a policy, a rule or an argument
 * record may take. Arrays are excluded because an array would satisfy every
 * object check while behaving unlike one, and a Map, a Set or a Date is excluded
 * because its members live outside its string keys: read as a record the
 * container would look empty, so it is refused rather than silently reduced to
 * nothing.
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
 * Validate a candidate against the policy shape.
 *
 * Returns `{ ok: true, policy }` when the candidate is a policy, where `policy`
 * is a freshly built copy holding exactly the validated fields. The caller's own
 * objects are never returned, so a later mutation of the input cannot change a
 * validated policy, and a rule carries an `arguments` member only when it
 * supplied one.
 *
 * Returns `{ ok: false, error }` — with a short, lower-case message naming the
 * place to fix — for every refusal: a candidate, a rule or an argument record
 * that is not a non-null, non-array object whose own enumerable string keys are
 * the whole of it, which refuses `null`, a primitive, a function and an array
 * alongside a `Map`, a `Set` and a `Date`; an unrecognised key at the policy
 * level or at the rule level; a version that is missing, not a string or empty;
 * `rules` that is missing or not an array (an empty array is valid, because
 * refusing to name any rule can only deny more); a rule entry that is not a
 * non-null, non-array object; a rule `id`, `tool` or `reason` that is missing,
 * not a string or empty; a `decision` outside `"allow"`, `"deny"` and
 * `"needs_approval"`; a rule id already used earlier in the policy; and an
 * `arguments` record that holds an empty key, that holds the reserved key
 * `"__proto__"` — which a record cannot carry as an own member, so keeping it
 * would drop the author's constraint in silence — or that holds a value that is
 * neither a string, a finite number, a boolean nor `"*"`.
 *
 * It never throws: a candidate whose members cannot be read without raising is
 * refused with `policy: the candidate could not be read`, and no message carries
 * any text the candidate supplied — not an unrecognised key name, not a rule id,
 * not an argument value — so a caller logging a refusal spreads none of the
 * document it was handed.
 */
export function validatePolicy(candidate: unknown): PolicyValidationResult {
  try {
    if (!isRecord(candidate)) {
      return { ok: false, error: "policy: expected an object" };
    }

    for (const key of Object.keys(candidate)) {
      if (!POLICY_KEYS.has(key)) {
        return { ok: false, error: "policy: unrecognised key" };
      }
    }

    const version = candidate.version;
    if (typeof version !== "string" || version === "") {
      return { ok: false, error: "policy: missing or empty version" };
    }

    const rawRules = candidate.rules;
    if (!Array.isArray(rawRules)) {
      return { ok: false, error: "rules: not an array" };
    }

    const rules: PolicyRule[] = [];
    const acceptedIds = new Set<string>();

    for (let index = 0; index < rawRules.length; index += 1) {
      const rawRule: unknown = rawRules[index];

      if (!isRecord(rawRule)) {
        return { ok: false, error: `rules[${index}]: expected an object` };
      }

      for (const ruleKey of Object.keys(rawRule)) {
        if (!RULE_KEYS.has(ruleKey)) {
          return { ok: false, error: `rules[${index}]: unrecognised key` };
        }
      }

      const id = rawRule.id;
      if (typeof id !== "string" || id === "") {
        return { ok: false, error: `rules[${index}]: missing or empty id` };
      }
      if (acceptedIds.has(id)) {
        return { ok: false, error: `rules[${index}]: duplicate rule id` };
      }

      const tool = rawRule.tool;
      if (typeof tool !== "string" || tool === "") {
        return { ok: false, error: `rules[${index}]: missing or empty tool` };
      }

      const decision = rawRule.decision;
      if (decision !== "allow" && decision !== "deny" && decision !== "needs_approval") {
        return { ok: false, error: `rules[${index}]: unknown decision` };
      }

      const reason = rawRule.reason;
      if (typeof reason !== "string" || reason === "") {
        return { ok: false, error: `rules[${index}]: missing or empty reason` };
      }

      // Only an own key counts as the rule's `arguments`, matching the own-key
      // reads at the policy and rule levels; a policy parsed from JSON always
      // carries it as one.
      if (!Object.prototype.hasOwnProperty.call(rawRule, "arguments")) {
        rules.push({ id, tool, decision, reason });
        acceptedIds.add(id);
        continue;
      }

      const rawArguments = rawRule.arguments;
      if (!isRecord(rawArguments)) {
        return { ok: false, error: `rules[${index}].arguments: expected an object` };
      }

      const accepted: Record<string, string | number | boolean | "*"> = {};
      for (const argumentKey of Object.keys(rawArguments)) {
        // An empty key names nothing, and the reserved key could never become an own member of this
        // record; either one would leave the author's constraint out of the policy returned as
        // valid, so the two are refused with the same message.
        if (argumentKey === "" || argumentKey === RESERVED_ARGUMENT_KEY) {
          return { ok: false, error: `rules[${index}].arguments: invalid argument key` };
        }

        const argumentValue = rawArguments[argumentKey];
        if (typeof argumentValue === "string" || typeof argumentValue === "boolean") {
          accepted[argumentKey] = argumentValue;
        } else if (typeof argumentValue === "number" && Number.isFinite(argumentValue)) {
          accepted[argumentKey] = argumentValue;
        } else {
          return { ok: false, error: `rules[${index}].arguments: invalid argument value` };
        }
      }

      rules.push({ id, tool, decision, reason, arguments: accepted });
      acceptedIds.add(id);
    }

    return { ok: true, policy: { version, rules } };
  } catch {
    return { ok: false, error: "policy: the candidate could not be read" };
  }
}

/**
 * Read a policy's version label, for the audit trail.
 *
 * Returns the candidate's own `version` when it is a non-empty string and `""`
 * otherwise. It is deliberately not a second validator: it reports the version
 * of an otherwise invalid policy (so an audit record can name the policy that
 * failed), answers `""` for a candidate that is not an object or whose version
 * is missing, not a string or empty, and never inspects `rules`, never reports
 * an error and never throws.
 */
export function readPolicyVersion(candidate: unknown): string {
  try {
    if (!isRecord(candidate)) {
      return "";
    }

    const version = candidate.version;
    return typeof version === "string" && version !== "" ? version : "";
  } catch {
    return "";
  }
}
