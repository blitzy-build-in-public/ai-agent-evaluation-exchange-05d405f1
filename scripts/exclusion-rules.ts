/**
 * The exclusion scan's rules: what counts as a violation, and nothing else.
 *
 * `scripts/scan-exclusions.ts` owns the walking, the ignore set, the git-history read, the exit code
 * and the output format. This module owns the four detectable classes as data, one matcher each, the
 * provider-digest hashing both sides must agree on, and the limitations the scan prints with its
 * findings. Keeping the rules apart from the scanner is what lets the planted self-test fire one
 * class at a time.
 *
 * Precision beats recall throughout. The scan is supplementary to the manual review in
 * `docs/REVIEW-CHECKLIST.md`, so a rule that cries wolf costs more than a rule that misses, and the
 * delivered repository is this module's own worst false-positive case: npm scopes look like mail
 * addresses, the migrations and the provider digest list are full of high-entropy hex, and the
 * documentation uses the words "token" and "secret" as ordinary words.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** How the scanner classifies the file a line was read from. */
export type FileKind = 'text' | 'manifest' | 'lockfile';

/** The four classes the scan detects; no other class may be reported. */
export type ExclusionClass =
  | 'email-address'
  | 'telephone-number'
  | 'credential-material'
  | 'prohibited-dependency';

/** One line of one file, handed to a line rule by the scanner. */
export interface RuleLineContext {
  readonly file: string;
  readonly kind: FileKind;
  readonly line: number;
  readonly text: string;
}

/** One declared or resolved dependency name, handed to a dependency rule by the scanner. */
export interface RuleDependencyContext {
  readonly file: string;
  readonly kind: FileKind;
  readonly line: number;
  readonly name: string;
  readonly section: string;
}

/** A rule hit: which rule fired, and a masked excerpt safe to print in a CI log. */
export interface RuleMatch {
  readonly ruleId: string;
  readonly excerpt: string;
}

/** One rule: its id, the class it reports, the file kinds it applies to and its matcher. */
export interface ExclusionRule {
  readonly id: string;
  readonly class: ExclusionClass;
  readonly description: string;
  readonly appliesTo: readonly FileKind[];
  readonly kind: 'line' | 'dependency';
  readonly matchLine?: (context: RuleLineContext) => readonly RuleMatch[];
  readonly matchDependency?: (
    context: RuleDependencyContext,
    blockedTokenDigests: ReadonlySet<string>,
  ) => readonly RuleMatch[];
}

/** The file kinds every content rule is applied to. */
const CONTENT_KINDS: readonly FileKind[] = Object.freeze([
  'text',
  'manifest',
  'lockfile',
] as FileKind[]);

/**
 * The file kinds the dependency rule is applied to. Scoping it to manifests and lockfiles is what
 * keeps a package name mentioned in prose or in a test fixture from firing it, and what stops the
 * scan from hashing every word in the repository.
 */
const DEPENDENCY_KINDS: readonly FileKind[] = Object.freeze(['manifest', 'lockfile'] as FileKind[]);

/** Rule ids, frozen: the scanner groups findings by them and the self-test asserts on them. */
const EMAIL_ADDRESS_RULE_ID = 'email-address';
const TELEPHONE_NUMBER_RULE_ID = 'telephone-number';
const PRIVATE_KEY_HEADER_RULE_ID = 'private-key-header';
const CREDENTIAL_ASSIGNMENT_RULE_ID = 'credential-assignment';
const PROHIBITED_DEPENDENCY_RULE_ID = 'prohibited-dependency';

const EXCERPT_VISIBLE_CHARS = 3;
const EXCERPT_MAX_CHARS = 24;

/**
 * Mask a matched value for a finding.
 *
 * Returns at most the first three characters of the value, an ellipsis and the value's length,
 * capped at 24 characters, so a finding never echoes the whole match: findings are printed into CI
 * logs, where a full copy of a secret would be a leak of its own. Returns an empty string for a
 * value that is empty or all whitespace; refuses nothing else.
 */
export function maskExcerpt(value: string): string {
  const flattened = value.replace(/\s+/g, ' ').trim();
  if (flattened.length === 0) {
    return '';
  }
  const masked = `${flattened.slice(0, EXCERPT_VISIBLE_CHARS)}\u2026(${flattened.length} chars)`;
  return masked.length > EXCERPT_MAX_CHARS ? masked.slice(0, EXCERPT_MAX_CHARS) : masked;
}

