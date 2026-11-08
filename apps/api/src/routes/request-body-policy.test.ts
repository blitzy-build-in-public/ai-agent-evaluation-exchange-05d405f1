/**
 * Unit test for the request-body policy: the predicate that decides whether a value holds the JSON
 * types its schema fragment declares and carries no field the fragment refuses.
 *
 * **What it covers, and against what.** In-process and with no server, no database and no request: it
 * hands {@link holdsDeclaredTypes} a fragment and a value and reads the answer. Two families of case
 * appear below, and they answer different questions. The synthetic fragments state the rule itself —
 * a number, a boolean, an array, an object and a null where a `string` is declared; a string and a
 * fraction where an `integer` is declared; an undeclared field against `additionalProperties: false`
 * and against its absence; a nested undeclared field inside an array of objects; an unconstrained
 * `{}` property; and a fragment that is not an object at all. The second family takes the fifteen
 * write-body schemas `@adem/shared` publishes — the objects the routes actually validate against —
 * and asserts that the body the web client sends for each one holds, and that one wrongly-typed or
 * undeclared variant of it does not.
 *
 * **What it deliberately does not assert.** The runtime outcome of a refused body — the `400`, the one
 * envelope, and the row that was not written — belongs to
 * `apps/api/test/integration/request-body-policy.test.ts`, which drives the real routes over a real
 * server; the statuses a valid body earns for each row belong to that suite and to
 * `route-walk.test.ts`. Nothing here starts a server, opens a database or reads a file.
 */

import { describe, expect, it } from "vitest";

import {
  appealCreateBodySchema,
  appealRulingBodySchema,
  challengeCreateBodySchema,
  challengeResponseBodySchema,
  checkoutSimulationBodySchema,
  evaluationSubmissionBodySchema,
  inquiryCreateBodySchema,
  listingCreateBodySchema,
  listingVersionCreateBodySchema,
  moderationActionBodySchema,
  refundCreateBodySchema,
  standardProposalCreateBodySchema,
  standardProposalReviewBodySchema,
  threadCreateBodySchema,
  threadPostBodySchema,
} from "@adem/shared";

import { holdsDeclaredTypes } from "./request-body-policy";

/**
 * Identifiers of the shape the contract uses wherever a case needs one. They are deliberately
 * obviously synthetic: this suite asserts a type rule, and a value that read as a real identifier
 * would add meaning the case does not have.
 */
const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const STANDARD_ID = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";

/** A field fragment declaring a string, the shape most write bodies carry for their text fields. */
const STRING_FIELD: unknown = { type: "string", minLength: 1 };

/** A field fragment declaring a whole number, the shape a money field and a count carry. */
const INTEGER_FIELD: unknown = { type: "integer", minimum: 0 };

/** A closed object: one declared string field, and `additionalProperties: false`. */
const CLOSED_BODY: unknown = {
  type: "object",
  required: ["title"],
  properties: { title: STRING_FIELD },
  additionalProperties: false,
};

/** The same object with the closing left out, so an undeclared field is not this predicate's. */
const OPEN_BODY: unknown = {
  type: "object",
  properties: { title: STRING_FIELD },
};

/** The same object declaring `additionalProperties: true`, which states the same thing as absent. */
const EXPLICITLY_OPEN_BODY: unknown = {
  type: "object",
  properties: { title: STRING_FIELD },
  additionalProperties: true,
};

/** A closed object holding a list of closed objects: the nested case, as `recorded_outputs` is. */
const NESTED_CLOSED_BODY: unknown = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { case_id: STRING_FIELD },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

/** A closed object whose only property is unconstrained, as a recorded output's value is. */
const UNCONSTRAINED_PROPERTY_BODY: unknown = {
  type: "object",
  properties: { output: {} },
  additionalProperties: false,
};

describe("holdsDeclaredTypes: a field declaring a string", () => {
  it.each<[string, unknown]>([
    ["a number", 123],
    ["a boolean", true],
    ["an array", ["123"]],
    ["an object", { value: "123" }],
    ["null", null],
  ])("refuses %s where the field declares a string", (_what, value) => {
    expect(holdsDeclaredTypes(STRING_FIELD, value)).toBe(false);
  });

  it.each(["a word", "123", ""])("holds the string %o", (value) => {
    expect(holdsDeclaredTypes(STRING_FIELD, value)).toBe(true);
  });
});

