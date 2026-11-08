# The manual privacy review checklist

This is the review that stands where automated scanning cannot reach. It walks a reviewer through the
three categories no pattern matcher sees — a real personal name, the contextual disclosure of private
or nonpublic information, and a reference to a private project, product or dataset — across every
surface a reader or a user of this repository meets: user-interface text, seed data, fixture data,
documentation, comments and examples.

It is **manual**, and it is never optional. `README.md` states that this review is manual,
`CONTRIBUTING.md` names the completed checklist as one of the three artefacts a pull request carries
and requires it for any change that adds or edits one of those surfaces, and the case for why no
command can replace it is section 2.

## 1. What this review proves, and where it is applied

Three properties, each established by reading rather than by running:

1. **No real personal name** appears anywhere in the repository — not in visible copy, not in seed or
   fixture data, not in a comment, not in a credit line, not in a licence holder line.
2. **No private or nonpublic information is disclosed by context.** Nothing becomes identifying in
   the company it keeps, even where no name appears in it.
3. **No reference to a private project, product or dataset** appears — no link, no path, no package
   name, no dataset name, no service name, and no claim that this repository came from something
   private.

The review is applied to the surfaces section 3 lists, which is the whole of what a reader or a user
can see: user-interface text, seed data, fixture data, documentation, comments and examples. It is
performed by the contributor before the pull request is opened and by the maintainer before the change
is merged, and the outcome rides with the pull request as the artefact `CONTRIBUTING.md` section 8
describes. A category that has not been read is not signed, and a signed category with an open finding
against it is a pass that was never earned.

## 2. Why this review is manual: what the scan detects, and what it cannot

`scripts/scan-exclusions.ts`, with its rules in `scripts/exclusion-rules.ts`, is the repository's
automated exclusion scan; `npm run scan:exclusions` runs it, and `npm test` runs its planted-violation
self-test. It detects exactly **four classes**:

- mail-address patterns;
- telephone-number patterns;
- credential material — a PEM-style private-key header, and a credential keyword assigned to a value
  that clears the scan's placeholder denylist, its length floor and its entropy gate;
- prohibited dependency names — payment, analytics and advertising packages, matched against digests
  held in `scripts/blocked-provider-hashes.json`.

It does **not** detect any of the three things this checklist reviews:

- **It does not detect personal names.** A name has no pattern that does not also match ordinary prose,
  so a rule for one would report the word "maintainer" and miss the one name that matters.
- **It does not detect contextual disclosure of private or nonpublic information.** An unformatted run
  of nine digits cannot be separated from a telephone number, an order number or a ZIP-plus-four code
  without the surrounding context that says which it is.
- **It does not detect references to private projects, products or datasets.** A repository name, a
  dataset name or an internal endpoint carries no marker that distinguishes it from a fictional one.

The reason is one sentence: **the scan matches patterns rather than meaning.** It follows that a clean
run is **not** evidence that the repository holds no private information, and that the scan **must
never be described — here, in a pull request, in a document, in a report, in a badge or in a user
interface string — as guaranteeing the absence of private information**. Its own findings are printed
with its limitations, and those limitations say the same thing in the command's own words. It also
reports nothing inside the deprecation notice a registry's packaging tool copies into a lockfile, or
on a commit's identity line, because those are what a packaging tool and a committing tool wrote
rather than content this repository authored.

This review is the check that covers what the scan cannot. The two are complementary and never
interchangeable: a passing scan with this checklist unsigned reports nothing about the three categories
above, and a signed checklist does not excuse a scan that fails over an address, a credential or a
prohibited dependency.

## 3. The surfaces to walk

Read each surface at the path given, looking for all three categories at once and recording what you
find as section 7 describes. The third column says what could go wrong there, so a reviewer knows what
to read *for* rather than only what to read.

