import { Link } from "react-router-dom";

import {
  BADGE_SCOPE,
  DEMO_AUTHENTICATION_LABEL,
  FOUNDER_ALLOCATION_CONTRACT_LABEL,
  NO_REPORT_LABEL,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
  SPONSORED_LABEL,
  SYNTHETIC_CURRENCY_LABEL,
} from "@adem/shared";

/**
 * The `/mission` route: what ADEM is, who it serves, the loop it exists to close, how its
 * standard is governed, and — the section that carries the most weight — what it deliberately
 * does not do.
 *
 * Static copy. The page reads no data, calls no API and holds no state, so it renders no
 * loading, empty, error or throttled state, and it imports no API client: nothing on it can
 * fail, and every sentence it shows is true of this repository as it stands. The closed
 * vocabulary below is imported from `@adem/shared` rather than written out again here, because
 * a label repeated in a page drifts away from the value the API, the badge, the ledger and the
 * end-to-end assertions all agree on.
 *
 * This page owns the document's single `<main>` landmark and its single `<h1>`; the shell
 * renders the header, the navigation, the demonstration banner and no landmark of its own.
 * `id="main-content"` and `tabIndex={-1}` are a pair with the shell's bypass link — the id is
 * that link's target and `tabIndex` is what lets the link move focus here without putting
 * `<main>` in the tab order — so neither is a free name to rename.
 *
 * The class names follow the stylesheet's convention: `.mission` is the block and
 * `.mission__lead`, `.mission__section` and `.mission__list` are its elements, alongside the
 * shared `.page`, `.page-mission` and `.item-list` classes the stylesheet already styles.
 */
