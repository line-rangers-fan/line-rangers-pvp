function commonSecurityHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
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
  } catch (_error) {
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
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...commonSecurityHeaders(), Allow: "GET, HEAD" },
      });
    }

    return serveSite(request, env);
  },
};
