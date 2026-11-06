-- 0003_inquiries.sql
-- Buyer inquiries on a listing, written once by POST /inquiries. Applied by
-- apps/api/src/db/migrate.ts after 0002, whose listings this file references.

-- As in 0001, every id is declared NOT NULL beside PRIMARY KEY: SQLite's legacy rule would
-- otherwise let a NULL primary key into a row.

-- An inquiry carries a message about a listing and nothing else. The buyer is named by the
-- synthetic demo account of 0001, so no personal identity, contact detail, credential or
-- financial information is collected or can be stored in a row here.
-- The row is mutable in this schema, and no route in this release rewrites one.
-- created_at is an ISO-8601 UTC string written by the application at insert time and carries
-- no default, because SQLite's CURRENT_TIMESTAMP yields a form this contract does not accept.
CREATE TABLE inquiries (
  id               TEXT PRIMARY KEY NOT NULL,
  listing_id       TEXT NOT NULL REFERENCES listings (id),
  buyer_account_id TEXT NOT NULL REFERENCES accounts (id),
  message          TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- The two read paths: the inquiries on one listing, and the inquiries written by one buyer.
CREATE INDEX idx_inquiries_listing_id ON inquiries (listing_id);
CREATE INDEX idx_inquiries_buyer_account_id ON inquiries (buyer_account_id);
