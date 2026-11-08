/**
 * The static half of the product's trust-separation guarantee.
 *
 * **What it proves.** No import path carries commercial or sponsored data into the SGI path, and no
 * manifest declares an edge its own workspace's row of the per-workspace contract forbids: the check
 * walks the import specifiers and sponsorship tokens of every TypeScript file under a scan directory
 * — by default `packages/sgi-core/` — and judges every enumerated manifest against that row,
 * reporting each forbidden edge it finds. The edges are the ones that contract states:
 * `packages/sgi-core` may import `@adem/shared`, `@adem/sgi-fixtures` and `better-sqlite3` and
 * nothing commercial, and an edge to one of the workspace packages this check judges is reported
 * unless the declaring workspace's own row permits it — none to `@adem/api` or `@adem/web` or to a
 * path inside `apps/`, none to `@adem/commerce-sim` except from `apps/api`, and none to
 * `@adem/sgi-core` or `@adem/sgi-fixtures` except from `apps/api`, `packages/sgi-core` (the fixture
 * package only) and the example extension.
 *
 * **Why it is static.** A test exercises only the code paths it calls, whereas the import graph is a
 * property of the whole tree, so this check holds for code paths no test ever runs.
 *
 * **What it returns, and when it throws.** It reads text and returns the findings it made; a
 * violation is reported and never thrown. It throws in exactly two situations, both of which mean it
 * could not read what it is required to read: the scan directory does not exist or is not a
 * directory, and the manifest set it was pointed at does not contain
 * `packages/sgi-core/package.json`. An empty array is the criterion-7 evidence, so it has to mean
 * "everything was read and nothing violates" rather than "nothing was read".
 *
 * **Its limits, stated plainly.** It reads `.ts` files under the scan directory and JSON manifests
 * only; it skips `node_modules`, `dist` and entries whose name begins with a dot; it never resolves a
 * package specifier to its sources, and it says nothing about runtime data flow. The behavioural half
 * of the same guarantee — a report, a badge and the organic ordering staying identical as sponsorship
 * and fee data vary — is `trust-separation.test.ts`'s job. Neither half is a security boundary, and
 * neither is a certification.
 *
 * **The rule identifiers.** Each identifier names the class of edge that was found rather than the
 * file that was scanned, so pointing the scan at another directory still reports the edge class its
 * rule forbids. That is what lets the suite prove the detector is alive by scanning a directory which
 * genuinely holds such an edge.
 *
 * The only I/O here is reading: nothing writes, creates a temporary file, deletes anything or touches
 * a database, and no directory listing is used before it is sorted, so two runs over the same tree
 * return the same array in the same order.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One forbidden edge that a check found: the file that holds it, the line it sits on, and the
 * literal or manifest entry that broke the rule.
 */
export interface BoundaryViolation {
  /** The offending file, relative to the repository root, with forward slashes. */
  readonly file: string;
  /** The offending file's absolute path, so a failure message can point at it directly. */
  readonly absolutePath: string;
  /** The 1-indexed line of the offending statement or manifest entry. */
  readonly line: number;
  /**
   * What broke the rule: an import specifier or a manifest dependency name, `name: value` when the
   * dependency's value is what broke it, or the sponsorship token that was matched.
   */
  readonly specifier: string;
  /** The class of edge that was found. See the module header on why this is not the scanned file. */
  readonly rule:
    | "sgi-core-imports-commerce-sim"
    | "sgi-core-imports-apps-api"
    | "sgi-core-imports-sponsorship"
    | "manifest-edge-to-commerce-sim"
    | "manifest-edge-to-apps-api"
    | "manifest-edge-to-sgi-core";
}

/**
 * The repository root: this file sits at `apps/api/test/integration/`, four levels below it. Every
 * reported path is relative to this directory, and the API workspace edge is resolved against it.
 */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The default scan directory of {@link checkSgiCoreImports}: the SGI-carrying package itself. */
const DEFAULT_SGI_CORE_ROOT = new URL("../../../../packages/sgi-core/", import.meta.url);

/** The default root whose manifests {@link checkWorkspaceManifests} reads. */
const DEFAULT_REPOSITORY_ROOT = new URL("../../../../", import.meta.url);

