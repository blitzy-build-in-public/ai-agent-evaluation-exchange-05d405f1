/**
 * The extension registry: the resolution half of this package's three extension seams.
 *
 * A community contribution is added by implementing {@link FixturePack}, {@link EvaluatorCheck} or
 * {@link ListingCategory} — the interfaces this folder's three sibling modules declare — and
 * registering it here. The registry is where a malformed contribution is refused: every registration
 * runs the seam's own guard before the contribution becomes reachable, so a defect surfaces at
 * composition time, where a maintainer can see which registration is wrong, rather than during an
 * evaluation.
 *
 * The rules a contributor works against, stated once here because the members below rely on them:
 *
 * - Each kind keeps its own namespace and its own uniqueness key: fixture packs and evaluator checks
 *   are keyed by `id`, listing categories by `slug`. The three namespaces are independent — the same
 *   string may legitimately be a pack `id` and a check `id`, because no accessor resolves across
 *   kinds — while a repeat within one kind is always refused.
 * - A repeat within a kind is refused with {@link DuplicateExtensionError}, and the first
 *   registration wins: a refused duplicate leaves the registry exactly as it was.
 * - `createExtensionRegistry()` returns a fresh, empty registry on every call. There is no
 *   module-level singleton, so a registration cannot leak from one composition root, test or suite
 *   run into another, and the composition root decides where the registry lives. The built-in
 *   `SGI-SO-1.0.0` case set is deliberately not pre-registered, so a contribution can never displace
 *   the shipped path.
 * - Every accessor returns a new frozen snapshot in registration order, so a caller can neither
 *   mutate the registry's state through a returned array nor observe a registration that happens
 *   after the call.
 *
 * Nothing here holds a database handle, reads a table, resolves a path, opens a file, reads an
 * environment variable or consults a clock: the registry is in memory and pure. Its runtime graph is
 * the three sibling guards and nothing else — in particular it imports nothing from
 * `@adem/sgi-fixtures`, which is what keeps the shipped case set out of the registry and a
 * contribution out of the shipped path.
 */

// Two statements per seam module: the interface is a type-only import and the guard a value import.
// `verbatimModuleSyntax` keeps the three type imports fully erased, so they add no runtime edge and
// the three guards below are the only value imports this module makes. Validation belongs to the
// guard that owns the rule, so the registry sequences guard -> duplicate -> append and re-implements
// no part of any rule: that is why a seam's own test file owns its refusal cases.
import type { FixturePack } from "./fixture-pack";
import type { EvaluatorCheck } from "./evaluator-check";
import type { ListingCategory } from "./listing-category";
import { validateFixturePack } from "./fixture-pack";
import { validateEvaluatorCheck } from "./evaluator-check";
import { validateListingCategory } from "./listing-category";

/**
 * Raised when a contribution is registered under a uniqueness key this registry already holds.
 *
 * The class name and `code` are fixed: `duplicate_extension` is the stable identifier this package's
 * error table names, and it is a **composition-time programming error that is never a route case** —
 * no HTTP status answers it, because a duplicate registration is a defect in the composition root or
 * a collision between two contributions, not something a caller of the API can trigger. The `kind`
 * and `id` fields are this module's own enrichment of that refusal: they exist to make the failing
 * start-up message precise, so a maintainer reads which of the three kinds collided and on which
 * key.
 */
export class DuplicateExtensionError extends Error {
  /** The stable machine-readable code for this refusal: `duplicate_extension`. */
  readonly code: string = "duplicate_extension";

  /**
   * The uniqueness key the second registration used: a fixture pack's or evaluator check's `id`, or
   * a listing category's `slug`.
   */
  readonly id: string;

  /** Which of the three extension kinds the duplicate belongs to. */
  readonly kind: "fixture-pack" | "evaluator-check" | "listing-category";

  constructor(kind: "fixture-pack" | "evaluator-check" | "listing-category", id: string) {
    super(`A ${kind} with id "${id}" is already registered.`);
    this.name = "DuplicateExtensionError";
    this.kind = kind;
    this.id = id;
  }
}

/**
 * The registry a composition root resolves this package's extension seams through.
 *
 * Every member is documented with the rule it applies, so this interface is the contributor-facing
 * statement of the registration contract rather than a bare list of methods.
 */
export interface ExtensionRegistry {
  /**
   * Registers a fixture pack, in three ordered steps: the seam's own guard first, then the duplicate
   * check, then the append.
   *
   * Because the guard runs before the duplicate check, a malformed contribution is reported as
   * malformed rather than as a duplicate of the pack it collides with.
   *
   * @param pack - The pack to register.
   * @returns Nothing; a caller that wants the stored pack reads it back through
   * {@link ExtensionRegistry.getFixturePack} or {@link ExtensionRegistry.listFixturePacks}.
   * @throws FixturePackValidationError when the pack fails the seam's validation.
   * @throws DuplicateExtensionError when a pack is already registered under the same `id`. The
   * registry is left exactly as it was, so the earlier pack remains the one `getFixturePack`
   * returns.
   */
  registerFixturePack(pack: FixturePack): void;

