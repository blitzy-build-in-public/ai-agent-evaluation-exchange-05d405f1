-- 0009_sponsored_slots_and_audit_events.sql
-- The two records of something other than the product's own subject matter: the sponsored slot,
-- which must reach no measurement, and the audit row, which must outlive the request that wrote
-- it. Applied by apps/api/src/db/migrate.ts after 0008, and after 0001, whose accounts the audit
-- row references.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row.

-- One sponsored slot: a limited demonstration of advertising, held as seed data and read only by
-- the public GET /sponsored-slots. No route creates, changes or removes a slot, so this table is
-- seed/read-only rather than mutable, and a slot changes only by a new seed.
--
-- The isolation of this table is the point of it, and it is structural rather than conventional.
-- It declares no foreign key at all, and no column of it references, or is referenced by,
-- evaluation_reports, standard_versions, listing_versions, listing_claims or any other SGI table.
-- A sponsorship therefore cannot be read as evidence about an agent or as an input to a
-- measurement, and no SGI query can join this table — a later column pointing it at an SGI row
-- would be the change that breaks that separation. The same holds for the organic order a buyer
-- sees: the reads that order listings do not name this table, and the sponsored items come back
-- as a labelled collection of their own, which a surface renders below its organic results and
-- never interleaved with them. apps/api/test/integration/trust-separation.test.ts holds both
-- halves of that: a static walk of every import specifier in packages/sgi-core, and a comparison
-- of report, badge and ordering payloads before and after sponsorship data is varied.
--
-- fee_minor_units is an INTEGER count of whole minor units of the product's one synthetic
-- currency, the value of SYNTHETIC_CURRENCY_LABEL in packages/shared/src/constants.ts. It is what
-- makes the item advertising and it stops there: no ledger entry is written from it, and it is
-- never eligible for the founder-participation allocation, which applies only to the net amount
-- of an eligible completed simulated marketplace transaction (0008's ledger_entries). The amount
-- needs no currency column of its own — every amount in this schema is counted in that one label,
-- and this fee is not read as money anywhere — and no column here can hold a real currency code,
-- a payment instrument or a processing intermediary's handle.
--
-- The slot holds nothing about a reader. No column identifies who saw or opened an item and none
-- counts either: the demonstration is labelled advertising with no personalized profiling behind
-- it, so no such value exists to store or to count. sponsor_label names the fictional sponsor of
-- the demonstration, and placement_key the surface the slot sits on, one of the two values the
-- closed vocabulary in packages/shared/src/types/sponsored.ts declares. Both are fictional demo
-- content: no real brand, no real person, no contact detail and no currency symbol appears in
-- this table or in a seeded row of it. The words a reader sees are copy, owned by
-- packages/shared/src/constants.ts — the literal "Sponsored" every labelled item carries through
-- apps/web/src/components/sponsored-label.tsx.
--
-- Unlike the closed vocabularies of 0004-0008, placement_key carries no CHECK. The vocabulary is
-- declared with its type and drawn from there by the one writer, the seed, and an applied
-- migration can never be edited: a CHECK enumerating today's two surfaces could admit no third
-- one, and a new surface is a disclosure decision rather than a value to add.
--
-- No trigger is declared for this table in 0010 and none is wanted: it is not one of the nine
-- append-only tables, and the seed that writes it runs against a fresh database. 0011 declares no
-- index for it either — the public read carries no filter for one to serve, and the collection is
-- small by design.
CREATE TABLE sponsored_slots (
  id              TEXT PRIMARY KEY NOT NULL,
  sponsor_label   TEXT NOT NULL,
  placement_key   TEXT NOT NULL,
  fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
  created_at      TEXT NOT NULL
);

-- One appended audit row: the record of a write request the API performed, written once as the
-- last step of that request and never amended. This is the feed of what was *written*; 0007's
-- governance_events is the feed of what was *decided*. A moderation action appends to both — one
-- row per request here, one row per decision there — because neither answers the other's
-- question: this table answers who acted and how the request ended, that one what was decided and
-- why. The write point is apps/api/src/audit/append-audit-event.ts, and the only read is the
-- operator-only GET /audit-events, which returns these rows in insertion order.
--
-- A row carries exactly the five facts an audited write fixes: actor_account_id, the synthetic
-- account of 0001 whose role authorised the write; action; the resource acted on, as the
-- resource_type and resource_id pair; status_code; and the stated reason. Nothing else — no
-- request body, no request metadata, no reader identifier and no personal data. The accounts this
-- references hold none, and no column here may grow one.
--
-- action and resource_type are deliberately unconstrained TEXT, on the terms 0007 gives for its
-- two open vocabularies: a row here can never be corrected, so a CHECK enumerating today's kinds
-- could refuse a legitimate future kind for good, and a refused append is a request the record
-- would simply never hold. resource_type's closed list of the twelve resources the contract's
-- write rows act on is declared in packages/shared/src/types/audit-event.ts, which the writing
-- route and every reader of the feed take it from. action carries the <resource>.<verb> member
-- the writing route states, closed to its seventeen values by the vocabulary in
-- apps/api/src/audit/append-audit-event.ts rather than by a CHECK here, and the stored row type
-- keeps action a plain string because this column is open TEXT.
--
-- status_code is an HTTP status — the one the write returned, so a refused write is as auditable
-- as an accepted one — and the CHECK holds it inside the range such a status can occupy. A value
-- outside 100-599 is refused at the write rather than stored as a number that a reader would take
-- for a status and that is not one. That range is this schema's own guard, nothing in the plan
-- fixing it: a range is the only vocabulary this column can have.
--
-- reason is nullable, as 0007's governance_events.reason is. Most audited writes state none: a
-- ground is written by the writes that have one — a moderation action's reason, an appeal ruled
-- with one — while a write that decided by what it created has no ground to state. The absence is
-- recorded as NULL rather than as an empty string, because that is what the row's own type
-- declares: packages/shared/src/types/audit-event.ts types this field as `string | null` and
-- states that a row without a reason records that absence as null. A NOT NULL here would refuse a
-- row that type declares legal, turning such a write into a constraint failure at the audit step
-- of a request whose own response code says it succeeded.
--
-- This table is append-only: a row is written once and never changed or removed, which is the
-- whole of what an audit trail claims. 0010 adds the two aborting triggers that refuse an update
-- or a delete as defence in depth rather than as a safety guarantee — a connection with write
-- access can drop one — and what holds the rule is that no route offers the change. 0011 owns the
-- created_at index the feed's read runs on.
CREATE TABLE audit_events (
  id               TEXT PRIMARY KEY NOT NULL,
  actor_account_id TEXT NOT NULL REFERENCES accounts (id),
  action           TEXT NOT NULL,
  resource_type    TEXT NOT NULL,
  resource_id      TEXT NOT NULL,
  status_code      INTEGER NOT NULL CHECK (status_code >= 100 AND status_code <= 599),
  reason           TEXT,
  created_at       TEXT NOT NULL
);
