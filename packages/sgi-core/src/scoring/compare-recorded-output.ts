/**
 * The per-case comparison primitive of ADEM's Standard Gate Index: it decides
 * whether one recorded output matches one case's expected output, and it returns
 * both canonical strings so the caller can store deterministic per-case evidence
 * in `report_case_results.expected_json` and `actual_json`.
 *
 * Equality is on the canonical form — never on JavaScript object identity, and
 * never on the order an object's keys happen to be written in — which is what makes
 * two runs of one submission yield byte-identical per-case results and the same
 * outcome. Both sides are rendered by the sibling `./canonical-json`, this package's
 * single producer of that form, so the comparison introduces no ordering rule of its
 * own that could drift from it.
 *
 * Nothing here reads a clock, a locale, a timezone, a random source, a file, an
 * environment variable or a database: two JSON values go in and a verdict comes out.
 * A candidate is declarative data compared as text, and nothing submitted is ever
 * executed.
 *
 * The `absent` outcome lives here rather than in the caller on purpose. A scored run
 * never reaches it: `scoreSubmission` refuses a submission that carries no recorded
 * output for a fixture case with `IncompleteSubmissionError` before any comparison
 * runs, so within a scored run the recorded side is always present. It is a caller
 * that is merely *inspecting* a candidate — asking what one case alone would say,
 * without scoring the whole submission — that needs "no recorded output for this
 * case" as a value instead of as a thrown error, and this function answers that
 * without throwing.
 */

import type { JsonValue } from "@adem/sgi-fixtures";
import { canonicalize } from "./canonical-json";

/**
 * The verdict on one fixture case, carrying the evidence a report row stores.
 *
 * All four members are present on every outcome: there is no optional member and no
 * variant shape, so a caller reads any of them without narrowing first.
 */
export interface CaseComparison {
  /**
   * Whether the recorded output matched the expected output.
   *
   * It is `false` both for a genuine mismatch and for an absent recording, so this flag
   * alone never distinguishes those two: `reason` is what tells them apart.
   */
  match: boolean;

  /**
   * The expected output as canonical JSON text — the byte-stable form of the standard
   * version's expected output, not the raw value it was rendered from.
   *
   * It is populated on every outcome, including `"absent"`.
   */
  expectedCanonical: string;

  /**
   * The recorded output as canonical JSON text.
   *
   * It is the **empty string** when the case has no recorded output, never `"null"`:
   * `"null"` would read as a recorded JSON `null` and would be indistinguishable from a
   * genuine one, such as fixture case `so-020`'s `assigned_team`.
   */
  actualCanonical: string;

  /**
   * Which of the three outcomes this comparison is: `"match"` when the two canonical
   * forms are equal, `"mismatch"` when a recording exists and the forms differ, and
   * `"absent"` when no output was recorded for the case at all.
   */
  reason: "match" | "mismatch" | "absent";
}

/**
 * Compares one case's expected output against the output a candidate recorded for it.
 *
 * Both values are rendered as canonical JSON by {@link canonicalize} and the two strings
 * are compared, so the comparison is byte for byte and repeatable. Three properties of the
 * fixture set are what the rendering decides, and this function is where they are settled:
 *
 * - Object **key order is insignificant**. Fixture case `so-017` records the same keys as
 *   its expected output in a different order — a difference no reader of the JSON can
 *   observe — and it matches.
 * - Whitespace **between tokens** is insignificant, because the canonical form writes
 *   none. Whitespace **inside a string value** is significant: case `so-018` records a note
 *   carrying a trailing space its expected output does not, and it does not match.
 * - Array **order is significant**: case `so-014` records the same codes in a different
 *   order and does not match, because the order of an array's elements is data.
 *
 * It refuses nothing and it never throws, whatever it is handed: both arguments are plain
 * JSON values, and `undefined` for the recorded side is a defined input rather than an
 * error.
 *
 * @param expected - The expected output of the case, as the standard version's fixture set
 * states it.
 * @param actual - The output the candidate recorded for that case, or `undefined` when it
 * recorded none.
 * @returns The {@link CaseComparison} verdict. `reason` is `"match"` when the two canonical
 * strings are equal, `"mismatch"` when a recorded output exists and differs from the
 * expected one, and `"absent"` when `actual` is `undefined` — the only outcome that
 * involves no recorded value, which reports `match: false` and `actualCanonical: ""`. Both
 * canonical strings are returned on all three outcomes, so a report row always holds its
 * expected and its actual evidence.
 */
export function compareRecordedOutput(
  expected: JsonValue,
  actual: JsonValue | undefined,
): CaseComparison {
  const expectedCanonical = canonicalize(expected);

  if (actual === undefined) {
    return { match: false, expectedCanonical, actualCanonical: "", reason: "absent" };
  }

  const actualCanonical = canonicalize(actual);
  const match = actualCanonical === expectedCanonical;

  return { match, expectedCanonical, actualCanonical, reason: match ? "match" : "mismatch" };
}
