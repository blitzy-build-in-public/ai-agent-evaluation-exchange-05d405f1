/**
 * Integration proof for `apps/api/src/audit/append-audit-event.ts`: the single insert path into
 * `audit_events`, the eight columns a row carries, the closed `AUDIT_ACTIONS` vocabulary, the two
 * refusals a caller's own defect meets, and the schema's guard behind the table.
 *
 * Everything runs against a real SQLite database built by `runMigrations` from the ordered files in
 * `packages/shared/migrations/`, so the columns and constraints under test are the delivered schema
 * rather than a fixture retyped here. One `:memory:` handle serves the whole file, and it is opened,
 * migrated, seeded with one `accounts` row and one `categories` row, and closed by this file alone.
 *
 * **The append participates in the caller's transaction by design.** `appendAuditEvent` wraps nothing
 * and commits nothing: a route performs its domain write and this append inside one
 * `db.transaction(...)`, which is what makes a write and the record of it indivisible. The case below
 * throws after both and re-reads the tables, so the rollback is the property asserted rather than
 * the absence of a transaction wrapper in the source.
 *
 * **The append-only trigger is defence in depth behind the rule that no route mutates the table.**
 * `0010_append_only_triggers.sql` declares a `BEFORE UPDATE` and a `BEFORE DELETE` trigger on
 * `audit_events`, each running `RAISE(ABORT)`; the messages this file expects are read out of that
 * migration rather than restated, so the trigger's own text is what the refusal is compared against.
 * A connection holding write access can drop a trigger, so what holds the rule is that no route
 * offers the change, and the trigger is what refuses a mutation reaching the table by some other
 * path.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Account, AuditResourceType } from "@adem/shared";

import {
  AUDIT_ACTIONS,
  appendAuditEvent,
  type AuditAction,
  type AuditEventInput,
} from "../../src/audit/append-audit-event";
import { runMigrations } from "../../src/db/migrate";
import {
  SEED_ACCOUNTS,
  SEED_CATEGORIES,
  SEED_CATEGORY_ORDER_INTAKE_ID,
  SEED_DEVELOPER_ACCOUNT_ID,
  SEED_LISTING_INTAKE_DESK_ID,
} from "../../src/seed/seed-data";

/**
 * A row of `audit_events`, typed as migration `0009` declares its columns, read back through a
 * statement this file writes rather than through the module under test.
 *
 * Reading independently is the point: a row asserted only through the writer's own return value
 * would prove nothing about what the INSERT stored.
 */
interface StoredAuditEventRow {
  readonly id: string;
  readonly actor_account_id: string;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly status_code: number;
  readonly reason: string | null;
  readonly created_at: string;
}

/** The one column a `COUNT(*)` query returns. */
interface CountRow {
  readonly count: number;
}

/**
 * The eight columns in the order migration `0009` declares them, named explicitly so a column added
 * by a later migration cannot change what this file asserts.
 */
const SELECTED_COLUMNS =
  "id, actor_account_id, action, resource_type, resource_id, status_code, reason, created_at";

/**
 * A UUID, the shape `randomUUID()` produces for the row's generated id.
 *
 * The version and variant digits are not pinned: what this file proves is that the id is a generated
 * UUID rather than a value the caller supplied, not which variant was generated.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The instant `new Date().toISOString()` writes: ISO-8601 UTC, milliseconds included, and a trailing
 * `Z`.
 *
 * The pattern exists beside a `Date.parse` because only it pins the two properties the row's writer
 * claims: SQLite's own `CURRENT_TIMESTAMP` produces `YYYY-MM-DD HH:MM:SS`, which parses as a date and
 * is neither UTC-marked nor millisecond-precision.
 */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * How far the row's instant may sit from this process's clock before the case fails for it.
 *
 * The write stamps its own instant and the case compares it with the clock read around the call, so
 * only clock skew between the two readings can move the row outside this window — never a delay in
 * the test's own work, which would have to exceed several seconds for a single INSERT.
 */
const INSTANT_TOLERANCE_MS = 5000;

/**
 * A listing id no seed writes, in the seed's own id shape.
 *
 * It belongs to the rollback case alone: the listing row inserted there must not exist before the
 * case runs, so that its absence afterwards is evidence the transaction rolled back.
 */
const TRANSIENT_LISTING_ID = "list9001-1a2b-4c3d-9e4f-a1b2c3d4e5f6";

/** The `audit_events` table the trigger messages below concern. */
const TABLE = "audit_events";

/**
 * The migrations directory, resolved from this module's own location rather than from the working
 * directory: `apps/api/test/integration/` → `apps/api/` → `apps/` → the repository root.
 */
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/shared/migrations/", import.meta.url),
);

let db: Database.Database;

/** The stored row with this id, failing the case rather than the assertion when none is stored. */
function storedRow(id: string): StoredAuditEventRow {
  const row = db
    .prepare<[string], StoredAuditEventRow>(
      `SELECT ${SELECTED_COLUMNS} FROM audit_events WHERE id = ?`,
    )
    .get(id);
  if (row === undefined) {
    throw new Error(`expected audit_events to hold a row with id ${id}`);
  }
  return row;
}

