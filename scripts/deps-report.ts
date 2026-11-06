/**
 * `npm run deps:report` — the generated dependency report and the licence-allowlist gate.
 *
 * Reads the installed dependency tree, writes `docs/DEPENDENCIES.md` listing every direct and
 * transitive dependency with its version and licence, and exits non-zero when a licence outside the
 * allowlist appears in the tree. The allowlist is data (`scripts/license-allowlist.json`), so
 * widening it is a reviewable diff rather than a code change.
 *
 * Three properties the report rests on:
 *
 * - **It is generated, never hand-edited.** The document is committed, so identical input must render
 *   byte-identically: no timestamp, no machine name, no absolute path, no run counter. A spurious
 *   diff on every run would hide a real one.
 * - **Versions and licences are read from the installed tree**, never re-derived from the lockfile's
 *   ranges, which is what keeps the document and `npm ci` from disagreeing.
 * - **Graph membership decides the development-only exception.** A licence listed under
 *   `developmentOnlyExceptions` passes only for an entry in the development graph, so the same
 *   licence reaching a runtime graph fails the gate instead of slipping through on a name match.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InitOpts, ModuleInfo, ModuleInfos } from 'license-checker-rseidelsohn';

/** The command that regenerates the report, named in the document and in diagnostics. */
const REPORT_COMMAND = 'npm run deps:report';

/** Path of the generated document, relative to the repository root. */
const REPORT_RELATIVE_PATH = join('docs', 'DEPENDENCIES.md');

/** Path of the allowlist data, relative to the repository root. */
const ALLOWLIST_RELATIVE_PATH = join('scripts', 'license-allowlist.json');

/** The files the report is generated from. Relative names only: the document carries no absolute path. */
const REPORT_SOURCES: readonly string[] = ['package.json', 'package-lock.json'];

/** Exit code for an unexpected command line — the only code {@link main} decides on its own. */
const USAGE_EXIT_CODE = 2;

/** Licence markers that name no usable licence and are never allowlisted, whatever the data holds. */
const NON_LICENSE_MARKERS: readonly string[] = ['UNKNOWN', 'UNLICENSED'];

/** Prefix of the "see a file instead" marker license-checker emits for unstated licences. */
const NON_LICENSE_PREFIX = 'SEE LICENSE IN';

/** Marker license-checker appends to a licence that differs from the one the manifest states. */
const MODIFIED_LICENSE_MARKER = '*';

/** Dependency maps that put a package in the runtime graph. `devDependencies` never does. */
const RUNTIME_DEPENDENCY_MAPS: readonly string[] = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
];

/** Every dependency map, used to decide whether a package is a direct dependency. */
const ALL_DEPENDENCY_MAPS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** Which graph a package belongs to: what the product ships, or what only builds and tests it. */
export type DependencyGraph = 'runtime' | 'development';

/** One dependency of the delivered product, with the licence the installed tree reports for it. */
export interface DependencyEntry {
  /** Package name as published, for example `fastify` or `@adem/shared`. */
  readonly name: string;
  /** Exactly the version installed under `node_modules`. */
  readonly version: string;
  /**
   * Normalised licence operands from {@link normalizeLicense}: one element per alternative, where an
   * element may itself be a conjunction such as `CC-BY-3.0 AND MIT`. Empty when no licence was
   * declared, which is reported rather than skipped.
   */
  readonly licenses: readonly string[];
  /** True when a manifest in this repository declares the package; false when it arrives transitively. */
  readonly direct: boolean;
  /** The graph the package was installed for. */
  readonly graph: DependencyGraph;
  /** True for the repository's own `@adem/*` workspaces, which are not third-party dependencies. */
  readonly inRepo: boolean;
}

/**
 * One licence outside the allowlist.
 *
 * `licenses` is the normalised operand list the entry was judged on, so the raw marker
 * (`UNLICENSED`, `SEE LICENSE IN …`) survives into the reason and the document.
 */
export interface LicenseViolation {
  /** Package name as published. */
  readonly name: string;
  /** Exactly the version the licence was found on. */
  readonly version: string;
  /** Normalised licence operands the entry was judged on. */
  readonly licenses: readonly string[];
  /** The graph the entry was found in. */
  readonly graph: DependencyGraph;
  /** Which licences failed, and in which graph, in plain words. */
  readonly reason: string;
}

/** One development-only exception: the licence, and why the project permits it there. */
export interface DevelopmentOnlyException {
  /** The licence identifier the exception covers. */
  readonly license: string;
  /** Why the exception exists, from the allowlist data, rendered into the report. */
  readonly reason: string;
}

