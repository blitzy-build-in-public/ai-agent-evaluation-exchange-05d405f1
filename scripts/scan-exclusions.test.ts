/**
 * The exclusion scan's planted-violation self-test.
 *
 * `npm run scan:exclusions` is the gate criterion 10 rests on: it reads the working tree, the
 * manifests, the lockfile and the git history, reports every finding with its file and line without
 * deleting anything, and exits non-zero when there is one. This suite proves that from both ends -
 * the delivered repository, which must scan clean and exit `0`, and a temporary tree it plants one
 * violation of each detectable class into, which must exit `1` naming the planted file and line. The
 * exit code is read three ways: in-process through `runScan`, through the rendered report, and from
 * the real command line spawned as its own process.
 *
 * Every planted value is assembled from parts at run time, exactly as `scripts/exclusion-rules.ts`
 * assembles its own patterns. This file is itself scanned - the delivered repository is the scan's own
 * worst false-positive case - so a literal address, telephone number, private-key header or credential
 * value here would make the clean-run case fail on the suite's own text.
 *
 * The temporary trees live under `tmpdir()` and are removed in `afterAll`; no run writes anything into
 * the repository, and the identity of the temporary commit comes from the spawned git process's
 * environment rather than from any `git config` write.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { EXCLUSION_RULES, SCAN_LIMITATIONS, hashToken, loadBlockedProviderTokens } from './exclusion-rules';
import type { RuleLineContext, RuleMatch } from './exclusion-rules';
import { main, renderScanReport, runScan } from './scan-exclusions';
import type { ScanResult } from './scan-exclusions';

/** The repository root, taken from this file's own location: `scripts/` sits directly under it. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The command the report names as its generator. */
const SCAN_COMMAND = 'npm run scan:exclusions';

/** The exit code an unexpected argument earns, which `main` decides on its own. */
const USAGE_EXIT_CODE = 2;

/** The address separator, assembled as `exclusion-rules.ts` assembles its own. */
const ADDRESS_SEPARATOR = String.fromCharCode(64);

/** The five dashes of a PEM-style header, assembled so no header appears literally in this file. */
const DASH_RUN = '-'.repeat(5);

/** A mail-address shape, assembled from parts and used for the planted line and the commit identity. */
const PLANTED_ADDRESS = `${['planted', 'address'].join('.')}${ADDRESS_SEPARATOR}${['example', 'invalid'].join('.')}`;

/** A grouped telephone-number shape the scan reports beside its own keyword. */
const PLANTED_TELEPHONE = ['555', '0100', '1234'].join('-');

/**
 * A token of two digit groups joined by a single hyphen, assembled from parts: the shape of an
 * identifier span or a numeric range, which the scan reports only beside a telephone keyword.
 */
const HYPHEN_JOINED_TWO_GROUP_TOKEN = ['0002', '0005'].join('-');

/** A two-group number opened with a plus, which the shape-only path still reports. */
const PLUS_JOINED_TWO_GROUP_TOKEN = `+${['44', '2079460958'].join('-')}`;

/** A PEM-style private-key header line, assembled from the dash run. */
const PLANTED_KEY_HEADER = `${DASH_RUN}BEGIN PRIVATE KEY${DASH_RUN}`;

/** A 20-character high-entropy value: well clear of the rule's length floor and entropy gate. */
const PLANTED_CREDENTIAL_VALUE = ['aZ9', 'kQ2', 'mL7', 'pR4', 'tX8', 'wV3', 'nB'].join('');

/** The planted line that assigns the credential keyword to that value. */
const PLANTED_CREDENTIAL_LINE = `password: ${PLANTED_CREDENTIAL_VALUE}`;

/** A dependency name that no store names: only its digest is written anywhere. */
const PLANTED_PROVIDER_NAME = ['not', 'a', 'real', 'provider'].join('-');

/** The digest the planted dependency name hashes to, which the synthetic store holds. */
const PLANTED_PROVIDER_DIGEST = hashToken(PLANTED_PROVIDER_NAME);

/** Name of the planted text file that carries an address. */
const ADDRESS_FILE = 'planted-address.txt';

/** Name of the planted text file that carries a keyword-anchored telephone number. */
const TELEPHONE_FILE = 'planted-telephone.txt';

