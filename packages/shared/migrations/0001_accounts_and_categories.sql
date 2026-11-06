-- 0001_accounts_and_categories.sql
-- Synthetic demo accounts and listing categories. Applied by apps/api/src/db/migrate.ts.

-- Demo accounts only: the X-Demo-Account header resolves to a row here, and the role
-- vocabulary below is the whole of it. No credential, session or contact column exists.
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('developer', 'buyer', 'contributor', 'operator')),
  display_label TEXT NOT NULL
);

CREATE TABLE categories (
  id   TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE INDEX idx_accounts_role ON accounts (role);
