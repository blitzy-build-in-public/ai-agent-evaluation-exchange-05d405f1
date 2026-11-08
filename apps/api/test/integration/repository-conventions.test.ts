/**
 * Repository conventions: the structural half of criteria 12 and 13, read from the artefacts other
 * folders own rather than exercised over HTTP.
 *
 * **What this file proves.** A statement about a file is proved by reading the file, and four of the
 * repository's obligations are exactly that. Criterion 12's structural half is that a new
 * contributor's path exists: `docs/starter-tasks/` holds at least twelve labelled briefs, each with a
 * title, a scope and an acceptance note, and `README.md` documents every root script the root
 * `package.json` declares, so the commands a contributor is told to run are the commands the
 * repository actually has. Criterion 13's structural half is that the manual privacy review's
 * artefact exists: `docs/REVIEW-CHECKLIST.md` names the three categories the review covers — a real
 * personal name, the contextual disclosure of private or nonpublic information, and a reference to a
 * private project, product or dataset — and carries one sign-off line per category, while `README.md`
 * says in its own words that the review is manual. Two further conventions come from the plan's own
 * fixed text: `.github/CODEOWNERS` carries the single generic token `MAINTAINER-PLACEHOLDER` with the
 * instruction to replace it, and protects the same seven paths `SECURITY.md` names as in scope for a
 * security fix. The last block guards the compile contract this folder depends on.
 *
 * **Why the assertions are structural rather than judgemental.** Each one asks "is this artefact
 * present, and does it carry the required element", never "is this text good". A criterion that can
 * be argued away in review is a criterion that gets waived, so every check below reduces to a
 * computable fact, and every failure names the file and the element that is missing: where more than
 * one element can be absent the checks collect their failures into a list and assert the list is
 * empty, rather than asserting a bare length or a bare truthiness that a red run cannot explain.
 *
 * **What is enumerated and what is asserted literally.** The individual brief file names, the order
 * they are listed in and the README's layout are the docs folder's own choices, so both are
 * enumerated from disk: a brief that is added, renamed or reordered does not turn this suite red, and
 * the script list is read from `package.json` rather than retyped here. The CODEOWNERS token, its
 * replacement instruction and its seven protected paths are fixed by the plan, so they are asserted
 * by name — a path quietly dropped from that file is the change this check exists to catch.
 *
 * **No server is started here, and that is a deliberate deviation from this folder's own
 * description.** The other suites of `apps/api/test/integration/` reach their subject over HTTP, so
 * they build the harness of `./test-server` in `beforeAll` and tear it down in `afterAll`. This file
 * reaches no subject over HTTP: it reads the repository's own files as text. Starting an API,
 * opening an in-memory database and applying the migrations in order to assert that a Markdown file
 * carries a scope heading would be waste, and it is why `./test-server` is not imported below and no
 * request is made. What makes it an integration suite is its selection: the integration configuration
 * includes exactly the suites under `apps/api/test/integration/`, so a check that has to run as part
 * of `npm test` runs here.
 *
 * **What it reads, and with what.** Only `node:fs`, `node:path` and `node:url`, and always as text:
 * Markdown, JSON and JSON-with-comments are all read as strings. The tsconfig pair is never
 * `JSON.parse`d, because a `//` comment in a tsconfig is legal and would throw; the one file parsed
 * as JSON is the root `package.json`, a real manifest with no comments in it. No glob package, no
 * YAML parser and no front-matter parser is used, so the closed dependency inventory is untouched.
 * Nothing is written to disk, no fixture file is read from beside this suite, and no snapshot is
 * taken.
 *
 * **What it never asserts.** Nothing here asserts a certification, an independent verification, a
 * guaranteed pass, or that the automated exclusion scan proves the absence of private information:
 * the plan forbids all four. The suite's last statement about the scan is that neither document may
 * claim that guarantee, and the manual review is asserted to be a separate artefact rather than
 * something a command performs and proves.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/* -------------------------------------------------------------------------------------------------
 * Paths
 *
 * Every path is resolved from this module's own location and never from the working directory a run
 * happens to start in: this suite sits four directories below the repository root, so a run started
 * anywhere reads the same files.
 * ---------------------------------------------------------------------------------------------- */

