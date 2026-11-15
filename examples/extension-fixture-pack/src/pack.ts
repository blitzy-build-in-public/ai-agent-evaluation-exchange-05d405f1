/**
 * The `FixturePack` implementation of `@adem/extension-fixture-pack`: the worked proof that a
 * fixture pack can be contributed to ADEM without editing `@adem/sgi-core`'s scoring code.
 *
 * The pack is this extension's own read-only case set. It is read from
 * `../fixtures/example-pack/cases.json` at call time and handed to the evaluator as plain data:
 * nothing here executes a submission, compares a recorded output or derives an outcome, because
 * those belong to `@adem/sgi-core`, which reaches a case set through the `FixturePack` interface
 * this module implements.
 *
 * The pack reads its own file rather than calling `@adem/sgi-fixtures`' loader, which resolves only
 * that package's own `fixtures/` root: a contributed pack ships its case set beside its own source,
 * so the read belongs to the pack. `@adem/sgi-fixtures` is therefore imported for its types alone
 * and contributes nothing at run time.
 *
 * `EXAMPLE_STANDARD_VERSION_ID` is deliberately distinct from the standard version ADEM ships, so a
 * registration of this example can never be mistaken for, or displace, the published standard.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FixturePack } from "@adem/sgi-core";
import type { CaseSet, CaseSeverity, FixtureCase, JsonValue } from "@adem/sgi-fixtures";

/** The registry key of this pack: stable, and the value the seam's guard reads first. */
export const EXAMPLE_FIXTURE_PACK_ID = "example-pack";

/**
 * The standard version identifier this pack's case set belongs to.
 *
 * Not the shipped `SGI-SO-1.0.0`: a report traces a measurement back to the version it was scored
 * under, so the example states a version of its own instead of borrowing the published one.
 */
export const EXAMPLE_STANDARD_VERSION_ID = "EXAMPLE-PACK-1.0.0";

/** The human-facing label of this pack, shown wherever a registered pack is listed. */
export const EXAMPLE_FIXTURE_PACK_TITLE = "Structured Output Conformance (Example Pack)";

/**
 * The declared key set of the case-set document, and of one case inside it.
 *
 * A fixture document is a closed shape: a key its reader does not know is refused rather than left
 * unread, which is what the pack file, the loader in `@adem/sgi-fixtures` and the case schema in
 * `@adem/shared` all hold to.
 */
const CASE_SET_KEYS = ["standard_version_id", "total_cases", "critical_cases", "cases"] as const;
const FIXTURE_CASE_KEYS = ["id", "severity", "input", "expected_output"] as const;

/**
 * Creates this extension's fixture pack.
 *
 * Returns a fresh {@link FixturePack} on every call — a plain object literal, so the pack holds no
 * state and two packs created here are interchangeable. Its `loadCaseSet` returns the case set of
 * `../fixtures/example-pack/cases.json`, freshly read and validated on every call.
 */
