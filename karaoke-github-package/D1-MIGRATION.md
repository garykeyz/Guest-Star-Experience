# Guest Star 4.2 — Cloudflare D1 Migration

Guest Star 4.2 moves live authentication, sessions, hotels, activities, requests and Bridge state to Cloudflare D1. Google Sheets remains the migration source and receives an asynchronous, idempotent hot-standby replica plus an append-only event log; it is no longer required for every click.

## Safety model

- Deployment starts in `apps_script` mode. Existing production behavior remains unchanged.
- `Import & Validate` copies data without changing live traffic.
- Activation is rejected unless the snapshot contains an active Superhost, all active-user password hashes, every active hotel snapshot and matching row counts.
- `Rollback` first drains and materializes every pending backup event into the
  original Sheets. It refuses to switch if that synchronization is incomplete.
- Existing Bridge device sessions are intentionally revoked during import. Each Bridge signs in once after activation; this prevents copying device/session secrets.
- The Superhost session is exchanged server-side during activation, so the Superhost stays signed in.

## Deployment order

1. Copy `google-apps-script/Code.gs` into the master Apps Script project and update the existing Web App deployment. Keep the same Web App URL.
2. Deploy the Cloudflare Worker:

   ```bash
   npm run deploy
   ```

   Wrangler automatically provisions the `GUEST_STAR_DB` D1 binding when it does not exist. Runtime schema bootstrap remains enabled as a recovery path.
3. Sign in at `https://host.gstarxp.com/host` as Superhost.
4. In **Fast Backend · Cloudflare D1**:
   - Select **Check Status**.
   - Select **Import & Validate**.
   - Confirm migration status is `ready` and the user/hotel/activity/request counts are correct.
   - Select **Activate D1**.
5. Sign in once on each Bridge Mac and load its assigned activity.
6. Select **Backup Now** and confirm `BACKUP PENDING` returns to `0`.

## Rollback

Select **Rollback** in the Superhost panel. The application first verifies that
the Sheets hot standby contains every D1 mutation, then returns to Apps Script
and clears the D1 browser session. If synchronization is unavailable, rollback
stops without changing live traffic. Sign in again with the same permanent
Superhost password after a successful rollback. D1 data is retained for
diagnosis and a later retry.

## Passwords and sessions

- Existing permanent passwords remain valid because D1 uses the same HMAC-SHA256 password-hash format as Apps Script.
- Passwords are never stored in plaintext and therefore cannot be displayed after saving.
- The Superhost can replace a Host password at any time; this revokes that Host’s sessions and Bridge devices.
- “Keep me signed in” creates a revocable 30-day HttpOnly cookie. A non-remembered session lasts 12 hours.

## Backup

Each D1 mutation creates an outbox event. Cloudflare sends pending events
asynchronously to the master Sheet tab `D1BackupEvents`, authenticated with a
96-character service secret generated during export. Apps Script records each
event idempotently and applies it to the corresponding master/hotel table, so
Sheets remains a hot standby rather than merely an audit log. Hotels created
after activation receive their own standby Sheet asynchronously. Failed
deliveries remain pending and can be retried with **Backup Now**.

The log contains password hashes and salts where required for disaster recovery, but never plaintext passwords, browser tokens, one-time login codes or Bridge device tokens.

## Free tier

This design fits Cloudflare’s free plans for a normal Guest Star installation. Current included D1 limits and Workers request limits should be checked before a large rollout:

- <https://developers.cloudflare.com/d1/platform/pricing/>
- <https://developers.cloudflare.com/workers/platform/pricing/>

No MySQL server is required.
