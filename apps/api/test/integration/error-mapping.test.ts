/**
 * The one error envelope's mapping of a route's failed JSON schema: the demo-session header's
 * failure answered `401 unauthorized`, and every other schema rejection answered `400
 * validation_error`, both from the single mapper and through the single envelope shape.
 *
 * `apps/api/src/server.ts` — the composition root whose one `setErrorHandler` performs this
 * mapping in the product — is a sibling deliverable that does not exist yet, so the probe
 * instance below composes the mapping here exactly as that handler composes it:
 * `const mapped = toApiError(error)` and then `reply.code(mapped.status).send(...)`. What the
 * assertions measure is the mapping itself, over a real Fastify validation pass: both probes
 * carry the contract's own wiring — `demoAccountHeaderSchema` from `@adem/shared` on each, and a
 * body schema on the write probe — so the header failure the contract answers `401` and a body
 * failure it answers `400` are observed at the edge rather than reconstructed by hand.
 *
 * Every request goes through `app.inject`, so no port is bound, no database is opened and no
 * temporary file is written.
 */

import Fastify from "fastify";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ACCOUNT_HEADER, demoAccountHeaderSchema } from "@adem/shared";

import type { ErrorEnvelope } from "../../src/errors/error-envelope";
import { ApiError, envelope, toApiError } from "../../src/errors/error-envelope";

/**
 * Fastify's own code for a request that fails a route's schema, restated here as the literal the
 * framework raises rather than imported from the module under test: these assertions are about a
 * value Fastify really produced, and a test that took the code from the mapper could not show it.
 */
const FASTIFY_VALIDATION_CODE = "FST_ERR_VALIDATION";

/**
 * The demo header's name as a validation failure spells it. Fastify lowercases the incoming header
 * names and the schema's names alike, so the lowercased spelling is the one Ajv reports — derived
 * from the header name's single declaration site rather than retyped.
 */
const DEMO_HEADER_VALIDATION_NAME = DEMO_ACCOUNT_HEADER.toLowerCase();

/**
 * The value the header schema accepts: the schema constrains presence and non-emptiness only, and
 * resolving it to a seeded account is `apps/api/src/auth/resolve-demo-account.ts`'s job, which
 * neither probe calls.
 */
const PROBE_ACCOUNT = "demo-probe-account";

const HEADER_PROBE_PATH = "/probe/demo-header";
const WRITE_PROBE_PATH = "/probe/demo-write";
const PROBE_MARKER = "probe-handler-reached";

/**
 * The sentence a client receives for a server fault, restated from the mapper's own text so that a
 * mapping which leaked a thrown message instead of substituting this one fails the assertion.
 */
const GENERIC_MESSAGE = "The request could not be completed. The failure has been recorded.";

/**
 * The write probe's schema: the demo header of the contract's non-public rows, plus a body with one
 * required property and one typed property, so a missing property (`required`) and a wrong-typed
 * property (`type`) are both reachable through a real request.
 */
const WRITE_PROBE_SCHEMA = {
  ...demoAccountHeaderSchema,
  body: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", minLength: 1 },
      case_count: { type: "integer" },
    },
    additionalProperties: false,
  },
} as const;

const app = Fastify();

/**
 * The value the mapping was handed for the most recent request, so each HTTP assertion can be
 * paired with a direct assertion on the raw failure Fastify raised.
 */
let lastThrownValue: unknown = undefined;
let headerHandlerReached = false;
let writeHandlerReached = false;

interface ProbeResult {
  readonly status: number;
  readonly body: unknown;
  readonly thrownValue: unknown;
}

/**
 * Sends one probe request and answers with its status, its parsed body and the value the mapping
 * was handed for it.
 */
async function probeWrite(options: InjectOptions): Promise<ProbeResult> {
  lastThrownValue = undefined;
  const response = await app.inject(options);
  return {
    status: response.statusCode,
    body: JSON.parse(response.body),
    thrownValue: lastThrownValue,
  };
}

/**
 * Asserts the one failure shape: `error`, and inside it exactly `code` and `message`, carrying the
 * sentence the envelope's own vocabulary supplies.
 */
function expectEnvelopeFailure(body: unknown, code: string, message: string): void {
  const parsed = body as ErrorEnvelope;
  expect(Object.keys(parsed)).toEqual(["error"]);
  expect(Object.keys(parsed.error)).toEqual(["code", "message"]);
  expect(parsed.error.code).toBe(code);
  expect(parsed.error.message).toBe(message);
}

/**
 * Asserts the mapping's own answer for a value Fastify really raised: the status, the code and the
 * sentence, never throwing on the way.
 */
function expectMappedAs(value: unknown, status: number, code: string, message: string): void {
  expect(() => toApiError(value)).not.toThrow();
  const mapped = toApiError(value);
  expect(mapped.status).toBe(status);
  expect(mapped.code).toBe(code);
  expect(mapped.message).toBe(message);
}

/** The stable code a thrown value carries, read the way the mapping reads it. */
function carriedCode(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as { code?: unknown }).code;
}

