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
import type { CaseSet } from "@adem/sgi-fixtures";
import { scoreSubmission } from "../scoring/score-submission";

import type { EvaluatorCheck } from "./evaluator-check";
import type { ExtensionRegistry } from "./extension-registry";
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
 * A case set of this file's own, holding one case and no critical case.
 *
 * Built inline rather than loaded: what a pack's `loadCaseSet` returns is the pack's own business,
 * and the registry stores the contribution and deliberately never calls it, so a contribution may
 * bring cases no fixture file holds. The two counts restate the array beside them, which is the
 * internal consistency the scoring path checks once such a pack is actually scored.
 */
function makeOwnCaseSet(standardVersionId: string = STANDARD_VERSION_ID): CaseSet {
  return {
    standard_version_id: standardVersionId,
    total_cases: 1,
    critical_cases: 0,
    cases: [
      {
        id: "x-001",
        severity: "standard",
        input: {
          instruction: "Restate the source as a JSON object holding one field, named summary.",
          source: "A fictional shipment notice covering one staged pallet.",
        },
        expected_output: { summary: "One staged pallet." },
      },
    ],
  };
}

/**
 * A pack satisfying the seam. `loadCaseSet` is never called by the registry or by any guard, so
 * building one costs nothing until a test asks for the case set; `caseSetSource` is the seam a test
 * varies when it needs a pack whose cases are its own rather than the shipped ones.
 */
