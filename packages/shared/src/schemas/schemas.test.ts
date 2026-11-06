/**
 * Structural contract test for the six JSON Schema request modules of this folder.
 *
 * It asserts what those modules guarantee rather than restating their text, and it does
 * so **without a validation engine**: the dependency inventory is closed and names no
 * schema library, so every expectation below is structural — `Object.keys`, `required`,
 * `enum`, `default`, `minimum`, `minItems`/`maxItems`, `minContains`/`maxContains`,
 * `pattern` and `additionalProperties` — plus one compiled `RegExp` for the compare
 * bound.
 *
 * Four of those facts are traps a later reader could "fix" away, so each is asserted
 * here by name:
 *
 * - The listing search query exposes exactly the seven keys of the contract and **no**
 *   page-size parameter, which is what keeps `LISTING_PAGE_SIZE` (20) the single
 *   definition of the fixed page size.
 * - `GET /compare`'s `ids` is a patterned **string** and not an array: Fastify's query
 *   parser hands `?ids=a,b,c` over as one string and its `coerceTypes: 'array'` does not
 *   split on a separator, so an array declaration would silently swallow the
 *   two-to-four bound. `COMPARE_IDS_PATTERN` stays a string so that JSON Schema's
 *   `pattern` keyword and this test's `new RegExp(...)` consume the same value.
 * - The evaluation submission body carries **no retest field**: `prior_report_id` is
 *   server-derived from the newest report for the submitted candidate version, so a
 *   client has no way to address a predecessor.
 * - The fixture set is exactly 20 cases of which exactly 5 are `critical`.
 *
 * **What this module deliberately does not prove, and where that proof lives.** It
 * proves the schema side of the contract in-process — no HTTP server, no database, no
 * filesystem, no fake timer and no snapshot — so the runtime outcomes belong elsewhere
 * and must not be duplicated here:
 *
 * - The `400`/`401`/`403`/`404`/`409`/`422` outcomes of the real routes are proven by
 *   `apps/api/test/integration/route-walk.test.ts` and `api-contract.test.ts`, which
 *   drive a real `createServer(options)` instance on an ephemeral port.
 * - Reproducibility of a re-run and the three seed outcomes are proven by
 *   `apps/api/test/integration/api-contract.test.ts` and
 *   `packages/sgi-core/src/scoring/score-submission.test.ts`.
 * - The absence of an import path from `sgi-core` to commercial or sponsored data is
 *   proven by `apps/api/test/integration/boundary-check.ts`.
 *
 * No snapshot baseline is used for any of it: a snapshot would turn a genuine schema
 * change into a failing byte comparison rather than a named expectation, and the
 * determinism criterion needs the suite's `update: false` mode to stay meaningful.
 */

import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNT_HEADER, demoAccountHeaderSchema } from './auth-header-schema';
import {
  challengeCreateBodySchema,
  challengeIdParamsSchema,
  challengeResponseBodySchema,
  threadCreateBodySchema,
  threadIdParamsSchema,
  threadPostBodySchema,
} from './challenges-threads-schema';
import {
  checkoutSimulationBodySchema,
  refundCreateBodySchema,
  transactionIdParamsSchema,
} from './commerce-schema';
import {
  FIXTURE_CASE_COUNT,
  FIXTURE_CRITICAL_CASE_COUNT,
  appealCreateBodySchema,
  appealIdParamsSchema,
  appealRulingBodySchema,
  evaluationIdParamsSchema,
  evaluationSubmissionBodySchema,
  fixtureCaseSchema,
  fixtureCaseSetSchema,
  recordedOutputItemSchema,
} from './evaluations-schema';
import {
  COMPARE_IDS_PATTERN,
  compareQuerySchema,
  listingCreateBodySchema,
  listingIdParamsSchema,
  listingSearchQuerySchema,
  listingVersionCreateBodySchema,
} from './listings-schema';
import {
  MODERATION_ACTIONS,
  moderationActionBodySchema,
  moderationListingIdParamsSchema,
  standardProposalCreateBodySchema,
  standardProposalIdParamsSchema,
  standardProposalReviewBodySchema,
} from './moderation-schema';

