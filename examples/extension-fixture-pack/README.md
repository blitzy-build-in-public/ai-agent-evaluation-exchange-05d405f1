# Example extension — a fixture pack contributed through the `FixturePack` seam

This folder is the repository's worked example of a community extension: one `FixturePack`
implemented against the typed seam exported from `sgi-core`, registered into a registry the caller
creates, and scored by `sgi-core`'s **unchanged** scoring path. The pack is `example-pack`, scored
under the standard version `EXAMPLE-PACK-1.0.0`: six cases, two of them `critical`, and the pass rule
"at least 5 of 6 cases match and no `critical` case fails". The fixture data, identifiers and wording
in this folder are invented for the example and contain no real brand, organisation, personal name or
contact detail. Nothing here claims safety, security or independent certification for any agent: the
example compares recorded data against fixed cases and states no more than that.

## What the example demonstrates

- **The seam is a typed interface plus a registry, and both sit on the package's single public
  entry.** `FixturePack` and `ExtensionRegistry` are the types a contribution is written against;
  `validateFixturePack`, `createExtensionRegistry` and `scoreSubmission` are the functions it calls.
  All of them are re-exported from `sgi-core`'s `index.ts`, so a contributor reads the whole contract
  in one file.
- **A contribution is registered at composition time and resolved by id.** A pack is registered with
  `registry.registerFixturePack(pack)` and read back with `registry.getFixturePack("example-pack")`,
  which returns the registered pack by identity rather than a copy. A second registration under an id
  the registry already holds is refused with `DuplicateExtensionError` (`code:
  "duplicate_extension"`), and the built-in `SGI-SO-1.0.0` case set is deliberately **not**
  registered, so a contribution can never displace or shadow the shipped one.
- **The extension carries its own licence and attribution.** [`LICENSE`](./LICENSE) declares this
  extension's terms and [`ATTRIBUTION.md`](./ATTRIBUTION.md) credits its author. Contributing an
  extension declares a licence and an attribution for the contribution; it does not force disclosure
  of the contributor's own source code.

## How to register a fixture pack through the seam

The sketch below uses the exported surface alone and is the shape this folder's own implementation
follows.

```ts
import { readFileSync } from "node:fs";
import type { ExtensionRegistry, FixturePack, StandardVersionDefinition } from "@adem/sgi-core";
import {
  createExtensionRegistry,
  FixturePackValidationError,
  scoreSubmission,
  validateFixturePack,
} from "@adem/sgi-core";
import type { CandidateSubmission, CaseSet } from "@adem/sgi-fixtures";

// 1. Implement the seam: three read-only members and the case set your pack publishes. The case set
//    is your own data — this folder's pack reads the file it ships, and `src/pack.ts` validates every
//    member of that file before handing it over.
const pack: FixturePack = {
  id: "example-pack",
  standardVersionId: "EXAMPLE-PACK-1.0.0",
  title: "Structured Output Conformance (Example Pack)",
  loadCaseSet(): CaseSet {
    return JSON.parse(
      readFileSync(new URL("../fixtures/example-pack/cases.json", import.meta.url), "utf8"),
    ) as CaseSet;
  },
};

// 2. Register into a registry the composition root creates, and resolve the pack back by id.
const registry: ExtensionRegistry = createExtensionRegistry();
registry.registerFixturePack(pack);
const registered = registry.getFixturePack("example-pack"); // the same pack, by identity

// 3. Check a contribution you did not construct yourself, and report the member at fault.
function refusalOf(contribution: unknown): string | null {
  try {
    validateFixturePack(contribution);
    return null;
  } catch (error) {
    if (error instanceof FixturePackValidationError) {
      return `${error.code}: ${error.field}`; // "seam_validation: id", and so on
    }
    throw error;
  }
}

// 4. Score against a standard version whose declared counts agree with your case set.
const standard: StandardVersionDefinition = {
  code: "EXAMPLE-PACK-1.0.0",
  versionLabel: "EXAMPLE-PACK-1.0.0",
  title: "Structured Output Conformance (Example Pack)",
  summary:
    "Compares the recorded structured outputs of a declarative submission against six fixed cases. The evidence is limited to structured output on the fixture set only, and nothing submitted is executed.",
  status: "provisional",
  totalCases: 6,
  criticalCases: 2,
  passThresholdMatches: 5,
  criticalFailuresAllowed: 0,
  rubricReference: "EXAMPLE-PACK-1.0.0#rubric",
  fixtureSetId: "EXAMPLE-PACK-1.0.0",
  publishedAt: "2024-06-01T00:00:00.000Z",
};

// A candidate is declarative data: a case id and one recorded JSON value per case, never code.
const submission: CandidateSubmission = {
  candidate_id: "example-candidate",
  candidate_version_id: "version-1.0.0",
  standard_version_id: "EXAMPLE-PACK-1.0.0",
  recorded_outputs: pack.loadCaseSet().cases.map((fixtureCase) => ({
    case_id: fixtureCase.id,
    output: fixtureCase.expected_output, // record your own output here to see a miss reported
  })),
};

const scored = scoreSubmission(standard, pack.loadCaseSet(), submission);
```

