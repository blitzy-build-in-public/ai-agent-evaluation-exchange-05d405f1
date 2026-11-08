# Contributing to ADEM

ADEM — the Agent Development Exchange and Marketplace — is a public, MIT-licensed foundation whose
first version runs locally with no account, no external service and no secret. This document is the
contribution path: what a checkout needs, which command proves which kind of change, how a branch and
a commit are named, which paths a maintainer reviews, the rules a change has to keep, and the
checklist every pull request carries.

Four documents sit beside this one and are not restated here. `README.md` is the product's own
account of what works and what deliberately does not, and holds the full command table.
`CODE_OF_CONDUCT.md` states the conduct expected in every issue, discussion and pull request.
`SECURITY.md` states how a vulnerability is reported and which modules a security fix covers.
`docs/governance/SGI-PROPOSALS.md` states how a change to a standard's criteria is proposed,
reviewed and published.

## 1. What you need, and the documented commands

Node.js 20 LTS (`engines` in the root `package.json` fixes `>=20.0.0 <21`), npm and git — nothing
else. No account, no API key, no database service, no registry credential and no environment file:
the product is built and run without one, and `npm ci` at the repository root installs all eight
workspaces from the single committed lockfile.

| Command | What it does |
| --- | --- |
| `npm install` | Installs every workspace from the committed lockfile. CI uses `CI=true npm ci`, which installs exactly the lockfile and never rewrites it. |
| `npm run build` | Compiles the workspaces with `tsc --build` and bundles the web application into `apps/web/dist`. |
| `npm run typecheck` | The static gate: `tsc --build` over the workspace project references. There is no linter or formatter in this repository — the dependency inventory is closed and names none — so this is the check that stands in its place. |
| `npm test` | Unit tests, integration tests and the exclusion scan's self-test. |
| `npm run test:unit` | Every `<name>.test.ts` beside its source under `apps/`, `packages/`, `examples/` and `scripts/`, except the exclusion scan's own self-test, which `npm run test:scan` owns so that no test file is run twice. |
| `npm run test:integration` | The suites in `apps/api/test/integration/`, which start the real server on an ephemeral port against an in-memory database. |
| `npm run test:e2e` | The browser suites in `e2e/` that exercise the developer-to-buyer loop and walk every public page. |
| `npm run test:a11y` | Accessibility and responsiveness at 1280 px and 360 px. |
| `npm run test:all` | `npm test`, then the browser and accessibility suites. |
| `npm run seed` | Applies the migrations and writes the demo rows into the database named by `ADEM_DB_PATH`. |
| `npm start` | Serves the API and the built web application from one process, on `http://localhost:3000` by default. |
| `npm run dev` | The web development server with hot reload; it proxies `/api` to the API at its default port. |
| `npm run scan:exclusions` | The four-class exclusion scan (section 7). Exits non-zero on a finding. |
| `npm run deps:report` | Regenerates `docs/DEPENDENCIES.md` and checks every licence against the allowlist. Exits non-zero on a licence outside it. |

The documented path from a clean checkout, in order:

```bash
npm install
npm run build
npm test
npm run seed && npm start      # then open http://localhost:3000
```

Three details save a contributor time:

- **The seed runs once, against a fresh database.** `seedDatabase` refuses a database that already
  holds rows rather than emptying it, so a second `npm run seed` over a seeded file fails loudly and
  changes nothing. Delete `.adem/adem.sqlite` or point `ADEM_DB_PATH` at a new path to seed again.
  `npm start` applies the migrations but never seeds, so a fresh checkout shows the exchange only
  after `npm run seed` has run once.
- **The container seeds explicitly, not at start-up.** `docker compose up` starts one service serving
  the UI and the API over a named volume; run `docker compose exec app npm run seed` once to fill it.
  Keeping the seed out of the service's own start command is what makes a restart on the persisted
  volume safe.