/** The message Fastify wrote, which is the schema's spelling the client must never read back. */
function carriedMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const message: unknown = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/**
 * Validation failures whose `validation` member, entry, `params` or `instancePath` is missing or of
 * the wrong type. Each must be answered `400` and must not throw: the mapper promises an `ApiError`
 * for every input, and an unreadable entry is no evidence that the demo header failed.
 */
const UNREADABLE_VALIDATION_FAILURES: readonly unknown[] = [
  { code: FASTIFY_VALIDATION_CODE },
  { code: FASTIFY_VALIDATION_CODE, validation: "not an array" },
  { code: FASTIFY_VALIDATION_CODE, validation: [null] },
  { code: FASTIFY_VALIDATION_CODE, validation: [{}] },
  { code: FASTIFY_VALIDATION_CODE, validation: [{ instancePath: 5, params: "x", keyword: 7 }] },
  { code: FASTIFY_VALIDATION_CODE, validation: [{ keyword: "required", params: {} }] },
  { code: FASTIFY_VALIDATION_CODE, validation: [{ instancePath: "/ok", keyword: 3 }] },
];

/** Validation failures that concern the demo header, in every shape Fastify reports one. */
const DEMO_HEADER_FAILURES: readonly unknown[] = [
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [
      {
        instancePath: "",
        schemaPath: "#/required",
        keyword: "required",
        params: { missingProperty: DEMO_HEADER_VALIDATION_NAME },
        message: `must have required property '${DEMO_HEADER_VALIDATION_NAME}'`,
      },
    ],
  },
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [
      {
        instancePath: `/${DEMO_HEADER_VALIDATION_NAME}`,
        schemaPath: `#/properties/${DEMO_HEADER_VALIDATION_NAME}/minLength`,
        keyword: "minLength",
        params: { limit: 1 },
      },
    ],
  },
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [
      { instancePath: "", keyword: "required", params: { missingProperty: DEMO_ACCOUNT_HEADER } },
    ],
  },
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [{ instancePath: `/${DEMO_ACCOUNT_HEADER}`, keyword: "minLength", params: {} }],
  },
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [
      { instancePath: "", keyword: "required", params: { missingProperty: "title" } },
      {
        instancePath: "",
        keyword: "required",
        params: { missingProperty: DEMO_HEADER_VALIDATION_NAME },
      },
    ],
  },
];

/** Validation failures that concern something else, which the contract answers `400`. */
const BODY_FAILURES: readonly unknown[] = [
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [
      { instancePath: "", keyword: "required", params: { missingProperty: "title" } },
    ],
  },
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [
      { instancePath: "/case_count", keyword: "type", params: { type: "integer" } },
    ],
  },
  {
    code: FASTIFY_VALIDATION_CODE,
    validation: [{ instancePath: "/title", keyword: "minLength", params: { limit: 1 } }],
  },
];

beforeAll(async () => {
  app.setErrorHandler((error, _request, reply) => {
    lastThrownValue = error;
    const mapped = toApiError(error);
    return reply.code(mapped.status).send(envelope(mapped.code, mapped.message));
  });

  app.post(HEADER_PROBE_PATH, { schema: demoAccountHeaderSchema }, (_request, reply) => {
    headerHandlerReached = true;
    return reply.code(200).send({ marker: PROBE_MARKER });
  });

  app.post(WRITE_PROBE_PATH, { schema: WRITE_PROBE_SCHEMA }, (_request, reply) => {
    writeHandlerReached = true;
    return reply.code(200).send({ marker: PROBE_MARKER });
  });

  await app.ready();
});

beforeEach(() => {
  lastThrownValue = undefined;
  headerHandlerReached = false;
  writeHandlerReached = false;
});

afterAll(async () => {
  await app.close();
});

describe("the demo header's failed validation", () => {
  it("answers a request without the header with 401 unauthorized", async () => {
    const { status, body, thrownValue } = await probeWrite({
      method: "POST",
      url: HEADER_PROBE_PATH,
    });

    expect(status).toBe(401);
    expectEnvelopeFailure(body, "unauthorized", ApiError.unauthorized().message);
    expect(headerHandlerReached).toBe(false);

    // The value the mapping was handed is Fastify's own failure, and its schema spelling is what
    // the client must not read back — the response carries the factory's sentence instead.
    expect(carriedCode(thrownValue)).toBe(FASTIFY_VALIDATION_CODE);
    expect(carriedMessage(thrownValue)).toContain(DEMO_HEADER_VALIDATION_NAME);
    expectMappedAs(thrownValue, 401, "unauthorized", ApiError.unauthorized().message);
  });

  it("answers a request whose header is empty with 401 unauthorized", async () => {
    const { status, body, thrownValue } = await probeWrite({
      method: "POST",
      url: HEADER_PROBE_PATH,
      headers: { [DEMO_ACCOUNT_HEADER]: "" },
    });

    expect(status).toBe(401);
    expectEnvelopeFailure(body, "unauthorized", ApiError.unauthorized().message);
    expect(headerHandlerReached).toBe(false);
    expect(carriedCode(thrownValue)).toBe(FASTIFY_VALIDATION_CODE);
    expectMappedAs(thrownValue, 401, "unauthorized", ApiError.unauthorized().message);
  });

  it("lets a request carrying the header reach the handler", async () => {
    const { status, body } = await probeWrite({
      method: "POST",
      url: HEADER_PROBE_PATH,
      headers: { [DEMO_ACCOUNT_HEADER]: PROBE_ACCOUNT },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ marker: PROBE_MARKER });
    expect(headerHandlerReached).toBe(true);
  });

  it.each(DEMO_HEADER_FAILURES)("maps a header failure to 401 unauthorized", (thrownValue) => {
    expectMappedAs(thrownValue, 401, "unauthorized", ApiError.unauthorized().message);
  });
});