import {
  BADGE_SCOPE,
  DEMO_AUTHENTICATION_LABEL,
  FOUNDER_ALLOCATION_CONTRACT_LABEL,
  LISTING_PAGE_SIZE,
  NO_REPORT_LABEL,
  REPORT_LABEL_SAMPLE,
  REPORT_LABEL_VERIFIED_IN_DEMO,
  SPONSORED_LABEL,
  SYNTHETIC_CURRENCY_LABEL,
  WRITE_RATE_LIMIT_MAX,
  WRITE_RATE_LIMIT_WINDOW,
} from '../constants';
import { ACCOUNT_ROLES } from '../types/account';
import { APPEAL_RULINGS } from '../types/appeal';
import { OFFER_MODELS } from '../types/commerce';
import { LEDGER_ENTRY_TYPES, LEDGER_NAMES } from '../types/ledger';
import {
  COMPARE_MAX_IDS,
  COMPARE_MIN_IDS,
  DEFAULT_LISTING_SORT,
  LISTING_SORTS,
  LISTING_STATUSES,
  PRICING_MODELS,
} from '../types/listing';
import { CASE_SEVERITIES, REPORT_LABELS, REPORT_OUTCOMES } from '../types/report';
import { PROPOSAL_REVIEW_STATUSES, PROPOSAL_STATUSES } from '../types/standard';

/**
 * The four Fastify request-section keys a request schema can carry. Exactly one belongs
 * on each schema object this folder exports — the folder's own contract, checked group
 * by group below and once across the whole folder at the end. A `response` key would
 * fail that check, which is how this file proves the folder holds no response schema.
 */
const SECTION_KEYS: readonly string[] = ['body', 'querystring', 'params', 'headers'];

describe('listingSearchQuerySchema', () => {
  it('exposes exactly the seven contract query keys and no page-size parameter', () => {
    expect(Object.keys(listingSearchQuerySchema)).toEqual(['querystring']);

    // The exact key list is the assertion: `limit`, `size`, `per_page`, `pageSize` and
    // `page_size` are absent by construction, and the page size stays the single
    // `LISTING_PAGE_SIZE` of `../constants`.
    expect(Object.keys(listingSearchQuerySchema.querystring.properties)).toEqual([
      'q',
      'category',
      'license',
      'model',
      'standard',
      'sort',
      'page',
    ]);
  });

  it('resolves sort and page so the handler never re-defaults them', () => {
    expect(DEFAULT_LISTING_SORT).toBe('relevance');
    expect(listingSearchQuerySchema.querystring.properties.sort.default).toBe(
      DEFAULT_LISTING_SORT,
    );
    expect(listingSearchQuerySchema.querystring.properties.page).toEqual({
      type: 'integer',
      minimum: 1,
      default: 1,
    });
  });

  it('closes the query object, so an unexpected key is stripped rather than accepted', () => {
    expect(listingSearchQuerySchema.querystring.additionalProperties).toBe(false);
  });
});

describe('listingIdParamsSchema', () => {
  it('requires the listing identifier and nothing else', () => {
    expect(Object.keys(listingIdParamsSchema)).toEqual(['params']);
    expect(listingIdParamsSchema.params.required).toEqual(['id']);
    expect(listingIdParamsSchema.params.additionalProperties).toBe(false);
  });
});

describe('listingCreateBodySchema', () => {
  it('accepts exactly the five fields a developer may write', () => {
    // `slug` and `status` are absent by construction: the slug is derived server-side
    // and a new listing is `active`, so neither is a client field.
    expect(Object.keys(listingCreateBodySchema)).toEqual(['body']);
    expect(listingCreateBodySchema.body.required).toEqual([
      'title',
      'summary',
      'category_id',
      'license_code',
      'pricing_model',
    ]);
    expect(Object.keys(listingCreateBodySchema.body.properties)).toEqual([
      'title',
      'summary',
      'category_id',
      'license_code',
      'pricing_model',
    ]);
    expect(listingCreateBodySchema.body.additionalProperties).toBe(false);
  });
});