/** The parent directories of the workspaces, as the root manifest declares them. */
const WORKSPACE_PARENT_DIRECTORIES: readonly string[] = ["apps", "packages", "examples"];

/** Every dependency block a manifest can declare an edge in. */
const DEPENDENCY_BLOCK_KEYS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Directories the scan never descends into: installed dependencies and build output. */
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "dist"]);

/**
 * The manifest the enumeration is required to hold, whichever root it is pointed at: the SGI-carrying
 * package's own manifest. Its absence means the check read nothing it was required to read.
 */
const SGI_CORE_MANIFEST_RELATIVE_PATH = join("packages", "sgi-core", "package.json");

/**
 * The commercial package the SGI path must never reach. It is held as a constant because it is rule
 * data — the name of the edge this check forbids — and not an import of that package.
 */
const COMMERCE_SIM_PACKAGE_NAME = "@adem/commerce-sim";

/** The API workspace the SGI path must never reach; likewise rule data rather than an import. */
const API_WORKSPACE_PACKAGE_NAME = "@adem/api";

/** The web workspace's package name; likewise rule data rather than an import. */
const WEB_WORKSPACE_PACKAGE_NAME = "@adem/web";

/** The SGI package's name; likewise rule data rather than an import. */
const SGI_CORE_PACKAGE_NAME = "@adem/sgi-core";

/** The fixture package's name; likewise rule data rather than an import. */
const SGI_FIXTURES_PACKAGE_NAME = "@adem/sgi-fixtures";

/** The npm protocol prefix a dependency value can carry in front of the path it names. */
const FILE_PROTOCOL_PREFIX = "file:";

/**
 * The path segment that names the workspace tree, as a dependency value writes it: the one spelling
 * that says where a value points whether npm would resolve it from the repository root or from the
 * declaring manifest, which is why {@link namesAppsTree} reads it in the value's own text.
 */
const APPS_PATH_SEGMENT = "apps/";

/**
 * One allowance of the per-workspace contract: the workspace package a manifest edge can name, the
 * rule identifier a forbidden declaration of it is reported under, and the workspaces whose own row
 * permits declaring it.
 */
interface WorkspacePackageAllowance {
  /** The package name an edge can name, matched on the name itself or on a subpath of it. */
  readonly packageName: string;
  /** The class of edge a declaration this check refuses is reported under. */
  readonly rule: BoundaryViolation["rule"];
  /** The workspaces whose own row permits the package to be declared, as workspace directories. */
  readonly permittedWorkspaceDirectories: readonly string[];
}

/**
 * The allowances the per-workspace contract's rows state, held as rule data.
 *
 * `apps/api` is reached over HTTP rather than by import, so no row permits an edge to `@adem/api` or
 * to `@adem/web`; the API workspace declares the commercial package and the SGI package by design,
 * the SGI package and the fixture package are declared by the example extension that adds a fixture
 * pack through the seam, and `sgi-core` declares the fixture package it reads. A workspace package
 * outside this table — the shared types package, and Shield — states no edge this check judges. Each
 * directory is a forward-slash path relative to the repository root, so `apps/api` is the API
 * workspace and `examples/extension-fixture-pack` is the example extension.
 */
const WORKSPACE_PACKAGE_ALLOWANCES: readonly WorkspacePackageAllowance[] = [
  {
    packageName: API_WORKSPACE_PACKAGE_NAME,
    rule: "manifest-edge-to-apps-api",
    permittedWorkspaceDirectories: [],
  },
  {
    packageName: WEB_WORKSPACE_PACKAGE_NAME,
    rule: "manifest-edge-to-apps-api",
    permittedWorkspaceDirectories: [],
  },
  {
    packageName: COMMERCE_SIM_PACKAGE_NAME,
    rule: "manifest-edge-to-commerce-sim",
    permittedWorkspaceDirectories: ["apps/api"],
  },
  {
    packageName: SGI_CORE_PACKAGE_NAME,
    rule: "manifest-edge-to-sgi-core",
    permittedWorkspaceDirectories: ["apps/api", "examples/extension-fixture-pack"],
  },
  {
    packageName: SGI_FIXTURES_PACKAGE_NAME,
    rule: "manifest-edge-to-sgi-core",
    permittedWorkspaceDirectories: [
      "apps/api",
      "packages/sgi-core",
      "examples/extension-fixture-pack",
    ],
  },
];

