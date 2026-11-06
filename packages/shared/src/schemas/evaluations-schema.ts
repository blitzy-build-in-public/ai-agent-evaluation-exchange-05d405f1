/**
 * The JSON Schema request contracts of the evaluation and appeal routes:
 * `POST /evaluations` (developer, owner of the candidate version),
 * `GET /evaluations/{id}` (public), `POST /evaluations/{id}/appeals`
 * (developer) and `POST /appeals/{id}/ruling` (operator).
 *
 * Two kinds of export live here, and the difference is load-bearing. Three are
 * **unwrapped fragments** — {@link fixtureCaseSchema},
 * {@link fixtureCaseSetSchema} and {@link recordedOutputItemSchema} — carrying
 * no Fastify section key, because they are consumed as an `items` or a
 * `contains` sub-schema, or validate fixture data directly. Five are **Fastify
 * section objects**, each carrying exactly one section key (`body` or `params`)
 * so it attaches to a route's `schema` option as it stands and can be spread
 * with the other section that route needs, as in
 * `{ ...evaluationIdParamsSchema, ...appealCreateBodySchema }` on
 * `POST /evaluations/{id}/appeals`. A section key on a fragment would break that
 * composition, and an unwrapped fragment where a route expects a section would
 * validate nothing.
 *
 * Every object below is a plain JSON Schema object, typed by nothing else: the
 * dependency inventory is closed and names no schema library, and Fastify 4
 * validates these objects as they are. This module is data only — no
 * comparison, no scoring, no outcome derivation, no label derivation and no
 * helper of any kind. A report's outcome and its label are derived by
 * `@adem/sgi-core` and by the route that writes the report; nothing here
 * computes, predicts or names either.
 *
 * The closed vocabularies are imported rather than re-spelled: `CASE_SEVERITIES`
 * from `../types/report` and `APPEAL_RULINGS` from `../types/appeal`. A local
 * copy of a tuple would be the second definition of a vocabulary whose whole
 * point is that it has exactly one.
 *
 * Request side only: no response schema appears in this file. The shape
 * `GET /evaluations/{id}` answers with is `EvaluationReportDetail` in
 * `../types/report.ts`, and a Fastify response schema would silently change how
 * that shape is serialised.
 *
 * Nothing here carries a timestamp, an identifier or any other fresh value. A
 * report's `id` and `created_at` are generated at write time and lie outside the
 * compared payload, which is what keeps two runs of one submission
 * byte-identical.
 */

import { CASE_SEVERITIES } from '../types/report';
import { APPEAL_RULINGS } from '../types/appeal';

/**
 * How many cases the `SGI-SO-1.0.0` fixture set holds: **20**.
 *
 * A **shape bound for request and fixture validation only**. The runtime pass
 * thresholds — 20 total cases, 5 critical cases, **at least 18 of 20 matches AND
 * zero critical-case failures allowed** — are versioned data stored in the
 * `standard_versions` columns (`total_cases`, `critical_cases`,
 * `pass_threshold_matches`, `critical_failures_allowed`; see
 * `packages/shared/migrations/0005_standards_and_proposals.sql` and
 * `packages/sgi-core/src/standards/sgi-so-1.0.0.ts`) and are owned by
 * `packages/sgi-core`. **No route may re-derive an outcome from this constant**
 * or from {@link FIXTURE_CRITICAL_CASE_COUNT}: a compiled-in threshold would
 * replace versioned criteria with a number in the build, and the evaluator's
 * determinism rests on the criteria staying data. The thresholds are provisional
 * and change only by publishing a new standard version through the SGI proposal
 * and review process.
 *
 * One reader beyond the schemas here depends on this exact number:
 * `apps/api/src/routes/evaluations.ts` uses it for its completeness check, which
 * is what makes a submission carrying no recorded output for one of the fixture
 * set's cases a **`422` before any report is written**, rather than a case
 * silently scored as a failure.
 */
export const FIXTURE_CASE_COUNT = 20;

/**
 * How many of those 20 cases are `critical` in `SGI-SO-1.0.0`: **5**.
 *
 * The shape counterpart of {@link FIXTURE_CASE_COUNT}, and the count
 * {@link fixtureCaseSetSchema} states with `minContains`/`maxContains`. It is a
 * fact about the delivered fixture set and never a rule: the rule that makes one
 * failing `critical` case fail a candidate outright is versioned data on the
 * stored standard version, and the count itself is asserted as data by
 * `packages/sgi-fixtures/src/load-fixtures.test.ts`. See
 * {@link FIXTURE_CASE_COUNT} for why no route may derive an outcome from it.
 */
