/**
 * Criterion 8's API half: the **route walk**, which drives every method-and-path row of the API
 * contract table against the real `@adem/api` server and asserts each row's documented success and
 * error status.
 *
 * **Why one walking file rather than a case per route.** Criterion 8 requires that every endpoint of
 * the contract table be reachable and answer the statuses the table fixes, and that is a property of
 * the surface as a whole rather than of any one handler: the table's twenty rows share one rule
 * (`401` for an absent or unresolvable demo header, `403` for a resolvable account whose role does
 * not match the row), one failure shape (`{ error: { code, message } }`) and one write bound, and the
 * four non-public reads are exactly four. So this file starts one migrated, seeded server and walks
 * the whole table once.
 *
 * **The rows it walks**, prefix-relative, reproduced here so the walk below is readable against the
 * contract it proves:
 *
 * | Method and path | Role | Success | Error cases |
 * | --- | --- | --- | --- |
 * | `GET /listings?q&category&license&model&standard&sort&page` | public | `200 {items,total,page}`, page size 20 | `400` |
 * | `GET /listings/{id}` | public | `200` with versions, claims, evidence, limitations | `404` |
 * | `POST /listings` | developer | `201` | `400`, `401`, `403` |
 * | `POST /listings/{id}/versions` | owning developer | `201` | `400`, `401`, `403`, `404`, `409` |
 * | `GET /compare?ids=a,b,c` | public | `200` | `400` below two or above four ids, `404` unknown id |
 * | `POST /inquiries` | buyer | `201` | `400`, `404`, `401`, `403` |
 * | `GET /challenges`, `POST /challenges`, `POST /challenges/{id}/responses` | read public; write buyer or developer | `200` / `201` | `400`, `404`, `401` |
 * | `GET /threads`, `POST /threads`, `POST /threads/{id}/posts` | read public; write any demo account | `200` / `201` | `400`, `404`, `401` |
 * | `GET /standards`, `GET /standards/{id}/versions/{v}` | public | `200` | `404` |
 * | `POST /standards/proposals` | contributor | `201` status `submitted` | `400`, `401`, `403` |
 * | `POST /standards/proposals/{id}/review` | operator | `200` status moved, event appended | `409`, `403` |
 * | `POST /evaluations` | developer (owner) | `201` report, deterministic and synchronous | `400`, `404`, `422`, `403` |
 * | `GET /evaluations/{id}` | public | `200` report with per-case evidence | `404` |
 * | `POST /evaluations/{id}/appeals`, `POST /appeals/{id}/ruling` | developer / operator | `201` / `200` | `404`, `409`, `401`, `403` |
 * | `POST /checkout-simulations` | buyer | `201` with `simulated: true` | `400`, `404`, `422` |
 * | `POST /transactions/{id}/refunds` | operator | `201` reversal entries | `404`, `409`, `422`, `401`, `403` |
 * | `GET /ledger/marketplace`, `GET /ledger/gate-fees`, `GET /ledger/founder-allocation` | operator | `200` append-only entries | `403`, `401` |
 * | `POST /moderation/listings/{id}/actions` | operator | `200`, event appended with a reason | `404`, `400`, `401`, `403` |
 * | `GET /sponsored-slots` | public | `200`, every item `sponsored: true` | none |
 * | `GET /audit-events` | operator | `200` | `403`, `401` |
 *
 * A row's error column names only the cases particular to it; the rule above supplies the other of
 * `401`/`403`, so both are asserted for every non-public row rather than inferred from the row's
 * brevity. The two discussion-board writes are the one exception, and they have none to supply: their
 * row admits any resolvable account, so no role can be the wrong one and the pair of roles that are
 * accepted stands in place of a `403`.
 *
 * **The order is creation order, not table order.** A row that reads or acts on a resource runs
 * after the row that creates it, so every refusal is provoked by a condition this file built rather
 * than by one it assumed: a listing is created and a version published to it, an inquiry and a
 * challenge are posted against a seeded listing, a challenge is answered by both of its two
 * permitted roles, a thread is started by two roles and replied to by a third, a standards proposal
 * is submitted and reviewed, a seeded candidate is scored and its report read back with no header at
 * all, an appeal is opened and ruled, a checkout is simulated and refunded twice, and this walk's own
 * listing is moderated and restored. The reads that need the walk's own state then run last — search,
 * detail, compare, the standards catalogue and a version, the three operator-only amount reads and
 * the audit feed — and the two rows that probe unmatched requests and the write throttle close the
 * file. Nothing a row's own read needs is deferred: a report is read in the block that wrote it,
 * because it is the same resource row of the table.
 *
 * **Every failure is asserted through one local helper.** All twenty error columns are checked by
 * `expectRefusal`, which reads the status from the expectation, asserts the body's top-level key set
 * is exactly `["error"]` and `error`'s key set is exactly `["code", "message"]`, and names the code
 * the closed vocabulary maps that status to. A fourth key, a framework `statusCode`, a `validation`
 * array or a driver sentence therefore fails here instead of reaching a client.
 *
 * **This file owns the repository's only `429` assertion.** Every other suite starts a server whose
 * write bound is raised so that no documented status is displaced by the throttle — the harness
 * exists for that reason — and this file's shared server is one of those. The end of the file starts
 * a second server on the same in-memory, seeded basis with the smallest bound the configuration
 * accepts, and asserts the contract's `429` with its `Retry-After` header there and nowhere else.
 *
 * **Nothing is written to disk, no port is fixed and no environment variable is read.**
 * `startTestServer` opens one in-memory connection, applies the migrations, loads the seed and
 * listens on an ephemeral port the kernel chooses, and the prefix, the header name, the labels, the
 * page size, the rate-limit numbers and the currency label all come from the modules that declare
 * them. Every identifier a request needs comes from a response, from one of the harness's accessors
 * or from `randomUUID()`, which is how the no-match probes are built without an identifier being
 * retyped anywhere in this file.
 *
 * **What it deliberately does not re-assert.** A documented status may appear here and in the suite
 * that owns its deeper evidence: the duplicate-version `409`'s byte-level "nothing was written" proof
 * belongs to the contract suite, the append-only mutation attempts to the immutability suite, the
 * ledger arithmetic to its own suite and the sponsorship experiment to the separation suite. Where a
 * row overlaps, this file asserts the status and the failure shape only, and says so in place.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AccountRole,
  Appeal,
  AuditEvent,
  Challenge,
  ChallengeResponse,
  CompareResult,
  EvaluationReportDetail,
  FounderAllocationLedgerReadResult,
  GovernanceEvent,
  Inquiry,
  LedgerEntry,
  LedgerReadResult,
  Listing,
  ListingDetail,
  ListingSearchResult,
  ListingVersion,
  ModerationAction,
  OfferModel,
  PricingModel,
  Refund,
  SponsoredSlotListItem,
  StandardProposal,
  StandardVersion,
  Thread,
  ThreadPost,
  Transaction,
} from "@adem/shared";
import {
  COLLECTION_PAGE_SIZE,
  COMPARE_MAX_IDS,
  COMPARE_MIN_IDS,
  LISTING_PAGE_SIZE,
  PAGE_NUMBER_MAX,
  REPORT_LABEL_SAMPLE,
  SYNTHETIC_CURRENCY_LABEL,
  WRITE_RATE_LIMIT_MAX,
  WRITE_RATE_LIMIT_WINDOW,
} from "@adem/shared";

import { COMMERCE_DISCLOSURE_LABEL } from "@adem/commerce-sim";

import { startTestServer } from "./test-server";
import type { RequestOptions, TestResponse, TestServer } from "./test-server";

/**
 * The one published standard version this release carries, whose code and version label are the same
 * string. It is a contract public value: a report cites it, an evaluation submission names it, the
 * catalogue answers with it and the standards row is addressed by it, so writing it here is reading
 * the contract rather than restating seeded data.
 */
const STANDARD_VERSION_LABEL = "SGI-SO-1.0.0";

/** The rubric reference every report of that version states, resolving to the standard's document. */
const RUBRIC_REFERENCE = "SGI-SO-1.0.0#rubric";

/** The title this walk's own listing is published under, and the version string it publishes. */
const WALK_LISTING_TITLE = "Route Walk Walkthrough Listing";
const WALK_VERSION_STRING = "1.0.0-route-walk";

/**
 * The pricing model the walk's own listing declares, and an offer model it therefore does not make.
 *
 * Both are members of the contract's closed vocabularies and both are typed as such, so a spelling
 * outside the vocabulary is a compile error rather than a request the server refuses. The pair is
 * what makes the checkout row's `422` reachable: the listing makes `purchase` alone, so a buyer
 * selecting `rent` is answered `422`.
 */
const DECLARED_PRICING_MODEL: PricingModel = "purchase";
const UNOFFERED_OFFER_MODEL: OfferModel = "rent";

/**
 * The write bound the walk's shared server runs with: a hundred times the contract's own maximum.
 *
 * The walk exercises every write row of the table several times inside one window, and a bound of
 * the contract's sixty is measured per route per client — a margin this file does not want to depend
 * on. Raising it is what lets every documented status below be observed as documented, and the one
 * server that asserts the limit does so with a bound of its own. The product's own number is read
 * from the module that declares it rather than written here.
 */
const WALK_WRITE_LIMIT_MAX = WRITE_RATE_LIMIT_MAX * 100;

/** The bound the throttling case's own server runs with: the smallest the configuration accepts. */
const THROTTLED_WRITE_LIMIT_MAX = 1;

/**
 * The one server every case of this file shares, started in `beforeAll` over one in-memory, migrated
 * and seeded database and closed in `afterAll`.
 */
let server: TestServer;

/**
 * What one step of the walk hands to the steps that follow it.
 *
 * The walk is one ordered sequence rather than a set of independent cases, so the identifiers a later
 * row needs are captured here from the response that created them instead of being written down as
 * literals. Each member an empty string or a zero means the step that fills it has not run, which
 * `captured` below reports as the failure it is.
 */
