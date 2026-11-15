/**
 * The Gate Readiness Academy's self-assessment scoring, pinned to the rules its module documents.
 *
 * `apps/web` has no DOM test environment — no such package is in the dependency inventory — so this
 * workspace's unit tests cover pure functions only, and every assertion below is therefore about
 * values: the points a questionnaire's weights award, the gaps it reports, the percent it rounds to
 * and the band that percent falls in. The default questionnaire's own shape is checked here too,
 * because the component renders that questionnaire with no schema of its own behind it.
 *
 * Four properties the module's contract turns on are pinned rather than left to a reader. `percent`
 * resolves an exact half upwards, so a share that lands on `.5` is not lost the way a floor would
 * lose it. A non-positive weight is clamped to zero rather than subtracted, so no caller-supplied
 * questionnaire can drive the maximum below zero. An empty questionnaire answers with a defined zero
 * instead of `NaN`. And the fold runs over the questionnaire, so the answer object's key order cannot
 * move a result and an id no question carries is ignored rather than counted.
 *
 * The document's four bands are checked on the two sides of every boundary: 29 and 30, 59 and 60, 84
 * and 85.
 *
 * No snapshot and no golden file is written, so the snapshot update mode does not bear on this
 * suite: `vitest.unit.config.ts` sets `update: false`, which the runner resolves to `none` under CI
 * — where the gate runs — and to writing a baseline only where the repository has none, locally.
 *
 * The fixtures are synthetic and inline, and every expected number is a literal that follows from
 * the weights the case states beside it, so nothing here asserts a figure the test cannot reason
 * about from the inputs above it.
 */

import { describe, expect, it } from "vitest";

import { READINESS_QUESTIONS, scoreSelfAssessment } from "./self-assessment";
import type { ReadinessAnswer, ReadinessQuestion, ReadinessResult } from "./self-assessment";

/** One synthetic question. Only its `id` and its `weight` reach the scoring. */
function question(id: string, weight: number): ReadinessQuestion {
  return { id, prompt: `Synthetic prompt for ${id}`, weight };
}

/** Every question in `questionnaire` answered the same way, keyed by question id. */
function answersFor(
  questionnaire: readonly ReadinessQuestion[],
  answer: ReadinessAnswer,
): Record<string, ReadinessAnswer> {
  const answers: Record<string, ReadinessAnswer> = {};
  for (const item of questionnaire) {
    answers[item.id] = answer;
  }
  return answers;
}

/** The default questionnaire's six ids, each answered `yes`. */
const ALL_YES: Readonly<Record<string, ReadinessAnswer>> = {
  "fixture-set": "yes",
  "deterministic-outputs": "yes",
  "declared-limitations": "yes",
  "linked-evidence": "yes",
  "declared-license": "yes",
  "stable-version-identifier": "yes",
};

/** The same six ids, each answered `no`, so every one of them is a gap. */
const ALL_NO: Readonly<Record<string, ReadinessAnswer>> = {
  "fixture-set": "no",
  "deterministic-outputs": "no",
  "declared-limitations": "no",
  "linked-evidence": "no",
  "declared-license": "no",
  "stable-version-identifier": "no",
};

/** A hundred weight-1 questions, so a count of `yes` answers is also the exact percent awarded. */
const UNIT_WEIGHT_QUESTIONNAIRE: readonly ReadinessQuestion[] = Array.from(
  { length: 100 },
  (_, index) => question(`synthetic-${index + 1}`, 1),
);

/**
 * Two shares of a weight-8 questionnaire that land on an exact half: `countedWeight` of 8 points.
 * `Math.round` carries both upwards, where a floor would report 12 and 87.
 */
const HALF_BOUNDARIES: readonly (readonly [countedWeight: number, expectedPercent: number, expectedTier: string])[] = [
  [1, 13, "Early stage"], // 1 / 8 = 12.5
  [7, 88, "Strong readiness"], // 7 / 8 = 87.5
];

/** Both sides of each of the document's three band boundaries, as a count of the 100 unit weights. */
const TIER_BOUNDARIES: readonly (readonly [yesAnswers: number, expectedTier: string])[] = [
  [29, "Early stage"],
  [30, "Partly ready"],
  [59, "Partly ready"],
  [60, "Mostly ready"],
  [84, "Mostly ready"],
  [85, "Strong readiness"],
];

/** Weights the module clamps rather than subtracts: one negative, and zero itself. */
const NON_POSITIVE_WEIGHTS: readonly number[] = [-4, 0];

interface ArbitraryCase {
  readonly name: string;
  readonly questionnaire: readonly ReadinessQuestion[];
  readonly answers: Readonly<Record<string, ReadinessAnswer>>;
  readonly expected: ReadinessResult;
}