describe('listingVersionCreateBodySchema', () => {
  it('requires a version string and holds the version pattern to a token', () => {
    expect(Object.keys(listingVersionCreateBodySchema)).toEqual(['body']);
    expect(listingVersionCreateBodySchema.body.required).toEqual(['version_string']);
    expect(listingVersionCreateBodySchema.body.additionalProperties).toBe(false);

    const versionString = listingVersionCreateBodySchema.body.properties.version_string;
    expect(versionString.type).toBe('string');
    expect(versionString.maxLength).toBe(32);
    expect(versionString.pattern).toBeTruthy();

    // The pattern keeps a version a token rather than free text. The uniqueness that
    // produces the contract's `409` is the stored `(listing_id, version_string)` pair in
    // `packages/shared/migrations/0002_listings_and_versions.sql` and never this pattern.
    const pattern = new RegExp(versionString.pattern);
    expect(pattern.test('-bad')).toBe(false);
  });

  it.each(['1.0.0', '2024-05', 'v2_rc1', '1.0.0-beta.2'])(
    'accepts the version label %s',
    (versionLabel) => {
      const versionString = listingVersionCreateBodySchema.body.properties.version_string;
      expect(new RegExp(versionString.pattern).test(versionLabel)).toBe(true);
    },
  );
});

describe('compareQuerySchema', () => {
  it('declares the identifiers as one patterned string and not as an array', () => {
    expect(Object.keys(compareQuerySchema)).toEqual(['querystring']);
    expect(compareQuerySchema.querystring.required).toEqual(['ids']);
    expect(compareQuerySchema.querystring.additionalProperties).toBe(false);

    // Declared `string` on purpose: `coerceTypes: 'array'` would turn the joined
    // `"a,b,c"` into a one-item array holding a bogus identifier, so the two-to-four
    // bound would never be checked. An `items` key would be that array schema.
    expect(compareQuerySchema.querystring.properties.ids.type).toBe('string');
    expect(compareQuerySchema.querystring.properties.ids).not.toHaveProperty('items');
    expect(compareQuerySchema.querystring.properties.ids.pattern).toBe(
      COMPARE_IDS_PATTERN,
    );
  });

  it('keeps the exported pattern a string for the schema keyword and for this test', () => {
    expect(typeof COMPARE_IDS_PATTERN).toBe('string');
    expect(COMPARE_MIN_IDS).toBe(2);
    expect(COMPARE_MAX_IDS).toBe(4);
  });

  it.each<[string, boolean]>([
    ['a', false],
    ['a,b', true],
    ['a,b,c', true],
    ['a,b,c,d', true],
    ['a,b,c,d,e', false],
    [',', false],
    ['a,', false],
  ])('decides "%s" as %s', (ids, accepted) => {
    const pattern = new RegExp(COMPARE_IDS_PATTERN);
    expect(pattern.test(ids)).toBe(accepted);
  });
});

