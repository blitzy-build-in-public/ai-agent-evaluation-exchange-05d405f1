# Add an evaluator check through the EvaluatorCheck seam

Labels: P1, good-first-issue, milestone M4

## Scope

The scorer's built-in comparison of a case's recorded output is deliberately the only decider until a
check is handed to it, which is what makes a contribution possible without a core change: a check
contributed through this seam decides the cases it declares, and every other case keeps the built-in
verdict. Your task is to write one, register it through the exported interface alone, and prove that
`packages/sgi-core/src/scoring/` was not edited to make it work.

You write three things and nothing else.

1. **Your check**, an object satisfying `EvaluatorCheck` as
   `packages/sgi-core/src/extensions/evaluator-check.ts` declares it: `id` (the stable machine key a
   report's provenance and an operator's diagnostics name it by), `title` (the human-facing label),
   `appliesTo` (the fixture case ids this check decides, at least one of them) and
   `compare(expected, actual)`. Declare `compare` as a method so a plain object literal satisfies the
   seam without a class.
2. **Its verdicts.** `compare` returns the whole `CaseComparison` the report stores — the four
   members the built-in path returns, including the canonical expected and actual strings the per-case
   evidence is written from — never a bare `match` flag, because a verdict without its evidence leaves
   the report's evidence empty. The recorded side may legitimately be `undefined`: a submission may
   answer fewer cases than the standard version defines, and that is a defined input, so return a
   non-match with reason `absent` and an empty actual canonical exactly as the built-in comparison
   does rather than raising.
3. **Its registration.** A check reaches the scoring path through the options the scorer takes;
   `validateEvaluatorCheck` runs before the check becomes reachable and refuses a value with a missing
   or blank `id` or `title`, an empty `appliesTo`, or a `compare` that is not a function, throwing
   `EvaluatorCheckValidationError` with the stable code `seam_validation` and the `field` that failed.
   The first check in the array whose `appliesTo` holds a case id decides that case, so ordering is
   the precedence rule and a repeated id in `appliesTo` is never reached.

**What must not change.** The fixture case set, the standard version, its pass rule and every file
under `packages/sgi-core/src/scoring/` stay exactly as they are. Your check changes how the cases it
declares are judged; it does not change what the standard requires, and it can never turn a `FAIL`
into a `PASS` for a case it does not decide.

**Reproducibility covers your check.** The product's promise is that the same fixture evaluated twice
yields identical per-case results and outcome, and a contributed check is inside that promise: your
`compare` reads no clock, locale, timezone, random source, environment or file, and compares plain
JSON data. A check whose verdict varies between two runs breaks an invariant of the report rather
than producing an odd one. Data stays fictional too — no real brand, product, personal name, contact
detail or credential, no `@` in any string, no run of five or more consecutive digits — and no
sentence anywhere claims certification, independent verification or a guaranteed pass.

Read next: `packages/sgi-core/src/extensions/evaluator-check.ts`;
`packages/sgi-core/src/scoring/compare-recorded-output.ts` for the shape and the `absent` reason;
`packages/sgi-core/src/scoring/score-submission.ts` for how a check is consulted;
`packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` for the case ids.

## Acceptance

1. `npm run typecheck` exits 0.
2. `npm run test:unit -- packages/sgi-core` exits 0, and your own test beside your check exits 0 under
   `npm run test:unit -- <your location>`. It asserts, rather than describes: that a case your check
   declares takes your verdict, that a case it does not declare still takes the built-in comparison's
   verdict, and that a submission answering fewer cases than the version defines still reports the
   absent case rather than throwing.
3. The seam's refusal is asserted: a value with a blank `id`, an empty `appliesTo` or a `compare` that
   is not a function throws `EvaluatorCheckValidationError` naming that field, and the error's `code`
   is `seam_validation`.
4. Determinism is asserted by recomputation, not by argument: score one submission twice through your
   check and assert the two per-case result arrays and the two outcomes are equal — the report's
   identifier and creation instant are the only fields that may differ, and neither is inside a
   comparison.
5. `git diff --stat -- packages/sgi-core/src/scoring packages/sgi-fixtures/fixtures/SGI-SO-1.0.0`
   prints nothing, and paste that empty output into the pull-request description.
6. `npm run test:integration -- --testNamePattern=evaluations` exits 0 with the three shipped seeded
   outcomes unchanged — your check must leave `seed-alpha` `PASS`, `seed-beta` failing on its critical
   case and `seed-gamma` failing on its threshold cases.
7. `npm run scan:exclusions` exits 0 with an empty finding list, and no file you add holds an `@` or a
   run of five or more consecutive digits.
