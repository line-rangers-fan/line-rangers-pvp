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
  DATA_URL: "https://line-rangers-fan.github.io/line-rangers-pvp/data/character_usage.json",
  GITHUB_ACTIONS_TOKEN: "test-token",
};

function healthyData(updatedAt, overrides = {}) {
  return {
    schema_version: 10,
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
      detail_fetch_duration_seconds: 40,
    },
    comparison: {
      periods: {
        hour: { comparable: false },
        day: { comparable: false },
        week: { comparable: false },
        month: { comparable: false },
      },
    },
    ...overrides,
  };
}


test("fresh data does not dispatch GitHub", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify(healthyData("2026-08-27T03:10:00Z")),
      { status: 200 },
    );
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, { dispatched: false, reason: "fresh" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "error");
});


test("stale data dispatches the guarded collection workflow", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify(healthyData("2026-08-27T02:54:00Z")),
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
    schedule: "*/15 * * * *",
    updated_at: "2026-08-27T03:10:00Z",
    age_minutes: 50,
    sampled_players: 200,
    target_players: 200,
    equipment_fill_rate: 99.9,
    detail_fetch_failures: 0,
    invalid_player_records: 0,
    collection_duration_seconds: 42.5,
    detail_fetch_duration_seconds: 40,
    stale_after_minutes: 60,
    checked_at: "2026-08-27T04:00:00.000Z",
  });
});


test("health inspection distinguishes stale and invalid data", () => {
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T02:54:00Z"),
      NOW,
    ).status,
    "stale",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", { schema_version: 9 }),
      NOW,
    ).status,
    "invalid_data",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", {
        comparison: {
          periods: {
            day: { comparable: false },
            week: { comparable: false },
            month: { comparable: false },
          },
        },
      }),
      NOW,
    ).status,
    "invalid_data",
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
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", {
        collection_quality: {
          ...healthyData("2026-08-27T03:10:00Z").collection_quality,
          detail_fetch_duration_seconds: 60,
          collection_duration_seconds: 30,
        },
      }),
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


test("watchdog rejects unsafe repository and data URL configuration", async () => {
  await assert.rejects(
    runWatchdog({ ...ENV, GITHUB_REPOSITORY: "owner/repo/extra" }),
    /owner\/repository/,
  );
  await assert.rejects(
    getHealthSnapshot({ ...ENV, DATA_URL: "http://example.test/data.json" }),
    /published ranking JSON URL/,
  );
  await assert.rejects(
    getHealthSnapshot({ ...ENV, DATA_URL: "https://example.test/data.json" }),
    /published ranking JSON URL/,
  );
});


test("oversized published data is treated as unreadable", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let health;
  try {
    health = await getHealthSnapshot(ENV, {
      fetchImpl: async () => new Response(
        "x".repeat(4 * 1024 * 1024 + 1),
        { status: 200 },
      ),
      nowMs: NOW,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(health.status, "unreadable");
});
