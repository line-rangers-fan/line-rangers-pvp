# LINE Rangers PvP + Community production cutover checklist

This document is deliberately conservative. The public review Worker is the staging surface. The canonical PvP repository/site must not be switched until every gate below is satisfied and the owner explicitly approves the cutover.

## 1. Freeze and inventory

- Record the exact copy-repository commit that passed build, regression, and live verification.
- Re-read the canonical `line-rangers-fan/line-rangers-pvp` main branch and its current deployment topology immediately before any production change.
- Inventory Cloudflare Worker, D1, R2, routes/domains, and secret **names only**. Never print secret values, account IDs, database IDs, access tokens, or owner credentials.
- Do not assume an old D1/R2 resource still exists because it existed historically.
- Keep review and production storage isolated. Never point production at `line-rangers-copy-review-db` or `line-rangers-copy-review-media` by accident.

## 2. Preserve the canonical PvP behavior

- PvP remains the home/default surface; `/boards` remains secondary.
- Preserve Legend top-200 semantics and the existing JST comparison rules.
- Fail closed on incomplete/invalid PvP snapshots. Never overwrite the last known-good snapshot with empty, malformed, extreme-drop, invalid-player, or sub-200 data.
- Verify PvP static rendering without relying on D1, R2, translation, upload, or board APIs. A community outage must not prevent the ranking from loading.

## 3. Production storage

- Use a dedicated production D1 database and R2 bucket unless an existing canonical resource is positively identified and validated.
- Back up/export existing production data before the first migration or binding change.
- Apply D1 migrations before enabling community write traffic.
- Verify D1 read/write capability and R2 read/write/range capability using non-user test data, then remove the test artifacts.
- Validate object size/type restrictions and multipart cleanup/expiry behavior before enabling video uploads.

## 4. Secrets and identity

Required or conditional secret names must be configured in the production environment without logging values:

- `BOARD_ANON_COOKIE_SECRET`
- `BOARD_OWNER_ACCESS_TOKEN`
- `BOARD_OWNER_SUBJECT`
- `GOOGLE_TRANSLATE_API_KEY` only if translation is enabled
- Cloudflare deployment credentials only in GitHub/Cloudflare secret stores

Checks:

- Display names such as Owner, 運営, 管理人, or Moderator never grant permissions.
- Owner elevation is server-side and bound to the configured owner subject.
- Only Owner can add/remove moderators.
- Role and contribution/title badges remain separate.
- Cross-origin mutations fail closed.

## 5. Community data-path verification

Test with disposable records and clean them up afterwards:

- Post a comment, reload, and confirm persistence.
- Retry the same idempotency/request ID and confirm no duplicate is created.
- Confirm the draft clears only after server success and remains after failure.
- Vote, change vote, reload, and confirm one active vote per user.
- Like/helpful reactions remain unique and removable.
- Upload an allowed image and an allowed video; verify R2 persistence and bounded video range playback.
- Verify text-only video comments and the configured maximum reply depth.
- Verify pin/hide/delete/restore and audit-log recording.
- Verify current-month and archived-month behavior.
- Verify NEW/read markers across reloads.

## 6. Failure isolation

Explicitly exercise degraded states before release:

- Board API unavailable -> PvP still loads normally.
- D1 unavailable -> PvP still loads; board fails cleanly without corrupting data.
- R2 unavailable -> PvP and text comments still load; media failure remains localized.
- Translation upstream unavailable -> original text and the rest of the board remain usable.
- Upload timeout/retry -> no duplicate post or orphaned final record.
- Collector failure or incomplete sample -> last known-good PvP data remains visible.

## 7. Security and abuse review

- Keep `Cache-Control: no-store` on identity-sensitive JSON responses.
- Keep `X-Content-Type-Options: nosniff` and Worker-wide browser security headers.
- Keep signed anonymous identity, rate limits, origin checks, input length/type checks, HTML execution prevention, and server-side authorization.
- Do not expose lists of people who liked/helped a post unless explicitly redesigned with privacy review.
- Check logs for accidental token, secret, account-ID, database-ID, or private-source leakage.
- Keep public browser assets independent of private-repository authentication.

## 8. Visual and device review

Compare the canonical PvP appearance and the candidate production build at matching viewports:

- phone
- tablet/iPad
- desktop

Review layout, typography, spacing, character image dimensions, table columns, overflow, controls, modal behavior, language switching, hidden states, and `/boards` navigation. Do not mark complete merely because automated tests pass.

## 9. Final release gate

All of the following must be green at the same candidate commit:

- build
- complete regression suite
- 200/200 PvP validation
- D1 runtime health
- R2 runtime health
- board API response
- signed anonymous identity
- browser CSS/JS asset delivery
- community/PvP failure isolation
- mobile/tablet/desktop review
- owner/moderator authorization checks
- backup and rollback readiness

Only after these checks and explicit owner approval should the canonical site be changed.

## 10. Rollback

Before cutover, record the previous known-good Worker/version and repository commit. If a production gate fails after cutover:

1. stop community write traffic or enable read-only mode if necessary;
2. roll the application back to the previous known-good version;
3. do not roll D1 schema/data backward destructively without a verified restoration plan;
4. keep the last known-good PvP snapshot intact;
5. diagnose on the isolated review environment;
6. repeat the full release gate before attempting another cutover.
