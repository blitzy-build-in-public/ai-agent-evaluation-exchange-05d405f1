/**
 * Unit suite for the policy validator.
 *
 * Two properties carry the weight. First, every failure is reported as a value:
 * a primitive, an array, a cyclic object and an accessor that raises when it is
 * read must all come back as a refusal rather than an exception, because a
 * policy that cannot be checked has to be refused and not crash its caller.
 * Second, the refusal is strict, so a policy accepted here is wholly one this
 * validator read: an unrecognised key at either level, a missing or empty
 * required field, a `rules` member that is not an array, a decision outside the
 * three outcomes, a repeated rule id, and an argument that is not a plain scalar
 * are each refused.
 *
 * Malformed candidates are built as `unknown`, which is what the validator takes:
 * none of these shapes needs a cast to be handed to it.
 */

import { describe, it, expect } from "vitest";
import { validatePolicy, readPolicyVersion } from "./policy-schema";
import type { Policy, PolicyRule } from "./policy-schema";

/** Assert a refusal, assert its message explains it, and return that message. */
function expectRefusal(candidate: unknown): string {
  const result = validatePolicy(candidate);
  if (result.ok) {
    throw new Error("expected the validator to refuse this candidate");
  }
  expect(result.error, "a refusal must carry a message").not.toBe("");
  return result.error;
}

/** Assert acceptance and return the policy the validator built. */
function expectValid(candidate: unknown): Policy {
  const result = validatePolicy(candidate);
  if (!result.ok) {
    throw new Error(`expected the validator to accept this candidate: ${result.error}`);
  }
  return result.policy;
}

/** Read a rule by index, narrowing a possibly-absent member without a `!`. */
function ruleAt(collection: readonly PolicyRule[], index: number): PolicyRule {
  const rule = collection[index];
  if (rule === undefined) {
    throw new Error(`expected a rule at index ${index}`);
  }
  return rule;
}

/** One rule, valid apart from the fields the caller overrides. */
function ruleWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "read",
    tool: "read_file",
    decision: "allow",
    reason: "reading is permitted",
    ...overrides,
  };
}

/** A policy holding the given rule entries. */
function policyWithRules(rules: unknown[]): Record<string, unknown> {
  return { version: "1.0.0", rules };
}

/** An object one of whose own members points back at the object itself. */
function selfReferencingObject(): unknown {
  const node: Record<string, unknown> = {};
  node.self = node;
  return node;
}

/** A policy-shaped object whose `rules` array holds itself. */
function policyWhoseRulesContainThemselves(): unknown {
  const rules: unknown[] = [];
  rules.push(rules);
  return { version: "1.0.0", rules };
}

/** A rule whose `arguments` value is the policy that holds it. */
function ruleWhoseArgumentIsItsPolicy(): unknown {
  const policy: Record<string, unknown> = { version: "1.0.0" };
  policy.rules = [ruleWith({ arguments: { policy } })];
  return policy;
}

/** A policy whose enumerable `rules` accessor raises when it is read. */
function policyWithThrowingRulesAccessor(): unknown {
  const target: Record<string, unknown> = { version: "1.0.0" };
  Object.defineProperty(target, "rules", {
    enumerable: true,
    get(): never {
      throw new Error("rules cannot be read");
    },
  });
  return target;
}

/** A policy whose enumerable `version` accessor raises when it is read. */
function policyWithThrowingVersionAccessor(): unknown {
  const target: Record<string, unknown> = { rules: [] };
  Object.defineProperty(target, "version", {
    enumerable: true,
    get(): never {
      throw new Error("version cannot be read");
    },
  });
  return target;
}

/** A `__proto__`-shaped own key, which only JSON text produces. */
function policyWithProtoKey(): unknown {
  return JSON.parse('{"__proto__":{"version":"1.0.0"},"version":"1.0.0","rules":[]}');
}

