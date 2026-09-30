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

function secured(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return secured(new Response("Method Not Allowed", {status: 405, headers:{allow:"GET, HEAD"}}));
    }
    const url = new URL(request.url);
    if (url.pathname === "/") url.pathname = "/index.html";
    const assetRequest = new Request(url, request);
    return secured(await env.ASSETS.fetch(assetRequest));
  },
};