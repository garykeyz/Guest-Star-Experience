DROP INDEX IF EXISTS guest_star_activity_access_active_activity;

WITH ranked AS (
  SELECT access_id,
         ROW_NUMBER() OVER (
           PARTITION BY hotel_id, venue_id
           ORDER BY access_version DESC, created_at DESC, access_id DESC
         ) AS room_rank
  FROM guest_star_activity_access
  WHERE status = 'active'
)
UPDATE guest_star_activity_access
SET status = 'revoked',
    revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE access_id IN (SELECT access_id FROM ranked WHERE room_rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS guest_star_activity_access_active_venue
  ON guest_star_activity_access (hotel_id, venue_id)
  WHERE status = 'active';

ALTER TABLE guest_star_activity_sessions
  ADD COLUMN venue_id TEXT NOT NULL DEFAULT '';

UPDATE guest_star_activity_sessions
SET venue_id = COALESCE((
  SELECT venue_id
  FROM guest_star_activity_access
  WHERE guest_star_activity_access.access_id = guest_star_activity_sessions.access_id
), '')
WHERE venue_id = '';

CREATE INDEX IF NOT EXISTS guest_star_activity_sessions_venue
  ON guest_star_activity_sessions (hotel_id, venue_id, revoked_at, expires_at);
