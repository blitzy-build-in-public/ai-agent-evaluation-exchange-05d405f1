/**
 * The `/academy` page: the Gate Readiness Academy.
 *
 * The page is static. It calls nothing — no API client, no storage, no cookie and no request of
 * any kind — so it renders the same content whether or not the API is reachable. Its one
 * interactive part is `../components/self-assessment`, which scores its questionnaire in the
 * browser and persists nothing.
 *
 * Two boundaries this file holds on purpose, each of which a later reader could otherwise
 * "improve" into a bug:
 *
 *   - The pass rule is stated as the standard's own: a candidate passes when at least as many
 *     cases match as the standard version publishes as its threshold, and no `critical` case
 *     fails. The threshold and the critical-case count are provisional for this release, are
 *     versioned with the standard version a report names, and change only through a reviewed
 *     proposal that publishes a new version. No wording here restates them any other way.
 *
 *   - Every link is an internal route. Fastify serves the built single-page app and no
 *     documentation directory, so a path into one would be answered by the SPA fallback with
 *     `index.html` rather than by the document it names.
 */

import { Link } from "react-router-dom";

import {
  BADGE_SCOPE,
  NO_REPORT_LABEL,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
  SYNTHETIC_CURRENCY_LABEL,
} from "@adem/shared";

import { SelfAssessment } from "../components/self-assessment";

/** One gate-readiness module: the section it renders, its heading, and what it teaches. */
interface ReadinessModule {
  /** The section's `id`, which the in-page link list at the top of the page points at. */
  readonly id: string;
  /** The module heading, rendered as an `<h2>`. */
  readonly heading: string;
  /** The module's guidance, each entry a paragraph of its own. */
  readonly guidance: readonly string[];
  /** The module's checkable points, rendered as a real list rather than as more prose. */
  readonly checks: readonly string[];
}

/**
 * The modules, in reading order. Each answers a question a developer preparing a candidate
 * actually has, and each states a rule of this product rather than a paraphrase of one: what the
 * standard asks for, how a pass is decided, what a listing should declare, what the label and the
 * badge mean, and how to read a report that failed.
 */
const MODULES: readonly ReadinessModule[] = [
  {
    id: "academy-standard",
    heading: "What SGI-SO-1.0.0 asks for",
    guidance: [
      'The standard is SGI-SO-1.0.0, "Structured Output Conformance". It asks one narrow question: does the candidate produce the structured output its fixture set expects? It asks nothing about how the candidate is built, how quickly it responds or what else it can do.',
      "A candidate is a declarative submission: the identifier of the version being evaluated, plus one recorded output for each fixture case. The evaluator compares that recorded data and runs nothing — no candidate code is executed, imported or interpreted.",
      "The fixture set, the cases it holds, which of them are critical and the expected output of each are all fixed before the evaluation, and they belong to the versioned standard the report names rather than to this page.",
    ],
    checks: [
      "Every case needs its own recorded output. A submission that is missing one is refused before any report is written.",
      "Nothing in a run depends on the clock, the machine or a random source, so the same submission produces the same per-case results every time.",
      "A case marked critical is judged on its own: it carries the weight the standard gives it, whichever other cases match.",
    ],
  },
  {
    id: "academy-pass-rule",
    heading: "How a pass is decided",
    guidance: [
      "A candidate passes when at least as many cases match as the standard version publishes as its threshold and no critical case fails. Anything else is FAIL, however many of the other cases matched.",
      "A match is decided on canonical JSON: property order is fixed and insignificant whitespace is removed before the comparison, so the recorded output is compared as a stable document rather than as text a formatter could change.",
      "The threshold and the critical-case count are provisional for this release and versioned with the standard. A later version changes them by being proposed, reviewed and published as a new version — never by an edit to the version a report was scored against.",
    ],
    checks: [
      "One failed critical case is a FAIL even when every other case matched.",
      `A completed evaluation records a fictional gate-evaluation fee in the gate-fee ledger only, counted in minor units of the synthetic currency ${SYNTHETIC_CURRENCY_LABEL}, whether the outcome is PASS or FAIL.`,
      "The fee buys no influence over the outcome. An evaluation is decided by the recorded evidence alone, and paying for one never guarantees a pass.",
    ],
  },
  {
    id: "academy-listing-claims",
    heading: "What a listing should state",
    guidance: [
      "A buyer compares what a listing claims against what was measured. Claims, limitations, the evidence summary, the license and the pricing model describe the version being offered, so write them for that version rather than for the project as a whole.",
      "Keep every claim checkable. The compare view sets two to four listings side by side with their measured evidence, and a claim a buyer cannot read next to evidence is one they have to take on trust.",
    ],
    checks: [
      "State in writing what the candidate does not do, and where it is known to fail.",
      "Give the version an identifier that will not change once it has been published; a published version is append-only and nothing edits it.",
      "Declare a license for the candidate you are offering, and say which of the offers — rent, purchase, license or subscription — the listing makes.",
    ],
  },
  {
    id: "academy-labels",
    heading: "What the label and the badge mean",
    guidance: [
      `Every report carries exactly one label from a closed vocabulary of two: ${REPORT_LABEL_SAMPLE} for a version seeded as a fixture candidate, and ${REPORT_LABEL_VERIFIED_IN_DEMO} for a version published through the API. The label states where the run came from, never that it passed.`,
      `A badge is issued on a pass, and it names the standard version, the report identifier and the scope "${BADGE_SCOPE}". That scope is the whole of what a badge measures.`,
      `A version with no report yet shows "${NO_REPORT_LABEL}" rather than an outcome or a badge, and a report that failed shows its per-case evidence and carries no badge at all.`,
    ],
    checks: [
      "Neither the label nor the badge is a statement about general safety or security, and neither is an independent certification of anything.",
      "A retest creates a new report linked to the one before it, and the earlier report stays exactly as it was, so a history of runs reads in order.",
      "Reports, standard versions and governance events are append-only, which is what lets a buyer read later the same evidence the developer read at the time.",
    ],
  },
  {
    id: "academy-failing-report",
    heading: "How to read a failing report",
    guidance: [
      "A failing report is evidence rather than a verdict on the project. It lists every case with the expected output, the recorded output and whether the two matched, so the failing cases are visible one by one.",
      "Reading it in order is usually enough: one critical case that did not match fails the candidate on its own, and a run that matched fewer cases than the standard version publishes as its threshold fails on that threshold even when every critical case matched.",
      "If a report is wrong about the evidence a submission gave it, open an appeal against the report. A ruling is recorded as an appended governance event and leaves the report itself unchanged, so the evidence a ruling answers stays readable.",
    ],
    checks: [
      "Correct what the failing cases show and run the evaluation again: a retest adds a new report and leaves the earlier one readable.",
      "Check the submission before checking the candidate. A case whose recorded output was copied or formatted wrongly fails for that reason alone.",
    ],
  },
];

