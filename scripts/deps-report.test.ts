/**
 * The licence gate's two exit paths, proven.
 *
 * `npm run deps:report` writes `docs/DEPENDENCIES.md` and exits non-zero when a licence outside the
 * allowlist reaches the tree. Both the document and the exit code are contract: the document is
 * committed evidence that the same input regenerates byte-identically, and the exit code is the gate
 * itself. This suite drives `runDepsReport` with **synthetic entries and a report path inside a
 * temporary directory**, which is what lets it prove those paths without an installed dependency tree
 * and without touching the artefact the `docs` folder owns:
 *
 * - an entry outside the allowlist exits `1`, naming the package in a violation and still listing
 *   every entry, so a reviewer sees the offender beside the clean ones;
 * - a tree wholly on the allowlist exits `0`;
 * - a development-only exception is decided by **graph membership, not by licence name**, so the same
 *   licence passes in the development graph and fails in the runtime graph — asserted in both
 *   directions, because a one-sided test is exactly how an exception widens to a runtime dependency;
 * - a third value, `workspace`, names this repository's own members: it belongs to neither inventory
 *   graph, so it is counted, rendered and read apart from both and never as what the product ships;
 * - a marker that names no usable licence (`UNLICENSED`, `UNKNOWN`, `SEE LICENSE IN …`) can never pass;
 * - the rendered document carries no timestamp, host name or absolute path, so regenerating the
 *   committed file produces no spurious diff;
 * - the graph split is driven over a synthetic lockfile-resolved repository, so the
 *   runtime/development classification — the mechanism that scopes the development-only exception —
 *   is exercised rather than assumed;
 * - a platform-conditional optional binary the lockfile resolves but this host did not install is
 *   listed all the same, with the licence the lockfile records for it, so the document is the same
 *   artefact wherever it is regenerated;
 * - nothing outside the path the run was handed is written.
 *
 * The allowlist cases read the delivered `scripts/license-allowlist.json` rather than a copy, so a
 * change to the policy is caught here instead of reaching the generated document.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import type { ModuleInfos } from "license-checker-rseidelsohn";

import {
  DECLARED_PACKAGE_PURPOSES,
  checkLicenses,
  collectDeclaredPackages,
  isAllowlisted,
  loadAllowlist,
  main,
  normalizeLicense,
  readResolvedTree,
  renderDependencyReport,
  runDepsReport,
} from "./deps-report";
import type {
  Allowlist,
  DependencyEntry,
  DependencyGraph,
  DepsReportResult,
  RunDepsReportOptions,
} from "./deps-report";

/** The repository root, taken from this file's own location: `scripts/` sits directly under it. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The allowlist data the real command reads — the policy every exit-path case is decided against. */
const ALLOWLIST_PATH = join(REPO_ROOT, "scripts", "license-allowlist.json");

/** The artefact the real command writes, which this suite has to leave byte-identical. */
const COMMITTED_REPORT_PATH = join(REPO_ROOT, "docs", "DEPENDENCIES.md");

/** The command the document names as its generator. */
const GENERATED_BY = "npm run deps:report";

/** The manifests the document names as its sources. */
const REPORT_SOURCES: readonly string[] = ["package.json", "package-lock.json"];

/** The two inventory graphs, so a case that has to hold in either one reads as a single line. */
const GRAPHS: readonly DependencyGraph[] = ["runtime", "development"];

/** The licences the request's Success criteria 11 requires the allowlist to hold. */
const REQUEST_ALLOWLISTED_LICENCES: readonly string[] = [
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
];

/** The licence the request permits for development-only dependencies, and never in a runtime graph. */
const DEVELOPMENT_ONLY_EXCEPTION = "MPL-2.0";

/** A licence outside the allowlist, planted to drive the failure path. */
const OUT_OF_ALLOWLIST_LICENCE = "GPL-3.0-only";

/**
 * The shape of a bare host name: one token of letters, digits, dots and hyphens.
 *
 * The case that proves the document is machine-independent used to read the running machine's host
 * name, which made it depend on that machine rather than on the document. This shape is what such a
 * leak would look like, and recognising it reads nothing of the host.
 */
const BARE_HOST_NAME = /^[A-Za-z0-9.-]+$/;

/** One entry per marker that names no usable licence, with the raw value a violation has to quote. */
const NON_LICENCE_MARKERS: ReadonlyArray<{ readonly name: string; readonly value: string }> = [
  { name: "pkg-unlicensed", value: "UNLICENSED" },
  { name: "pkg-unknown", value: "UNKNOWN" },
  { name: "pkg-see-licence", value: "SEE LICENSE IN LICENSE.txt" },
];

/**
 * The suite's scratch directory, created inside the system temporary directory on first use and
 * removed by the `afterAll` below whatever a case did before failing. Every path this suite writes
 * lives under it, so no case can reach a file of the repository by accident.
 */
let scratch: string | undefined;

/** Returns the suite's scratch directory, creating it on first use. */
function scratchDirectory(): string {
  scratch ??= mkdtempSync(join(tmpdir(), "adem-deps-report-"));
  return scratch;
}

/** Returns the path of `name` inside the scratch directory, creating the directory if needed. */
function scratchPath(name: string): string {
  return join(scratchDirectory(), name);
}

/** Removes the scratch directory when this suite created one, and forgets it. Safe when none exists. */
function removeScratch(): void {
  if (scratch !== undefined) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
}

afterAll(() => {
  removeScratch();
});

/**
 * Runs one case in a directory of its own, removing it afterwards even when the case throws.
 *
 * The removal is part of what a case may assert: a directory this suite made must not outlive the
 * suite's own run, and every write of a case has to stay inside that directory.
 */
async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "adem-deps-report-case-"));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Builds one dependency entry, so every case reads as data rather than as a full literal. */
function dependency(name: string, overrides: Partial<Omit<DependencyEntry, "name">> = {}): DependencyEntry {
  return {
    name,
    version: overrides.version ?? "1.0.0",
    licenses: overrides.licenses ?? ["MIT"],
    direct: overrides.direct ?? false,
    graph: overrides.graph ?? "runtime",
    inRepo: overrides.inRepo ?? false,
  };
}

/** Builds a licence policy, for the cases that fix the mechanism rather than the delivered data. */
function policyAllowing(allowed: readonly string[], developmentOnly: readonly string[] = []): Allowlist {
  return {
    allowed,
    developmentOnly,
    developmentOnlyExceptions: developmentOnly.map((license) => ({
      license,
      reason: `${license} is permitted in the development graph only.`,
    })),
  };
}

/** Reads the delivered allowlist, the policy the real command decides on. */
function deliveredAllowlist(): Allowlist {
  return loadAllowlist(ALLOWLIST_PATH);
}

/** Returns the first member of a list, failing readably rather than reading `undefined`. */
function firstOf<T>(values: readonly T[], what: string): T {
  const [first] = values;
  if (first === undefined) {
    throw new Error(`expected ${what}`);
  }
  return first;
}

/**
 * Runs something with the process's output captured.
 *
 * `runDepsReport` prints an operator-facing summary to stdout and the command line writes its usage
 * refusal to stderr; capturing both keeps this suite's own report readable and lets a case assert what
 * an operator would have been told.
 */
