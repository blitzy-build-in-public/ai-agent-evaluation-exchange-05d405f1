-- 0002_listings_and_versions.sql
-- Developer listings, their version history and the claims made about each version.
-- Applied by apps/api/src/db/migrate.ts after 0001, whose accounts and categories it
-- references.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row.

-- A listing is developer-owned content plus an operator moderation state. 'hidden' removes
-- the listing from search and compare while leaving it readable, with its history, to the
-- operator. DEFAULT 'active' gives a newly created listing a defined moderation state.
-- slug is deliberately not UNIQUE: no route documents a conflict for a repeated slug, and
-- listings are addressed by id.
CREATE TABLE listings (
  id                   TEXT PRIMARY KEY NOT NULL,
  developer_account_id TEXT NOT NULL REFERENCES accounts (id),
  slug                 TEXT NOT NULL,
  title                TEXT NOT NULL,
  summary              TEXT NOT NULL,
  category_id          TEXT NOT NULL REFERENCES categories (id),
  license_code         TEXT NOT NULL,
  pricing_model        TEXT NOT NULL CHECK (pricing_model IN ('rent', 'purchase', 'license', 'subscription')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'flagged', 'hidden')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- Version history. UNIQUE (listing_id, version_string) is the only conflict this schema
-- raises: a repeated version string under one listing answers 409, while the same string
-- under another listing is a different version.
-- is_fixture_candidate marks a version as one of the seeded candidate fixture references; it
-- is the single stored input to a report's label, which is SAMPLE when it is set and
-- VERIFIED-IN-DEMO otherwise, on PASS and FAIL alike.
-- The flag is stored as the integer 1 or 0. better-sqlite3 refuses a JavaScript boolean binding
-- ("SQLite3 can only bind numbers, strings, bigints, buffers, and null"), so the seed writes
-- `is_fixture_candidate ? 1 : 0`, and a version created through the API omits the column and
-- takes DEFAULT 0, which is the value every version published through the API carries.
-- This table is append-only: migration 0010 adds the triggers that abort an update or a
-- delete, so no path here may plan one.
CREATE TABLE listing_versions (
  id                   TEXT PRIMARY KEY NOT NULL,
  listing_id           TEXT NOT NULL REFERENCES listings (id),
  version_string       TEXT NOT NULL,
  notes                TEXT NOT NULL,
  is_fixture_candidate INTEGER NOT NULL DEFAULT 0 CHECK (is_fixture_candidate IN (0, 1)),
  created_at           TEXT NOT NULL,
  UNIQUE (listing_id, version_string)
);

-- The claims a listing makes about one version, each with the limitation the developer
-- states and a summary of the evidence, so a compare view can set claims beside measured
-- evidence. license_code and pricing_model repeat the listing's columns because a claim is
-- compared as claimed for that version rather than inherited from the listing row.
CREATE TABLE listing_claims (
  id                 TEXT PRIMARY KEY NOT NULL,
  listing_version_id TEXT NOT NULL REFERENCES listing_versions (id),
  claim              TEXT NOT NULL,
  limitation         TEXT NOT NULL,
  evidence_summary   TEXT NOT NULL,
  license_code       TEXT NOT NULL,
  pricing_model      TEXT NOT NULL CHECK (pricing_model IN ('rent', 'purchase', 'license', 'subscription'))
);
