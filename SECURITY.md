# Security policy

How to report a suspected vulnerability in ADEM — the Agent Development Exchange and Marketplace — and
what this repository does and does not cover. It is written for the person who has found something in
this code and wants to know whether it is a defect, where a fix would land, and what happens after a
report arrives.

The full model — the assets, the actors, the trust boundaries, the mitigations and the non-goals — is
`docs/THREAT-MODEL.md`, and this document points at it rather than restating it. For the package that
ships to adopters, `docs/shield/THREAT-MODEL.md` and `docs/shield/EXCLUSIONS.md` carry the equivalent
material in Shield's own words.

## 1. Supported versions

ADEM ships as a **local demonstration and foundation at version `0.1.0`**: one process, one SQLite
file, one container, no external service and no secret. Security fixes target the current release on
the `main` branch, and that is the whole of the supported set —

- No earlier release line is supported, because there is none: `0.1.0` is the first version, and no
  backport or maintenance branch exists.
- The library packages — `packages/sgi-core`, `packages/sgi-fixtures`, `packages/shield` and
  `packages/commerce-sim` — are adopted by taking the source under the repository's MIT licence
  (`LICENSE`) rather than from a registry, so the supported version of any of them is the current state
  of `main` rather than a published release.
- A fix is delivered as a commit on `main`, and there is no release cadence, no security-release
  channel and no advisory feed to subscribe to.

## 2. Reporting a vulnerability

**Report it privately, through the hosting platform's private vulnerability reporting form** — the
repository's Security tab offers it directly — and not in a public issue, pull request, discussion or
post. Where the platform also offers a private message to the maintainers, that is an acceptable
alternative for a report that does not fit the form.

This repository publishes **no email address, no telephone number and no other personal contact
detail**, and it offers no other reporting route. That is deliberate rather than an oversight:

- The repository is public and MIT-licensed, and a real contact detail is itself a prohibited item in
  it — nothing here may carry real personal information, a contact detail, a credential or a secret.
- A private channel keeps the report between the reporter and the maintainers until a fix exists,
  which is the point of reporting privately. A public issue or a public post would disclose the issue
  to everyone before anyone could fix it.
- The platform channel records the report and the discussion in one place, so the fix, the reasoning
  and the disclosure all stay together.

`CONTRIBUTING.md` states the same rule for contributors, and `.github/ISSUE_TEMPLATE/standards-proposal.md`
directs a suspected vulnerability to this channel rather than to the public tracker.

## 3. What a useful report contains

A report that names the property it affects and how to reproduce it is the one a maintainer can act on
quickly. Please include:

- **A description of the issue**, in one or two sentences: what a caller, a user or a component can do
  that it should not be able to do.
- **The affected path**, taken from the list in section 5 — for example a scoring module, a fixture
  file, a policy path, the allocation arithmetic, the exclusion scan or a workflow.
- **Reproduction steps**, or failing that the smallest description that would let a maintainer
  reproduce it: the input, the sequence of requests or calls, and the environment you observed it in.
- **Observed behaviour and expected behaviour**, stated separately.
- **Whether any real data or secret is involved.** Say *where* it is and never *what* it is: name the
  file, the field or the route, and do not paste the value itself. If a credential has already been
  committed, replace or revoke it first and treat the repository's history as exposed — removing it in
  a later commit is not enough — then report it.
- **Optionally**, a suggested fix, and the commit you observed the behaviour at.

**Do not include** real personal information, a contact detail, a credential or token, financial
information, or private and nonpublic information about a third party. This repository holds none of
those and a report should not introduce any. Do not include a working exploit aimed at a system you do
not own.

## 4. What happens next

- **Acknowledgement.** Your report is acknowledged through the same private thread, so both sides can
  see it.
- **An initial assessment.** A maintainer states whether the report is accepted as a defect, needs more
  information to decide, or is one of the two expected non-vulnerabilities in section 7 — in which case
  the reason is given rather than the report being closed silently.
- **A fix**, where one is warranted, lands on `main` and follows the review path the affected path
  requires (section 5). The fix carries the test that demonstrates the defect, in the form the
  contribution path uses: a unit test for pure logic, an integration test for a route and its statuses,
  a browser test for a behaviour only a browser shows.
- **Coordinated disclosure.** Once a fix is available, the issue and the fix are written up together,
  and the write-up is coordinated with you before it is published. If you would like to be credited, say
  so and say which handle to use; a handle is welcome and a personal name is not, because this
  repository publishes none.
- **No promise of a response time.** There is no service level, no response-time commitment, no embargo
  arrangement beyond the coordination above, and no bug bounty. The maintainers are volunteers on a
  foundation rather than a commercial support desk, and this document offers no assurance beyond the
  process described here.

## 5. In scope for a security fix

