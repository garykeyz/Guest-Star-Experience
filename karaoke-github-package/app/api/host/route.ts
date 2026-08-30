import { NextRequest, NextResponse } from "next/server";
import {
  d1Health,
  ensureD1Schema,
  getGuestStarD1,
  reserveDailyFreeTranslationBudget,
  type JsonObject
} from "@/lib/guest-star/d1-store";
import { handleD1HostAction } from "@/lib/guest-star/d1-actions";
import {
  estimateBrandingTranslationNeurons,
  getWorkersAiBinding,
  prepareBrandingLocalization
} from "@/lib/guest-star/translation";

const SESSION_COOKIE = "guest_star_host_session";
const MAX_HOST_BODY_BYTES = 128 * 1024;

export const dynamic = "force-dynamic";

function safeResponse(data: JsonObject, status = 200) {
  const {
    authToken: _authToken,
    deviceToken: _deviceToken,
    passwordHash: _passwordHash,
    passwordSalt: _passwordSalt,
    backupSecret: _backupSecret,
    ...safe
  } = data;
  return NextResponse.json(safe, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function setSessionCookie(response: NextResponse, token: string, expiresAt: unknown) {
  const expiry = Date.parse(String(expiresAt || ""));
  const maxAge = Number.isFinite(expiry)
    ? Math.max(60, Math.floor((expiry - Date.now()) / 1000))
    : 30 * 24 * 60 * 60;
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  });
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function POST(request: NextRequest) {
  let body: JsonObject;
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_HOST_BODY_BYTES) {
    return safeResponse({ ok: false, code: "REQUEST_TOO_LARGE" }, 413);
  }
  try {
    body = JSON.parse(rawBody) as JsonObject;
  } catch {
    return safeResponse({ ok: false, code: "INVALID_REQUEST" }, 400);
  }

  const action = String(body.action || "");
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value || "";
  const payload: JsonObject = { ...body };
  delete payload.authToken;
  delete payload.deviceToken;
  if (action === "login") payload.clientType = "web";
  else if (action !== "consumeOneTimeLoginCode") payload.authToken = sessionToken;

  try {
    const db = getGuestStarD1();
    if (!db) {
      return safeResponse({
        ok: false,
        code: "D1_SERVICE_UNAVAILABLE",
        error: "Guest Star D1 is required for live operation."
      }, 503);
    }
    await ensureD1Schema(db);

    if (action.startsWith("d1")) {
      if (action === "d1Status") {
        const identity = await handleD1HostAction(db, {
          ...body,
          action: "me",
          authToken: sessionToken
        });
        if (identity?.ok !== true || (identity.user as JsonObject | undefined)?.role !== "superhost") {
          throw new Error("FORBIDDEN");
        }
        return safeResponse(await d1Health(db));
      }
      return safeResponse({ ok: false, code: "D1_ONLY_MODE" }, 410);
    }

    if (action === "googleFallbackState" || action === "linkGoogleFallback") {
      return safeResponse({
        ok: false,
        code: "GOOGLE_REQUEST_BACKUP_DISABLED",
        error: "Google Forms and Sheets are not part of the live Guest Star request path."
      }, 410);
    }

    let translationWarning = "";
    if (action === "updateHotelBranding") {
      const requestedMode = String((payload.branding as JsonObject | undefined)?.translationMode || "auto");
      let ai = requestedMode === "manual" ? null : getWorkersAiBinding();
      if (ai) {
        const estimate = estimateBrandingTranslationNeurons(payload.branding);
        if (!await reserveDailyFreeTranslationBudget(db, estimate)) ai = null;
      }
      const localized = await prepareBrandingLocalization(payload.branding, ai);
      payload.branding = localized.branding;
      translationWarning = localized.warning;
    }

    const data: JsonObject = await handleD1HostAction(db, payload) || {
      ok: false,
      code: "D1_ACTION_NOT_IMPLEMENTED"
    };
    if (translationWarning && data.ok === true && !data.warning) data.warning = translationWarning;

    const code = String(data.code || "");
    const response = safeResponse(
      data,
      data.ok === false && (code === "UNAUTHORIZED" || code === "INVALID_CREDENTIALS")
        ? 401
        : code === "D1_SERVICE_UNAVAILABLE"
          ? 503
          : 200
    );
    if (
      data.ok === true &&
      (action === "login" || action === "consumeOneTimeLoginCode") &&
      typeof data.authToken === "string"
    ) setSessionCookie(response, data.authToken, data.expiresAt);
    if (action === "logout" || code === "UNAUTHORIZED") clearSessionCookie(response);
    return response;
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Guest Star took too long to respond. Try again."
      : error instanceof Error
        ? error.message
        : "The Host Panel could not connect to Guest Star. Contact the Superhost if this continues.";
    const status = message === "FORBIDDEN" || message === "GOOGLE_EMAIL_MISMATCH"
      ? 403
      : ["UNAUTHORIZED", "INVALID_GOOGLE_CREDENTIAL", "GOOGLE_CREDENTIAL_EXPIRED", "GOOGLE_EMAIL_NOT_VERIFIED"].includes(message)
        ? 401
        : 502;
    return safeResponse({ ok: false, code: message, error: message }, status);
  }
}
