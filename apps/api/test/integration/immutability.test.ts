/**
 * The integration proof of ADEM's append-only guarantee: no route the product serves can change or
 * remove a row of the nine tables its historical record rests on, and a real governance decision
 * appends one event while leaving the measurement it concerns byte-identical.
 *
 * **What it evidences.**
 *
 * 1. *No route mutates an append-only table.* Every route that exposes one of the nine tables'
 *    resources is attempted with `PUT`, `PATCH` and `DELETE` — never with a `POST`, which is the one
 *    verb those routes do register — and each attempt must be answered `404` with the single error
 *    envelope `{ error: { code, message } }` and nothing else. The attempt carries the demo account
 *    whose role that route requires, because that is what makes the answer mean "no such method":
 *    an attempt with no header, or with one naming the wrong role, would earn a `401` or a `403` and
 *    prove nothing about whether the route accepts the mutation. A `405` is never expected — Fastify
 *    4 has no method-not-allowed branch, so an unregistered method on a registered path and an
 *    unregistered path are indistinguishable, which the block's own equivalence case makes
 *    observable. The table's rows are then re-read and compared with the snapshot taken before the
 *    attempts, as canonical JSON, so the comparison is over the stored data rather than over two
 *    driver objects.
 * 2. *A real change appends and never edits.* An appeal is opened against a seeded report and ruled
 *    by the operator: exactly one `governance_events` row appears, naming the ruling, the operator
 *    and the appeal, while the report, its per-case evidence and the payload the report route
 *    answers with stay byte-identical, and while the appeal's own row moves its `status` column and
 *    no other. The ruling's answer carries that appended row beside the ruled appeal, which is the
 *    trail the operator reads where the decision is shown. A second ruling is refused `409`
 *    `already_ruled` and appends nothing at all.
 * 3. *The suite's table list is the migration's.* The nine tables are read out of
 *    `packages/shared/migrations/0010_append_only_triggers.sql` at run time and asserted equal to the
 *    list the attempts are built from, so a migration that gains an append-only table, or a list
 *    here that drifts from one, fails in this file rather than going unnoticed.
 *
 * **The criterion's other half lives beside this file.** That a report carries the version it
 * measured, the criteria it was scored against, its rubric, its per-case evidence and its outcome is
 * asserted by `apps/api/test/integration/api-contract.test.ts`, for all three seeded reports and
 * against the fixture pack's own recorded expectations, so this file does not assert it a second
 * time. What this file adds to traceability is the part only a ruling can break: that the report
 * payload a buyer reads is byte-identical across a governance decision, that the appeal names the
 * report it contests, and that the appended event names both the outcome and that report.
 *
 * **The triggers are defence in depth, never the proof.** Migration `0010` raises `ABORT` from a
 * `BEFORE UPDATE` and a `BEFORE DELETE` trigger on each of the nine, and the tail of each table's
 * case records a direct attempt through the harness's own connection that meets one, comparing the
 * refusal against the message the migration itself declares. That evidence is supplementary: SQLite
 * offers no command that disables a trigger, but a connection holding write access can drop one, so
 * what holds the rule is that no route offers the mutation. The guarantee this suite establishes is
 * the route-level one — every attempt is answered `404` and every stored row is unchanged after it —
 * and a trigger is what refuses a mutation that reaches a table by some other path. No assertion
 * below makes a trigger the security boundary, and none may be read as making it one.
 *
 * **One harness, one connection, one seeded database.** The suite is built on `./test-server`: the
 * real composition root listening on an ephemeral port over one in-memory SQLite connection, with
 * the schema migrated and the synthetic seed loaded. No identifier is a literal — the listing, the
 * report, the standard and its version are resolved from the seed through the harness or the
 * database, and the proposal, the appeal and the transaction come from the responses of the writes
 * that created them — and every row is read back through that one connection, because a second
 * `new Database(":memory:")` in a suite would be a second and empty database.
 *
 * **Four of the nine tables hold no seeded row**, so the suite's own set-up performs the four legal
 * appends that give every table something to protect: a proposal, an appeal, a simulated checkout
 * and one refund of it. Each is a write the product is meant to accept, which is why the empty-table
 * comparison this suite could otherwise make — an empty list equal to an empty list — is not the one
 * it makes: every table's snapshot is asserted to hold a row before its attempts begin.
 *
 * **Nothing here is repaired.** No refusal is rolled back, restored or cleaned up and no database
 * file is written: a refused attempt leaves the row exactly as it found it, and that is the property
 * under test rather than a step of the test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalize } from "@adem/sgi-core";
import type { GovernanceEventType } from "@adem/sgi-core";
import { GOVERNANCE_EVENT_TYPES } from "@adem/sgi-core";
import { APPEAL_RULINGS } from "@adem/shared";
import type { AccountRole, Appeal, AppealRuling, Transaction } from "@adem/shared";

import { API_PREFIX, startTestServer } from "./test-server";
import type { SeedAccount, TestResponse, TestServer } from "./test-server";

/**
 * The migration that declares both triggers on all nine tables, and the directory it sits in,
 * resolved from this module's own location rather than from the working directory:
 * `apps/api/test/integration/` → `apps/api/` → `apps/` → the repository root.
 *
 * The file is read rather than restated because it is the declaration site of the fact this suite
 * asserts: which tables are append-only, and what each trigger says when it refuses a change.
 */
const APPEND_ONLY_MIGRATION_FILE = "0010_append_only_triggers.sql";

/** The directory {@link APPEND_ONLY_MIGRATION_FILE} is read from. */
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/shared/migrations/", import.meta.url),
);

