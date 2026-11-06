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
 * - a marker that names no usable licence (`UNLICENSED`, `UNKNOWN`, `SEE LICENSE IN …`) can never pass;
 * - the rendered document carries no timestamp, host name or absolute path, so regenerating the
 *   committed file produces no spurious diff;
 * - nothing outside the path the run was handed is written.
 *
 * The allowlist cases read the delivered `scripts/license-allowlist.json` rather than a copy, so a
 * change to the policy is caught here instead of reaching the generated document.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  checkLicenses,
  isAllowlisted,
  loadAllowlist,
  main,
  normalizeLicense,
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

/** Both graphs, so a case that has to hold in either one reads as a single line. */
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
    const workspace = dependency("@adem/planted-workspace", { licenses: [], inRepo: true });

    expect(checkLicenses([workspace], deliveredAllowlist())).toEqual([]);
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

  it("exits 0 for a repository workspace that declares no licence, and renders it as such", async () => {
    const reportPath = scratchPath("in-repo-report.md");
    const { result } = await runCommand({
      root: REPO_ROOT,
      allowlist: deliveredAllowlist(),
      reportPath,
      entries: [
        dependency("@adem/planted-workspace", { version: "0.1.0", licenses: [], inRepo: true }),
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
    dependency("@adem/example-workspace", { version: "0.1.0", licenses: [], direct: false, inRepo: true }),
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
      "transitive",
      "runtime",
    ]);
    for (const row of dependencyRows(document)) {
      expect(row).toHaveLength(5);
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
    const second = render();

    // The document is committed evidence, so a spurious diff on every run would hide a real one.
    expect(first === second).toBe(true);
    expect(render([...entries].reverse())).toBe(first);
  });

  it("carries no timestamp, host name or absolute path", () => {
    const document = render();

    expect(document).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(document).not.toContain(String(new Date().getFullYear()));
    expect(document).not.toContain(hostname());
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

  it("answers with the install instruction, and writes nothing, when there is no installed tree", async () => {
    const emptyRoot = scratchPath("no-installed-tree");
    mkdirSync(emptyRoot, { recursive: true });

    // No entries, no allowlist beside that root and no report path: the missing tree is answered first.
    const { result, printed } = await runCommand({ root: emptyRoot });

    expect(result.exitCode).toBe(1);
    expect(result.wroteReport).toBe(false);
    expect(result.entries).toEqual([]);
    expect(firstOf(result.notes, "the install note")).toMatch(/npm ci/);
    expect(printed).toContain("npm ci");
    expect(existsSync(join(emptyRoot, "docs"))).toBe(false);
  });

  it("runs against a tree with no installed dependencies at all when the entries are supplied", async () => {
    const detachedRoot = scratchPath("detached-root");
    mkdirSync(detachedRoot, { recursive: true });
    expect(existsSync(join(detachedRoot, "node_modules"))).toBe(false);

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
