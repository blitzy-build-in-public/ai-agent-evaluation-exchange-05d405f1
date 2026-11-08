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
 * Two of the scan's own artefacts are asserted from the delivered files rather than from a copy: the
 * rule set and the limit statement it declares, and the provider digest store, which has to hold
 * digests and nothing else. One further temporary tree carries only the shapes this repository is
 * itself made of - an npm scope, a UUID, a version, a plain count - which the scan has to stay silent
 * about.
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

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  EXCLUSION_CLASSES,
  EXCLUSION_RULES,
  SCAN_LIMITATIONS,
  hashToken,
  loadBlockedProviderTokens,
  maskExcerpt,
  tokenVariants,
} from './exclusion-rules';
import type { RuleLineContext, RuleMatch } from './exclusion-rules';
import { main, renderScanReport, runScan } from './scan-exclusions';
import type { ScanResult } from './scan-exclusions';

/** The repository root, taken from this file's own location: `scripts/` sits directly under it. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The command the report names as its generator. */
const SCAN_COMMAND = 'npm run scan:exclusions';

/** The one exit code a run that reached no verdict leaves behind: an argument, or unreadable rules. */
const NO_VERDICT_EXIT_CODE = 2;

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

/** One address-shaped line read in five contexts, with the finding count each one earns. */
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
    expected: 1,
  },
  {
    label: 'a lockfile deprecation notice',
    context: {
      file: 'package-lock.json',
      kind: 'lockfile',
      line: 1,
      text: `"deprecated": "contact ${PLANTED_ADDRESS} for details",`,
    },
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

/** The five rule ids the scanner and the rules module define, in the order the report prints them. */
const EXPECTED_RULE_IDS: readonly string[] = [
  'email-address',
  'telephone-number',
  'private-key-header',
  'credential-assignment',
  'prohibited-dependency',
];

/** The id of the one rule whose matcher reads a dependency name rather than a line. */
const DEPENDENCY_RULE_ID = 'prohibited-dependency';

/** The four classes the scan may report, in the order it groups findings by them. */
const EXPECTED_CLASSES: readonly string[] = [
  'email-address',
  'telephone-number',
  'credential-material',
  'prohibited-dependency',
];

/** The three file kinds every content rule applies to, in the order the rules module lists them. */
const CONTENT_KINDS: readonly string[] = ['text', 'manifest', 'lockfile'];

/** The two file kinds the dependency rule alone applies to, in that same order. */
const DEPENDENCY_KINDS: readonly string[] = ['manifest', 'lockfile'];

/**
 * A sentence claiming the scan guarantees the absence of private information, which no limitation may
 * be. `guaranteeing` sits deliberately outside this pattern: the delivered text uses that word in a
 * refusal, and a case that could not tell the two apart would be no case at all.
 */
const CLAIM_OF_GUARANTEE = /\bguarantees?\b|\bguaranteed\b/i;

/** A JSON string literal in the delivered digest store, escapes included. */
const QUOTED_JSON_STRING = /"((?:[^"\\]|\\.)*)"/g;

/** The shape a stored provider token digest has. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** The delivered digest store: the file whose digests the prohibited-dependency rule matches. */
const DIGEST_STORE_PATH = join(REPO_ROOT, STORE_FILE);

/** A 64-character hex digest, assembled so this file holds no 64-character hex run of its own. */
const SHAPE_DIGEST = '0123456789abcdef'.repeat(4);

/** A UUID and an ISO-8601 timestamp, both assembled from parts for that same reason. */
const SHAPE_UUID = ['3f2504e0', '4f89', '11d3', '9a0c', '0305e82c3301'].join('-');
const SHAPE_TIMESTAMP = `${['2024-01-02', '03:04:05'].join('T')}Z`;

/** The npm scope the delivered manifests declare, which is the shape an address is not. */
const SHAPE_SCOPE = ['@adem', 'shared'].join('/');

/** The temporary root holding only the machine-written shapes the scan has to stay silent about. */
const CLEAN_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-clean-'));

