/**
 * `npm run scan:exclusions` - the deterministic four-class exclusion scan.
 *
 * Reads the working tree's files, the dependency manifests and lockfiles, and the local `git log -p`
 * history, applies the rules held in `scripts/exclusion-rules.ts`, prints every finding with its file
 * and line, and exits non-zero when there is one. The rules module owns the four classes, their
 * matchers, the provider-digest hashing and the limitations text; this file owns the walking, the
 * ignore set, the two git reads, the exit code and the output format.
 *
 * Three properties the command rests on:
 *
 * - **It is deterministic.** No clock, host name or run counter reaches the output, and every
 *   finding's own file field is root-relative, so the same tree renders byte-identically and a
 *   spurious difference cannot hide a real one. The only absolute path it can carry is quoted
 *   inside a diagnostic note, where the note repeats a message that names a path: the resolved path
 *   of the provider digest store when that file cannot be read, or a message git printed. A
 *   diagnostic that did not say which file failed would not be actionable.
 * - **It reports without deleting.** Every file is opened for reading only, and no run writes,
 *   removes, moves or stages anything anywhere.
 * - **Its limitations are part of its output.** Every entry of `SCAN_LIMITATIONS` is printed with the
 *   findings, because the scan is supplementary to the manual privacy review in
 *   `docs/REVIEW-CHECKLIST.md` and is never a substitute for it.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXCLUSION_CLASSES,
  EXCLUSION_RULES,
  SCAN_LIMITATIONS,
  loadBlockedProviderTokens,
} from './exclusion-rules';
import type { ExclusionClass, ExclusionRule, FileKind, RuleMatch } from './exclusion-rules';

/** The command that runs this scan, named in the report so a reader knows how to repeat it. */
const SCAN_COMMAND = 'npm run scan:exclusions';

/** Exit code for an unexpected command line - the only code {@link main} decides on its own. */
const USAGE_EXIT_CODE = 2;

/** Path of the provider digest store, relative to the scan root. */
const DIGEST_STORE_RELATIVE_PATH = join('scripts', 'blocked-provider-hashes.json');

/** Bytes of a file read to decide whether it is binary: a NUL in this prefix makes it one. */
const BINARY_PROBE_BYTES = 8192;

/** Bytes of git output read before the read is abandoned with a note rather than a crash. */
const GIT_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;

/** The history header format: one commit line, its identity lines, then the commit's patch. */
const HISTORY_FORMAT = 'commit %H%nAuthor: %an <%ae>%nCommitter: %cn <%ce>%nDate: %ad';

/** Characters of a commit hash a history finding names the commit by. */
const HISTORY_HASH_CHARS = 7;

/** Log lines that describe the patch rather than belong to it. */
const PATCH_METADATA_PREFIXES: readonly string[] = Object.freeze([
  'index ',
  'new file mode',
  'old mode',
  'similarity index',
  'rename ',
]);

/** Directory names the fallback walk never descends into. */
const SKIPPED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  '.adem',
  'test-results',
  'playwright-report',
  'blob-report',
  'coverage',
]);

/** Repository-relative prefixes the fallback walk never descends into. */
const SKIPPED_PATH_PREFIXES: readonly string[] = Object.freeze([
  'blitzy/screenshots',
  'blitzy/screen_recordings',
]);

/** File suffixes the fallback walk never reads. */
const SKIPPED_FILE_SUFFIXES: readonly string[] = Object.freeze([
  '.tsbuildinfo',
  '.log',
  '.DS_Store',
]);

/** Manifest maps whose keys are declared dependency names. */
const MANIFEST_DEPENDENCY_SECTIONS: readonly string[] = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

/** Lockfile sections whose keys name resolved dependencies. */
const LOCKFILE_SECTIONS: readonly string[] = Object.freeze(['packages', 'dependencies']);

/** The path segment a lockfile `packages` key is read through, at its last occurrence. */
const NODE_MODULES_SEGMENT = 'node_modules/';

