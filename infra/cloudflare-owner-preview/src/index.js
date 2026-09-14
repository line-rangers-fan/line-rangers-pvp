const OWNER_TOKEN_SHA256 = "6e5695de527d439cda9a2d0741584c38983eddcbeb5770319e976d5e0fd61adc";
const COOKIE_NAME = "__Host-lr_owner_preview_v2";
const SESSION_MAX_AGE_SECONDS = 3600;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedAttempts = new Map();

function commonSecurityHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...commonSecurityHeaders(),
      ...headers,
    },
  });
}

function maintenancePage() {
  return html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>LINEレンジャー PvP統計サイト</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#eef7ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(680px,calc(100% - 32px));box-sizing:border-box;padding:36px 28px;border:1px solid #1f3a4d;border-radius:20px;background:#0c1a2a;box-shadow:0 18px 60px rgba(0,0,0,.28)}.k{color:#59d38c;font-weight:800;letter-spacing:.12em;font-size:.78rem}h1{font-size:clamp(1.6rem,6vw,2.5rem);margin:.5rem 0 1rem}p{line-height:1.8;color:#c8d7e5}</style></head><body><main class="card"><div class="k">UNDER MAINTENANCE</div><h1>現在、サイトを改修しています。</h1><p>掲示板サイトの併設、キャラクター情報・スキル情報の追加のため、一時的に閉鎖しています。</p><p>より使いやすいサイトにするため調整中です。公開再開までしばらくお待ちください。</p></main></body></html>`);
}

function loginPage(error = "", status = 200) {
  return html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Owner Preview</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#eef7ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(460px,calc(100% - 32px));box-sizing:border-box;padding:32px;border:1px solid #1f3a4d;border-radius:18px;background:#0c1a2a}label{display:block;margin-bottom:8px}input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #345;background:#07111f;color:#fff}button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#35c978;color:#04130b;font-weight:800}.e{color:#ff9d9d}</style></head><body><main class="card"><h1>Owner Preview</h1><p>管理者専用プレビューです。</p>${error ? `<p class="e">${error}</p>` : ""}<form method="post" action="/owner/login"><label for="token">アクセスキー</label><input id="token" name="token" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required><button type="submit">開く</button></form></main></body></html>`, status);
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tokenMatches(value) {
  if (!value) return false;
  return constantTimeEqualHex(await sha256Hex(value), OWNER_TOKEN_SHA256);
}

function cookieValue(request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function isAuthorized(request) {
  return tokenMatches(cookieValue(request));
}

function clientKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function isLockedOut(request) {
  const key = clientKey(request);
  const state = failedAttempts.get(key);
  if (!state) return false;
  if (Date.now() - state.firstAt >= LOCKOUT_MS) {
    failedAttempts.delete(key);
    return false;
  }
  return state.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(request) {
  const key = clientKey(request);
  const now = Date.now();
  const state = failedAttempts.get(key);
  if (!state || now - state.firstAt >= LOCKOUT_MS) {
    failedAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  state.count += 1;
  failedAttempts.set(key, state);
}

function clearFailedAttempts(request) {
  failedAttempts.delete(clientKey(request));
}

function stripMaintenance(htmlText) {
  return htmlText
    .replace(/\s*<link\s+rel="stylesheet"\s+href="\.\/assets\/maintenance\.css\?[^>]+>\s*/i, "\n")
    .replace(/<html\s+lang="ja">/i, '<html lang="ja" data-owner-preview="true">')
    .replace(/<body\s+class="maintenance-mode">/i, "<body>")
    .replace(/\s*<section class="maintenance-screen"[\s\S]*?<\/section>\s*/i, "\n");
}

function contentTypeForPath(path) {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".html")) return "text/html; charset=utf-8";
  if (normalized.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (normalized.endsWith(".css")) return "text/css; charset=utf-8";
  if (normalized.endsWith(".json")) return "application/json; charset=utf-8";
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".ico")) return "image/x-icon";
  if (normalized.endsWith(".woff2")) return "font/woff2";
  if (normalized.endsWith(".woff")) return "font/woff";
  if (normalized.endsWith(".mp4")) return "video/mp4";
  if (normalized.endsWith(".webm")) return "video/webm";
  return null;
}

async function proxySite(request, env) {
  if (!env?.ASSETS?.fetch) {
    return new Response("Preview assets unavailable", {
      status: 503,
      headers: commonSecurityHeaders(),
    });
  }

  const url = new URL(request.url);
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch (_error) {
    return new Response("Bad Request", { status: 400, headers: commonSecurityHeaders() });
  }

  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return new Response("Bad Request", { status: 400, headers: commonSecurityHeaders() });
  }
  if (path === "/" || path === "") path = "/index.html";

  const assetUrl = new URL(request.url);
  assetUrl.pathname = path;
  assetUrl.search = "";
  assetUrl.hash = "";

  const upstream = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: request.method,
      headers: request.headers,
    })
  );

  if (!upstream.ok) {
    return new Response("Not Found", {
      status: upstream.status,
      headers: commonSecurityHeaders(),
    });
  }

  const headers = new Headers(upstream.headers);
  for (const [key, value] of Object.entries(commonSecurityHeaders())) headers.set(key, value);
  headers.delete("content-length");

  const contentType = contentTypeForPath(path);
  if (contentType) headers.set("content-type", contentType);

  if (path === "/index.html" && request.method !== "HEAD") {
    const body = stripMaintenance(await upstream.text());
    headers.set("content-type", "text/html; charset=utf-8");
    headers.delete("content-encoding");
    headers.delete("etag");
    return new Response(body, { status: 200, headers });
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/owner" && request.method === "GET") {
      if (await isAuthorized(request)) return Response.redirect(`${url.origin}/`, 302);
      return loginPage();
    }

    if (url.pathname === "/owner/login" && request.method === "POST") {
      if (isLockedOut(request)) {
        return loginPage("試行回数が多すぎます。しばらく待ってから再試行してください。", 429);
      }

      const contentLength = Number(request.headers.get("content-length") || "0");
      if (contentLength > 2048) {
        return new Response("Payload Too Large", {
          status: 413,
          headers: commonSecurityHeaders(),
        });
      }

      const form = await request.formData();
      const token = String(form.get("token") || "");
      if (!(await tokenMatches(token))) {
        recordFailedAttempt(request);
        return loginPage("アクセスキーを確認してください。", 401);
      }

      clearFailedAttempts(request);
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
          ...commonSecurityHeaders(),
        },
      });
    }

    if (url.pathname === "/owner/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/owner",
          "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
          ...commonSecurityHeaders(),
        },
      });
    }

    if (!(await isAuthorized(request))) return maintenancePage();

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...commonSecurityHeaders(), Allow: "GET, HEAD" },
      });
    }

    return proxySite(request, env);
  },
};