const hostileInputs: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "a number", value: 7 },
  { label: "a boolean", value: false },
  { label: "a plain string", value: "allow" },
  { label: "a function", value: (): string => "allow" },
  { label: "an array", value: [] },
  { label: "a Map", value: new Map([["version", "1.0.0"]]) },
  { label: "a Date", value: new Date(0) },
  { label: "an object whose only key is a symbol", value: { [Symbol("k")]: 1 } },
  { label: "an object referring to itself", value: selfReferencingObject() },
  { label: "a policy whose rules contain themselves", value: policyWhoseRulesContainThemselves() },
  { label: "a rule whose argument value is its own policy", value: ruleWhoseArgumentIsItsPolicy() },
  { label: "a policy whose rules accessor throws", value: policyWithThrowingRulesAccessor() },
  { label: "a policy whose version accessor throws", value: policyWithThrowingVersionAccessor() },
  { label: "a policy whose __proto__ is an own key", value: policyWithProtoKey() },
  { label: "the JSON text of a policy", value: '{"version":"1.0.0","rules":[]}' },
];

describe("validatePolicy: hostile candidates", () => {
  it("never throws, refuses every one, and leaves the version reader readable", () => {
    for (const { label, value } of hostileInputs) {
      expect(() => validatePolicy(value), `validatePolicy threw for ${label}`).not.toThrow();

      const result = validatePolicy(value);
      expect(result.ok, `validatePolicy accepted ${label}`).toBe(false);
      if (!result.ok) {
        expect(result.error.length, `refusing ${label} carries no message`).toBeGreaterThan(0);
      }

      expect(() => readPolicyVersion(value), `readPolicyVersion threw for ${label}`).not.toThrow();
      expect(typeof readPolicyVersion(value), `readPolicyVersion is not a string for ${label}`).toBe("string");
    }
  });
});

describe("validatePolicy: strictness at the policy level", () => {
  const refused: Array<[string, unknown]> = [
    ["an array instead of an object", []],
    ["null instead of an object", null],
    ["a primitive instead of an object", 42],
    ["an unrecognised key beside version and rules", { version: "1.0.0", rules: [], extra: 1 }],
    ["a missing version", { rules: [] }],
    ["a non-string version", { version: 7, rules: [] }],
    ["an empty version", { version: "", rules: [] }],
    ["missing rules", { version: "1.0.0" }],
    ["rules as a string", { version: "1.0.0", rules: "none" }],
    ["rules as an object", { version: "1.0.0", rules: {} }],
    ["rules as null", { version: "1.0.0", rules: null }],
  ];

  it.each(refused)("refuses %s", (_label, candidate) => {
    expectRefusal(candidate);
  });
});

describe("validatePolicy: strictness at the rule level", () => {
  const refused: Array<[string, unknown]> = [
    ["an unrecognised key beside the recognised rule keys", policyWithRules([ruleWith({ extra: 1 })])],
    ["a missing rule id", policyWithRules([{ tool: "read_file", decision: "allow", reason: "permitted" }])],
    ["a non-string rule id", policyWithRules([ruleWith({ id: 7 })])],
    ["an empty rule id", policyWithRules([ruleWith({ id: "" })])],
    ["a missing rule tool", policyWithRules([{ id: "read", decision: "allow", reason: "permitted" }])],
    ["a non-string rule tool", policyWithRules([ruleWith({ tool: 7 })])],
    ["an empty rule tool", policyWithRules([ruleWith({ tool: "" })])],
    ["a missing rule decision", policyWithRules([{ id: "read", tool: "read_file", reason: "permitted" }])],
    ["a non-string rule decision", policyWithRules([ruleWith({ decision: 1 })])],
    ["a decision outside the three outcomes", policyWithRules([ruleWith({ decision: "ask" })])],
    ["an upper-case decision", policyWithRules([ruleWith({ decision: "ALLOW" })])],
    ["an empty decision", policyWithRules([ruleWith({ decision: "" })])],
    ["a decision spelled with a space", policyWithRules([ruleWith({ decision: "needs approval" })])],
    ["a missing rule reason", policyWithRules([{ id: "read", tool: "read_file", decision: "allow" }])],
    ["a non-string rule reason", policyWithRules([ruleWith({ reason: 7 })])],
    ["an empty rule reason", policyWithRules([ruleWith({ reason: "" })])],
    ["a rule entry that is null", policyWithRules([null])],
    ["a rule entry that is a string", policyWithRules(["read"])],
    ["a rule entry that is an array", policyWithRules([[]])],
    // This entry rests on the duplicate-id check alone: remove that check and
    // two rules sharing an id are accepted, so this is the case that fails.
    ["two rules sharing one id", policyWithRules([ruleWith({}), ruleWith({ tool: "write_file" })])],
  ];

  it.each(refused)("refuses %s", (_label, candidate) => {
    expectRefusal(candidate);
  });
});

