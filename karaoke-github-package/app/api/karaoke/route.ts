import { NextRequest, NextResponse } from "next/server";
import { getGuestStarD1, type JsonObject } from "@/lib/guest-star/d1-store";
import { handleD1PublicGet, handleD1PublicPost } from "@/lib/guest-star/d1-actions";
import { realtimeResponseHeaders } from "@/lib/guest-star/realtime-event";
const MAX_PUBLIC_BODY_BYTES = 64 * 1024;
const ACTIVITY_SESSION_COOKIE = "guest_star_activity_session";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 502) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function d1UnavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "D1_SERVICE_UNAVAILABLE",
      error: "Guest Star está recuperando el servicio. Intenta enviar nuevamente."
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "2", "X-Guest-Star-Backend": "d1-only" }
    }
  );
}

function setActivitySessionCookie(response: NextResponse, token: string, expiresAt: unknown) {
  const parsed = Date.parse(String(expiresAt || ""));
  const maxAge = Number.isFinite(parsed)
    ? Math.max(60, Math.floor((parsed - Date.now()) / 1000))
    : 7 * 24 * 60 * 60;
  response.cookies.set(ACTIVITY_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  });
}

function clearActivitySessionCookie(response: NextResponse) {
  response.cookies.set(ACTIVITY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "";
  if (!["", "status", "publicBootstrap"].includes(action)) {
    return errorResponse("Public action is not allowed.", 403);
  }
  const db = getGuestStarD1();
  if (!db) return d1UnavailableResponse();
  try {
    const data = await handleD1PublicGet(db, request.nextUrl.searchParams);
    return NextResponse.json(data, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Guest-Star-Backend": "d1-only",
        ...realtimeResponseHeaders("/api/karaoke", "scheduleTransition", {}, data)
      }
    });
  } catch {
    return d1UnavailableResponse();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PUBLIC_BODY_BYTES) {
    return errorResponse("La solicitud es demasiado grande.", 413);
  }
  let parsed: JsonObject;
  try {
    parsed = JSON.parse(body) as JsonObject;
  } catch {
    return errorResponse("La solicitud no contiene datos válidos.", 400);
  }
  parsed._requestFingerprint = (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0] ||
    ""
  ).trim().slice(0, 240);
  if (!parsed.activitySessionToken) {
    parsed.activitySessionToken = request.cookies.get(ACTIVITY_SESSION_COOKIE)?.value || "";
  }
  const action = String(parsed.action || "");
  if (!["", "submitReview", "createGuestReminder", "unsubscribeGuest", "joinByPin", "joinByToken", "resumeSession"].includes(action)) {
    return errorResponse("Public action is not allowed.", 403);
  }
  const db = getGuestStarD1();
  if (!db) return d1UnavailableResponse();
  try {
    const data = await handleD1PublicPost(db, parsed);
    const response = NextResponse.json(data, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Guest-Star-Backend": "d1-only",
        ...realtimeResponseHeaders("/api/karaoke", action, parsed, data)
      }
    });
    if (data.ok === true && typeof data.activitySessionToken === "string") {
      setActivitySessionCookie(response, data.activitySessionToken, data.sessionExpiresAt);
    }
    if ([
      "SESSION_EXPIRED", "SESSION_DEVICE_MISMATCH", "SESSION_PIN_CHANGED", "ACTIVITY_ENDED", "ACCESS_EXPIRED"
    ].includes(String(data.code || ""))) clearActivitySessionCookie(response);
    return response;
  } catch {
    return d1UnavailableResponse();
  }
}
