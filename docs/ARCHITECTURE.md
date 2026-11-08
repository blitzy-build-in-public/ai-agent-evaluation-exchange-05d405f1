# ADEM architecture

How ADEM is put together, why its module boundaries hold by construction rather than by discipline, and
where in the tree each decision lives.

This document is the module map. What happens, request by request, on a read, a write, an evaluation, a
governance decision and a simulated purchase is `docs/DATA-FLOW.md`; the tables, their owners and the
mutable-versus-append-only split are `docs/SCHEMA.md`. Neither is restated here.

Nothing in this document is a claim about the product's safety or maturity. An evaluation report carries
exactly one of the two labels the vocabulary closes to `SAMPLE` and `VERIFIED-IN-DEMO`, a badge states
the scope "structured output on fixture set only", and no part of ADEM is certified, independently
verified or described as safe for arbitrary workloads.

## 1. What ADEM is

ADEM — the Agent Development Exchange and Marketplace — is a local, MIT-licensed foundation for an AI
agent exchange. A developer lists an agent and a version; the Standard Gate Index, whose one provisional
standard is `SGI-SO-1.0.0` (Structured Output Conformance), turns a declarative candidate submission into
a reproducible PASS/FAIL report by comparing recorded outputs against a fixed fixture set rather than by
running anything; a buyer compares each listing's claims against that measured evidence, and each
listing's stated limitations, before posting an inquiry or completing a simulated checkout. Every
commercial surface is a labelled nonfunctional simulation, every amount is an integer count of minor
units of the synthetic currency `DEMO`, and the SGI path has no edge to any of it.

What the delivered version does and does not do, and the commands that run it, are `README.md`; the
capabilities deferred out of this foundation are `docs/ROADMAP.md`.

## 2. Deployed shape

One process, one port, one SQLite file, and nothing outside them. The diagrams in this document are plain
ASCII rather than mermaid on purpose — the repository ships no diagram tooling, and a diagram has to be
readable in a plain editor and diff cleanly — the same choice `docs/DATA-FLOW.md` makes for its flow
diagrams.

```text
     browser
  +----------------------------+
  | the built React UI         |   built by npm run build (Vite) into apps/web/dist
  | 13 route files             |
  | api-client.ts              |   the only module that calls /api/v1
  +-------------+--------------+
                | HTTP/1.1, JSON, relative to the page's own origin
                v
  +-----------------------------------------------------------------------+
  | one Node 20 process                                                   |
  |                                                                       |
  |  Fastify 4 instance (apps/api/src/server.ts)                          |
  |    /api/v1          14 route groups                                   |
  |    one error body   { "error": { "code": ..., "message": ... } }      |
  |    write limit      60 requests/minute/client -> 429 + Retry-After     |
  |    @fastify/static  serves apps/web/dist, with the SPA fallback        |
  |    migrations       applied at start-up (apps/api/src/db/migrate.ts)   |
  |                                                                       |
  |  domain packages, reached through their single entry only:            |
  |    @adem/sgi-core        standards, scoring, reports, governance       |
  |    @adem/commerce-sim    offers, checkout, ledgers, refunds            |
  +-----------------------------------+-----------------------------------+
                                      | SQL, synchronous (better-sqlite3)
                                      v
  +-----------------------------------------------------------------------+
  | one SQLite file: <repository root>/.adem/adem.sqlite                  |
  | (override: ADEM_DB_PATH)   journal_mode = WAL, foreign_keys = ON      |
  +-----------------------------------------------------------------------+

  outside the box: nothing. No external service, no message queue or worker,
  no second datastore, no analytics or advertising endpoint, no payment
  provider, and no outbound network call from any code path.
```

Two documented ways to start it, both from the repository root:

```text
  without Docker                          with Docker
  --------------------------------        -----------------------------------------
  npm install                             docker compose up
  npm run build                           builds the image, starts the one service
  npm test                                named `app`, publishes 3000:3000, keeps
  npm start                               the database in the named volume
  -> http://localhost:3000                adem-data

  demo data, once:  npm run seed          demo data, once:
                                          docker compose exec app npm run seed
```

Seeding is a one-time command against a running service and deliberately not a start-up step: the seed
writes rows with fixed identifiers, so a second run against an already seeded database fails
(`apps/api/src/seed/run-seed.ts`, `Dockerfile`, `docker-compose.yml`).