- **Two optional variables, both with working defaults**: `ADEM_PORT` (default `3000`) and
  `ADEM_DB_PATH` (default `<repository root>/.adem/adem.sqlite`, and a relative value is resolved
  against that same repository root rather than against the command's own working directory, so
  `npm run seed` and `npm start` open one file for one value). Nothing has to be set to install,
  build, test, seed or start. Setting `ADEM_PORT` while developing the UI also means pointing the
  web development server's proxy at it, because `apps/web/vite.config.ts` proxies `/api` to the API's
  documented default port.

### The browser suites

The end-to-end and accessibility suites start the built application themselves, on a port derived
from `CLONE_INDEX` (the default, `0`, is `4100`) and against a fresh, run-unique database file handed
to the process through `ADEM_DB_PATH`, so a suite never touches your own database and never collides
with a server you left running on `3000`. They need the web build to exist, so run `npm run build`
first, and they need the browser once:

```bash
npx playwright install chromium    # once per machine; the only download the project needs
CLONE_INDEX=3 npm run test:e2e     # optional: a different checkout on the same machine uses its own block
CLONE_INDEX=3 npm run test:a11y
```

## 2. Where a change goes, surface by surface

| The change is in | What to change | What proves it |
| --- | --- | --- |
| A domain package — `packages/sgi-core`, `packages/shield`, `packages/commerce-sim`, `packages/sgi-fixtures`, `packages/shared` | The source, and a unit test beside it named `<name>.test.ts`. Every test is discovered by its path, so a new one needs no registration anywhere. | `npm run test:unit -- packages/shield` — the positional argument is a **file-path** filter, so a workspace directory or a single test file both work. |
| The API — `apps/api/src/` | The route **and** the JSON schema it validates against in `packages/shared/src/schemas/`, so the contract and its enforcement change together. An integration test goes in `apps/api/test/integration/`. | `npm run test:integration`, or `npm run test:integration -- --testNamePattern=immutability` to narrow it. |
| The public UI — `apps/web/src/` | The page or component. `apps/web/src/api-client.ts` is the **only** module that may call `/api/v1`; a component that fetches directly is a change to be asked for in the pull request, not merged. Behaviour is proven in the browser, not in a DOM test: the dependency inventory holds no DOM test environment, so web unit tests cover pure functions only. | `npm run test:e2e`, plus `npm run test:a11y` for anything that renders. |
| The database schema — `packages/shared/migrations/` | A **new** migration file. An applied migration is immutable: the runner records each file's SHA-256 checksum in `schema_migrations` and refuses to start when an applied file's bytes changed. Migrations only add; none may drop or rewrite. | `npm run seed` on a fresh path, then `npm test`. |
| Documentation — `*.md`, `docs/` | The document. `docs/DEPENDENCIES.md` is the exception: it is generated by `npm run deps:report` and must never be hand-edited. | `npm run deps:report` exits 0 and leaves the file unchanged. |
| The extension seams — `packages/sgi-core/src/extensions/` | Nothing here, if you are adding an extension. New fixture packs, evaluator checks and listing categories arrive through the seams (section 9), and the scoring path is not edited. | `npm run test:unit -- examples/extension-fixture-pack`, with `git diff --stat -- packages/sgi-core/src/scoring` empty. |

**The demo header is a role selector, not authentication.** Writes are addressed with
`X-Demo-Account: <accountId>` naming one of the six seeded synthetic accounts; the server resolves it
and checks the route's role, answering `401` when the header is missing or names nothing it can
resolve and `403` when the resolved account's role does not match. Adding a route means taking the
seam the existing routes take rather than inventing a second one, and the UI keeps showing the label
`demo only, no production authentication` wherever the switcher appears. The order one write is
admitted — rate limit, schema validation, `401`, `403`, one transactional domain call, the audit
append, the response — is `docs/DATA-FLOW.md`; the tables and their owners are `docs/SCHEMA.md`.

## 3. Testing expectations

- **Name the check that proves your change, in the pull request.** A unit test for pure logic, an
  integration test for a route and its statuses, a browser test for a behaviour only a browser can
  show.