describe("another failed schema", () => {
  it("answers a body missing a required property with 400 validation_error", async () => {
    const { status, body, thrownValue } = await probeWrite({
      method: "POST",
      url: WRITE_PROBE_PATH,
      headers: { [DEMO_ACCOUNT_HEADER]: PROBE_ACCOUNT },
      payload: { case_count: 3 },
    });

    expect(status).toBe(400);
    expectEnvelopeFailure(body, "validation_error", ApiError.validation().message);
    expect(writeHandlerReached).toBe(false);
    expect(carriedCode(thrownValue)).toBe(FASTIFY_VALIDATION_CODE);
    expectMappedAs(thrownValue, 400, "validation_error", ApiError.validation().message);
  });

  it("answers a body carrying a wrong-typed property with 400 validation_error", async () => {
    const { status, body, thrownValue } = await probeWrite({
      method: "POST",
      url: WRITE_PROBE_PATH,
      headers: { [DEMO_ACCOUNT_HEADER]: PROBE_ACCOUNT },
      payload: { title: "a probe listing", case_count: "three" },
    });

    expect(status).toBe(400);
    expectEnvelopeFailure(body, "validation_error", ApiError.validation().message);
    expect(writeHandlerReached).toBe(false);
    expect(carriedCode(thrownValue)).toBe(FASTIFY_VALIDATION_CODE);
    expectMappedAs(thrownValue, 400, "validation_error", ApiError.validation().message);
  });

  it("reaches the handler once both schemas pass", async () => {
    const { status, body } = await probeWrite({
      method: "POST",
      url: WRITE_PROBE_PATH,
      headers: { [DEMO_ACCOUNT_HEADER]: PROBE_ACCOUNT },
      payload: { title: "a probe listing", case_count: 3 },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ marker: PROBE_MARKER });
    expect(writeHandlerReached).toBe(true);
  });

  it("answers a request that fails the body and the header together with 400", async () => {
    // Fastify validates a route's parts in order — params, body, querystring, then headers —
    // and reports the first failure alone, so a request that fails both is answered for its
    // body. The assertion is here because it also pins that a body failure is never mistaken
    // for a header one: the mapping reads the failure's own entries rather than answering
    // `401` for any rejection.
    const { status, body, thrownValue } = await probeWrite({
      method: "POST",
      url: WRITE_PROBE_PATH,
      payload: {},
    });

    expect(status).toBe(400);
    expectEnvelopeFailure(body, "validation_error", ApiError.validation().message);
    expect(writeHandlerReached).toBe(false);
    expect(carriedCode(thrownValue)).toBe(FASTIFY_VALIDATION_CODE);
    expectMappedAs(thrownValue, 400, "validation_error", ApiError.validation().message);
  });

  it.each(BODY_FAILURES)("maps a body failure to 400 validation_error", (thrownValue) => {
    expectMappedAs(thrownValue, 400, "validation_error", ApiError.validation().message);
  });

  it.each(UNREADABLE_VALIDATION_FAILURES)(
    "maps a validation failure it cannot read to 400 validation_error",
    (thrownValue) => {
      expectMappedAs(thrownValue, 400, "validation_error", ApiError.validation().message);
    },
  );
});

describe("every other thrown value", () => {
  it("returns an ApiError unchanged", () => {
    const thrown = new ApiError(403, "forbidden", "x");
    expect(toApiError(thrown)).toBe(thrown);
  });

  it.each([
    "seam_validation",
    "duplicate_extension",
    "unknown_event_type",
    "SQLITE_CONSTRAINT_UNIQUE",
  ])("maps an unmapped code to 500 internal_error with the generic sentence", (code) => {
    const mapped = toApiError({ code, message: "x" });
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("internal_error");
    expect(mapped.message).toBe(GENERIC_MESSAGE);
  });

  it.each([undefined, null, "boom", 42, {}, new Error("driver failure")])(
    "answers a value it cannot map with 500 internal_error",
    (thrownValue) => {
      expect(() => toApiError(thrownValue)).not.toThrow();
      const mapped = toApiError(thrownValue);
      expect(mapped.status).toBe(500);
      expect(mapped.code).toBe("internal_error");
      expect(mapped.message).toBe(GENERIC_MESSAGE);
    },
  );
});
