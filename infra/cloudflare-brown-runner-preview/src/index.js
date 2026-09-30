const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
});

function secureHeaders(headers = new Headers()) {
  const result = new Headers(headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) result.set(name, value);
  return result;
}

function contentTypeForPath(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  return null;
}

async function serveAsset(request, env) {
  if (!env?.ASSETS?.fetch) {
    return new Response("Preview assets unavailable", {status: 503, headers: secureHeaders()});
  }

  const url = new URL(request.url);
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", {status: 400, headers: secureHeaders()});
  }
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return new Response("Bad Request", {status: 400, headers: secureHeaders()});
  }
  if (path === "/" || path === "") path = "/index.html";

  const assetUrl = new URL(request.url);
  assetUrl.pathname = path;
  assetUrl.search = "";
  assetUrl.hash = "";
  const upstream = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    method: request.method,
    headers: request.headers,
  }));
  if (!upstream.ok) {
    return new Response("Not Found", {status: upstream.status, headers: secureHeaders()});
  }

  const headers = secureHeaders(upstream.headers);
  headers.delete("content-length");
  const contentType = contentTypeForPath(path.toLowerCase());
  if (contentType) headers.set("content-type", contentType);
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: secureHeaders(new Headers({allow:"GET, HEAD"})),
      });
    }
    return serveAsset(request, env);
  },
};