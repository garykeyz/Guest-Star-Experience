const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "drive.usercontent.google.com",
  "docs.google.com"
]);

function validDriveFileId(value: string | null | undefined) {
  const candidate = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{10,}$/.test(candidate) ? candidate : "";
}

export function googleDriveFileId(value: string | null | undefined) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source);
    if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return "";
    const pathMatch = url.pathname.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})(?:\/|$)/);
    return validDriveFileId(pathMatch?.[1] || url.searchParams.get("id"));
  } catch {
    return "";
  }
}

export function normalizeBrandImageUrl(value: string | null | undefined) {
  const source = String(value || "").trim();
  const fileId = googleDriveFileId(source);
  if (!fileId) return source;
  const thumbnail = new URL("https://drive.google.com/thumbnail");
  thumbnail.searchParams.set("id", fileId);
  thumbnail.searchParams.set("sz", "w1000");
  try {
    const resourceKey = new URL(source).searchParams.get("resourcekey");
    if (resourceKey) thumbnail.searchParams.set("resourcekey", resourceKey);
  } catch {
    // The source was already validated above, so this is only defensive.
  }
  return thumbnail.toString();
}
