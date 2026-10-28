export function currentHostActivityAccess(state, { superhostInHostView = false } = {}) {
  const role = state?.account?.user?.role;
  if (state?.account?.authenticated !== true ||
    (role !== "host" && !(role === "superhost" && superhostInHostView))) return null;
  const tenant = state.tenant || {};
  const access = tenant.kioskAccess;
  const selected = state.account.current || {};
  if (!access || !tenant.hotel || !tenant.activity || !tenant.venue) return null;
  if (access.hotelId !== tenant.hotel.hotelId || access.activityId !== tenant.activity.activityId || access.venueId !== tenant.venue.venueId) return null;
  if (selected.hotelId !== access.hotelId || selected.activityId !== access.activityId || selected.venueId !== access.venueId) return null;
  if (!/^\d{6}$/.test(String(access.pin || ""))) return null;
  try {
    const joinUrl = new URL(access.joinUrl);
    if (joinUrl.origin !== "https://request.gstarxp.com" || !/^\/join\/[^/]+\/?$/.test(joinUrl.pathname)) return null;
  } catch { return null; }
  return access;
}