export function Mission(): JSX.Element {
  return (
    <main id="main-content" tabIndex={-1} className="page page-mission">
      <h1>The ADEM mission</h1>

      <p className="mission__lead">
        ADEM — the Agent Development Exchange and Marketplace — is a new, independent, public
        open-source foundation for an AI agent exchange. Its purpose is narrow and can be stated
        plainly: an independent developer or a small team should be able to publish an agent
        without asking anyone's permission, and a buyer should be able to compare what a listing
        claims with what was actually measured.
      </p>

      <section className="mission__section" aria-labelledby="mission-what-adem-is">
        <h2 id="mission-what-adem-is">What ADEM is</h2>
        <p>
          Developers list agents and agent groups. A listing carries the versions its developer
          has published, the claims and the limitations that developer states, its license and
          its pricing model. Buyers search, filter and compare two to four listings side by
          side, where each column sets the developer's claims against the measured evidence for
          the version on offer. A community-governed Standard Gate Index (SGI) produces
          reproducible PASS or FAIL reports from deterministic fixtures. ADEM Shield Basic is a
          separate, free package that enforces allow and deny policy on tool calls. Every
          commercial surface is a labelled, nonfunctional simulation.
        </p>
        <p>
          This release carries one provisional standard, <code>SGI-SO-1.0.0</code> — Structured
          Output Conformance. A candidate submits one recorded output for each case in a fixture
          set of 20 cases, 5 of which are critical. The standard passes a candidate when at least
          18 of the 20 cases match and no critical case fails, and fails it otherwise; the
          thresholds are provisional and versioned with the standard rather than fixed in code.
          Nothing is executed: a submission is data compared against fixed expected outputs.
        </p>
        <p>
          This repository is the working first version of that foundation — one process, one
          SQLite file, no external service, no environment variable and no secret — and it runs
          locally from the commands the README documents.
        </p>
      </section>

      <section className="mission__section" aria-labelledby="mission-who-it-serves">
        <h2 id="mission-who-it-serves">Who ADEM serves</h2>
        <p>Four roles use the exchange, with different work to do on it.</p>
        <ul className="item-list mission__list">
          <li className="item-list__item">
            <strong>Developer.</strong> Lists agents and versions, runs simulated evaluations
            against them, and answers the challenges a buyer raises about a claim.
          </li>
          <li className="item-list__item">
            <strong>Buyer.</strong> Searches, filters and compares listings, reads the limitations
            a developer has stated, posts challenges and inquiries, and runs a simulated
            checkout.
          </li>
          <li className="item-list__item">
            <strong>Community contributor.</strong> Proposes standards and tests, takes part in
            discussion, and contributes open code, fixture packs and evaluator checks through the
            repository's extension seams.
          </li>
          <li className="item-list__item">
            <strong>Operator.</strong> Moderates listings, reviews standards proposals, rules on
            appeals, and reads the append-only records. An operator cannot alter a measurement:
            moderation, review and a ruling append an event, and the report, the standard version
            and the ledger entries stay exactly as they were written.
          </li>
        </ul>
        <p>
          Anyone may browse the exchange, read the documentation and use ADEM Shield Basic
          without an account. The demonstration accounts exist only so that the write actions on
          this site can be performed, and they are synthetic.
        </p>
      </section>

      <section className="mission__section" aria-labelledby="mission-developer-to-buyer">
        <h2 id="mission-developer-to-buyer">The developer-to-buyer loop</h2>
        <p>
          A developer publishes a listing and a version of it, runs a simulated SGI evaluation on
          that version, and receives a reproducible report: the same submission scored again
          yields the same per-case results and the same outcome, because the fixtures, the
          expected outputs and the pass rule are fixed data. A report that passes carries a
          sample badge. A buyer then finds the listing through search, compares it with another,
          posts an inquiry, and completes a simulated checkout. A listing that has not been
          evaluated yet shows "{NO_REPORT_LABEL}" in place of an outcome, which is a state of the
          product rather than a failure. Every step of the loop runs on synthetic data.
        </p>
      </section>

      <section className="mission__section" aria-labelledby="mission-governance">
        <h2 id="mission-governance">How the standard is governed</h2>
        <p>
          Standards and their pass thresholds change in exactly one way: by creating a new
          standard version through the SGI proposal and review process. An existing standard
          version is never edited, because an identifier that is meant to be immutable is only
          worth something while nothing rewrites it.
        </p>
        <p>
          A proposal starts as <code>submitted</code>. Operator review moves it to{" "}
          <code>accepted</code> or <code>rejected</code> and appends a governance event that
          records who decided and why; a review never rewrites the proposal's own text. Standard
          versions, evaluation reports, their per-case results, governance events and ledger
          entries are append-only, and no route in the API updates or deletes one. An appeal
          ruling appends an event and leaves the report it concerns exactly as it was written,
          and a change to a standard is a new version rather than a correction of an old one.
        </p>
        <p>
          There is no automated governance: a proposal needs human review, and the standard, the
          scoring code and the security-critical packages require maintainer review before a
          change merges. The direction of travel is community governance, and the proposal and
          review process is the mechanism a community takes over.
        </p>
      </section>

      <section className="mission__section" aria-labelledby="mission-limits">
        <h2 id="mission-limits">What ADEM does not do</h2>
        <p>
          These limits are part of the product rather than caveats added to it. Each one
          describes what this repository is today.
        </p>
        <ul className="item-list mission__list">
          <li className="item-list__item">
            <strong>No production authentication.</strong> The demonstration accounts are synthetic
            rows selected by a request header, and the label that stands beside the switcher reads
            "{DEMO_AUTHENTICATION_LABEL}". There is no sign-in, no credential store and no real
            identity anywhere in this repository.
          </li>
          <li className="item-list__item">
            <strong>Commerce here is a simulation.</strong> Every amount is an integer count of
            minor units of the synthetic currency {SYNTHETIC_CURRENCY_LABEL}: there is no real
            currency code or symbol in the product, no money moves, and no payment provider is
            integrated. The founder-participation allocation is a provisional, configurable share
            of an eligible simulated transaction, and its contract structure is labelled "
            {FOUNDER_ALLOCATION_CONTRACT_LABEL}"; it carries no personal identity, beneficiary
            account or entitlement.
          </li>
          <li className="item-list__item">
            <strong>A report is evidence about one fixture set.</strong> A report carries exactly
            one of two labels, {REPORT_LABEL_SAMPLE} or {REPORT_LABEL_VERIFIED_IN_DEMO}, chosen
            from where the measured version came from and never from who paid for it. The badge
            names the standard version, the report ID and the scope "{BADGE_SCOPE}". The outcome
            is decided by test evidence alone, and buying an evaluation never guarantees a pass.
            Nothing here is independent certification, and no badge or report says anything about
            general safety or certified security.
          </li>
          <li className="item-list__item">
            <strong>Shield is a policy engine, not a gate pass.</strong> ADEM Shield Basic is free
            and needs no signup. It denies a tool call by default when no rule matches, and a call
            that needs approval stays blocked until an approval is recorded. It is not a pass
            through the Standard Gate Index, not a certification and not a security guarantee,
            and it ships with a documented threat model and a list of what it excludes.
          </li>
          <li className="item-list__item">
            <strong>Sponsored slots are a demonstration.</strong> Every sponsored item carries the
            label {SPONSORED_LABEL}, sponsored items are kept out of organic ordering, and there
            is no personalized tracking and no analytics beyond aggregate local counters.
          </li>
          <li className="item-list__item">
            <strong>The privacy review is manual.</strong> The automated exclusion scan looks for
            a small number of detectable patterns — credential and secret shapes, contact details
            and prohibited dependencies — and it is supplementary: it does not guarantee that no
            private information is present. A maintainer reviews the repository against a written
            checklist.
          </li>
          <li className="item-list__item">
            <strong>No submitted code is executed.</strong> An evaluation compares recorded
            outputs as data against fixed expected outputs. Third-party agent code submitted as a
            candidate is never run, and this repository holds no sandbox, no live orchestration
            and no deployment of it.
          </li>
          <li className="item-list__item">
            <strong>No external service, and no deployment.</strong> Nothing in the running
            product calls an external service: no payment, analytics or advertising SDK is part
            of it. The one network step in the project's setup is the documented one-time
            download of a test browser for the end-to-end suite. Deployment and public
            announcements are out of scope here and need separate approval.
          </li>
        </ul>
      </section>

      <section className="mission__section" aria-labelledby="mission-take-part">
        <h2 id="mission-take-part">Where to take part</h2>
        <p>Four routes in this running product are a contributor's entry points.</p>
        <ul className="item-list mission__list">
          <li className="item-list__item">
            <Link to="/standards">Read the provisional standard and propose a change</Link>
          </li>
          <li className="item-list__item">
            <Link to="/challenges">Read the public challenges board and answer a question</Link>
          </li>
          <li className="item-list__item">
            <Link to="/threads">Join the discussion threads</Link>
          </li>
          <li className="item-list__item">
            <Link to="/listings">Browse what developers have listed and compare two of them</Link>
          </li>
        </ul>
        <p>
          Code contributions follow the repository's contributor guide, its code of conduct, its
          security policy and its roadmap, and the labeled starter tasks are sized for a first
          change. A new fixture pack, evaluator check or listing category is registered through
          the typed extension seams of the SGI core package, which is why a community addition
          builds and passes without editing the scoring code. How to report a vulnerability, and
          which parts of the repository a security fix covers, is stated in the security policy.
        </p>
      </section>
    </main>
  );
}

// app.tsx's route table imports the default export, and the named export travels with it so the
// page can also be imported by name — the same pair, for the same reason, as not-found.tsx.
export default Mission;
