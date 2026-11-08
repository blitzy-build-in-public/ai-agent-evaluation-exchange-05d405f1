/**
 * The writer of the demonstration database: the fictional rows of `./seed-data` into the migration
 * schema, the standard version they are scored against, and one report with its gate-evaluation fee
 * per seeded fixture candidate.
 *
 * **One parameter, and no path of its own.** The `better-sqlite3` handle belongs to the caller
 * (ports and adapters): this module opens no connection, resolves no path, sets no pragma and reads
 * no environment variable. The fictional commerce assumptions arrive through `../config`, which is
 * the workspace's only reader of the environment, so the fee a seeded report is charged is the same
 * resolved default the running API would charge.
 *
 * **All-or-nothing.** The whole seed runs inside one transaction. better-sqlite3 nests a transaction
 * opened while one is already open as a `SAVEPOINT`, so the domain writers that open one of their
 * own — the standard registration, the report writer and the ledger writer — roll back with this
 * one. That is why a failure anywhere leaves the database exactly as it was and why there is no
 * compensating cleanup to get wrong.
 *
 * **It runs once.** A database that already holds rows is refused before anything is written, rather
 * than made idempotent or emptied: this seed's identifiers are fixed, so a second run over one
 * database could only collide with, or silently duplicate, what the first run wrote.
 *
 * **Insert only.** Every statement here is a plain `INSERT`. Nothing updates a row, nothing deletes
 * one, and no replace-style conflict resolution is used, because SQLite resolves an `INSERT OR
 * REPLACE` collision by deleting the row it collided with — a delete that fires none of the
 * `RAISE(ABORT)` triggers `packages/shared/migrations/0010_append_only_triggers.sql` puts on the nine
 * append-only tables. A seeded row that has become inconvenient is corrected in `./seed-data` and
 * re-seeded into a fresh database, never rewritten in place.
 *
 * **Every number is a domain call's or SQLite's.** A matched count, a critical-failure count, an
 * outcome, a report label and a fee are all derived by the module that owns the rule: this file
 * compares no count to a threshold and re-derives no pass rule. The row counts it returns are read
 * back with `COUNT(*)`, so the summary states what the database holds rather than what this module
 * believes it wrote.
 *
 * **Nothing is executed.** A candidate is declarative data compared as canonical JSON by
 * `@adem/sgi-core`; there is no `eval`, no dynamic import of submitted content and no sandbox on this
 * path. Nothing here reads a clock, a locale, a timezone or a random source either — the report
 * identifier and instant are generated inside the report writer and lie outside the payload two runs
 * compare, which is what lets the same submission score identically on every machine.
 *
 * `apps/api/src/seed/run-seed.ts` is the `npm run seed` entry that opens a file database and calls
 * {@link seedDatabase}; `apps/api/test/integration/` calls it against its own in-memory connection,
 * which is why no integration case needs hand-made data.
 */

import type { Database } from "better-sqlite3";

import { recordGateFeeCharge } from "@adem/commerce-sim";
import {
  SGI_SO_1_0_0,
  buildReport,
  deriveReportLabel,
  findLatestReportId,
  getStandardCaseSet,
  getStandardVersion,
  insertReport,
  registerStandardVersion,
  scoreSubmission,
} from "@adem/sgi-core";
import type { ScoredSubmission } from "@adem/sgi-core";

import { DATABASE_PATH_ENV_VAR, resolveConfig } from "../config";
import type { CommerceConfig } from "../config";
import {
  SEED_ACCOUNTS,
  SEED_CANDIDATES,
  SEED_CATEGORIES,
  SEED_CHALLENGES,
  SEED_CHALLENGE_RESPONSES,
  SEED_LISTING_CLAIMS,
  SEED_LISTINGS,
  SEED_LISTING_VERSIONS,
  SEED_SPONSORED_SLOTS,
  SEED_STANDARD,
  SEED_THREADS,
  SEED_THREAD_POSTS,
} from "./seed-data";
import type { SeedCandidateDescriptor } from "./seed-data";

/** The tables this seed writes, in dependency order. */
export type SeededTable =
  | "accounts"
  | "categories"
  | "listings"
  | "listing_versions"
  | "listing_claims"
  | "threads"
  | "thread_posts"
  | "challenges"
  | "challenge_responses"
  | "standards"
  | "standard_versions"
  | "sponsored_slots"
  | "evaluation_reports"
  | "report_case_results"
  | "ledger_entries";

