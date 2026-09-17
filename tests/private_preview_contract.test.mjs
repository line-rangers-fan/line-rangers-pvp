import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

assert.ok(source.includes("PRIVATE_PREVIEW_MODE"));
assert.ok(source.includes("PRIVATE_PREVIEW_COOKIE_SECRET"));
assert.ok(source.includes("BOARD_OWNER_ACCESS_TOKEN"));
assert.ok(source.includes("BOARD_OWNER_SUBJECT"));
assert.ok(source.includes("__Host-lr_private_preview"));
assert.ok(source.includes("__Host-lr_owner"));
assert.ok(source.includes("__Host-lr_display_name"));
assert.ok(source.includes("PRIVATE_ENTRY_PATH"));
assert.ok(source.includes("PRIVATE_ENTRY_COOKIE"));
assert.ok(source.includes("__private/login"));
assert.ok(source.includes("__private/activate"));
assert.ok(source.includes("privateNotFound"));
assert.ok(source.includes("__private/logout"));
assert.ok(source.includes("sameSecret"));
assert.ok(source.includes("x-robots-tag"));
assert.ok(source.includes("X-Frame-Options"));
assert.ok(source.includes("privatePreviewEnabled(env)"));
assert.ok(source.includes("!await hasPrivateSession(request, env)"));
assert.ok(source.includes("createOwnerCookie"));
assert.ok(source.includes('OWNER_DISPLAY_NAME = "LINEレンジャーは神ゲー"'));
assert.doesNotMatch(
  source,
  /console\.(log|info|debug)\([^\n]*(?:BOARD_OWNER_ACCESS_TOKEN|PRIVATE_PREVIEW_COOKIE_SECRET|BOARD_ANON_COOKIE_SECRET)/
);

console.log("private dynamic preview gate contract: ok");
