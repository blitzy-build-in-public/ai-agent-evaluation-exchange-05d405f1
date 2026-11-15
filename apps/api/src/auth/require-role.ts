/**
 * The role check: the demo account a non-public route resolved either carries the role its
 * contract row requires, or the request is refused with `403` — and the role refusal of this
 * workspace has this module as its only producer.
 *
 * It is the second half of the pair whose first half is
 * `apps/api/src/auth/resolve-demo-account.ts`, and the order between the two is fixed: that
 * module runs first and answers `401` when the demo-account header is absent, blank or names
 * no seeded account, and this one runs on the account it returned and answers `403` when the
 * account's role is not one the row accepts. Each status has exactly one source, and the two
 * are never interchanged: a resolvable account is never treated as unauthenticated, and a
 * wrong role is never answered as a missing resource, because a demo account that exists is
 * not concealed from its caller. Together they are the whole of the auth failure surface of
 * `apps/api` — no other module there raises either refusal. A route module does raise the same
 * status for a resource question — the ownership refusal the paragraph below leaves to the route
 * that owns the resource — and that refusal is raised where the resource is known and is no part of
 * the auth failure surface.
 *
 * **It also holds the one role question a route asks without a refusal.** {@link isOperator} answers
 * whether a resolved account is the operator, and it is the only other place a role question is asked,
 * so the rule has one implementation and one reviewer. It exists for the one public read that conceals
 * a resource instead of refusing a role: `GET /listings/{id}` answers a hidden listing to the operator
 * and that row's "unknown or removed" `404` to everyone else, so the caller asks the question through
 * the predicate rather than through {@link requireRole} — a concealment is not a role refusal. The
 * predicate raises nothing and produces no status, which keeps the role `403` of this workspace in
 * one place.
 *
 * **It is pure over its arguments.** The account arrives already resolved, so this module
 * opens no connection, takes no database handle, issues no statement, reads no clock, writes
 * no audit event and holds no module-level state. The same account and the same requirement
 * give the same answer every time, and a refusal leaves nothing behind: the account is
 * neither cloned nor mutated on either path.
 *
 * **It is default deny.** Only a requirement that names the account's role returns the
 * account. A requirement that matches nothing denies, and an empty requirement list denies
 * too rather than admitting everyone. There is no third outcome and no "unknown" answer.
 *
 * **It answers one question.** Whether the account may act is a role question and belongs
 * here; whether a listing, a version, a report or a challenge is the caller's own is a
 * resource question and belongs to the route that owns that resource — for instance
 * `apps/api/src/routes/listings.ts` for a version of another developer's listing, and
 * `apps/api/src/routes/evaluations.ts` for an evaluation of another developer's version.
 * Folding the second question in here would make one function answer two.
 *
 * **The list form exists for exactly one row.** `POST /challenges/{id}/responses` is the only
 * contract row whose write role is two-valued — buyer or developer — so it passes a readonly
 * list; every other non-public row passes one role and nothing else. The list is not a
 * wildcard: it still names roles, and a role outside it is refused like any other mismatch.
 *
 * **Two rows never call this function at all.** `POST /threads` and `POST /threads/{id}/posts`
 * admit any resolvable demo account and their contract row lists no `403`, so
 * `apps/api/src/routes/threads.ts` resolves the account and stops there. That is the contract
 * rather than an oversight: the exception lives at those call sites and must not be pulled in
 * here as a threads-specific branch, a wildcard role, or an "any" member of the vocabulary.
 *
 * The role vocabulary itself is not this file's to invent: see {@link DemoRole}.
 */

import type { DemoAccount } from "./resolve-demo-account";

import { ApiError } from "../errors/error-envelope";