describe("holdsDeclaredTypes: a field declaring an integer", () => {
  it.each<[string, unknown]>([
    ["a numeric string", "42"],
    ["a fraction", 12.5],
    ["a boolean", true],
    ["null", null],
    ["an array holding one", [42]],
  ])("refuses %s where the field declares an integer", (_what, value) => {
    expect(holdsDeclaredTypes(INTEGER_FIELD, value)).toBe(false);
  });

  it.each([0, 4000, -1])("holds the whole number %i", (value) => {
    expect(holdsDeclaredTypes(INTEGER_FIELD, value)).toBe(true);
  });

  it("holds an integer where the field declares a number, and refuses a fraction for an integer", () => {
    expect(holdsDeclaredTypes({ type: "number" }, 25)).toBe(true);
    expect(holdsDeclaredTypes({ type: "number" }, 12.5)).toBe(true);
    expect(holdsDeclaredTypes({ type: "integer" }, 12.5)).toBe(false);
  });
});

describe("holdsDeclaredTypes: the fields of an object", () => {
  it("refuses an undeclared field where the fragment closes the object", () => {
    expect(holdsDeclaredTypes(CLOSED_BODY, { title: "A title", extra: 1 })).toBe(false);
  });

  it("holds a body of declared fields, which is what every accepted write sends", () => {
    expect(holdsDeclaredTypes(CLOSED_BODY, { title: "A title" })).toBe(true);
  });

  it("accepts an undeclared field where `additionalProperties` is absent or true", () => {
    expect(holdsDeclaredTypes(OPEN_BODY, { title: "A title", extra: 1 })).toBe(true);
    expect(holdsDeclaredTypes(EXPLICITLY_OPEN_BODY, { title: "A title", extra: 1 })).toBe(true);
  });

  it("recurses into a declared property, so a wrongly-typed member is refused", () => {
    expect(holdsDeclaredTypes(CLOSED_BODY, { title: 7 })).toBe(false);
  });

  it("refuses a nested undeclared field inside an array of objects", () => {
    expect(holdsDeclaredTypes(NESTED_CLOSED_BODY, { items: [{ case_id: "so-001" }] })).toBe(true);
    expect(
      holdsDeclaredTypes(NESTED_CLOSED_BODY, { items: [{ case_id: "so-001", output: {} }] }),
    ).toBe(false);
  });

  it("holds whatever an unconstrained property carries", () => {
    expect(holdsDeclaredTypes(UNCONSTRAINED_PROPERTY_BODY, { output: { any: ["value"] } })).toBe(
      true,
    );
    expect(holdsDeclaredTypes(UNCONSTRAINED_PROPERTY_BODY, { output: null })).toBe(true);
    expect(holdsDeclaredTypes(UNCONSTRAINED_PROPERTY_BODY, { output: [1, 2, 3] })).toBe(true);
  });

  it("refuses a value of the wrong type for a declared object, and holds one of the right type", () => {
    expect(holdsDeclaredTypes({ type: "object" }, [1, 2])).toBe(false);
    expect(holdsDeclaredTypes({ type: "object" }, null)).toBe(false);
    expect(holdsDeclaredTypes({ type: "object" }, { title: "A title" })).toBe(true);
  });
});