**No environment variable is required and no secret is read.** The process reads exactly two inputs, both
optional and both with working defaults: `ADEM_PORT` (default 3000) and `ADEM_DB_PATH` (default
`<repository root>/.adem/adem.sqlite`). They are resolved in `apps/api/src/config.ts`, the only module of
the workspace permitted to read the environment, and a present-but-unusable value is refused at start-up
rather than silently replaced by the default. Nothing reads a secret, a token or a key; no `.env` file
exists and none is needed. The single network step in the product's lifetime belongs to a contributor's
machine rather than to the application — the one-time Playwright browser download for the browser suites.

**The stack, and the file that fixes each choice.**

| Piece | Version line | Where the choice lives |
| --- | --- | --- |
| Language and type checking | TypeScript 5.4.5, strict | `tsconfig.base.json`, `tsconfig.json`, the root `package.json` |
| Runtime and workspaces | Node 20 LTS, npm workspaces | root `package.json` (`engines`, `workspaces`, the root scripts) |
| Public UI | React 18.3.1, Vite 5.4.21 | `apps/web/package.json`, `apps/web/vite.config.ts` |
| HTTP surface and validation | Fastify 4.28.1, JSON schema | `apps/api/package.json`, the route groups' own schemas, `packages/shared/src/schemas/` |
| Storage | better-sqlite3 9.6.0 | `apps/api/src/db/connection.ts` |
| Tests | Vitest 1.6.1, Playwright 1.45.3 | `vitest.unit.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts` |
| Container | `node:20-bookworm-slim` | `Dockerfile`, `docker-compose.yml` |

The base image is Debian slim rather than Alpine for one dependency: better-sqlite3 9.6.0 publishes a Node
20 glibc x64 prebuilt binary, so the install fetches the native module instead of compiling it.

## 3. Workspace map

Eight workspaces, declared in the root `package.json` as `apps/*`, `packages/*` and `examples/*`. Each one
has a single responsibility, one public entry, and a set of edges it may have and edges it may not.

| Workspace | Responsibility and the data it keeps | Public entry | May import / must not import |
| --- | --- | --- | --- |
| `apps/web` | Public UI: the 13 route files, the components and the demo-account switcher; keeps no data, only the selected demo account in `sessionStorage` | `apps/web/src/main.tsx` (browser entry); `apps/web/src/api-client.ts` is the sole caller of `/api/v1` | `@adem/shared` types only; must not import `@adem/api` or a domain package |
| `apps/api` | HTTP surface, rate limiting, demo-session resolution, moderation, migrations, seed and audit events; keeps accounts, listings, versions, claims, inquiries, challenges, threads and sponsored slots | `apps/api/src/index.ts`, exporting `createServer(options)` | May import `@adem/shared`, `@adem/sgi-core` and `@adem/commerce-sim`; must not import `@adem/web`; holds no scoring, ledger or policy arithmetic |
| `packages/sgi-core` | Standards, versions, rubric, pass/fail rules, proposals, appeals, reports and governance events, append-only | `packages/sgi-core/src/index.ts` | May import `@adem/shared`, `@adem/sgi-fixtures` and `better-sqlite3`; **must not import `@adem/commerce-sim` or any sponsorship data** |
| `packages/sgi-fixtures` | The deterministic fixture pack and its expected outcomes, read-only: `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/` | `packages/sgi-fixtures/src/index.ts` | `@adem/shared` types only; no runtime dependencies |
| `packages/shield` | ADEM Shield Basic: policy engine, reference adapter, approval checkpoint and audit log with a file sink | `packages/shield/src/index.ts` | **No dependency on any other workspace and no runtime dependency at all** — it is adopted on its own |
| `packages/commerce-sim` | Offers and their selection, the simulated checkout, the marketplace, gate-fee and founder-allocation ledgers, refunds | `packages/commerce-sim/src/index.ts` | May import `@adem/shared` and `better-sqlite3`; must not import `@adem/sgi-core` |
| `packages/shared` | Types, constants, the JSON schemas used by more than one workspace, and the ordered migration files in `packages/shared/migrations/` | `packages/shared/src/index.ts` | Keeps no data and has no runtime dependency |
| `examples/extension-fixture-pack` | The worked community extension: one fixture pack contributed through `@adem/sgi-core`'s seam, with its own `LICENSE` and `ATTRIBUTION.md` | `examples/extension-fixture-pack/src/index.ts` | May import `@adem/sgi-core` and `@adem/sgi-fixtures`; never imported by `packages/sgi-core`; no scoring code is edited to add it |
| `docs/`, `.github/` | The documents, the templates and the CI workflow | — | Keep no data and no source imports; outside every workspace graph |

