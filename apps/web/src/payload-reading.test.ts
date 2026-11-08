/**
 * The payload-reading module's pure functions, pinned to the rules it documents.
 *
 * `apps/web` has no DOM test environment — no such package is in the dependency inventory — so this
 * workspace's unit tests cover pure functions only. `Timestamp` is exercised the one way available
 * without a document: the function is called directly and the element it returns is read for its props,
 * which pins the machine-readable value it carries. How that element paints belongs to the browser
 * suites.
 *
 * Every table below is about a value that crossed the client boundary, which is why several of the
 * cases are structural failures that are not instances of the client's error class: reading by shape
 * rather than by class is the property that keeps a failure explainable when it is raised from another
 * realm or by a future client path. Expectations are stated as values rather than recomputed from the
 * module, so a case fails when the behaviour changes and never merely when the implementation is
 * rewritten.
 *
 * No snapshot and no golden file is written: the unit configuration resolves the snapshot update mode
 * to `none`, under which a baseline missing from the repository fails the run instead of being
 * recorded.
 */

import { describe, expect, it } from "vitest";

import { Fragment, isValidElement } from "react";
import type { ReactElement } from "react";

import {
  describeRetryWait,
  isRecord,
  readCount,
  readInstant,
  readMember,
  readNumber,
  readString,
  readText,
  readWriteFailure,
  statusOf,
  Timestamp,
  withFullStop,
} from "./payload-reading";
import type { InstantReading } from "./payload-reading";

/**
 * The props of the element a component returned.
 *
 * `apps/web` has no DOM environment, so the element is read rather than rendered: this is the whole of
 * what a unit test can assert about markup here.
 */
function propsOf(element: ReactElement<unknown>): Record<string, unknown> {
  return isRecord(element.props) ? element.props : {};
}

const RECORD_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly isRecord: boolean;
}> = [
  { label: "an object is a record", value: { id: "listing-1" }, isRecord: true },
  { label: "an empty object is a record", value: {}, isRecord: true },
  { label: "an array is not a record", value: [], isRecord: false },
  { label: "an array holding one value is not a record", value: ["listing-1"], isRecord: false },
  { label: "null is not a record", value: null, isRecord: false },
  { label: "undefined is not a record", value: undefined, isRecord: false },
  { label: "a string is not a record", value: "listing-1", isRecord: false },
  { label: "a number is not a record", value: 7, isRecord: false },
  { label: "a boolean is not a record", value: false, isRecord: false },
  { label: "a function is not a record", value: () => 7, isRecord: false },
];

const STRING_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly text: string;
}> = [
  { label: "returns the value itself for a string", value: "listing-1", text: "listing-1" },
  { label: "returns the empty string for an empty string", value: "", text: "" },
  { label: "returns a blank string as it stands", value: "   ", text: "   " },
  { label: "returns the empty string for null", value: null, text: "" },
  { label: "returns the empty string for undefined", value: undefined, text: "" },
  { label: "returns the empty string for a number", value: 7, text: "" },
  { label: "returns the empty string for a boolean", value: true, text: "" },
  { label: "returns the empty string for an object", value: { id: "listing-1" }, text: "" },
  { label: "returns the empty string for an array", value: ["listing-1"], text: "" },
  { label: "returns the empty string for a function", value: () => "listing-1", text: "" },
];

const TEXT_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly text: string | null;
}> = [
  { label: "returns a value carrying text as it stands", value: "listing-1", text: "listing-1" },
  { label: "keeps a padded value as it stands", value: "  listing-1  ", text: "  listing-1  " },
  { label: "returns null for an empty string", value: "", text: null },
  { label: "returns null for a blank string", value: "   ", text: null },
  { label: "returns null for null", value: null, text: null },
  { label: "returns null for undefined", value: undefined, text: null },
  { label: "returns null for a number", value: 7, text: null },
  { label: "returns null for a boolean", value: false, text: null },
  { label: "returns null for an object", value: { id: "listing-1" }, text: null },
  { label: "returns null for an array", value: ["listing-1"], text: null },
];

const NUMBER_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly number: number | null;
}> = [
  {
    label: "keeps 0, the status the client reports when no response was received",
    value: 0,
    number: 0,
  },
  { label: "keeps a positive whole number", value: 429, number: 429 },
  { label: "keeps a negative number", value: -1, number: -1 },
  { label: "keeps a fraction", value: 1.5, number: 1.5 },
  { label: "returns null for NaN", value: Number.NaN, number: null },
  { label: "returns null for infinity", value: Number.POSITIVE_INFINITY, number: null },
  { label: "returns null for negative infinity", value: Number.NEGATIVE_INFINITY, number: null },
  { label: "returns null for a string", value: "429", number: null },
  { label: "returns null for null", value: null, number: null },
  { label: "returns null for an object", value: { status: 429 }, number: null },
  { label: "returns null for an array", value: [429], number: null },
];

