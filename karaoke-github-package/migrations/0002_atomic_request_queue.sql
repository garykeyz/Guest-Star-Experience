DROP TRIGGER IF EXISTS guest_star_public_request_queue;
DROP TABLE IF EXISTS guest_star_queue_counters;
UPDATE guest_star_requests SET queue_position = 0 WHERE queue_position < 0;

CREATE INDEX IF NOT EXISTS guest_star_records_hotel_json
  ON guest_star_records (scope, table_name, json_extract(data_json, '$.hotelId'), updated_at)
  WHERE json_valid(data_json);

CREATE INDEX IF NOT EXISTS guest_star_records_public_code_json
  ON guest_star_records (json_extract(data_json, '$.publicCode'))
  WHERE scope = 'master' AND table_name = 'Hotels' AND json_valid(data_json);

CREATE INDEX IF NOT EXISTS guest_star_requests_cycle_guest
  ON guest_star_requests (hotel_id, activity_id, cycle_id, source_type, archived_at, status);

CREATE INDEX IF NOT EXISTS guest_star_requests_cycle_song
  ON guest_star_requests (hotel_id, activity_id, cycle_id, song COLLATE NOCASE, artist COLLATE NOCASE, archived_at, status);

CREATE INDEX IF NOT EXISTS guest_star_requests_cycle_singer
  ON guest_star_requests (hotel_id, activity_id, cycle_id, singer COLLATE NOCASE, archived_at, status);
