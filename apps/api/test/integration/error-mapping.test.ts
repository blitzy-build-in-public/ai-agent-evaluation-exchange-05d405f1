/**
 * The one error envelope's mapping of a route's failed JSON schema — the demo-session header's
 * failure answered `401 unauthorized`, and every other schema rejection answered `400
 * validation_error` — the client errors Fastify raises for a body it will not parse, the transport
 * pair answered at their own statuses rather than as server faults and a body the runtime's JSON
 * parser refuses answered with the envelope's own sentence rather than the parser's, the refusal of a
 * request that never became one answered by the transport-level handler, and the level each failure is
 * recorded at.
 *
 * `apps/api/src/server.ts` is the composition root whose one `setErrorHandler` performs that mapping
 * in the product, and it exports the mapping as `mapFailure` and its logging policy as
 * `failureLogLevel`, so the assertions below measure the product's own answer rather than a copy of
 * it. The probe instance composes `mapFailure` and the envelope exactly as that handler does, which
 * is what lets a real Fastify validation pass be measured: both probes carry the contract's own
 * wiring — `demoAccountHeaderSchema` from `@adem/shared` on each, and a body schema on the write
 * probe — so the header failure the contract answers `401` and a body failure it answers `400` are
 * observed at the edge rather than reconstructed by hand.
 *
 * The two conditions Fastify raises before any schema runs — a body above its 1 MiB limit and a media
 * type with no parser — are measured twice: as the mapped answer for the value the framework really
 * raises, and through a real request on the instance `../../src/index`'s `createServer` builds over
 * one in-memory handle, where the status and the sentence a client receives are read off the wire.
 *
 * A third probe throws a domain package's own refusal — `@adem/sgi-core`'s for a number JSON cannot
 * carry — which exercises the mapping's other branch: a code the one code-to-status map records is
 * answered with that status and the code the domain spelled, so a refusal the contract calls a
 * malformed submission is `400` rather than the `500 internal_error` the mapper reserves for a code
 * it does not know, and the domain's own sentence reaches the client unchanged.
 *
 * A further ground is the one no Fastify request exists for: a request the HTTP parser itself refuses
 * — a garbage request line, a header name carrying a space or a NUL, an HTTP version the parser does
 * not know. Those cases write their bytes over a loopback connection to the product's own instance
 * listening on an ephemeral port, because `app.inject` speaks through an HTTP client that a malformed
 * request cannot survive: no request object is built for it, so no route, hook or error handler is
 * reached. What they assert is the one envelope the transport-level handler frames by hand, in place
 * of the framework's own built-in error body.
 *
 * Every request whose mapping is asserted goes through `app.inject`, so no port is bound and no
 * temporary file is written for those; the parser-refused ground above is the one that needs a real
 * socket. The two databases this file opens are in-memory handles, one per instance, each closed with
 * the instance it was handed to.
 */

import { createConnection } from "node:net";

import Database from "better-sqlite3";
import Fastify from "fastify";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canonicalize } from "@adem/sgi-core";
import { DEMO_ACCOUNT_HEADER, demoAccountHeaderSchema } from "@adem/shared";

import type { ErrorEnvelope } from "../../src/errors/error-envelope";
import { ApiError, envelope, toApiError } from "../../src/errors/error-envelope";
// The product instance the real-request probes run against is built by the workspace's public entry,
// which is the factory the documented `npm start` and the integration harness both reach; the mapping
// and the logging policy are the composition root's own exports beside it.
import { createServer } from "../../src/index";
import { API_PREFIX, failureLogLevel, mapFailure } from "../../src/server";

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
const REFUSAL_PROBE_PATH = "/probe/domain-refusal";
const PROBE_MARKER = "probe-handler-reached";

/**
 * The refusal `@adem/sgi-core` raises for a value canonical JSON cannot carry: the real error, taken
 * from the package's own exported renderer rather than restated, so the assertions below measure the
 * value the product actually throws — its own stable `code` and its own sentence included — and not a
 * hand-built object that merely carries those members. The refusal class is deliberately not
 * re-exported from the package entry, which is why the instance is obtained by asking `canonicalize`
 * to render the one input JSON text reaches it through: `1e999`, which `JSON.parse` reads as
 * `Infinity`.
 */
function domainRefusal(): unknown {
  try {
    canonicalize(Number.POSITIVE_INFINITY);
  } catch (error) {
    return error;
  }
  return "the domain call returned instead of refusing";
}

