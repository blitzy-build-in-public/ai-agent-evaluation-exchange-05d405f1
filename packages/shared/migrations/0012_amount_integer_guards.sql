-- 0012_amount_integer_guards.sql
-- The integrality guard on the four columns that hold an amount: the amount a simulated checkout
-- takes in, the amount an operator refunds of it, the amount a ledger entry journals, and the fee a
-- sponsored slot records. Applied by apps/api/src/db/migrate.ts after 0011, over the four tables
-- 0008 and 0009 declare.
--
-- 0008 and 0009 give each of those columns `CHECK (column >= 0)` and nothing more, and SQLite's type
-- affinity does not keep a REAL, TEXT or BLOB value out of an INTEGER column: 10.5 is stored as a
-- `real` and 'abc' as a `text` beside that guard, so a fractional or non-numeric amount can enter a
-- ledger through raw SQL or through any of the writers that pass an amount straight through, and a
-- SUM over a ledger then returns a non-integer. Every amount in this schema is a whole count of minor
-- units of its one synthetic currency, and this file is what makes the store hold that: 0005 already
-- implements the guard for the identical hazard on its four count columns —
-- `CHECK (typeof(column) = 'integer')`, after the column list, with the reason stated beside it — and
-- the four guards below are that same form. A non-negative check on its own does not imply one, which
-- is why both now stand on each of the four columns.
--
-- SQLite cannot add a CHECK to an existing table, and an applied migration file is immutable — the
-- runner refuses a changed file, and changing the schema means adding a new numbered file — so the
-- guard arrives here, by rebuilding each of the four tables with its guard in place. Foreign keys
-- stay on throughout: the runner wraps this file in one transaction, `PRAGMA foreign_keys` is a no-op
-- inside a transaction, and the rebuild therefore works with the constraints it finds rather than
-- switching them off. Three properties of that arrangement decide the shape below.
--
-- First, `DROP TABLE transactions` fails its own implicit-delete foreign-key check while a refunds
-- or a ledger_entries row still references the table being dropped ("FOREIGN KEY constraint
-- failed"), so both child tables' rows are staged into plain copies, the children are dropped, the
-- parent is rebuilt, and the children are rebuilt from the staged rows.
-- Second, the implicit delete a `DROP TABLE` performs does not fire a trigger, while 0010's
-- `BEFORE DELETE` trigger does refuse an explicit `DELETE FROM` of the same rows. This file
-- therefore drops a guarded table rather than deleting its rows, and never issues a DELETE against
-- one.
-- Third, a dropped table takes its indexes and its triggers with it, so the two indexes 0011
-- declares on the rebuilt tables and the six 0010 triggers that stood on them are recreated at the
-- end of this file, verbatim.
--
-- Rowids are carried across explicitly, in their original order: ledger_entries is read in insertion
-- order (`ORDER BY rowid`), and a transaction's refunds and its journalled entries keep the rowids
-- they were written with. No amount is rewritten: a stored value these guards cannot admit makes the
-- copy fail and the whole file roll back, because an amount already written is never rewritten — a
-- ledger is history, and a migration that silently rounded, replaced or dropped a journalled amount
-- would be this product changing a record it states nothing can change. Such a database refuses to
-- apply this file: the copy fails on the guard whose expression the driver reports, the version
-- recorded stays the one before this file, no table is rebuilt and every stored amount stands.
-- Locating that row and deciding what to do with it is the operator's call, not this file's.
--
-- Every column, name, type, order, NOT NULL, DEFAULT, REFERENCES clause, CHECK and index of these
-- four tables is the one 0008 and 0009 declare; the one addition is the integrality guard itself, a
-- table-level CHECK at the end of each column list. Nothing else in the schema moves: the other six
-- append-only tables and their twelve triggers are untouched, no trigger is declared for
-- sponsored_slots — it is not one of the nine append-only tables — and 0009, 0010 and 0011 are not
-- edited by this file.

-- The two child tables first, because the parent cannot be dropped while either references it. Each
-- staging copy is a plain table holding the rows as they stand, original rowid included, and it
-- carries no constraint: it holds what is already stored, and the guards run when those rows are
-- copied into the rebuilt tables.
CREATE TABLE ledger_entries_staging AS
SELECT rowid AS original_rowid, id, ledger, entry_type, direction, amount_minor_units,
       transaction_id, report_id, currency_label, disclosure_label, description, created_at
FROM ledger_entries;
CREATE TABLE refunds_staging AS
SELECT rowid AS original_rowid, id, transaction_id, amount_minor_units, operator_account_id, created_at
FROM refunds;

-- Nothing references either table, so each one's own implicit delete is clean, and the index and the
-- two append-only triggers it carried go with it.
DROP TABLE ledger_entries;
DROP TABLE refunds;

-- transactions, rebuilt from 0008's declaration of it with the integrality guard added.
CREATE TABLE transactions_guarded (
  id                 TEXT PRIMARY KEY NOT NULL,
  buyer_account_id   TEXT NOT NULL REFERENCES accounts (id),
  listing_id         TEXT NOT NULL REFERENCES listings (id),
  listing_version_id TEXT NOT NULL REFERENCES listing_versions (id),
  offer_model        TEXT NOT NULL CHECK (offer_model IN ('rent', 'purchase', 'license', 'subscription')),
  amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units >= 0),
  currency_label     TEXT NOT NULL CHECK (currency_label = 'DEMO'),
  simulated          INTEGER NOT NULL DEFAULT 1 CHECK (simulated = 1),
  disclosure_label   TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  -- SQLite's type affinity does not keep a REAL, TEXT or BLOB value out of an INTEGER column, so the
  -- non-negativity guard on the column above accepts 10.5 as a `real` and 'abc' as a `text`. This
  -- guard is what makes the column hold the whole count of minor units an amount is, so a SUM over
  -- the tables that store one adds up integers.
  CHECK (typeof(amount_minor_units) = 'integer')
);

