/**
 * Integration proof for the contract of `apps/api/src/seed/seed-data.ts`: the rows the seed publishes
 * and the invariants the demonstration database depends on.
 *
 * **No database is opened here, and that is exact rather than convenient.** The seed's insert path
 * `seedDatabase` is a sibling deliverable of this same workspace that is not written yet, so what can
 * be asserted today is the exported data itself: the counts per table, the closed vocabularies every
 * column's `CHECK` requires, the fourteen versions with exactly three fixture candidates, the one
 * claim per version, the standard and its case set, the sponsored slots, the three candidate
 * descriptors, and the absence of any contact detail in every string the module publishes.
 *
 * Two committed documents of `packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/` are read from disk and
 * used as the check on the seed's own data: the twenty-case set with its five critical cases, and the
 * three recorded outcomes. The seed's descriptor carries deltas against that case set rather than a
 * copy of it, so the two are read together — and the pass rule the seed's three candidates must
 * produce is applied here to the recorded counts rather than restated as a conclusion.
 *
 * The versioned threshold row those candidates are scored against is **not** in this module:
 * `seedDatabase` writes it through `@adem/sgi-core`'s standard registration, and the four numbers that
 * row carries belong to that standard's own suite. What this file proves is the seed's half — that
 * its data produces exactly the three outcomes the plan fixes for `seed-alpha`, `seed-beta` and
 * `seed-gamma`, each for the documented reason.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCOUNT_ROLES, LISTING_STATUSES, PRICING_MODELS, SPONSORED_PLACEMENT_KEYS } from "@adem/shared";

import * as seedData from "../../src/seed/seed-data";
import {
  SEED_ACCOUNTS,
  SEED_ALPHA_VERSION_ID,
  SEED_BETA_VERSION_ID,
  SEED_CANDIDATES,
  SEED_CATEGORIES,
  SEED_CATEGORY_DEPOT_ROUTING_ID,
  SEED_CATEGORY_NOTIFICATION_DRAFTING_ID,
  SEED_CATEGORY_ORDER_INTAKE_ID,
  SEED_CATEGORY_RECORD_KEEPING_ID,
  SEED_CHALLENGES,
  SEED_CHALLENGE_RESPONSES,
  SEED_GAMMA_VERSION_ID,
  SEED_LISTING_CLAIMS,
  SEED_LISTINGS,
  SEED_LISTING_VERSIONS,
  SEED_SPONSORED_SLOTS,
  SEED_STANDARD,
  SEED_THREAD_POSTS,
  SEED_THREADS,
} from "../../src/seed/seed-data";

/**
 * The ListingCategory extension seam's own slug pattern, `^[a-z][a-z0-9-]{1,31}$`, declared here
 * because a seeded category has to be a value a community extension could equally have registered
 * through that seam — and because `packages/sgi-core` is reachable only through its public entry,
 * which this tier does not import.
 */
const CATEGORY_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * The id shape `apps/api/src/seed/seed-data.ts` documents for every row it publishes: a readable
 * lowercase prefix that names the row's kind and numbers it — four letters and the four digits of
 * the counter — followed by the four hexadecimal groups that complete a UUID.
 *
 * The rule it checks is the one this product holds for identifiers (AAP §0.12.2: identifiers are
 * UUID strings), stated by the seed's own doc comment, so a seeded id is checked as the shape it
 * takes rather than as a second copy of any one value.
 */
const SEEDED_ID_PATTERN = /^[a-z]{4}[0-9]{4}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * The longest run of digits a seeded id holds: the four of the prefix counter above. The seed's doc
 * comment states the bound and its content check greps for it, because a longer run is what
 * `scripts/scan-exclusions.ts` could read as a telephone-number pattern.
 */
const SEEDED_ID_MAX_DIGIT_RUN = 4;

/**
 * The provisional pass rule of `SGI-SO-1.0.0`: at least eighteen of the twenty cases match and no
 * critical case fails.
 *
 * The versioned row that carries these two numbers is written by `seedDatabase` through
 * `@adem/sgi-core`'s standard registration rather than by this module, so they are stated here as the
 * rule the seed's data is checked against, and the row itself is asserted by that package's suite.
 */
const PASS_THRESHOLD_MATCHES = 18;
const CRITICAL_FAILURES_ALLOWED = 0;

/** The rubric reference a report cites, which resolves through the standard code this module seeds. */
const RUBRIC_REFERENCE = "SGI-SO-1.0.0#rubric";

