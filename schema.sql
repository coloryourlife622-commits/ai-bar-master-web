-- Initial schema for a NEW database. Existing databases need explicit ALTER migrations.
-- Timestamps: UTC in SQLite datetime format (YYYY-MM-DD HH:MM:SS).
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  plan_type TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free','standard','premium')),
  used_seconds_today INTEGER NOT NULL DEFAULT 0 CHECK (used_seconds_today >= 0),
  total_used_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_used_seconds >= 0),
  used_seconds_month INTEGER NOT NULL DEFAULT 0 CHECK (used_seconds_month >= 0),
  usage_month TEXT,
  ticket_seconds_remaining INTEGER NOT NULL DEFAULT 0 CHECK (ticket_seconds_remaining >= 0),
  last_used_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  summary_text TEXT NOT NULL DEFAULT '' CHECK (length(summary_text) <= 50),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cocktails (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  phrase TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  CHECK (start_at IS NULL OR end_at IS NULL OR start_at < end_at)
);
CREATE INDEX cocktails_active_window ON cocktails(is_active, start_at, end_at);
