/**
 * The single public entry of `@adem/extension-fixture-pack`: the in-repository example that proves a
 * community `FixturePack` plugs into `@adem/sgi-core`'s extension seam.
 *
 * The package contributes one fixture pack — this extension's own case set — to a registry the
 * composing application creates. It registers through the exported `FixturePack` interface and the
 * exported `registerFixturePack` member alone, and no file under `packages/sgi-core/src/scoring/` is
 * edited, imported or otherwise depended on by that contribution: the scoring path is handed a case
 * set and the standard version whose criteria it is scored under, so adding a pack is a registration
 * rather than a change to the evaluator. A contributor reading this file as the worked reference for
 * the starter task "add a fixture pack through the `FixturePack` seam" needs nothing else.
 *
 * This module is the only entry a consumer reaches. `package.json` exposes exactly `"."`, so a name
 * it does not re-export is unreachable from outside the package — which is why the two wiring
 * functions below live here rather than in `./pack`, whose own declarations stay an implementation
 * detail. Everything is re-exported by name: `export *` would let a later declaration in `./pack`
 * reach consumers silently, and this surface is meant to be read in one file.
 *
 * The split between the two re-export statements is required rather than stylistic.
 * `verbatimModuleSyntax` is on in `tsconfig.base.json`, so a type crosses in a type-only statement
 * and a value or a function in a value statement; naming a type in the value statement would be a
 * compile error, not a harmless elision.
 *
 * **No state lives here.** There is no module-level registry, no cache and no statement executed for
 * its effect at import time, so two callers cannot observe each other's registrations and no test can
 * leak a contribution into the next. Constructing a registry belongs to the caller;
 * {@link createExampleExtensionRegistry} is a convenience for a demonstration or a test that wants a
 * registry already holding this pack, and it builds a fresh one on every call.
 *
 * Nothing here reads a clock, a locale, a timezone, a random source, an environment variable, a file
 * or a network, and nothing here executes a submission: the case set is read by `./pack`, whose loader
 * is the pack's own business, and the comparison that turns a case set into an outcome belongs to
 * `@adem/sgi-core`.
 */

import type { ExtensionRegistry, FixturePack } from "@adem/sgi-core";
import { createExtensionRegistry } from "@adem/sgi-core";
import { createExampleFixturePack } from "./pack";

/**
 * This extension's case set and its identity, re-exported so a consumer of the package reads the
 * pack's id, its standard version and its title from the same entry it gets the factory from.
 *
 * `createExampleFixturePack` is named in both this statement and the import above on purpose: the
 * import is what {@link registerExampleFixturePack} and {@link createExampleExtensionRegistry} call,
 * and the re-export is what makes the factory public. A consumer therefore creates the pack itself
 * or lets the wiring functions below do it, and both reach one implementation.
 */
export {
  createExampleFixturePack,
  EXAMPLE_FIXTURE_PACK_ID,
  EXAMPLE_FIXTURE_PACK_TITLE,
  EXAMPLE_STANDARD_VERSION_ID,
} from "./pack";

/**
 * The two seam types a consumer needs to work with this package without reaching into
 * `@adem/sgi-core`'s own entry: the pack a contributor implements, and the registry a composition
 * root registers it with. Declared as a separate type-only statement because they are erased at
 * compile time, and re-exported rather than restated so the contributor reads the seam's own
 * declaration and not a copy that could drift from it.
 */
export type { ExtensionRegistry, FixturePack } from "@adem/sgi-core";

/**
 * Registers this extension's fixture pack into `registry` and returns the pack it registered.
 *
 * The returned object is the very pack handed to the registry — the same identity, not a copy and not
 * a lookup result — so a caller can assert that the registry resolves this pack by
 * `registry.getFixturePack(EXAMPLE_FIXTURE_PACK_ID)` without a second construction.
 *
 * @param registry - The registry to register into. It is created by the caller, so this function
 * holds no state of its own and is safe to call once per registry.
 * @returns The registered {@link FixturePack}, by identity.
 * @throws FixturePackValidationError when the pack fails the seam's own validation, and
 * DuplicateExtensionError when a pack is already registered under the same `id`. Both refusals are
 * raised by the registry and propagate unchanged — they are not caught, wrapped or translated here,
 * because a duplicate or malformed registration is a composition-time defect that must fail loudly
 * at the point of registration, and the classes carry the `code` and the offending member a caller
 * reports. The registry is left exactly as it was in either case.
 */
export function registerExampleFixturePack(registry: ExtensionRegistry): FixturePack {
  const pack = createExampleFixturePack();
  registry.registerFixturePack(pack);
  return pack;
}

/**
 * Builds a registry holding this extension's fixture pack and nothing else.
 *
 * Each call returns a **fresh, isolated** registry: `createExtensionRegistry()` is called inside, so
 * the returned registry shares no state with the one a previous call returned and neither can observe
 * the other's later registrations. It exists for demonstrations and tests, and it is the shape a real
 * composition root follows — create a registry, register the contributions it wants, hand the
 * registry to whatever resolves the seams.
 *
 * The shipped `SGI-SO-1.0.0` case set is deliberately not registered here, and not by the registry
 * either: a versioned standard is reached through the standards registry, so a contribution can never
 * displace or shadow the published path.
 *
 * @returns A new {@link ExtensionRegistry} holding one fixture pack: this example's.
 * @throws FixturePackValidationError or DuplicateExtensionError only if this package's own pack were
 * malformed or registered twice, which the single registration below cannot produce; the refusal
 * would propagate unchanged from the registry.
 */
export function createExampleExtensionRegistry(): ExtensionRegistry {
  const registry = createExtensionRegistry();
  registerExampleFixturePack(registry);
  return registry;
}