/** One finding: which rule fired, its class, the file and line, and a masked excerpt of the match. */
export interface ScanFinding {
  /** Id of the rule that fired, such as `email-address` or `prohibited-dependency`. */
  readonly ruleId: string;
  /** The class the rule reports, one of the four the rules module declares. */
  readonly class: ExclusionClass;
  /** Repository-relative path of the file, or `git:<commit>:<path>` for a line read from history. */
  readonly file: string;
  /** 1-based line the match was read from: the new-file line for an added line, the old-file line for a removed one. */
  readonly line: number;
  /** The masked match, exactly as the rule rendered it through `maskExcerpt`. */
  readonly excerpt: string;
}

/** Everything one run decided, and the exit code the command should leave behind. */
export interface ScanResult {
  /** Every finding, deduplicated and ordered by class, then file, then line, then rule id. */
  readonly findings: readonly ScanFinding[];
  /** Files whose text was read and scanned. */
  readonly filesScanned: number;
  /** Files counted as skipped: binary, or unreadable. */
  readonly filesSkipped: number;
  /** Added and removed patch lines examined in `git log -p`. `0` when no history was read. */
  readonly historyLinesScanned: number;
  /** Operator-facing notes, such as why no history was read. Empty when there is nothing to report. */
  readonly notes: readonly string[];
  /** `1` when there is at least one finding and `0` when there is none. */
  readonly exitCode: number;
}

/**
 * Options of {@link runScan}; every one of them exists so a caller can drive the whole scan without
 * spawning a process, which is what the self-test does.
 */
export interface RunScanOptions {
  /** Root to read from. Defaults to the current working directory. */
  readonly root?: string;
  /** Path of the provider digest store. Defaults to `<root>/scripts/blocked-provider-hashes.json`. */
  readonly blockedProviderPath?: string;
  /** Digests to match against instead of reading the store, as the self-test injects one. */
  readonly blockedTokenDigests?: ReadonlySet<string>;
  /** Whether to read `git log -p`. Defaults to `true`. */
  readonly includeHistory?: boolean;
}

/** One dependency name a document declares or resolves, and where it was read from. */
interface DependencyName {
  /** The key exactly as the document spells it, which is what the line search looks for. */
  readonly key: string;
  /** The name the rules are fed: the key, with a `packages` key read past its `node_modules/` run. */
  readonly name: string;
  /** The section the name was read from. */
  readonly section: string;
}

/** What one document's dependency read produced: its findings, and a note when it could not be read. */
interface DependencyScan {
  /** Findings the dependency rules produced. */
  readonly findings: readonly ScanFinding[];
  /** A note naming why the document yielded no dependency names, or `null` when it was read in full. */
  readonly note: string | null;
}

