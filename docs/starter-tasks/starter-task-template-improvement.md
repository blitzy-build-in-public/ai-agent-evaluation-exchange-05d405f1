# Improve the starter-task template

Labels: P1, good-first-issue, milestone M4

## Scope

Every brief in this folder is written to one shape, and that shape is what makes the folder checkable
rather than trusted. A brief is four parts and nothing else:

- a level-one heading that names the task and is the file's **first** Markdown heading;
- one plain `Labels:` line, naming the priority tier `docs/ROADMAP.md` gives the capability, the
  `good-first-issue` label and the milestone that capability belongs to;
- a `## Scope` section stating exactly what you add, which files it touches and what must not change;
- a `## Acceptance` section stating how the change is judged — a named command and the observable
  result it must produce.

`apps/api/test/integration/repository-conventions.test.ts` reads this folder as text and asserts that
every file carries a title, a scope and an acceptance note, which is why the shape is a contract rather
than a house style: the suite goes red, naming the file and the missing element, when a brief loses one
of the three. Your task is to improve what those four parts tell a contributor — the wording and the
usefulness of the guidance inside them — and not to add a fifth part, a new template file, or a second
place where the shape is written down.

**What you may change, in the briefs already here.** The guidance inside the four parts:

- Make an acceptance note concrete. Each of its items should name a command that exits 0, a response
  that carries a value, or a line of output to paste, rather than an intention a reviewer has to
  interpret.
- Name the tier and the milestone plainly on the `Labels:` line, using the vocabulary
  `docs/ROADMAP.md` already uses.
- Point at the document that owns the detail — the standard's rubric document, the governance rules,
  the Shield policy format — instead of restating it in the brief.
- Drop a sentence that repeats what `CONTRIBUTING.md` or `docs/ROADMAP.md` says, and link to it
  instead.
- Fix a brief whose named path, symbol, route, status code or command has drifted from what the plan
  declares, so that every path a brief names still resolves to something real.

**What you may not change.** The three structural elements — the level-one title, the scope section and
the acceptance note — may not be removed or renamed, because the suite above asserts them and
criterion 12, the contributor path, rests on them. The folder's population and its file names stay as
they are: one brief per task the plan lists. And the folder's conventions hold: Markdown only, no
subfolder, no index file, no additional template file, and no further brief invented to hold the
template, because the template is the shape these briefs share rather than a file of its own. Do not
restate `CONTRIBUTING.md` or `docs/ROADMAP.md`, and do not pad a brief to fill space: a brief is one
page, and a longer one is a harder one to act on.

**What your edits must preserve.** The closed vocabulary, spelled exactly wherever it appears: `SAMPLE`,
`VERIFIED-IN-DEMO`, "structured output on fixture set only", "Sponsored", "demo only, no production
authentication", `DEMO`, "No SGI report yet", "to be determined", `SGI-SO-1.0.0`. No brief may invite
work the plan defers or excludes, and none may describe the repository as certified, independently
verified, guaranteed to pass, or proved free of private information by the exclusion scan. No brief may
tell a contributor to edit one of the nine append-only stores, a status code, a fixed interface, an
applied migration or a listed path: each of those is a plan revision raised before code exists, not an
implementation choice.

**Who a brief addresses.** The reader as "you" — never a person by name, and never with a contact
detail. No personal name, contact detail, email address, telephone-number pattern, credential or token
belongs in this folder: `npm run scan:exclusions` reads every tracked file, and the manual review
`docs/REVIEW-CHECKLIST.md` describes reads this folder by hand.

**Read next.** `CONTRIBUTING.md` for the contribution path and the artefacts a pull request carries;
`docs/ROADMAP.md` for the tiers and the milestones a `Labels:` line draws on; the briefs in this folder
for the shape in use, with `docs/starter-tasks/new-standard-version-case-set.md` as the most thorough
worked example.

## Acceptance

1. `npm run test:integration -- --testNamePattern="repository conventions"` exits 0 — the structural
   proof: this folder holds the plan's twelve briefs and every one of them carries a title, a scope and
   an acceptance note. A brief missing one of the three turns that suite red, naming the file.
2. Observable by reading this folder: every file's first Markdown heading is its title; every file
   carries exactly one `## Scope` and one `## Acceptance`; every file carries one `Labels:` line naming
   a tier `docs/ROADMAP.md` uses; and no file has gained a second H2 section, front matter or HTML.
3. The folder's shape is unchanged: the same briefs, one per task the plan lists — no brief added,
   renamed or removed, no subfolder, no index and no separate template file.
4. Every repository path, symbol, route and command a brief names still resolves to something the plan
   declares: grep each brief for `packages/`, `apps/`, `scripts/`, `docs/`, `e2e/` and `examples/`
   paths, and confirm each one exists.
5. `npm run scan:exclusions` exits 0 with an empty finding list, and no file in this folder contains
   `@` or a run of five or more consecutive digits.
6. The pull-request description records which briefs you changed and which of the three structural
   elements each change left intact, so a reviewer confirms criterion 12 still holds without
   re-deriving it.
