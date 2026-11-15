/**
 * The demo-session vocabulary: the label that must be visible wherever the demo
 * account switcher appears, and the shape of the demo session the API resolves
 * from the `X-Demo-Account` header.
 *
 * This module declares **types only** — no constant, no function, no class, no
 * validation, no default value. `../index` re-exports it with `export type *`,
 * which is only sound while nothing here has a runtime value; and the one string
 * it concerns is owned by `../constants` and merely typed here, so the API and
 * the UI cannot drift into saying different sentences about a demo session.
 *
 * The header name is not declared here: it is owned by
 * `../schemas/auth-header-schema.ts`, and two modules exporting one identifier
 * would collide through `../index`'s `export *`.
 */

import { DEMO_AUTHENTICATION_LABEL } from "../constants";
import type { AccountRole } from "./account";

/**
 * The visible demo-authentication label, whose type is the literal type of
 * `DEMO_AUTHENTICATION_LABEL` in `../constants` — that is, the single string
 * `"demo only, no production authentication"`.
 *
 * It is the copy the demo banner renders wherever the account switcher appears,
 * and it is what tells a reader that the selected account is a synthetic role
 * selector rather than an identity. Deriving the type from the constant is what
 * keeps that disclosure one sentence in one place: this module types the value
 * and never restates it, so a component that annotates its label with this type
 * cannot render a different one and still compile.
 */
export type DemoAuthenticationLabel = typeof DEMO_AUTHENTICATION_LABEL;

/**
 * One demo session: both a switcher entry in `apps/web/src/data/demo-accounts.ts`
 * and the session `apps/api/src/auth/resolve-demo-account.ts` resolves from the
 * `X-Demo-Account` header. One interface serves both sides of the wire, so the
 * account the UI offers and the account the server resolves cannot drift apart.
 *
 * `account_id` is the value of `Account.id` (the sibling `./account`) and is the
 * string a client sends in the header; `handle` and `display_label` are fictional
 * demo handles and labels. Neither may be a real personal name, an email address
 * or a telephone number — the seed data and every fixture are synthetic.
 *
 * **The header is a synthetic role selector and never authentication.** It
 * separates roles for a demonstration and asserts nothing about who the caller
 * is: it is trivially impersonable by design, and that is why every write path
 * checks the role carried here. An absent or unresolvable account is `401`, a
 * resolvable account whose role does not match the route is `403`, and no route
 * may treat the header as proof of identity.
 *
 * For the same reason the session carries no sign-in material of any kind — no
 * secret, no proof of possession, nothing that could be presented later — and its
 * `accounts` row has no column to hold one. There is no authentication here for
 * such a field to belong to, and adding one would invent a security claim the
 * product does not make.
 *
 * Property names are snake_case so the database column, the JSON payload and this
 * type share one spelling: `account_id` names the `accounts.id` value and is
 * deliberately not `id`, which would be `Account.id` under a second name, and
 * `display_label` is the `accounts.display_label` column. Every field is
 * required, so no consumer has to decide what an absent one means.
 */
export interface DemoSession {
  /** The `accounts.id` of the demo account; the value sent in the demo header. */
  account_id: string;
  /** A fictional demo handle, unique among the synthetic accounts. */
  handle: string;
  /** The role every non-public route checks before it writes anything. */
  role: AccountRole;
  /** A fictional label for display, free of any real personal detail. */
  display_label: string;
}