describe('the SGI-SO-1.0.0 fixture envelope', () => {
  it('states exactly 20 cases, exactly 5 of them critical', () => {
    expect(FIXTURE_CASE_COUNT).toBe(20);
    expect(FIXTURE_CRITICAL_CASE_COUNT).toBe(5);
  });

  it('fixes the case-set envelope with the two counts and the critical-case rule', () => {
    // These two numbers are `SGI-SO-1.0.0`'s shape and never a pass threshold: the
    // thresholds are versioned data on the stored standard version, so no consumer may
    // derive an outcome from these constants.
    expect(fixtureCaseSetSchema.type).toBe('array');
    expect(fixtureCaseSetSchema.minItems).toBe(FIXTURE_CASE_COUNT);
    expect(fixtureCaseSetSchema.maxItems).toBe(FIXTURE_CASE_COUNT);
    expect(fixtureCaseSetSchema.items).toBe(fixtureCaseSchema);
    expect(fixtureCaseSetSchema.minContains).toBe(FIXTURE_CRITICAL_CASE_COUNT);
    expect(fixtureCaseSetSchema.maxContains).toBe(FIXTURE_CRITICAL_CASE_COUNT);
    expect(fixtureCaseSetSchema.contains.required).toContain('severity');
    expect(fixtureCaseSetSchema.contains.properties.severity.const).toBe('critical');
  });

  it('holds a case to four fields, with input and expected_output as any JSON value', () => {
    // The two payload fields are deliberately untyped — a fixture value may be a
    // scalar, an array or an object — and `expected_output` is the spelling the
    // delivered fixture pack uses for all 20 cases.
    expect(fixtureCaseSchema.required).toEqual([
      'id',
      'input',
      'expected_output',
      'severity',
    ]);
    expect(fixtureCaseSchema.properties.input).toEqual({});
    expect(fixtureCaseSchema.properties.expected_output).toEqual({});
    expect(fixtureCaseSchema.additionalProperties).toBe(false);
  });

  it('holds a recorded output to its case identifier and an untyped output', () => {
    expect(recordedOutputItemSchema.required).toEqual(['case_id', 'output']);
    expect(recordedOutputItemSchema.properties.output).toEqual({});
    expect(recordedOutputItemSchema.additionalProperties).toBe(false);
  });

  it('carries no Fastify section key on the three fragments', () => {
    // These three are sub-schemas — an `items`, a `contains` or a directly applied
    // fragment — so a section key on one of them would break the composition they exist
    // for and would validate nothing where a route expects a section.
    for (const fragment of [
      fixtureCaseSchema,
      fixtureCaseSetSchema,
      recordedOutputItemSchema,
    ]) {
      expect(Object.keys(fragment).filter((key) => SECTION_KEYS.includes(key))).toEqual(
        [],
      );
    }
  });
});

describe('evaluationSubmissionBodySchema', () => {
  it('accepts exactly the three submission fields', () => {
    expect(Object.keys(evaluationSubmissionBodySchema)).toEqual(['body']);
    expect(evaluationSubmissionBodySchema.body.required).toEqual([
      'candidate_version_id',
      'standard_version_id',
      'recorded_outputs',
    ]);
    expect(Object.keys(evaluationSubmissionBodySchema.body.properties)).toEqual([
      'candidate_version_id',
      'standard_version_id',
      'recorded_outputs',
    ]);
    expect(evaluationSubmissionBodySchema.body.additionalProperties).toBe(false);
  });

  it('offers no field through which a retest link could be addressed', () => {
    // The server derives `prior_report_id` from the newest existing report for the
    // submitted candidate version and standard version, so the client has no way to
    // point at a predecessor; with `removeAdditional: true` an injected field is removed
    // before the handler runs, and no handler may rely on seeing one.
    const serialised = JSON.stringify(evaluationSubmissionBodySchema);
    expect(serialised).not.toMatch(/prior_report_id/i);
    expect(serialised).not.toMatch(/priorReportId/i);
    expect(serialised).not.toMatch(/retest/i);
  });

  it('bounds the recorded outputs by the fixture case count', () => {
    const recordedOutputs = evaluationSubmissionBodySchema.body.properties.recorded_outputs;
    expect(recordedOutputs.type).toBe('array');
    expect(recordedOutputs.items).toBe(recordedOutputItemSchema);
    expect(recordedOutputs.minItems).toBe(1);
    expect(recordedOutputs.maxItems).toBe(FIXTURE_CASE_COUNT);
    expect(recordedOutputs.uniqueItems).toBe(true);
  });
});