  /**
   * Registers an evaluator check, in the same three ordered steps as
   * {@link ExtensionRegistry.registerFixturePack}. A registered check is a contribution the caller
   * may hand to the scoring path through its options; registering it here neither runs it nor makes
   * the built-in path use it.
   *
   * @param check - The check to register.
   * @returns Nothing.
   * @throws EvaluatorCheckValidationError when the check fails the seam's validation.
   * @throws DuplicateExtensionError when a check is already registered under the same `id`.
   */
  registerEvaluatorCheck(check: EvaluatorCheck): void;

  /**
   * Registers a listing category, in the same three ordered steps as
   * {@link ExtensionRegistry.registerFixturePack}. This kind's uniqueness key is its `slug`, which is
   * what a seeded `categories` row carries.
   *
   * @param category - The category to register.
   * @returns Nothing.
   * @throws ListingCategoryValidationError when the category fails the seam's validation.
   * @throws DuplicateExtensionError when a category is already registered under the same `slug`.
   */
  registerListingCategory(category: ListingCategory): void;

  /**
   * Lists the registered fixture packs.
   *
   * @returns A **new** frozen array in registration order on every call, so mutating it throws in
   * strict mode, two calls are equal in contents but distinct arrays, and an array obtained before a
   * later registration does not grow. Freezing the array does not freeze the packs themselves: the
   * registry owns the collection, not the objects a contributor handed it.
   */
  listFixturePacks(): readonly FixturePack[];

  /** @returns A new frozen array of the registered evaluator checks in registration order. */
  listEvaluatorChecks(): readonly EvaluatorCheck[];

  /** @returns A new frozen array of the registered listing categories in registration order. */
  listListingCategories(): readonly ListingCategory[];

  /**
   * Resolves one fixture pack by its `id`. This is the registry's only single-item lookup: the other
   * two kinds are read as lists, which is why their namespaces never need to agree with this one's.
   *
   * @param id - The pack's `id`.
   * @returns The registered pack **by identity** — nothing is cloned or wrapped — or `null` when no
   * pack is registered under that `id`.
   */
  getFixturePack(id: string): FixturePack | null;
}

/**
 * Creates a registry that starts empty and is reachable only through the value returned here.
 *
 * There is no module-level registry and no module-level mutable state: the three ordered arrays live
 * in this call's closure, so two calls are isolated from each other, a new registry starts empty, and
 * a test that registers a contribution cannot leak it into the next test in the same process.
 *
 * @returns A fresh, empty {@link ExtensionRegistry}.
 */
export function createExtensionRegistry(): ExtensionRegistry {
  /** Registered fixture packs, in registration order. */
  const fixturePacks: FixturePack[] = [];

  /** Registered evaluator checks, in registration order. */
  const evaluatorChecks: EvaluatorCheck[] = [];

  /** Registered listing categories, in registration order. */
  const listingCategories: ListingCategory[] = [];

  function registerFixturePack(pack: FixturePack): void {
    const validated = validateFixturePack(pack);
    if (fixturePacks.some((registered) => registered.id === validated.id)) {
      throw new DuplicateExtensionError("fixture-pack", validated.id);
    }
    fixturePacks.push(validated);
  }

  function registerEvaluatorCheck(check: EvaluatorCheck): void {
    const validated = validateEvaluatorCheck(check);
    if (evaluatorChecks.some((registered) => registered.id === validated.id)) {
      throw new DuplicateExtensionError("evaluator-check", validated.id);
    }
    evaluatorChecks.push(validated);
  }

  function registerListingCategory(category: ListingCategory): void {
    const validated = validateListingCategory(category);
    if (listingCategories.some((registered) => registered.slug === validated.slug)) {
      throw new DuplicateExtensionError("listing-category", validated.slug);
    }
    listingCategories.push(validated);
  }

  function listFixturePacks(): readonly FixturePack[] {
    return Object.freeze([...fixturePacks]);
  }

  function listEvaluatorChecks(): readonly EvaluatorCheck[] {
    return Object.freeze([...evaluatorChecks]);
  }

  function listListingCategories(): readonly ListingCategory[] {
    return Object.freeze([...listingCategories]);
  }

  function getFixturePack(id: string): FixturePack | null {
    return fixturePacks.find((pack) => pack.id === id) ?? null;
  }

  return {
    registerFixturePack,
    registerEvaluatorCheck,
    registerListingCategory,
    listFixturePacks,
    listEvaluatorChecks,
    listListingCategories,
    getFixturePack,
  };
}
