---
name: Bug report
about: Report a defect in the ADEM exchange, the Standard Gate Index, the demo evaluator, ADEM Shield Basic or the simulated commerce, so a maintainer can reproduce it from a documented command.
title: "[bug]: "
labels: ["bug"]
---

Something in ADEM does not do what its own documentation says it does, and a report of it is welcome here.
`README.md` is the product's account of what works and what deliberately does not, and its command table is
the whole command interface; `CONTRIBUTING.md` is the contribution path, the command that proves which kind
of change, and the review a protected path requires. A capability that does not exist yet belongs in
`.github/ISSUE_TEMPLATE/feature-request.md`, and a change to a standard's criteria in
`.github/ISSUE_TEMPLATE/standards-proposal.md`. Everything below is answerable from your checkout alone:
the product installs, builds, tests, seeds and starts with no account, no service, no secret and no
environment variable.

_Answer each prompt below in place, and delete a prompt you have answered._

## What you expected to happen

_What should have happened, with the documented statement it comes from — so the report names a contract
rather than a preference. It is usually one of the following. A command in `README.md`'s command table that
should have exited 0. A route's documented success status: `200` for a public read, `201` for a write. A
route's documented error status: `400` for a parameter or a body that fails its schema, `401` when the
`X-Demo-Account` header is absent or names nothing the server can resolve, `403` when the resolved account's
role is not the one the route requires, `404` for an unknown or removed resource, `409` for a duplicate
listing version or an already-decided proposal, `422` for an evaluation submission that lacks a recorded
output for a fixture case, and `429` with a `Retry-After` header past 60 write requests per minute per
client. The one error envelope `{ "error": { "code", "message" } }`. A label from the closed vocabulary: a
report's label is `SAMPLE` or `VERIFIED-IN-DEMO`; a sponsored item carries "Sponsored"; a simulated amount
is an integer count of minor units of the synthetic currency `DEMO`; a listing that has never been
evaluated shows "No SGI report yet"; a badge's scope is "structured output on fixture set only"; and a
demo session carries "demo only, no production authentication" wherever the switcher appears. A state: an
empty search or listing set rendering an explanation rather than an error trace, a hidden listing leaving
search and compare, or a rate-limited write showing a visible retry message. An invariant: the same
fixture submission evaluated twice yielding byte-identical per-case results and the same outcome, because
the outcome follows from the recorded evidence and the versioned criteria alone and never from who paid._

## What actually happened

_What you observed instead, and what you were looking at when you saw it. Where the API produced it, give
the request you sent, the response status, and the error body **copied verbatim** — the envelope is
`{ "error": { "code", "message" } }`, so paste it with the actual `code` and `message` values in place of
those two words. A short excerpt is what is needed: the relevant lines, and no more. A whole log, a whole
configuration file or a whole response body buries the part that matters, so paste the smallest piece that
shows the defect and describe the rest. Where a page rendered something other than the state its
documentation describes, say what appeared in its place, and say whether the browser console reported
anything._

## The command that reproduces it

_Name the exact command, because a report naming a command nobody can run is not reproducible and a
maintainer cannot act on it. Use one of the documented commands and nothing invented: `npm install`,
`npm run build`, `npm test`, `npm run seed`, `npm start`, `npm run test:unit`, `npm run test:integration`,
`npm run test:e2e`, `npm run test:a11y`, `npm run scan:exclusions`, `npm run deps:report`, or the
equivalent `docker compose up` path. Give the smallest sequence that shows the defect, in the order you ran
it, with the arguments you passed and what each command printed. A suite can be narrowed rather than edited
— `npm run test:unit -- packages/shield` runs one workspace's tests — so say what you narrowed, and why.
If no documented command shows it, say what you ran by hand instead, but read the command table in
`README.md` first: it is the whole interface, so a command that is not there is not part of the project._

## Where it happens

