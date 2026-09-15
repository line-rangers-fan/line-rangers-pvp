# Community hardening & performance plan

Status: implementation/release gate. Fail closed. This branch is not approval to publish.

## Goals

1. Owner/Moderator/User identity and authorization cannot be forged from browser state, display name, cookie edits, or direct API calls.
2. Community failures never block PvP reads/collection/publication.
3. Mobile-first pages stay responsive on slow networks and large histories.
4. Media is validated, bounded, non-autoplaying, and delivered without forcing full video downloads during list browsing.
5. Retries are idempotent and do not double-vote, double-react, double-post, or orphan media.
6. Public APIs reveal no email, IP, raw internal identity ID, authorization metadata, or secrets.

## Identity and role invariants

- The server creates a random opaque user identity and stores the role server-side.
- Browser cookie contains only an opaque authenticated session token: Secure, HttpOnly, SameSite=Lax or stricter.
- Display name is profile data only. Names such as `運営`, `管理人`, `Owner`, `Moderator`, or visually similar Unicode text never grant a badge or privilege.
- Owner bootstrap matches one preconfigured verified owner principal on the server. Never ship the owner email/principal to public JS, HTML, JSON, logs, or API responses.
- `Owner` badge is rendered only from a server-authorized response for that stable identity.
- Only Owner can grant/revoke Moderator. Moderator cannot grant roles or alter Owner.
- Achievement/title badges are a separate namespace/table and cannot imply authorization.
- Invalid/tampered/expired sessions fail to ordinary User, never upward.
- Every privileged mutation re-checks authorization server-side; UI hiding is not security.
- Role changes and moderation actions append immutable audit events containing actor identity, target identity/content, action and timestamp, while public responses expose none of those internal IDs.

## Abuse and mutation safety

- Per-route rate limits for identity creation, posting, voting, reactions, role changes and uploads; stricter limits for anonymous identity creation and uploads.
- Human verification may be required only after abuse thresholds; failure must not block PvP browsing.
- Every mutation accepts a bounded idempotency key and persists the result so retry returns the original result.
- Unique DB constraints enforce one vote per `(user_id, character_id, poll_type)` and one reaction per `(user_id, post_id, reaction_type)`.
- Enforce allowed Host/Origin and CSRF protection. Credentialed CORS never uses `*`.
- Validate UTF-8 text length, enum values, IDs and control characters server-side; render user text escaped.
- Parameterized database queries only. Generic external errors; detailed diagnostics stay in redacted server logs.

## Media pipeline and performance budget

Upload hard limit remains 12 MiB. Validate file signatures/container metadata, not only filename/MIME. Reject SVG/HTML/executable/polyglot/path-traversal attempts by default. Generate object keys server-side.

Images:
- Decode safely, strip unnecessary metadata, normalize orientation, create bounded display thumbnail, retain original only when product requirements require it.
- Lazy-load below-fold images and provide explicit dimensions to avoid layout shift.

Video:
- No autoplay. List/feed pages use poster metadata only and MUST NOT preload the full video (`preload=\"none\"`).
- Generate a small poster thumbnail server-side.
- Transcode asynchronously to a browser-safe delivery profile when the source is materially larger than the delivery target; cap dimensions/frame rate/bitrate rather than blindly recompressing already-efficient media.
- Do not publish a transcoded object until container validation succeeds. Keep processing state separate from the post so a failed transcode cannot corrupt the post.
- Clean temporary/orphan objects after bounded retry/reconciliation.
- Serve media with correct Content-Type, nosniff, immutable/versioned cache headers for content-addressed objects, and byte-range support for video.

Page/runtime budgets:
- Community entry critical JS/CSS must stay small and dependency-free.
- Paginate comments, reactions, moderation history and archives; never render unbounded collections.
- Defer noncritical board/media work until after PvP ranking bootstrap.
- Avoid duplicate data sources: community may read validated PvP output but never duplicate/mutate ranking history.
- Cache immutable static assets aggressively by version; HTML/API/private personalized responses must use appropriate no-store/private semantics.

## Required negative tests

- Tampered cookie/session cannot impersonate another user or become Moderator/Owner.
- A User named `運営` receives User permissions and no Owner/Moderator badge.
- User cannot invoke moderation endpoints; Moderator cannot invoke role-grant/Owner endpoints.
- Client-supplied role/badge fields are ignored/rejected.
- Duplicate/retried vote, reaction, post and upload-finalize calls are idempotent.
- Cross-site credentialed mutation is rejected.
- Stored/reflected XSS payloads render inert.
- Oversize, mismatched MIME/signature, executable, SVG/HTML, malformed container and traversal uploads are rejected.
- Feed browsing does not download video bodies before user playback.
- Timeout/transcode failure leaves no permanently orphaned object and does not block PvP.
- Public API snapshots contain no email/IP/raw user ID/session token/role-assignment metadata.
- Long Japanese/multilingual text and media do not create horizontal overflow at 320px width.
- Backup AND restore are demonstrated in a disposable environment.

## Release gate

Do not merge/publish the integrated board until all applicable tests above have executable evidence. GitHub Pages stays disabled and repository visibility stays private unless the owner explicitly approves public reopening.
