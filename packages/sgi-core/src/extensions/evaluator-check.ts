/**
 * The evaluator-check extension seam.
 *
 * A new evaluator check is contributed by implementing {@link EvaluatorCheck} and handing it to the
 * scoring path through `ScoreSubmissionOptions.checks`, which runs {@link validateEvaluatorCheck}
 * before the check becomes reachable. Adding one therefore never requires editing this package's
 * scoring code: the scoring path consults the checks it is handed and reads each verdict against the
 * case ids that check declares, rather than branching on the name of a particular check or case.
 *
 * What a check replaces is the built-in canonical comparison of `src/scoring/compare-recorded-output`,
 * which remains the sole decider of every case when no check is supplied. A contributed check can
 * therefore change how one case's evidence is judged while the fixture set, the standard version and
 * its pass rule stay exactly what the built-in path scores.
 *
 * Nothing here holds a database handle, reads a table, resolves a path, opens a file or reads an
 * environment variable: this module names only the type of the values a check is given and the type it
 * must return. The loader that produces the fixture data belongs to `@adem/sgi-fixtures`, and the
 * comparison primitive both this seam and the built-in path answer to belongs to
 * `src/scoring/compare-recorded-output`.
 *
 * A violation is a composition-time programming error rather than a request the product can answer,
 * so the guard throws {@link EvaluatorCheckValidationError} — carrying the stable code
 * `seam_validation` — and fails start-up loudly instead of returning a discriminated result.
 */

// Both imports are `import type`, which here is load-bearing rather than stylistic: `verbatimModuleSyntax`
// keeps them fully erased, so the mutual reference between this seam and the scoring path is a
// types-only cycle carrying no runtime edge in either direction. `src/scoring/score-submission` imports
// `EvaluatorCheck` from this module, and this module imports `CaseComparison` from
// `src/scoring/compare-recorded-output`. Rewriting either one as a plain import would create a real
// runtime cycle between the seam and scoring, and the module loader would resolve it in whichever
// order the entry point happened to import them.
import type { JsonValue } from "@adem/sgi-fixtures";
import type { CaseComparison } from "../scoring/compare-recorded-output";

/**
 * The refusal messages, composed once so every refusal reads the same and each names the member that
 * failed. Each states the rule it applies, which is what makes a start-up failure actionable rather
 * than a bare stack.
 */
const ID_MESSAGE = 'EvaluatorCheck field "id" must be a non-empty string.';
const TITLE_MESSAGE = 'EvaluatorCheck field "title" must be a non-empty string.';
const APPLIES_TO_MESSAGE =
  'EvaluatorCheck field "appliesTo" must be a non-empty array of non-empty strings.';
const COMPARE_MESSAGE = 'EvaluatorCheck field "compare" must be a function.';

/**
 * Whether a value is a string holding at least one non-whitespace character.
 *
 * The whitespace rule is this package's convention for authored text — the same one
 * `src/proposals/submit-proposal.ts` and `src/appeals/open-appeal.ts` apply to a proposal's rationale
 * and an appeal's reason — and here it decides validity only: {@link validateEvaluatorCheck} never
 * rewrites the text it accepts.
 */
function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether a value is an array holding at least one non-empty string.
 *
 * `every` and a length test are used rather than an index read, so the guard remains correct under
 * `noUncheckedIndexedAccess`: no element is ever read through an unchecked index.
 */
function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((caseId) => isNonEmptyTrimmedString(caseId))
  );
}

/**
 * The shape read from a {@link validateEvaluatorCheck} candidate before it is narrowed: every member
 * is read as an unknown value so the guard can check it without trusting the caller.
 */
interface EvaluatorCheckCandidate {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly appliesTo?: unknown;
  readonly compare?: unknown;
}

/**
 * An evaluator check a community extension can supply to the scoring path.
 *
 * **The five rules below are this package's own stated definition of the seam.** They are not a
 * restatement of a document that fixes them elsewhere, so a check is written against them and the
 * scoring path is expected to honour them:
 *
 * 1. A check **replaces the canonical comparison for the case ids it declares in `appliesTo`**. That
 *    substitution is the whole point of the seam: it is what lets a contribution change how a case is
 *    judged without any edit to this package's scoring code.
 * 2. A check is consulted **only** when a caller supplies it through `ScoreSubmissionOptions.checks`.
 *    The built-in evaluation path supplies none, so an ordinary run is unchanged by this module's
 *    existence: with no checks, the canonical comparison decides every case.
 * 3. The **first** check in the supplied list whose `appliesTo` includes a case id is the one used for
 *    that case, and a check is never consulted for a case it does not declare.
 * 4. A check **must be as deterministic as the built-in path**: no clock, no locale, no timezone, no
 *    network, no random source and no environment. The reproducibility the product promises — the same
 *    fixture evaluated twice yields identical per-case results and outcome — covers contributed
 *    checks, so a check whose verdict varies between two runs breaks an invariant of the report rather
 *    than merely producing an odd one.
 * 5. A check must return the **whole** {@link CaseComparison} record, not a bare verdict: the
 *    expected and actual canonical strings are what the report's per-case evidence is written from, so
 *    a check returning `match` alone would leave that evidence empty.
 *
 * `id`, `title` and `appliesTo` are read-only: a registered check is treated as immutable, and a
 * change to one is a new registration rather than an edit of an existing value.
 */