describe("holdsDeclaredTypes: what it does not model, and what it never does", () => {
  it("accepts a fragment that is not a plain object", () => {
    expect(holdsDeclaredTypes(null, "anything")).toBe(true);
    expect(holdsDeclaredTypes(undefined, "anything")).toBe(true);
    expect(holdsDeclaredTypes("not a schema", "anything")).toBe(true);
    expect(holdsDeclaredTypes([{ type: "string" }], "anything")).toBe(true);
    expect(holdsDeclaredTypes(42, "anything")).toBe(true);
  });

  it("accepts a fragment whose keywords it does not model, leaving them to the validator", () => {
    // `const`, `enum`, `required` with no `type`, `contains` and a `$ref` name no JSON type and no
    // declared field, so each states nothing this predicate judges. A later reader must not "fix"
    // them into refusals here: the validator owns every one of them.
    expect(holdsDeclaredTypes({ const: "exact" }, "another value")).toBe(true);
    expect(holdsDeclaredTypes({ enum: ["a", "b"] }, "c")).toBe(true);
    expect(holdsDeclaredTypes({ required: ["title"] }, {})).toBe(true);
    expect(holdsDeclaredTypes({ contains: { type: "string" } }, [1, 2])).toBe(true);
    expect(holdsDeclaredTypes({ $ref: "#/definitions/whatever" }, 7)).toBe(true);
  });

  it("answers a value of any type without throwing", () => {
    expect(holdsDeclaredTypes(STRING_FIELD, 12)).toBe(false);
    expect(holdsDeclaredTypes(CLOSED_BODY, "not an object")).toBe(false);
    expect(holdsDeclaredTypes(CLOSED_BODY, null)).toBe(false);
    expect(holdsDeclaredTypes({ type: ["string", "null"] }, null)).toBe(true);
    expect(holdsDeclaredTypes({ type: ["string", "null"] }, 12)).toBe(false);
  });
});

/**
 * One real write body of `@adem/shared`: the schema the route validates against, the body the web
 * client sends for that row — which must hold — and one variant of it that must not.
 *
 * The variant names the failure the row would otherwise swallow: a field of the wrong JSON type, a
 * field a handler must never read, or a field the row's contract deliberately leaves out.
 */
interface PublishedBodyCase {
  /** The name of the exported schema, which the case titles read. */
  readonly name: string;
  /** The Fastify section object's own `body` fragment. */
  readonly body: unknown;
  /** The body the web client sends for this row. */
  readonly holds: unknown;
  /** One variant of it: wrongly typed, or carrying a field the body does not declare. */
  readonly refused: unknown;
}

