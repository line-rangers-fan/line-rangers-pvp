import assert from "node:assert/strict";
import test from "node:test";

import {
  dataNeedsCollection,
  getHealthSnapshot,
  inspectDataHealth,
  runWatchdog,
} from "../infra/cloudflare-watchdog/src/index.mjs";


const NOW = Date.parse("2026-08-27T04:00:00Z");
const ENV = {
  GITHUB_REPOSITORY: "line-rangers-fan/line-rangers-pvp",
  DATA_URL: "https://example.test/character_usage.json",
  GITHUB_ACTIONS_TOKEN: "test-token",
};

function healthyData(updatedAt, overrides = {}) {
  return {
    updated_at: updatedAt,
    target_players: 200,
    sampled_players: 200,
    complete_target: true,
    characters: [{ unit_code: "u-a" }],
    collection_quality: {
      sample_coverage: 100,
      equipment_fill_rate: 99.9,
      detail_fetch_failures: 0,
      invalid_player_records: 0,
      collection_duration_seconds: 42.5,
    },
    ...overrides,
  };
}


test("fresh data does not dispatch GitHub", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify(healthyData("2026-08-27T03:10:00Z")),
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
        JSON.stringify(healthyData("2026-08-27T03:05:00Z")),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, {
    dispatched: true,
    reason: "stale",
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
    dataNeedsCollection(healthyData("2026-08-27T04:11:00Z"), NOW),
    true,
  );
});


test("health snapshot reports freshness and age", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify(healthyData("2026-08-27T03:10:00Z")),
    { status: 200 },
  );

  const health = await getHealthSnapshot(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(health, {
    status: "ok",
    service: "line-rangers-pvp-watchdog",
    schedule: "27 * * * *",
    updated_at: "2026-08-27T03:10:00Z",
    age_minutes: 50,
    sampled_players: 200,
    target_players: 200,
    equipment_fill_rate: 99.9,
    detail_fetch_failures: 0,
    invalid_player_records: 0,
    collection_duration_seconds: 42.5,
    stale_after_minutes: 55,
    checked_at: "2026-08-27T04:00:00.000Z",
  });
});


test("health inspection distinguishes stale and invalid data", () => {
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:05:00Z"),
      NOW,
    ).status,
    "stale",
  );
  assert.equal(inspectDataHealth({}, NOW).status, "unreadable");
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T04:11:00Z"),
      NOW,
    ).status,
    "invalid_timestamp",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", { sampled_players: 199 }),
      NOW,
    ).status,
    "invalid_data",
  );
});


test("fresh but incomplete data triggers repair", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify(healthyData("2026-08-27T03:50:00Z", {
          complete_target: false,
        })),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, { dispatched: true, reason: "invalid_data" });
  assert.equal(calls.length, 2);
});