export const FIXTURE_CRITICAL_CASE_COUNT = 5;

/**
 * One case of a fixture set: the shape each entry of the `cases` array in
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` carries, and the
 * `items` sub-schema of {@link fixtureCaseSetSchema}.
 *
 * A **fragment**, not a Fastify section: it has no `body`, `querystring`,
 * `params` or `headers` key, because it is consumed as a sub-schema. It is
 * attached to no route.
 *
 * The expected output is spelled **`expected_output`** because that is the
 * spelling the delivered fixture pack uses for every one of its cases — in
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json` and in
 * `examples/extension-fixture-pack/fixtures/example-pack/cases.json` alike — and
 * this fragment exists to state and guard that shape. It follows the shipped
 * data rather than introducing a second spelling: a renamed field here would
 * make the schema fail on the repository's own fixture set. The submission side
 * of the same comparison is unaffected, because a candidate records its answers
 * as `output` in `recordedOutputItemSchema`.
 *
 * `input` and `expected_output` are **any JSON value**, written as the empty
 * schema `{}`. The fixture format permits a scalar, an array or an object, so
 * naming a type here would silently reject valid fixture data — the mistake this
 * fragment is most likely to attract.
 *
 * `severity` is constrained to the imported `CASE_SEVERITIES` tuple, which is
 * the same vocabulary as the `severity` `CHECK` on `report_case_results`. `id` is
 * a non-empty string; its uniqueness within a case set is a property of the
 * fixture data, asserted by
 * `packages/sgi-fixtures/src/load-fixtures.test.ts`, and not something a JSON
 * Schema can state.
 *
 * `additionalProperties: false` holds a case to the four fields the evaluator
 * reads, so a fixture carrying a fifth field fails validation instead of
 * travelling unread. Validation produces `400` for a malformed case wherever
 * this fragment is applied; it is applied to no route.
 */
export const fixtureCaseSchema = {
  type: 'object',
  required: ['id', 'input', 'expected_output', 'severity'],
  properties: {
    id: { type: 'string', minLength: 1 },
    input: {},
    expected_output: {},
    severity: { type: 'string', enum: CASE_SEVERITIES },
  },
  additionalProperties: false,
} as const;

/**
 * A whole fixture set: **exactly 20 cases, exactly 5 of them `critical`**.
 *
 * A **fragment**, not a Fastify section: it is the array schema for the case set
 * the fixture pack publishes, and it is attached to no route, so no Fastify
 * schema compiler ever sees it. The delivered pack file,
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/cases.json`, is an object whose
 * `cases` key holds exactly this array beside `standard_version_id`,
 * `total_cases` and `critical_cases`; the count keys there restate the standard
 * version's own columns for a reader of the file and are not a second source of
 * truth for anything, and the array under `cases` is what a consumer validates
 * with this fragment.
 *
 * The two counts are **`SGI-SO-1.0.0`'s**, so this fragment guards that
 * version's case set rather than a pack published for another standard version:
 * each version carries its own counts, read from its own stored row, and the
 * example extension pack in
 * `examples/extension-fixture-pack/fixtures/example-pack/cases.json` ships six
 * cases — two of them `critical` — against its own version. A case object of any
 * pack is what {@link fixtureCaseSchema} describes; the counts are the version's.
 *
 * `items` types every case, `minItems`/`maxItems` fix the count at
 * {@link FIXTURE_CASE_COUNT}, and a `contains` sub-schema matching a case whose
 * `severity` is `critical` with `minContains` and `maxContains` both set to
 * {@link FIXTURE_CRITICAL_CASE_COUNT} is how "exactly five critical cases" is
 * expressed in JSON Schema. `minContains` and `maxContains` are JSON Schema
 * 2019-09+ keywords, and Ajv 8 implements them in its 2019-09/2020-12 dialect,
 * where this fragment compiles and all three counts are enforced: the delivered
 * array of 20 cases with 5 critical validates, and the same array with 4 or 6
 * critical cases, or with 19 cases, is rejected.
 *
 * Where the keywords are *not* enforced decides where the real guard sits, so it
 * is stated rather than implied. The JSON Schema validator Fastify 4 bundles is
 * Ajv 8 in draft-07 mode, for which `minContains` is an unknown keyword: an Ajv
 * compiled with that validator's defaults throws on it, and one with `strict`
 * off ignores it. That is precisely why this fragment is attached to no Fastify
 * route, and why the delivered fixture set is checked by its own test,
 * `packages/sgi-fixtures/src/load-fixtures.test.ts`, which asserts the same two
 * counts as data. The shape is guarded from both sides — this schema states it
 * and the test proves the data obeys it — and neither may be replaced by a
 * hand-written count in a consumer, which would move the rule out of the schema
 * and into whichever code happened to check it.
 *
 * Neither count is a pass threshold: see {@link FIXTURE_CASE_COUNT}.
 */
