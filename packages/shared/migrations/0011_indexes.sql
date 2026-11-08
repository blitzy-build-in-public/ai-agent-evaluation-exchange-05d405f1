-- 0011_indexes.sql
-- The read-path indexes behind the API's documented reads. Applied by apps/api/src/db/migrate.ts
-- after 0010, so every table indexed below already exists: listings (0002), evaluation_reports
-- (0006), governance_events (0007), ledger_entries and refunds (0008) and audit_events (0009).
--
-- Indexes only: this migration creates no table, no trigger and no row. 0012 follows it, rebuilding
-- four tables and recreating verbatim the two indexes declared here for the ones it rebuilds, because
-- a rebuilt table drops the indexes that stood on it. It is deliberately the only place the read-path
-- indexes are declared, so that the set docs/SCHEMA.md lists is the set applied here. Keeping every
-- documented read indexed is what keeps each query small, which matters because better-sqlite3's API
-- is synchronous on the calling thread.
--
-- Three indexes already exist elsewhere and are deliberately not repeated: 0001 declares
-- idx_accounts_role, 0003 declares idx_inquiries_listing_id and idx_inquiries_buyer_account_id, and
-- the UNIQUE constraints of 0002, 0005 and 0006 provide the indexes for listing_versions
-- (listing_id, version_string), standard_versions (standard_id, version_label) and
-- report_case_results (report_id, case_id). A second index on the same columns would be dead weight
-- on every write.

-- Search and compare return active listings only — a hidden listing leaves both — so status is a
-- filter every listing read carries.
CREATE INDEX idx_listings_status ON listings (status);

-- The three closed filters the contract's search row names beside the free-text q: category, model
-- and license. Each is selective on its own and they are combined with the free-text match, so each
-- gets its own single-column index rather than one composite that a filter subset could not use.
CREATE INDEX idx_listings_category_id ON listings (category_id);
CREATE INDEX idx_listings_pricing_model ON listings (pricing_model);
CREATE INDEX idx_listings_license_code ON listings (license_code);

-- The search row's standard filter, which asks whether a listing has a report for a standard
-- version.
CREATE INDEX idx_evaluation_reports_standard_version_id ON evaluation_reports (standard_version_id);

-- Two report read paths in one index, in that column order: the listing summary's latest-report join
-- for a candidate version, which reads the newest row by created_at, and the retest lookup that
-- derives prior_report_id from the newest existing report for the submitted candidate version and
-- standard version. The retest read has no body field of its own — POST /evaluations carries none —
-- so this is the lookup that supplies it.
CREATE INDEX idx_evaluation_reports_candidate_version_id ON evaluation_reports (candidate_version_id, standard_version_id, created_at);

-- The three operator-only ledger reads: each filters on the ledger discriminator and reads its rows in
-- the order they were appended. The read (packages/commerce-sim/src/ledgers/ledger-repository.ts)
-- orders by `rowid`, which is the table's own insertion counter and the only column that can supply
-- that order — two rows appended in one millisecond carry equal instants — so the index is declared on
-- the discriminator alone: `rowid` is appended to every index key, which makes this index return one
-- ledger's rows in rowid order and the read needs no sort. A second key was unable to serve that order.
CREATE INDEX idx_ledger_entries_ledger ON ledger_entries (ledger);

-- The net-remaining computation behind the refund contract's 409 (already fully refunded) and 422
-- (amount exceeds the net remaining): a transaction's amount minor units minus the sum of its
-- refunds, read from the refund rows because no balance is stored beside them. This index serves
-- that read and weakens nothing — refunds stays append-only, so the index makes a sum faster, never
-- a row editable.
CREATE INDEX idx_refunds_transaction_id ON refunds (transaction_id);

-- The operator audit feed, read in insertion order.
CREATE INDEX idx_audit_events_created_at ON audit_events (created_at);

-- Governance events are read with the subject they concern, so a proposal's review trail and an
-- appeal's ruling trail are both visible from the event log alone.
CREATE INDEX idx_governance_events_subject ON governance_events (subject_type, subject_id);

-- Read paths left unindexed on purpose, so no later change adds an index that cannot be used:
-- the free-text q match on listings.title and listings.summary is a LIKE '%…%' comparison, which no
-- B-tree index can serve; GET /compare resolves each of its two to four ids by primary key; the
-- board reads GET /challenges and GET /threads document no filter and no order to serve; the
-- governance event log read whole (packages/sgi-core/src/events/list-events.ts) filters on no
-- indexed column, so it scans governance_events; the same read narrowed by event_type alone has no
-- index behind it either, so that too scans — the subject filter a route exposes is served by
-- idx_governance_events_subject above, whose rows the read then orders itself; and
-- GET /evaluations/{id} reads its report by primary key, with the per-case evidence served by the
-- (report_id, case_id) unique index 0006 declares.