interface WalkState {
  /** A seeded listing that is visible, used as the target of the inquiry and challenge rows. */
  seededListingId: string;
  /** The category identifier a listing body must name, which no route publishes. */
  categoryId: string;
  /** A licence code a listing body may carry, taken from a seeded listing rather than invented. */
  licenseCode: string;
  /** The listing this walk created. */
  createdListingId: string;
  /** The version this walk published to that listing. */
  createdVersionId: string;
  /** The challenge this walk's buyer raised. */
  challengeId: string;
  /** The thread this walk started. */
  threadId: string;
  /** The proposal this walk's contributor submitted. */
  proposalId: string;
  /** The proposal's own text, asserted unchanged after the review decides it. */
  proposalTitle: string;
  proposalRationale: string;
  /** The seeded fixture candidate the walk scores, and one of its seeded reports. */
  candidateVersionId: string;
  seededReportId: string;
  /** The report this walk's own submission wrote. */
  reportId: string;
  /** The appeal this walk opened against that report. */
  appealId: string;
  /** The first simulated transaction of this walk and its amount in whole minor units. */
  transactionId: string;
  transactionAmount: number;
  /** A second simulated transaction, refunded by an amount larger than it has left. */
  secondTransactionId: string;
  secondTransactionAmount: number;
}

const walk: WalkState = {
  seededListingId: "",
  categoryId: "",
  licenseCode: "",
  createdListingId: "",
  createdVersionId: "",
  challengeId: "",
  threadId: "",
  proposalId: "",
  proposalTitle: "",
  proposalRationale: "",
  candidateVersionId: "",
  seededReportId: "",
  reportId: "",
  appealId: "",
  transactionId: "",
  transactionAmount: 0,
  secondTransactionId: "",
  secondTransactionAmount: 0,
};

/**
 * A value a previous step of the walk captured, or a failure naming what is missing.
 *
 * It exists so that a request path can never be composed from an empty identifier: a walk whose
 * earlier step failed would otherwise send a request against a path that matches no row and report a
 * `404` as if the row under test had refused it.
 */
function captured(value: string, what: string): string {
  if (value.length === 0) {
    throw new Error(
      `route walk: ${what} was not captured by an earlier step, so the walk cannot continue.`,
    );
  }

  return value;
}

/** The request options that send one write as the first seeded account carrying the given role. */
function actingAs(role: AccountRole): RequestOptions {
  return { account: server.accountForRole(role) };
}

/** The sorted keys of a response body, which is how the envelope's shape is compared. */
function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

/**
 * The one failure assertion this file runs on every refusal it provokes: the documented status, the
 * single error shape, and the code the closed vocabulary maps that status to.
 *
 * The expected code is a parameter and never read from the response, so the assertion states what the
 * contract says rather than what the server happened to answer. The key sets are compared sorted and
 * exactly, which is what makes a fourth key a failure here: no `statusCode`, no `validation` array,
 * no stack and no identifier may ride along with a failure body.
 */
function expectRefusal(response: TestResponse, status: number, code: string): void {
  expect(response.status).toBe(status);

  const envelope = response.json<{ readonly error: Record<string, unknown> }>();

  expect(keysOf(envelope)).toEqual(["error"]);
  expect(keysOf(envelope.error)).toEqual(["code", "message"]);
  expect(envelope.error["code"]).toBe(code);
  expect(typeof envelope.error["message"]).toBe("string");
  expect(String(envelope.error["message"]).length).toBeGreaterThan(0);
}

/**
 * The one row a statement selected, or a failure naming the statement.
 *
 * Several criteria are stated as counts of stored rows, and the harness's `query` is the documented
 * way to read them: a count taken through the API would be a second answer to the question the
 * criterion asks. A statement that selects no row is a defect in this file rather than a server
 * state, so it is reported as one.
 */
function firstRow<T>(sql: string, ...params: readonly unknown[]): T {
  const row = server.query<T>(sql, ...params)[0];

  if (row === undefined) {
    throw new Error(`route walk: the statement "${sql}" selected no row.`);
  }

  return row;
}

/** How many rows the statement's `COUNT(*)` reports. */
function countOf(sql: string): number {
  return firstRow<{ readonly count: number }>(sql).count;
}

beforeAll(async () => {
  server = await startTestServer({
    // Raised so that every documented status below is observable; see WALK_WRITE_LIMIT_MAX. The one
    // case that asserts the contract's own bound starts a server of its own at the end of this file.
    writeRateLimit: { max: WALK_WRITE_LIMIT_MAX, timeWindow: WRITE_RATE_LIMIT_WINDOW },
  });

  // Two identifications a listing body must carry that no route publishes: the category its
  // `category_id` names and a licence code. The seed's own first listing supplies both, read through
  // the harness's documented escape hatch, which is what the hatch exists for — so neither value is
  // invented here and neither is a copy of the seed's data.
  const seedRow = firstRow<{ readonly category_id: string; readonly license_code: string }>(
    "SELECT category_id, license_code FROM listings ORDER BY rowid ASC LIMIT 1",
  );
  walk.categoryId = seedRow.category_id;
  walk.licenseCode = seedRow.license_code;

  // The listing the inquiry and challenge rows are posted against: the listing that owns the seeded
  // `seed-alpha` candidate version, which is a visible seeded listing and is left untouched by this
  // file. The accessor resolves it, so no seeded identifier is written down.
  walk.seededListingId = server.candidateVersion("seed-alpha").listingId;
  walk.candidateVersionId = server.candidateVersion("seed-alpha").id;
  walk.seededReportId = server.seededReportId("seed-alpha");
});

afterAll(async () => {
  await server.close();
});

