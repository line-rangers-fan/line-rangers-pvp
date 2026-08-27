import assert from "node:assert/strict";
import test from "node:test";

import {
  dataNeedsCollection,
  runWatchdog,
} from "../infra/cloudflare-watchdog/src/index.mjs";


const NOW = Date.parse("2026-08-27T04:00:00Z");
const ENV = {
  GITHUB_REPOSITORY: "line-rangers-fan/line-rangers-pvp",
  DATA_URL: "https://example.test/character_usage.json",
  GITHUB_ACTIONS_TOKEN: "test-token",
};


test("fresh data does not dispatch GitHub", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ updated_at: "2026-08-27T03:10:00Z" }),
      { status: 200 },
    );
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, { dispatched: false, reason: "fresh" });
  assert.equal(calls.length, 1);
});


test("stale data dispatches the guarded collection workflow", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify({ updated_at: "2026-08-27T03:05:00Z" }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, {
    dispatched: true,
    reason: "stale_or_unreadable",
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /update-character-usage\.yml\/dispatches$/);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer test-token",
  );
});


test("missing and future timestamps request repair", () => {
  assert.equal(dataNeedsCollection({}, NOW), true);
  assert.equal(
    dataNeedsCollection({ updated_at: "2026-08-27T04:11:00Z" }, NOW),
    true,
  );
});
