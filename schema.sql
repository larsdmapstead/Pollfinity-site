-- Pollfinity panel opt-ins (D1)
-- Create DB:   wrangler d1 create pollfinity-panel
-- Apply:       wrangler d1 execute pollfinity-panel --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS optins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  phone TEXT UNIQUE,            -- E.164, null if email-only panelist
  email TEXT,
  zip TEXT NOT NULL,
  state TEXT NOT NULL,
  party TEXT,
  age_range TEXT,
  consent_sms INTEGER NOT NULL DEFAULT 0,
  consent_text TEXT,            -- verbatim consent language at submit time (TCPA audit trail)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending -> confirmed (after Reply YES) -> revoked (STOP)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  confirmed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_optins_email
  ON optins(email) WHERE email IS NOT NULL AND email != '';
CREATE INDEX IF NOT EXISTS idx_optins_status ON optins(status);
CREATE INDEX IF NOT EXISTS idx_optins_state ON optins(state);
