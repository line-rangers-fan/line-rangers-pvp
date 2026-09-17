# Owner review copy — verification status

This checkout is isolated from `line-rangers-fan/line-rangers-pvp`. It does not write to the primary PvP repository, its workflows, Pages, production data or history.

## Current review flow

- `/` launches `/pvp/index.html` and the PvP ranking is the primary surface.
- `/boards` remains the new-character community board.
- The PvP surface is now physically tracked under `public/pvp/`; it is no longer a redirect to a missing generated directory.
- The browser reads the committed same-origin `public/pvp/data/character_usage.json`, not a private GitHub raw/Pages URL.
- A community entry card links the ranking surface to `/boards` without replacing the ranking.

## PvP snapshot integrity

`refresh-pvp-data` collects the public `rangers.lerico.net` LEGEND ranking and validates all 200 player detail records before producing a new snapshot. A partial top-200 or failed player detail causes the collection to fail closed instead of overwriting the last known good snapshot. Character occurrence count, unique-player adoption count/rate, and WEAPON/ARMOR/ACC equipment counts are derived from the validated player teams.

The committed bootstrap snapshot was produced from a verified 200/200 collection. Comparison history is accumulated in the copy repository. A comparison period without a valid saved reference remains explicitly non-comparable and the UI shows `履歴待ち`; it does not invent a delta.

## Board security and integrity

- Owner / Moderator / User authorization is server-side. Display names such as `運営`, `管理人`, `Owner` or `Moderator` do not grant roles.
- Owner activation uses a signed HttpOnly cookie and fixed-size hashed token comparison.
- Cross-origin mutations fail closed and privileged mutations are checked by the API.
- Comment requests use request IDs/idempotency. Successful posts clear the controlled input/persisted draft; failed posts preserve it.
- September 2026 new-character topic uses `u1631e-sally` / `かに座 サリー` / ultimate evolution.
- The public verification repository must contain no credential, Owner token, signing secret, DB/Storage secret or personal data.

## Build architecture

The previous unauthenticated private-repository codeload dependency was removed. Build now consumes tracked review assets and does not require a token for the private primary repository. `verify-owner-copy` performs locked install, Vinext/Cloudflare build and Node regression tests. `refresh-pvp-data` updates only validated snapshot/history files and does not deploy the site.

## Still required before broad production release

This remains an Owner review copy, not a production-readiness claim. Broad release still requires deployed multi-account identity/RBAC tests, physical phone/iPad media tests, abuse/load tests, backup/restore drill, retention/deletion policy, automatic verified new-character ingestion, production translation configuration, and a release decision by the Owner. GitHub Pages/Production publication is not part of this verification flow.
