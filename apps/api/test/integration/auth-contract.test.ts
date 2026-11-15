/**
 * Integration proof for the two halves of the demo-account auth pair —
 * `apps/api/src/auth/resolve-demo-account.ts` (`401`) and `apps/api/src/auth/require-role.ts` (`403`)
 * — against the real `accounts` table built by `runMigrations` from the ordered files in
 * `packages/shared/migrations/` and seeded from `SEED_ACCOUNTS`.
 *
 * This file covers **the whole auth failure surface of `apps/api`**: `401` comes from the resolver
 * and from nowhere else, `403` comes from the role check and from nowhere else, and the two are never
 * interchanged — a resolvable account is never answered as unauthenticated, and a wrong role is never
 * answered as a missing resource. The header is a synthetic role selector and not authentication, so
 * every case here asserts a status and an envelope code rather than any identity.
 *
 * One `:memory:` handle, opened, migrated and seeded by this file alone, holds all six seeded rows
 * plus one row whose stored role is outside the four the product speaks — a row the schema's own
 * `CHECK (role IN (...))` refuses, written under `PRAGMA ignore_check_constraints = ON` and reached
 * only through the resolver's default-deny reading of an account that cannot be resolved. The pragma
 * is restored before any case runs, and the case below re-asserts that the column refuses such a row
 * once it is off, so the row is evidence about the resolver rather than about a weakened schema.
 *
 * Nothing here reads a clock, a network, an environment variable or a locale: every expected value is
 * a seeded row, a literal, or the factory's own default sentence obtained by calling the factory.
 */

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Account, AccountRole } from "@adem/shared";
import { ACCOUNT_ROLES, DEMO_ACCOUNT_HEADER } from "@adem/shared";

import { requireRole, type DemoRole } from "../../src/auth/require-role";
import {
  resolveDemoAccount,
  resolveOptionalDemoAccount,
  type DemoAccount,
} from "../../src/auth/resolve-demo-account";
import { runMigrations } from "../../src/db/migrate";
import { ApiError } from "../../src/errors/error-envelope";
import { SEED_ACCOUNTS, SEED_DEVELOPER_ACCOUNT_ID } from "../../src/seed/seed-data";

/**
 * The `accounts.id` of a row whose stored role is outside the four the product speaks, in the seed's
 * own id shape.
 *
 * No route can write it: the column's `CHECK` refuses a fifth role, so this row exists only because
 * the case that seeds it turns that guard off for one INSERT. It is the input the resolver's
 * narrowing step refuses, which is the default-deny reading of an account that cannot be resolved.
 */
const RETIRED_ROLE_ACCOUNT_ID = "acct9001-6a7b-4c8d-9e9f-a7b8c9dae1f2";

/** The handle of that row, fictional and naming no role of the four. */
const RETIRED_ROLE_ACCOUNT_HANDLE = "demo-retired-role";

/** The fifth role the schema refuses, spelled the way a retired vocabulary would be. */
const RETIRED_ROLE = "archivist";

/**
 * A header value that names no seeded account, and whose text appears nowhere in the refusal the
 * resolver sends — which is what lets the case below assert that the sentence does not echo it.
 */
const UNKNOWN_HEADER_VALUE = "no-such-demo-handle";

/**
 * One header the resolver must refuse, with the name the cases are reported under. The set is shared
 * by the required form's cases and the tolerant form's, so both are asserted over the same inputs.
 */
interface RefusedHeaderCase {
  readonly label: string;
  readonly header: string | string[] | undefined;
}

/**
 * Every way the header names no account: absent, empty, whitespace-only, a repeated header the server
 * joins into one comma-separated value, a value naming no row, a row whose role is outside the four,
 * an empty array, and an array whose first element names no row.
 */
const refusedHeaders: readonly RefusedHeaderCase[] = [
  { label: "an absent header", header: undefined },
  { label: "an empty header", header: "" },
  { label: "a whitespace-only header", header: "   " },
  {
    label: "a repeated header joined into one comma-separated value",
    header: `${SEED_DEVELOPER_ACCOUNT_ID},${SEED_DEVELOPER_ACCOUNT_ID}`,
  },
  { label: "a value naming no seeded account", header: UNKNOWN_HEADER_VALUE },
  { label: "a row whose stored role is outside the four", header: RETIRED_ROLE_ACCOUNT_ID },
  { label: "an empty array", header: [] },
  { label: "an array whose first element names no seeded account", header: [UNKNOWN_HEADER_VALUE] },
];

/**
 * The words a refusal must not carry, in any spelling of their stem.
 *
 * The header names a synthetic account of a demonstration and is never authentication, so a sentence
 * that mentioned a credential, a session, a token or a login would describe a mechanism the product
 * does not have.
 */
