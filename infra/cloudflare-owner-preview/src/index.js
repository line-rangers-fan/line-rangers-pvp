function commonSecurityHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
    "strict-transport-security": "max-age=31536000",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

function stripMaintenance(htmlText) {
  return htmlText
    .replace(/\s*<link\s+rel="stylesheet"\s+href="\.\/assets\/maintenance\.css\?[^>]+>\s*/i, "\n")
    .replace(/<html\s+lang="ja">/i, '<html lang="ja" data-repo-preview="true">')
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


const OWNER_SESSION_COOKIE = "__Host-lr_owner_preview";
const OWNER_SESSION_TTL_SECONDS = 8 * 60 * 60;
const PRIVATE_BOARD_PREVIEW_PATH = "/__owner/board-staging-required";
const textEncoder = new TextEncoder();

function privateHeaders(extra = {}) {
  const headers = new Headers(commonSecurityHeaders());
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return headers;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function constantTimeEqual(left, right) {
  const a = textEncoder.encode(String(left));
  const b = textEncoder.encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(value)
  );
  return bytesToHex(new Uint8Array(signature));
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  if (cookieHeader.length > 8192) return "";
  for (const piece of cookieHeader.split(";")) {
    const separator = piece.indexOf("=");
    if (separator < 0) continue;
    if (piece.slice(0, separator).trim() !== name) continue;
    const value = piece.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

async function hasOwnerSession(request, env) {
  const secret = typeof env?.OWNER_PREVIEW_COOKIE_SECRET === "string"
    ? env.OWNER_PREVIEW_COOKIE_SECRET
    : "";
  const cookie = readCookie(request, OWNER_SESSION_COOKIE);
  if (!secret || !cookie || cookie.length > 512) return false;

  const parts = cookie.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return false;

  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt < now ||
    expiresAt - issuedAt > OWNER_SESSION_TTL_SECONDS
  ) {
    return false;
  }

  const payload = parts.slice(0, 4).join(".");
  const expectedSignature = await hmacHex(secret, payload);
  return constantTimeEqual(parts[4], expectedSignature);
}

async function createOwnerSession(secret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + OWNER_SESSION_TTL_SECONDS;
  const payload = ["v1", issuedAt, expiresAt, randomHex()].join(".");
  return payload + "." + await hmacHex(secret, payload);
}

function sessionCookie(value, maxAge) {
  return OWNER_SESSION_COOKIE + "=" + value +
    "; Max-Age=" + maxAge +
    "; Path=/; HttpOnly; Secure; SameSite=Strict";
}

function redirectToLogin() {
  const headers = privateHeaders({ location: "/__owner/login" });
  return new Response(null, { status: 303, headers });
}

function ownerLoginPage() {
  return [
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Owner Preview</title></head><body>",
    "<main><h1>Owner Preview / 運営プレビュー</h1>",
    "<p>運営専用の非公開確認画面です。/ Private owner-only review.</p>",
    "<form method=\"post\" action=\"/__owner/activate\" autocomplete=\"off\">",
    "<label>運営アクセス / Owner access ",
    "<input type=\"password\" name=\"access_token\" required minlength=\"1\" ",
    "autocomplete=\"current-password\"></label>",
    "<button type=\"submit\">入る / Enter</button></form></main>",
    "</body></html>"
  ].join("");
}

function ownerLoginResponse(request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateHeaders({ allow: "GET, HEAD" }),
    });
  }
  const headers = privateHeaders({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'",
  });
  return new Response(
    request.method === "HEAD" ? null : ownerLoginPage(),
    { status: 200, headers }
  );
}

async function readAccessToken(request) {
  const contentType = request.headers.get("content-type") || "";
  const body = await request.text();
  if (body.length > 4096) return "";

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
      return "";
    }
  }
  return new URLSearchParams(body).get("access_token") || "";
}

async function ownerActivate(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateHeaders({ allow: "POST" }),
    });
  }

  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) {
        return new Response("Forbidden", {
          status: 403,
          headers: privateHeaders(),
        });
      }
    } catch {
      return new Response("Forbidden", {
        status: 403,
        headers: privateHeaders(),
      });
    }
  }

  const expectedToken = typeof env?.BOARD_OWNER_ACCESS_TOKEN === "string"
    ? env.BOARD_OWNER_ACCESS_TOKEN
    : "";
  const cookieSecret = typeof env?.OWNER_PREVIEW_COOKIE_SECRET === "string"
    ? env.OWNER_PREVIEW_COOKIE_SECRET
    : "";
  if (!expectedToken || !cookieSecret) {
    return new Response("Preview authentication is unavailable", {
      status: 503,
      headers: privateHeaders(),
    });
  }

  const providedToken = await readAccessToken(request);
  if (!constantTimeEqual(providedToken, expectedToken)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: privateHeaders(),
    });
  }

  const value = await createOwnerSession(cookieSecret);
  const headers = privateHeaders({ location: "/" });
  headers.set("set-cookie", sessionCookie(value, OWNER_SESSION_TTL_SECONDS));
  return new Response(null, { status: 303, headers });
}

function ownerLogout(request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateHeaders({ allow: "POST" }),
    });
  }
  const headers = privateHeaders({ location: "/__owner/login" });
  headers.set("set-cookie", sessionCookie("", 0));
  return new Response(null, { status: 303, headers });
}

function ownerBoardStagingRequiredPage(request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateHeaders({ allow: "GET, HEAD" }),
    });
  }
  const headers = privateHeaders({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  const body = [
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Private board staging</title></head><body>",
    "<main><h1>非公開掲示板プレビュー / Private board preview</h1>",
    "<p>この確認環境から公開Communityへは移動しません。</p>",
    "<p>This private review does not open the public Community.</p>",
    "<p>隔離されたD1/R2の動的検証環境を準備後に確認できます。</p>",
    "</main></body></html>",
  ].join("");
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
}

function isolateCommunityEntry(script) {
  return script.replace(
    /https?:\/\/line-rangers-pvp-community-[^"'\s]+\/boards/g,
    PRIVATE_BOARD_PREVIEW_PATH
  );
}

async function serveSite(request, env) {
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
  } catch {
    return new Response("Bad Request", {
      status: 400,
      headers: commonSecurityHeaders(),
    });
  }

  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return new Response("Bad Request", {
      status: 400,
      headers: commonSecurityHeaders(),
    });
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
  for (const [key, value] of Object.entries(commonSecurityHeaders())) {
    headers.set(key, value);
  }
  headers.delete("content-length");

  const contentType = contentTypeForPath(path);
  if (contentType) headers.set("content-type", contentType);

  if (path === "/assets/community-entry.js" && request.method !== "HEAD") {
    const body = isolateCommunityEntry(await upstream.text());
    headers.set("content-type", "application/javascript; charset=utf-8");
    headers.delete("content-encoding");
    headers.delete("etag");
    return new Response(body, { status: upstream.status, headers });
  }

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

const ownerPreviewWorker = {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/__owner/login") {
      return ownerLoginResponse(request);
    }
    if (pathname === "/__owner/activate") {
      return ownerActivate(request, env);
    }
    if (pathname === "/__owner/logout") {
      return ownerLogout(request);
    }

    if (pathname === PRIVATE_BOARD_PREVIEW_PATH) {
      if (!await hasOwnerSession(request, env)) {
        return redirectToLogin();
      }
      return ownerBoardStagingRequiredPage(request);
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: privateHeaders({ allow: "GET, HEAD" }),
      });
    }

    if (!await hasOwnerSession(request, env)) {
      return redirectToLogin();
    }

    return serveSite(request, env);
  },
};

export default ownerPreviewWorker;