The tree of listed directories is the contract: a file may be added inside a directory this map names, and
no workspace may be added and no listed path moved.

## 4. Component interaction

Which workspace reaches which, and nothing more:

```text
        +------------------+        HTTP, JSON, /api/v1        +------------------+
        |    apps/web      | --------------------------------> |    apps/api      |
        |    public UI     |                                   |    HTTP surface  |
        |    api-client.ts | <-------------------------------- |    composition   |
        +------------------+          JSON responses           |    root          |
                                                               +---------+--------+
                                                                         |
                        +------------------------------------------------+
                        |                                                |
                        v                                                v
              +-------------------+                          +-------------------+
              | packages/sgi-core |                          | packages/         |
              | standards         |                          | commerce-sim      |
              | scoring, reports  |                          | offers, checkout  |
              | proposals, appeals|                          | ledgers, refunds  |
              | governance events |                          +---------+---------+
              +---------+---------+                                    |
                        |                                              |
                        v                                              |
              +-------------------+                                    |
              | packages/         |                                    |
              | sgi-fixtures      |                                    |
              | read-only data    |                                    |
              +---------+---------+                                    |
                        |                                              |
                        +---------------------+------------------------+
                                              v
              +-------------------------------------------------------------+
              | one SQLite file: the nine append-only tables and the mutable |
              | tables, each written by the package that owns it             |
              +-------------------------------------------------------------+

              +-------------------+         +--------------------------------+
              | packages/shield   | <------ | an adopting application        |
              | no dependency on  |         | outside this repository        |
              | any other workspace|        +--------------------------------+
              +-------------------+

  @adem/shared is imported by apps/web, apps/api, packages/sgi-core,
  packages/sgi-fixtures and packages/commerce-sim; it keeps no data and depends
  on nothing, and it is left out of the arrows for legibility, not as an exception.
```

Read as edges, the diagram is short: `apps/web` reaches `apps/api` and nothing else; `apps/api` reaches
`@adem/shared`, `@adem/sgi-core` and `@adem/commerce-sim`; `packages/sgi-core` reaches
`packages/sgi-fixtures`; both domain packages reach the file's tables directly, which is why they receive
a database handle from the composition root rather than fetching one; and **no arrow leaves this
repository for `packages/shield`** — its only caller is an adopting application.

Two conventions cross these boundaries and are fixed once, in `packages/shared/src/constants.ts`: every
amount crosses as an integer count of minor units of the synthetic currency `DEMO`, and every rendered
label comes from that one file: `Sponsored` on a sponsored item, `No SGI report yet` for a listing with no
report, `to be determined` for the founder-allocation contract structure, which carries no personal
identity, beneficiary account or entitlement, and `demo only, no production authentication` wherever the
demo-account switcher appears.

## 5. Why the boundaries are structural, not conventional

**Trust separation is an absent import.** `packages/sgi-core` has no edge to `packages/commerce-sim`, to
`apps/api`, or to any sponsorship module or column, so sponsored and commercial data cannot reach a
measurement, a report, a badge or the organic ordering of a listing search — not because a rule forbids it
but because no path exists. That absence is checked rather than trusted:
`apps/api/test/integration/boundary-check.ts` walks the import specifiers and sponsorship tokens of every
TypeScript file under `packages/sgi-core/` and reads every workspace manifest, reporting any edge that
would carry a commercial value into the SGI path and any manifest edge back into it. The check is static,
so it holds for code paths no test exercises; its behavioural half — reports, badges and ordering staying
identical as sponsorship and fee data vary — is `apps/api/test/integration/trust-separation.test.ts`'s
job.