/** The licence policy the tree is checked against, read from the allowlist data. */
export interface Allowlist {
  /** Licence identifiers that may appear in either graph. */
  readonly allowed: readonly string[];
  /** Licence identifiers that may appear only in the development graph. */
  readonly developmentOnly: readonly string[];
  /**
   * The development-only exceptions with their reasons. Optional so that a caller may construct the
   * documented `{ allowed, developmentOnly }` shape; the report then renders the scoping rule alone.
   */
  readonly developmentOnlyExceptions?: readonly DevelopmentOnlyException[];
}

/** Everything one run decided, and the exit code the command should leave behind. */
export interface DepsReportResult {
  /** Every entry the report covers, sorted by name then version. */
  readonly entries: readonly DependencyEntry[];
  /** Every licence the allowlist rejected, sorted by name, then version, then reason. */
  readonly violations: readonly LicenseViolation[];
  /** Absolute path of the generated document. */
  readonly reportPath: string;
  /** False when no document was written, which happens only when there is no tree to read. */
  readonly wroteReport: boolean;
  /** Operator-facing notes, such as the instruction to install the tree first. */
  readonly notes: readonly string[];
  /** `0` when the tree is inside the allowlist, non-zero otherwise. */
  readonly exitCode: number;
}

/** Options of {@link runDepsReport}; every one of them exists so a caller can drive the command. */
export interface RunDepsReportOptions {
  /** Repository root to read from. Defaults to the current working directory. */
  readonly root?: string;
  /** Path of the allowlist data. Defaults to `<root>/scripts/license-allowlist.json`. */
  readonly allowlistPath?: string;
  /** Path of the document to write. Defaults to `<root>/docs/DEPENDENCIES.md`. */
  readonly reportPath?: string;
  /** Entries to report on instead of reading the installed tree, as the unit test does. */
  readonly entries?: readonly DependencyEntry[];
  /** Allowlist to check against instead of reading the data file. */
  readonly allowlist?: Allowlist;
}

/** Narrows an unknown value to a plain JSON object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Turns a thrown value into a message fit for a diagnostic line. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Compares two strings by code unit, so ordering never depends on a locale. */
const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Returns the values in first-seen order with duplicates removed. */
const uniqueStrings = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

/** Reads one required list of non-empty licence identifiers out of the allowlist data. */
const readLicenseList = (value: unknown, key: string, file: string): readonly string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      `licence allowlist at ${file} is malformed: "${key}" must be an array of licence identifiers`,
    );
  }
  const licenses: string[] = [];
  for (const member of value) {
    if (typeof member !== 'string' || member.trim().length === 0) {
      throw new Error(
        `licence allowlist at ${file} is malformed: every member of "${key}" must be a non-empty licence identifier`,
      );
    }
    licenses.push(member.trim());
  }
  return uniqueStrings(licenses);
};

/** Reads the development-only exceptions, each carrying the reason the report has to print. */
const readDevelopmentOnlyExceptions = (
  value: unknown,
  file: string,
): readonly DevelopmentOnlyException[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      `licence allowlist at ${file} is malformed: "developmentOnlyExceptions" must be an array`,
    );
  }
  const exceptions: DevelopmentOnlyException[] = [];
  for (const member of value) {
    if (!isRecord(member) || typeof member.license !== 'string' || member.license.trim().length === 0) {
      throw new Error(
        `licence allowlist at ${file} is malformed: every "developmentOnlyExceptions" entry needs a non-empty "license"`,
      );
    }
    if (member.reason !== undefined && typeof member.reason !== 'string') {
      throw new Error(
        `licence allowlist at ${file} is malformed: the reason of the "${member.license}" exception must be a string`,
      );
    }
    exceptions.push({ license: member.license.trim(), reason: (member.reason as string | undefined) ?? '' });
  }
  return exceptions;
};

/**
 * Reads the licence policy from the allowlist data.
 *
 * The allowlist is data, not code: this function is the only place that knows its shape, and it fails
 * with an error naming the file rather than silently checking the tree against an empty policy.
 *
 * @param path - Path of the allowlist data. Defaults to `scripts/license-allowlist.json` under the
 * current working directory.
 * @returns The allowlisted licences, the development-only ones and each exception's reason.
 * @throws When the file is missing, is not JSON, or does not carry the documented shape.
 */