INSERT INTO transactions_guarded
  (rowid, id, buyer_account_id, listing_id, listing_version_id, offer_model, amount_minor_units,
   currency_label, simulated, disclosure_label, created_at)
SELECT rowid, id, buyer_account_id, listing_id, listing_version_id, offer_model, amount_minor_units,
       currency_label, simulated, disclosure_label, created_at
FROM transactions
ORDER BY rowid;

DROP TABLE transactions;
ALTER TABLE transactions_guarded RENAME TO transactions;

-- refunds, rebuilt from 0008's declaration of it with the integrality guard added. It references the
-- rebuilt transactions table above, which is why the parent is rebuilt first and this one's rows wait
-- in refunds_staging until it exists.
CREATE TABLE refunds_guarded (
  id                  TEXT PRIMARY KEY NOT NULL,
  transaction_id      TEXT NOT NULL REFERENCES transactions (id),
  amount_minor_units  INTEGER NOT NULL CHECK (amount_minor_units >= 0),
  operator_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at          TEXT NOT NULL,
  -- The same integrality guard as the transaction this row reverses, and no stricter one: type
  -- affinity would otherwise store 10.5 as a `real` and 'abc' as a `text` beside the
  -- non-negativity guard above, which is the hazard 0005 states for its count columns. A refund of
  -- nothing stays representable, and whether a given amount is acceptable stays the route's
  -- decision rather than a constraint's.
  CHECK (typeof(amount_minor_units) = 'integer')
);

INSERT INTO refunds_guarded
  (rowid, id, transaction_id, amount_minor_units, operator_account_id, created_at)
SELECT original_rowid, id, transaction_id, amount_minor_units, operator_account_id, created_at
FROM refunds_staging
ORDER BY original_rowid;

DROP TABLE refunds_staging;
ALTER TABLE refunds_guarded RENAME TO refunds;

