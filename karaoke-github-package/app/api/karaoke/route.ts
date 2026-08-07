import { NextRequest, NextResponse } from "next/server";

const APPS_SCRIPT_ENDPOINT =
  process.env.KARAOKE_APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbxpUugPQJ1N3yb8uezB6fpd84CELAKtbuB2maE3HberOBGo5ObABGtN3ZfCI3UvKbLkzg/exec";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

function errorResponse(message: string, status = 502) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

async function readAppsScriptJson(response: Response): Promise<JsonObject> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Guest Star respondió ${response.status}.`);
  }
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    throw new Error(
      "Guest Star no devolvió una respuesta válida. Intenta de nuevo o avisa al equipo de la actividad."
    );
  }
}

async function forward(url: URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });
    const data = await readAppsScriptJson(response);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Guest Star tardó demasiado en responder. Intenta de nuevo."
        : error instanceof Error
          ? error.message
          : "No se pudo conectar con Guest Star.";
    return errorResponse(message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "";
  if (!["", "status", "publicBootstrap"].includes(action)) {
    return errorResponse("Public action is not allowed.", 403);
  }
  const target = new URL(APPS_SCRIPT_ENDPOINT);
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== "callback") target.searchParams.set(key, value);
  });
  target.searchParams.set("t", String(Date.now()));
  return forward(target);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  let parsed: JsonObject;
  try {
    parsed = JSON.parse(body) as JsonObject;
  } catch {
    return errorResponse("La solicitud no contiene datos válidos.", 400);
  }
  const action = String(parsed.action || "");
  if (!["", "submitReview", "createGuestReminder", "unsubscribeGuest"].includes(action)) {
    return errorResponse("Public action is not allowed.", 403);
  }
  return forward(new URL(APPS_SCRIPT_ENDPOINT), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body
  });
}
