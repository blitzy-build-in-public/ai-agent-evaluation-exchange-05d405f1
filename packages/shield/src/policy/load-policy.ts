/**
 * Loading of a Shield policy, from either the value or the JSON text holding it.
 *
 * A caller may already hold a policy as plain data, or hold the JSON text it was
 * read from — a configuration file the host application parsed itself, a string
 * it read from its own environment. Both reach validation through one entry
 * point and one result shape. The text is read as data only: `JSON.parse` is the
 * sole parser and no part of a policy is ever executed.
 *
 * Every outcome is a value. Neither function throws for any input, and an input
 * that cannot be read as a policy is refused rather than accepted, so a policy
 * that cannot be checked never reaches the engine.
 */

import { validatePolicy } from "./policy-schema";
import type { Policy } from "./policy-schema";

/** The outcome of {@link loadPolicy} and {@link parsePolicyJson}. */
export type PolicyLoadResult =
  | { ok: true; policy: Policy }
  | { ok: false; error: string };

/**
 * Load a policy from JSON text.
 *
 * Returns the result of validating the parsed text: `{ ok: true, policy }` when
 * the text holds a policy, and `{ ok: false, error }` for every other text — one
 * that is not valid JSON, one that parses to something other than a policy
 * (`"[1,2]"`, `"3"`, `"null"` and a schema-invalid object included), and a `text`
 * argument that is not a string at all.
 *
 * It never throws. Each message it produces is short, stable and free of the
 * text it came from: the text may hold a credential-shaped value or be very
 * long, and an error echoing it would both spread it and be disproportionately
 * large.
 */
export function parsePolicyJson(text: string): PolicyLoadResult {
  // The declared parameter type is not a guarantee at run time for an untyped
  // caller, so a non-string is refused here instead of reaching JSON.parse,
  // whose TypeError would escape as a thrown exception.
  if (typeof text !== "string") {
    return { ok: false, error: "policy: expected a JSON string" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Text that is not JSON is a refusal. Accepting it would turn an input that
    // could not be read into a policy, which is the fail-open direction.
    return { ok: false, error: "policy: invalid JSON" };
  }

  return validatePolicy(parsed);
}

/**
 * Load a policy from either form: an already-parsed value, or the JSON text
 * holding one.
 *
 * Returns the validated policy as `{ ok: true, policy }` when `input` is a
 * policy in either form — the value and its JSON text agree on `version` — and
 * `{ ok: false, error }` otherwise. A string is the only input read as JSON
 * text; every other value, `null`, `undefined`, a number, a boolean, a function
 * and a cyclic object included, is validated exactly as it stands, without being
 * serialised first.
 *
 * It never throws.
 */
export function loadPolicy(input: unknown): PolicyLoadResult {
  return typeof input === "string" ? parsePolicyJson(input) : validatePolicy(input);
}
