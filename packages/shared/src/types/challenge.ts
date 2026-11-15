/**
 * The public challenge board: a buyer's question about a listing, and the
 * responses that question collects.
 *
 * The two entities are deliberately asymmetric. A `challenges` row is mutable in
 * exactly one column — `status` — while a `challenge_responses` row is written
 * once and never edited. Types are declared below so that asymmetry.
 */

/**
 * The closed vocabulary for `challenges.status`, matching the `CHECK` constraint
 * in the migration that creates the table.
 *
 * Answering a challenge flips `open` to `responded`; the question text is never
 * rewritten. A third value cannot be added without a plan revision.
 */
export const CHALLENGE_STATUSES = ['open', 'responded'] as const;

/** The status of a challenge on the public board. */
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

/**
 * A `challenges` row, read publicly by `GET /challenges`.
 *
 * The status is the only column a response changes: the response is appended to
 * `challenge_responses` and this row's status moves from `open` to `responded`.
 *
 * `buyer_account_id` references `accounts.id` and names one of the six synthetic
 * demo accounts, so it carries no personal identity. `created_at` is an ISO-8601
 * UTC string written at insert time by `apps/api`.
 *
 * A successful write appends an `audit_events` row of resource type `challenge`.
 */
export interface Challenge {
  id: string;
  listing_id: string;
  buyer_account_id: string;
  question: string;
  status: ChallengeStatus;
  created_at: string;
}

/**
 * The `POST /challenges` body, written by a buyer.
 *
 * The writer's identity is resolved on the server from the `X-Demo-Account`
 * header — a synthetic role selector and never authentication — so it is absent
 * here by design: a client-supplied account field would let a caller write as
 * another account. A missing or unresolvable header is `401`, a wrong role is
 * `403`, an unknown `listing_id` is `404`, and a malformed body is `400`.
 *
 * This is the shape only; the JSON schema that validates the route body lives
 * with the route.
 */
export interface ChallengeCreateBody {
  listing_id: string;
  question: string;
}

/**
 * A `challenge_responses` row, written by `POST /challenges/{id}/responses`.
 *
 * Append-only by route design: no route updates or deletes one, which is why
 * there is no `updated_at` field. This table is not among those guarded by the
 * append-only triggers in the migration set, so nothing may claim a database
 * trigger protects it.
 *
 * Either the buyer who asked the question or the listing's developer may
 * respond, so no single role is implied by `account_id` — named `account_id`,
 * not `author_account_id`, to match the column.
 *
 * A successful write appends an `audit_events` row of resource type
 * `challenge_response`.
 */
export interface ChallengeResponse {
  id: string;
  challenge_id: string;
  account_id: string;
  body: string;
  created_at: string;
}

/**
 * The `POST /challenges/{id}/responses` body.
 *
 * The challenge being answered comes from the path, which is why `challenge_id`
 * is absent here. The responder's identity is likewise resolved from the
 * `X-Demo-Account` header on the server, for the same reason
 * {@link ChallengeCreateBody} carries no account field.
 */
export interface ChallengeResponseBody {
  body: string;
}
