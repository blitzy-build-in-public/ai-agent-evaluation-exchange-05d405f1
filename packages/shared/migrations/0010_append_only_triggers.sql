-- 0010_append_only_triggers.sql
-- The guard rails behind the nine tables whose history the product's trust claim rests on: the
-- versioned criteria a report is scored against, the reports and their per-case evidence, the
-- governance event log, the three ledgers and their reversals, the audit feed of writes, and the
-- listing versions a published version is recorded in. Applied by apps/api/src/db/migrate.ts after
-- 0009, so every table named below already exists.
--
-- These triggers are defence in depth behind the rule that no route changes or removes an
-- append-only resource. They are NOT a security boundary, and no document in this repository may
-- describe them as one: SQLite offers no command that disables a trigger, but a connection with
-- write access can drop one, or rewrite the schema through the writable-schema escape hatch. What
-- holds the rule is that no route offers the mutation; these triggers refuse a mutation that
-- reaches a table by some other path.
--
-- The one write an append-only table accepts is a new row. A REPLACE-style conflict resolution must
-- never be used on these tables: SQLite documents it as bypassing a delete trigger, so such a row
-- would go without either trigger below ever running. The append-only write paths in
-- packages/sgi-core and packages/commerce-sim therefore add rows only, and never replace one.

CREATE TRIGGER trg_standard_versions_no_update
BEFORE UPDATE ON standard_versions
BEGIN
  SELECT RAISE(ABORT, 'standard_versions is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_standard_versions_no_delete
BEFORE DELETE ON standard_versions
BEGIN
  SELECT RAISE(ABORT, 'standard_versions is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_evaluation_reports_no_update
BEFORE UPDATE ON evaluation_reports
BEGIN
  SELECT RAISE(ABORT, 'evaluation_reports is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_evaluation_reports_no_delete
BEFORE DELETE ON evaluation_reports
BEGIN
  SELECT RAISE(ABORT, 'evaluation_reports is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_report_case_results_no_update
BEFORE UPDATE ON report_case_results
BEGIN
  SELECT RAISE(ABORT, 'report_case_results is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_report_case_results_no_delete
BEFORE DELETE ON report_case_results
BEGIN
  SELECT RAISE(ABORT, 'report_case_results is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_governance_events_no_update
BEFORE UPDATE ON governance_events
BEGIN
  SELECT RAISE(ABORT, 'governance_events is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_governance_events_no_delete
BEFORE DELETE ON governance_events
BEGIN
  SELECT RAISE(ABORT, 'governance_events is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_transactions_no_update
BEFORE UPDATE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'transactions is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_refunds_no_update
BEFORE UPDATE ON refunds
BEGIN
  SELECT RAISE(ABORT, 'refunds is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_refunds_no_delete
BEFORE DELETE ON refunds
BEGIN
  SELECT RAISE(ABORT, 'refunds is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only: rows may not be deleted');
END;

CREATE TRIGGER trg_listing_versions_no_update
BEFORE UPDATE ON listing_versions
BEGIN
  SELECT RAISE(ABORT, 'listing_versions is append-only: rows may not be updated');
END;

CREATE TRIGGER trg_listing_versions_no_delete
BEFORE DELETE ON listing_versions
BEGIN
  SELECT RAISE(ABORT, 'listing_versions is append-only: rows may not be deleted');
END;
