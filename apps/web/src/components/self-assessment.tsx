/**
 * The Academy's readiness self-assessment: a short questionnaire a developer fills in privately.
 *
 * Two properties are deliberate. `scoreSelfAssessment` is exported on its own so the scoring can be
 * read and checked without rendering anything, and it is pure — the same answers always produce the
 * same result. The component keeps its state in React and writes nowhere: no storage, no cookie, no
 * URL parameter, no request.
 */
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

/** The closed answer vocabulary: no free-text answers, so the scoring is deterministic. */
export type ReadinessAnswer = "yes" | "partly" | "no";

export interface ReadinessQuestion {
  readonly id: string;
  readonly prompt: string;
  /** How much this question contributes; a positive integer, so no fraction is ever needed. */
  readonly weight: number;
}

export interface ReadinessResult {
  /** Points awarded, a non-negative integer. */
  readonly points: number;
  /** The maximum this questionnaire can award, a positive integer. */
  readonly maxPoints: number;
  /** The awarded share, an integer percent (0-100), rounded half up from the two integers above. */
  readonly percent: number;
  /** The ids of the questions whose answer was not `"yes"`, in questionnaire order. */
  readonly gaps: readonly string[];
  /** A short, plain-language tier derived from `percent` by documented thresholds. */
  readonly tier: string;
}

/** The Academy's readiness questionnaire, frozen. Fictional content only. */
export const READINESS_QUESTIONS: readonly ReadinessQuestion[] = Object.freeze([
  Object.freeze({
    id: "fixture-set",
    prompt:
      "Does the candidate run against a fixed set of test cases whose expected outputs were recorded before it ran?",
    weight: 2,
  }),
  Object.freeze({
    id: "deterministic-outputs",
    prompt:
      "Does the same recorded input always produce the same output, with no dependence on the clock, the machine or a random source?",
    weight: 2,
  }),
  Object.freeze({
    id: "declared-limitations",
    prompt:
      "Does the listing state in writing what the agent does not do, or where it is known to fail?",
    weight: 2,
  }),
  Object.freeze({
    id: "linked-evidence",
    prompt:
      "Can each claim on the listing be read next to the recorded evidence that supports it?",
    weight: 2,
  }),
  Object.freeze({
    id: "declared-license",
    prompt: "Has a license been declared for the candidate being offered?",
    weight: 1,
  }),
  Object.freeze({
    id: "stable-version-identifier",
    prompt:
      "Does every candidate carry a version identifier that will not change once it has been published?",
    weight: 1,
  }),
]);

interface AnswerOption {
  readonly value: ReadinessAnswer;
  readonly label: string;
}

/** The three answer options every question offers, in reading order. */
const ANSWER_OPTIONS: readonly AnswerOption[] = [
  { value: "yes", label: "Yes" },
  { value: "partly", label: "Partly" },
  { value: "no", label: "No" },
];

/** The id of the hint that explains why the submit control is disabled. */
const SUBMIT_HINT_ID = "self-assessment-submit-hint";

/**
 * Readiness bands, keyed on the integer percent: 85-100 "Strong readiness", 60-84 "Mostly ready",
 * 30-59 "Partly ready", 0-29 "Early stage". Plain-language bands, never an approval.
 */
function describeTier(percent: number): string {
  if (percent >= 85) {
    return "Strong readiness";
  }
  if (percent >= 60) {
    return "Mostly ready";
  }
  if (percent >= 30) {
    return "Partly ready";
  }
  return "Early stage";
}

/**
 * Scores an answer set against a questionnaire. Pure: no clock, no locale, no random source, no I/O,
 * no storage, no DOM — and no dependence on the order of `answers`' keys, because the fold runs over
 * `questions`, so two calls with equal arguments return deeply equal results.
 *
 * Award rule: `"yes"` awards the question's whole weight, `"partly"` awards half the weight rounded
 * down, and anything else — `"no"`, an unanswered question, or a value outside the vocabulary —
 * awards nothing.
 * Gap rule: `gaps` lists every question whose answer is not `"yes"`, in questionnaire order, so a
 * `"partly"` answer is a gap too even though it awarded points.
 * Rounding rule: `percent` is `Math.round((points / maxPoints) * 100)`, and 0 when `maxPoints` is 0.
 * A question id in `answers` that no question in `questions` carries is ignored.
 */
