-- Additive only: existing hotels, activities, accounts, sessions and requests are untouched.
CREATE TABLE IF NOT EXISTS guest_star_game_sessions (
 game_id TEXT PRIMARY KEY,
 hotel_id TEXT NOT NULL,
 venue_id TEXT NOT NULL,
 activity_id TEXT NOT NULL,
 run_id TEXT NOT NULL,
 definition_id TEXT NOT NULL,
 rules_version TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 status TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_star_games_activity ON guest_star_game_sessions(hotel_id,venue_id,activity_id,run_id,updated_at);
CREATE TABLE IF NOT EXISTS guest_star_game_event_log (
 game_id TEXT NOT NULL REFERENCES guest_star_game_sessions(game_id),
 sequence INTEGER NOT NULL,
 event_id TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL,
 event_json TEXT NOT NULL CHECK(json_valid(event_json)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(game_id,sequence)
);
CREATE INDEX IF NOT EXISTS guest_star_game_events_time ON guest_star_game_event_log(created_at);
-- Chunked archives avoid D1 and Durable Object per-value limits for 250 contestants.
CREATE TABLE IF NOT EXISTS guest_star_game_state_chunks (
 game_id TEXT NOT NULL REFERENCES guest_star_game_sessions(game_id),
 revision INTEGER NOT NULL,
 ordinal INTEGER NOT NULL,
 content TEXT NOT NULL,
 PRIMARY KEY(game_id,revision,ordinal)
);