/** How many rows `audit_events` holds, read independently of the module under test. */
function auditRowCount(): number {
  const row = db.prepare<[], CountRow>("SELECT COUNT(*) AS count FROM audit_events").get();
  if (row === undefined) {
    throw new Error("expected the count query to return a row");
  }
  return row.count;
}

/** How many rows `listings` holds for one id, read independently of the module under test. */
function listingRowCount(id: string): number {
  const row = db
    .prepare<[string], CountRow>("SELECT COUNT(*) AS count FROM listings WHERE id = ?")
    .get(id);
  if (row === undefined) {
    throw new Error("expected the count query to return a row");
  }
  return row.count;
}

/** The seeded account this file's audit rows are written by. */
function seededAccount(id: string): Account {
  const account = SEED_ACCOUNTS.find((candidate) => candidate.id === id);
  if (account === undefined) {
    throw new Error(`expected SEED_ACCOUNTS to hold the account ${id}`);
  }
  return account;
}

/**
 * The message the `audit_events` trigger of this phase raises, read out of
 * `packages/shared/migrations/0010_append_only_triggers.sql`.
 *
 * The migration's own text is the source of the expectation rather than a copy of it in this file, so
 * the two cannot be changed apart from one another; an extraction that finds nothing fails the case
 * instead of comparing against an empty string.
 */
function triggerMessageFor(phase: string): string {
  const sql = readFileSync(join(migrationsDir, "0010_append_only_triggers.sql"), "utf8");
  const pattern = new RegExp(`${phase} ON ${TABLE}[\\s\\S]*?RAISE\\(ABORT, '([^']+)'\\)`);
  const message = pattern.exec(sql)?.[1];
  if (message === undefined) {
    throw new Error(`expected migration 0010 to state a ${phase} trigger message for ${TABLE}`);
  }
  return message;
}

/** The sentence a thrown value carries, or an empty string for a value that is not an error. */
function messageOf(refusal: unknown): string {
  return refusal instanceof Error ? refusal.message : "";
}

/** The five facts one audited write fixes, before any case varies one of them. */
const baseInput: AuditEventInput = {
  actorAccountId: SEED_DEVELOPER_ACCOUNT_ID,
  action: "listing.created",
  resourceType: "listing",
  resourceId: SEED_LISTING_INTAKE_DESK_ID,
  statusCode: 201,
};

/**
 * How many rows `audit_events` held when the current case began.
 *
 * The refusal cases assert that a rejected write stored nothing, which is a statement about this
 * count rather than about one row: the cases before them appended rows of their own, so each case
 * reads the count it started from.
 */
let rowsBeforeCase = 0;

beforeEach(() => {
  rowsBeforeCase = auditRowCount();
});

beforeAll(() => {
  db = new Database(":memory:");
  // SQLite leaves foreign keys off by default, and every audit row references an `accounts` row.
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  // One account and one category, both taken from the seed data so the ids and handles here are the
  // ones the product ships rather than values invented for a fixture.
  const account = seededAccount(SEED_DEVELOPER_ACCOUNT_ID);
  db.prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)").run(
    account.id,
    account.handle,
    account.role,
    account.display_label,
  );

  const category = SEED_CATEGORIES.find(
    (candidate) => candidate.id === SEED_CATEGORY_ORDER_INTAKE_ID,
  );
  if (category === undefined) {
    throw new Error(`expected SEED_CATEGORIES to hold the category ${SEED_CATEGORY_ORDER_INTAKE_ID}`);
  }
  db.prepare("INSERT INTO categories (id, slug, name) VALUES (?, ?, ?)").run(
    category.id,
    category.slug,
    category.name,
  );
});

afterAll(() => {
  db.close();
});