export function createExampleFixturePack(): FixturePack {
  return {
    id: EXAMPLE_FIXTURE_PACK_ID,
    standardVersionId: EXAMPLE_STANDARD_VERSION_ID,
    title: EXAMPLE_FIXTURE_PACK_TITLE,
    loadCaseSet(): CaseSet {
      // Resolved from this module's own location and never from the working directory, so the same
      // file is read wherever the process was started. The read is here rather than a static
      // `import` of the JSON because `fixtures/` lies outside this project's `rootDir` (`src`) and
      // so outside its compile program, and because a case set is data the pack publishes rather
      // than a compiled constant. Nothing is cached: every call reads and parses the file afresh, so
      // an edited case set is picked up, two calls against an unchanged file return deeply equal
      // case sets, and mutating one result cannot reach the next.
      const casesPath = fileURLToPath(
        new URL("../fixtures/example-pack/cases.json", import.meta.url),
      );
      const document: unknown = JSON.parse(readFileSync(casesPath, "utf8"));

      if (!isJsonObject(document)) {
        throw refuse("cases.json must hold a JSON object, not an array or a scalar", casesPath);
      }
      assertOnlyDeclaredKeys(document, CASE_SET_KEYS, casesPath, "cases.json");

      const standardVersionId = document["standard_version_id"];
      if (!isNonEmptyString(standardVersionId)) {
        throw refuse("cases.json declares no non-empty string standard_version_id", casesPath);
      }
      if (standardVersionId !== EXAMPLE_STANDARD_VERSION_ID) {
        throw refuse(
          `cases.json declares standard_version_id ${JSON.stringify(standardVersionId)}, not this ` +
            `pack's ${JSON.stringify(EXAMPLE_STANDARD_VERSION_ID)}`,
          casesPath,
        );
      }

      const declaredCases = document["cases"];
      if (!isNonEmptyArray(declaredCases)) {
        throw refuse("cases.json carries no non-empty cases array", casesPath);
      }

      const declaredTotalCases = document["total_cases"];
      if (!isWholeNumber(declaredTotalCases)) {
        throw refuse("cases.json declares no whole-number total_cases", casesPath);
      }
      if (declaredTotalCases !== declaredCases.length) {
        throw refuse(
          `cases.json declares total_cases ${declaredTotalCases} but contains ` +
            `${declaredCases.length}`,
          casesPath,
        );
      }

      const declaredCriticalCases = document["critical_cases"];
      if (!isWholeNumber(declaredCriticalCases)) {
        throw refuse("cases.json declares no whole-number critical_cases", casesPath);
      }

      // Read in the order a contributor reads the file, and the file's own order is kept: the case
      // array is never sorted, so the case set this returns is the one the document states.
      const cases: FixtureCase[] = [];
      const caseIds = new Set<string>();
      let criticalCases = 0;

      for (const [index, value] of declaredCases.entries()) {
        const caseLabel = `cases[${index}]`;

        if (!isJsonObject(value)) {
          throw refuse(`${caseLabel} must be a JSON object`, casesPath);
        }
        assertOnlyDeclaredKeys(value, FIXTURE_CASE_KEYS, casesPath, caseLabel);

        const id = value["id"];
        if (!isNonEmptyString(id)) {
          throw refuse(`${caseLabel} declares no non-empty string id`, casesPath);
        }
        if (caseIds.has(id)) {
          throw refuse(`${caseLabel} repeats the case id ${JSON.stringify(id)}`, casesPath);
        }
        caseIds.add(id);

        const severity = value["severity"];
        if (!isCaseSeverity(severity)) {
          throw refuse(
            `${caseLabel}.severity ${JSON.stringify(severity) ?? "is absent"}: a case severity is ` +
              `"critical" or "standard"`,
            casesPath,
          );
        }

        const input = value["input"];
        if (!isFixtureInput(input)) {
          throw refuse(
            `${caseLabel}.input must carry the non-empty strings "instruction" and "source"`,
            casesPath,
          );
        }

        const expectedOutput = value["expected_output"];
        if (!isJsonValue(expectedOutput)) {
          throw refuse(`${caseLabel} carries no JSON expected_output`, casesPath);
        }

        if (severity === "critical") {
          criticalCases += 1;
        }
        cases.push({
          id,
          severity,
          input: { instruction: input.instruction, source: input.source },
          expected_output: expectedOutput,
        });
      }

      if (declaredCriticalCases !== criticalCases) {
        throw refuse(
          `cases.json declares critical_cases ${declaredCriticalCases} but ${criticalCases} of its ` +
            `cases are critical`,
          casesPath,
        );
      }

      return {
        standard_version_id: standardVersionId,
        total_cases: cases.length,
        critical_cases: criticalCases,
        cases,
      };
    },
  };
}

/** A parsed JSON object: the shape every guard below narrows an unknown value to before a read. */
type JsonObject = { [key: string]: unknown };

/**
 * Builds the error every refusal here throws.
 *
 * One shape, so the `example-pack:` prefix and the absolute path of the file at fault are never
 * missing: a contributor holding a failure sees which case set to open. A plain `Error` rather than
 * a class of this module's own, because a malformed case set is a defect in the pack's own data and
 * a caller has nothing to branch on beyond the message.
 */
function refuse(problem: string, casesPath: string): Error {
  return new Error(`example-pack: ${problem} (${casesPath})`);
}

/** Refuses an object carrying a key its document kind does not declare. */
function assertOnlyDeclaredKeys(
  object: JsonObject,
  declared: readonly string[],
  casesPath: string,
  label: string,
): void {
  for (const key of Object.keys(object)) {
    if (!declared.includes(key)) {
      throw refuse(`${label} carries the undeclared key ${JSON.stringify(key)}`, casesPath);
    }
  }
}

/** Whether a value is a JSON object rather than an array, `null` or a scalar. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is an array holding at least one element. */
function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/** Whether a value is a string holding at least one character. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Whether a value is a whole number. */
function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Whether a value is one of the two case severities a fixture case may state. */
function isCaseSeverity(value: unknown): value is CaseSeverity {
  return value === "critical" || value === "standard";
}

/** Whether a value is a fixture input: an object carrying both of its declared non-empty strings. */
function isFixtureInput(value: unknown): value is { instruction: string; source: string } {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value["instruction"]) &&
    isNonEmptyString(value["source"])
  );
}

/**
 * Whether a value is a JSON value.
 *
 * `JSON.parse` can produce nothing else, so this guard is what carries that fact into the types:
 * without it a parsed `expected_output` could not be typed as {@link JsonValue} without asserting
 * the shape the validation above is supposed to establish.
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isJsonObject(value)) {
    return Object.keys(value).every((key) => isJsonValue(value[key]));
  }
  return false;
}