/**
 * The sentence a client receives for a server fault, restated from the mapper's own text so that a
 * mapping which leaked a thrown message instead of substituting this one fails the assertion.
 */
const GENERIC_MESSAGE = "The request could not be completed. The failure has been recorded.";

/**
 * The sentence a client receives for a client error whose thrown message cannot be sent: the
 * substitution the envelope makes below `500`, restated from its own text for the same reason as
 * {@link GENERIC_MESSAGE}. It is the sentence the two transport failures below read whenever the
 * framework's own text carries a separator or a driver report.
 */
const CLIENT_ERROR_SENTENCE = "The request could not be completed as sent.";

/**
 * The failure Fastify raises for a body above the route's limit — 1 MiB by default — restated as the
 * value the framework produces rather than taken from the module under test, because the assertion is
 * about what the framework really handed the handler. Its `message` is the framework's own sentence,
 * which carries no separator, no stack and no driver report, so the safety gate lets it through.
 */
const PAYLOAD_TOO_LARGE_FAILURE = {
  code: "FST_ERR_CTP_BODY_TOO_LARGE",
  statusCode: 413,
  message: "Request body is too large",
} as const;

/**
 * The failure Fastify raises for a media type it has no parser for, restated the same way. Its
 * `message` names the refused media type, and every media type is spelled `<type>/<subtype>`: the
 * separator is one of the markers the safety gate refuses, so this failure is answered with the
 * envelope's own client-error sentence rather than with the framework's spelling.
 */
const INVALID_MEDIA_TYPE_FAILURE = {
  code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
  statusCode: 415,
  message: "Unsupported Media Type: application/x-www-form-urlencoded",
} as const;

/**
 * Fastify's default body limit, restated as the size the oversized probe is measured against: the
 * framework's own constant is not exported, and a payload above it is what produces the `413`.
 */
const BODY_LIMIT_BYTES = 1_048_576;

/**
 * The bodies the runtime's JSON parser refuses: none of them is JSON, and each differs from the others
 * only in the text that made it unparsable. The three spellings are the reason the sentence a client
 * reads is the envelope's own — the parser names the caller's own bytes back for one of them and only
 * its own position for another, so the framework's message gave three malformed bodies three different
 * sentences.
 */
const MALFORMED_JSON_BODIES: readonly string[] = ["<html>", '{"title": ', '{"a":1,}'];

/**
 * The address the raw-connection probes connect to: the loopback address and never the wildcard, so a
 * probe reaches its own instance's socket and only that one.
 */
const LOOPBACK_HOST = "127.0.0.1";

/**
 * The requests the HTTP parser itself refuses, each named for the shape that makes it unparsable. None
 * of them needs a header or a body to be refused: the parser never gets as far as routing the request,
 * so what it refuses is the syntax and nothing about the destination, and the path and version are the
 * API's own only because a probe should ask for the API it is probing.
 */
const PARSER_REFUSED_REQUESTS: readonly { readonly shape: string; readonly raw: string }[] = [
  {
    shape: "a header name carrying a space",
    raw: `GET ${API_PREFIX}/listings HTTP/1.1\r\nHost: x\r\nBad Header: a\r\n\r\n`,
  },
  {
    shape: "a header name carrying a NUL",
    raw: `GET ${API_PREFIX}/listings HTTP/1.1\r\nHost: x\r\nBad\u0000Header: a\r\n\r\n`,
  },
  { shape: "a garbage request line", raw: "GARBAGE\r\n\r\n" },
  { shape: "an impossible HTTP version", raw: `GET ${API_PREFIX}/listings HTTP/9.9\r\n\r\n` },
];

/**
 * The statuses a framework failure may carry that the closed vocabulary has no code for. Each is in
 * the client-error range and none is in `STATUS_DEFAULT_CODE`, so the mapping's documented answer — a
 * status it cannot name a code for is answered `500 internal_error` — is what these pin.
 */
const UNMAPPED_CLIENT_STATUSES: readonly number[] = [405, 406, 408, 418];

/**
 * The statuses {@link failureLogLevel} is asserted over: every status the closed vocabulary carries,
 * so the policy is pinned for each of them, plus `503`, a server fault the contract does not name and
 * which must still be recorded as one.
 */
