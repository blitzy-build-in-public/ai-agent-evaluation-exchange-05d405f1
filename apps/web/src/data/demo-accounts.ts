/**
 * The six synthetic demo accounts the demonstration offers, and the two lookups the account
 * switcher and the surfaces built on it need.
 *
 * Each account is a fictional handle and a fictional label and nothing else: this module
 * declares no personal name, no contact detail, no credential and no sign-in material, and
 * none may be added, because a demo session carries no authentication to vouch for.
 *
 * An identifier here is a cross-workspace literal contract rather than a display value. It is
 * the value `apps/web/src/api-client.ts` sends in the `X-Demo-Account` write header, and the
 * value the API resolves against the seeded `accounts` rows; a mismatch is therefore a `401`
 * on the first write rather than a compile error, which is why the six identifiers are taken
 * verbatim from the seed instead of being chosen here.
 *
 * The header is a synthetic role selector and never authentication: it separates the
 * demonstration's roles and asserts nothing about who the caller is. The visible label that
 * says so — `DEMO_AUTHENTICATION_LABEL`, owned by `@adem/shared` — is rendered by
 * `apps/web/src/components/demo-banner.tsx` and is deliberately not restated here.
 *
 * The module is inert data plus two pure lookups: no rendering, no request, no browser
 * storage, no clock, no randomness and no I/O. Importing it loads nothing and writes nothing;
 * building the frozen constants below is its only module-level statement.
 */

import type { AccountRole, DemoSession } from "@adem/shared";

/**
 * One synthetic demo account: the session shape the API resolves from the write header, plus
 * the identifier under the short field name the switcher and the pages read.
 *
 * Extending {@link DemoSession} rather than declaring a second, parallel shape is deliberate:
 * a switcher entry and the session the API resolves from its header then carry the same field
 * names, and neither `id` nor `account_id` is authored as an independently typed string — both
 * are written from one constant per account, so the two names cannot hold different values.
 */
export interface DemoAccount extends DemoSession {
  /** The demo account identifier — the same value as `account_id`, exposed under `id`. */
  readonly id: string;
}

/**
 * The `accounts.id` of each synthetic account.
 *
 * `apps/api/src/seed/seed-data.ts` is the source of truth for all six: the identifiers, the
 * handles, the roles and the labels below are that file's values, so the account the switcher
 * offers and the `accounts` row the API resolves from the header are one account and cannot
 * drift apart. They are reused verbatim rather than restated in a second spelling, which also
 * keeps this module's identifiers free of the long digit runs that file's id scheme avoids.
 */
const DEMO_DEVELOPER_ID = "acct0001-0a1b-4c2d-9e3f-a1b2c3d4e5f6";
const DEMO_SECOND_DEVELOPER_ID = "acct0002-1b2c-4d3e-8f4a-b2c3d4e5f6a7";
const DEMO_BUYER_ID = "acct0003-2c3d-4e4f-9a5b-c3d4e5f6a7b8";
const DEMO_SECOND_BUYER_ID = "acct0004-3d4e-4f5a-8b6c-d4e5f6a7b8c9";
const DEMO_CONTRIBUTOR_ID = "acct0005-4e5f-4a6b-9c7d-e5f6a7b8c9da";
const DEMO_OPERATOR_ID = "acct0006-5f6a-4b7c-8d8e-f6a7b8c9dae1";

/**
 * The six synthetic accounts, one frozen array of frozen entries: `readonly` is the
 * compile-time promise that {@link Object.freeze} keeps at run time, so neither the collection
 * nor an entry can be edited after import.
 *
 * The order is a contract rather than a convenience. Roles run *developer, buyer, contributor,
 * operator, developer, buyer*, so a switcher groups the accounts in the order `ACCOUNT_ROLES`
 * fixes while each role that holds a second account keeps a stable order of its own — the first
 * developer and the first buyer come before their seconds everywhere.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = Object.freeze([
  Object.freeze({
    id: DEMO_DEVELOPER_ID,
    account_id: DEMO_DEVELOPER_ID,
    handle: "demo-developer",
    role: "developer",
    display_label: "Demo developer account",
  }),
  Object.freeze({
    id: DEMO_BUYER_ID,
    account_id: DEMO_BUYER_ID,
    handle: "demo-buyer",
    role: "buyer",
    display_label: "Demo buyer account",
  }),
  Object.freeze({
    id: DEMO_CONTRIBUTOR_ID,
    account_id: DEMO_CONTRIBUTOR_ID,
    handle: "demo-contributor",
    role: "contributor",
    display_label: "Demo contributor account",
  }),
  Object.freeze({
    id: DEMO_OPERATOR_ID,
    account_id: DEMO_OPERATOR_ID,
    handle: "demo-operator",
    role: "operator",
    display_label: "Demo operator account",
  }),
  Object.freeze({
    id: DEMO_SECOND_DEVELOPER_ID,
    account_id: DEMO_SECOND_DEVELOPER_ID,
    handle: "demo-developer-two",
    role: "developer",
    display_label: "Second demo developer account",
  }),
  Object.freeze({
    id: DEMO_SECOND_BUYER_ID,
    account_id: DEMO_SECOND_BUYER_ID,
    handle: "demo-buyer-two",
    role: "buyer",
    display_label: "Second demo buyer account",
  }),
]);

/**
 * The account whose identifier is `id`, or `null` when no account carries it.
 *
 * The lookup never throws and never reports why a value did not match, because its callers
 * hold whatever a previous visit left behind: `null`, `undefined`, an empty or whitespace-only
 * string, an identifier from a retired account and a value typed into storage by hand all
 * yield `null`, which a caller renders as the switcher's unselected state.
 */
export function findDemoAccount(id: string | null | undefined): DemoAccount | null {
  return DEMO_ACCOUNTS.find((account) => account.id === id) ?? null;
}

/**
 * Every account holding this role, in {@link DEMO_ACCOUNTS} order, as a new array.
 *
 * The result is a copy, so a caller may sort, slice or retain it without reaching
 * {@link DEMO_ACCOUNTS}; the shared constant is never mutated and the call never throws. A
 * role with no account yields an empty array, which is a complete answer rather than an error.
 */
export function demoAccountsForRole(role: AccountRole): readonly DemoAccount[] {
  return DEMO_ACCOUNTS.filter((account) => account.role === role);
}
