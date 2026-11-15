/**
 * Unit suite for the policy loader.
 *
 * The loader is the one place where "something a caller passed" — an already
 * parsed value, or the JSON text holding one — becomes either a typed policy or
 * a refusal. Two properties carry the weight. First, totality: no input raises,
 * a non-string argument to the text path and every non-policy value included.
 * Second, fail-closed: text that is not JSON, JSON that is not an object and an
 * object that fails the schema can never become a policy.
 *
 * Only the loader's own two messages are its to invent, for text that is not JSON
 * and for an argument that is not a string; every other refusal is asserted as
 * *a* refusal carrying a message, never as particular wording, which
 * `policy-schema.ts` owns. Each group names the mistake it catches.
 */

import { describe, it, expect } from "vitest";
import { loadPolicy, parsePolicyJson } from "./load-policy";
import type { Policy, PolicyRule } from "./policy-schema";

/** The result shape both entry points return. */
type LoadResult = ReturnType<typeof loadPolicy>;

/** Assert a refusal, assert it explains itself, and return its message. */
function expectRefusal(result: LoadResult): string {
  if (result.ok) {
    throw new Error("expected the loader to refuse this input");
  }
  expect(result.error, "a refusal must carry a message").not.toBe("");
  return result.error;
}

/** Assert acceptance and return the policy the loader validated. */
function expectValid(result: LoadResult): Policy {
  if (!result.ok) {
    throw new Error(`expected the loader to accept this input: ${result.error}`);
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

/** The one policy every accepted case in this suite is built from. */
const validPolicy: Policy = {
  version: "1.0.0",
  rules: [
    {
      id: "allow-read-file",
      tool: "read_file",
      decision: "allow",
      reason: "Reading a file is allowed by this test policy.",
      arguments: { scope: "workspace" },
    },
  ],
};

/** An object one of whose own members points back at the object itself. */
function selfReferencingObject(): unknown {
  const node: Record<string, unknown> = {};
  node.self = node;
  return node;
}

/** A policy-shaped value whose `rules` array holds itself. */
function policyWhoseRulesHoldThemselves(): unknown {
  const rules: unknown[] = [];
  rules.push(rules);
  return { version: "1.0.0", rules };
}

/**
 * The valid policy reached through a prototype whose `toJSON` raises: a loader
 * that serialised a parsed value would raise here, while the validator, which
 * reads own enumerable string keys only, never sees the member.
 */
function policyWhoseSerialisationRaises(): unknown {
  const inherited = {
    toJSON(): never {
      throw new Error("this fixture must never be serialised");
    },
  };
  return Object.assign(Object.create(inherited) as Record<string, unknown>, validPolicy);
}

/** Hands any value to the text path's parameter, which its declared type forbids. */
function asUnknownText(value: unknown): string {
  return value as string;
}

describe("loadPolicy: the two input forms", () => {
  it("loads a policy already parsed, preserving every field of its rule", () => {
    const policy = expectValid(loadPolicy(validPolicy));

    expect(policy.version).toBe("1.0.0");
    const rule = ruleAt(policy.rules, 0);
    expect(rule.tool).toBe("read_file");
    expect(rule.decision).toBe("allow");
    expect(rule.reason).toBe("Reading a file is allowed by this test policy.");
    expect(rule.arguments).toEqual({ scope: "workspace" });
  });

  it("loads the same policy from its JSON text and agrees with the value path", () => {
    const fromValue = expectValid(loadPolicy(validPolicy));
    const fromText = expectValid(loadPolicy(JSON.stringify(validPolicy)));

    expect(fromText.version).toBe(fromValue.version);
    expect(ruleAt(fromText.rules, 0).id).toBe(ruleAt(fromValue.rules, 0).id);
    expect(ruleAt(fromText.rules, 0).decision).toBe(ruleAt(fromValue.rules, 0).decision);
    expect(fromText).toEqual(fromValue);
  });

  // Catches a loader that serialises a parsed value before validating it: this
  // fixture raises when it is serialised and validates as it stands.
  it("validates a parsed value as it stands, never serialising it", () => {
    const policy = expectValid(loadPolicy(policyWhoseSerialisationRaises()));

    expect(policy.version).toBe("1.0.0");
    expect(ruleAt(policy.rules, 0).tool).toBe("read_file");
  });

  // The same mistake from the other side, direction pinned: a loader that
  // serialised first would raise on either fixture, not refuse it.
  it("refuses a parsed value JSON cannot express, without raising", () => {
    const valuesJSONCannotExpress: Array<{ label: string; value: unknown }> = [
      { label: "a bigint-valued own key", value: { ...validPolicy, count: 3n } },
      { label: "a rules array holding itself", value: policyWhoseRulesHoldThemselves() },
    ];

    for (const { label, value } of valuesJSONCannotExpress) {
      expect(() => loadPolicy(value), `loadPolicy threw for ${label}`).not.toThrow();
      expectRefusal(loadPolicy(value));
    }
  });
});

const textsThatCannotBeAPolicy: Array<{ label: string; text: string }> = [
  { label: "a truncated object", text: "{" },
  { label: "an empty string", text: "" },
  { label: "text that is not JSON at all", text: "not json" },
  { label: "a JSON array", text: "[1,2]" },
  { label: "a JSON number", text: "3" },
  { label: "a JSON string", text: '"x"' },
  { label: "a JSON null", text: "null" },
  { label: "a JSON boolean", text: "true" },
  { label: "an object that fails the schema", text: '{"version":"","rules":"nope"}' },
  { label: "an object carrying an unrecognised key", text: '{"version":"1.0.0","rules":[],"extra":1}' },
];

describe("parsePolicyJson: text that cannot be a policy", () => {
  // Catches a loader that answers with a permissive default from its catch, and
  // one that copies the text it could not read into its message.
  it("never throws, refuses every text, and keeps that text out of the message", () => {
    for (const { label, text } of textsThatCannotBeAPolicy) {
      expect(() => parsePolicyJson(text), `parsePolicyJson threw for ${label}`).not.toThrow();

      const error = expectRefusal(parsePolicyJson(text));
      if (text !== "") {
        expect(error, `refusing ${label} echoes the text it read`).not.toContain(text);
      }
    }
  });

  // The text may hold a credential-shaped value, and a message that copied it
  // would spread it; the marker is the brace alone, so this file stays clean.
  it("returns a refusal rather than the text, which may hold a credential-shaped value", () => {
    expect(expectRefusal(parsePolicyJson("{"))).not.toContain("{");
  });

  // Catches a loader that re-checks the fields itself instead of asking the
  // validator: both texts below parse, so the refusal of the first beside the
  // acceptance of the second shows the refusal comes from validation.
  it("refuses a parsed object that fails the schema, with the validator's refusal", () => {
    expectRefusal(parsePolicyJson('{"version":"","rules":"nope"}'));
    expect(parsePolicyJson('{"version":"1.0.0","rules":[]}').ok).toBe(true);
  });

  // The reserved argument key reaches the validator through JSON text alone, and a policy file is
  // the primary input path a policy takes: both entry points refuse that text and neither echoes
  // any of it back, because a rule id and a key name are text the document may hold and the message
  // is not the place to spread them.
  it("refuses the text of a rule constrained on the reserved argument key, without echoing it", () => {
    const text =
      '{"version":"proto-1.0.0","rules":[{"id":"proto-rule","tool":"danger_tool","decision":"allow","reason":"x","arguments":{"__proto__":"*"}}]}';

    const message = expectRefusal(parsePolicyJson(text));

    expectRefusal(loadPolicy(text));
    expect(message).not.toContain("__proto__");
    expect(message).not.toContain(text);
  });
});

const inputsThatAreNotAPolicy: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "a number", value: 42 },
  { label: "a boolean", value: true },
  { label: "an array holding the policy", value: [validPolicy] },
  { label: "a function", value: (): string => "allow" },
  { label: "an object whose only key is a symbol", value: { [Symbol("policy")]: validPolicy } },
  { label: "an object referring to itself", value: selfReferencingObject() },
];