const COUNT_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly count: number | null;
}> = [
  { label: "keeps 0", value: 0, count: 0 },
  { label: "keeps a positive whole number", value: 20, count: 20 },
  { label: "returns null for a fraction", value: 2.5, count: null },
  { label: "returns null for a negative number", value: -1, count: null },
  { label: "returns null for NaN", value: Number.NaN, count: null },
  { label: "returns null for infinity", value: Number.POSITIVE_INFINITY, count: null },
  { label: "returns null for a string", value: "20", count: null },
  { label: "returns null for null", value: null, count: null },
];

/** A closed two-value vocabulary, frozen as the payloads' own vocabularies are. */
const TWO_WORD_VOCABULARY = Object.freeze(["open", "responded"] as const);

const MEMBER_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly member: "open" | "responded" | null;
}> = [
  { label: "reads the first member of the vocabulary", value: "open", member: "open" },
  { label: "reads the second member of the vocabulary", value: "responded", member: "responded" },
  { label: "refuses a value outside the vocabulary", value: "closed", member: null },
  { label: "refuses the empty string", value: "", member: null },
  { label: "refuses null", value: null, member: null },
  { label: "refuses a number", value: 7, member: null },
  { label: "refuses an array holding a member", value: ["open"], member: null },
];

const STATUS_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly status: number | null;
}> = [
  { label: "reads the status a read failure carries", value: { status: 404 }, status: 404 },
  {
    label: "keeps 0, the client's code for a response never received",
    value: { status: 0 },
    status: 0,
  },
  { label: "returns null for a status stated as a string", value: { status: "404" }, status: null },
  { label: "returns null for a status of NaN", value: { status: Number.NaN }, status: null },
  { label: "returns null for a status of infinity", value: { status: Number.POSITIVE_INFINITY }, status: null },
  { label: "returns null for a record with no status", value: { code: "not_found" }, status: null },
  {
    label: "returns null for an error carrying no status property",
    value: new Error("the read failed"),
    status: null,
  },
  { label: "returns null for a bare string", value: "404", status: null },
  { label: "returns null for a number", value: 404, status: null },
  { label: "returns null for null", value: null, status: null },
  { label: "returns null for an array", value: [404], status: null },
];

/** A failure read structurally rather than by class, which is the case this module exists for. */
const STRUCTURAL_FAILURE: Readonly<Record<string, unknown>> = Object.freeze({
  status: 429,
  code: "rate_limited",
  message: "Too many writes in a minute.",
  retryAfterSeconds: 30,
});

const REFUSAL_CASES: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
  { label: "refuses a bare string", value: "Too many writes in a minute." },
  { label: "refuses a number", value: 429 },
  { label: "refuses null", value: null },
  { label: "refuses undefined", value: undefined },
  { label: "refuses an array", value: [{ status: 429 }] },
  {
    label: "refuses an object with no status",
    value: { code: "rate_limited", message: "Too many writes in a minute." },
  },
  {
    label: "refuses an object whose status is a string",
    value: { status: "429", code: "rate_limited", message: "Too many writes in a minute." },
  },
  {
    label: "refuses an object whose status is NaN",
    value: { status: Number.NaN, code: "rate_limited", message: "Too many writes in a minute." },
  },
  {
    label: "refuses an object whose status is infinity",
    value: {
      status: Number.POSITIVE_INFINITY,
      code: "rate_limited",
      message: "Too many writes in a minute.",
    },
  },
  {
    label: "refuses an object with a blank code",
    value: { status: 429, code: "   ", message: "Too many writes in a minute." },
  },
  {
    label: "refuses an object with a blank message",
    value: { status: 429, code: "rate_limited", message: "  " },
  },
  { label: "refuses an object with no message", value: { status: 429, code: "rate_limited" } },
];

const RETRY_WAIT_CASES: ReadonlyArray<{
  readonly label: string;
  readonly wait: unknown;
  readonly retryAfterSeconds: number | null;
}> = [
  { label: "keeps a numeric wait", wait: 30, retryAfterSeconds: 30 },
  { label: "keeps a wait of zero", wait: 0, retryAfterSeconds: 0 },
  { label: "returns null for a wait stated as a string", wait: "30", retryAfterSeconds: null },
  { label: "returns null for a wait of NaN", wait: Number.NaN, retryAfterSeconds: null },
  { label: "returns null for no wait at all", wait: null, retryAfterSeconds: null },
];

