/**
 * The request-body policy as the running API applies it: a write body that does not hold the JSON
 * types and the declared fields its own schema states is refused with the contract's `400`, and the
 * row it meant to write is not written.
 *
 * **What it proves that the unit test cannot.** `request-body-policy.test.ts` proves the predicate;
 * this file proves the hook that calls it, and proves it through the real routes — one migrated,
 * seeded server on an ephemeral port, real requests, and row counts read from the same connection.
 * The two findings behind both files were observed exactly here, over HTTP: a `POST /listings` whose
 * `title` was the JSON number `123` answered `201` with the title stored as the string `"123"`, and an
 * undeclared field — `"extra": 1` on a listing, `"body"` on a thread — answered `201` with the field
 * silently gone. Each case below is that request, asserted to be refused instead, with the row count
 * read before and after it and the row the write would have created looked for by name.
 *
 * **The refusal is the contract's own, and nothing new.** A refused body earns the same status, the
 * same code and the same sentence a body the validator itself rejects earns — the one envelope, with
 * `error` and inside it exactly `code` and `message`. Every assertion here compares the whole body to
 * that object rather than reading one member of it, so a fourth key, a framework `statusCode` or a
 * schema's spelling would fail the case.
 *
 * **The identifiers a valid body must name come from the seeded database**, through the harness's
 * accessor for a listing and through the two columns no route publishes — a category identifier and a
 * licence code — so no seeded identifier is written down in this file. The refused bodies are built
 * from the same references: their refusal is decided before any route resolves an identifier, which
 * is why a `400` here cannot be a `404` about a listing or a category that does not exist.
 *
 * **What it deliberately does not re-assert.** The rest of each row's contract — the `401` and `403`
 * of every write, the `404`s, the `409`s and the shape each success carries — belongs to
 * `route-walk.test.ts` and `api-contract.test.ts`, which walk the whole table. This file asserts the
 * two things the policy owns: the refusal, and the row that was not written.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AccountRole } from "@adem/shared";

import { startTestServer } from "./test-server";
import type { RequestOptions, TestServer } from "./test-server";

/**
 * The one failure body every body rejection of this API leaves by, compared whole.
 *
 * The sentence is the product's own: a schema rejection is answered from the envelope's vocabulary
 * rather than from the validator's spelling, so the policy's refusal and the validator's are
 * indistinguishable to a client — which is the point.
 */
const EXPECTED_REFUSAL = {
  error: { code: "validation_error", message: "The request is not valid." },
};

/** The titles and the question the refused bodies carry: no row may be found under any of them. */
const REFUSED_LISTING_TITLE = "Request Body Policy Refused Listing";
const REFUSED_THREAD_TITLE = "Request Body Policy Refused Thread";
const REFUSED_CHALLENGE_QUESTION = "Is this listing's evidence recorded for every case?";

/** The titles and the question the accepted bodies carry: exactly one row must be found under each. */
const ACCEPTED_LISTING_TITLE = "Request Body Policy Accepted Listing";
const ACCEPTED_THREAD_TITLE = "Request Body Policy Accepted Thread";
const ACCEPTED_CHALLENGE_QUESTION = "Which fixture set backs the reported outcome?";

/** The one server every case of this file shares, started in `beforeAll` and closed in `afterAll`. */
let server: TestServer;

/**
 * The seeded values a valid body must name, read once from the harness's own connection: the category
 * column and the licence code of the first seeded listing, and the listing that owns the seeded
 * `seed-alpha` candidate version. None of them is published by a route, which is why they are read
 * here rather than written down.
 */
interface SeededReferences {
  /** The `categories.id` a listing body's `category_id` must name. */
  readonly categoryId: string;

  /** The licence code a listing body may carry, taken from a seeded listing. */
  readonly licenseCode: string;

  /** A visible seeded listing, the target of the challenge row. */
  readonly listingId: string;
}

let references: SeededReferences;

