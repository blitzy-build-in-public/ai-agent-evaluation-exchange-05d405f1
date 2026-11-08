# ADEM — Agent Development Exchange and Marketplace

ADEM (the Agent Development Exchange and Marketplace) is a new, independent, public, MIT-licensed
open-source foundation for an AI agent exchange, delivered as a working first version that runs
locally. One process serves a web UI and a JSON API on one port, against one SQLite file, with no
account, no external service, no environment variable and no secret: `npm install`, `npm run build`,
`npm test`, `npm start`, or `docker compose up`, and the exchange is running on
`http://localhost:3000`.

The point of the product is the loop between the two sides of an exchange. A developer publishes an
agent and a version of it; the **Standard Gate Index (SGI)** turns a declarative candidate submission
into a reproducible PASS/FAIL report by comparing recorded outputs against a fixed fixture set rather
than by running anything; a buyer compares each listing's claims against that measured evidence, reads
its stated limitations, licence and pricing model, posts an inquiry or a challenge, and completes a
simulated checkout. Every number a buyer sees on the evaluation side comes from data, not from a
running agent, and every commercial surface is a labelled, nonfunctional simulation.

## Contents

- [What works today](#what-works-today)
- [What does not work here, and what is simulated](#what-does-not-work-here-and-what-is-simulated)
- [Quick start without Docker](#quick-start-without-docker)
- [Quick start with Docker](#quick-start-with-docker)
- [Command reference](#command-reference)
- [Optional configuration](#optional-configuration)
- [Demo accounts and the demo label](#demo-accounts-and-the-demo-label)
- [The Standard Gate Index and badges](#the-standard-gate-index-and-badges)
- [ADEM Shield Basic](#adem-shield-basic)
- [Commerce is a labelled simulation](#commerce-is-a-labelled-simulation)
- [Architecture and data flow](#architecture-and-data-flow)
- [Contributing and project documents](#contributing-and-project-documents)
- [Privacy and the manual review](#privacy-and-the-manual-review)
- [Licence](#licence)

## What works today

End to end, on synthetic seed data, with no manual setup:

1. A **developer** publishes a listing and a version of it, runs an SGI evaluation against the
   published standard, and receives a report with per-case evidence, a PASS/FAIL outcome, one label
   and — on a PASS — a sample badge.
2. A **buyer** searches and filters the catalogue, opens a listing to compare its claims with its
   measured evidence, compares two to four listings side by side, posts an inquiry or a challenge, and
   runs a simulated checkout on an offer the listing makes.
3. A **community contributor** submits a standards proposal and takes part in the discussion threads,
   and can add a fixture pack, an evaluator check or a listing category through the extension seams
   without editing the scoring code.
4. An **operator** moderates a listing, reviews a standards proposal, rules on an appeal, and reads the
   append-only audit feed and the three ledgers — and can never alter a measurement.

Anyone may browse, read the documentation on this page and under `docs/`, read any evaluation report,
work through the **Gate Readiness Academy** and answer its self-assessment — the result is computed
locally and nothing is persisted — read the illustrative **opportunity index**, which states on every
render that it is illustrative, and take ADEM Shield Basic without an account, because reads are public.
The seed data is at least twelve listings across four categories, six demo accounts, three evaluated
candidate fixtures, sponsored slots, threads, challenges and the one published standard version.

## What does not work here, and what is simulated

This list is the product's own boundary rather than a disclaimer bolted onto it. `docs/THREAT-MODEL.md`
states the full set of non-goals, and `docs/ROADMAP.md` states which capabilities are deferred.

- **No money moves, and no payment provider is named anywhere.** Commerce is a labelled, nonfunctional
  simulation: rent, purchase, licence and subscription offers are selectable, a checkout writes a
  transaction marked `simulated: true`, and every amount is an integer count of minor units of the
  synthetic currency `DEMO` with no real currency code and no currency symbol. There is no payment
  provider integration, no payout, no settlement and no bank connection, and none is planned.
- **No production authentication, and no real personal data.** The `X-Demo-Account` write header names
  one of six synthetic seed accounts and is a role selector, never authentication. Every identity in
  the seed data, the fixtures and the examples is a fictional handle or organisation. There is no
  credential store, no password, no session secret and no `.env` file, and no personal information of
  any kind is accepted into the repository.
- **Nothing submitted is ever executed.** A candidate is declarative data — a candidate version
  identifier plus one recorded output per fixture case — compared as canonical JSON. There is no
  `eval`, no dynamic import of submitted content and no sandbox anywhere in the tree, and executing
  third-party agent code is deferred until isolation has been reviewed separately.
- **No certification and no guarantee of a pass.** A report carries exactly one label, `SAMPLE` or
  `VERIFIED-IN-DEMO`; nothing here claims general safety, security or independent verification, and a
  badge states only the standard version, its scope and the report identifier. Buying an evaluation
  never guarantees a pass, and outcomes depend on test evidence only. ADEM Shield Basic is not a gate
  pass and not a security guarantee.
- **No deployment, no public announcement and no enterprise posture.** There is no deployment
  workflow, no release announcement, no monitoring or log-shipping backend, no tracing exporter, no
  external connector and no enterprise compliance claim. Deployment and publishing require separate
  approval.
- **No paid advertising and no tracking.** Sponsored slots are a limited local demonstration, stored
  apart from every SGI table, rendered in their own block with the literal label `Sponsored` and never
  interleaved with organic results. There is no personalized tracking, no advertising SDK and no
  analytics beyond local aggregate counters.

## Quick start without Docker

Node.js 20 LTS is required — the root `package.json` fixes `engines` to `>=20.0.0 <21` — together with
npm and git. Nothing else: no account, no API key, no database service, no registry credential and no
environment file.

```bash
npm install     # every workspace, from the committed lockfile
npm run build   # type-check the workspaces and bundle the web application
npm test        # unit tests, integration tests and the exclusion scan's self-test
npm run seed    # write the demo data into the database (once, on a fresh file)
npm start       # serve the API and the built UI on http://localhost:3000
```

Open `http://localhost:3000`. For a clean, exactly-pinned install — the path CI and the container use —
run `CI=true npm ci` instead of `npm install`; it installs what `package-lock.json` holds and never
rewrites it.

Three details save a first run:

- **No environment variable and no secret is required.** The process reads exactly two optional inputs,
  both with working defaults ([Optional configuration](#optional-configuration)). Do not create a
  `.env` file: nothing reads one.
- **The seed runs once, against a fresh database.** `npm run seed` writes the demo rows into the file
  named by `ADEM_DB_PATH` — `<repository root>/.adem/adem.sqlite` by default — and it refuses a database
  that already holds rows rather than emptying it, so a second run over a seeded file fails loudly and
  changes nothing. Delete `.adem/adem.sqlite` or point `ADEM_DB_PATH` at a new path to seed again.
  `npm start` applies the migrations but never seeds, so a fresh checkout shows the exchange only after
  the seed has run.
- **The command sequence above is the documented path** for a first run: `npm install`, `npm run build`,
  `npm test`, `npm start`. All four are rows of the [command reference](#command-reference), which
  documents every script the root `package.json` declares plus the two commands that are not scripts.

## Quick start with Docker

```bash
docker compose up -d            # builds node:20-bookworm-slim, one service named `app`
docker compose exec app npm run seed   # once: load the demo data
```

Open `http://localhost:3000`. One service, named `app`, serves both halves of the product on port
3000: the Fastify API under `/api/v1` and the built React UI, which the API itself serves. The SQLite
file lives on the named volume `adem-data`, mounted at `/app/.adem`, so the data outlives a restart;
only `docker compose down -v` discards it.

The container deliberately **does not seed at start-up**. `npm run seed` writes rows with fixed
identifiers, so a second start against the persisted volume would fail; seeding is the documented
one-time command above, which is also why a restart on the same volume is safe. The image carries its
own readiness check, which probes the API's listing route, so `docker compose ps` reports the service
as healthy once the schema has been migrated and the store answers.

If several checkouts run on one machine, give the Compose project your own name so containers and
volumes cannot collide: `COMPOSE_PROJECT_NAME=adem-local docker compose up -d`.

## Command reference

Every script the root `package.json` declares, plus the two commands a contributor needs that are not
scripts. This table is the whole interface: if a command is not here, it is not part of the project.

| Command | What it does | When to run it |
| --- | --- | --- |
| `npm install` | Installs every workspace from the committed lockfile. | Once, after cloning. `CI=true npm ci` for a clean, exactly-pinned install. |
| `npm run build` | `tsc --build` over the workspace project references, then the Vite bundle into `apps/web/dist`. | Before `npm start` or the browser suites, and before a change you intend to test through the UI. |
| `npm run typecheck` | The static gate: `tsc --build`, nothing else. There is no linter or formatter in this repository — the dependency inventory is closed and names none — so this stands in their place. | Per change, before committing. |
| `npm start` | Serves the API and the built web application from one process, on `http://localhost:3000` by default. | To run the product. Applies the migrations at start-up; never seeds. |
| `npm run seed` | Applies the migrations and writes the demo rows into the database named by `ADEM_DB_PATH`. | Once, against a fresh database, before the first look at the exchange. |
| `npm run dev` | The web development server with hot reload; it proxies `/api` to the API at its default port. `npm run dev -w @adem/web` runs the same script from the workspace directly. | While working on the UI, with `npm start` (or `npm run seed`) in another shell for the API. |
| `npm test` | `test:unit`, then `test:integration`, then `test:scan`, in that order. Exits 0 only when all three pass. | Before every commit. This is the whole-package gate. |
| `npm run test:unit` | Every `<name>.test.ts` beside its source under `apps/`, `packages/`, `examples/` and `scripts/`, in-process: no HTTP server and no database file. The exclusion scan's own self-test is not one of them — it has its own entry point, `npm run test:scan`, so no test file is run twice. `npm run test:unit -- <path>` narrows it to a workspace directory or one file. | While changing a pure function, a scoring rule, a policy or a ledger. |
| `npm run test:integration` | The suites in `apps/api/test/integration/`, which start the real server on an ephemeral port against an in-memory database with the migrations applied and the seed loaded. `-- --testNamePattern=<name>` narrows it. | While changing a route, a status code or the migration runner. |
| `npm run test:scan` | The exclusion scan's planted-violation self-test, also run by `npm test`. | While changing the scan itself. |
| `npm run test:e2e` | The browser suites that drive the developer-to-buyer loop and walk every public page, against the application the configuration starts itself. | Before a pull request that touches the UI or the API. Requires `npm run build` and the browser below. |
| `npm run test:a11y` | Accessibility and responsiveness checks on the homepage, a listing page, a compare page and a report page at 1280 px and 360 px, with the no-horizontal-scroll assertion at 360 px. | Before a pull request that renders anything. |
| `npm run test:all` | `npm test`, then `npm run test:e2e`, then `npm run test:a11y`. | Before a pull request that touches the UI or the API. |
| `npm run scan:exclusions` | The four-class exclusion scan over the working tree, the manifests, the lockfiles and the local git history. Exits `0` on no finding, `1` on a finding, `2` when it could not reach a verdict. Reports each finding with its file and line and deletes nothing. | Before a pull request, and whenever content is added. |
| `npm run deps:report` | Regenerates `docs/DEPENDENCIES.md` from the installed tree and checks every licence against the allowlist, exiting non-zero on a licence outside it. | After any manifest change; commit the regenerated document with it. |
| `npx playwright install chromium` | Downloads the one browser the browser suites use. This is the single network step in the project's life; no Playwright browser is in the dependency set itself. | Once per machine, before `npm run test:e2e` or `npm run test:a11y`. |

The browser suites start the built application themselves, on a port derived from `CLONE_INDEX` (the
default, `0`, is `4100`) and against a fresh, run-unique database file handed to the process through
`ADEM_DB_PATH`, so a suite never touches your own database and never collides with a server you left
running on `3000`. Set `CLONE_INDEX=<n>` only when another checkout on the same machine is running its
own suites. They need the build to exist, so run `npm run build` first.

Script names that npm also recognises as shorthands can be written either way: `npm start` and
`npm run start` are the same command, as are `npm test` and `npm run test`, and every other row takes
the explicit `npm run <script>` form.

## Optional configuration

Both of these are optional and both have working defaults. They are the only two inputs the process
takes from outside itself, they are defined in `apps/api/src/config.ts`, and nothing has to be set to
install, build, test, seed or start the product.

| Variable | Default | What it changes |
| --- | --- | --- |
| `ADEM_PORT` | `3000` | The port the API and the UI are served on. Set it only when `3000` is taken; the web development server proxies `/api` to `3000`, so a different port also means pointing the proxy at it. |
| `ADEM_DB_PATH` | `<repository root>/.adem/adem.sqlite` | The SQLite file the process opens. A relative value is resolved against the repository root, the same base the default has, so one value names one file whichever documented command opens it. Point it at a throwaway path, for example under `/tmp`, for a disposable run. |

There is no other environment variable, no configuration file, no `.env` file and no secret anywhere in
this project. Nothing at runtime calls an external network service.

## Demo accounts and the demo label

The six accounts a write may name are **synthetic seed rows**, and the UI shows the label
`demo only, no production authentication` wherever the account switcher appears:

| Handle | Role | What the role may write |
| --- | --- | --- |
| `demo-developer` | developer | Listings, listing versions, evaluations of its own versions, appeals, challenge responses. |
| `demo-developer-two` | developer | The same, as a second independent developer. |
| `demo-buyer` | buyer | Inquiries, challenges, challenge responses, simulated checkouts. |
| `demo-buyer-two` | buyer | The same, as a second buyer. |
| `demo-contributor` | contributor | Standards proposals, threads and posts. |
| `demo-operator` | operator | Proposal reviews, appeal rulings, moderation actions, refunds, and the four operator reads. |

Any resolvable demo account may start a thread and post to one: `POST /threads` and
`POST /threads/{id}/posts` document no role and no `403`, so all six accounts may write there.

A write carries the header `X-Demo-Account: <accountId>`, whose value is one of the seeded accounts'
identifiers or handles, matched exactly. The header is a **synthetic role selector and never
authentication**: it separates roles for this demonstration and asserts nothing about who the caller
is. An absent, blank or unresolvable value is `401`; a resolvable account whose role the route does not
accept is `403`. Every failure answers the one envelope `{ "error": { "code": "...", "message": "..." } }`.
Writes are rate-limited to 60 requests per minute per client and answered `429` with a `Retry-After`
header beyond that; reads carry no limit. The order in which a write is admitted — rate limit, schema
validation, `401`, `403`, one transactional domain call, the audit append, the response — is
`docs/DATA-FLOW.md`.

## The Standard Gate Index and badges

The Standard Gate Index publishes **one provisional standard in this release**:

| Field | Value |
| --- | --- |
| Code | `SGI-SO-1.0.0` |
| Title | Structured Output Conformance |
| Fixture set | 20 cases, each with an identifier, an input, an expected output and a severity (`critical` or `standard`); **5 of the 20 are critical** |
| Pass rule | at least 18 of 20 cases match **and** no `critical` case fails — anything else is FAIL |
| Label a report carries | exactly one of `SAMPLE` or `VERIFIED-IN-DEMO` |
| Scope a badge states | `structured output on fixture set only` |

A candidate is a **declarative submission**: the candidate version identifier, the standard version
identifier, and one recorded output per fixture case. Nothing is executed. Each recorded output is
compared against its case's expected output as canonical JSON, and the totals, the critical failures and
the outcome are derived from the thresholds stored with the standard version rather than from constants
in the build — so scoring the same submission twice yields byte-identical per-case results and the same
outcome. A submission that lacks a recorded output for a fixture case is rejected with `422` before any
report is written. The three seeded candidate fixtures produce one PASS, one FAIL on a critical case and
one FAIL on the 18-case threshold.

Every report carries the report identifier, the candidate version identifier, the standard version
identifier, the per-case results (`case_id`, `expected`, `actual`, `match`), the totals, the outcome, the
rubric reference `SGI-SO-1.0.0#rubric` and its one label. Reports are **append-only**: no route updates
or deletes one, and a retest appends a new report linked to its predecessor through `prior_report_id`
while the predecessor is untouched. An appeal is opened against a report with a stated reason and ruled
`upheld` or `denied` by appending a governance event — the report is never edited, and the ruling is
read from the event log rather than from a mutated row. The thresholds above are **provisional and
versioned with the standard**: they change only by publishing a new standard version through the review
process, never by editing a file or a row.

A badge names the standard version, the scope `structured output on fixture set only` and the report
identifier, and states nothing else. It is labelled `SAMPLE` or `VERIFIED-IN-DEMO` and **is not a
certification** and implies nothing about safety, security or general capability. A FAIL report carries
no badge at all; it renders the per-case evidence with a plain-language summary instead. A listing that
has never been evaluated shows `No SGI report yet` rather than a blank or a zero, and a hidden listing
leaves search and compare while remaining visible to the operator with its history. **Buying an
evaluation never guarantees a pass, and outcomes depend on test evidence only.**

- The rubric, the case list, the evidence semantics and the seeded outcomes:
  [`docs/STANDARD-SGI-SO-1.0.0.md`](docs/STANDARD-SGI-SO-1.0.0.md)
- How a change to a standard is proposed, reviewed and published:
  [`docs/governance/SGI-PROPOSALS.md`](docs/governance/SGI-PROPOSALS.md)

## ADEM Shield Basic

ADEM Shield Basic is a small, **free, standalone policy decision engine** with no signup of any kind:
no registration, no licence key, no account and no telemetry. It is the workspace `packages/shield`,
reachable only through its single public entry `packages/shield/src/index.ts`, and it is structurally
independent — it declares no dependency on any other workspace in this repository and no runtime
dependency at all. It is not wired into the product: `apps/api` does not import it and no ADEM route is
protected by it. Adoption means consuming it from a checkout of this repository, or vendoring the
workspace under this repository's MIT licence; it is not published to a registry.

The decision contract is one call, one policy and one record. `evaluate(call, policy, context)` returns

```ts
{ decision: "allow" | "deny" | "needs_approval", reason: string, ruleId: string | null }
```

and the behaviour behind it is fixed:

- **Default deny.** A call that matches no allow rule is denied, and an undecidable input is a refusal,
  never permission.
- **Never throws.** A call missing its tool name or arguments, or a policy that fails schema validation,
  returns `deny` with reason `malformed` rather than raising.
- **`needs_approval` blocks.** Such a call is held until a recorded approval event exists for that call
  identifier, and only then may it proceed.
- **Every decision is audited.** Each decision appends an audit event carrying the timestamp, the call
  identifier, the decision, the rule identifier and the policy version, and the log can be sunk to a
  file as newline-delimited records.

ADEM Shield Basic **is not a gate pass and is not a security guarantee**, and it is never presented as
one. It ships with its own supported threat model and an explicit exclusions list:

- [`docs/shield/README.md`](docs/shield/README.md) — what the package is and how to adopt it
- [`docs/shield/THREAT-MODEL.md`](docs/shield/THREAT-MODEL.md) — the model it does support
- [`docs/shield/EXCLUSIONS.md`](docs/shield/EXCLUSIONS.md) — what it deliberately does not cover
- [`docs/shield/POLICY-FORMAT.md`](docs/shield/POLICY-FORMAT.md) — the policy document format

## Commerce is a labelled simulation

Every commercial surface in this repository is a simulation that must **read** as a simulation. There is
no money movement, no payment provider and no real currency anywhere:

- **Offers.** A listing may offer rent, purchase, licence or subscription. Selecting an offer model the
  listing does not offer is rejected with `422`.
- **Amounts.** Every amount is an **integer count of minor units of the synthetic currency `DEMO`** —
  no real currency code and no currency symbol appears in the UI, the ledger, the configuration or the
  code — and every simulated amount is rendered with a disclosure label.
- **The gate-evaluation fee.** A configurable, fictional *flat* fee, by default **150.00 `DEMO`**,
  charged per completed evaluation whether the outcome is PASS or FAIL, and recorded in the gate-fee
  ledger only. It is never eligible for a founder allocation.
- **The founder-participation allocation.** A provisional, configurable rate, by default **25 basis
  points (0.25%)** of the net amount of an eligible completed simulated marketplace transaction, rounded
  half up to a whole minor unit — never of a gate fee and never of a sponsored-slot record. Its contract
  structure is labelled `to be determined`, and the ledger carries no personal identity, no beneficiary
  account and no entitlement.
- **Refunds.** A refund **appends** a proportional reversal entry. Nothing is edited and nothing is
  deleted: a transaction's net position is derived from its reversal entries, which is how an
  already-fully-refunded transaction answers `409` and an amount larger than the net remaining answers
  `422`.
- **Three ledgers.** Marketplace entries, gate-fee entries and founder-allocation entries are written
  append-only and read by the three operator ledger routes.

## Architecture and data flow

One TypeScript monorepo on Node.js 20, ESM throughout, with one HTTP surface, one store and one
composition root. `apps/web` (React 18 with Vite) is presentation only and calls `apps/api` — and only
`apps/api`, through the single module `apps/web/src/api-client.ts`. `apps/api` (Fastify 4, routes under
`/api/v1`) is the only workspace that opens the database: it sets the connection pragmas, applies the
ordered migrations in `packages/shared/migrations/` at start-up, validates every write against a JSON
schema, resolves the demo account and its role, and serves the built UI. Storage is one SQLite file
through `better-sqlite3`; there is no external service to run and nothing to configure.

The domain packages are reachable only through their own single `index.ts` entry:

| Workspace | What it owns | Dependencies it may take |
| --- | --- | --- |
| `packages/shared` | Types, constants, the JSON schemas more than one workspace uses, and the ordered migrations | None at runtime |
| `packages/sgi-core` | Standards, scoring, reports, proposals, appeals, governance events and the typed extension seams | `shared`, `sgi-fixtures`, `better-sqlite3`; **no import path to `commerce-sim` or to sponsored data** |
| `packages/sgi-fixtures` | The read-only fixture pack and its typed loader | None at runtime |
| `packages/shield` | The policy engine, the approval checkpoint, the audit log and the reference adapter | **No dependency on any other workspace, and no runtime dependency at all** |
| `packages/commerce-sim` | Offers, simulated checkout, the three ledgers, refunds and the fictional configuration | `shared`, `better-sqlite3`; never `sgi-core` |

The trust separation is structural rather than a promise: because no import edge exists from `sgi-core`
to `commerce-sim` or to sponsorship data, commercial or sponsored data cannot reach a score, a report, a
badge or the organic ordering of a listing, and a static boundary check in the integration suite fails
the build if an edge is ever added.

The extension seams are the growth mechanism, and their acceptance test is that a community addition
builds and passes **without editing the scoring code**: a new fixture pack, evaluator check or listing
category implements a typed interface exported from `sgi-core` and registers it.
[`examples/extension-fixture-pack/`](examples/extension-fixture-pack/README.md) is the worked proof.

Nothing in the product calls an external network service. The modules, the boundaries and the request
paths are documented rather than restated here:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the module map and the workspace boundaries
- [`docs/DATA-FLOW.md`](docs/DATA-FLOW.md) — what happens, request by request, on a read, a write, an
  evaluation, a governance decision and a simulated purchase
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — the tables, their owners, and the mutable-versus-append-only split

```text
apps/web/       the public UI: 13 route files, shared components, the single API client
apps/api/       the HTTP surface, the composition root, migrations, the seed, the audit append
packages/       shared, sgi-core, sgi-fixtures, shield, commerce-sim
examples/       extension-fixture-pack: the worked community extension
docs/           architecture, data flow, schema, threat model, the standard, governance, Shield,
                the review checklist, the roadmap, the starter tasks, the generated dependency report
e2e/            the browser suites: the developer-to-buyer loop, the route walk, accessibility
scripts/        the exclusion scan and the dependency report, with their self-tests
.github/        CI, issue and pull-request templates, and the code-ownership file
```

## Contributing and project documents

A contribution starts with the document that fits it, and each of these is the single source for its
subject rather than a summary of another:

| Document | What it is for |
| --- | --- |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The contribution path: what a checkout needs, which command proves which kind of change, the branch and commit conventions, the paths a maintainer reviews, the dependency rules, and the pull-request checklist. |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | The conduct expected in every issue, discussion, review and proposal. |
| [`SECURITY.md`](SECURITY.md) | How to report a suspected vulnerability privately, which modules a security fix covers, and what is out of scope. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The milestones in dependency order, each with the capability it delivers and the check that proves it. No milestone is a date or a promise. |
| [`docs/starter-tasks/`](docs/starter-tasks) | Labelled starter tasks for a first contribution, each with a title, a scope and an acceptance note. |
| [`docs/governance/SGI-PROPOSALS.md`](docs/governance/SGI-PROPOSALS.md) | How a standards proposal is submitted, reviewed, ruled and published as a new standard version. |
| [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) | The generated dependency inventory: every direct and transitive dependency with its version and licence. Generated by `npm run deps:report`; never edited by hand. |
| [`examples/extension-fixture-pack/`](examples/extension-fixture-pack/README.md) | The worked community extension, proving a fixture pack can be added without editing `sgi-core`'s scoring code. |
| [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE) | The issue templates, including the one for standards proposals. `.github/PULL_REQUEST_TEMPLATE.md` carries the checklist a pull request completes. |
| [`.github/CODEOWNERS`](.github/CODEOWNERS) | The code-ownership file. It holds the single placeholder token `MAINTAINER-PLACEHOLDER`, which the project owner must replace with a real owner before the repository is published. |

Two notes for a new contributor. The dependency inventory is **closed**: adding a package needs an
inventory entry, an exact version string in the manifest, a licence inside the allowlist, a purpose
record and a regenerated dependency report — `CONTRIBUTING.md` states the five parts. And contributing
involves no copyright assignment and no CLA: the project is MIT, contributors keep their rights, and a
submitted extension declares its own licence and attribution rather than disclosing the contributor's
own source.

## Privacy and the manual review

Nothing in this repository may carry real personal information, contact details, financial information,
credentials, tokens or secrets — in code, tests, fixtures, seed data, documentation, comments, examples
or commit messages. Every identity here is a fictional handle or organisation, and this page publishes
no email address and no telephone number, including for security reports: `SECURITY.md` states how to
report a vulnerability through the hosting platform's private form instead.

Two layers check that, and neither replaces the other.

**The automated scan is supplementary.** `npm run scan:exclusions` reads the working tree, the manifests
and lockfiles, and the local git history, and it detects exactly four classes: mail-address patterns;
telephone-number patterns; credential material; and prohibited payment, analytics and advertising
dependency names, matched against digests rather than names. It reports every finding with its file and
line and deletes nothing, and it exits `2` rather than `0` when it could not reach a verdict at all, so
a broken scanner is never mistaken for a clean tree. Two suppressions are stated in this command's
own output and in `docs/REVIEW-CHECKLIST.md` §2: no mail-address finding is reported inside a
lockfile or inside the deprecation notice npm copies verbatim from the registry, because both are
upstream metadata the repository passes on rather than its own content, and none is reported on a git
commit's `Author:` or `Committer:` line, because each commit carries the committing tool's identity
rather than a person's address. **It does not guarantee the absence of private
information.** It does not detect personal names; it does not detect the contextual disclosure of
private or nonpublic information; and it does not detect references to private projects, products or
datasets. A clean run is not evidence that the repository holds none of those, and no document, comment
or UI string here may describe the scan as guaranteeing that absence.

**The manual review covers what the scan cannot, and it is manual.**
[`docs/REVIEW-CHECKLIST.md`](docs/REVIEW-CHECKLIST.md) walks a reviewer through the three categories the
scan is blind to — personal names, contextual disclosure of private or nonpublic information, and
references to private projects, products or datasets — across UI text, seed data, fixtures,
documentation, comments and examples. It carries one sign-off line per category, completed by a
maintainer, and it is performed by reading rather than by running anything: no command in this
repository performs it or proves it was done.

## Licence

[MIT](LICENSE). The licence covers this repository; the library packages are adopted by taking their
source under it, and contributors keep the rights to their own work. A submitted extension declares its
own licence and attribution — see [`examples/extension-fixture-pack/LICENSE`](examples/extension-fixture-pack/LICENSE)
and [`examples/extension-fixture-pack/ATTRIBUTION.md`](examples/extension-fixture-pack/ATTRIBUTION.md)
for the shape of that declaration.