/**
 * The sponsorship tokens a measurement path must never mention: a closed list. The alternation names
 * the longest tokens first, so `sponsored_slots` matches as one token rather than as `sponsored`
 * followed by a tail, and the `\b` boundaries keep a longer identifier from matching a shorter token.
 */
const SPONSORSHIP_TOKEN_SOURCE =
  "\\b(?:sponsored_slots|sponsor_label|placement_key|fee_minor_units|sponsored)\\b";

/** The SQL keywords that make a string literal a statement, which is the second way a token can land. */
const SQL_KEYWORD_PATTERN = /\b(?:SELECT|FROM|JOIN|INSERT|UPDATE)\b/i;

/** One import specifier written in a source file, with the line its literal sits on. */
interface ImportSpecifier {
  /** The specifier's text, exactly as the source spells it between its quotes. */
  readonly specifier: string;
  /** The 1-indexed line of the specifier literal itself, unambiguous for a multi-line import. */
  readonly line: number;
  /** The offset of the specifier's opening quote, which is how it is joined to its string literal. */
  readonly start: number;
}

/** One string literal found in a source file's code, with the line its opening quote sits on. */
interface SourceLiteral {
  /** The literal's text between its quotes, exactly as written, escapes included. */
  readonly text: string;
  /** The 1-indexed line of the opening quote. */
  readonly line: number;
  /** The offset of the opening quote in the scanned source. */
  readonly start: number;
}

/** A source file reduced to the two things this check reads: its code and its string literals. */
interface ScannedSource {
  /** The source with every comment body blanked out; offsets and line numbers are unchanged. */
  readonly code: string;
  /** Every string literal written in code, in source order. */
  readonly literals: readonly SourceLiteral[];
}

/** One dependency entry of a manifest, as the text of its block spells it. */
interface ManifestDependency {
  /** The dependency's name, which is the key it is declared under. */
  readonly name: string;
  /** The dependency's value when it is a string, which is the only shape that can name a path. */
  readonly value: string | null;
  /** The dependency block the entry was found in. */
  readonly blockKey: string;
}

/**
 * Compares two strings by UTF-16 code unit, which is what keeps the output stable across machines.
 * `localeCompare` is deliberately not used: it would make the order depend on the host's locale.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Turns a filesystem path into the forward-slash form every reported path uses. */
function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

/** The 1-indexed line of one offset in a text, counting the newlines before it. */
function lineOfIndex(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text.charAt(cursor) === "\n") {
      line += 1;
    }
  }
  return line;
}

/** The message of an unknown thrown value, for the errors this check composes. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a path names a directory this process can read. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a path names a file this process can read. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Reads one file's text, refusing to continue when it cannot be read at all. */
function readTextFile(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`boundary check cannot read "${absolutePath}": ${errorMessage(error)}`);
  }
}

/** The names of a directory's entries, sorted by code unit and without dot-entries. */
function listDirectoryNames(directory: string): readonly string[] {
  const names: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      names.push(entry.name);
    }
  }
  names.sort(compareCodeUnits);
  return names;
}

/**
 * Every `.ts` file under a directory, as absolute paths, sorted by code unit.
 *
 * The walk is written out rather than delegated to `readdirSync`'s `recursive` option because that
 * option's per-entry path field is `path` before Node 20.12 and `parentPath` after it, so relying on
 * it would tie the check to one point on the Node 20 line. Only `.ts` files are read: the scan
 * directory holds no `.tsx`, and a `.tsx` added there later would need this suffix list extended.
 */
function walkSourceFiles(directory: string): readonly string[] {
  const found: string[] = [];
  const visit = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          visit(entryPath);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        found.push(entryPath);
      }
    }
  };
  visit(directory);
  found.sort(compareCodeUnits);
  return found;
}

/**
 * Reads a source file's code and the string literals written in it.
 *
 * Comment bodies are blanked rather than removed, one space per character and newlines kept, so that
 * every later offset, line number and regex match still refers to the file as the reader sees it.
 * Blanking them is not cosmetic: a comment's apostrophe would otherwise pair with the next one and
 * turn a stretch of documentation into a phantom literal, which is exactly how a mention of a
 * sponsorship table in a comment would be misread as code that reaches it. Escapes are copied
 * through, so a quote inside a literal never ends it, and a template literal is read as text to its
 * closing backtick.
 */