/** The temporary root whose ignored directories and binary file are counted rather than reported. */
const BINARY_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-counts-'));

/** The temporary root holding one manifest that declares a scoped dependency. */
const VARIANT_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-variant-'));

/** The temporary git repository whose only address sits in its commit's own metadata. */
const METADATA_ROOT = mkdtempSync(join(tmpdir(), 'scan-exclusions-metadata-'));

/** The lines of the clean text file: the shapes this repository is itself made of, and no violation. */
const CLEAN_SHAPE_LINES: readonly string[] = [
  `an npm scope: "${SHAPE_SCOPE}"`,
  `a uuid: ${SHAPE_UUID}`,
  `an iso-8601 timestamp: ${SHAPE_TIMESTAMP}`,
  'a conformance target: WCAG 2.1',
  'a protocol version: HTTP/1.1',
  'the approved runtime: node 20.20.2',
  'a prebuilt native module: node-v115-linux-x64',
  'a provisional rate: 0.25%',
  'two viewports and two ports: 1280, 360, 3000, 15000',
  `a 64-character digest: ${SHAPE_DIGEST}`,
  'a licence field spelled as the manifests spell it: "license": "MIT"',
  'a digest list opening: "tokens": [',
  'The words token, key, secret and hash are ordinary words on this line, never an assignment.',
];

/** The clean manifest: a scope, a licence field, and no dependency name the delivered store knows. */
const CLEAN_MANIFEST_LINES: readonly string[] = [
  '{',
  '  "name": "clean-probe-tree",',
  '  "version": "0.1.0",',
  '  "private": true,',
  '  "license": "MIT",',
  '  "dependencies": {',
  `    "${SHAPE_SCOPE}": "0.1.0"`,
  '  }',
  '}',
];

/** The digest-list shape: the store's own opening, in a file that is not the store. */
const CLEAN_DIGEST_LIST_LINES: readonly string[] = [
  '{',
  '  "tokens": [',
  `    "${SHAPE_DIGEST}"`,
  '  ]',
  '}',
];

/** Every file the clean tree holds, and the exact contents the suite writes into it. */
const CLEAN_FILE_CONTENTS: ReadonlyArray<{ readonly file: string; readonly contents: string }> = [
  { file: 'clean-shapes.txt', contents: `${CLEAN_SHAPE_LINES.join('\n')}\n` },
  { file: 'clean-manifest/package.json', contents: `${CLEAN_MANIFEST_LINES.join('\n')}\n` },
  { file: 'clean-digest-shapes.json', contents: `${CLEAN_DIGEST_LIST_LINES.join('\n')}\n` },
];

/** The one text file the counts tree holds, which is read and holds no finding. */
const COUNTED_TEXT_FILE = 'counted-text.txt';

/** The binary file that tree holds: a NUL in its first bytes, so no rule ever reads a byte of one. */
const SKIPPED_BINARY_FILE = 'opaque-blob.bin';

/** The directories the walk never descends into, each planted with an address it must not report. */
const IGNORED_DIRECTORY_NAMES: readonly string[] = ['node_modules', 'dist'];

/** A dependency name the store knows only through the unscoped, suffix-free variant of it. */
const SCOPED_PROVIDER_NAME = ['@synthetic-scope', 'zzqqprov-sdk'].join('/');

/** The base variant of that name, which is what the injected digests are computed from. */
const SCOPED_PROVIDER_BASE = 'zzqqprov';

/**
 * The digests of that base's own variants, injected in place of the delivered store. They deliberately
 * hold no digest of the scoped name itself, so a finding can only come from the variant walk the
 * prohibited-dependency rule performs - which is the whole point of the override.
 */
const SCOPED_PROVIDER_DIGESTS: ReadonlySet<string> = new Set(
  tokenVariants(SCOPED_PROVIDER_BASE).map((variant) => hashToken(variant)),
);