const CREDENTIAL_WORDS = /credential|session|token|login|password|secret|authenticat/i;

/**
 * The two-valued requirement of the one contract row whose write role is two-valued — buyer or
 * developer for `POST /challenges/{id}/responses` — written out here because the role check takes it
 * as a readonly list rather than as a wildcard.
 */
const TWO_ROLE_REQUIREMENT: readonly DemoRole[] = ["buyer", "developer"];

let db: Database.Database;

/** The seeded rows, in the seed's own order, failing the case rather than the assertion when absent. */
function seededAccount(id: string): Account {
  const account = SEED_ACCOUNTS.find((candidate) => candidate.id === id);
  if (account === undefined) {
    throw new Error(`expected SEED_ACCOUNTS to hold the account ${id}`);
  }
  return account;
}

/** One seeded account of this role, so each requirement is asked of the account that carries it. */
function accountForRole(role: AccountRole): DemoAccount {
  const account = SEED_ACCOUNTS.find((candidate) => candidate.role === role);
  if (account === undefined) {
    throw new Error(`expected SEED_ACCOUNTS to hold an account with the role ${role}`);
  }
  return account;
}

/** The value a call expected to refuse threw, or a failure when the call returned instead. */
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

/** The refusal a call produced, failing the case when it refused with something other than an ApiError. */
function apiRefusalFrom(attempt: () => unknown): ApiError {
  const refusal = refusalFrom(attempt);
  if (!(refusal instanceof ApiError)) {
    throw new Error(`expected the call to refuse with an ApiError, received ${String(refusal)}`);
  }
  return refusal;
}

beforeAll(() => {
  db = new Database(":memory:");
  // SQLite leaves foreign keys off by default; nothing here references another table, and the product's
  // connection turns it on, so this handle is opened the same way the server's is.
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insertAccount = db.prepare(
    "INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)",
  );
  for (const account of SEED_ACCOUNTS) {
    insertAccount.run(account.id, account.handle, account.role, account.display_label);
  }

  // One row the closed vocabulary would refuse, written with the guard off and the guard restored in
  // the same breath. The finally block is what keeps a failed INSERT from leaving the pragma set for
  // every case that follows.
  db.pragma("ignore_check_constraints = ON");
  try {
    insertAccount.run(
      RETIRED_ROLE_ACCOUNT_ID,
      RETIRED_ROLE_ACCOUNT_HANDLE,
      RETIRED_ROLE,
      "Retired demo role account",
    );
  } finally {
    db.pragma("ignore_check_constraints = OFF");
  }
});

afterAll(() => {
  db.close();
});

describe("resolveDemoAccount against the seeded accounts", () => {
  it("resolves every seeded account by its id and by its handle to that row's own values", () => {
    for (const account of SEED_ACCOUNTS) {
      expect(resolveDemoAccount(db, account.id)).toStrictEqual(account);
      expect(resolveDemoAccount(db, account.handle)).toStrictEqual(account);
    }
  });

  it("takes the first element of an array-valued header", () => {
    const account = seededAccount(SEED_DEVELOPER_ACCOUNT_ID);

    expect(resolveDemoAccount(db, [account.id])).toStrictEqual(account);
    expect(resolveDemoAccount(db, [account.handle, UNKNOWN_HEADER_VALUE])).toStrictEqual(account);
  });

  it.each(refusedHeaders)("refuses $label with 401 unauthorized", ({ header }) => {
    const refusal = apiRefusalFrom(() => resolveDemoAccount(db, header));

    expect(refusal.status).toBe(401);
    expect(refusal.code).toBe("unauthorized");
    // The sentence names the header the request lacked and nothing else: not the value the caller
    // supplied, and no credential, session, token or login.
    expect(refusal.message).toContain(DEMO_ACCOUNT_HEADER);
    expect(refusal.message).not.toMatch(CREDENTIAL_WORDS);
    if (typeof header === "string" && header.trim().length > 0) {
      expect(refusal.message).not.toContain(header.trim());
    }
  });
});

describe("resolveOptionalDemoAccount, the tolerant form a public read uses", () => {
  it("answers the account for a resolvable header", () => {
    const account = seededAccount(SEED_DEVELOPER_ACCOUNT_ID);

    expect(resolveOptionalDemoAccount(db, account.id)).toStrictEqual(account);
    expect(resolveOptionalDemoAccount(db, [account.id])).toStrictEqual(account);
  });

  it.each(refusedHeaders)("answers null for $label, without refusing", ({ header }) => {
    expect(resolveOptionalDemoAccount(db, header)).toBeNull();
  });

  it("answers null on a closed handle, where the required form propagates the driver's error", () => {
    // A handle of its own, migrated and closed, so this case can prove the closed-connection
    // behaviour without taking the shared handle away from the cases that follow it.
    const closed = new Database(":memory:");
    runMigrations(closed);
    closed.close();

    expect(resolveOptionalDemoAccount(closed, SEED_DEVELOPER_ACCOUNT_ID)).toBeNull();
    expect(resolveOptionalDemoAccount(closed, undefined)).toBeNull();

    // The required form answers nothing at all: the driver's own failure reaches the caller rather
    // than being reported as the `401` an unresolved header produces, which is what a public read
    // would otherwise turn into a refusal.
    const propagated = refusalFrom(() => resolveDemoAccount(closed, SEED_DEVELOPER_ACCOUNT_ID));
    expect(propagated).not.toBeInstanceOf(ApiError);
    expect(propagated).toBeInstanceOf(TypeError);
  });
});