Exactly the paths `.github/CODEOWNERS` protects, which is what makes a fix in any of them follow the
maintainer-review path those entries require:

| Path | What a fix there covers |
| --- | --- |
| `packages/sgi-core/` | Standards and their versioned thresholds, canonical comparison, scoring, report building, proposals, appeals, governance events and the extension registry — the modules a report's outcome is derived from. |
| `packages/sgi-fixtures/` | The read-only fixture set of 20 cases with 5 marked `critical`, the three seed candidates and their expected outcomes: change one and every published outcome moves. |
| `packages/shield/` | The policy engine and its schema validation, `evaluate`, the approval checkpoint, the audit log with its file sink, and the reference adapter. |
| `packages/commerce-sim/` | The fictional configuration, offer selection, the simulated checkout, the three ledgers and refunds — the arithmetic that decides an amount or a reversal. |
| `docs/governance/` | The rules a standards change follows, so a criteria change cannot arrive as an unreviewed edit. |
| `scripts/scan-exclusions.ts` | The four-class exclusion scan, which is one of the repository's own verification artefacts and so has to be trusted to report honestly. |
| `.github/` | The workflow, the issue and pull-request templates, and the ownership file itself. |

A fix in one of them follows the same review those entries describe: a maintainer reviews it, and it is
not merged by the person who opened it. `.github/CODEOWNERS` carries the single generic token
`MAINTAINER-PLACEHOLDER`, with a comment stating that the project owner must replace it with a real
owner before the repository is published. Until that replacement is made, those paths have no effective
owner and no review is requested automatically, so a fix touching one of them asks for a maintainer's
review explicitly, exactly as a contribution does.

**A suspected vulnerability outside these paths is still worth reporting** through the same private
channel. The append-only rule and the role checks are enforced in `apps/api/src/`, for instance, which is
not on the list: a report that a write route omits its role check, or that a route offers an update or a
delete on an append-only row, is a finding and is not refused for landing on a path whose fix takes an
ordinary review rather than a protected-path one.

## 6. Out of scope: what this project deliberately does not defend

Each entry is a capability this foundation does not have — not a gap waiting for a reporter to fill, and
not a defect a report can close.

- **Production authentication and authorisation over real identities.** There is no identity to
  authenticate: the demo accounts are synthetic seed rows, so there is nothing here for an identity
  provider to attach to.
- **Session management and credential storage.** No session exists, no credential is stored, and no
  credential store is read.
- **Any real money movement, settlement, payout or payment-provider integration.** No money moves.
  Commerce is a labelled simulation over integer minor units of the synthetic currency `DEMO`, and a
  provider integration would create a money path this product deliberately does not have.
- **Real personal data of any kind**, including contact details and financial information. None is
  collected and none may be added; the demo identities are fictional.
- **Isolation, sandboxing or safe execution of third-party agent code.** Nothing submitted is executed:
  a candidate is declarative data compared as canonical JSON. Isolation has not been reviewed, so
  execution of submitted code stays out of scope until it is.
- **Resistance to denial-of-service beyond the documented rate limit.** Write routes are limited to
  60 requests per minute per client and answer `429` with a `Retry-After` header beyond that, and the UI
  renders a visible retry message. That bound is a fair-use limit on one client's write rate: it is not
  DoS protection, and volumetric attacks are not defended against.
- **High availability, multi-instance or clustered deployment.** The store is a single-writer SQLite
  file in one process by design, so there is no failover, no replication and no instance to scale out.
- **Enterprise compliance, audit certification or regulatory conformance.** None is claimed and no
  evidence exists here for any of it.
- **Encryption at rest, key management or secret rotation.** There is no secret to rotate and no key
  management path, and the database file is not encrypted at rest.
- **The security of community extensions.** An extension is the contributor's responsibility under its
  own licence declaration. The example under `examples/extension-fixture-pack/` carries its own
  `LICENSE` and `ATTRIBUTION.md`, and its presence in this repository is not a review of it.
- **Deployment, publication and announcement hardening.** Deploying, announcing or promoting the product
  needs separate approval and is not covered by anything here.

The posture is deliberate and documented: `docs/THREAT-MODEL.md` section 7 states each of these as a
non-goal, and `docs/shield/EXCLUSIONS.md` states Shield's own version of the list as obligations its
adopter carries.

## 7. Two things that are expected, and are not vulnerabilities

Both are recorded in `docs/THREAT-MODEL.md` section 6 as deliberately chosen parts of the design. Read
this section before reporting either of them — and note that neither one excuses a real defect beside it.

