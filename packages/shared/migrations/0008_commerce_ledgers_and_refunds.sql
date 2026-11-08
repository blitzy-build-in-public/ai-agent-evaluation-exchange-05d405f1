-- 0008_commerce_ledgers_and_refunds.sql
-- The simulated commerce record: the transactions a simulated checkout performs, the refunds an
-- operator appends to them, and the three ledgers every amount is journalled in. Applied by
-- apps/api/src/db/migrate.ts after 0007, and after 0001, 0002 and 0006, whose accounts, listings,
-- listing versions and evaluation reports these tables reference.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row.

-- One completed simulated transaction, written by POST /checkout-simulations and read back as the
-- record the buyer's checkout produced.
--
-- amount_minor_units is an INTEGER count of minor units and never a price a client chose: the amount
-- of a simulated purchase is computed from the offer model the listing makes for the version it is
-- made for, which is why the checkout body in
-- packages/shared/src/schemas/commerce-schema.ts carries no amount field. Every monetary column in
-- this schema is such an integer, and two guards keep this one that: the non-negativity check on the
-- column below, and the `typeof(amount_minor_units) = 'integer'` guard 0012 adds to this table, which
-- is what refuses the fractional or non-numeric value INTEGER affinity would otherwise store beside
-- the first of them. The writer side holds the same line a layer up: the configuration refuses a
-- non-integer fee or rate, the request schemas accept `type: 'integer'` only, and the product's
-- single rounding point (packages/commerce-sim/src/ledgers/allocate.ts) resolves its one fraction to
-- a whole unit before a row is built.
--
-- currency_label is guarded to the product's one synthetic label. The literal below is the value of
-- SYNTHETIC_CURRENCY_LABEL in packages/shared/src/constants.ts, which a .sql file cannot import and
-- which packages/commerce-sim/src/config.ts therefore hands to every insert. That guard is what
-- keeps a real currency code out of the data: no column of this table can hold one, and a statement
-- naming another label is refused at the insert rather than stored.
--
-- simulated is 1 in every row and can be nothing else. The commerce path is provider-neutral and
-- simulation-only, so no column of this schema can hold a processing intermediary's identifier, a
-- payment instrument, a financial account reference or any other third party's handle: an amount here
-- is a whole number of minor units of the synthetic label, and no column exists through which a real
-- payment or a real balance could enter. DEFAULT 1 states that as a property of the table rather than
-- a value each writer has to remember to supply, and the CHECK refuses the one value that would make
-- the row claim otherwise.
--
-- disclosure_label carries the nonfunctional demonstration label every simulated amount renders
-- with, taken from COMMERCE_DISCLOSURE_LABEL in packages/commerce-sim/src/config.ts. It is NOT NULL,
-- because an amount written without it is an amount a reader could mistake for a real one.
--
-- This table is append-only: 0010 adds the triggers that abort an update or a delete of a row. It
-- carries no balance, no status and no updated-at column for that reason — a refund appends a row to
-- `refunds` below, and a transaction's net position is derived from those rows rather than stored
-- beside them — and 0011 owns the indexes its reads run on.
CREATE TABLE transactions (
  id                 TEXT PRIMARY KEY NOT NULL,
  buyer_account_id   TEXT NOT NULL REFERENCES accounts (id),
  listing_id         TEXT NOT NULL REFERENCES listings (id),
  listing_version_id TEXT NOT NULL REFERENCES listing_versions (id),
  offer_model        TEXT NOT NULL CHECK (offer_model IN ('rent', 'purchase', 'license', 'subscription')),
  amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units >= 0),
  currency_label     TEXT NOT NULL CHECK (currency_label = 'DEMO'),
  simulated          INTEGER NOT NULL DEFAULT 1 CHECK (simulated = 1),
  disclosure_label   TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

