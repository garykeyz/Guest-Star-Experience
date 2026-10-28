CREATE TABLE IF NOT EXISTS guest_star_show_sessions (
 show_id TEXT PRIMARY KEY,hotel_id TEXT NOT NULL,venue_id TEXT NOT NULL,activity_id TEXT NOT NULL,run_id TEXT NOT NULL,
 revision INTEGER NOT NULL,status TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_star_shows_activity ON guest_star_show_sessions(hotel_id,venue_id,activity_id,run_id);
CREATE TABLE IF NOT EXISTS guest_star_show_event_log (
 show_id TEXT NOT NULL REFERENCES guest_star_show_sessions(show_id),sequence INTEGER NOT NULL,event_json TEXT NOT NULL CHECK(json_valid(event_json)),PRIMARY KEY(show_id,sequence)
);
CREATE TABLE IF NOT EXISTS guest_star_show_state_chunks (
 show_id TEXT NOT NULL REFERENCES guest_star_show_sessions(show_id),revision INTEGER NOT NULL,ordinal INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(show_id,revision,ordinal)
);
CREATE TABLE IF NOT EXISTS guest_star_show_templates (
 hotel_id TEXT NOT NULL,template_id TEXT NOT NULL,version INTEGER NOT NULL,config_json TEXT NOT NULL CHECK(json_valid(config_json)),created_by TEXT NOT NULL,created_at INTEGER NOT NULL,command_id TEXT NOT NULL,
 UNIQUE(hotel_id,command_id),
 PRIMARY KEY(hotel_id,template_id,version)
);
CREATE TABLE IF NOT EXISTS guest_star_show_offers (
 hotel_id TEXT PRIMARY KEY,formats_json TEXT NOT NULL CHECK(json_valid(formats_json)),updated_by TEXT NOT NULL,updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_star_activity_game_offers (hotel_id TEXT NOT NULL,activity_id TEXT NOT NULL,formats_json TEXT NOT NULL CHECK(json_valid(formats_json)),updated_by TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(hotel_id,activity_id));