const FULL_STOP_CASES: ReadonlyArray<{
  readonly label: string;
  readonly sentence: string;
  readonly result: string;
}> = [
  {
    label: "appends a full stop to a sentence with no mark",
    sentence: "No standard is recorded at this address",
    result: "No standard is recorded at this address.",
  },
  {
    label: "leaves a sentence ending in a full stop alone",
    sentence: "No standard is recorded at this address.",
    result: "No standard is recorded at this address.",
  },
  {
    label: "leaves a sentence ending in an exclamation mark alone",
    sentence: "The version could not be read!",
    result: "The version could not be read!",
  },
  {
    label: "leaves a sentence ending in a question mark alone",
    sentence: "Was the version read?",
    result: "Was the version read?",
  },
  { label: "appends a full stop to an empty sentence", sentence: "", result: "." },
];

/** The tail clause one form supplies, which is what makes one function serve every form's wording. */
const RETRY_ACTION = "then send it again.";

const RETRY_WAIT_RENDERING_CASES: ReadonlyArray<{
  readonly label: string;
  readonly retryAfterSeconds: number | null;
  readonly sentence: string;
}> = [
  {
    label: "renders a moment when the response states no wait",
    retryAfterSeconds: null,
    sentence: "Wait a moment, then send it again.",
  },
  {
    label: "renders a moment for a wait of zero seconds",
    retryAfterSeconds: 0,
    sentence: "Wait a moment, then send it again.",
  },
  {
    label: "renders a moment for a negative wait",
    retryAfterSeconds: -1,
    sentence: "Wait a moment, then send it again.",
  },
  {
    label: "renders a moment for a wait under one second",
    retryAfterSeconds: 0.5,
    sentence: "Wait a moment, then send it again.",
  },
  {
    label: "renders one second for exactly one second",
    retryAfterSeconds: 1,
    sentence: "Wait 1 second, then send it again.",
  },
  {
    label: "rounds two and a half seconds up to the whole second a reader counts",
    retryAfterSeconds: 2.5,
    sentence: "Wait 3 seconds, then send it again.",
  },
  {
    label: "renders ninety seconds as ninety seconds",
    retryAfterSeconds: 90,
    sentence: "Wait 90 seconds, then send it again.",
  },
];

const INSTANT_CASES: ReadonlyArray<{
  readonly label: string;
  readonly value: unknown;
  readonly reading: InstantReading;
}> = [
  {
    label: "reads a bare-second instant as its date and time in UTC",
    value: "2026-11-08T01:32:38Z",
    reading: { dateTime: "2026-11-08T01:32:38Z", text: "2026-11-08 01:32 UTC" },
  },
  {
    label: "reads a fractional-second instant as its date and time in UTC",
    value: "2026-11-08T01:32:38.672412Z",
    reading: { dateTime: "2026-11-08T01:32:38.672412Z", text: "2026-11-08 01:32 UTC" },
  },
  {
    label: "reads an instant stated to the minute as its date and time in UTC",
    value: "2026-11-08T01:32Z",
    reading: { dateTime: "2026-11-08T01:32Z", text: "2026-11-08 01:32 UTC" },
  },
  {
    label: "trims an instant before reading it",
    value: "  2026-11-08T01:32:38Z  ",
    reading: { dateTime: "2026-11-08T01:32:38Z", text: "2026-11-08 01:32 UTC" },
  },
  {
    label: "renders an unparseable string as the value it states",
    value: "8 November 2026",
    reading: { dateTime: null, text: "8 November 2026" },
  },
  {
    label: "renders an instant stated with an offset rather than UTC as the value it states",
    value: "2026-11-08T01:32:38+01:00",
    reading: { dateTime: null, text: "2026-11-08T01:32:38+01:00" },
  },
  {
    label: "renders an empty string as a time the record does not state",
    value: "",
    reading: { dateTime: null, text: "a time the record does not state" },
  },
  {
    label: "renders a blank string as a time the record does not state",
    value: "   ",
    reading: { dateTime: null, text: "a time the record does not state" },
  },
  {
    label: "renders null as a time the record does not state",
    value: null,
    reading: { dateTime: null, text: "a time the record does not state" },
  },
  {
    label: "renders undefined as a time the record does not state",
    value: undefined,
    reading: { dateTime: null, text: "a time the record does not state" },
  },
  {
    label: "renders a number as a time the record does not state, never as a coerced date",
    value: 1_760_000_000,
    reading: { dateTime: null, text: "a time the record does not state" },
  },
  {
    label: "renders a Date object as a time the record does not state, never as a coerced date",
    value: new Date(0),
    reading: { dateTime: null, text: "a time the record does not state" },
  },
];