/** The options that send one write as the first seeded account carrying the given role. */
function actingAs(role: AccountRole): RequestOptions {
  return { account: server.accountForRole(role) };
}

/**
 * How many rows the statement's `COUNT(*)` reports.
 *
 * A statement that selects no row is a defect in this file rather than a server state, so it is
 * reported as one instead of being read as a zero.
 */
function rowCount(sql: string, ...params: readonly unknown[]): number {
  const row = server.query<{ readonly count: number }>(sql, ...params)[0];

  if (row === undefined) {
    throw new Error(`request body policy: the statement "${sql}" selected no row.`);
  }

  return row.count;
}

/** How many listings carry the given title. */
function listingsTitled(title: string): number {
  return rowCount("SELECT COUNT(*) AS count FROM listings WHERE title = ?", title);
}

/** How many threads carry the given title. */
function threadsTitled(title: string): number {
  return rowCount("SELECT COUNT(*) AS count FROM threads WHERE title = ?", title);
}

/** How many challenges carry the given question. */
function challengesAsked(question: string): number {
  return rowCount("SELECT COUNT(*) AS count FROM challenges WHERE question = ?", question);
}

/**
 * One write of this suite: the row it addresses, the account that sends it, the body it sends and the
 * table its effect is measured in.
 *
 * The body is a **function of the seeded references** rather than a value, because the identifiers a
 * body must name are read from the database once the server is running, which is after these tables
 * are built. Every member is data: the two tables below differ only in whether the body holds its
 * schema's declarations.
 */
interface WriteCase {
  /** What the body does, which the case titles read. */
  readonly what: string;

  /** The prefix-relative path the write addresses. */
  readonly path: string;

  /** The role the writing account carries, resolved through the harness's accessor. */
  readonly role: AccountRole;

  /** The table whose row count this case measures, before and after the write. */
  readonly table: "listings" | "threads" | "challenges";

  /** The body the write sends, built from the seeded references. */
  readonly body: (references: SeededReferences) => Record<string, unknown>;
}

/**
 * The four refused writes — the two findings of this group as they arrive over HTTP: the `POST
 * /listings` that sent a JSON number for `title` and was stored as the string `"123"`, and the three
 * bodies that carry a field their row does not declare — `extra` on a listing, the opening `body` on
 * a thread, and a client-supplied `account_id` on a challenge.
 *
 * Each body is what a client really sends: the listing writes carry all five declared fields, the
 * thread write carries the opening post its author believed the row accepted, and the challenge write
 * carries the identity its author believed it could set.
 */
const REFUSED_WRITE_CASES: readonly WriteCase[] = [
  {
    what: "a number where the title field declares a string",
    path: "/listings",
    role: "developer",
    table: "listings",
    body: (seed) => ({
      title: 123,
      summary: "A summary.",
      category_id: seed.categoryId,
      license_code: seed.licenseCode,
      pricing_model: "purchase",
    }),
  },
  {
    what: "an undeclared field beside the five the body declares",
    path: "/listings",
    role: "developer",
    table: "listings",
    body: (seed) => ({
      title: REFUSED_LISTING_TITLE,
      summary: "A summary.",
      category_id: seed.categoryId,
      license_code: seed.licenseCode,
      pricing_model: "purchase",
      extra: 1,
    }),
  },
  {
    what: "an opening post the thread row does not declare",
    path: "/threads",
    role: "contributor",
    table: "threads",
    body: () => ({ title: REFUSED_THREAD_TITLE, body: "Opening post text." }),
  },
  {
    what: "a client-supplied account identity on a challenge",
    path: "/challenges",
    role: "buyer",
    table: "challenges",
    body: (seed) => ({
      listing_id: seed.listingId,
      question: REFUSED_CHALLENGE_QUESTION,
      account_id: server.accountForRole("contributor").id,
    }),
  },
];

