const OWNER_TOKEN_SHA256 = "3e422c299a6cae56999f3cc01b0c96bafeb7b880701ab048c1e96198067416e3";
const RAW_BASE = "https://raw.githubusercontent.com/line-rangers-fan/line-rangers-pvp/main/docs";
const COOKIE_NAME = "lr_owner_preview";

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function maintenancePage() {
  return html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LINEレンジャー PvP統計サイト</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#eef7ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(680px,calc(100% - 32px));box-sizing:border-box;padding:36px 28px;border:1px solid #1f3a4d;border-radius:20px;background:#0c1a2a;box-shadow:0 18px 60px rgba(0,0,0,.28)}.k{color:#59d38c;font-weight:800;letter-spacing:.12em;font-size:.78rem}h1{font-size:clamp(1.6rem,6vw,2.5rem);margin:.5rem 0 1rem}p{line-height:1.8;color:#c8d7e5}</style></head><body><main class="card"><div class="k">UNDER MAINTENANCE</div><h1>現在、サイトを改修しています。</h1><p>掲示板サイトの併設、キャラクター情報・スキル情報の追加のため、一時的に閉鎖しています。</p><p>より使いやすいサイトにするため調整中です。公開再開までしばらくお待ちください。</p></main></body></html>`);
}

function loginPage(error = "", status = 200) {
  return html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner Preview</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#eef7ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(460px,calc(100% - 32px));box-sizing:border-box;padding:32px;border:1px solid #1f3a4d;border-radius:18px;background:#0c1a2a}label{display:block;margin-bottom:8px}input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #345;background:#07111f;color:#fff}button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#35c978;color:#04130b;font-weight:800}.e{color:#ff9d9d}</style></head><body><main class="card"><h1>Owner Preview</h1><p>管理者専用プレビューです。</p>${error ? `<p class="e">${error}</p>` : ""}<form method="post" action="/owner/login"><label for="token">アクセスキー</label><input id="token" name="token" type="password" autocomplete="current-password" required><button type="submit">開く</button></form></main></body></html>`, status);
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const value = cookieValue(request);
  return Boolean(value) && (await sha256Hex(value)) === OWNER_TOKEN_SHA256;
}

function stripMaintenance(htmlText) {
  return htmlText
    .replace(/\s*<link\s+rel="stylesheet"\s+href="\.\/assets\/maintenance\.css\?[^>]+>\s*/i, "\n")
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

async function proxySite(request) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.includes("..")) return new Response("Bad Request", { status: 400 });
  if (path === "/" || path === "") path = "/index.html";

  const upstream = await fetch(`${RAW_BASE}${path}`, {
    method: request.method,
    headers: { "user-agent": "line-rangers-owner-preview/1.0" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!upstream.ok) return new Response("Not Found", { status: upstream.status });

  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("x-content-type-options", "nosniff");
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
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/owner" && request.method === "GET") {
      if (await isAuthorized(request)) return Response.redirect(`${url.origin}/`, 302);
      return loginPage();
    }
    if (url.pathname === "/owner/login" && request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") || "0");
      if (contentLength > 2048) return new Response("Payload Too Large", { status: 413 });
      const form = await request.formData();
      const token = String(form.get("token") || "");
      if (!token || (await sha256Hex(token)) !== OWNER_TOKEN_SHA256) {
        return loginPage("アクセスキーが違います。", 401);
      }
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
          "cache-control": "no-store",
        },
      });
    }
    if (url.pathname === "/owner/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/owner",
          "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
          "cache-control": "no-store",
        },
      });
    }
    if (!(await isAuthorized(request))) return maintenancePage();
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    return proxySite(request);
  },
};
