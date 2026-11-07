/**
 * The fixture-pack extension seam.
 *
 * A new fixture pack is contributed by implementing {@link FixturePack} and registering it through
 * the extension registry in this folder, which runs {@link validateFixturePack} before the pack
 * becomes reachable. Adding one therefore never requires editing this package's scoring code: the
 * scoring path is handed the case set and the standard version, and reads the versioned criteria
 * from them rather than from a branch that names a particular pack.
 *
 * The built-in `SGI-SO-1.0.0` case set is deliberately not registered as an extension, so a
 * contribution can never displace the shipped path.
 *
 * Nothing here reads a file, resolves a path or opens a connection: the loader that produces the
 * fixture data belongs to `@adem/sgi-fixtures`, and this module names only the type of what that
 * loader returns. A seeded `categories` row written by an API composition root is likewise not
 * visible from here: no module in this folder holds a database handle, reads a table or writes one.
 *
 * A violation is a composition-time programming error rather than a request the product can answer,
 * so the guard throws {@link FixturePackValidationError} — carrying the stable code
 * `seam_validation` — and fails start-up loudly instead of returning a discriminated result.
 */

import type { CaseSet } from "@adem/sgi-fixtures";

/**
 * The refusal messages, composed once so every refusal reads the same and each names the member
 * that failed. Each states the rule it applies, which is what makes a start-up failure actionable
 * rather than a bare stack.
 */
const ID_MESSAGE = 'FixturePack field "id" must be a non-empty string.';
const STANDARD_VERSION_ID_MESSAGE = 'FixturePack field "standardVersionId" must be a non-empty string.';
const TITLE_MESSAGE = 'FixturePack field "title" must be a non-empty string.';
const LOAD_CASE_SET_MESSAGE = 'FixturePack field "loadCaseSet" must be a function.';

/**
 * The shape read from a {@link validateFixturePack} candidate before it is narrowed: every member is
 * read as an unknown value so the guard can check it without trusting the caller.
 */
interface FixturePackCandidate {
  readonly id?: unknown;
  readonly standardVersionId?: unknown;
  readonly title?: unknown;
  readonly loadCaseSet?: unknown;
}

/**
 * A fixture pack a community extension can register.
 *
 * All three text members are read-only: a registered pack is treated as immutable, and a change to
 * one is a new registration rather than an edit of an existing value.
 */
export interface FixturePack {
  /**
   * The stable machine key, and the registry's uniqueness key for this kind of extension. Two packs
   * registered under one `id` are a defect the registry refuses rather than a pair it holds.
   */
  readonly id: string;

  /**
   * The standard version identifier whose **versioned** criteria the returned case set is evaluated
   * under, for example `SGI-SO-1.0.0`. It is what the report traces a measurement back to, so it
   * names the published standard version rather than the pack.
   */
  readonly standardVersionId: string;

  /** The human-facing label shown wherever the pack is listed, for example `Structured output pack`. */
  readonly title: string;

  /**
   * Produces this pack's case set.
   *
   * Declared as a method so a plain object literal satisfies the seam without a class. It returns a
   * {@link CaseSet} — whose field names are snake_case, shared with the fixture files and the
   * `/api/v1` wire contract — and its `total_cases` and `critical_cases` must agree with the
   * standard version's declared counts, because the scoring path refuses a case set that drifts from
   * the versioned criteria it is scored against.
   *
   * How the case set is produced is the pack's own business: the guard below never inspects the
   * result, so a loader may read a document, build the set in memory, or defer either until it is
   * called.
   */
  loadCaseSet(): CaseSet;
}

/**
 * Raised when a value offered as a {@link FixturePack} fails the seam's validation.
 *
 * The error is typed and machine-readable: `code` is the stable `seam_validation` identifier and
 * `field` names the member that failed, so a composition root can report precisely which
 * registration is wrong. There is no HTTP status for this code — a seam violation is a programming
 * error raised at registration time, not a request the product answers.
 */
export class FixturePackValidationError extends Error {
  readonly code: string = "seam_validation";

  /** The member that failed validation: `id`, `standardVersionId`, `title` or `loadCaseSet`. */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "FixturePackValidationError";
    this.field = field;
  }
}

/**
 * Narrows an untrusted value to a {@link FixturePack}, returning the very same object widened no
 * further: nothing is cloned, frozen or copied, extra properties are left untouched, and the text
 * members are never rewritten. A plain object satisfying the interface is enough — the candidate
 * need not be an instance of a class.
 *
 * It reads the members in a fixed order and throws on the first failure, so a candidate wrong in
 * several members always reports the earliest one:
 *
 * 1. `id` — a string whose value is non-empty after `trim()`. A candidate that is not a non-null
 *    object (`null`, `undefined`, a number, a string, a boolean) fails here.
 * 2. `standardVersionId` — a string whose value is non-empty after `trim()`.
 * 3. `title` — a string whose value is non-empty after `trim()`.
 * 4. `loadCaseSet` — a function.
 *
 * The whitespace rule for the three text members is this package's convention for authored text:
 * trimming decides validity only, so a padded title such as `"  Structured output pack  "` is
 * accepted and returned verbatim rather than trimmed.
 *
 * The case set a pack returns is deliberately not validated here. Its shape is `@adem/sgi-fixtures`'
 * own contract — that loader validates what it reads and refuses malformed documents — and a case
 * set whose counts disagree with its standard version is refused while scoring, at the point the
 * versioned criteria are applied. Checking it again here would duplicate another module's rule and
 * would reject a pack whose loader is legitimately deferred until it is called.
 *
 * Returns the validated pack. Refuses — by throwing {@link FixturePackValidationError} with `code`
 * `seam_validation` and the offending `field` — any candidate that fails one of the four checks
 * above; it never returns a partially validated value.
 */
export function validateFixturePack(candidate: unknown): FixturePack {
  if (typeof candidate !== "object" || candidate === null) {
    throw new FixturePackValidationError("id", ID_MESSAGE);
  }

  const { id, standardVersionId, title, loadCaseSet } = candidate as FixturePackCandidate;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new FixturePackValidationError("id", ID_MESSAGE);
  }

  if (typeof standardVersionId !== "string" || standardVersionId.trim().length === 0) {
    throw new FixturePackValidationError("standardVersionId", STANDARD_VERSION_ID_MESSAGE);
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new FixturePackValidationError("title", TITLE_MESSAGE);
  }

  if (typeof loadCaseSet !== "function") {
    throw new FixturePackValidationError("loadCaseSet", LOAD_CASE_SET_MESSAGE);
  }

  return candidate as FixturePack;
}