/**
 * The three HTTP methods no route of this API registers, and therefore the three an append-only
 * resource is attempted with.
 *
 * `POST` is deliberately absent: it is the verb every append-only write path does register, and an
 * attempt carrying it would be testing the append rather than the impossibility of the rewrite.
 */
const MUTATING_METHODS = ["PUT", "PATCH", "DELETE"] as const;

/**
 * A prefix-relative path no route group registers.
 *
 * The harness composes a request's URL from {@link API_PREFIX} and the path it is handed, so this
 * value is deliberately written without the prefix: the equivalence case sends
 * `` `${API_PREFIX}${UNREGISTERED_PATH}` ``. It carries no query, no extension and no identifier, so
 * nothing but the absence of a route can decide its answer.
 */
const UNREGISTERED_PATH = "/no-route-group-registers-this-path";

/**
 * A prefix-relative path whose `DELETE` is unregistered while its `GET` is: the registered route the
 * equivalence case contrasts {@link UNREGISTERED_PATH} with. `/sponsored-slots` registers exactly
 * one `GET` and no other method, and its row is public, so nothing about the account a caller sends
 * can enter the comparison.
 */
const REGISTERED_PATH_WITHOUT_MUTATING_VERB = "/sponsored-slots";

/**
 * The suffix the supplementary trigger probe appends to a row's own identifier.
 *
 * It exists so the probe attempts a change that would be visible if it were allowed to stand: a
 * probe whose assignment could not alter a stored byte would leave the snapshot comparison unable to
 * report a missing trigger. The trigger refuses the statement before SQLite's own foreign-key checks
 * run, so an identifier change is refused by the trigger rather than by a reference to the row.
 */
const TRIGGER_PROBE_SUFFIX = "-rewritten-by-the-immutability-suite";

/**
 * A row of an append-only table, as the driver returns it.
 *
 * Every column of the nine tables is `TEXT`, `INTEGER` or nullable, and none is a `BLOB`, so a row
 * is a record of strings, numbers and nulls and nothing else. {@link canonicalize} accepts this
 * shape because it carries an index signature, which is what lets a whole table's rows be rendered
 * to one comparable string without a cast.
 */
type SnapshotRow = Record<string, string | number | null>;

/**
 * One route an append-only table's resources are reachable through, beside the role the contract
 * gives that route.
 */
interface RouteAttempt {
  /** The prefix-relative path, of the form the harness composes with {@link API_PREFIX}. */
  readonly path: string;

  /** The role the route requires of the account it is sent as, or `"public"` where it requires none. */
  readonly role: AccountRole | "public";
}

/** One append-only table, with every route its resources are reachable through. */
interface TableAttemptPlan {
  /** The table's name, spelled as migration `0010` spells it and as the re-read statement uses it. */
  readonly table: string;

  /** The routes to attempt a mutation on, built from the identifiers the suite's set-up resolved. */
  routes(resolved: AttemptIds): readonly RouteAttempt[];
}

/**
 * The identifiers the attempts address, every one of them resolved at run time.
 *
 * Each stands for a resource the product really holds, because the proof depends on the attempts
 * reaching routes that exist: a path built from an invented identifier would still be answered
 * `404`, but it would evidence nothing about the resources an operator, a buyer or a developer can
 * reach, and this suite would be asserting against a fiction of its own.
 */
interface AttemptIds {
  /** The `standards.id` of the seeded catalogue row, for the version path's first segment. */
  readonly standardId: string;

  /** The `standard_versions.version_label` of the published version, for that path's second. */
  readonly standardVersionLabel: string;

  /** A seeded listing's id, the owner of the fixture candidate the evaluation suite scores. */
  readonly listingId: string;

  /** A seeded report's id, which the public report read answers for. */
  readonly reportId: string;

  /** The proposal this suite submitted, reachable through the review route. */
  readonly proposalId: string;

  /** The appeal this suite opened, reachable through the ruling route, and left unruled here. */
  readonly appealId: string;

  /** The simulated transaction this suite completed, reachable through the refund route. */
  readonly transactionId: string;
}

/**
 * The nine tables of migration `0010`, each with the routes its resources are reachable through.
 *
 * The table set is the migration's, and the coverage case below asserts the two agree in both
 * directions, so this list cannot quietly shed a table or invent one. What each entry records is the
 * other half of the same fact: which route a client could hope to send a mutation to. The paths are
 * prefix-relative because the harness applies {@link API_PREFIX} once, and each route's role is the
 * one its own row of the contract fixes, so the attempt's header names an account that route accepts
 * and the `404` it earns cannot be a role refusal in disguise.
 */
const APPEND_ONLY_TABLE_ATTEMPTS: readonly TableAttemptPlan[] = Object.freeze([
  Object.freeze({
    table: "standard_versions",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: "/standards", role: "public" },
      {
        path: `/standards/${resolved.standardId}/versions/${resolved.standardVersionLabel}`,
        role: "public",
      },
    ],
  }),
  Object.freeze({
    table: "listing_versions",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: `/listings/${resolved.listingId}`, role: "public" },
      { path: `/listings/${resolved.listingId}/versions`, role: "developer" },
    ],
  }),
  Object.freeze({
    table: "evaluation_reports",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: "/evaluations", role: "developer" },
      { path: `/evaluations/${resolved.reportId}`, role: "public" },
    ],
  }),
  Object.freeze({
    table: "report_case_results",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: "/evaluations", role: "developer" },
      { path: `/evaluations/${resolved.reportId}`, role: "public" },
    ],
  }),
  Object.freeze({
    table: "governance_events",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: `/standards/proposals/${resolved.proposalId}/review`, role: "operator" },
      { path: `/appeals/${resolved.appealId}/ruling`, role: "operator" },
      { path: `/moderation/listings/${resolved.listingId}/actions`, role: "operator" },
    ],
  }),
  Object.freeze({
    table: "ledger_entries",
    routes: (): readonly RouteAttempt[] => [
      { path: "/ledger/marketplace", role: "operator" },
      { path: "/ledger/gate-fees", role: "operator" },
      { path: "/ledger/founder-allocation", role: "operator" },
    ],
  }),
  Object.freeze({
    table: "transactions",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: "/checkout-simulations", role: "buyer" },
      { path: `/transactions/${resolved.transactionId}/refunds`, role: "operator" },
    ],
  }),
  Object.freeze({
    table: "refunds",
    routes: (resolved: AttemptIds): readonly RouteAttempt[] => [
      { path: `/transactions/${resolved.transactionId}/refunds`, role: "operator" },
    ],
  }),
  Object.freeze({
    table: "audit_events",
    routes: (): readonly RouteAttempt[] => [{ path: "/audit-events", role: "operator" }],
  }),
]);