/** The repository root, resolved from this file's own URL — `apps/api/test/integration/` is four deep. */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The root manifest, whose `scripts` object is the list of commands a contributor is told to run. */
const ROOT_MANIFEST_PATH = join(REPOSITORY_ROOT, "package.json");

/** The product's front page and the contributor's entry point. */
const README_PATH = join(REPOSITORY_ROOT, "README.md");

/** The code-ownership file whose placeholder token the plan fixes. */
const CODEOWNERS_PATH = join(REPOSITORY_ROOT, ".github", "CODEOWNERS");

/** The manual privacy review's artefact, with one sign-off line per category. */
const REVIEW_CHECKLIST_PATH = join(REPOSITORY_ROOT, "docs", "REVIEW-CHECKLIST.md");

/** The directory the labelled first-contribution briefs live in. */
const STARTER_TASKS_DIRECTORY = join(REPOSITORY_ROOT, "docs", "starter-tasks");

/** The API workspace's TypeScript configuration, which decides whether this folder is in the program. */
const API_TSCONFIG_PATH = join(REPOSITORY_ROOT, "apps", "api", "tsconfig.json");

/** The solution file whose project references make the whole tree build in dependency order. */
const ROOT_TSCONFIG_PATH = join(REPOSITORY_ROOT, "tsconfig.json");

/** The strict option set every workspace, and so every suite, inherits. */
const BASE_TSCONFIG_PATH = join(REPOSITORY_ROOT, "tsconfig.base.json");

/** The fixture package's manifest: the entry this folder's test-only `@adem/sgi-fixtures` import resolves to. */
const FIXTURES_MANIFEST_PATH = join(REPOSITORY_ROOT, "packages", "sgi-fixtures", "package.json");

/* -------------------------------------------------------------------------------------------------
 * The plan's fixed values, asserted by name
 * ---------------------------------------------------------------------------------------------- */

/** How many labelled briefs the contributor path must offer — the plan fixes twelve, asserted as a floor. */
const MINIMUM_STARTER_TASKS = 12;

/** The single generic token `.github/CODEOWNERS` holds, awaiting the project owner's replacement. */
const MAINTAINER_PLACEHOLDER = "MAINTAINER-PLACEHOLDER";

/** The instruction that must accompany the token, as the request fixes it verbatim. */
const REPLACEMENT_INSTRUCTION = /replace/i;

/**
 * The seven paths the plan protects, in the order it lists them. This is the same set `SECURITY.md`
 * repeats as in scope for a security fix, which is why each one is asserted literally rather than
 * inferred from the file's own patterns.
 */
const CODEOWNERS_PROTECTED_PATHS: readonly string[] = [
  "packages/sgi-core/",
  "packages/sgi-fixtures/",
  "packages/shield/",
  "packages/commerce-sim/",
  "docs/governance/",
  "scripts/scan-exclusions.ts",
  ".github/",
];

/**
 * An owner token that is machine-shaped: a single token, optionally a GitHub mention or an
 * organisation-and-team pair, with no space in it. A spaced display name cannot appear on a
 * CODEOWNERS line at all, which is the whole of what this shape can enforce — whether a bare handle
 * belongs to a real person is not decidable from the text and is criterion 13's manual review.
 */