/**
 * One role of the closed vocabulary, derived from the resolved account rather than restated.
 *
 * `DemoAccount` is `@adem/shared`'s `Account`, so this alias is exactly its `role` field —
 * `developer`, `buyer`, `contributor` or `operator`. The tuple `ACCOUNT_ROLES` in
 * `packages/shared/src/types/account.ts` remains the single definition of the set: the four
 * literals are spelled out nowhere in this file but the one {@link OPERATOR_ROLE} names, and no
 * second role type stands beside this alias, so a fifth role would have to change the shared
 * vocabulary before any call site accepted it.
 *
 * The import above is type-only, which is also what keeps this module and
 * `./resolve-demo-account` free of a run-time cycle: this file reads a type from that one,
 * and that one imports nothing from here.
 */
export type DemoRole = DemoAccount["role"];

/**
 * The operator role, named once for this module: the role the operator-only rows require of an account
 * and the one {@link isOperator} asks about.
 *
 * It is spelled here rather than written into the comparison below, so the operator rule has one
 * spelling beside its one implementation, and it is typed as the closed vocabulary's own member, so a
 * rename in `@adem/shared` fails this declaration rather than a comparison.
 */
const OPERATOR_ROLE: DemoRole = "operator";

/**
 * Returns the demo account when its role is one the requirement names, and refuses with `403`
 * `forbidden` when it is not.
 *
 * `role` is either the single role a contract row names or a readonly list of the roles it
 * accepts, the list form serving the one two-valued row named in this module's comment above.
 * The requirement is normalised to a list and the account's role is looked up in it, so both
 * forms take one code path and cannot drift apart. An empty list refuses.
 *
 * The refusal is an {@link ApiError} and nothing else, and its sentence is the factory's own
 * default, written once in `apps/api/src/errors/error-envelope.ts`: it names the role
 * requirement generically and says nothing about the account, the resource or the caller.
 * An override here would be a second wording for one fixed refusal, so none is passed.
 *
 * The same account is returned — the identical object — so a route can chain
 * `const actor = requireRole(resolveDemoAccount(database, header), "buyer")` and append
 * `actor.id` as the actor of its audit event without a second lookup and without a second
 * failure path.
 *
 * It is synchronous: nothing it does waits, and it starts nothing in the background.
 */
export function requireRole(
  account: DemoAccount,
  role: DemoRole | readonly DemoRole[],
): DemoAccount {
  // Narrow on the value's own type rather than with `Array.isArray`, which widens a readonly
  // array parameter to `any[]` and would then compare an untyped list.
  const allowed: readonly DemoRole[] = typeof role === "string" ? [role] : role;

  if (!allowed.includes(account.role)) {
    throw ApiError.forbidden();
  }

  return account;
}

/**
 * Whether the resolved account is the operator: the rule {@link requireRole} enforces for that role,
 * asked as a question instead of raised as a refusal.
 *
 * It answers `true` for an account whose role is {@link OPERATOR_ROLE} and `false` for every other
 * account, and for `null` as well — the "no operator here" answer
 * `apps/api/src/auth/resolve-demo-account.ts`'s `resolveOptionalDemoAccount` gives when the
 * demo-account header is absent, blank or names no seeded account. That answer is the reason this
 * predicate exists: `GET /listings/{id}` is a public read that must stay `200` for every caller, so it
 * resolves the header tolerantly and asks this question only to decide whether the caller may be shown
 * a hidden listing, answering that row's "unknown or removed" `404` to a non-operator rather than the
 * `403` a wrong role is otherwise refused with.
 *
 * It raises nothing and produces no status, which is what keeps the `403` of this module in one place:
 * a caller that needs the refusal calls {@link requireRole} and gets it, and this predicate answers the
 * one role question a route asks without one.
 *
 * It is pure over its argument, exactly as {@link requireRole} is: it opens no connection, issues no
 * statement, reads no clock and holds no state, so the same account always gives the same answer and
 * the account is neither cloned nor mutated.
 */
export function isOperator(account: DemoAccount | null): boolean {
  return account !== null && account.role === OPERATOR_ROLE;
}