/**
 * The Academy: what a candidate and its evidence need before an evaluation, and a closed
 * questionnaire a developer answers privately.
 *
 * This page owns the route's single `<main>` landmark and its single `<h1>`, so the shell — which
 * renders the header, the navigation, the demonstration banner and the account switcher — must not
 * wrap it in another landmark. The heading outline it produces is `h1`, then one `h2` per module
 * and for the self-assessment, and the assessment's own result sits under an `h3` inside that
 * section, so no level is skipped.
 */
export function Academy(): JSX.Element {
  return (
    // `id` is the target the shell's skip link points at, and `tabIndex={-1}` is what lets that
    // link move focus here without putting the landmark itself in the tab order.
    <main id="main-content" tabIndex={-1} className="page page-academy">
      <section aria-labelledby="academy-purpose-heading">
        <h1 id="academy-purpose-heading">Gate readiness</h1>
        <p>
          The Academy helps you judge whether a listing and the evidence behind it are ready for an
          SGI evaluation, by working through short modules and a self-assessment.
        </p>
        <p>
          The self-assessment is scored locally in your browser. Your answers stay in this page,
          nothing is submitted anywhere and nothing is saved, so reloading the page clears them.
        </p>
        <p>
          The Academy is guidance about your own readiness. It is not an evaluation, not a score,
          not a certification and not a prediction of a pass: the outcome of an evaluation depends
          on test evidence only.
        </p>
      </section>

      <nav aria-labelledby="academy-contents-heading">
        <h2 id="academy-contents-heading">On this page</h2>
        <ul>
          {MODULES.map((module) => (
            <li key={module.id}>
              <a href={`#${module.id}`}>{module.heading}</a>
            </li>
          ))}
          <li>
            <a href="#academy-self-assessment">Check your own readiness</a>
          </li>
        </ul>
      </nav>

      {/* Each module is a target of the in-page list above. `tabIndex={-1}` lets an anchor
          activated from that list move focus into the module rather than only scrolling to it, so
          a keyboard reader arrives at the guidance instead of at the top of the page. */}
      {MODULES.map((module) => (
        <section
          key={module.id}
          id={module.id}
          tabIndex={-1}
          aria-labelledby={`${module.id}-heading`}
        >
          <h2 id={`${module.id}-heading`}>{module.heading}</h2>
          {module.guidance.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <ul>
            {module.checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </section>
      ))}

      <section id="academy-self-assessment" aria-labelledby="academy-self-assessment-heading">
        <h2 id="academy-self-assessment-heading">Check your own readiness</h2>
        <p>
          Answer the questions below for the candidate you are preparing. The questionnaire marks
          its own answers in this page and gives a plain-language reading of what you told it — not
          an evaluation, not evidence, and not a prediction of how an evaluation would turn out.
        </p>
        <SelfAssessment />
      </section>

      <section aria-labelledby="academy-next-steps-heading">
        <h2 id="academy-next-steps-heading">Next steps</h2>
        <ul>
          <li>
            <Link to="/standards">Read the standard and its proposals</Link>
          </li>
          <li>
            <Link to="/developer">Publish a version and run an evaluation</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}

// The default export is what app.tsx's route table imports; the named export is what a test or a
// sibling page imports. Both exist on purpose.
export default Academy;