/** One seeded report, in the fixed order alpha, beta, gamma. */
export interface SeedReportSummary {
  /** The candidate the report was derived from: `seed-alpha`, `seed-beta` or `seed-gamma`. */
  readonly candidateId: string;

  /** The listing version the report measures, whose row carries `is_fixture_candidate = true`. */
  readonly candidateVersionId: string;

  /** The appended report's identifier, which `GET /evaluations/{id}` answers for. */
  readonly reportId: string;

  /** The outcome the domain scorer derived: `PASS` or `FAIL`. */
  readonly outcome: ScoredSubmission["outcome"];
}

/**
 * What the seed did: how many rows each table it writes holds, and the three reports it derived.
 *
 * The counts are read back from the database rather than counted in JavaScript, so a summary a
 * caller logs or asserts is evidence about the seeded database rather than a restatement of the
 * rows this module meant to write.
 */
export interface SeedSummary {
  /** One `COUNT(*)` per seeded table, read inside the seeding transaction. */
  readonly counts: Readonly<Record<SeededTable, number>>;

  /** The three reports, in the fixed order alpha, beta, gamma. */
  readonly reports: readonly SeedReportSummary[];
}

/**
 * The fixture case set the domain hands the evaluator, taken from the loader this module calls
 * rather than restated: the fixture package is deliberately unimportable from this workspace, and
 * `@adem/sgi-core`'s loader is the only path to a case set, so the shape of a case is derived from
 * that loader's own signature and cannot drift from it here.
 */
type DomainCaseSet = ReturnType<typeof getStandardCaseSet>;

/** One fixture case of that set: the case the recorded output is submitted for. */
type DomainFixtureCase = DomainCaseSet["cases"][number];

/** The JSON value one fixture case's output carries, expected and recorded alike. */
type CaseOutput = DomainFixtureCase["expected_output"];

/**
 * Seeds the demonstration database: the fictional accounts, categories, listings, versions, claims,
 * discussion rows, sponsored slots and one standard version, followed by the three reports the
 * fixture candidates score to and the gate-evaluation fee each of those reports is charged.
 *
 * The seeding is one transaction, so a refusal or a database error anywhere leaves the database as
 * it was. The function is called once per database: it never truncates, never deletes and never
 * replaces a row, and it takes no path, no clock and no configuration argument — the fictional
 * commerce assumptions come from `../config`, the only reader of the environment in this workspace.
 *
 * @param database - The caller's `better-sqlite3` handle, on which the migrations have been applied
 *   and whose connection enforces foreign keys. It is used as given, and never closed here.
 * @returns A {@link SeedSummary}: one row count per seeded table, read with `COUNT(*)`, and the three
 *   seeded reports in the fixed order alpha, beta, gamma.
 * @throws {Error} When the database already contains data, naming it and the variable that selects
 *   an empty one; when the registered standard version cannot be read back, naming the version; when
 *   a row count cannot be read, naming the table; when a fixture candidate's override is not JSON
 *   data, naming the candidate and the case. Every one of these leaves the database unchanged.
 * @throws Whatever a domain writer raises — a schema constraint, or an append-only trigger — which
 *   likewise rolls the whole seed back rather than leaving a partially written database behind.
 */
export function seedDatabase(database: Database): SeedSummary {
  const commerce = resolveConfig().commerce;

  // One transaction around every write below, opened once: the domain writers that open a
  // transaction of their own become SAVEPOINTs inside it, so they roll back with this one.
  const seed = database.transaction((): SeedSummary => {
    refusePopulatedDatabase(database);

    // Foreign-key dependency order: a row is written after everything it references. The connection
    // the caller opened enforces foreign keys, so this order is what the schema requires rather than
    // a preference of this file.
    insertAccounts(database);
    insertCategories(database);
    insertListings(database);
    insertListingVersions(database);
    insertListingClaims(database);
    insertThreads(database);
    insertThreadPosts(database);
    insertChallenges(database);
    insertChallengeResponses(database);

    // The catalogue row first: the version's registration resolves its parent standard by the
    // definition's code, so a registration with no catalogue row would write one of its own.
    insertStandard(database);
    // The versioned criteria are the domain's data, written through the domain's only writer rather
    // than by a hand-written insert: a row this file built itself could state criteria the evaluator
    // does not read.
    registerStandardVersion(database, SGI_SO_1_0_0);

    insertSponsoredSlots(database);

    // The reports are derived before the counts are read, so the summary states the rows the seed's
    // own evaluation path wrote as well as the fiction it inserted.
    const reports = deriveSeedReports(database, commerce);

    return {
      counts: countSeededRows(database),
      reports,
    };
  });

  return seed();
}