export const fixtureCaseSetSchema = {
  type: 'array',
  minItems: FIXTURE_CASE_COUNT,
  maxItems: FIXTURE_CASE_COUNT,
  items: fixtureCaseSchema,
  contains: { properties: { severity: { const: 'critical' } }, required: ['severity'] },
  minContains: FIXTURE_CRITICAL_CASE_COUNT,
  maxContains: FIXTURE_CRITICAL_CASE_COUNT,
} as const;

/**
 * One recorded output in an evaluation submission: the `items` sub-schema of
 * `recorded_outputs` in {@link evaluationSubmissionBodySchema}.
 *
 * A **fragment**, not a Fastify section: it has no section key, because it is
 * consumed as the `items` of the submission body and is attached to nothing of
 * its own.
 *
 * The field names are the ones the delivered candidate files use: every entry of
 * `recorded_outputs` in
 * `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/candidates/seed-alpha.json` and
 * its two siblings is a `{ case_id, output }` pair, so this fragment describes
 * the shipped data as well as validating it.
 *
 * `output` is any JSON value and is **pure data from the moment it arrives until
 * it is compared**: a candidate submission is declarative, nothing in this
 * product executes it, and the value is compared against its case's expected
 * output as canonical JSON. There is no field here through which executable
 * content could be expressed — no path, no command, no module, no endpoint — and
 * `additionalProperties: false` keeps a client from adding one that some later
 * reader might act on.
 *
 * The type of `output` is deliberately not narrowed. The evaluator compares
 * canonical forms, so a fragment naming a type would reject valid recorded data
 * before the comparison could reject it for what it actually says.
 */
export const recordedOutputItemSchema = {
  type: 'object',
  required: ['case_id', 'output'],
  properties: {
    case_id: { type: 'string', minLength: 1 },
    output: {},
  },
  additionalProperties: false,
} as const;

/**
 * Body contract for `POST /evaluations` (developer, owner of the candidate
 * version): the deterministic, synchronous evaluation that writes the report.
 *
 * **The body carries no retest field, and `additionalProperties: false` is how
 * that is expressed structurally.** Fastify 4 validates with `removeAdditional:
 * true` among its Ajv defaults, so an unexpected field — a client-supplied
 * `prior_report_id`, say — is **removed before the handler runs** rather than
 * producing a `400`; likewise a numeric-looking string such as `"42"` is coerced
 * under `coerceTypes: 'array'`, so a `candidate_version_id` of `"42"` arrives as
 * the string it already is. The consequence matters to a handler author: no
 * handler may rely on seeing an unknown field, and none needs to, because the
 * prior-report link is server-derived. `apps/api/src/routes/evaluations.ts` takes
 * the newest existing report for the submitted `candidate_version_id` and
 * `standard_version_id`, records its id in `prior_report_id`, and records no link
 * (`null`) when that version has no prior report.
 *
 * **Two outcomes this schema does not decide, because it cannot.** Whether a
 * submission carries a recorded output for every case of the loaded fixture set,
 * and whether it names an unknown or duplicated `case_id`, are decided by the
 * route's completeness check against the fixture set it loaded — the schema
 * cannot know a case set's ids. A missing case is the contract's **`422` before
 * any report is written**, and the number that check reads is
 * {@link FIXTURE_CASE_COUNT}, exported above for exactly that purpose.
 *
 * `uniqueItems: true` is a deep-equality check on whole `{ case_id, output }`
 * items, so it rejects a byte-identical duplicate and **not** the same `case_id`
 * twice with different outputs; that case is the route's completeness check
 * again. This schema narrows the input; it does not replace the check.
 *
 * Statuses this row produces: `400` for a malformed body — a missing field, an
 * empty `candidate_version_id` or `standard_version_id`, an empty
 * `recorded_outputs` array, more than {@link FIXTURE_CASE_COUNT} outputs, or a
 * duplicated item — `404` from the route for an unknown candidate version or
 * standard version, `422` for the completeness failures above, `401` for a
 * missing or unresolvable `X-Demo-Account` header, and `403` for a resolvable
 * account whose role is not `developer` or which does not own the version.
 * Success is `201` with the report. Nothing here is a threshold: the outcome the
 * report states is derived from the stored standard version.
 */