- **Nothing is committed that leaves `npm test` failing.** Run `npm run typecheck` and the suite that
  covers your change before every commit, and `npm run test:all` before a pull request that touches
  the UI or the API.
- **A new or changed route asserts every documented status**, including the error cases: the API
  contract documents each row's `400`, `401`, `403`, `404`, `409`, `422` and `429`, and a row that
  documents one has a test for it.
- **Scoring, policy and ledger tests are deterministic by construction.** Nothing in the scoring path
  may read a clock, a locale, a timezone, a random source or the network; comparisons are made on
  canonical JSON (a fixed property order, no insignificant whitespace); and a report's identifier and
  creation timestamp are generated at write time and sit outside any compared payload, so two runs
  over the same fixture produce byte-identical per-case results. A test that depends on the wall
  clock, on the machine's locale or on the order a directory happens to be read is a defect in the
  test.
- **Coverage is a review guideline, not a gate.** The target is 80% of the pure scoring, policy and
  ledger functions — the canonicalisation, comparison, scoring and report building in `sgi-core`, the
  decision and approval logic in `shield`, and the allocation, fee and reversal arithmetic in
  `commerce-sim`. No coverage package is installed, because the dependency inventory is closed, so
  what actually holds your change is the suite you run and the criteria it names.

## 4. Branch, commit and pull-request conventions

**Branches.** One logical change per branch, named `type/short-description`, where `type` is one of
`feat/`, `fix/`, `docs/`, `test/` or `chore/` — `feat/listing-category-filter`,
`docs/contributing-clarity`, `fix/ledger-rounding`. A branch that starts needing a second, unrelated
change is a second branch.

**Commits.** The subject is in the imperative mood and under 72 characters (`add the ledger view
filter`, not `added` or `adds`); the body explains *why* the change is right, not what the diff
already shows. Small commits are welcome; a commit that leaves the suite failing is not. There is no
requirement to sign commits, and no merge-commit shape beyond the hosting platform's default.

**Pull requests.** The title is in the imperative mood; the description records the change, the
checks you ran with their outcome, and — for the first pull request, and for any later change to the
documented commands — the clean-checkout walkthrough of section 8. Do not force-push a branch that is
under review: push new commits, so a reviewer can see what changed since their last read.

## 5. Governance and review

**Seven paths need a maintainer's review.** `.github/CODEOWNERS` declares ownership of
`packages/sgi-core/`, `packages/sgi-fixtures/`, `packages/shield/`, `packages/commerce-sim/`,
`docs/governance/`, `scripts/scan-exclusions.ts` and `.github/`. The file carries one generic
placeholder token, `MAINTAINER-PLACEHOLDER`, with a comment stating that the project owner must
replace it before the repository is published. Until that replacement is made the paths have no
effective owner and no review is requested automatically, so a pull request touching one of them says
so in its description and asks for a maintainer's review; it is not merged by the person who opened
it.

**Standards and scoring change by version, never by edit.** A change to a case set, a severity, a
pass threshold or the pass rule is a governance change: a proposal through the process in
`docs/governance/SGI-PROPOSALS.md`, discussed and triaged through
`.github/ISSUE_TEMPLATE/standards-proposal.md`, reviewed by an operator, and published as a **new**
standard version. The published version is never edited, `SGI-SO-1.0.0` is never amended in place,
and a change of that kind reaches the product only that way. Human review is mandatory: automated
standards governance is explicitly deferred.

**Nine tables are append-only** — `standard_versions`, `evaluation_reports`, `report_case_results`,
`governance_events`, `ledger_entries`, `transactions`, `refunds`, `audit_events` and
`listing_versions`. A route may insert a row and may never update or delete one, so a contribution
that adds such a route is refused however well written it is. A refund appends a reversal entry; a
retest appends a new report linked to its predecessor; an appeal ruling appends a governance event
and leaves the report it concerns untouched. The guard-rail triggers behind this rule raise `ABORT`
on an update or a delete, and they are defence in depth rather than a security boundary: the rule is
that no route offers the mutation, and a route that does would be the finding.