/** What the history read produced: its findings, the patch lines examined, and a note when it failed. */
interface HistoryScan {
  /** Findings the line rules produced over the patch's content lines. */
  readonly findings: readonly ScanFinding[];
  /** Added and removed patch lines examined. */
  readonly linesScanned: number;
  /** A note naming why no history was read, or `null` when the history was read. */
  readonly note: string | null;
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

/** Where each class sits in the report order, so findings sort by class before anything else. */
const CLASS_ORDER: ReadonlyMap<ExclusionClass, number> = new Map(
  EXCLUSION_CLASSES.map((exclusionClass, index) => [exclusionClass, index] as const),
);

/** Orders findings by class, then file, then line, then rule id. */
function compareFindings(left: ScanFinding, right: ScanFinding): number {
  const unknownClass = EXCLUSION_CLASSES.length;
  const byClass =
    (CLASS_ORDER.get(left.class) ?? unknownClass) - (CLASS_ORDER.get(right.class) ?? unknownClass);
  if (byClass !== 0) {
    return byClass;
  }
  const byFile = compareStrings(left.file, right.file);
  if (byFile !== 0) {
    return byFile;
  }
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return compareStrings(left.ruleId, right.ruleId);
}

/** One key per finding identity: the rule, file, line and excerpt the report prints. */
function findingIdentity(finding: ScanFinding): string {
  return [finding.ruleId, finding.file, String(finding.line), finding.excerpt].join('\u0000');
}

/** The findings the report prints: duplicates of one identity removed, then ordered. */
function orderFindings(findings: readonly ScanFinding[]): readonly ScanFinding[] {
  const seen = new Set<string>();
  const unique: ScanFinding[] = [];
  for (const finding of findings) {
    const identity = findingIdentity(finding);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    unique.push(finding);
  }
  return unique.sort(compareFindings);
}

/** The rules that read a document line by line, in the order the module declares them. */
const LINE_RULES: readonly ExclusionRule[] = Object.freeze(
  EXCLUSION_RULES.filter((rule) => rule.kind === 'line'),
);

/** The rules that read a dependency name, in the order the module declares them. */
const DEPENDENCY_RULES: readonly ExclusionRule[] = Object.freeze(
  EXCLUSION_RULES.filter((rule) => rule.kind === 'dependency'),
);

/** The line rules that apply to one file kind. */
function lineRulesFor(kind: FileKind): readonly ExclusionRule[] {
  return LINE_RULES.filter((rule) => rule.appliesTo.includes(kind));
}

/** The dependency rules that apply to one file kind. */
function dependencyRulesFor(kind: FileKind): readonly ExclusionRule[] {
  return DEPENDENCY_RULES.filter((rule) => rule.appliesTo.includes(kind));
}

/**
 * Runs one rule over one line and appends what it matched.
 *
 * The excerpt is the rule's own, rendered through the rules module's `maskExcerpt`, so no raw matched
 * value ever reaches the report.
 */
function appendLineFindings(
  findings: ScanFinding[],
  rules: readonly ExclusionRule[],
  file: string,
  kind: FileKind,
  line: number,
  text: string,
): void {
  for (const rule of rules) {
    const matches: readonly RuleMatch[] =
      rule.matchLine === undefined ? [] : rule.matchLine({ file, kind, line, text });
    for (const match of matches) {
      findings.push({ ruleId: match.ruleId, class: rule.class, file, line, excerpt: match.excerpt });
    }
  }
}

/** Applies every applicable line rule to each line of a file's text. */
function findLineFindings(
  file: string,
  kind: FileKind,
  text: string,
  findings: ScanFinding[],
): void {
  const rules = lineRulesFor(kind);
  if (rules.length === 0) {
    return;
  }
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    appendLineFindings(findings, rules, file, kind, index + 1, lines[index] ?? '');
  }
}

/** The file's lines without their terminator, so a CRLF file yields the same text as an LF one. */
function splitLines(text: string): readonly string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** The kind the rules module knows a file by: the lockfile, any manifest, and everything else. */
function fileKindOf(file: string): FileKind {
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (name === 'package-lock.json') {
    return 'lockfile';
  }
  if (name === 'package.json') {
    return 'manifest';
  }
  return 'text';
}

/** The dependency a lockfile `packages` key names: the text after its last `node_modules/` run. */
function lockfilePackageName(key: string): string {
  const segment = key.lastIndexOf(NODE_MODULES_SEGMENT);
  return segment < 0 ? key : key.slice(segment + NODE_MODULES_SEGMENT.length);
}

/** Every dependency name one document declares or resolves, in section then document order. */
function dependencyNames(kind: FileKind, document: Record<string, unknown>): readonly DependencyName[] {
  const sections = kind === 'lockfile' ? LOCKFILE_SECTIONS : MANIFEST_DEPENDENCY_SECTIONS;
  const names: DependencyName[] = [];
  for (const section of sections) {
    const value = document[section];
    if (!isRecord(value)) {
      continue;
    }
    for (const key of Object.keys(value)) {
      const name = section === 'packages' ? lockfilePackageName(key) : key;
      if (name.trim().length === 0) {
        continue;
      }
      names.push({ key, name, section });
    }
  }
  return names;
}

/** The 1-based line a section header is written on, or `1` when the document does not spell it. */
function findSectionLine(lines: readonly string[], section: string): number {
  const header = JSON.stringify(section);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (!line.startsWith(header)) {
      continue;
    }
    if (line.slice(header.length).trimStart().startsWith(':')) {
      return index + 1;
    }
  }
  return 1;
}