export const evaluationSubmissionBodySchema = {
  body: {
    type: 'object',
    required: ['candidate_version_id', 'standard_version_id', 'recorded_outputs'],
    properties: {
      candidate_version_id: { type: 'string', minLength: 1 },
      standard_version_id: { type: 'string', minLength: 1 },
      recorded_outputs: {
        type: 'array',
        items: recordedOutputItemSchema,
        minItems: 1,
        maxItems: FIXTURE_CASE_COUNT,
        uniqueItems: true,
      },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `GET /evaluations/{id}` (public) and, spread with
 * {@link appealCreateBodySchema}, for `POST /evaluations/{id}/appeals`
 * (developer).
 *
 * `id` names an `evaluation_reports` row — the report whose per-case evidence
 * the read returns — and never a listing version. The read is public and
 * unauthenticated: no demo header is attached to it, anyone may read any report
 * and its evidence, and the route answers `404` when no report carries the id.
 * Validation itself produces `400` for a missing or empty `id`.
 *
 * Nothing of `POST /evaluations` plays a part here: an appeal neither writes,
 * re-scores nor replaces a report. A ruling on it appends a governance event, so
 * `GET /evaluations/{id}` returns the same report — same evidence, same counts,
 * same outcome, same label — before and after the ruling.
 */
export const evaluationIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Path-parameter contract for `POST /appeals/{id}/ruling` (operator).
 *
 * `id` names an `appeals` row — the appeal being decided, not the report it
 * concerns and not a governance event. The route resolves it and answers `404`
 * when no appeal carries it and `409` when the appeal already carries a terminal
 * status; validation itself produces `400` for a missing or empty `id`. A
 * missing or unresolvable demo header is `401`, and a resolvable account whose
 * role is not `operator` is `403`.
 */
export const appealIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /evaluations/{id}/appeals` (developer who owns the
 * appealed report).
 *
 * The report being appealed comes from the **path**, through
 * {@link evaluationIdParamsSchema}, and never from this body, so a caller cannot
 * appeal a report it did not target. The appellant's identity comes from the
 * resolved `X-Demo-Account` header and is not a field here either: Fastify 4
 * strips an unexpected field before the handler runs, so a client-supplied
 * `developer_account_id`, `report_id`, `status` or `created_at` has no effect and
 * no handler may rely on one.
 *
 * `reason` is **required** — an appeal is opened against a report *with a stated
 * reason* — and it carries `minLength: 1` so an empty string states nothing
 * either. The appeal is created `open`; only {@link appealRulingBodySchema} moves
 * it, and the contract's `409` for an already-decided appeal belongs to that
 * ruling route.
 *
 * A ruling on the appeal appends a governance event and leaves the report
 * **byte-identical**: `evaluation_reports` is append-only, this route is not
 * among its writers, and no field below can express a change to it.
 *
 * Statuses: `400` for a missing or empty `reason`, `404` for an unknown report,
 * `401` for a missing or unresolvable demo header, `403` for a resolvable
 * account whose role is not `developer` or which does not own the appealed
 * report. Success is `201` with the appeal in status `open`.
 */
export const appealCreateBodySchema = {
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * Body contract for `POST /appeals/{id}/ruling` (operator).
 *
 * The required field is named **`status`** because that is the column the ruling
 * sets — `appeals.status` — and not because a successful answer is a status
 * document; the contract's success here is `200` with the appeal beside the
 * governance event the ruling appended.
 *
 * Its enum is `APPEAL_RULINGS` (`upheld` or `denied`), imported from
 * `../types/appeal` and used as the tuple it is rather than re-spelled, and it
 * deliberately excludes `open`. That narrow vocabulary is what makes the
 * contract's `409` for an already-ruled appeal coherent: `open` is the initial
 * state and not a ruling, so no ruling can reopen or un-decide an appeal, and an
 * attempt to set one back to `open` fails validation as a `400` before a handler
 * runs. `APPEAL_STATUSES` is deliberately not used here: widening this enum to
 * the appeal's full status vocabulary would delete contract behaviour rather
 * than relax a constraint.
 *
 * `reason` is optional — a ruling is not obliged to justify itself — and when
 * present it travels into the appended event's payload rather than into the
 * appeal row. The operator's power is additive only: this body touches no
 * report, no case result and no ledger entry, and an upheld appeal certifies
 * nothing and changes no badge, so `evaluation_reports` stays byte-identical.
 *
 * Statuses: `400` for a missing `status` or a value outside the enum, `404` for
 * an unknown appeal, `409` for an appeal already ruled, `401` for a missing or
 * unresolvable demo header, and `403` for a resolvable account whose role is not
 * `operator`.
 */
export const appealRulingBodySchema = {
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: APPEAL_RULINGS },
      reason: { type: 'string' },
    },
    additionalProperties: false,
  },
} as const;