**The `X-Demo-Account` header is a synthetic role selector, not authentication.** It names one seeded
account, any client can send any name, and that is the design: the header separates roles for a
demonstration and asserts nothing about who the caller is. It creates no session, carries no credential
and is checked against no credential store. The UI shows the label `demo only, no production
authentication` wherever the switcher appears. What bounds a spoofed value is the per-route role check —
`401` when the header is absent or names nothing the server can resolve, `403` when the resolved
account's role is not the one the row requires — together with the write rate limit, the append-only
record of what was written, and the operator's inability to alter a measurement. A report that the header
can be spoofed restates that design. A report that a role check is bypassed or missing on a write route,
or that an operator's route can alter a measurement, is a defect and is exactly what this document is
for.

**A SQLite `RAISE(ABORT)` trigger is defence in depth, not a security boundary.** The triggers behind the
append-only tables refuse an update or a delete that reaches one of them, and they are worth having.
They are also not a boundary: SQLite has no command that disables a trigger, but a connection holding
write access can drop one, and the writable-schema escape hatch can rewrite the schema itself. What
makes the append-only rule hold is that no route offers the mutation, and the test that proves it is
`apps/api/test/integration/immutability.test.ts`. A report that a trigger can be dropped restates the
design. A report that a route updates or deletes an append-only row, or that a fee, a sponsorship or any
commercial value reaches a score, a report, a badge or the organic ordering of a listing, is a defect.

## 8. The assets this design protects

Naming which of these a finding touches is the fastest way to have it triaged:

1. **The integrity of the fixture set and the versioned pass rule.** Every published outcome derives
   from the 20 cases in `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/` and from the thresholds stored in
   a standard-version row, so a criteria change must be a new version rather than an edit.
2. **The append-only historical record** — the nine tables that accept only a new row:
   `standard_versions`, `evaluation_reports`, `report_case_results`, `governance_events`,
   `ledger_entries`, `transactions`, `refunds`, `audit_events` and `listing_versions`, together with the
   per-case evidence nested under each report.
3. **The separation between roles.** A buyer must not publish listings, a developer must not moderate,
   and neither may read the operator's ledger or audit routes; the roles exist so that each action stays
   attributable to the account that took it.
4. **The absence of real personal data, credentials and secrets** from the repository and from the
   running system. The demo accounts are seed rows carrying a handle, a role and a display label, and no
   module reads a secret, a token or a key.
5. **The meaning of the badge and the closed label vocabulary.** `SAMPLE` and `VERIFIED-IN-DEMO`, with
   the scope `structured output on fixture set only`, say one narrow thing about one fixture set; a badge
   that could imply more would mislead the buyer it exists to inform.
6. **The foundation's own reputation.** A public demonstration of simulated commerce can damage it if any
   surface reads as real, which is why every simulated amount carries a disclosure label, every sponsored
   item carries the label `Sponsored`, and no real currency code or currency symbol appears anywhere.

## 9. What this project claims, and does not

ADEM is a **local demonstration and foundation**. It is not a production service, and this document is
not an assurance that it would be one.

- It claims **no certification**, **no independent verification** and **no universal safety**, for the
  product or for anything built on it. No document in this repository describes any part of the system
  as certified, independently verified or safe for arbitrary workloads.
- ADEM Shield Basic is **not a gate pass and not a security guarantee**. It is a small in-process
  library whose own boundary is its adopter's process, and `docs/shield/EXCLUSIONS.md` states in full
  what it does not do.
- The exclusion scan (`npm run scan:exclusions`) detects four classes — mail-address patterns,
  telephone-number patterns, credential material and prohibited dependency names — and it **matches
  patterns rather than meaning**. A clean run is therefore not evidence that the repository holds no
  private information, it must never be described as showing that absence, and it does not see a
  personal name, a contextual disclosure or a reference to a private project at all. It is supplementary
  to the manual review in `docs/REVIEW-CHECKLIST.md`, which covers what it cannot, and never a substitute
  for it.
- No surface, badge, report or document states that buying an evaluation guarantees a pass: outcomes
  depend on test evidence only.
- There is no support commitment, no service level, no advisory feed and no bug bounty.

## Read next

- `docs/THREAT-MODEL.md` — the assets, the actors and their reachable writes, the trust boundaries, the
  mitigation for each threat, the non-goals, and what would change the model.
- `docs/shield/EXCLUSIONS.md` and `docs/shield/THREAT-MODEL.md` — the same material for ADEM Shield
  Basic, whose boundary belongs to its adopter.
- `CONTRIBUTING.md` — the contribution path, the review the protected paths require, and the pull-request
  checklist.
- `docs/governance/SGI-PROPOSALS.md` — how a change to a standard's criteria is proposed, reviewed and
  published as a new version.
- `docs/SCHEMA.md` — the tables, their owners, and the nine append-only ones.
- `docs/REVIEW-CHECKLIST.md` — the manual privacy review that covers what the automated scan cannot.