-- One appended refund of a simulated transaction, written by POST /transactions/{id}/refunds and
-- read back as the reversal entries that route returns.
--
-- These rows are the source of a transaction's net position: what remains is the transaction's
-- amount_minor_units minus the sum of its refunds, which is what makes the contract's `409` (the
-- transaction is already fully refunded) and `422` (the amount exceeds the net remaining) answerable
-- from the rows alone, without a stored balance and without changing anything. A balance column
-- would be a second source of truth for a value these rows already state.
--
-- amount_minor_units takes the same two guards as the transaction it reverses — the non-negativity
-- check on the column below and the `typeof(amount_minor_units) = 'integer'` guard 0012 adds — and no
-- stricter one: a refund of nothing is representable, and whether a given amount is acceptable is
-- the route's decision rather than a constraint's. The amount is a whole number of minor units of
-- the synthetic label carried by the transaction, so this table holds no currency column of its own
-- and no real currency code can appear here.
--
-- operator_account_id names the synthetic operator account of 0001 that ruled the refund. No column
-- here holds a personal name, a contact detail, a credential or a financial reference, and none may
-- be added.
--
-- This table is append-only: 0010 adds the triggers that abort an update or a delete of a row, so a
-- refund is a new row and never a correction of an earlier one. 0011 owns the transaction_id
-- index the net-remaining read runs on.
CREATE TABLE refunds (
  id                  TEXT PRIMARY KEY NOT NULL,
  transaction_id      TEXT NOT NULL REFERENCES transactions (id),
  amount_minor_units  INTEGER NOT NULL CHECK (amount_minor_units >= 0),
  operator_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at          TEXT NOT NULL
);

-- One entry of one of the three ledgers, and the only place an amount is journalled.
--
-- One table holds all three and `ledger` is the discriminator the three operator reads filter on:
-- the marketplace ledger, the gate-evaluation-fee ledger and the founder-participation allocation
-- ledger. They keep separate meaning rather than merely separate rows — a gate-evaluation fee is
-- recorded in the gate-fee ledger only and is never eligible for an allocation, and an allocation
-- applies only to the net amount of an eligible completed simulated marketplace transaction and
-- never to that fee or to a sponsored-slot record. The list is closed and matches LEDGER_NAMES in
-- packages/shared/src/types/ledger.ts, so the discriminator the reads filter on and the vocabulary
-- the type checker enforces cannot drift apart.
--
-- entry_type records what a row is: the `charge` a simulated checkout takes in, the `allocation`
-- computed from it, and the `reversal` a refund appends. A reversal is a new row proportional to
-- what it corrects and never an edit to the row it corrects, which is what lets each ledger be read
-- as history in insertion order.
--
-- direction records which side of the ledger a row falls on, read relative to the ledger the row
-- sits in. This migration fixes the pair, because it is the declaration site the rest of the product
-- reads: packages/commerce-sim carries it in ledgers/ledger-types.ts, the operator routes validate
-- against it and packages/shared/src/types/ledger.ts names the same two values. It is deliberately
-- not the sign of an amount — amounts stay non-negative and no negative amount is ever stored, so a
-- reader who took direction for a sign would build a second, contradictory rule on top of this one —
-- and the kind of an entry is carried by entry_type alone.
--
-- The last CHECK is the pair this table keeps apart: a row references a transaction or a report and
-- never both. A marketplace charge, the allocation computed from it and a reversal of either carry
-- the transaction; a gate-evaluation fee carries the report it was charged for. Neither reference is
-- NOT NULL because exactly one is populated by definition, and the XOR is what refuses the two
-- states a reader could not interpret — a row naming both references and a row naming none.
--
-- currency_label and disclosure_label carry the same guard and the same labelling duty as the two
-- tables above, so every journalled amount states the synthetic label it is counted in and the
-- nonfunctional demonstration it belongs to. description is the plain-language record of what the
-- row is, read by the operator ledger view; a founder-allocation row states there the basis-point
-- rate it was computed from, because the appended row is the durable record of that rate and a later
-- configuration change must not retroactively alter what an existing row was computed from. No
-- column here names a person, a beneficiary, an entitlement or an account: an allocation is a
-- computed share of a simulated transaction and is assigned to no one.
--
-- This table is append-only: 0010 adds the triggers that abort an update or a delete of a row, so
-- the correction a refund appends is a new row and never a change to the row it corrects. 0011 owns
-- the (ledger) index the three ledger reads run on.
CREATE TABLE ledger_entries (
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
  CHECK ((transaction_id IS NULL) <> (report_id IS NULL))
);