| Surface | Path a reviewer opens | What could go wrong there |
| --- | --- | --- |
| User-interface (UI) text | `apps/web/src/pages/` and `apps/web/src/components/`, including the label components `demo-banner`, `sponsored-label` and `sample-badge` | A caption, a quoted sample message, an example reply or an author line carrying a plausible-looking name, a real organisation, or a copied path or host name. |
| Label and message strings | `packages/shared/src/constants.ts`, which defines each label in one place, and every surface that renders or echoes one | A label sentence hand-edited into a paraphrase, or one that has picked up a contact detail, a real organisation name or an internal reference a reader could follow. |
| Synthetic demo accounts | `apps/web/src/data/demo-accounts.ts` | A handle or display label that is silently a real person's handle, an employee's name, or the name of a real organisation. |
| Seed rows | `apps/api/src/seed/seed-data.ts` | A fictional listing, developer, buyer, operator, challenge, thread or sponsored slot whose wording reads as a real company, a real product or a real person. |
| Fixture data | `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/` — the case set, the three candidates and the expected outcomes — and `examples/extension-fixture-pack/fixtures/example-pack/cases.json` | An instruction, a source line or an expected output copied from a real dataset, a real prompt, a private fixture, or a third-party product whose name identifies it. |
| Community documents | `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and everything under `docs/`, including `docs/governance/` and `docs/shield/` | An author credit, a worked example, a "reported by" line, a link, or a policy excerpt that carries a name, a private reference or an internal detail. |
| Issue and pull-request templates | `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md` | A filled-in example naming a real person, linking a private repository, quoting an internal incident, or showing a path from a machine. |
| Comments, doc comments and test fixtures | every source file under `apps/`, `packages/`, `examples/` and `scripts/` | A comment naming who asked for a change, a copied log line, a machine-specific absolute path, an internal ticket or incident identifier, or a test fixture built from real data. |
| Licence and attribution files | `LICENSE`, and `examples/extension-fixture-pack/LICENSE` with `examples/extension-fixture-pack/ATTRIBUTION.md` | A copyright holder line or a credit carrying a personal name where a project handle or a collective phrasing belongs. |
| Generated documents | `docs/DEPENDENCIES.md`, and any command output pasted into a pull request or an issue — the scan's report included | A date, a host name, an absolute path or a machine identifier added by hand to a document that is emitted without them. |
| Starter-task briefs | `docs/starter-tasks/` | A brief written as if for a named contributor, or one that points at private work as the place a task came from. |

Two habits keep the walk honest. Read the surface as a stranger would — a name you recognise is a
finding even when it looks ordinary — and read the *whole* file rather than the lines near a change,
because a name or a private reference that arrived in an earlier change is exactly as much a finding
as one added today.

**The fixed labels are part of what you read.** Where a surface carries one of this product's labels it
must read exactly as the label is fixed, because a reader told something slightly different has been
told something untrue. The closed vocabulary, and nothing beyond it: `SAMPLE` or `VERIFIED-IN-DEMO` for
a report's label, and no third value; `structured output on fixture set only` for a badge's scope;
`Sponsored` on a sponsored item; `demo only, no production authentication` for a demo session; `DEMO`
for a simulated amount; `No SGI report yet` for a listing with no evaluation; `to be determined` for the
founder-allocation contract structure; and `SGI-SO-1.0.0` for the one standard this release carries. A
paraphrase, a capitalisation variant or an extra label is a finding to record and correct, and so is any
label that has leaked into a surface where it does not belong.

## 4. Category 1 — real personal names

**What to look for.** Any real person's identity, in any of these forms: a first name, a surname, both
together, an initials-and-surname pair, a personal handle, a signature, an author line, a contributor
credit, a reviewer or maintainer name, a "thanks to" line, or a licence holder line naming a person.
Look in visible copy, seed data, fixture data, code comments and doc comments, test names and test
fixtures, attribution files, licence files, and any text shaped like a commit message, a changelog
entry or a release note.

**What is correct.** A fictional organisation or a fictional handle, or a collective phrasing such as
the repository's own licence line, which credits the project's contributors rather than a person. The
synthetic demo accounts in `apps/web/src/data/demo-accounts.ts` are the worked standard: a handle, a
role and a display label, and nothing that identifies anybody. An extension's credit takes the same
form — `examples/extension-fixture-pack/ATTRIBUTION.md` credits a project handle and says in its own
words that this repository carries no real personal name.

**The rule for a name that looks plausible but is fabricated.** Replace it with an obvious handle
anyway. A reviewer reading the same file a year later, or a reader who happens to know someone by that
name, cannot tell a fabricated identity from a real one, and the cost of that confusion is exactly the
disclosure this review exists to prevent. Plausible is the hazard, not provenance.

**A credit is welcome; a name is not.** If a contribution is to be credited, credit it to a handle, as
`SECURITY.md` section 4 states for a vulnerability report. Never replace a placeholder with a real
name to make a file look finished — a placeholder is the correct end state wherever the identity of a
person is not needed, and the sign-off block in section 9 is the worked case of that.

## 5. Category 2 — contextual disclosure of private or nonpublic information

**What to look for.** Anything that becomes identifying in context even though no name appears in it:
a path to a private repository or a directory outside this one; a ticket, incident, change or review
identifier; an internal host name, service name or domain; a machine-specific absolute path — a home
directory, a resolved build directory, a scratch path; a project codename; a meeting, calendar or
scheduling reference; a customer-, employer- or team-specific detail; an unpublicised plan, milestone or
roadmap item named as though it were already public; and any screenshot, log excerpt, command output or
error trace carrying one of those.

**The trap this repository invites.** Example output and generated documents are where a machine's own
details arrive by accident. Two properties show what to protect, and a reviewer should confirm both
still hold:

- `docs/DEPENDENCIES.md` is regenerated by `npm run deps:report` and is emitted **without** a date, a
  host name or an absolute path, precisely so it cannot carry one. A hand-added date, host name or
  resolved path breaks that property, and the correction belongs in the generator rather than in the
  generated file.
- `scripts/scan-exclusions.ts` is deterministic in the same way: no clock, host name or run counter
  reaches its output, and every path it reports is relative to the root of the checkout.

**What is correct.** A repository-relative path is the normal and expected form everywhere in this
repository's documents, comments and configuration — `packages/sgi-core/src/scoring/` in a document is
correct. The finding is a path that is absolute, a path that leaves this checkout, a path that names a
directory belonging to one machine, or a value that identifies a particular person's environment, a
particular private system, or a particular unpublicised piece of work.

**One consequence for the reviewer.** A disclosure is a finding even when it looks harmless in place,
because its harm depends on what else a reader can see. When in doubt, treat it as a finding and
replace it with the repository-relative or fictional form that says the same thing.

## 6. Category 3 — references to private projects, products or datasets

**What to look for.** A link, a path, a repository name, a directory name, a package or module name
outside the dependency inventory, a dataset name, an application programming interface endpoint, a
service name, a tool name that is not publicly available, or a comparison naming a private product. Also
look for any claim that this repository is derived from, extracted from, integrated with, or a
reimplementation of something private; for a note that data was obtained from somewhere real; and for a
dataset described as real or third-party when it is synthetic.

**This product's own rule, in one line.** ADEM — the Agent Development Exchange and Marketplace — is a
**new, independent, public open-source foundation**: it is not derived from, and does not integrate
with, any other private repository, product, project, workflow, document or dataset, and its seed data
and its fixtures are invented rather than real. Read alongside that rule:

- Every title, package name, identifier, document and user-interface string uses ADEM or the full name.
  No historic project alias or predecessor name is used or retained anywhere.
- The synthetic demo accounts, the seeded listings, challenges and threads, the case set under
  `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/`, the example pack under
  `examples/extension-fixture-pack/` and the commerce simulation are all fictional. Amounts are integer
  minor units of the synthetic currency `DEMO` and carry no real currency code or symbol, and no
  fixture may be described as real, third-party or captured from production.
- A public dependency named in a manifest, or a public standard named in a document, is a public
  reference rather than a finding. The finding is a reference to something that is not public, or an
  unpublicised piece of work named as though it were.

**Why this one matters beyond tidiness.** A reference to a private project is the one disclosure a
reader can act on directly: it points somewhere, and following it reveals work that was never published
here. A passing scan reports nothing about it, which is the whole reason this category is reviewed by
hand.

## 7. How to run the review

Work in this order, and do not skip step 3.

1. **Read each surface in section 3**, whole files rather than the lines near a change, with all three
   categories in mind at once. The third column of the table names what to read for.
2. **Record every finding**, each as: the repository-relative file path, the line, the quoted text, and
   the replacement made or proposed. A finding recorded without its path or line cannot be checked
   later, and a review that reports only a verdict cannot be re-performed.
3. **Fix or file each finding before signing anything.** Fix the text at its source: a correction to
   `docs/DEPENDENCIES.md` belongs in `scripts/deps-report.ts` or in the manifest that produced it,
   because the document is regenerated and a hand edit is lost on the next run. A name written into a
   test fixture is corrected in the fixture rather than in the assertion that reads it.
4. **Complete the three sign-off lines in section 9** with your own account and the date, replacing
   both placeholders. One line per category: do not sign a category you did not read, and do not fold
   two of them into one line.
5. **Attach the outcome to the pull request** as the artefact `CONTRIBUTING.md` section 8 and the
   pull-request template require: the completed checklist, and every finding with its disposition. A
   finding that is a credential or a suspected disclosure of private information is **never** quoted
   into a public issue, pull request or discussion — report it through the private channel
   `SECURITY.md` section 2 describes, and replace or revoke a live credential before anything else,
   because removing it in a later commit does not remove it from the history.

Three rules bind the reviewer throughout. **If you are unsure whether something is a real name, treat
it as one** — record it, and either replace it with an obvious handle or file it; a doubt is never a
signature. **A change completes this review for the surfaces it touches**, because a review is not
reserved for a new file. And **the review is per category**: a category with a finding left open does
not get a passing result, and the result field on its line says which of the two outcomes the reviewer
reached.

## 8. What this review does not cover

Each of these is somebody else's check or nobody's, and naming them keeps this checklist from being
read as a wider assurance than it is.

- **Licence compliance.** Whether a dependency's licence is allowed is decided by `npm run deps:report`
  against the allowlist data in `scripts/license-allowlist.json`, and the generated result is
  `docs/DEPENDENCIES.md`. This review reads the attribution and licence files an author wrote; it does
  not decide whether a licence permits something.
- **Prohibited dependency classes and providers.** Payment, analytics and advertising packages are
  caught by `npm run scan:exclusions` through `scripts/exclusion-rules.ts` and the provider digests in
  `scripts/blocked-provider-hashes.json`. This review does not read the dependency graph.
- **Personal data protection law, regulatory conformance and compliance certification.** Nothing here is
  a legal or compliance opinion, and no surface of this repository claims certification, independent
  verification or universal safety.
- **Security review of the code.** This review reads text for real identities and private references. It
  says nothing about whether the system is secure: `docs/THREAT-MODEL.md` states what the system does
  and does not defend, `SECURITY.md` sections 6 and 7 list the deliberate non-goals and the two expected
  non-vulnerabilities, and `docs/shield/EXCLUSIONS.md` states Shield's own limits for its adopters.
- **Reporting a vulnerability or a committed credential.** That is the private channel `SECURITY.md`
  describes, not this checklist. A live credential is replaced or revoked first, and the exposed history
  is treated as exposed.
- **The code of a community extension.** An extension is its author's responsibility under the licence
  it declares; this review reads an extension's visible text, its attribution and its licence holder
  line, and neither reviews nor endorses what its code does.
- **An earlier commit's content.** This review reads the working tree. Fixing a finding in the current
  file does not remove it from the history that holds the earlier version, which is why a disclosure of
  a credential is handled by replacement or revocation rather than by a later edit.

## 9. Sign-off

Each category is signed separately, because the three fail for different reasons — a name, a disclosure
that only context reveals, and a reference that points at private work — and one combined pass or fail
would hide which of them was actually read. Replace both placeholders on a line with your own account
and the date you completed that category, and leave the line exactly as it stands until you have.

```
Sign-off (personal names): reviewer <REVIEWER-ACCOUNT-PLACEHOLDER> — date <YYYY-MM-DD> — result <PASS | FINDINGS FILED>
Sign-off (contextual disclosure): reviewer <REVIEWER-ACCOUNT-PLACEHOLDER> — date <YYYY-MM-DD> — result <PASS | FINDINGS FILED>
Sign-off (references to private projects): reviewer <REVIEWER-ACCOUNT-PLACEHOLDER> — date <YYYY-MM-DD> — result <PASS | FINDINGS FILED>
```
