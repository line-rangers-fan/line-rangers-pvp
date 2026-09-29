# LINE Rangers Community — Security & Migration Contract

Status: implementation gate for the community board migration. This file is intentionally fail-closed: an item that has not been verified must not be represented as complete.

## Isolation

- PvP collection/publication and community writes are separate failure domains.
- Community failures must never block or overwrite valid PvP snapshots.
- Community reads may consume validated PvP output; community code must not mutate PvP history.

## Anonymous identity

- The server, not browser JavaScript, creates the stable anonymous user identifier.
- Browser receives an opaque, authenticated session/identity cookie only.
- Cookie requirements: `Secure`, `HttpOnly`, `SameSite=Lax` or stricter, explicit expiry/rotation policy. Do not store role, owner flag, raw database ID, email, IP address, or signing secret in a client-readable cookie.
- Display name is mutable profile data and is never an authorization principal.
- Returning users recover the stored display name through their stable server-side identity.
- Changing a display name must not create a new voter/reactor/post author.
- Invalid, expired, malformed, or tampered identity cookies fail closed and receive a new ordinary User identity; they can never become Owner/Moderator.
- Identity creation, voting, reactions, posts and uploads are rate-limited. Add human verification when abuse thresholds are crossed.

## Authorization

Roles: Owner, Moderator, User. All authorization is server-side.

- Owner bootstrap is explicit and auditable; display names never grant roles.
- Only Owner can grant/revoke Moderator.
- Moderator cannot grant roles, change Owner, or edit authorization configuration.
- Pin/unpin/hide/delete/restore actions require server authorization and audit records.
- Deletes are soft deletes by default; destructive purge is a separate privileged operation.
- Achievement/title data is separate from roles and cannot grant privileges.

## Request integrity

- Mutations accept an idempotency/request ID and reject/replay duplicate submissions safely.
- Enforce Origin/Host policy and CSRF protection appropriate to the chosen cookie mode.
- CORS uses an explicit allowlist; never `*` for credentialed mutation endpoints.
- Server validates IDs, enum values, lengths, Unicode/control characters and empty content.
- User text is stored as text and rendered escaped; arbitrary HTML/script/event handlers are never executed.
- Database queries are parameterized.
- Error responses do not expose stack traces, secrets, SQL, internal IDs or infrastructure details.

## Voting and reactions

- Unique constraint: `(user_id, character_id, poll_type)`; changing a vote updates the existing vote.
- Unique constraint: `(user_id, post_id, reaction_type)` for like/helpful.
- Server, not UI state, enforces uniqueness.
- Deleted/hidden content cannot be newly reacted to.

## Uploads

- Current maximum: 12 MiB per file.
- Allowlist supported image/video types; validate magic bytes/container metadata in addition to extension and claimed MIME.
- Reject executable/HTML/SVG payloads unless separately sanitized and explicitly required (default: reject).
- Generate server-side object keys; never trust user filenames as storage paths.
- Strip/ignore path components, prevent traversal and overwrite, and use non-executable object delivery headers.
- Do not autoplay video. Video-detail comments are text-only and cannot create a third media/comment hierarchy.
- Rate-limit uploads and apply storage/traffic quotas. Failed DB writes must not leave untracked permanent objects; use cleanup/reconciliation.

## New-character ingestion

Do not equate “first observed in top-200 PvP” with “new release”.

Candidate state machine:

`unknown -> observed -> reconfirmed -> metadata_verified -> approved -> published`

Publication requires:
1. Stable unknown character ID.
2. Re-observation in multiple valid collection runs.
3. Verified name, evolution/stage relationship and image metadata.
4. Match against a trusted release source or approved character registry.
5. Current JST month assignment.
6. Idempotent creation keyed by stable character ID.

Failures keep the candidate unpublished and must not affect PvP collection.

For September 2026, the approved board target is exactly `u1631e-sally`, display name `かに座 サリー`. Do not merge the other evolution by name/image similarity. A missing image uses a placeholder keyed to this ID; replacement is permitted only after ID/stage validation.

## Persistence and recovery

Persist posts, polls, reactions, display names, read markers, roles and audit records in the database. Store media in object storage.

- Define backup cadence and retention.
- Test restore, not just backup creation.
- Schema migrations must be forward/backward considered and backed up before destructive changes.
- Pagination is mandatory for unbounded lists (posts/reactions/audit log).
- Timestamps are stored unambiguously; board month boundaries and display use JST rules.

## Privacy

- Do not expose IP addresses, emails, raw internal identity IDs or moderation-only metadata in public board APIs/UI.
- Collect only abuse/security metadata that is necessary and define retention.
- Logs must redact cookies, authorization tokens and secrets.

## Required negative tests before public migration

1. Tampered/expired cookie cannot impersonate another user or gain a role.
2. Display-name change preserves identity; naming oneself `運営` grants nothing.
3. User cannot call moderator/owner endpoints directly.
4. Moderator cannot grant Moderator/Owner.
5. Duplicate vote/reaction/request cannot increment twice.
6. Cross-site credentialed mutation is rejected.
7. Script/HTML injection renders inert.
8. Oversized, mismatched-MIME, executable and traversal upload attempts are rejected.
9. Video-detail comments reject media/URL/embed and third-level nesting.
10. Timeout/retry does not duplicate a post or orphan media indefinitely.
11. DB/storage/community outage leaves PvP functioning and valid snapshots untouched.
12. New-character false positive remains unpublished.
13. Wrong Sally evolution/image cannot replace `u1631e-sally`.
14. JST month boundary, year boundary and leap-year cases pass.
15. Mobile layouts tolerate long names, long multilingual text and media without horizontal overflow.
16. Backup restore is demonstrated against a disposable environment.

## Release gate

Do not call the GitHub-integrated board production-ready until the implementation has evidence for every applicable requirement above. Do not publish GitHub Pages or change repository visibility as part of this work without explicit owner approval.