describe('the evaluation and appeal parameter and body contracts', () => {
  it('addresses a report and an appeal by path parameter alone', () => {
    expect(evaluationIdParamsSchema.params.required).toEqual(['id']);
    expect(appealIdParamsSchema.params.required).toEqual(['id']);
  });

  it('requires a stated reason to open an appeal', () => {
    expect(Object.keys(appealCreateBodySchema)).toEqual(['body']);
    expect(appealCreateBodySchema.body.required).toEqual(['reason']);
    expect(appealCreateBodySchema.body.properties.reason.minLength).toBe(1);
    expect(appealCreateBodySchema.body.additionalProperties).toBe(false);
  });

  it('rules an appeal with the ruling vocabulary and never reopens it', () => {
    expect(Object.keys(appealRulingBodySchema)).toEqual(['body']);
    expect(appealRulingBodySchema.body.required).toEqual(['status']);
    expect(appealRulingBodySchema.body.additionalProperties).toBe(false);
    // `open` is the initial state and not a ruling, which is what keeps the contract's
    // `409` for an already-decided appeal coherent.
    expect(APPEAL_RULINGS).not.toContain('open');
  });
});

describe('demoAccountHeaderSchema', () => {
  it('names the demo-session header and requires it', () => {
    expect(DEMO_ACCOUNT_HEADER).toBe('X-Demo-Account');
    expect(Object.keys(demoAccountHeaderSchema)).toEqual(['headers']);
    expect(demoAccountHeaderSchema.headers.type).toBe('object');
    expect(demoAccountHeaderSchema.headers.required).toEqual([DEMO_ACCOUNT_HEADER]);
    expect(demoAccountHeaderSchema.headers.required).toContain(DEMO_ACCOUNT_HEADER);
  });

  it('constrains the demo header only, and leaves the other headers alone', () => {
    const properties = demoAccountHeaderSchema.headers.properties;
    expect(Object.keys(properties)).toHaveLength(1);
    expect(properties[DEMO_ACCOUNT_HEADER]).toEqual({ type: 'string', minLength: 1 });
    // Left open on purpose: a real request carries `content-type`, `accept`, `host` and
    // `user-agent`, and tightening this would fail every write.
    expect(demoAccountHeaderSchema.headers.additionalProperties).toBe(true);
  });

  it('describes a synthetic role selector and never an authentication header', () => {
    const properties = demoAccountHeaderSchema.headers.properties;
    for (const authenticationHeader of [
      'authorization',
      'cookie',
      'token',
      'password',
      'set-cookie',
    ]) {
      expect(properties).not.toHaveProperty(authenticationHeader);
    }
  });
});

describe('the simulated-commerce request contracts', () => {
  it('accepts an offer selection and no amount, currency or provider field', () => {
    expect(Object.keys(checkoutSimulationBodySchema)).toEqual(['body']);
    expect(checkoutSimulationBodySchema.body.required).toEqual([
      'listing_id',
      'listing_version_id',
      'offer_model',
    ]);
    expect(checkoutSimulationBodySchema.body.additionalProperties).toBe(false);

    // The amount is computed from the selected offer and the listing version, and every
    // monetary value in this product is an integer count of minor units of the synthetic
    // currency `DEMO`, so no amount, currency or provider field may exist here.
    for (const serverOwnedField of [
      'amount_minor_units',
      'currency',
      'currency_label',
      'currency_code',
      'card',
      'account',
      'provider',
    ]) {
      expect(checkoutSimulationBodySchema.body.properties).not.toHaveProperty(
        serverOwnedField,
      );
    }
  });

  it('requires a whole, non-negative refund amount in minor units', () => {
    expect(Object.keys(refundCreateBodySchema)).toEqual(['body']);
    expect(refundCreateBodySchema.body.required).toEqual(['amount_minor_units']);
    // `integer` is the schema-side guard against floating-point money and `minimum: 0`
    // permits a zero refund, leaving the domain's `409` and `422` as the meaningful
    // rejections.
    expect(refundCreateBodySchema.body.properties.amount_minor_units).toEqual({
      type: 'integer',
      minimum: 0,
    });
    expect(refundCreateBodySchema.body.additionalProperties).toBe(false);
  });

  it('takes the refunded transaction from the path', () => {
    expect(transactionIdParamsSchema.params.required).toEqual(['id']);
  });
});