/** The two phases migration `0010` declares a trigger in, spelled as the migration spells them. */
type TriggerPhase = "BEFORE UPDATE" | "BEFORE DELETE";

/**
 * The text of migration `0010`, read from disk.
 *
 * Read on each call rather than cached in a module-level constant so that a read that fails does so
 * inside the case that needed it, naming the file, instead of during this module's own evaluation.
 */
function readTriggerMigration(): string {
  return readFileSync(join(migrationsDir, APPEND_ONLY_MIGRATION_FILE), "utf8");
}

/**
 * The message migration `0010` raises for one table and one phase, read out of the migration.
 *
 * The migration's own text is the expectation rather than a copy of it here, so the two cannot be
 * changed apart from one another. The pattern is anchored at the trigger's own `BEGIN … SELECT
 * RAISE`, so an extraction that a table has no trigger for finds nothing and the case fails with
 * that fact rather than quietly returning the next table's message.
 *
 * @throws {Error} When the migration declares no such trigger message for the table.
 */
function triggerMessageFor(phase: TriggerPhase, table: string): string {
  const pattern = new RegExp(
    `${phase} ON ${table}\\s+BEGIN\\s+SELECT RAISE\\(ABORT, '([^']+)'\\)`,
  );
  const message = pattern.exec(readTriggerMigration())?.[1];

  if (message === undefined) {
    throw new Error(
      `${APPEND_ONLY_MIGRATION_FILE} declares no ${phase} trigger message for ${table}`,
    );
  }

  return message;
}

/**
 * The tables one phase of migration `0010` declares a trigger on, in the order the file declares
 * them.
 *
 * Both phases are read separately rather than unioned, because a table carrying only one of the two
 * triggers is a hole this suite must report: a `BEFORE UPDATE` without its `BEFORE DELETE` leaves
 * the row's removal possible, and the coverage case compares the two lists against each other for
 * exactly that reason.
 */
function triggerTablesFor(sql: string, phase: TriggerPhase): readonly string[] {
  const pattern = new RegExp(`${phase} ON\\s+(\\w+)`, "g");
  const tables: string[] = [];

  for (const match of sql.matchAll(pattern)) {
    const table = match[1];

    if (table === undefined) {
      throw new Error(`${APPEND_ONLY_MIGRATION_FILE} names no table after "${phase} ON"`);
    }

    if (!tables.includes(table)) {
      tables.push(table);
    }
  }

  return tables;
}

/**
 * Every row of one append-only table, in a stable order.
 *
 * `ORDER BY rowid` is load-bearing rather than decorative: several of the nine tables hold rows that
 * share their `created_at` instant — a report and its retest, two events appended in one run — and a
 * snapshot whose order depended on the planner's choice would compare two orderings rather than two
 * contents.
 *
 * The table name is interpolated into the statement, which is safe here and nowhere else in this
 * file: it comes from the closed literal list above — a set the coverage case holds equal to the
 * migration's — and never from a request, a response or a row. A bound parameter cannot carry an
 * identifier in SQL, so interpolation is the only form this read can take, and the list being a
 * closed literal set is what keeps it from being an injection.
 */
function snapshotOf(server: TestServer, table: string): SnapshotRow[] {
  return server.query<SnapshotRow>(`SELECT * FROM ${table} ORDER BY rowid`);
}

/**
 * The canonical JSON text of one response's parsed body.
 *
 * The parameter type is derived from the renderer rather than imported: the alias it is declared
 * with belongs to the fixture package, which this workspace does not depend on and which a suite
 * must not reach for. Nothing is asserted away by the derivation — a body this API serialised is a
 * JSON value by construction — and the harness's own `json<T>()` is the one place that narrows it.
 */
function canonicalBody(response: TestResponse): string {
  return canonicalize(response.json<Parameters<typeof canonicalize>[0]>());
}

/**
 * Asserts every part of the refusal an unregistered route answers with.
 *
 * Four facts are checked, because the `404` alone is not the claim: the status, that the body is the
 * one error envelope and nothing else — no `statusCode`, no validation detail, no identifier — that
 * the envelope carries exactly the `code` and `message` members a client reads, and that the code is
 * the contract's `not_found`. The path named in each failure message is the full one,
 * {@link API_PREFIX} included, because that is the URL whose answer is being checked.
 *
 * @param response The answer the server gave the attempt.
 * @param method The method attempted, named in the failure messages.
 * @param path The prefix-relative path attempted; the messages state its full form.
 */
