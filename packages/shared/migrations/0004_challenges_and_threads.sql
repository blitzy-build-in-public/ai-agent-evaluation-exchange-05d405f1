-- 0004_challenges_and_threads.sql
-- The public discussion surfaces: the buyer challenge board and the community threads.
-- Applied by apps/api/src/db/migrate.ts after 0003, whose listings and accounts this file
-- references.

-- A challenge asks a question about one listing and the listing's developer answers it
-- through challenge_responses. status is the only column a response changes, moving
-- 'open' to 'responded', which is why this table is mutable while its answer table is not;
-- DEFAULT 'open' gives every new challenge that state without the writer asserting it.
-- Written by POST /challenges, and the asker is a synthetic demo account of 0001.
CREATE TABLE challenges (
  id               TEXT PRIMARY KEY,
  listing_id       TEXT NOT NULL REFERENCES listings (id),
  buyer_account_id TEXT NOT NULL REFERENCES accounts (id),
  question         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded')),
  created_at       TEXT NOT NULL
);

-- The answers a challenge receives, written once by POST /challenges/{id}/responses.
-- Append-only by route design: the route inserts and nothing rewrites or removes a row.
-- This table is not one of the nine the append-only triggers of 0010 protect, so SQLite
-- would raise nothing and the route's insert-only behaviour is the whole guarantee.
-- created_at is an ISO-8601 UTC string written by the application at insert time and carries
-- no default, because SQLite's CURRENT_TIMESTAMP yields a form this contract does not accept.
CREATE TABLE challenge_responses (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges (id),
  account_id   TEXT NOT NULL REFERENCES accounts (id),
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

-- A discussion thread. Any resolved demo account may start one, so the author names a
-- synthetic account of 0001 and the row carries no identity beyond that handle.
CREATE TABLE threads (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  author_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at        TEXT NOT NULL
);

-- A thread's posts, written once by POST /threads/{id}/posts and append-only by route design
-- on the same terms as challenge_responses above: no trigger guards this table, because it is
-- not one of the nine append-only tables, and no index is declared for it because the board
-- read carries no filter for one to serve.
CREATE TABLE thread_posts (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL REFERENCES threads (id),
  author_account_id TEXT NOT NULL REFERENCES accounts (id),
  body              TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