/**
 * A machine-written value and never a contact detail: a UUID, and the ISO-8601 UTC date or instant
 * the seed writes as a fixed literal.
 *
 * Each is removed before a value is tested for a telephone shape, which is the same refusal the
 * repository's own exclusion scan makes when it declines a candidate that sits inside a UUID, a date
 * or a timestamp — an identifier's digit run and a timestamp's groups are not a number anyone can
 * call.
 */
const UUID_SHAPE_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ISO_DATE_TIME_SOURCE =
  "[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z)?";
const MACHINE_WRITTEN_VALUE = new RegExp(
  `${UUID_SHAPE_SOURCE}|${ISO_DATE_TIME_SOURCE}`,
  "g",
);

/**
 * A span of digits written as one number: a leading digit, digits and the separators a written number
 * carries, and a trailing digit.
 */
const NUMBER_SPAN_PATTERN = /[0-9][0-9 .()+-]*[0-9]/g;

/** A bare run this long is a number, not a count: the shape of a leaked telephone number. */
const MIN_BARE_DIGIT_RUN = 9;

/** A grouped number this long, carried by this many separators, is written as a number as well. */
const MIN_GROUPED_DIGITS = 7;
const MIN_GROUP_SEPARATORS = 2;

/**
 * The address shape, and the two schemes a contact detail would be written with.
 *
 * The separator is assembled rather than written literally, so this file carries no address-shaped
 * text of its own while still being able to recognise one: the scan that reads these files treats a
 * literal address as a finding wherever it appears, in a test as much as in source.
 */
const ADDRESS_SEPARATOR = String.fromCharCode(64);
const ADDRESS_LIKE_PATTERN = new RegExp(
  `[A-Za-z0-9._%+-]+${ADDRESS_SEPARATOR}[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+`,
);
const CONTACT_SCHEME_PATTERN = /(?:mailto|tel):/i;

/** One case of the fixture set, as `cases.json` commits it. */
interface FixtureCase {
  readonly id: string;
  readonly severity: string;
  readonly expected_output?: unknown;
}

/** The fixture case set: the twenty cases and their two counts. */
interface FixtureCaseSet {
  readonly standard_version_id: string;
  readonly total_cases: number;
  readonly critical_cases: number;
  readonly cases: readonly FixtureCase[];
}

/** One candidate's recorded outcome, as `expected-outcomes.json` commits it. */
interface FixtureCandidateOutcome {
  readonly candidate_id: string;
  readonly candidate_version_id: string;
  readonly outcome: string;
  readonly matched_count: number;
  readonly total_count: number;
  readonly critical_failures: number;
  readonly failing_case_ids: readonly string[];
}

/** The three recorded outcomes. */
interface FixtureExpectedOutcomes {
  readonly standard_version_id: string;
  readonly candidates: readonly FixtureCandidateOutcome[];
}

/**
 * The fixture pack's directory, resolved from this module's own location rather than from the working
 * directory: `apps/api/test/integration/` → `apps/api/` → `apps/` → the repository root.
 */
const fixturesDir = fileURLToPath(
  new URL("../../../../packages/sgi-fixtures/fixtures/SGI-SO-1.0.0/", import.meta.url),
);

/** One committed fixture document, parsed. */
function readFixtureDocument<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

const caseSet = readFixtureDocument<FixtureCaseSet>("cases.json");
const expectedOutcomes = readFixtureDocument<FixtureExpectedOutcomes>("expected-outcomes.json");

/** The severity of a fixture case, failing the case rather than the assertion for an unknown id. */
function severityOf(caseId: string): string {
  const fixtureCase = caseSet.cases.find((candidate) => candidate.id === caseId);
  if (fixtureCase === undefined) {
    throw new Error(`expected the fixture case set to hold the case ${caseId}`);
  }
  return fixtureCase.severity;
}

/** The outcome the pass rule derives from a candidate's recorded counts. */
function outcomeUnderPassRule(outcome: FixtureCandidateOutcome): string {
  const passes =
    outcome.matched_count >= PASS_THRESHOLD_MATCHES &&
    outcome.critical_failures <= CRITICAL_FAILURES_ALLOWED;
  return passes ? "PASS" : "FAIL";
}

/** A string the module publishes, with the path it was reached by. */
interface WalkedString {
  readonly path: string;
  readonly value: string;
}

/** Collects every string reachable inside a value, naming the path each was reached by. */
function collectStrings(value: unknown, path: string, found: WalkedString[]): void {
  if (typeof value === "string") {
    found.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((member, index) => collectStrings(member, `${path}[${index}]`, found));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      collectStrings(member, `${path}.${key}`, found);
    }
  }
}