function expectUnregisteredRoute(response: TestResponse, method: string, path: string): void {
  const where = `${method} ${API_PREFIX}${path}`;

  expect(response.status, `${where} is answered by no route, so it must be 404`).toBe(404);

  const body = response.json<{ error: { code: string; message: string } }>();

  expect(
    Object.keys(body),
    `${where} must answer the one envelope and nothing beside it`,
  ).toStrictEqual(["error"]);
  expect(
    Object.keys(body.error),
    `${where} must carry exactly the envelope's two members`,
  ).toStrictEqual(["code", "message"]);
  expect(body.error.code, `${where} must carry the contract's not-found code`).toBe("not_found");
  expect(body.error.message.length, `${where} must carry a client-facing sentence`).toBeGreaterThan(
    0,
  );
}

/**
 * The account an attempt's header names.
 *
 * A route whose row requires a role is sent that role's own seeded account, so the `404` the attempt
 * earns cannot be a `403` in disguise and the demo header can never be the reason an attempt was
 * refused. A public row requires no role at all; the operator's account is sent there because it is
 * the most privileged seeded account and therefore cannot introduce a role refusal where the row
 * requires none — and no public route resolves the header in any case.
 */
function attemptAccountFor(server: TestServer, role: AccountRole | "public"): SeedAccount {
  return role === "public" ? server.accountForRole("operator") : server.accountForRole(role);
}

/**
 * The single row a one-row read must answer with.
 *
 * The two reads this suite makes of seeded data — the standard catalogue row and its published
 * version — are single-row by nature, and a second row or none at all would mean this file's
 * assumption rather than the database's content had changed. `noUncheckedIndexedAccess` makes the
 * indexed read an optional, so this check is also what narrows it.
 *
 * @throws {Error} When the read answered a number of rows other than one, naming what was read.
 */
function singleRowOf<T>(rows: readonly T[], what: string): T {
  const [row] = rows;

  if (row === undefined || rows.length !== 1) {
    throw new Error(`expected the database to hold exactly one ${what}, found ${rows.length}`);
  }

  return row;
}

/**
 * The governance vocabulary's member for an operator's ruling on an appeal.
 *
 * It is derived from the closed tuple `@adem/sgi-core` publishes rather than typed here, because a
 * spelling written into a test outlives the rename that breaks it: the vocabulary holds one member
 * for this decision — the ruling's outcome travels in the appended event's payload rather than in a
 * second event type — and a vocabulary that grew a second member for it, or lost the one, fails this
 * derivation instead of quietly mismatching an expectation below.
 *
 * @throws {Error} When the vocabulary does not hold exactly one appeal-ruling member.
 */
function rulingEventTypeOf(vocabulary: readonly GovernanceEventType[]): GovernanceEventType {
  const candidates = vocabulary.filter(
    (eventType) => eventType.startsWith("appeal_") && eventType.includes("rule"),
  );
  const [rulingEventType] = candidates;

  if (rulingEventType === undefined || candidates.length !== 1) {
    throw new Error(
      `expected @adem/sgi-core's governance vocabulary to hold exactly one appeal-ruling member, found ${candidates.length}`,
    );
  }

  return rulingEventType;
}

/** The vocabulary's ruling member, resolved once from the tuple the package owns. */
const RULING_EVENT_TYPE: GovernanceEventType = rulingEventTypeOf(GOVERNANCE_EVENT_TYPES);

/**
 * The outcome this suite sends, taken from the vocabulary `@adem/shared` publishes rather than
 * spelled here: the value sent, the value the appeal's row takes and the value asserted below are one
 * value, taken from the product's own outcomes.
 *
 * @throws {Error} When the vocabulary holds no outcome at all, which would mean the product
 *   published no ruling a client could send.
 */
function rulingOf(vocabulary: readonly AppealRuling[]): AppealRuling {
  const [ruling] = vocabulary;

  if (ruling === undefined) {
    throw new Error("expected @adem/shared's APPEAL_RULINGS to hold at least one outcome");
  }

  return ruling;
}

/** The ruling the appeal block sends and asserts. */
const RULING: AppealRuling = rulingOf(APPEAL_RULINGS);


/**
 * The started harness: the real server on an ephemeral port, the one in-memory connection behind it,
 * with the schema migrated and the synthetic seed loaded.
 */
let server: TestServer;

/**
 * The identifiers the attempts address, resolved once by the suite's own set-up.
 *
 * It is deliberately optional rather than assigned at its declaration: the set-up is what resolves
 * it, and a case reading it before that has happened is a defect in this file rather than a state a
 * case can meet.
 */
let attemptIds: AttemptIds | undefined;

/**
 * The identifiers the suite's set-up resolved.
 *
 * @throws {Error} When the set-up has not run, which is what a case ordered before its hook would
 *   find — and is worth a sentence of its own rather than an un-narrowed optional at every use.
 */
function resolvedIds(): AttemptIds {
  if (attemptIds === undefined) {
    throw new Error(
      "the suite's set-up has not resolved the identifiers the attempts address, so no case can reach a route yet",
    );
  }

  return attemptIds;
}

/** The sentence the set-up's proposal states, so the row it creates carries this suite's own text. */
const PROPOSAL_TITLE = "Add a second fixture pack to the case set of the first standard";

/** The ground that proposal states; fiction, as every synthetic row of this product is. */
const PROPOSAL_RATIONALE =
  "A second pack would probe a shape the current case set does not, and it would ship as a new standard version rather than as an edit to the published one.";

/** The ground the set-up's appeal states, in the same register as the proposal's. */
const APPEAL_REASON =
  "The seeded report counts one case as a miss whose recorded output the standard's own rubric measures as a match.";

/** The one minor unit of the synthetic currency the set-up's refund reverses. */
const REFUND_MINOR_UNITS = 1;

