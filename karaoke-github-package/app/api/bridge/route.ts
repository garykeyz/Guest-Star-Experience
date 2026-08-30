import { NextRequest, NextResponse } from "next/server";
import { ensureD1Schema, getGuestStarD1, type JsonObject } from "@/lib/guest-star/d1-store";
import { handleD1HostAction, loginD1WithVerifiedGoogle } from "@/lib/guest-star/d1-actions";
import { verifyGoogleIdentityToken } from "@/lib/guest-star/google-identity";
import { runtimeEnvString } from "@/lib/guest-star/runtime-env";
const MAX_BODY_BYTES = 512 * 1024;

export const dynamic = "force-dynamic";

function response(data: JsonObject, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Guest-Star-Bridge-Proxy": "4.4.0"
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
    const action = String(payload.action || "");
    const googleClientId = runtimeEnvString("GOOGLE_OAUTH_CLIENT_ID");
    if (action === "googleLoginConfig") {
      return response({
        ok: Boolean(googleClientId),
        code: googleClientId ? "" : "GOOGLE_SIGN_IN_NOT_CONFIGURED",
        googleClientId
      }, googleClientId ? 200 : 503);
    }
    if (action === "googleLogin") {
      if (!googleClientId) {
        return response({ ok: false, code: "GOOGLE_SIGN_IN_NOT_CONFIGURED" }, 503);
      }
      const verified = await verifyGoogleIdentityToken(payload.credential, googleClientId);
      const loginPayload: JsonObject = {
        action: "googleBridgeLogin",
        email: verified.email,
        clientType: "bridge",
        deviceId: String(payload.deviceId || ""),
        deviceName: String(payload.deviceName || "Guest Star Bridge"),
        bridgeVersion: String(payload.bridgeVersion || "4.4.0"),
        rememberLogin: payload.rememberLogin !== false
      };
      if (db) {
        await ensureD1Schema(db);
        return response(await loginD1WithVerifiedGoogle(db, verified.email, loginPayload));
      }
      return response({ ok: false, code: "GOOGLE_LOGIN_NOT_READY" }, 503);
    }
    if (db) {
      await ensureD1Schema(db);
      const data = await handleD1HostAction(db, payload) || {
        ok: false,
        code: "D1_ACTION_NOT_IMPLEMENTED"
      };
      return response(data, data.ok === false && data.code === "UNAUTHORIZED" ? 401 : 200);
    }
    return response({
      ok: false,
      code: "D1_SERVICE_UNAVAILABLE",
      error: "Guest Star D1 is required for live operation."
    }, 503);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["INVALID_GOOGLE_CREDENTIAL", "GOOGLE_CREDENTIAL_EXPIRED", "GOOGLE_EMAIL_NOT_VERIFIED"].includes(code)) {
      return response({ ok: false, code }, 401);
    }
    return response({
      ok: false,
      code: "BRIDGE_UPSTREAM_UNAVAILABLE",
      error: error instanceof Error && error.name === "AbortError"
        ? "Guest Star took longer than 60 seconds to respond. Try again."
        : "Bridge could not reach Guest Star. Contact the Superhost if this continues."
    }, 502);
  }
}