async function captureOutput<T>(
  run: () => Promise<T>,
): Promise<{ readonly value: T; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  const collect =
    (sink: string[]) =>
    (chunk: unknown): boolean => {
      sink.push(String(chunk));
      return true;
    };
  process.stdout.write = collect(stdout) as typeof process.stdout.write;
  process.stderr.write = collect(stderr) as typeof process.stderr.write;
  try {
    const value = await run();
    return { value, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

/** Runs the command with its output captured, returning what it decided and what it printed. */
async function runCommand(
  options: RunDepsReportOptions,
): Promise<{ readonly result: DepsReportResult; readonly printed: string }> {
  const { value, stdout } = await captureOutput(() => runDepsReport(options));
  return { result: value, printed: stdout };
}

/**
 * Splits one table row into its cells, on the separators that are not escaped.
 *
 * A `|` inside a cell has to reach the reader as `\|`: splitting on a bare separator would turn one
 * cell into two and a malformed row into an apparently well-formed one that hides a violation.
 */
function tableCells(row: string): readonly string[] {
  return row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** Returns the table row of one package, failing readably when the document holds none. */
function tableRowOf(document: string, name: string): string {
  const row = document.split("\n").find((line) => line.startsWith(`| ${name} |`));
  if (row === undefined) {
    throw new Error(`the document holds no dependency table row for ${name}`);
  }
  return row;
}

/** Returns the dependency table's data rows as cells, in the order they were rendered. */
function dependencyRows(document: string): readonly (readonly string[])[] {
  const header = document.indexOf("| Package | Version |");
  if (header === -1) {
    throw new Error("the document holds no dependency table");
  }
  return document
    .slice(header)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Package") && !line.startsWith("| ---"))
    .map((line) => tableCells(line));
}

/** Returns the bullet lines of the acceptance section, stopping at the next heading. */
function acceptedEntries(document: string): readonly string[] {
  const heading = "## Accepted through a development-only exception";
  const start = document.indexOf(heading);
  if (start === -1) {
    throw new Error(`the document holds no ${heading} section`);
  }
  const rest = document.slice(start + heading.length);
  const end = rest.indexOf("\n## ");
  return (end === -1 ? rest : rest.slice(0, end)).split("\n").filter((line) => line.startsWith("- "));
}

describe("the licence allowlist data", () => {
  it("holds the licences the request names, in the file's own order and without duplicates", () => {
    const data = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as { readonly allowed: readonly string[] };

    const allowlist = deliveredAllowlist();

    // The policy the code decides on is the policy the data holds: nothing added, dropped or reordered.
    expect(allowlist.allowed).toEqual(data.allowed);
    for (const licence of REQUEST_ALLOWLISTED_LICENCES) {
      expect(allowlist.allowed).toContain(licence);
    }
    expect(new Set(allowlist.allowed).size).toBe(allowlist.allowed.length);
    for (const licence of allowlist.allowed) {
      expect(licence.length).toBeGreaterThan(0);
      expect(licence).toBe(licence.trim());
    }
  });

  it("records where the list came from, so widening it is reviewed against the request", () => {
    const data = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as { readonly source?: unknown };

    expect(typeof data.source).toBe("string");
    expect(String(data.source)).toMatch(/criteria 11/i);
  });

  it("keeps every development-only exception out of the allowed list and scoped to one graph", () => {
    const allowlist = deliveredAllowlist();
    const exceptions = allowlist.developmentOnlyExceptions ?? [];

    expect(exceptions.length).toBeGreaterThan(0);
    for (const exception of exceptions) {
      expect(allowlist.allowed).not.toContain(exception.license);
      expect(exception.reason.trim().length).toBeGreaterThan(0);
      expect(allowlist.developmentOnly).toContain(exception.license);
      // An exception is safe only while the graph decides it, so each one is asserted both ways.
      expect(isAllowlisted([exception.license], "development", allowlist)).toBe(true);
      expect(isAllowlisted([exception.license], "runtime", allowlist)).toBe(false);
    }
  });

  it("names MPL-2.0 as the request's development-only exception, with a reason that keeps it out of a runtime graph", () => {
    const allowlist = deliveredAllowlist();
    const matching = (allowlist.developmentOnlyExceptions ?? []).filter(
      (exception) => exception.license === DEVELOPMENT_ONLY_EXCEPTION,
    );
    const exception = firstOf(matching, `one ${DEVELOPMENT_ONLY_EXCEPTION} exception`);

    expect(matching).toHaveLength(1);
    expect(allowlist.allowed).not.toContain(DEVELOPMENT_ONLY_EXCEPTION);
    expect(exception.reason).toMatch(/runtime graph/i);
    expect(isAllowlisted([DEVELOPMENT_ONLY_EXCEPTION], "development", allowlist)).toBe(true);
    expect(isAllowlisted([DEVELOPMENT_ONLY_EXCEPTION], "runtime", allowlist)).toBe(false);
  });

  it("records the amendment to the request's licence list, so widening it stays a reviewed diff", () => {
    const allowlist = deliveredAllowlist();
    const data = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as { readonly source?: unknown };
    const exceptions = (allowlist.developmentOnlyExceptions ?? []).map((exception) => exception.license);

    // Exactly one licence beyond the request's six, and exactly the four exceptions the amendment names:
    // a silent removal and a further widening both fail here, in either direction.
    expect(allowlist.allowed.filter((licence) => !REQUEST_ALLOWLISTED_LICENCES.includes(licence))).toEqual([
      "BlueOak-1.0.0",
    ]);
    expect(exceptions.sort()).toEqual(["CC-BY-3.0", "CC-BY-4.0", "CC0-1.0", DEVELOPMENT_ONLY_EXCEPTION]);

    const source = String(data.source);
    expect(source).toMatch(/criteria 11/i);
    expect(source).toMatch(/amendment/i);
    expect(source).toContain("BlueOak-1.0.0");
  });

  it("does not admit a copyleft licence the request leaves out", () => {
    const allowlist = deliveredAllowlist();

    for (const licence of ["GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only"]) {
      expect(allowlist.allowed).not.toContain(licence);
      for (const graph of GRAPHS) {
        expect(isAllowlisted([licence], graph, allowlist)).toBe(false);
      }
    }
  });
});

describe("loadAllowlist", () => {
  it("fails, naming the file, when the allowlist is missing", () => {
    const missing = scratchPath("absent-allowlist.json");

    expect(existsSync(missing)).toBe(false);
    expect(() => loadAllowlist(missing)).toThrowError(/absent-allowlist\.json/);
  });

  it("fails, naming the file, when the allowlist is not JSON", () => {
    const notJson = scratchPath("not-json-allowlist.json");
    writeFileSync(notJson, '{ "allowed": [ "MIT",\n', "utf8");

    expect(() => loadAllowlist(notJson)).toThrowError(/not-json-allowlist\.json[\s\S]*not valid JSON/);
  });

  it("fails, naming the file, when the JSON carries no allowed list", () => {
    const withoutAllowed = scratchPath("missing-allowed-allowlist.json");
    writeFileSync(withoutAllowed, JSON.stringify({ developmentOnlyExceptions: [] }), "utf8");

    expect(() => loadAllowlist(withoutAllowed)).toThrowError(
      /missing-allowed-allowlist\.json[\s\S]*"allowed" array is required/,
    );
  });

  it("fails, naming the file, when a licence identifier is empty", () => {
    const withEmptyMember = scratchPath("empty-member-allowlist.json");
    writeFileSync(withEmptyMember, JSON.stringify({ allowed: ["MIT", ""] }), "utf8");

    expect(() => loadAllowlist(withEmptyMember)).toThrowError(/empty-member-allowlist\.json[\s\S]*malformed/);
  });

  it("fails, naming the file, when the development-only exceptions are not a list of exceptions", () => {
    const badExceptions = scratchPath("bad-exceptions-allowlist.json");
    writeFileSync(badExceptions, JSON.stringify({ allowed: ["MIT"], developmentOnlyExceptions: ["MPL-2.0"] }), "utf8");

    expect(() => loadAllowlist(badExceptions)).toThrowError(/bad-exceptions-allowlist\.json[\s\S]*malformed/);
  });

  it("reads a policy that names no development-only exception", () => {
    const plain = scratchPath("plain-allowlist.json");
    writeFileSync(plain, JSON.stringify({ allowed: ["MIT", "ISC"] }), "utf8");

    expect(loadAllowlist(plain)).toEqual({ allowed: ["MIT", "ISC"], developmentOnly: [], developmentOnlyExceptions: [] });
  });
});

describe("normalizeLicense", () => {
  /** Every form the installed tree was seen to report, and the operands each one has to become. */
  const normalisationCases: Array<[string | readonly string[] | undefined, readonly string[]]> = [
    ["MIT", ["MIT"]],
    ["  MIT  ", ["MIT"]],
    ["(MIT)", ["MIT"]],
    ["MIT*", ["MIT"]],
    ["(MIT OR Apache-2.0)", ["MIT", "Apache-2.0"]],
    ["MIT AND Apache-2.0", ["Apache-2.0 AND MIT"]],
    [["MIT", "Apache-2.0"], ["MIT", "Apache-2.0"]],
    [["MIT", "MIT*"], ["MIT"]],
    ["UNLICENSED", ["UNLICENSED"]],
    ["unlicensed", ["unlicensed"]],
    ["UNKNOWN", ["UNKNOWN"]],
    ["SEE LICENSE IN LICENSE.txt", ["SEE LICENSE IN LICENSE.txt"]],
    [undefined, []],
    [[], []],
    ["", []],
    ["   ", []],
  ];

  it.each(normalisationCases)("normalises %s into %j", (value, expected) => {
    expect(normalizeLicense(value)).toEqual(expected);
  });

  it("ignores a member that is not a string, rather than reading it as a licence", () => {
    // license-checker reports a licence as a string, an array, or nothing usable at all.
    expect(normalizeLicense(["MIT", 42] as unknown as readonly string[])).toEqual(["MIT"]);
  });
});

describe("the allowlist decision", () => {
  /** A minimal policy, so these cases fix the mechanism rather than the delivered data. */
  const policy = policyAllowing(["MIT", "Apache-2.0"], [DEVELOPMENT_ONLY_EXCEPTION]);

  it("accepts a licence on the allowlist in either graph", () => {
    for (const licence of ["MIT", "Apache-2.0"]) {
      for (const graph of GRAPHS) {
        expect(isAllowlisted([licence], graph, policy)).toBe(true);
      }
    }
  });

  it("refuses an entry that declares no licence at all, in either graph", () => {
    for (const graph of GRAPHS) {
      expect(isAllowlisted([], graph, policy)).toBe(false);
      expect(isAllowlisted(normalizeLicense(undefined), graph, policy)).toBe(false);
      expect(isAllowlisted(normalizeLicense([]), graph, policy)).toBe(false);
    }
  });

  it("accepts a disjunction when one alternative is allowed, and refuses one when none is", () => {
    expect(isAllowlisted(normalizeLicense("MIT OR GPL-3.0-only"), "runtime", policy)).toBe(true);
    expect(isAllowlisted(normalizeLicense("GPL-3.0-only OR AGPL-3.0-only"), "runtime", policy)).toBe(false);
  });

  it("refuses a conjunction when any operand is outside the allowlist", () => {
    expect(isAllowlisted(normalizeLicense("MIT AND Apache-2.0"), "runtime", policy)).toBe(true);
    expect(isAllowlisted(normalizeLicense("MIT AND GPL-3.0-only"), "runtime", policy)).toBe(false);
  });

  it("decides the development-only exception by graph membership, not by licence name", () => {
    expect(isAllowlisted([DEVELOPMENT_ONLY_EXCEPTION], "development", policy)).toBe(true);
    expect(isAllowlisted([DEVELOPMENT_ONLY_EXCEPTION], "runtime", policy)).toBe(false);
  });

  it("refuses every marker that names no usable licence, in either graph, and quotes the raw marker", () => {
    const entries = NON_LICENCE_MARKERS.map((marker) =>
      dependency(marker.name, { licenses: normalizeLicense(marker.value) }),
    );
    const violations = checkLicenses(entries, deliveredAllowlist());

    expect(violations).toHaveLength(NON_LICENCE_MARKERS.length);
    for (const marker of NON_LICENCE_MARKERS) {
      const violation = firstOf(
        violations.filter((candidate) => candidate.name === marker.name),
        `a violation for ${marker.name}`,
      );
      expect(violation.licenses).toEqual([marker.value]);
      expect(violation.reason).toContain(marker.value);
      for (const graph of GRAPHS) {
        expect(isAllowlisted([marker.value], graph, deliveredAllowlist())).toBe(false);
      }
    }
  });

  it("reports an entry with no licence declared rather than passing over it", () => {
    const violations = checkLicenses([dependency("pkg-silent", { licenses: [] })], deliveredAllowlist());

    const violation = firstOf(violations, "one violation for an undeclared licence");
    expect(violation.licenses).toEqual([]);
    expect(violation.reason).toMatch(/no licence declared/);
  });

  it("exempts a repository workspace even when it declares no licence", () => {
    const workspace = dependency("@adem/planted-workspace", {
      licenses: [],
      graph: "workspace",
      inRepo: true,
    });

    expect(checkLicenses([workspace], deliveredAllowlist())).toEqual([]);
  });
});

/** One manifest of a synthetic repository: where it sits under the root, and what it declares. */
interface SyntheticManifest {
  /** Path of the manifest's directory, relative to the repository root (`.` for the root itself). */
  readonly at: string;
  /** The manifest's contents. */
  readonly manifest: Readonly<Record<string, unknown>>;
}

/**
 * The manifests of the synthetic repository the classification cases read.
 *
 * The repository carries one project of each kind the split has to get right — a package declared by
 * the root manifest, one declared by a workspace manifest, one reached transitively along a runtime
 * edge, one reached along a `devDependencies` edge, and the workspace member itself — because those
 * are the edges the runtime/development classification is derived from. The packages themselves are
 * not installed: what the repository resolves, and each package's version, licence and edges, is in
 * the synthetic lockfile beside these manifests.
 */
function syntheticManifests(): readonly SyntheticManifest[] {
  return [
    {
      at: ".",
      manifest: {
        name: "synthetic-root",
        version: "1.0.0",
        private: true,
        license: "MIT",
        workspaces: ["packages/*"],
        dependencies: { "pkg-runtime-direct": "1.0.0" },
        devDependencies: { "pkg-development-direct": "1.0.0" },
      },
    },
    {
      at: join("packages", "example"),
      manifest: {
        name: "@synthetic/example",
        version: "0.1.0",
        private: true,
        license: "Apache-2.0",
        dependencies: { "pkg-runtime-through-workspace": "1.0.0" },
      },
    },
  ];
}

/**
 * The synthetic lockfile's `packages` map: every package the repository resolves, by its own path.
 *
 * npm writes one record per resolved path, and a workspace member is recorded twice — once at its own
 * directory and once as the `link` record it places under `node_modules` — which is what the reader
 * has to read as one entry rather than two. Only the runtime transitive package's licence differs
 * between the two repositories this suite builds, so it is the one value a case replaces.
 */
function syntheticLockfilePackages(runtimeTransitiveLicence: string): Readonly<Record<string, unknown>> {
  return {
    "": {
      name: "synthetic-root",
      version: "1.0.0",
      license: "MIT",
      workspaces: ["packages/*"],
      dependencies: { "pkg-runtime-direct": "1.0.0" },
      devDependencies: { "pkg-development-direct": "1.0.0" },
    },
    [join("packages", "example")]: {
      name: "@synthetic/example",
      version: "0.1.0",
      license: "Apache-2.0",
      dependencies: { "pkg-runtime-through-workspace": "1.0.0" },
    },
    [join("node_modules", "@synthetic", "example")]: {
      resolved: join("packages", "example"),
      link: true,
    },
    [join("node_modules", "pkg-runtime-direct")]: {
      version: "1.0.0",
      license: "MIT",
      dependencies: { "pkg-runtime-transitive": "1.0.0" },
    },
    [join("node_modules", "pkg-runtime-transitive")]: {
      version: "1.0.0",
      license: runtimeTransitiveLicence,
    },
    [join("node_modules", "pkg-runtime-through-workspace")]: {
      version: "1.0.0",
      license: "BSD-3-Clause",
    },
    [join("node_modules", "pkg-development-direct")]: {
      version: "1.0.0",
      license: DEVELOPMENT_ONLY_EXCEPTION,
      dependencies: { "pkg-development-transitive": "1.0.0" },
    },
    [join("node_modules", "pkg-development-transitive")]: { version: "1.0.0", license: "MIT" },
  };
}

/**
 * Writes the synthetic repository under `directory` and returns its root.
 *
 * The repository is built here rather than read from the checkout, so these cases stay
 * install-independent and cannot be satisfied by whatever happens to be installed beside them. Nothing
 * is written into a `node_modules` directory: the entry set comes from the lockfile, and a checkout
 * with no installed tree is a state the command supports and generates the document from.
 */
function buildSyntheticRepository(directory: string, runtimeTransitiveLicence: string): string {
  const root = join(directory, "synthetic-repository");
  for (const { at, manifest } of syntheticManifests()) {
    const manifestDirectory = join(root, at);
    mkdirSync(manifestDirectory, { recursive: true });
    writeFileSync(join(manifestDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(syntheticLockfile(runtimeTransitiveLicence), null, 2)}\n`, "utf8");
  return root;
}

/** Wraps the synthetic lockfile's `packages` map in the lockfile that carries it. */
function syntheticLockfile(runtimeTransitiveLicence: string): Readonly<Record<string, unknown>> {
  return {
    name: "synthetic-root",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: syntheticLockfilePackages(runtimeTransitiveLicence),
  };
}

/** One platform-conditional optional binary: what the lockfile records, and what its copy declares. */
interface SyntheticPlatformBinary {
  /** Package name as published. */
  readonly name: string;
  /** The platform the package names, which is what npm matches before it installs the package at all. */
  readonly libc: string;
  /** The licence the committed lockfile records for it. */
  readonly lockfileLicence: string;
  /** The licence its installed copy declares. */
  readonly installedLicence: string;
}

/**
 * The two platform-conditional binaries the fixture resolves, one per platform.
 *
 * `installedLicence` differs from `lockfileLicence` on the first, so a case can tell which source a
 * row was reported from rather than assuming the two agree.
 */
function syntheticPlatformBinaries(): readonly SyntheticPlatformBinary[] {
  return [
    { name: "pkg-native-glibc", libc: "glibc", lockfileLicence: "Apache-2.0", installedLicence: "MIT" },
    { name: "pkg-native-musl", libc: "musl", lockfileLicence: "MIT", installedLicence: "MIT" },
  ];
}

/**
 * Writes a repository whose lockfile resolves both binaries and whose tree holds `installed` of them.
 *
 * npm decides at install time, by the platform each package names, whether it places the package at
 * all, so the two repositories this builds are the two states the same committed lockfile produces:
 * the delivered checkout, which holds one copy, and a checkout on the other platform, which holds
 * both.
 */
function buildSyntheticPlatformRepository(
  directory: string,
  name: string,
  installed: readonly string[],
): string {
  const root = join(directory, name);
  const binaries = syntheticPlatformBinaries();
  const declared = Object.fromEntries(binaries.map((binary) => [binary.name, "1.0.0"]));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      { name: "synthetic-platform-root", version: "1.0.0", private: true, license: "MIT", optionalDependencies: declared },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const packages: Record<string, unknown> = {
    "": { name: "synthetic-platform-root", version: "1.0.0", license: "MIT", optionalDependencies: declared },
  };
  for (const binary of binaries) {
    packages[join("node_modules", binary.name)] = {
      version: "1.0.0",
      license: binary.lockfileLicence,
      optional: true,
      os: ["linux"],
      cpu: ["x64"],
      libc: [binary.libc],
    };
    if (!installed.includes(binary.name)) continue;
    const installedDirectory = join(root, "node_modules", binary.name);
    mkdirSync(installedDirectory, { recursive: true });
    writeFileSync(
      join(installedDirectory, "package.json"),
      `${JSON.stringify({ name: binary.name, version: "1.0.0", license: binary.installedLicence }, null, 2)}\n`,
      "utf8",
    );
  }

  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify(
      { name: "synthetic-platform-root", version: "1.0.0", lockfileVersion: 3, requires: true, packages },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return root;
}

/**
 * The graph reader, driven over a repository this suite builds itself.
 *
 * `readResolvedTree`'s runtime/development split is the mechanism that scopes the development-only
 * exception, and no `entries`-supplying case can reach it: every case that checks the exception hands
 * the graph in. Read from the resolved graph instead, a regression that classified every package
 * `development` would keep all of them green while the exception silently covered a runtime
 * dependency, which is why the classification is asserted here edge by edge.
 */
describe("readResolvedTree", () => {
  /** Renders the document over one repository's entries, exactly as the command does. */
  function render(entries: readonly DependencyEntry[]): string {
    return renderDependencyReport({
      entries,
      allowlist: deliveredAllowlist(),
      generatedBy: GENERATED_BY,
      sources: REPORT_SOURCES,
    });
  }

  it("classifies a synthetic lockfile-resolved repository by graph, directness and origin", async () => {
    await withTemporaryDirectory(async (directory) => {
      const entries = await readResolvedTree(buildSyntheticRepository(directory, "MIT"));
      const allowlist = deliveredAllowlist();

      // A workspace manifest's runtime dependency joins the closure, a devDependencies edge does not
      // follow, and only what a manifest of this repository declares is direct. The workspace member is
      // read from its own manifest rather than from the `link` record npm writes for it, so it is
      // listed once, as `workspace`.
      expect(entries).toEqual([
        dependency("@synthetic/example", {
          version: "0.1.0",
          licenses: ["Apache-2.0"],
          graph: "workspace",
          inRepo: true,
        }),
        dependency("pkg-development-direct", {
          licenses: [DEVELOPMENT_ONLY_EXCEPTION],
          direct: true,
          graph: "development",
        }),
        dependency("pkg-development-transitive", { graph: "development" }),
        dependency("pkg-runtime-direct", { direct: true }),
        dependency("pkg-runtime-through-workspace", { licenses: ["BSD-3-Clause"], direct: true }),
        dependency("pkg-runtime-transitive"),
      ]);
      // The root project is not a dependency of anything, so it never reaches the inventory.
      expect(entries.map((entry) => entry.name)).not.toContain("synthetic-root");
      expect(checkLicenses(entries, allowlist)).toEqual([]);

      const document = render(entries);
      // The repository's one development-only licence is the one entry the exception covers.
      expect(acceptedEntries(document)).toEqual([
        `- pkg-development-direct@1.0.0 — \`${DEVELOPMENT_ONLY_EXCEPTION}\` (development graph)`,
      ]);
    });
  });

  it("exits 1 when that repository's development-only licence is in its runtime graph", async () => {
    await withTemporaryDirectory(async (directory) => {
      const root = buildSyntheticRepository(directory, DEVELOPMENT_ONLY_EXCEPTION);
      const reportPath = join(directory, "runtime-exception-report.md");
      // No `entries`: the command reads the resolved graph itself, which is the path a classification
      // regression changes — with every package read as development, this run would exit 0.
      const { result } = await runCommand({ root, allowlist: deliveredAllowlist(), reportPath });

      expect(result.wroteReport).toBe(true);
      expect(result.entries).toHaveLength(6);
      expect(result.exitCode).toBe(1);
      expect(result.violations.map((violation) => violation.name)).toEqual(["pkg-runtime-transitive"]);

      const violation = firstOf(result.violations, "the runtime-graph violation");
      expect(violation.version).toBe("1.0.0");
      expect(violation.graph).toBe("runtime");
      expect(violation.licenses).toEqual([DEVELOPMENT_ONLY_EXCEPTION]);
      expect(violation.reason).toMatch(/development-only/);
      expect(violation.reason).toMatch(/runtime graph/);

      // The same licence on the development edge of the same repository is not a violation.
      expect(result.violations.map((violation) => violation.name)).not.toContain("pkg-development-direct");
      expect(acceptedEntries(readFileSync(reportPath, "utf8"))).toEqual([
        `- pkg-development-direct@1.0.0 — \`${DEVELOPMENT_ONLY_EXCEPTION}\` (development graph)`,
      ]);
    });
  });

  it("lists a platform-conditional optional binary whether or not this host installed it, and renders one document either way", async () => {
    await withTemporaryDirectory(async (directory) => {
      const binaries = syntheticPlatformBinaries();
      const glibc = firstOf(
        binaries.filter((binary) => binary.name === "pkg-native-glibc"),
        "the glibc binary",
      );
      const musl = firstOf(
        binaries.filter((binary) => binary.name === "pkg-native-musl"),
        "the musl binary",
      );

      // The delivered checkout's own state: one lockfile resolves both binaries, and npm placed only
      // the copy whose platform this host is — which is why the committed document lists a binary that
      // is not on this machine, and why the entry set cannot come from the installed tree.
      const thisHost = buildSyntheticPlatformRepository(directory, "platform-this-host", [glibc.name]);
      // A checkout on the other platform: the same lockfile, both copies installed.
      const otherHost = buildSyntheticPlatformRepository(directory, "platform-other-host", [
        glibc.name,
        musl.name,
      ]);
      expect(existsSync(join(thisHost, "node_modules", musl.name))).toBe(false);

      const thisHostEntries = await readResolvedTree(thisHost);
      const otherHostEntries = await readResolvedTree(otherHost);

      // Both binaries are listed either way, in the runtime graph their optional edges put them in.
      for (const entries of [thisHostEntries, otherHostEntries]) {
        expect(entries.map((entry) => `${entry.name}@${entry.version}`)).toEqual([
          `${glibc.name}@1.0.0`,
          `${musl.name}@1.0.0`,
        ]);
        expect(entries.map((entry) => entry.graph)).toEqual(["runtime", "runtime"]);
        expect(checkLicenses(entries, deliveredAllowlist())).toEqual([]);
      }

      // The binary this host did not install carries the licence the lockfile records for it.
      const notInstalled = firstOf(
        thisHostEntries.filter((entry) => entry.name === musl.name),
        "the entry of the binary this host did not install",
      );
      expect(notInstalled.licenses).toEqual(normalizeLicense(musl.lockfileLicence));

      // The installed copy is the stronger evidence, so that is what the row reports, rather than the
      // lockfile's own record of the package's licence.
      const installedHere = firstOf(
        thisHostEntries.filter((entry) => entry.name === glibc.name),
        "the entry of the binary this host installed",
      );
      expect(installedHere.licenses).toEqual(normalizeLicense(glibc.installedLicence));
      expect(installedHere.licenses).not.toEqual(normalizeLicense(glibc.lockfileLicence));

      // The finding's own case: present or absent, the document is one artefact byte for byte.
      expect(render(otherHostEntries)).toBe(render(thisHostEntries));
    });
  });
});