/**
 * Performs the four appends that leave every one of the nine tables holding a row, and resolves
 * every identifier the attempts and the appeal block address.
 *
 * **Why the suite writes at all.** `transactions`, `refunds`, `governance_events` and `audit_events`
 * hold no seeded row, and a before-and-after comparison over an empty table is a comparison of two
 * empty lists: it would pass whatever the attempts did. The four writes below are the product's own
 * append paths — a contributor's proposal, a developer's appeal, a buyer's simulated checkout and an
 * operator's refund — so each is a change the design permits, and each leaves the row the table is
 * then made to protect.
 *
 * **Why nothing here is a literal.** Each identifier is read from the seed through the harness, read
 * from the database, or taken from the response of the write that created it. A path built from an
 * invented identifier would still be answered `404`, but it would prove nothing about the resources
 * a real client can reach.
 *
 * @param harness The started harness to write through.
 * @returns The identifiers the attempts address.
 * @throws {Error} When any of the four writes is refused, when a set-up read answers something other
 *   than the one row it expects, or when the fixture candidate the suite scores carries no report —
 *   each of which means this file's assumptions rather than the product's behaviour changed.
 */
async function createImmutableHistory(harness: TestServer): Promise<AttemptIds> {
  const standard = singleRowOf(
    harness.query<{ id: string }>("SELECT id FROM standards ORDER BY rowid ASC LIMIT 1"),
    "standards row",
  );
  const standardVersion = singleRowOf(
    harness.query<{ version_label: string }>(
      "SELECT version_label FROM standard_versions ORDER BY rowid ASC LIMIT 1",
    ),
    "published standard version",
  );

  const candidate = harness.candidateVersion("seed-alpha");
  const reportId = harness.seededReportId("seed-alpha");

  // 1. A contributor's proposal. It stays `submitted`: the review route is one this suite attempts a
  //    mutation on, and a review performed here would be this file performing the very write it is
  //    proving unreachable by any other method.
  const proposalResponse = await harness.post(
    "/standards/proposals",
    { standard_id: standard.id, title: PROPOSAL_TITLE, rationale: PROPOSAL_RATIONALE },
    { account: harness.accountForRole("contributor") },
  );
  expect(
    proposalResponse.status,
    "the set-up's proposal must be accepted; without it governance_events has nothing to protect",
  ).toBe(201);
  const proposal = proposalResponse.json<{ standard_proposal: { id: string } }>().standard_proposal;

  // 2. A developer's appeal against a seeded report. Opening it appends the one governance event the
  //    seed does not, and it is left open here: ruling it is the other half of this file's evidence.
  const appealResponse = await harness.post(
    `/evaluations/${reportId}/appeals`,
    { reason: APPEAL_REASON },
    { account: harness.accountForRole("developer") },
  );
  expect(
    appealResponse.status,
    "the set-up's appeal must be accepted; without it governance_events has nothing to protect",
  ).toBe(201);
  const appeal = appealResponse.json<Appeal>();

  // 3. A buyer's simulated checkout, for the offer model the listing's own row declares. An offer
  //    model the listing does not make is the contract's `422`, so the model is read from the row
  //    rather than chosen here — and the amount is the route's own fixed base amount for it.
  const listing = singleRowOf(
    harness.query<{ pricing_model: string }>(
      "SELECT pricing_model FROM listings WHERE id = ?",
      candidate.listingId,
    ),
    "listing row",
  );
  const checkoutResponse = await harness.post(
    "/checkout-simulations",
    {
      listing_id: candidate.listingId,
      listing_version_id: candidate.id,
      offer_model: listing.pricing_model,
    },
    { account: harness.accountForRole("buyer") },
  );
  expect(
    checkoutResponse.status,
    "the set-up's simulated checkout must be accepted; without it transactions has nothing to protect",
  ).toBe(201);
  const transaction = checkoutResponse.json<Transaction>();

  // 4. An operator's refund of one minor unit. It is within the transaction's net remaining by
  //    construction — the smallest base offer amount is far above one — and it appends the reversal
  //    entries that leave `refunds` holding a row.
  const refundResponse = await harness.post(
    `/transactions/${transaction.id}/refunds`,
    { amount_minor_units: REFUND_MINOR_UNITS },
    { account: harness.accountForRole("operator") },
  );
  expect(
    refundResponse.status,
    "the set-up's refund must be accepted; without it refunds has nothing to protect",
  ).toBe(201);

  return {
    standardId: standard.id,
    standardVersionLabel: standardVersion.version_label,
    listingId: candidate.listingId,
    reportId,
    proposalId: proposal.id,
    appealId: appeal.id,
    transactionId: transaction.id,
  };
}


/**
 * One `governance_events` row, restricted to the columns this suite asserts.
 *
 * It is declared as a type alias rather than an interface on purpose: `canonicalize` accepts this
 * shape because a type alias of an object type carries the index signature the renderer needs, which
 * is what lets one read of the table serve both the byte-for-byte comparison and the field
 * assertions below without a cast at either.
 */
type GovernanceEventRow = {
  /** Identifier of the appended row. */
  readonly id: string;
  /** Which kind of row `subject_id` names; `appeal` for a ruling. */
  readonly subject_type: string;
  /** Identifier of the row the decision concerns. */
  readonly subject_id: string;
  /** Which decision was recorded, from `GOVERNANCE_EVENT_TYPES`. */
  readonly event_type: string;
  /** The account that caused the decision, referencing `accounts.id`. */
  readonly actor_account_id: string;
  /** The stated reason where the decision carried one, and `null` where it carried none. */
  readonly reason: string | null;
  /** Serialized JSON text of any extra detail the event carries, or `null`. */
  readonly payload_json: string | null;
  /** ISO-8601 UTC instant written at insert time. */
  readonly created_at: string;
};