/** Caller-supplied questionnaires the default one does not cover, with the result each implies. */
const ARBITRARY_CASES: readonly ArbitraryCase[] = [
  {
    name: "a questionnaire of unrelated weights, one of them answered partly",
    questionnaire: [question("odd", 3), question("even", 1), question("heavy", 7)],
    answers: { odd: "partly", even: "no" },
    // floor(3 / 2) = 1 of 11 points; 1 / 11 = 9.09 percent, and the unanswered question is a gap.
    expected: {
      points: 1,
      maxPoints: 11,
      percent: 9,
      gaps: ["odd", "even", "heavy"],
      tier: "Early stage",
    },
  },
  {
    name: "two partly answers, one on an even weight and one on an odd one",
    questionnaire: [question("pair", 2), question("solo", 5)],
    answers: { pair: "partly", solo: "partly" },
    // floor(2 / 2) + floor(5 / 2) = 3 of 7 points; 3 / 7 = 42.85 percent.
    expected: {
      points: 3,
      maxPoints: 7,
      percent: 43,
      gaps: ["pair", "solo"],
      tier: "Partly ready",
    },
  },
  {
    name: "one gap in an otherwise complete questionnaire",
    questionnaire: [
      question("one", 1),
      question("two", 1),
      question("three", 1),
      question("four", 1),
    ],
    answers: { one: "yes", two: "yes", three: "yes", four: "no" },
    // 3 of 4 points = 75 percent.
    expected: {
      points: 3,
      maxPoints: 4,
      percent: 75,
      gaps: ["four"],
      tier: "Mostly ready",
    },
  },
];

