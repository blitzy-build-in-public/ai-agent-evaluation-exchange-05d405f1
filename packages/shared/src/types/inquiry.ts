/**
 * The buyer inquiry and the body that creates one.
 *
 * Declarations only, by design: `packages/shared` holds the shapes the API validates against
 * and the UI renders, and none of the values in this module survives to runtime.
 */

/**
 * A row of the `inquiries` table.
 *
 * `buyer_account_id` references `accounts.id` and always names one of the six synthetic demo
 * accounts, so it carries no personal identity. `created_at` is an ISO-8601 UTC string written
 * at insert time by `apps/api`; SQLite's `CURRENT_TIMESTAMP` is deliberately not used here
 * because it yields `YYYY-MM-DD HH:MM:SS` rather than the form this contract requires.
 *
 * The row is mutable in the schema, so it claims nothing about being append-only — and in this
 * release no route updates or deletes one, which is why an inquiry is written once by
 * `POST /inquiries` and read back unchanged.
 *
 * The shape holds a message on a listing and nothing else. An inquiry is not a channel: no
 * contact detail, payment detail or financial information of any kind is collected from a
 * buyer, and no field below can hold one.
 */
export interface Inquiry {
  id: string;
  listing_id: string;
  buyer_account_id: string;
  message: string;
  created_at: string;
}

/**
 * The `POST /inquiries` request body.
 *
 * Written only by a buyer, carrying the `X-Demo-Account` header. That header is a synthetic
 * role selector and never authentication, so the server resolves it and takes the buyer's
 * account id from the resolved demo session; the id is deliberately absent here, because a
 * client-supplied `buyer_account_id` would let a caller write an inquiry as another account.
 *
 * A missing or unresolvable header is the contract's `401`, a resolved account that is not a
 * buyer is `403`, and a `listing_id` that names no listing is `404`. Validation of this body
 * belongs to the route's JSON schema, not to the type.
 *
 * A successful write appends an `audit_events` row of resource type `inquiry`.
 */
export interface InquiryCreateBody {
  listing_id: string;
  message: string;
}