/**
 * The 1-based line a key was read from, searching from its section header.
 *
 * Returns the section header's line when the key cannot be located, and `1` when that cannot be either:
 * a finding with no line number at all would be worse than one pointing at the document holding it.
 */
function findKeyLine(
  lines: readonly string[],
  key: string,
  section: string,
  usedLines: Set<number>,
): number {
  const sectionLine = findSectionLine(lines, section);
  const needle = JSON.stringify(key);
  for (let index = sectionLine - 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    if (usedLines.has(lineNumber)) {
      continue;
    }
    const line = lines[index] ?? '';
    const at = line.indexOf(needle);
    if (at < 0 || !line.slice(at + needle.length).trimStart().startsWith(':')) {
      continue;
    }
    usedLines.add(lineNumber);
    return lineNumber;
  }
  return sectionLine;
}

/**
 * Reads one manifest's or lockfile's dependency names and feeds each to the dependency rules.
 *
 * Returns the findings, and a note when the document could not be read as a JSON object: a silent skip
 * would read as a clean result, while the run has to be able to point at the document it could not
 * read.
 */
function findDependencyFindings(
  file: string,
  kind: FileKind,
  text: string,
  blockedTokenDigests: ReadonlySet<string>,
): DependencyScan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { findings: [], note: `${file} was not read as a dependency document: ${messageOf(error)}` };
  }
  if (!isRecord(parsed)) {
    return {
      findings: [],
      note: `${file} was not read as a dependency document: expected a JSON object`,
    };
  }
  const rules = dependencyRulesFor(kind);
  if (rules.length === 0) {
    return { findings: [], note: null };
  }
  const lines = splitLines(text);
  const usedLines = new Set<number>();
  const findings: ScanFinding[] = [];
  for (const dependency of dependencyNames(kind, parsed)) {
    const line = findKeyLine(lines, dependency.key, dependency.section, usedLines);
    for (const rule of rules) {
      const matches: readonly RuleMatch[] =
        rule.matchDependency === undefined
          ? []
          : rule.matchDependency(
              { file, kind, line, name: dependency.name, section: dependency.section },
              blockedTokenDigests,
            );
      for (const match of matches) {
        findings.push({ ruleId: match.ruleId, class: rule.class, file, line, excerpt: match.excerpt });
      }
    }
  }
  return { findings, note: null };
}

/** The directory's entries, or an empty list when it cannot be read. */
function readDirectoryEntries(path: string): readonly Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    // An unreadable directory contributes no files rather than failing the scan: the run's verdict is
    // about what it could read, and the count of what it skipped is printed beside it.
    return [];
  }
}

/** Whether a repository-relative path falls under one of the prefixes the walk never descends into. */
function isSkippedPrefix(path: string): boolean {
  return SKIPPED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Whether a repository-relative file path holds a name the walk never reads. */
function isSkippedFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name === '.env' || name.startsWith('.env.')) {
    return true;
  }
  return SKIPPED_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * The root's files by a recursive walk, for a root git cannot list.
 *
 * This is the path a temporary tree outside any checkout takes, which is how the self-test's planted
 * violations are scanned. Directories named in {@link SKIPPED_DIRECTORY_NAMES}, paths under
 * {@link SKIPPED_PATH_PREFIXES} and files named in {@link SKIPPED_FILE_SUFFIXES} are never entered or
 * read, and neither are `.env` files or symbolic links: the walk follows nothing out of the root.
 */
function walkRoot(root: string): readonly string[] {
  const found: string[] = [];
  const pending: string[] = [''];
  while (pending.length > 0) {
    const directory = pending.pop() ?? '';
    for (const entry of readDirectoryEntries(join(root, directory))) {
      const path = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name) && !isSkippedPrefix(path)) {
          pending.push(path);
        }
        continue;
      }
      if (entry.isFile() && !isSkippedFile(path)) {
        found.push(path);
      }
    }
  }
  return found;
}

/**
 * The files git considers part of the working tree: tracked, plus untracked-but-not-ignored.
 *
 * Returns `null` when git cannot answer - no git, or a root that is not a work tree, which is what a
 * temporary directory outside any checkout is - so that the caller falls back to its own walk.
 */