/** Every `governance_events` row, in insertion order. */
function readGovernanceEvents(running: TestServer): GovernanceEventRow[] {
  return running.query<GovernanceEventRow>("SELECT * FROM governance_events ORDER BY rowid");
}

/**
 * The payload one appended governance event carries, parsed.
 *
 * The column holds serialized JSON text rather than an object, so a reader that asserted on it would
 * otherwise be comparing two strings and hoping the key order never moved. A row that carries no
 * payload at all, or a payload that is not a JSON object, fails here with that fact rather than with
 * a parser's own error.
 *
 * @throws {Error} When the row's `payload_json` is null or does not parse to a JSON object.
 */
function payloadOf(event: GovernanceEventRow): Record<string, unknown> {
  if (event.payload_json === null) {
    throw new Error(`the appended ${event.event_type} governance event carries no payload`);
  }

  const parsed: unknown = JSON.parse(event.payload_json);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `the appended ${event.event_type} governance event's payload is not a JSON object`,
    );
  }

  return parsed as Record<string, unknown>;
}

/** The ground the block's ruling states, so the appended event's `reason` is this suite's sentence. */
const RULING_REASON =
  "The report's per-case evidence was read against the standard's rubric and the outcome stands.";

/**
 * What the appeal block's set-up captured, so each of its cases asserts one facet of one ruling
 * rather than repeating the whole sequence.
 *
 * The report and the two tables are captured as their canonical text rather than as driver objects,
 * because the claim each case makes is byte-identity and the canonical form is what makes that claim
 * comparable at all.
 */
interface RulingEvidence {
  /** The report the appeal was opened against. */
  readonly reportId: string;

  /** The operator whose account the ruling was sent as, and which the appended event must name. */
  readonly operator: SeedAccount;

  /** The appeal as the opener answered with it, in status `open`. */
  readonly appealAtOpening: Appeal;

  /** The report route's payload before the ruling, as canonical JSON. */
  readonly reportBeforeRuling: string;

  /** Every `evaluation_reports` row before the ruling, as canonical JSON. */
  readonly reportsBeforeRuling: string;

  /** Every `report_case_results` row before the ruling, as canonical JSON. */
  readonly caseResultsBeforeRuling: string;

  /** The governance log before the ruling, as the rows it held. */
  readonly eventsBeforeRuling: GovernanceEventRow[];

  /** What the ruling route answered. */
  readonly rulingResponse: TestResponse;

  /** The governance log immediately after the ruling, as the rows it held. */
  readonly eventsAfterRuling: GovernanceEventRow[];
}

/** The block's captured evidence, absent until its set-up has run. */
let rulingEvidence: RulingEvidence | undefined;

/**
 * The appeal block's captured evidence.
 *
 * @throws {Error} When the block's set-up has not run, which is the defect a case ordered before it
 *   would meet rather than the un-narrowed optional it would otherwise read.
 */
function capturedEvidence(): RulingEvidence {
  if (rulingEvidence === undefined) {
    throw new Error("the appeal block's set-up has not captured the evidence its cases assert");
  }

  return rulingEvidence;
}

/**
 * The one governance event the ruling appended: the row the log holds after the ruling that it did
 * not hold before it.
 *
 * The two logs are compared by id rather than by position, because where in the trail a ruling falls
 * is the database's business while *that it appended exactly one row* is the claim the block makes.
 * The count is asserted where it belongs — in the case about what a ruling appends — so every case
 * that needs the appended row takes it from here rather than repeating the comparison.
 *
 * @param captured - The appeal block's captured evidence.
 * @returns The row the ruling added to the log.
 * @throws {Error} When the ruling appended no row, or appended more than one.
 */
function appendedRulingEvent(captured: RulingEvidence): GovernanceEventRow {
  const alreadyLogged = new Set(captured.eventsBeforeRuling.map((event) => event.id));
  const appended = captured.eventsAfterRuling.filter((event) => !alreadyLogged.has(event.id));
  const [event] = appended;

  if (event === undefined || appended.length !== 1) {
    throw new Error(
      `expected the ruling to append exactly one governance event, found ${appended.length}`,
    );
  }

  return event;
}

/**
 * The suite's one harness, started by the first hook and closed by the last.
 *
 * Every case reaches the running server through {@link runningServer}, so a case that ran before its
 * hook fails with that reason instead of on a property of an un-narrowed value.
 */
let harness: TestServer | undefined;

/**
 * The running harness.
 *
 * @throws {Error} When the suite's own hook has not started it.
 */
function runningServer(): TestServer {
  if (harness === undefined) {
    throw new Error("the suite's set-up has not started the server its cases assert against");
  }

  return harness;
}

/**
 * The append-only proof: every route that exposes one of the nine tables' resources, attempted with
 * every method that would change one, and every row re-read afterwards.
 */