**Commercial and sponsored data never reach a measurement.** No import path exists from
`packages/sgi-core` to `packages/commerce-sim` or to sponsorship data, and a contribution must not
create one: fees, sponsorship and commercial values may not reach a score, a report, a badge or the
organic ordering of a listing. Sponsored items are returned in their own labelled collection and
rendered with the literal label `Sponsored`, never interleaved with organic results.

**A change to a documented interface is a decision to raise, not a choice to take.** A decision
shape, a status code, the pass rule, the label vocabulary and the membership of the append-only set
are fixed by the contract the repository documents — the API contract, the standard's own document
and `docs/SCHEMA.md`. If a change seems to need a different one, raise it in an issue or in the pull
request description rather than folding it into a feature change, so the decision is discussed once
instead of reconstructed from a diff.

## 6. Dependency rules

The dependency inventory is **closed**. Every package the manifests declare has an entry giving its
exact registry version, its licence and its purpose, and no workspace installs a package that has no
entry. Adding one is a change of five parts:

1. **The inventory entry**, with the exact version, the licence and the purpose.
2. **The exact version string in the manifest** — no caret, no tilde, no range. A version line
   identifies which line was chosen; the manifest states the patch that installs.
3. **A licence inside the allowlist**, which is data in `scripts/license-allowlist.json`: the
   always-allowed set is `0BSD`, `Apache-2.0`, `BlueOak-1.0.0`, `BSD-2-Clause`, `BSD-3-Clause`,
   `ISC` and `MIT`. A licence listed as a development-only exception — `MPL-2.0` among them — passes
   in the development graph only and must never appear in a runtime graph, because a licence
   permitted for development must not be distributed. Read the data file rather than this list: it is
   the list the gate applies, and widening it is a reviewable diff.
4. **A purpose record** in `scripts/deps-report.ts`, so the generated report answers for the package
   the way the inventory entry does. A package the record does not hold is not an error — the report
   renders `purpose: not recorded`, which is exactly the line a reviewer will ask about.
5. **A regenerated report.** Run `npm run deps:report`: it rewrites `docs/DEPENDENCIES.md` from the
   dependency graph `package-lock.json` resolves, lists every direct and transitive dependency with
   its version and licence, and exits non-zero on a licence outside the allowlist. Commit the
   regenerated document with the manifest change — the document is committed output, not a
   hand-maintained list.

Install at the repository root, never inside a workspace, and never hand-edit `package-lock.json`:
the one root lockfile is what `npm ci` installs and what the dependency report is read from.

The root manifest also carries an `allowScripts` block, approving the two packages whose install
scripts a working checkout needs — `better-sqlite3`, which fetches its prebuilt binding, and
`esbuild`, which fetches its platform binary. What that block enforces depends on the npm in use,
and on the documented toolchain it is a record of what the build needs rather than a boundary around
what may run: the npm bundled with the documented Node 20.20.2 release is 10.8.2, which does not
implement the field at all, so on that toolchain every dependency's install script runs. npm 11.16
and later read the block and warn about a dependency it does not cover, while on the npm 11 line
that dependency's script still runs; npm 12 blocks an uncovered install script by default, and
`--strict-allow-scripts` makes such an install fail. Read the install script a dependency declares
before adding it, extend the block only when the build genuinely needs that script, and say why in
the pull request.

**Three classes of package may not be added at all**, whatever their licence: a payment provider's
library, an analytics or tracking SDK, and an advertising SDK. The exclusion scan fails the build on
any of them. A payment provider's name may not appear anywhere either — in source, configuration,
tests, documentation or an example — and the blocklist that enforces this holds hashes rather than
names.

## 7. Privacy, personal data and secrets

**This is a duty of the contributor, not a result a tool returns.** Nothing in this repository may
carry real personal information, contact details, financial information, credentials, tokens or
secrets — in code, tests, fixtures, seed data, documentation, comments, examples or commit messages.
Every identity, listing, developer, buyer, contributor and operator in the seed data, the fixtures
and the examples is a fictional handle or organisation, and personal data of any kind is not
accepted. Where a document needs a person to be named, it names a role, a placeholder or a handle
instead.