/** Name of the planted text file that carries a private-key header and a credential assignment. */
const CREDENTIAL_FILE = 'planted-credential.txt';

/** Name of the planted manifest that declares the prohibited dependency. */
const MANIFEST_FILE = 'package.json';

/** Path of the synthetic digest store, relative to a temporary root. */
const STORE_FILE = ['scripts', 'blocked-provider-hashes.json'].join('/');

/** Path of the file the history tree commits and then deletes from its working tree. */
const HISTORY_FILE = ['history', 'planted-history.txt'].join('/');

/** The temporary root the planted violations live in, removed when the suite ends. */
const PLANTED_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-planted-'));

/** The temporary git repository the history case reads, removed when the suite ends. */
const HISTORY_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-history-'));

/** The temporary root the refused digest stores live in, removed when the suite ends. */
const REFUSED_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-refused-'));

/** The lines of the planted address file, so the case can name the line it expects reported. */
const PLANTED_ADDRESS_LINES: readonly string[] = [
  '# a planted text file: the scan reads it and reports the address below',
  'a line that holds no finding at all',
  `contact ${PLANTED_ADDRESS} for details`,
];

/** The lines of the planted telephone file. */
const PLANTED_TELEPHONE_LINES: readonly string[] = [
  '# a planted text file: the scan reads it and reports the number below',
  `telephone: ${PLANTED_TELEPHONE}`,
];

/** The lines of the planted credential file: the header, then the keyword's own line. */
const PLANTED_KEY_HEADER_LINES: readonly string[] = [
  PLANTED_KEY_HEADER,
  PLANTED_CREDENTIAL_LINE,
];

/** The lines of the planted manifest that declares the prohibited dependency. */
const PLANTED_MANIFEST_LINES: readonly string[] = [
  '{',
  '  "name": "planted-tree",',
  '  "version": "0.0.0",',
  '  "private": true,',
  '  "dependencies": {',
  `    ${JSON.stringify(PLANTED_PROVIDER_NAME)}: "1.0.0"`,
  '  }',
  '}',
];

/** The lines of the planted history file the history tree commits and then deletes. */
const HISTORY_LINES: readonly string[] = [
  '# committed once, then deleted from the working tree',
  `contact ${PLANTED_ADDRESS} for details`,
];

/** Every planted file and the exact contents the suite writes, so both runs can be held to them. */
const PLANTED_FILE_CONTENTS: ReadonlyArray<{ readonly file: string; readonly contents: string }> = [
  { file: ADDRESS_FILE, contents: `${PLANTED_ADDRESS_LINES.join('\n')}\n` },
  { file: TELEPHONE_FILE, contents: `${PLANTED_TELEPHONE_LINES.join('\n')}\n` },
  { file: CREDENTIAL_FILE, contents: `${PLANTED_KEY_HEADER_LINES.join('\n')}\n` },
  { file: MANIFEST_FILE, contents: `${PLANTED_MANIFEST_LINES.join('\n')}\n` },
  { file: STORE_FILE, contents: storeDocument() },
];

/** One planted violation the temporary tree holds, and the finding it has to produce. */
interface PlantedExpectation {
  /** Id of the rule that has to fire. */
  readonly ruleId: string;
  /** The file the finding has to name, as a root-relative path. */
  readonly file: string;
  /** The 1-based line the finding has to name. */
  readonly line: number;
}

