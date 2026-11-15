-- 0006_reports_and_case_results.sql
-- The SGI evaluation record: one report per evaluation, with the per-case evidence that
-- report states. Applied by apps/api/src/db/migrate.ts after 0005, whose versioned criteria
-- a report references, and after 0002, whose listing version it measures.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row, which no id-addressed read could fetch.

-- One evaluation: the report POST /evaluations writes and GET /evaluations/{id} returns to
-- anyone, carrying the provenance every report states. The evaluator compares the candidate's
-- recorded outputs against the case set's expected outputs and derives the outcome from the
-- versioned pass rule; nothing is executed, and no column here names a person, a payment or a
-- real currency.
-- outcome is closed to the pair below. The pass rule itself — at least 18 of 20 cases match
-- and no critical case fails — is versioned data in 0005's standard_versions row rather than a
-- branch in the scoring code, so it is read from that row and never restated as a constraint
-- here.
-- label is closed to its own pair and carries no default: which of the two a report takes
-- follows from the candidate version's origin (listing_versions.is_fixture_candidate) and the
-- outcome, both applied by the writing code, so a FAIL report carries one of the two exactly
-- as a PASS report does. The vocabulary is what a badge may state, and it stops there.
-- matched_count, total_count and critical_failures are the totals the outcome is derived from
-- and are read back on the report page. The two cross-column guards keep an arithmetic
-- combination that contradicts itself out of a row that can never be corrected.
-- rubric_reference holds the reference the report was scored against — 'SGI-SO-1.0.0#rubric',
-- resolving to docs/STANDARD-SGI-SO-1.0.0.md#rubric, which states the rubric, the evidence
-- semantics and the badge scope — as a column rather than a constant, so a later standard
-- version can carry its own reference.
-- prior_report_id is the retest link, and it is nullable for the two cases that make it one: a
-- version's first report points at nothing, and a retest for the same candidate version
-- inserts a new report pointing at its predecessor while the predecessor stays as it was. It
-- is never a client input: POST /evaluations carries no retest field, and the route derives
-- this value from the newest report for the submitted candidate version and standard version.
-- id and created_at are generated at write time and lie outside the compared payload, which is
-- what lets two runs of one submission compare byte for byte. created_at is an ISO-8601 UTC
-- string written by the application and carries no default, because SQLite's
-- CURRENT_TIMESTAMP yields a form this contract does not accept.
-- This table is append-only: migration 0010 adds the triggers that abort an update or a delete
-- of a row, and nothing rewrites a report — a retest inserts a new row and a ruling appends a
-- governance event, leaving the report byte-identical.
CREATE TABLE evaluation_reports (
  id                   TEXT PRIMARY KEY NOT NULL,
  candidate_version_id TEXT NOT NULL REFERENCES listing_versions (id),
  standard_version_id  TEXT NOT NULL REFERENCES standard_versions (id),
  outcome              TEXT NOT NULL CHECK (outcome IN ('PASS', 'FAIL')),
  matched_count        INTEGER NOT NULL CHECK (matched_count >= 0),
  total_count          INTEGER NOT NULL CHECK (total_count >= 0),
  critical_failures    INTEGER NOT NULL CHECK (critical_failures >= 0),
  label                TEXT NOT NULL CHECK (label IN ('SAMPLE', 'VERIFIED-IN-DEMO')),
  rubric_reference     TEXT NOT NULL,
  prior_report_id      TEXT REFERENCES evaluation_reports (id),
  created_at           TEXT NOT NULL,
  CHECK (matched_count <= total_count),
  CHECK (critical_failures <= total_count)
);

-- One row per fixture case per report: the evidence the outcome rests on, written in the same
-- transaction as its report and read nested under it by GET /evaluations/{id}.
-- expected_json and actual_json hold the canonical JSON strings the evaluator compared —
-- property order fixed and insignificant whitespace removed — so the evidence states the
-- compared artefact itself rather than two values a reader would have to canonicalise again.
-- match is 1 when the canonical actual equalled the canonical expected and 0 otherwise, and
-- severity is the case's own, so the failing critical cases of a FAIL are visible from the
-- evidence alone.
-- UNIQUE (report_id, case_id) makes the evidence set exact: exactly one result per case per
-- report. It also provides the report_id-prefixed index every per-case read needs, which is
-- why no other index is declared here; migration 0011 owns the report read-path indexes.
-- This table is append-only, like its report: migration 0010 adds the triggers that abort an
-- update or a delete of a row, and a case result is written only together with its report.
CREATE TABLE report_case_results (
  id            TEXT PRIMARY KEY NOT NULL,
  report_id     TEXT NOT NULL REFERENCES evaluation_reports (id),
  case_id       TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('critical', 'standard')),
  expected_json TEXT NOT NULL,
  actual_json   TEXT NOT NULL,
  match         INTEGER NOT NULL CHECK (match IN (0, 1)),
  UNIQUE (report_id, case_id)
);