/**
 * The same writes with only declared fields and correct types: the bodies the web client sends, which
 * must still be accepted.
 *
 * The accepted listing body carries the same five fields the refused ones carry, so the two arms of
 * the listing experiment differ only in the type one field's value had and in the field one client
 * added.
 */
const ACCEPTED_WRITE_CASES: readonly WriteCase[] = [
  {
    what: "five declared fields with the types the body declares",
    path: "/listings",
    role: "developer",
    table: "listings",
    body: (seed) => ({
      title: ACCEPTED_LISTING_TITLE,
      summary: "A summary.",
      category_id: seed.categoryId,
      license_code: seed.licenseCode,
      pricing_model: "purchase",
    }),
  },
  {
    what: "the title a thread row declares",
    path: "/threads",
    role: "contributor",
    table: "threads",
    body: () => ({ title: ACCEPTED_THREAD_TITLE }),
  },
  {
    what: "a declared listing and question",
    path: "/challenges",
    role: "buyer",
    table: "challenges",
    body: (seed) => ({
      listing_id: seed.listingId,
      question: ACCEPTED_CHALLENGE_QUESTION,
    }),
  },
];

beforeAll(async () => {
  server = await startTestServer();

  const seedRow = server.query<{
    readonly category_id: string;
    readonly license_code: string;
  }>("SELECT category_id, license_code FROM listings ORDER BY rowid ASC LIMIT 1")[0];

  if (seedRow === undefined) {
    throw new Error("request body policy: the seeded database carries no listing to read from.");
  }

  references = {
    categoryId: seedRow.category_id,
    licenseCode: seedRow.license_code,
    listingId: server.candidateVersion("seed-alpha").listingId,
  };
});

afterAll(async () => {
  await server.close();
});

describe("a write body that does not hold its schema's declared types and fields", () => {
  it.each(REFUSED_WRITE_CASES)("refuses $what on POST $path with 400", async (entry) => {
    const response = await server.post(entry.path, entry.body(references), actingAs(entry.role));

    expect(response.status).toBe(400);
    expect(response.json()).toEqual(EXPECTED_REFUSAL);
  });

  it.each(REFUSED_WRITE_CASES)("writes no $table row for $what", async (entry) => {
    const before = rowCount(`SELECT COUNT(*) AS count FROM ${entry.table}`);

    await server.post(entry.path, entry.body(references), actingAs(entry.role));

    expect(rowCount(`SELECT COUNT(*) AS count FROM ${entry.table}`)).toBe(before);
  });

  it("leaves no row under the title or the question a refused body named", async () => {
    // The refused writes above carry values no other case of this file uses, so a row under one of
    // them could only have come from a write the policy was supposed to refuse.
    expect(listingsTitled(REFUSED_LISTING_TITLE)).toBe(0);
    expect(threadsTitled(REFUSED_THREAD_TITLE)).toBe(0);
    expect(challengesAsked(REFUSED_CHALLENGE_QUESTION)).toBe(0);
  });
});

describe("a write body that holds its schema's declared types and fields", () => {
  it.each(ACCEPTED_WRITE_CASES)("accepts $what on POST $path with 201, appending one $table row", async (entry) => {
    const before = rowCount(`SELECT COUNT(*) AS count FROM ${entry.table}`);

    const response = await server.post(entry.path, entry.body(references), actingAs(entry.role));

    expect(response.status).toBe(201);
    expect(rowCount(`SELECT COUNT(*) AS count FROM ${entry.table}`)).toBe(before + 1);
  });

  it("stores exactly one row under the title or the question an accepted body named", async () => {
    // The other half of the experiment: the same fields, with the types the bodies declare, do reach
    // the handlers and are written, so the refusals above are about the bodies and not about the
    // routes being unable to accept anything.
    expect(listingsTitled(ACCEPTED_LISTING_TITLE)).toBe(1);
    expect(threadsTitled(ACCEPTED_THREAD_TITLE)).toBe(1);
    expect(challengesAsked(ACCEPTED_CHALLENGE_QUESTION)).toBe(1);
  });
});