**Shield stands alone because its manifest says so.** `packages/shield/package.json` declares no
`dependencies` block at all: not another workspace and not a third-party package. An adopting application
that imports `@adem/shield` therefore pulls in its source and nothing else, on any machine, with no
account, no signup and no part of the rest of ADEM. Inside the package, its policy engine, decision
function, approval checkpoint and audit log are reachable only from its single entry,
`packages/shield/src/index.ts`.

**There is one door to the API.** `apps/web/src/api-client.ts` is the only module in the UI that calls
`/api/v1`: no page and no component holds a URL, an HTTP header or a fetch call, so no component can reach
around the demo-account header, and the write rate limit, the JSON-schema validation and the role check on
every non-public route cannot be bypassed from the browser. The header the client attaches is
`X-Demo-Account`, a synthetic role selector and never authentication; what the client may send and what
the server answers are `docs/DATA-FLOW.md` and `docs/THREAT-MODEL.md`.

**One public entry per workspace.** Each workspace declares exactly one `exports` entry, `"."`, resolving
to its single entry file — `src/index.ts` for every workspace but `apps/web`, whose entry is
`src/main.tsx` because its consumer is the browser rather than a module. A workspace is never imported by
any other path, so a name a consumer needs and cannot find in the entry is a missing re-export rather than
a reason to reach a deep path.

## 6. Storage and execution decisions

One database per server instance, opened once, with a schema that only ever grows by adding files.

- **One connection, opened by the composition root.** `apps/api/src/db/connection.ts` opens it and
  requests `journal_mode = WAL`, `synchronous = FULL` and `foreign_keys = ON`, each as its own statement
  outside any transaction, because SQLite will not change the journal mode inside one. There is no pool,
  no connection cache and never a second handle: on `:memory:` two handles are two different empty
  databases, which is why the integration suite runs a whole file against one connection.
- **Migrations are ordered, wrapped and checksum-guarded.** `apps/api/src/db/migrate.ts` applies
  `packages/shared/migrations/NNNN_description.sql` in filename order at start-up, each file inside its own
  `db.transaction(...)` together with the row that records it, so a file whose SQL fails leaves nothing
  applied and never looks applied. `schema_migrations` is authoritative for both the applied state and the
  SHA-256 checksum of every applied file; `PRAGMA user_version` is set to the highest applied version as a
  cheap integer marker for tooling and for a human reading the file, and carries no checksum. The runner
  refuses to start when a recorded file's bytes have changed, been renamed or disappeared, which is what
  makes an applied migration immutable in practice: a schema change is a new numbered file, never an edit.
- **Nine tables are append-only.** `standard_versions`, `evaluation_reports`, `report_case_results`,
  `governance_events`, `ledger_entries`, `transactions`, `refunds`, `audit_events` and `listing_versions`
  accept one kind of write: a new row, inserted. No route registers an update or a delete for any of them
  and no write path uses a replace-style conflict resolution, so history reads back in insertion order and
  a correction is a new row, a new version or an appended event. The full table list, with each table's
  owner, is `docs/SCHEMA.md`; the write sequence is section 3 of `docs/DATA-FLOW.md`.
- **The triggers are defence in depth, not a boundary.**
  `packages/shared/migrations/0010_append_only_triggers.sql` creates a `BEFORE UPDATE` and a `BEFORE
  DELETE` trigger raising `ABORT` on each of the nine — eighteen triggers in all. They are guard rails: a
  connection holding write access can drop a trigger or rewrite the schema, so what holds the rule is that
  no route offers the change, and what proves it is `apps/api/test/integration/immutability.test.ts`. The
  limits are stated in `docs/THREAT-MODEL.md`.
- **The store's API is synchronous on the calling thread.** better-sqlite3 executes a statement as the
  caller's own call, so every query stays small and indexed, one process is one writer, and the deployment
  is single-process and single-writer by design. A slow statement blocks the event loop; there is no worker
  to move it to.

## 7. The composition root

`apps/api/src/server.ts` and `apps/api/src/index.ts` are the only two files where the process is assembled,
and nothing else in the workspace registers a plugin, a handler or a hook.