describe('moderationActionBodySchema', () => {
  it('requires both an action from the closed vocabulary and a stated reason', () => {
    expect(Object.keys(moderationActionBodySchema)).toEqual(['body']);
    // The missing-reason `400` is this row's own contract case, so `reason` is asserted
    // as a required member in its own right.
    expect(moderationActionBodySchema.body.required).toContain('action');
    expect(moderationActionBodySchema.body.required).toContain('reason');
    expect(moderationActionBodySchema.body.properties.reason).toEqual({
      type: 'string',
      minLength: 1,
    });
    expect(moderationActionBodySchema.body.additionalProperties).toBe(false);
    expect(MODERATION_ACTIONS).toEqual(['flag', 'hide', 'restore']);
  });

  it('addresses the moderated listing by path parameter', () => {
    expect(moderationListingIdParamsSchema.params.required).toEqual(['id']);
  });
});

describe('the standards proposal and review bodies', () => {
  it('creates a proposal with no status field', () => {
    // The row is created `submitted` and the review route is the only route that moves
    // it, so `status` is not a client field of the creation body.
    expect(Object.keys(standardProposalCreateBodySchema)).toEqual(['body']);
    expect(standardProposalCreateBodySchema.body.required).toEqual([
      'standard_id',
      'title',
      'rationale',
    ]);
    expect(standardProposalCreateBodySchema.body.properties).not.toHaveProperty('status');
    expect(standardProposalCreateBodySchema.body.additionalProperties).toBe(false);
  });

  it('reviews a proposal through the narrowed review vocabulary', () => {
    expect(standardProposalIdParamsSchema.params.required).toEqual(['id']);
    expect(Object.keys(standardProposalReviewBodySchema)).toEqual(['body']);
    expect(standardProposalReviewBodySchema.body.required).toEqual(['status']);
    expect(standardProposalReviewBodySchema.body.additionalProperties).toBe(false);
    // `submitted` is the initial state and not a review outcome, which is what keeps the
    // contract's `409` for an already-decided proposal coherent.
    expect(standardProposalReviewBodySchema.body.properties.status.enum).not.toEqual(
      PROPOSAL_STATUSES,
    );
    expect(standardProposalReviewBodySchema.body.properties.status.enum).not.toContain(
      'submitted',
    );
  });
});


/**
 * Anti-drift check on every closed vocabulary: it is declared once, in its `../types`
 * module, and must not drift between the type, the wire contract and the JSON Schema.
 * Half 1 compares each schema `enum` with its tuple; half 2 asserts the vocabularies that
 * no schema in this folder carries.
 *
 * Plan reconciliation, recorded so nobody restores an assertion that cannot hold: the
 * folder's specification lists `LISTING_STATUSES`, `REPORT_OUTCOMES`, `REPORT_LABELS`,
 * `LEDGER_NAMES` and `LEDGER_ENTRY_TYPES` among the vocabularies whose schema `enum`
 * arrays equal the corresponding `../types` tuples exactly. **No schema among the six
 * modules in this folder carries an enum for any of those five.** There is no
 * listing-status request field, no report-outcome request field and no label request
 * field — the outcome and the label are derived by the domain and are never submitted —
 * and the three operator ledger reads take no request input at all. An equality against
 * a schema enum for them is therefore unsatisfiable without inventing a seventh schema
 * module, which the file map forbids and which would be a second definition of a
 * vocabulary whose point is that it has one. They are asserted by their exact literal
 * members and order in half 2 instead, which preserves the anti-drift purpose.
 */