/** The synthetic digest store, written as JSON so the loader reads exactly what the scan reads. */
function storeDocument(): string {
  const document = {
    algorithm: 'sha256',
    normalization: 'trim-lowercase',
    tokens: [PLANTED_PROVIDER_DIGEST],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Writes a file under a root, creating the directories it needs. */
function writeTempFile(root: string, relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

/** The 1-based line of the first entry holding a needle, so a case never guesses a line number. */
function lineOf(lines: readonly string[], needle: string): number {
  const index = lines.findIndex((line) => line.includes(needle));
  if (index < 0) {
    throw new Error(`the planted text holds no line with ${needle}`);
  }
  return index + 1;
}

/** The findings the planted tree has to produce, one per rule a planted violation fires. */
const PLANTED_EXPECTATIONS: ReadonlyArray<PlantedExpectation> = [
  { ruleId: 'email-address', file: ADDRESS_FILE, line: lineOf(PLANTED_ADDRESS_LINES, PLANTED_ADDRESS) },
  {
    ruleId: 'telephone-number',
    file: TELEPHONE_FILE,
    line: lineOf(PLANTED_TELEPHONE_LINES, PLANTED_TELEPHONE),
  },
  { ruleId: 'private-key-header', file: CREDENTIAL_FILE, line: lineOf(PLANTED_KEY_HEADER_LINES, PLANTED_KEY_HEADER) },
  {
    ruleId: 'credential-assignment',
    file: CREDENTIAL_FILE,
    line: lineOf(PLANTED_KEY_HEADER_LINES, PLANTED_CREDENTIAL_VALUE),
  },
  {
    ruleId: 'prohibited-dependency',
    file: MANIFEST_FILE,
    line: lineOf(PLANTED_MANIFEST_LINES, JSON.stringify(PLANTED_PROVIDER_NAME)),
  },
];

/** The line of the planted address inside the history tree's committed file. */
const HISTORY_ADDRESS_LINE = lineOf(HISTORY_LINES, PLANTED_ADDRESS);

/** One address-shaped line read in three contexts, with the finding count each one earns. */
const ADDRESS_CONTEXTS: ReadonlyArray<{
  readonly label: string;
  readonly context: RuleLineContext;
  readonly expected: number;
}> = [
  {
    label: 'a text file',
    context: { file: ADDRESS_FILE, kind: 'text', line: 1, text: `contact ${PLANTED_ADDRESS} for details` },
    expected: 1,
  },
  {
    label: 'a lockfile',
    context: { file: 'package-lock.json', kind: 'lockfile', line: 1, text: `contact ${PLANTED_ADDRESS} for details` },
    expected: 0,
  },
  {
    label: 'an Author header line',
    context: {
      file: `git:${'0'.repeat(7)}:${ADDRESS_FILE}`,
      kind: 'text',
      line: 1,
      text: `Author: Scan Self Test <${PLANTED_ADDRESS}>`,
    },
    expected: 0,
  },
  {
    label: 'a Committer header line',
    context: {
      file: `git:${'0'.repeat(7)}:${ADDRESS_FILE}`,
      kind: 'text',
      line: 1,
      text: `Committer: Scan Self Test <${PLANTED_ADDRESS}>`,
    },
    expected: 0,
  },
];

/** One telephone-shaped line and the number of findings the `telephone-number` rule yields for it. */
const TELEPHONE_SHAPES: ReadonlyArray<{
  readonly label: string;
  readonly text: string;
  readonly expected: number;
}> = [
  {
    label: 'a bare two-group token joined by one hyphen',
    text: `the range ${HYPHEN_JOINED_TWO_GROUP_TOKEN} declares it the same way`,
    expected: 0,
  },
  {
    label: 'a three-group hyphenated number',
    text: `reachable at ${PLANTED_TELEPHONE} during office hours`,
    expected: 1,
  },
  {
    label: 'a plus-prefixed two-group number',
    text: `reachable at ${PLUS_JOINED_TWO_GROUP_TOKEN} during office hours`,
    expected: 1,
  },
  {
    label: 'the bare two-group token beside a telephone keyword',
    text: `telephone: ${HYPHEN_JOINED_TWO_GROUP_TOKEN} is the range this comment names`,
    expected: 1,
  },
];

/** One digest store the loader has to refuse, and the file the case writes it to. */
const REFUSED_STORES: ReadonlyArray<{
  readonly label: string;
  readonly file: string;
  readonly document: unknown;
}> = [
  {
    label: 'a store whose algorithm is not sha256',
    file: 'refused-algorithm.json',
    document: { algorithm: 'sha512', normalization: 'trim-lowercase', tokens: [PLANTED_PROVIDER_DIGEST] },
  },
  {
    label: 'a store whose normalization is not trim-lowercase',
    file: 'refused-normalization.json',
    document: { algorithm: 'sha256', normalization: 'lowercase', tokens: [PLANTED_PROVIDER_DIGEST] },
  },
  {
    label: 'a store holding an entry that is not a 64-character lowercase digest',
    file: 'refused-entry.json',
    document: { algorithm: 'sha256', normalization: 'trim-lowercase', tokens: ['Z'.repeat(64)] },
  },
];

for (const planted of PLANTED_FILE_CONTENTS) {
  writeTempFile(PLANTED_ROOT, planted.file, planted.contents);
}

for (const refused of REFUSED_STORES) {
  writeTempFile(REFUSED_ROOT, refused.file, `${JSON.stringify(refused.document, null, 2)}\n`);
}

/** Runs a rule out of the exported list by id, which is how a case reads one rule directly. */
function matchLineOf(ruleId: string, context: RuleLineContext): readonly RuleMatch[] {
  const matcher = EXCLUSION_RULES.find((rule) => rule.id === ruleId)?.matchLine;
  if (matcher === undefined) {
    throw new Error(`scripts/exclusion-rules.ts exports no line rule with id ${ruleId}`);
  }
  return matcher(context);
}

/** What one spawned command produced. */
interface CommandRun {
  /** The process's exit status, or `null` when it did not exit normally. */
  readonly status: number | null;
  /** Everything the command wrote to stdout. */
  readonly stdout: string;
  /** Everything the command wrote to stderr. */
  readonly stderr: string;
}

/** Runs a command and returns its status and both output streams, with nothing inherited from the shell. */
function runProcess(command: string, args: readonly string[], cwd: string): CommandRun {
  const run = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: HISTORY_IDENTITY_ENVIRONMENT,
    timeout: 120_000,
    windowsHide: true,
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** The environment a temporary commit gets its identity from: never a `git config` write, anywhere. */
const HISTORY_IDENTITY_ENVIRONMENT: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Scan Self Test',
  GIT_AUTHOR_EMAIL: PLANTED_ADDRESS,
  GIT_COMMITTER_NAME: 'Scan Self Test',
  GIT_COMMITTER_EMAIL: PLANTED_ADDRESS,
};

/** Runs git in a directory, with the temporary commit identity in the process's own environment. */
function runGit(cwd: string, args: readonly string[]): CommandRun {
  return runProcess('git', args, cwd);
}

/**
 * The real command line, exactly as `npm run scan:exclusions` runs it: the workspace's tsx binary over
 * the script, from the root the scan has to read.
 */
function runCommandLine(cwd: string): CommandRun {
  const tsx = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const script = join(REPO_ROOT, 'scripts', 'scan-exclusions.ts');
  return runProcess(tsx, [script], cwd);
}

/** The scan of the planted tree, driven through the digest override the way the self-test injects one. */
function plantedScan(): ScanResult {
  return runScan({ root: PLANTED_ROOT, blockedTokenDigests: new Set([PLANTED_PROVIDER_DIGEST]) });
}

/**
 * Builds the temporary git repository the history case reads.
 *
 * The commit's identity comes from the spawned git process's environment, so no repository's
 * configuration is written and no `git config` is ever run. The planted file is committed and then
 * deleted from the working tree, which leaves its address in the patch of the commit that added it and
 * nowhere else - the shape a scan of the working tree alone could not see.
 */
function buildHistoryTree(): { readonly ok: boolean; readonly reason: string; readonly commit: string } {
  writeTempFile(HISTORY_ROOT, STORE_FILE, storeDocument());
  writeTempFile(HISTORY_ROOT, HISTORY_FILE, `${HISTORY_LINES.join('\n')}\n`);
  const steps: ReadonlyArray<{ readonly label: string; readonly args: readonly string[] }> = [
    { label: 'git init', args: ['init', '--quiet'] },
    { label: 'git add', args: ['add', '--', HISTORY_FILE] },
    { label: 'git commit', args: ['commit', '--quiet', '-m', 'plant a violation the working tree will not keep'] },
  ];
  for (const step of steps) {
    const run = runGit(HISTORY_ROOT, step.args);
    if (run.status !== 0) {
      return { ok: false, reason: `${step.label} failed: ${run.stderr.trim()}`, commit: '' };
    }
  }
  const head = runGit(HISTORY_ROOT, ['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim().length === 0) {
    return { ok: false, reason: `the commit hash could not be read: ${head.stderr.trim()}`, commit: '' };
  }
  rmSync(join(HISTORY_ROOT, HISTORY_FILE), { force: true });
  return { ok: true, reason: '', commit: head.stdout.trim() };
}

/** What the history tree's setup achieved, read by the case that depends on it. */
const HISTORY_SETUP = buildHistoryTree();

/**
 * Every file under a root with its size and modification time.
 *
 * A run that wrote, truncated or touched anything in the tree changes this snapshot, which is what
 * makes "reports without deleting" a fact rather than a claim.
 */
function snapshotTree(root: string): string {
  const entries: string[] = [];
  const pending: string[] = [''];
  while (pending.length > 0) {
    const directory = pending.pop() ?? '';
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      const stats = statSync(join(root, path));
      entries.push(`${path}\t${stats.size}\t${stats.mtimeMs}`);
    }
  }
  return entries.sort().join('\n');
}

afterAll(() => {
  for (const root of [PLANTED_ROOT, HISTORY_ROOT, REFUSED_ROOT]) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('the delivered repository', () => {
  it('scans clean: exit 0, no findings, and files and history actually read', () => {
    const result = runScan({ root: REPO_ROOT });
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(result.historyLinesScanned).toBeGreaterThan(0);
  });

  it('prints the command, every stated limitation, and no absolute path', () => {
    const report = renderScanReport(runScan({ root: REPO_ROOT }));
    expect(report).toContain(SCAN_COMMAND);
    expect(report).toContain('0 finding(s) across 0 rule(s).');
    expect(report).not.toContain(REPO_ROOT);
    for (const limitation of SCAN_LIMITATIONS) {
      expect(report).toContain(limitation);
    }
  });
});

describe('the planted violations in a temporary tree', () => {
  it('exits 1 with exactly one finding per rule a planted violation fires', () => {
    const result = plantedScan();
    expect(result.exitCode).toBe(1);
    expect(result.findings).toHaveLength(PLANTED_EXPECTATIONS.length);
    expect(new Set(result.findings.map((finding) => finding.ruleId))).toEqual(
      new Set(PLANTED_EXPECTATIONS.map((expectation) => expectation.ruleId)),
    );
  });

  it.each(PLANTED_EXPECTATIONS)('names $file:$line for $ruleId', (expectation) => {
    const found = plantedScan().findings.filter((finding) => finding.ruleId === expectation.ruleId);
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe(expectation.file);
    expect(found[0]?.line).toBe(expectation.line);
  });

  it('masks every excerpt, so a report never echoes the matched value', () => {
    for (const finding of plantedScan().findings) {
      expect(finding.excerpt).not.toContain(PLANTED_ADDRESS);
      expect(finding.excerpt).not.toContain(PLANTED_CREDENTIAL_VALUE);
      expect(finding.excerpt).not.toContain(PLANTED_TELEPHONE);
    }
  });
});

describe('the real command line', () => {
  it('exits 1 in the planted tree, naming the planted file and line on stdout', () => {
    const run = runCommandLine(PLANTED_ROOT);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`${ADDRESS_FILE}:${lineOf(PLANTED_ADDRESS_LINES, PLANTED_ADDRESS)}`);
    expect(run.stdout).toContain(`${CREDENTIAL_FILE}:${lineOf(PLANTED_KEY_HEADER_LINES, PLANTED_KEY_HEADER)}`);
    expect(run.stdout).toContain(`${MANIFEST_FILE}:${lineOf(PLANTED_MANIFEST_LINES, JSON.stringify(PLANTED_PROVIDER_NAME))}`);
    expect(run.stdout).toContain(`${PLANTED_EXPECTATIONS.length} finding(s) across`);
    expect(run.stderr.trim()).toBe('');
  });

  it('exits 0 in the delivered repository, which is criterion 10s own command', () => {
    const run = runCommandLine(REPO_ROOT);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('0 finding(s) across 0 rule(s).');
  });

  it('exits 2 with a message for an unexpected argument, and prints no report', () => {
    const run = runProcess(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [
      join(REPO_ROOT, 'scripts', 'scan-exclusions.ts'),
      '--unexpected',
    ], PLANTED_ROOT);
    expect(run.status).toBe(USAGE_EXIT_CODE);
    expect(run.stderr).toContain('--unexpected');
    expect(run.stdout).toBe('');
  });
});

describe('a violation only the history holds', () => {
  it('reports it against the commit that added it, with the path and the old file line', () => {
    if (!HISTORY_SETUP.ok) {
      throw new Error(`the temporary git repository could not be built: ${HISTORY_SETUP.reason}`);
    }
    const result = runScan({ root: HISTORY_ROOT });
    const expectedFile = `git:${HISTORY_SETUP.commit.slice(0, 7)}:${HISTORY_FILE}`;
    expect(result.exitCode).toBe(1);
    expect(result.historyLinesScanned).toBeGreaterThan(0);
    expect(result.findings.map((finding) => finding.file)).toEqual([expectedFile]);
    expect(result.findings[0]?.ruleId).toBe('email-address');
    expect(result.findings[0]?.line).toBe(HISTORY_ADDRESS_LINE);
    expect(expectedFile).toMatch(/^git:[0-9a-f]{7}:/);
    expect(readFileSync(join(HISTORY_ROOT, STORE_FILE), 'utf8')).toBe(storeDocument());
  });
});

describe('nothing is read destructively', () => {
  it('leaves the temporary tree unchanged across an in-process run and a spawned one', () => {
    const before = snapshotTree(PLANTED_ROOT);
    expect(plantedScan().exitCode).toBe(1);
    expect(runCommandLine(PLANTED_ROOT).status).toBe(1);
    expect(snapshotTree(PLANTED_ROOT)).toBe(before);
  });

  it.each(PLANTED_FILE_CONTENTS)('leaves $file byte-identical', (planted) => {
    expect(readFileSync(join(PLANTED_ROOT, planted.file), 'utf8')).toBe(planted.contents);
  });
});

describe('the exemptions the scan states', () => {
  it('states the lockfile exemption and the git commit header exemption, and prints both', () => {
    const lockfileEntries = SCAN_LIMITATIONS.filter((entry) => entry.toLowerCase().includes('lockfile'));
    const headerEntries = SCAN_LIMITATIONS.filter((entry) => /author:|committer:/i.test(entry));
    expect(lockfileEntries.length).toBeGreaterThan(0);
    expect(headerEntries.length).toBeGreaterThan(0);
    const report = renderScanReport(runScan({ root: REPO_ROOT }));
    for (const entry of [...lockfileEntries, ...headerEntries]) {
      expect(report).toContain(entry);
    }
  });

  it.each(ADDRESS_CONTEXTS)('yields $expected finding(s) for an address in $label', ({ context, expected }) => {
    expect(matchLineOf('email-address', context)).toHaveLength(expected);
  });
});

describe('a telephone-shaped token joined by a single hyphen', () => {
  it.each(TELEPHONE_SHAPES)('yields $expected finding(s) for $label', ({ text, expected }) => {
    const context: RuleLineContext = { file: TELEPHONE_FILE, kind: 'text', line: 1, text };
    expect(matchLineOf('telephone-number', context)).toHaveLength(expected);
  });
});

describe('the exit code', () => {
  it('is 0 for an empty command line, 2 for any argument, and untouched by runScan', () => {
    expect(main([])).toBe(0);
    expect(main(['--unexpected'])).toBe(USAGE_EXIT_CODE);
    expect(USAGE_EXIT_CODE).toBe(2);
    const before = process.exitCode;
    expect(plantedScan().exitCode).toBe(1);
    expect(runScan({ root: REPO_ROOT }).exitCode).toBe(0);
    expect(process.exitCode).toBe(before);
  });
});

describe('determinism', () => {
  it('renders byte-identical reports for two runs over the same tree', () => {
    const first = renderScanReport(plantedScan());
    const second = renderScanReport(plantedScan());
    expect(first).toBe(second);
    expect(first).not.toContain(PLANTED_ROOT);
    expect(renderScanReport(runScan({ root: REPO_ROOT }))).toBe(
      renderScanReport(runScan({ root: REPO_ROOT })),
    );
  });
});

describe('the provider digest store', () => {
  it.each(REFUSED_STORES)('refuses $label', (refused) => {
    const path = join(REFUSED_ROOT, refused.file);
    expect(() => loadBlockedProviderTokens(path)).toThrow();
    const result = runScan({ root: REFUSED_ROOT, blockedProviderPath: path });
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(1);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain(refused.file);
  });
});
