"use strict";

// Fast-path the large PvP snapshot without weakening app.js validation.
// - removes the per-request cache-busting query that bypassed the CDN
// - reuses the last browser-verified network response on repeat visits
// - revalidates that cached response in the background
// - prefers the Cloudflare Worker data endpoint when GitHub Pages is the UI host
(() => {
  const nativeFetch = window.fetch.bind(window);
  const CACHE_NAME = "line-rangers-pvp-runtime-v1";
  const DATA_FILE = "/data/character_usage.json";
  const WORKER_DATA_URL =
    "https://line-rangers-pvp-community-production.n-yu1791.workers.dev/pvp/data/character_usage.json";
  const MAX_CACHE_TEXT_LENGTH = 4 * 1024 * 1024;
  let servedCachedSnapshot = false;
  let refreshScheduled = false;

  function dataRequestUrl(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.href);
      if (!url.pathname.endsWith(DATA_FILE)) return null;
      url.searchParams.delete("v");
      return url;
    } catch {
      return null;
    }
  }

  function isGetRequest(input, init) {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    return method === "GET";
  }

  function safeFetchInit(input, init, cacheMode) {
    const source = input instanceof Request
      ? {
          method: input.method,
          headers: input.headers,
          credentials: input.credentials,
          mode: input.mode,
          redirect: input.redirect,
          referrer: input.referrer,
          referrerPolicy: input.referrerPolicy,
          integrity: input.integrity,
          keepalive: input.keepalive,
          signal: input.signal,
        }
      : {};
    return {
      ...source,
      ...(init || {}),
      cache: cacheMode,
    };
  }

  async function cacheSnapshot(cacheKey, response) {
    if (!(response instanceof Response) || !response.ok || !("caches" in window)) return;
    try {
      const copy = response.clone();
      const text = await copy.text();
      if (!text || text.length > MAX_CACHE_TEXT_LENGTH) return;
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.characters) || parsed.characters.length === 0) return;
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        cacheKey,
        new Response(text, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-LR-Runtime-Cache": "1",
          },
        }),
      );
    } catch {
      // CacheStorage is an optimization only. Never block the canonical loader.
    }
  }

  async function fetchNetwork(canonicalUrl, input, init, cacheMode = "default") {
    const candidates = [];
    if (window.location.hostname.endsWith("github.io")) {
      candidates.push(WORKER_DATA_URL);
    }
    candidates.push(canonicalUrl.href);

    let lastResponse = null;
    let lastError = null;
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      try {
        const response = await nativeFetch(
          candidate,
          safeFetchInit(input, init, cacheMode),
        );
        lastResponse = response;
        if (!response.ok) continue;
        void cacheSnapshot(canonicalUrl.href, response);
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError || new TypeError("PvP snapshot fetch failed");
  }

  function scheduleRevalidation(canonicalUrl, input, init) {
    if (refreshScheduled) return;
    refreshScheduled = true;
    const refresh = () => {
      void fetchNetwork(canonicalUrl, input, init, "no-cache")
        .catch(() => {})
        .finally(() => {
          refreshScheduled = false;
        });
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(refresh, { timeout: 1200 });
    } else {
      window.setTimeout(refresh, 350);
    }
  }

  window.fetch = async function fastPvPFetch(input, init) {
    const canonicalUrl = dataRequestUrl(input);
    if (!canonicalUrl || !isGetRequest(input, init)) {
      return nativeFetch(input, init);
    }

    // app.js used ?v=Date.now() + cache:no-store. Ignore those two cache
    // busters only for the canonical public snapshot; app.js still performs
    // full schema/integrity validation on every Response we return.
    if (!servedCachedSnapshot && "caches" in window) {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(canonicalUrl.href);
        if (cached) {
          servedCachedSnapshot = true;
          scheduleRevalidation(canonicalUrl, input, init);
          return cached;
        }
      } catch {
        // Fall through to the network path.
      }
    }

    return fetchNetwork(canonicalUrl, input, init, "default");
  };
})();