describe("runDepsReport", () => {
  it("exits 1, names the offending package and still lists every entry when a licence is outside the allowlist", async () => {
    const reportPath = scratchPath("violation-report.md");
    const { result, printed } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [
        dependency("pkg-on-the-allowlist", { version: "1.0.0", licenses: ["MIT"], direct: true }),
        dependency("pkg-planted", { version: "2.0.0", licenses: [OUT_OF_ALLOWLIST_LICENCE], direct: true }),
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.wroteReport).toBe(true);
    expect(result.reportPath).toBe(reportPath);
    expect(result.violations).toHaveLength(1);

    const violation = firstOf(result.violations, "one licence violation");
    expect(violation.name).toBe("pkg-planted");
    expect(violation.version).toBe("2.0.0");
    expect(violation.licenses).toEqual([OUT_OF_ALLOWLIST_LICENCE]);
    expect(violation.graph).toBe("runtime");
    expect(violation.reason).toContain(OUT_OF_ALLOWLIST_LICENCE);
    expect(violation.reason).toMatch(/not on the allowlist/);

    // The offender is visible beside the clean entries, so a reviewer can see what failed and what did not.
    const document = readFileSync(reportPath, "utf8");
    expect(document).toContain("pkg-on-the-allowlist");
    expect(document).toContain("pkg-planted");
    expect(document).toContain("## Violations");
    expect(document).toContain(OUT_OF_ALLOWLIST_LICENCE);
    expect(printed).toContain("pkg-planted@2.0.0");
    expect(printed).toContain("1 licence violation(s)");
  });

  it("exits 0 with no violation when every entry is on the allowlist, whatever SPDX form it arrived in", async () => {
    const reportPath = scratchPath("allowlisted-report.md");
    const { result, printed } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [
        dependency("pkg-modified", { version: "1.0.0", licenses: normalizeLicense("MIT*") }),
        dependency("pkg-either", { version: "1.0.0", licenses: normalizeLicense("(MIT OR Apache-2.0)") }),
        dependency("pkg-both", { version: "1.0.0", licenses: normalizeLicense("MIT AND Apache-2.0") }),
        ...REQUEST_ALLOWLISTED_LICENCES.map((licence, index) =>
          dependency(`pkg-allowlisted-${index}`, {
            version: "1.0.0",
            licenses: [licence],
            graph: index % 2 === 0 ? "runtime" : "development",
          }),
        ),
      ],
    });

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.wroteReport).toBe(true);
    expect(existsSync(reportPath)).toBe(true);
    expect(printed).toContain("0 licence violation(s)");

    // The three SPDX forms are the cases the rule has to get right, so what they normalise to is fixed here.
    expect(normalizeLicense("MIT*")).toEqual(["MIT"]);
    expect(normalizeLicense("(MIT OR Apache-2.0)")).toEqual(["MIT", "Apache-2.0"]);
    expect(normalizeLicense("MIT AND Apache-2.0")).toEqual(["Apache-2.0 AND MIT"]);
  });

  it("exits 1 when a conjunction carries an operand outside the allowlist, and names the operand", async () => {
    const reportPath = scratchPath("conjunction-report.md");
    const { result } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [
        dependency("pkg-conjunction", { licenses: normalizeLicense(`MIT AND ${OUT_OF_ALLOWLIST_LICENCE}`) }),
        dependency("pkg-disjunction", { licenses: normalizeLicense(`MIT OR ${OUT_OF_ALLOWLIST_LICENCE}`) }),
      ],
    });

    // The disjunction passes on its allowed alternative; the conjunction fails on its disallowed operand.
    expect(result.violations).toHaveLength(1);
    const violation = firstOf(result.violations, "the conjunction violation");
    expect(result.exitCode).toBe(1);
    expect(violation.name).toBe("pkg-conjunction");
    expect(violation.reason).toContain(OUT_OF_ALLOWLIST_LICENCE);
    expect(violation.reason).toMatch(/required by/);
  });

  describe("the development-only exception, scoped by graph", () => {
    it("exits 0 for MPL-2.0 in the development graph, and lists it as accepted through the exception", async () => {
      const reportPath = scratchPath("mpl-development-report.md");
      const { result } = await runCommand({
        root: REPO_ROOT,
        allowlist: deliveredAllowlist(),
        reportPath,
        entries: [dependency("pkg-mpl-development", { version: "3.0.0", licenses: [DEVELOPMENT_ONLY_EXCEPTION], graph: "development" })],
      });

      expect(result.violations).toEqual([]);
      expect(result.exitCode).toBe(0);

      const document = readFileSync(reportPath, "utf8");
      expect(document).toContain("## Accepted through a development-only exception");
      expect(document).toContain(`- pkg-mpl-development@3.0.0 — \`${DEVELOPMENT_ONLY_EXCEPTION}\` (development graph)`);
    });

    it("exits 1 for MPL-2.0 in the runtime graph, saying the licence is development-only", async () => {
      const reportPath = scratchPath("mpl-runtime-report.md");
      const { result } = await runCommand({
        root: REPO_ROOT,
        allowlist: deliveredAllowlist(),
        reportPath,
        entries: [dependency("pkg-mpl-runtime", { version: "3.0.0", licenses: [DEVELOPMENT_ONLY_EXCEPTION], graph: "runtime" })],
      });

      expect(result.exitCode).toBe(1);
      const violation = firstOf(result.violations, "the runtime-graph violation");
      expect(violation.graph).toBe("runtime");
      expect(violation.licenses).toEqual([DEVELOPMENT_ONLY_EXCEPTION]);
      expect(violation.reason).toMatch(/development-only/);
      expect(violation.reason).toMatch(/runtime graph/);
    });
  });

  describe("the workspace graph", () => {
    it("is neither inventory graph: an allowlisted licence passes there and a development-only one does not", () => {
      const allowlist = deliveredAllowlist();

      expect(isAllowlisted(["MIT"], "workspace", allowlist)).toBe(true);
      expect(isAllowlisted([DEVELOPMENT_ONLY_EXCEPTION], "workspace", allowlist)).toBe(false);

      // An in-repo entry is exempt because it is this repository's own member — in the workspace graph
      // as in the two inventory graphs — never because a third graph accepts a licence.
      const inRepo = dependency("@adem/planted-workspace", {
        version: "0.1.0",
        licenses: [OUT_OF_ALLOWLIST_LICENCE],
        graph: "workspace",
        inRepo: true,
      });
      expect(checkLicenses([inRepo], allowlist)).toEqual([]);
    });

    it("names the graph an entry was judged in, so a workspace entry is never called a runtime one", () => {
      const judged = dependency("pkg-workspace-graph", {
        version: "1.0.0",
        licenses: [DEVELOPMENT_ONLY_EXCEPTION],
        graph: "workspace",
      });

      const violation = firstOf(
        checkLicenses([judged], deliveredAllowlist()),
        "the workspace-graph violation",
      );
      expect(violation.graph).toBe("workspace");
      expect(violation.reason).toMatch(/development-only/);
      expect(violation.reason).toMatch(/workspace graph/);
      expect(violation.reason).not.toMatch(/runtime graph/);
    });
  });

  it("reports the runtime, development and in-repo counts the document states", async () => {
    const reportPath = scratchPath("kind-counts-report.md");
    const { result, printed } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [
        dependency("pkg-runtime-only", { version: "1.0.0", licenses: ["MIT"], graph: "runtime" }),
        dependency("pkg-development-only", { version: "1.0.0", licenses: ["MIT"], graph: "development" }),
        dependency("@adem/planted-workspace", {
          version: "0.1.0",
          licenses: [],
          graph: "workspace",
          inRepo: true,
        }),
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(printed).toContain("3 dependencies: 1 runtime, 1 development, 1 in-repo");
    // The same three numbers in the document, so an operator and a reader of the committed file see
    // one split rather than two.
    expect(readFileSync(reportPath, "utf8")).toContain(
      "3 entries: 1 in the runtime graph, 1 in the development graph and 1 this repository's own",
    );
  });

  it("exits 0 for a repository workspace that declares no licence, and renders it as such", async () => {
    const reportPath = scratchPath("in-repo-report.md");
    const { result } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [
        dependency("@adem/planted-workspace", {
          version: "0.1.0",
          licenses: [],
          graph: "workspace",
          inRepo: true,
        }),
        dependency("pkg-third-party", { version: "1.0.0", licenses: ["MIT"] }),
      ],
    });

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(0);

    const document = readFileSync(reportPath, "utf8");
    expect(document).toContain("@adem/planted-workspace");
    expect(document).toContain("none declared");
  });
});