function listWorkTreeFiles(root: string): readonly string[] | null {
  const listing = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BYTES, windowsHide: true },
  );
  if (listing.error !== undefined || listing.status !== 0 || typeof listing.stdout !== 'string') {
    return null;
  }
  const files: string[] = [];
  for (const entry of listing.stdout.split('\0')) {
    if (entry.length === 0 || entry.endsWith('/')) {
      continue;
    }
    if (entry.startsWith('/') || entry === '..' || entry.startsWith('../')) {
      continue;
    }
    files.push(entry);
  }
  return files;
}

/** Every file the scan reads, as root-relative paths in a stable order. */
function listFiles(root: string): readonly string[] {
  return [...(listWorkTreeFiles(root) ?? walkRoot(root))].sort(compareStrings);
}

/**
 * Whether the file's first 8 KiB hold no NUL, read through a handle that is always released.
 *
 * A binary file is answered `false` here and is never decoded, so no rule ever sees a byte of one. A
 * file that cannot be opened, read or closed is answered `false` as well: it is counted as skipped
 * rather than reported as clean.
 */
function headHoldsText(path: string): boolean {
  let handle: number;
  try {
    handle = openSync(path, 'r');
  } catch {
    return false;
  }
  let holdsText = false;
  try {
    const probe = Buffer.alloc(BINARY_PROBE_BYTES);
    const read = readSync(handle, probe, 0, BINARY_PROBE_BYTES, 0);
    holdsText = !probe.subarray(0, read).includes(0);
  } catch {
    holdsText = false;
  }
  try {
    closeSync(handle);
  } catch {
    holdsText = false;
  }
  return holdsText;
}

/** The file's text, or `null` when it is binary or unreadable. */
function readTextIfAny(path: string): string | null {
  if (!headHoldsText(path)) {
    return null;
  }
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Whether git resolves the root as a work tree, which is what the history read needs. */
function isWorkTree(root: string): boolean {
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return probe.error === undefined && probe.status === 0 && probe.stdout.trim() === 'true';
}

/** The two start lines of a hunk header, or `null` when the line is not one this scan can number. */
function parseHunkHeader(line: string): { readonly oldStart: number; readonly newStart: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (match === null) {
    return null;
  }
  const oldStart = Number.parseInt(match[1] ?? '', 10);
  const newStart = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isInteger(oldStart) || !Number.isInteger(newStart)) {
    return null;
  }
  return { oldStart, newStart };
}

/** The repository-relative path of a `---` or `+++` patch header, or `null` for `/dev/null`. */
function patchPath(header: string): string | null {
  const value = header.trim();
  if (value.length === 0 || value === '/dev/null') {
    return null;
  }
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value;
}

/** One patch content line, applied to the line rules and reported against the commit that carries it. */
function appendHistoryFindings(
  findings: ScanFinding[],
  rules: readonly ExclusionRule[],
  commit: string,
  path: string,
  line: number,
  text: string,
): void {
  const file = `git:${commit.slice(0, HISTORY_HASH_CHARS)}:${path}`;
  appendLineFindings(findings, rules, file, 'text', line, text);
}

/**
 * Reads the patch's added and removed content lines and applies every line rule to them.
 *
 * A patch line has no file kind of its own, so each one is read as text, which is the kind every
 * content rule applies to. The file a finding names is `git:<commit>:<path>` with the commit's first
 * seven characters, and its line is the new-file number for an added line and the old-file number for
 * a removed one, taken from the hunk header the line sits under.
 */