function makeFixturePack(
  id: string,
  standardVersionId: string = STANDARD_VERSION_ID,
  caseSetSource: () => CaseSet = () => loadCaseSet(standardVersionId),
): FixturePack {
  return {
    id,
    standardVersionId,
    title: `Fixture pack ${id}`,
    loadCaseSet: caseSetSource,
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

  it("holds a contribution that brings its own cases without displacing the shipped case set", () => {
    const registry = createExtensionRegistry();
    const ownCaseSet = makeOwnCaseSet();
    registry.registerFixturePack(
      makeFixturePack(EXTENSION_PACK_ID, STANDARD_VERSION_ID, () => ownCaseSet),
    );

    const pack = registry.getFixturePack(EXTENSION_PACK_ID);
    if (pack === null) {
      throw new Error(`expected ${EXTENSION_PACK_ID} to resolve from the registry`);
    }

    expect(pack.loadCaseSet()).toBe(ownCaseSet);
    expect(registry.getFixturePack(SGI_SO_1_0_0.fixtureSetId)).toBeNull();
    expect(loadCaseSet(SGI_SO_1_0_0.fixtureSetId).total_cases).toBe(SGI_SO_1_0_0.totalCases);
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

/**
 * The three accessors, each with the one registration it snapshots and the one it takes afterwards,
 * so the snapshot contract is asserted for every kind rather than for one of them: the three
 * members are three separate closures over three separate arrays, and a defect in one of them — a
 * returned live array, or one frozen array shared between two kinds — is invisible through the
 * other two.
 */
interface SnapshotAccessor {
  /** The kind, for the test's own name. */
  readonly kind: string;
  /** Registers the one contribution this accessor's snapshot should hold. */
  readonly register: (registry: ExtensionRegistry) => void;
  /** Registers a second contribution of the same kind, after a snapshot was taken. */
  readonly registerAnother: (registry: ExtensionRegistry) => void;
  /** Reads this accessor's snapshot. */
  readonly snapshot: (registry: ExtensionRegistry) => readonly unknown[];
  /** The second contribution, which is what a mutation attempt would push. */
  readonly added: unknown;
}

/** The second contribution of each kind, registered only after a snapshot has been taken. */
const secondPack = makeFixturePack("pack-b");
const secondCheck = makeEvaluatorCheck("check-b");
const secondCategory = makeListingCategory("data-pipelines");

const snapshotAccessors: readonly SnapshotAccessor[] = [
  {
    kind: "fixture packs",
    register: (registry) => {
      registry.registerFixturePack(makeFixturePack("pack-a"));
    },
    registerAnother: (registry) => {
      registry.registerFixturePack(secondPack);
    },
    snapshot: (registry) => registry.listFixturePacks(),
    added: secondPack,
  },
  {
    kind: "evaluator checks",
    register: (registry) => {
      registry.registerEvaluatorCheck(makeEvaluatorCheck("check-a"));
    },
    registerAnother: (registry) => {
      registry.registerEvaluatorCheck(secondCheck);
    },
    snapshot: (registry) => registry.listEvaluatorChecks(),
    added: secondCheck,
  },
  {
    kind: "listing categories",
    register: (registry) => {
      registry.registerListingCategory(makeListingCategory("logistics-tools"));
    },
    registerAnother: (registry) => {
      registry.registerListingCategory(secondCategory);
    },
    snapshot: (registry) => registry.listListingCategories(),
    added: secondCategory,
  },
];

describe("snapshot accessors", () => {
  it.each(snapshotAccessors)("freezes the array the $kind accessor returns", (accessor) => {
    const registry = createExtensionRegistry();
    accessor.register(registry);

    expect(Object.isFrozen(accessor.snapshot(registry))).toBe(true);
  });

  it.each(snapshotAccessors)("returns a distinct, equal $kind array on each call", (accessor) => {
    const registry = createExtensionRegistry();
    accessor.register(registry);

    const first = accessor.snapshot(registry);
    const second = accessor.snapshot(registry);

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it.each(snapshotAccessors)("refuses a mutation of the $kind array it returned", (accessor) => {
    const registry = createExtensionRegistry();
    accessor.register(registry);

    const snapshot = accessor.snapshot(registry);

    // The cast is what gives this assertion its meaning: the declared type is `readonly`, so the
    // only way to reach the runtime freeze is to smuggle a write past the compiler. ESM is always
    // strict mode, so the write throws rather than being silently dropped.
    expect(() => {
      (snapshot as unknown as unknown[]).push(accessor.added);
    }).toThrow(TypeError);
    expect(accessor.snapshot(registry)).toHaveLength(1);
  });

  it.each(snapshotAccessors)(
    "does not grow a $kind array obtained before a later registration",
    (accessor) => {
      const registry = createExtensionRegistry();
      accessor.register(registry);

      const beforeLaterRegistration = accessor.snapshot(registry);
      accessor.registerAnother(registry);

      expect(beforeLaterRegistration).toHaveLength(1);
      expect(accessor.snapshot(registry)).toHaveLength(2);
    },
  );
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

      // The file name rides with each assertion, so a failure names the scoring module that has
      // reached for an extension rather than leaving the reader to infer it from the source shown.
      expect(source, `${name} must not name a registered extension`).not.toContain(EXTENSION_PACK_ID);
      expect(source, `${name} must not name a registered extension`).not.toContain(EXTENSION_CHECK_ID);
      expect(source, `${name} must not name a registered extension`).not.toContain(
        EXTENSION_CATEGORY_SLUG,
      );
    }
  });
});

/**
 * The behavioural half of the same assertion, in the form the seam's acceptance actually turns on:
 * the case set a registered pack hands over is scored by the shipped entry point
 * `../scoring/score-submission`, which is where the pass rule, the totals, the failing-case
 * derivation and the drift checks between the criteria, the case set and the submission all live.
 *
 * Nothing of that path is restated here: the run's coverage is asserted against the shipped set's
 * own size, and its second run is compared with its first rather than expected case by case. The
 * seam's only contact with that deterministic path is the typed `ScoreSubmissionOptions.checks`
 * option, which an ordinary evaluation leaves empty — the calls below supply no checks, so every
 * case is decided inside `src/scoring/` and nothing in that folder had to change for a registered
 * contribution to be scored.
 */
describe("seam acceptance: the registered pack is scored by the shipped path", () => {
  it("scores a seed candidate through the case set a registered pack hands over", () => {
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
    const first = scoreSubmission(SGI_SO_1_0_0, caseSet, submission);
    const second = scoreSubmission(SGI_SO_1_0_0, pack.loadCaseSet(), submission);

    // Twenty is the shipped case set's own size, and a matched count equal to the total is a run
    // that missed nothing: neither number is a threshold this file restates.
    expect(first.standardVersionId).toBe(SGI_SO_1_0_0.versionLabel);
    expect(first.totalCount).toBe(20);
    expect(first.matchedCount).toBe(first.totalCount);
    expect(first.criticalFailures).toBe(0);
    expect(first.failingCaseIds).toEqual([]);
    expect(first.outcome).toBe("PASS");

    // The reproducibility the evaluation promises, applied to a registered contribution: the same
    // fixture scored twice yields identical per-case results and the same outcome.
    expect(second.caseResults).toEqual(first.caseResults);
    expect(second.outcome).toBe(first.outcome);
  });
});
