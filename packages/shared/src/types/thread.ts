/**
 * The public discussion board: a thread, its posts, and the two request bodies
 * that create them.
 *
 * This module declares types only — no constant, no function and no import.
 * Neither a thread nor a post has a closed vocabulary to publish (unlike a
 * challenge's status or a listing's status), so nothing here is a runtime value.
 * The JSON schemas that validate these bodies live with the threads route.
 */

/**
 * A `threads` row: one discussion thread on the public board.
 *
 * Any demo account may start a thread — developer, buyer, contributor or
 * operator — which is what makes the board a contribution surface rather than a
 * buyer-only one. The write routes therefore carry no role check, and a write
 * has no `403` case beyond the general rule: an absent or unresolvable
 * `X-Demo-Account` header is `401` and a malformed body is `400`. A successful
 * write appends an `audit_events` row of resource type `thread`.
 *
 * The table is mutable, but no route in this release modifies a thread: its
 * title is written once, which is why it carries no modification timestamp.
 */
export interface Thread {
  id: string;
  title: string;
  /**
   * `accounts.id` of one of the six synthetic demo accounts. It references a
   * fictional handle, so no personal identity and no real name reaches the board.
   */
  author_account_id: string;
  /**
   * ISO-8601 UTC, written at insert time by `apps/api`. SQLite's
   * `CURRENT_TIMESTAMP` is deliberately not used: it yields `YYYY-MM-DD HH:MM:SS`
   * rather than the ISO-8601 UTC form this project requires.
   */
  created_at: string;
}

/**
 * The `POST /threads` request body, written by any demo account that carries the
 * `X-Demo-Account` header.
 *
 * The author comes from the resolved demo session and is deliberately not a
 * client field: the header is a synthetic role selector that separates roles for
 * the demonstration and is never authentication.
 */
export interface ThreadCreateBody {
  title: string;
}

/**
 * A `thread_posts` row: one reply on a thread.
 *
 * Append-only by route design — no route updates or deletes a post — which is
 * why it carries no modification timestamp, no status and no revision field. A
 * successful write appends an `audit_events` row of resource type `thread_post`.
 */
export interface ThreadPost {
  id: string;
  thread_id: string;
  /** `accounts.id` of one of the six synthetic demo accounts. */
  author_account_id: string;
  body: string;
  /** ISO-8601 UTC, written at insert time by `apps/api`. */
  created_at: string;
}

/**
 * The `POST /threads/{id}/posts` request body.
 *
 * The thread being replied to comes from the path, not the body, so it is not
 * repeated here; the author comes from the resolved demo session, exactly as in
 * `ThreadCreateBody`.
 */
export interface ThreadPostBody {
  body: string;
}