describe('anti-drift: each closed vocabulary has exactly one definition', () => {
  it('carries every schema enum with its own types tuple', () => {
    expect(listingSearchQuerySchema.querystring.properties.model.enum).toEqual(
      PRICING_MODELS,
    );
    expect(listingSearchQuerySchema.querystring.properties.sort.enum).toEqual(
      LISTING_SORTS,
    );
    expect(listingCreateBodySchema.body.properties.pricing_model.enum).toEqual(
      PRICING_MODELS,
    );
    expect(fixtureCaseSchema.properties.severity.enum).toEqual(CASE_SEVERITIES);
    expect(checkoutSimulationBodySchema.body.properties.offer_model.enum).toEqual(
      OFFER_MODELS,
    );
    expect(appealRulingBodySchema.body.properties.status.enum).toEqual(APPEAL_RULINGS);
    expect(moderationActionBodySchema.body.properties.action.enum).toEqual(
      MODERATION_ACTIONS,
    );
    expect(standardProposalReviewBodySchema.body.properties.status.enum).toEqual(
      PROPOSAL_REVIEW_STATUSES,
    );
  });

  it('keeps a listing status distinct from the moderation action that moves it', () => {
    // `flag|hide|restore` are *actions*; `active|flagged|hidden` are the *statuses* they
    // leave behind. No schema in this folder constrains a listing status, so the two
    // vocabularies are asserted here by value.
    expect(LISTING_STATUSES).toEqual(['active', 'flagged', 'hidden']);
  });

  it('closes the report vocabulary to its two outcomes and its two labels', () => {
    // Neither is a request field: the outcome and the label are derived by the domain,
    // so no schema enum carries them.
    expect(REPORT_OUTCOMES).toEqual(['PASS', 'FAIL']);
    expect(REPORT_LABELS).toEqual([REPORT_LABEL_SAMPLE, REPORT_LABEL_VERIFIED_IN_DEMO]);
    expect(REPORT_LABELS).toEqual(['SAMPLE', 'VERIFIED-IN-DEMO']);
  });

  it('names the three ledgers and the three entry types they carry', () => {
    // The three ledger reads are operator-only `GET`s with no request input, which is
    // why no schema in this folder carries these enums.
    expect(LEDGER_NAMES).toEqual(['marketplace', 'gate_fees', 'founder_allocation']);
    expect(LEDGER_ENTRY_TYPES).toEqual(['charge', 'allocation', 'reversal']);
  });

  it('lists the proposal statuses and the four demo roles', () => {
    // A proposal's creation body carries no status, and no route accepts a role as input,
    // so both vocabularies live only in `../types` and in the seed.
    expect(PROPOSAL_STATUSES).toEqual(['submitted', 'accepted', 'rejected']);
    expect(ACCOUNT_ROLES).toEqual(['developer', 'buyer', 'contributor', 'operator']);
  });
});

describe('the rendered copy equals its exact literal', () => {
  // This copy is rendered by the UI and asserted by `e2e/**`, and a paraphrase would be a
  // labelling defect rather than a wording choice: the report label vocabulary, the badge
  // scope, the demo-session label, the empty-evaluation copy, the founder-ledger note and
  // the sponsored label are the product's closed vocabulary.
  const copyLiterals: Array<[string, string, string]> = [
    ['SYNTHETIC_CURRENCY_LABEL', SYNTHETIC_CURRENCY_LABEL, 'DEMO'],
    ['REPORT_LABEL_SAMPLE', REPORT_LABEL_SAMPLE, 'SAMPLE'],
    ['REPORT_LABEL_VERIFIED_IN_DEMO', REPORT_LABEL_VERIFIED_IN_DEMO, 'VERIFIED-IN-DEMO'],
    ['BADGE_SCOPE', BADGE_SCOPE, 'structured output on fixture set only'],
    [
      'DEMO_AUTHENTICATION_LABEL',
      DEMO_AUTHENTICATION_LABEL,
      'demo only, no production authentication',
    ],
    ['NO_REPORT_LABEL', NO_REPORT_LABEL, 'No SGI report yet'],
    ['FOUNDER_ALLOCATION_CONTRACT_LABEL', FOUNDER_ALLOCATION_CONTRACT_LABEL, 'to be determined'],
    ['SPONSORED_LABEL', SPONSORED_LABEL, 'Sponsored'],
    ['WRITE_RATE_LIMIT_WINDOW', WRITE_RATE_LIMIT_WINDOW, '1 minute'],
  ];

  const numericConstants: Array<[string, number, number]> = [
    ['LISTING_PAGE_SIZE', LISTING_PAGE_SIZE, 20],
    ['WRITE_RATE_LIMIT_MAX', WRITE_RATE_LIMIT_MAX, 60],
  ];

  it.each(copyLiterals)('%s equals its exact literal', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each(numericConstants)('%s equals its exact literal', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });
});

