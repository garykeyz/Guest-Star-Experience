const GUEST_DEVICE_STORAGE_KEY = "guest-star-public-device-v1";
const PUBLIC_ACTIVITY_CONTEXT_KEY = "guest-star-public-activity-context-v1";
let ephemeralGuestDeviceId = "";

function newGuestDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
}

export function guestDeviceId() {
  if (ephemeralGuestDeviceId) return ephemeralGuestDeviceId;
  try {
    const saved = window.localStorage.getItem(GUEST_DEVICE_STORAGE_KEY) || "";
    if (/^[a-z0-9._:-]{16,128}$/i.test(saved)) {
      ephemeralGuestDeviceId = saved;
      return saved;
    }
    ephemeralGuestDeviceId = newGuestDeviceId();
    window.localStorage.setItem(GUEST_DEVICE_STORAGE_KEY, ephemeralGuestDeviceId);
  } catch {
    ephemeralGuestDeviceId = newGuestDeviceId();
  }
  return ephemeralGuestDeviceId;
}

export type PublicActivityContext = {
  publicCode: string;
  hotelId?: string;
  hotelName?: string;
  venueId?: string;
  venueName?: string;
  activityId?: string;
  activityName?: string;
  pin?: string;
  joinToken?: string;
  updatedAt: number;
};

export function readPublicActivityContext(): PublicActivityContext | null {
  try {
    const value=JSON.parse(window.localStorage.getItem(PUBLIC_ACTIVITY_CONTEXT_KEY)||"null") as PublicActivityContext|null;
    if(!value||typeof value.publicCode!=="string"||!value.publicCode||!Number.isFinite(value.updatedAt))return null;
    if(Date.now()-value.updatedAt>30*24*60*60*1000){window.localStorage.removeItem(PUBLIC_ACTIVITY_CONTEXT_KEY);return null;}
    return value;
  } catch { return null; }
}

export function storePublicActivityContext(context: PublicActivityContext) {
  try{window.localStorage.setItem(PUBLIC_ACTIVITY_CONTEXT_KEY,JSON.stringify({...context,updatedAt:Date.now()}));}
  catch{/* Public links continue to work when storage is disabled. */}
}

export function clearPublicActivityContext() {
  try{window.localStorage.removeItem(PUBLIC_ACTIVITY_CONTEXT_KEY);}catch{/* optional cache */}
}
