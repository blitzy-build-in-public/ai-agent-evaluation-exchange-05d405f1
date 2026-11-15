-- 0007_governance_events_and_appeals.sql
-- The governance record: the append-only log of domain decisions, and the appeals those
-- decisions are ruled on. Applied by apps/api/src/db/migrate.ts after
-- 0006_reports_and_case_results.sql, whose evaluation_reports an appeal references, and after
-- 0001, whose accounts both tables reference.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row.

-- One appended domain decision: a standard published, a proposal reviewed, a listing moderated,
-- an appeal opened or ruled, or a retest created. This is the log of what was *decided*, and it
-- is deliberately not the log 0009 writes: audit_events holds what was *written*, one row per
-- write request, and a moderation action appends to both — one row per decision, one row per
-- request — because neither answers the other's question.
--
-- subject_type and subject_id are polymorphic: the pair names the row the decision concerns and
-- event_type says what happened to it. SQLite cannot point one column at several tables, so
-- subject_id carries no REFERENCES clause and the pairing is held by the writing code in
-- packages/sgi-core/src/events/.
--
-- subject_type and event_type are deliberately unconstrained TEXT, the one vocabulary in this
-- schema left open. A row here can never be corrected: 0010 adds the two aborting triggers that
-- refuse any attempt to change or remove one, so a CHECK enumerating today's kinds could reject a
-- legitimate future kind for good, and a rejected append is a decision the record would simply
-- never hold. The vocabulary the writing code uses is declared in
-- packages/shared/src/types/governance-event.ts, and it is expected rather than enforced:
-- subject_type is one of 'listing', 'standard_proposal', 'standard_version',
-- 'evaluation_report' or 'appeal', and event_type one of 'standard_version_published',
-- 'proposal_reviewed', 'listing_moderated', 'appeal_opened', 'appeal_ruled' or
-- 'retest_created'.
--
-- actor_account_id names the synthetic demo account that acted, referencing 0001. No column here
-- holds a personal name, a contact detail or a credential, and none may be added: the accounts
-- this references carry none either.
--
-- reason and payload_json are nullable on purpose. Most events carry both — a moderation action's
-- reason is required by its route, and a proposal review, an appeal opened and an appeal ruled
-- each state the ground they rest on — but the kinds that decide by what they point at carry
-- neither, so a retest and a standard publication store the absence. Because a row here can never
-- be corrected, a NOT NULL would force a fabricated reason or an empty payload object into a
-- decision that had no stated reason, which is a false record of an event rather than a stricter
-- one. packages/shared/src/types/governance-event.ts types both as their text or null for the
-- same reason.
--
-- This table holds no state: it is read back in insertion order as the trail behind a listing, a
-- proposal, a standard version, a report or an appeal, and nothing in the product updates or
-- deletes a row. 0010 backs that rule up with two aborting triggers as defence in depth — a
-- connection with write access can drop one, so the guarantee is that no route offers the
-- mutation — and 0011 owns the index this table's subject reads run on.
CREATE TABLE governance_events (
  id               TEXT PRIMARY KEY NOT NULL,
  subject_type     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  actor_account_id TEXT NOT NULL REFERENCES accounts (id),
  reason           TEXT,
  payload_json     TEXT,
  created_at       TEXT NOT NULL
);

-- One appeal: a developer's challenge to a single evaluation report, opened with a stated reason
-- and resolved by an operator's ruling of 'upheld' or 'denied'.
--
-- status is this row's only mutable column, and it is why this table is not one of the nine
-- append-only ones: a ruling moves it from 'open' to one of its two terminal outcomes and appends
-- a governance event naming the appeal, and the ruling history lives in that event rather than
-- here. That is why there is no ruled_at, no ruled_by and no ruling-reason column — each would
-- either duplicate what the appended event already records or invite an edit of a row a ruling
-- has already decided. The appealed report is untouched by any part of this: it is append-only in
-- 0006, and a ruling that changed what a measurement says is the one thing this table exists to
-- prevent.
--
-- report_id references 0006's evaluation_reports and developer_account_id references 0001's
-- accounts. Nothing limits a report to one appeal, because an appeal is a challenge to a report
-- rather than a state of it; the '409' the ruling route returns is for ruling an appeal that
-- already carries a terminal status.
-- No trigger is declared for this table in 0010 and none is wanted, which is the whole difference
-- between it and governance_events above: a ruling writes it. No index is declared here either;
-- 0011 owns the read-path indexes.
CREATE TABLE appeals (
  id                   TEXT PRIMARY KEY NOT NULL,
  report_id            TEXT NOT NULL REFERENCES evaluation_reports (id),
  developer_account_id TEXT NOT NULL REFERENCES accounts (id),
  reason               TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'denied')),
  created_at           TEXT NOT NULL
);
