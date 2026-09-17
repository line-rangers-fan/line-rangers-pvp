import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

assert.match(source, /PRIVATE_PREVIEW_MODE/);
assert.match(source, /PRIVATE_PREVIEW_COOKIE_SECRET/);
assert.match(source, /BOARD_OWNER_ACCESS_TOKEN/);
assert.match(source, /BOARD_OWNER_SUBJECT/);
assert.match(source, /__Host-lr_private_preview/);
assert.match(source, /__Host-lr_owner/);
assert.match(source, /__Host-lr_display_name/);
assert.match(source, /__private\\/login/);
assert.match(source, /__private\\/activate/);
assert.match(source, /__private\\/logout/);
assert.match(source, /sameSecret/);
assert.match(source, /x-robots-tag/);
assert.match(source, /X-Frame-Options/);
assert.match(source, /privatePreviewEnabled\\(env\\)/);
assert.match(source, /!await hasPrivateSession\\(request, env\\)/);
assert.match(source, /createOwnerCookie/);
assert.match(source, /OWNER_DISPLAY_NAME = "LINEレンジャーは神ゲー"/);
assert.doesNotMatch(source, /console\\.(log|info|debug)\\([^\\n]*(?:BOARD_OWNER_ACCESS_TOKEN|PRIVATE_PREVIEW_COOKIE_SECRET|BOARD_ANON_COOKIE_SECRET)/);

console.log("private dynamic preview gate contract: ok");