describe("scoreSelfAssessment", () => {
  it("scores the default questionnaire's whole maximum when every question is answered yes", () => {
    // The default weights are 2, 2, 2, 2, 1, 1: 10 of 10 points, which is 100 percent, the
    // strongest band, and leaves nothing to work through.
    expect(scoreSelfAssessment(ALL_YES)).toEqual({
      points: 10,
      maxPoints: 10,
      percent: 100,
      gaps: [],
      tier: "Strong readiness",
    });
  });

  it("scores zero and reports every question as a gap when every question is answered no", () => {
    expect(scoreSelfAssessment(ALL_NO)).toEqual({
      points: 0,
      maxPoints: 10,
      percent: 0,
      gaps: [
        "fixture-set",
        "deterministic-outputs",
        "declared-limitations",
        "linked-evidence",
        "declared-license",
        "stable-version-identifier",
      ],
      tier: "Early stage",
    });
  });

  it("scores a mixed answer set as the sum its weights imply and lists every unmet question in order", () => {
    // fixture-set awards its whole weight of 2, linked-evidence awards floor(2 / 2) = 1 and
    // declared-license awards nothing, so 3 of 10 points is 30 percent — the first percent of the
    // "Partly ready" band. The gaps are the four questions left unanswered plus the two answered
    // without a plain yes, in questionnaire order, so the partly answered one sits among them.
    expect(
      scoreSelfAssessment({
        "fixture-set": "yes",
        "linked-evidence": "partly",
        "declared-license": "no",
      }),
    ).toEqual({
      points: 3,
      maxPoints: 10,
      percent: 30,
      gaps: [
        "deterministic-outputs",
        "declared-limitations",
        "linked-evidence",
        "declared-license",
        "stable-version-identifier",
      ],
      tier: "Partly ready",
    });
  });

  it("awards half of an odd weight, rounded down, and still reports the partly answer as a gap", () => {
    const questionnaire: readonly ReadinessQuestion[] = [question("odd", 5)];

    // floor(5 / 2) = 2 of 5 points = 40 percent, and the question the points came from is a gap too.
    expect(scoreSelfAssessment({ odd: "partly" }, questionnaire)).toEqual({
      points: 2,
      maxPoints: 5,
      percent: 40,
      gaps: ["odd"],
      tier: "Partly ready",
    });
  });

  it.each(HALF_BOUNDARIES)(
    "rounds a share that lands on an exact half up: %i of 8 points is %i percent",
    (countedWeight, expectedPercent, expectedTier) => {
      const questionnaire: readonly ReadinessQuestion[] = [
        question("counted", countedWeight),
        question("other", 8 - countedWeight),
      ];

      expect(scoreSelfAssessment({ counted: "yes" }, questionnaire)).toEqual({
        points: countedWeight,
        maxPoints: 8,
        percent: expectedPercent,
        gaps: ["other"],
        tier: expectedTier,
      });
    },
  );

  it.each(TIER_BOUNDARIES)("places %i of 100 points in the %s band", (yesAnswers, expectedTier) => {
    const questionnaire = UNIT_WEIGHT_QUESTIONNAIRE;
    // Every question weighs 1 and there are 100 of them, so the percent is the count of yes answers.
    const answers = answersFor(questionnaire.slice(0, yesAnswers), "yes");

    const result = scoreSelfAssessment(answers, questionnaire);

    expect(result.points).toBe(yesAnswers);
    expect(result.maxPoints).toBe(100);
    expect(result.percent).toBe(yesAnswers);
    expect(result.tier).toBe(expectedTier);
  });

  it.each(ARBITRARY_CASES)(
    "returns the documented result for a caller-supplied $name",
    ({ questionnaire, answers, expected }) => {
      const result = scoreSelfAssessment(answers, questionnaire);

      expect(result).toEqual(expected);
      // The ranges `ReadinessResult` documents hold for any questionnaire a caller supplies.
      expect(Number.isInteger(result.points)).toBe(true);
      expect(Number.isInteger(result.maxPoints)).toBe(true);
      expect(Number.isInteger(result.percent)).toBe(true);
      expect(result.points).toBeGreaterThanOrEqual(0);
      expect(result.points).toBeLessThanOrEqual(result.maxPoints);
      expect(result.percent).toBeGreaterThanOrEqual(0);
      expect(result.percent).toBeLessThanOrEqual(100);
      // The gap rule read back from the questionnaire itself: exactly the ids not answered "yes".
      expect(result.gaps).toEqual(
        questionnaire.filter((item) => answers[item.id] !== "yes").map((item) => item.id),
      );
    },
  );

  it.each(NON_POSITIVE_WEIGHTS)("clamps the non-positive weight %i instead of subtracting it", (weight) => {
    const questionnaire: readonly ReadinessQuestion[] = [
      question("counted", 3),
      question("zeroed", weight),
    ];
    const score = (): ReadinessResult => scoreSelfAssessment(answersFor(questionnaire, "yes"), questionnaire);

    expect(score).not.toThrow();
    // Only the weight-3 question contributes: 3 of 3 points = 100 percent, and nothing is a gap.
    expect(score()).toEqual({
      points: 3,
      maxPoints: 3,
      percent: 100,
      gaps: [],
      tier: "Strong readiness",
    });
  });

  it("returns a defined zero result for an empty questionnaire rather than NaN or a throw", () => {
    const questionnaire: readonly ReadinessQuestion[] = [];
    const noAnswers = (): ReadinessResult => scoreSelfAssessment({}, questionnaire);
    const strayAnswers = (): ReadinessResult =>
      scoreSelfAssessment({ "not-a-question": "yes" }, questionnaire);

    expect(noAnswers).not.toThrow();
    expect(strayAnswers).not.toThrow();
    // A maximum of 0 is answered with a percent of 0, never a division by zero.
    expect(noAnswers()).toEqual({
      points: 0,
      maxPoints: 0,
      percent: 0,
      gaps: [],
      tier: "Early stage",
    });
    expect(strayAnswers()).toEqual(noAnswers());
  });

  it("ignores an answer id that no question in the questionnaire carries", () => {
    const questionnaire: readonly ReadinessQuestion[] = [question("counted", 3)];

    // A stray "yes" cannot add points: the fold visits the questionnaire, not the answer object.
    expect(scoreSelfAssessment({ counted: "no", "not-a-question": "yes" }, questionnaire)).toEqual({
      points: 0,
      maxPoints: 3,
      percent: 0,
      gaps: ["counted"],
      tier: "Early stage",
    });
    // A stray "no" cannot become a gap either: gaps holds the questionnaire's own ids.
    expect(scoreSelfAssessment({ counted: "yes", "not-a-question": "no" }, questionnaire)).toEqual({
      points: 3,
      maxPoints: 3,
      percent: 100,
      gaps: [],
      tier: "Strong readiness",
    });
  });

  it("returns deeply equal results for equal arguments and is unmoved by the answer object's key order", () => {
    const questionnaire: readonly ReadinessQuestion[] = [
      question("first", 2),
      question("second", 1),
      question("third", 2),
    ];
    const answers: Readonly<Record<string, ReadinessAnswer>> = {
      first: "yes",
      second: "partly",
      third: "no",
    };
    const reordered: Readonly<Record<string, ReadinessAnswer>> = {
      third: "no",
      second: "partly",
      first: "yes",
    };

    // 2 + floor(1 / 2) + 0 = 2 of 5 points = 40 percent.
    const expected: ReadinessResult = {
      points: 2,
      maxPoints: 5,
      percent: 40,
      gaps: ["second", "third"],
      tier: "Partly ready",
    };
    const once = scoreSelfAssessment(answers, questionnaire);
    const again = scoreSelfAssessment(answers, questionnaire);

    expect(once).toEqual(expected);
    expect(again).toEqual(once);
    // The two answer objects really do carry different key orders, so the comparison below means
    // something: the result depends on the questionnaire alone.
    expect(Object.keys(answers)).toEqual(["first", "second", "third"]);
    expect(Object.keys(reordered)).toEqual(["third", "second", "first"]);
    expect(scoreSelfAssessment(reordered, questionnaire)).toEqual(once);
  });
});

describe("READINESS_QUESTIONS", () => {
  it("carries a unique id and a positive integer weight on every question", () => {
    const ids = READINESS_QUESTIONS.map((item) => item.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of READINESS_QUESTIONS) {
      expect(Number.isInteger(item.weight)).toBe(true);
      expect(item.weight).toBeGreaterThan(0);
    }
    // The maximum the default questionnaire can award, which the all-yes case above spends in full.
    expect(READINESS_QUESTIONS.reduce((total, item) => total + item.weight, 0)).toBe(10);
  });
});
