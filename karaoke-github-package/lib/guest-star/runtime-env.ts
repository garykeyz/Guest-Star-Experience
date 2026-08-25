import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Reads runtime configuration from the deployed Cloudflare Worker first and
 * falls back to process.env for local Next.js builds and tests.
 */
export function runtimeEnvString(key: string): string {
  try {
    const context = getCloudflareContext();
    const env = context.env as unknown as Record<string, unknown>;
    const value = env[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  } catch {
    // Cloudflare context is unavailable during local Next.js execution.
  }

  return String(process.env[key] || "").trim();
}