const MACHINE_OWNER = /^@?[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The categories the manual review covers, and the phrase each must be named by. */
interface ReviewCategory {
  /** How the failure message names the category. */
  readonly label: string;
  /** The lowercased phrase the checklist must contain to cover it. */
  readonly phrase: string;
}

/** The three categories of criterion 13, matched case-insensitively on the phrases the criterion uses. */
const REVIEW_CATEGORIES: readonly ReviewCategory[] = [
  { label: "real personal names", phrase: "personal name" },
  {
    label: "contextual disclosure of private or nonpublic information",
    phrase: "contextual disclosure",
  },
  { label: "references to private projects, products or datasets", phrase: "private project" },
];

/** The two script names npm also accepts as shorthands, so the README may document them either way. */
const NPM_LIFECYCLE_SCRIPTS: readonly string[] = ["test", "start"];

/** A Markdown level-one heading — the title every brief opens with. */
const MARKDOWN_TITLE = /^#\s+\S/;

/** A label that names a brief's scope section. */
const SCOPE_LABEL = /\bscope\b/i;

/** A label that names what a brief deliberately leaves out, which is not its scope section. */
const NOT_A_SCOPE_LABEL = /\bout\s+of\s+scope\b|\bnot\s+in\s+scope\b|\bbeyond\s+the\s+scope\b/i;

/** A label that names a brief's acceptance note. */
const ACCEPTANCE_LABEL = /\bacceptance\b/i;

/** A line that records a reviewer's sign-off. */
const SIGN_OFF_LINE = /sign[-\s]?off/i;

/** The reviewer field a sign-off line must carry, because a signed category names who signed it. */
const REVIEWER_FIELD = /\breviewer\b/i;

/** The README's statement that the privacy review is performed by hand. */
const MANUAL = /\bmanual\b/i;

/** The other half of that statement. */
const REVIEW = /\breview\b/i;

/**
 * A phrase that asserts the exclusion scan guarantees the absence of private information — the one
 * claim the plan forbids outright. A sentence that carries a negation before this phrase states the
 * opposite (that the scan does *not* guarantee it), which is what the delivered documents say and
 * what this check must not report.
 */
const GUARANTEE_OF_ABSENCE = /\bguarantee(?:s|d|ing)?\s+(?:the|that)\s+absence\b/gi;

/** A negation anywhere earlier in the phrase's own sentence, which turns the claim into its opposite. */
const NEGATION = /\b(?:not|never|nor|no|none|nothing|cannot|without|refus\w*|n't)\b/i;

/** A string a file must carry, and why the suite cares that it does. */
interface RequiredFragment {
  /** The literal text the file must contain. */
  readonly fragment: string;
  /** What breaks when it is absent, phrased for the failure message. */
  readonly why: string;
}

/** The API configuration fragments that put this folder in the TypeScript program. */
const REQUIRED_API_TSCONFIG_FRAGMENTS: readonly RequiredFragment[] = [
  {
    fragment: "test/**",
    why: "the include that puts this folder's suites in the program at all",
  },
  {
    fragment: "../../tsconfig.base.json",
    why: "the inheritance that gives every suite the strict option set",
  },
  {
    fragment: '"composite"',
    why: "the flag the solution build needs from a referenced project",
  },
];

/** The strict options this folder's suites compile under; loosening one changes what compiles. */
const REQUIRED_BASE_TSCONFIG_FRAGMENTS: readonly RequiredFragment[] = [
  { fragment: '"strict"', why: "strict mode, without which the option set is not the plan's" },
  {
    fragment: '"noUncheckedIndexedAccess"',
    why: "the indexed-read narrowing every suite here relies on",
  },
  {
    fragment: '"verbatimModuleSyntax"',
    why: "the type-only import form the suites are written in",
  },
];

/* -------------------------------------------------------------------------------------------------
 * Reading helpers
 *
 * All of them are pure reads: no helper below writes a file, opens a socket or reads an environment
 * variable, and every failure message names a repository-relative path so a red run is actionable.
 * ---------------------------------------------------------------------------------------------- */

/** A repository-relative path, which is the only form the failure messages may use. */
function displayPath(absolutePath: string): string {
  return relative(REPOSITORY_ROOT, absolutePath);
}

/**
 * A file's text, or a failure naming the path. A missing artefact is the first finding a maintainer
 * needs, so it is reported as a failure of the check that reads it rather than as a stray throw.
 */
function readRequired(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    throw new Error(`${displayPath(absolutePath)}: the file does not exist or could not be read`);
  }
}

/** A file's lines, split on either line ending so a checkout's own convention cannot change the count. */
function textLines(text: string): readonly string[] {
  return text.split(/\r?\n/);
}

/**
 * The Markdown briefs under `docs/starter-tasks/`, sorted so a red run lists them in the same order
 * every time. A directory that cannot be read fails naming the directory, because reporting every
 * brief as absent would hide the one cause behind twelve symptoms.
 */
function requireStarterTaskNames(): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(STARTER_TASKS_DIRECTORY).filter((name) => name.endsWith(".md"));
  } catch {
    throw new Error(
      `${displayPath(STARTER_TASKS_DIRECTORY)}: the directory does not exist or could not be read`,
    );
  }
  return [...names].sort();
}