- **`apps/api/src/server.ts`** — `createApp(options)` builds the Fastify instance in one fixed order: the
  resolved configuration, then the database handle (the caller's, or one this module opens and therefore
  owns and closes), then the migration runner, then the rate-limit plugin, then the route groups, then the
  static handler and the SPA fallback, then the two handlers below. It holds no business rule: no matched
  count, outcome, label, allocation, gate fee or reversal is computed here.
  - One `setErrorHandler` maps every thrown value to the single body
    `{ "error": { "code": ..., "message": ... } }`, so validation failures, an unresolved demo header, a
    domain refusal and a server fault leave by one route, and no handler formats its own error.
  - `@fastify/rate-limit` is registered with `global: false`: reads are unlimited, and each write route
    opts in to 60 requests per minute per client, answering `429` with a `Retry-After` header beyond that.
    Both numbers are `packages/shared/src/constants.ts`'s.
  - The versioned prefix is `API_PREFIX` in `apps/api/src/routes/register-routes.ts`, applied once inside
    one encapsulated scope, so no group file contains the literal and no group's path can be reached
    without it.
  - `@fastify/static` serves the built UI from `apps/web/dist` when it exists. One not-found handler
    answers an `/api/` path, or a request whose last segment looks like a file, with the JSON envelope and
    `404`, and every other path with the SPA entry and `200`, which is what lets the client router own deep
    links. A checkout whose web build has not run yet is a supported state: the server answers for the API
    alone rather than failing at start-up.
  - Fastify 4 answers an unregistered path and an unregistered method on a registered path with the same
    `404`, and no group registers a method other than `GET` or `POST` — so an update or a delete of an
    append-only record is unreachable rather than refused.
- **`apps/api/src/routes/register-routes.ts`** — mounts the fourteen route groups in the order of the API
  contract's resource groups and hands each one the database handle and the resolved configuration by
  closure, never on the instance, so no group depends on decoration order.
- **`apps/api/src/index.ts`** — the workspace's public entry, exporting `createServer(options)`. As the
  process's entry point it resolves the configuration, opens the connection, applies the migrations,
  builds the instance, listens on `0.0.0.0` so a published container port is answered, and closes the
  instance and then the connection on `SIGINT` and `SIGTERM`. It listens only when it is the entry point,
  so importing it binds no port: `apps/api/test/integration/test-server.ts` builds the same instance and
  listens on an ephemeral port of its own.

## 8. What this architecture deliberately is not

There are no microservices, no message queue and no worker process, so an evaluation is synchronous inside
its request and no result arrives later. There is no external service of any kind, no second datastore, no
analytics or advertising SDK and no payment provider, and nothing in the tree makes an outbound network
call. There is no production authentication and no credential store: `X-Demo-Account` names one of the
seeded synthetic accounts and asserts nothing about who the caller is, which is why the label
`demo only, no production authentication` is rendered wherever the switcher appears and why every
non-public route checks the role itself — the subject of `docs/THREAT-MODEL.md`. There is no deployment
automation, no release process and no monitoring stack: `restart: unless-stopped` in `docker-compose.yml`
is the whole operation story, and Fastify's own logger at `info` is the whole of the application's
instrumentation. Production authentication, real money movement, execution of submitted third-party code,
enterprise connectors, paid advertising and deployment are deferred, each with its reason, in
`docs/ROADMAP.md`.

## 9. Where to look next

- `docs/DATA-FLOW.md` — the read, write, evaluation, governance, commerce and report-read paths, the status
  each stage answers with, and the canonical-JSON comparison boundary a contributor must not move.
- `docs/SCHEMA.md` — every table with its owner, its columns, and its place on the
  mutable-versus-append-only split.
- `docs/THREAT-MODEL.md` — the assets, the actors, the trust boundaries and the threats this design
  addresses, together with what it deliberately does not defend.
- `docs/STANDARD-SGI-SO-1.0.0.md` — the one provisional standard: its rubric, its pass rule, its evidence
  semantics and its retest and appeal semantics.
- `docs/governance/SGI-PROPOSALS.md` — how a standards proposal is submitted, reviewed and versioned, and
  which paths a maintainer must review.
- `docs/shield/README.md` — ADEM Shield Basic's usage and its fixed decision contract, with
  `docs/shield/EXCLUSIONS.md` for the obligations an adopter carries and `docs/shield/POLICY-FORMAT.md` for
  the policy format.

