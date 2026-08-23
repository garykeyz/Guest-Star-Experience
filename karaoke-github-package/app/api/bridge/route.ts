import { NextRequest, NextResponse } from "next/server";
import { backendMode, ensureD1Schema, getGuestStarD1, type JsonObject } from "@/lib/guest-star/d1-store";
import { handleD1HostAction } from "@/lib/guest-star/d1-actions";
import { callAppsScript, scheduleD1Backup } from "@/lib/guest-star/upstream";

const MAX_BODY_BYTES = 512 * 1024;
const APPS_SCRIPT_TIMEOUT_MS = 60_000;

export const dynamic = "force-dynamic";

function response(data: JsonObject, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Guest-Star-Bridge-Proxy": "4.2.1"
    }
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return response({ ok: false, code: "REQUEST_TOO_LARGE" }, 413);
  }

  let payload: JsonObject;
  try {
    payload = JSON.parse(body) as JsonObject;
  } catch {
    return response({ ok: false, code: "INVALID_REQUEST" }, 400);
  }
  if (!String(payload.action || "").trim()) {
    return response({ ok: false, code: "ACTION_REQUIRED" }, 400);
  }

  try {
    const db = getGuestStarD1();
    if (db) {
      await ensureD1Schema(db);
      if (await backendMode(db) === "d1_primary") {
        const data = await handleD1HostAction(db, payload) || {
          ok: false,
          code: "D1_ACTION_NOT_IMPLEMENTED"
        };
        if (!["me", "activityState", "pollBridgeCommands"].includes(String(payload.action))) {
          scheduleD1Backup(db);
        }
        return response(data, data.ok === false && data.code === "UNAUTHORIZED" ? 401 : 200);
      }
    }
    return response(await callAppsScript(payload, APPS_SCRIPT_TIMEOUT_MS));
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof Error && error.name === "AbortError"
        ? "Guest Star took longer than 60 seconds to respond. Try again."
        : "Bridge could not reach Guest Star. Contact the Superhost if this continues."
    }, 502);
  }
}