describe("loadPolicy: every non-string input", () => {
  // A parsed policy is the only one of these the loader may accept.
  it("refuses each input that is not a parsed policy, without raising", () => {
    for (const { label, value } of inputsThatAreNotAPolicy) {
      expect(() => loadPolicy(value), `loadPolicy threw for ${label}`).not.toThrow();
      expectRefusal(loadPolicy(value));
    }

    const accepted = [validPolicy, ...inputsThatAreNotAPolicy.map((input) => input.value)].filter(
      (value) => loadPolicy(value).ok,
    );
    expect(accepted).toEqual([validPolicy]);
  });
});

const nonStringArguments: Array<unknown> = [42, validPolicy, null, (): string => "allow", Symbol("policy")];

describe("parsePolicyJson: an argument that is not a string", () => {
  // Catches a loader that reads its parameter's declared type as a run-time
  // guarantee: an unguarded parse raises for these — a TypeError for a symbol, a
  // SyntaxError for an object — and that raise has to arrive as a refusal.
  it("refuses a non-string argument rather than letting the parse raise", () => {
    for (const value of nonStringArguments) {
      const text = asUnknownText(value);
      expect(() => parsePolicyJson(text), "parsePolicyJson threw").not.toThrow();
      expectRefusal(parsePolicyJson(text));
    }
  });
});

describe("loadPolicy: a string is only ever read as JSON text", () => {
  // Catches a loader that hands a string to the validator as a value instead of
  // reading it as JSON text, and one that fails to round trip a policy.
  it("round trips a policy through its JSON text", () => {
    const policy = expectValid(parsePolicyJson(JSON.stringify(validPolicy)));

    expect(policy.version).toBe(validPolicy.version);
    expect(policy).toEqual(validPolicy);
  });

  it("refuses a string that is not a JSON object holding a policy", () => {
    for (const text of ['"x"', "5", '{"version":"","rules":[]}']) {
      expectRefusal(loadPolicy(text));
    }
  });
});
