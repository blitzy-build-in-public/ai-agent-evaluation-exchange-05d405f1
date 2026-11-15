/**
 * The demo account the {@link DEMO_ACCOUNT_HEADER} request header names: resolved from the seed rows
 * of `accounts`, by exact equality, before any non-public route does anything.
 *
 * {@link resolveDemoAccount} is the required form — it answers the row a header names, or refuses
 * the request with `401`. Two kinds of caller reach it: the nineteen non-public rows of the contract
 * table, and the composition root's error mapper, which calls it to decide the status of a request a
 * route's schema rejected. {@link resolveOptionalDemoAccount} answers the same question without ever
 * refusing, and exists for exactly one caller: `GET /listings/{id}` must return a hidden listing to
 * the operator while everyone else gets `404`, and a public read may not turn into a `401`.
 *
 * **It reads, and it only reads.** One row is looked up by exact equality on `id` and then on
 * `handle`; the four columns of that table are selected and returned unchanged, and no statement in
 * this file is an `INSERT`, an `UPDATE` or a `DELETE`. Nothing is prepared ahead of time and nothing
 * is cached between requests: the handle belongs to the caller (ports and adapters), so this module
 * opens no connection, holds no shared mutable state, reads no clock, logs nothing and writes nothing.
 *
 * **The header is a synthetic role selector, and it is never authentication.** It is trivially
 * impersonable by design: it separates roles for a demonstration and asserts nothing about who the
 * caller is. The load therefore falls on the per-route role check
 * (`apps/api/src/auth/require-role.ts`), the write rate limit, the append-only record, and the visible
 * `DEMO_AUTHENTICATION_LABEL` ("demo only, no production authentication") the UI renders. There is no
 * credential to compare and no column that could hold one: the header's value is an identifier of a
 * seed row and nothing more.
 *
 * Its two outcomes are `401` — the header is absent, blank, or names no seeded account, refused here
 * — and `403`, which `requireRole` raises for a resolved account whose role the route does not accept.
 * This file produces `401` and nothing else: no `403`, no `404`, no `500`, and no pass.
 *
 * The nineteen non-public rows of the API contract table call {@link resolveDemoAccount} — the
 * fifteen writes and the four operator-only reads, each having attached `demoAccountHeaderSchema` to
 * its own header. Every public read resolves no account at all, and `GET /listings/{id}` is the one
 * row that reads the tolerant variant.
 *
 * **A caller reads the header by its lowercased name.** Fastify exposes request header names
 * lowercased, so the value a row passes in is
 * `request.headers[DEMO_ACCOUNT_HEADER.toLowerCase()]`; reading the mixed-case key yields `undefined`
 * and is answered `401` as an absent header. That expression belongs to the call site — this module is
 * handed the value — and it is stated here because the mistake is silent at compile time and at run
 * time both, and no test of this module can see it.
 */

// The handle's type is imported by name because `@types/better-sqlite3` exports a namespace whose
// `Database` member is the instance interface, so a default *type* import of that package resolves to
// the namespace rather than to a type and does not compile.
import type { Database } from "better-sqlite3";

import type { Account, AccountRole } from "@adem/shared";
import { ACCOUNT_ROLES, DEMO_ACCOUNT_HEADER } from "@adem/shared";

import { ApiError } from "../errors/error-envelope";

/**
 * The resolved demo account.
 *
 * It IS the `accounts` row shape — `Account` from `@adem/shared` — under the name the request side
 * calls it, so nothing renames a field on the way out: a consumer reads `account.id` as the actor of
 * an append, `account.role` for the role check and `account.display_label` for display, all in the
 * spelling the database column, the JSON payload and the shared type use.
 *
 * The alias carries no second role union: {@link AccountRole} is the closed vocabulary
 * `ACCOUNT_ROLES` declares, and this file narrows a stored role to it rather than restating it.
 */
export type DemoAccount = Account;