function readPatchContent(patch: string): HistoryScan {
  const findings: ScanFinding[] = [];
  const rules = lineRulesFor('text');
  let commit = '';
  let file: string | null = null;
  let pendingFile: string | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let linesScanned = 0;

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('commit ')) {
      commit = line.slice('commit '.length).trim();
      file = null;
      pendingFile = null;
      inHunk = false;
      continue;
    }
    if (line.startsWith('diff ')) {
      file = null;
      pendingFile = null;
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      const hunk = parseHunkHeader(line);
      inHunk = hunk !== null;
      if (hunk !== null) {
        oldLine = hunk.oldStart;
        newLine = hunk.newStart;
      }
      continue;
    }
    if (PATCH_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    if (!inHunk) {
      // Outside a hunk only the two file headers carry a path, and the commit's own identity lines
      // carry none: the header shape is what the rules module exempts an address on.
      if (line.startsWith('--- ')) {
        pendingFile = patchPath(line.slice(4));
        continue;
      }
      if (line.startsWith('+++ ')) {
        file = patchPath(line.slice(4)) ?? pendingFile;
      }
      continue;
    }
    if (line.startsWith('\\')) {
      // `\ No newline at end of file` describes the line above rather than being one.
      continue;
    }
    if (line.startsWith('+')) {
      linesScanned += 1;
      if (file !== null) {
        appendHistoryFindings(findings, rules, commit, file, newLine, line.slice(1));
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      linesScanned += 1;
      if (file !== null) {
        appendHistoryFindings(findings, rules, commit, file, oldLine, line.slice(1));
      }
      oldLine += 1;
      continue;
    }
    // A context line advances both files' numbering and carries no finding of its own.
    oldLine += 1;
    newLine += 1;
  }

  return { findings, linesScanned, note: null };
}

/**
 * Reads the local history's patches, or records why it could not.
 *
 * A root that is not a work tree, and a git that will not run at all, are expected situations rather
 * than failures: each yields a note naming that no history was read. Any other failure yields a note
 * carrying git's own message, so the run says what happened instead of throwing a stack trace at a
 * reader.
 */
function scanGitHistory(root: string): HistoryScan {
  const history = spawnSync(
    'git',
    ['log', '-p', '--no-color', '--no-merges', '--no-ext-diff', `--format=${HISTORY_FORMAT}`],
    { cwd: root, encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BYTES, windowsHide: true },
  );
  if (history.error !== undefined) {
    return {
      findings: [],
      linesScanned: 0,
      note: `no git history was read: the history command could not run: ${messageOf(history.error)}`,
    };
  }
  if (history.status !== 0 || typeof history.stdout !== 'string') {
    if (!isWorkTree(root)) {
      return {
        findings: [],
        linesScanned: 0,
        note: 'no git history was read: the scan root is not a git work tree',
      };
    }
    const reason = (history.stderr ?? '').trim();
    return {
      findings: [],
      linesScanned: 0,
      note: `no git history was read: ${reason.length > 0 ? reason : 'the history command exited non-zero'}`,
    };
  }
  return readPatchContent(history.stdout);
}

/**
 * Runs the whole scan and returns what it found, without printing anything and without touching the
 * process exit code.
 *
 * The provider digest store is read once, before any file: the prohibited-dependency rule cannot match
 * a name without it, so a store that is missing, malformed or unreadable refuses the run with the
 * loader's own message as the single note rather than reporting a scan that could not have seen a
 * prohibited dependency. The scan then reads the working tree's files, the manifests and lockfiles,
 * and the history, and never writes anything.
 *
 * @param options - The root, the digest store and its override, and whether to read the history.
 * @returns Every finding with its file and line, the file and history counts, the notes, and `1` when
 * there is at least one finding or `0` when there is none.
 */
