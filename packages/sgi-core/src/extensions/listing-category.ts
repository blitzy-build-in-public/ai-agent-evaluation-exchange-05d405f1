/**
 * The listing-category extension seam.
 *
 * A new listing category is added by implementing {@link ListingCategory} and registering it
 * through the extension registry in this folder, which runs {@link validateListingCategory}
 * before the category becomes reachable. That is the designed growth path for the exchange's
 * categories, and it never requires editing this package's scoring code.
 *
 * The `categories` table and its four seeded rows belong to `apps/api/src/seed/seed-data.ts`,
 * not to this module: nothing here reads or writes a table, opens a connection or resolves a
 * path. The guard exists so that validation happens once, at registration and seed time, leaving
 * the API layer without a second validator.
 *
 * A category's `description` is registration metadata the registered value carries rather than a
 * stored column: the row of `packages/shared/migrations/0001_accounts_and_categories.sql` holds
 * the id, slug and name a listing is filtered by, and the catalogue a seed registers states the
 * description beside each of its categories. Nothing here claims a row stores the member, and
 * nothing reads one back.
 *
 * The seeded slugs are owned by that seed file and must themselves satisfy the pattern below; a
 * seed slug that cannot match is a defect to fix in that file, never a reason to widen the
 * pattern here.
 *
 * A violation is a composition-time programming error rather than a request the product can
 * answer, so the guard throws {@link ListingCategoryValidationError} — carrying the stable code
 * `seam_validation` — and fails start-up loudly instead of returning a discriminated result.
 */

/**
 * The pattern a listing-category `slug` must satisfy: one leading lowercase letter, then one to
 * thirty-one further characters drawn from `[a-z0-9-]` — two to thirty-two characters in total,
 * lowercase letters, digits and hyphens only.
 *
 * It deliberately accepts a repeated hyphen (`a--b`) and a trailing hyphen (`ab-`): the pattern is
 * this seam's own, and no further rule is layered on top of it. It refuses an underscore, a
 * space, an uppercase letter, a leading digit, a leading hyphen, a single-character slug and any
 * slug longer than thirty-two characters.
 *
 * Module-private on purpose: exactly three names are exported from this module and no consumer
 * reads the pattern directly. Callers and tests exercise the rule through
 * {@link validateListingCategory}.
 */
const LISTING_CATEGORY_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

const SLUG_MESSAGE =
  'ListingCategory field "slug" must match ^[a-z][a-z0-9-]{1,31}$ (two to thirty-two lowercase letters, digits or hyphens, starting with a letter).';
const NAME_MESSAGE = 'ListingCategory field "name" must be a non-empty string.';
const DESCRIPTION_MESSAGE = 'ListingCategory field "description" must be a non-empty string.';

/**
 * The shape read from a {@link validateListingCategory} candidate before it is narrowed: every
 * member is read as an unknown value so the guard can check it without trusting the caller.
 */
interface ListingCategoryCandidate {
  readonly slug?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
}

/**
 * A listing category a community extension can register.
 *
 * All three members are read-only: a registered category is treated as immutable, and a change to
 * one is a new registration rather than an edit of an existing value.
 */
export interface ListingCategory {
  /**
   * The stable machine key, and the registry's uniqueness key for this kind of extension. It is
   * what a seeded `categories` row carries, so it never changes once published.
   *
   * It must be two to thirty-two characters long, start with a lowercase letter, and contain only
   * lowercase letters, digits and hyphens (`^[a-z][a-z0-9-]{1,31}$`) — for example `logistics-tools`.
   */
  readonly slug: string;

  /** The human-facing label shown wherever the category is listed, for example `Logistics tools`. */
  readonly name: string;

  /**
   * A short, non-empty explanation of which agents the category covers. It is registration
   * metadata: the `categories` row stores the category's id, slug and name, not this member.
   */
  readonly description: string;
}

/**
 * Raised when a value offered as a {@link ListingCategory} fails the seam's validation.
 *
 * The error is typed and machine-readable: `code` is the stable `seam_validation` identifier and
 * `field` names the member that failed, so a composition root can report precisely which
 * registration or seed row is wrong. There is no HTTP status for this code — a seam violation is
 * a programming error raised at registration time, not a request the product answers.
 */
export class ListingCategoryValidationError extends Error {
  readonly code: string = "seam_validation";

  /** The member that failed validation: `slug`, `name` or `description`. */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ListingCategoryValidationError";
    this.field = field;
  }
}

/**
 * Narrows an untrusted value to a {@link ListingCategory}, returning the very same object widened
 * no further: nothing is cloned, frozen or copied, extra properties are left untouched, and the
 * text members are never rewritten.
 *
 * It reads the members in a fixed order and throws on the first failure, so a candidate wrong in
 * several fields always reports `slug` first:
 *
 * 1. `slug` — a string matching `^[a-z][a-z0-9-]{1,31}$` (see the private pattern above). A
 *    candidate that is not a non-null object (`null`, `undefined`, a number, a string) fails here.
 * 2. `name` — a string whose value is non-empty after `trim()`.
 * 3. `description` — a string whose value is non-empty after `trim()`.
 *
 * The whitespace rule for `name` and `description` is this package's convention for authored
 * text: trimming decides validity only, so a padded label such as `"  Logistics tools  "` is
 * accepted and returned verbatim rather than trimmed.
 *
 * Returns the validated category. Refuses — by throwing {@link ListingCategoryValidationError}
 * with `code` `seam_validation` and the offending `field` — any candidate that fails one of the
 * three checks above; it never returns a partially validated value.
 */
export function validateListingCategory(candidate: unknown): ListingCategory {
  if (typeof candidate !== "object" || candidate === null) {
    throw new ListingCategoryValidationError("slug", SLUG_MESSAGE);
  }

  const { slug, name, description } = candidate as ListingCategoryCandidate;

  if (typeof slug !== "string" || !LISTING_CATEGORY_SLUG_PATTERN.test(slug)) {
    throw new ListingCategoryValidationError("slug", SLUG_MESSAGE);
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ListingCategoryValidationError("name", NAME_MESSAGE);
  }

  if (typeof description !== "string" || description.trim().length === 0) {
    throw new ListingCategoryValidationError("description", DESCRIPTION_MESSAGE);
  }

  return candidate as ListingCategory;
}