export function scoreSelfAssessment(
  answers: Readonly<Record<string, ReadinessAnswer>>,
  questions: readonly ReadinessQuestion[] = READINESS_QUESTIONS,
): ReadinessResult {
  let points = 0;
  let maxPoints = 0;
  const gaps: string[] = [];

  for (const question of questions) {
    // A caller-supplied questionnaire may carry a non-positive weight; clamping keeps `points`,
    // `maxPoints` and `percent` inside the ranges this result documents.
    const weight = question.weight > 0 ? question.weight : 0;
    maxPoints += weight;

    const answer = answers[question.id];
    if (answer === "yes") {
      points += weight;
    } else {
      if (answer === "partly") {
        points += Math.floor(weight / 2);
      }
      // The gap list is what the reader works through next, so a partly-met question belongs in it
      // even though it was awarded points.
      gaps.push(question.id);
    }
  }

  const percent = maxPoints === 0 ? 0 : Math.round((points / maxPoints) * 100);

  return { points, maxPoints, percent, gaps, tier: describeTier(percent) };
}

/**
 * The Academy's locally scored readiness questionnaire. Rendering only: it calls no API, writes
 * nothing to storage, and refuses to describe its result as an evaluation, a score issued by anyone
 * else, or a promise about how a real evaluation would turn out.
 */
export function SelfAssessment(): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, ReadinessAnswer>>({});
  const [result, setResult] = useState<ReadinessResult | null>(null);

  const promptsById = useMemo((): Map<string, string> => {
    const prompts = new Map<string, string>();
    for (const question of READINESS_QUESTIONS) {
      prompts.set(question.id, question.prompt);
    }
    return prompts;
  }, []);

  const hasAnyAnswer = Object.keys(answers).length > 0;

  const handleAnswerChange = (questionId: string, value: ReadinessAnswer): void => {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setResult(scoreSelfAssessment(answers));
  };

  // Nothing is persisted anywhere, so clearing React state and the form controls is the whole reset.
  const handleReset = (): void => {
    setAnswers({});
    setResult(null);
  };

  // The Academy page owns this component's section heading; rendering one here would duplicate it.
  return (
    <div className="self-assessment">
      <p>
        Answer as many questions as you can for the candidate you are preparing. Your answers are
        scored here in the browser, stay in this page and are not submitted anywhere.
      </p>

      <form className="self-assessment__form" onSubmit={handleSubmit} onReset={handleReset}>
        {READINESS_QUESTIONS.map((question) => (
          <fieldset className="field" key={question.id}>
            <legend className="field__label">{question.prompt}</legend>
            <div className="field__group">
              {ANSWER_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name={question.id}
                    value={option.value}
                    checked={answers[question.id] === option.value}
                    onChange={() => handleAnswerChange(question.id, option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="self-assessment__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!hasAnyAnswer}
            aria-describedby={hasAnyAnswer ? undefined : SUBMIT_HINT_ID}
          >
            See my result
          </button>
          <button type="reset" className="button button--secondary">
            Start over
          </button>
        </div>

        {hasAnyAnswer ? null : (
          <p className="field__hint" id={SUBMIT_HINT_ID}>
            See my result becomes available once at least one question has been answered.
          </p>
        )}
      </form>

      {result === null ? null : (
        <div className="status-region" role="status" aria-live="polite">
          <div className="notice notice--info self-assessment__result">
            <h3>Your readiness result</h3>
            <p>
              <strong>{result.points}</strong> of {result.maxPoints} points ({result.percent}%)
              {" — "}
              <strong>{result.tier}</strong>.
            </p>

            {result.gaps.length === 0 ? (
              <p>Every question was answered "Yes".</p>
            ) : (
              <>
                <p>These questions were not answered "Yes":</p>
                <ul className="self-assessment__gaps">
                  {result.gaps.map((questionId) => (
                    <li key={questionId}>{promptsById.get(questionId) ?? questionId}</li>
                  ))}
                </ul>
              </>
            )}

            <p>
              This result was computed locally in your browser from the answers above. Nothing was
              sent anywhere and nothing is saved, so reloading the page clears it. Change an answer
              and choose See my result to score it again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
