-- Additive: legacy cycles and schedules are retained without reassignment.
CREATE TABLE IF NOT EXISTS guest_star_activity_runs (
  run_id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL, activity_id TEXT NOT NULL,
  venue_id TEXT NOT NULL, schedule_id TEXT, starts_at TEXT NOT NULL,
  status TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_star_one_open_run
  ON guest_star_activity_runs(hotel_id, activity_id, venue_id)
  WHERE status IN ('scheduled', 'in_progress');
CREATE INDEX IF NOT EXISTS guest_star_due_runs
  ON guest_star_activity_runs(hotel_id, status, starts_at);
