import { NextRequest, NextResponse } from "next/server";
import {
  backendMode,
  d1Health,
  ensureD1Schema,
  getMeta,
  getRecord,
  getGuestStarD1,
  importD1Snapshot,
  reserveDailyFreeTranslationBudget,
  type D1MigrationSnapshot,
  type JsonObject
} from "@/lib/guest-star/d1-store";
import {
  createMigrationSession,
  handleD1HostAction,
  setD1BackendMode
} from "@/lib/guest-star/d1-actions";
import {
  callAppsScript,
  flushD1BackupFully,
  scheduleD1Backup
} from "@/lib/guest-star/upstream";
import {
  estimateBrandingTranslationNeurons,
  getWorkersAiBinding,
  prepareBrandingLocalization
} from "@/lib/guest-star/translation";
import { verifyGoogleIdentityToken } from "@/lib/guest-star/google-identity";
import { runtimeEnvString } from "@/lib/guest-star/runtime-env";

const SESSION_COOKIE = "guest_star_host_session";
const DEFAULT_APPS_SCRIPT_TIMEOUT_MS = 30_000;
const HOTEL_PROVISIONING_TIMEOUT_MS = 120_000;
const MIGRATION_TIMEOUT_MS = 180_000;
const MAX_HOST_BODY_BYTES = 128 * 1024;
const READ_ONLY_D1_ACTIONS = new Set([
  "me", "adminState", "activityState", "listReviews", "hotelShare", "youtubeSearchV4"
]);

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