/**
 * A folder schema's section, reduced to the one keyword this group checks across every
 * schema at once.
 */
interface ClosedSection {
  readonly additionalProperties: unknown;
}

/** A schema object that carries a `body` section. */
interface BodyBearingSchema {
  readonly body: ClosedSection;
}

/** A schema object that carries a `querystring` section. */
interface QueryBearingSchema {
  readonly querystring: ClosedSection;
}

describe('the folder contract: exactly one Fastify section key per schema object', () => {
  it('carries one section key on each of the 25 request schemas and no response schema', () => {
    // The 25 section objects of the six modules. The three fragments —
    // `fixtureCaseSchema`, `fixtureCaseSetSchema` and `recordedOutputItemSchema` — are
    // deliberately absent: they are sub-schemas and carry no section key, which the
    // fixture-envelope group above asserts.
    const requestSchemas = [
      listingSearchQuerySchema,
      listingIdParamsSchema,
      listingCreateBodySchema,
      listingVersionCreateBodySchema,
      compareQuerySchema,
      evaluationSubmissionBodySchema,
      evaluationIdParamsSchema,
      appealIdParamsSchema,
      appealCreateBodySchema,
      appealRulingBodySchema,
      checkoutSimulationBodySchema,
      refundCreateBodySchema,
      transactionIdParamsSchema,
      demoAccountHeaderSchema,
      challengeCreateBodySchema,
      challengeIdParamsSchema,
      challengeResponseBodySchema,
      threadCreateBodySchema,
      threadIdParamsSchema,
      threadPostBodySchema,
      moderationActionBodySchema,
      moderationListingIdParamsSchema,
      standardProposalCreateBodySchema,
      standardProposalIdParamsSchema,
      standardProposalReviewBodySchema,
    ];

    expect(requestSchemas).toHaveLength(25);

    for (const requestSchema of requestSchemas) {
      const keys = Object.keys(requestSchema);
      // One key in total, and it is one of the four sections: a `response` key or a
      // second section would fail both halves of this pair.
      expect(keys).toHaveLength(1);
      expect(keys.filter((key) => SECTION_KEYS.includes(key))).toHaveLength(1);
    }
  });

  it('closes every body and query schema to its declared fields', () => {
    const bodyBearingSchemas: readonly BodyBearingSchema[] = [
      listingCreateBodySchema,
      listingVersionCreateBodySchema,
      evaluationSubmissionBodySchema,
      appealCreateBodySchema,
      appealRulingBodySchema,
      checkoutSimulationBodySchema,
      refundCreateBodySchema,
      challengeCreateBodySchema,
      challengeResponseBodySchema,
      threadCreateBodySchema,
      threadPostBodySchema,
      moderationActionBodySchema,
      standardProposalCreateBodySchema,
      standardProposalReviewBodySchema,
    ];

    const queryBearingSchemas: readonly QueryBearingSchema[] = [
      listingSearchQuerySchema,
      compareQuerySchema,
    ];

    expect(bodyBearingSchemas).toHaveLength(14);
    expect(queryBearingSchemas).toHaveLength(2);

    for (const requestSchema of bodyBearingSchemas) {
      expect(requestSchema.body.additionalProperties).toBe(false);
    }

    for (const requestSchema of queryBearingSchemas) {
      expect(requestSchema.querystring.additionalProperties).toBe(false);
    }
  });
});