**Import by package name, never by a subpath.** There is exactly one public entry per workspace and
`package.json` exposes exactly `"."`, so a deep path such as `src/extensions/fixture-pack` beneath
`sgi-core` is not importable: `index.ts` is the whole contract, and a name you need and cannot find
there is a missing re-export rather than a reason to reach deeper. `registry.registerFixturePack`
runs the same guard as `validateFixturePack`, so a malformed pack is refused where it is registered,
with the member at fault named in the refusal.

**Score under your pack's own standard version id.** `scoreSubmission` refuses with
`StandardDriftError` (`code: "standard_drift"`) unless the standard version you hand it carries your
case set's identity: its `fixtureSetId` must equal your case set's `standard_version_id`, its
`versionLabel` must equal the `standard_version_id` your submission declares, and its `totalCases`
and `criticalCases` must equal the case set's `total_cases` and `critical_cases`. A standard version
is published as data through `registerStandardVersion(db, definition)`: the call is idempotent for a
version already published, and a changed threshold is a new version rather than an edit of an
existing one.

## The command that proves it

```bash
npm run test:unit -- examples/extension-fixture-pack   # this folder's acceptance test, src/pack.test.ts
npm test                                              # the whole suite: unit, integration and the scan self-test
```

The positional filter matches **file paths**, so the folder path is what selects this folder's tests.
There is no per-package test configuration to add: the root `vitest.unit.config.ts` discovers
`examples/**/src/**/*.test.ts`, as it does the same pattern under `apps/**`, `packages/**` and
`scripts/**`, so a test placed beside its source is discovered with no registration anywhere.

## No scoring code was modified

This example adds only its own files. It changes **no** file under `packages/sgi-core/src/scoring/`,
so the change that adds this folder leaves the evaluator exactly as it stood:

```bash
git diff --stat -- packages/sgi-core/src/scoring   # empty for the change that adds this folder
```

That emptiness is the point of the seam. If this example could not be written without editing the
scoring path, the seam would be wrong and the defect would belong in `sgi-core`, not here: the seam
exists so that a new fixture pack is a registration, never a change to the shipped evaluator.

## Where to go next

- [`../../docs/starter-tasks/`](../../docs/starter-tasks/) — the brief "add a fixture pack through the
  `FixturePack` seam" is the worked version of this example.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — the contribution path, the pull-request
  checklist, and the rule that a contributed extension carries its own licence and attribution.
- This folder's own implementation: `src/pack.ts` (the pack and the case set it reads), `src/index.ts`
  (the package's single public entry) and `fixtures/example-pack/cases.json` (the six cases, two of
  them `critical`).