async function verifySuperhost(
  body: JsonObject,
  sessionToken: string,
  mode: string,
  db: NonNullable<ReturnType<typeof getGuestStarD1>>
) {
  const identity = mode === "d1_primary"
    ? await handleD1HostAction(db, { ...body, action: "me", authToken: sessionToken })
    : await callAppsScript({ action: "me", authToken: sessionToken });
  if (identity?.ok !== true || (identity.user as JsonObject | undefined)?.role !== "superhost") {
    throw new Error("FORBIDDEN");
  }
  return identity;
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
    let mode = "apps_script";
    if (db) {
      await ensureD1Schema(db);
      mode = await backendMode(db);
    }

    if (action.startsWith("d1")) {
      if (!db) return safeResponse({ ok: false, code: "D1_BINDING_NOT_CONFIGURED" }, 503);

      if (action === "d1Status") {
        await verifySuperhost(body, sessionToken, mode, db);
        return safeResponse(await d1Health(db));
      }

      if (action === "d1Prepare") {
        if (mode !== "apps_script") return safeResponse({ ok: false, code: "D1_ALREADY_ACTIVE" }, 409);
        const snapshot = await callAppsScript({
          action: "exportD1Snapshot",
          authToken: sessionToken
        }, MIGRATION_TIMEOUT_MS);
        if (snapshot.ok !== true) {
          return safeResponse({ ok: false, code: String(snapshot.code || "D1_EXPORT_FAILED") }, 400);
        }
        const imported = await importD1Snapshot(db, snapshot as D1MigrationSnapshot);
        return safeResponse({ ok: true, migration: imported, health: await d1Health(db) });
      }

      if (action === "d1Activate") {
        if (mode !== "apps_script") return safeResponse(await d1Health(db));
        const identity = await verifySuperhost(body, sessionToken, mode, db);
        const userId = String((identity.user as JsonObject).userId || "");
        const session = await createMigrationSession(db, userId);
        await setD1BackendMode(db, "d1_primary");
        const response = safeResponse(await d1Health(db));
        setSessionCookie(response, session.token, session.expiresAt);
        scheduleD1Backup(db);
        return response;
      }

      if (action === "d1Rollback") {
        await verifySuperhost(body, sessionToken, mode, db);
        if (mode === "d1_primary") {
          const backup = await flushD1BackupFully(db);
          if (backup.ok !== true) {
            return safeResponse({
              ok: false,
              code: "ROLLBACK_BACKUP_INCOMPLETE",
              error: "Rollback stopped because the latest D1 changes are not yet synchronized to Google Sheets.",
              backup
            }, 409);
          }
        }
        await setD1BackendMode(db, "apps_script");
        const response = safeResponse({
          ...await d1Health(db),
          signInRequired: true
        });
        clearSessionCookie(response);
        return response;
      }

      if (action === "d1BackupNow") {
        await verifySuperhost(body, sessionToken, mode, db);
        const backup = await flushD1BackupFully(db);
        return safeResponse({ ok: backup.ok, backup, health: await d1Health(db) }, backup.ok ? 200 : 502);
      }

      return safeResponse({ ok: false, code: "INVALID_D1_ACTION" }, 400);
    }

    if (action === "googleFallbackState" || action === "linkGoogleFallback") {
      const useD1 = Boolean(db && mode === "d1_primary");
      const identity = useD1
        ? await handleD1HostAction(db!, { action: "me", authToken: sessionToken })
        : await callAppsScript({ action: "me", authToken: sessionToken });
      if (identity?.ok !== true || !identity.user) {
        return safeResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
      }
      const user = identity.user as JsonObject;
      const backupSecret = useD1 ? await getMeta(db!, "sheets_backup_secret") : "";
      if (useD1 && !backupSecret) return safeResponse({ ok: false, code: "GOOGLE_FALLBACK_NOT_READY" }, 503);
      const googleClientId = runtimeEnvString("GOOGLE_OAUTH_CLIENT_ID");
      const appsScriptAuth = useD1 ? { backupSecret } : { authToken: sessionToken };

      if (action === "linkGoogleFallback") {
        if (!googleClientId) return safeResponse({ ok: false, code: "GOOGLE_SIGN_IN_NOT_CONFIGURED" }, 503);
        const verified = await verifyGoogleIdentityToken(body.credential, googleClientId);
        const accountEmail = String(user.email || "").trim().toLowerCase();
        if (!accountEmail || verified.email !== accountEmail) {
          return safeResponse({ ok: false, code: "GOOGLE_EMAIL_MISMATCH" }, 403);
        }
        const linked = await callAppsScript({
          action: "provisionGoogleFallback",
          ...appsScriptAuth,
          userId: String(user.userId || ""),
          role: String(user.role || ""),
          displayName: String(user.displayName || user.username || "Guest Star Host"),
          email: verified.email,
          hotelId: String(body.hotelId || ""),
          venueId: String(body.venueId || ""),
          activityId: String(body.activityId || "")
        }, HOTEL_PROVISIONING_TIMEOUT_MS);
        return safeResponse({ ...linked, googleClientId, googleEmail: verified.email });
      }

      const state = await callAppsScript({
        action: "googleFallbackState",
        ...appsScriptAuth,
        userId: String(user.userId || ""),
        role: String(user.role || "")
      }, HOTEL_PROVISIONING_TIMEOUT_MS);
      let effectiveDefaultGoogleFallback = state.defaultGoogleFallback;
      if (useD1) {
        const stored = await getRecord(db!, "GlobalSettings", "defaultGoogleFallback");
        try {
          const parsed = JSON.parse(String(stored?.settingValue || "{}"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            effectiveDefaultGoogleFallback = parsed as JsonObject;
          }
        } catch {
          // Keep the Apps Script mirror value if the D1 record is not valid JSON.
        }
      }
      return safeResponse({
        ...state,
        defaultGoogleFallback: effectiveDefaultGoogleFallback,
        googleClientId,
        googleSignInEnabled: Boolean(googleClientId),
        accountEmail: String(user.email || "")
      });
    }

    let translationWarning = "";
    if (action === "updateHotelBranding" && db && mode === "d1_primary") {
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

    let data: JsonObject;
    if (db && mode === "d1_primary") {
      data = await handleD1HostAction(db, payload) || {
        ok: false,
        code: "D1_ACTION_NOT_IMPLEMENTED"
      };
      if (data.ok === true && !READ_ONLY_D1_ACTIONS.has(action)) scheduleD1Backup(db);
    } else {
      const timeoutMs = action === "createHotel"
        ? HOTEL_PROVISIONING_TIMEOUT_MS
        : DEFAULT_APPS_SCRIPT_TIMEOUT_MS;
      data = await callAppsScript(payload, timeoutMs);
    }
    if (translationWarning && data.ok === true && !data.warning) data.warning = translationWarning;

    const code = String(data.code || "");
    const response = safeResponse(
      data,
      data.ok === false && (code === "UNAUTHORIZED" || code === "INVALID_CREDENTIALS") ? 401 : 200
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
