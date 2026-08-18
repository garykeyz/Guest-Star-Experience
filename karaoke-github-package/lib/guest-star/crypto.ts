const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: unknown, salt: unknown) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(salt || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(String(secret || ""))
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function sha256Hex(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return bytesToHex(new Uint8Array(digest));
}

export function safeEqual(left: unknown, right: unknown) {
  const first = String(left || "");
  const second = String(right || "");
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

export function randomToken(length = 64) {
  const size = Math.max(12, Math.min(128, Math.round(length || 64)));
  const bytes = new Uint8Array(Math.ceil(size / 2));
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes).slice(0, size);
}

export function randomId() {
  return crypto.randomUUID();
}
