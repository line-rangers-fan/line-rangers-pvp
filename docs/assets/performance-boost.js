"use strict";

// Fast-path the large PvP snapshot without weakening app.js validation.
// - removes the per-request cache-busting query that bypassed the CDN
// - reuses only a very recent browser-verified response on repeat visits
// - revalidates that cached response in the background
// - prefers the Cloudflare Worker data endpoint when GitHub Pages is the UI host
// - bounds the Worker fast path so a slow mirror cannot delay the Pages fallback
(() => {
  const nativeFetch = window.fetch.bind(window);
  const CACHE_NAME = "line-rangers-pvp-runtime-v2";
  const OLD_CACHE_NAME = "line-rangers-pvp-runtime-v1";
  const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
  const WORKER_FAST_PATH_TIMEOUT_MS = 2500;
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

  function requestSignal(input, init) {
    return init?.signal || (input instanceof Request ? input.signal : null) || null;
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

  async function fetchCandidate(url, input, init, cacheMode, timeoutMs = 0) {
    if (!(timeoutMs > 0)) {
      return nativeFetch(url, safeFetchInit(input, init, cacheMode));
    }

    const externalSignal = requestSignal(input, init);
    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", relayAbort, { once: true });
      }
    }
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await nativeFetch(url, {
        ...safeFetchInit(input, init, cacheMode),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error("Fast snapshot source timed out");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      externalSignal?.removeEventListener?.("abort", relayAbort);
    }
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
            "X-LR-Cached-At": String(Date.now()),
          },
        }),
      );
      void caches.delete(OLD_CACHE_NAME).catch(() => {});
    } catch {
      // CacheStorage is an optimization only. Never block the canonical loader.
    }
  }

  async function fetchNetwork(canonicalUrl, input, init, cacheMode = "default") {
    const candidates = [];
    if (window.location.hostname.endsWith("github.io")) {
      candidates.push({ url: WORKER_DATA_URL, timeoutMs: WORKER_FAST_PATH_TIMEOUT_MS });
    }
    candidates.push({ url: canonicalUrl.href, timeoutMs: 0 });

    let lastResponse = null;
    let lastError = null;
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      try {
        const response = await fetchCandidate(
          candidate.url,
          input,
          init,
          cacheMode,
          candidate.timeoutMs,
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

  async function recentCachedResponse(cacheKey) {
    if (!("caches" in window)) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (!cached) return null;
      const cachedAt = Number(cached.headers.get("X-LR-Cached-At"));
      if (!Number.isFinite(cachedAt) || cachedAt > Date.now() || Date.now() - cachedAt > CACHE_MAX_AGE_MS) {
        await cache.delete(cacheKey).catch(() => {});
        return null;
      }
      return cached;
    } catch {
      return null;
    }
  }

  window.fetch = async function fastPvPFetch(input, init) {
    const canonicalUrl = dataRequestUrl(input);
    if (!canonicalUrl || !isGetRequest(input, init)) {
      return nativeFetch(input, init);
    }

    // app.js uses ?v=Date.now() + cache:no-store. Ignore those two cache
    // busters only for the canonical public snapshot; app.js still performs
    // full schema/integrity validation on every Response we return.
    if (!servedCachedSnapshot) {
      const cached = await recentCachedResponse(canonicalUrl.href);
      if (cached) {
        servedCachedSnapshot = true;
        scheduleRevalidation(canonicalUrl, input, init);
        return cached;
      }
    }

    return fetchNetwork(canonicalUrl, input, init, "default");
  };
})();