describe("requireRole against the four seeded roles", () => {
  it("returns the identical account for its own role and refuses every other, across the four roles", () => {
    for (const required of ACCOUNT_ROLES) {
      for (const account of SEED_ACCOUNTS) {
        // The account the role check is chained on is the resolver's own return value, which is the
        // shape a route uses — so the identity asserted below is the identity across both halves.
        const resolved = resolveDemoAccount(db, account.id);

        if (account.role === required) {
          // Identity, not equality: a route chains the returned account into its audit append, so a
          // copy would be a second value where the contract promises one.
          expect(requireRole(resolved, required)).toBe(resolved);
          continue;
        }

        const refusal = apiRefusalFrom(() => requireRole(resolved, required));
        expect(refusal.status).toBe(403);
        expect(refusal.code).toBe("forbidden");
        expect(refusal.message).toBe(ApiError.forbidden().message);
        expect(refusal.message).not.toContain(account.id);
        expect(refusal.message).not.toContain(account.handle);
      }
    }
  });

  it("admits both roles of the list form and refuses the two it does not name", () => {
    const buyer = resolveDemoAccount(db, accountForRole("buyer").id);
    const developer = resolveDemoAccount(db, accountForRole("developer").id);

    expect(requireRole(buyer, TWO_ROLE_REQUIREMENT)).toBe(buyer);
    expect(requireRole(developer, TWO_ROLE_REQUIREMENT)).toBe(developer);

    for (const refused of ["contributor", "operator"] as const) {
      const account = resolveDemoAccount(db, accountForRole(refused).id);
      const refusal = apiRefusalFrom(() => requireRole(account, TWO_ROLE_REQUIREMENT));

      expect(refusal.status).toBe(403);
      expect(refusal.code).toBe("forbidden");
      expect(refusal.message).toBe(ApiError.forbidden().message);
    }
  });

  it("denies an empty requirement list rather than admitting every account", () => {
    for (const seeded of SEED_ACCOUNTS) {
      const account = resolveDemoAccount(db, seeded.id);
      const refusal = apiRefusalFrom(() => requireRole(account, []));

      expect(refusal.status).toBe(403);
      expect(refusal.code).toBe("forbidden");
      expect(refusal.message).toBe(ApiError.forbidden().message);
    }
  });

  it("mutates neither the account nor the requirement list, on a pass and on a refusal", () => {
    const account = resolveDemoAccount(db, accountForRole("buyer").id);
    const requirement: readonly DemoRole[] = ["buyer", "contributor"];
    const accountBefore = structuredClone(account);
    const requirementBefore = structuredClone(requirement);

    expect(requireRole(account, requirement)).toBe(account);
    apiRefusalFrom(() => requireRole(account, ["developer"]));
    apiRefusalFrom(() => requireRole(account, []));

    expect(account).toStrictEqual(accountBefore);
    expect(requirement).toStrictEqual(requirementBefore);
  });
});

describe("the accounts vocabulary the resolver narrows a stored role to", () => {
  it("holds the seeded rows and refuses a fifth role once the schema's guard is back on", () => {
    expect(ACCOUNT_ROLES).toHaveLength(4);
    expect(SEED_ACCOUNTS).toHaveLength(6);
    for (const account of SEED_ACCOUNTS) {
      expect(ACCOUNT_ROLES).toContain(account.role);
    }

    // The pragma was restored: the column refuses the fifth role again, so the retired-role row above
    // exists because one INSERT ran with the guard off, not because the schema admits a fifth role.
    expect(db.pragma("ignore_check_constraints", { simple: true })).toBe(0);
    expect(() =>
      db
        .prepare("INSERT INTO accounts (id, handle, role, display_label) VALUES (?, ?, ?, ?)")
        .run(
          "acct9002-7b8c-4d9e-8f1a-b8c9dae1f2a3",
          "demo-retired-role-two",
          RETIRED_ROLE,
          "Second retired demo role account",
        ),
    ).toThrow(/CHECK constraint failed/);
  });
});