/** Every string the module publishes, reached through its exports. */
function publishedStrings(): readonly WalkedString[] {
  const found: WalkedString[] = [];
  for (const [key, value] of Object.entries(seedData)) {
    collectStrings(value, key, found);
  }
  return found;
}

/** Whether a value carries a telephone shape once its machine-written parts are set aside. */
function telephoneShaped(value: string): boolean {
  const remainder = value.replace(MACHINE_WRITTEN_VALUE, " ");
  for (const span of remainder.match(NUMBER_SPAN_PATTERN) ?? []) {
    const digits = span.replace(/[^0-9]/g, "").length;
    const separators = span.length - digits;
    if (separators === 0 && digits >= MIN_BARE_DIGIT_RUN) {
      return true;
    }
    if (separators >= MIN_GROUP_SEPARATORS && digits >= MIN_GROUPED_DIGITS) {
      return true;
    }
  }
  return false;
}

/** The longest run of consecutive digits a value holds, and zero when it holds none. */
function longestDigitRun(value: string): number {
  return (value.match(/[0-9]+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
}

/** The ids of the four seeded categories. */
const categoryIds = new Set(SEED_CATEGORIES.map((category) => category.id));

/** The ids of the six seeded accounts. */
const accountIds = new Set(SEED_ACCOUNTS.map((account) => account.id));

/** The ids of the seeded listings. */
const listingIds = new Set(SEED_LISTINGS.map((listing) => listing.id));

/** The ids of the seeded versions. */
const versionIds = new Set(SEED_LISTING_VERSIONS.map((version) => version.id));

describe("the rows the seed publishes", () => {
  it("holds six accounts: one per role plus a second developer and a second buyer", () => {
    expect(SEED_ACCOUNTS).toHaveLength(ACCOUNT_ROLES.length + 2);
    expect(new Set(SEED_ACCOUNTS.map((account) => account.id)).size).toBe(
      SEED_ACCOUNTS.length,
    );
    expect(new Set(SEED_ACCOUNTS.map((account) => account.handle)).size).toBe(
      SEED_ACCOUNTS.length,
    );

    for (const account of SEED_ACCOUNTS) {
      expect(ACCOUNT_ROLES).toContain(account.role);
      expect(account.display_label.trim().length).toBeGreaterThan(0);
    }

    // One row per role, and the two extras are the second developer and the second buyer: the
    // ownership refusal needs a developer that owns no listing, and the two challenge states need two
    // buyers rather than one account answering itself.
    const perRole = new Map<string, number>();
    for (const account of SEED_ACCOUNTS) {
      perRole.set(account.role, (perRole.get(account.role) ?? 0) + 1);
    }
    expect(perRole.get("developer")).toBe(2);
    expect(perRole.get("buyer")).toBe(2);
    expect(perRole.get("contributor")).toBe(1);
    expect(perRole.get("operator")).toBe(1);
  });

  it("holds the four categories, with unique slugs that satisfy the extension seam's pattern", () => {
    expect(SEED_CATEGORIES).toHaveLength(4);
    expect(categoryIds).toStrictEqual(
      new Set([
        SEED_CATEGORY_ORDER_INTAKE_ID,
        SEED_CATEGORY_DEPOT_ROUTING_ID,
        SEED_CATEGORY_RECORD_KEEPING_ID,
        SEED_CATEGORY_NOTIFICATION_DRAFTING_ID,
      ]),
    );
    expect(new Set(SEED_CATEGORIES.map((category) => category.slug)).size).toBe(
      SEED_CATEGORIES.length,
    );

    for (const category of SEED_CATEGORIES) {
      expect(category.slug).toMatch(CATEGORY_SLUG_PATTERN);
      expect(category.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("holds at least twelve listings, each in a seeded category and owned by a seeded account", () => {
    expect(SEED_LISTINGS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SEED_LISTINGS.map((listing) => listing.id)).size).toBe(SEED_LISTINGS.length);

    const listingsPerCategory = new Map<string, number>();
    for (const listing of SEED_LISTINGS) {
      expect(categoryIds).toContain(listing.category_id);
      expect(accountIds).toContain(listing.developer_account_id);
      expect(PRICING_MODELS).toContain(listing.pricing_model);
      expect(LISTING_STATUSES).toContain(listing.status);
      expect(listing.license_code.trim().length).toBeGreaterThan(0);
      expect(listing.title.trim().length).toBeGreaterThan(0);
      listingsPerCategory.set(
        listing.category_id,
        (listingsPerCategory.get(listing.category_id) ?? 0) + 1,
      );
    }

    // Every category a buyer can filter on carries something to find, which is what keeps the search
    // surface reachable from seed data alone.
    for (const category of SEED_CATEGORIES) {
      expect(listingsPerCategory.get(category.id) ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("holds fourteen versions, exactly three of them fixture candidates", () => {
    expect(SEED_LISTING_VERSIONS).toHaveLength(14);
    expect(new Set(SEED_LISTING_VERSIONS.map((version) => version.id)).size).toBe(
      SEED_LISTING_VERSIONS.length,
    );

    // The unique pair the schema declares, which is the conflict the version route answers with 409.
    const pairs = SEED_LISTING_VERSIONS.map((version) =>
      JSON.stringify([version.listing_id, version.version_string]),
    );
    expect(new Set(pairs).size).toBe(pairs.length);

    for (const version of SEED_LISTING_VERSIONS) {
      expect(listingIds).toContain(version.listing_id);
      expect(version.version_string.trim().length).toBeGreaterThan(0);
    }

    // The flag is the only stored input to a report's label: a stray `true` on another row would
    // label a developer's own submission SAMPLE, and a missing one would label a seed result
    // VERIFIED-IN-DEMO.
    const candidates = SEED_LISTING_VERSIONS.filter((version) => version.is_fixture_candidate);
    const others = SEED_LISTING_VERSIONS.filter((version) => !version.is_fixture_candidate);
    expect(candidates.map((version) => version.id)).toStrictEqual([
      SEED_ALPHA_VERSION_ID,
      SEED_BETA_VERSION_ID,
      SEED_GAMMA_VERSION_ID,
    ]);
    expect(others).toHaveLength(11);
  });

  it("claims about every seeded version and about nothing else", () => {
    expect(new Set(SEED_LISTING_CLAIMS.map((claim) => claim.id)).size).toBe(
      SEED_LISTING_CLAIMS.length,
    );
    expect(SEED_LISTING_CLAIMS).toHaveLength(SEED_LISTING_VERSIONS.length);

    for (const claim of SEED_LISTING_CLAIMS) {
      // A claim is what a version asserts about itself, so it names a version that exists — and the
      // limitation beside it is what a compare view sets against the measured evidence.
      expect(versionIds).toContain(claim.listing_version_id);
      expect(claim.claim.trim().length).toBeGreaterThan(0);
      expect(claim.limitation.trim().length).toBeGreaterThan(0);
      expect(PRICING_MODELS).toContain(claim.pricing_model);
    }
    expect(new Set(SEED_LISTING_CLAIMS.map((claim) => claim.listing_version_id)).size).toBe(
      SEED_LISTING_VERSIONS.length,
    );
  });

  it("links every seeded thread, post, challenge and response to the rows around it", () => {
    for (const thread of SEED_THREADS) {
      expect(accountIds).toContain(thread.author_account_id);
    }
    for (const post of SEED_THREAD_POSTS) {
      expect(new Set(SEED_THREADS.map((thread) => thread.id))).toContain(post.thread_id);
      expect(accountIds).toContain(post.author_account_id);
    }

    for (const challenge of SEED_CHALLENGES) {
      expect(listingIds).toContain(challenge.listing_id);
      expect(accountIds).toContain(challenge.buyer_account_id);
    }
    // Both board states are reachable without writing anything: one challenge nobody answered and one
    // the developer answered, each raised by a different buyer.
    expect(SEED_CHALLENGES.map((challenge) => challenge.status).sort()).toStrictEqual([
      "open",
      "responded",
    ]);

    for (const response of SEED_CHALLENGE_RESPONSES) {
      expect(accountIds).toContain(response.account_id);
      const answered = SEED_CHALLENGES.find((challenge) => challenge.id === response.challenge_id);
      expect(answered?.status).toBe("responded");
    }
    // The open challenge has no response row, which is what makes the two states honest rather than a
    // board claiming a question was answered twice.
    const answeredIds = new Set(SEED_CHALLENGE_RESPONSES.map((response) => response.challenge_id));
    const openChallengeIds = SEED_CHALLENGES.filter((challenge) => challenge.status === "open").map(
      (challenge) => challenge.id,
    );
    for (const openId of openChallengeIds) {
      expect(answeredIds).not.toContain(openId);
    }
  });

  it("advertises two sponsored slots, each on a known placement and with a non-negative fee", () => {
    expect(SEED_SPONSORED_SLOTS).toHaveLength(2);
    expect(new Set(SEED_SPONSORED_SLOTS.map((slot) => slot.id)).size).toBe(
      SEED_SPONSORED_SLOTS.length,
    );

    for (const slot of SEED_SPONSORED_SLOTS) {
      expect(SPONSORED_PLACEMENT_KEYS).toContain(slot.placement_key);
      expect(slot.sponsor_label.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(slot.fee_minor_units)).toBe(true);
      expect(slot.fee_minor_units).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the standard and the candidates the seed describes", () => {
  it("publishes the one standard whose case set holds twenty cases and five critical ones", () => {
    // The row's primary key is an identifier, and every identifier this product stores is a UUID
    // string (AAP §0.12.2), so it takes the shape the seed's own doc comment states for its ids: a
    // readable prefix and the four hexadecimal groups that complete a UUID, holding no digit run
    // longer than the prefix counter's four. It is deliberately not a second copy of the code below,
    // which is the identity people quote and the one the case set and the rubric reference name.
    expect(SEED_STANDARD.id.trim().length).toBeGreaterThan(0);
    expect(SEED_STANDARD.id).not.toBe(SEED_STANDARD.code);
    expect(SEED_STANDARD.id).toMatch(SEEDED_ID_PATTERN);
    expect(longestDigitRun(SEED_STANDARD.id)).toBeLessThanOrEqual(SEEDED_ID_MAX_DIGIT_RUN);
    expect(SEED_STANDARD.code).toBe("SGI-SO-1.0.0");
    expect(SEED_STANDARD.title).toBe("Structured Output Conformance");
    expect(SEED_STANDARD.summary.trim().length).toBeGreaterThan(0);

    // The case set the standard version is scored against, and the two counts it fixes: twenty cases,
    // five of them critical.
    expect(caseSet.standard_version_id).toBe(SEED_STANDARD.code);
    expect(caseSet.cases).toHaveLength(20);
    expect(caseSet.total_cases).toBe(20);
    expect(caseSet.critical_cases).toBe(5);
    expect(new Set(caseSet.cases.map((fixtureCase) => fixtureCase.id)).size).toBe(20);
    expect(caseSet.cases.filter((fixtureCase) => fixtureCase.severity === "critical")).toHaveLength(
      5,
    );

    // The rubric reference a report cites resolves through the code this row seeds, so the two cannot
    // drift apart: a standard published under another code would leave the reference pointing at a
    // section no document of that name holds.
    const rubric = /^(?<code>[^#]+)#(?<section>[a-z]+)$/.exec(RUBRIC_REFERENCE)?.groups;
    expect(rubric?.code).toBe(SEED_STANDARD.code);
    expect(rubric?.section).toBe("rubric");
  });

  it("produces the three recorded outcomes from the pass rule, each for its documented reason", () => {
    expect(expectedOutcomes.standard_version_id).toBe(SEED_STANDARD.code);
    expect(expectedOutcomes.candidates).toHaveLength(3);

    for (const descriptor of SEED_CANDIDATES) {
      const outcome = expectedOutcomes.candidates.find(
        (candidate) => candidate.candidate_version_id === descriptor.candidateVersionId,
      );
      if (outcome === undefined) {
        throw new Error(
          `expected the recorded outcomes to hold the candidate ${descriptor.candidateId}`,
        );
      }

      expect(outcome.candidate_id).toBe(descriptor.candidateId);
      expect(outcome.total_count).toBe(caseSet.total_cases);
      expect(outcomeUnderPassRule(outcome)).toBe(outcome.outcome);
      // Nothing fails that the candidate's own deltas did not touch: a case the descriptor does not
      // override is submitted with the case set's own expected output.
      for (const failingCaseId of outcome.failing_case_ids) {
        expect(Object.keys(descriptor.outputOverrides)).toContain(failingCaseId);
        expect(caseSet.cases.map((fixtureCase) => fixtureCase.id)).toContain(failingCaseId);
      }
      for (const overriddenCaseId of Object.keys(descriptor.outputOverrides)) {
        expect(caseSet.cases.map((fixtureCase) => fixtureCase.id)).toContain(overriddenCaseId);
      }
    }

    // alpha passes with every case matched; its one delta is the same four keys and values the case
    // set expects for so-017, written in a different key order, so it matches under canonical
    // comparison. The differing key order is deliberate and is never sorted: it is the probe that
    // proves the comparison is canonical rather than textual.
    const alpha = expectedOutcomes.candidates.find(
      (candidate) => candidate.candidate_version_id === SEED_ALPHA_VERSION_ID,
    );
    expect(alpha?.outcome).toBe("PASS");
    expect(alpha?.matched_count).toBe(caseSet.total_cases);
    expect(alpha?.critical_failures).toBe(0);
    expect(alpha?.failing_case_ids).toStrictEqual([]);
    const alphaDelta = SEED_CANDIDATES[0]?.outputOverrides["so-017"];
    const so017 = caseSet.cases.find((fixtureCase) => fixtureCase.id === "so-017");
    expect(alphaDelta).toBeDefined();
    expect(alphaDelta).toEqual(so017?.expected_output);

    // beta fails on the critical rule and not on the threshold: it matches enough cases, and it is the
    // one critical case it misses that fails it.
    const beta = expectedOutcomes.candidates.find(
      (candidate) => candidate.candidate_version_id === SEED_BETA_VERSION_ID,
    );
    expect(beta?.outcome).toBe("FAIL");
    expect(beta?.matched_count).toBeGreaterThanOrEqual(PASS_THRESHOLD_MATCHES);
    expect(beta?.critical_failures).toBeGreaterThan(CRITICAL_FAILURES_ALLOWED);
    expect(beta?.failing_case_ids).toStrictEqual(["so-003"]);
    expect(severityOf("so-003")).toBe("critical");

    // gamma fails on the threshold and not on the critical rule: no critical case fails, and it is
    // three standard cases it misses that fail it.
    const gamma = expectedOutcomes.candidates.find(
      (candidate) => candidate.candidate_version_id === SEED_GAMMA_VERSION_ID,
    );
    expect(gamma?.outcome).toBe("FAIL");
    expect(gamma?.matched_count).toBeLessThan(PASS_THRESHOLD_MATCHES);
    expect(gamma?.critical_failures).toBe(CRITICAL_FAILURES_ALLOWED);
    expect(gamma?.failing_case_ids).toStrictEqual(["so-014", "so-016", "so-018"]);
    for (const failingCaseId of gamma?.failing_case_ids ?? []) {
      expect(severityOf(failingCaseId)).toBe("standard");
    }
  });

  it("names exactly the three candidate versions, in the order the seed records them", () => {
    expect(SEED_CANDIDATES.map((descriptor) => descriptor.candidateVersionId)).toStrictEqual([
      SEED_ALPHA_VERSION_ID,
      SEED_BETA_VERSION_ID,
      SEED_GAMMA_VERSION_ID,
    ]);
    expect(SEED_CANDIDATES.map((descriptor) => descriptor.candidateId)).toStrictEqual([
      "seed-alpha",
      "seed-beta",
      "seed-gamma",
    ]);

    for (const descriptor of SEED_CANDIDATES) {
      // The row that carries the flag and the fixture pack's candidate id are the same version, which
      // is what lets a report resolve its label from the row the seed wrote.
      expect(descriptor.versionRowId).toBe(descriptor.candidateVersionId);
      expect(versionIds).toContain(descriptor.versionRowId);
      expect(listingIds).toContain(descriptor.listingId);
      const version = SEED_LISTING_VERSIONS.find((row) => row.id === descriptor.versionRowId);
      expect(version?.is_fixture_candidate).toBe(true);
      expect(version?.listing_id).toBe(descriptor.listingId);
    }
  });
});

describe("the strings the seed publishes", () => {
  it("publishes its values under SEED_-prefixed names, so every one of them is walked below", () => {
    const exportedNames = Object.keys(seedData);
    expect(exportedNames.length).toBeGreaterThan(0);
    for (const name of exportedNames) {
      expect(name.startsWith("SEED_")).toBe(true);
    }
  });

  it("carries no address-shaped value and no contact scheme anywhere in what it publishes", () => {
    const offenders: string[] = [];
    for (const { path, value } of publishedStrings()) {
      if (ADDRESS_LIKE_PATTERN.test(value)) {
        offenders.push(`${path} is an address-shaped value`);
      }
      if (CONTACT_SCHEME_PATTERN.test(value)) {
        offenders.push(`${path} carries a contact scheme`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it("carries no telephone-shaped value anywhere in what it publishes", () => {
    const offenders: string[] = [];
    for (const { path, value } of publishedStrings()) {
      if (telephoneShaped(value)) {
        offenders.push(`${path} is telephone-shaped`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });
});
