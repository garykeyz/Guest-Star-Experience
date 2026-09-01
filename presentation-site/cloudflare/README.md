# GStarXP direct Cloudflare deployment

This folder is a standalone, static Cloudflare Worker deployment for the Guest Star Experience presentation site. It does not use the Guest Star application Worker, D1 database, or `main` branch.

## Deployment

Pushing changes to `site/gstarxp-presentation` runs the dedicated GitHub Actions workflow. The repository needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` configured as GitHub Actions secrets.

## Domain setup in Cloudflare

After the first successful deployment, create the following Worker Route in the Cloudflare dashboard for the `gstarxp.com` zone:

- `gstarxp.com/*` → `gstarxp-site`

Optionally add `www.gstarxp.com/*` to the same Worker after deciding whether `www` should serve the site or redirect to the apex domain. The zone must be proxied by Cloudflare for a Worker Route to apply.
