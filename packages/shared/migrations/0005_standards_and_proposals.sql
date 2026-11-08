-- 0005_standards_and_proposals.sql
-- The Standard Gate Index: the standards, the version rows that carry the pass rule an
-- evaluation is scored against, and the proposals the community reviews. Applied by
-- apps/api/src/db/migrate.ts after 0004, whose accounts this file references.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row.

-- A standard is the named thing the community governs; its criteria live in standard_versions
-- so that changing a threshold creates a version rather than editing a criterion.
-- One row exists in this release, code 'SGI-SO-1.0.0', written by the seed
-- (apps/api/src/seed/seed-data.ts) and not by this migration.
-- UNIQUE on code is what lets a standard be addressed by the identifier people quote; no
-- timestamp column exists because nothing in the read path displays or orders by one.
CREATE TABLE standards (
  id      TEXT PRIMARY KEY NOT NULL,
  code    TEXT NOT NULL UNIQUE,
  title   TEXT NOT NULL,
  summary TEXT NOT NULL
);

-- The versioned criteria: an evaluation is scored from these columns, so the pass rule is data
-- rather than a branch in the scoring code, and two runs over one version cannot disagree.
-- This table is append-only: migration 0010 adds the triggers that abort an update or a delete,
-- so no path here may plan one, and changing a threshold means inserting a new version row.
-- UNIQUE (standard_id, version_label) is the address a version is fetched by, which is also
-- what keeps a published version identifier immutable.
-- rubric_reference carries no default, so the seed writes its value: the seeded row's is
-- 'SGI-SO-1.0.0#rubric', the anchor resolving to the rubric and the pass rule stated in
-- docs/STANDARD-SGI-SO-1.0.0.md. The thresholds beside it are the numbers that document
-- states — 20 cases, 5 of them critical, 18 matches required, 0 critical failures allowed.
CREATE TABLE standard_versions (
  id                        TEXT PRIMARY KEY NOT NULL,
  standard_id               TEXT NOT NULL REFERENCES standards (id),
  version_label             TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('provisional', 'active')),
  total_cases               INTEGER NOT NULL CHECK (total_cases >= 0),
  critical_cases            INTEGER NOT NULL CHECK (critical_cases >= 0),
  pass_threshold_matches    INTEGER NOT NULL CHECK (pass_threshold_matches >= 0),
  critical_failures_allowed INTEGER NOT NULL CHECK (critical_failures_allowed >= 0),
  rubric_reference          TEXT NOT NULL,
  definition_json           TEXT NOT NULL,
  published_at              TEXT NOT NULL,
  UNIQUE (standard_id, version_label),
  -- SQLite's type affinity does not keep a REAL, TEXT or BLOB value out of an INTEGER column, and
  -- its type ordering places every integer below any TEXT or BLOB, so `>= 0` alone accepts 'abcd'.
  -- These four guards are what make the columns hold the integers the pass rule is arithmetic on;
  -- with them the three cross-column guards below always compare integer to integer.
  CHECK (typeof(total_cases) = 'integer'),
  CHECK (typeof(critical_cases) = 'integer'),
  CHECK (typeof(pass_threshold_matches) = 'integer'),
  CHECK (typeof(critical_failures_allowed) = 'integer'),
  -- Three cross-column guards, so a combination the evaluator could not apply is
  -- unrepresentable: a row that cannot be corrected once written must not be writable in a
  -- state that contradicts itself. The seeded row holds 5 <= 20, 18 <= 20 and 0 <= 5.
  CHECK (critical_cases <= total_cases),
  CHECK (pass_threshold_matches <= total_cases),
  CHECK (critical_failures_allowed <= critical_cases)
);

-- A proposal argues for a change to a standard. status is the only mutable column: operator
-- review moves it to 'accepted' or 'rejected' and appends a governance event, which is why the
-- decision is refused with a conflict once it has been made. The title and the rationale are
-- never rewritten by anyone.
-- DEFAULT 'submitted' gives a new proposal the state every proposal starts in, so the write
-- route need not assert what the schema already knows.
-- created_at is an ISO-8601 UTC string written by the application at insert time and carries no
-- default, because SQLite's CURRENT_TIMESTAMP yields a form this contract does not accept.
CREATE TABLE standard_proposals (
  id                  TEXT PRIMARY KEY NOT NULL,
  standard_id         TEXT NOT NULL REFERENCES standards (id),
  proposer_account_id TEXT NOT NULL REFERENCES accounts (id),
  title               TEXT NOT NULL,
  rationale           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected')),
  created_at          TEXT NOT NULL
);