/**
 * Refuses a database that already holds seeded rows, as the first statement inside the transaction so
 * that a second run writes nothing at all.
 *
 * One read decides: a single `accounts` row is the presence this seed's fixed identifiers would
 * collide with. The refusal names the database — `database.name` is the file path, or the in-memory
 * name the integration harness opens — and the variable that selects another one, because the honest
 * remedy is a fresh database path rather than an emptied one. The seed is deliberately not
 * idempotent: a second run over seeded data would either collide on an identifier or append a second
 * copy of rows the product expects once.
 */
function refusePopulatedDatabase(database: Database): void {
  const present = database
    .prepare<[], { readonly present: number }>("SELECT 1 AS present FROM accounts LIMIT 1")
    .get();

  if (present !== undefined) {
    throw new Error(
      `the database at ${database.name} already contains data, and this seed runs once against a fresh database path: point ${DATABASE_PATH_ENV_VAR} at an empty one, or remove the file.`,
    );
  }
}

/** Appends the six synthetic demo accounts the `X-Demo-Account` header resolves to. */
function insertAccounts(database: Database): void {
  const insert = database.prepare<[string, string, string, string]>(
    "INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)",
  );

  for (const account of SEED_ACCOUNTS) {
    insert.run(account.id, account.handle, account.role, account.display_label);
  }
}

/** Appends the four listing categories a listing filter draws on. */
function insertCategories(database: Database): void {
  const insert = database.prepare<[string, string, string]>(
    "INSERT INTO categories (id, slug, name) VALUES (?, ?, ?)",
  );

  for (const category of SEED_CATEGORIES) {
    insert.run(category.id, category.slug, category.name);
  }
}

