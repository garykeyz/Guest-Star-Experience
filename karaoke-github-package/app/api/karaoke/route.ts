import { NextRequest, NextResponse } from "next/server";
import { ensureD1Schema, getGuestStarD1, type JsonObject } from "@/lib/guest-star/d1-store";
import { handleD1PublicGet, handleD1PublicPost } from "@/lib/guest-star/d1-actions";
const MAX_PUBLIC_BODY_BYTES = 64 * 1024;

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

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "";
  if (!["", "status", "publicBootstrap"].includes(action)) {
    return errorResponse("Public action is not allowed.", 403);
  }
  const db = getGuestStarD1();
  if (!db) return d1UnavailableResponse();
  try {
    await ensureD1Schema(db);
    const data = await handleD1PublicGet(db, request.nextUrl.searchParams);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Guest-Star-Backend": "d1-only" }
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
  const action = String(parsed.action || "");
  if (!["", "submitReview", "createGuestReminder", "unsubscribeGuest"].includes(action)) {
    return errorResponse("Public action is not allowed.", 403);
  }
  const db = getGuestStarD1();
  if (!db) return d1UnavailableResponse();
  try {
    await ensureD1Schema(db);
    const data = await handleD1PublicPost(db, parsed);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store", "X-Guest-Star-Backend": "d1-only" }
    });
  } catch {
    return d1UnavailableResponse();
  }
}