/**
 * Hash one token the way `scripts/blocked-provider-hashes.json` declares it: the SHA-256 digest of
 * the trimmed, lowercased token, hex-encoded.
 *
 * Returns a 64-character lowercase hex digest and refuses nothing, so a caller may hash any
 * candidate name.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim().toLowerCase()).digest('hex');
}

/**
 * The packaging suffixes a provider name may carry in a package name, and the leading hyphenated
 * forms, longest first so that `-react` is stripped before a bare `js` suffix could be.
 */
const DEPENDENCY_SUFFIXES: readonly string[] = Object.freeze([
  '-native',
  '-react',
  '-sdk',
  '-node',
  '-js',
  'js',
]);

/**
 * Every token variant of a dependency name that the blocked-provider digests are stored under.
 *
 * Returns a deduped, order-stable array of lowercase tokens: the whole name; the name with a
 * leading npm scope stripped; that base with `.`, `_`, `-` and `/` removed; the base's leading
 * segment when the base carries a separator; and each of those with a trailing packaging suffix
 * removed, repeatedly. `blocked-provider-hashes.json` stores exactly those families, so a scoped
 * dependency is found through its unscoped base. Refuses nothing: an empty or whitespace-only name
 * yields an empty array, and a name with neither scope nor separator yields one variant.
 */
export function tokenVariants(name: string): readonly string[] {
  const whole = name.trim().toLowerCase();
  if (whole.length === 0) {
    return [];
  }
  const unscoped =
    whole.startsWith('@') && whole.includes('/') ? whole.slice(whole.indexOf('/') + 1) : whole;
  const compacted = unscoped.replace(/[._\-/]/g, '');
  const variants: string[] = [];
  for (const seed of [whole, unscoped, compacted, splitLeadingSegment(unscoped)]) {
    for (const variant of suffixStrippedForms(seed)) {
      if (!variants.includes(variant)) {
        variants.push(variant);
      }
    }
  }
  return variants;
}

/** The leading segment of a separated name, or null when the name carries no separator. */
function splitLeadingSegment(value: string): string | null {
  const separatorIndex = value.search(/[._\-/]/);
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : null;
}

/** A seed token, then the token with each trailing packaging suffix removed in turn. */
function suffixStrippedForms(seed: string | null): readonly string[] {
  const forms: string[] = [];
  let current = seed ?? '';
  while (current.length > 0) {
    if (!forms.includes(current)) {
      forms.push(current);
    }
    const suffix = DEPENDENCY_SUFFIXES.find(
      (candidate) => current.length > candidate.length && current.endsWith(candidate),
    );
    if (suffix === undefined) {
      break;
    }
    current = current
      .slice(0, current.length - suffix.length)
      .replace(/[-._]+$/, '');
  }
  return forms;
}

const BLOCKED_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Load the blocked-provider digest store the prohibited-dependency rule matches against.
 *
 * Returns a read-only set of lowercase SHA-256 hex digests. Refuses, by throwing an `Error` whose
 * message names the file and the problem, a missing or unreadable file, malformed JSON, a document
 * that is not an object, one whose `algorithm` is not `sha256`, one whose `normalization` is not
 * `trim-lowercase`, a document with no `tokens` array, an entry that is not a 64-character
 * lowercase sha256 digest, and a token list that holds no digests. The scanner turns the throw into
 * a non-zero exit with an actionable message, so nothing is swallowed here.
 */
