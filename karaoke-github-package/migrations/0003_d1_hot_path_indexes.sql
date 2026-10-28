CREATE INDEX IF NOT EXISTS guest_star_records_auth_session_hash
ON guest_star_records (json_extract(data_json, '$.sessionTokenHash'))
WHERE scope = 'master'
  AND table_name = 'AuthSessions'
  AND json_valid(data_json);

CREATE INDEX IF NOT EXISTS guest_star_records_bridge_commands_pending
ON guest_star_records (
  json_extract(data_json, '$.deviceId'),
  json_extract(data_json, '$.activityId'),
  json_extract(data_json, '$.status'),
  json_extract(data_json, '$.createdAt'),
  record_id
)
WHERE scope = 'master'
  AND table_name = 'BridgeCommands'
  AND json_valid(data_json);

CREATE INDEX IF NOT EXISTS guest_star_records_created_order
ON guest_star_records (scope, table_name, created_at, record_id);

CREATE INDEX IF NOT EXISTS guest_star_requests_active_cycle
ON guest_star_requests (
  hotel_id,
  activity_id,
  archived_at,
  cycle_id,
  queue_position,
  created_at,
  row_id
);
