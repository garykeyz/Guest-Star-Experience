import { NextRequest, NextResponse } from "next/server";

const APPS_SCRIPT_ENDPOINT =
  process.env.KARAOKE_APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbxpUugPQJ1N3yb8uezB6fpd84CELAKtbuB2maE3HberOBGo5ObABGtN3ZfCI3UvKbLkzg/exec";
const MAX_BODY_BYTES = 512 * 1024;
const APPS_SCRIPT_TIMEOUT_MS = 60_000;

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function response(data: JsonObject, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Guest-Star-Bridge-Proxy": "4.0.1"
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT_MS);
  try {
    const upstream = await fetch(APPS_SCRIPT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return response({
        ok: false,
        error: `Google Apps Script returned ${upstream.status}.`
      }, 502);
    }
    try {
      return response(JSON.parse(text) as JsonObject);
    } catch {
      return response({
        ok: false,
        error: "Google Apps Script did not return a valid JSON response."
      }, 502);
    }
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof Error && error.name === "AbortError"
        ? "Google Apps Script took longer than 60 seconds to respond."
        : "The Bridge proxy could not reach Google Apps Script."
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