-- ledger_entries, rebuilt from 0008's declaration of it with the integrality guard added. Its
-- original rowids are what the three ledger reads order by, so the staged rows are copied back in
-- original_rowid order and each row keeps the rowid it was written with.
CREATE TABLE ledger_entries_guarded (
  id                 TEXT PRIMARY KEY NOT NULL,
  ledger             TEXT NOT NULL CHECK (ledger IN ('marketplace', 'gate_fees', 'founder_allocation')),
  entry_type         TEXT NOT NULL CHECK (entry_type IN ('charge', 'allocation', 'reversal')),
  direction          TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units >= 0),
  transaction_id     TEXT REFERENCES transactions (id),
  report_id          TEXT REFERENCES evaluation_reports (id),
  currency_label     TEXT NOT NULL CHECK (currency_label = 'DEMO'),
  disclosure_label   TEXT NOT NULL,
  description        TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  CHECK ((transaction_id IS NULL) <> (report_id IS NULL)),
  -- As in the two tables above, INTEGER affinity alone accepts 10.5 as a `real` and 'abc' as a
  -- `text`, so the non-negativity guard on the column is joined by this one: a journalled amount is
  -- a whole count of minor units, and a ledger read that sums one reads integers.
  CHECK (typeof(amount_minor_units) = 'integer')
);

INSERT INTO ledger_entries_guarded
  (rowid, id, ledger, entry_type, direction, amount_minor_units, transaction_id, report_id,
   currency_label, disclosure_label, description, created_at)
SELECT original_rowid, id, ledger, entry_type, direction, amount_minor_units, transaction_id,
       report_id, currency_label, disclosure_label, description, created_at
FROM ledger_entries_staging
ORDER BY original_rowid;

DROP TABLE ledger_entries_staging;
ALTER TABLE ledger_entries_guarded RENAME TO ledger_entries;

-- sponsored_slots, rebuilt from 0009's declaration of it with the integrality guard added. It
-- declares no foreign key and nothing references it, so it needs no staging copy: its rows move
-- straight into the rebuilt table, original rowids included. No trigger is declared for it — it is
-- not one of the nine append-only tables — and no index is declared for it either, 0011 having found
-- no filter for one to serve.
CREATE TABLE sponsored_slots_guarded (
  id              TEXT PRIMARY KEY NOT NULL,
  sponsor_label   TEXT NOT NULL,
  placement_key   TEXT NOT NULL,
  fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
  created_at      TEXT NOT NULL,
  -- SQLite's type affinity does not keep a REAL, TEXT or BLOB value out of an INTEGER column, so the
  -- non-negativity guard above accepts 10.5 as a `real` and 'abc' as a `text`. This fee is a whole
  -- count of minor units of the product's one synthetic currency like every other amount in this
  -- schema, and this guard is what makes the column hold one.
  CHECK (typeof(fee_minor_units) = 'integer')
);

INSERT INTO sponsored_slots_guarded
  (rowid, id, sponsor_label, placement_key, fee_minor_units, created_at)
SELECT rowid, id, sponsor_label, placement_key, fee_minor_units, created_at
FROM sponsored_slots
ORDER BY rowid;

DROP TABLE sponsored_slots;
ALTER TABLE sponsored_slots_guarded RENAME TO sponsored_slots;

-- The two indexes 0011 declares on the rebuilt tables, recreated verbatim: dropping a table drops
-- the indexes that stood on it, and the reads they serve must find them again.
CREATE INDEX idx_refunds_transaction_id ON refunds (transaction_id);
CREATE INDEX idx_ledger_entries_ledger ON ledger_entries (ledger);

-- The six append-only triggers of 0010 that stood on the rebuilt tables, recreated verbatim, in
-- 0010's own order and wording. They are the guard rails behind the rule that no route updates or
-- deletes a transaction, a refund or a ledger entry, and that rule is unchanged by this file.
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