export function loadBlockedProviderTokens(path: string): ReadonlySet<string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `exclusion rules: cannot read the blocked-provider digest file ${path}: ${describeError(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `exclusion rules: the blocked-provider digest file ${path} is not valid JSON: ${describeError(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `exclusion rules: the blocked-provider digest file ${path} must be a JSON object with "algorithm", "normalization" and "tokens"`,
    );
  }
  const document = parsed as Record<string, unknown>;
  const algorithm = document['algorithm'];
  if (algorithm !== 'sha256') {
    throw new Error(
      `exclusion rules: the blocked-provider digest file ${path} declares algorithm ${JSON.stringify(algorithm)}, expected "sha256"`,
    );
  }
  const normalization = document['normalization'];
  if (normalization !== 'trim-lowercase') {
    throw new Error(
      `exclusion rules: the blocked-provider digest file ${path} declares normalization ${JSON.stringify(normalization)}, expected "trim-lowercase"`,
    );
  }
  const entries = document['tokens'];
  if (!Array.isArray(entries)) {
    throw new Error(
      `exclusion rules: the blocked-provider digest file ${path} has no "tokens" array`,
    );
  }
  const digests = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'string' || !BLOCKED_DIGEST_PATTERN.test(entry)) {
      throw new Error(
        `exclusion rules: the blocked-provider digest file ${path} has an entry that is not a 64-character lowercase sha256 digest: ${maskExcerpt(typeof entry === 'string' ? entry : String(entry))}`,
      );
    }
    digests.add(entry);
  }
  if (digests.size === 0) {
    throw new Error(
      `exclusion rules: the blocked-provider digest file ${path} lists no provider digests`,
    );
  }
  return digests;
}

/** The message of a thrown value, for the error the loader raises. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------------------------------------
 * Shared guards
 * ---------------------------------------------------------------------------------------------- */