export interface EvaluatorCheck {
  /**
   * The stable machine key naming this check in a report's provenance and in a composition root's
   * diagnostics. It is what an operator reads when asking which contribution produced a verdict.
   */
  readonly id: string;

  /** The human-facing label shown wherever the check is listed, for example `Strict key-set check`. */
  readonly title: string;

  /**
   * The fixture case ids this check decides, and the only cases it is ever consulted for.
   *
   * At least one id is required — see {@link validateEvaluatorCheck} — because a check that declares
   * no case can never run. A repeated id is harmless: rule 3 above makes the first match win, so the
   * repeat is never reached.
   */
  readonly appliesTo: readonly string[];

  /**
   * Produces the verdict on one case's recorded output.
   *
   * Declared as a method so a plain object literal satisfies the seam without a class. It takes the
   * case's expected output and the output the candidate recorded for it, and it returns the
   * {@link CaseComparison} the report stores — all four members, per rule 5 above.
   *
   * The recorded side may be `undefined`, and that is a defined input rather than an error: a
   * submission may legitimately answer fewer cases than its standard version defines, so a check must
   * handle it the way the built-in comparison does, by returning a non-match with `reason`
   * `"absent"` and an empty `actualCanonical`. Like that comparison, a check must not throw for a
   * legitimate input — whatever it is handed is plain JSON data, and how a missing recording is
   * reported is a value to return rather than an exception to raise.
   */
  compare(expected: JsonValue, actual: JsonValue | undefined): CaseComparison;
}

/**
 * Raised when a value offered as an {@link EvaluatorCheck} fails the seam's validation.
 *
 * The error is typed and machine-readable: `code` is the stable `seam_validation` identifier and
 * `field` names the member that failed, so a composition root can report precisely which contribution
 * is wrong. There is no HTTP status for this code — a seam violation is a programming error raised at
 * registration time, not a request the product answers.
 */
export class EvaluatorCheckValidationError extends Error {
  readonly code: string = "seam_validation";

  /** The member that failed validation: `id`, `title`, `appliesTo` or `compare`. */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "EvaluatorCheckValidationError";
    this.field = field;
  }
}

/**
 * Narrows an untrusted value to an {@link EvaluatorCheck}, returning the very same object widened no
 * further: nothing is cloned, frozen or copied, extra properties are left untouched, and the text
 * members are never rewritten. A plain object satisfying the interface is enough — the candidate need
 * not be an instance of a class.
 *
 * It reads the members in a fixed order and throws on the first failure, so a candidate wrong in
 * several members always reports the earliest one:
 *
 * 1. `id` — a string whose value is non-empty after `trim()`. A candidate that is not a non-null
 *    object (`null`, `undefined`, a number, a string, an array) fails here.
 * 2. `title` — a string whose value is non-empty after `trim()`.
 * 3. `appliesTo` — an array with at least one element, every element a string whose value is
 *    non-empty after `trim()`.
 * 4. `compare` — a function.
 *
 * The whitespace rule for the three text members is this package's convention for authored text:
 * trimming decides validity only, so a padded title such as `"  Strict key-set check  "` is accepted
 * and returned verbatim rather than trimmed.
 *
 * **Requiring at least one entry in `appliesTo` is this seam's own judgment call**, not a rule an
 * external document states. A check that declares no case id can never be consulted under rule 3 of
 * {@link EvaluatorCheck}, so registering one is a mistake, and catching it at registration reports the
 * mistake where it was made instead of leaving a contribution that silently does nothing. A repeated
 * case id inside `appliesTo` is deliberately accepted: the first match wins, so the repeat is inert.
 *
 * The return value of `compare` is deliberately neither validated nor called. What this guard decides
 * is the shape of a registration, and calling a contributor's function while validating would make
 * registration run arbitrary work, order it unpredictably against the caller's own state, and surface
 * a failure at the wrong moment. A verdict that is wrong for its case is a scoring concern; a verdict
 * that is not a comparison at all is refused by the scoring path that consumes it.
 *
 * Returns the validated check. Refuses — by throwing {@link EvaluatorCheckValidationError} with `code`
 * `seam_validation` and the offending `field` — any candidate that fails one of the four checks above;
 * it never returns a partially validated value.
 */
export function validateEvaluatorCheck(candidate: unknown): EvaluatorCheck {
  if (typeof candidate !== "object" || candidate === null) {
    throw new EvaluatorCheckValidationError("id", ID_MESSAGE);
  }

  const { id, title, appliesTo, compare } = candidate as EvaluatorCheckCandidate;

  if (!isNonEmptyTrimmedString(id)) {
    throw new EvaluatorCheckValidationError("id", ID_MESSAGE);
  }

  if (!isNonEmptyTrimmedString(title)) {
    throw new EvaluatorCheckValidationError("title", TITLE_MESSAGE);
  }

  if (!isNonEmptyStringArray(appliesTo)) {
    throw new EvaluatorCheckValidationError("appliesTo", APPLIES_TO_MESSAGE);
  }

  if (typeof compare !== "function") {
    throw new EvaluatorCheckValidationError("compare", COMPARE_MESSAGE);
  }

  return candidate as EvaluatorCheck;
}
