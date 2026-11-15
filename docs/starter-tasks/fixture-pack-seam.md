# Add a fixture pack through the FixturePack seam

Labels: P1, good-first-issue, milestone M4

## Scope

A fixture pack is the first of the three extension seams, and the one the repository already proves:
`examples/extension-fixture-pack` implements the interface in its own workspace, registers it through
the exported seam alone, and scores a candidate against the pack it adds while
`packages/sgi-core/src/scoring/` is untouched. Your task is to follow it — a new pack of your own, by
the same route, with the same property: **adding a pack must never require editing the scoring code**,
because a community addition that needs a core change is not an extension.

You write three things and nothing else.

1. **Your pack**, an object satisfying `FixturePack` as `packages/sgi-core/src/extensions/fixture-pack.ts`
   declares it: `id`, `standardVersionId`, `title` and `loadCaseSet()`. Hand it to
   `validateFixturePack`, which refuses a value whose members are present but wrong — the refusal is a
   `FixturePackValidationError` carrying the stable code `seam_validation` and the `field` that failed,
   raised at composition time and never returned as a request result. A seam violation is a
   programming error, so failing start-up loudly is the intended behaviour rather than a rough edge.
2. **Your case set**, returned by `loadCaseSet()` in the shape `packages/sgi-fixtures/src/index.ts`
   reads: `standard_version_id`, `total_cases`, `critical_cases` and a `cases` array whose every case
   carries `id`, `severity` (`critical` or `standard`), `input` (`instruction`, `source`) and
   `expected_output`. Keep your case ids in a namespace of your own — `so-001`…`so-020` belong to the
   shipped set — and keep candidates, if you ship them, declarative: a candidate id, its version
   identifier, the standard version identifier and one recorded output per case. Nothing is executed,
   ever.
3. **Its registration**, through `createExtensionRegistry()` from
   `packages/sgi-core/src/extensions/extension-registry.ts`: `registerFixturePack` accepts your pack
   and refuses a second registration of an id it already holds with `DuplicateExtensionError`, whose
   code is `duplicate_extension` and whose kind is `fixture-pack`.

**What must not change.** The published standard version and its case set under
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/`, the standard's row, and every file under
`packages/sgi-core/src/scoring/` stay exactly as they are: criteria change by publishing a new
standard version through `docs/governance/SGI-PROPOSALS.md`, never by editing one, and no seam
addition edits the scorer. A workspace of your own is welcome as long as it is not imported by
`packages/sgi-core` and does not import `apps/api` or `packages/commerce-sim`.

**Data, and the vocabulary.** Deterministic: no clock, locale, timezone, random source, environment
read or network in your pack or its data — every count is an integer and every identifier is a fixed
literal. Fictional and clean: no real brand, company, product, personal name, contact detail,
credential or token — no `@` in any string and no run of five or more consecutive digits, because the
exclusion scan and the manual privacy review both read these files. Report labels stay closed to
`SAMPLE` and `VERIFIED-IN-DEMO`; a badge names the standard version, the scope
`structured output on fixture set only` and the report id; nothing states or implies general safety,
certified security or independent certification, and buying an evaluation never guarantees a pass.

Read next: `packages/sgi-core/src/extensions/fixture-pack.ts` and
`packages/sgi-core/src/extensions/extension-registry.ts`; `examples/extension-fixture-pack/README.md`
with its `src/pack.ts`, `src/pack.test.ts`, `LICENSE` and `ATTRIBUTION.md`; `docs/ARCHITECTURE.md`;
`CONTRIBUTING.md`.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- packages/sgi-core` exits 0, and a test of your own sits beside your pack and
   exits 0 under `npm run test:unit -- <your workspace>`. It registers the pack, loads the case set
   through `loadCaseSet()`, and **asserts rather than prints**: the case count and the critical count
   against the cases array, the uniqueness of every case id, the `id`, `standardVersionId` and `title`
   the pack declares, and that a candidate is scored against your pack with the outcome recomputed
   from your cases and the versioned pass rule rather than retyped.
3. The seam's two refusals are asserted rather than assumed: a value whose `id`, `standardVersionId`
   or `title` is not a non-empty string, or whose `loadCaseSet` is not a function, throws
   `FixturePackValidationError` naming that field; registering one id twice throws
   `DuplicateExtensionError` for kind `fixture-pack`.
4. `git diff --stat -- packages/sgi-core/src/scoring packages/sgi-core/src/standards
   packages/sgi-fixtures/fixtures/SGI-SO-1.0.0` prints nothing: no scoring module, no standard
   version and no shipped case set was edited. Paste that empty output into the pull-request
   description with the change, because it is the property the seam exists to prove.
5. `npm run scan:exclusions` exits 0 with an empty finding list, and no file you add holds an `@` or
   a run of five or more consecutive digits.
6. If you ship in a workspace of your own, it declares its own licence and attribution as
   `examples/extension-fixture-pack` does; contributing puts no obligation on your own source.
