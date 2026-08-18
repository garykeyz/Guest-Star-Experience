CREATE TABLE IF NOT EXISTS guest_star_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_star_records (
  scope TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, table_name, record_id)
);

CREATE INDEX IF NOT EXISTS guest_star_records_table
  ON guest_star_records (scope, table_name, updated_at);

CREATE TABLE IF NOT EXISTS guest_star_requests (
  row_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  venue_id TEXT NOT NULL DEFAULT '',
  activity_id TEXT NOT NULL DEFAULT '',
  cycle_id TEXT NOT NULL DEFAULT '',
  singer TEXT NOT NULL,
  song TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  transition_seconds INTEGER NOT NULL DEFAULT 0,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0,
  remaining_seconds INTEGER NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pendiente',
  file_name TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'guest_request',
  virtual_dj_item_id TEXT NOT NULL DEFAULT '',
  queue_position INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT '',
  state_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS guest_star_requests_activity
  ON guest_star_requests (hotel_id, activity_id, archived_at, queue_position, created_at);

CREATE INDEX IF NOT EXISTS guest_star_requests_request_id
  ON guest_star_requests (hotel_id, request_id, archived_at);

CREATE INDEX IF NOT EXISTS guest_star_requests_virtual_dj
  ON guest_star_requests (hotel_id, activity_id, virtual_dj_item_id, archived_at);

CREATE TABLE IF NOT EXISTS guest_star_activity_runtime (
  activity_id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  venue_id TEXT NOT NULL DEFAULT '',
  cycle_id TEXT NOT NULL DEFAULT '',
  accepting INTEGER NOT NULL DEFAULT 0,
  running INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  state_revision INTEGER NOT NULL DEFAULT 0,
  last_action TEXT NOT NULL DEFAULT '',
  last_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS guest_star_activity_runtime_hotel
  ON guest_star_activity_runtime (hotel_id, updated_at);

CREATE TABLE IF NOT EXISTS guest_star_rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_star_outbox (
  event_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS guest_star_outbox_pending
  ON guest_star_outbox (status, created_at);