/**
 * The label a line carries, or `null` when the line is not a label at all. A brief's sections are
 * written as Markdown headings, as bolded labels or as plain `Scope:`-style labels, and all three
 * are accepted so the check reads the briefs the docs folder published rather than one house style.
 */
function sectionLabel(line: string): string | null {
  const trimmed = line.trim();
  const heading = /^#{1,6}\s+(.+?)\s*$/.exec(trimmed);
  if (heading?.[1] !== undefined) {
    return heading[1];
  }
  const bolded = /^(?:\*\*|__)(.+?)(?:\*\*|__):?\s*$/.exec(trimmed);
  if (bolded?.[1] !== undefined) {
    return bolded[1];
  }
  const plain = /^([A-Za-z][A-Za-z0-9 /-]{0,40}):\s*$/.exec(trimmed);
  if (plain?.[1] !== undefined) {
    return plain[1];
  }
  return null;
}

/** Whether a line is a label that names the wanted section, and not the section it is confused with. */
function isSectionLabel(
  line: string,
  wanted: RegExp,
  excluded: RegExp | null = null,
): boolean {
  const label = sectionLabel(line);
  if (label === null || !wanted.test(label)) {
    return false;
  }
  return excluded === null || !excluded.test(label);
}

/**
 * Runs a check over every item and returns one message per failing item, so a single red run reports
 * every gap rather than the first. A check returns `null` when the item satisfies it.
 */
function checkEach<T>(items: readonly T[], violation: (item: T) => string | null): readonly string[] {
  const failures: string[] = [];
  for (const item of items) {
    const message = violation(item);
    if (message !== null) {
      failures.push(message);
    }
  }
  return failures;
}

/**
 * The root scripts declared by the manifest, or `null` when its shape is not a manifest with a
 * `scripts` object of string commands. `package.json` is a real manifest with no comments in it, so
 * `JSON.parse` is the right reader here — unlike the tsconfig pair, which is read as text.
 */
function rootScriptNames(manifestText: string): readonly string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const scripts: unknown = (parsed as Record<string, unknown>)["scripts"];
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return null;
  }
  const names: string[] = [];
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command === "string" && command.trim() !== "") {
      names.push(name);
    }
  }
  return names;
}

/** One ownership rule of `.github/CODEOWNERS`: a path pattern and the owners it hands to. */
interface CodeownersRule {
  /** The pattern, with GitHub's optional leading slash removed so the plan's paths compare equal. */
  readonly path: string;
  /** Every owner token on the line, in the order the line lists them. */
  readonly owners: readonly string[];
}

/** The rules of `.github/CODEOWNERS`; blank lines and comments (the file's `#` lines) are not rules. */
function codeownersRules(text: string): readonly CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const line of textLines(text)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (pattern === undefined) {
      continue;
    }
    rules.push({ path: pattern.replace(/^\//, ""), owners });
  }
  return rules;
}

/**
 * The comment blocks of a file: each run of comment lines, blank lines between them included, ending
 * where content begins. A block is the unit a reader sees as one instruction, which is why the token
 * and the sentence telling the owner to replace it may sit on different lines of the same block.
 */
function commentBlocks(text: string): readonly string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of textLines(text)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      current.push(line);
      continue;
    }
    if (trimmed === "" && current.length > 0) {
      current.push(line);
      continue;
    }
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks;
}

/** Where a match sits, as the 1-based line number a reviewer would open. */
function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (text[position] === "\n") {
      line += 1;
    }
  }
  return line;
}