export function runScan(options: RunScanOptions = {}): ScanResult {
  const root = resolvePath(options.root ?? process.cwd());

  let blockedTokenDigests: ReadonlySet<string>;
  try {
    blockedTokenDigests =
      options.blockedTokenDigests ??
      loadBlockedProviderTokens(
        options.blockedProviderPath ?? join(root, DIGEST_STORE_RELATIVE_PATH),
      );
  } catch (error) {
    return {
      findings: [],
      filesScanned: 0,
      filesSkipped: 0,
      historyLinesScanned: 0,
      notes: [messageOf(error)],
      exitCode: 1,
    };
  }

  const notes: string[] = [];
  const findings: ScanFinding[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;

  for (const file of listFiles(root)) {
    const text = readTextIfAny(join(root, file));
    if (text === null) {
      filesSkipped += 1;
      continue;
    }
    filesScanned += 1;
    const kind = fileKindOf(file);
    findLineFindings(file, kind, text, findings);
    if (kind !== 'text') {
      const dependency = findDependencyFindings(file, kind, text, blockedTokenDigests);
      if (dependency.note !== null) {
        notes.push(dependency.note);
      }
      findings.push(...dependency.findings);
    }
  }

  let historyLinesScanned = 0;
  if (options.includeHistory ?? true) {
    const history = scanGitHistory(root);
    historyLinesScanned = history.linesScanned;
    findings.push(...history.findings);
    if (history.note !== null) {
      notes.push(history.note);
    }
  }

  const ordered = orderFindings(findings);
  return {
    findings: ordered,
    filesScanned,
    filesSkipped,
    historyLinesScanned,
    notes,
    exitCode: ordered.length > 0 ? 1 : 0,
  };
}

/**
 * Renders the report for one result: the command, the counts, every limitation the scan states, one
 * subsection per rule with its findings, the notes, and the summary line.
 *
 * What this function renders from a result - the findings, the counts, the limitations and the
 * summary - carries no timestamp, no host name, no absolute path and no run counter, so the same tree
 * renders byte-identically; every finding's own file field is root-relative. The exception is a note,
 * which may quote a message that names a path: the resolved path of the provider digest store when
 * that file cannot be read, for instance, or a message git printed, because a diagnostic that did not
 * say which file failed would not be actionable. Every limitation in `SCAN_LIMITATIONS` is printed
 * verbatim, because that list is the artefact's own statement of its limits and a scan must not be
 * read as covering more than it does. Excerpts are printed exactly as the rules masked them, so a
 * report can never echo a raw matched value.
 *
 * @param result - One run's findings, counts and notes.
 * @returns The report, ready to print, ending in a newline.
 */
export function renderScanReport(result: ScanResult): string {
  const lines: string[] = [
    `${SCAN_COMMAND} - the deterministic exclusion scan over the working tree's files, the dependency manifests and lockfiles, and the local git history. It reports every finding with its file and line and deletes nothing.`,
    `Read ${result.filesScanned} file(s) and ${result.historyLinesScanned} git-history line(s); skipped ${result.filesSkipped} file(s) that are binary or unreadable.`,
    '',
    'Limitations of this scan:',
  ];
  for (const limitation of SCAN_LIMITATIONS) {
    lines.push(`- ${limitation}`);
  }

  lines.push('', 'Findings by rule:');
  for (const rule of EXCLUSION_RULES) {
    lines.push('', rule.id);
    const ruleFindings = result.findings.filter((finding) => finding.ruleId === rule.id);
    if (ruleFindings.length === 0) {
      lines.push('- none');
      continue;
    }
    for (const finding of ruleFindings) {
      lines.push(`- ${finding.file}:${finding.line}  ${finding.excerpt}`);
    }
  }

  lines.push('', 'Notes:');
  if (result.notes.length === 0) {
    lines.push('- none');
  } else {
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
  }

  const ruleCount = new Set(result.findings.map((finding) => finding.ruleId)).size;
  lines.push('', `${result.findings.length} finding(s) across ${ruleCount} rule(s).`);
  return `${lines.join('\n')}\n`;
}

/**
 * Decides what the command line allows before any work starts.
 *
 * The scan takes no arguments, which is the only thing this can decide on its own.
 *
 * @param argv - Arguments after the script name. Defaults to the process's own.
 * @returns `0` when the command may proceed, {@link USAGE_EXIT_CODE} for an unexpected argument.
 */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const unexpected = argv.filter((argument) => argument.trim().length > 0);
  if (unexpected.length > 0) {
    process.stderr.write(
      `scan:exclusions takes no arguments; unexpected: ${unexpected.join(' ')}\n`,
    );
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
    // The library path never calls process.exit and never prints: the report and the exit code are all
    // the process is given, which is what lets the self-test drive the same scan in-process.
    try {
      const result = runScan();
      process.stdout.write(renderScanReport(result));
      process.exitCode = result.exitCode;
    } catch (error) {
      process.stderr.write(`exclusion scan failed: ${messageOf(error)}\n`);
      process.exitCode = 1;
    }
  }
}