function scanSource(source: string): ScannedSource {
  const out: string[] = [];
  const literals: SourceLiteral[] = [];
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";
  let quote = "";
  let literalStart = 0;
  let literalChars: string[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source.charAt(index);

    if (state === "code") {
      const next = source.charAt(index + 1);
      if (char === "/" && next === "/") {
        state = "line-comment";
        out.push("  ");
        index += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block-comment";
        out.push("  ");
        index += 2;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        state = "string";
        quote = char;
        literalStart = index;
        literalChars = [];
      }
      out.push(char);
      index += 1;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        out.push("\n");
      } else {
        out.push(" ");
      }
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && source.charAt(index + 1) === "/") {
        state = "code";
        out.push("  ");
        index += 2;
        continue;
      }
      out.push(char === "\n" ? "\n" : " ");
      index += 1;
      continue;
    }

    if (char === "\\") {
      const escaped = source.charAt(index + 1);
      literalChars.push(char, escaped);
      out.push(char, escaped);
      index += 2;
      continue;
    }
    if (char === quote) {
      literals.push({ text: literalChars.join(""), line: lineOfIndex(source, literalStart), start: literalStart });
      out.push(char);
      state = "code";
      index += 1;
      continue;
    }
    literalChars.push(char);
    out.push(char);
    index += 1;
  }

  if (state === "string") {
    literals.push({ text: literalChars.join(""), line: lineOfIndex(source, literalStart), start: literalStart });
  }

  return { code: out.join(""), literals };
}

/**
 * Every import specifier written in a source file's code, covering the four forms an import takes:
 * `import … from "…"`, `export … from "…"`, a bare `import "…"` and a dynamic `import("…")`. Both
 * quote characters are handled, and the offsets returned are the ones the matching string literal
 * carries, which is how the two halves of the walk are joined.
 */
function collectImportSpecifiers(code: string): readonly ImportSpecifier[] {
  const pattern = /(?:^|[^\w$])(?:from|import)\s*\(?\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  const specifiers: ImportSpecifier[] = [];
  for (const match of code.matchAll(pattern)) {
    const raw = match[2];
    if (raw === undefined || match.index === undefined) {
      continue;
    }
    const start = match.index + match[0].length - (raw.length + 2);
    specifiers.push({ specifier: raw, line: lineOfIndex(code, start), start });
  }
  return specifiers;
}

/** The first sponsorship token a text mentions, or `null` when it mentions none. */
function firstSponsorshipToken(text: string): string | null {
  const match = new RegExp(SPONSORSHIP_TOKEN_SOURCE, "i").exec(text);
  return match === null ? null : match[0];
}

/** Orders violations by file, then line, then the specifier that broke the rule. */
function compareViolations(left: BoundaryViolation, right: BoundaryViolation): number {
  return (
    compareCodeUnits(left.file, right.file) ||
    left.line - right.line ||
    compareCodeUnits(left.specifier, right.specifier)
  );
}

/**
 * Whether a specifier reaches the API workspace: either it names that path outright, or it is a
 * relative one that resolves inside `<repositoryRoot>apps/`. Only a relative specifier is resolved,
 * so a package specifier is never mis-resolved against the importing file's own directory.
 */
function reachesApiWorkspace(specifier: string, absolutePath: string, appsDirectory: string): boolean {
  if (specifier.includes("apps/")) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }
  const resolved = resolve(dirname(absolutePath), specifier);
  return resolved === appsDirectory || resolved.startsWith(`${appsDirectory}${sep}`);
}