/**
 * One stored row of `accounts`, in the shape the table holds it: the four columns
 * `packages/shared/migrations/0001_accounts_and_categories.sql` declares, in its order, so the select
 * list below can be read against the schema line by line.
 *
 * It is the declared result of the prepared statements, which is what removes the need for a cast when
 * the row is mapped.
 *
 * `role` is a plain `string` here although the column carries
 * `CHECK (role IN ('developer', 'buyer', 'contributor', 'operator'))`: the column is stored as text,
 * and narrowing it to `AccountRole` is the mapping step's job below, done by searching the shared
 * tuple rather than by asserting the type.
 */
interface DemoAccountRow {
  readonly id: string;
  readonly handle: string;
  readonly role: string;
  readonly display_label: string;
}

/**
 * The four columns every lookup in this file selects, named explicitly rather than through
 * `SELECT *`: a row is mapped member by member below, so a column a later migration adds stays out of
 * the result until this line and {@link DemoAccountRow} are updated together, while `SELECT *` would
 * quietly change every answer this module gives.
 */
const SELECTED_COLUMNS = "id, handle, role, display_label";

/**
 * The two lookups, each an exact equality and nothing else.
 *
 * `id` is asked first because the contract names the header's value `<accountId>` and the seed writes
 * every `accounts.id`; `handle` is asked second because the demo-account switcher may legitimately
 * carry the fictional handle a reader sees rather than the identifier behind it, and both are unique —
 * `id` as the primary key, `handle` by the table's own `UNIQUE` constraint.
 *
 * Neither matches a pattern, a prefix or a different case: an account is named exactly or it is not
 * named. One row at most can come back from either, so there is no ordering to fix and no ambiguity
 * to resolve.
 */
const SELECT_ACCOUNT_BY_ID = `SELECT ${SELECTED_COLUMNS} FROM accounts WHERE id = ?`;
const SELECT_ACCOUNT_BY_HANDLE = `SELECT ${SELECTED_COLUMNS} FROM accounts WHERE handle = ?`;

/**
 * The one header value to act on, or `null` when there is none to act on.
 *
 * Fastify's header map is typed `string | string[] | undefined` and all three members arrive here:
 * `undefined` when the header is absent, a `string` in the ordinary case — including a header a
 * client repeated, which the server joins into one comma-separated value — and an array for the
 * headers Fastify does deliver as arrays.
 *
 * An array takes its first element. That choice is fixed here, once, so behaviour cannot vary
 * silently between two readers of this module. A joined value is left exactly as it arrived and
 * matches no account when it names more than one, because the lookups below are exact equality and
 * this function repairs nothing. Anything that is not a string is absent, and a value that is empty
 * or whitespace-only after trimming is absent too: the header schema at the edge requires
 * `minLength: 1`, and this normalisation is what makes that requirement hold for a path that does not
 * pass through it.
 *
 * The supplied value is never echoed: it reaches two parameterised lookups and no message, no log and
 * no response.
 */
