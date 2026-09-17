import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ownerPreviewWorker from "../infra/cloudflare-owner-preview/src/index.js";

const source = await readFile(new URL("../infra/cloudflare-owner-preview/src/index.js", import.meta.url), "utf8");
const wrangler = await readFile(new URL("../infra/cloudflare-owner-preview/wrangler.toml", import.meta.url), "utf8");

assert.match(source, /application\/javascript; charset=utf-8/);
assert.match(source, /text\/css; charset=utf-8/);
assert.match(source, /application\/json; charset=utf-8/);
assert.match(source, /headers\.delete\("content-length"\)/);
assert.match(source, /headers\.delete\("content-encoding"\)/);
assert.match(source, /"x-content-type-options": "nosniff"/);
assert.match(source, /"strict-transport-security": "max-age=31536000"/);
assert.match(source, /"x-frame-options": "DENY"/);
assert.match(source, /"x-robots-tag": "noindex, nofollow, noarchive, nosnippet"/);

assert.match(source, /env\?\.ASSETS\?\.fetch/);
assert.match(source, /env\.ASSETS\.fetch/);
assert.match(source, /data-repo-preview="true"/);
assert.match(source, /\["GET", "HEAD"\]/);
assert.match(source, /stripMaintenance/);
assert.match(source, /BOARD_OWNER_ACCESS_TOKEN/);
assert.match(source, /OWNER_PREVIEW_COOKIE_SECRET/);
assert.match(source, /__Host-lr_owner_preview/);
assert.match(source, /__owner\/login/);
assert.match(source, /constantTimeEqual/);
assert.match(source, /PRIVATE_BOARD_PREVIEW_PATH/);
assert.match(source, /isolateCommunityEntry/);
assert.doesNotMatch(source, /raw\.githubusercontent\.com/);
assert.doesNotMatch(source, /chatgpt\.site/);

assert.match(wrangler, /directory = "\.\.\/\.\.\/docs"/);
assert.match(wrangler, /binding = "ASSETS"/);
assert.match(wrangler, /run_worker_first = true/);

const html = "<html lang=\"ja\"><body class=\"maintenance-mode\">" +
  "<section class=\"maintenance-screen\">maintenance</section>" +
  "<main><h1>レジェンド帯 キャラ集計</h1></main></body></html>";
const ownerAccessToken = "test-owner-access-token";
const env = {
  BOARD_OWNER_ACCESS_TOKEN: ownerAccessToken,
  OWNER_PREVIEW_COOKIE_SECRET: "test-cookie-secret",
  ASSETS: {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/assets/community-entry.js") {
        return new Response(
          "const boardUrl = 'https://line-rangers-pvp-community-production.n-yu1791.workers.dev/boards';",
          { status: 200, headers: { "content-type": "application/javascript" } }
        );
      }
      if (pathname === "/index.html") {
        return new Response(html, {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": "999",
            "content-encoding": "gzip",
            etag: "test-etag",
          },
        });
      }
      return new Response("asset", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "5" },
      });
    },
  },
};
const base = "https://preview.example";

const locked = await ownerPreviewWorker.fetch(new Request(base + "/"), env);
assert.equal(locked.status, 303);
assert.equal(locked.headers.get("location"), "/__owner/login");

const login = await ownerPreviewWorker.fetch(new Request(base + "/__owner/login"), env);
assert.equal(login.status, 200);
assert.match(await login.text(), /__owner\/activate/);

const wrongOrigin = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/activate", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "access_token=" + ownerAccessToken,
  }),
  env
);
assert.equal(wrongOrigin.status, 403);

const wrongToken = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/activate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "access_token=wrong",
  }),
  env
);
assert.equal(wrongToken.status, 401);
assert.equal(wrongToken.headers.get("set-cookie"), null);

const activated = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/activate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "access_token=" + ownerAccessToken,
  }),
  env
);
assert.equal(activated.status, 303);
assert.equal(activated.headers.get("location"), "/");
const setCookie = activated.headers.get("set-cookie") || "";
const cookieMatch = setCookie.match(/(__Host-lr_owner_preview=[^;]+)/);
assert.ok(cookieMatch, "owner session cookie should be issued");
const cookiePair = cookieMatch[1];

const unlocked = await ownerPreviewWorker.fetch(
  new Request(base + "/", { headers: { cookie: cookiePair } }),
  env
);
assert.equal(unlocked.status, 200);
const unlockedHtml = await unlocked.text();
assert.match(unlockedHtml, /レジェンド帯 キャラ集計/);
assert.doesNotMatch(unlockedHtml, /maintenance-screen/);
assert.equal(unlocked.headers.get("content-type"), "text/html; charset=utf-8");
assert.equal(unlocked.headers.get("content-encoding"), null);

const lockedBoard = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/board-staging-required"),
  env
);
assert.equal(lockedBoard.status, 303);

const communityEntry = await ownerPreviewWorker.fetch(
  new Request(base + "/assets/community-entry.js", {
    headers: { cookie: cookiePair },
  }),
  env
);
assert.equal(communityEntry.status, 200);
const communityEntryBody = await communityEntry.text();
assert.match(communityEntryBody, /__owner\/board-staging-required/);
assert.doesNotMatch(communityEntryBody, /line-rangers-pvp-community-production/);

const privateBoard = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/board-staging-required", {
    headers: { cookie: cookiePair },
  }),
  env
);
assert.equal(privateBoard.status, 200);
assert.match(await privateBoard.text(), /Private board preview/);

const asset = await ownerPreviewWorker.fetch(
  new Request(base + "/assets/app.js", { headers: { cookie: cookiePair } }),
  env
);
assert.equal(asset.status, 200);
assert.equal(asset.headers.get("content-type"), "application/javascript; charset=utf-8");
assert.equal(asset.headers.get("content-length"), null);

const loggedOut = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/logout", {
    method: "POST",
    headers: { cookie: cookiePair },
  }),
  env
);
assert.equal(loggedOut.status, 303);
assert.match(loggedOut.headers.get("set-cookie") || "", /Max-Age=0/);

const unavailable = await ownerPreviewWorker.fetch(
  new Request(base + "/__owner/activate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "access_token=" + ownerAccessToken,
  }),
  { ...env, OWNER_PREVIEW_COOKIE_SECRET: "" }
);
assert.equal(unavailable.status, 503);

console.log("owner-only private-repo preview, security, MIME, and auth guards: ok");