**What the automated scan does.** `npm run scan:exclusions` reads the working tree, the dependency
manifests and lockfiles, and the local `git log -p` history, and reports every finding with its file
and line without deleting anything. It detects exactly four classes: mail addresses; telephone-number
patterns; credential material (a PEM-style private-key header, and a credential keyword assigned to a
value that clears a placeholder denylist, a length floor and an entropy gate); and prohibited
payment, analytics and advertising dependency names, matched against a blocklist held as hashes. The
command exits `0` on no finding, `1` on a finding and `2` when it could not reach a verdict at all,
so a broken scanner is never mistaken for a clean tree.
Two suppressions are stated in this command's own output and in `docs/REVIEW-CHECKLIST.md` §2: no
mail-address finding is reported inside the deprecation notice npm copies verbatim from the registry,
because that notice is upstream metadata the repository passes on rather than its own content, and
none is reported on a git commit's `Author:` or `Committer:` line, because each commit carries the
committing tool's identity rather than a person's address. An address written anywhere else, a
lockfile's own lines included, is reported.

**What it does not do, and may never be described as doing.** It does not detect personal names. It
does not detect the contextual disclosure of private or nonpublic information. It does not detect
references to private projects, products or datasets. It matches patterns rather than meaning, so a
clean run is **not** evidence that the repository holds no private information, and the scan must
never be described as guaranteeing that absence — in a pull request, a document, a UI string or a
comment. It is supplementary to the manual review below and never a substitute for it.

**The manual review covers what the scan cannot.** `docs/REVIEW-CHECKLIST.md` walks a contributor and
a maintainer through the three categories the scan is blind to — personal names, contextual
disclosure, and references to private projects, products or datasets — across UI text, seed data,
fixtures, documentation, comments and examples. It carries one sign-off line per category, and a pull
request that adds or changes any of those surfaces completes it as part of the checklist in
section 8.

**If a credential is ever committed, removing it in a later commit is not enough.** Anything pushed
is in the history the repository keeps, so a live credential is replaced or revoked first and the
history treated as exposed. Then say what happened in the pull request, so the exposure is recorded
rather than quietly rewritten.

**Vulnerabilities.** Report a vulnerability the way `SECURITY.md` states, through the hosting
platform's private vulnerability reporting channel. Never open a public issue for a vulnerability,
and never include a live credential, a piece of personal data or an exploit against a system you do
not own in any issue, discussion or pull request.

## 8. The pull-request checklist

Copy this into the pull request description and tick each line. A line that does not apply is struck
through with a word about why, not deleted.

```markdown
- [ ] One logical change, on a branch named `type/short-description`.
- [ ] `npm run typecheck` and `npm run build` exit 0.
- [ ] `npm test` exits 0 (unit, integration, and the exclusion scan's self-test).
- [ ] The suite that covers this change passes, and the pull request names it.
- [ ] UI or API change: `npm run test:e2e` passes. UI change: `npm run test:a11y` passes.
- [ ] A new or changed route has its JSON schema in `packages/shared/src/schemas/` and a test for
      every status the contract documents for it, error cases included.
- [ ] `npm run scan:exclusions` exits 0 with an empty finding list; its output is pasted below.
- [ ] `npm run deps:report` exits 0 and `docs/DEPENDENCIES.md` is regenerated and committed, or is
      unchanged because no manifest changed.
- [ ] `docs/REVIEW-CHECKLIST.md` is complete, with its per-category sign-off lines, for any change
      that adds or edits UI text, seed data, fixtures, documentation, comments or examples.
- [ ] No real personal information, contact detail, financial information, credential, token or
      secret is introduced, and no personal name appears.
- [ ] Any new dependency has an inventory entry, its purpose record in `scripts/deps-report.ts`, an
      exact version, and an allowed licence; the lockfile is committed and was not hand-edited, apart
      from the one removal of upstream registry metadata that carries a third party's contact detail.
- [ ] Append-only holds: no route updates or deletes one of the nine append-only tables.
- [ ] Trust separation holds: nothing carries fee, sponsorship or commercial data into scoring, a
      report, a badge or organic ordering.
- [ ] Determinism holds: the scoring path reads no clock, locale, timezone, random source or network,
      and comparisons are made on canonical JSON.
- [ ] Accessibility holds for a UI change: semantic landmarks and labels, keyboard operation with a
      visible focus ring, status changes announced, and no horizontal scroll at 360 px.
- [ ] The label vocabulary is intact: `SAMPLE` or `VERIFIED-IN-DEMO` on a report, `Sponsored` on a
      sponsored item, `DEMO` for a simulated amount, `demo only, no production authentication` for a
      demo session, `No SGI report yet` for a listing with no evaluation, `to be determined` for the
      founder-allocation contract structure.
- [ ] Documentation this change affects is updated: `README.md`, `docs/SCHEMA.md`,
      `docs/DATA-FLOW.md`, `docs/ARCHITECTURE.md`, `docs/STANDARD-SGI-SO-1.0.0.md`, `docs/ROADMAP.md`
      or the relevant `docs/governance/` document.
- [ ] A change to a protected path asks for a maintainer's review in the description.
- [ ] First pull request, or a change to the documented commands: the clean-checkout walkthrough is
      recorded below.
```