const PUBLISHED_BODY_CASES: readonly PublishedBodyCase[] = [
  {
    name: "listingCreateBodySchema",
    body: listingCreateBodySchema.body,
    holds: {
      title: "A fictional listing",
      summary: "A summary.",
      category_id: CATEGORY_ID,
      license_code: "MIT",
      pricing_model: "purchase",
    },
    // The coercion the finding measured: the number is stored as the string "123" without this rule.
    refused: {
      title: 123,
      summary: "A summary.",
      category_id: CATEGORY_ID,
      license_code: "MIT",
      pricing_model: "purchase",
    },
  },
  {
    name: "listingVersionCreateBodySchema",
    body: listingVersionCreateBodySchema.body,
    holds: { version_string: "1.0.1", notes: "Notes for this version." },
    // The listing comes from the path, so a body cannot name a second one.
    refused: { version_string: "1.0.1", listing_id: LISTING_ID },
  },
  {
    name: "inquiryCreateBodySchema",
    body: inquiryCreateBodySchema.body,
    holds: { listing_id: LISTING_ID, message: "Is this available for a licensing trial?" },
    // The buyer is the resolved demo account, never a body field.
    refused: {
      listing_id: LISTING_ID,
      message: "Is this available for a licensing trial?",
      buyer_account_id: "acct0003-0a1b-4c2d-9e3f-a1b2c3d4e5f3",
    },
  },
  {
    name: "challengeCreateBodySchema",
    body: challengeCreateBodySchema.body,
    holds: { listing_id: LISTING_ID, question: "Which fixture set backs the reported outcome?" },
    // The finding's own case: a client-supplied identity is refused, not stripped.
    refused: {
      listing_id: LISTING_ID,
      question: "Which fixture set backs the reported outcome?",
      account_id: "acct0003-0a1b-4c2d-9e3f-a1b2c3d4e5f3",
    },
  },
  {
    name: "challengeResponseBodySchema",
    body: challengeResponseBodySchema.body,
    holds: { body: "The case set is versioned with the standard version." },
    refused: { body: 7 },
  },
  {
    name: "threadCreateBodySchema",
    body: threadCreateBodySchema.body,
    holds: { title: "A discussion thread" },
    // The finding's other case: the opening post a client believed it sent is refused, not dropped.
    refused: { title: "A discussion thread", body: "An opening post the row does not accept." },
  },
  {
    name: "threadPostBodySchema",
    body: threadPostBodySchema.body,
    holds: { body: "A reply to the thread." },
    refused: { body: "A reply to the thread.", author_account_id: "acct0005-0a1b-4c2d-9e3f-a1b2c3d4e5f5" },
  },
  {
    name: "standardProposalCreateBodySchema",
    body: standardProposalCreateBodySchema.body,
    holds: {
      standard_id: STANDARD_ID,
      title: "A proposed addition",
      rationale: "The evidence recorded for the fixture set is unambiguous.",
    },
    // A proposer cannot decide its own proposal: the review route moves the status, not this one.
    refused: {
      standard_id: STANDARD_ID,
      title: "A proposed addition",
      rationale: "The evidence recorded for the fixture set is unambiguous.",
      status: "accepted",
    },
  },
  {
    name: "standardProposalReviewBodySchema",
    body: standardProposalReviewBodySchema.body,
    holds: { status: "accepted", reason: "The rationale is sound." },
    refused: { status: true },
  },
  {
    name: "evaluationSubmissionBodySchema",
    body: evaluationSubmissionBodySchema.body,
    holds: {
      candidate_version_id: VERSION_ID,
      standard_version_id: STANDARD_ID,
      recorded_outputs: [{ case_id: "so-001", output: { answer: "recorded" } }],
    },
    // The retest link is server-derived: no client field may address a predecessor.
    refused: {
      candidate_version_id: VERSION_ID,
      standard_version_id: STANDARD_ID,
      recorded_outputs: [{ case_id: "so-001", output: { answer: "recorded" } }],
      prior_report_id: null,
    },
  },
  {
    name: "appealCreateBodySchema",
    body: appealCreateBodySchema.body,
    holds: { reason: "The recorded evidence does not support the stated outcome." },
    // The report being appealed comes from the path, never from the body.
    refused: {
      reason: "The recorded evidence does not support the stated outcome.",
      report_id: "55555555-5555-4555-8555-555555555555",
    },
  },
  {
    name: "appealRulingBodySchema",
    body: appealRulingBodySchema.body,
    holds: { status: "upheld", reason: "The evidence was misread." },
    refused: { status: 1 },
  },
  {
    name: "checkoutSimulationBodySchema",
    body: checkoutSimulationBodySchema.body,
    holds: { listing_id: LISTING_ID, listing_version_id: VERSION_ID, offer_model: "purchase" },
    // The amount is the server's: it is computed from the offer model, never submitted.
    refused: {
      listing_id: LISTING_ID,
      listing_version_id: VERSION_ID,
      offer_model: "purchase",
      amount_minor_units: 10000,
    },
  },
  {
    name: "refundCreateBodySchema",
    body: refundCreateBodySchema.body,
    holds: { amount_minor_units: 4000 },
    // Money is whole minor units: a numeric string is not the integer the field declares.
    refused: { amount_minor_units: "4000" },
  },
  {
    name: "moderationActionBodySchema",
    body: moderationActionBodySchema.body,
    holds: { action: "flag", reason: "A concern worth a second operator's review." },
    // The status a listing ends up in is the server's; the action chooses between the three.
    refused: {
      action: "flag",
      reason: "A concern worth a second operator's review.",
      status: "hidden",
    },
  },
];

describe("holdsDeclaredTypes: the write bodies @adem/shared publishes", () => {
  it("covers every body schema the schemas folder exports", () => {
    expect(PUBLISHED_BODY_CASES).toHaveLength(15);
    expect(new Set(PUBLISHED_BODY_CASES.map((entry) => entry.name)).size).toBe(15);
  });

  it.each(PUBLISHED_BODY_CASES)("holds the body the web client sends for $name", (entry) => {
    expect(holdsDeclaredTypes(entry.body, entry.holds)).toBe(true);
  });

  it.each(PUBLISHED_BODY_CASES)("refuses a wrongly-typed or undeclared body for $name", (entry) => {
    expect(holdsDeclaredTypes(entry.body, entry.refused)).toBe(false);
  });
});
