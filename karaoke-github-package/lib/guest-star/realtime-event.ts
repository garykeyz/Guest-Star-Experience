import type { JsonObject } from "./d1-store";

const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const ACTIVITY_ACTIONS = new Set([
  "startActivityV4", "startNewActivityV4", "finishActivityV4", "archiveClearQueue",
  "prepareSession", "continueActivityV4", "toggleRequests", "updateActivitySettings", "resetSessionPin", "updateKioskMessages"
]);

const EXPERIENCE_ACTIONS = new Set([
  "createActivity", "updateActivity", "updateActivityLanguages", "scheduleActivity",
  "updateSchedule", "cancelSchedule", "updateHotelBranding",
  "updateHotel", "createVenue", "updateVenue"
]);

function text(value: unknown) {
  return String(value || "").trim();
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function eventName(pathname: string, action: string, result: JsonObject) {
  if (pathname === "/api/karaoke" && !action) return "public.request.created";
  if (result.scheduleTransitioned === true) return "activity.changed";
  if (action === "queueBridgeCommand") return "bridge.command.queued";
  if (action === "completeBridgeCommand") return "bridge.command.completed";
  if (["bridgeRequestUpdate", "bridgeExternalSync", "playerRuntimeUpdate"].includes(action)) {
    return "request.changed";
  }
  if (ACTIVITY_ACTIONS.has(action)) return "activity.changed";
  if (EXPERIENCE_ACTIONS.has(action)) return "experience.changed";
  return "";
}

export function realtimeResponseHeaders(
  pathname: string,
  actionValue: unknown,
  _requestBody: JsonObject,
  result: JsonObject
): Record<string, string> {
  if (result.ok !== true || result.deduplicated === true || result.idempotent === true) return {};
  const action = text(actionValue);
  if (action === "bridgeRequestUpdate" && result.backupNeeded !== true) return {};
  if (action === "bridgeExternalSync" && Number(result.changed) <= 0) return {};
  const session = object(result.session);
  const automationHotel = object(result.hotel);
  const automationHotelId=text(automationHotel.hotelId || object(result.schedule).hotelId || object(result.activity).hotelId);
  const automation: Record<string,string> = CHANNEL_PATTERN.test(automationHotelId)
    ? {"X-Guest-Star-Run-Wakeup":JSON.stringify({hotelId:automationHotelId,runId:text(session.runId),startsAt:text(session.startsAt)})} : {};
  const event = eventName(pathname, action, result);
  const activity = object(result.activity);
  const venue = object(result.venue);
  const hotel = object(result.hotel);
  const schedule = object(result.schedule);
  const branding = object(result.branding);
  const request = object(result.request);
  const command = object(result.command);
  const playerRuntime = object(result.playerRuntime);
  const state = object(result.state);
  const selection = object(result.selection);
  const defaultPublicExperience = object(result.defaultPublicExperience);
  // Only identifiers returned after authorization and tenant validation can
  // select a Durable Object. Never route an invalidation with a submitted ID.
  const channel = text(
    result.realtimeChannel || result.hotelId || hotel.hotelId || activity.hotelId ||
    venue.hotelId || schedule.hotelId || branding.hotelId || request.hotelId ||
    command.hotelId || playerRuntime.hotelId || state.hotelId || selection.hotelId ||
    defaultPublicExperience.hotelId
  );
  const channels = [...new Set([
    channel,
    ...(Array.isArray(result.realtimeChannels) ? result.realtimeChannels.map(text) : [])
  ].filter((candidate) => CHANNEL_PATTERN.test(candidate)))];
  if (!event || !channels.length) return automation;
  const queuePeopleCount = Number(result.queuePeopleCount);
  return {
    ...automation,
    "X-Guest-Star-Realtime-Event": event,
    "X-Guest-Star-Realtime-Channel": channels[0],
    ...(channels.length > 1
      ? { "X-Guest-Star-Realtime-Channels": channels.slice(0, 4).join(",") }
      : {}),
    ...(Number.isFinite(queuePeopleCount) && queuePeopleCount >= 0
      ? { "X-Guest-Star-Realtime-Queue-Count": String(Math.floor(queuePeopleCount)) }
      : {}),
    "X-Guest-Star-Realtime-Action": action || "submitRequest"
  };
}