describe("route walk: every row of the API contract table", () => {
  // The blocks below are declared in the order the walk runs in, and each block's name is the
  // resource group of the rows it walks. No nested name repeats another integration suite's own
  // subject, so each documented `--testNamePattern` selects exactly one suite.

  describe("listings", () => {
    /** A valid listing body, which is what a row's own failure case is built against. */
    function listingBody(title: string): Record<string, string> {
      return {
        title,
        summary: "A listing the route walk publishes to exercise the contract's write rows.",
        category_id: walk.categoryId,
        license_code: walk.licenseCode,
        pricing_model: DECLARED_PRICING_MODEL,
      };
    }

    it("creates a listing as the developer", async () => {
      const response = await server.post(
        "/listings",
        listingBody(WALK_LISTING_TITLE),
        actingAs("developer"),
      );

      expect(response.status).toBe(201);

      const created = response.json<Listing>();

      expect(created.title).toBe(WALK_LISTING_TITLE);
      // A new listing is `active`: no field of the body could have placed it in another state, and
      // moderation is the operator's act rather than the author's.
      expect(created.status).toBe("active");
      expect(created.pricing_model).toBe(DECLARED_PRICING_MODEL);
      expect(created.developer_account_id).toBe(server.accountForRole("developer").id);
      // The slug is derived server-side, so the client cannot choose a URL token it does not own.
      expect(created.slug.length).toBeGreaterThan(0);

      walk.createdListingId = created.id;
    });

    it("refuses a listing body that states no title with 400", async () => {
      const body = listingBody(WALK_LISTING_TITLE);
      delete body["title"];

      expectRefusal(
        await server.post("/listings", body, actingAs("developer")),
        400,
        "validation_error",
      );
    });

    it("refuses a listing write with no demo header as 401", async () => {
      // No `account` option at all: the header is absent, which is the only way this file reaches a
      // `401`. The body is valid, so nothing but the identity can be what failed.
      expectRefusal(
        await server.post("/listings", listingBody(WALK_LISTING_TITLE)),
        401,
        "unauthorized",
      );
    });

    it("refuses a listing write from the buyer role as 403", async () => {
      expectRefusal(
        await server.post("/listings", listingBody(WALK_LISTING_TITLE), actingAs("buyer")),
        403,
        "forbidden",
      );
    });

    it("publishes a version for the owning developer", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");

      const response = await server.post(
        `/listings/${listingId}/versions`,
        { version_string: WALK_VERSION_STRING, notes: "Published by the route walk." },
        actingAs("developer"),
      );

      expect(response.status).toBe(201);

      const version = response.json<ListingVersion>();

      expect(version.listing_id).toBe(listingId);
      expect(version.version_string).toBe(WALK_VERSION_STRING);
      // The one stored field a report's label is derived from. A version published through the API is
      // never a fixture candidate, so a developer's own version is labelled `VERIFIED-IN-DEMO`
      // whatever its outcome — which is why the flag is asserted here rather than assumed.
      expect(version.is_fixture_candidate).toBe(false);

      walk.createdVersionId = version.id;
    });

    it("answers 409 for a version string the listing has already published", async () => {
      // The status and the envelope are this file's; the byte-level proof that the refused append
      // wrote nothing belongs to the contract suite. The pair `(listing_id, version_string)` is what
      // produces this status, and a correction is a new version rather than a rewrite.
      const listingId = captured(walk.createdListingId, "the created listing");

      expectRefusal(
        await server.post(
          `/listings/${listingId}/versions`,
          { version_string: WALK_VERSION_STRING },
          actingAs("developer"),
        ),
        409,
        "conflict",
      );
    });

    it("answers 404 for a version write on a listing identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/listings/${randomUUID()}/versions`,
          { version_string: "1.0.0" },
          actingAs("developer"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses a version write with no demo header as 401", async () => {
      // A valid body and no header at all, so nothing but the identity can be what failed.
      const listingId = captured(walk.createdListingId, "the created listing");

      expectRefusal(
        await server.post(`/listings/${listingId}/versions`, { version_string: "2.0.0" }),
        401,
        "unauthorized",
      );
    });

    it("refuses a version write from an account that is neither the owner nor a developer", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");

      expectRefusal(
        await server.post(
          `/listings/${listingId}/versions`,
          { version_string: "9.9.9" },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });
  });

  describe("inquiries", () => {
    it("posts a buyer inquiry on a listing as the buyer", async () => {
      const response = await server.post(
        "/inquiries",
        { listing_id: walk.seededListingId, message: "Does this listing record a depot per leg?" },
        actingAs("buyer"),
      );

      expect(response.status).toBe(201);

      const { inquiry } = response.json<{ readonly inquiry: Inquiry }>();

      expect(inquiry.listing_id).toBe(walk.seededListingId);
      // The buyer is the resolved demo account and never a body field, so the row states the account
      // the header named rather than one the request could have chosen.
      expect(inquiry.buyer_account_id).toBe(server.accountForRole("buyer").id);
      expect(inquiry.message.length).toBeGreaterThan(0);
    });

    it("refuses an inquiry that states no message with 400", async () => {
      expectRefusal(
        await server.post(
          "/inquiries",
          { listing_id: walk.seededListingId, message: "" },
          actingAs("buyer"),
        ),
        400,
        "validation_error",
      );
    });

    it("answers 404 for an inquiry on a listing identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          "/inquiries",
          { listing_id: randomUUID(), message: "Is this listing measurable?" },
          actingAs("buyer"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses an inquiry with no demo header as 401", async () => {
      expectRefusal(
        await server.post("/inquiries", { listing_id: walk.seededListingId, message: "Hello." }),
        401,
        "unauthorized",
      );
    });

    it("refuses an inquiry from the developer role as 403", async () => {
      expectRefusal(
        await server.post(
          "/inquiries",
          { listing_id: walk.seededListingId, message: "Hello." },
          actingAs("developer"),
        ),
        403,
        "forbidden",
      );
    });
  });

  describe("challenges", () => {
    it("answers the public challenges board with no request header", async () => {
      const response = await server.get("/challenges");

      expect(response.status).toBe(200);

      const board = response.json<{ readonly items: readonly Challenge[] }>();

      expect(Array.isArray(board.items)).toBe(true);
      expect(board.items.length).toBeGreaterThan(0);
    });

    it("raises a challenge as the buyer", async () => {
      const response = await server.post(
        "/challenges",
        { listing_id: walk.seededListingId, question: "Which depot does this listing record?" },
        actingAs("buyer"),
      );

      expect(response.status).toBe(201);

      const challenge = response.json<Challenge>();

      expect(challenge.listing_id).toBe(walk.seededListingId);
      expect(challenge.buyer_account_id).toBe(server.accountForRole("buyer").id);
      expect(challenge.status).toBe("open");

      walk.challengeId = challenge.id;
    });

    it("refuses a challenge that states no question with 400", async () => {
      expectRefusal(
        await server.post(
          "/challenges",
          { listing_id: walk.seededListingId, question: "" },
          actingAs("buyer"),
        ),
        400,
        "validation_error",
      );
    });

    it("answers 404 for a challenge on a listing identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          "/challenges",
          { listing_id: randomUUID(), question: "Which depot?" },
          actingAs("buyer"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses a challenge with no demo header as 401", async () => {
      expectRefusal(
        await server.post("/challenges", { listing_id: walk.seededListingId, question: "Which?" }),
        401,
        "unauthorized",
      );
    });

    it("refuses a challenge from the developer role as 403", async () => {
      expectRefusal(
        await server.post(
          "/challenges",
          { listing_id: walk.seededListingId, question: "Which?" },
          actingAs("developer"),
        ),
        403,
        "forbidden",
      );
    });

    it("accepts a response to a challenge from the buyer and from the developer", async () => {
      // The row reads "write buyer or developer" and the pair is not a wildcard, so both roles are
      // asserted and neither may be answered `403`. A second response to one challenge is accepted:
      // the row's only resource question is whether the challenge exists.
      const challengeId = captured(walk.challengeId, "the raised challenge");

      const asBuyer = await server.post(
        `/challenges/${challengeId}/responses`,
        { body: "The listing records one depot per leg." },
        actingAs("buyer"),
      );
      expect(asBuyer.status).toBe(201);

      const asDeveloper = await server.post(
        `/challenges/${challengeId}/responses`,
        { body: "Confirmed, and the limitation is stated on the version." },
        actingAs("developer"),
      );
      expect(asDeveloper.status).toBe(201);

      const response = asDeveloper.json<ChallengeResponse>();
      expect(response.challenge_id).toBe(challengeId);
      expect(response.account_id).toBe(server.accountForRole("developer").id);
    });

    it("moves the challenge it answered to responded on the board", async () => {
      // The status transition is the reason a response is not merely an append: the board states
      // `responded` once an answer exists, without the challenge's own text being rewritten.
      const challengeId = captured(walk.challengeId, "the raised challenge");
      const board = await server.get("/challenges");

      expect(board.status).toBe(200);

      const answered = board
        .json<{ readonly items: readonly Challenge[] }>()
        .items.find((challenge) => challenge.id === challengeId);

      expect(answered?.status).toBe("responded");
    });

    it("answers 404 for a response to a challenge identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/challenges/${randomUUID()}/responses`,
          { body: "An answer to nothing." },
          actingAs("developer"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses a challenge response from a role the row does not admit as 403", async () => {
      // The accepted pair is not a wildcard: a contributor is neither the buyer who asked nor the
      // developer whose listing was challenged, so the row refuses the role rather than the request.
      const challengeId = captured(walk.challengeId, "the raised challenge");

      expectRefusal(
        await server.post(
          `/challenges/${challengeId}/responses`,
          { body: "An answer from a role the row does not admit." },
          actingAs("contributor"),
        ),
        403,
        "forbidden",
      );
    });

    it("refuses a challenge response with no demo header as 401", async () => {
      const challengeId = captured(walk.challengeId, "the raised challenge");

      expectRefusal(
        await server.post(`/challenges/${challengeId}/responses`, { body: "An answer." }),
        401,
        "unauthorized",
      );
    });
  });

  describe("threads", () => {
    it("answers the public discussion board with no request header", async () => {
      const response = await server.get("/threads");

      expect(response.status).toBe(200);

      const board = response.json<{ readonly items: readonly Thread[] }>();

      expect(Array.isArray(board.items)).toBe(true);
      expect(board.items.length).toBeGreaterThan(0);
    });

    it("starts a thread from a resolvable account of any role, never refusing one", async () => {
      // Two different roles, because the row admits every demo account: a role the route refused
      // would answer `403`, which is the status this pair of assertions rules out.
      const asBuyer = await server.post(
        "/threads",
        { title: "Which depot does the intake listing record?" },
        actingAs("buyer"),
      );
      expect(asBuyer.status).toBe(201);

      const asOperator = await server.post(
        "/threads",
        { title: "How is a standard proposal reviewed?" },
        actingAs("operator"),
      );
      expect(asOperator.status).toBe(201);

      const thread = asBuyer.json<Thread>();
      expect(thread.title.length).toBeGreaterThan(0);
      expect(thread.author_account_id).toBe(server.accountForRole("buyer").id);

      walk.threadId = thread.id;
    });

    it("refuses a thread that states no title with 400", async () => {
      expectRefusal(await server.post("/threads", { title: "" }, actingAs("buyer")), 400, "validation_error");
    });

    it("refuses a thread with no demo header as 401", async () => {
      expectRefusal(await server.post("/threads", { title: "A thread with no author." }), 401, "unauthorized");
    });

    it("posts a reply to a thread from a resolvable account of a third role", async () => {
      const threadId = captured(walk.threadId, "the started thread");

      const response = await server.post(
        `/threads/${threadId}/posts`,
        { body: "The proposal row states its review status in the catalogue." },
        actingAs("contributor"),
      );

      expect(response.status).toBe(201);

      const post = response.json<ThreadPost>();

      expect(post.thread_id).toBe(threadId);
      expect(post.author_account_id).toBe(server.accountForRole("contributor").id);
    });

    it("answers 404 for a reply to a thread identifier no row carries", async () => {
      expectRefusal(
        await server.post(`/threads/${randomUUID()}/posts`, { body: "A reply to nothing." }, actingAs("buyer")),
        404,
        "not_found",
      );
    });

    it("refuses a thread reply with no demo header as 401", async () => {
      const threadId = captured(walk.threadId, "the started thread");

      expectRefusal(await server.post(`/threads/${threadId}/posts`, { body: "A reply." }), 401, "unauthorized");
    });
  });

  describe("standards", () => {
    it("submits a standard proposal as the contributor", async () => {
      const title = "Publish the fixture set's case identifiers with the version";
      const rationale = "A reader of a report cannot resolve a failing case id without the case set.";

      const response = await server.post(
        "/standards/proposals",
        { standard_id: STANDARD_VERSION_LABEL, title, rationale },
        actingAs("contributor"),
      );

      expect(response.status).toBe(201);

      const { standard_proposal: proposal } = response.json<{
        readonly standard_proposal: StandardProposal;
      }>();

      // The row is created `submitted`: the vocabulary of a creation is not the vocabulary of a
      // review, so a proposer cannot decide its own proposal.
      expect(proposal.status).toBe("submitted");
      expect(proposal.title).toBe(title);
      expect(proposal.rationale).toBe(rationale);
      expect(proposal.proposer_account_id).toBe(server.accountForRole("contributor").id);

      walk.proposalId = proposal.id;
      walk.proposalTitle = proposal.title;
      walk.proposalRationale = proposal.rationale;
    });

    it("refuses a proposal that states no rationale with 400", async () => {
      expectRefusal(
        await server.post(
          "/standards/proposals",
          { standard_id: STANDARD_VERSION_LABEL, title: "A change with no reason.", rationale: "" },
          actingAs("contributor"),
        ),
        400,
        "validation_error",
      );
    });

    it("refuses a proposal with no demo header as 401", async () => {
      expectRefusal(
        await server.post("/standards/proposals", {
          standard_id: STANDARD_VERSION_LABEL,
          title: "A change with no proposer.",
          rationale: "Stated for completeness.",
        }),
        401,
        "unauthorized",
      );
    });

    it("refuses a proposal from the buyer role as 403", async () => {
      expectRefusal(
        await server.post(
          "/standards/proposals",
          { standard_id: STANDARD_VERSION_LABEL, title: "A change.", rationale: "Stated." },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });

    it("reviews a proposal as the operator and moves its status", async () => {
      const proposalId = captured(walk.proposalId, "the submitted proposal");

      const response = await server.post(
        `/standards/proposals/${proposalId}/review`,
        { status: "accepted", reason: "The case set should be resolvable from a report." },
        actingAs("operator"),
      );

      expect(response.status).toBe(200);

      const { standard_proposal: reviewed } = response.json<{
        readonly standard_proposal: StandardProposal;
      }>();

      expect(reviewed.id).toBe(proposalId);
      expect(reviewed.status).toBe("accepted");
      // A review decides and records; it does not rewrite the text it decided, so the reasoning the
      // decision answered stays readable afterwards.
      expect(reviewed.title).toBe(walk.proposalTitle);
      expect(reviewed.rationale).toBe(walk.proposalRationale);
    });

    it("answers 409 for a second review of the same proposal", async () => {
      const proposalId = captured(walk.proposalId, "the submitted proposal");

      expectRefusal(
        await server.post(
          `/standards/proposals/${proposalId}/review`,
          { status: "rejected" },
          actingAs("operator"),
        ),
        409,
        "already_decided",
      );
    });

    it("answers 404 for a review of a proposal identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/standards/proposals/${randomUUID()}/review`,
          { status: "accepted" },
          actingAs("operator"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses a review with no demo header as 401, ahead of the proposal's own state", async () => {
      // The header is validated at the edge, before the handler runs, so an absent header is answered
      // `401` even though this proposal is already decided and a resolvable operator would earn the
      // `409` asserted above.
      const proposalId = captured(walk.proposalId, "the submitted proposal");

      expectRefusal(
        await server.post(`/standards/proposals/${proposalId}/review`, { status: "accepted" }),
        401,
        "unauthorized",
      );
    });

    it("refuses a review from the buyer role as 403", async () => {
      const proposalId = captured(walk.proposalId, "the submitted proposal");

      expectRefusal(
        await server.post(
          `/standards/proposals/${proposalId}/review`,
          { status: "accepted" },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });
  });

  describe("scoring and the report read", () => {
    /**
     * A complete submission for the seeded `seed-alpha` candidate: one recorded output per case of
     * the fixture set, each recording the value the case expects.
     *
     * The case identifiers come from the seeded report's own per-case evidence rather than from a
     * fixture file or from a list written here, because the fixture set is the versioned data the
     * evaluator loads and a report written against it states exactly the cases a complete submission
     * must carry. The recorded value is the stored expectation parsed back: `expected` is the
     * canonical JSON of the case's expected output, so parsing it recovers the value and recording it
     * is what a matching submission holds. Nothing is executed — a submission is data the evaluator
     * compares.
     */
    async function completeRecordedOutputs(): Promise<
      readonly { readonly case_id: string; readonly output: unknown }[]
    > {
      const seeded = await server.get(`/evaluations/${walk.seededReportId}`);

      expect(seeded.status).toBe(200);

      return seeded.json<EvaluationReportDetail>().case_results.map((evidence) => ({
        case_id: evidence.case_id,
        output: JSON.parse(evidence.expected) as unknown,
      }));
    }

    it("scores a seeded candidate for the developer that owns it and answers the report", async () => {
      const response = await server.post(
        "/evaluations",
        {
          candidate_version_id: walk.candidateVersionId,
          standard_version_id: STANDARD_VERSION_LABEL,
          recorded_outputs: await completeRecordedOutputs(),
        },
        actingAs("developer"),
      );

      expect(response.status).toBe(201);

      const report = response.json<EvaluationReportDetail>();

      expect(report.candidate_version_id).toBe(walk.candidateVersionId);
      // The report cites the standard version as the label the resolved criteria publish, on the
      // write and on the read alike, and states the rubric reference that resolves to its document.
      expect(report.standard_version_id).toBe(STANDARD_VERSION_LABEL);
      expect(report.rubric_reference).toBe(RUBRIC_REFERENCE);
      expect(report.total_count).toBe(report.case_results.length);

      // A submission that records the expected value for every case of the versioned set passes: the
      // pass rule is the standard version's own data, applied by the scorer and not by this file.
      expect(report.outcome).toBe("PASS");
      expect(report.matched_count).toBe(report.total_count);
      expect(report.critical_failures).toBe(0);

      // The label is derived from the version's origin rather than from the outcome, so a seeded
      // fixture candidate is labelled a sample whatever the run found.
      expect(report.label).toBe(REPORT_LABEL_SAMPLE);

      // The retest link is the server's: the same candidate version already carries the seeded report,
      // so the new report points at it although the request named no predecessor. The body carries no
      // retest field, which is what stops a submission from choosing what it points away from.
      expect(report.prior_report_id).toBe(walk.seededReportId);

      walk.reportId = report.id;
    });

    it("answers 400 for a submission that states no recorded outputs", async () => {
      expectRefusal(
        await server.post(
          "/evaluations",
          {
            candidate_version_id: walk.candidateVersionId,
            standard_version_id: STANDARD_VERSION_LABEL,
          },
          actingAs("developer"),
        ),
        400,
        "validation_error",
      );
    });

    it("answers 404 for an unknown candidate version and for an unknown standard version", async () => {
      const recorded_outputs = await completeRecordedOutputs();

      expectRefusal(
        await server.post(
          "/evaluations",
          {
            candidate_version_id: randomUUID(),
            standard_version_id: STANDARD_VERSION_LABEL,
            recorded_outputs,
          },
          actingAs("developer"),
        ),
        404,
        "not_found",
      );

      expectRefusal(
        await server.post(
          "/evaluations",
          {
            candidate_version_id: walk.candidateVersionId,
            standard_version_id: randomUUID(),
            recorded_outputs,
          },
          actingAs("developer"),
        ),
        404,
        "not_found",
      );
    });

    it("answers 422 for a submission that omits a case, before anything is written", async () => {
      const reportsBefore = countOf("SELECT COUNT(*) AS count FROM evaluation_reports");
      const feeEntriesBefore = countOf("SELECT COUNT(*) AS count FROM ledger_entries");

      const [firstCase] = await completeRecordedOutputs();

      if (firstCase === undefined) {
        throw new Error("route walk: the seeded report carried no per-case evidence to omit from.");
      }

      const response = await server.post(
        "/evaluations",
        {
          candidate_version_id: walk.candidateVersionId,
          standard_version_id: STANDARD_VERSION_LABEL,
          recorded_outputs: [firstCase],
        },
        actingAs("developer"),
      );

      expectRefusal(response, 422, "incomplete_submission");

      // The ordering is product behaviour rather than error handling: the completeness refusal is
      // raised by the scorer before the report insert and before the gate fee, so a refused
      // submission leaves the append-only tables exactly as they were.
      expect(countOf("SELECT COUNT(*) AS count FROM evaluation_reports")).toBe(reportsBefore);
      expect(countOf("SELECT COUNT(*) AS count FROM ledger_entries")).toBe(feeEntriesBefore);
    });

    it("refuses a submission with no demo header as 401", async () => {
      // A schema-valid submission and no header at all: the header is what failed, and the row is
      // answered `401` without the request being read as a submission by anyone.
      const [firstCase] = await completeRecordedOutputs();

      if (firstCase === undefined) {
        throw new Error("route walk: the seeded report carried no per-case evidence.");
      }

      expectRefusal(
        await server.post("/evaluations", {
          candidate_version_id: walk.candidateVersionId,
          standard_version_id: STANDARD_VERSION_LABEL,
          recorded_outputs: [firstCase],
        }),
        401,
        "unauthorized",
      );
    });

    it("refuses a submission from the buyer role as 403", async () => {
      const [firstCase] = await completeRecordedOutputs();

      if (firstCase === undefined) {
        throw new Error("route walk: the seeded report carried no per-case evidence.");
      }

      expectRefusal(
        await server.post(
          "/evaluations",
          {
            candidate_version_id: walk.candidateVersionId,
            standard_version_id: STANDARD_VERSION_LABEL,
            recorded_outputs: [firstCase],
          },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });

    it("reads a report with no request header at all, per-case evidence included", async () => {
      const reportId = captured(walk.reportId, "the written report");

      const anonymous = await server.get(`/evaluations/${reportId}`);

      expect(anonymous.status).toBe(200);

      const report = anonymous.json<EvaluationReportDetail>();

      expect(report.id).toBe(reportId);
      expect(report.case_results.length).toBe(report.total_count);

      for (const evidence of report.case_results) {
        expect(evidence.case_id.length).toBeGreaterThan(0);
        expect(typeof evidence.expected).toBe("string");
        expect(typeof evidence.actual).toBe("string");
        expect(typeof evidence.match).toBe("boolean");
      }

      // The read resolves no identity: an account the server cannot resolve is answered the same
      // bytes, which is what makes this row public rather than quietly identified.
      const unresolvable = await server.get(`/evaluations/${reportId}`, {
        account: "route-walk-no-account-carries-this-value",
      });

      expect(unresolvable.status).toBe(200);
      expect(unresolvable.text).toBe(anonymous.text);
    });

    it("answers 404 for a report identifier no row carries", async () => {
      expectRefusal(await server.get(`/evaluations/${randomUUID()}`), 404, "not_found");
    });
  });

  describe("appeals", () => {
    it("opens an appeal against a report as the developer", async () => {
      const reportId = captured(walk.reportId, "the written report");

      const response = await server.post(
        `/evaluations/${reportId}/appeals`,
        { reason: "The report should state the case identifiers its evidence names." },
        actingAs("developer"),
      );

      expect(response.status).toBe(201);

      const appeal = response.json<Appeal>();

      expect(appeal.report_id).toBe(reportId);
      // An appeal is opened `open`: only the ruling route moves it, and no ruling can reopen one.
      expect(appeal.status).toBe("open");
      expect(appeal.reason.length).toBeGreaterThan(0);

      walk.appealId = appeal.id;
    });

    it("refuses an appeal that states no reason with 400", async () => {
      const reportId = captured(walk.reportId, "the written report");

      expectRefusal(
        await server.post(`/evaluations/${reportId}/appeals`, { reason: "" }, actingAs("developer")),
        400,
        "validation_error",
      );
    });

    it("answers 404 for an appeal against a report identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/evaluations/${randomUUID()}/appeals`,
          { reason: "An appeal against nothing." },
          actingAs("developer"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses an appeal with no demo header as 401", async () => {
      const reportId = captured(walk.reportId, "the written report");

      expectRefusal(
        await server.post(`/evaluations/${reportId}/appeals`, { reason: "An appeal." }),
        401,
        "unauthorized",
      );
    });

    it("refuses an appeal from the buyer role as 403", async () => {
      const reportId = captured(walk.reportId, "the written report");

      expectRefusal(
        await server.post(
          `/evaluations/${reportId}/appeals`,
          { reason: "An appeal from a role the row does not admit." },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });

    it("rules an appeal as the operator and leaves the measurement it concerns alone", async () => {
      const appealId = captured(walk.appealId, "the opened appeal");
      const reportId = captured(walk.reportId, "the written report");

      const before = (await server.get(`/evaluations/${reportId}`)).json<EvaluationReportDetail>();

      const response = await server.post(
        `/appeals/${appealId}/ruling`,
        { status: "upheld", reason: "The case identifiers should travel with the report." },
        actingAs("operator"),
      );

      expect(response.status).toBe(200);

      // The answer carries the ruled appeal beside the governance event the ruling appended, so the
      // operator's stated ground is readable where the decision is shown. The event's own fields —
      // its reason, its actor, its payload — are asserted against the stored row by the immutability
      // suite, which owns the append; what this walk pins is that the answer carries an event at all,
      // and that it is the one for the appeal the ruling acted on.
      const { appeal: ruled, event } = response.json<{
        readonly appeal: Appeal;
        readonly event: GovernanceEvent;
      }>();

      expect(ruled.id).toBe(appealId);
      expect(ruled.status).toBe("upheld");
      expect(event.subject_id).toBe(appealId);

      // The operator's power is additive: a ruling appends the record of the decision and no request
      // it accepts can reach a report. A byte-for-byte comparison of the stored rows is the
      // immutability suite's; what is asserted here is that the same row still measures what it did.
      const after = (await server.get(`/evaluations/${reportId}`)).json<EvaluationReportDetail>();

      expect(after.outcome).toBe(before.outcome);
      expect(after.matched_count).toBe(before.matched_count);
      expect(after.critical_failures).toBe(before.critical_failures);
      expect(after.label).toBe(before.label);
    });

    it("answers 409 for a second ruling of the same appeal", async () => {
      const appealId = captured(walk.appealId, "the opened appeal");

      expectRefusal(
        await server.post(`/appeals/${appealId}/ruling`, { status: "denied" }, actingAs("operator")),
        409,
        "already_ruled",
      );
    });

    it("answers 404 for a ruling of an appeal identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/appeals/${randomUUID()}/ruling`,
          { status: "denied" },
          actingAs("operator"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses a ruling with no demo header as 401, ahead of the appeal's own state", async () => {
      // As with the review row: the header is validated at the edge, so an absent header is `401`
      // even though this appeal is already ruled and a resolvable operator would earn the `409`.
      const appealId = captured(walk.appealId, "the opened appeal");

      expectRefusal(
        await server.post(`/appeals/${appealId}/ruling`, { status: "denied" }),
        401,
        "unauthorized",
      );
    });

    it("refuses a ruling from the buyer role as 403", async () => {
      const appealId = captured(walk.appealId, "the opened appeal");

      expectRefusal(
        await server.post(`/appeals/${appealId}/ruling`, { status: "denied" }, actingAs("buyer")),
        403,
        "forbidden",
      );
    });
  });

  describe("commerce", () => {
    /**
     * The body of a checkout of the walk's own published version, so that the row's own failure cases
     * are built against a listing and a version that exist and differ only in the field under test.
     */
    function checkoutBody(offerModel: OfferModel): Record<string, string> {
      return {
        listing_id: captured(walk.createdListingId, "the created listing"),
        listing_version_id: captured(walk.createdVersionId, "the published version"),
        offer_model: offerModel,
      };
    }

    it("simulates a purchase as the buyer and labels the transaction as a simulation", async () => {
      const response = await server.post(
        "/checkout-simulations",
        checkoutBody(DECLARED_PRICING_MODEL),
        actingAs("buyer"),
      );

      expect(response.status).toBe(201);

      const transaction = response.json<Transaction>();

      // The row is labelled as what it is in the payload a client renders: a simulated transaction of
      // the synthetic currency, disclosed as such, in whole minor units, with no real currency code
      // and no symbol anywhere.
      expect(transaction.simulated).toBe(true);
      expect(transaction.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
      expect(transaction.disclosure_label).toBe(COMMERCE_DISCLOSURE_LABEL);
      expect(Number.isInteger(transaction.amount_minor_units)).toBe(true);
      expect(transaction.amount_minor_units).toBeGreaterThan(0);
      expect(transaction.buyer_account_id).toBe(server.accountForRole("buyer").id);
      expect(transaction.offer_model).toBe(DECLARED_PRICING_MODEL);

      walk.transactionId = transaction.id;
      walk.transactionAmount = transaction.amount_minor_units;
    });

    it("simulates a second purchase of the same version", async () => {
      // The second transaction exists so the refund row's two refusal cases can both be provoked
      // without disturbing the first transaction's state.
      const response = await server.post(
        "/checkout-simulations",
        checkoutBody(DECLARED_PRICING_MODEL),
        actingAs("buyer"),
      );

      expect(response.status).toBe(201);

      const transaction = response.json<Transaction>();

      walk.secondTransactionId = transaction.id;
      walk.secondTransactionAmount = transaction.amount_minor_units;

      expect(walk.secondTransactionId).not.toBe(walk.transactionId);
    });

    it("answers 400 for a checkout body that states no offer model", async () => {
      const body = checkoutBody(DECLARED_PRICING_MODEL);
      delete body["offer_model"];

      expectRefusal(await server.post("/checkout-simulations", body, actingAs("buyer")), 400, "validation_error");
    });

    it("answers 404 for a checkout naming a listing and a version no row carries", async () => {
      const versionId = captured(walk.createdVersionId, "the published version");

      expectRefusal(
        await server.post(
          "/checkout-simulations",
          {
            listing_id: randomUUID(),
            listing_version_id: versionId,
            offer_model: DECLARED_PRICING_MODEL,
          },
          actingAs("buyer"),
        ),
        404,
        "not_found",
      );

      expectRefusal(
        await server.post(
          "/checkout-simulations",
          {
            listing_id: captured(walk.createdListingId, "the created listing"),
            listing_version_id: randomUUID(),
            offer_model: DECLARED_PRICING_MODEL,
          },
          actingAs("buyer"),
        ),
        404,
        "not_found",
      );
    });

    it("answers 422 for an offer model the listing does not make", async () => {
      // The refusal is the domain package's own code, preserved by the mapping: a route maps a
      // refusal by the string the package that produces it spells, so the code a client reads says
      // what the refusal was rather than that something was unprocessable.
      expectRefusal(
        await server.post(
          "/checkout-simulations",
          checkoutBody(UNOFFERED_OFFER_MODEL),
          actingAs("buyer"),
        ),
        422,
        "not_offered",
      );
    });

    it("refuses a checkout with no demo header as 401", async () => {
      expectRefusal(
        await server.post("/checkout-simulations", checkoutBody(DECLARED_PRICING_MODEL)),
        401,
        "unauthorized",
      );
    });

    it("refuses a checkout from the developer role as 403", async () => {
      expectRefusal(
        await server.post(
          "/checkout-simulations",
          checkoutBody(DECLARED_PRICING_MODEL),
          actingAs("developer"),
        ),
        403,
        "forbidden",
      );
    });

    it("refunds a simulated transaction in full as the operator, appending reversals", async () => {
      const transactionId = captured(walk.transactionId, "the first transaction");

      const response = await server.post(
        `/transactions/${transactionId}/refunds`,
        { amount_minor_units: walk.transactionAmount },
        actingAs("operator"),
      );

      expect(response.status).toBe(201);

      const { entries, refund } = response.json<{
        readonly entries: readonly LedgerEntry[];
        readonly refund: Refund;
      }>();

      // One proportional reversal per ledger the transaction reached, written beside the rows they
      // reverse: `entries` is the array the client's own reader looks for, and nothing of the
      // transaction itself is edited or removed.
      expect(entries.length).toBe(2);

      for (const entry of entries) {
        expect(entry.entry_type).toBe("reversal");
        expect(entry.transaction_id).toBe(transactionId);
        expect(entry.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
        expect(entry.disclosure_label).toBe(COMMERCE_DISCLOSURE_LABEL);
        expect(Number.isInteger(entry.amount_minor_units)).toBe(true);
        expect(entry.description.length).toBeGreaterThan(0);
      }

      expect(refund.transaction_id).toBe(transactionId);
      expect(refund.amount_minor_units).toBe(walk.transactionAmount);
      expect(refund.operator_account_id).toBe(server.accountForRole("operator").id);
    });

    it("answers 409 for a second refund of a transaction already refunded in full", async () => {
      const transactionId = captured(walk.transactionId, "the first transaction");

      // A net position is derived from the refund rows rather than stored, so the second refund of a
      // transaction already reversed in full is a refusal about the transaction's state.
      expectRefusal(
        await server.post(
          `/transactions/${transactionId}/refunds`,
          { amount_minor_units: 1 },
          actingAs("operator"),
        ),
        409,
        "already_fully_refunded",
      );
    });

    it("answers 422 for a refund larger than a transaction has left to reverse", async () => {
      const transactionId = captured(walk.secondTransactionId, "the second transaction");

      expectRefusal(
        await server.post(
          `/transactions/${transactionId}/refunds`,
          { amount_minor_units: walk.secondTransactionAmount + 1 },
          actingAs("operator"),
        ),
        422,
        "exceeds_net_remaining",
      );
    });

    it("answers 404 for a refund of a transaction identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/transactions/${randomUUID()}/refunds`,
          { amount_minor_units: 1 },
          actingAs("operator"),
        ),
        404,
        "transaction_not_found",
      );
    });

    it("refuses a refund with no demo header as 401", async () => {
      // A valid body and an absent header, so nothing but the identity can be what failed.
      const transactionId = captured(walk.transactionId, "the first transaction");

      expectRefusal(
        await server.post(`/transactions/${transactionId}/refunds`, { amount_minor_units: 0 }),
        401,
        "unauthorized",
      );
    });

    it("refuses a refund from the buyer role as 403", async () => {
      const transactionId = captured(walk.transactionId, "the first transaction");

      expectRefusal(
        await server.post(
          `/transactions/${transactionId}/refunds`,
          { amount_minor_units: 0 },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });
  });

  describe("moderation", () => {
    /** The one action body of this row, so its failure cases differ only in the field under test. */
    interface ActionBody {
      readonly action: ModerationAction;
      readonly reason: string;
    }

    /** Applies one moderation action to the listing this walk created, as the operator. */
    async function moderate(action: ModerationAction, reason: string): Promise<TestResponse> {
      const listingId = captured(walk.createdListingId, "the created listing");

      return server.post(
        `/moderation/listings/${listingId}/actions`,
        { action, reason } satisfies ActionBody,
        actingAs("operator"),
      );
    }

    /** The listing's status as the action's own `200` body states it. */
    function statusOf(response: TestResponse): string {
      return response.json<{ readonly listing: { readonly status: string } }>().listing.status;
    }

    it("flags the walk's own listing as the operator and appends exactly one event", async () => {
      const eventsBefore = countOf("SELECT COUNT(*) AS count FROM governance_events");

      const response = await moderate("flag", "The summary should state the limitation it omits.");

      expect(response.status).toBe(200);
      // A flag records a concern without changing whether the listing is visible, which is what lets
      // one operator's doubt be reviewed before anything is removed.
      expect(statusOf(response)).toBe("flagged");
      expect(countOf("SELECT COUNT(*) AS count FROM governance_events")).toBe(eventsBefore + 1);
    });

    it("hides it: gone from browse and from a public reader, still readable by the operator", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");
      const eventsBefore = countOf("SELECT COUNT(*) AS count FROM governance_events");

      const response = await moderate("hide", "The listing's claims are under review.");

      expect(response.status).toBe(200);
      expect(statusOf(response)).toBe("hidden");
      expect(countOf("SELECT COUNT(*) AS count FROM governance_events")).toBe(eventsBefore + 1);

      // Gone from the search a buyer browses, for every caller: the row source excludes a hidden
      // listing before any filter runs, and the match set is an empty collection rather than an
      // absent key, because no listing matching a search is an ordinary answer.
      const search = await server.get("/listings", { query: { q: WALK_LISTING_TITLE } });

      expect(search.status).toBe(200);
      expect(search.json<ListingSearchResult>().total).toBe(0);
      expect(search.json<ListingSearchResult>().items).toEqual([]);

      // Gone from the public detail read, which is the "unknown or removed" `404` rather than a role
      // refusal: the listing is concealed from a reader who is not the operator.
      expectRefusal(await server.get(`/listings/${listingId}`), 404, "not_found");
      expectRefusal(await server.get(`/listings/${listingId}`, actingAs("buyer")), 404, "not_found");

      // Still readable by the operator, with the version history a later restore has to find.
      const asOperator = await server.get(`/listings/${listingId}`, actingAs("operator"));

      expect(asOperator.status).toBe(200);

      const detail = asOperator.json<ListingDetail>();

      expect(detail.id).toBe(listingId);
      expect(detail.versions[0]?.version_string).toBe(WALK_VERSION_STRING);
    });

    it("restores it to visibility as the operator", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");
      const eventsBefore = countOf("SELECT COUNT(*) AS count FROM governance_events");

      const response = await moderate("restore", "The review found nothing to withhold.");

      expect(response.status).toBe(200);
      expect(statusOf(response)).toBe("active");
      expect(countOf("SELECT COUNT(*) AS count FROM governance_events")).toBe(eventsBefore + 1);

      const search = await server.get("/listings", { query: { q: WALK_LISTING_TITLE } });

      expect(search.status).toBe(200);

      const page = search.json<ListingSearchResult>();

      expect(page.total).toBe(1);
      expect(page.items[0]?.id).toBe(listingId);
    });

    it("answers 400 for a moderation action that states no reason", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");

      // The reason is required by the row's own contract rather than by good manners: the operator
      // accounts for the decision, and the event it appends carries that reason.
      expectRefusal(
        await server.post(
          `/moderation/listings/${listingId}/actions`,
          { action: "flag" },
          actingAs("operator"),
        ),
        400,
        "validation_error",
      );
    });

    it("answers 400 for a moderation action whose reason is blank", async () => {
      expectRefusal(await moderate("flag", "   "), 400, "validation_error");
    });

    it("answers 404 for a moderation action on a listing identifier no row carries", async () => {
      expectRefusal(
        await server.post(
          `/moderation/listings/${randomUUID()}/actions`,
          { action: "hide", reason: "A listing that does not exist." },
          actingAs("operator"),
        ),
        404,
        "not_found",
      );
    });

    it("refuses a moderation action with no demo header as 401", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");

      expectRefusal(
        await server.post(`/moderation/listings/${listingId}/actions`, {
          action: "hide",
          reason: "A decision with no operator behind it.",
        }),
        401,
        "unauthorized",
      );
    });

    it("refuses a moderation action from the buyer role as 403", async () => {
      const listingId = captured(walk.createdListingId, "the created listing");

      expectRefusal(
        await server.post(
          `/moderation/listings/${listingId}/actions`,
          { action: "hide", reason: "A decision from a role the row does not admit." },
          actingAs("buyer"),
        ),
        403,
        "forbidden",
      );
    });
  });

  describe("search and detail", () => {
    it("answers one page of public search with no request header", async () => {
      const response = await server.get("/listings");

      expect(response.status).toBe(200);

      const page = response.json<ListingSearchResult>();

      expect(Array.isArray(page.items)).toBe(true);
      expect(page.items.length).toBeGreaterThan(0);
      // The page size is the contract's fixed number rather than a client's choice, so a page never
      // carries more than it.
      expect(page.items.length).toBeLessThanOrEqual(LISTING_PAGE_SIZE);
      expect(page.page).toBe(1);
      expect(page.total).toBeGreaterThanOrEqual(page.items.length);

      for (const summary of page.items) {
        expect(summary.id.length).toBeGreaterThan(0);
        expect(summary.license_code.length).toBeGreaterThan(0);
        expect(summary.pricing_model.length).toBeGreaterThan(0);
      }
    });

    it("states the walk's own listing as measured by nothing yet", async () => {
      // The listing this walk published a version to carries no report, which is the ordinary
      // "no report yet" state rather than an error: the three provenance values are absent together
      // rather than one of them being an empty string or a substituted word.
      const response = await server.get("/listings", { query: { q: WALK_LISTING_TITLE } });

      expect(response.status).toBe(200);

      const page = response.json<ListingSearchResult>();

      expect(page.total).toBe(1);
      expect(page.items.length).toBe(1);

      const summary = page.items[0];

      expect(summary?.id).toBe(captured(walk.createdListingId, "the created listing"));
      expect(summary?.version_string).toBe(WALK_VERSION_STRING);
      expect(summary?.outcome).toBeNull();
      expect(summary?.standard_version_id).toBeNull();
      expect(summary?.label).toBeNull();
    });

    it("answers a listing detail with versions, claims, evidence and offer models", async () => {
      const listingId = captured(walk.seededListingId, "the seeded listing");

      const response = await server.get(`/listings/${listingId}`);

      expect(response.status).toBe(200);

      const detail = response.json<ListingDetail>();

      expect(detail.id).toBe(listingId);
      expect(detail.versions.length).toBeGreaterThan(0);
      expect(detail.claims.length).toBeGreaterThan(0);
      expect(detail.offer_models.length).toBeGreaterThan(0);

      for (const claim of detail.claims) {
        expect(claim.claim.length).toBeGreaterThan(0);
        // A limitation is what the compare view sets beside the claim, so a claim without one would
        // make a comparison describe a listing more confidently than its author did.
        expect(claim.limitation.length).toBeGreaterThan(0);
      }

      // The evidence is the newest report for the newest version, and the four provenance values are
      // present together. The newest report for this listing's candidate version is the one this
      // walk's own submission wrote, which is the newest-measurement rule the read applies: the seeded
      // report is the predecessor that submission linked to rather than the value stated here.
      expect(detail.report_id).toBe(captured(walk.reportId, "the written report"));
      expect(detail.outcome).not.toBeNull();
      expect(detail.standard_version_id).toBe(STANDARD_VERSION_LABEL);
      expect(detail.label).not.toBeNull();
    });

    it("answers 404 for a listing identifier no row carries", async () => {
      expectRefusal(await server.get(`/listings/${randomUUID()}`), 404, "not_found");
    });
  });

  describe("compare", () => {
    it("compares two listings and answers the columns in the requested order", async () => {
      // The order is the request's own, so a table's columns follow the reader's ordering rather than
      // one the server happened to return rows in.
      const measuredId = captured(walk.seededListingId, "the seeded listing");
      const unmeasuredId = captured(walk.createdListingId, "the created listing");

      const response = await server.get("/compare", {
        query: { ids: `${measuredId},${unmeasuredId}` },
      });

      expect(response.status).toBe(200);

      const { entries } = response.json<CompareResult>();

      expect(entries.length).toBe(2);
      expect(entries[0]?.listing_id).toBe(measuredId);
      expect(entries[1]?.listing_id).toBe(unmeasuredId);

      // One column states what was measured against it beside the claim's own limitation. The measured
      // evidence of a seeded candidate's version is the newest report for that version, which is the
      // report this walk's own submission wrote rather than the seeded report it linked to.
      const measured = entries[0];

      expect(measured?.report_id).toBe(captured(walk.reportId, "the written report"));
      expect(measured?.limitations.length).toBeGreaterThan(0);
      expect(measured?.license_code.length).toBeGreaterThan(0);

      // ...and the listing this walk published is stated as measured by nothing, in all three of the
      // provenance fields at once rather than in one of them.
      const unmeasured = entries[1];

      expect(unmeasured?.report_id).toBeNull();
      expect(unmeasured?.outcome).toBeNull();
      expect(unmeasured?.standard_version_id).toBeNull();
      expect(unmeasured?.label).toBeNull();
      expect(unmeasured?.license_code.length).toBeGreaterThan(0);
    });

    it("answers 400 for a single identifier", async () => {
      // The two-to-four bound is the request schema's, because `ids` is a comma-joined string the
      // validator can measure rather than an array it would coerce: a comparison of one is a listing
      // read, so one identifier is a validation failure rather than an answer with one column.
      const ids = captured(walk.seededListingId, "the seeded listing");

      expect(ids.split(",").length).toBeLessThan(COMPARE_MIN_IDS);
      expectRefusal(
        await server.get("/compare", { query: { ids } }),
        400,
        "validation_error",
      );
    });

    it("answers 400 for more identifiers than the bound admits", async () => {
      const ids = Array.from({ length: COMPARE_MAX_IDS + 1 }, (): string => randomUUID()).join(",");

      expect(ids.split(",")).toHaveLength(COMPARE_MAX_IDS + 1);
      expectRefusal(await server.get("/compare", { query: { ids } }), 400, "validation_error");
    });

    it("answers 404 for an identifier that names no listing", async () => {
      const ids = [captured(walk.seededListingId, "the seeded listing"), randomUUID()].join(",");

      expectRefusal(await server.get("/compare", { query: { ids } }), 404, "not_found");
    });
  });

  describe("the standards catalogue", () => {
    /** One catalogue item: the standard, with its versions and its proposals beside it. */
    interface CatalogueItem {
      readonly id: string;
      readonly code: string;
      readonly versions: readonly StandardVersion[];
      readonly proposals: readonly StandardProposal[];
    }

    /** The catalogue read, which both reads of this block are built from. */
    async function readCatalogue(): Promise<readonly CatalogueItem[]> {
      const response = await server.get("/standards");

      expect(response.status).toBe(200);

      return response.json<{ readonly items: readonly CatalogueItem[] }>().items;
    }

    it("answers the catalogue with no request header, proposals in review status included", async () => {
      const proposalId = captured(walk.proposalId, "the submitted proposal");
      const standard = (await readCatalogue()).find((item) => item.code === STANDARD_VERSION_LABEL);

      expect(standard).toBeDefined();
      expect(standard?.versions.length).toBeGreaterThan(0);

      const proposal = standard?.proposals.find((entry) => entry.id === proposalId);

      // The proposal the walk submitted is readable beside the standard it concerns, in its reviewed
      // status, with the text the review decided untouched: a review moves the status and appends the
      // record of the decision, and never rewrites what it decided.
      expect(proposal?.status).toBe("accepted");
      expect(proposal?.title).toBe(walk.proposalTitle);
      expect(proposal?.rationale).toBe(walk.proposalRationale);
    });

    it("answers a published version by the standard's code and by the version's label and row id", async () => {
      const standard = (await readCatalogue()).find((item) => item.code === STANDARD_VERSION_LABEL);
      const version = standard?.versions[0];

      expect(standard).toBeDefined();
      expect(version).toBeDefined();

      if (standard === undefined || version === undefined) {
        throw new Error("route walk: the catalogue holds no version of the seeded standard.");
      }

      // The label resolves the row, which is the address a report cites and the one the page uses.
      const byLabel = await server.get(
        `/standards/${STANDARD_VERSION_LABEL}/versions/${STANDARD_VERSION_LABEL}`,
      );

      expect(byLabel.status).toBe(200);

      const cited = byLabel.json<{ readonly standard_version: StandardVersion }>().standard_version;

      expect(cited.version_label).toBe(STANDARD_VERSION_LABEL);
      expect(cited.id).toBe(version.id);
      // The versioned criteria are read back as the row stores them: no threshold is recomputed by a
      // read, which is what lets a report's outcome rest on data rather than on a build.
      expect(cited.total_cases).toBeGreaterThan(0);
      expect(cited.critical_cases).toBeGreaterThan(0);
      expect(cited.pass_threshold_matches).toBeGreaterThan(0);
      expect(cited.rubric_reference).toBe(RUBRIC_REFERENCE);

      // The other address resolves the same row: the standard by its identifier and the version by its
      // own, which answers the identical body.
      const byRowId = await server.get(`/standards/${standard.id}/versions/${version.id}`);

      expect(byRowId.status).toBe(200);
      expect(byRowId.text).toBe(byLabel.text);
    });

    it("answers 404 for a version label that names no published version", async () => {
      expectRefusal(
        await server.get(`/standards/${STANDARD_VERSION_LABEL}/versions/${randomUUID()}`),
        404,
        "not_found",
      );
    });
  });

  describe("operator reads", () => {
    /**
     * The three amount collections, each with the path it is served at and the ledger its entries
     * state. Together with the audit feed read below they are the four non-public reads of the
     * contract table, and the paths are written here because they are the row's address rather than
     * a value a response could supply.
     */
    const collections: readonly (readonly [string, string, string])[] = [
      ["the marketplace collection", "/ledger/marketplace", "marketplace"],
      ["the gate-fee collection", "/ledger/gate-fees", "gate_fees"],
      ["the founder-allocation collection", "/ledger/founder-allocation", "founder_allocation"],
    ];

    /**
     * How many entries one of the three ledgers holds in all, read from the table itself.
     *
     * The count is taken through the harness's own connection rather than from a response, so the
     * bounded read's `total` is compared against the ledger rather than against itself.
     */
    const ledgerEntryCount = (ledger: string): number =>
      firstRow<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM ledger_entries WHERE ledger = ?",
        ledger,
      ).count;

    /**
     * The identifiers of one page of the audit feed exactly as the read answers them: the page is
     * windowed over the newest end of the feed's own order — `created_at` descending with the table's
     * `rowid` as the tie-break, which is the order the writes happened read backwards — and the page's
     * rows are then put back into that order ascending, which is the insertion order the feed documents.
     */
    const auditPageIds = (page: number): string[] =>
      server
        .query<{ readonly id: string }>(
          `SELECT id FROM (
             SELECT id, created_at, rowid AS position FROM audit_events
             ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
           ) ORDER BY created_at ASC, position ASC`,
          COLLECTION_PAGE_SIZE,
          COLLECTION_PAGE_SIZE * (page - 1),
        )
        .map((row) => row.id);

    it.each(collections)("answers %s for the operator, one page at a time", async (_label, path, ledger) => {
      const response = await server.get(path, actingAs("operator"));

      expect(response.status).toBe(200);

      const body = response.json<LedgerReadResult | FounderAllocationLedgerReadResult>();

      expect(body.ledger).toBe(ledger);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThan(0);

      // The read is bounded and says so: one page of the fixed page size, page 1 when no page is asked
      // for, with the number of entries the ledger holds in all stated beside it, read here from the
      // table rather than from the response.
      expect(body.page).toBe(1);
      expect(body.entries.length).toBeLessThanOrEqual(COLLECTION_PAGE_SIZE);
      expect(body.total).toBe(ledgerEntryCount(ledger));

      for (const entry of body.entries) {
        // Every amount is a whole count of the synthetic currency, labelled as such: there is no real
        // currency code and no symbol anywhere in a ledger entry.
        expect(Number.isInteger(entry.amount_minor_units)).toBe(true);
        expect(entry.currency_label).toBe(SYNTHETIC_CURRENCY_LABEL);
        expect(entry.disclosure_label).toBe(COMMERCE_DISCLOSURE_LABEL);
      }
    });

    it.each(collections)("refuses %s for a resolvable non-operator", async (_label, path) => {
      expectRefusal(await server.get(path, actingAs("buyer")), 403, "forbidden");
    });

    it.each(collections)("refuses %s with no demo header", async (_label, path) => {
      expectRefusal(await server.get(path), 401, "unauthorized");
    });

    it("answers the append-only audit feed for the operator, one page at a time", async () => {
      const response = await server.get("/audit-events", actingAs("operator"));

      expect(response.status).toBe(200);

      const feed = response.json<{
        readonly items: readonly AuditEvent[];
        readonly total: number;
        readonly page: number;
      }>();

      expect(Array.isArray(feed.items)).toBe(true);
      // Every write this walk made is recorded, so the feed is not empty by the time it is read, and
      // each row carries the five facts of an audited write rather than a request body.
      expect(feed.items.length).toBeGreaterThan(0);

      // The read is bounded, and it states the record's size: one page of the fixed page size — page 1
      // when no page is asked for — with the number of events the whole feed holds counted from
      // `audit_events` itself, which is also the page's own rows in the insertion order the feed
      // documents.
      expect(feed.page).toBe(1);
      expect(feed.items.length).toBeLessThanOrEqual(COLLECTION_PAGE_SIZE);
      expect(feed.total).toBe(countOf("SELECT COUNT(*) AS count FROM audit_events"));
      expect(feed.items.map((event) => event.id)).toStrictEqual(auditPageIds(1));

      for (const event of feed.items) {
        expect(event.actor_account_id.length).toBeGreaterThan(0);
        expect(event.action.length).toBeGreaterThan(0);
        expect(event.resource_type.length).toBeGreaterThan(0);
        expect(event.resource_id.length).toBeGreaterThan(0);
        expect(Number.isInteger(event.status_code)).toBe(true);
      }
    });

    it("answers the page before the last writes for ?page=2, with the whole feed's own count on both", async () => {
      const first = await server.get("/audit-events", actingAs("operator"));
      const second = await server.get("/audit-events", { ...actingAs("operator"), query: { page: 2 } });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const firstPage = first.json<{
        readonly items: readonly AuditEvent[];
        readonly total: number;
        readonly page: number;
      }>();
      const secondPage = second.json<{
        readonly items: readonly AuditEvent[];
        readonly total: number;
        readonly page: number;
      }>();

      // Both pages describe the same feed — only the page number moves — and each answers its own window
      // of the feed's order, so the two never hold the same event twice. A feed holding no more than one
      // page answers the empty list on page 2 with the same total, which is an ordinary answer rather
      // than an error: what matters is that neither page claims to be the whole record.
      expect(secondPage.page).toBe(2);
      expect(secondPage.total).toBe(firstPage.total);
      expect(secondPage.items.map((event) => event.id)).toStrictEqual(auditPageIds(2));
      expect(firstPage.items.length).toBeLessThanOrEqual(COLLECTION_PAGE_SIZE);

      const firstPageIds = new Set(firstPage.items.map((event) => event.id));
      expect(secondPage.items.some((event) => firstPageIds.has(event.id))).toBe(false);
    });

    it("refuses the audit feed for a resolvable non-operator and for no header", async () => {
      expectRefusal(await server.get("/audit-events", actingAs("buyer")), 403, "forbidden");
      expectRefusal(await server.get("/audit-events"), 401, "unauthorized");
    });
  });

  /**
   * The upper bound of `page` on the eight bounded collection reads, and the largest page each read
   * admits.
   *
   * Each of those reads turns its page into a number it hands the storage layer — the offset of the
   * page, and on the catalogue the rank the page ends on — and those numbers are reproduced exactly
   * only at or below `PAGE_NUMBER_MAX` (`@adem/shared`). A page above it used to reach that arithmetic
   * and round, which the storage layer refused with `SQLITE_MISMATCH` or with a `RangeError` and the
   * single error handler answered `500 internal_error`; it is a value the schema itself refuses now,
   * which is the `400` the row's error column documents. The listing search is not among them: it
   * declares the lower bound alone and refuses the page whose offset the store cannot address in its
   * own route, which is that row's refusal and is asserted where that row's statuses are. The largest
   * page a read's bound admits is at the same time an ordinary request: every read here, the search
   * included, answers it `200` with an empty page and the collection's own size, which is the
   * documented empty page rather than an error.
   */
  describe("the page bound every collection read carries", () => {
    /**
     * What one answer states about the page it answered: the page itself — `null` where the read states
     * only the collection's size — the number of rows the page carries, and the size of the whole
     * collection the same answer states beside it.
     */
    interface AnsweredPage {
      readonly page: number | null;
      readonly rows: number;
      readonly statedTotal: number;
    }

    /** One catalogue item, as this block reads it: its own page of proposals and the standard's total. */
    interface CatalogueItem {
      readonly proposals: readonly StandardProposal[];
      readonly proposal_total: number;
    }

    /**
     * One read the bound applies to: where it is served, the header it needs, and how its body states
     * the page, the page's rows and the collection's size.
     *
     * The path and the options are functions because neither exists when this table is built:
     * `beforeAll` fills the walk's captured identifiers and starts the server after this file's
     * describes are evaluated, so a path or an account read here would be the empty string.
     */
    interface PagedRead {
      readonly label: string;
      readonly path: () => string;
      readonly options: () => RequestOptions;
      readonly answered: (response: TestResponse) => AnsweredPage;
      /**
       * Whether the read's own query schema bounds `page` above at `PAGE_NUMBER_MAX`. Only the
       * listing search does not: its schema declares the lower bound alone, and its route refuses a
       * page whose offset the store cannot address — that row's own refusal, asserted where that
       * row's statuses are — so the search is left out of the bound probe and kept in the
       * largest-page probe below.
       */
      readonly boundedAbove?: boolean;
    }

    /** The three ledger reads, which are the operator's and answer one body shape. */
    const ledgerPaths: readonly string[] = [
      "/ledger/marketplace",
      "/ledger/gate-fees",
      "/ledger/founder-allocation",
    ];

    const reads: readonly PagedRead[] = [
      {
        label: "the listing search",
        path: () => "/listings",
        options: () => ({}),
        // Its own query schema bounds `page` at the lower end only: the upper end is the route's
        // judgement about the offset it binds, asserted with the rest of this row's statuses.
        boundedAbove: false,
        answered: (response) => {
          const page = response.json<ListingSearchResult>();

          return { page: page.page, rows: page.items.length, statedTotal: page.total };
        },
      },
      {
        label: "the listing detail's version history",
        path: () => `/listings/${captured(walk.seededListingId, "the seeded listing")}`,
        options: () => ({}),
        answered: (response) => {
          const detail = response.json<ListingDetail>();

          // This read states the size of the history in `version_total` and no page of its own: the
          // page it answered is not a member of its body, which is why it is the one row whose page is
          // asserted as the `null` the read itself carries.
          return { page: null, rows: detail.versions.length, statedTotal: detail.version_total };
        },
      },
      {
        label: "the challenges board",
        path: () => "/challenges",
        options: () => ({}),
        answered: (response) => {
          const board = response.json<{
            readonly items: readonly Challenge[];
            readonly total: number;
            readonly page: number;
          }>();

          return { page: board.page, rows: board.items.length, statedTotal: board.total };
        },
      },
      {
        label: "the threads board",
        path: () => "/threads",
        options: () => ({}),
        answered: (response) => {
          const board = response.json<{
            readonly items: readonly Thread[];
            readonly total: number;
            readonly page: number;
          }>();

          return { page: board.page, rows: board.items.length, statedTotal: board.total };
        },
      },
      {
        label: "the standards catalogue",
        path: () => "/standards",
        options: () => ({}),
        answered: (response) => {
          const catalogue = response.json<{
            readonly items: readonly CatalogueItem[];
            readonly page: number;
          }>();

          // The page of proposals is nested in each item, and each item states that standard's whole
          // proposal history: the page is every item's proposals together, and the size the read states
          // beside it is those histories added up.
          return {
            page: catalogue.page,
            rows: catalogue.items.reduce((rows, item) => rows + item.proposals.length, 0),
            statedTotal: catalogue.items.reduce(
              (total, item) => total + item.proposal_total,
              0,
            ),
          };
        },
      },
      {
        label: "the audit feed",
        path: () => "/audit-events",
        options: () => actingAs("operator"),
        answered: (response) => {
          const feed = response.json<{
            readonly items: readonly AuditEvent[];
            readonly total: number;
            readonly page: number;
          }>();

          return { page: feed.page, rows: feed.items.length, statedTotal: feed.total };
        },
      },
      ...ledgerPaths.map(
        (path): PagedRead => ({
          label: `the ledger at ${path}`,
          path: () => path,
          options: () => actingAs("operator"),
          answered: (response) => {
            const ledger = response.json<LedgerReadResult>();

            return {
              page: ledger.page,
              rows: ledger.entries.length,
              statedTotal: ledger.total,
            };
          },
        }),
      ),
    ];

    /**
     * The pages a read must refuse: the first page above the bound, and the two the finder reported as
     * `500 internal_error` when the bound did not exist — `2^53 + 1`, the first whole number whose
     * offset the arithmetic rounds, and a page beyond every range the arithmetic can state.
     */
    const refusedPages: readonly string[] = [
      String(PAGE_NUMBER_MAX + 1),
      "9007199254740993",
      "999999999999999999999",
    ];

    /** The reads whose own schema bounds `page` above: every read above but the listing search. */
    const boundedReads = reads.filter((read) => read.boundedAbove !== false);

    it.each(boundedReads)("refuses a page above the bound on $label, in the one envelope", async (read) => {
      for (const page of refusedPages) {
        expectRefusal(
          await server.get(read.path(), { ...read.options(), query: { page } }),
          400,
          "validation_error",
        );
      }
    });

    it.each(reads)(
      "answers the largest page the bound admits on $label with an empty page and the collection's own size",
      async (read) => {
        const first = await server.get(read.path(), { ...read.options(), query: { page: 1 } });
        const last = await server.get(read.path(), {
          ...read.options(),
          query: { page: PAGE_NUMBER_MAX },
        });

        expect(first.status).toBe(200);
        expect(last.status).toBe(200);

        const firstPage = read.answered(first);
        const lastPage = read.answered(last);

        // The page number moves and nothing else does. The answer at the bound is the empty page of the
        // same collection — the ordinary answer a page past the end earns, never a refusal — and the
        // size it states is the size the first page states, so the bound bounds the window a request
        // may ask for rather than the collection it pages. Eight of the nine reads echo the page they
        // answered; the listing detail states only its history's size, so its own shape is followed here.
        expect(lastPage.page).toBe(firstPage.page === null ? null : PAGE_NUMBER_MAX);
        expect(lastPage.rows).toBe(0);
        expect(lastPage.statedTotal).toBeGreaterThan(0);
        expect(lastPage.statedTotal).toBe(firstPage.statedTotal);
      },
    );
  });

  describe("sponsored slots", () => {
    it("answers the sponsored collection with no request header, every item labelled", async () => {
      const response = await server.get("/sponsored-slots");

      expect(response.status).toBe(200);

      const { items } = response.json<{ readonly items: readonly SponsoredSlotListItem[] }>();

      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        // The marker as its own assertion rather than a truthiness test: a renderer that took this
        // collection for organic content is the defect the marker exists to stop.
        expect(typeof item.sponsored).toBe("boolean");
        expect(item.sponsored).toBe(true);
        expect(item.sponsor_label.length).toBeGreaterThan(0);
        expect(Number.isInteger(item.fee_minor_units)).toBe(true);
      }

      // The collection is a block of its own: no sponsored item appears among the organic results the
      // search answers with. The fuller experiment — that sponsorship and fee data cannot change a
      // report, a badge or the organic order — belongs to the trust-separation suite.
      const organic = (await server.get("/listings")).json<ListingSearchResult>();
      const organicIds = new Set(organic.items.map((summary) => summary.id));

      for (const item of items) {
        expect(organicIds.has(item.id)).toBe(false);
      }
    });
  });

  describe("unregistered methods and unmatched paths", () => {
    it("answers an unregistered method on a registered path exactly as an unmatched path", async () => {
      // Fastify 4 has no method-not-allowed branch: an unregistered method on a registered path and a
      // path no route registers both reach the not-found handler, so both answer the one JSON `404`
      // envelope and a `405` is never expected and never asserted. The immutability suite rests on
      // that equivalence, and this is where it is observable.
      //
      // Every attempt carries a resolvable account, so a `401` could never be mistaken for the proof
      // this case means to be.
      const listingId = captured(walk.createdListingId, "the created listing");
      const reportId = captured(walk.reportId, "the written report");

      const attempts: readonly (readonly [string, string])[] = [
        ["PUT", `/listings/${listingId}`],
        ["PATCH", `/listings/${listingId}`],
        ["DELETE", `/listings/${listingId}`],
        ["PUT", `/evaluations/${reportId}`],
        // A path under the versioned prefix that no group registers. The harness prepends the
        // prefix's one declaration, so composing it here would be the second spelling of it.
        ["GET", "/route-walk-no-group-registers-this-path"],
      ];

      for (const [method, path] of attempts) {
        expectRefusal(await server.request(method, path, actingAs("operator")), 404, "not_found");
      }
    });
  });

  describe("write throttling", () => {
    /**
     * The one server of this repository started with the contract's own write bound driven to its
     * smallest value: the write bound is measured per route per client, and the walk's shared server
     * runs it raised so that no documented status is displaced by a throttle. This server is the
     * counter-example that proves the bound is real.
     */
    let throttled: TestServer;

    beforeAll(async () => {
      throttled = await startTestServer({
        writeRateLimit: { max: THROTTLED_WRITE_LIMIT_MAX, timeWindow: WRITE_RATE_LIMIT_WINDOW },
      });
    });

    afterAll(async () => {
      await throttled.close();
    });

    it("answers the second write inside the window with 429, a Retry-After header and the one envelope", async () => {
      const asBuyer: RequestOptions = { account: throttled.accountForRole("buyer") };

      const first = await throttled.post("/threads", { title: "A write inside the bound." }, asBuyer);

      // The first write inside the window is an ordinary success, so the refusal below is the bound
      // rather than anything about the request.
      expect(first.status).toBe(201);

      const second = await throttled.post(
        "/threads",
        { title: "A second write inside the same window." },
        asBuyer,
      );

      expectRefusal(second, 429, "rate_limited");

      // The header the contract states, in whole seconds: the plugin sets it before the refusal is
      // answered, and the failure body is the same envelope as every other refusal.
      const retryAfter = second.headers.get("retry-after");

      expect(retryAfter).not.toBeNull();
      expect(Number.isInteger(Number(retryAfter))).toBe(true);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    });

    it("leaves the walk's own server unthrottled", async () => {
      // The low bound belongs to the server above and to nothing else: in the same run, the walk's
      // shared server answers the same write with the documented `201`, which is what makes the two
      // servers' bounds separate rather than one leaking into the other.
      const response = await server.post(
        "/threads",
        { title: "A write from the walk's own server." },
        actingAs("buyer"),
      );

      expect(response.status).toBe(201);
    });
  });
});
