-- 0013_newest_row_and_filter_indexes.sql
-- The five read-path indexes 0011 does not declare and the reads below cannot do without. Applied by
-- apps/api/src/db/migrate.ts after 0012, so every table indexed here already exists: listings,
-- listing_versions and listing_claims (0002), challenges and challenge_responses (0004), and
-- evaluation_reports (0006).
-- 0011's own header calls itself the only place the read-path indexes are declared and 0012's own
-- comment names the two indexes it recreates — each describing the set as it stood when that applied
-- file was written — and this file is where the set grew, so a reader who starts at an applied file
-- is routed here for the set's current statement.
--
-- Indexes only: this migration creates no table, no trigger and no row, and it repeats no index an
-- applied file already declares. Every statement below is a plain `CREATE INDEX` rather than
-- `CREATE INDEX IF NOT EXISTS`: a pending file is applied once, inside the runner's own transaction,
-- and a second application of one file is a state the runner refuses before it applies anything.
--
-- Immutability, and where the ledger index actually lives. 0008's comment on `ledger_entries` and
-- 0011's comment on `idx_ledger_entries_ledger_created_at` both describe a `(ledger, created_at)`
-- index. The index the three operator ledger reads run on today is the `(ledger)` one 0012 recreates
-- on the `ledger_entries` table it rebuilds, and those two comments are left as they stand because an
-- applied migration file is never edited — a schema change arrives as a new numbered file, which is
-- what this file is. `(ledger)` serves those reads because `rowid` is appended to every index key, so
-- one ledger's rows come back in the order they were appended, which is the order the reads state.

-- The limitation subquery of the listing row source (apps/api/src/routes/listings.ts), which the
-- search and the detail read both project: the first claim of the version a listing's evidence is
-- linked to. With no index on listing_version_id it was a full scan of a table that grows with every
-- published claim, evaluated once for every row the search considered rather than once per returned
-- row. The detail read's own claims statement and the compare read's claimsStatement reach the same
-- rows through the same column and are served by the same index; because those two collect the claims
-- of several versions at once and order them by `rowid`, they sort what they collected, which is that
-- listing's own claims rather than a scan of every claim in the exchange — `rowid` is not a column an
-- index may name, and no other spelling of this index removes that order's sort.
CREATE INDEX idx_listing_claims_listing_version_id ON listing_claims (listing_version_id);

-- The newest-version read, spelled three times: the listing row source's newest-version join, the
-- compare read's newest-version probe, and the detail read's version history, which asks for one
-- listing's versions ordered `created_at DESC, rowid DESC`. `listing_id` is equated and `created_at`
-- is the next key, so the candidates for one listing are read in that order and each of the three
-- reads is answered without the temporary B-tree it sorted through before.
CREATE INDEX idx_listing_versions_listing_id_created_at ON listing_versions (listing_id, created_at);

-- The newest-report read, likewise spelled three times: the listing row source's newest-report join,
-- SELECT_LATEST_REPORT_FOR_VERSION in the detail read, and latestReportStatement in the compare read.
-- idx_evaluation_reports_candidate_version_id cannot serve them: `created_at` is that index's third
-- key while only the first is equated, so a read that orders by `created_at` had to sort its own
-- candidates. That three-key index stays, because it does serve the retest lookup, which equates
-- candidate_version_id and standard_version_id and takes the newest of the rows left.
CREATE INDEX idx_evaluation_reports_candidate_version_created_at ON evaluation_reports (candidate_version_id, created_at);

-- The slug walk of POST /listings: `freeSlug` (apps/api/src/routes/listings.ts) asks
-- `SELECT 1 AS taken FROM listings WHERE slug = ? LIMIT 1` once per token it tries, inside the
-- create-listing transaction and therefore while the single writer is held. A slug is deliberately not
-- UNIQUE (0002) and nothing else indexes the column, so each trial was a scan of a table that grows
-- with every listing, and the walk cost one scan per suffix it tried. This makes each trial a lookup.
CREATE INDEX idx_listings_slug ON listings (slug);

-- The challenge board's batched response read (apps/api/src/routes/challenges.ts): one statement
-- selecting the responses whose challenge_id is among the board's own ids, issued on every
-- GET /challenges. 0004 declares no index on that column, so the statement scanned the whole
-- challenge_responses table, which grows with every response the board carries.
CREATE INDEX idx_challenge_responses_challenge_id ON challenge_responses (challenge_id);