/**
 * Walks the import specifiers and sponsorship tokens of every `.ts` file under `root`.
 *
 * @param root - The directory to walk, defaulting to `packages/sgi-core/`: the package the contract
 *   forbids a commercial or sponsored edge into. It is a parameter so the check can be pointed at any
 *   directory tree, which is how the suite proves the detector is alive by scanning a directory that
 *   genuinely holds such an edge. The rule identifiers name the class of edge found, not this
 *   directory, so a report from another directory is still the edge class its rule forbids.
 * @returns Every forbidden edge found, ordered by file, then line, then specifier. An empty array
 *   means the directory was read and holds none.
 * @throws {Error} When `root` does not exist or is not a directory, because an empty array from a
 *   directory that was never read would pass the check for the wrong reason. It throws for nothing
 *   else: a violation is returned, never thrown.
 */
export function checkSgiCoreImports(root: URL = DEFAULT_SGI_CORE_ROOT): BoundaryViolation[] {
  const scanDirectory = fileURLToPath(root);
  if (!isDirectory(scanDirectory)) {
    throw new Error(
      `boundary check cannot scan "${scanDirectory}": it does not exist or is not a directory, so an empty result would mean nothing was read rather than nothing violates the rules`,
    );
  }

  const appsDirectory = join(REPOSITORY_ROOT, "apps");
  const violations: BoundaryViolation[] = [];

  for (const absolutePath of walkSourceFiles(scanDirectory)) {
    const file = toPosixPath(relative(REPOSITORY_ROOT, absolutePath));
    const { code, literals } = scanSource(readTextFile(absolutePath));
    const specifierStarts = new Map<number, string>();

    for (const { specifier, line, start } of collectImportSpecifiers(code)) {
      specifierStarts.set(start, specifier);
      if (specifier === COMMERCE_SIM_PACKAGE_NAME || specifier.startsWith(`${COMMERCE_SIM_PACKAGE_NAME}/`)) {
        violations.push({ file, absolutePath, line, specifier, rule: "sgi-core-imports-commerce-sim" });
        continue;
      }
      if (reachesApiWorkspace(specifier, absolutePath, appsDirectory)) {
        violations.push({ file, absolutePath, line, specifier, rule: "sgi-core-imports-apps-api" });
      }
    }

    // The sponsorship half reads the literals rather than the imports, because a join on a
    // commercial table is the other way such data could reach a measurement: a token counts in an
    // import specifier anywhere, and in any other literal only where that literal is a statement.
    for (const literal of literals) {
      const token = firstSponsorshipToken(literal.text);
      if (token === null) {
        continue;
      }
      if (!specifierStarts.has(literal.start) && !SQL_KEYWORD_PATTERN.test(literal.text)) {
        continue;
      }
      violations.push({
        file,
        absolutePath,
        line: literal.line,
        specifier: token,
        rule: "sgi-core-imports-sponsorship",
      });
    }
  }

  violations.sort(compareViolations);
  return violations;
}

/**
 * Every manifest to judge: the root's, then each workspace's under the three parent directories, in
 * code-unit order. Judging all of them, rather than one of them, is what holds a workspace — the root
 * included — to its own row of the per-workspace contract and stops a workspace added later from
 * going unjudged by this check.
 */
function enumerateManifestPaths(repositoryRoot: string): readonly string[] {
  const manifestPaths: string[] = [join(repositoryRoot, "package.json")];
  for (const parentName of WORKSPACE_PARENT_DIRECTORIES) {
    const parentPath = join(repositoryRoot, parentName);
    if (!isDirectory(parentPath)) {
      continue;
    }
    for (const workspaceName of listDirectoryNames(parentPath)) {
      const manifestPath = join(parentPath, workspaceName, "package.json");
      if (isFile(manifestPath)) {
        manifestPaths.push(manifestPath);
      }
    }
  }
  return manifestPaths;
}

/** Parses a manifest, refusing to continue when it is not valid JSON or not a JSON object. */
function parseManifest(manifestPath: string, text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`boundary check cannot parse "${manifestPath}": ${errorMessage(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`boundary check cannot read "${manifestPath}": its text is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Every dependency entry the four dependency blocks of a manifest declare, in declaration order. */
function listManifestDependencies(
  manifestPath: string,
  manifest: Record<string, unknown>,
): readonly ManifestDependency[] {
  const dependencies: ManifestDependency[] = [];
  for (const blockKey of DEPENDENCY_BLOCK_KEYS) {
    const block = manifest[blockKey];
    if (block === undefined) {
      continue;
    }
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      throw new Error(`boundary check cannot read "${manifestPath}": its "${blockKey}" block is not a JSON object`);
    }
    for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
      dependencies.push({ name, value: typeof value === "string" ? value : null, blockKey });
    }
  }
  return dependencies;
}

