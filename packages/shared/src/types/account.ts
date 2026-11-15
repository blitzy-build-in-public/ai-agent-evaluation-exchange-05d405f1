/**
 * The `accounts` row and the closed role vocabulary the whole product speaks.
 *
 * Exactly four roles exist — developer, buyer, community contributor and
 * operator — and every write route checks the resolved account's role against
 * the one its contract row requires. The `X-Demo-Account` header names one of the
 * synthetic demo accounts; an absent or unresolvable account is `401`, a
 * resolvable account with the wrong role is `403`.
 *
 * The header is a synthetic role selector, never authentication: it separates
 * roles for demonstration and asserts nothing about who the caller is. Nothing
 * here may grow a sign-in field, and no code may describe these accounts as a
 * login or a session.
 *
 * The module declares types and one tuple and holds no logic: validation is
 * `packages/shared/src/schemas/*`'s job and derivation is the domain packages'.
 */

/**
 * The four account roles, in the order the schemas and the seed data use.
 *
 * `packages/shared/src/schemas/*` builds its JSON Schema `enum` arrays from this
 * tuple, so the role type and the wire contract cannot drift apart. The set is
 * closed: a fifth role would silently widen the auth and moderation enums and
 * change the `403` contract the API promises.
 */
export const ACCOUNT_ROLES = ["developer", "buyer", "contributor", "operator"] as const;

/**
 * One account role, derived from {@link ACCOUNT_ROLES} rather than restated, so
 * the vocabulary has exactly one definition in the repository.
 */
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * The identifier of a demo account: a UUID string, the type of `accounts.id`.
 *
 * It is the value a client sends in the `X-Demo-Account` header, and the value
 * `DemoSession.account_id` carries in the sibling `demo-label.ts`.
 */
export type AccountId = string;

/**
 * One row of the `accounts` table, and the resolved demo session.
 *
 * The seed writes six synthetic rows — one per role in {@link ACCOUNT_ROLES}
 * plus two extras — and `handle` and `display_label` are fictional demo handles
 * and labels. The row is deliberately identity-free: it holds no personal name,
 * no contact detail and no sign-in material, because a demo session carries no
 * authentication to vouch for. The `accounts` table has no such column and none
 * may be added — real personal information and contact details are excluded from
 * this repository, and the exclusion scan fails the build on a contact detail.
 *
 * Property names are snake_case so the database column, the JSON payload and
 * this type share one spelling and no route needs a renaming layer.
 */
export interface Account {
  id: AccountId;
  handle: string;
  role: AccountRole;
  display_label: string;
}