/** The lines of the manifest that declares the scoped dependency. */
const VARIANT_MANIFEST_LINES: readonly string[] = [
  '{',
  '  "name": "variant-probe-tree",',
  '  "version": "0.0.0",',
  '  "private": true,',
  '  "dependencies": {',
  `    ${JSON.stringify(SCOPED_PROVIDER_NAME)}: "1.0.0"`,
  '  }',
  '}',
];

/** The clean file the metadata-only commit carries. */
const METADATA_FILE = 'metadata-clean.txt';

/** Its lines: no rule can fire on them, so any finding would have to come from a commit header. */
const METADATA_LINES: readonly string[] = [
  '# a commit whose content holds no finding',
  'the only address in this repository is the committing tool identity',
];

/** Writes every file the clean tree, the counts tree and the variant tree hold. */
function writeProbeTrees(): void {
  for (const clean of CLEAN_FILE_CONTENTS) {
    writeTempFile(CLEAN_ROOT, clean.file, clean.contents);
  }
  writeTempFile(BINARY_ROOT, COUNTED_TEXT_FILE, '# one text file, and no finding in it\n');
  writeFileSync(join(BINARY_ROOT, SKIPPED_BINARY_FILE), Buffer.from([0, 1, 2, 0, 3, 4, 5]));
  for (const ignored of IGNORED_DIRECTORY_NAMES) {
    writeTempFile(BINARY_ROOT, `${ignored}/ignored.txt`, `contact ${PLANTED_ADDRESS} for details\n`);
  }
  writeTempFile(VARIANT_ROOT, MANIFEST_FILE, `${VARIANT_MANIFEST_LINES.join('\n')}\n`);
}

/** The error a call threw, asserted rather than assumed: a silent pass would hide a non-throw. */
function errorOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`the call threw a value that is not an Error: ${String(error)}`);
  }
  throw new Error('the call did not throw at all');
}

/** The delivered digest store's text, read from the file the scan itself reads. */
function deliveredStoreText(): string {
  return readFileSync(DIGEST_STORE_PATH, 'utf8');
}