/**
 * The allowance whose package a dependency name names: the name itself, or a subpath of it, since
 * `@adem/sgi-core/internal` reaches into the same package. `undefined` when the name names none of
 * the packages this check judges, which leaves the dependency to be judged by its value instead.
 */
function allowanceForDependencyName(name: string): WorkspacePackageAllowance | undefined {
  return WORKSPACE_PACKAGE_ALLOWANCES.find(
    (allowance) => name === allowance.packageName || name.startsWith(`${allowance.packageName}/`),
  );
}

/**
 * Whether a dependency value names the `<repositoryRoot>apps/` tree, read both ways a value can
 * name it.
 *
 * The text is read first, and it has to be: npm resolves a `file:` value against the directory npm
 * itself runs from — the repository root — rather than against the manifest that declares it, so
 * `file:apps/api` reaches `<repositoryRoot>apps/api` from any workspace while the value's own text
 * is the only thing that says so, a bare relative path carrying no leading `.` or `/` for a
 * resolution to start from. Any value whose text carries the `apps/` segment once the `file:`
 * protocol prefix is stripped therefore names the tree, wherever inside it the rest of the value
 * then points.
 *
 * The resolution is read second, and it catches the spellings the text does not write: a value whose
 * stripped remainder begins with `.` or `/` is resolved against the declaring manifest's own
 * directory, and names the tree when the result is that `apps/` directory itself or a path under it —
 * `file:../../apps/api` written from a package, or `file:../api` written from `apps/web`, which
 * reaches `apps/api` without writing the segment at all.
 *
 * A value that neither carries the segment nor resolves into the tree names no path inside it — a
 * version range, a tag or a registry alias — and is not reported.
 *
 * @param repositoryRoot - The repository root whose `apps/` directory is the tree a value can name.
 * @param manifestPath - The manifest that declares the dependency, whose own directory a relative
 *   value is resolved against.
 * @param value - The dependency's value, or `null` when the manifest declares a shape that is not a
 *   string and so can name no path at all.
 * @returns Whether the value names the `apps/` tree by either reading.
 */
function namesAppsTree(repositoryRoot: string, manifestPath: string, value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const remainder = value.startsWith(FILE_PROTOCOL_PREFIX)
    ? value.slice(FILE_PROTOCOL_PREFIX.length)
    : value;
  if (remainder.includes(APPS_PATH_SEGMENT)) {
    return true;
  }
  if (!remainder.startsWith(".") && !remainder.startsWith("/")) {
    return false;
  }
  const appsDirectory = join(repositoryRoot, "apps");
  const resolved = resolve(dirname(manifestPath), remainder);
  return resolved === appsDirectory || resolved.startsWith(`${appsDirectory}${sep}`);
}

/**
 * The 1-indexed line of a dependency entry's name, searched from the start of the block it is
 * declared in, so a name that also appears in another block reports the block's own line. When the
 * name cannot be located the block's own line is reported, and the first line of the file after
 * that: a line is never fabricated as 0.
 */
function dependencyLine(manifestText: string, dependency: ManifestDependency): number {
  const blockIndex = manifestText.indexOf(`"${dependency.blockKey}"`);
  const searchFrom = blockIndex < 0 ? 0 : blockIndex;
  const nameIndex = manifestText.indexOf(`"${dependency.name}"`, searchFrom);
  if (nameIndex >= 0) {
    return lineOfIndex(manifestText, nameIndex);
  }
  if (blockIndex >= 0) {
    return lineOfIndex(manifestText, blockIndex);
  }
  return 1;
}

