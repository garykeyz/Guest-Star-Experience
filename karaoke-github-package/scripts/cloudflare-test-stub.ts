export function getCloudflareContext(): never {
  throw new Error("Cloudflare context is not available in the in-memory D1 test.");
}
