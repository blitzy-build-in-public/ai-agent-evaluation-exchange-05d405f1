/**
 * What this file proves about the extension registry.
 *
 * Two things, and neither is a restatement of a sibling seam's own tests. First, the registry's own
 * contract: registration order, the per-kind uniqueness keys, the first-registration-wins rule, the
 * frozen snapshot accessors, the empty start and the isolation of two registries created by two
 * calls. Second, the seam's acceptance assertion — **a contribution registered here scores through
 * the real scoring path with no file under `src/scoring/` edited** — which is checked twice: by
 * scoring a seed candidate through a pack read back from the registry, and by scanning the scoring
 * sources for any trace of the ids this test registers.
 *
 * The refusals a *guard* makes are not re-tested here. Each guard belongs to the module that owns its
 * rule, and `./fixture-pack.test.ts`, `./evaluator-check.test.ts` and `./listing-category.test.ts`
 * own those cases; what the registry adds is the *order* of its three steps, which is what the
 * malformed-duplicate case below pins down.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCandidate, loadCaseSet } from "@adem/sgi-fixtures";
import { compareRecordedOutput } from "../scoring/compare-recorded-output";

import type { EvaluatorCheck } from "./evaluator-check";
import type { FixturePack } from "./fixture-pack";
import type { ListingCategory } from "./listing-category";
import { EvaluatorCheckValidationError } from "./evaluator-check";
import { DuplicateExtensionError, createExtensionRegistry } from "./extension-registry";
import { FixturePackValidationError } from "./fixture-pack";
import { ListingCategoryValidationError } from "./listing-category";
import { SGI_SO_1_0_0 } from "../standards/sgi-so-1.0.0";

/** The standard version every pack in this file declares, and the case set it loads when asked. */
const STANDARD_VERSION_ID = "SGI-SO-1.0.0";

/** The ids the seam-acceptance scan asserts are absent from this package's scoring sources. */
const EXTENSION_PACK_ID = "community-extension-pack";
const EXTENSION_CHECK_ID = "community-extension-check";
const EXTENSION_CATEGORY_SLUG = "community-extension-tools";

/**
 * A pack satisfying the seam. `loadCaseSet` is never called by the registry or by any guard, so
 * building one costs nothing until a test asks for the case set.
 */
function makeFixturePack(id: string, standardVersionId: string = STANDARD_VERSION_ID): FixturePack {
  return {
    id,
    standardVersionId,
    title: `Fixture pack ${id}`,
    loadCaseSet: () => loadCaseSet(standardVersionId),
  };
}

/**
 * A check satisfying the seam. Its `compare` is a fixed verdict because neither the registry nor the
 * guard calls it: the guard validates the shape of a registration and deliberately does not run a
 * contributor's function, so a check is scored by the scoring path that consumes it, not here.
 */
function makeEvaluatorCheck(id: string): EvaluatorCheck {
  return {
    id,
    title: `Evaluator check ${id}`,
    appliesTo: ["so-001"],
    compare: () => ({ match: true, expectedCanonical: "{}", actualCanonical: "{}", reason: "match" }),
  };
}

/** A category satisfying the seam's slug pattern. */
function makeListingCategory(slug: string): ListingCategory {
  return {
    slug,
    name: "Logistics tools",
    description: "Agents that plan, track and reconcile shipments.",
  };
}