/**
 * Reads the root and workspace manifests and flags every edge a workspace's own row forbids.
 *
 * Every enumerated manifest is judged against the allowance the row of its own workspace states, so
 * an edge is reported wherever it is declared rather than in `packages/sgi-core/package.json` alone:
 * a declaration of one of the workspace packages the allowance table names, or of a subpath of one,
 * is reported unless the declaring workspace is on that package's permitted list, and a dependency
 * whose value names the `apps/` tree — by writing its segment or by resolving inside it, both of
 * which {@link namesAppsTree} reads — is reported wherever it is declared, because a path into the
 * `apps/` tree is a way into the API or the UI workspace and no row permits it. At most one
 * violation is reported per dependency: the name rule decides first, and the value rule is read only
 * for a name the table does not judge. Every manifest is read and parsed as well, because an
 * unreadable manifest is a defect this check must surface rather than skip.
 *
 * @param root - The repository root whose manifests are read and whose workspace directories the
 *   allowances are matched against, defaulting to this file's own repository. A workspace parent
 *   directory that is absent is simply absent from the enumeration.
 * @returns Every forbidden edge found, ordered by file, then line, then specifier; empty on the
 *   delivered repository, whose manifests declare only the edges their own rows permit.
 * @throws {Error} When `<root>package.json` or `<root>packages/sgi-core/package.json` cannot be read,
 *   and when a manifest that was read is not valid JSON or not a JSON object. An empty array from a
 *   manifest that was never read would pass the check for the wrong reason; it throws for nothing else.
 */
export function checkWorkspaceManifests(root: URL = DEFAULT_REPOSITORY_ROOT): BoundaryViolation[] {
  const repositoryRoot = fileURLToPath(root);
  const rootManifestPath = join(repositoryRoot, "package.json");
  if (!isFile(rootManifestPath)) {
    throw new Error(
      `boundary check cannot read the root manifest "${rootManifestPath}": it does not exist or is not a file`,
    );
  }

  const manifestPaths = enumerateManifestPaths(repositoryRoot);
  const sgiCoreManifestPath = resolve(repositoryRoot, SGI_CORE_MANIFEST_RELATIVE_PATH);
  if (!manifestPaths.some((manifestPath) => resolve(manifestPath) === sgiCoreManifestPath)) {
    throw new Error(
      `boundary check cannot read "${sgiCoreManifestPath}": the manifest it is required to check is missing, so an empty result would mean nothing was read rather than nothing violates the rules`,
    );
  }

  const violations: BoundaryViolation[] = [];
  for (const manifestPath of manifestPaths) {
    const text = readTextFile(manifestPath);
    const manifest = parseManifest(manifestPath, text);
    const file = toPosixPath(relative(repositoryRoot, manifestPath));
    // The workspace a manifest belongs to, as a path relative to the repository root: the root
    // manifest's own directory is the empty path, which no allowance permits an edge from.
    const workspaceDirectory = toPosixPath(relative(repositoryRoot, dirname(manifestPath)));
    for (const dependency of listManifestDependencies(manifestPath, manifest)) {
      const line = dependencyLine(text, dependency);
      const allowance = allowanceForDependencyName(dependency.name);
      if (allowance !== undefined) {
        if (!allowance.permittedWorkspaceDirectories.includes(workspaceDirectory)) {
          violations.push({
            file,
            absolutePath: manifestPath,
            line,
            specifier: dependency.name,
            rule: allowance.rule,
          });
        }
        continue;
      }
      if (namesAppsTree(repositoryRoot, manifestPath, dependency.value)) {
        violations.push({
          file,
          absolutePath: manifestPath,
          line,
          specifier: `${dependency.name}: ${dependency.value}`,
          rule: "manifest-edge-to-apps-api",
        });
      }
    }
  }

  violations.sort(compareViolations);
  return violations;
}

/**
 * Both checks, concatenated in a stable order: the source scan over its own default directory first,
 * which is the criterion-7 subject, then the manifest check.
 *
 * The source scan is deliberately never switched to the caller's directory. `root` is the repository
 * root whose manifests are read, so widening the scan is not possible from here and the criterion-7
 * call cannot be turned into one that always fails.
 *
 * @param root - The repository root whose manifests are read, defaulting to this file's own.
 * @returns Every forbidden edge the two checks found, in the order described above.
 * @throws {Error} For the conditions {@link checkSgiCoreImports} and {@link checkWorkspaceManifests}
 *   throw on, and for nothing else.
 */
export function runBoundaryChecks(root: URL = DEFAULT_REPOSITORY_ROOT): BoundaryViolation[] {
  return [...checkSgiCoreImports(), ...checkWorkspaceManifests(root)];
}