/** Whether `next` ends a sentence: whitespace follows the terminator, or the text ends there. */
function endsSentence(terminator: string, next: string | undefined): boolean {
  if (terminator === "\n") {
    return next === "\n";
  }
  if (terminator === "." || terminator === "!" || terminator === "?") {
    return next === undefined || /\s/.test(next);
  }
  return false;
}

/**
 * The index the sentence containing `index` begins at: the last sentence terminator or blank line
 * before it. A soft line wrap does not end a sentence, because a Markdown paragraph is wrapped by
 * hand — the negation that governs the phrase is often a line or two above it.
 */
function sentenceStartBefore(text: string, index: number): number {
  const prefix = text.slice(0, index);
  for (let position = prefix.length - 1; position >= 0; position -= 1) {
    const character = prefix[position];
    if (character === undefined) {
      continue;
    }
    if (endsSentence(character, prefix[position + 1])) {
      return position + 1;
    }
  }
  return 0;
}

/** The index just after the sentence containing `index`: the next terminator, or the text's end. */
function sentenceEndAfter(text: string, index: number): number {
  for (let position = index; position < text.length; position += 1) {
    const character = text[position];
    if (character === undefined) {
      continue;
    }
    if (endsSentence(character, text[position + 1])) {
      return position + 1;
    }
  }
  return text.length;
}

/**
 * Every statement in `text` that claims the exclusion scan guarantees the absence of private
 * information, each reported with its path, its line and the sentence it sits in. A phrase whose own
 * sentence carries a negation states the opposite — that the scan does *not* guarantee it — and is
 * not a claim; the sentences the delivered documents use are exactly that shape, so this check
 * reports a reworded claim and never the limitation itself.
 */
function unnegatedGuaranteeClaims(absolutePath: string, text: string): readonly string[] {
  const claims: string[] = [];
  for (const match of text.matchAll(GUARANTEE_OF_ABSENCE)) {
    const index = match.index;
    const phrase = match[0];
    if (index === undefined || phrase === undefined) {
      continue;
    }
    const sentenceStart = sentenceStartBefore(text, index);
    const sentence = text.slice(sentenceStart, index);
    if (NEGATION.test(sentence)) {
      continue;
    }
    const excerpt = text.slice(sentenceStart, sentenceEndAfter(text, index + phrase.length));
    claims.push(
      `${displayPath(absolutePath)}:${lineNumberAt(text, index)}: states that the scan guarantees the absence of private information — "${excerpt.replace(/\s+/g, " ").trim()}"`,
    );
  }
  return claims;
}

/** The fragments a file fails to carry, each reported as a failure naming the file and the fragment. */
function missingFragments(
  absolutePath: string,
  text: string,
  fragments: readonly RequiredFragment[],
): readonly string[] {
  return fragments
    .filter((required) => !text.includes(required.fragment))
    .map((required) => `${displayPath(absolutePath)}: ${required.fragment} is absent — ${required.why}`);
}

/* -------------------------------------------------------------------------------------------------
 * The suite
 *
 * The top-level title carries the words `repository conventions` because criteria 12 and 13 select
 * this suite by title — `npm run test:integration -- --testNamePattern="repository conventions"` —
 * and no nested title repeats a keyword another suite's command selects on (`evaluations`,
 * `route walk`, `immutability`, `ledger`, `trust separation`), so each documented command still
 * selects exactly one suite.
 * ---------------------------------------------------------------------------------------------- */

