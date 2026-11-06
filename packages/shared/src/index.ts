/**
 * The single public entry of `@adem/shared`: the workspace that owns the product's
 * shared vocabulary, its domain types, the JSON schemas the API validates against and
 * the ordered SQL migrations.
 *
 * Consumers reach the package by its name — `import type { Listing } from "@adem/shared"`
 * — and never by a subpath. `package.json` exposes exactly `"."`, so every other module
 * in this folder is an implementation detail that is public only where a re-export below
 * makes it public. A name a consumer needs and cannot find here is a missing module in
 * this list, never a reason to import a deep path: the plan allows each workspace exactly
 * one public entry so that the package's surface can be read in one file.
 *
 * This module re-exports and does nothing else. It holds no constant, type, function or
 * default export, executes no statement and has no side effect, because the same file is
 * bundled for the browser by `apps/web` and imported from Node by the domain packages —
 * a module-level side effect would run in both, and code here would have no single owner.
 *
 * Specifiers are extensionless, matching the package's `moduleResolution: "bundler"`.
 *
 * Three of the modules below declare types only — `types/demo-label`, `types/inquiry` and
 * `types/thread`. Every other module below exports at least one runtime value — the
 * closed-vocabulary tuples and the schema objects — so `export *` is what keeps those
 * values reachable through the entry. `export type *` is used only where the module
 * declares no value: `types/demo-label` is re-exported with it because that module declares
 * types only, nothing is emitted for it, and the form says so. `types/inquiry` and
 * `types/thread` declare types only as well and are re-exported with `export *`, which is
 * sound for a module that exports no runtime value because it publishes no runtime name
 * either way. No identifier may be exported by two of these modules: `export *` would
 * collide on it, and the fix is to rename the provider rather than to drop a re-export and
 * silently remove a public name.
 */

export * from "./constants";

export * from "./types/account";
export * from "./types/listing";
export * from "./types/inquiry";
export * from "./types/challenge";
export * from "./types/thread";
export * from "./types/standard";
export * from "./types/report";
export * from "./types/appeal";
export * from "./types/governance-event";
export * from "./types/audit-event";
export * from "./types/commerce";
export * from "./types/ledger";
export * from "./types/sponsored";
export type * from "./types/demo-label";

export * from "./schemas/listings-schema";
export * from "./schemas/evaluations-schema";
export * from "./schemas/commerce-schema";
export * from "./schemas/auth-header-schema";
export * from "./schemas/challenges-threads-schema";
export * from "./schemas/moderation-schema";