**Three artefacts, not three sentences.** Every pull request carries the outputs, not a description of
them:

1. **The exclusion scan's output** on your branch — the command's own report. An empty finding list
   and exit `0` is the passing case; the self-test in `npm test` proves the command fails when it
   should.
2. **The regenerated `docs/DEPENDENCIES.md`** from `npm run deps:report`, committed, or the statement
   that it is unchanged because no manifest changed.
3. **The completed `docs/REVIEW-CHECKLIST.md`**, with its per-category sign-off lines, for a change
   that touches the surfaces section 7 lists.

**The clean-checkout walkthrough.** On a clean checkout, with Node 20 first on the path and no
environment variable set, run `npm install`, `npm run build`, `npm test` and `npm start`, and paste
the result into the description. This is what proves the documented path still works for the next
contributor, and it is what the first pull request carries.

## 9. Where to start

**The starter tasks.** `docs/starter-tasks/` holds twelve labeled briefs, each with a title, a scope
and an acceptance note, sized for a first contribution and mapped to the extension seams and the
documentation rather than to the core: add a fixture pack through the `FixturePack` seam; add an
evaluator check through the `EvaluatorCheck` seam; add a listing category through the
`ListingCategory` seam; add a case set as a new standard version; add a standard proposal document;
add a Shield policy example with its tests; add a Shield adapter for a new call shape; add an
accessibility test for a wider viewport set; add a seed listing in a new category; improve the
starter-task template; add an operator ledger view filter; add a section to `docs/DATA-FLOW.md`.
Agreeing on "done" is what the acceptance note is for.

**The seams, and the example that proves them.** A community addition is a typed interface plus a
registration, and both sit on `sgi-core`'s single public entry: `FixturePack`, `EvaluatorCheck` and
`ListingCategory`, with the registry that resolves them, are exported from
`packages/sgi-core/src/index.ts` alongside `scoreSubmission`. Adding a fixture pack or a check must
therefore **not** require editing the scoring path, and
`examples/extension-fixture-pack/` is the in-repository proof — one pack, its case set, its own
tests, and a `git diff --stat -- packages/sgi-core/src/scoring` that is empty for the change that
adds it. Import a workspace by its package name, never by a path inside it: each workspace exposes
exactly one entry point, and a name you need and cannot find there is a missing re-export rather than
a reason to reach deeper.

**You keep your rights.** The project is MIT-licensed, and contributing does not force you to
disclose your own source code. What a contributed extension does declare is its own licence and its
attribution: `examples/extension-fixture-pack/LICENSE` and `ATTRIBUTION.md` are the worked example of
those two files. Add them to any new extension package.