describe("the generated document", () => {
  /** The entries the document cases render: one per kind, licence shape and graph the report must show. */
  const entries: readonly DependencyEntry[] = [
    dependency("pkg-direct-runtime", { version: "1.2.3", licenses: ["MIT"], direct: true, graph: "runtime" }),
    dependency("pkg-transitive-development", {
      version: "4.5.6",
      licenses: ["Apache-2.0"],
      direct: false,
      graph: "development",
    }),
    dependency("pkg-mpl-development", {
      version: "7.8.9",
      licenses: [DEVELOPMENT_ONLY_EXCEPTION],
      direct: false,
      graph: "development",
    }),
    dependency("@adem/example-workspace", {
      version: "0.1.0",
      licenses: [],
      direct: false,
      graph: "workspace",
      inRepo: true,
    }),
  ];

  /** Renders the document exactly as the command does, over the given entries. */
  function render(candidates: readonly DependencyEntry[] = entries): string {
    return renderDependencyReport({
      entries: candidates,
      allowlist: deliveredAllowlist(),
      generatedBy: GENERATED_BY,
      sources: REPORT_SOURCES,
    });
  }

  it("renders every entry with its name, version, licence, kind and graph", () => {
    const document = render();

    expect(tableCells(tableRowOf(document, "pkg-direct-runtime"))).toEqual([
      "pkg-direct-runtime",
      "1.2.3",
      "MIT",
      "direct",
      "runtime",
    ]);
    expect(tableCells(tableRowOf(document, "pkg-transitive-development"))).toEqual([
      "pkg-transitive-development",
      "4.5.6",
      "Apache-2.0",
      "transitive",
      "development",
    ]);
    expect(tableCells(tableRowOf(document, "@adem/example-workspace"))).toEqual([
      "@adem/example-workspace",
      "0.1.0",
      "none declared",
      "workspace",
      "workspace",
    ]);
    for (const row of dependencyRows(document)) {
      expect(row).toHaveLength(5);
    }
  });

  it("counts the runtime, development and in-repo buckets separately, and names all three in the table header", () => {
    const document = render();
    const rows = dependencyRows(document);
    const countOf = (graph: string): number => rows.filter((cells) => cells[4] === graph).length;

    // The header paragraph states the counts the table's own graph column carries: the repository's
    // own workspace is counted as such, never folded into the runtime graph it does not belong to.
    expect(document).toContain(
      `${rows.length} entries: ${countOf("runtime")} in the runtime graph, ${countOf(
        "development",
      )} in the development graph and ${countOf("workspace")} this repository's own`,
    );
    expect(countOf("workspace")).toBe(1);

    // Both column headers name the third value, so `workspace` in a cell is documented rather than a
    // value a reader has to interpret from the row it sits in.
    expect(document).toContain(
      "| Package | Version | License | Kind (direct/transitive/workspace) | Graph (runtime/development/workspace) |",
    );

    // A workspace kind and a workspace graph travel together: no row offers one without the other, so
    // no in-repo entry reads as a direct or transitive dependency of this product.
    for (const cells of rows) {
      expect(cells[3] === "workspace").toBe(cells[4] === "workspace");
    }
  });

  it("names its generator and its sources, and states that it must not be edited by hand", () => {
    const document = render();

    expect(document.startsWith("# Dependency inventory")).toBe(true);
    expect(document).toContain(GENERATED_BY);
    expect(document).toMatch(/must not be edited by hand/);
    for (const source of REPORT_SOURCES) {
      expect(document).toContain(`- \`${source}\``);
    }
  });

  it("renders the allowlist and the scoping rule of the development-only exception", () => {
    const document = render();
    const allowlist = deliveredAllowlist();

    for (const licence of allowlist.allowed) {
      expect(document).toContain(`- \`${licence}\``);
    }
    expect(document).toMatch(/development-only exception passes only in the development graph/);
    for (const exception of allowlist.developmentOnlyExceptions ?? []) {
      expect(document).toContain(`- \`${exception.license}\` — ${exception.reason}`);
    }
  });

  it("sorts the entries by name, then version, so regeneration cannot reorder the file", () => {
    const document = render([
      dependency("pkg-b", { version: "1.0.0" }),
      dependency("pkg-a", { version: "1.2.0" }),
      dependency("pkg-a", { version: "1.0.0" }),
    ]);

    expect(dependencyRows(document).map((row) => row.slice(0, 2))).toEqual([
      ["pkg-a", "1.0.0"],
      ["pkg-a", "1.2.0"],
      ["pkg-b", "1.0.0"],
    ]);
  });

  it("is byte-identical for the same input, whatever order the entries arrive in", () => {
    const first = render();

    // The document is committed evidence, so a spurious diff on every run would hide a real one, and
    // what it renders has to be the fixture's own document — a renderer that dropped a row or a
    // column would be byte-identical with itself and pass a self-comparison.
    expect(render([...entries].reverse())).toBe(first);
    expect(dependencyRows(first)).toEqual([
      ["@adem/example-workspace", "0.1.0", "none declared", "workspace", "workspace"],
      ["pkg-direct-runtime", "1.2.3", "MIT", "direct", "runtime"],
      ["pkg-mpl-development", "7.8.9", DEVELOPMENT_ONLY_EXCEPTION, "transitive", "development"],
      ["pkg-transitive-development", "4.5.6", "Apache-2.0", "transitive", "development"],
    ]);
  });

  it("carries no timestamp, host name or absolute path", () => {
    const document = render();

    // Properties of the document, not of the machine that rendered it: a year, a date or a bare host
    // name in the document is what a spurious diff would come from, wherever the run happened.
    expect(document).not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(document).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(document.split("\n").filter((line) => BARE_HOST_NAME.test(line.trim()))).toEqual([]);
    expect(document).not.toContain(REPO_ROOT);
    expect(document).not.toContain(scratchDirectory());
    expect(document.endsWith("\n")).toBe(true);
  });

  it("escapes a pipe inside a licence, so a malformed row cannot hide a violation", () => {
    const piped = dependency("pkg-piped-licence", { version: "1.0.0", licenses: ["MIT WITH notes|extra"] });
    const document = render([piped, dependency("pkg-plain", { version: "1.0.0" })]);

    const row = tableRowOf(document, "pkg-piped-licence");
    expect(row).toContain("MIT WITH notes\\|extra");
    expect(tableCells(row)).toHaveLength(5);
    for (const cells of dependencyRows(document)) {
      expect(cells).toHaveLength(5);
    }
    // The escaping is cosmetic: that licence still fails the allowlist and is still reported.
    expect(checkLicenses([piped], deliveredAllowlist())).toHaveLength(1);
    expect(document).toContain("## Violations");
  });

  /**
   * The hostile shapes a dependency value can carry, one per character the renderer has to neutralise.
   *
   * A line feed and a carriage return would otherwise end the line the value sits on, so the rest of
   * the value would render as a line nobody wrote — a heading, a list item or a table row — which is
   * how a value hides its own row or fabricates one. A bare backtick would pair with a fence elsewhere
   * on the line and close the span early. A backslash immediately before a backtick is where the
   * escaping order goes wrong, because the escape the renderer adds is itself a backslash: escaping
   * the backtick without escaping the value's own backslash first renders an escaped backslash and
   * then a bare backtick, which opens a code span exactly as a bare one does.
   *
   * Each shape carries a licence outside the allowlist, so its entry lands in the violation list a
   * reviewer reads as well as in the table.
   */
  const hostileShapes: ReadonlyArray<{ readonly label: string; readonly name: string }> = [
    { label: "a line feed", name: "name-newline-package\n## Injected heading" },
    { label: "a carriage return", name: "carriage-return-package\rINJECTED-ROW" },
    { label: "a bare backtick", name: "pkg-backtick-name`x" },
    { label: "a backslash before a backtick", name: "pkg-backslash-name\\`x" },
  ];

  it.each(hostileShapes)(
    "escapes a dependency value carrying $label, so no value can break out of the line it renders on",
    ({ name }: { readonly label: string; readonly name: string }) => {
      /**
       * The value as the document has to render it: each line break named by the two characters that
       * spell it, then each backslash, then each backtick, escaped once.
       */
      const escaped = (value: string): string =>
        value
          .replace(/\r\n|\r|\n/g, (lineBreak) =>
            lineBreak === "\r\n" ? "\\r\\n" : lineBreak === "\r" ? "\\r" : "\\n",
          )
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`");

      /**
       * The backticks a line leaves unescaped, which are the ones that can pair with a fence.
       *
       * A backtick counts as escaped only behind an odd run of backslashes, which is how Markdown reads
       * the escape: `\` followed by a backtick is a literal backtick, while the backslash of an escaped
       * backslash pairs away and leaves the backtick behind it bare.
       */
      const unescapedBackticks = (line: string): number => {
        let unescaped = 0;
        let backslashes = 0;
        for (const character of line) {
          if (character === "\\") {
            backslashes += 1;
            continue;
          }
          if (character === "`" && backslashes % 2 === 0) unescaped += 1;
          backslashes = 0;
        }
        return unescaped;
      };

      const hostile = dependency(name, { version: "1.2.0", licenses: [OUT_OF_ALLOWLIST_LICENCE] });
      const document = render([hostile]);
      const lines = document.split("\n");

      // Exactly one line opens this entry's row, and it opens on the value as the document has to
      // render it: a second line opening the row is what a break the renderer let through would make.
      const rowLines = lines.filter((line) => line.startsWith(`| ${escaped(name)} |`));
      expect(rowLines).toHaveLength(1);
      const row = firstOf(rowLines, `the dependency table row of ${JSON.stringify(name)}`);
      // The row still splits into its five cells, so the value hid no cell and added none.
      expect(tableCells(row)).toHaveLength(5);
      expect(tableCells(row)[0]).toBe(escaped(name));

      // Its violation bullet carries the same escaped value, in the section a reviewer reads for
      // problems, beside a licence span whose fence the value would otherwise pair with.
      expect(document).toContain(`- ${escaped(name)}@1.2.0`);
      expect(document.slice(document.indexOf("## Violations"))).toContain(`- ${escaped(name)}@1.2.0`);

      // No line may leave an unescaped backtick unpaired, whichever shape carried it.
      expect(lines.filter((line) => unescapedBackticks(line) % 2 !== 0)).toEqual([]);

      // No line may open as a heading other than the document's own, which are the six a dependency
      // value cannot add to: a line break the renderer let through would manufacture one from the
      // rest of the value.
      expect(lines.filter((line) => line.startsWith("#"))).toEqual([
        "# Dependency inventory",
        "## Sources",
        "## Licence allowlist",
        "## Dependencies",
        "## Accepted through a development-only exception",
        "## Violations",
      ]);

      // The escaping is cosmetic: that licence still fails the allowlist and is still reported.
      expect(checkLicenses([hostile], deliveredAllowlist())).toHaveLength(1);
      expect(document).toContain("## Violations");
    },
  );

  it("prints an entry's licences as one cell, joining its alternatives", () => {
    const document = render([dependency("pkg-multi", { version: "1.0.0", licenses: ["MIT", "Apache-2.0"] })]);

    expect(tableCells(tableRowOf(document, "pkg-multi"))).toEqual([
      "pkg-multi",
      "1.0.0",
      "MIT, Apache-2.0",
      "transitive",
      "runtime",
    ]);
  });
});