function normaliseHeaderValue(header: string | string[] | undefined): string | null {
  const supplied: unknown = Array.isArray(header) ? header[0] : header;

  if (typeof supplied !== "string") {
    return null;
  }

  const trimmed = supplied.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The stored row an exact-equality value names, or `undefined` when it names none.
 *
 * The statement is prepared per call — twice at most, and the second only when the first misses —
 * because a prepared statement belongs to the connection that made it and this module owns no
 * connection: the handle is the caller's, as ports and adapters require. SQLite caches the compiled
 * statement itself, so the per-call `prepare` allocates no plan of its own, and no statement is kept
 * in module state, which is what keeps two requests from sharing anything.
 *
 * Both statements are reads. Neither a hit nor a miss changes a row.
 */
function readAccountRow(database: Database, value: string): DemoAccountRow | undefined {
  const byId = database.prepare<[string], DemoAccountRow>(SELECT_ACCOUNT_BY_ID).get(value);

  if (byId !== undefined) {
    return byId;
  }

  return database.prepare<[string], DemoAccountRow>(SELECT_ACCOUNT_BY_HANDLE).get(value);
}

/**
 * The row as the demo account it is, or `null` when its role is not one of the four the product
 * speaks.
 *
 * The role is narrowed by searching {@link ACCOUNT_ROLES} for a member equal to the stored string,
 * which yields `AccountRole | undefined` without a cast — and the tuple, not this type, is what makes
 * the vocabulary closed. The column's `CHECK` constraint makes a fifth role unwritable, so a search
 * that finds nothing describes a row this product cannot have; refusing it is the default-deny reading
 * of `401` for an account that cannot be resolved, rather than inventing a role or passing the string
 * on as though it were one.
 *
 * Every field is returned as the row holds it. Nothing is derived, defaulted or reformatted here.
 */
function toDemoAccount(row: DemoAccountRow): DemoAccount | null {
  const role: AccountRole | undefined = ACCOUNT_ROLES.find((candidate) => candidate === row.role);

  if (role === undefined) {
    return null;
  }

  return {
    id: row.id,
    handle: row.handle,
    role,
    display_label: row.display_label,
  };
}

/**
 * The account a header names, or `null` for every way it can name none.
 *
 * The single implementation of the lookup: both exports below delegate here, so the query, the
 * normalisation and the narrowing exist once and the two answers cannot drift apart.
 *
 * This function performs no role check. Deciding whether the resolved account may act is
 * `apps/api/src/auth/require-role.ts`'s job; this answers one question only — which seeded account, if
 * any, does this header name.
 */
function lookupDemoAccount(
  database: Database,
  header: string | string[] | undefined,
): DemoAccount | null {
  const value = normaliseHeaderValue(header);

  if (value === null) {
    return null;
  }

  const row = readAccountRow(database, value);

  if (row === undefined) {
    return null;
  }

  return toDemoAccount(row);
}

/**
 * The demo account {@link DEMO_ACCOUNT_HEADER} names.
 *
 * Returns that account, carrying the `id` a route appends as the actor of its audit event and the
 * `role` `requireRole` checks.
 *
 * Refuses with `401` `unauthorized` in three cases, which are one refusal path because a client
 * answers them alike: the header is absent, its value is empty or whitespace-only, or the value names
 * no seeded account — including a row whose stored role is not one of the four the product speaks,
 * which cannot be written and cannot be resolved. The message names the header, never its value, says
 * nothing about credentials, and claims nothing about identity: the header selects a role and this
 * function looks up a seed row.
 *
 * Its refusal is that `ApiError` and nothing else: it raises no bare `Error` of its own, asserts
 * nothing and produces no other status. It is synchronous, side-effect free and cheap, because it is
 * the step between a route's schema validation and its work.
 */
export function resolveDemoAccount(
  database: Database,
  header: string | string[] | undefined,
): DemoAccount {
  const account = lookupDemoAccount(database, header);

  if (account === null) {
    throw ApiError.unauthorized(
      `${DEMO_ACCOUNT_HEADER} is missing or does not name a demo account.`,
    );
  }

  return account;
}

/**
 * The demo account {@link DEMO_ACCOUNT_HEADER} names, or `null` — never a refusal.
 *
 * It exists for exactly one caller: `GET /listings/{id}` is a public read that must stay `200`, so a
 * header that is absent, blank or unresolvable cannot become a `401` there. The route resolves the
 * account only to decide whether the caller may be shown a hidden listing, and `null` means "no
 * operator here", which is the answer every other reader of a public read gets. The required form
 * carries the second caller of the pair: the composition root's error mapper asks it whether a
 * rejected request established no identity, because the status that request is answered with depends
 * on the answer.
 *
 * It answers `null` for all of the cases {@link resolveDemoAccount} refuses, and for a lookup that
 * fails outright: the promise is that this function never throws, so a failure of the underlying read
 * is reported as `null` rather than reaching a client of a public read as a `500`. Nothing is repaired,
 * retried or substituted — the account could not be resolved, and an unresolved account is `null`.
 *
 * It performs no role check, exactly as the required form does not.
 */
export function resolveOptionalDemoAccount(
  database: Database,
  header: string | string[] | undefined,
): DemoAccount | null {
  try {
    return lookupDemoAccount(database, header);
  } catch {
    return null;
  }
}