describe("validatePolicy: strictness in the arguments record", () => {
  const refused: Array<[string, unknown]> = [
    ["arguments as an array", policyWithRules([ruleWith({ arguments: [] })])],
    ["arguments as a string", policyWithRules([ruleWith({ arguments: "path=*" })])],
    ["arguments as a number", policyWithRules([ruleWith({ arguments: 3 })])],
    ["arguments as null", policyWithRules([ruleWith({ arguments: null })])],
    ["an empty argument key", policyWithRules([ruleWith({ arguments: { "": "read_file" } })])],
    // JSON text is the only input that can produce an own `__proto__` key, so both of these are
    // built with `JSON.parse`: a JS object literal would set the prototype and add no own member.
    ["an arguments record carrying the reserved key", policyWithRules([ruleWith({ arguments: JSON.parse('{"__proto__":"*"}') })])],
    ["the reserved key beside a legitimate key", policyWithRules([ruleWith({ arguments: JSON.parse('{"scope":"workspace","__proto__":"*"}') })])],
    ["an object-valued argument", policyWithRules([ruleWith({ arguments: { path: {} } })])],
    ["an array-valued argument", policyWithRules([ruleWith({ arguments: { path: [] } })])],
    ["a null-valued argument", policyWithRules([ruleWith({ arguments: { path: null } })])],
    ["an undefined-valued argument", policyWithRules([ruleWith({ arguments: { path: undefined } })])],
    ["a NaN-valued argument, a number no JSON document can produce", policyWithRules([ruleWith({ arguments: { path: NaN } })])],
    ["an Infinity-valued argument, the other number JSON cannot produce", policyWithRules([ruleWith({ arguments: { path: Infinity } })])],
    ["a function-valued argument", policyWithRules([ruleWith({ arguments: { path: (): string => "*" } })])],
    ["a symbol-valued argument", policyWithRules([ruleWith({ arguments: { path: Symbol("path") } })])],
    ["a bigint-valued argument", policyWithRules([ruleWith({ arguments: { path: BigInt(3) } })])],
  ];

  it.each(refused)("refuses %s", (_label, candidate) => {
    expectRefusal(candidate);
  });

  // Catches a fix that keeps the reserved key instead of refusing it: the constraint a plain
  // assignment would drop has to be refused, and the record's own prototype chain has to survive
  // the refusal untouched. The fixture is JSON text because a JS literal adds no own `__proto__`.
  it("refuses the reserved key carried as a real own key, leaving the prototype chain alone", () => {
    const rawArguments: Record<string, unknown> = JSON.parse('{"__proto__":"*"}');
    expect(Object.prototype.hasOwnProperty.call(rawArguments, "__proto__")).toBe(true);

    const message = expectRefusal(policyWithRules([ruleWith({ arguments: rawArguments })]));

    expect(message).toBe("rules[0].arguments: invalid argument key");
    expect(message).not.toContain("__proto__");
    expect(Object.getPrototypeOf(rawArguments)).toBe(Object.prototype);
    const fresh: Record<string, unknown> = {};
    expect(fresh.polluted, "validation must not set a prototype").toBeUndefined();
  });

  // The refusal is the reserved key alone. `constructor` and `toString` are ordinary inherited data
  // properties rather than accessors, so assignment gives the record an own member of each and both
  // constraints survive validation.
  it("accepts constructor and toString, whose inherited members are data properties, and keeps them", () => {
    const policy = expectValid(
      policyWithRules([ruleWith({ arguments: { constructor: "*", toString: "*" } })]),
    );
    const accepted = ruleAt(policy.rules, 0).arguments;
    if (accepted === undefined) {
      throw new Error("expected the rule to carry the arguments record it supplied");
    }

    expect(Object.keys(accepted).sort()).toEqual(["constructor", "toString"]);
    expect(Object.prototype.hasOwnProperty.call(accepted, "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(accepted, "toString")).toBe(true);
  });
});

describe("validatePolicy: accepted shapes", () => {
  it("accepts a minimal policy with an empty rule list, because naming no rule can only deny more", () => {
    const policy = expectValid({ version: "1.0.0", rules: [] });

    expect(policy).toEqual<Policy>({ version: "1.0.0", rules: [] });
    expect(policy.rules).toHaveLength(0);
  });

  it("accepts a rule that supplies no arguments and keeps the member absent", () => {
    const policy = expectValid(policyWithRules([ruleWith({})]));

    expect(ruleAt(policy.rules, 0)).toEqual<PolicyRule>({
      id: "read",
      tool: "read_file",
      decision: "allow",
      reason: "reading is permitted",
    });
    expect(Object.prototype.hasOwnProperty.call(ruleAt(policy.rules, 0), "arguments")).toBe(false);
  });

  it("accepts an empty arguments record and keeps the member present", () => {
    const policy = expectValid(policyWithRules([ruleWith({ arguments: {} })]));

    expect(ruleAt(policy.rules, 0).arguments).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(ruleAt(policy.rules, 0), "arguments")).toBe(true);
  });

  it("accepts string, number, boolean and wildcard argument values and keeps them", () => {
    const policy = expectValid(
      policyWithRules([
        ruleWith({
          id: "write",
          tool: "write_file",
          decision: "needs_approval",
          reason: "writing needs approval",
          arguments: { path: "notes.txt", retries: 3, readonly: true, target: "*" },
        }),
      ]),
    );

    expect(ruleAt(policy.rules, 0).arguments).toEqual({
      path: "notes.txt",
      retries: 3,
      readonly: true,
      target: "*",
    });
  });

  it("keeps the author's rule order and accepts all three decisions", () => {
    const policy = expectValid(
      policyWithRules([
        ruleWith({ id: "first", decision: "allow" }),
        ruleWith({ id: "second", decision: "deny" }),
        ruleWith({ id: "third", decision: "needs_approval" }),
      ]),
    );

    expect(policy.rules.map((rule) => rule.id)).toEqual(["first", "second", "third"]);
    expect(policy.rules.map((rule) => rule.decision)).toEqual(["allow", "deny", "needs_approval"]);
  });

  it("accepts symbol keys beside the recognised ones, which are not own enumerable string keys", () => {
    const policy = expectValid({ version: "1.0.0", rules: [], [Symbol("k")]: 1 });

    expect(Object.keys(policy)).toEqual(["version", "rules"]);
  });

  it("builds fresh objects carrying exactly the recognised keys", () => {
    const ruleInput: PolicyRule = {
      id: "read",
      tool: "read_file",
      decision: "allow",
      reason: "reading is permitted",
    };
    const input: Policy = { version: "1.0.0", rules: [ruleInput] };

    const policy = expectValid(input);

    expect(policy).not.toBe(input);
    expect(ruleAt(policy.rules, 0)).not.toBe(ruleInput);
    expect(Object.keys(policy).sort()).toEqual(["rules", "version"]);
    expect(Object.keys(ruleAt(policy.rules, 0)).sort()).toEqual(["decision", "id", "reason", "tool"]);
  });

  it("carries arguments beside the recognised keys on a rule that supplied them", () => {
    const policy = expectValid(policyWithRules([ruleWith({ arguments: { path: "notes.txt" } })]));

    expect(Object.keys(ruleAt(policy.rules, 0)).sort()).toEqual([
      "arguments",
      "decision",
      "id",
      "reason",
      "tool",
    ]);
  });

  it("returns a policy that later mutation of the caller's rule cannot change", () => {
    const ruleInput: PolicyRule = {
      id: "read",
      tool: "read_file",
      decision: "allow",
      reason: "reading is permitted",
    };
    const input: Policy = { version: "1.0.0", rules: [ruleInput] };

    const policy = expectValid(input);
    input.version = "9.9.9";
    ruleInput.decision = "deny";

    expect(policy.version).toBe("1.0.0");
    expect(ruleAt(policy.rules, 0).decision).toBe("allow");
  });

  it("returns an arguments record detached from the caller's own record", () => {
    const argumentsInput = { path: "notes.txt" };
    const policy = expectValid(policyWithRules([ruleWith({ arguments: argumentsInput })]));

    argumentsInput.path = "changed.txt";

    expect(ruleAt(policy.rules, 0).arguments).toEqual({ path: "notes.txt" });
  });
});

describe("validatePolicy: refusal messages", () => {
  it("refuses the JSON text of a policy without echoing anything taken from it", () => {
    const error = expectRefusal('{"version":"1.0.0","rules":[]}');

    expect(error).not.toContain("{");
  });

  // A key name and a rule id are text the candidate supplied, and either may be credential-shaped
  // or enormous: the message names the place to fix and never the text that was there. Both markers
  // are assembled at run time, so this file holds no credential-shaped literal.
  it("keeps a credential-shaped key name and rule id out of the message", () => {
    const credentialShapedKey = ["sk", "live", "0123456789abcdef"].join("-");
    const keyMessage = expectRefusal({ version: "1.0.0", rules: [], [credentialShapedKey]: 1 });

    expect(keyMessage).toBe("policy: unrecognised key");
    expect(keyMessage).not.toContain(credentialShapedKey);

    const credentialShapedId = ["ghp", "0123456789abcdef"].join("-");
    const idMessage = expectRefusal(
      policyWithRules([
        ruleWith({ id: credentialShapedId }),
        ruleWith({ id: credentialShapedId, tool: "write_file" }),
      ]),
    );

    expect(idMessage).toBe("rules[1]: duplicate rule id");
    expect(idMessage).not.toContain(credentialShapedId);
  });

  // The same promise holds for the rule-level key refusal, the third message that once named the
  // text it had read.
  it("keeps an unrecognised rule key out of the message", () => {
    const credentialShapedKey = ["sk", "live", "fedcba9876543210"].join("-");
    const message = expectRefusal(policyWithRules([ruleWith({ [credentialShapedKey]: 1 })]));

    expect(message).toBe("rules[0]: unrecognised key");
    expect(message).not.toContain(credentialShapedKey);
  });
});

describe("readPolicyVersion", () => {
  it("reads the version of a valid policy", () => {
    expect(readPolicyVersion({ version: "1.0.0", rules: [] })).toBe("1.0.0");
  });

  it("reads the version of an otherwise invalid policy, so a refused policy can still be named", () => {
    const candidate = { version: "2.0.0", rules: "not an array" };

    expect(validatePolicy(candidate).ok).toBe(false);
    expect(readPolicyVersion(candidate)).toBe("2.0.0");
  });

  it("is not a validator: an unrecognised key does not hide the version it can report", () => {
    const candidate = { version: "3.0.0", rules: [], extra: 1 };

    expect(validatePolicy(candidate).ok).toBe(false);
    expect(readPolicyVersion(candidate)).toBe("3.0.0");
  });

  it("returns an empty label when there is no readable version", () => {
    const unreadable: Array<[string, unknown]> = [
      ["undefined", undefined],
      ["null", null],
      ["a number", 7],
      ["an array", []],
      ["a plain string", "1.0.0"],
      ["the JSON text of a policy", '{"version":"1.0.0","rules":[]}'],
      ["an object with no version", { rules: [] }],
      ["an empty version", { version: "", rules: [] }],
      ["a non-string version", { version: 7, rules: [] }],
      ["an object whose only key is a symbol", { [Symbol("k")]: 1 }],
    ];

    for (const [label, candidate] of unreadable) {
      expect(readPolicyVersion(candidate), `expected an empty label for ${label}`).toBe("");
    }
  });

  it("never throws and never reads rules, even when there is no answer to give", () => {
    expect(readPolicyVersion(policyWithThrowingRulesAccessor())).toBe("1.0.0");
    expect(readPolicyVersion(policyWithThrowingVersionAccessor())).toBe("");
    expect(readPolicyVersion(selfReferencingObject())).toBe("");
    expect(readPolicyVersion(policyWhoseRulesContainThemselves())).toBe("1.0.0");
  });
});