**The milestones.** `docs/ROADMAP.md` orders the work by dependency rather than by date — M1 the
foundation builds, M2 exchange discovery, M3 the Standard Gate Index and the deterministic evaluator,
M4 collaboration and ADEM Shield Basic, M5 participation and the commerce simulation, M6 release
readiness — and names the command that proves each one done. A contribution fits one of those exit
conditions; if it seems to need a new one, say so in an issue before writing the code.

## 10. What will be rejected

A contribution is refused whatever its quality when it does any of the following. These are the hard
boundaries of the foundation, and it is better to read them here than to have them found in review:

- **Names a payment provider, or builds a real money path.** The commerce surfaces are
  provider-neutral simulations. No provider's name appears anywhere, no real money moves, and every
  simulated amount is an integer count of minor units of the synthetic currency `DEMO` — no real
  currency code and no currency symbol, anywhere.
- **Makes a simulated surface read as real.** A simulated amount without its disclosure label, a
  sponsor slot without the literal label `Sponsored`, a demo session without the label
  `demo only, no production authentication`.
- **Claims certification, safety or a guaranteed pass.** The badge vocabulary is closed to `SAMPLE`
  and `VERIFIED-IN-DEMO`, a badge names the standard version, the scope "structured output on fixture
  set only" and the report ID, a `FAIL` report carries no badge, and nothing describes the standard,
  a report or ADEM Shield Basic as independent certification, a security guarantee or a gate pass.
  Buying an evaluation never guarantees a pass: outcomes depend on test evidence only.
- **Intends to execute submitted third-party agent code.** A candidate is a declarative submission
  compared as data on fixtures, and no `eval`, dynamic import of submitted content or sandbox exists
  anywhere in the tree.
- **Adds production authentication, real accounts or a credential store.** The demo accounts are
  synthetic and the header is a role selector, not an identity.
- **Adds a route that updates or deletes an append-only row**, or that lets a fee, a sponsorship or
  any commercial value reach a score, a report, a badge or organic ordering.
- **Turns a standards change into an edit.** Case sets, severities, thresholds and the pass rule
  change by publishing a new standard version through a reviewed proposal.
- **Adds a package outside the closed inventory**, or one whose licence falls outside the allowlist
  in the graph it lands in.
- **Adds paid live advertising, personalised ad profiling or an analytics or tracking SDK**, or any
  real ad or tracking script.
- **Publishes a personal name, a contact address or real personal data**, or describes the exclusion
  scan as proving that the repository holds none.
- **Adds deployment automation or an announcement.** Deployment, announcements and outreach require
  separate approval and are not part of this repository.

## 11. Getting help, and where to ask

Open an issue for a question, a bug, a proposal or a starter task you would like to take; use the
pull-request discussion for a change already under review. Both are public and both are read by the
maintainers, which is why this repository publishes no contact address: no mail address, telephone
number or personal name appears in this file, in the code of conduct or in the security policy, and
there is nothing to write to outside the tracker. A security report does not go in the tracker at all
— `SECURITY.md` states the private channel for it.

## 12. Where to go next

- `README.md` — what works, what does not, and the command table.
- `docs/ARCHITECTURE.md` and `docs/DATA-FLOW.md` — the workspaces, their boundaries, and how one
  request, one evaluation and one simulated purchase write.
- `docs/SCHEMA.md` — the tables, their owners, and the mutable-versus-append-only split.
- `docs/STANDARD-SGI-SO-1.0.0.md` — the rubric, the pass rule, the evidence and how that standard
  changes.
- `docs/governance/SGI-PROPOSALS.md` — the proposal process, the review, and the protected paths.
- `docs/THREAT-MODEL.md` and `docs/shield/` — the trust boundaries, the mitigations, and what ADEM
  Shield Basic does and does not cover.
- `docs/starter-tasks/`, `docs/ROADMAP.md`, `examples/extension-fixture-pack/` — where to start, what
  comes next, and a contribution worked end to end.
- `SECURITY.md` and `CODE_OF_CONDUCT.md` — reporting a vulnerability, and the conduct expected here.

