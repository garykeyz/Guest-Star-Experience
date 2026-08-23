type GoogleTokenHeader = { alg?: string; kid?: string };
type GoogleJwk = JsonWebKey & { kid?: string; kty?: string };
export type VerifiedGoogleIdentity = {
  sub: string;
  email: string;
  name: string;
  picture: string;
};

type VerifyOptions = {
  fetcher?: typeof fetch;
  now?: number;
};

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let cachedKeys: { expiresAt: number; keys: GoogleJwk[] } | null = null;

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function cacheSeconds(response: Response) {
  const match = String(response.headers.get("cache-control") || "").match(/max-age=(\d+)/i);
  return Math.max(60, Math.min(86_400, Number(match?.[1]) || 3_600));
}

async function googleKeys(fetcher: typeof fetch, now: number) {
  if (cachedKeys && cachedKeys.expiresAt > now) return cachedKeys.keys;
  const response = await fetcher(GOOGLE_CERTS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("GOOGLE_CERTS_UNAVAILABLE");
  const data = await response.json() as { keys?: GoogleJwk[] };
  if (!Array.isArray(data.keys) || !data.keys.length) throw new Error("GOOGLE_CERTS_INVALID");
  cachedKeys = { keys: data.keys, expiresAt: now + cacheSeconds(response) * 1000 };
  return data.keys;
}

function audienceMatches(audience: unknown, clientId: string) {
  if (typeof audience === "string") return audience === clientId;
  return Array.isArray(audience) && audience.some((value) => value === clientId);
}

export async function verifyGoogleIdentityToken(
  token: unknown,
  clientId: string,
  options: VerifyOptions = {}
): Promise<VerifiedGoogleIdentity> {
  const source = String(token || "");
  if (!clientId || source.length < 100 || source.length > 16_384) throw new Error("INVALID_GOOGLE_CREDENTIAL");
  const parts = source.split(".");
  if (parts.length !== 3) throw new Error("INVALID_GOOGLE_CREDENTIAL");

  let header: GoogleTokenHeader;
  let claims: Record<string, unknown>;
  try {
    header = decodeJson<GoogleTokenHeader>(parts[0]);
    claims = decodeJson<Record<string, unknown>>(parts[1]);
  } catch {
    throw new Error("INVALID_GOOGLE_CREDENTIAL");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Error("INVALID_GOOGLE_CREDENTIAL");

  const now = options.now ?? Date.now();
  const keys = await googleKeys(options.fetcher || fetch, now);
  const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new Error("INVALID_GOOGLE_CREDENTIAL");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!validSignature) throw new Error("INVALID_GOOGLE_CREDENTIAL");

  const nowSeconds = Math.floor(now / 1000);
  const issuer = String(claims.iss || "");
  const expiry = Number(claims.exp || 0);
  const issuedAt = Number(claims.iat || 0);
  const email = String(claims.email || "").trim().toLowerCase();
  if (!["accounts.google.com", "https://accounts.google.com"].includes(issuer)) throw new Error("INVALID_GOOGLE_CREDENTIAL");
  if (!audienceMatches(claims.aud, clientId)) throw new Error("INVALID_GOOGLE_CREDENTIAL");
  if (!Number.isFinite(expiry) || expiry <= nowSeconds - 30) throw new Error("GOOGLE_CREDENTIAL_EXPIRED");
  if (issuedAt && (!Number.isFinite(issuedAt) || issuedAt > nowSeconds + 300)) throw new Error("INVALID_GOOGLE_CREDENTIAL");
  if (claims.email_verified !== true || !email || !String(claims.sub || "")) throw new Error("GOOGLE_EMAIL_NOT_VERIFIED");

  return {
    sub: String(claims.sub),
    email,
    name: String(claims.name || ""),
    picture: String(claims.picture || "")
  };
}

export function clearGoogleIdentityKeyCacheForTests() {
  cachedKeys = null;
}
