CREATE TABLE IF NOT EXISTS guest_star_activity_access (
  access_id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  venue_id TEXT NOT NULL DEFAULT '',
  activity_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL DEFAULT '',
  pin TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  join_token TEXT NOT NULL,
  join_token_hash TEXT NOT NULL,
  access_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  default_messages_enabled INTEGER NOT NULL DEFAULT 1,
  custom_messages_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS guest_star_activity_access_active_activity
  ON guest_star_activity_access (activity_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS guest_star_activity_access_active_pin
  ON guest_star_activity_access (pin_hash)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS guest_star_activity_access_join_token
  ON guest_star_activity_access (join_token_hash);

CREATE INDEX IF NOT EXISTS guest_star_activity_access_pin_history
  ON guest_star_activity_access (pin_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS guest_star_activity_sessions (
  session_token_hash TEXT PRIMARY KEY,
  access_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS guest_star_activity_sessions_access
  ON guest_star_activity_sessions (access_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS guest_star_pin_attempts (
  attempt_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_expires_at TEXT NOT NULL,
  blocked_until TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