/** Appends the twelve listings, each in a seeded category and owned by the seeded developer. */
function insertListings(database: Database): void {
  const insert = database.prepare<
    [string, string, string, string, string, string, string, string, string, string, string]
  >(
    `INSERT INTO listings
       (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const listing of SEED_LISTINGS) {
    insert.run(
      listing.id,
      listing.developer_account_id,
      listing.slug,
      listing.title,
      listing.summary,
      listing.category_id,
      listing.license_code,
      listing.pricing_model,
      listing.status,
      listing.created_at,
      listing.updated_at,
    );
  }
}

/**
 * Appends the fourteen version rows, three of which are the fixture candidates.
 *
 * `is_fixture_candidate` is written as the integer the column holds: better-sqlite3 refuses a
 * JavaScript boolean binding, and the migration's `CHECK (is_fixture_candidate IN (0, 1))` admits
 * the two values `? 1 : 0` produces. The flag is the only stored input to a report's label, so a
 * version a developer publishes later leaves the column at its default 0 and scores
 * `VERIFIED-IN-DEMO` while these three score `SAMPLE`.
 */
function insertListingVersions(database: Database): void {
  const insert = database.prepare<[string, string, string, string, number, string]>(
    `INSERT INTO listing_versions
       (id, listing_id, version_string, notes, is_fixture_candidate, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const version of SEED_LISTING_VERSIONS) {
    insert.run(
      version.id,
      version.listing_id,
      version.version_string,
      version.notes,
      version.is_fixture_candidate ? 1 : 0,
      version.created_at,
    );
  }
}

/** Appends the claim and the stated limitation of every seeded version, one per version. */
function insertListingClaims(database: Database): void {
  const insert = database.prepare<[string, string, string, string, string, string, string]>(
    `INSERT INTO listing_claims
       (id, listing_version_id, claim, limitation, evidence_summary, license_code, pricing_model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const claim of SEED_LISTING_CLAIMS) {
    insert.run(
      claim.id,
      claim.listing_version_id,
      claim.claim,
      claim.limitation,
      claim.evidence_summary,
      claim.license_code,
      claim.pricing_model,
    );
  }
}

/** Appends the two discussion threads. */
function insertThreads(database: Database): void {
  const insert = database.prepare<[string, string, string, string]>(
    "INSERT INTO threads (id, title, author_account_id, created_at) VALUES (?, ?, ?, ?)",
  );

  for (const thread of SEED_THREADS) {
    insert.run(thread.id, thread.title, thread.author_account_id, thread.created_at);
  }
}

/** Appends the three thread replies, in the order the seed states them. */
function insertThreadPosts(database: Database): void {
  const insert = database.prepare<[string, string, string, string, string]>(
    `INSERT INTO thread_posts (id, thread_id, author_account_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const post of SEED_THREAD_POSTS) {
    insert.run(post.id, post.thread_id, post.author_account_id, post.body, post.created_at);
  }
}

/** Appends the two challenges: the one nobody answered and the one the developer answered. */
function insertChallenges(database: Database): void {
  const insert = database.prepare<[string, string, string, string, string, string]>(
    `INSERT INTO challenges (id, listing_id, buyer_account_id, question, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const challenge of SEED_CHALLENGES) {
    insert.run(
      challenge.id,
      challenge.listing_id,
      challenge.buyer_account_id,
      challenge.question,
      challenge.status,
      challenge.created_at,
    );
  }
}

/** Appends the single challenge answer, which the `responded` challenge beside it already states. */
function insertChallengeResponses(database: Database): void {
  const insert = database.prepare<[string, string, string, string, string]>(
    `INSERT INTO challenge_responses (id, challenge_id, account_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const response of SEED_CHALLENGE_RESPONSES) {
    insert.run(
      response.id,
      response.challenge_id,
      response.account_id,
      response.body,
      response.created_at,
    );
  }
}

/**
 * Appends the one catalogue row of the standard the community governs.
 *
 * Only the catalogue row: the versioned criteria beneath it are written by the registration that
 * follows, so the pass rule has one writer and one authority rather than a hand-built row beside it.
 */
function insertStandard(database: Database): void {
  database
    .prepare<[string, string, string, string]>(
      "INSERT INTO standards (id, code, title, summary) VALUES (?, ?, ?, ?)",
    )
    .run(
      SEED_STANDARD.id,
      SEED_STANDARD.code,
      SEED_STANDARD.title,
      SEED_STANDARD.summary,
    );
}

/** Appends the two sponsored slots of the limited advertising demonstration. */
function insertSponsoredSlots(database: Database): void {
  const insert = database.prepare<[string, string, string, number, string]>(
    `INSERT INTO sponsored_slots (id, sponsor_label, placement_key, fee_minor_units, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const slot of SEED_SPONSORED_SLOTS) {
    insert.run(
      slot.id,
      slot.sponsor_label,
      slot.placement_key,
      slot.fee_minor_units,
      slot.created_at,
    );
  }
}

/**
 * Scores each seeded fixture candidate and writes its report, followed by the gate-evaluation fee
 * that report is charged.
 *
 * The criteria are read back **from the stored row**, never from the in-memory definition that was
 * just registered: `getStandardVersion` returns the version's parsed `definition_json` assembled
 * from the row's own columns, so the numbers the evaluator applies are the numbers the database
 * holds. The case set arrives through `getStandardCaseSet`, which is the only path from a version
 * to a fixture set, and the recorded outputs are built from that case set's own expected outputs
 * with each descriptor's deltas applied on top.
 *
 * The order is the order `SEED_CANDIDATES` states — alpha, beta, gamma — because a report's
 * `prior_report_id` is derived from the reports already written for a candidate version, so the
 * order decides which report a first retest would link to.
 *
 * Two values are never taken from a caller. The label comes from `deriveReportLabel(true, outcome)`,
 * `true` for every candidate here because all three rows carry `is_fixture_candidate = 1`; and the
 * retest link comes from `findLatestReportId`, which answers `null` on a fresh database. Both rules
 * belong to the domain, and neither is recomputed in this file.
 */
function deriveSeedReports(
  database: Database,
  commerce: CommerceConfig,
): readonly SeedReportSummary[] {
  const standard = getStandardVersion(database, SEED_STANDARD.code, SGI_SO_1_0_0.versionLabel);

  if (standard === null) {
    throw new Error(
      `the standard version "${SGI_SO_1_0_0.versionLabel}" could not be read back after its registration, so no seeded candidate can be scored against it.`,
    );
  }

  const caseSet = getStandardCaseSet(database, standard.definition.versionLabel);
  const summaries: SeedReportSummary[] = [];

  for (const descriptor of SEED_CANDIDATES) {
    const scored = scoreSubmission(standard.definition, caseSet, {
      candidate_id: descriptor.candidateId,
      candidate_version_id: descriptor.candidateVersionId,
      standard_version_id: standard.definition.versionLabel,
      recorded_outputs: caseSet.cases.map((fixtureCase) =>
        recordedOutputFor(descriptor, fixtureCase),
      ),
    });

    const report = buildReport(scored, {
      candidateVersionId: descriptor.candidateVersionId,
      standardVersionId: standard.definition.versionLabel,
      label: deriveReportLabel(true, scored.outcome),
      priorReportId: findLatestReportId(
        database,
        descriptor.candidateVersionId,
        standard.definition.versionLabel,
      ),
    });

    insertReport(database, report);

    // Once per completed report, a PASS and a FAIL alike: the fee is charged for the evaluation, not
    // for its result, and it is journalled in the gate-evaluation-fee ledger only. A configured fee of
    // zero is the configuration stating that the fee does not apply, and the writer appends nothing
    // for it, so this call needs no branch of its own.
    recordGateFeeCharge(database, { reportId: report.reportId, config: commerce });

    summaries.push({
      candidateId: descriptor.candidateId,
      candidateVersionId: descriptor.candidateVersionId,
      reportId: report.reportId,
      outcome: scored.outcome,
    });
  }

  return Object.freeze(summaries);
}

/**
 * One recorded output for one fixture case: the descriptor's override where it states one, and the
 * case set's own expected output otherwise.
 *
 * The override map is typed as the output a *submission* carries — `unknown`, because a submission
 * arrives as data nothing has validated yet — so a value read out of it is narrowed to the JSON data
 * the comparison reads before it reaches the scorer. A descriptor holding anything else is refused
 * here, naming the candidate and the case, rather than compared as a third kind of value: the
 * descriptor is hand-edited data, and the refusal is what keeps a broken delta from scoring as a
 * silent failure of that case.
 */
function recordedOutputFor(
  descriptor: SeedCandidateDescriptor,
  fixtureCase: DomainFixtureCase,
): { readonly case_id: string; readonly output: CaseOutput } {
  const override = descriptor.outputOverrides[fixtureCase.id];

  if (override === undefined) {
    return { case_id: fixtureCase.id, output: fixtureCase.expected_output };
  }

  if (!isCaseOutput(override)) {
    throw new Error(
      `the fixture candidate "${descriptor.candidateId}" records an override for case "${fixtureCase.id}" that is not a JSON value, so it could be compared as neither a match nor a failure.`,
    );
  }

  return { case_id: fixtureCase.id, output: override };
}

/**
 * Whether a value is the JSON data a fixture case's output is.
 *
 * The walk is recursive because a case's output is arbitrarily nested, and `undefined` inside an
 * array is refused by it while a missing member of an object is simply absent — the distinction the
 * canonical comparison turns on. The type it narrows to is the one `getStandardCaseSet` publishes,
 * derived from that signature rather than declared again here, so a fixture output type that changed
 * would change this narrowing with it.
 */
function isCaseOutput(value: unknown): value is CaseOutput {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((member) => isCaseOutput(member));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((member) => isCaseOutput(member));
  }

  return false;
}

/**
 * One row count per seeded table, read inside the transaction that wrote them.
 *
 * The keys are written in the order {@link SeededTable} lists the tables, which is also the order
 * they were written in, so a reader can walk the summary against the seed itself.
 */
function countSeededRows(database: Database): Readonly<Record<SeededTable, number>> {
  return Object.freeze({
    accounts: countRows(database, "accounts"),
    categories: countRows(database, "categories"),
    listings: countRows(database, "listings"),
    listing_versions: countRows(database, "listing_versions"),
    listing_claims: countRows(database, "listing_claims"),
    threads: countRows(database, "threads"),
    thread_posts: countRows(database, "thread_posts"),
    challenges: countRows(database, "challenges"),
    challenge_responses: countRows(database, "challenge_responses"),
    standards: countRows(database, "standards"),
    standard_versions: countRows(database, "standard_versions"),
    sponsored_slots: countRows(database, "sponsored_slots"),
    evaluation_reports: countRows(database, "evaluation_reports"),
    report_case_results: countRows(database, "report_case_results"),
    ledger_entries: countRows(database, "ledger_entries"),
  });
}

/**
 * How many rows one seeded table holds.
 *
 * The table name is interpolated because a table cannot be bound as a parameter. Every name this
 * function can be called with is one of {@link SeededTable}'s, which this module's own literal list
 * above enumerates, so no caller-supplied text can reach the statement.
 *
 * `COUNT(*)` always answers with one row, so a missing one is a database this module cannot read
 * rather than an empty table; it is refused rather than reported as a count of nothing.
 */
function countRows(database: Database, table: SeededTable): number {
  const row = database
    .prepare<[], { readonly total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)
    .get();

  if (row === undefined) {
    throw new Error(
      `the seed could not read a row count for the table "${table}", so it cannot state what it wrote.`,
    );
  }

  return row.total;
}
