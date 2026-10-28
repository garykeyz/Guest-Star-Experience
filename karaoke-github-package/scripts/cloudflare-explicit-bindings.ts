// The scoped worker adapter receives env.GUEST_STAR_DB directly. Code paths
// that require a Next request context must continue through the original worker.
export function getCloudflareContext():never {throw new Error('Explicit Cloudflare bindings required for this adapter.');}