/** The delivered digest store as a JSON object, refusing a document that is not one. */
function deliveredStoreDocument(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(deliveredStoreText());
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`the delivered digest store at ${DIGEST_STORE_PATH} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** The store's `tokens` array, refusing a document that holds none. */
function deliveredStoreTokens(): readonly unknown[] {
  const tokens = deliveredStoreDocument()['tokens'];
  if (!Array.isArray(tokens)) {
    throw new Error('the delivered digest store holds no "tokens" array');
  }
  return tokens;
}

/** The store's tokens as digests, refusing any entry that is not one rather than skipping it. */
function deliveredStoreDigests(): readonly string[] {
  const tokens = deliveredStoreTokens();
  const digests = tokens.filter((entry): entry is string => typeof entry === 'string');
  if (digests.length !== tokens.length) {
    throw new Error('the delivered digest store holds an entry that is not a string');
  }
  return digests;
}

writeProbeTrees();

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
 * Builds the repository whose only address sits in its commit metadata rather than in its content.
 *
 * The identity comes from the spawned git process's environment, so no repository's configuration is
 * written and no `git config` is ever run. `git log --format=%ae` then reads back what git actually
 * recorded, which is what makes the guard below a fact about the commit rather than about this suite's
 * intent - and it is the regression guard for this repository's own initial commit, whose author line
 * carries the committing tool's address.
 */
function buildMetadataTree(): { readonly ok: boolean; readonly reason: string; readonly author: string } {
  writeTempFile(METADATA_ROOT, METADATA_FILE, `${METADATA_LINES.join('\n')}\n`);
  const steps: ReadonlyArray<{ readonly label: string; readonly args: readonly string[] }> = [
    { label: 'git init', args: ['init', '--quiet'] },
    { label: 'git add', args: ['add', '--', METADATA_FILE] },
    { label: 'git commit', args: ['commit', '--quiet', '-m', 'clean content, address-shaped identity'] },
  ];
  for (const step of steps) {
    const run = runGit(METADATA_ROOT, step.args);
    if (run.status !== 0) {
      return { ok: false, reason: `${step.label} failed: ${run.stderr.trim()}`, author: '' };
    }
  }
  const author = runGit(METADATA_ROOT, ['log', '--format=%ae']);
  if (author.status !== 0) {
    return { ok: false, reason: `the recorded identity could not be read: ${author.stderr.trim()}`, author: '' };
  }
  return { ok: true, reason: '', author: author.stdout.trim() };
}

/** What the metadata-only repository achieved, read by the case that depends on it. */
const METADATA_SETUP = buildMetadataTree();

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
  for (const root of [PLANTED_ROOT, HISTORY_ROOT, REFUSED_ROOT, CLEAN_ROOT, BINARY_ROOT, VARIANT_ROOT, METADATA_ROOT]) {
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
    expect(report).toContain(`0 finding(s); ${EXCLUSION_RULES.length} rule(s) applied.`);
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

  it('names every planted file and every fired rule in the rendered report', () => {
    const report = renderScanReport(plantedScan());
    for (const expectation of PLANTED_EXPECTATIONS) {
      expect(report).toContain(`${expectation.file}:${expectation.line}`);
      expect(report).toContain(expectation.ruleId);
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
    expect(run.stdout).toContain(`${PLANTED_EXPECTATIONS.length} finding(s); ${EXCLUSION_RULES.length} rule(s) applied.`);
    expect(run.stderr.trim()).toBe('');
  });

  it('exits 0 in the delivered repository, which is criterion 10s own command', () => {
    const run = runCommandLine(REPO_ROOT);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`0 finding(s); ${EXCLUSION_RULES.length} rule(s) applied.`);
  });

  it('exits 2 with a message for an unexpected argument, and prints no report', () => {
    const run = runProcess(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [
      join(REPO_ROOT, 'scripts', 'scan-exclusions.ts'),
      '--unexpected',
    ], PLANTED_ROOT);
    expect(run.status).toBe(NO_VERDICT_EXIT_CODE);
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
  it('states the lockfile limitation and the git commit header exemption, and prints both', () => {
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
    expect(NO_VERDICT_EXIT_CODE).toBe(2);

    // The refusal is the CLI's own message and belongs on stderr, but this case drives `main` in
    // process, so the write is captured rather than left to reach the terminal: it is asserted below,
    // and a passing `npm run test:scan` carries no error-shaped line. The stub is restored in `finally`
    // so a failing assertion cannot leak it into another case.
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      expect(main(['--unexpected'])).toBe(NO_VERDICT_EXIT_CODE);
    } finally {
      spy.mockRestore();
    }
    const refusal = chunks.join('');
    expect(refusal).toContain('takes no arguments');
    expect(refusal).toContain('--unexpected');

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

  it('returns deeply equal findings for two runs over the same root', () => {
    const first = plantedScan();
    const second = plantedScan();
    expect(second).toStrictEqual(first);
    expect(second.findings.length).toBeGreaterThan(0);
  });
});

describe('the provider digest store', () => {
  it.each(REFUSED_STORES)('refuses $label', (refused) => {
    const path = join(REFUSED_ROOT, refused.file);
    const error = errorOf(() => loadBlockedProviderTokens(path));
    expect(error.message).toContain(refused.file);
    const result = runScan({ root: REFUSED_ROOT, blockedProviderPath: path });
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(NO_VERDICT_EXIT_CODE);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain(refused.file);
  });

  it('reports no verdict rather than a clean tree when its own rules cannot be read', () => {
    const refused = REFUSED_STORES[0];
    if (refused === undefined) {
      throw new Error('the refused stores list is empty');
    }
    const result = runScan({ root: REFUSED_ROOT, blockedProviderPath: join(REFUSED_ROOT, refused.file) });
    const report = renderScanReport(result);
    expect(report).toContain('reached no verdict');
    expect(report).not.toContain('0 finding(s)');
  });

  it('refuses a store that does not exist, naming the path it could not read', () => {
    const missing = join(REFUSED_ROOT, 'no-such-store.json');
    expect(errorOf(() => loadBlockedProviderTokens(missing)).message).toContain(missing);
    const result = runScan({ root: REFUSED_ROOT, blockedProviderPath: missing });
    expect(result.exitCode).toBe(NO_VERDICT_EXIT_CODE);
    expect(result.findings).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain(missing);
  });
});

describe('the rule set the scan declares', () => {
  it('holds the five rule ids and the four classes, in the order the report groups them', () => {
    expect(EXCLUSION_RULES.map((rule) => rule.id)).toEqual(EXPECTED_RULE_IDS);
    expect(EXCLUSION_CLASSES).toEqual(EXPECTED_CLASSES);
    expect([...new Set(EXCLUSION_RULES.map((rule) => rule.class))].sort()).toEqual(
      [...EXPECTED_CLASSES].sort(),
    );
  });

  it('scopes the dependency rule to manifests and lockfiles, and every other rule to all text', () => {
    expect(EXCLUSION_RULES).toHaveLength(EXPECTED_RULE_IDS.length);
    for (const rule of EXCLUSION_RULES) {
      expect(rule.description.trim().length).toBeGreaterThan(0);
      if (rule.id === DEPENDENCY_RULE_ID) {
        expect(rule.kind).toBe('dependency');
        expect([...rule.appliesTo]).toEqual(DEPENDENCY_KINDS);
        expect(rule.matchDependency).toBeTypeOf('function');
        continue;
      }
      expect(rule.kind).toBe('line');
      expect([...rule.appliesTo]).toEqual(CONTENT_KINDS);
      expect(rule.appliesTo).toContain('text');
      expect(rule.matchLine).toBeTypeOf('function');
    }
  });
});

describe('what the scan says about its own limits', () => {
  it('names the four classes it detects and the three areas it does not detect', () => {
    const stated = SCAN_LIMITATIONS.join(' ');
    expect(SCAN_LIMITATIONS.length).toBeGreaterThan(0);
    expect(SCAN_LIMITATIONS.every((entry) => entry.trim().length > 0)).toBe(true);
    expect(stated).toMatch(/four classes/);
    for (const undetected of ['personal names', 'contextual disclosure', 'references to private projects']) {
      expect(stated).toMatch(new RegExp(`does not detect[^.]*${undetected}`, 'i'));
    }
  });

  it('calls itself supplementary to the manual review and claims no guarantee anywhere', () => {
    const stated = SCAN_LIMITATIONS.join(' ');
    expect(stated).toMatch(/supplementary/i);
    expect(stated).toContain('docs/REVIEW-CHECKLIST.md');
    expect(stated).toMatch(/not evidence/);
    for (const entry of SCAN_LIMITATIONS) {
      expect(entry).not.toMatch(CLAIM_OF_GUARANTEE);
    }
  });
});

describe('the delivered provider digest store', () => {
  it('pins its algorithm and normalization, and lists sorted, unique, digest-shaped tokens', () => {
    const store = deliveredStoreDocument();
    expect(Object.keys(store).sort()).toEqual(['algorithm', 'normalization', 'note', 'tokens']);
    expect(store['algorithm']).toBe('sha256');
    expect(store['normalization']).toBe('trim-lowercase');
    const tokens = deliveredStoreTokens();
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((entry) => DIGEST_PATTERN.test(String(entry)))).toBe(true);
    const digests = deliveredStoreDigests();
    expect(digests).toEqual([...digests].sort());
    expect(new Set(digests).size).toBe(digests.length);
    expect(loadBlockedProviderTokens(DIGEST_STORE_PATH).size).toBe(digests.length);
  });

  it('holds digests only, so no plaintext provider name reaches this repository', () => {
    const store = deliveredStoreDocument();
    const note = store['note'];
    expect(typeof note).toBe('string');
    expect(String(note)).toMatch(/supplementary/i);
    const allowed = new Set([
      'algorithm',
      'normalization',
      'tokens',
      'note',
      'sha256',
      'trim-lowercase',
      String(note),
    ]);
    const readable: string[] = [];
    for (const match of deliveredStoreText().matchAll(QUOTED_JSON_STRING)) {
      const value = match[1] ?? '';
      if (!DIGEST_PATTERN.test(value) && !allowed.has(value)) {
        readable.push(value);
      }
    }
    expect(readable).toEqual([]);
  });
});

describe('a tree of clean shapes', () => {
  it('reports nothing for the machine-written shapes this repository is itself made of', () => {
    const result = runScan({ root: CLEAN_ROOT, blockedProviderPath: DIGEST_STORE_PATH });
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.filesScanned).toBe(CLEAN_FILE_CONTENTS.length);
    expect(renderScanReport(result)).toContain(`0 finding(s); ${EXCLUSION_RULES.length} rule(s) applied.`);
  });

  it('reads no history outside a work tree, and says so instead of failing', () => {
    const result = runScan({ root: CLEAN_ROOT, blockedProviderPath: DIGEST_STORE_PATH });
    expect(result.historyLinesScanned).toBe(0);
    expect(result.notes.join(' ')).toMatch(/no git history was read/);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('reports an address in that same tree once one line carries it, so the silence is not vacuous', () => {
    const planted = join(CLEAN_ROOT, 'clean-shapes-plus-one-line.txt');
    writeFileSync(planted, `contact ${PLANTED_ADDRESS} for details\n`, 'utf8');
    try {
      const result = runScan({ root: CLEAN_ROOT, blockedProviderPath: DIGEST_STORE_PATH });
      expect(result.findings.map((finding) => finding.ruleId)).toEqual(['email-address']);
      expect(result.findings[0]?.file).toBe('clean-shapes-plus-one-line.txt');
      expect(result.exitCode).toBe(1);
    } finally {
      rmSync(planted, { force: true });
    }
  });
});

describe('the counts a run reports', () => {
  it('counts the binary file as skipped and never reads the ignored directories', () => {
    const result = runScan({ root: BINARY_ROOT, blockedProviderPath: DIGEST_STORE_PATH });
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.filesScanned).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(renderScanReport(result)).not.toContain('ignored.txt');
  });
});

describe('a dependency the store knows only by its base', () => {
  it('reports a scoped dependency through the variant walk, not through the whole name', () => {
    expect(SCOPED_PROVIDER_DIGESTS.has(hashToken(SCOPED_PROVIDER_NAME))).toBe(false);
    const result = runScan({ root: VARIANT_ROOT, blockedTokenDigests: SCOPED_PROVIDER_DIGESTS });
    const [finding] = result.findings;
    expect(finding?.ruleId).toBe('prohibited-dependency');
    expect(finding?.file).toBe(MANIFEST_FILE);
    expect(finding?.line).toBe(lineOf(VARIANT_MANIFEST_LINES, JSON.stringify(SCOPED_PROVIDER_NAME)));
    expect(result.exitCode).toBe(1);
  });
});

describe('the commit identity a history read meets', () => {
  it('reports no finding for an address-shaped identity in a commit header', () => {
    if (!METADATA_SETUP.ok) {
      throw new Error(`the metadata-only repository could not be built: ${METADATA_SETUP.reason}`);
    }
    expect(METADATA_SETUP.author).toBe(PLANTED_ADDRESS);
    const result = runScan({ root: METADATA_ROOT, blockedProviderPath: DIGEST_STORE_PATH });
    expect(result.historyLinesScanned).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(renderScanReport(result)).not.toContain(PLANTED_ADDRESS);
  });
});

describe('the excerpt a finding carries', () => {
  it('masks a matched value to a prefix and a length, and masks an empty value to nothing', () => {
    const masked = maskExcerpt(PLANTED_CREDENTIAL_VALUE);
    expect(masked.startsWith(PLANTED_CREDENTIAL_VALUE.slice(0, 3))).toBe(true);
    expect(masked.length).toBeLessThanOrEqual(24);
    expect(masked).not.toContain(PLANTED_CREDENTIAL_VALUE);
    expect(maskExcerpt('   ')).toBe('');
  });
});

describe('a line longer than any line the repository holds', () => {
  /**
   * Nothing bounds the length of one line: a committed bundle, one line of JSON or one base64 blob is a
   * line of megabytes, and every rule reads it in full because the scan is required to read content. These
   * cases are what holds that read to a bounded cost, over a line of 250,000 characters - past the point at
   * which a rule that attempts a match from every start position needs tens of seconds for this one line,
   * and so turns the CI gate that runs the scan into a hang with no diagnostic.
   */
  const LONG_LINE_CHARS = 250_000;

  /**
   * What one long-line call may cost. The bound is what makes this a failing case on such a matcher rather
   * than a slow one: a rule that never yields cannot be interrupted by a test timeout, so it runs to
   * completion and passes. The cost the matcher is held to here is its own, and the margin is four orders
   * of magnitude wide, so the bound refuses a cost that grows with the square of the line's length without
   * mistaking a loaded shared host for one.
   */
  const LONG_LINE_BUDGET_MS = 5_000;

  /** A line of 250,000 characters out of which no address shape can be assembled. */
  const LONG_LINE_WITHOUT_ADDRESS = 'x'.repeat(LONG_LINE_CHARS);

  /** The same line with the planted address written after a space, at its very end. */
  const LONG_LINE_WITH_ADDRESS = `${LONG_LINE_WITHOUT_ADDRESS} ${PLANTED_ADDRESS}`;

  /** Names of the two files the temporary tree holds: the one with the address, and the one without. */
  const LONG_LINE_FILE = 'long-line.txt';
  const LONG_LINE_CLEAN_FILE = 'long-line-clean.txt';

  /** Times one rule over one line through the same helper the rest of this suite reads a rule with. */
  function timeRuleOverLine(
    ruleId: string,
    text: string,
  ): { readonly matches: readonly RuleMatch[]; readonly elapsedMs: number } {
    const context: RuleLineContext = { file: LONG_LINE_FILE, kind: 'text', line: 1, text };
    const started = Date.now();
    const matches = matchLineOf(ruleId, context);
    return { matches, elapsedMs: Date.now() - started };
  }

  it.each([
    { label: 'holds no address at all', text: LONG_LINE_WITHOUT_ADDRESS, expected: 0 },
    { label: 'holds the planted address after a space', text: LONG_LINE_WITH_ADDRESS, expected: 1 },
  ])('yields $expected finding(s) for a 250,000-character line that $label', ({ text, expected }) => {
    const { matches, elapsedMs } = timeRuleOverLine('email-address', text);
    expect(elapsedMs).toBeLessThan(LONG_LINE_BUDGET_MS);
    expect(matches).toHaveLength(expected);
    for (const match of matches) {
      expect(match.excerpt).toBe(maskExcerpt(PLANTED_ADDRESS));
    }
  });

  it('reports that one address, within the budget, when the scan reads the line from a file', () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-exclusions-long-line-'));
    try {
      writeTempFile(root, LONG_LINE_FILE, `${LONG_LINE_WITH_ADDRESS}\n`);
      writeTempFile(root, LONG_LINE_CLEAN_FILE, `${LONG_LINE_WITHOUT_ADDRESS}\n`);
      const started = Date.now();
      const result = runScan({ root, blockedProviderPath: DIGEST_STORE_PATH });
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeLessThan(LONG_LINE_BUDGET_MS);
      expect(result.findings.map((finding) => finding.ruleId)).toEqual(['email-address']);
      expect(result.findings[0]?.file).toBe(LONG_LINE_FILE);
      expect(result.findings[0]?.line).toBe(1);
      expect(result.findings[0]?.excerpt).toBe(maskExcerpt(PLANTED_ADDRESS));
      expect(result.filesScanned).toBe(2);
      expect(result.exitCode).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