describe("immutability of the append-only record", () => {
  beforeAll(async () => {
    const started = await startTestServer();
    harness = started;
    attemptIds = await createImmutableHistory(started);
  });

  afterAll(async () => {
    // Idempotent by the harness's own contract, and guarded here because a hook that never started a
    // server must not turn a start-up failure into a teardown failure that replaces it.
    if (harness !== undefined) {
      await harness.close();
    }
  });

  describe("append-only tables", () => {
    it("covers exactly the tables migration 0010 declares append-only", () => {
      const sql = readTriggerMigration();
      const declaredForUpdate = triggerTablesFor(sql, "BEFORE UPDATE");
      const declaredForDelete = triggerTablesFor(sql, "BEFORE DELETE");

      // A table carrying only one of the two triggers leaves the other mutation possible, so the two
      // phases are compared with each other — order included, since the migration declares both for
      // each table together — before either is compared with the list the attempts are built from.
      expect(declaredForDelete).toStrictEqual(declaredForUpdate);

      const attempted = APPEND_ONLY_TABLE_ATTEMPTS.map((plan) => plan.table);

      // Set equality in both directions: a migration that gained an append-only table and a list here
      // that invented one each fail this comparison, whichever side changed.
      expect([...declaredForUpdate].sort()).toStrictEqual([...attempted].sort());
    });

    it("answers an unregistered path with the same envelope an unregistered method earns", async () => {
      const running = runningServer();

      const onUnregisteredPath = await running.request("GET", UNREGISTERED_PATH);
      const onUnregisteredMethod = await running.request(
        "DELETE",
        REGISTERED_PATH_WITHOUT_MUTATING_VERB,
      );

      expectUnregisteredRoute(onUnregisteredPath, "GET", UNREGISTERED_PATH);
      expectUnregisteredRoute(
        onUnregisteredMethod,
        "DELETE",
        REGISTERED_PATH_WITHOUT_MUTATING_VERB,
      );

      // The equivalence every case below rests on, made observable: Fastify answers an unregistered
      // method on a registered path with the same document it answers an unregistered path, so a
      // `404` earned by an attempt is the absence of the method rather than a missing resource this
      // suite built its path around.
      expect(onUnregisteredMethod.body).toStrictEqual(onUnregisteredPath.body);
    });

    for (const plan of APPEND_ONLY_TABLE_ATTEMPTS) {
      it(`answers no mutating method on any route exposing ${plan.table}, leaving every row as it was`, async () => {
        const running = runningServer();
        const resolved = resolvedIds();

        // The snapshot is taken once for the table rather than once per method, so a failure names the
        // table whose rows changed — the fact a reader needs — instead of whichever of the methods was
        // being attempted when the difference appeared.
        const before = snapshotOf(running, plan.table);

        // An empty table compares equal to itself whatever the attempts did, so the comparison below is
        // evidence only where the table holds a row. The seed fills five of the nine and this suite's
        // own set-up fills the other four, which is why every table is asserted to hold one first.
        expect(
          before.length,
          `${plan.table} must hold at least one row, or the comparison below protects nothing`,
        ).toBeGreaterThan(0);

        const beforeText = canonicalize(before);

        for (const route of plan.routes(resolved)) {
          // The role the route's own row of the contract requires, so a `401` or a `403` can never be
          // mistaken for the `404` that proves the method is unregistered.
          const account = attemptAccountFor(running, route.role);

          for (const method of MUTATING_METHODS) {
            const response = await running.request(method, route.path, { account });

            expectUnregisteredRoute(response, method, route.path);
          }
        }

        // The route-level proof, and it is complete before the trigger evidence below begins: no route
        // accepted a mutation, and every stored row is byte-identical to the snapshot taken before the
        // attempts. `canonicalize` fixes property order and removes insignificant whitespace, so what
        // is compared is the stored data itself rather than two driver objects or an object's identity.
        expect(
          canonicalize(snapshotOf(running, plan.table)),
          `${plan.table}: no mutating attempt may leave a stored row changed`,
        ).toBe(beforeText);

        // Supplementary defence-in-depth evidence, recorded for every table and never the proof.
        // Migration 0010's triggers refuse a mutation that reaches a table by a path no route takes;
        // they are not a security boundary, since a connection holding write access can drop one, and
        // the guarantee above does not rest on them. Each probe changes the row's own identifier, so a
        // missing trigger could not pass unnoticed, and the expectation is the message the migration
        // itself declares — which is what pins each refusal to that trigger rather than to a
        // constraint, an affinity rule or a reference the statement happens to meet first.
        const targetRow = `(SELECT MIN(rowid) FROM ${plan.table})`;

        expect(
          () =>
            running.database
              .prepare(`UPDATE ${plan.table} SET id = id || ? WHERE rowid = ${targetRow}`)
              .run(TRIGGER_PROBE_SUFFIX),
          `${plan.table}: the migration's BEFORE UPDATE trigger must refuse a direct rewrite`,
        ).toThrow(triggerMessageFor("BEFORE UPDATE", plan.table));

        expect(
          () => running.database.prepare(`DELETE FROM ${plan.table} WHERE rowid = ${targetRow}`).run(),
          `${plan.table}: the migration's BEFORE DELETE trigger must refuse a direct removal`,
        ).toThrow(triggerMessageFor("BEFORE DELETE", plan.table));
      });
    }
  });

  /**
   * The positive control: a real governance decision appends one event and leaves the measurement
   * byte-identical.
   *
   * The proof above establishes that a mutation cannot be made. This block establishes the other
   * half of the same invariant — that the one change the design does allow is an append, and that it
   * leaves the record it comments on exactly as it was. The sequence runs once, in the block's own
   * hook, so each case below asserts one facet of one ruling rather than repeating it: the single
   * appended event, the untouched report, the appeal's single mutable column, the answer that carries
   * the appended event beside the ruled appeal, and the refusal of a second ruling. A log that grew
   * by two would be as much a defect as a rewritten report, which is why the count is asserted
   * exactly rather than at least.
   */
  describe("appeal ruling", () => {
    beforeAll(async () => {
      const running = runningServer();
      const operator = running.accountForRole("operator");
      const reportId = running.seededReportId("seed-beta");

      // The appeal is opened in the developer's role the route requires, against a seeded report, and
      // left to this block to rule: nothing in the set-up writes to it.
      const opening = await running.post(
        `/evaluations/${reportId}/appeals`,
        { reason: APPEAL_REASON },
        { account: running.accountForRole("developer") },
      );
      expect(
        opening.status,
        "the block's appeal must be accepted before a ruling on it can be asserted",
      ).toBe(201);
      const appealAtOpening = opening.json<Appeal>();

      // Everything the ruling must not change, captured before it is sent: the payload the public
      // report read answers with, the two append-only tables the measurement lives in, and the
      // governance log as it stands.
      const reportBeforeRuling = canonicalBody(await running.get(`/evaluations/${reportId}`));
      const reportsBeforeRuling = canonicalize(snapshotOf(running, "evaluation_reports"));
      const caseResultsBeforeRuling = canonicalize(snapshotOf(running, "report_case_results"));
      const eventsBeforeRuling = readGovernanceEvents(running);

      const rulingResponse = await running.post(
        `/appeals/${appealAtOpening.id}/ruling`,
        { status: RULING, reason: RULING_REASON },
        { account: operator },
      );
      expect(rulingResponse.status, "the operator's ruling must be accepted").toBe(200);

      rulingEvidence = {
        reportId,
        operator,
        appealAtOpening,
        reportBeforeRuling,
        reportsBeforeRuling,
        caseResultsBeforeRuling,
        eventsBeforeRuling,
        rulingResponse,
        eventsAfterRuling: readGovernanceEvents(running),
      };
    });

    it("appends exactly one governance event, naming the ruling, the operator and the appeal", () => {
      const captured = capturedEvidence();

      expect(captured.eventsAfterRuling.length, "a ruling appends one event and no more").toBe(
        captured.eventsBeforeRuling.length + 1,
      );

      // The one row the ruling added, resolved by comparing the two logs rather than by assuming a
      // position: the comparison below is what proves the count, and the row itself is what this case
      // then reads.
      const event = appendedRulingEvent(captured);

      // The type is the vocabulary member the package owns, resolved above rather than spelled here:
      // one member covers both outcomes, so the outcome itself travels in the payload asserted below.
      expect(event.event_type).toBe(RULING_EVENT_TYPE);
      expect(event.actor_account_id).toBe(captured.operator.id);
      expect(event.reason).toBe(RULING_REASON);
      expect(event.subject_type).toBe("appeal");
      expect(event.subject_id).toBe(captured.appealAtOpening.id);

      // Traceability to the report the decision concerns, without the decision touching it: the
      // appeal's own row names the report, and the appended payload states both the outcome the single
      // event type does not spell out and the report it was ruled against.
      expect(captured.appealAtOpening.report_id).toBe(captured.reportId);

      const payload = payloadOf(event);
      expect(payload["status"]).toBe(RULING);
      expect(payload["reportId"]).toBe(captured.reportId);
    });

    it("leaves the report and its per-case evidence byte-identical across the ruling", async () => {
      const captured = capturedEvidence();
      const running = runningServer();

      // The report route's own answer, read before the appeal and read again after the ruling: a buyer
      // reads the same report, the same evidence and the same outcome.
      expect(canonicalBody(await running.get(`/evaluations/${captured.reportId}`))).toBe(
        captured.reportBeforeRuling,
      );

      // And the two tables the measurement lives in, row for row.
      expect(canonicalize(snapshotOf(running, "evaluation_reports"))).toBe(
        captured.reportsBeforeRuling,
      );
      expect(canonicalize(snapshotOf(running, "report_case_results"))).toBe(
        captured.caseResultsBeforeRuling,
      );
    });

    it("moves only the appeal's own status column, and answers with the ruled appeal and its event", () => {
      const captured = capturedEvidence();

      const stored = singleRowOf(
        runningServer().query<Appeal>(
          "SELECT * FROM appeals WHERE id = ?",
          captured.appealAtOpening.id,
        ),
        "appeals row",
      );

      // Exactly one value differs from the row the opener wrote: the status the ruling set. The
      // developer's stated ground, the report the appeal names, the appellant and the opening instant
      // are the values they were, because a ruling records a new decision rather than correcting an
      // old one — which is also why the row carries no ruled-at, ruled-by or ruling-reason column, and
      // why the ruling's own ground lives in the appended event asserted above.
      expect(stored).toStrictEqual({ ...captured.appealAtOpening, status: RULING });

      // The route answers the ruled appeal beside the governance event the ruling appended, which is
      // the shape the moderation row already uses for its own decision and the shape that makes the
      // trail readable where the decision is shown. The event asserted here is the row the log holds,
      // read back through the harness, so the comparison is between the route's answer and the stored
      // record rather than between two renderings of the same value.
      expect(
        captured.rulingResponse.json<{ readonly appeal: Appeal; readonly event: GovernanceEventRow }>(),
      ).toStrictEqual({
        appeal: { ...captured.appealAtOpening, status: RULING },
        event: appendedRulingEvent(captured),
      });
    });

    it("refuses a second ruling with 409 already_ruled and appends nothing for it", async () => {
      const captured = capturedEvidence();
      const running = runningServer();

      const second = await running.post(
        `/appeals/${captured.appealAtOpening.id}/ruling`,
        { status: RULING, reason: RULING_REASON },
        { account: captured.operator },
      );

      // A ruling is final: the same outcome a second time is as much a second ruling as the opposite
      // outcome would be, and the refusal is raised before anything is written.
      expect(second.status).toBe(409);
      expect(second.json<{ error: { code: string } }>().error.code).toBe("already_ruled");

      // Nothing was appended for the refused attempt: the log is exactly what the accepted ruling left.
      expect(canonicalize(readGovernanceEvents(running))).toBe(
        canonicalize(captured.eventsAfterRuling),
      );

      // And the measurement is still the one captured before the appeal was opened.
      expect(canonicalize(snapshotOf(running, "evaluation_reports"))).toBe(
        captured.reportsBeforeRuling,
      );
    });
  });
});