export function loadAllowlist(path?: string): Allowlist {
  const file = resolvePath(path ?? join(process.cwd(), ALLOWLIST_RELATIVE_PATH));
  if (!existsSync(file)) {
    throw new Error(
      `licence allowlist not found at ${file}: restore it, or point the command at the file that holds the "allowed" list`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error: unknown) {
    throw new Error(`licence allowlist at ${file} is not valid JSON: ${messageOf(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `licence allowlist at ${file} is malformed: expected an object with an "allowed" array`,
    );
  }

  const allowed = readLicenseList(parsed.allowed, 'allowed', file);
  if (parsed.allowed === undefined) {
    throw new Error(
      `licence allowlist at ${file} is malformed: the "allowed" array is required, and an absent list would let nothing pass`,
    );
  }
  const exceptions = readDevelopmentOnlyExceptions(parsed.developmentOnlyExceptions, file);

  return {
    allowed,
    developmentOnly: uniqueStrings(exceptions.map((exception) => exception.license)),
    developmentOnlyExceptions: exceptions,
  };
}

/** Strips the parentheses wrapping a whole SPDX expression or operand. */
const stripWrappingParentheses = (value: string): string => {
  let current = value.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let index = 0; index < current.length; index += 1) {
      const character = current[index];
      if (character === '(') depth += 1;
      else if (character === ')') {
        depth -= 1;
        if (depth === 0 && index < current.length - 1) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced) break;
    current = current.slice(1, -1).trim();
  }
  return current;
};

/** Splits an expression on a top-level ` AND ` or ` OR ` operator, respecting parentheses. */
const splitTopLevel = (expression: string, operator: 'AND' | 'OR'): readonly string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index] as string;
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth === 0 && character === ' ') {
      const rest = expression.slice(index + 1);
      const match = /^(AND|OR)\s/.exec(rest);
      if (match !== null && match[1] === operator) {
        parts.push(current);
        current = '';
        index += 1 + match[0].length - 1;
        continue;
      }
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
};

/**
 * Normalises one licence field into operands an allowlist decision can be made on.
 *
 * Arrays are read as alternatives, a top-level `OR` splits into alternatives, and a top-level `AND`
 * becomes one conjunction element whose operands are sorted so the result is stable. The
 * "modified" marker license-checker appends (`MIT*`) is stripped, and a marker that names no usable
 * licence (`UNLICENSED`, `UNKNOWN`, `SEE LICENSE IN …`) is kept verbatim so a violation can quote
 * the raw value rather than paraphrase it — the decision on such a marker is always "not allowlisted".
 *
 * @param value - The `licenses` field as the installed tree reports it.
 * @returns The deduplicated operand list in first-seen order; empty when no licence is declared.
 */
export function normalizeLicense(value: string | readonly string[] | undefined): readonly string[] {
  const rawElements: readonly unknown[] = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const operands: string[] = [];

  const normalizeExpression = (expression: string): void => {
    const stripped = stripWrappingParentheses(expression);
    if (stripped.length === 0) return;
    if (isNonLicenseMarker(stripped)) {
      operands.push(stripped);
      return;
    }
    const alternatives = splitTopLevel(stripped, 'OR');
    if (alternatives.length > 1) {
      for (const alternative of alternatives) normalizeExpression(alternative);
      return;
    }
    const conjunctions = splitTopLevel(stripped, 'AND');
    if (conjunctions.length > 1) {
      const operandsOfConjunction = conjunctions
        .map((operand) => stripWrappingParentheses(operand))
        .filter((operand) => operand.length > 0)
        .sort(compareStrings);
      operands.push(operandsOfConjunction.join(' AND '));
      return;
    }
    operands.push(stripped);
  };

  for (const element of rawElements) {
    if (typeof element !== 'string') continue;
    const trimmed = element.trim();
    const withoutMarker =
      trimmed.endsWith(MODIFIED_LICENSE_MARKER) && trimmed.length > 1
        ? trimmed.slice(0, -1).trim()
        : trimmed;
    if (withoutMarker.length === 0) continue;
    normalizeExpression(withoutMarker);
  }

  return uniqueStrings(operands);
}

/** True for a marker that names no usable licence and can therefore never be allowlisted. */
const isNonLicenseMarker = (value: string): boolean => {
  const upper = value.trim().toUpperCase();
  return NON_LICENSE_MARKERS.includes(upper) || upper.startsWith(NON_LICENSE_PREFIX);
};

/** Splits a normalised operand into the sub-operands of its conjunction. */
const operandsOf = (operand: string): readonly string[] => {
  const parts = splitTopLevel(operand, 'AND').filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [operand];
};

/**
 * Returns why one normalised operand fails the allowlist, or an empty list when it passes.
 *
 * The messages name the graph, because the same licence is acceptable in one graph and not in the
 * other, and call out the development-only case in its own words.
 */
const assessOperand = (
  operand: string,
  graph: DependencyGraph,
  allowlist: Allowlist,
): readonly string[] => {
  const subOperands = operandsOf(operand);
  if (subOperands.length > 1) {
    return subOperands.flatMap((subOperand) =>
      assessOperand(subOperand, graph, allowlist).map((reason) =>
        subOperand === operand ? reason : `${reason} (required by "${operand}")`,
      ),
    );
  }

  if (isNonLicenseMarker(operand)) {
    return [`licence "${operand}" names no usable licence and can never be allowlisted (${graph} graph)`];
  }
  if (allowlist.allowed.includes(operand)) return [];
  if (allowlist.developmentOnly.includes(operand)) {
    if (graph === 'development') return [];
    return [
      `licence "${operand}" is a development-only exception but the entry is in the runtime graph`,
    ];
  }
  return [`licence "${operand}" is not on the allowlist (${graph} graph)`];
};

/**
 * Decides whether one entry's licences pass the allowlist in the graph it was found in.
 *
 * An entry passes when every operand of a conjunction passes and at least one alternative of a
 * disjunction passes. A licence the data lists as development-only passes only in the development
 * graph, so the exception can never carry a runtime dependency.
 *
 * @param licenses - Normalised operands, as {@link normalizeLicense} returns them.
 * @param graph - The graph the entry was found in.
 * @param allowlist - The licence policy to check against.
 * @returns True when the entry may ship.
 */
export function isAllowlisted(
  licenses: readonly string[],
  graph: DependencyGraph,
  allowlist: Allowlist,
): boolean {
  if (licenses.length === 0) return false;
  return licenses.some((operand) => assessOperand(operand, graph, allowlist).length === 0);
}

/**
 * Collects every licence violation in a set of entries.
 *
 * In-repo workspaces are skipped: they are this repository's own unpublished packages, not third
 * party dependencies, and the report states that exemption where it lists them.
 *
 * @param entries - The entries to check, typically from {@link readInstalledTree}.
 * @param allowlist - The licence policy to check against.
 * @returns The violations sorted by name, then version, then reason, so output is diffable.
 */
export function checkLicenses(
  entries: readonly DependencyEntry[],
  allowlist: Allowlist,
): readonly LicenseViolation[] {
  const violations: LicenseViolation[] = [];
  for (const entry of entries) {
    if (entry.inRepo) continue;
    if (isAllowlisted(entry.licenses, entry.graph, allowlist)) continue;
    const reasons =
      entry.licenses.length === 0
        ? [`no licence declared; an entry without a usable licence can never be allowlisted (${entry.graph} graph)`]
        : entry.licenses.flatMap((operand) => assessOperand(operand, entry.graph, allowlist));
    if (reasons.length === 0) continue;
    violations.push({
      name: entry.name,
      version: entry.version,
      licenses: entry.licenses,
      graph: entry.graph,
      reason: reasons.join('; '),
    });
  }
  violations.sort(
    (left, right) =>
      compareStrings(left.name, right.name) ||
      compareStrings(left.version, right.version) ||
      compareStrings(left.reason, right.reason),
  );
  return violations;
}

/** One manifest's identity, the licence it declares and the dependency names it declares. */
interface Manifest {
  /** Directory holding the manifest. */
  readonly dir: string;
  /** Package name. */
  readonly name: string;
  /** Package version. */
  readonly version: string;
  /** The licence field as declared, or `undefined` when the manifest states none. */
  readonly license: string | readonly string[] | undefined;
  /** The workspace globs of a repository root, empty for every other manifest. */
  readonly workspaces: readonly string[];
  /** Declared dependency names, keyed by dependency map. */
  readonly dependencyMaps: Readonly<Record<string, readonly string[]>>;
}

/** Reads the dependency maps of a manifest, keeping only the names it declares. */
const readDependencyMaps = (parsed: Record<string, unknown>): Readonly<Record<string, readonly string[]>> => {
  const maps: Record<string, readonly string[]> = {};
  for (const map of ALL_DEPENDENCY_MAPS) {
    const value = parsed[map];
    maps[map] = isRecord(value)
      ? Object.keys(value).filter((name) => name.trim().length > 0)
      : [];
  }
  return maps;
};

/** Turns a parsed manifest into the shape this module reads, or throws naming the file. */
const toManifest = (dir: string, parsed: unknown): Manifest => {
  const file = join(dir, 'package.json');
  if (!isRecord(parsed)) {
    throw new Error(`manifest at ${file} is malformed: expected a JSON object`);
  }
  const name = typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name.trim() : '';
  if (name.length === 0) {
    throw new Error(`manifest at ${file} is malformed: it declares no package name`);
  }
  const license =
    typeof parsed.license === 'string'
      ? parsed.license
      : Array.isArray(parsed.license)
        ? (parsed.license.filter((member): member is string => typeof member === 'string') as readonly string[])
        : undefined;
  const workspaces = Array.isArray(parsed.workspaces)
    ? parsed.workspaces.filter((member): member is string => typeof member === 'string')
    : [];
  return {
    dir,
    name,
    version: typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : 'unknown',
    license,
    workspaces,
    dependencyMaps: readDependencyMaps(parsed),
  };
};

/** Reads a manifest, returning `null` when it is absent or unreadable. */
const readManifestIfPresent = (dir: string): Manifest | null => {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return toManifest(dir, JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
};

/** Reads a manifest the run cannot do without, failing with the path when it is unreadable. */
const requireManifest = (dir: string): Manifest => {
  const manifest = readManifestIfPresent(dir);
  if (manifest === null) {
    throw new Error(`expected a readable manifest at ${join(dir, 'package.json')}`);
  }
  return manifest;
};

/**
 * Expands the root manifest's workspace globs into the directories that hold a manifest.
 *
 * The `dir/*` form the manifests use is expanded by listing the directory, so no glob package is
 * needed; a glob with no `*` is read as the directory itself.
 */
const expandWorkspaceGlobs = (rootDir: string, globs: readonly string[]): readonly string[] => {
  const directories: string[] = [];
  for (const glob of globs) {
    const segments = glob.split('/').filter((segment) => segment.length > 0);
    const starIndex = segments.indexOf('*');
    if (starIndex === -1) {
      const dir = join(rootDir, ...segments);
      if (existsSync(join(dir, 'package.json'))) directories.push(dir);
      continue;
    }
    const base = join(rootDir, ...segments.slice(0, starIndex));
    if (!existsSync(base)) continue;
    const rest = segments.slice(starIndex + 1);
    for (const member of readdirSync(base).sort(compareStrings)) {
      const dir = join(base, member, ...rest);
      if (existsSync(join(dir, 'package.json'))) directories.push(dir);
    }
  }
  return uniqueStrings(directories);
};

/** Resolves a dependency name from an installed package, the way Node walks `node_modules`. */
const resolveInstalledPackage = (fromDir: string, name: string): string | null => {
  let current = resolvePath(fromDir);
  for (;;) {
    const candidate = join(current, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

/** Collects every package name any manifest in the repository declares. */
const collectDeclaredNames = (manifests: readonly Manifest[]): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const manifest of manifests) {
    for (const map of ALL_DEPENDENCY_MAPS) {
      for (const name of manifest.dependencyMaps[map] ?? []) names.add(name);
    }
  }
  return names;
};

/**
 * Splits the installed packages into the runtime and development graphs.
 *
 * license-checker's own `production`/`development` options cannot make this split here: they filter
 * against the root manifest's own dependency maps, and an npm-workspaces root declares no
 * dependencies of its own, so the production pass returns only the root project while the
 * development pass returns the whole tree. Membership is therefore derived from what the manifests
 * declare — the root's and every in-repo workspace's `dependencies`, `optionalDependencies` and
 * `peerDependencies` — closed transitively over the installed packages' own `dependencies` and
 * `optionalDependencies`. `devDependencies` are never followed, so a package reachable only through
 * them is a development dependency.
 *
 * @param manifests - The root manifest followed by every in-repo workspace manifest.
 * @returns The `name@version` keys of the packages in the runtime graph.
 */
const collectRuntimeGraph = (manifests: readonly Manifest[]): ReadonlySet<string> => {
  const runtime = new Set<string>();
  const pending: Array<{ readonly fromDir: string; readonly name: string }> = [];
  for (const manifest of manifests) {
    for (const map of RUNTIME_DEPENDENCY_MAPS) {
      for (const name of manifest.dependencyMaps[map] ?? []) {
        pending.push({ fromDir: manifest.dir, name });
      }
    }
  }

  while (pending.length > 0) {
    const next = pending.shift();
    if (next === undefined) break;
    const dir = resolveInstalledPackage(next.fromDir, next.name);
    if (dir === null) continue;
    const manifest = readManifestIfPresent(dir);
    if (manifest === null) continue;
    const key = `${manifest.name}@${manifest.version}`;
    if (runtime.has(key)) continue;
    runtime.add(key);
    for (const map of ['dependencies', 'optionalDependencies']) {
      for (const name of manifest.dependencyMaps[map] ?? []) {
        pending.push({ fromDir: dir, name });
      }
    }
  }
  return runtime;
};

/** Orders entries by name, then version, so the document is stable across runs and machines. */
const sortEntries = (entries: readonly DependencyEntry[]): readonly DependencyEntry[] =>
  [...entries].sort(
    (left, right) => compareStrings(left.name, right.name) || compareStrings(left.version, right.version),
  );

/** Splits an installed-package key (`name@version`) into its parts. */
const parseInstalledKey = (
  key: string,
  info: ModuleInfo | undefined,
): { readonly name: string; readonly version: string } => {
  const separator = key.lastIndexOf('@');
  const nameFromKey = separator > 0 ? key.slice(0, separator) : key;
  const versionFromKey = separator > 0 ? key.slice(separator + 1) : '';
  const name = typeof info?.name === 'string' && info.name.length > 0 ? info.name : nameFromKey;
  const version =
    typeof info?.version === 'string' && info.version.length > 0 ? info.version : versionFromKey;
  return { name, version };
};

/** The shape of the module that walks `node_modules`, loaded on demand. */
type LicenseCheckerModule = typeof import('license-checker-rseidelsohn');

let licenseCheckerModule: Promise<LicenseCheckerModule> | undefined;

/**
 * Loads license-checker on demand, once per process.
 *
 * The import is dynamic so this module can be loaded — and its pure functions driven — without an
 * installed tree: a static import fails at link time when `node_modules` is absent, which is exactly
 * the state the command has to answer with an instruction rather than a stack trace. The package is
 * ESM and exports no default, so it is imported as a namespace.
 */
const loadLicenseChecker = (): Promise<LicenseCheckerModule> => {
  licenseCheckerModule ??= import('license-checker-rseidelsohn');
  return licenseCheckerModule;
};

/** Reads the installed tree through license-checker's documented callback API. */
const readInstalledPackages = async (rootDir: string): Promise<ModuleInfos> => {
  let licenseChecker: LicenseCheckerModule;
  try {
    licenseChecker = await loadLicenseChecker();
  } catch (error: unknown) {
    throw new Error(
      `could not load license-checker-rseidelsohn, which walks the installed tree: ${messageOf(error)}`,
    );
  }

  return new Promise<ModuleInfos>((resolve, reject) => {
    // `json` shapes the CLI's printed output; the callback always receives the plain object.
    const options: InitOpts = { start: rootDir, json: true };
    licenseChecker.init(options, (error: Error | null, result: ModuleInfos) => {
      if (error) {
        reject(new Error(`could not read the installed dependency tree at ${rootDir}: ${messageOf(error)}`));
        return;
      }
      resolve(result ?? {});
    });
  });
};

/**
 * Reads every installed package, classifying it by graph, directness and origin.
 *
 * Versions and licences come from the installed tree, so the document cannot disagree with what
 * `npm ci` installed. In-repo workspaces are read from their own manifests rather than from their
 * `UNLICENSED` private-package rows, and the project itself — which is not a dependency of anything —
 * is left out. Only the name, version and licences of a package are kept: the raw license-checker
 * payload embeds every licence's full text, which would make the document unusable and its size
 * arbitrary.
 *
 * @param root - Repository root to read from. Defaults to the current working directory.
 * @returns The entries, sorted by name then version; empty when no installed tree is present.
 */
export async function readInstalledTree(root: string = process.cwd()): Promise<readonly DependencyEntry[]> {
  const rootDir = resolvePath(root);
  if (!existsSync(join(rootDir, 'node_modules'))) return [];

  const rootManifest = requireManifest(rootDir);
  const workspaceManifests = expandWorkspaceGlobs(rootDir, rootManifest.workspaces).map((dir) =>
    requireManifest(dir),
  );
  const manifests: readonly Manifest[] = [rootManifest, ...workspaceManifests];
  const declaredNames = collectDeclaredNames(manifests);
  const runtime = collectRuntimeGraph(manifests);
  const inRepo = new Map(workspaceManifests.map((manifest) => [manifest.name, manifest] as const));

  const installed = await readInstalledPackages(rootDir);
  const entries: DependencyEntry[] = [];
  for (const key of Object.keys(installed).sort(compareStrings)) {
    const info = installed[key];
    const { name, version } = parseInstalledKey(key, info);
    if (inRepo.has(name)) continue;
    const modulePath = typeof info?.path === 'string' ? info.path : undefined;
    const isProjectItself =
      modulePath !== undefined
        ? resolvePath(modulePath) === rootDir
        : name === rootManifest.name;
    if (isProjectItself) continue;
    entries.push({
      name,
      version,
      licenses: normalizeLicense(info?.licenses),
      direct: declaredNames.has(name),
      graph: runtime.has(key) ? 'runtime' : 'development',
      inRepo: false,
    });
  }

  for (const manifest of workspaceManifests) {
    entries.push({
      name: manifest.name,
      version: manifest.version,
      licenses: normalizeLicense(manifest.license),
      direct: declaredNames.has(manifest.name),
      graph: 'runtime',
      inRepo: true,
    });
  }

  return sortEntries(entries);
}



/** Escapes a value so it cannot break out of a Markdown table cell. */
const escapeCell = (value: string): string => value.replace(/\|/g, '\\|');

/** Renders an entry's licences as one table cell. */
const licenceCell = (entry: DependencyEntry): string =>
  entry.licenses.length === 0 ? 'none declared' : entry.licenses.map(escapeCell).join(', ');

/** Lists the development-only exception licences an entry actually carries. */
const exceptionLicencesOf = (
  entry: DependencyEntry,
  developmentOnly: readonly string[],
): readonly string[] =>
  uniqueStrings(
    entry.licenses.flatMap((operand) =>
      operandsOf(operand).filter((subOperand) => developmentOnly.includes(subOperand)),
    ),
  );

/**
 * Renders the document.
 *
 * Byte-identical for identical input by design: no timestamp, no machine name, no absolute path and
 * no run counter, so regenerating the committed file produces no spurious diff. Only what the tree,
 * the policy and the source list carry reaches the page.
 *
 * @param input - The entries to list, the policy they were checked against, the command that
 * generated the file and the manifests it was generated from.
 * @returns The complete Markdown document, ending in a newline.
 */
export function renderDependencyReport(input: {
  readonly entries: readonly DependencyEntry[];
  readonly allowlist: Allowlist;
  readonly generatedBy: string;
  readonly sources: readonly string[];
}): string {
  const entries = sortEntries(input.entries);
  const violations = checkLicenses(entries, input.allowlist);
  const exceptions = [...(input.allowlist.developmentOnlyExceptions ?? [])].sort((left, right) =>
    compareStrings(left.license, right.license),
  );
  const accepted = entries.filter(
    (entry) =>
      !entry.inRepo &&
      entry.graph === 'development' &&
      exceptionLicencesOf(entry, input.allowlist.developmentOnly).length > 0,
  );
  const runtimeCount = entries.filter((entry) => entry.graph === 'runtime').length;
  const inRepoCount = entries.filter((entry) => entry.inRepo).length;

  const lines: string[] = [];
  lines.push('# Dependency inventory');
  lines.push('');
  lines.push(
    `Generated by \`${input.generatedBy}\`. This file must not be edited by hand: it is regenerated from`,
  );
  lines.push('the installed dependency tree on every run, so edit a manifest — or the allowlist data — and');
  lines.push(`run \`${input.generatedBy}\` again.`);
  lines.push('');
  lines.push('## Sources');
  lines.push('');
  for (const source of input.sources) lines.push(`- \`${source}\``);

  lines.push('');
  lines.push('## Licence allowlist');
  lines.push('');
  lines.push('Every entry is checked against the allowlist in `scripts/license-allowlist.json`:');
  lines.push('');
  for (const licence of [...input.allowlist.allowed].sort(compareStrings)) lines.push(`- \`${licence}\``);
  lines.push('');
  lines.push('A licence listed as a development-only exception passes only in the development graph, never in');
  lines.push('the runtime graph, because a licence permitted for development must not be distributed:');
  lines.push('');
  if (exceptions.length === 0) {
    lines.push('- None.');
  } else {
    for (const exception of exceptions) {
      lines.push(
        `- \`${exception.license}\`${exception.reason.length > 0 ? ` — ${exception.reason}` : ''}`,
      );
    }
  }

  lines.push('');
  lines.push('## Dependencies');
  lines.push('');
  lines.push(
    `${entries.length} entries: ${runtimeCount} in the runtime graph and ${entries.length - runtimeCount} in the development`,
  );
  lines.push(
    `graph, ${inRepoCount} of them this repository's own workspaces. A package reachable only through a`,
  );
  lines.push('`devDependencies` map is a development dependency. The in-repo `@adem/*` workspaces list the');
  lines.push('licence their own manifest declares: they are not third-party dependencies, and they are exempt');
  lines.push('from the allowlist check.');
  lines.push('');
  lines.push('| Package | Version | License | Kind (direct/transitive) | Graph (runtime/development) |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const entry of entries) {
    lines.push(
      `| ${escapeCell(entry.name)} | ${escapeCell(entry.version)} | ${licenceCell(entry)} | ${
        entry.direct ? 'direct' : 'transitive'
      } | ${entry.graph} |`,
    );
  }

  lines.push('');
  lines.push('## Accepted through a development-only exception');
  lines.push('');
  if (accepted.length === 0) {
    lines.push('- None.');
  } else {
    for (const entry of accepted) {
      const licences = exceptionLicencesOf(entry, input.allowlist.developmentOnly)
        .map((licence) => `\`${licence}\``)
        .join(', ');
      lines.push(`- ${entry.name}@${entry.version} — ${licences} (development graph)`);
    }
  }

  if (violations.length > 0) {
    lines.push('');
    lines.push('## Violations');
    lines.push('');
    for (const violation of violations) {
      const licences =
        violation.licenses.length === 0
          ? 'none declared'
          : violation.licenses.map((licence) => `\`${licence}\``).join(', ');
      lines.push(`- ${violation.name}@${violation.version} — licences: ${licences} — ${violation.reason}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/** Writes one line to stdout. */
const printLine = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * Runs the whole command: read the policy, read the tree, write the document, report the outcome.
 *
 * The document is always written when there is a tree to describe — a reviewer has to be able to see
 * the offending entries — and the exit code alone carries the verdict. When no installed tree is
 * present the command returns an instruction rather than a stack trace, and writes nothing, because a
 * document generated from no tree would read as an inventory of nothing.
 *
 * @param options - Overrides for the root, the two paths and the inputs, which is how the unit test
 * drives both exit paths without spawning a process.
 * @returns What the run decided: the entries, the violations, the document's path and the exit code.
 */
export async function runDepsReport(options: RunDepsReportOptions = {}): Promise<DepsReportResult> {
  const rootDir = resolvePath(options.root ?? process.cwd());
  const reportPath = resolvePath(options.reportPath ?? join(rootDir, REPORT_RELATIVE_PATH));
  const allowlistPath = resolvePath(options.allowlistPath ?? join(rootDir, ALLOWLIST_RELATIVE_PATH));

  // The tree is checked before the policy so that a checkout whose dependencies are not installed is
  // told to install them, whatever state the policy file happens to be in.
  if (options.entries === undefined && !existsSync(join(rootDir, 'node_modules'))) {
    const note = `no installed dependency tree found at ${join(rootDir, 'node_modules')}; run \`npm ci\` first`;
    printLine(note);
    return { entries: [], violations: [], reportPath, wroteReport: false, notes: [note], exitCode: 1 };
  }

  const allowlist = options.allowlist ?? loadAllowlist(allowlistPath);

  const entries = options.entries ?? (await readInstalledTree(rootDir));
  const violations = checkLicenses(entries, allowlist);
  const document = renderDependencyReport({
    entries,
    allowlist,
    generatedBy: REPORT_COMMAND,
    sources: REPORT_SOURCES,
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, document, 'utf8');

  const runtimeCount = entries.filter((entry) => entry.graph === 'runtime').length;
  const inRepoCount = entries.filter((entry) => entry.inRepo).length;
  printLine(
    `${entries.length} dependencies: ${runtimeCount} runtime, ${entries.length - runtimeCount} development, ${inRepoCount} in-repo`,
  );
  printLine(`${violations.length} licence violation(s) against ${allowlist.allowed.length} allowlisted licence(s)`);
  printLine(`wrote ${reportPath}`);
  for (const violation of violations) {
    printLine(`${violation.name}@${violation.version} — ${violation.reason}`);
  }

  return {
    entries,
    violations,
    reportPath,
    wroteReport: true,
    notes: [],
    exitCode: violations.length > 0 ? 1 : 0,
  };
}

/**
 * Decides what the command line allows before any work starts.
 *
 * The report is built asynchronously — the installed tree is read through license-checker's callback
 * API — so this returns the code the synchronous part settles on and leaves the run itself to
 * {@link runDepsReport}. The command takes no arguments, which is the only thing it can decide here.
 *
 * @param argv - Arguments after the script name. Defaults to the process's own.
 * @returns `0` when the command may proceed, {@link USAGE_EXIT_CODE} for an unexpected argument.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const unexpected = argv.filter((argument) => argument.trim().length > 0);
  if (unexpected.length > 0) {
    process.stderr.write(`deps:report takes no arguments; unexpected: ${unexpected.join(' ')}\n`);
    return USAGE_EXIT_CODE;
  }
  return 0;
}

/** True when this module is the program the process was started to run. */
const isDirectRun = (): boolean => {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return resolvePath(fileURLToPath(import.meta.url)) === resolvePath(invoked);
};

if (isDirectRun()) {
  const preflight = main();
  if (preflight !== 0) {
    process.exitCode = preflight;
  } else {
    // The library path never calls process.exit; the exit code is all the process is told.
    void runDepsReport()
      .then((result) => {
        process.exitCode = result.exitCode;
      })
      .catch((error: unknown) => {
        process.stderr.write(`deps:report failed: ${messageOf(error)}\n`);
        process.exitCode = 1;
      });
  }
}