describe("repository conventions", () => {
  /*
   * (a) Criterion 12's first half: the contributor path. The brief file names and their order are the
   * docs folder's own choice, so they are enumerated from disk rather than retyped here.
   */
  describe("the starter-task briefs a first contribution begins from", () => {
    it("holds at least twelve briefs", () => {
      const names = requireStarterTaskNames();
      const failures =
        names.length >= MINIMUM_STARTER_TASKS
          ? []
          : [
              `${displayPath(STARTER_TASKS_DIRECTORY)}: holds ${names.length} Markdown ${
                names.length === 1 ? "brief" : "briefs"
              }, and the contributor path requires at least ${MINIMUM_STARTER_TASKS}${
                names.length === 0 ? "" : ` (found: ${names.join(", ")})`
              }`,
            ];
      expect(
        failures,
        "the starter-task directory must offer at least twelve labelled first contributions",
      ).toEqual([]);
    });

    it("gives every brief a title, a scope and an acceptance note", () => {
      const failures: string[] = [];
      for (const name of requireStarterTaskNames()) {
        const absolutePath = join(STARTER_TASKS_DIRECTORY, name);
        const lines = textLines(readRequired(absolutePath));
        const shown = displayPath(absolutePath);
        if (!lines.some((line) => MARKDOWN_TITLE.test(line))) {
          failures.push(`${shown}: no title — the brief must open with a Markdown "# " heading`);
        }
        if (!lines.some((line) => isSectionLabel(line, SCOPE_LABEL, NOT_A_SCOPE_LABEL))) {
          failures.push(
            `${shown}: no scope — the brief must carry a heading or a prominent label naming its scope`,
          );
        }
        if (!lines.some((line) => isSectionLabel(line, ACCEPTANCE_LABEL))) {
          failures.push(
            `${shown}: no acceptance note — the brief must carry a heading or a prominent label saying what done means`,
          );
        }
      }
      expect(
        failures,
        "every starter-task brief must carry a title, a scope and an acceptance note",
      ).toEqual([]);
    });
  });

  /*
   * (b) Criterion 12's second half: the README documents every root script the manifest declares, so
   * the commands a contributor is told to run are the commands the repository actually has. The list
   * is read from the manifest, and the check is presence rather than layout.
   */
  describe("the commands the README documents", () => {
    it("names every root script the manifest declares", () => {
      const scriptNames = rootScriptNames(readRequired(ROOT_MANIFEST_PATH));
      if (scriptNames === null) {
        throw new Error(
          `${displayPath(ROOT_MANIFEST_PATH)}: "scripts" is missing, or is not an object of string commands`,
        );
      }
      if (scriptNames.length === 0) {
        throw new Error(`${displayPath(ROOT_MANIFEST_PATH)}: "scripts" declares no command`);
      }
      const readme = readRequired(README_PATH);
      const failures = checkEach(scriptNames, (name) => {
        const forms = [`npm run ${name}`];
        if (NPM_LIFECYCLE_SCRIPTS.includes(name)) {
          forms.push(`npm ${name}`);
        }
        return forms.some((form) => readme.includes(form))
          ? null
          : `${displayPath(README_PATH)}: documents no command for the root script "${name}" (expected ${forms.join(" or ")})`;
      });
      expect(failures, "every root script must be documented in the README").toEqual([]);
    });
  });

  /*
   * (c) The code-ownership file. Its token, its replacement instruction and the seven paths it
   * protects are fixed by the plan, so they are asserted by name: a path quietly dropped from that
   * file is the change this check exists to catch.
   */
  describe("the code-ownership file", () => {
    it("carries the placeholder token with the instruction to replace it", () => {
      const text = readRequired(CODEOWNERS_PATH);
      const failures: string[] = [];
      if (!text.includes(MAINTAINER_PLACEHOLDER)) {
        failures.push(
          `${displayPath(CODEOWNERS_PATH)}: does not contain the token ${MAINTAINER_PLACEHOLDER}`,
        );
      }
      /*
       * The placeholder is the documented state of this file rather than an oversight: until the
       * project owner replaces it the file is intentionally not a valid owner list, because the
       * hosting platform cannot resolve the token. That is exactly why the instruction has to stand
       * in the same comment block as the token, instead of being assumed from the token alone. The
       * block is read as a whole because the delivered file's header wraps it across several lines.
       */
      const tokenBlock = commentBlocks(text).find((block) =>
        block.includes(MAINTAINER_PLACEHOLDER),
      );
      if (tokenBlock === undefined) {
        failures.push(
          `${displayPath(CODEOWNERS_PATH)}: no comment names ${MAINTAINER_PLACEHOLDER}, so nothing explains the placeholder to the owner who must replace it`,
        );
      } else if (!REPLACEMENT_INSTRUCTION.test(tokenBlock)) {
        failures.push(
          `${displayPath(CODEOWNERS_PATH)}: the comment naming ${MAINTAINER_PLACEHOLDER} does not instruct the owner to replace it`,
        );
      }
      expect(
        failures,
        "the ownership file must carry the placeholder token and its replacement instruction",
      ).toEqual([]);
    });

    it("protects each of the seven paths the plan fixes", () => {
      const rules = codeownersRules(readRequired(CODEOWNERS_PATH));
      const protectedPaths = new Set(rules.map((rule) => rule.path));
      const failures = checkEach(CODEOWNERS_PROTECTED_PATHS, (path) =>
        protectedPaths.has(path)
          ? null
          : `${displayPath(CODEOWNERS_PATH)}: protects no rule for "${path}"`,
      );
      expect(failures, "every protected path must carry its own ownership rule").toEqual([]);
    });

    it("names no owner that is a personal name rather than a machine token", () => {
      /*
       * This repository carries no real personal name anywhere, so an owner is either the placeholder
       * or a machine-shaped token. A spaced display name cannot stand on a CODEOWNERS line at all;
       * whether a bare handle belongs to a real person is not decidable from the text, which is why
       * that half is criterion 13's manual review rather than this check.
       */
      const failures: string[] = [];
      for (const rule of codeownersRules(readRequired(CODEOWNERS_PATH))) {
        if (rule.owners.length === 0) {
          failures.push(
            `${displayPath(CODEOWNERS_PATH)}: the rule for "${rule.path}" names no owner`,
          );
          continue;
        }
        for (const owner of rule.owners) {
          if (owner === MAINTAINER_PLACEHOLDER || MACHINE_OWNER.test(owner)) {
            continue;
          }
          failures.push(
            `${displayPath(CODEOWNERS_PATH)}: the owner "${owner}" on the rule for "${rule.path}" is neither ${MAINTAINER_PLACEHOLDER} nor a machine-shaped token`,
          );
        }
      }
      expect(
        failures,
        "an owner must be the placeholder token or a machine-shaped token",
      ).toEqual([]);
    });
  });

  /*
   * (d) Criterion 13: the manual review's artefact, its per-category sign-off lines, the README's
   * statement that the review is manual, and the one claim neither document may make.
   */
  describe("the manual privacy review and the README's statement about it", () => {
    it("names each of the three categories the review covers", () => {
      const checklist = readRequired(REVIEW_CHECKLIST_PATH).toLowerCase();
      const failures = checkEach(REVIEW_CATEGORIES, (category) =>
        checklist.includes(category.phrase)
          ? null
          : `${displayPath(REVIEW_CHECKLIST_PATH)}: names no ${category.label}, which the review must cover`,
      );
      expect(failures, "the checklist must cover all three review categories").toEqual([]);
    });

    it("carries one sign-off line per category", () => {
      /*
       * One line per category, each carrying the reviewer field: a category that has not been read is
       * not signed, and folding two into one line would hide which of the three was actually read.
       * The field itself stays a placeholder for a real account — no name is invented in this
       * repository, here or anywhere else — so this checks that the field exists, never that it has
       * been filled in.
       */
      const lines = textLines(readRequired(REVIEW_CHECKLIST_PATH));
      const signOffLines = lines.filter((line) => SIGN_OFF_LINE.test(line));
      const failures: string[] = [];
      if (signOffLines.length < REVIEW_CATEGORIES.length) {
        failures.push(
          `${displayPath(REVIEW_CHECKLIST_PATH)}: carries ${signOffLines.length} line${
            signOffLines.length === 1 ? "" : "s"
          } recording a sign-off, and one per category is required — ${REVIEW_CATEGORIES.length}`,
        );
      }
      const signedLines = signOffLines.filter((line) => REVIEWER_FIELD.test(line));
      if (signedLines.length < REVIEW_CATEGORIES.length) {
        failures.push(
          `${displayPath(REVIEW_CHECKLIST_PATH)}: only ${signedLines.length} of those lines carry a reviewer field, and one per category is required — ${REVIEW_CATEGORIES.length}`,
        );
      }
      expect(failures, "the checklist must carry one sign-off line per category").toEqual([]);
    });

    it("is stated in the README to be manual", () => {
      const lines = textLines(readRequired(README_PATH));
      const failures = lines.some((line) => MANUAL.test(line) && REVIEW.test(line))
        ? []
        : [
            `${displayPath(README_PATH)}: states in no line that the privacy review is manual, which the criterion requires of it`,
          ];
      expect(failures, "the README must say that the privacy review is manual").toEqual([]);
    });

    it("never claims the scan guarantees the absence of private information", () => {
      /*
       * The automated scan is supplementary and the manual review covers what it cannot see, so the
       * two artefacts are never presented as interchangeable. A sentence that claims the guarantee is
       * reported; a sentence that denies it — the delivered documents' own wording — is not.
       */
      const failures = [README_PATH, REVIEW_CHECKLIST_PATH].flatMap((absolutePath) =>
        unnegatedGuaranteeClaims(absolutePath, readRequired(absolutePath)),
      );
      expect(
        failures,
        "neither document may describe the scan as guaranteeing the absence of private information",
      ).toEqual([]);
    });
  });

  /*
   * (e) The compile contract this folder depends on. These assertions live in an integration suite
   * because `vitest.integration.config.ts` includes exactly the integration suites of the API
   * workspace, so this is the only place in the repository where a TypeScript-level structural check
   * runs as part of `npm test`. Each one guards something the suites here silently rely on: being in
   * the program at all, the strict options they are compiled under, and the resolution path of the
   * fixture package a sibling suite imports.
   */
  describe("the compile contract this folder depends on", () => {
    it("keeps this folder inside the API workspace's TypeScript program", () => {
      const failures = missingFragments(
        API_TSCONFIG_PATH,
        readRequired(API_TSCONFIG_PATH),
        REQUIRED_API_TSCONFIG_FRAGMENTS,
      );
      expect(
        failures,
        "the API workspace's configuration must keep this folder in the program",
      ).toEqual([]);
    });

    it("resolves the fixture package this folder's suites import", () => {
      /*
       * `api-contract.test.ts` imports `@adem/sgi-fixtures` although `apps/api/package.json`
       * deliberately does not declare it: a route reaches a case set through `@adem/sgi-core` and
       * never through the loader, and a suite is not a route. Two things make that test-only import
       * resolve, and both are asserted here — the fixture package publishes a source entry, so the
       * workspace link in the root `node_modules` resolves the specifier, and the solution file
       * references both projects, so the whole-solution build compiles the fixture package's
       * declarations that this folder's program consumes.
       *
       * The pair is asserted rather than a `references` entry of this workspace's own, because the
       * delivered workspace carries no such entry and needs none: the API project reaches the fixture
       * package through `packages/sgi-core`, which already references it. A check that demanded a
       * reference the workspace does not carry would fail a build that is correct.
       */
      const fixturesManifest = readRequired(FIXTURES_MANIFEST_PATH);
      const solution = readRequired(ROOT_TSCONFIG_PATH);
      const failures: string[] = [];
      if (!fixturesManifest.includes('"./src/index.ts"')) {
        failures.push(
          `${displayPath(FIXTURES_MANIFEST_PATH)}: its exports map publishes no "./src/index.ts" entry, which is the specifier this folder imports`,
        );
      }
      for (const reference of ["./packages/sgi-fixtures", "./apps/api"]) {
        if (!solution.includes(reference)) {
          failures.push(
            `${displayPath(ROOT_TSCONFIG_PATH)}: references no ${reference}, so no solution build covers it`,
          );
        }
      }
      expect(failures, "the fixture import these suites make must have a resolution path").toEqual(
        [],
      );
    });

    it("compiles under the strict options the base configuration sets", () => {
      const failures = missingFragments(
        BASE_TSCONFIG_PATH,
        readRequired(BASE_TSCONFIG_PATH),
        REQUIRED_BASE_TSCONFIG_FRAGMENTS,
      );
      expect(failures, "the option set every suite compiles under must not be loosened").toEqual([]);
    });
  });
});

