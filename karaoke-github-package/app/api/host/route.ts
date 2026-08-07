import { NextRequest, NextResponse } from "next/server";

const APPS_SCRIPT_ENDPOINT =
  process.env.KARAOKE_APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";
const SESSION_COOKIE = "guest_star_host_session";
const DEFAULT_APPS_SCRIPT_TIMEOUT_MS = 30_000;
const HOTEL_PROVISIONING_TIMEOUT_MS = 120_000;

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

async function callAppsScript(payload: JsonObject) {
  const timeoutMs = payload.action === "createHotel"
    ? HOTEL_PROVISIONING_TIMEOUT_MS
    : DEFAULT_APPS_SCRIPT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(APPS_SCRIPT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Google Apps Script returned ${response.status}.`);
    return JSON.parse(text) as JsonObject;
  } finally {
    clearTimeout(timeout);
  }
}

function safeResponse(data: JsonObject, status = 200) {
  const { authToken: _authToken, deviceToken: _deviceToken, ...safe } = data;
  return NextResponse.json(safe, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: NextRequest) {
  let body: JsonObject;
  try {
    body = await request.json() as JsonObject;
  } catch {
    return safeResponse({ ok: false, code: "INVALID_REQUEST" }, 400);
  }
  const action = String(body.action || "");
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value || "";
  const payload: JsonObject = { ...body };
  delete payload.authToken;
  delete payload.deviceToken;
  if (action === "login") {
    payload.clientType = "web";
  } else if (action !== "consumeOneTimeLoginCode") {
    payload.authToken = sessionToken;
  }

  try {
    const data = await callAppsScript(payload);
    const code = String(data.code || "");
    const response = safeResponse(
      data,
      data.ok === false && (code === "UNAUTHORIZED" || code === "INVALID_CREDENTIALS")
        ? 401
        : 200
    );
    if (
      data.ok === true &&
      (action === "login" || action === "consumeOneTimeLoginCode") &&
      typeof data.authToken === "string"
    ) {
      const expiresAt = Date.parse(String(data.expiresAt || ""));
      const maxAge = Number.isFinite(expiresAt)
        ? Math.max(60, Math.floor((expiresAt - Date.now()) / 1000))
        : 12 * 60 * 60;
      response.cookies.set(SESSION_COOKIE, data.authToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge
      });
    }
    if (action === "logout" || code === "UNAUTHORIZED") {
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0
      });
    }
    return response;
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script took too long to respond."
      : error instanceof Error
        ? error.message
        : "The Host Panel could not connect to Google Apps Script.";
    return safeResponse({ ok: false, error: message }, 502);
  }
}