const REFUSED_STATUSES: readonly number[] = [400, 401, 403, 404, 409, 413, 415, 422, 429];
const SERVER_FAULT_STATUSES: readonly number[] = [500, 503];

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
 * The product instance the two real-request probes run against: `createServer` over one in-memory
 * handle, so the requests cross the composition root's own wiring — the one error handler, the
 * migration runner, the route groups and the rate-limit plugin — rather than a probe route of this
 * file's. Its configuration is resolved with the port pinned, so this file answers the same way in a
 * shell that sets `ADEM_PORT`.
 *
 * The handle is created here and handed in, so `createServer` does not own it: it is deliberately not
 * closed by the instance and is closed with it in the teardown below.
 */
const productDatabase = new Database(":memory:");
const productApp = createServer({ database: productDatabase, port: 1 });

/**
 * The instance the raw-connection cases run against: the product's own instance over an in-memory
 * handle of its own, listening on an ephemeral port for the four parser-refused shapes.
 *
 * It gets a handle of its own rather than sharing `productDatabase`, because a refusal that never
 * became a request reads nothing: sharing one would couple two grounds that prove different things,
 * and neither handle is written to by a parser refusal. The port is pinned in the configuration for
 * the same reason as the instance above — a shell that sets `ADEM_PORT` must not change what this file
 * proves — and the socket is bound to port 0 later, so the kernel's ephemeral port is the one used.
 */
const parserDatabase = new Database(":memory:");
const parserApp = createServer({ database: parserDatabase, port: 1 });

/** The port {@link parserApp} bound, read back from its own socket once it listens. */
let parserPort = 0;

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
 *
 * The mapping measured is `apps/api/src/server.ts`'s exported `mapFailure`, which is the whole of
 * what the product's error handler applies to a thrown value — so an assertion here cannot drift
 * from the answer a client receives, and a case the composition root could not see would fail here
 * rather than pass.
 */
function expectMappedAs(value: unknown, status: number, code: string, message: string): void {
  expect(() => mapFailure(value)).not.toThrow();
  const mapped = mapFailure(value);
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
 * Writes one request's raw bytes over a fresh loopback connection and answers with everything the
 * server wrote back before the connection closed.
 *
 * A connection rather than a request, because the refusal these cases measure happens before there is
 * a request to make: `app.inject` and the global `fetch` both hand their request to an HTTP client
 * whose own parser would reject or re-encode a malformed spelling, and the framework's handler for a
 * request the parser refuses can only be reached by bytes arriving on a socket.
 *
 * The server answers and then destroys the connection, so a reset can arrive after the bytes this
 * probe reads: an error once something has been received is the teardown of the connection rather than
 * a failed probe. A connection that closes having carried nothing is refused here, because the case's
 * assertion would otherwise report an empty answer as a missing envelope.
 */
function sendRawRequest(rawRequest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: LOOPBACK_HOST, port: parserPort });
    const chunks: Buffer[] = [];

    socket.on("connect", () => socket.write(rawRequest));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on("error", (error: Error) => {
      if (chunks.length === 0) {
        reject(error);
      }
    });
    socket.on("close", () => {
      if (chunks.length === 0) {
        reject(new Error("The connection closed before the server wrote a response."));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
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
    const mapped = mapFailure(error);
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

  // The domain refusal, thrown from a handler exactly as `apps/api/src/routes/evaluations.ts` lets a
  // scoring refusal out: the route catches nothing, and the one error handler maps what it threw.
  app.post(REFUSAL_PROBE_PATH, { schema: demoAccountHeaderSchema }, () => {
    throw domainRefusal();
  });

  await app.ready();

  // The product instance is readied for the same reason: its routes, the rate-limit plugin and the
  // migration runner are what the two real-request probes cross.
  await productApp.ready();

  // The parser-refused cases need a real socket, and a socket needs a bound port: `listen` is handed
  // port 0 so the kernel chooses one, and the port it chose is read back from the instance's own
  // address rather than assumed, so this file binds nothing another suite or another process holds.
  await parserApp.listen({ port: 0, host: LOOPBACK_HOST });

  const address = parserApp.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("The parser-refused probe instance did not bind a loopback port.");
  }

  parserPort = address.port;
});

beforeEach(() => {
  lastThrownValue = undefined;
  headerHandlerReached = false;
  writeHandlerReached = false;
});