describe("the declared-package inventory", () => {
  /**
   * Every package name the root manifest or a workspace manifest declares, with the versions stated,
   * read here independently of the module so the inventory cannot pass by agreeing with itself. The
   * root manifest's workspace globs are `apps/*`, `packages/*` and `examples/*`, so the directories
   * under those three are the workspaces whose manifests declare packages.
   */
  function declaredInManifests(): ReadonlyMap<string, ReadonlySet<string>> {
    const directories = [
      REPO_ROOT,
      ...["apps", "packages", "examples"].flatMap((group) =>
        readdirSync(join(REPO_ROOT, group)).map((member) => join(REPO_ROOT, group, member)),
      ),
    ];
    const declared = new Map<string, Set<string>>();
    for (const directory of directories) {
      const manifestPath = join(directory, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      for (const name of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const declarations = manifest[name];
        if (declarations === null || typeof declarations !== "object") continue;
        for (const [packageName, version] of Object.entries(declarations as Record<string, unknown>)) {
          const versions = declared.get(packageName) ?? new Set<string>();
          if (typeof version === "string") versions.add(version);
          declared.set(packageName, versions);
        }
      }
    }
    return declared;
  }

  it("lists every declared package with its declared version, a licence and a recorded purpose, and renders no section when none are supplied", async () => {
    const allowlist = deliveredAllowlist();
    const entries = await readResolvedTree(REPO_ROOT);
    const declared = collectDeclaredPackages(REPO_ROOT, entries);
    const document = renderDependencyReport({
      entries,
      allowlist,
      generatedBy: GENERATED_BY,
      sources: REPORT_SOURCES,
      declaredPackages: declared,
    });

    // Every package the manifests declare is inventoried, in name order, at the versions they state.
    const fromManifests = declaredInManifests();
    expect(declared.map((declaredPackage) => declaredPackage.name)).toEqual(
      [...fromManifests.keys()].sort(),
    );
    for (const declaredPackage of declared) {
      const manifestVersions = [...(fromManifests.get(declaredPackage.name) ?? [])].sort();
      expect(manifestVersions.length).toBeGreaterThan(0);
      expect([...declaredPackage.versions].sort()).toEqual(manifestVersions);
      // The purpose is the record's, and it is recorded: nothing on the delivered set is left blank.
      expect(DECLARED_PACKAGE_PURPOSES[declaredPackage.name]).toBe(declaredPackage.purpose);
      expect(declaredPackage.purpose.trim().length).toBeGreaterThan(0);
      expect(declaredPackage.purpose).not.toBe("not recorded");

      const line = firstOf(
        document.split("\n").filter((candidate) => candidate.startsWith(`- \`${declaredPackage.name}\` `)),
        `a declared-package line for ${declaredPackage.name}`,
      );
      for (const version of declaredPackage.versions) {
        expect(line).toContain(version);
      }
      expect(line).toContain(firstOf(declaredPackage.licenses, `a licence for ${declaredPackage.name}`));
      expect(line).toContain("— purpose: ");
      expect(line).not.toContain("purpose: not recorded");
    }

    // The four packages this checkpoint's findings name are inventoried like every other declaration.
    const findings: ReadonlyArray<readonly [string, string]> = [
      ["@types/node", "20.19.43"],
      ["@types/better-sqlite3", "9.6.0"],
      ["@types/react", "18.3.31"],
      ["@types/react-dom", "18.3.7"],
    ];
    for (const [name, version] of findings) {
      const declaredPackage = firstOf(
        declared.filter((candidate) => candidate.name === name),
        `the ${name} inventory entry`,
      );
      expect(declaredPackage.versions).toEqual([version]);
      expect(declaredPackage.licenses.length).toBeGreaterThan(0);
      expect(declaredPackage.purpose).toBe(DECLARED_PACKAGE_PURPOSES[name]);
    }

    // A caller that supplies no declared packages gets no such section, and no other section changes.
    const withoutDeclared = renderDependencyReport({
      entries,
      allowlist,
      generatedBy: GENERATED_BY,
      sources: REPORT_SOURCES,
    });
    const sectionStart = document.indexOf("## Declared packages");
    const nextSection = document.indexOf("## Accepted through a development-only exception");
    expect(withoutDeclared).not.toContain("## Declared packages");
    expect(sectionStart).toBeGreaterThan(-1);
    expect(nextSection).toBeGreaterThan(sectionStart);
    expect(document.slice(0, sectionStart) + document.slice(nextSection)).toBe(withoutDeclared);
  });
});

/**
 * The delivered tree's own licence record, held to the set the committed lockfile resolves.
 *
 * The entry set is host-independent by construction; the licence is the one field that still prefers
 * what this checkout installed, so a package this host did not install reports the lockfile's record
 * while a package it did install reports the installed copy's own. This case fixes that the two
 * sources agree on the delivered tree: if a row ever differed, the committed document would carry one
 * licence where a contributor's regenerated one carried another — the drift the entry set was taken
 * out of the installed tree to prevent in the first place.
 */
describe("the delivered tree's licence sources", () => {
  /**
   * Reads the licence every installed copy reports, straight from license-checker.
   *
   * Read here rather than through the module under test, so what this case compares is two independent
   * sources — the installed copies and the committed lockfile — and not the module with itself.
   */
  async function installedLicences(): Promise<ReadonlyMap<string, readonly string[]>> {
    const licenseChecker = await import("license-checker-rseidelsohn");
    const reported = await new Promise<ModuleInfos>((resolveReport, rejectReport) => {
      licenseChecker.init({ start: REPO_ROOT, json: true }, (error, result) => {
        if (error) {
          rejectReport(error);
          return;
        }
        resolveReport(result ?? {});
      });
    });

    const licenses = new Map<string, readonly string[]>();
    for (const key of Object.keys(reported).sort()) {
      const info = reported[key];
      const separator = key.lastIndexOf("@");
      const name =
        typeof info?.name === "string" && info.name.length > 0
          ? info.name
          : separator > 0
            ? key.slice(0, separator)
            : key;
      const version =
        typeof info?.version === "string" && info.version.length > 0
          ? info.version
          : separator > 0
            ? key.slice(separator + 1)
            : "";
      const pair = `${name}@${version}`;
      if (licenses.has(pair)) continue;
      licenses.set(pair, normalizeLicense(info?.licenses));
    }
    return licenses;
  }

  it.skipIf(!existsSync(join(REPO_ROOT, "node_modules")))(
    "reports the same licence operands from the installed copies and from the lockfile-resolved set",
    async () => {
      const installed = await installedLicences();
      const resolved = new Map(
        (await readResolvedTree(REPO_ROOT))
          .filter((entry) => !entry.inRepo)
          .map((entry) => [`${entry.name}@${entry.version}`, entry]),
      );

      const differing: string[] = [];
      let compared = 0;
      for (const [pair, licenses] of installed) {
        const entry = resolved.get(pair);
        // A pair the inventory does not list — the project itself, or a workspace member — is not an
        // entry here: an in-repo workspace lists the licence of its own manifest.
        if (entry === undefined) continue;
        compared += 1;
        if (entry.licenses.join(", ") !== licenses.join(", ")) {
          differing.push(
            `${pair}: the installed copy reports "${licenses.join(", ")}", the inventory entry holds "${entry.licenses.join(", ")}"`,
          );
        }
      }

      expect(differing).toEqual([]);
      // A floor on the sample, so the comparison cannot pass by comparing almost nothing.
      expect(compared).toBeGreaterThan(250);
    },
  );
});

describe("isolation from the repository", () => {
  it("leaves the committed dependency report byte-identical", async () => {
    const reportPath = scratchPath("isolation-report.md");
    const before = existsSync(COMMITTED_REPORT_PATH) ? readFileSync(COMMITTED_REPORT_PATH, "utf8") : null;

    const { result } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [dependency("pkg-synthetic-violation", { licenses: [OUT_OF_ALLOWLIST_LICENCE] })],
    });

    expect(result.exitCode).toBe(1);
    expect(result.reportPath).toBe(reportPath);

    const after = existsSync(COMMITTED_REPORT_PATH) ? readFileSync(COMMITTED_REPORT_PATH, "utf8") : null;
    expect(after).toBe(before);
    // The document another folder owns is neither rewritten nor created by a run of this suite.
    expect(existsSync(COMMITTED_REPORT_PATH)).toBe(before !== null);
  });

  it("writes only the report path it was given, and removes the directory it made", async () => {
    let caseDirectory = "";
    const written = await withTemporaryDirectory(async (directory) => {
      caseDirectory = directory;
      const { result } = await runCommand({
        root: REPO_ROOT,
        allowlist: deliveredAllowlist(),
        reportPath: join(directory, "report.md"),
        entries: [dependency("pkg-synthetic", { licenses: ["MIT"] })],
      });
      expect(result.wroteReport).toBe(true);
      return readdirSync(directory);
    });

    expect(written).toEqual(["report.md"]);
    expect(existsSync(caseDirectory)).toBe(false);
  });

  it("answers with the lockfile instruction, and writes nothing, when the committed lockfile is missing", async () => {
    const emptyRoot = scratchPath("no-lockfile");
    mkdirSync(emptyRoot, { recursive: true });

    // No entries, no lockfile, no allowlist beside that root and no report path: the missing lockfile
    // is answered first, because it is what the entry set is read from.
    const { result, printed } = await runCommand({ root: emptyRoot });

    expect(result.exitCode).toBe(1);
    expect(result.wroteReport).toBe(false);
    expect(result.entries).toEqual([]);
    const note = firstOf(result.notes, "the lockfile note");
    expect(note).toMatch(/package-lock\.json/);
    expect(note).toMatch(/npm ci/);
    expect(printed).toContain("npm ci");
    expect(existsSync(join(emptyRoot, "package-lock.json"))).toBe(false);
    expect(existsSync(join(emptyRoot, "docs"))).toBe(false);
  });

  it("runs with neither an installed tree nor a lockfile when the entries are supplied", async () => {
    const detachedRoot = scratchPath("detached-root");
    mkdirSync(detachedRoot, { recursive: true });
    expect(existsSync(join(detachedRoot, "node_modules"))).toBe(false);
    expect(existsSync(join(detachedRoot, "package-lock.json"))).toBe(false);

    const { result } = await runCommand({
      root: detachedRoot,
      allowlist: deliveredAllowlist(),
      reportPath: join(detachedRoot, "report.md"),
      entries: [dependency("pkg-synthetic", { licenses: ["MIT"] })],
    });

    expect(result.exitCode).toBe(0);
    expect(result.wroteReport).toBe(true);
    expect(existsSync(join(detachedRoot, "report.md"))).toBe(true);
  });
});

describe("the deps:report command line", () => {
  it("accepts no arguments and refuses one with the usage exit code", async () => {
    const accepted = await captureOutput(async () => main([]));
    const refused = await captureOutput(async () => main(["--report"]));

    expect(accepted.value).toBe(0);
    expect(refused.value).toBe(2);
    expect(refused.stderr).toMatch(/takes no arguments/);
  });
});