/** The characters that make a match part of a longer machine-written token. */
const TOKEN_CHARACTER_PATTERN = /[0-9A-Za-z_.:+@#/-]/;

/**
 * The whitespace-free token a match sits inside, expanded to both sides over identifier, path,
 * version, timestamp, digest and scope punctuation. The guards ask whether that token is
 * machine-written rather than a telephone number or a credential.
 */
function surroundingToken(text: string, start: number, end: number): string {
  let left = start;
  let right = end;
  while (left > 0 && TOKEN_CHARACTER_PATTERN.test(text.charAt(left - 1))) {
    left -= 1;
  }
  while (right < text.length && TOKEN_CHARACTER_PATTERN.test(text.charAt(right))) {
    right += 1;
  }
  return text.slice(left, right);
}

/** Count the runs of digits in a value, so a space-grouped number can be told from two numbers. */
function countDigitGroups(value: string): number {
  return value.split(/[^0-9]+/).filter((group) => group.length > 0).length;
}

/** Shannon entropy of the value's characters, in bits per character. */
function shannonEntropyPerCharacter(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

/* ------------------------------------------------------------------------------------------------
 * Rule 1: mail addresses
 * ---------------------------------------------------------------------------------------------- */

/**
 * The address separator, assembled rather than written literally: a literal address shape in this
 * file would be matched by the very rule defined here.
 */
const ADDRESS_SEPARATOR = String.fromCharCode(64);

const LOCAL_PART_SOURCE = '[A-Za-z0-9._%+-]+';
const DOMAIN_LABEL_SOURCE = '[A-Za-z0-9_-]+';
const EMAIL_CANDIDATE_SOURCE = `${LOCAL_PART_SOURCE}${ADDRESS_SEPARATOR}${DOMAIN_LABEL_SOURCE}(?:\\.${DOMAIN_LABEL_SOURCE})+`;
const DOMAIN_LABEL_FORMAT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const TOP_LEVEL_LABEL_PATTERN = /^[A-Za-z]{2,63}$/;
const IPV4_ADDRESS_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The address line of a git commit header. Its address is the committing tool's identity — every
 * commit this repository carries has one — so that line is not treated as content: a clean run on
 * the delivered repository is what the requirement needs. An address in file content has a
 * different shape or no such prefix and still fires.
 */
const GIT_METADATA_ADDRESS_PATTERN = /^(?:Author|Committer):\s[^<>]*<[^<>]+>\s*$/;

/**
 * The deprecation-notice field npm copies verbatim from the registry into a lockfile. One such
 * notice names the package maintainer, so the address belongs to upstream registry metadata the
 * repository hands on rather than to the repository's own content, and the lockfile cannot be
 * edited: `npm ci` regenerates it.
 */
const LOCKFILE_DEPRECATION_FIELD_PATTERN = /"deprecated"\s*:\s*"/;

/**
 * Match a complete address shape.
 *
 * Returns one match per address on the line, each excerpted through `maskExcerpt`. Refuses, by
 * returning no match, an npm scope (which reaches the separator but carries no dot in its domain),
 * a shape with no dot in its domain, a domain label that is not alphanumeric with inner hyphens, a
 * domain carrying an underscore, an IP-literal domain, a top-level label that is not 2 to 63
 * letters, an occurrence that continues a longer local part or scope, the address line of a git
 * commit header, and an address inside a lockfile or inside an upstream deprecation notice — both
 * of which carry a third party's identity rather than the repository's own. A hand-written manifest
 * and every text file are still checked in full.
 */
function matchEmailAddress(context: RuleLineContext): readonly RuleMatch[] {
  if (
    context.kind === 'lockfile' ||
    GIT_METADATA_ADDRESS_PATTERN.test(context.text) ||
    LOCKFILE_DEPRECATION_FIELD_PATTERN.test(context.text)
  ) {
    return [];
  }
  const matches: RuleMatch[] = [];
  const pattern = new RegExp(EMAIL_CANDIDATE_SOURCE, 'g');
  for (const candidate of context.text.matchAll(pattern)) {
    const value = candidate[0];
    const index = candidate.index ?? -1;
    if (index < 0 || !isAddressLike(value)) {
      continue;
    }
    if (index > 0 && /[\w@]/.test(context.text.charAt(index - 1))) {
      continue;
    }
    matches.push({ ruleId: EMAIL_ADDRESS_RULE_ID, excerpt: maskExcerpt(value) });
  }
  return matches;
}

/** Whether a matched candidate is a complete address rather than a scope or a bare pair. */
function isAddressLike(value: string): boolean {
  const separatorIndex = value.indexOf(ADDRESS_SEPARATOR);
  if (separatorIndex <= 0) {
    return false;
  }
  const domain = value.slice(separatorIndex + 1);
  if (IPV4_ADDRESS_PATTERN.test(domain)) {
    return false;
  }
  const labels = domain.split('.');
  const topLevel = labels[labels.length - 1] ?? '';
  if (!TOP_LEVEL_LABEL_PATTERN.test(topLevel)) {
    return false;
  }
  return labels.every((label) => DOMAIN_LABEL_FORMAT_PATTERN.test(label));
}

/* ------------------------------------------------------------------------------------------------
 * Rule 2: telephone numbers
 * ---------------------------------------------------------------------------------------------- */

/** The context keywords that anchor a number, in two tiers of confidence. */
const PHONE_KEYWORD_SOURCE = '(tel|telephone|phone|mobile|cell|whatsapp|sms|fax|call|contact)';

/**
 * The keywords that name a telephone directly. Beside one of these a bare run of 7 to 15 digits is
 * reported, because that is the shape a leaked number takes.
 */
const PHONE_SPECIFIC_KEYWORDS: ReadonlySet<string> = new Set([
  'tel',
  'telephone',
  'phone',
  'mobile',
  'cell',
  'whatsapp',
  'sms',
  'fax',
]);

/** How far after a keyword a number may start and still be anchored to it. */
const PHONE_KEYWORD_WINDOW = 48;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

/** A candidate reached from a keyword, which may be written with single spaces between groups. */
const LOOSE_PHONE_CANDIDATE_SOURCE = '\\+?[0-9(][0-9\\s().-]{4,}[0-9]';

/**
 * The strict shape: an optional leading plus, then a parenthesised or plain first group, then the
 * grouped digits, with a trailing group so that a shorter local format is reachable too.
 */
const STRICT_PHONE_CANDIDATE_SOURCE =
  '\\+?(?:\\(\\d{1,4}\\)|\\d{1,4}(?:[\\s.-]?\\(\\d{1,4}\\))?)[\\s.-]?\\d{2,4}[\\s.-]?\\d{2,4}(?:[\\s.-]?\\d{1,4})?';

/** The separators that make a digit run look grouped rather than counted. */
const PHONE_STRUCTURE_PATTERN = /[ .()-]/;
const PHONE_DOT_OR_DASH_PATTERN = /[.()-]/;

/** Shapes that are machine-written, never a telephone number. */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_DATE_TIME_PATTERN =
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
const SLASH_DATE_PATTERN = /\d{4}\/\d{1,2}\/\d{1,2}/;
const CLOCK_TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?\b/;
const LONG_HEX_PATTERN = /[0-9a-f]{32,}/i;
const NODE_ARCH_PATTERN = /node-v\d+/i;
const DIGEST_PREFIX_PATTERN = /(?:^|[^0-9a-z])(?:sha\d*|integrity)[-:]/i;
const DOTTED_FOUR_GROUP_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const DOTTED_VERSION_PATTERN = /^\d{1,2}(?:\.\d{1,3}){2,}$/;
const DOTTED_FRACTION_PATTERN = /^\d+(?:\.\d{1,2})$/;

/** A digit run and where it sits on the line. */
interface TelephoneCandidate {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

/** How a candidate was reached, which decides how much structure it must carry. */
type TelephoneAnchor = 'specific-keyword' | 'general-keyword' | 'shape-only';

/**
 * Match a telephone-number pattern in two ways, with the negative guards the scan needs.
 *
 * Returns one match per number, deduped by overlap and excerpted through `maskExcerpt`. The first
 * way is keyword-anchored: a context keyword — tel, telephone, phone, mobile, cell, whatsapp, sms,
 * fax, call, contact — followed within a short distance by 7 to 15 digits. Beside a keyword that
 * names a telephone directly a bare digit run is reported; beside the general words call and
 * contact the run must also be grouped, since both appear in ordinary prose and in code. The second
 * way is a strict shape on its own, which must carry a separator, a parenthesised group or a
 * leading plus, so an ungrouped run of digits is never reported on its own. Refuses, by returning
 * no match, a candidate that is not 7 to 15 digits, one adjacent to a letter, a digit, a hash or a
 * separator that ties it to a longer token, and any candidate whose surrounding token is a UUID, a
 * date, timestamp or clock time, a long hex digest, a sha or integrity-prefixed digest, a
 * node-v<digits>-<architecture> triple, a dotted quad, a dotted version or a dotted fraction.
 *
 * The rule detects a pattern, not a person: a number written in words, or with its digits split by
 * unrelated text, is invisible to it, which is why the manual privacy review exists alongside it.
 */
function matchTelephoneNumber(context: RuleLineContext): readonly RuleMatch[] {
  const text = context.text;
  const candidates: TelephoneCandidate[] = [];
  const keywordPattern = new RegExp(PHONE_KEYWORD_SOURCE, 'gi');
  for (const keyword of text.matchAll(keywordPattern)) {
    const keywordValue = (keyword[1] ?? '').toLowerCase();
    const keywordEnd = (keyword.index ?? 0) + keyword[0].length;
    const anchor: TelephoneAnchor = PHONE_SPECIFIC_KEYWORDS.has(keywordValue)
      ? 'specific-keyword'
      : 'general-keyword';
    const window = text.slice(keywordEnd, keywordEnd + PHONE_KEYWORD_WINDOW);
    const loosePattern = new RegExp(LOOSE_PHONE_CANDIDATE_SOURCE, 'g');
    for (const candidate of window.matchAll(loosePattern)) {
      const start = keywordEnd + (candidate.index ?? 0);
      const end = start + candidate[0].length;
      if (isPlausibleTelephoneCandidate(text, start, end, anchor)) {
        candidates.push({ start, end, value: text.slice(start, end) });
      }
    }
  }
  const strictPattern = new RegExp(STRICT_PHONE_CANDIDATE_SOURCE, 'g');
  for (const candidate of text.matchAll(strictPattern)) {
    const start = candidate.index ?? 0;
    const end = start + candidate[0].length;
    if (isPlausibleTelephoneCandidate(text, start, end, 'shape-only')) {
      candidates.push({ start, end, value: candidate[0] });
    }
  }
  const accepted: TelephoneCandidate[] = [];
  for (const candidate of [...candidates].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    if (accepted.some((other) => candidate.start < other.end && other.start < candidate.end)) {
      continue;
    }
    accepted.push(candidate);
  }
  return accepted.map((candidate) => ({
    ruleId: TELEPHONE_NUMBER_RULE_ID,
    excerpt: maskExcerpt(candidate.value),
  }));
}

/** Whether a candidate looks like a telephone number rather than a number that is not one. */
function isPlausibleTelephoneCandidate(
  text: string,
  start: number,
  end: number,
  anchor: TelephoneAnchor,
): boolean {
  const value = text.slice(start, end);
  const digitCount = value.replace(/\D/g, '').length;
  if (digitCount < MIN_PHONE_DIGITS || digitCount > MAX_PHONE_DIGITS) {
    return false;
  }
  const startsWithPlus = value.startsWith('+');
  const hasStructure = startsWithPlus || PHONE_STRUCTURE_PATTERN.test(value);
  const spaceGroupedOnly = !startsWithPlus && !PHONE_DOT_OR_DASH_PATTERN.test(value);
  if (anchor === 'general-keyword' && !hasStructure) {
    return false;
  }
  if (anchor === 'shape-only') {
    if (!hasStructure || (spaceGroupedOnly && countDigitGroups(value) < 3)) {
      return false;
    }
  }
  const before = start > 0 ? text.charAt(start - 1) : '';
  const after = end < text.length ? text.charAt(end) : '';
  if (/[0-9A-Za-z_@#]/.test(before) || before === '-' || before === '.') {
    return false;
  }
  if (/[0-9A-Za-z_@#%]/.test(after)) {
    return false;
  }
  if ((after === '-' || after === '.') && /[0-9]/.test(text.charAt(end + 1))) {
    return false;
  }
  const token = surroundingToken(text, start, end);
  if (token.length === 0) {
    return false;
  }
  if (UUID_PATTERN.test(token) || ISO_DATE_TIME_PATTERN.test(token)) {
    return false;
  }
  if (SLASH_DATE_PATTERN.test(token) || CLOCK_TIME_PATTERN.test(token)) {
    return false;
  }
  if (LONG_HEX_PATTERN.test(token) || DIGEST_PREFIX_PATTERN.test(token)) {
    return false;
  }
  if (NODE_ARCH_PATTERN.test(token)) {
    return false;
  }
  if (DOTTED_FOUR_GROUP_PATTERN.test(token) || DOTTED_VERSION_PATTERN.test(token)) {
    return false;
  }
  if (DOTTED_FRACTION_PATTERN.test(token)) {
    return false;
  }
  return !(/[A-Za-z]/.test(token) && token.includes('/'));
}

/* ------------------------------------------------------------------------------------------------
 * Rules 3 and 4: credential material
 * ---------------------------------------------------------------------------------------------- */

/** The five dashes of a PEM-style header, assembled so the literal header never appears here. */
const DASH_RUN = '-'.repeat(5);

/**
 * The private-key header: the dash run, BEGIN, an optional uppercase label and the private-key
 * trailer. Built from the assembled dash run, so this file contains no header its own rule matches.
 */
const PRIVATE_KEY_HEADER_SOURCE = `${DASH_RUN}BEGIN[A-Z0-9 ]{0,40}PRIVATE KEY${DASH_RUN}`;

/**
 * Match a PEM-style private-key header line, the highest-precision credential shape a pattern can
 * find.
 *
 * Returns one match per header on the line, excerpted through `maskExcerpt`. Refuses nothing: the
 * shape is specific enough that a match is a header.
 */
function matchPrivateKeyHeader(context: RuleLineContext): readonly RuleMatch[] {
  const matches: RuleMatch[] = [];
  const pattern = new RegExp(PRIVATE_KEY_HEADER_SOURCE, 'g');
  for (const candidate of context.text.matchAll(pattern)) {
    matches.push({ ruleId: PRIVATE_KEY_HEADER_RULE_ID, excerpt: maskExcerpt(candidate[0]) });
  }
  return matches;
}

/**
 * The credential keywords. `hash`, `checksum`, `digest`, `license`, `version`, `port`, `id`, `url`,
 * `name`, `type` and `status` are deliberately absent: the repository's own manifest fields,
 * checksums and migration digests would otherwise fire, and a field named with those words is not a
 * credential.
 */
const CREDENTIAL_KEYWORD_SOURCE =
  'password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key|bearer';

/**
 * An assignment of one of those keywords to a quoted literal, or to a bare value of at least 12
 * characters in token shape. A quoted value may hold anything but its own quote, so a dotted
 * credential is still reached, while a bare value cannot be a dotted path or a call. The keyword may
 * itself carry a closing quote, because a JSON or YAML key is written that way.
 */
const CREDENTIAL_ASSIGNMENT_SOURCE = `\\b(?:${CREDENTIAL_KEYWORD_SOURCE})\\b["'\`]?\\s*(?::|=>|=)\\s*(?:"([^"\\r\\n]+)"|'([^'\\r\\n]+)'|\`([^\`\\r\\n]+)\`|([A-Za-z0-9+/=_-]{12,}))`;

/** A bare value of letters only is a word or an identifier, never a credential. */
const BARE_VALUE_WORD_PATTERN = /^[A-Za-z]+$/;

/** The floor below which a value is a word rather than a credential, and the entropy gate's own. */
const CREDENTIAL_SCALAR_MIN_LENGTH = 12;
const CREDENTIAL_ENTROPY_MIN_LENGTH = 16;
const CREDENTIAL_MIN_ENTROPY_BITS = 3.5;

/**
 * The words and shapes that mark a value as a placeholder rather than a credential, applied before
 * the entropy gate so that a long placeholder is never reported.
 */
const PLACEHOLDER_MARKERS: readonly string[] = Object.freeze([
  'redacted',
  'placeholder',
  'example',
  'changeme',
  'your-',
  'xxxx',
  'todo',
  'test',
  'dummy',
  'sample',
  '<',
  '*',
]);

/**
 * Match an assignment of a credential keyword to a scalar, high-entropy value.
 *
 * Returns one match per assignment, excerpted through `maskExcerpt`. Refuses, by returning no
 * match, an assignment to an array or an object, an empty value, a boolean, null or undefined, a
 * value under either length floor, a value carrying a placeholder marker, a value that opens with a
 * bracket or a placeholder character, and a value whose Shannon entropy is under 3.5 bits per
 * character. Both length floors are applied: the scalar floor refuses a short word, and the entropy
 * gate's floor refuses a value too short for its score to mean anything. A bare value is refused as
 * well when it is the callee of a call or a word of letters alone — an expression reference such as
 * `token = readToken(...)` is code, not a credential.
 *
 * An entropy-gated keyword match is best effort by construction: no pattern reliably separates a
 * placeholder from a real credential, so this rule must never be described as proving the absence
 * of secrets.
 */
function matchCredentialAssignment(context: RuleLineContext): readonly RuleMatch[] {
  const matches: RuleMatch[] = [];
  const pattern = new RegExp(CREDENTIAL_ASSIGNMENT_SOURCE, 'gi');
  for (const candidate of context.text.matchAll(pattern)) {
    const quoted = candidate[1] ?? candidate[2] ?? candidate[3];
    const value = quoted ?? candidate[4] ?? '';
    if (quoted === undefined) {
      const afterValue = context.text.charAt((candidate.index ?? 0) + candidate[0].length);
      if (afterValue === '(' || BARE_VALUE_WORD_PATTERN.test(value)) {
        continue;
      }
    }
    if (!isCredentialLikeValue(value)) {
      continue;
    }
    matches.push({ ruleId: CREDENTIAL_ASSIGNMENT_RULE_ID, excerpt: maskExcerpt(value) });
  }
  return matches;
}

/** Whether an assigned value is a credential-shaped scalar rather than a placeholder or a word. */
function isCredentialLikeValue(value: string): boolean {
  if (
    value.length < CREDENTIAL_SCALAR_MIN_LENGTH ||
    value.length < CREDENTIAL_ENTROPY_MIN_LENGTH
  ) {
    return false;
  }
  if (
    value.startsWith('[') ||
    value.startsWith('{') ||
    value.startsWith('<') ||
    value.startsWith('*')
  ) {
    return false;
  }
  if (/^(?:true|false|null|undefined)$/i.test(value)) {
    return false;
  }
  const lowered = value.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) {
    return false;
  }
  return shannonEntropyPerCharacter(value) >= CREDENTIAL_MIN_ENTROPY_BITS;
}

/* ------------------------------------------------------------------------------------------------
 * Rule 5: prohibited dependencies
 * ---------------------------------------------------------------------------------------------- */

/**
 * Match a dependency name against the blocked-provider digests.
 *
 * Returns one match when any token variant of the name hashes to a digest in the store, and no
 * match otherwise — the store holds digests only, so no provider name appears in this repository.
 * Refuses nothing beyond that: a name whose variants are absent from the store is not a finding, and
 * an empty store yields no match at all.
 */
function matchProhibitedDependency(
  context: RuleDependencyContext,
  blockedTokenDigests: ReadonlySet<string>,
): readonly RuleMatch[] {
  if (blockedTokenDigests.size === 0) {
    return [];
  }
  for (const variant of tokenVariants(context.name)) {
    if (blockedTokenDigests.has(hashToken(variant))) {
      return [{ ruleId: PROHIBITED_DEPENDENCY_RULE_ID, excerpt: maskExcerpt(context.name) }];
    }
  }
  return [];
}

/* ------------------------------------------------------------------------------------------------
 * The rules, and what the scan says about its own limits
 * ---------------------------------------------------------------------------------------------- */

/**
 * The five rules, one per matcher, covering exactly the four detectable classes: mail addresses;
 * telephone numbers; the two credential rules, which report under the single `credential-material`
 * class the scan groups findings by; and prohibited dependencies. The content rules apply to text,
 * manifests and lockfiles, and the dependency rule to manifests and lockfiles alone.
 */
export const EXCLUSION_RULES: readonly ExclusionRule[] = Object.freeze([
  Object.freeze({
    id: EMAIL_ADDRESS_RULE_ID,
    class: 'email-address',
    description:
      'A complete address shape: a local part, the separator, at least two domain labels and an alphabetic top-level label. An npm scope reaches the separator but carries no dot in its domain, so no scope is reported, and an address written with words or spaces is invisible to it.',
    appliesTo: CONTENT_KINDS,
    kind: 'line',
    matchLine: matchEmailAddress,
  }),
  Object.freeze({
    id: TELEPHONE_NUMBER_RULE_ID,
    class: 'telephone-number',
    description:
      'Anchored beside tel, phone, sms and similar keywords, or recognised by a strictly grouped shape on its own, with the guards the scan needs: a run of 7 to 15 digits, never a date, a timestamp, a clock time, a UUID, a hex digest or a node-v<digits>-<architecture> triple. It detects a pattern rather than a person, which is why the manual review stands beside it.',
    appliesTo: CONTENT_KINDS,
    kind: 'line',
    matchLine: matchTelephoneNumber,
  }),
  Object.freeze({
    id: PRIVATE_KEY_HEADER_RULE_ID,
    class: 'credential-material',
    description:
      'A PEM-style private-key header line: the dash run, BEGIN, an optional uppercase label and the private-key trailer. The highest-precision credential shape a pattern can find, and its pattern text is assembled in this module so that no header appears in the file itself.',
    appliesTo: CONTENT_KINDS,
    kind: 'line',
    matchLine: matchPrivateKeyHeader,
  }),
  Object.freeze({
    id: CREDENTIAL_ASSIGNMENT_RULE_ID,
    class: 'credential-material',
    description:
      'A credential keyword (password, secret, token, api key, client secret, private key, bearer and similar) assigned to a scalar value that clears the placeholder denylist, both length floors and a 3.5-bit-per-character entropy gate. Best effort by construction: no pattern reliably separates a placeholder from a real credential, so a clean run never proves the absence of secrets.',
    appliesTo: CONTENT_KINDS,
    kind: 'line',
    matchLine: matchCredentialAssignment,
  }),
  Object.freeze({
    id: PROHIBITED_DEPENDENCY_RULE_ID,
    class: 'prohibited-dependency',
    description:
      'A dependency name whose token variant hashes to a digest in the blocked-provider store. The store holds digests only, so no provider name appears in this repository, and the rule runs over manifests and lockfiles alone.',
    appliesTo: DEPENDENCY_KINDS,
    kind: 'dependency',
    matchDependency: matchProhibitedDependency,
  }),
] as ExclusionRule[]);

/** The four classes the scan detects, in the order the scanner is expected to group them. */
export const EXCLUSION_CLASSES: readonly ExclusionClass[] = Object.freeze([
  'email-address',
  'telephone-number',
  'credential-material',
  'prohibited-dependency',
] as ExclusionClass[]);

/**
 * What the scan does not do, printed with its findings and asserted by its self-test.
 *
 * One limitation per entry, in the words the scanner and the documentation may use. No document,
 * report or user-interface string may describe the scan as more than this.
 */
export const SCAN_LIMITATIONS: readonly string[] = Object.freeze([
  'The scan detects four classes only: mail addresses, telephone-number patterns, credential material, and prohibited payment, analytics and advertising dependencies.',
  'It does not detect personal names.',
  'It does not detect contextual disclosure of private or nonpublic information.',
  'It does not detect references to private projects, products or datasets.',
  'It reads the working tree and the local git history, and nothing outside the checkout.',
  'It matches patterns rather than meaning, so a clean run is not evidence that the repository holds no private information, and the scan must never be described as guaranteeing that absence.',
  'It is supplementary to the manual privacy review in docs/REVIEW-CHECKLIST.md, and never a substitute for it.',
]);