afterAll(async () => {
  await app.close();

  // The instance first, then the handle it was handed: the composition root closes only a connection
  // it opened itself, so this file is the one that releases this one.
  await productApp.close();
  productDatabase.close();

  // The same order for the parser-refused ground, which owns a listening socket as well as a handle.
  await parserApp.close();
  parserDatabase.close();
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

describe("a domain package's refusal", () => {
  it("answers a refusal carrying unrenderable_value with 400 and the domain's own sentence", async () => {
    const refusalMessage = carriedMessage(domainRefusal());

    // The sentence the domain wrote passes the envelope's safety gate, so it is the sentence the
    // client reads rather than a substitution: at most 200 characters, non-blank, no control
    // character and none of the markers that make a message a stack, a driver report or a query.
    expect(refusalMessage.length).toBeGreaterThan(0);
    expect(refusalMessage.length).toBeLessThanOrEqual(200);

    const { status, body, thrownValue } = await probeWrite({
      method: "POST",
      url: REFUSAL_PROBE_PATH,
      headers: { [DEMO_ACCOUNT_HEADER]: PROBE_ACCOUNT },
    });

    // The point of the case: the refusal's own code is an entry of the one code-to-status map, so a
    // refusal the contract calls a malformed submission is answered `400` with the code the domain
    // spelled — never the `500 internal_error` fallback the mapper reserves for a code it does not
    // know, and never a message the mapper substituted for the domain's own.
    expect(status).toBe(400);
    expectEnvelopeFailure(body, "unrenderable_value", refusalMessage);
    expect(refusalMessage).not.toBe(GENERIC_MESSAGE);

    expect(carriedCode(thrownValue)).toBe("unrenderable_value");
    expectMappedAs(thrownValue, 400, "unrenderable_value", refusalMessage);
  });
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

describe("a request Fastify refuses before any schema runs", () => {
  it("maps a payload above the route's limit to 413 payload_too_large", () => {
    // The framework's sentence for this failure names the body and nothing else — no path, no
    // separator, no driver report — so the safety gate lets it through unchanged and the client reads
    // it rather than the envelope's own sentence for the status.
    expectMappedAs(PAYLOAD_TOO_LARGE_FAILURE, 413, "payload_too_large", "Request body is too large");
  });

  it("maps a media type with no parser to 415 unsupported_media_type", () => {
    // The framework's sentence ends in the refused media type, and every media type is spelled
    // `<type>/<subtype>`: that separator is one of the markers the gate refuses, so the client reads
    // the envelope's own sentence for the status and never the framework's spelling of the media type.
    expectMappedAs(INVALID_MEDIA_TYPE_FAILURE, 415, "unsupported_media_type", CLIENT_ERROR_SENTENCE);
  });

  it.each([
    {
      failure: { ...PAYLOAD_TOO_LARGE_FAILURE, message: undefined },
      status: 413,
      code: "payload_too_large",
    },
    { failure: { ...PAYLOAD_TOO_LARGE_FAILURE, message: "" }, status: 413, code: "payload_too_large" },
    {
      failure: {
        ...PAYLOAD_TOO_LARGE_FAILURE,
        message: "FST_ERR_CTP_BODY_TOO_LARGE\n at Object.<anonymous> (/tmp/probe.js:1:1)",
      },
      status: 413,
      code: "payload_too_large",
    },
    {
      failure: { ...INVALID_MEDIA_TYPE_FAILURE, message: undefined },
      status: 415,
      code: "unsupported_media_type",
    },
    {
      failure: { ...INVALID_MEDIA_TYPE_FAILURE, message: "   " },
      status: 415,
      code: "unsupported_media_type",
    },
    {
      failure: { ...INVALID_MEDIA_TYPE_FAILURE, message: `Unsupported Media Type: ${"x".repeat(200)}` },
      status: 415,
      code: "unsupported_media_type",
    },
  ])(
    "answers a transport failure whose message cannot be sent with the client-error sentence",
    ({ failure, status, code }) => {
      // A message that is absent, blank, over-long or a stack is replaced by the sentence the status
      // selects. Below `500` that is the client-error sentence and never the server-fault one: a
      // refused request must not be described to the client as a failure the server recorded.
      expectMappedAs(failure, status, code, CLIENT_ERROR_SENTENCE);
    },
  );

  it.each([
    { statusCode: PAYLOAD_TOO_LARGE_FAILURE.statusCode, code: "payload_too_large" },
    { statusCode: INVALID_MEDIA_TYPE_FAILURE.statusCode, code: "unsupported_media_type" },
  ])(
    "answers a transport failure carrying only its status at that status",
    ({ statusCode, code }) => {
      // A value carrying the status and nothing else is the shape the inverse map is documented for:
      // the status Fastify raised is enough to answer with, and the sentence is the envelope's own.
      expectMappedAs({ statusCode }, statusCode, code, CLIENT_ERROR_SENTENCE);
    },
  );

  it("answers a framework failure at a 4xx status the vocabulary carries with that status's code", () => {
    // `FST_ERR_CTP_EMPTY_JSON_BODY` is Fastify's own `400` for a JSON content type with nothing in
    // the body: a framework code outside the closed vocabulary at a status the inverse map carries,
    // so the status supplies the code and the client is told its request was refused. The framework's
    // sentence names a media type, so the gate refuses it and the envelope's sentence is what a client
    // reads.
    expectMappedAs(
      {
        code: "FST_ERR_CTP_EMPTY_JSON_BODY",
        statusCode: 400,
        message: "Body cannot be empty when content-type is set to 'application/json'",
      },
      400,
      "validation_error",
      CLIENT_ERROR_SENTENCE,
    );
  });

  it.each(UNMAPPED_CLIENT_STATUSES)(
    "answers a framework failure at a 4xx status the vocabulary carries no code for with 500 internal_error",
    (statusCode) => {
      // The documented boundary: a status nothing can name a code for is not passed through with a
      // code invented for it. It is answered as the mapper answered it, which is the generic server
      // fault, so no client ever reads a status the contract does not define.
      expectMappedAs({ statusCode }, 500, "internal_error", GENERIC_MESSAGE);
    },
  );
});

describe("a request the product refuses, through a real request", () => {
  it("answers a body above the 1 MiB default with 413 payload_too_large", async () => {
    // The payload is one body limit's worth of title, so it is above Fastify's default limit by the
    // bytes the JSON envelope around it adds. No header is needed: the parser refuses the body before
    // the route's own schemas, the demo header's included, are looked at.
    const response = await productApp.inject({
      method: "POST",
      url: `${API_PREFIX}/listings`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "a".repeat(BODY_LIMIT_BYTES) }),
    });

    expect(response.statusCode).toBe(413);
    expectEnvelopeFailure(
      JSON.parse(response.body),
      "payload_too_large",
      "Request body is too large",
    );
  });

  it("answers a media type with no parser with 415 unsupported_media_type", async () => {
    const response = await productApp.inject({
      method: "POST",
      url: `${API_PREFIX}/threads`,
      headers: { "content-type": "application/xml" },
      payload: "<title>a probe thread</title>",
    });

    expect(response.statusCode).toBe(415);
    expectEnvelopeFailure(
      JSON.parse(response.body),
      "unsupported_media_type",
      CLIENT_ERROR_SENTENCE,
    );
  });

  it.each(MALFORMED_JSON_BODIES)(
    "answers a body the runtime's JSON parser refuses with the envelope's own sentence",
    async (payload) => {
      // No header is needed here either: the parser refuses the body before the route's own schemas,
      // the demo header's included, are looked at. The sentence asserted is the envelope's and never
      // the parser's, which for these three spellings names the caller's own bytes back for one body
      // and only its own position for another — three malformed forms, one answer.
      const response = await productApp.inject({
        method: "POST",
        url: `${API_PREFIX}/listings`,
        headers: { "content-type": "application/json" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expectEnvelopeFailure(JSON.parse(response.body), "validation_error", CLIENT_ERROR_SENTENCE);
    },
  );
});

describe("a request the HTTP parser itself refuses", () => {
  it.each(PARSER_REFUSED_REQUESTS)(
    "answers $shape with the one envelope at 400",
    async ({ raw }) => {
      const response = await sendRawRequest(raw);

      // The status line is framed by the transport-level handler rather than by the framework, so it
      // is asserted as a line: the protocol, the status the contract gives a request the API will not
      // accept, and a reason phrase that is always present.
      const lineEnd = response.indexOf("\r\n");

      expect(lineEnd).toBeGreaterThan(0);
      expect(response.slice(0, lineEnd)).toMatch(/^HTTP\/1\.1 400 .+$/);

      // And the body is the one envelope, in place of the framework's own built-in error body.
      const bodyStart = response.indexOf("\r\n\r\n");

      expect(bodyStart).toBeGreaterThan(0);
      expectEnvelopeFailure(
        JSON.parse(response.slice(bodyStart + 4)),
        "validation_error",
        CLIENT_ERROR_SENTENCE,
      );
    },
  );
});

describe("the level a failure is recorded at", () => {
  it.each(REFUSED_STATUSES)("records a refused request at warning level", (status) => {
    expect(failureLogLevel(status)).toBe("warn");
  });

  it.each(SERVER_FAULT_STATUSES)("records a server fault at error level", (status) => {
    expect(failureLogLevel(status)).toBe("error");
  });
});