/** Runs a registration expected to collide, and returns the typed refusal it raised. */
function catchDuplicateError(register: () => void): DuplicateExtensionError {
  try {
    register();
  } catch (error) {
    if (error instanceof DuplicateExtensionError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the registration to be refused as a duplicate");
}

/**
 * Runs a registration expected to be refused by a guard, and narrows the refusal to the class that
 * guard owns. All three seam error classes share the `(field, message)` constructor, so one helper
 * serves each of them without a cast at the call site.
 */
function catchSeamRefusal<T extends Error>(
  register: () => void,
  errorClass: new (field: string, message: string) => T,
): T {
  try {
    register();
  } catch (error) {
    if (error instanceof errorClass) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the registration to be refused by the seam guard");
}

describe("createExtensionRegistry", () => {
  it("starts empty, with no built-in case set pre-registered", () => {
    const registry = createExtensionRegistry();

    expect(registry.listFixturePacks()).toEqual([]);
    expect(registry.listEvaluatorChecks()).toEqual([]);
    expect(registry.listListingCategories()).toEqual([]);
    expect(registry.getFixturePack(STANDARD_VERSION_ID)).toBeNull();
  });

  it("returns a registry that holds no state shared with another registry", () => {
    const first = createExtensionRegistry();
    const second = createExtensionRegistry();

    first.registerFixturePack(makeFixturePack(EXTENSION_PACK_ID));
    first.registerEvaluatorCheck(makeEvaluatorCheck(EXTENSION_CHECK_ID));
    first.registerListingCategory(makeListingCategory(EXTENSION_CATEGORY_SLUG));

    expect(first.listFixturePacks()).toHaveLength(1);
    expect(second.listFixturePacks()).toEqual([]);
    expect(second.listEvaluatorChecks()).toEqual([]);
    expect(second.listListingCategories()).toEqual([]);
    expect(second.getFixturePack(EXTENSION_PACK_ID)).toBeNull();
  });
});

describe("registration order", () => {
  it("keeps each kind in the order it was registered", () => {
    const registry = createExtensionRegistry();

    registry.registerFixturePack(makeFixturePack("pack-b"));
    registry.registerFixturePack(makeFixturePack("pack-a"));
    registry.registerEvaluatorCheck(makeEvaluatorCheck("check-y"));
    registry.registerEvaluatorCheck(makeEvaluatorCheck("check-x"));
    registry.registerListingCategory(makeListingCategory("logistics-tools"));
    registry.registerListingCategory(makeListingCategory("data-pipelines"));

    expect(registry.listFixturePacks().map((pack) => pack.id)).toEqual(["pack-b", "pack-a"]);
    expect(registry.listEvaluatorChecks().map((check) => check.id)).toEqual(["check-y", "check-x"]);
    expect(registry.listListingCategories().map((category) => category.slug)).toEqual([
      "logistics-tools",
      "data-pipelines",
    ]);
  });

  it("stores the contribution itself rather than a copy of it", () => {
    const registry = createExtensionRegistry();
    const pack = makeFixturePack("pack-a");

    registry.registerFixturePack(pack);

    expect(registry.listFixturePacks()[0]).toBe(pack);
    expect(registry.getFixturePack("pack-a")).toBe(pack);
  });
});

describe("duplicate refusal", () => {
  it("refuses a second fixture pack registered under the same id", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack(makeFixturePack(EXTENSION_PACK_ID));

    const error = catchDuplicateError(() => {
      registry.registerFixturePack(makeFixturePack(EXTENSION_PACK_ID));
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DuplicateExtensionError);
    expect(error.name).toBe("DuplicateExtensionError");
    expect(error.code).toBe("duplicate_extension");
    expect(error.kind).toBe("fixture-pack");
    expect(error.id).toBe(EXTENSION_PACK_ID);
    expect(error.message).toBe(
      `A fixture-pack with id "${EXTENSION_PACK_ID}" is already registered.`,
    );
  });

  it("refuses a second evaluator check registered under the same id", () => {
    const registry = createExtensionRegistry();
    registry.registerEvaluatorCheck(makeEvaluatorCheck(EXTENSION_CHECK_ID));

    const error = catchDuplicateError(() => {
      registry.registerEvaluatorCheck(makeEvaluatorCheck(EXTENSION_CHECK_ID));
    });

    expect(error.name).toBe("DuplicateExtensionError");
    expect(error.code).toBe("duplicate_extension");
    expect(error.kind).toBe("evaluator-check");
    expect(error.id).toBe(EXTENSION_CHECK_ID);
    expect(error.message).toBe(
      `A evaluator-check with id "${EXTENSION_CHECK_ID}" is already registered.`,
    );
  });

  it("refuses a second listing category registered under the same slug", () => {
    const registry = createExtensionRegistry();
    registry.registerListingCategory(makeListingCategory(EXTENSION_CATEGORY_SLUG));

    const error = catchDuplicateError(() => {
      registry.registerListingCategory(makeListingCategory(EXTENSION_CATEGORY_SLUG));
    });

    expect(error.name).toBe("DuplicateExtensionError");
    expect(error.code).toBe("duplicate_extension");
    expect(error.kind).toBe("listing-category");
    expect(error.id).toBe(EXTENSION_CATEGORY_SLUG);
    expect(error.message).toBe(
      `A listing-category with id "${EXTENSION_CATEGORY_SLUG}" is already registered.`,
    );
  });

  it("lets the first registration win and leaves the registry exactly as it was", () => {
    const registry = createExtensionRegistry();
    const firstPack = makeFixturePack(EXTENSION_PACK_ID);
    const firstCheck = makeEvaluatorCheck(EXTENSION_CHECK_ID);
    registry.registerFixturePack(firstPack);
    registry.registerEvaluatorCheck(firstCheck);

    catchDuplicateError(() => {
      registry.registerFixturePack(makeFixturePack(EXTENSION_PACK_ID));
    });
    catchDuplicateError(() => {
      registry.registerEvaluatorCheck(makeEvaluatorCheck(EXTENSION_CHECK_ID));
    });

    expect(registry.listFixturePacks()).toHaveLength(1);
    expect(registry.listEvaluatorChecks()).toHaveLength(1);
    expect(registry.getFixturePack(EXTENSION_PACK_ID)).toBe(firstPack);
    expect(registry.listEvaluatorChecks()[0]).toBe(firstCheck);
  });
});

describe("per-kind namespaces", () => {
  it("accepts one string as a fixture pack id, an evaluator check id and a category slug", () => {
    const registry = createExtensionRegistry();

    registry.registerFixturePack(makeFixturePack("community-extension"));
    registry.registerEvaluatorCheck(makeEvaluatorCheck("community-extension"));
    registry.registerListingCategory(makeListingCategory("community-extension"));

    expect(registry.getFixturePack("community-extension")).not.toBeNull();
    expect(registry.listEvaluatorChecks()).toHaveLength(1);
    expect(registry.listListingCategories()).toHaveLength(1);
  });

  it("refuses a repeat inside one kind while another kind holds the same string", () => {
    const registry = createExtensionRegistry();
    registry.registerEvaluatorCheck(makeEvaluatorCheck("community-extension"));
    registry.registerListingCategory(makeListingCategory("community-extension"));

    const error = catchDuplicateError(() => {
      registry.registerEvaluatorCheck(makeEvaluatorCheck("community-extension"));
    });

    expect(error.kind).toBe("evaluator-check");
    expect(registry.listEvaluatorChecks()).toHaveLength(1);
  });
});

describe("getFixturePack", () => {
  it("resolves a known id by identity and an unknown id to null", () => {
    const registry = createExtensionRegistry();
    const pack = makeFixturePack("pack-a");
    registry.registerFixturePack(pack);

    expect(registry.getFixturePack("pack-a")).toBe(pack);
    expect(registry.getFixturePack("pack-b")).toBeNull();
    expect(registry.getFixturePack("")).toBeNull();
  });

  it("exposes exactly the seven members the interface fixes", () => {
    const registry = createExtensionRegistry();

    expect(Object.keys(registry).sort()).toEqual([
      "getFixturePack",
      "listEvaluatorChecks",
      "listFixturePacks",
      "listListingCategories",
      "registerEvaluatorCheck",
      "registerFixturePack",
      "registerListingCategory",
    ]);
  });
});

describe("malformed registrations", () => {
  it("refuses a pack whose id is empty and registers nothing", () => {
    const registry = createExtensionRegistry();

    const error = catchSeamRefusal(() => {
      registry.registerFixturePack({ ...makeFixturePack("pack-a"), id: "   " });
    }, FixturePackValidationError);

    expect(error).toBeInstanceOf(FixturePackValidationError);
    expect(error.name).toBe("FixturePackValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("id");
    expect(registry.listFixturePacks()).toEqual([]);
  });

  it("refuses a pack whose loadCaseSet is not a function, and a non-object candidate", () => {
    const registry = createExtensionRegistry();

    const notAFunction = catchSeamRefusal(() => {
      registry.registerFixturePack({
        ...makeFixturePack("pack-a"),
        loadCaseSet: "not a function",
      } as unknown as FixturePack);
    }, FixturePackValidationError);
    const notAnObject = catchSeamRefusal(() => {
      registry.registerFixturePack(null as unknown as FixturePack);
    }, FixturePackValidationError);

    expect(notAFunction.field).toBe("loadCaseSet");
    expect(notAnObject.field).toBe("id");
    expect(registry.listFixturePacks()).toEqual([]);
  });

  it("refuses a check that declares no case and registers nothing", () => {
    const registry = createExtensionRegistry();

    const error = catchSeamRefusal(() => {
      registry.registerEvaluatorCheck({ ...makeEvaluatorCheck("check-a"), appliesTo: [] });
    }, EvaluatorCheckValidationError);

    expect(error).toBeInstanceOf(EvaluatorCheckValidationError);
    expect(error.name).toBe("EvaluatorCheckValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("appliesTo");
    expect(registry.listEvaluatorChecks()).toEqual([]);
  });

  it("refuses a category whose slug breaks the pattern and registers nothing", () => {
    const registry = createExtensionRegistry();

    const error = catchSeamRefusal(() => {
      registry.registerListingCategory({ ...makeListingCategory("logistics-tools"), slug: "Bad Slug" });
    }, ListingCategoryValidationError);

    expect(error).toBeInstanceOf(ListingCategoryValidationError);
    expect(error.name).toBe("ListingCategoryValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("slug");
    expect(registry.listListingCategories()).toEqual([]);
  });

  it("reports a malformed duplicate as malformed, because the guard runs before the duplicate check", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack(makeFixturePack(EXTENSION_PACK_ID));

    const error = catchSeamRefusal(() => {
      registry.registerFixturePack({ ...makeFixturePack(EXTENSION_PACK_ID), title: "" });
    }, FixturePackValidationError);

    expect(error.field).toBe("title");
    expect(registry.getFixturePack(EXTENSION_PACK_ID)).not.toBeNull();
  });
});

describe("snapshot accessors", () => {
  it("returns a frozen array from every accessor", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack(makeFixturePack("pack-a"));
    registry.registerEvaluatorCheck(makeEvaluatorCheck("check-a"));
    registry.registerListingCategory(makeListingCategory("logistics-tools"));

    expect(Object.isFrozen(registry.listFixturePacks())).toBe(true);
    expect(Object.isFrozen(registry.listEvaluatorChecks())).toBe(true);
    expect(Object.isFrozen(registry.listListingCategories())).toBe(true);
  });

  it("returns a distinct array with equal contents on each call", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack(makeFixturePack("pack-a"));

    const first = registry.listFixturePacks();
    const second = registry.listFixturePacks();

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it("refuses a mutation of the array it returned, leaving the registry unchanged", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack(makeFixturePack("pack-a"));

    const snapshot = registry.listFixturePacks();

    expect(() => {
      (snapshot as unknown as FixturePack[]).push(makeFixturePack("pack-b"));
    }).toThrow(TypeError);
    expect(registry.listFixturePacks().map((pack) => pack.id)).toEqual(["pack-a"]);
  });

  it("does not grow an array obtained before a later registration", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack(makeFixturePack("pack-a"));

    const beforeLaterRegistration = registry.listFixturePacks();
    registry.registerFixturePack(makeFixturePack("pack-b"));

    expect(beforeLaterRegistration.map((pack) => pack.id)).toEqual(["pack-a"]);
    expect(registry.listFixturePacks().map((pack) => pack.id)).toEqual(["pack-a", "pack-b"]);
  });
});

/**
 * The machine-checked half of the seam's acceptance assertion: a contribution registered here is
 * scored by the shipped path with the scoring sources untouched, so nothing under `src/scoring/`
 * names an extension. The directory is read from disk and scanned whole — asserted non-empty first,
 * so the scan cannot pass vacuously over an empty directory — rather than over a file list this test
 * maintains by hand, which would go stale the moment the scoring path gained a module.
 */
describe("seam acceptance: a registered contribution needs no scoring edit", () => {
  it("finds no trace of a registered extension id in the scoring sources", () => {
    const scoringDirectory = fileURLToPath(new URL("../scoring/", import.meta.url));
    const scoringFiles = readdirSync(scoringDirectory).filter((name) => name.endsWith(".ts"));

    expect(scoringFiles.length).toBeGreaterThan(0);
    expect(scoringFiles).toContain("compare-recorded-output.ts");

    for (const name of scoringFiles) {
      const source = readFileSync(join(scoringDirectory, name), "utf8");

      expect(source).not.toContain(EXTENSION_PACK_ID);
      expect(source).not.toContain(EXTENSION_CHECK_ID);
      expect(source).not.toContain(EXTENSION_CATEGORY_SLUG);
    }
  });
});

/**
 * The behavioural half of the same assertion: the case set a registered pack hands the scoring path
 * is the shipped one, and the shipped comparison judges a real seed candidate match for match on
 * every case of it.
 *
 * The per-case judging below calls the shipped comparison primitive itself —
 * `../scoring/compare-recorded-output`, the module that decides every case of an ordinary evaluation
 * — rather than a comparison written here, because the seam's claim is precisely that a contribution
 * is judged by the shipped path and restating that path in the test would prove nothing about it.
 * The pass rule that turns a run's matches into an outcome is not restated here either: it belongs
 * to the scoring entry point and to the standard version it is read from.
 */
describe("seam acceptance: the registered pack is judged by the shipped path", () => {
  it("hands the scoring path the shipped case set and matches every seed case through it", () => {
    const registry = createExtensionRegistry();
    registry.registerFixturePack({
      id: EXTENSION_PACK_ID,
      standardVersionId: SGI_SO_1_0_0.versionLabel,
      title: "Community extension pack",
      loadCaseSet: () => loadCaseSet(SGI_SO_1_0_0.fixtureSetId),
    });

    const pack = registry.getFixturePack(EXTENSION_PACK_ID);
    if (pack === null) {
      throw new Error(`expected ${EXTENSION_PACK_ID} to resolve from the registry`);
    }

    const caseSet = pack.loadCaseSet();
    expect(caseSet).toEqual(loadCaseSet(SGI_SO_1_0_0.fixtureSetId));
    expect(caseSet.total_cases).toBe(SGI_SO_1_0_0.totalCases);

    const submission = loadCandidate("seed-alpha");
    const recordedOutputs = new Map(
      submission.recorded_outputs.map((recorded) => [recorded.case_id, recorded.output]),
    );
    const judge = () =>
      caseSet.cases.map((fixtureCase) =>
        compareRecordedOutput(fixtureCase.expected_output, recordedOutputs.get(fixtureCase.id)),
      );

    const results = judge();

    expect(results).toHaveLength(SGI_SO_1_0_0.totalCases);
    expect(results.filter((result) => !result.match)).toEqual([]);

    // The reproducibility the evaluation promises: the same fixture judged twice compares equal.
    expect(judge()).toEqual(results);
  });
});