describe("isRecord", () => {
  it.each(RECORD_CASES)("$label", ({ value, isRecord: expected }) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe("readString", () => {
  it.each(STRING_CASES)("$label", ({ value, text }) => {
    expect(readString(value)).toBe(text);
  });
});

describe("readText", () => {
  it.each(TEXT_CASES)("$label", ({ value, text }) => {
    expect(readText(value)).toBe(text);
  });
});

describe("readNumber", () => {
  it.each(NUMBER_CASES)("$label", ({ value, number }) => {
    expect(readNumber(value)).toBe(number);
  });
});

describe("readCount", () => {
  it.each(COUNT_CASES)("$label", ({ value, count }) => {
    expect(readCount(value)).toBe(count);
  });
});

describe("readMember", () => {
  it.each(MEMBER_CASES)("$label", ({ value, member }) => {
    expect(readMember(value, TWO_WORD_VOCABULARY)).toBe(member);
  });

  it("keeps the vocabulary's own member type in its result", () => {
    const member: "open" | "responded" | null = readMember("responded", TWO_WORD_VOCABULARY);
    expect(member).toBe("responded");
  });
});

describe("statusOf", () => {
  it.each(STATUS_CASES)("$label", ({ value, status }) => {
    expect(statusOf(value)).toBe(status);
  });
});

describe("readWriteFailure", () => {
  it("reads the four facts off a structural failure that is not the client's error class", () => {
    expect(Object.getPrototypeOf(STRUCTURAL_FAILURE)).toBe(Object.prototype);
    expect(readWriteFailure(STRUCTURAL_FAILURE)).toStrictEqual({
      status: 429,
      code: "rate_limited",
      message: "Too many writes in a minute.",
      retryAfterSeconds: 30,
    });
  });

  it("reads a failure raised as another class as data as well", () => {
    class ForeignFailure {
      readonly status = 409;
      readonly code = "conflict";
      readonly message = "The proposal has already been decided.";
      readonly retryAfterSeconds = null;
    }
    const failure: ForeignFailure = new ForeignFailure();
    expect(failure instanceof Error).toBe(false);
    expect(readWriteFailure(failure)).toStrictEqual({
      status: 409,
      code: "conflict",
      message: "The proposal has already been decided.",
      retryAfterSeconds: null,
    });
  });

  it("reads a failure that states no wait as one stating none", () => {
    expect(
      readWriteFailure({
        status: 404,
        code: "not_found",
        message: "No standard is recorded at this address.",
      }),
    ).toStrictEqual({
      status: 404,
      code: "not_found",
      message: "No standard is recorded at this address.",
      retryAfterSeconds: null,
    });
  });

  it.each(REFUSAL_CASES)("$label and returns null", ({ value }) => {
    expect(readWriteFailure(value)).toBeNull();
  });

  it.each(RETRY_WAIT_CASES)("$label among the four facts", ({ wait, retryAfterSeconds }) => {
    expect(
      readWriteFailure({
        status: 429,
        code: "rate_limited",
        message: "Too many writes in a minute.",
        retryAfterSeconds: wait,
      }),
    ).toStrictEqual({
      status: 429,
      code: "rate_limited",
      message: "Too many writes in a minute.",
      retryAfterSeconds,
    });
  });
});

describe("withFullStop", () => {
  it.each(FULL_STOP_CASES)("$label", ({ sentence, result }) => {
    expect(withFullStop(sentence)).toBe(result);
  });
});

describe("describeRetryWait", () => {
  it.each(RETRY_WAIT_RENDERING_CASES)("$label", ({ retryAfterSeconds, sentence }) => {
    expect(describeRetryWait(retryAfterSeconds, RETRY_ACTION)).toBe(sentence);
  });

  it("ends with the caller's own tail clause", () => {
    const clause = "then post the question again.";
    const sentence = describeRetryWait(30, clause);
    expect(sentence).toBe("Wait 30 seconds, then post the question again.");
    expect(sentence.endsWith(clause)).toBe(true);
  });
});

describe("readInstant", () => {
  it.each(INSTANT_CASES)("$label", ({ value, reading }) => {
    expect(readInstant(value)).toStrictEqual(reading);
  });
});

describe("Timestamp", () => {
  it("renders a time element carrying the machine-readable value and the UTC text", () => {
    const instant = "2026-11-08T01:32:38.672412Z";
    const element = Timestamp({ value: instant });
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe("time");
    const props = propsOf(element);
    expect(props["dateTime"]).toBe(instant);
    expect(props["children"]).toBe("2026-11-08 01:32 UTC");
  });

  it("renders the words the record states, never an empty element, for an instant it cannot parse", () => {
    const element = Timestamp({ value: "8 November 2026" });
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(Fragment);
    const props = propsOf(element);
    expect(props).not.toHaveProperty("dateTime");
    expect(props["children"]).toBe("8 November 2026");
  });

  it("renders words saying no time is stated for a record that holds no instant", () => {
    const element = Timestamp({ value: null });
    expect(propsOf(element)["children"]).toBe("a time the record does not state");
  });
});