_Give one path under `/api/v1` or one page, as precisely as you can. For the API, name the path: a listing
search (`/api/v1/listings`), a listing's detail, a compare query, an inquiry (`/api/v1/inquiries`), a
challenge or a challenge response, a thread or a post, a standard or a standard version, an evaluation
submission (`/api/v1/evaluations`) or the report it produced, an appeal or its ruling, a simulated
checkout, a refund, a ledger read (`/api/v1/ledger/founder-allocation`), a moderation action, or the
sponsored slots. For the UI, name one of the thirteen pages: home, mission, listings, listing detail,
compare, developer, challenges, threads, standards, report, academy, opportunity index, and the not-found
page. The inquiry form and the simulated checkout are surfaces inside the listing detail and compare pages
rather than pages of their own, so a defect in either is reported against the page it appears on. Say how
you reached the page — the navigation, or the address you typed — and, for a page, what its heading said,
so the same screen can be found again._

## Your environment

_Node.js 20: the root `package.json` fixes `engines` to `>=20.0.0 <21`, so a run on another major version
is a report about a runtime the project does not support. Say whether you ran the product locally with npm
or through `docker compose up`. Say whether the database was a fresh seed written by `npm run seed`, and
which file the process opened: that is the optional `ADEM_DB_PATH`, documented with the optional `ADEM_PORT`
— whose default is 3000 — in `apps/api/src/config.ts`. Both inputs are optional and both have working
defaults, and no environment variable and no secret is required to install, build, test, seed or start the
product, so a report needs the name of an input at most and never its value._

## What you already tried

_Which checks you have already run and what each one showed, so a maintainer can start where you stopped
rather than repeat the ground. Name the suites already run: `npm run test:unit` for a pure function, a
scoring rule, a policy or the ledger arithmetic; `npm run test:integration` for a route, a status code or
the migration runner; `npm run test:e2e` for a behaviour only a browser shows; `npm run test:a11y` for
accessibility and responsiveness at 1280 px and 360 px; `npm run scan:exclusions` for a finding in one of
its four classes; and `npm run deps:report` for a licence outside the allowlist. If CI is what ran them, say
so rather than describing the result yourself: the workflow runs `npm ci`, `npm run build`, `npm test`,
`npm run test:e2e`, `npm run test:a11y`, `npm run scan:exclusions` and `npm run deps:report`, in that order.
Say also whether anything moved the defect — a restart, a fresh seed against a new path, a second machine,
a narrower filter — and paste the failure rather than retelling it._

---

## Before you submit: what must not go in this issue

**No real personal data, credential, token or secret belongs in an issue.** That prohibition covers anything
inside a pasted configuration file, environment file, log excerpt or command output: if the part you would
paste holds something sensitive, cut that part out and describe it in words instead of pasting it. Nothing
in this repository needs a secret — the product runs with none — so no report should carry one. A
credential that has already been committed is not undone by removing it in a later commit, because the
history keeps it: replace or revoke it first, then say that it happened.

**A suspected vulnerability is not reported here.** It goes through the private vulnerability reporting
channel that `SECURITY.md` describes, on the hosting platform, rather than into a public issue or pull
request. No contact address is published anywhere in this repository — no mail address and no telephone
number — so there is nothing to ask for in this issue and nothing else to offer you instead. Two behaviours
are deliberate and are not defects, and `SECURITY.md` states both so that a report is not spent on them: the
`X-Demo-Account` header is a synthetic role selector rather than authentication, and the append-only triggers
are defence in depth rather than a security boundary. What is a defect is a write route whose role check is
missing or bypassed, a route that updates or deletes an append-only row, an operator path that can alter a
measurement, or any path that lets a fee or a sponsorship reach a score, a report, a badge or the organic
ordering of a listing.

**Do not describe a demo artefact as a real transaction, and do not describe a report as a certification.**
The commerce surfaces are simulations: every amount is an integer count of minor units of the synthetic
currency `DEMO`, and no real currency code and no currency symbol appears anywhere. A demo session carries
the label "demo only, no production authentication". A report carries exactly one label, `SAMPLE` or
`VERIFIED-IN-DEMO`, with the badge scope "structured output on fixture set only" — and a report is not a
certification, not an independent verification and not a guarantee of safety, while a `FAIL` report carries
no badge at all. ADEM Shield Basic is not a gate pass, not a certification and not a security guarantee: its
decision is `allow`, `deny` or `needs_approval`, with a reason and a rule ID. Buying an evaluation never
guarantees a pass: outcomes depend on test evidence only.
