-- Keep every existing PIN and join token. An access is now scoped to the
-- stable activity in a venue; a finished cycle does not remove that access.
DROP INDEX IF EXISTS guest_star_activity_access_active_venue;

CREATE UNIQUE INDEX IF NOT EXISTS guest_star_activity_access_active_identity
  ON guest_star_activity_access (hotel_id, activity_id, venue_id)
  WHERE status = 'active' AND activity_id <> '';

CREATE INDEX IF NOT EXISTS guest_star_activity_access_active_venue_lookup
  ON guest_star_activity_access (hotel_id, venue_id, status, created_at DESC);