describe("appendAuditEvent against the delivered schema", () => {
  it("stores one row and returns the id it generated for it", () => {
    const id = appendAuditEvent(db, baseInput);

    expect(id).toMatch(UUID_SHAPE);

    const row = storedRow(id);
    expect(row.id).toBe(id);
    expect(row.actor_account_id).toBe(SEED_DEVELOPER_ACCOUNT_ID);
    expect(row.resource_type).toBe("listing");
    expect(row.resource_id).toBe(SEED_LISTING_INTAKE_DESK_ID);
    expect(row.status_code).toBe(201);
    expect(row.action).toBe("listing.created");
    // The vocabulary is closed at the write side, so a stored action is a member of it — and the
    // tuple itself holds no repetition, which would otherwise let two write paths share one value.
    expect(AUDIT_ACTIONS).toContain(row.action);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("stamps created_at with an ISO-8601 UTC instant carrying milliseconds, at the write", () => {
    const before = Date.now();
    const id = appendAuditEvent(db, baseInput);
    const after = Date.now();

    const row = storedRow(id);
    expect(row.created_at).toMatch(ISO_UTC_INSTANT);

    const instant = Date.parse(row.created_at);
    expect(Number.isNaN(instant)).toBe(false);
    expect(instant).toBeGreaterThanOrEqual(before - INSTANT_TOLERANCE_MS);
    expect(instant).toBeLessThanOrEqual(after + INSTANT_TOLERANCE_MS);
  });

  it("stores an absent reason as SQL NULL and a supplied one verbatim", () => {
    const withoutReason = appendAuditEvent(db, baseInput);
    const supplied = "Flagged for a limitation the version does not state.";
    const withReason = appendAuditEvent(db, { ...baseInput, reason: supplied });

    const absent = storedRow(withoutReason);
    // An absent reason is the absence, not an empty string: the column is nullable and the row type
    // declares `string | null`, so a writer that stored "" would report a reason where none exists.
    expect(absent.reason).toBeNull();
    expect(absent.reason).not.toBe("");

    expect(storedRow(withReason).reason).toBe(supplied);
  });

  it.each([
    { member: "actorAccountId", input: { ...baseInput, actorAccountId: "" } },
    { member: "actorAccountId", input: { ...baseInput, actorAccountId: "   " } },
    // No route can produce a blank action: the cast states the defect a runtime guard has to catch,
    // because the parameter's type is what closes the vocabulary at compile time.
    { member: "action", input: { ...baseInput, action: "" as AuditAction } },
    { member: "action", input: { ...baseInput, action: "   " as AuditAction } },
    { member: "resourceType", input: { ...baseInput, resourceType: "" as AuditResourceType } },
    { member: "resourceId", input: { ...baseInput, resourceId: "" } },
    { member: "resourceId", input: { ...baseInput, resourceId: "   " } },
  ])("refuses a blank $member with a TypeError naming it", ({ member, input }) => {
    const caught = refusalFrom(() => appendAuditEvent(db, input));

    expect(caught).toBeInstanceOf(TypeError);
    expect(messageOf(caught)).toContain(member);
    expect(auditRowCount()).toBe(rowsBeforeCase);
  });

  it.each([
    { statusCode: 99, why: "below the range the column accepts" },
    { statusCode: 600, why: "above the range the column accepts" },
    { statusCode: 1.5, why: "not an integer" },
  ])("refuses a statusCode of $statusCode, $why, with a RangeError", ({ statusCode }) => {
    const caught = refusalFrom(() => appendAuditEvent(db, { ...baseInput, statusCode }));

    expect(caught).toBeInstanceOf(RangeError);
    expect(messageOf(caught)).toContain("statusCode");
    expect(auditRowCount()).toBe(rowsBeforeCase);
  });

  it("appends inside the caller's transaction, so a later fault leaves neither row behind", () => {
    const auditRowsBefore = auditRowCount();
    expect(listingRowCount(TRANSIENT_LISTING_ID)).toBe(0);

    // One transaction around a domain write and its audit append, which is the shape a route uses:
    // the throw stands for the fault that happens after both and before the response.
    const routeWrite = db.transaction((): void => {
      db.prepare(
        `INSERT INTO listings
           (id, developer_account_id, slug, title, summary, category_id, license_code, pricing_model,
            status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        TRANSIENT_LISTING_ID,
        SEED_DEVELOPER_ACCOUNT_ID,
        "transient-listing",
        "Transient Listing",
        "A listing the rollback case inserts and does not keep.",
        SEED_CATEGORY_ORDER_INTAKE_ID,
        "MIT",
        "purchase",
        "active",
        "2024-04-01T09:00:00.000Z",
        "2024-04-01T09:00:00.000Z",
      );

      appendAuditEvent(db, { ...baseInput, resourceId: TRANSIENT_LISTING_ID });

      throw new Error("the write failed after the domain row and the audit append");
    });

    expect(() => routeWrite()).toThrow(
      "the write failed after the domain row and the audit append",
    );
    expect(listingRowCount(TRANSIENT_LISTING_ID)).toBe(0);
    expect(auditRowCount()).toBe(auditRowsBefore);
  });

  it("refuses an UPDATE and a DELETE with the trigger's own message, unchanged row", () => {
    const id = appendAuditEvent(db, {
      ...baseInput,
      reason: "The reason the row was written with.",
    });
    const before = storedRow(id);

    expect(() =>
      db.prepare(`UPDATE ${TABLE} SET reason = ? WHERE id = ?`).run("rewritten", id),
    ).toThrow(triggerMessageFor("BEFORE UPDATE"));
    expect(() => db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id)).toThrow(
      triggerMessageFor("BEFORE DELETE"),
    );

    const after = storedRow(id);
    expect(after).toStrictEqual(before);
    // Byte for byte: the serialized row is the same string, so no column and no spelling of one
    // changed under the two refused statements.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

/**
 * The value a call expected to refuse threw, or a failure when the call returned instead.
 *
 * The caught value is deliberately not narrowed here: each case asserts the class it expects with
 * its own `toBeInstanceOf`, so a refusal of the wrong kind fails the case rather than being cast into
 * looking like the expected one.
 */
function refusalFrom(attempt: () => unknown): unknown {
  let threw = false;
  let refusal: unknown;
  try {
    attempt();
  } catch (error) {
    threw = true;
    refusal = error;
  }
  if (!threw) {
    throw new Error("expected the call to refuse, but it returned");
  }
  return refusal;
}
