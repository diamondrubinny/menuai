/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Ordered, append-only SQL migrations. Never edit a shipped migration: add a new one.
 * Kept as strings (not files) so the bundled server needs no extra assets.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_init',
    sql: `
CREATE TYPE user_role AS ENUM ('owner', 'editor', 'viewer');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  role user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE login_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_tokens_user ON login_tokens (user_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  draft jsonb NOT NULL,
  draft_version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  version integer NOT NULL,
  data jsonb NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_id, version)
);

CREATE TABLE publications (
  menu_id uuid PRIMARY KEY REFERENCES menus(id) ON DELETE CASCADE,
  public_slug text NOT NULL UNIQUE CHECK (public_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  version_id uuid NOT NULL REFERENCES menu_versions(id),
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE upload_status AS ENUM ('quarantine', 'clean', 'rejected');

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status upload_status NOT NULL DEFAULT 'quarantine',
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  scanned_at timestamptz
);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at ON audit_log (at DESC);
`,
  },
  {
    id: '0002_upload_details',
    sql: `
ALTER TABLE uploads ADD COLUMN width integer CHECK (width > 0);
ALTER TABLE uploads ADD COLUMN height integer CHECK (height > 0);
ALTER TABLE uploads ADD COLUMN scan_result text CHECK (length(scan_result) <= 200);
CREATE INDEX uploads_status_created ON uploads (status, created_at);
`,
  },
  {
    id: '0003_payments',
    sql: `
-- Pay the bill from the table (docs/PAYMENTS_PLAN.md). Money is integer agorot; no card data is ever stored.
CREATE TABLE payment_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'fake' CHECK (provider IN ('fake', 'grow')),
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  credentials_enc text,
  tip_percents smallint[] NOT NULL DEFAULT '{10,12,15}',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  token text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  menu_id uuid REFERENCES menus(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dining_tables_label ON dining_tables (lower(label));

CREATE TYPE bill_status AS ENUM ('open', 'paid', 'closed', 'cancelled');
CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES dining_tables(id) ON DELETE RESTRICT,
  amount_agorot integer NOT NULL CHECK (amount_agorot BETWEEN 100 AND 10000000),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  status bill_status NOT NULL DEFAULT 'open',
  opened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
-- One open bill per table.
CREATE UNIQUE INDEX bills_one_open ON bills (table_id) WHERE status = 'open';
CREATE INDEX bills_status_opened ON bills (status, opened_at DESC);

CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'expired');
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  share_agorot integer NOT NULL CHECK (share_agorot > 0),
  tip_agorot integer NOT NULL DEFAULT 0 CHECK (tip_agorot >= 0),
  status payment_status NOT NULL DEFAULT 'pending',
  provider text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  -- The provider's identifiers for this payment (e.g. Grow processId/processToken). Never card data.
  provider_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_txn text CHECK (length(provider_txn) <= 100),
  -- Set when money arrived that the bill could no longer take (staff must refund or review).
  review_reason text CHECK (review_reason IN ('bill_not_open', 'overpaid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX payments_bill ON payments (bill_id, status);
CREATE INDEX payments_pending ON payments (created_at) WHERE status = 'pending';

-- Provider notifications, minimal (no names, phones or card details): for troubleshooting and audit.
CREATE TABLE payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  provider text NOT NULL,
  kind text NOT NULL CHECK (length(kind) <= 40),
  outcome text NOT NULL CHECK (length(outcome) <= 40),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_at ON payment_events (at);
`,
  },
  {
    id: '0004_payment_terms',
    sql: `
-- The restaurant's payment terms page; when set, guests must accept it before paying (Grow's review requires it).
ALTER TABLE payment_settings ADD COLUMN terms_url text CHECK (terms_url ~ '^https://' AND length(terms_url) <= 500);
`,
  },
  {
    id: '0005_payment_review',
    sql: `
-- Staff close the loop on a flagged payment (refunded in the provider's dashboard, or reviewed).
ALTER TABLE payments ADD COLUMN review_resolved_at timestamptz;
ALTER TABLE payments ADD COLUMN review_resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN review_note text CHECK (length(review_note) <= 200);
CREATE INDEX payments_paid_at ON payments (paid_at) WHERE status = 'paid';
`,
  },
  {
    id: '0006_payplus',
    sql: `
ALTER TABLE payment_settings DROP CONSTRAINT IF EXISTS payment_settings_provider_check;
ALTER TABLE payment_settings ADD CONSTRAINT payment_settings_provider_check CHECK (provider IN ('fake', 'grow', 'payplus'));
`,
  },
];
